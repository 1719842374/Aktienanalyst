# WORK_TEIL7_SCORING.md

> Vollständiger detaillierter TEIL 7 aus Commit 975dbe93  
> Trend-Gates, Pricing Power, Relative Momentum, Veto-Architektur, Katalysatoren, Porter, Verdict, Gold vs Real Yields  
> Stand: 28.07.2026

---

# TEIL 7 — TREND-GATES, PRICING POWER & BIG-PICTURE-SCORING + GOLD vs REAL YIELDS

> Ziel: Fehlinvestments vom Typ "Nike 2023" strukturell verhindern — ohne Hardcoding  
> einzelner Ticker oder fixer Schwellenwerte. Alle Gates arbeiten mit relativen,  
> selbstkalibrierenden Größen (Peer-Gruppe, eigene Historie, Branchenindex).

## 7.1 Problemanalyse: Warum die 17 Sektionen den Nike-Fall nicht fängt

Die Pipeline ist breiter als ein klassischer Analystenreport, aber sie ist  
überwiegend **level-basiert statt delta-basiert**. Sie beantwortet  
"Wie gut ist die Firma heute und was ist sie wert?" — nicht  
"Verändert sich gerade die Grundlage, auf der diese Bewertung ruht?"

Simulation Nike Q3 2023:

| Sektion | Signal 2023 | Problem |
|---|---|---|
| Fundamental / Qualität | grün | ROIC, Marke, Bruttomarge ~44% noch stark |
| Lynch-Klassifikation | Fast Grower → Stalwart | Reklassifikation ist nur ein Label, kein Score-Abzug |
| FCFF-DCF | stark grün | Historische Wachstumsraten fortgeschrieben = massive "Unterbewertung" |
| Reverse DCF | neutral | Prüft gegen 5J-Historie statt gegen 8Q-Realtrend |
| Porter Five Forces | grün | Statisch: Branche attraktiv, Positionsverlust unsichtbar |
| Technik (RSI/MACD/RSL) | rot | Wird als "überverkauft = Chance" fehlinterpretiert |
| News / LLM | Rabatte, DTC-Probleme erwähnt | Prosa ohne Score-Wirkung |

**Ergebnis:** mehrheitlich grün → Fazit "Value-Chance". Der Red Flag wird nicht erkannt, weil kein Mechanismus existiert, der ein negatives Delta gegen einen positiven Level durchsetzt.

Fehlende Kernmessung: **Preissetzungsmacht**.

## 7.2 Designprinzipien (Anti-Hardcoding)

1. **Keine absoluten Schwellen.** Jede Grenze ist ein Perzentil der eigenen Historie (rolling 20 Quartale) oder der Peer-Gruppe.
2. **Delta vor Level.** Jede Sektion liefert zusätzlich zum Level einen z-standardisierten Trendwert über 8 Quartale.
3. **Gates deckeln, sie addieren nicht.** Ein Red Flag kann nicht durch einen starken DCF wegkompensiert werden.
4. **LLM extrahiert, es urteilt nicht.** Das Modell füllt typisierte Felder mit Quelle + Datum; die Aggregation ist deterministischer Code.
5. **Konflikte sichtbar machen.** Divergenz zwischen Ebenen ist ein eigener Output, kein Mittelwert.

## 7.3 Neue Kernmodule

### 7.3.1 `client/src/lib/pricingPower.ts`

```ts
export interface PricingPowerInput {
  grossMarginQ: number[];          // 8+ Quartale, älteste zuerst
  inputCostIndex: number[];        // Branchen-PPI (FRED), gleiche Länge
  asp: (number | null)[];          // Average Selling Price, aus Transkript-Extraktion
  volume: (number | null)[];       // Absatzmenge / Units
  discountMentions: number[];      // Anzahl Rabatt-Erwähnungen je Call
  peerGrossMarginQ: number[][];    // je Peer eine Serie
}

export interface PricingPowerResult {
  score: number;                   // 0..100
  marginVsCostDivergence: number;  // negativ = Marge fällt trotz fallender Kosten
  aspTrend: number | null;
  volumeTrend: number | null;
  discountPressure: number;        // 0..1
  relativeMarginTrend: number;     // vs. Peer-Median
  flags: string[];
}

const slope = (xs: number[]) => {
  const n = xs.length, mx = (n - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  xs.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return den === 0 ? 0 : num / den;
};

export function pricingPowerScore(i: PricingPowerInput): PricingPowerResult {
  const flags: string[] = [];
  const gmSlope = slope(i.grossMarginQ);
  const costSlope = slope(i.inputCostIndex);

  const marginVsCostDivergence = gmSlope - costSlope * 0.5;
  if (gmSlope < 0 && costSlope <= 0) {
    flags.push('PRICING_POWER_LOSS: Bruttomarge fällt trotz stabiler/fallender Inputkosten');
  }

  const aspSeries = i.asp.filter((v): v is number => v !== null);
  const volSeries = i.volume.filter((v): v is number => v !== null);
  const aspTrend = aspSeries.length >= 4 ? slope(aspSeries) : null;
  const volumeTrend = volSeries.length >= 4 ? slope(volSeries) : null;

  if (aspTrend !== null && volumeTrend !== null && aspTrend > 0 && volumeTrend < 0) {
    flags.push('VOLUME_EROSION: Umsatz nur preisgetrieben, Menge rückläufig');
  }
  if (aspTrend !== null && aspTrend < 0) {
    flags.push('DISCOUNTING: Durchschnittspreise rückläufig');
  }

  const dm = i.discountMentions;
  const base = dm.slice(0, Math.floor(dm.length / 2));
  const recent = dm.slice(Math.floor(dm.length / 2));
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const discountPressure = avg(base) === 0 ? 0
    : Math.min(1, Math.max(0, (avg(recent) - avg(base)) / Math.max(1, avg(base))));
  if (discountPressure > 0.5) flags.push('PROMO_INTENSITY: Rabatt-Rhetorik stark gestiegen');

  const peerSlopes = i.peerGrossMarginQ.map(slope).sort((a, b) => a - b);
  const peerMedian = peerSlopes.length ? peerSlopes[Math.floor(peerSlopes.length / 2)] : 0;
  const relativeMarginTrend = gmSlope - peerMedian;
  if (relativeMarginTrend < 0 && peerMedian >= 0) {
    flags.push('RELATIVE_MARGIN_LOSS: Marge schwächer als Peer-Median');
  }

  const n = (v: number, s: number) => 50 + 50 * Math.tanh(v / s);
  const score = Math.round(
    0.35 * n(marginVsCostDivergence, 0.4) +
    0.25 * n(relativeMarginTrend, 0.4) +
    0.20 * n(volumeTrend ?? 0, 0.05) +
    0.20 * (100 - discountPressure * 100)
  );

  return { score, marginVsCostDivergence, aspTrend, volumeTrend,
           discountPressure, relativeMarginTrend, flags };
}
```

### 7.3.2 `client/src/lib/relativeMomentum.ts`

```ts
export interface RelativeMomentumResult {
  growthGap: number;
  negativeQuarters: number;
  inventoryStress: number;
  marketShareTrend: number;
  flags: string[];
}

export function relativeMomentum(
  ownYoY: number[],
  peerYoYWeighted: number[],
  inventoryDays: number[],
  revenue: number[]
): RelativeMomentumResult {
  const gaps = ownYoY.map((v, k) => v - peerYoYWeighted[k]);
  let negativeQuarters = 0;
  for (let k = gaps.length - 1; k >= 0 && gaps[k] < 0; k--) negativeQuarters++;

  const dInv = inventoryDays.at(-1)! - inventoryDays.at(-5)!;
  const dRev = (revenue.at(-1)! / revenue.at(-5)! - 1) * 100;
  const inventoryStress = dInv - dRev;

  const flags: string[] = [];
  if (negativeQuarters >= 3)
    flags.push('SHARE_LOSS: 3+ Quartale schwächer als Peers → Moat-Erosion');
  if (inventoryStress > 0 && dRev <= 0)
    flags.push('INVENTORY_BUILD: Lager wächst schneller als Umsatz');

  return {
    growthGap: gaps.at(-1)!,
    negativeQuarters,
    inventoryStress,
    marketShareTrend: gaps.reduce((a, b) => a + b, 0),
    flags,
  };
}
```

### 7.3.3 `client/src/lib/gates.ts` — Veto-Architektur

```ts
export interface Gate {
  id: string;
  active: boolean;
  cap: number;
  severity: 'warn' | 'hard';
  rationale: string;
}

export function buildGates(
  pp: PricingPowerResult,
  rm: RelativeMomentumResult,
  revDcf: { impliedGrowth: number; realizedGrowth8Q: number }
): Gate[] {
  const gates: Gate[] = [];

  gates.push({
    id: 'PRICING_POWER',
    active: pp.flags.includes('PRICING_POWER_LOSS') || pp.score < 40,
    cap: 55, severity: 'hard',
    rationale: 'Preissetzungsmacht erodiert — Qualitätsprämie nicht mehr gerechtfertigt',
  });

  gates.push({
    id: 'RELATIVE_GROWTH',
    active: rm.negativeQuarters >= 3,
    cap: 60, severity: 'hard',
    rationale: 'Marktanteilsverlust über 3+ Quartale',
  });

  const gapRatio = revDcf.realizedGrowth8Q === 0 ? Infinity
    : revDcf.impliedGrowth / Math.max(0.01, revDcf.realizedGrowth8Q);

  gates.push({
    id: 'DCF_REALITY_CHECK',
    active: gapRatio > 2,
    cap: 65, severity: 'warn',
    rationale: `DCF unterstellt ${(revDcf.impliedGrowth * 100).toFixed(1)} % Wachstum, `
      + `realisiert wurden ${(revDcf.realizedGrowth8Q * 100).toFixed(1)} %`,
  });

  gates.push({
    id: 'INVENTORY',
    active: rm.flags.includes('INVENTORY_BUILD'),
    cap: 70, severity: 'warn',
    rationale: 'Lageraufbau bei stagnierendem Umsatz — Nachfrageschwäche',
  });

  return gates;
}

export function applyGates(qualityScore: number, trendMultiplier: number, gates: Gate[]) {
  const raw = qualityScore * trendMultiplier;
  const caps = gates.filter(g => g.active).map(g => g.cap);
  const cap = caps.length ? Math.min(...caps) : 100;
  return { score: Math.min(raw, cap), cappedBy: gates.filter(g => g.active && g.cap === cap) };
}
```

### 7.3.4 Trend-Multiplikator

```ts
// 0.5 .. 1.15 — bestraft Verschlechterung stärker als es Verbesserung belohnt
export function trendMultiplier(zDeltas: number[]): number {
  const mean = zDeltas.reduce((a, b) => a + b, 0) / zDeltas.length;
  return mean >= 0 ? 1 + 0.15 * Math.tanh(mean) : 1 + 0.50 * Math.tanh(mean);
}
```

## 7.4 Katalysatoren als quantifizierte Objekte

```ts
export interface Catalyst {
  id: string;
  type: 'fiscal' | 'deal' | 'product' | 'regulatory' | 'capacity' | 'buyback' | 'litigation';
  title: string;
  eventDate: string | null;
  probability: number;
  addressableVolume: number;
  companyShare: number;
  epsImpact: number;
  multipleImpact: number;
  source: { url: string; publishedAt: string; snippet: string };
  confidence: 'low' | 'medium' | 'high';
}

export function catalystExpectedValue(cs: Catalyst[], price: number): number {
  return cs.reduce((sum, c) => {
    const decay = c.eventDate
      ? Math.exp(-Math.max(0, (Date.parse(c.eventDate) - Date.now()) / 3.15e10))
      : 0.5;
    return sum + c.probability * c.epsImpact * decay;
  }, 0) / price * 100;
}
```

## 7.5 Porter dynamisch statt statisch

```ts
export interface PorterSnapshot {
  supplierPower: number; buyerPower: number; newEntrants: number;
  substitutes: number; rivalry: number;
  disruption: number; // 6. Kraft
}

export function porterDelta(t0: PorterSnapshot, t1: PorterSnapshot) {
  const keys = Object.keys(t0) as (keyof PorterSnapshot)[];
  const deltas = Object.fromEntries(keys.map(k => [k, t1[k] - t0[k]]));
  const total = keys.reduce((s, k) => s + (t1[k] - t0[k]), 0);
  return { deltas, total, deteriorating: keys.filter(k => t1[k] - t0[k] < -1) };
}
```

## 7.6 LLM-Layer: Extraktion statt Urteil

```ts
export interface ExtractedFact {
  field: 'asp' | 'volume' | 'discount' | 'capacity' | 'guidance' | 'contract' | 'churn';
  value: number | string;
  unit: string | null;
  period: string;
  quote: string;
  source: { url: string; publishedAt: string };
  confidence: number;
}
```

Regeln: Kein Wert ohne quote+source. Keine Adjektive. Bei Widerspruch beide Fälle, confidence senken.

## 7.7 Fazit-Sektion: Konfliktmatrix statt Rating

```ts
export function buildVerdict(v: {
  quality: number; trendMult: number; gates: Gate[];
  technicalRegime: 'uptrend' | 'range' | 'breakdown';
  catalystEV: number; reverseDcfConsistent: boolean;
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

## 7.8 Gold vs Real Yields

Real Yield = DFII10 (FRED) oder Nominal 10Y − T10YIE Breakeven.

```ts
export function goldRealYieldInverseScore(
  series: { gold: number; real10Y: number }[],
  window = 60
): { score: number; correlation: number; flags: string[] } {
  if (series.length < window) return { score: 50, correlation: 0, flags: ['INSUFFICIENT_DATA'] };
  const recent = series.slice(-window);
  const goldReturns = recent.slice(1).map((d, i) => (d.gold - recent[i].gold) / recent[i].gold);
  const realYieldChanges = recent.slice(1).map((d, i) => d.real10Y - recent[i].real10Y);
  const n = goldReturns.length;
  const meanG = goldReturns.reduce((a, b) => a + b, 0) / n;
  const meanR = realYieldChanges.reduce((a, b) => a + b, 0) / n;
  let num = 0, denG = 0, denR = 0;
  for (let i = 0; i < n; i++) {
    const dg = goldReturns[i] - meanG, dr = realYieldChanges[i] - meanR;
    num += dg * dr; denG += dg * dg; denR += dr * dr;
  }
  const correlation = denG === 0 || denR === 0 ? 0 : num / Math.sqrt(denG * denR);
  const score = Math.round(50 - 50 * Math.tanh(correlation * 2));
  const flags: string[] = [];
  if (correlation > -0.2) flags.push('DECOUPLING: Inverse Beziehung geschwächt');
  if (correlation < -0.5) flags.push('STRONG_INVERSE: Klassische Gold-RealYield Relation intakt');
  return { score, correlation, flags };
}
```

Datenquellen FRED: DGS10, DFII10, T10YIE.

## 7.9 Nächste Schritte

- [ ] PricingPower + RelativeMomentum als Lib in `client/src/lib/`
- [ ] Gates multiplikativ in Verdict-Pipeline
- [ ] Gold vs Real Yields Chart im Researcher Macro-Pulse
- [ ] LLM-Prompt ASP/Volume/Discount aus Earnings Calls
- [ ] Keine Hardcoded-Ticker — alles relativ / z-score / Perzentil

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
