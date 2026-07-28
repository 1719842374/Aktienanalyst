# WORK_REVERSE_DCF_BRIDGE.md

> Stand: 28.07.2026 | Nur Dokumentation  
> **1) Reverse-DCF Methodik im Detail**  
> **2) Bridge: Fiskal-/Megatrend-Programme → Sektor/Branche → Scoring + Daily Briefing**

---

# Teil 1 — Reverse DCF Methodik im Detail

## 1.1 Zweck

Der Reverse DCF beantwortet **nicht** „Was ist die Aktie wert?“, sondern:

> **Welche Wachstumsrate g\* ist im aktuellen Kurs bereits eingepreist?**

Vergleich g\* mit dem **realisierten 8Q-Trend** und (optional) mit belegten Fiscal-/Order-Katalysatoren  
erzeugt den Gate `DCF_REALITY_CHECK` und die Konfliktzeile im Verdict.

```
Forward DCF:  Annahmen → Fair Value
Reverse DCF:  Marktpreis → implizite Annahme g*
```

## 1.2 Modellgleichung (N-Jahres FCFF + Terminal)

Enterprise Value aus dem Kurs:

$$
EV_{mkt} = P \times Shares + NetDebt
$$

Modell-EV bei Wachstumsrate \(g\):

$$
EV(g) = \sum_{t=1}^{N} \frac{FCF_0 \,(1+g)^t}{(1+WACC)^t}
+ \frac{FCF_0 \,(1+g)^N \,(1+g_{term})}{(WACC - g_{term})\,(1+WACC)^N}
$$

Gesucht: \(g^*\) mit \(EV(g^*) = EV_{mkt}\).

| Parameter | Default | Hinweis |
|-----------|---------|--------|
| \(N\) | 5 | explizite Phase |
| \(g_{term}\) | 2,5 % | ≤ langfristiges Nominalwachstum |
| \(WACC\) | aus Modell / Sector | konsistent zur Forward-DCF |
| \(FCF_0\) | TTM FCFF in USD | Non-USD: × fxRate (Bug D) |
| Suche | Binary Search | \(g \in [-5\%,\, +40\%]\), 50 Iterationen |

## 1.3 Binary Search (deterministisch)

```ts
export function calcImpliedGStarExact(opts: {
  price: number;
  sharesOutstanding: number;
  netDebt: number;       // bereits USD
  fcf: number;           // TTM FCFF USD
  wacc: number;
  n?: number;            // default 5
  terminalGrowth?: number; // default 0.025
}): number | null {
  const {
    price, sharesOutstanding, netDebt, fcf, wacc,
    n = 5, terminalGrowth = 0.025,
  } = opts;

  if (fcf <= 0 || wacc <= terminalGrowth) return null;

  const evMkt = price * sharesOutstanding + netDebt;

  const dcfValue = (g: number) => {
    let pv = 0;
    for (let t = 1; t <= n; t++) {
      pv += fcf * Math.pow(1 + g, t) / Math.pow(1 + wacc, t);
    }
    const term =
      fcf * Math.pow(1 + g, n) * (1 + terminalGrowth)
      / ((wacc - terminalGrowth) * Math.pow(1 + wacc, n));
    return pv + term;
  };

  let lo = -0.05, hi = 0.40;
  if (dcfValue(hi) < evMkt || dcfValue(lo) > evMkt) return null; // außerhalb Band

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (dcfValue(mid) > evMkt) hi = mid;
    else lo = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100; // z.B. 12.34 (%)
}
```

Rückgabe in **Prozentpunkten** (12.34 = 12,34 %) oder intern als Dezimal — Pipeline einheitlich halten.

## 1.4 Realisierter Trend (8Q)

```ts
// YoY FCF oder Revenue/EPS — konsistent wählen, dokumentieren
realizedGrowth8Q = slope oder CAGR der letzten 8 Quartale
// Beispiel CAGR:
realizedGrowth8Q = (fcf_q0 / fcf_q7) ** (1/2) - 1  // 8Q ≈ 2 Jahre
```

## 1.5 Gap-Ratio & Gate

```
gapRatio = g* / max(0.01, realizedGrowth8Q)

DCF_REALITY_CHECK active wenn gapRatio > 2
  → Cap 65 (warn)
  → rationale: "DCF unterstellt X%, realisiert Y%"
```

Interpretation:

| Lage | Bedeutung |
|------|-----------|
| g\* ≈ realized | Kurs und Trend konsistent |
| g\* ≫ realized | Markt preist deutlich mehr Wachstum als geliefert — Gate |
| g\* ≪ realized | Kurs impliziert Pessimismus vs. Trend (nicht automatisch „billig“) |

## 1.6 Fiscal-/Megatrend-Abgleich (Anbindung §2)

Wenn ein **qualifizierter** Fiscal-/Program-Katalysator greift (siehe Bridge):

- g\* bleibt berechnet (keine Verfälschung der Zahl)
- Gate `DCF_REALITY_CHECK` kann **gemildert** werden (Cap +10), nie gelöscht
- Conflict-Text: „Implizites Wachstum über Run-Rate — teilweise durch belegtes Programm X gedeckt“

Private AI-Capex ohne Staats-/Vertragsfund: **keine** Milderung.

## 1.7 Validierungsbeispiele (Orientierung)

```
MSFT:  g* ≈ hist. Wachstum → fair
NVO:   g* ≈ hist. → fair
ASML:  g* deutlich > hist. → Reverse signalisiert teuer / hohes implied growth
Nike 2023: g* hoch, realized dreht → gapRatio groß → Gate an
```

## 1.8 Anti-Lookahead

```
[ ] FCF, Shares, NetDebt, Price nur as-of Datum
[ ] realizedGrowth8Q nur Quartale ≤ as-of
[ ] Keine „bekannten“ Future-Earnings im Reverse
[ ] Programm-Quellen publishedAt ≤ as-of (Bridge)
```

---

# Teil 2 — Bridge: Programme → Sektor → Scoring + Daily Briefing

## 2.1 Ziel

Neu angekündigte oder noch nicht voll umgesetzte **Fiskal- und Capex-Programme**  
(generisch: Rüstung, Infra, Chips Acts, Energie, **AI-Infra-Subventionen**, …)  
sollen:

1. **einmal gecacht** werden (Researcher Daily Briefing / LLM-Search),
2. über eine **Bridge-Datei/Schnittstelle** Sektoren & Branchen zugeordnet,
3. automatisch in **Scoring** (Katalysator + optionale DCF-Milderung) und  
   **Daily Briefing** (Sector-Tab) ankommen — ohne manuelles Ticker-Hardcoding.

## 2.2 Bridge-Datei (Kommunikationsschnittstelle)

```
server/bridge/
  programCache.ts       ← Store + TTL
  programTypes.ts       ← Interfaces
  sectorMap.ts          ← Programm → Sector/Industry GICS/FMP
  programToCatalyst.ts  ← Programm → Catalyst[] pro Ticker/Sektor
  index.ts              ← public API für Researcher + Scoring
```

Oder eine einzige Spec-Datei im Repo als Vertrag:

```
shared/bridge/fiscalPrograms.ts   // Typen + Mapping-Regeln (Dokumentation = Vertrag)
```

## 2.3 Datenmodell

```ts
/** Ein erkanntes Programm — generisch, nicht nur Rüstung */
export interface FiscalProgram {
  id: string;                          // slug: "nato-2pct-2022", "us-chips-act", "eu-ai-infra-2026"
  title: string;
  type: 'fiscal' | 'capex_subsidy' | 'procurement' | 'tax_credit' | 'regulation_driven_demand';
  /** Geopolitik / Industriepolitik / Tech */
  theme: 'defense' | 'ai_infra' | 'semiconductors' | 'energy' | 'infrastructure' | 'healthcare' | 'other';
  geography: string[];                 // ['US'], ['EU','DE'], ['NATO']
  status: 'announced' | 'legislated' | 'funded' | 'deploying' | 'expired';
  confidence: 'low' | 'medium' | 'high';
  /** Budget / Volumen soweit bekannt */
  volumeUsdBn: number | null;
  startYear: number | null;
  endYear: number | null;
  /** Für Lookahead-Sperre */
  source: { url: string; publishedAt: string; snippet: string };
  /** GICS / FMP Industry Strings oder Sector-Keys */
  sectorKeys: string[];                // z.B. ['Aerospace & Defense', 'Electrical Equipment']
  industryKeys: string[];
  /** Optional explizite Ticker-Boost-Liste (nicht Pflicht) */
  tickerHints?: string[];
  /** Wann gecacht */
  cachedAt: string;
  expiresAt: string;                   // TTL z.B. 7–30 Tage
  rawBriefingIds?: string[];           // Verknüpfung Daily Briefing Items
}

export interface ProgramSectorHit {
  programId: string;
  sectorKey: string;
  industryKey?: string;
  relevance: number;                   // 0–1
  appliedAs: 'catalyst' | 'context_only';
}
```

## 2.4 Cache-Flow (Daily Briefing → Bridge)

```
Daily Briefing / LLM-Search (Sonar)
        │
        │  extrahiert strukturiert: title, type, theme, geo,
        │  volume, years, source, sectorKeywords
        ▼
programCache.upsert(FiscalProgram)     // TTL, dedupe by id/slug
        │
        ▼
sectorMap.resolve(program) → ProgramSectorHit[]
        │
        ├─► Researcher Sector-Tab / Daily Briefing UI
        │     "Aktive Programme für Aerospace & Defense: …"
        │
        └─► Scoring (pro Ticker)
              programToCatalyst(ticker, sector, industry) → Catalyst[]
              fiscalMegatrendQualifies / softenDcfRealityGate
```

## 2.5 Sector-Map (Regeln, kein Hardcoding einzelner Aktien)

```ts
/** Keyword/Theme → FMP/GICS Sektoren — erweiterbar */
export const THEME_SECTOR_MAP: Record<FiscalProgram['theme'], string[]> = {
  defense:        ['Aerospace & Defense', 'Electrical Equipment', 'IT Services'],
  ai_infra:       ['Semiconductors', 'Software', 'Electrical Equipment', 'Building Products'],
  semiconductors: ['Semiconductors', 'Semiconductor Equipment & Materials'],
  energy:         ['Oil, Gas & Consumable Fuels', 'Electrical Equipment', 'Construction & Engineering'],
  infrastructure: ['Construction & Engineering', 'Building Products', 'Machinery'],
  healthcare:     ['Health Care Equipment', 'Pharmaceuticals', 'Biotechnology'],
  other:          [],
};

export function resolveProgramSectors(p: FiscalProgram): ProgramSectorHit[] {
  const fromTheme = THEME_SECTOR_MAP[p.theme] ?? [];
  const keys = [...new Set([...fromTheme, ...p.sectorKeys])];
  return keys.map(sectorKey => ({
    programId: p.id,
    sectorKey,
    relevance: p.confidence === 'high' ? 0.9 : p.confidence === 'medium' ? 0.6 : 0.3,
    appliedAs: p.confidence === 'high' && (p.status === 'legislated' || p.status === 'funded' || p.status === 'deploying')
      ? 'catalyst'
      : 'context_only',
  }));
}
```

## 2.6 Programm → Catalyst (für runScoringPipeline)

```ts
export function programToCatalyst(
  p: FiscalProgram,
  ctx: { ticker: string; sector: string; industry: string; price: number; eps?: number }
): Catalyst | null {
  const hits = resolveProgramSectors(p);
  const match = hits.find(h =>
    h.sectorKey === ctx.sector || h.sectorKey === ctx.industry
    || (p.tickerHints?.includes(ctx.ticker))
  );
  if (!match || match.appliedAs !== 'catalyst') return null;
  if (p.confidence === 'low') return null;

  // epsImpact: nur wenn volume/EPS grob schätzbar — sonst 0 und confidence senken
  const epsImpact = 0; // bewusst 0 bis Research eine Zahl setzt; EV dann über probability*manual

  return {
    id: `prog:${p.id}`,
    type: 'fiscal',
    title: p.title,
    eventDate: p.endYear ? `${p.endYear}-12-31` : null,
    probability: p.confidence === 'high' ? 0.75 : 0.5,
    epsImpact,
    source: p.source,
    confidence: p.confidence,
  };
}

/** Alle aktiven Programme für einen Ticker-Kontext */
export function catalystsFromProgramCache(
  cache: FiscalProgram[],
  ctx: { ticker: string; sector: string; industry: string; price: number },
  asOf: string
): Catalyst[] {
  return cache
    .filter(p => p.expiresAt >= asOf && p.source.publishedAt <= asOf) // Lookahead-Sperre
    .map(p => programToCatalyst(p, ctx))
    .filter((c): c is Catalyst => c != null);
}
```

## 2.7 Verknüpfung Daily Briefing (Researcher)

```
POST /api/researcher/daily-briefing
  → Sonar/LLM liefert News + strukturierte programCandidates[]
  → server normalisiert zu FiscalProgram[]
  → programCache.upsert
  → Response enthält:
       briefingItems[]
       activePrograms[]          // für UI-Chip-Leiste
       programsBySector: Record<sectorKey, FiscalProgram[]>

Sector-Opportunity-Tab:
  lädt programsBySector[currentSector]
  zeigt Status, Volumen, Jahre, Confidence, Source

Aktienanalyse (Scoring):
  catalystsFromProgramCache(cache, { ticker, sector, industry, price }, asOf)
  merged mit bestehenden Catalyst[] aus LLM-Extraktion
  → fiscalMegatrendQualifies / softenDcfRealityGate (WORK_SCORING_VORLAGE §17)
```

## 2.8 LLM-Extraktionsschema (Briefing → Programm)

```ts
// LLM liefert nur Fakten, kein Urteil
export interface ProgramExtraction {
  title: string;
  type: FiscalProgram['type'];
  theme: FiscalProgram['theme'];
  geography: string[];
  status: FiscalProgram['status'];
  volumeUsdBn: number | null;
  startYear: number | null;
  endYear: number | null;
  sectorKeywords: string[];
  sourceUrl: string;
  publishedAt: string;       // ISO
  snippet: string;
  confidence: 'low' | 'medium' | 'high';
}
```

Prompt-Regeln: keine Ticker-Empfehlung, keine „Buy Defense“-Sprache, nur Felder + Zitat.

## 2.9 AI-Capex vs. Staatsprogramm (Bridge-Policy)

| Signal | theme | appliedAs | DCF-Milderung |
|--------|-------|-----------|---------------|
| NATO / Sondervermögen / legislated procurement | defense | catalyst (high) | ja, eng (§17) |
| US Chips Act Grants **funded** | semiconductors | catalyst | ja, eng |
| Hyperscaler „we will spend $X on AI“ (privat) | ai_infra | context_only | **nein** |
| EU-Programm angekündigt, nicht funded | * | context_only | nein |
| Tax Credit legislated (IRA-ähnlich) | energy/other | catalyst wenn high | ja, eng |

**Generisch:** Jedes `FiscalProgram` mit `status ∈ {legislated, funded, deploying}` und `confidence=high`  
kann Sector-Hits erzeugen — Theme ist nicht auf Rüstung beschränkt.

## 2.10 API-Skizze Bridge

```ts
// server/bridge/index.ts — Vertrag
export interface ProgramBridge {
  upsertFromBriefing(extractions: ProgramExtraction[]): Promise<FiscalProgram[]>;
  listActive(asOf: string): Promise<FiscalProgram[]>;
  bySector(sectorKey: string, asOf: string): Promise<FiscalProgram[]>;
  catalystsForTicker(ctx: {
    ticker: string; sector: string; industry: string; price: number; asOf: string;
  }): Promise<Catalyst[]>;
}
```

Daily Briefing und Scoring hängen **nur** an diesem Vertrag — keine direkten LLM-Calls in der Gate-Logik.

## 2.11 Checkliste

```
[ ] programTypes + THEME_SECTOR_MAP
[ ] programCache mit TTL + publishedAt ≤ asOf
[ ] Daily Briefing schreibt Extractions → Cache
[ ] Sector-Tab liest bySector
[ ] Scoring: catalystsFromProgramCache → merge → fiscalMegatrendQualifies
[ ] Private AI-Capex-Extractions: theme ai_infra, appliedAs context_only
[ ] Reverse DCF unverändert berechnen; nur Gate-Cap optional +10
[ ] Kein Ticker-Hardcoding in der Map
```

---

**Weiter:** Scoring-Gates → [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md) §17  
**Regel:** Dokumentation. Implementierung lokal → PR → Review.
