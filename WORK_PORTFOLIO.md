# WORK_PORTFOLIO.md — Virtuelles Portfolio (Buy-Basket · CAPM · Kelly · Sharpe)

> Stand: 28.07.2026 | Nur Dokumentation  
> Buy-Liste → virtuelles Portfolio → **CAPM-Gewichte** + **separates Kelly** + **Sharpe**  
> + überarbeitete **Gewichtungsalgorithmen** (Max-Sharpe / Risk-Parity / Score-Tilt).

---

## 1. Produktidee

```
Researcher-Tab  ──┐
                  ├──► verifizierter Buy ──► Buy-Liste
Manuelle Analyse ─┘                              │
                                                 ▼
                                   Virtuelles Portfolio
                                   ├── Gewichtungs-Modus A/B/C
                                   ├── Sharpe (Basket vs Equal)
                                   └── Kelly % (Einzeltitel)
                                                 │
                                   Input Kapital K → € / Stück
```

| Baustein | Rolle |
| --- | --- |
| Buy-Liste | Researcher + Manual → aktive Kandidaten |
| Gewichtung A/B/C | Diversifikation im Basket |
| Sharpe | Qualität der gewählten Allokation messen |
| Kelly | separat: %-Anteil **einer** Aktie |
| Kapital K | `w×K` bzw. `f×K` |

Kelly ersetzt CAPM/Gewichtung **nicht**.

---

## 2. Intake Buy-Liste

```
score >= scoreMin  UND  kein hard Gate  UND  (conflicts leer|warn)
optional: technicalRegime != breakdown
```

Manuell: `include`, `conviction`.  
Types: `PortfolioCandidate`, `VirtualPortfolio` (ticker, score, beta, mu, price, capitalBase, …).

---

## 3. Sharpe-Ratio — Berechnung

### 3.1 Definition (ex ante, Allokations-Sharpe)

Portfolio-Überschussrendite und -Volatilität aus denselben Inputs wie die Gewichtung:

$$
\mu_p = w^\top \mu, \quad
\tilde\mu_p = \mu_p - r_f = w^\top \tilde\mu, \quad
\sigma_p = \sqrt{w^\top \Sigma w}
$$

$$
\mathrm{Sharpe}_p = \frac{\mu_p - r_f}{\sigma_p} = \frac{w^\top \tilde\mu}{\sqrt{w^\top \Sigma w}}
$$

- \(w\): Gewichtsvektor, \(\sum w_i = 1\), long-only  
- \(\mu\): erwartete Renditen p.a. (CAPM oder Research-μ̂)  
- \(\Sigma\): Kovarianzmatrix annualisiert  
- \(r_f\): risikofreier Satz p.a.

**Einzeltitel-Sharpe** (Vergleichsspalte):

$$
\mathrm{Sharpe}_i = \frac{\mu_i - r_f}{\sigma_i}, \quad \sigma_i = \sqrt{\Sigma_{ii}}
$$

### 3.2 Was die UI ausweist

| Metrik | Bedeutung |
| --- | --- |
| `sharpePortfolio` | Sharpe der **aktuellen** Basket-Gewichte |
| `sharpeEqualWeight` | gleiche Titel, \(w_i = 1/n\) — Referenz |
| `sharpeSingle[i]` | CAPM-/Research-Sharpe je Titel |
| Δ vs Equal | `sharpePortfolio - sharpeEqualWeight` (Optimierer-Nutzen) |

Kein absolutes „gutes Sharpe“-Label ohne Benchmark-Kontext.

### 3.3 Code-Kern (Dokumentation)

```ts
export function portfolioVol(w: number[], Sigma: number[][]): number {
  // σ_p = sqrt(w' Σ w)
  let s = 0;
  for (let i = 0; i < w.length; i++)
    for (let j = 0; j < w.length; j++)
      s += w[i] * Sigma[i][j] * w[j];
  return Math.sqrt(Math.max(s, 0));
}

export function portfolioExcess(w: number[], mu: number[], rf: number): number {
  let m = 0;
  for (let i = 0; i < w.length; i++) m += w[i] * mu[i];
  return m - rf;
}

export function sharpeRatio(w: number[], mu: number[], Sigma: number[][], rf: number): number | null {
  const vol = portfolioVol(w, Sigma);
  if (vol < 1e-12) return null;
  return portfolioExcess(w, mu, rf) / vol;
}

export function equalWeight(n: number): number[] {
  return Array(n).fill(1 / n);
}
```

### 3.4 Annualisierung (wenn Returns daily)

```
mu_ann   = mu_daily * 252
Sigma_ann = Sigma_daily * 252
Sharpe aus annualisierten Größen (nicht zusätzlich * sqrt(252) auf den Sharpe)
```

### 3.5 Edge Cases

| Fall | Handling |
| --- | --- |
| σ_p ≈ 0 | Sharpe = null |
| n = 1 | nur Single-Sharpe + Kelly, kein Basket-Sharpe-Vergleich nötig |
| μ alle ≈ rf | Sharpe ≈ 0; Gewichtung eher Risk-Parity |
| Σ nicht SPD | Shrinkage / Ridge bevor Sharpe/Optimierer |

---

## 4. Gewichtungsalgorithmen (überarbeitet)

Drei Modi + Guards. Kelly bleibt **außerhalb** dieser Basket-Logik.

### 4.1 Modus A — Max-Sharpe long-only (Default)

Unconstrained Tangency-Richtung, dann Projektion:

$$
w^{\text{raw}} \propto \Sigma^{-1} \tilde\mu
$$

1. Negative Gewichte → 0  
2. Renormalisieren auf Summe 1  
3. **maxWeight**-Cap (z. B. 0.30): Überschuss proportional auf Rest verteilen, iterieren  

Äquivalent Ziel (wenn Solver vorhanden):

$$
\max_w \frac{w^\top \tilde\mu}{\sqrt{w^\top \Sigma w}}
\quad\text{s.t.}\quad w \ge 0,\; \sum w_i = 1,\; w_i \le w_{\max}
$$

**Wann:** n ≥ 3, Σ stabil, μ-Qualität medium/high.

### 4.2 Modus B — Risk-Parity (inverse Volatilität)

$$
w_i \propto \frac{1}{\sigma_i}, \quad \sigma_i = \sqrt{\Sigma_{ii}}
$$

Danach renorm + maxWeight-Cap.  
**Wann:** μ unsicher, n klein (2–4), Σ schlecht konditioniert — **Fallback**.

### 4.3 Modus C — Score-Tilt

1. Basis: Equal-Weight **oder** Risk-Parity  
2. Tilt mit normalisiertem Score / Conviction:

$$
w_i \propto w_i^{\text{base}} \cdot \bigl(1 + \kappa \cdot z(\mathrm{score}_i)\bigr)
$$

- \(z\) = z-Score der Scores im Basket  
- \(\kappa\) klein (z. B. 0.25–0.5), UI-Slider  
- wieder renorm + maxWeight  

**Wann:** Brücke Scoring → Portfolio, ohne aggressives Return-Forecasting.

### 4.4 Auto-Wahl des Modus

```ts
export type WeightMode = 'max_sharpe' | 'risk_parity' | 'score_tilt';

export function pickWeightMode(opts: {
  n: number;
  muQuality: 'low' | 'medium' | 'high';
  sigmaStable: boolean;       // z.B. cond(Σ) unter Schwelle, Shrinkage ok
}): WeightMode {
  if (opts.n < 2) throw new Error('use Kelly only');
  if (opts.n < 3 || !opts.sigmaStable || opts.muQuality === 'low')
    return 'risk_parity';
  if (opts.muQuality === 'high' && opts.sigmaStable)
    return 'max_sharpe';
  return 'score_tilt';       // mittlerer Weg
}
```

### 4.5 Guards (gelten für A/B/C)

```
[ ] long-only (w_i >= 0)
[ ] sum w = 1
[ ] maxWeight z.B. 0.25–0.35
[ ] minWeight 0 oder 0.05 (sonst Streich-Kandidat)
[ ] Ledoit-Wolf / Ridge auf Σ wenn n klein oder Fenster kurz
[ ] n == 1 → kein Basket-Modus, nur Kelly
[ ] nach Cap: Renorm, bis Constraints erfüllt (max Iterationen)
```

### 4.6 Code-Skizzen

```ts
export function allocateMaxSharpeLongOnly(opts: {
  mu: number[];
  Sigma: number[][];
  rf: number;
  maxWeight?: number; // default 0.30
}): number[] { /* Σ^{-1} μ̃ → clip → renorm → cap loop */ }

export function allocateRiskParity(opts: {
  Sigma: number[][];
  maxWeight?: number;
}): number[] { /* 1/σ_i → renorm → cap */ }

export function allocateScoreTilt(opts: {
  scores: number[];
  baseWeights: number[];
  kappa?: number;      // default 0.35
  maxWeight?: number;
}): number[] { /* base * (1+κ z(score)) → renorm → cap */ }

export function applyMaxWeight(w: number[], maxW: number): number[] {
  // iterative: cap, redistribute excess to uncapped names
}
```

### 4.7 Output-Zeile je Titel

```ts
export interface BasketAllocationRow {
  ticker: string;
  mode: WeightMode;
  weight: number;
  amount: number;          // weight * K
  sharesHint: number;
  mu: number;
  sigma: number;
  sharpeSingle: number | null;
}

export interface BasketResult {
  mode: WeightMode;
  rows: BasketAllocationRow[];
  sharpePortfolio: number | null;
  sharpeEqualWeight: number | null;
  capitalBase: number;
}
```

---

## 5. Kelly — separat (unverändert im Zweck)

$$
f^* = \frac{\mu - r_f}{\sigma^2} \quad\text{(continuous)}, \quad
f_{\text{half}} = \tfrac12 f^*, \quad
f \le f_{\max}\ (\text{default } 0.25)
$$

Nur **ein** Ticker; nicht über den Basket summieren.  
UI: Full / Half / Capped + € bei Kapital K.

---

## 6. Kapital-Input

| Methode | Formel |
| --- | --- |
| Basket (A/B/C) | \(w_i \times K\) — Summe = K |
| Kelly | \(f^{\text{capped}}_j \times K\) — nur Titel j |

Tabelle: Ticker | Score | Mode-w | € | Kelly-% | Kelly-€ | Stück.

---

## 7. Pipeline

```
Scoring/Gates → Buy-Liste
    → schätze μ, Σ, β, rf
    → pickWeightMode
    → allocate (A|B|C) + applyMaxWeight
    → sharpePortfolio / sharpeEqualWeight
    → optional sizeKellySingle(ticker)
    → × Kapital K
```

---

## 8. Defaults

| Parameter | Default |
| --- | --- |
| maxWeight | 0.30 |
| Σ-Fenster | 252 Tage |
| Shrinkage | an bei n < 8 oder cond hoch |
| Kelly fraction | 0.5 (Half) |
| Kelly maxF | 0.25 |
| scoreMin Intake | 65 |
| κ Score-Tilt | 0.35 |
| Benchmark | SPY (wählbar) |

Historie > 5Y: siehe [WORK_DATA_PROVIDERS.md](./WORK_DATA_PROVIDERS.md).

---

## 9. UI-Skizze

```
Kapital K | Benchmark | Mode: Auto|Max-Sharpe|Risk-Parity|Score-Tilt
Max-Gewicht | Kelly: Half

Sharpe Basket: x.xx  |  Equal-Weight: y.yy  |  Δ: …

Ticker  Score  w%  €  Sharpe_i  Kelly-Half%  Kelly-€
…
```

Disclaimer: CAPM/Sharpe = Basket-Diversifikation; Kelly = Einzeltitel; keine Order-Ausführung.

---

## 10. Checkliste

```
[ ] sharpeRatio / portfolioVol / equalWeight
[ ] allocateMaxSharpeLongOnly + applyMaxWeight
[ ] allocateRiskParity
[ ] allocateScoreTilt
[ ] pickWeightMode
[ ] sizeKellySingle (half + cap)
[ ] Intake Researcher + Manual
[ ] Σ-Schätzung + Shrinkage
[ ] UI Sharpe Basket vs Equal + Kapital-Tabelle
```

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
