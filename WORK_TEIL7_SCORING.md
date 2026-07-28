# WORK_TEIL7_SCORING.md

> TEIL 7: Trend-Gates, Pricing Power, Relative Momentum, Veto, Katalysatoren, Porter, Verdict  
> + **Gold-Dashboard: Minenkosten, Makro, Chart Gold vs Realzinsen/Leitzinsen**  
> Stand: 28.07.2026

---

# TEIL 7 — TREND-GATES, PRICING POWER & BIG-PICTURE-SCORING

> Ziel: Fehlinvestments vom Typ "Nike 2023" strukturell verhindern — relativ, selbstkalibrierend.

## 7.1–7.7 (Kurzverweis)

Nike-Problem (Level vs Delta) · Designprinzipien · pricingPower · relativeMomentum · gates/Veto · trendMultiplier · Catalyst · Porter-Delta · ExtractedFact · buildVerdict

Vollständige Code-Blöcke bleiben in dieser Datei unter den jeweiligen Unterabschnitten der Vorgängerversion / Git-History. Fokus hier: **7.8 Gold-Dashboard-Erweiterung**.

---

## 7.8 Gold-Dashboard: Minenkosten, Makro-Treiber & Chart Gold vs. Kapitalmarkt/Zinsen

> **Nur Dokumentation.** Analog zu BTC Section 13 Miner (WORK_TEIL0-6 §6.4).  
> Unterschied zu BTC: Bei Gold dominieren **Realzinsen** (Nachfrage/Opportunitätskosten);  
> Minenkosten markieren einen **langfristigen Angebotsboden** (Monate–Jahre Reaktionszeit).  
> Bei BTC reagiert Hashrate in Tagen/Wochen.

### 7.8.1 Minenkosten-Indikatoren (Angebotsseite ≈ BTC-Hashprice/Breakeven)

| # | Indikator | Bedeutung | Kapitulation / Druck | Entspannung |
|---|-----------|-----------|----------------------|-------------|
| 1 | **AISC** (All-In Sustaining Cost, World Gold Council) | Förderkosten + Exploration-CAPEX + G&A + Sustaining pro oz | Spot ≤ AISC (~$1.200–1.400/oz typisch) → Minen unrentabel | Spot ≫ AISC |
| 2 | **Cash Cost (C1) vs All-In Cost (C3)** | C1 = Produktion; C3 = inkl. Kapitalkosten/Abschreibung | Hochkosten-Minen (rechtes Ende der Kurve) schließen zuerst | C1-Minen bleiben online |
| 3 | **Gold Miners' Cost Curve** (CRU, Metals Focus, S&P) | Ranking globaler Minen nach $/oz — S-Kurve | Marginale Mine bestimmt Angebotsboden | Kurve verschiebt sich mit Kosteninflation |
| 4 | **GDX/GLD-Ratio** | Miner-Aktien vs. physisches Gold | Ratio fällt → Margendruck (Miner gehebelt auf Goldpreis) | Ratio steigt → operative Erholung |
| 5 | **P/NAV der Miner** | Reserven abdiskontiert mit Long-Term-Goldpreis-Annahme | Spot ≪ NAV-Annahme → Reserven-Abschreibung | Spot stützt NAV |

**Analogie BTC:** AISC/C3 ≈ Mining Breakeven; Cost Curve ≈ Hashrate-Flotte nach Effizienz; GDX/GLD ≈ Hashprice vs. Spot-Stress.

### 7.8.2 Makro-Indikatoren (Nachfrageseite / antizyklisch)

| # | Indikator | Quelle / Formel | Wirkung auf Gold |
|---|-----------|-----------------|------------------|
| 6 | **Real Yield 10Y** | DFII10 (FRED) oder DGS10 − T10YIE | **Dominant inverse** Korrelation |
| 7 | **Gold-Fair-Value vs Realzins** | Regression Gold ~ Realzins (+ optional DXY, Fed-Bilanz) | Über-/Unterbewertung vs. Modell |
| 8 | **US-Dollar-Index (DXY)** | ICE / FRED DTWEXBGS | Starker USD → Druck auf Gold |
| 9 | **Realer Leitzins** | Fed Funds − Inflation (YoY CPI) | Kurzfristige Policy-Straffung |
| 10 | **Gold/Silber-Ratio** | XAU/XAG | Steigt in Risiko-Off / Rezessionsangst |
| 11 | **Zentralbank-Nettokäufe** | World Gold Council Quarterly | Strukturelle Nachfrage, oft antizyklisch |
| 12 | **Gold vs 10Y Treasury Total Return** | Relative Performance | Asset-Rotation Indikator |

### 7.8.3 Kernkonzept Chart: Gold vs. Kapitalmarkt / Zinsen (inverse Beziehung)

**Warum plotten?**  
Gold trägt keinen Coupon. Steigende Realzinsen erhöhen die Opportunitätskosten → Gold unter Druck. Fallende Realzinsen / expansive Policy → Gold attraktiver. Das ist das etablierte Anti-Zyklus-Muster (Katusa/Bloomberg „Gold reconnecting with yields“).

**Chart-Layout (analog BTC-TA / Miner-Chart):**

```
┌──────────────────────────────────────────────────────────────┐
│  HAUPTPANEL (dual axis)                                      │
│  · Gold Spot $/oz          (gelb, linke Achse)               │
│  · Real 10Y Yield %        (blau, rechte Achse, optional     │
│    invertiert skaliert, damit Inverse optisch klar wird)     │
│  · Nominal 10Y (DGS10)     (grau, gestrichelt, rechte Achse) │
│  · Optional: Fed Funds     (violett, rechte Achse)           │
│                                                              │
│  Zonen:                                                      │
│  ████ rot  = Real Yield rising + Gold falling (Stress)       │
│  ▓▓▓▓ grün = Real Yield falling + Gold rising (Tailwind)     │
│  Marker    = Decoupling-Phasen (Korrelation > −0.2)           │
├──────────────────────────────────────────────────────────────┤
│  PANEL 2: AISC-Band (horizontal) + Spot                      │
│           Spot unter AISC = Angebots-Kapitulationsdruck      │
│  PANEL 3: GDX/GLD Ratio                                      │
│  PANEL 4: DXY (inverse Schattierung optional)                │
└──────────────────────────────────────────────────────────────┘
```

**Recharts-Skizze (Dokumentation):**

```tsx
<ComposedChart data={goldMacroSeries}>
  {/* Stress-Zonen: Realzins steigt, Gold fällt */}
  {stressZones.map(z => (
    <ReferenceArea key={z.start} x1={z.start} x2={z.end}
      fill="#ef4444" fillOpacity={0.12} />
  ))}
  {/* Tailwind-Zonen: Realzins fällt, Gold steigt */}
  {tailwindZones.map(z => (
    <ReferenceArea key={z.start} x1={z.start} x2={z.end}
      fill="#22c55e" fillOpacity={0.10} />
  ))}

  <Line yAxisId="left"  dataKey="gold"     stroke="#F5A623" dot={false} name="Gold $/oz" />
  <Line yAxisId="right" dataKey="real10Y"  stroke="#3b82f6" dot={false} name="Real 10Y %" />
  <Line yAxisId="right" dataKey="nominal10Y" stroke="#94a3b8" strokeDasharray="4 4"
        dot={false} name="Nominal 10Y" />

  {/* AISC als horizontale Band-Linie */}
  <ReferenceLine yAxisId="left" y={aiscUsd} stroke="#f97316" strokeDasharray="6 3"
                 label="AISC" />

  <YAxis yAxisId="left"  domain={['auto','auto']} orientation="left" />
  <YAxis yAxisId="right" domain={['auto','auto']} orientation="right" reversed={false} />
  {/* Hinweis: für optische Inverse kann right axis reversed werden */}
  <XAxis dataKey="date" />
  <Tooltip />
  <Legend />
</ComposedChart>
```

### 7.8.4 Code-Logik (Dokumentation — `client/src/lib/goldMacro.ts`)

```ts
export interface GoldMacroPoint {
  date: string;
  gold: number;          // $/oz
  nominal10Y: number;    // DGS10
  real10Y: number;       // DFII10
  breakeven10Y: number;  // T10YIE
  dxy?: number;
  fedFunds?: number;
  aiscUsd?: number;      // Branchen-AISC oder geschätzt
  gdxGldRatio?: number;
}

export interface GoldRegimeZone {
  start: string;
  end: string;
  type: 'stress' | 'tailwind' | 'decoupling';
  reason: string;
}

/** Rolling Pearson: Gold-Returns vs Δ Real Yield — stark negativ = intakt */
export function goldRealYieldInverseScore(
  series: { gold: number; real10Y: number }[],
  window = 60
): { score: number; correlation: number; flags: string[] } {
  if (series.length < window)
    return { score: 50, correlation: 0, flags: ['INSUFFICIENT_DATA'] };

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
  // correlation ≈ -0.7 → score ≈ 85 (starke Inverse)
  const score = Math.round(50 - 50 * Math.tanh(correlation * 2));
  const flags: string[] = [];
  if (correlation > -0.2) flags.push('DECOUPLING: Inverse geschwächt');
  if (correlation < -0.5) flags.push('STRONG_INVERSE: klassische Relation intakt');
  return { score, correlation, flags };
}

/** Zonen: Stress (Zinsen↑ Gold↓) vs Tailwind (Zinsen↓ Gold↑) */
export function deriveGoldRegimeZones(
  points: GoldMacroPoint[],
  lookback = 20
): GoldRegimeZone[] {
  const zones: GoldRegimeZone[] = [];
  let cur: { type: GoldRegimeZone['type']; start: number; reason: string } | null = null;

  for (let i = lookback; i < points.length; i++) {
    const g0 = points[i - lookback].gold, g1 = points[i].gold;
    const r0 = points[i - lookback].real10Y, r1 = points[i].real10Y;
    const goldUp = g1 > g0 * 1.02;
    const goldDn = g1 < g0 * 0.98;
    const realUp = r1 > r0 + 0.15; // +15 bp
    const realDn = r1 < r0 - 0.15;

    let type: GoldRegimeZone['type'] | null = null;
    let reason = '';
    if (realUp && goldDn) {
      type = 'stress';
      reason = 'Realzins steigend, Gold fallend — Opportunitätskosten-Druck';
    } else if (realDn && goldUp) {
      type = 'tailwind';
      reason = 'Realzins fallend, Gold steigend — klassischer Tailwind';
    }

    // AISC-Kapitulationsdruck als zusätzlicher Stress-Grund
    if (points[i].aiscUsd != null && points[i].gold < points[i].aiscUsd!) {
      type = type ?? 'stress';
      reason = (reason ? reason + ' · ' : '') + 'Spot unter AISC';
    }

    if (type && (!cur || cur.type !== type)) {
      if (cur) {
        zones.push({
          start: points[cur.start].date,
          end: points[i - 1].date,
          type: cur.type,
          reason: cur.reason,
        });
      }
      cur = { type, start: i, reason };
    } else if (!type && cur) {
      zones.push({
        start: points[cur.start].date,
        end: points[i - 1].date,
        type: cur.type,
        reason: cur.reason,
      });
      cur = null;
    }
  }
  if (cur) {
    zones.push({
      start: points[cur.start].date,
      end: points[points.length - 1].date,
      type: cur.type,
      reason: cur.reason,
    });
  }
  return zones;
}

/** Einfaches Fair-Value aus linearer Regression Gold ~ Realzins (rolling) */
export function goldFairValueFromRealYield(
  gold: number[],
  real10Y: number[],
  window = 252
): (number | null)[] {
  // OLS: gold = a + b * real10Y  auf rolling window; Fair Value = a + b * current real
  return gold.map((_, i) => {
    if (i < window - 1) return null;
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
    if (den === 0) return null;
    const b = num / den;
    const a = my - b * mx;
    return a + b * real10Y[i];
  });
}
```

### 7.8.5 Gate-Anbindung (Makro)

```ts
gates.push({
  id: 'GOLD_REAL_YIELD_REGIME',
  active: inverseScore.correlation > -0.25, // Decoupling
  cap: 75,
  severity: 'warn',
  rationale: 'Gold und Real Yields entkoppelt — Regime-Wechsel oder struktureller Bid möglich',
});

// Optional: Angebotsdruck
gates.push({
  id: 'GOLD_AISC_STRESS',
  active: spot < aiscUsd,
  cap: 80,
  severity: 'warn',
  rationale: 'Gold Spot unter Branchen-AISC — marginale Minen unter Druck',
});
```

### 7.8.6 Datenquellen

| Serie | Quelle |
|-------|--------|
| Gold Spot | FMP commodities / Yahoo / Metals API |
| DGS10, DFII10, T10YIE | FRED |
| Fed Funds | FRED FEDFUNDS |
| DXY | FRED DTWEXBGS / ICE |
| AISC | World Gold Council Reports (quartalsweise, manuell/LLM) |
| GDX, GLD | FMP / Yahoo |
| Zentralbank-Käufe | WGC Quarterly |

### 7.8.7 Umsetzungsschritte (wenn implementiert)

```
[ ] client/src/lib/goldMacro.ts — inverseScore, deriveGoldRegimeZones, fairValueFromRealYield
[ ] Gold-Dashboard / Researcher Macro-Tab: dual-axis Chart Gold vs Real10Y (+ Nominal)
[ ] ReferenceArea stress (rot) / tailwind (grün)
[ ] AISC ReferenceLine + GDX/GLD Panel
[ ] FRED-Anbindung (bereits in WORK2 §8.12 MacroSnapshot)
[ ] Kein Hardcoding — Serien aus API/Cache
```

---

## 7.9 Nächste Schritte (gesamt TEIL 7)

- [ ] PricingPower + RelativeMomentum als Lib
- [ ] Gates multiplikativ in Verdict-Pipeline
- [ ] **Gold-Dashboard Chart** (7.8) im Researcher / eigenem Tab
- [ ] LLM ASP/Volume/Discount aus Earnings Calls
- [ ] Keine Hardcoded-Ticker — relativ / z-score / Perzentil

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
