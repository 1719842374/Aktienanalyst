# WORK_PORTFOLIO_BACKTEST.md — Portfolio Performance Attribution vs. Benchmark

> **Stand: 19.08.2026**  
> Erster Backtesting-/Attribution-Block für das virtuelle Portfolio.  
> Generisch, ex-post, keine Order-Ausführung, keine Look-ahead-Bias.

**Ziel:** Das Portfolio-Modul von „Forward-Looking Optimierer“ um eine professionelle **ex-post Performance-Attribution** erweitern (analog zum gezeigten Dashboard: Equity Curve, Alpha/Beta/IR, Underwater, Capture Ratios, Contribution).

---

## 1. Motivation & Ist-Zustand

### Was das gezeigte Frontend liefert (Referenz-Screenshot 19.08.2026)

| Kennzahl | Wert (Beispiel) | Aussage |
|----------|-----------------|--------|
| β | 0,69 | Defensive Haltung – hinkt Rallyes hinterher |
| Alpha | –3,40 %/Jahr | Selektion kostet gegenüber reinem Indexieren |
| IR | –0,50 | Negative Information Ratio |
| Up Capture | 66 % | Unterproportionale Teilnahme an Aufwärtsmärkten |
| Down Capture | 67 % | Fast symmetrisch in Abwärtsmärkten |
| Hit Rate | 60 % (6/10) | 6 von 10 Titeln positiv |
| Profit Factor | 3,55 | Σ Gewinne / \|Σ Verluste\| |
| Avg Win / Avg Loss | +7,14 % / –3,02 % | Asymmetrie der Treffer |
| Max DD | –23,1 % / 392 Tage | Längste und tiefste Phase ab 11.10.2022 |
| Trading Days | 1.255 | ~5 Jahre |

### Was im Aktienanalyst aktuell fehlt

`PortfolioPage` + `engine.ts` sind stark **forward-looking** (CAPM/Kelly/Sharpe, Gewichte vorschlagen).  
Historische Preise pro Ticker existieren (Analyse-Cache), aber es gibt **keine**:

- Portfolio-weite Equity Curve (gewichtete Strategie über die gesamte Haltedauer)
- Benchmark-Vergleich mit Alpha, Beta, Information Ratio
- Underwater-/Drawdown-Chart mit markierten Perioden
- Up-/Down-Capture, Profit Factor, Hit Rate
- Contribution-Attribution pro Titel und Sektor

---

## 2. Ökonomische & mathematische Grundlagen (Formeln)

### 2.1 Tägliche Portfolio-Rendite

\[
r_{p,t} = \sum_{i=1}^{N} w_{i,t} \cdot r_{i,t}
\]

wobei

\[
r_{i,t} = \frac{P_{i,t}}{P_{i,t-1}} - 1, \quad
w_{i,t} = \frac{\text{Qty}_i \cdot P_{i,t}}{\sum_j \text{Qty}_j \cdot P_{j,t}}
\]

Bei Buy-and-Hold mit festen Qty kann das Gewicht täglich aus den Marktwerten rekonstruiert werden.  
Alternative (einfacher, für v1): Gewichte zum Entry-Zeitpunkt fixieren und bis zum Ende halten.

### 2.2 Kumulative Rendite (Equity Curve)

\[
C_t = \prod_{s=1}^{t} (1 + r_{p,s}) - 1
\]

Analog für den Benchmark \( C_{b,t} \).

### 2.3 Alpha & Beta (CAPM-Regression)

\[
r_{p,t} - r_{f,t} = \alpha + \beta \cdot (r_{b,t} - r_{f,t}) + \varepsilon_t
\]

- \( \alpha \) = jährliche Überrendite (annualisiert aus täglichen Residuen)
- \( \beta \) = systematische Marktsensitivität
- \( \sigma(\varepsilon) \) = Tracking Error

**Information Ratio:**

\[
\text{IR} = \frac{\alpha}{\sigma(\varepsilon)}
\]

### 2.4 Maximum Drawdown & Underwater

\[
\text{Peak}_t = \max_{s \le t} C_s, \quad
\text{DD}_t = \frac{C_t - \text{Peak}_t}{\text{Peak}_t}, \quad
\text{Max DD} = \min_t \text{DD}_t
\]

Zusätzlich speichern: Start-Datum, End-Datum und Dauer (Handelstage) der schlimmsten Phase.

### 2.5 Up-Capture & Down-Capture

\[
\text{Up Capture} = \frac{\overline{r_p} \mid r_b > 0}{\overline{r_b} \mid r_b > 0}
\]

Analog für Down-Capture (\( r_b < 0 \)).

### 2.6 Hit Rate & Profit Factor

- Hit Rate = Anteil der Perioden/Titel mit \( r > 0 \)
- Profit Factor = \( \frac{\sum \text{positive Returns}}{|\sum \text{negative Returns}|} \)

### 2.7 Contribution (Attribution)

\[
\text{Contribution}_i = w_i \cdot (r_i - r_b)
\]

Summe der Contributions ≈ Portfolio-Alpha (bei konstanter Gewichtung).

---

## 3. Datenmodell (TypeScript)

```ts
export interface PortfolioBacktestPoint {
  date: string;               // YYYY-MM-DD
  portfolioCum: number;       // 1.0 = Start
  benchmarkCum: number;
  drawdown: number;           // 0 … negativ
}

export interface HoldingAttribution {
  ticker: string;
  weightPct: number;
  contributionPct: number;    // zum Gesamt-Alpha
  alphaPct: number;           // Einzel-Alpha vs. Benchmark
  volPct: number;             // annualisierte Volatilität
  beta: number;
  retVol: number;             // Return / Vol
  maxDdPct: number;
  days: number;               // Haltedauer in Handelstagen
  sector?: string;
}

export interface SectorAggregate {
  sector: string;
  weightPct: number;
  contributionPct: number;
}

export interface PortfolioBacktestResult {
  // Meta
  startDate: string;
  endDate: string;
  tradingDays: number;
  benchmark: string;

  // Kurven
  series: PortfolioBacktestPoint[];

  // Summary
  totalReturnPct: number;
  benchmarkReturnPct: number;
  alphaAnnualPct: number;
  beta: number;
  informationRatio: number;
  maxDrawdownPct: number;
  maxDrawdownDays: number;
  maxDrawdownStart: string;
  maxDrawdownEnd: string;

  // Capture & Quality
  upCapturePct: number;
  downCapturePct: number;
  hitRatePct: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;

  // Attribution
  holdings: HoldingAttribution[];
  sectorAggregates: SectorAggregate[];
}
```

---

## 4. Rechenschritte (v1 – robust & einfach)

1. **Kalender bauen**  
   Intersection aller verfügbaren Handelstage der Positionen + Benchmark (Inner Join auf Datum).

2. **Portfolio-Renditeserie**  
   - Variante A (empfohlen für v1): Gewichte zum jeweiligen Entry-Datum fixieren (Buy-and-Hold).  
   - Variante B: Tägliche Marktgewichtete Rekonstruktion aus Qty × Preis.

3. **Kumulative Kurven**  
   Produkt der (1 + r) für Portfolio und Benchmark.

4. **OLS-Regression**  
   Einfache lineare Regression (Portfolio excess vs. Benchmark excess) → α, β, Residuen-σ → IR.  
   Annualisierung: α_daily × 252.

5. **Drawdown-Serie**  
   Running Peak → DD_t → Max DD + Start/Ende/Dauer der schlimmsten Phase.  
   Optional: die 2–3 nächstschlimmeren Perioden für Marker speichern.

6. **Capture Ratios**  
   Filter auf Tage mit r_b > 0 bzw. < 0 → Mittelwerte bilden.

7. **Holdings-Attribution**  
   Für jeden Titel: eigene Renditeserie vs. Benchmark → Einzel-Alpha, Contribution, eigene Max DD, Vol, β.

8. **Sektor-Aggregation**  
   Aus Analyse-Cache (`sector`) oder Fallback „Unknown“. Summe Weight und Contribution pro Sektor.

**Robustheit:**
- Mindestens 20 gemeinsame Handelstage, sonst `status: "insufficient_data"`.
- Fehlende Kurse an einzelnen Tagen → Forward-Fill (max. 3 Tage) oder Tag auslassen.
- Keine Look-ahead: nur Preise ≤ heutigem Datum.

---

## 5. Chart-Design (detailliert)

### 5.1 Cumulative Return Chart (Hauptchart)

- **Typ:** Dual-Line (Recharts `LineChart` oder `ComposedChart`)
- **Linien:**
  - Portfolio: `stroke="#3b82f6"` (blau), `strokeWidth={2}`
  - Benchmark: `stroke="#f59e0b"` (amber/orange), `strokeWidth={1.5}`, `strokeDasharray` optional
- **Y-Achse:** Prozent (–30 % … +80 % oder auto), `tickFormatter` mit `%`
- **X-Achse:** Datum, sparsames Labeling (alle 3–6 Monate)
- **Tooltip:** Datum + Portfolio-Wert + Benchmark-Wert + Relative Performance (pp)
- **Legende:** oben rechts, compact
- **Höhe:** 280–320 px
- **Toggle (optional v1.1):** Linear / Log

### 5.2 Underwater / Drawdown Chart (direkt darunter)

- **Typ:** AreaChart, gefüllt
- **Farbe:** `fill="#7f1d1d"` oder `fill="rgba(127,29,29,0.55)"` (dunkelrot)
- **Y-Achse:** 0 bis Max-DD (negativ nach unten)
- **Marker:** 2–3 ReferenceDots oder Annotationen für die schlimmsten Phasen  
  Format: `–23.1 % · 392d · 2022-10-11`
- **Synchronisation:** gleiche X-Domain wie Cumulative-Chart (Brush oder shared state)
- **Höhe:** 120–140 px

### 5.3 Key-Metrics-Leiste (über den Charts)

Horizontal, 6 Kacheln (wie im Screenshot):

| Up Capture | Down Capture | Hit Rate | Profit Factor | Avg Win | Avg Loss |
|------------|--------------|----------|---------------|---------|----------|

Zusätzlich darunter oder daneben: α, β, IR, Max DD, Trading Days.

### 5.4 Holdings-Tabelle (Attribution)

- Sortierbar nach: Weight, Contribution, Alpha, Max DD, Ret/Vol
- Sektor-Header-Zeilen (grau hinterlegt) mit Aggregaten
- Farblogik:
  - Contribution / Alpha > 0 → text-emerald-400
  - Contribution / Alpha < 0 → text-rose-400
- Spalten: Ticker · Weight % · Contrib % · A % · Vol % · β · Ret/Vol · Max DD % · Days

---

## 6. UI-Platzierung (minimal-invasiv)

**Empfehlung A (bevorzugt):**  
Neuer Block direkt **unter** der bestehenden Übersicht (Section 1) in `PortfolioOverview.tsx`  
oder als eigene Section „Performance & Attribution“ (dann bestehende Sections 5/6 nach hinten schieben).

**Empfehlung B (noch schlanker):**  
In `PortfolioOverview` einen Toggle „vs. Benchmark“ einbauen, der Equity-Curve + Underwater + Key Metrics einblendet.  
Die detaillierte Holdings-Attribution als zusätzliche Spalten in der bestehenden Investments-Tabelle.

**Policy-Anbindung:**  
Benchmark kommt aus dem bereits vorhandenen `policy.benchmark`-Feld (Default „SPY“).

---

## 7. Generizität & Erweiterbarkeit

| Aspekt | v1 | Später |
|--------|----|--------|
| Benchmark | String aus Policy (SPY, VWCE.DE, …) | Mehrere Benchmarks parallel |
| Gewichtung | Fix ab Entry (Buy-and-Hold) | Tägliche Marktgewichtung, Rebalancing-Regeln |
| Universum | P1 (manuelle Positionen) | P2 Watchlist + P3 Researcher |
| Zeitfenster | Max / 1Y / 6M / 3M / 1M | Custom Date Range |
| Transaktionskosten | 0 | konfigurierbare bps |
| Währung | USD/EUR aus Analyse | Multi-Currency mit FX-Serie |

Die erste Version bleibt bewusst einfach und generisch, damit sie später ohne Breaking Changes erweitert werden kann.

---

## 8. Acceptance-Kriterien (v1)

- [ ] Bei ≥ 2 offenen Long-Positionen und ausreichender Historie erscheint der Backtest-Block
- [ ] Equity Curve Portfolio + Benchmark korrekt (manuell gegen Excel/Yahoo prüfbar)
- [ ] Alpha, Beta, IR, Max DD, Up/Down Capture, Profit Factor werden berechnet und angezeigt
- [ ] Underwater-Chart zeigt die schlimmste Drawdown-Phase mit Label
- [ ] Holdings-Tabelle enthält Contribution und Einzel-Alpha, sortierbar
- [ ] Sektor-Aggregate korrekt summiert
- [ ] Benchmark aus Policy steuerbar
- [ ] Keine Console-Errors, keine Look-ahead-Daten
- [ ] Bestehende CAPM/Kelly-Optimierung bleibt unverändert funktionsfähig

---

## 9. Aufwandsschätzung

| Teil | Aufwand |
|------|--------|
| Datenmodell + pure Berechnungsfunktionen (`lib/portfolio/backtest.ts`) | 4–6 h |
| Equity + Underwater Charts (Recharts) | 3–4 h |
| Metrics-Leiste + Holdings-Attribution-Tabelle | 2–3 h |
| Integration in PortfolioOverview / PortfolioPage | 1–2 h |
| Tests (synthetische Serien + Edge-Cases) | 2 h |
| **Gesamt v1** | **≈ 1,5–2 Tage** |

---

## 10. Abgrenzung (was v1 bewusst *nicht* macht)

- Kein Strategy-Backtesting mit periodischem Rebalancing
- Keine Transaction Costs / Slippage
- Keine Short-Positionen in der Attribution (nur Long)
- Keine Monte-Carlo-Zukunftssimulation (das bleibt bei der bestehenden Optimierung)
- Kein Live-Paper-Trading

---

*Erstellt 19.08.2026 nach Analyse des professionellen Portfolio-Performance-Dashboards und Abgleich mit dem aktuellen Stand von PortfolioPage + engine.ts.*
