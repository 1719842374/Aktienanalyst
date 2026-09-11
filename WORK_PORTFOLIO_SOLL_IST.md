# WORK_PORTFOLIO_SOLL_IST.md — Target vs Actual Weights im Portfolio-Dashboard

> **Stand:** 11.09.2026 12:40 CEST  
> **Repo:** `1719842374/Aktienanalyst`  
> **HEAD zum Zeitpunkt der Spec:** `54a0746`  
> **Referenz-UI:** Feng Feng „Personal Quant System · Status Dashboard“, moomoo SIMULATE(Paper), Generated **2026-08-28 09:12**  
> **Ampel:** ⬜ Spec + Drop-in fertig, **noch nicht auf `main` verdrahtet**  
> **Nicht anfassen:** inverted DCF, PEG, Miner, Sentiment, Portfolio F.2 Kern.

Companion: [WORK_PORTFOLIO.md](./WORK_PORTFOLIO.md) · [WORK_PORTFOLIO_BACKTEST.md](./WORK_PORTFOLIO_BACKTEST.md) · [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md)

---

## 0. Ziel

Pie-Chart in `PortfolioOverview` kann **nur einen** Vektor zeigen (Toggle Ist-Marktwert / Ziel-Gewicht CAPM).  
Was fehlt: gruppierte Balken **Soll vs. Ist**, Active Weight, Tracking-KPIs, Trade-Notional — analog zur rechten Karte im Referenz-Dashboard.

Kein neues Backend. `#/portfolio` bleibt `localStorage`. Kein LLM für Kurse oder Gewichte (Regel `positions.ts`).

---

## 1. Referenz-Dashboard — alle Zahlen (1:1)

Quelle: Screenshot Feng Feng, SIMULATE(Paper), 2026-08-28 09:12.

### 1.1 Live-KPIs

| Feld | Wert | Einheit | Farbe |
|------|------|---------|-------|
| Cash | 30 620 | USD | weiß |
| Total Assets | 1 021 589 | USD | weiß |
| Mkt Value | 990 969 | USD | weiß |
| Positions | 25 | Anzahl | weiß |
| Active Orders | 0 | Anzahl | weiß |
| Total P&L | 21 589 | USD | grün |

**Additions-Check (kürzester Weg):**

```
Total Assets = Cash + Mkt Value
30620 + 990969 = 1021589   →  exakt
```

### 1.2 Backtest-Anzeige (Chart-Titel)

`Backtest Equity (Strategy vs S&P 500, walk-forward, net of costs)`

| Serie | Farbe im Chart |
|-------|----------------|
| Strategy (net) | hellblau |
| Strategy (gross) | grün |
| S&P 500 | orange/gelb |

Achsen:

- Y logarithmisch: 1.0 · 1.5 · 2.0 · 3.0 · 5.0 · 10.0 · 15.0
- X sichtbar: 2013-03-28, 2014-07-09, 2015-10-16, 2017-01-27, 2018-05-09, 2019-08-20, 2020-11-27, 2022-03-10, 2023-06-22, 2024-10-02

Visuelles Ende ~2024-10: Strategy net ≈ 11×, S&P ≈ 5.5× (Index Start = 1.0).

### 1.3 Performance-Karten (Anzeige)

| Label | Anzeige |
|-------|---------|
| Backtest CAGR | 20.55 % |
| Benchmark CAGR | 14.17 % |
| Ann. Excess | 5.67 % |
| Sharpe | 1.11 |
| Max Drawdown | 25.34 % |
| Ann. Turnover | 160.74 % |

### 1.4 If $10,000 invested at 2013 start

| Label | Anzeige |
|-------|---------|
| Initial Invest | 10 000 USD |
| Final Value (net) | 108 593 USD |
| Total Return (net) | +985.93 % |
| Total Return (gross) | +998.25 % |
| Cost Drag | 1.13 % |

**10k-Check:**

```
108593 / 10000 = 10.8593
(10.8593 − 1) × 100 % = 985.93 %   →  exakt
```

**Kumulativer Cost Drag (Niveau, nicht annualisiert):**

```
998.25 % − 985.93 % = 12.32 Prozentpunkte kumuliert
```

Anzeige 1.13 % = annualisierter Drag, nicht die 12.32 pp.

### 1.5 Konsistenz-Bruch im Original (Pflicht dokumentieren)

Chart-Fenster:

```
T_chart = (2024-10-02 − 2013-03-28).days / 365.25
        = 4206 / 365.25
        ≈ 11.5154 Jahre
```

Impliziertes T aus 10k-Block bei Anzeige-CAGR 20.55 %:

```
T_impl = ln(108593/10000) / ln(1.2055)
       = ln(10.8593) / ln(1.2055)
       ≈ 12.7613 Jahre
```

Probe: `1.2055^12.7613 = 10.8593`.

Dieselbe 10k→108593 über `T_chart = 11.5154` wäre CAGR ≈ **23.01 %**, nicht 20.55 %.  
Die Anzeige nutzt **zwei verschiedene T**. Aktienanalyst darf das nicht nachbauen — ein T, eine Formelquelle.

Ann. Excess:

```
arith = 20.55 % − 14.17 % = 6.38 pp
geo   = 1.2055 / 1.1417 − 1 = 5.588 % ≈ 5.59 %
Anzeige = 5.67 %   (+8 bp, andere Periodenaggregation)
```

**Regel:** Excess geometrisch `(1+CAGR_s)/(1+CAGR_b)−1` als Default. Arithmetisch nur als zweite Spalte.

---

## 2. Sichtbare Paper-Positionen (1:1)

Spalten Original: Code · Qty · Cost · Price · Mkt Val · Weight · P&L

Nenner Weight im Screenshot ≈ Mkt Value 990 969 (nicht Total Assets).  
P&L% = (Price − Cost) / Cost.

| Code | Qty | Cost | Price | Mkt Val | Weight (Anzeige) | P&L abs | P&L % |
|------|-----|------|-------|---------|------------------|---------|-------|
| US.CDNS | 133.00 | 316.17 | 347.55 | 46 224 | 4.52 % | 4 174 | 9.93 % |
| US.ALAB | 149.00 | 269.15 | 304.09 | 45 309 | 4.44 % | 5 206 | 12.98 % |
| US.ANET | 225.00 | 187.13 | 201.09 | 45 245 | 4.43 % | 3 142 | 7.46 % |
| US.ADSK | 167.00 | 253.99 | 270.58 | 45 187 | 4.42 % | 2 771 | 6.53 % |
| US.ADBE | 154.00 | 274.70 | 289.15 | 44 529 | 4.36 % | 2 225 | 5.26 % |
| US.ARM | 174.00 | 235.58 | 255.21 | 44 407 | 4.35 % | 3 416 | 8.33 % |
| US.CBOE | 141.00 | 303.20 | 313.95 | 44 267 | 4.33 % | 1 516 | 3.55 % |

Weitere 18 Namen abgeschnitten (gesamt 25). Sichtbare Gewichte 4.33–4.52 % → nahezu gleichgewichtet, nicht exakt 1/25 = 4.00 %.

### 2.1 Nachrechnung CDNS (komplette Formel)

```
MktVal = 133 × 347.55 = 46224.15 ≈ 46224
P&L    = 133 × (347.55 − 316.17) = 133 × 31.38 = 4173.54 ≈ 4174
P&L%   = 31.38 / 316.17 ≈ 9.925 % ≈ 9.93 %
```

Weight gegen Screenshot-NAV:

```
46224 / 990969 ≈ 4.665 %
Anzeige 4.52 %
Differenz ≈ 14.5 bp
```

Ursache: anderer Nenner (Cash anteilig, anderer Bewertungsstand, oder Weight auf Total Assets 1 021 589):

```
46224 / 1021589 ≈ 4.525 % ≈ 4.52 %
```

**Fakt:** Original-Weight nutzt **Total Assets** (Cash+Mkt), nicht nur Mkt Value.  
Das ist Nenner-Typ B (siehe §3). Aktienanalyst-Ist heute ist Typ A (nur Equity) — beim Vergleich **ein** Nenner wählen, nicht mischen.

---

## 3. Soll vs. Ist — Definitionen (verbindlich)

| Symbol | Name | Quelle im Repo heute |
|--------|------|----------------------|
| \(w_i^\star\) | Soll / Target | `capmWeights` aus `allocate` (Modus A/B/C) in `weighting.ts` |
| \(w_i\) | Ist / Actual | `computeMarketWeights` / `computePortfolioWeights` in `engine.ts` / `positions.ts` |
| \(a_i\) | Active Weight | **fehlt** → \(a_i = w_i - w_i^\star\) |
| NAV | Nenner | Summe `qty × lastPrice` der offenen Longs **oder** Total Assets |

### 3.1 Formeln

Ist-Gewicht (Typ A, Status quo Repo):

\[
w_i = \frac{q_i \cdot P_i}{\sum_j q_j \cdot P_j}
\]

Ist-Gewicht (Typ B, Original-Screenshot):

\[
w_i^{B} = \frac{q_i \cdot P_i}{\text{Cash}+\sum_j q_j \cdot P_j}
\]

Active, L1, Turnover, MAE, Trade:

\[
a_i = w_i - w_i^\star
\]

\[
\mathrm{L1}=\sum_i |a_i|
\qquad
\mathrm{Turnover}=\frac{\mathrm{L1}}{2}
\qquad
\mathrm{MAE}=\frac{\mathrm{L1}}{n}
\]

\[
\mathrm{Trade}_i = (w_i^\star - w_i)\cdot \mathrm{NAV}
\]

`Trade_i > 0` → Buy, `< 0` → Sell.  
Turnover = einmalige Umschichtung zurück auf Soll.

### 3.2 Schwellen (bp)

| Status | Bedingung | UI |
|--------|-----------|-----|
| on target | \|a\| < 25 bp = 0.0025 | emerald |
| leicht off | \|a\| < 100 bp = 0.01 | amber |
| off target | sonst | red |

Bestehender Banner in `PortfolioOverview` feuert erst bei **max \|Δ\| > 10 pp (0.10)**. Zu grob für Execution. Neue Karte nutzt 25 / 100 bp. Alter Banner bleibt (nicht anfassen), neue Karte additiv.

### 3.3 Drei harte Regeln

1. **Gleicher Nenner.** Nie Typ-A-Ist gegen Typ-B-Soll plotten. Cash nur, wenn **beide** Vektoren eine `CASH`-Quote haben.
2. **Union der Ticker**, kein Inner-Join. Nur-Soll → Ist = 0 (nie gekauft). Nur-Ist → Soll = 0 (Drift/Altlast).
3. **Keine Renormierung vor Trade.** Renorm verfälscht `Trade_i`. Summe-Soll ≠ 1 als Banner, nicht wegskalieren.

---

## 4. Ist im Aktienanalyst (Code, HEAD `54a0746`)

| Baustein | Pfad | Status |
|----------|------|--------|
| Position (qty, entry, side) | `client/src/lib/portfolio/positions.ts` | ✅ |
| Ist-Gewicht Marktwert | `computePortfolioWeights` | ✅ |
| Ist-Gewicht Engine | `computeMarketWeights` (`engine.ts`) | ✅ |
| Soll-Gewicht Optimizer | `allocate` / `capmWeights` Prop | ✅ |
| Pie-Toggle Ist / CAPM-Soll | `PortfolioOverview.tsx` Z.183–188 | ✅ |
| Drift-Banner maxΔ > 10 pp | `PortfolioOverview.tsx` Z.92–103 | ✅ grob |
| Gruppierte Soll/Ist-Balken | — | ⬜ |
| Active-Weight-Chart | — | ⬜ |
| MAE / L1/2 / Off-Count | — | ⬜ |
| Trade-Notional-Spalte | — | ⬜ |
| `compareTargetActual` pure | — | ⬜ Drop-in spezifiziert |

`computePortfolioKPIs` liefert **kein** `totalMarketValue` — nur `avgActivePerformance`, `bestPerformer`, `avgRealizedPerformance`.  
NAV für Trades = Summe `weights[i].marketValue`.

Layout heute:

```
KPI-Karten
Pie (Toggle) | Performance-Kurve
EfficientFrontier
PortfolioBacktestPanel
```

Soll-Layout:

```
KPI-Karten
Pie (Toggle) | Performance-Kurve
Soll-vs-Ist-Karte volle Breite     ← neu
EfficientFrontier
PortfolioBacktestPanel
```

---

## 5. Drop-in (lokal spezifiziert, noch nicht auf main)

| Datei | Zielpfad |
|-------|-----------|
| `compareTargetActual.ts` | `client/src/lib/portfolio/compareTargetActual.ts` |
| `TargetVsActualWeights.tsx` | `client/src/components/portfolio/TargetVsActualWeights.tsx` |

Wire in `PortfolioOverview.tsx` (nach `lg:grid-cols-2`, vor `EfficientFrontierPanel`):

```tsx
import TargetVsActualWeights from "./TargetVsActualWeights";

<TargetVsActualWeights
  target={capmWeights ?? {}}
  actual={marketWeightsForDelta}
  nav={weights.reduce((s, w) => s + (w.marketValue ?? 0), 0)}
  onSelectTicker={onSelectTicker}
/>
```

`capmWeights`, `marketWeightsForDelta`, `weights` existieren bereits in der Datei.

Design-Tokens (bestehendes System, nicht Feng-Dark erzwingen):

| Element | Token / Wert |
|---------|----------------|
| Karte | `bg-card rounded-xl border border-border p-4` |
| Soll-Balken | `#38bdf8` (sky) |
| Ist-Balken | `#f59e0b` (amber) |
| Active + | `#10b981` |
| Active − | `#ef4444` |
| Chart | Recharts `BarChart layout="vertical"` wie übrige Portfolio-Charts |
| Empty-State | kein Fake-Equal-Weight, Text: Optimierung muss Soll liefern |

Policy-Defaults in Code:

```
onTargetBp = 25
slightBp   = 100
displayFloor = 0.0025
renormalizeDisplay = false
```

---

## 6. Backtest-Metriken (Formeln, falls Block später an Display-Karten andockt)

Nicht Gegenstand dieses Tickets (liegt bei `WORK_PORTFOLIO_BACKTEST.md`). Nur damit die Referenzzahlen nicht verlorengehen.

CAGR:

\[
\mathrm{CAGR}=\Bigl(\frac{V_T}{V_0}\Bigr)^{1/T}-1
\]

Excess geo / arith: siehe §1.5.

Sharpe arithmetisch (Praktiker, p = Perioden/Jahr):

\[
\sigma_{\mathrm{ann}}=s\cdot\sqrt{p}
\qquad
\mathrm{Sharpe}=\frac{\bar r\cdot p-R_f}{\sigma_{\mathrm{ann}}}
\]

MDD:

\[
\mathrm{Peak}_t=\max_{s\le t}V_s
\qquad
\mathrm{DD}_t=\frac{V_t}{\mathrm{Peak}_t}-1
\qquad
\mathrm{MDD}=\min_t\mathrm{DD}_t
\]

Cost Drag annualisiert:

\[
\mathrm{Drag}_{\mathrm{ann}}=\mathrm{CAGR}_{\mathrm{gross}}-\mathrm{CAGR}_{\mathrm{net}}
\]

---

## 7. Acceptance

- [ ] Datei `compareTargetActual.ts` auf `main`, pure, ohne Netz, unit-testbar
- [ ] Datei `TargetVsActualWeights.tsx` auf `main`, Tokens wie PortfolioOverview
- [ ] Wire in `PortfolioOverview` additiv, Pie/Frontier/Backtest unverändert
- [ ] Ohne `capmWeights`: Empty-State, keine erfundenen Soll-Gewichte
- [ ] Union-Ticker: Name nur in Soll oder nur in Ist erscheint
- [ ] KPI-Karten MAE, Turnover=L1/2, Max \|Active\|, Off-Count
- [ ] Tabellen-Spalten Soll · Ist · Active · Trade · Status
- [ ] Trade_i = (Soll − Ist) × NAV; Vorzeichen Buy/Sell korrekt
- [ ] Banner wenn Summe Soll um > 2 pp von 1 abweicht
- [ ] Kein LLM, kein neues Backend, F.2 unberührt
- [ ] Manueller Check gegen Tabelle §2: CDNS MktVal / P&L / P&L% auf 1 USD / 1 bp genau

---

## 8. Abgrenzung

- Kein Live-Broker / moomoo-API
- Kein Walk-Forward-Rebalancing in dieser Karte
- Keine Änderung an `allocate` / Black-Litterman
- `WORK_IST_VS_SOLL.md` bleibt der **globale Spec-Audit** — diese Datei ist das **Portfolio-Tracking-Ticket**

---

## 9. Aufwand

| Teil | h |
|------|---|
| Pure `compareTargetActual` + 6 Fixtures (Summe≠1, Union, Cash-Mix) | 2 |
| UI-Karte Recharts + Tabelle | 3 |
| Wire Overview + Empty-State | 1 |
| Tests + Review Nenner A vs B | 1 |
| **Summe** | **≈ 1 Tag** |

---

*Erstellt 11.09.2026 aus 1:1-Transkription des Feng-Feng-SIMULATE-Dashboards (2026-08-28) und Code-Stand PortfolioOverview / positions.ts / weighting.ts auf HEAD `54a0746`.*
