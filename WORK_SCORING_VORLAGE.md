# WORK_SCORING_VORLAGE.md — Scoring-Logik Vorlage

> Stand: 28.07.2026 | Nur Dokumentation  
> Enthält: Kern-Pipeline · **Gate-Logik Implementierung** · **Backtesting** · **runScoringPipeline Beispiel**

---

## 0. Architektur

```
finalScore = min( qualityScore × trendMultiplier , gateCap )
catalystEV  → separat ausweisen (nicht in finalScore einrechnen)
```

---

## 1–8. Module (Kurz)

`types` · `pricingPowerScore` · `relativeMomentum` · `trendMultiplier` · `buildGates` / `applyGates` · `catalystExpectedValue` · `buildVerdict` · `runScoringPipeline`  
→ voller Code in Abschnitten 2–8 der Vorgängerversion / unten §15 gebündelt.

### Gate-Caps

| ID | Cap | Severity | Trigger |
|----|-----|----------|--------|
| PRICING_POWER | 55 | hard | PRICING_POWER_LOSS ∨ score<40 |
| RELATIVE_GROWTH | 60 | hard | negativeQuarters ≥ 3 |
| DCF_REALITY_CHECK | 65 | warn | implied/realized8Q > 2 |
| INVENTORY | 70 | warn | INVENTORY_BUILD |
| REGULATORY_EXPOSURE | 55/65 | hard/warn | TEIL 8 |

---

## 13. Implementierung der Gate-Logik

### 13.1 Prinzip

Gates sind **Vetos**, keine Abzüge. Ein aktives Gate setzt eine **Obergrenze** (`cap`).  
Mehrere aktive Gates → `gateCap = min(caps)`. Hard-Gates schlagen Warn-Gates, wenn Cap niedriger.

```
rawScore = qualityScore * trendMult          // z.B. 88 * 0.72 = 63.4
activeCaps = [55, 70]                        // PRICING_POWER + INVENTORY
gateCap = 55
finalScore = min(63.4, 55) = 55
cappedBy = [PRICING_POWER]
```

### 13.2 Auswertungsreihenfolge

```
1. pricingPowerScore → flags + score
2. relativeMomentum  → flags + negativeQuarters
3. revDcf gapRatio
4. buildGates(...)   → Gate[] mit active true/false
5. applyGates(quality, trendMult, gates) → { score, cappedBy }
6. regulatoryGates (TEIL 8) als extra[] in buildGates mergen
```

### 13.3 Gate-Builder (vollständig)

```ts
export function buildGates(
  pp: PricingPowerResult,
  rm: RelativeMomentumResult,
  revDcf: { impliedGrowth: number; realizedGrowth8Q: number },
  extra: Gate[] = []
): Gate[] {
  const gates: Gate[] = [];

  // HARD — Preissetzungsmacht
  gates.push({
    id: 'PRICING_POWER',
    active: pp.flags.includes('PRICING_POWER_LOSS') || pp.score < 40,
    cap: 55,
    severity: 'hard',
    rationale: 'Preissetzungsmacht erodiert — Qualitätsprämie nicht gerechtfertigt',
  });

  // HARD — relatives Wachstum
  gates.push({
    id: 'RELATIVE_GROWTH',
    active: rm.negativeQuarters >= 3,
    cap: 60,
    severity: 'hard',
    rationale: 'Marktanteilsverlust über 3+ Quartale → Moat-Erosion',
  });

  // WARN — DCF vs Realität
  const gapRatio = revDcf.realizedGrowth8Q === 0
    ? Infinity
    : revDcf.impliedGrowth / Math.max(0.01, revDcf.realizedGrowth8Q);
  gates.push({
    id: 'DCF_REALITY_CHECK',
    active: gapRatio > 2,
    cap: 65,
    severity: 'warn',
    rationale: `DCF g*=${(revDcf.impliedGrowth * 100).toFixed(1)}% vs 8Q=${(revDcf.realizedGrowth8Q * 100).toFixed(1)}%`,
  });

  // WARN — Inventar
  gates.push({
    id: 'INVENTORY',
    active: rm.flags.includes('INVENTORY_BUILD'),
    cap: 70,
    severity: 'warn',
    rationale: 'Lageraufbau bei stagnierendem Umsatz',
  });

  // Extra (Regulatory etc.) — nur aktive übernehmen
  for (const g of extra) {
    if (g.active) gates.push(g);
  }
  return gates;
}

export function applyGates(qualityScore: number, trendMult: number, gates: Gate[]) {
  const raw = qualityScore * trendMult;
  const active = gates.filter(g => g.active);
  if (active.length === 0) return { score: raw, cappedBy: [] as Gate[] };

  const cap = Math.min(...active.map(g => g.cap));
  const cappedBy = active.filter(g => g.cap === cap);
  // bei gleichem Cap: hard vor warn sortieren für UI
  cappedBy.sort((a, b) => (a.severity === 'hard' && b.severity !== 'hard' ? -1 : 0));

  return { score: Math.min(raw, cap), cappedBy };
}
```

### 13.4 UI-Regeln für Gates

```
- cappedBy.length > 0 → Badge "GATED" + Liste der IDs
- severity hard → rote Karte, warn → gelbe Karte
- testQuestion immer auf cappedBy[0] (schärfstes Gate)
- score und qualityScore nebeneinander zeigen (Transparenz der Deckelung)
```

### 13.5 Unit-Test-Vektoren Gate-Logik

```
T1: pp.score=30, flags=[PRICING_POWER_LOSS], quality=90, trendMult=1.0
    → active PRICING_POWER, score=55, cappedBy=[PRICING_POWER]

T2: rm.negativeQuarters=4, kein PP-Flag, quality=80, trendMult=0.9
    → raw=72, cap=60, score=60, cappedBy=[RELATIVE_GROWTH]

T3: gapRatio=3, quality=70, trendMult=1.0, keine anderen Flags
    → score=65, cappedBy=[DCF_REALITY_CHECK], severity=warn

T4: PP + RELATIVE gleichzeitig, quality=95, trendMult=1.0
    → cap=min(55,60)=55, score=55, cappedBy=[PRICING_POWER]

T5: keine Flags, quality=80, trendMult=1.1
    → score=88, cappedBy=[]
```

---

## 14. Backtesting der Scoring-Modelle

### 14.1 Ziel

Prüfen, ob die Gate-Logik historische Fehlsignale (Nike 2023-Typ) **früher** als reines Level-Scoring erkannt hätte — ohne Lookahead.

### 14.2 Daten-Schnittstelle

```ts
export interface BacktestPoint {
  date: string;                     // Quartalsende ISO
  ticker: string;
  qualityScore: number;             // damaliger Level-Score (rekonstruiert)
  zDeltas: number[];
  pricingPower: PricingPowerInput;  // nur Daten ≤ date
  ownYoY: number[];
  peerYoYWeighted: number[];
  inventoryDays: number[];
  revenue: number[];
  revDcf: { impliedGrowth: number; realizedGrowth8Q: number };
  price: number;
  // Forward-Labels (nur für Evaluation, nicht für Score-Input):
  forwardReturn12M?: number;        // realisierte 12M-Performance nach date
  wasValueTrap?: boolean;           // manuell/regelbasiert: großer Drawdown trotz hohem Quality
}
```

### 14.3 Backtest-Runner (Vorlage)

```ts
export interface BacktestRow {
  date: string;
  ticker: string;
  qualityScore: number;
  trendMult: number;
  score: number;
  cappedBy: string[];
  gateActive: boolean;
  forwardReturn12M?: number;
  wasValueTrap?: boolean;
}

export function runScoringBacktest(points: BacktestPoint[]): BacktestRow[] {
  return points.map(p => {
    const result = runScoringPipeline({
      qualityScore: p.qualityScore,
      zDeltas: p.zDeltas,
      pricingPower: p.pricingPower,
      ownYoY: p.ownYoY,
      peerYoYWeighted: p.peerYoYWeighted,
      inventoryDays: p.inventoryDays,
      revenue: p.revenue,
      revDcf: p.revDcf,
      catalysts: [],
      price: p.price,
      technicalRegime: 'range',
      reverseDcfConsistent: p.revDcf.impliedGrowth / Math.max(0.01, p.revDcf.realizedGrowth8Q) <= 2,
    });
    return {
      date: p.date,
      ticker: p.ticker,
      qualityScore: p.qualityScore,
      trendMult: result.trendMult,
      score: result.score,
      cappedBy: result.cappedBy.map(g => g.id),
      gateActive: result.cappedBy.length > 0,
      forwardReturn12M: p.forwardReturn12M,
      wasValueTrap: p.wasValueTrap,
    };
  });
}
```

### 14.4 Metriken

```ts
export function evaluateBacktest(rows: BacktestRow[]) {
  const traps = rows.filter(r => r.wasValueTrap);
  const trapsCaught = traps.filter(r => r.gateActive);
  const falseAlarms = rows.filter(r => r.gateActive && r.forwardReturn12M != null && r.forwardReturn12M > 0.1);

  // Trennung: mittlerer Forward-Return wenn gated vs. nicht gated
  const gated = rows.filter(r => r.gateActive && r.forwardReturn12M != null);
  const clear = rows.filter(r => !r.gateActive && r.forwardReturn12M != null);
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  return {
    n: rows.length,
    trapRecall: traps.length ? trapsCaught.length / traps.length : null,       // Anteil Value-Traps mit Gate
    falseAlarmRate: rows.length ? falseAlarms.length / rows.length : null,
    avgReturnGated: avg(gated.map(r => r.forwardReturn12M!)),
    avgReturnClear: avg(clear.map(r => r.forwardReturn12M!)),
    // Erwartung: avgReturnGated < avgReturnClear
  };
}
```

### 14.5 Nike-Stresstest (manuelles Fixture)

```ts
// Synthetisches Fixture „Nike Q3 2023“
const nike2023Q3: BacktestPoint = {
  date: '2023-08-31',
  ticker: 'NKE',
  qualityScore: 82,              // ROIC/Marke/Marge noch stark
  zDeltas: [-0.8, -1.1, -0.6], // negative Verlaufsdynamik
  pricingPower: {
    grossMarginQ: [45, 44.5, 44, 43.5, 43, 42.5, 42, 41.5], // fallend
    inputCostIndex: [100, 99, 98, 98, 97, 97, 96, 96],       // Kosten stabil/fallend
    asp: [100, 101, 100, 99, 98, 97, 96, 95],
    volume: [100, 98, 97, 95, 94, 92, 90, 88],
    discountMentions: [1, 1, 2, 2, 3, 4, 5, 6],
    peerGrossMarginQ: [[40,40,41,41,41,42,42,42]],
  },
  ownYoY: [8, 5, 2, 0, -2, -4, -5, -6],
  peerYoYWeighted: [6, 6, 5, 5, 4, 4, 3, 3],
  inventoryDays: [60, 62, 65, 68, 70, 72, 75, 78],
  revenue: [120, 118, 115, 112, 110, 108, 105, 102],
  revDcf: { impliedGrowth: 0.12, realizedGrowth8Q: 0.02 },
  price: 100,
  forwardReturn12M: -0.30,
  wasValueTrap: true,
};

// Erwartung nach runScoringPipeline:
// PRICING_POWER active (Marge fällt, Kosten nicht steigend)
// RELATIVE_GROWTH active (viele negative gaps)
// DCF_REALITY_CHECK active (0.12/0.02 = 6 > 2)
// score ≤ 55, gateActive = true, trapRecall trägt 1 bei
```

### 14.6 Backtest-Checkliste

```
[ ] Quartals-Panel 2018–2025 für 30–50 Liquid-Namen (US + EU)
[ ] qualityScore zeitpunktgetreu rekonstruieren (kein Lookahead)
[ ] Pricing-Power-Inputs nur aus bekannten Quartalen ≤ date
[ ] Forward 12M Total Return als Label
[ ] Value-Trap-Label: quality≥70 & forwardReturn12M ≤ −25%
[ ] Metriken: trapRecall, falseAlarmRate, avgReturnGated vs Clear
[ ] Nike-Fixture als Regressionstest in CI
```

---

## 15. Code-Beispiel: runScoringPipeline (End-to-End)

```ts
import {
  pricingPowerScore,
  relativeMomentum,
  trendMultiplier,
  buildGates,
  applyGates,
  catalystExpectedValue,
  buildVerdict,
  type ScoringInput,
  type ScoringResult,
} from './scoring';

/** Vollständige Pipeline — Copy-Paste-Kern für index.ts */
export function runScoringPipeline(input: ScoringInput): ScoringResult {
  // 1) Delta-Module
  const pricingPower = pricingPowerScore(input.pricingPower);
  const relativeMom = relativeMomentum(
    input.ownYoY,
    input.peerYoYWeighted,
    input.inventoryDays,
    input.revenue
  );

  // 2) Trend-Multiplikator
  const trendMult = trendMultiplier(input.zDeltas);

  // 3) Gates (inkl. optional Regulatory aus TEIL 8)
  const gates = buildGates(
    pricingPower,
    relativeMom,
    input.revDcf,
    input.regulatoryGates ?? []
  );

  // 4) Score deckeln
  const { score, cappedBy } = applyGates(input.qualityScore, trendMult, gates);

  // 5) Katalysatoren (separat)
  const catalystEV = catalystExpectedValue(input.catalysts, input.price);

  // 6) Konfliktmatrix
  const verdict = buildVerdict({
    quality: input.qualityScore,
    trendMult,
    gates,
    technicalRegime: input.technicalRegime,
    catalystEV,
    reverseDcfConsistent: input.reverseDcfConsistent,
  });

  return {
    qualityScore: input.qualityScore,
    trendMult,
    pricingPower,
    relativeMomentum: relativeMom,
    gates,
    score,
    cappedBy,
    catalystEV,
    conflicts: verdict.conflicts,
    testQuestion: verdict.testQuestion,
    verdict,
  };
}

// ─── Beispielaufruf (Nike-artig) ─────────────────────────────
const exampleInput: ScoringInput = {
  qualityScore: 82,
  zDeltas: [-0.8, -1.1, -0.6],
  pricingPower: {
    grossMarginQ: [45, 44.5, 44, 43.5, 43, 42.5, 42, 41.5],
    inputCostIndex: [100, 99, 98, 98, 97, 97, 96, 96],
    asp: [100, 101, 100, 99, 98, 97, 96, 95],
    volume: [100, 98, 97, 95, 94, 92, 90, 88],
    discountMentions: [1, 1, 2, 2, 3, 4, 5, 6],
    peerGrossMarginQ: [[40, 40, 41, 41, 41, 42, 42, 42]],
  },
  ownYoY: [8, 5, 2, 0, -2, -4, -5, -6],
  peerYoYWeighted: [6, 6, 5, 5, 4, 4, 3, 3],
  inventoryDays: [60, 62, 65, 68, 70, 72, 75, 78],
  revenue: [120, 118, 115, 112, 110, 108, 105, 102],
  revDcf: { impliedGrowth: 0.12, realizedGrowth8Q: 0.02 },
  catalysts: [{
    id: 'c1',
    type: 'product',
    title: 'China-Recovery',
    eventDate: '2024-06-01',
    probability: 0.4,
    epsImpact: 0.5,
    source: { url: 'https://example.com', publishedAt: '2023-09-01', snippet: '...' },
    confidence: 'medium',
  }],
  price: 100,
  technicalRegime: 'breakdown',
  reverseDcfConsistent: false,
};

const out = runScoringPipeline(exampleInput);

/* Erwartete Struktur von out:
{
  qualityScore: 82,
  trendMult: ~0.7x (negative zDeltas),
  pricingPower: { score: <40, flags: ['PRICING_POWER_LOSS', 'VOLUME_EROSION', ...] },
  relativeMomentum: { negativeQuarters: ≥3, flags: ['SHARE_LOSS', 'INVENTORY_BUILD'] },
  gates: [ PRICING_POWER active, RELATIVE_GROWTH active, DCF_REALITY active, INVENTORY active ],
  score: 55,                    // durch PRICING_POWER gedeckelt
  cappedBy: [{ id: 'PRICING_POWER', ... }],
  catalystEV: ~0.1–0.2,         // separat
  conflicts: [
    'Starke Substanz, aber negative Verlaufsdynamik',
    'Bewertung attraktiv, Kursstruktur gebrochen',
    'DCF-Annahmen nicht durch realisierten Trend gedeckt'
  ],
  testQuestion: 'Was müsste passieren, damit "PRICING_POWER" entfällt? → ...'
}
*/
```

---

## 16. Integrations-Checkliste

```
[ ] scoring/-Ordner anlegen (types, pricingPower, relativeMomentum, gates, trend, catalysts, verdict, index)
[ ] runScoringPipeline an qualityScore der bestehenden Analyse hängen
[ ] Gate-Unit-Tests T1–T5 (§13.5)
[ ] Nike-Fixture als Regressionstest (§14.5)
[ ] Backtest-Panel optional (Researcher) mit trapRecall-Metrik
[ ] UI: Score + qualityScore + cappedBy + conflicts + testQuestion + catalystEV
[ ] Kein Kauf/Verkauf-Label — nur Konfliktmatrix
```

**Regel:** Dokumentation. Implementierung lokal → `npm run check` → PR → Review.
