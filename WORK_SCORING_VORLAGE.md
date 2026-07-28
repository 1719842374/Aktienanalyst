# WORK_SCORING_VORLAGE.md — Scoring-Logik Vorlage

> Stand: 28.07.2026  
> **Nur Dokumentation.** Copy-Paste-Vorlage für `client/src/lib/scoring/`.  
> Ziel: Nike-2023-Fehlgriffe verhindern — Gates deckeln, Narrative zählen nicht.

---

## 0. Architektur in einem Satz

```
finalScore = min( qualityScore × trendMultiplier , gateCap ) + catalystEV
             └──────── basis (0–100, multiplikativ) ────────┘   └ separat ┘
```

- **qualityScore** (0–100): Level-Fundamental (bestehend)
- **trendMultiplier** (0.5–1.15): Delta über 8Q, asymmetrisch
- **gateCap**: schärfstes aktives Veto (55/60/65/70/…)
- **catalystEV**: Erwartungswert in % des Kurses — **nicht** multipliziert, additiv ausgewiesen

---

## 1. Dateistruktur (Ziel)

```
client/src/lib/scoring/
  types.ts
  pricingPower.ts
  relativeMomentum.ts
  gates.ts
  trend.ts
  catalysts.ts
  verdict.ts
  index.ts          ← runScoringPipeline()
```

---

## 2. types.ts

```ts
export interface PricingPowerInput {
  grossMarginQ: number[];           // ≥8 Quartale, älteste zuerst
  inputCostIndex: number[];         // Branchen-PPI, gleiche Länge
  asp: (number | null)[];
  volume: (number | null)[];
  discountMentions: number[];
  peerGrossMarginQ: number[][];
}

export interface PricingPowerResult {
  score: number;                    // 0–100
  marginVsCostDivergence: number;
  aspTrend: number | null;
  volumeTrend: number | null;
  discountPressure: number;         // 0–1
  relativeMarginTrend: number;
  flags: string[];
}

export interface RelativeMomentumResult {
  growthGap: number;
  negativeQuarters: number;
  inventoryStress: number;
  marketShareTrend: number;
  flags: string[];
}

export interface Gate {
  id: string;
  active: boolean;
  cap: number;
  severity: 'warn' | 'hard';
  rationale: string;
}

export interface Catalyst {
  id: string;
  type: 'fiscal' | 'deal' | 'product' | 'regulatory' | 'capacity' | 'buyback' | 'litigation';
  title: string;
  eventDate: string | null;
  probability: number;              // 0–1
  epsImpact: number;                // Währung/Aktie
  source: { url: string; publishedAt: string; snippet: string };
  confidence: 'low' | 'medium' | 'high';
}

export interface ScoringInput {
  qualityScore: number;             // 0–100 aus bestehender Pipeline
  zDeltas: number[];                // z-Scores der Delta-Signale (8Q)
  pricingPower: PricingPowerInput;
  ownYoY: number[];
  peerYoYWeighted: number[];
  inventoryDays: number[];
  revenue: number[];
  revDcf: { impliedGrowth: number; realizedGrowth8Q: number };
  catalysts: Catalyst[];
  price: number;
  technicalRegime: 'uptrend' | 'range' | 'breakdown';
  reverseDcfConsistent: boolean;
  /** optional aus TEIL 8 */
  regulatoryGates?: Gate[];
}

export interface ScoringResult {
  qualityScore: number;
  trendMult: number;
  pricingPower: PricingPowerResult;
  relativeMomentum: RelativeMomentumResult;
  gates: Gate[];
  score: number;                    // nach Gates
  cappedBy: Gate[];
  catalystEV: number;               // % vom Kurs
  conflicts: string[];
  testQuestion: string | null;
  verdict: {
    score: number;
    conflicts: string[];
    cappedBy: Gate[];
    testQuestion: string | null;
    catalystEV: number;
  };
}
```

---

## 3. pricingPower.ts

```ts
const slope = (xs: number[]) => {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  xs.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return den === 0 ? 0 : num / den;
};

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const norm = (v: number, s: number) => 50 + 50 * Math.tanh(v / s);

export function pricingPowerScore(i: PricingPowerInput): PricingPowerResult {
  const flags: string[] = [];
  const gmSlope = slope(i.grossMarginQ);
  const costSlope = slope(i.inputCostIndex);
  const marginVsCostDivergence = gmSlope - costSlope * 0.5;

  if (gmSlope < 0 && costSlope <= 0)
    flags.push('PRICING_POWER_LOSS');

  const aspSeries = i.asp.filter((v): v is number => v != null);
  const volSeries = i.volume.filter((v): v is number => v != null);
  const aspTrend = aspSeries.length >= 4 ? slope(aspSeries) : null;
  const volumeTrend = volSeries.length >= 4 ? slope(volSeries) : null;

  if (aspTrend != null && volumeTrend != null && aspTrend > 0 && volumeTrend < 0)
    flags.push('VOLUME_EROSION');
  if (aspTrend != null && aspTrend < 0)
    flags.push('DISCOUNTING');

  const mid = Math.floor(i.discountMentions.length / 2);
  const base = avg(i.discountMentions.slice(0, mid));
  const recent = avg(i.discountMentions.slice(mid));
  const discountPressure = base === 0 ? 0 : Math.min(1, Math.max(0, (recent - base) / Math.max(1, base)));
  if (discountPressure > 0.5) flags.push('PROMO_INTENSITY');

  const peerSlopes = i.peerGrossMarginQ.map(slope).sort((a, b) => a - b);
  const peerMedian = peerSlopes.length ? peerSlopes[Math.floor(peerSlopes.length / 2)] : 0;
  const relativeMarginTrend = gmSlope - peerMedian;
  if (relativeMarginTrend < 0 && peerMedian >= 0) flags.push('RELATIVE_MARGIN_LOSS');

  const score = Math.round(
    0.35 * norm(marginVsCostDivergence, 0.4) +
    0.25 * norm(relativeMarginTrend, 0.4) +
    0.20 * norm(volumeTrend ?? 0, 0.05) +
    0.20 * (100 - discountPressure * 100)
  );

  return {
    score, marginVsCostDivergence, aspTrend, volumeTrend,
    discountPressure, relativeMarginTrend, flags,
  };
}
```

---

## 4. relativeMomentum.ts

```ts
export function relativeMomentum(
  ownYoY: number[],
  peerYoYWeighted: number[],
  inventoryDays: number[],
  revenue: number[]
): RelativeMomentumResult {
  const gaps = ownYoY.map((v, k) => v - (peerYoYWeighted[k] ?? 0));
  let negativeQuarters = 0;
  for (let k = gaps.length - 1; k >= 0 && gaps[k] < 0; k--) negativeQuarters++;

  const dInv = (inventoryDays.at(-1) ?? 0) - (inventoryDays.at(-5) ?? 0);
  const r0 = revenue.at(-5) ?? 1;
  const dRev = r0 !== 0 ? ((revenue.at(-1) ?? 0) / r0 - 1) * 100 : 0;
  const inventoryStress = dInv - dRev;

  const flags: string[] = [];
  if (negativeQuarters >= 3) flags.push('SHARE_LOSS');
  if (inventoryStress > 0 && dRev <= 0) flags.push('INVENTORY_BUILD');

  return {
    growthGap: gaps.at(-1) ?? 0,
    negativeQuarters,
    inventoryStress,
    marketShareTrend: gaps.reduce((a, b) => a + b, 0),
    flags,
  };
}
```

---

## 5. trend.ts + gates.ts

```ts
/** 0.5–1.15 — Verschlechterung härter bestraft als Verbesserung belohnt */
export function trendMultiplier(zDeltas: number[]): number {
  if (!zDeltas.length) return 1;
  const mean = zDeltas.reduce((a, b) => a + b, 0) / zDeltas.length;
  return mean >= 0 ? 1 + 0.15 * Math.tanh(mean) : 1 + 0.50 * Math.tanh(mean);
}

export function buildGates(
  pp: PricingPowerResult,
  rm: RelativeMomentumResult,
  revDcf: { impliedGrowth: number; realizedGrowth8Q: number },
  extra: Gate[] = []
): Gate[] {
  const gates: Gate[] = [];

  gates.push({
    id: 'PRICING_POWER',
    active: pp.flags.includes('PRICING_POWER_LOSS') || pp.score < 40,
    cap: 55,
    severity: 'hard',
    rationale: 'Preissetzungsmacht erodiert — Qualitätsprämie nicht gerechtfertigt',
  });

  gates.push({
    id: 'RELATIVE_GROWTH',
    active: rm.negativeQuarters >= 3,
    cap: 60,
    severity: 'hard',
    rationale: 'Marktanteilsverlust über 3+ Quartale',
  });

  const gapRatio = revDcf.realizedGrowth8Q === 0
    ? Infinity
    : revDcf.impliedGrowth / Math.max(0.01, revDcf.realizedGrowth8Q);

  gates.push({
    id: 'DCF_REALITY_CHECK',
    active: gapRatio > 2,
    cap: 65,
    severity: 'warn',
    rationale: `DCF unterstellt ${(revDcf.impliedGrowth * 100).toFixed(1)}%, realisiert ${(revDcf.realizedGrowth8Q * 100).toFixed(1)}%`,
  });

  gates.push({
    id: 'INVENTORY',
    active: rm.flags.includes('INVENTORY_BUILD'),
    cap: 70,
    severity: 'warn',
    rationale: 'Lageraufbau bei stagnierendem Umsatz',
  });

  return [...gates, ...extra.filter(g => g.active)];
}

export function applyGates(qualityScore: number, trendMult: number, gates: Gate[]) {
  const raw = qualityScore * trendMult;
  const active = gates.filter(g => g.active);
  const caps = active.map(g => g.cap);
  const cap = caps.length ? Math.min(...caps) : 100;
  return {
    score: Math.min(raw, cap),
    cappedBy: active.filter(g => g.cap === cap),
  };
}
```

---

## 6. catalysts.ts

```ts
export function catalystExpectedValue(cs: Catalyst[], price: number): number {
  if (!price) return 0;
  return cs.reduce((sum, c) => {
    if (c.confidence === 'low') return sum; // low = display only
    const decay = c.eventDate
      ? Math.exp(-Math.max(0, (Date.parse(c.eventDate) - Date.now()) / 3.15e10))
      : 0.5;
    return sum + c.probability * c.epsImpact * decay;
  }, 0) / price * 100;
}
```

---

## 7. verdict.ts

```ts
export function buildVerdict(v: {
  quality: number;
  trendMult: number;
  gates: Gate[];
  technicalRegime: 'uptrend' | 'range' | 'breakdown';
  catalystEV: number;
  reverseDcfConsistent: boolean;
}) {
  const { score, cappedBy } = applyGates(v.quality, v.trendMult, v.gates);
  const conflicts: string[] = [];

  if (v.quality > 70 && v.trendMult < 0.85)
    conflicts.push('Starke Substanz, aber negative Verlaufsdynamik');
  if (score > 65 && v.technicalRegime === 'breakdown')
    conflicts.push('Bewertung attraktiv, Kursstruktur gebrochen');
  if (!v.reverseDcfConsistent)
    conflicts.push('DCF-Annahmen nicht durch realisierten Trend gedeckt');

  const testQuestion = cappedBy.length
    ? `Was müsste passieren, damit "${cappedBy[0].id}" entfällt? → ${cappedBy[0].rationale}`
    : null;

  return { score, conflicts, cappedBy, testQuestion, catalystEV: v.catalystEV };
}
```

---

## 8. index.ts — Pipeline-Vorlage

```ts
export function runScoringPipeline(input: ScoringInput): ScoringResult {
  const pp = pricingPowerScore(input.pricingPower);
  const rm = relativeMomentum(
    input.ownYoY,
    input.peerYoYWeighted,
    input.inventoryDays,
    input.revenue
  );
  const trendMult = trendMultiplier(input.zDeltas);
  const gates = buildGates(pp, rm, input.revDcf, input.regulatoryGates ?? []);
  const { score, cappedBy } = applyGates(input.qualityScore, trendMult, gates);
  const catalystEV = catalystExpectedValue(input.catalysts, input.price);
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
    pricingPower: pp,
    relativeMomentum: rm,
    gates,
    score,
    cappedBy,
    catalystEV,
    conflicts: verdict.conflicts,
    testQuestion: verdict.testQuestion,
    verdict,
  };
}
```

---

## 9. Gate-Cap-Referenz

| Gate-ID | Cap | Severity | Trigger |
|---------|-----|----------|--------|
| PRICING_POWER | 55 | hard | Flag PRICING_POWER_LOSS oder score < 40 |
| RELATIVE_GROWTH | 60 | hard | negativeQuarters ≥ 3 |
| DCF_REALITY_CHECK | 65 | warn | impliedGrowth / realized8Q > 2 |
| INVENTORY | 70 | warn | INVENTORY_BUILD |
| REGULATORY_EXPOSURE | 55/65 | hard/warn | TEIL 8 material regs |
| GOLD_REAL_YIELD_REGIME | 75 | warn | corr > −0.25 (Makro-Kontext) |

**Regel:** `gateCap = min(aktive Caps)`. Ein hard Gate bei 55 kann einen Quality-Score von 90 auf 55 deckeln.

---

## 10. Output-Vertrag (UI / PDF)

```ts
// An Fazit-Sektion / PDF-Export:
{
  score: number,              // 0–gateCap
  qualityScore: number,
  trendMult: number,
  cappedBy: [{ id, rationale, severity }],
  conflicts: string[],
  testQuestion: string | null,
  catalystEV: number,         // separat ausweisen, nicht in score einrechnen
  flags: {
    pricingPower: string[],
    relativeMomentum: string[],
  }
}
```

**Kein einzelnes Kauf/Verkauf-Label.** Konfliktmatrix + Testfrage ersetzen das Rating.

---

## 11. Anti-Hardcoding-Checkliste

```
[ ] Keine ticker-spezifischen if (ticker === 'NKE')
[ ] Keine absoluten Margen-Schwellen (nur Trends / Peers / eigene Historie)
[ ] Gates nur über Flags + relative Bedingungen
[ ] LLM liefert ExtractedFact (asp/volume/discount), kein Score-Text
[ ] Katalysatoren nur mit source.url + publishedAt
[ ] confidence === 'low' → kein Gate, nur UI-Badge
```

---

## 12. Minimaler Integrationspfad

```
1. types.ts + pricingPower.ts + relativeMomentum.ts + trend.ts + gates.ts anlegen
2. runScoringPipeline an bestehende qualityScore-Berechnung hängen
3. Ergebnis in Section 17 / Fazit rendern (Score, Caps, Conflicts, TestQuestion)
4. catalystEV als eigene Zeile neben DCF-Target
5. Unit-Tests: Nike-ähnliche Inputs → PRICING_POWER aktiv, score ≤ 55
```

**Regel:** Vorlage = Dokumentation. Implementierung lokal → `npm run check` → PR → Review.
