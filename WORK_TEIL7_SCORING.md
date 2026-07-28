# WORK_TEIL7_SCORING.md

> TEIL 7 + Gold-Dashboard + **Realzins-Modell Implementierung**  
> Stand: 28.07.2026

---

# TEIL 7 — TREND-GATES & GOLD / REALZINS-MODELL

## 7.1–7.7

Nike · Designprinzipien · pricingPower · relativeMomentum · gates · Catalyst · Porter · Verdict  
(Code in Git-History / Vorgängercommits dieser Datei)

## 7.8 Gold-Dashboard (Übersicht)

Minenkosten (AISC, Cost Curve, GDX/GLD) · Makro (Real Yield, DXY, Fed Funds) · Chart dual-axis  
Zonen stress/tailwind · Gates GOLD_REAL_YIELD_REGIME / GOLD_AISC_STRESS

---

## 7.8.8 Realzins-Modell — Implementierungsspezifikation

> **Nur Dokumentation.** Ziel: deterministische Pipeline von FRED-Rohdaten → Realzins →  
> Fair-Value-Gold → Chart + Gate. Kein LLM-Urteil in der Berechnung.

### A) Definition Realzins (zwei äquivalente Wege)

```
Methode 1 — direkt (bevorzugt):
  real10Y = DFII10          // FRED: 10Y TIPS Yield

Methode 2 — berechnet:
  real10Y = DGS10 − T10YIE  // Nominal 10Y − 10Y Breakeven Inflation

Differenz DFII10 vs. (DGS10−T10YIE) ist i.d.R. klein (Liquidity/Technical Spread).
Regel: primär DFII10; Fallback = DGS10 − T10YIE wenn DFII10 fehlt.
```

```ts
export function resolveReal10Y(opts: {
  dfii10: number | null;
  dgs10: number | null;
  t10yie: number | null;
}): { value: number | null; source: 'DFII10' | 'DGS10-T10YIE' | null } {
  if (opts.dfii10 != null && !Number.isNaN(opts.dfii10))
    return { value: opts.dfii10, source: 'DFII10' };
  if (opts.dgs10 != null && opts.t10yie != null)
    return { value: opts.dgs10 - opts.t10yie, source: 'DGS10-T10YIE' };
  return { value: null, source: null };
}

/** Kurzfristiger Real-Leitzins (Policy) */
export function realFedFunds(fedFunds: number, cpiYoY: number): number {
  return fedFunds - cpiYoY; // beide in %
}
```

### B) Datenpipeline (Anbindung an WORK2 §8.12 MacroSnapshot)

```
FRED fetchFredSeries / buildMacroSnapshot
        │
        ├─ DGS10      → nominal10Y
        ├─ DFII10     → real10Y (primär)
        ├─ T10YIE     → breakeven10Y (Fallback-Rechnung)
        ├─ FEDFUNDS   → fedFunds
        ├─ CPIAUCSL   → inflationYoY (für realFedFunds)
        └─ DTWEXBGS   → dxy (optional)
        │
        ▼
Gold Spot Serie (FMP / Yahoo / Metals)
        │
        ▼
mergeAsOfDate(gold[], macro[])  → GoldMacroPoint[]
        │
        ├─ goldRealYieldInverseScore(window=60|120|252)
        ├─ goldFairValueModel(...)
        ├─ deriveGoldRegimeZones(...)
        └─ goldRateSensitivity(...)
```

```ts
export async function buildGoldMacroSeries(
  goldSeries: { date: string; gold: number }[],
  macroByDate: Map<string, { dgs10: number|null; dfii10: number|null; t10yie: number|null;
                              fedFunds?: number|null; cpiYoY?: number|null; dxy?: number|null }>
): Promise<GoldMacroPoint[]> {
  return goldSeries.map(g => {
    const m = macroByDate.get(g.date) ?? {};
    const real = resolveReal10Y({
      dfii10: m.dfii10 ?? null,
      dgs10: m.dgs10 ?? null,
      t10yie: m.t10yie ?? null,
    });
    return {
      date: g.date,
      gold: g.gold,
      nominal10Y: m.dgs10 ?? 0,
      real10Y: real.value ?? 0,
      breakeven10Y: m.t10yie ?? 0,
      dxy: m.dxy ?? undefined,
      fedFunds: m.fedFunds ?? undefined,
    };
  }).filter(p => p.real10Y !== 0 || p.nominal10Y !== 0);
}
```

### C) Fair-Value-Modell (Gold ~ Realzins)

**Einfach (1-Faktor, rolling OLS):**

$$
\text{Gold}_t = \alpha_t + \beta_t \cdot \text{Real10Y}_t + \varepsilon_t
$$

```ts
export interface FairValueResult {
  fairValue: number | null;
  alpha: number | null;
  beta: number | null;       // typisch negativ (Inverse)
  residualPct: number | null; // (Spot − FV) / FV
  regime: 'undervalued' | 'fair' | 'overvalued' | 'n/a';
}

export function goldFairValueModel(
  gold: number[],
  real10Y: number[],
  window = 252,
  bandPct = 0.10 // ±10 % = fair
): FairValueResult[] {
  return gold.map((_, i) => {
    if (i < window - 1)
      return { fairValue: null, alpha: null, beta: null, residualPct: null, regime: 'n/a' };

    const y = gold.slice(i - window + 1, i + 1);
    const x = real10Y.slice(i - window + 1, i + 1);
    const n = window;
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let k = 0; k < n; k++) {
      num += (x[k] - mx) * (y[k] - my);
      den += (x[k] - mx) ** 2;
    }
    if (den === 0)
      return { fairValue: null, alpha: null, beta: null, residualPct: null, regime: 'n/a' };

    const beta = num / den;
    const alpha = my - beta * mx;
    const fairValue = alpha + beta * real10Y[i];
    const residualPct = fairValue !== 0 ? (gold[i] - fairValue) / fairValue : null;

    let regime: FairValueResult['regime'] = 'fair';
    if (residualPct != null) {
      if (residualPct < -bandPct) regime = 'undervalued';
      else if (residualPct > bandPct) regime = 'overvalued';
    }

    return { fairValue, alpha, beta, residualPct, regime };
  });
}
```

**Erweitert (2–3 Faktoren, optional):**

$$
\text{Gold}_t = \alpha + \beta_1 \text{Real10Y}_t + \beta_2 \text{DXY}_t + \beta_3 \log(\text{FedBalance}_t) + \varepsilon
$$

```ts
// Multiple Regression nur wenn DXY / Fed-Bilanz-Serien verfügbar.
// Implementierung: normale Gleichungen oder einfache Matrix-OLS (2×2 / 3×3).
// beta1 weiterhin dominant negativ erwartet; beta2 (DXY) typisch negativ.
```

### D) Zinssensitivität (empirische „Duration“)

```
Historisch (Faustformel, Longtermtrends / PIMCO-Nähe):
  ΔGold ≈ −15 % bis −20 % pro +100 bp Real Yield
  → empirische Duration ≈ 18

Im Modell aus beta der Regression:
  semiElasticity ≈ beta / mean(Gold)     // relative Änderung pro 1 %-Punkt Realzins
  durationProxy  ≈ −semiElasticity * 100 // % Gold-Änderung pro 100 bp
```

```ts
export function goldRateSensitivity(
  beta: number,           // aus Fair-Value OLS
  meanGold: number
): { semiElasticity: number; durationProxy: number } {
  const semiElasticity = meanGold !== 0 ? beta / meanGold : 0;
  // beta ist $/oz pro %-Punkt Realzins; semiElasticity = relative Änderung pro pp
  const durationProxy = -semiElasticity * 100; // % pro 100 bp
  return { semiElasticity, durationProxy };
}

/** Szenario-Tabelle für UI */
export function goldRateScenarios(
  currentGold: number,
  currentReal10Y: number,
  beta: number,
  shocksBp: number[] = [-100, -50, 0, 50, 100, 150]
): { shockBp: number; impliedGold: number; changePct: number }[] {
  return shocksBp.map(shockBp => {
    const dReal = shockBp / 100; // bp → %-Punkte
    const impliedGold = currentGold + beta * dReal;
    const changePct = currentGold !== 0 ? (impliedGold - currentGold) / currentGold * 100 : 0;
    return { shockBp, impliedGold, changePct };
  });
}
```

### E) End-to-End Builder

```ts
export async function runRealYieldGoldModel(params: {
  goldSeries: { date: string; gold: number }[];
  // aus buildMacroSnapshot / FRED-Historie aligned auf goldSeries.dates
  macroSeries: {
    date: string;
    dgs10: number | null;
    dfii10: number | null;
    t10yie: number | null;
    fedFunds?: number | null;
    cpiYoY?: number | null;
    dxy?: number | null;
  }[];
  window?: number;
}) {
  const window = params.window ?? 252;
  const macroMap = new Map(params.macroSeries.map(m => [m.date, m]));
  const points = await buildGoldMacroSeries(params.goldSeries, macroMap);

  const gold = points.map(p => p.gold);
  const real = points.map(p => p.real10Y);

  const inverse = goldRealYieldInverseScore(
    points.map(p => ({ gold: p.gold, real10Y: p.real10Y })),
    Math.min(60, points.length)
  );
  const fairSeries = goldFairValueModel(gold, real, window);
  const zones = deriveGoldRegimeZones(points);
  const lastFair = fairSeries[fairSeries.length - 1];
  const sensitivity = lastFair?.beta != null
    ? goldRateSensitivity(lastFair.beta, gold[gold.length - 1] ?? 1)
    : null;
  const scenarios = lastFair?.beta != null
    ? goldRateScenarios(
        gold[gold.length - 1],
        real[real.length - 1],
        lastFair.beta
      )
    : [];

  return {
    points,
    inverse,
    fairSeries,
    zones,
    sensitivity,
    scenarios,
    latest: {
      gold: gold[gold.length - 1],
      real10Y: real[real.length - 1],
      fairValue: lastFair?.fairValue ?? null,
      residualPct: lastFair?.residualPct ?? null,
      regime: lastFair?.regime ?? 'n/a',
      correlation: inverse.correlation,
      inverseFlags: inverse.flags,
    },
  };
}
```

### F) UI-Ausgabe (Gold-Dashboard / Macro-Tab)

```
1. Dual-Axis Chart: Gold vs Real10Y (+ Nominal gestrichelt)
2. Fair-Value-Linie über Gold legen (aus fairSeries)
3. Residual-Badge: undervalued / fair / overvalued (±10 % Band)
4. Szenario-Tabelle: −100bp … +150bp → implied Gold
5. Korrelations-Score + Flags (STRONG_INVERSE / DECOUPLING)
6. Stress/Tailwind ReferenceAreas aus zones
```

### G) Implementierungs-Checkliste

```
[ ] resolveReal10Y + realFedFunds in client/src/lib/goldMacro.ts
[ ] buildGoldMacroSeries (Merge Gold + FRED MacroSnapshot Historie)
[ ] goldFairValueModel (rolling OLS, window 252 default)
[ ] goldRateSensitivity + goldRateScenarios
[ ] runRealYieldGoldModel End-to-End
[ ] FRED-Serien: DFII10, DGS10, T10YIE, FEDFUNDS, CPI YoY (WORK2 §8.12)
[ ] Chart: Gold + FV-Linie + Real10Y dual-axis + Zonen
[ ] Gate GOLD_REAL_YIELD_REGIME aus inverse.correlation
```

**Regel:** Nur Dokumentation. Implementierung lokal → PR → Review.

---

## 7.9 Nächste Schritte

- [ ] PricingPower / RelativeMomentum Lib
- [ ] Gates in Verdict-Pipeline
- [ ] **Realzins-Modell** (7.8.8) + Gold-Chart
- [ ] LLM ExtractedFact ASP/Volume/Discount

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
