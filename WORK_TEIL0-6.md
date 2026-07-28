# WORK_TEIL0-6.md — Vollständige Detailtiefe TEIL 0–6

> Restore aus Commit 975dbe93 + dokumentiertem Stand  
> Stand: 28.07.2026  
> Zugehörig: WORK.md (Index) · WORK_TEIL7_SCORING.md (TEIL 7) · WORK2.md (TEIL 8)

---

# TEIL 0 — PLATFORM-REALITÄT & SOFORT-FIXES (Stand 25.07.2026)

> Alle früheren Annahmen zu "Railway" sind falsch — das Projekt läuft NICHT auf Railway.

## 0.1 — Produktive Deployments

```
Plattform 1: Perplexity Computer (pplx.app)           [PRIMÄR]
  URL:        https://aktienanalyst-pro.pplx.app
  Deploy:     publish_website (Perplexity-internes Tool)
  Keys:       werden als credentials= beim publish_website-Aufruf injiziert

Plattform 2: Render (Docker-Container)                [SEKUNDÄR]
  URL:        https://aktienanalyst.onrender.com
  Deploy:     Dockerfile → node:20-slim, baut via npm run build, startet node dist/index.cjs
  Keys:       müssen im Render-Dashboard unter "Environment" gesetzt sein
  Port:       5000 (fest im Dockerfile: EXPOSE 5000)
  Branch:     main (auto-deploy bei Push)
```

## 0.2 — Railway: Nicht verwenden

```
RAILWAY WIRD NICHT GENUTZT.
Zu entfernen (Branch: chore/remove-railway):
[ ] railway.json löschen
[ ] .github/workflows/*.yml auf Railway-Deploy-Steps prüfen und entfernen
[ ] Kommentare/Docs Railway → Render ersetzen
[ ] README.md Deploy-Sektion auf pplx.app + Render aktualisieren
```

## 0.3 — Render Environment Variables (P0)

```
FMP_API_KEY         = <dein FMP Key>
OPENROUTER_API_KEY  = sk-or-v1-...
PERPLEXITY_API_KEY  = pplx-...          (optional, für Sonar)
NODE_ENV            = production
PORT                = 5000
PLAYWRIGHT_BROWSERS_PATH = /root/.cache/ms-playwright

Diagnose:
  curl https://aktienanalyst.onrender.com/api/health
  curl https://aktienanalyst.onrender.com/api/fmp-budget
  → Erwartung: { fmp: { calls: N, budget: 750 }, fmpAvailable: true }
```

## 0.4 — Legacy Quota Guard deaktivieren (P0)

```ts
// server/analyze-helpers.ts
export function isQuotaExceeded(): boolean { return false; }
export function incrementQuota() { /* stub */ }
```

## 0.5 — Render Health-Check

```
Health Check Path: /api/health
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));
```

## 0.6 — Mega-Files: Anti-Truncation Split-Plan

```
REGEL: Jede Datei < 80 KB.
Barrel-Pattern für researcher.ts, llm-openrouter.ts, Researcher.tsx
```

## 0.7 — Checkliste Render

```
[ ] Env Vars · Quota Guard · Health-Check · /api/health ok · fmpAvailable true
```

---

# TEIL 1 — BTC DASHBOARD RESTORE

```
client/src/pages/
├── BTCDashboard.tsx        ← Shell
└── btc/
    ├── Sections1to6.tsx
    ├── Sections7to12.tsx
    └── Section13Miner.tsx   ← Miner-Zone (siehe TEIL 6.4 unten — Spezifikation)
```

```tsx
case 13: return (
  <Section13Miner data={btcData} minerData={minerData ?? null}
    loading={minerLoading} error={minerError} />
);
```

Gute Commits: `33c8e77`, `5bf8a2d`, `bafff3c`

---

# TEIL 2 — BUGS A–D

| Bug | Kern | Branch |
|-----|------|--------|
| A | FMP fmpAvailable | fix/fmp-key-check |
| B | Peer ROIC 3J (`calcROIC`) | fix/peer-comparison-section7 |
| C | Product + Geo Segments | fix/revenue-segments-product-geo |
| D | Non-USD `toUSD = val * fxRate` | fix/non-usd-dcf-conversion |

```ts
export function calcROIC(ebit, taxExpense, incomeBeforeTax, longTermDebt, totalEquity, cash) {
  const taxRate = incomeBeforeTax > 0
    ? Math.max(0.10, Math.min(0.35, taxExpense / incomeBeforeTax)) : 0.21;
  const nopat = ebit * (1 - taxRate);
  const investedCapital = totalEquity + longTermDebt - cash;
  return investedCapital <= 0 ? 0 : (nopat / investedCapital) * 100;
}
```

---

# TEIL 3 — KATALYSATOREN-FORMELN

```ts
nettoUpside = bruttoUpside * (1 - einpreisungsgrad / 100)
gb = (pos / 100) * nettoUpside
catalystTarget = dcfFairValue * (1 + sumGB / 100)
// Reverse DCF: Binary Search g* N=5, g ∈ [-5%, +40%]
```

---

# TEIL 4 — OPENROUTER FALLBACK

```ts
// 3-Modell-Kette: Haiku → Llama-3.1-8B-Free → Gemini-Flash-Free
// Hybrid: Sonar (Live) + Claude (Struktur)
```

---

# TEIL 5 — FMP-MIGRATION

1. Budget-Debug → 2. Non-USD → 3. Peer+ROIC → 4. Segments → 5. Reverse DCF → 6. Catalyst Math → 7. Fallback → 8. Integration-Test

---

# TEIL 6 — FEATURE-ROADMAP

## 6.1 Technische Grundregeln

- Neue Section: SECTIONS-Array + case
- Formeln unit-testbar in `client/src/lib/calculations.ts`
- Datei < 80 KB vor Push

## 6.2 Geplante Sections

Section 8 WACC/TV · 14 PESTEL · 15 Reverse DCF · 17 Summary

## 6.3 Thesis Score / Kelly

```
Thesis = Moat*0.25 + FCF*0.20 + Fiskal*0.15 + Konjunktur*0.15 + Reputation*0.15 + Events*0.10
Kelly % = (p*b - q) / b · Pabrai max 10%
```

---

## 6.4 BTC Section 13 — Miner-Profitabilität, Kapitulationszonen & Chart-Spezifikation

> **Nur Dokumentation.** Keine Änderungen am BTC-Dashboard-Code in diesem Commit.  
> Ziel: Section13Miner so spezifizieren, dass Kapitulationszonen (rot) und profitable Zonen (grün)  
> analog zur bestehenden BTC-Technischen-Analyse visualisiert werden können.

### 6.4.1 Indikatoren-Übersicht

| # | Indikator | Formel / Logik | Kapitulation | Profitabel |
|---|-----------|----------------|--------------|------------|
| 1 | **Hash Ribbons** (Capriole) | MA30 vs MA60 der Hashrate | MA30 < MA60 und beide fallend | MA30 kreuzt MA60 von unten (Buy Signal) |
| 2 | **Puell Multiple** | Tagesemission_USD / MA365(Tagesemission_USD) | < 0.5 | 0.5–1.2 normal; > 4 überhitzt |
| 3 | **Hashprice** | USD / (TH/s · Tag) | unter Betriebskosten Referenz-Miner | deutlich über Breakeven |
| 4 | **Mining Breakeven** | (Energiekosten/Hash × Difficulty) / Hardware-Effizienz | Spot < Breakeven | Spot > Breakeven × 1.2 |
| 5 | **Difficulty Ribbon** | MAs 9/14/25/40/60/90/128/200 der Difficulty | starke Compression (Bänder eng) | Expansion nach Compression |
| 6 | **Miner Position Index / Netflows** | Miner→Exchange Netflows vs. Hist.-Mittel | hohe Netflows (Zwangsverkauf), dann Austrocknen | Netflows negativ (HODL) |
| 7 | **Kontext: Realized Price** | Realized Price ≈ Produktionskosten am Bärenmarkt-Tief | Konvergenz Spot / Realized / Breakeven | Spot klar über beiden |

### 6.4.2 Zyklischer Zusammenhang mit dem Halving

```
Halving → Block-Subvention −50% → Hashprice fällt abrupt (wenn Kurs nicht mitzieht)
  → ineffiziente Miner (alte ASICs) unprofitabel
  → Difficulty Adjustment verzögert (alle 2016 Blöcke ≈ 2 Wochen)
  → Anpassungsphase = Kapitulationszone
  → schwache Hände raus → Hashrate/Difficulty sinkt → Kostenlinie sinkt nach
  → Hash-Ribbon-Crossover (MA30 kreuzt MA60 von unten) = historisches Ende der Phase
```

### 6.4.3 Code-Logik (Dokumentation — `client/src/lib/btcMiner.ts`)

```ts
export interface MinerSeriesPoint {
  date: string;           // ISO
  hashrateEh: number;     // EH/s
  difficulty: number;
  priceUsd: number;       // Spot
  issuanceUsd: number;    // tägliche Coin-Emission in USD
  hashpriceUsdPerThDay: number | null;
}

export interface HashRibbonSignal {
  ma30: number;
  ma60: number;
  regime: 'capitulation' | 'recovery' | 'expansion' | 'neutral';
  buySignal: boolean;     // MA30 kreuzt MA60 von unten
}

export interface PuellResult {
  value: number;
  zone: 'capitulation' | 'neutral' | 'overheated';
}

export interface BreakevenResult {
  breakevenUsd: number;
  spotVsBreakeven: number; // Spot / Breakeven
  zone: 'unprofitable' | 'marginal' | 'profitable';
}

export interface MinerZone {
  start: string;
  end: string;
  type: 'capitulation' | 'profitable';
  reason: string;
}

/** Einfacher gleitender Durchschnitt */
function sma(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => {
    if (i < window - 1) return null;
    const slice = values.slice(i - window + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / window;
  });
}

/** Hash Ribbons: MA30 vs MA60 Hashrate */
export function calcHashRibbons(hashrate: number[]): HashRibbonSignal[] {
  const ma30 = sma(hashrate, 30);
  const ma60 = sma(hashrate, 60);
  return hashrate.map((_, i) => {
    const a = ma30[i], b = ma60[i];
    if (a == null || b == null) {
      return { ma30: a ?? 0, ma60: b ?? 0, regime: 'neutral' as const, buySignal: false };
    }
    const prevA = i > 0 ? ma30[i - 1] : null;
    const prevB = i > 0 ? ma60[i - 1] : null;
    const buySignal =
      prevA != null && prevB != null && prevA <= prevB && a > b; // Cross von unten

    let regime: HashRibbonSignal['regime'] = 'neutral';
    if (a < b && (i < 5 || (ma30[i - 1] ?? a) >= a)) regime = 'capitulation'; // unter + fallend
    else if (a > b && buySignal) regime = 'recovery';
    else if (a > b) regime = 'expansion';

    return { ma30: a, ma60: b, regime, buySignal };
  });
}

/** Puell Multiple */
export function calcPuell(issuanceUsd: number[]): PuellResult[] {
  const ma365 = sma(issuanceUsd, 365);
  return issuanceUsd.map((iss, i) => {
    const m = ma365[i];
    if (m == null || m === 0) return { value: 1, zone: 'neutral' as const };
    const value = iss / m;
    const zone =
      value < 0.5 ? 'capitulation' :
      value > 4   ? 'overheated'   : 'neutral';
    return { value, zone };
  });
}

/**
 * Mining Breakeven (vereinfachtes Cost-of-Production-Modell)
 * breakeven ≈ (powerCostUsdPerKwh * joulesPerTh * 24) / (hashprice-Faktor aus Difficulty)
 * Praktisch: Referenz-Hardware-Effizienz + Strompreis → USD-Kosten pro TH/Tag
 *            → skaliert mit Difficulty-Niveau auf BTC-Preis-Äquivalent
 */
export function calcBreakeven(params: {
  difficulty: number[];
  priceUsd: number[];
  powerCostUsdPerKwh?: number;  // default 0.06
  efficiencyJPerTh?: number;    // default 25 (moderne Flotte); alte: 60–100
}): BreakevenResult[] {
  const power = params.powerCostUsdPerKwh ?? 0.06;
  const eff = params.efficiencyJPerTh ?? 25;
  // Kosten pro TH/Tag in USD
  const costPerThDay = (eff / 1000) * power * 24; // J/TH → kWh/TH/Tag * $/kWh

  // Hashprice-Proxy: bei gegebener Difficulty und bekanntem Network-Hashrate
  // vereinfacht: Breakeven-Preis skaliert proportional zur Difficulty
  // (vollständige Formel braucht Hashrate + Block-Reward — hier dokumentiert als Platzhalter)
  return params.difficulty.map((diff, i) => {
    // Platzhalter-Skalierung: normalisiere Difficulty auf Index 2024-Basis
    // In Produktion: breakeven = f(diff, hashrate, blockReward, costPerThDay)
    const breakevenUsd = costPerThDay * (diff / 1e13) * 50_000; // kalibrierbar
    const spot = params.priceUsd[i] ?? 0;
    const ratio = breakevenUsd > 0 ? spot / breakevenUsd : 1;
    const zone =
      ratio < 1.0  ? 'unprofitable' :
      ratio < 1.2  ? 'marginal'     : 'profitable';
    return { breakevenUsd, spotVsBreakeven: ratio, zone };
  });
}

/**
 * Kapitulations- und Profit-Zonen aus kombinierter Signal-Logik ableiten.
 * Rote Zone (capitulation): Hash-Ribbon capitulation ODER Puell < 0.5 ODER Spot < Breakeven
 * Grüne Zone (profitable):  Hash-Ribbon expansion + Puell neutral + Spot > Breakeven×1.2
 */
export function deriveMinerZones(
  dates: string[],
  ribbons: HashRibbonSignal[],
  puell: PuellResult[],
  breakeven: BreakevenResult[]
): MinerZone[] {
  const zones: MinerZone[] = [];
  let current: { type: MinerZone['type']; start: number; reason: string } | null = null;

  for (let i = 0; i < dates.length; i++) {
    const isCap =
      ribbons[i]?.regime === 'capitulation' ||
      puell[i]?.zone === 'capitulation' ||
      breakeven[i]?.zone === 'unprofitable';

    const isProf =
      ribbons[i]?.regime === 'expansion' &&
      puell[i]?.zone === 'neutral' &&
      breakeven[i]?.zone === 'profitable';

    const type = isCap ? 'capitulation' : isProf ? 'profitable' : null;

    if (type && (!current || current.type !== type)) {
      if (current) {
        zones.push({
          start: dates[current.start],
          end: dates[i - 1],
          type: current.type,
          reason: current.reason,
        });
      }
      current = {
        type,
        start: i,
        reason: isCap
          ? 'Hash-Ribbon/Puell/Breakeven → Kapitulation'
          : 'Ribbon Expansion + Puell neutral + Spot > Breakeven',
      };
    } else if (!type && current) {
      zones.push({
        start: dates[current.start],
        end: dates[i - 1],
        type: current.type,
        reason: current.reason,
      });
      current = null;
    }
  }
  if (current) {
    zones.push({
      start: dates[current.start],
      end: dates[dates.length - 1],
      type: current.type,
      reason: current.reason,
    });
  }
  return zones;
}
```

### 6.4.4 Chart-Visualisierung (analog BTC Technische Analyse)

Zielbild wie bei der bestehenden TA-Sektion: **eine Haupt-Preislinie + Overlay-Zonen + Sekundärachsen-Indikatoren.**

```
┌─────────────────────────────────────────────────────────────┐
│  BTC Spot (blau, linke Achse)                               │
│  Miner-Breakeven-Linie (orange, gestrichelt)                │
│                                                             │
│  ████ rote Flächen = Kapitulationszonen                     │
│       (Spot unter Breakeven und/oder Ribbon-Capitulation    │
│        und/oder Puell < 0.5)                                │
│                                                             │
│  ▓▓▓▓ grüne Flächen = Profitable Zonen                      │
│       (Spot > Breakeven×1.2 + Ribbon Expansion)             │
│                                                             │
│  ▼ Marker = Hash-Ribbon Buy Signal (MA30×MA60 von unten)    │
├─────────────────────────────────────────────────────────────┤
│  Panel 2: Puell Multiple (Linie) + Horizontal 0.5 / 4.0     │
│  Panel 3: Hash Ribbon MA30/MA60 (zwei Linien)               │
└─────────────────────────────────────────────────────────────┘
```

**Recharts-Skizze (Dokumentation):**

```tsx
// Section13Miner Chart-Struktur (nur Spezifikation)
<ComposedChart data={mergedSeries}>
  {/* Kapitulations-Zonen als ReferenceArea */}
  {capitulationZones.map(z => (
    <ReferenceArea
      key={z.start}
      x1={z.start} x2={z.end}
      fill="#ef4444" fillOpacity={0.15}
      strokeOpacity={0}
    />
  ))}
  {/* Profitable Zonen */}
  {profitableZones.map(z => (
    <ReferenceArea
      key={z.start}
      x1={z.start} x2={z.end}
      fill="#22c55e" fillOpacity={0.12}
      strokeOpacity={0}
    />
  ))}

  <Line yAxisId="left" dataKey="priceUsd" stroke="#3b82f6" dot={false} name="BTC Spot" />
  <Line yAxisId="left" dataKey="breakevenUsd" stroke="#f97316" strokeDasharray="6 4"
        dot={false} name="Miner Breakeven" />

  {/* Hash-Ribbon Buy-Signale als Scatter/Dots */}
  <Scatter yAxisId="left" data={buySignalPoints} fill="#22c55e" name="Ribbon Buy" />

  <YAxis yAxisId="left" domain={['auto', 'auto']} />
  <XAxis dataKey="date" />
  <Tooltip />
  <Legend />
</ComposedChart>

// Separates Panel Puell:
<LineChart data={mergedSeries}>
  <Line dataKey="puell" stroke="#a855f7" dot={false} />
  <ReferenceLine y={0.5} stroke="#ef4444" strokeDasharray="4 4" label="Kapitulation" />
  <ReferenceLine y={4} stroke="#f59e0b" strokeDasharray="4 4" label="Überhitzt" />
</LineChart>
```

### 6.4.5 Wann ist die Bärenmarkt-Konsolidierung am Maximum?

```
Maximum der Kapitulation (historisch beste Einstiegszone) wenn MEHRERE gleichzeitig gelten:

1. Hash Ribbon: MA30 < MA60, beide fallend (Capitulation-Regime)
2. Puell Multiple < 0.5
3. Spot-Preis ≤ oder leicht unter Breakeven-Linie
4. Difficulty-Ribbon stark komprimiert (wenig Anpassung übrig)
5. Miner-Netflows: nach Spike wieder austrocknend (schwache Hände raus)

→ Dann: Hash-Ribbon-Crossover (MA30 kreuzt MA60 von unten) = klassisches
  "Ende der Kapitulation"-Signal. Rote Zone endet, grüne Recovery beginnt.
```

### 6.4.6 Datenquellen (für spätere Implementierung)

| Serie | Quelle |
|-------|--------|
| Hashrate | Blockchain.com API / mempool.space / CryptoQuant |
| Difficulty | mempool.space / Node |
| Issuance USD | Block-Reward × Preis (oder Glassnode) |
| Hashprice | Hashrate Index / Luxor |
| Strompreis-Annahme | Parameter 0.04–0.08 $/kWh (UI-Slider) |
| Hardware-Effizienz | Parameter J/TH (Default 25 modern, 60–100 alt) |

### 6.4.7 Umsetzungsschritte (wenn implementiert wird)

```
[ ] client/src/lib/btcMiner.ts — calcHashRibbons, calcPuell, calcBreakeven, deriveMinerZones
[ ] Section13Miner.tsx — ComposedChart mit ReferenceArea (rot/grün) + Buy-Signal-Marker
[ ] Panel Puell + Panel Hash-Ribbon MAs
[ ] Parameter-Slider: Strompreis $/kWh, Effizienz J/TH
[ ] Kein Hardcoding von Daten — Serien aus API/Cache
```

**Regel:** Alles Design-Dokumentation. Implementierung lokal → PR → Review.  
**Keine Änderung am BTC-Dashboard in diesem Schritt.**

---

**Weiter:**
- TEIL 7 (Scoring) → [WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md)
- TEIL 8 (Regulatory/PESTEL) → [WORK2.md](./WORK2.md)
