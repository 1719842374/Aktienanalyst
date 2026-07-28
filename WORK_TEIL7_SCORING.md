# WORK_TEIL7_SCORING.md

> TEIL 7 vollständig: Trend-Gates, Pricing Power, Gates, Katalysatoren, Verdict  
> + Gold-Dashboard + **Realzins-Modell Implementierung**  
> Stand: 28.07.2026 | Nur Dokumentation

---

# TEIL 7 — TREND-GATES, PRICING POWER & BIG-PICTURE-SCORING

> Ziel: Fehlinvestments vom Typ "Nike 2023" strukturell verhindern — ohne Hardcoding  
> einzelner Ticker. Gates arbeiten relativ (Peer, Historie, Branchenindex).

## 7.1 Problemanalyse (Nike)

Pipeline ist **level-basiert statt delta-basiert**. Nike Q3 2023: Fundamental/ROIC/Marke grün, DCF grün, Technik rot als „Chance“. **Preissetzungsmacht fehlt** → Red Flag wird nicht erkannt.

## 7.2 Designprinzipien

1. Keine absoluten Schwellen (Perzentile / Peers)  
2. Delta vor Level (z-standardisiert 8Q)  
3. Gates **deckeln** multiplikativ, addieren nicht  
4. LLM extrahiert, urteilt nicht  
5. Konflikte sichtbar machen

## 7.3 Kernmodule

### 7.3.1 pricingPower.ts

```ts
export interface PricingPowerInput {
  grossMarginQ: number[];
  inputCostIndex: number[];
  asp: (number | null)[];
  volume: (number | null)[];
  discountMentions: number[];
  peerGrossMarginQ: number[][];
}

const slope = (xs: number[]) => {
  const n = xs.length, mx = (n - 1) / 2, my = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  xs.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return den === 0 ? 0 : num / den;
};

export function pricingPowerScore(i: PricingPowerInput) {
  const flags: string[] = [];
  const gmSlope = slope(i.grossMarginQ);
  const costSlope = slope(i.inputCostIndex);
  const marginVsCostDivergence = gmSlope - costSlope * 0.5;
  if (gmSlope < 0 && costSlope <= 0)
    flags.push('PRICING_POWER_LOSS: Bruttomarge fällt trotz stabiler/fallender Inputkosten');

  const aspSeries = i.asp.filter((v): v is number => v !== null);
  const volSeries = i.volume.filter((v): v is number => v !== null);
  const aspTrend = aspSeries.length >= 4 ? slope(aspSeries) : null;
  const volumeTrend = volSeries.length >= 4 ? slope(volSeries) : null;
  if (aspTrend != null && volumeTrend != null && aspTrend > 0 && volumeTrend < 0)
    flags.push('VOLUME_EROSION');
  if (aspTrend != null && aspTrend < 0) flags.push('DISCOUNTING');

  const dm = i.discountMentions;
  const mid = Math.floor(dm.length / 2);
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  const discountPressure = avg(dm.slice(0, mid)) === 0 ? 0
    : Math.min(1, Math.max(0, (avg(dm.slice(mid)) - avg(dm.slice(0, mid))) / Math.max(1, avg(dm.slice(0, mid)))));
  if (discountPressure > 0.5) flags.push('PROMO_INTENSITY');

  const peerSlopes = i.peerGrossMarginQ.map(slope).sort((a, b) => a - b);
  const peerMedian = peerSlopes.length ? peerSlopes[Math.floor(peerSlopes.length / 2)] : 0;
  const relativeMarginTrend = gmSlope - peerMedian;
  if (relativeMarginTrend < 0 && peerMedian >= 0) flags.push('RELATIVE_MARGIN_LOSS');

  const n = (v: number, s: number) => 50 + 50 * Math.tanh(v / s);
  const score = Math.round(
    0.35 * n(marginVsCostDivergence, 0.4) +
    0.25 * n(relativeMarginTrend, 0.4) +
    0.20 * n(volumeTrend ?? 0, 0.05) +
    0.20 * (100 - discountPressure * 100)
  );
  return { score, marginVsCostDivergence, aspTrend, volumeTrend, discountPressure, relativeMarginTrend, flags };
}
```

### 7.3.2 relativeMomentum.ts

```ts
export function relativeMomentum(ownYoY: number[], peerYoYWeighted: number[], inventoryDays: number[], revenue: number[]) {
  const gaps = ownYoY.map((v, k) => v - peerYoYWeighted[k]);
  let negativeQuarters = 0;
  for (let k = gaps.length - 1; k >= 0 && gaps[k] < 0; k--) negativeQuarters++;
  const dInv = inventoryDays.at(-1)! - inventoryDays.at(-5)!;
  const dRev = (revenue.at(-1)! / revenue.at(-5)! - 1) * 100;
  const flags: string[] = [];
  if (negativeQuarters >= 3) flags.push('SHARE_LOSS: 3+ Quartale schwächer als Peers');
  if (dInv - dRev > 0 && dRev <= 0) flags.push('INVENTORY_BUILD');
  return { growthGap: gaps.at(-1)!, negativeQuarters, inventoryStress: dInv - dRev,
           marketShareTrend: gaps.reduce((a, b) => a + b, 0), flags };
}
```

### 7.3.3 gates.ts — Veto

```ts
export interface Gate { id: string; active: boolean; cap: number; severity: 'warn'|'hard'; rationale: string; }

export function buildGates(pp: ReturnType<typeof pricingPowerScore>, rm: ReturnType<typeof relativeMomentum>,
  revDcf: { impliedGrowth: number; realizedGrowth8Q: number }): Gate[] {
  const gates: Gate[] = [];
  gates.push({ id: 'PRICING_POWER', active: pp.flags.includes('PRICING_POWER_LOSS') || pp.score < 40,
    cap: 55, severity: 'hard', rationale: 'Preissetzungsmacht erodiert' });
  gates.push({ id: 'RELATIVE_GROWTH', active: rm.negativeQuarters >= 3,
    cap: 60, severity: 'hard', rationale: 'Marktanteilsverlust 3+ Quartale' });
  const gapRatio = revDcf.realizedGrowth8Q === 0 ? Infinity
    : revDcf.impliedGrowth / Math.max(0.01, revDcf.realizedGrowth8Q);
  gates.push({ id: 'DCF_REALITY_CHECK', active: gapRatio > 2,
    cap: 65, severity: 'warn', rationale: `DCF g* vs 8Q-Trend` });
  gates.push({ id: 'INVENTORY', active: rm.flags.includes('INVENTORY_BUILD'),
    cap: 70, severity: 'warn', rationale: 'Lageraufbau bei stagnierendem Umsatz' });
  return gates;
}

export function applyGates(quality: number, trendMult: number, gates: Gate[]) {
  const raw = quality * trendMult;
  const caps = gates.filter(g => g.active).map(g => g.cap);
  const cap = caps.length ? Math.min(...caps) : 100;
  return { score: Math.min(raw, cap), cappedBy: gates.filter(g => g.active && g.cap === cap) };
}

export function trendMultiplier(zDeltas: number[]) {
  const mean = zDeltas.reduce((a, b) => a + b, 0) / zDeltas.length;
  return mean >= 0 ? 1 + 0.15 * Math.tanh(mean) : 1 + 0.50 * Math.tanh(mean);
}
```

## 7.4 Katalysatoren

```ts
export interface Catalyst {
  id: string; type: string; title: string; eventDate: string | null;
  probability: number; epsImpact: number;
  source: { url: string; publishedAt: string; snippet: string };
  confidence: 'low'|'medium'|'high';
}
export function catalystExpectedValue(cs: Catalyst[], price: number) {
  return cs.reduce((sum, c) => {
    const decay = c.eventDate
      ? Math.exp(-Math.max(0, (Date.parse(c.eventDate) - Date.now()) / 3.15e10)) : 0.5;
    return sum + c.probability * c.epsImpact * decay;
  }, 0) / price * 100;
}
```

## 7.5–7.7 Porter-Delta · ExtractedFact · buildVerdict

```ts
export function buildVerdict(v: {
  quality: number; trendMult: number; gates: Gate[];
  technicalRegime: 'uptrend'|'range'|'breakdown';
  catalystEV: number; reverseDcfConsistent: boolean;
}) {
  const { score, cappedBy } = applyGates(v.quality, v.trendMult, v.gates);
  const conflicts: string[] = [];
  if (v.quality > 70 && v.trendMult < 0.85)
    conflicts.push('Starke Substanz, negative Verlaufsdynamik');
  if (score > 65 && v.technicalRegime === 'breakdown')
    conflicts.push('Bewertung attraktiv, Kursstruktur gebrochen');
  if (!v.reverseDcfConsistent)
    conflicts.push('DCF-Annahmen nicht durch Trend gedeckt');
  const testQuestion = cappedBy.length
    ? `Was müsste passieren, damit "${cappedBy[0].id}" entfällt?` : null;
  return { score, conflicts, cappedBy, testQuestion, catalystEV: v.catalystEV };
}
```

---

# 7.8 Gold-Dashboard & Realzins-Modell

## 7.8.1–7.8.2 Indikatoren

**Angebot:** AISC · C1/C3 · Cost Curve · GDX/GLD · P/NAV  
**Makro:** Real Yield 10Y · Fair-Value-Regression · DXY · Real Fed Funds · Gold/Silber · WGC Zentralbank-Käufe

## 7.8.3 Chart-Konzept

Dual-Axis: Gold (gelb, links) vs Real 10Y (blau, rechts) + Nominal gestrichelt.  
Rot = Stress (Zins↑ Gold↓) · Grün = Tailwind (Zins↓ Gold↑) · AISC-Linie · GDX/GLD-Panel

## 7.8.8 Realzins-Modell — fertige Implementierungsspezifikation

### A) Realzins auflösen

```ts
export function resolveReal10Y(opts: {
  dfii10: number | null; dgs10: number | null; t10yie: number | null;
}): { value: number | null; source: 'DFII10' | 'DGS10-T10YIE' | null } {
  if (opts.dfii10 != null && !Number.isNaN(opts.dfii10))
    return { value: opts.dfii10, source: 'DFII10' };
  if (opts.dgs10 != null && opts.t10yie != null)
    return { value: opts.dgs10 - opts.t10yie, source: 'DGS10-T10YIE' };
  return { value: null, source: null };
}

export function realFedFunds(fedFunds: number, cpiYoY: number) {
  return fedFunds - cpiYoY;
}
```

### B) Serie bauen (FRED MacroSnapshot + Gold)

```ts
export interface GoldMacroPoint {
  date: string; gold: number;
  nominal10Y: number; real10Y: number; breakeven10Y: number;
  dxy?: number; fedFunds?: number; aiscUsd?: number; gdxGldRatio?: number;
}

export function buildGoldMacroSeries(
  goldSeries: { date: string; gold: number }[],
  macroByDate: Map<string, {
    dgs10: number|null; dfii10: number|null; t10yie: number|null;
    fedFunds?: number|null; dxy?: number|null;
  }>
): GoldMacroPoint[] {
  return goldSeries.map(g => {
    const m = macroByDate.get(g.date) ?? { dgs10: null, dfii10: null, t10yie: null };
    const real = resolveReal10Y({ dfii10: m.dfii10 ?? null, dgs10: m.dgs10 ?? null, t10yie: m.t10yie ?? null });
    return {
      date: g.date, gold: g.gold,
      nominal10Y: m.dgs10 ?? 0,
      real10Y: real.value ?? 0,
      breakeven10Y: m.t10yie ?? 0,
      dxy: m.dxy ?? undefined,
      fedFunds: m.fedFunds ?? undefined,
    };
  });
}
```

### C) Inverse-Score (Pearson)

```ts
export function goldRealYieldInverseScore(
  series: { gold: number; real10Y: number }[], window = 60
) {
  if (series.length < window) return { score: 50, correlation: 0, flags: ['INSUFFICIENT_DATA'] };
  const recent = series.slice(-window);
  const gRet = recent.slice(1).map((d, i) => (d.gold - recent[i].gold) / recent[i].gold);
  const rChg = recent.slice(1).map((d, i) => d.real10Y - recent[i].real10Y);
  const n = gRet.length;
  const mG = gRet.reduce((a, b) => a + b, 0) / n;
  const mR = rChg.reduce((a, b) => a + b, 0) / n;
  let num = 0, dG = 0, dR = 0;
  for (let i = 0; i < n; i++) {
    const dg = gRet[i] - mG, dr = rChg[i] - mR;
    num += dg * dr; dG += dg * dg; dR += dr * dr;
  }
  const correlation = dG === 0 || dR === 0 ? 0 : num / Math.sqrt(dG * dR);
  const score = Math.round(50 - 50 * Math.tanh(correlation * 2));
  const flags: string[] = [];
  if (correlation > -0.2) flags.push('DECOUPLING');
  if (correlation < -0.5) flags.push('STRONG_INVERSE');
  return { score, correlation, flags };
}
```

### D) Fair-Value (rolling OLS)

$$
Gold_t = \alpha_t + \beta_t \cdot Real10Y_t
$$

```ts
export function goldFairValueModel(gold: number[], real10Y: number[], window = 252, bandPct = 0.10) {
  return gold.map((_, i) => {
    if (i < window - 1) return { fairValue: null, alpha: null, beta: null, residualPct: null, regime: 'n/a' as const };
    const y = gold.slice(i - window + 1, i + 1);
    const x = real10Y.slice(i - window + 1, i + 1);
    const n = window;
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let k = 0; k < n; k++) { num += (x[k] - mx) * (y[k] - my); den += (x[k] - mx) ** 2; }
    if (den === 0) return { fairValue: null, alpha: null, beta: null, residualPct: null, regime: 'n/a' as const };
    const beta = num / den;
    const alpha = my - beta * mx;
    const fairValue = alpha + beta * real10Y[i];
    const residualPct = fairValue !== 0 ? (gold[i] - fairValue) / fairValue : null;
    const regime = residualPct == null ? 'n/a' as const
      : residualPct < -bandPct ? 'undervalued' as const
      : residualPct > bandPct ? 'overvalued' as const : 'fair' as const;
    return { fairValue, alpha, beta, residualPct, regime };
  });
}
```

### E) Sensitivität & Szenarien

```ts
export function goldRateSensitivity(beta: number, meanGold: number) {
  const semiElasticity = meanGold !== 0 ? beta / meanGold : 0;
  return { semiElasticity, durationProxy: -semiElasticity * 100 }; // % je 100 bp
}

export function goldRateScenarios(currentGold: number, beta: number, shocksBp = [-100, -50, 0, 50, 100, 150]) {
  return shocksBp.map(shockBp => {
    const impliedGold = currentGold + beta * (shockBp / 100);
    const changePct = currentGold !== 0 ? (impliedGold - currentGold) / currentGold * 100 : 0;
    return { shockBp, impliedGold, changePct };
  });
}
```

### F) Regime-Zonen

```ts
export function deriveGoldRegimeZones(points: GoldMacroPoint[], lookback = 20) {
  const zones: { start: string; end: string; type: 'stress'|'tailwind'; reason: string }[] = [];
  let cur: { type: 'stress'|'tailwind'; start: number; reason: string } | null = null;
  for (let i = lookback; i < points.length; i++) {
    const g0 = points[i - lookback].gold, g1 = points[i].gold;
    const r0 = points[i - lookback].real10Y, r1 = points[i].real10Y;
    const realUp = r1 > r0 + 0.15, realDn = r1 < r0 - 0.15;
    const goldUp = g1 > g0 * 1.02, goldDn = g1 < g0 * 0.98;
    let type: 'stress'|'tailwind'|null = null;
    let reason = '';
    if (realUp && goldDn) { type = 'stress'; reason = 'Realzins↑ Gold↓'; }
    else if (realDn && goldUp) { type = 'tailwind'; reason = 'Realzins↓ Gold↑'; }
    if (points[i].aiscUsd != null && points[i].gold < points[i].aiscUsd!) {
      type = type ?? 'stress'; reason += (reason ? ' · ' : '') + 'Spot < AISC';
    }
    if (type && (!cur || cur.type !== type)) {
      if (cur) zones.push({ start: points[cur.start].date, end: points[i-1].date, type: cur.type, reason: cur.reason });
      cur = { type, start: i, reason };
    } else if (!type && cur) {
      zones.push({ start: points[cur.start].date, end: points[i-1].date, type: cur.type, reason: cur.reason });
      cur = null;
    }
  }
  if (cur) zones.push({ start: points[cur.start].date, end: points[points.length-1].date, type: cur.type, reason: cur.reason });
  return zones;
}
```

### G) End-to-End Builder

```ts
export function runRealYieldGoldModel(points: GoldMacroPoint[], window = 252) {
  const gold = points.map(p => p.gold);
  const real = points.map(p => p.real10Y);
  const inverse = goldRealYieldInverseScore(points.map(p => ({ gold: p.gold, real10Y: p.real10Y })), 60);
  const fairSeries = goldFairValueModel(gold, real, window);
  const zones = deriveGoldRegimeZones(points);
  const last = fairSeries[fairSeries.length - 1];
  const sensitivity = last?.beta != null ? goldRateSensitivity(last.beta, gold.at(-1) ?? 1) : null;
  const scenarios = last?.beta != null ? goldRateScenarios(gold.at(-1) ?? 0, last.beta) : [];
  return {
    points, inverse, fairSeries, zones, sensitivity, scenarios,
    latest: {
      gold: gold.at(-1), real10Y: real.at(-1),
      fairValue: last?.fairValue ?? null,
      residualPct: last?.residualPct ?? null,
      regime: last?.regime ?? 'n/a',
      correlation: inverse.correlation,
      flags: inverse.flags,
    },
  };
}
```

### H) Gates

```ts
// correlation > -0.25 → DECOUPLING
gates.push({ id: 'GOLD_REAL_YIELD_REGIME', active: inverse.correlation > -0.25,
  cap: 75, severity: 'warn', rationale: 'Gold/Real Yields entkoppelt' });
gates.push({ id: 'GOLD_AISC_STRESS', active: spot < aiscUsd,
  cap: 80, severity: 'warn', rationale: 'Spot unter AISC' });
```

### I) Datenquellen & Checkliste

| Serie | FRED / Quelle |
|-------|----------------|
| Real 10Y | DFII10 |
| Nominal 10Y | DGS10 |
| Breakeven | T10YIE |
| Fed Funds | FEDFUNDS |
| CPI YoY | CPIAUCSL |
| DXY | DTWEXBGS |
| Gold Spot | FMP / Yahoo |
| AISC | WGC Reports |

```
[ ] goldMacro.ts: resolveReal10Y, buildGoldMacroSeries, inverseScore, fairValue, scenarios, zones, runModel
[ ] FRED-Anbindung (WORK2 §8.12 MacroSnapshot)
[ ] Chart: Gold + FV-Linie + Real10Y dual-axis + Stress/Tailwind Areas
[ ] Szenario-Tabelle −100bp … +150bp
[ ] Gates an Verdict anbinden
```

---

## 7.9 Nächste Schritte

- [ ] pricingPower + relativeMomentum + gates als Lib
- [ ] **Realzins-Modell** (7.8.8) implementieren
- [ ] Gold-Chart im Researcher / Gold-Tab
- [ ] LLM ExtractedFact für ASP/Volume/Discount

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
