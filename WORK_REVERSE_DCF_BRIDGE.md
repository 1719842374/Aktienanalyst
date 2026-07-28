# WORK_REVERSE_DCF_BRIDGE.md

> Stand: 28.07.2026 | Nur Dokumentation  
> Reverse-DCF · Bridge · TTL · **Cache-Invalidierung** · **DCF-Modellierung mit Fiskaldaten**

---

# Teil 1 — Reverse DCF (Kern)

$$EV(g^*) = P \times Shares + NetDebt$$
g\* Binary Search · gapRatio = g\*/realized8Q → DCF_REALITY_CHECK

---

# Teil 2 — Bridge, TTL, Invalidierung

## 2.12 TTL (Kurz)

| status/confidence | TTL |
|-------------------|-----|
| announced/low | 3 d |
| announced/high | 14 d |
| legislated | 30 d |
| funded | 45 d |
| deploying | 60 d |
| expired | 0 |

Aktiv nur wenn: expiresAt ≥ asOf ∧ publishedAt ≤ asOf ∧ status ≠ expired ∧ endYear ok.

---

## 2.13 Cache-Invalidierung

TTL = passives Verfallen. **Invalidierung** = aktives, event-getriebenes Entfernen oder Zurückstufen.

### 2.13.1 Invalidierungs-Trigger

| # | Event | Aktion | Schwere |
|---|--------|--------|--------|
| I1 | Quelle dementiert / zurückgezogen (offiziell) | `status=expired`, `expiresAt=now` | hard |
| I2 | Budget gestrichen / Appropriation failed | `status=expired` oder `confidence=low` + TTL 3d | hard |
| I3 | endYear überschritten (Kalender) | `status=expired` | hard |
| I4 | Widerspruch neuer Extraction vs. Cache (Volume −50 %+ oder status-Downgrade) | Felder updaten, confidence senken, TTL verkürzen | soft/hard |
| I5 | Sector-Map-Treffer falsch (manuell oder Rule) | `sectorKeys` korrigieren; Catalyst-Recompute | soft |
| I6 | Max-Size Overflow | drop oldest announced+low | soft |
| I7 | GC-Cron / Briefing-Ende | `gcExpired(asOf)` | soft |
| I8 | Admin/API `invalidate(id)` | hard delete oder expired | hard |

### 2.13.2 Invalidierungs-API (Vertrag)

```ts
export type InvalidationReason =
  | 'denied'
  | 'defunded'
  | 'end_year'
  | 'contradiction'
  | 'sector_fix'
  | 'overflow'
  | 'ttl_gc'
  | 'manual';

export interface InvalidationEvent {
  programId: string;
  reason: InvalidationReason;
  at: string;                 // ISO as-of
  source?: { url: string; publishedAt: string; snippet: string };
  note?: string;
}

export function invalidateProgram(
  store: Map<string, FiscalProgram>,
  ev: InvalidationEvent
): FiscalProgram | null {
  const p = store.get(ev.programId);
  if (!p) return null;

  if (ev.reason === 'denied' || ev.reason === 'defunded' || ev.reason === 'end_year' || ev.reason === 'manual') {
    const row: FiscalProgram = {
      ...p,
      status: 'expired',
      expiresAt: ev.at,
      confidence: 'low',
      // Audit: letzte Source behalten + optional note in snippet-chain
    };
    store.set(row.id, row);
    return row;
  }

  if (ev.reason === 'contradiction') {
    const row: FiscalProgram = {
      ...p,
      confidence: p.confidence === 'high' ? 'medium' : 'low',
      expiresAt: computeExpiresAt(ev.at, p.status, 'low'),
    };
    store.set(row.id, row);
    return row;
  }

  if (ev.reason === 'ttl_gc' || ev.reason === 'overflow') {
    store.delete(ev.programId);
    return null;
  }

  return p;
}
```

### 2.13.3 Downstream-Propagierung (wer muss neu rechnen?)

```
invalidateProgram(id)
    │
    ├─► listActive / bySector        → UI Briefing & Sector-Tab sofort ohne Programm
    ├─► catalystsForTicker           → Catalyst `prog:id` fällt weg
    ├─► fiscalMegatrendQualifies     → ggf. DCF-Milderung AUS
    └─► optional: score-cache pro Ticker invalidieren
          key pattern: score:{ticker}:{asOfDate}
          wenn catalystEV oder gates von prog:id abhingen → Recompute-Flag
```

```ts
// Score-Cache-Keys die von Programmen abhängen
export function scoreCacheKeysTouchedByProgram(
  programId: string,
  tickers: string[],
  asOf: string
): string[] {
  return tickers.map(t => `score:${t}:${asOf}:prog:${programId}`);
}
```

**Regel:** Scoring-Ergebnisse, die ein jetzt invalidiertes Programm als Catalyst genutzt haben,  
dürfen nicht aus einem Warm-Cache kommen — entweder Recompute oder Cache-Eintrag droppen.

### 2.13.4 Widerspruchs-Detection (automatisch)

```ts
export function detectContradiction(prev: FiscalProgram, next: ProgramExtraction): InvalidationReason | null {
  if (next.status === 'expired' || /denied|cancelled|struck down/i.test(next.snippet))
    return 'denied';
  if (prev.volumeUsdBn && next.volumeUsdBn != null && next.volumeUsdBn < prev.volumeUsdBn * 0.5)
    return 'contradiction';
  const rank = { announced: 1, legislated: 2, funded: 3, deploying: 4, expired: 0 };
  if (rank[next.status] < rank[prev.status] && next.status !== 'expired')
    return 'contradiction'; // unerwartetes Downgrade
  return null;
}
```

Im Briefing-Upsert: bei `detectContradiction` → `invalidateProgram` oder confidence-Downgrade **vor** normalem upsert.

### 2.13.5 Invalidierungs-Checkliste

```
[ ] invalidateProgram + InvalidationEvent
[ ] hard: denied/defunded/end_year/manual → expired
[ ] soft: contradiction → confidence down + TTL kurz
[ ] GC + overflow
[ ] Score-Cache-Keys mit prog:id droppen
[ ] Briefing-UI liest nur isProgramActive
[ ] Audit-Log optional (wer/wann/warum)
```

---

# Teil 3 — DCF-Modellierung mit Fiskaldaten

> Ziel: Fiskalprogramme **sichtbar und konsistent** in Forward- und Reverse-DCF einbinden —  
> ohne Narrative-Bias und ohne Lookahead.

## 3.1 Prinzipien

```
1. Reverse-DCF g* bleibt rein markt-/fundamental-basiert (Price, FCF, WACC).
   Fiskal ändert g* NICHT direkt.

2. Forward-DCF darf einen optionalen Fiscal-Overlay auf FCF-Pfad legen,
   nur wenn Programm qualifies (legislated|funded|deploying, confidence high).

3. Overlay ist additiv, zeitlich begrenzt (startYear–endYear), und mit probability gewichtet.

4. DCF_REALITY_CHECK vergleicht g* vs realized8Q; Fiscal mildert nur Cap, nicht die Zahlen.

5. Private AI-Capex-Guidance ≠ Fiscal-Overlay.
```

## 3.2 Fiscal-Overlay auf den FCF-Pfad (Forward)

$$
FCF_t^{adj} = FCF_t^{base} + \sum_{p \in \mathcal{P}} \pi_p \cdot \Delta FCF_{t,p}
$$

- \(\mathcal{P}\): aktive, qualifizierte Programme für Ticker/Sektor  
- \(\pi_p\): probability (z.B. 0.75 high)  
- \(\Delta FCF_{t,p}\): erwarteter FCF-Beitrag in Jahr t aus Programm p (0 außerhalb [start,end])

```ts
export interface FiscalFcfOverlay {
  programId: string;
  year: number;                 // Kalenderjahr t
  deltaFcfUsd: number;          // absolute FCF-Wirkung in USD
  probability: number;          // 0–1
  source: FiscalProgram['source'];
}

/** Einfache Verteilung des Programmvolumens auf Unternehmens-FCF */
export function allocateProgramToFcf(opts: {
  program: FiscalProgram;
  /** Anteil des Unternehmens am adressierbaren Markt/Orders */
  companyShare: number;         // 0–1, aus Research/Segment
  /** Wie viel vom Revenue-Uplift als FCF ankommt */
  fcfMargin: number;            // z.B. 0.15
  probability: number;
}): FiscalFcfOverlay[] {
  const { program: p, companyShare, fcfMargin, probability } = opts;
  if (p.volumeUsdBn == null || p.startYear == null || p.endYear == null) return [];
  if (p.endYear < p.startYear) return [];

  const years = p.endYear - p.startYear + 1;
  const totalCompanyFcf = p.volumeUsdBn * 1e9 * companyShare * fcfMargin;
  const perYear = totalCompanyFcf / years;

  const out: FiscalFcfOverlay[] = [];
  for (let y = p.startYear; y <= p.endYear; y++) {
    out.push({
      programId: p.id,
      year: y,
      deltaFcfUsd: perYear,
      probability,
      source: p.source,
    });
  }
  return out;
}
```

**Guardrails für companyShare / volume:**

```
- companyShare default konservativ (z.B. ≤ 5–15 % je nach Marktstruktur)
- wenn volumeUsdBn null → kein Overlay, nur qualitativer Catalyst
- Summe π·ΔFCF über alle Programme ≤ z.B. 30 % von base FCF_0 (Cap gegen Explosiv-Szenarien)
```

```ts
export function capOverlays(
  baseFcf0: number,
  overlays: FiscalFcfOverlay[],
  maxFraction = 0.30
): FiscalFcfOverlay[] {
  const byYear = new Map<number, FiscalFcfOverlay[]>();
  for (const o of overlays) {
    const arr = byYear.get(o.year) ?? [];
    arr.push(o);
    byYear.set(o.year, arr);
  }
  const result: FiscalFcfOverlay[] = [];
  for (const [, arr] of byYear) {
    const raw = arr.reduce((s, o) => s + o.probability * o.deltaFcfUsd, 0);
    const cap = Math.abs(baseFcf0) * maxFraction;
    const scale = raw > cap && raw > 0 ? cap / raw : 1;
    for (const o of arr) result.push({ ...o, deltaFcfUsd: o.deltaFcfUsd * scale });
  }
  return result;
}
```

## 3.3 Forward-DCF mit Overlay

```ts
export function forwardDcfWithFiscal(opts: {
  fcf0: number;
  baseGrowth: number;           // organische g ohne Fiscal
  wacc: number;
  n?: number;
  terminalGrowth?: number;
  overlays: FiscalFcfOverlay[]; // bereits probability-gewichtet oder roh
  netDebt: number;
  shares: number;
}): { equityValue: number; fairValuePerShare: number; fcfPath: number[] } {
  const n = opts.n ?? 5;
  const gTerm = opts.terminalGrowth ?? 0.025;
  const startYear = new Date().getUTCFullYear();

  const fcfPath: number[] = [];
  let pv = 0;
  for (let t = 1; t <= n; t++) {
    const year = startYear + t - 1;
    const base = opts.fcf0 * Math.pow(1 + opts.baseGrowth, t);
    const fiscal = opts.overlays
      .filter(o => o.year === year)
      .reduce((s, o) => s + o.probability * o.deltaFcfUsd, 0);
    const fcfT = base + fiscal;
    fcfPath.push(fcfT);
    pv += fcfT / Math.pow(1 + opts.wacc, t);
  }
  const last = fcfPath[n - 1];
  const term = last * (1 + gTerm) / ((opts.wacc - gTerm) * Math.pow(1 + opts.wacc, n));
  const ev = pv + term;
  const equity = ev - opts.netDebt;
  return {
    equityValue: equity,
    fairValuePerShare: opts.shares > 0 ? equity / opts.shares : 0,
    fcfPath,
  };
}
```

## 3.4 Reverse-DCF bleibt „clean“

```
calcImpliedGStarExact({ price, shares, netDebt, fcf: fcf0, wacc })
  → g*  // OHNE Fiscal-Overlay im FCF

realizedGrowth8Q  // OHNE zukunftiges Fiscal

gapRatio = g* / realized8Q
```

Fiscal wirkt auf Reverse nur über:

1. **Gate-Milderung** `softenDcfRealityGate` (Cap 65→75), wenn qualifies  
2. **Conflict-/Katalysator-Text** („Teil des implied growth durch Programm X gedeckt“)  
3. **Separater catalystEV** im Verdict (nicht in g\*)

So bleibt vergleichbar: g\* ist immer „was der Kurs auf Basis historischem FCF verlangt“.

## 3.5 Abgleich Forward vs Reverse mit Fiscal

| Größe | Mit Fiscal? | Verwendung |
|-------|-------------|------------|
| g\* (Reverse) | nein | Gate, Konfliktmatrix |
| Fair Value Forward base | nein | Referenz „ohne Programm“ |
| Fair Value Forward + Overlay | ja | Szenario „mit belegtem Programm“ |
| catalystEV | ja (separat) | additiv im UI, nicht in g\* |
| DCF_REALITY Cap | indirekt | +10 nur wenn qualifies |

UI-Empfehlung:

```
FV (base)     $X
FV (fiscal)   $Y   ← Overlay, probability-gewichtet, Cap 30 % FCF
g*            Z %  ← clean Reverse
realized 8Q   R %
Gate          DCF_REALITY [aktiv|gemildert]
```

## 3.6 Qualifikation (identisch Scoring §17)

```
Overlay nur wenn:
  status ∈ { legislated, funded, deploying }
  confidence === high
  publishedAt ≤ asOf
  isProgramActive
  volumeUsdBn != null (sonst nur textueller Catalyst, ΔFCF=0)

AI-Capex privat → kein Overlay
```

## 3.7 Zahlenbeispiel (Rüstung, illustrativ)

```
Programm: Sondervermögen / NATO-Nachfrage, volumeUsdBn = 20, Jahre 2025–2028 (4J)
companyShare = 0.08, fcfMargin = 0.12, probability = 0.75

totalCompanyFcf = 20e9 * 0.08 * 0.12 = 192e6 USD
perYear = 48e6 USD
gewichtet = 0.75 * 48e6 = 36e6 USD/Jahr Overlay

fcf0 = 400e6, baseGrowth = 0.05
Jahr 1 base = 420e6 + 36e6 = 456e6
…
Cap: 0.30 * 400e6 = 120e6 → Overlay 36e6 ok (unter Cap)

Reverse g* unverändert aus Preis/fcf0/wacc.
Wenn gapRatio > 2 und Programm qualifies → Cap 75 statt 65.
```

## 3.8 Checkliste DCF + Fiscal

```
[ ] allocateProgramToFcf + capOverlays (max 30 % fcf0)
[ ] forwardDcfWithFiscal (base vs overlay Szenario)
[ ] Reverse DCF ohne Overlay
[ ] Gate-Milderung nur über qualifies, g* unverfälscht
[ ] volumeUsdBn null → kein numerisches Overlay
[ ] companyShare konservativ, dokumentiert
[ ] UI: FV base | FV fiscal | g* | Gate-Status
```

---

**Weiter:** [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md) §17  
**Regel:** Dokumentation. Implementierung lokal → PR → Review.
