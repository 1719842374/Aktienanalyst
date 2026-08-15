# WORK_PORTFOLIO.md — Virtuelles Portfolio

> Stand: 15.08.2026 | Spec + **Implementierung client-side**  
> Buy-Liste · Gewichtungsmodi · **Sharpe (vertieft)** · **Kelly (Anwendungsregeln)** · Kapital
>
> **Code:** `client/src/lib/portfolio/*` · UI: `/portfolio` · Tests: `script/test-portfolio-*.ts`

---

# Kapitel A — Zielbild & Architektur

## A.1 Produktidee

```
Researcher + Manual Analyse
        → Buy-Liste (verifizierte attraktive Titel)
        → Virtuelles Portfolio
              ├── Gewichtungsmodus A/B/C (Basket)
              ├── Sharpe-Kennzahlen (Messung)
              └── Kelly (separat, Einzeltitel-Sizing)
        → Input Kapital K → Soll-€ / Stück
```

| Baustein | Frage |
| --- | --- |
| Buy-Liste | Welche Titel sind aktiv? |
| Modus A/B/C | Wie im **Basket** gewichten? |
| Sharpe | Wie gut ist die gewählte Allokation risikoadjustiert? |
| Kelly | Wie groß **eine** Position maximal/sinnvoll? |
| Kapital K | Konkrete €-Beträge |

**Trennlinie:** Kelly ersetzt die Basket-Gewichtung nicht. Sharpe steuert die Gewichte nicht allein — er **misst** sie.

## A.2 Datenmodell (Kern)

```ts
PortfolioCandidate  // ticker, score, conviction, mu?, beta?, price, status, source
VirtualPortfolio    // candidates[], benchmark, rf, capitalBase
BasketResult        // mode, rows[], sharpePortfolio, sharpeEqualWeight
KellySizing         // fStar, fHalf, fCapped, amount
```

→ `shared/schema.ts` (additive Interfaces).

## A.3 Intake Buy-Liste

```
Auto: score ≥ scoreMin ∧ kein hard Gate ∧ conflicts ∈ {leer, warn}
Manual: include / conviction override
source: researcher | manual | both
```

→ `pipeline.intakeFilter` (scoreMin=65); Live-UI nutzt manuelle Positions (`positions.ts`).

---

# Kapitel B — Gewichtungsalgorithmen (Basket)

## B.1 Drei Modi

| Modus | Kern | Wann |
| --- | --- | --- |
| **A Max-Sharpe long-only** | \(w \propto \Sigma^{-1}\tilde\mu\), clip, renorm, cap | n≥3, Σ stabil, μ ok |
| **B Risk-Parity** | \(w_i \propto 1/\sigma_i\) | μ schwach / Σ instabil / n klein |
| **C Score-Tilt** | Basis Equal/RP × (1+κ z(score)) | Brücke Scoring → Portfolio |

→ `weighting.ts`: `weightMaxSharpe`, `weightRiskParity`, `weightScoreTilt`, `allocate`.

## B.2 Guards

long-only · Σ w=1 · maxWeight≈0.30 · optional minWeight · Shrinkage bei kleiner n · n=1 → kein Basket, nur Kelly

## B.3 Auto-Mode

```
n < 2        → Kelly only
n < 3 oder μ low oder Σ instabil → Risk-Parity
μ high + Σ stabil → Max-Sharpe
sonst → Score-Tilt
```

→ `pickWeightMode` + Tests in `test-portfolio-weighting.ts`.

---

# Kapitel C — Sharpe-Ratio (Implementierung vertieft)

## C.1–C.2 API

Wortgetreu in `client/src/lib/portfolio/sharpe.ts`:
`portfolioVariance`, `portfolioVol`, `portfolioMean`, `sharpeRatio`, `sharpeReport`.

## C.3 Annualisierung

Daily → μ×252, Σ×252 in `covariance.ts`; Sharpe **nicht** nochmal ×√252.

## C.4 Numerische Stabilität

Σ-Symmetrie / Ridge / Shrinkage in `covariance.ts` + `weighting.shrinkCovariance`; vol&lt;1e-12 → Sharpe null.

## C.6 Test-Vektoren

`script/test-portfolio-sharpe.ts` — alle 5 Vektoren + sharpeReport-Konsistenz: **grün**.

---

# Kapitel D — Kelly-Kriterium (Anwendung geprüft)

## D.1–D.6

`client/src/lib/portfolio/kelly.ts`:
`kellyContinuous`, `kellyDiscrete`, `applyKellyPolicy` (Half + maxF=0.25), `sizeKellySingle`.

UI: beide Spalten (Basket-w% und Kelly-€), kein stummes max(w,f).

## D.7 Test-Vektoren

`script/test-portfolio-kelly.ts` — alle 5 Vektoren + sizeKellySingle: **grün**.

---

# Kapitel E — Kapital, UI, Pipeline

## E.1 Kapital K

| Spalte | Formel |
| --- | --- |
| Basket-€ | w_i × K |
| Kelly-€ | f_capped × K |
| Stück | € / price |

## E.2 UI

`/portfolio` → Übersicht · Investments · Policy (K, rf, maxWeight, Kelly) · Optimierung (Sharpe_p / Equal / Δ + Tabelle) · Disclaimer CAPM≠Kelly, keine Orders.

## E.3 Pipeline

1 Intake → 2 μ/Σ → 3 allocate → 4 sharpeReport → 5 Kelly → 6 ×K  
Live: `engine.computePortfolioFromPositions` · Alt: `runPortfolioPipeline`.

---

# Kapitel F — Defaults & Checkliste

## F.1 Defaults

| Parameter | Wert | Code |
| --- | --- | --- |
| maxWeight | 0.30 | `DEFAULT_MAX_WEIGHT` |
| Kelly fraction | 0.5 | `applyKellyPolicy` |
| Kelly maxF | 0.25 | `applyKellyPolicy` |
| Σ-Fenster | 252 | `covariance` / `DEFAULTS.sigmaWindowDays` |
| scoreMin | 65 | `DEFAULTS.scoreMin` |
| κ Score-Tilt | 0.35 | `DEFAULT_KAPPA_SCORE_TILT` |
| Sharpe-Floor vol | 1e-12 | `sharpeRatio` |

## F.2 Umsetzung

```
[x] Kapitel-C API: sharpeRatio, sharpeReport, Annualisierung, Shrinkage
    → client/src/lib/portfolio/sharpe.ts + covariance.ts + weighting.shrinkCovariance
    → Tests: script/test-portfolio-sharpe.ts (C.6 alle 5 Vektoren + sharpeReport)
[x] Kapitel-D API: kellyContinuous/Discrete, applyKellyPolicy, sizeKellySingle
    → client/src/lib/portfolio/kelly.ts
    → Tests: script/test-portfolio-kelly.ts (D.7 alle 5 Vektoren + sizeKellySingle)
[x] Tests C.6 und D.7
    → test-portfolio-sharpe.ts, test-portfolio-kelly.ts — grün (15.08.2026)
[x] Modi A/B/C + pickWeightMode
    → client/src/lib/portfolio/weighting.ts
    → Tests: script/test-portfolio-weighting.ts
[x] UI-Kennzahlen + Zwei-Spalten-€ (Basket vs Kelly)
    → PortfolioPage.tsx + PortfolioOptimizationPanel.tsx + PortfolioOverview.tsx
    → Route: /portfolio
[x] n=1-Pfad ohne Basket-Optimierer
    → pickWeightMode → "kelly-only"; allocate weights=[1]
```

**Status 15.08.2026:** Kern-Spec (A–F) ist im Client implementiert und unit-getestet.
Live-Pfad: `positions` (manual) → `engine.computePortfolioFromPositions` → UI.
Optionaler Kandidaten-Pfad: `pipeline.intakeFilter` + `runPortfolioPipeline`.

**Regel:** Design-Dokumentation. Änderungen an Formeln nur additiv + Tests grün halten.
