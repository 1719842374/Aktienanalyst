# WORK_RESEARCHER_PORTFOLIO — Teil 2 (Kapitel J–Q)

> Fortsetzung von `WORK_RESEARCHER_PORTFOLIO.md`  
> Zahlen, Daten, Fakten: File-Map, Kapitalgewichtung, Risiko, Shrinkage, Frontier, Ist-Gewichte

# Kapitel J — File-Map, Routing & Kommunikation (verbindlich)

## J.1 Abhängigkeitsgraph (Client)

```
PortfolioPage.tsx
├── positions.ts          load/save localStorage, makePosition, handleAddPosition
├── engine.ts             computePortfolioFromPositions()  ← EIN Rechenblock
│   ├── covariance.ts     buildCovariance() → μ, σ, Σ, Ridge
│   ├── winsorize.ts      winsorizeMuArray() auf historische μ
│   ├── weighting.ts      allocate / pickWeightMode / shrinkCovariance / maxWeight
│   ├── sharpe.ts         sharpeReport
│   ├── kelly.ts          kellyContinuous + applyKellyPolicy
│   └── concentration.ts  HHI, Effective-N, Korrelations-Warnungen
├── PortfolioOverview.tsx     KPI + Pie (Ziel-Gewicht CAPM) + Performance-Chart
├── PortfolioInvestmentsTable.tsx
└── PortfolioOptimizationPanel.tsx  ruft ebenfalls computePortfolioFromPositions

Daten-Zufluss Kurse/Historie:
  PortfolioPage.fetchAnalysisForTicker
    → POST /api/analyze  { ticker, useLLM: false, force }
    → server/analyze-route.ts → FMP OHLCV + Fundamentals
    → analysisByTicker[ticker].currentPrice / historicalPrices
    → engine + positions entryPrice-Nachzug
```

## J.2 Server-Routen

| Route | Datei | Rolle |
|-------|-------|-------|
| `POST /api/analyze` | `server/analyze-route.ts` | Preis + Historie + Score-Cache |
| `GET /api/watchlist` | Dashboard „Zuletzt analysiert“ | **nicht** kuratierte Watchlist |
| Researcher-Routen | `server/researcher.ts` | candidates / beneficiaries / affectedTickers |

## J.3 Storage-Keys

| Key | Inhalt |
|-----|--------|
| `aktienanalyst_portfolio_positions_v1` | `PortfolioPosition[]` |
| `aktienanalyst_portfolio_policy_v1` | Policy (K, rf, maxWeight) |
| `aktienanalyst_watchlist_v1` | `WatchlistEntry[]` (NEU) |

## J.4 Konstanten (Single Source of Truth)

| Konstante | Datei | Wert |
|-----------|-------|------|
| `DEFAULT_MAX_WEIGHT` | weighting.ts | **0,30** |
| `DEFAULT_KAPPA_SCORE_TILT` | weighting.ts | **0,35** |
| `DEFAULT_MU_WINSORIZE_MIN/MAX` | winsorize.ts | **−0,20 / +0,40** |
| `TRADING_DAYS_PER_YEAR` | covariance.ts | **252** |
| `MIN_OBSERVATIONS` | covariance.ts | **60** |
| `RIDGE_KAPPA` | covariance.ts | **1e−3** |
| Kelly fraction / maxF | kelly.ts | **0,5 / 0,25** |
| `MIN_POSITIONS_FOR_OPTIMIZATION` | engine.ts | **2** |
| `EFFECTIVE_N_WARNING_RATIO` | concentration.ts | **0,6** |
| `AVG_CORRELATION_WARNING` | concentration.ts | **0,7** |
| `MAX_CORRELATION_WARNING` | concentration.ts | **0,9** |

---

# Kapitel K — Kapitalgewichtungslogik (Zahlen, Daten, Fakten)

## K.1 Rechenpipeline

```
Positionen (qty × Kurs)
    → Ist-Marktwert-Gewichte weightMarket
    → μ, σ, Σ aus Historie (252 Tage) + Overrides
    → μ-Winsorize nur historical
    → pickWeightMode → A | B | C
    → Ziel-Gewichte weightCapm (Σw = 1)
    → × Kapital K → basketAmount
    → parallel: Kelly pro Einzeltitel (NICHT Basket-Gewicht)
```

Einstieg: `computePortfolioFromPositions()` in `engine.ts`.

## K.2 Drei Modi

**A Max-Sharpe:** \(\tilde\mu = \mu - r_f,\; w \propto \Sigma^{-1}\tilde\mu\) → clip → renorm → maxWeight-Cap  
**B Risk-Parity:** \(w_i \propto 1/\sigma_i\)  
**C Score-Tilt:** \(w_i = w_i^{Basis} \cdot (1 + \kappa \cdot z(score_i)),\; \kappa=0{,}35\)

## K.3 pickWeightMode

| Bedingung | Modus |
|-----------|-------|
| n < 2 | kelly-only |
| n < 3 ∨ μ schwach ∨ Σ instabil | **B** |
| μ stark ∧ Σ stabil | **A** |
| sonst | **C** |

μ schwach: mittlerer Excess **< 2 % p.a.** oder **< 50 %** der Titel mit positivem Excess.

## K.4 maxWeight — Zahlen aus Code

| n | suggestedMaxWeightDefault(n) | Floor 1/n |
|---|------------------------------|-----------|
| 2 | **60 %** | 50 % |
| 3 | **60 %** | ≈ 33 % |
| 4 | **40 %** | 25 % |
| ≥ 5 | **30 %** | ≤ 20 % |

## K.5 Live-Portfolio 14.08.2026 (MSFT, NVDA, NVO, LLY)

**n = 4.** Pie Ziel CAPM: **MSFT 30 % · NVDA 30 % · LLY 30 % · NVO 10 %**  
Cap 30 % erfüllbar (0,30×4 = 1,20 ≥ 1). Drei Titel am Cap, Residual → NVO.

| Ticker | w_CAPM | Basket-€ bei K=100.000 |
|--------|--------|------------------------|
| MSFT | 0,30 | 30.000 € |
| NVDA | 0,30 | 30.000 € |
| LLY | 0,30 | 30.000 € |
| NVO | 0,10 | 10.000 € |

## K.6 Kelly

\(f^* = (\mu-r_f)/\sigma^2,\; f_{Half}=0{,}5\,f^*,\; f_{Capped}=\min(f_{Half},0{,}25)\)

Beispiel μ=0,12, rf=0,03, σ=0,20 → f*=2,25 → Half=1,125 → **Capped=0,25** → bei K=100.000: **25.000 €** max pro Titel.

---

# Kapitel L — Risikomanagement

| Mechanismus | Parameter | Datei |
|-------------|-----------|-------|
| long-only | w≥0 | weighting.ts |
| maxWeight-Cap | Default 0,30; n=4 suggested 0,40 | weighting.ts |
| Half-Kelly + Cap | 0,5 · max 0,25 | kelly.ts |
| Diagonal-Shrinkage | δ siehe M | weighting.ts |
| Ridge auf Σ | κ=1e−3 · mean(diag) | covariance.ts |
| μ-Winsorize | [−20 %, +40 %] p.a. | winsorize.ts |
| HHI / Effective-N / ρ | Schwellen 0,6·n / 0,7 / 0,9 | concentration.ts |

**Pie 30/30/30/10:** HHI = 3×0,30² + 0,10² = **0,28** → Effective-N ≈ **3,57**  
Schwelle 0,6×4=2,4 → 3,57 > 2,4 → keine Klumpen-Warnung laut Code.

---

# Kapitel M — Shrinkage im Detail

| Stufe | Name | Formel | Datei |
|-------|------|--------|-------|
| 1 | **Ridge** (immer) | Σ ← Σ + εI, ε=max(1e−8, κ·mean(diag)), κ=1e−3 | covariance.ts |
| 2 | **Diagonal-Shrinkage** | Σ_shrunk=(1−δ)Σ + δ·diag(Σ) | weighting.ts |

**δ nach n:** n≤2 → **0,40** · n≤4 → **0,25** · n≤8 → **0,10** · n>8 → **0**  
Dein Fall **n=4 → δ=0,25**. Ledoit-Wolf **nicht** implementiert.

Beispiel Ridge: mean(diag)=0,04 → ε = 1e−3×0,04 = **4e−5**.

---

# Kapitel N — Efficient Frontier Spec

Clientseitig (Recharts): N Zufalls-Portfolios long-only + maxWeight → (σ_p, μ_p) → effiziente Hülle.  
Marker: **Ist** (weightMarket), **CAPM-Ziel** (weightCapm), Equal-Weight.  
Nur bei status=ok, n≥2, Σ vorhanden. Kein LLM.

---

# Kapitel O — Ist-Gewichte Zahlen-Check

```ts
marketValue_i = qty_i * lastPrice_i
weightMarket_i = marketValue_i / Σ marketValue
weightCapm_i   = allocResult.weights[i]
basketAmount_i = weightCapm_i * capital
```

**Live qty=1 (14.08.2026):**

| Ticker | Kurs ≈ | Marktwert | **Ist %** | **Ziel %** | Δ |
|--------|--------|-----------|-----------|------------|---|
| MSFT | 496,88 € | 496,88 | **~48 %** | 30 % | **+18 pp** |
| NVDA | 225,30 € | 225,30 | **~22 %** | 30 % | **−8 pp** |
| NVO | 66,72 € | 66,72 | **~6–7 %** | 10 % | **−3–4 pp** |
| LLY | (hoch) | — | Rest | 30 % | — |

KPI Profit **−0,5 %** folgt dem **Ist**, nicht dem CAPM-Pie.

**UI-Pflicht:** Pie-Toggle Ist|Ziel · Spalten Ist-% / Ziel-% · Banner wenn max|Δ|>10 pp.

---

# Kapitel P — Fehlerstatus

**Behoben 10.08.2026:** stilles Equal-Weight bei maxWeight=30% und n≤3 → Cap nicht erzwingen + `capWasInfeasible`; suggestedMaxWeight 60% bei n=2/3; `solveFailed` sichtbar.

**Offen:** Policy-Default oft 30% bei n=4 (suggested 40%) · Ist≠Ziel bei qty=1 · Direkt-Add fehlt · Watchlist↔Position Sync · Frontier UI · Ledoit-Wolf backlog.

---

# Kapitel Q — Checkliste

```
[ ] Efficient-Frontier-Panel in Optimierung oder id=5
[ ] UI-Toggle + Δ-Banner + Ist/Ziel-Spalten
[ ] Policy-Reset nutzt suggestedMaxWeightDefault(n)
[ ] Tests: HHI 30/30/30/10 = 0.28; Effective-N ≈ 3.57
[ ] Tests: shrinkCovariance n=4 → δ=0.25
[ ] Tests: weightMarket Summe = 1 wenn alle Kurse da
```

---

**Regel:** Design-Dokumentation. Zahlen = Code-Stand `main` 14.08.2026.
