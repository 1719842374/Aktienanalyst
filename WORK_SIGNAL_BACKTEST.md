# WORK_SIGNAL_BACKTEST.md — Signal-/Gate-Backtest, Walk-Forward, Survivorship, Cluster-Median

> **Stand: 26.08.2026**
> Spezifikation für den fehlenden Backtesting-Layer der Scoring-Pipeline.
> Kein zweites Score-Modell. Live-Code = Replay-Code.
> Ergänzt `WORK_PORTFOLIO_BACKTEST.md` (ex-post Depot-Attribution) und `WORK_SCORING_VORLAGE.md` (§17 Lookahead).

**Ziel:** Belegen oder widerlegen, dass Avoid/Gates *typischerweise* schlechtere Forward-Returns haben als Buy — point-in-time, ohne Lookahead, ohne Siegerkorb, ohne überlappende Schein-n.

---

## 0. Abgrenzung

| Dokument | Fragt | Status |
|---|---|---|
| `WORK_PORTFOLIO_BACKTEST.md` | Wie lief *mein* Depot vs. Benchmark? | Spezifiziert, Engine/UI offen |
| `WORK_SCORING_VORLAGE.md` §17 | Lookahead-Sperre Fiscal, Gate-Caps | Live in `scoring-gates.ts` |
| **dieses Dokument** | Hätte das Scoring an T Avoid gesagt — und war das richtig? | **offen** (BACKLOG: Screener-Gates + Backtesting) |

Drei Tests, nicht einer:

| Test | Frage | Kosten | Aggregator |
|---|---|---|---|
| T1 Gate-Lift | Gate aktiv vs. inaktiv, gleicher Titel | 0 bp | Cluster-Median |
| T2 Signal-Kohorte | Avoid vs. Buy, Buy-and-Hold Horizont h | 1× Half-Spread (ausweisen) | Cluster-Median |
| T3 Policy-Portfolio | Quartals-Rebalance nach Signal/CRV | voll `cost_v1` | Mean der Portfoliorenditen (Wealth) |

Pitch / Broker-Zahl = **T2 Cluster-Median, survivorship-corrected, Test-Folds**.
T3-Netto nur, wenn Gewichtung als Produkt behauptet wird.

---

## 1. Architektur

```
asOf T
  → universe_corr(T)          # Cap_T ≥ 1 Mrd., gelistet an T, Delist später erlaubt
  → PIT-Fundamentals ≤ T      # Filing-Datum, nicht Periodenende
  → deriveGateInputs + runScoringPipeline   # EXISTIERENDER Code
  → signal(T) ∈ {Buy, Accumulate, Hold, Reduce, Avoid}
  → r(T+1 → T+h)              # Embargo T+1
  → Cluster-Median über (Monat, Signal)
  → Walk-Forward mit Purge ≥ h
```

**Verbot:** zweiter „Backtest-Score“. Drift Live vs. Replay = Bug.

LLM-Katalysatoren im historischen Replay: **default aus**.
Fiscal-Ausnahme nur wenn `source.publishedAt ≤ asOf` (bereits in `fiscalMegatrendQualifies`).
Sonst `qualifies = false` — konservativ, kein GPT-2026-Lookahead.

---

## 2. Betroffene Dateien (Ist + Soll)

### 2.1 Existierender Code — wiederverwenden, nicht kopieren

| Datei | Rolle im Backtest |
|---|---|
| `server/scoring-gates.ts` | `GATE_CAPS`, `GATE_THRESHOLDS`, `buildGates`, `runScoringPipeline`, Fiscal-Qualify/Soften |
| `server/scoring-integration.ts` | `deriveGateInputs`, `calcRealizedGrowth8QServer`, `mapQualityScore`, `mapTrendMultiplier`, `buildScoringForAnalysis` |
| `server/thesis-strength.ts` | `mapGrowthProfile`, `GROWTH_PROFILE_RANGES`, G1–G4, Inflection cyclical |
| `server/catalyst-engine.ts` | `calcImpliedGStar` — Replay mit WACC/FCF **an T** |
| `server/fiscal-bridge.ts` | fertig, **unwired**; an Replay andocken (`publishedAt ≤ asOf`) |
| `server/regulatory.ts` | Regulatory-Gate nur wenn Assessment-as-of ≤ T, sonst inaktiv |
| `client/src/lib/calculations.ts` | Client-8Q / Reverse-DCF; Server-Spiegel muss driftfrei bleiben (`test-scoring-integration.ts`) |
| `server/disk-cache.ts` / `data.db` | Snapshot-Store erweitern |
| `server/analyze-route.ts` | nach Live-Analyze `ScoringSnapshot` schreiben |
| `server/fmp.ts` / `fmp-fetcher.ts` | PIT-Prices, Income quarterly/annual, delisted, constituents |
| `shared/schema.ts` | Snapshot- + Backtest-Result-Typen additiv |
| `script/test-scoring-gates.ts` | Regression: Replay gleicher Fixture → gleicher Score |
| `script/test-scoring-pipeline.ts` | Nike/NKE-Logik darf im Replay nicht zerfallen |
| `BACKLOG.md` | Item „Screener-Gates + Backtesting“ auf diese Spec zeigen |

### 2.2 Neu anzulegen

| Datei | Inhalt |
|---|---|
| `server/backtest/types.ts` | Snapshot, UniverseRow, ClusterDelta, FoldResult |
| `server/backtest/universe.ts` | `inUniverse(T)`, naive vs. corr |
| `server/backtest/pit.ts` | Filing-as-of Join, Cap_T, Terminal-Return |
| `server/backtest/replay.ts` | `replayAt(ticker, asOf, pit) → ScoringSnapshot` |
| `server/backtest/signal.ts` | Buy/Hold/Avoid aus Score+Gates+invDCF — **eine** Funktion, auch Live-Summary |
| `server/backtest/returns.ts` | Forward-Return T+1→T+h, Delist-Terminal |
| `server/backtest/cluster.ts` | Median inner/outer, Mean-Nebenrechnung |
| `server/backtest/walkforward.ts` | Folds, Purge, Embargo |
| `server/backtest/costs.ts` | `cost_v1` Cap-Buckets |
| `server/backtest/evaluate.ts` | T1/T2/T3 Reports |
| `server/backtest-routes.ts` | `POST /api/backtest/run`, `GET /api/backtest/report` |
| `script/test-backtest-cluster.ts` | Median vs. Mean Fixture |
| `script/test-backtest-survivorship.ts` | Naive vs. corr Fixture |
| `script/test-backtest-purge.ts` | Overlap-Leakage darf nicht in Train/Test |
| `script/test-backtest-replay-parity.ts` | Live-Analyze ≙ Replay(heute) |
| `client/src/pages/CalibrationPage.tsx` | intern: Δ_6M, Gap, n, Profile-Strata |

`WORK_PORTFOLIO_BACKTEST.md` bleibt Depot-Attribution (`lib/portfolio/backtest.ts`) — nicht hier hineinmischen.

---

## 3. Datenvertrag Point-in-Time

### 3.1 Erlaubt an T

- OHLCV mit Datum ≤ T
- Quartals-/Jahreszahlen erst nach **Report-/Filing-Date** ≤ T (nicht FY-End)
- Peer-Median nur aus Peers mit ListingDate ≤ T
- Sector/Industry-String an T → `mapGrowthProfile`
- Katalysatoren nur `publishedAt ≤ T`
- Market Cap = Preis_T × Shares_T

### 3.2 Verboten

- Heutiges \(g^*\) auf alten EV
- LLM-Katalysatoren 2026 für 2023
- 2026-Cap als Filter für 2021
- Restated GuV ohne Filing-Datum
- Delistings droppen statt Terminal-Return

### 3.3 DCF / invertierter DCF — Klassensperre

Invertierter DCF ist **keine** Universalgleichung.

```
dcfApplicable =
  FCF_T > 0
  AND sector ∉ {Banks, Insurance, Capital Markets als Bank-Proxy}
  AND profile erlaubt FCF-DCF
```

Sonst: `invDcf = null`, Signal höchstens Hold, `dataComplete.dcf = false`.
Kein stilles Pressen von Banken-FCF, sonst beweist der Backtest ein Artefakt.

Zykliker: Live-Inflection bleibt; Auswertung **zusätzlich** 12M-Kohorte (6M allein zu kurz).

---

## 4. Hardcoding vs. Adaptiv (Modellvertrag)

Hardcoding = benannte Konstante oder Regel **ohne Ticker-Namen**.
Adaptiv = dieselbe Funktion, Input aus Profil/Daten/as-of.

### 4.1 Live bereits fest (`scoring-gates.ts` / Integration)

| Symbol | Wert |
|---|---|
| `GATE_CAPS` | PP 55, RelGrowth 60, DCF 65, Inventory 70 |
| `WEAK_REALIZED_GROWTH_PCT` | 5 |
| `HIGH_GAP_RATIO` | 1.5 |
| `MARGIN_COMPRESSION_PP` | 2 |
| `SHARE_LOSS_PP` | 2 |
| Inventory-Trigger | +15 % YoY (warn) |
| Fiscal soften | nur `DCF_REALITY`, Cap +10, max 80 |
| Fiscal qualify | type fiscal\|capacity, conf high, p≥0.6, URL, epsImpact, publishedAt≤asOf, EV≥5 |
| Quality-Map | Excellent 80 … Critical 28; Moat +8/+4/0 |
| Trend-Mult | 1.1 / 1.0 / 0.9 |
| Profile | software_growth \| consumer_brands \| cyclical \| other |

### 4.2 Backtest-Standards (`backtest_v1`) — ebenfalls fest, versionieren

| Symbol | Wert |
|---|---|
| `CAP_FLOOR_USD` | 1e9 an T |
| Snapshot-Raster | Monatultimo oder letzter Handelstag im Monat |
| Horizonte h | 21 / 63 / 126 / 252 Handelstage |
| Default-Pitch-Horizont | 126 (6M) |
| Embargo | T+1 Close |
| Purge | ≥ h Handelstage |
| `min_n_signal_per_month` | 8 |
| `min_n_avoid_per_fold` | 80 (darunter „unzureichend“) |
| Haltbare Aussage | Vorzeichen Δ auf ≥ 2 von 3 Test-Folds |
| T3 Rebalance | quartalsweise, max 15 Titel, Δw > 2 pp |
| Train darf ändern | höchstens *eine* Zahl in `GATE_THRESHOLDS` |
| Train darf nicht | Gate-Logik, Fiscal-Vertrag, Signalregel, Ticker-ifs |

### 4.3 Verboten

```
if (ticker === "NKE" || ticker === "MSFT") { ... }
zweites Gap-Ratio je Sektor nur für den Backtest
Avoid-Regel nach Anschauen der Test-Folds umschreiben
```

Neue Schwelle = `GATE_THRESHOLDS_v1.1` + alte Snapshots unverändert lassen.

---

## 5. Universum und Survivorship-Korrektur

### 5.1 Definitionen

```
U_naive(T) = { i | i ∈ Index_heute ∧ cap_2026(i) ≥ 1e9 }
U_corr(T)  = { i | handelbar an T
                 ∧ cap_T(i) ≥ 1e9
                 ∧ listingDate ≤ T
                 ∧ (delistDate = null ∨ delistDate > T)
                 ∧ PIT-Mindestfelder oder dataComplete-Flag }
```

Wer an T in `U_corr` war und 2024 delistet: bleibt in allen Snapshots ≤ Delist-Tag.

### 5.2 Literatur-Größenordnung (Eichung, kein Plug-in-Faktor)

Nicht „×1.02 rechnen“. Nur Erwartung kalibrieren.

| Setting | Typische Überzeichnung Survivor-only |
|---|---|
| US-Aktienfonds, Elton/Gruber/Blake 1996 | ~0,7–0,9 pp p.a. Alpha-Maß |
| Brown et al. 1992 / Folgestudien Fonds | oft ~1–3 pp p.a. |
| Dimensional US-Fonds 1991–2020 | Median-Alpha +0,60 pp p.a. durch Survivors-only |
| Large-Cap-Produktvergleiche | oft klein, Large-Cap-Core nahe 0 |
| Small-Cap-Index-Rekonstruktion (Bsp. NIFTY Smallcap 2016–25) | +4,9 pp p.a. |

**Erwartung Aktienanalyst v1 (Large/Mid ≥ 1 Mrd., ~5J):**
Gap naive−corr auf 6M-Δ eher **0,3–1,5 pp**, Avoid-Kohorte stärker betroffen als Buy.
Small-Cap-Universum nicht still aufblasen.

### 5.3 Terminal-Return

```
r_term =
  Offer/P_{T+1}-1     Cash-M&A
  P_last/P_{T+1}-1    letzter handelbarer Close
  [-1.0, -0.8]        Insolvenz / Pennystock (dokumentieren)
```

Kein Drop, kein r=0.

### 5.4 Coverage-Quote

```
coverage_T = #{i in U_corr(T): dataComplete} / #U_corr(T)
```

Signalstatistik nur auf `dataComplete`. `coverage_T` je Monat reporten.

### 5.5 Bias-Gap

```
Gap = Δ_6M_naive - Δ_6M_corr
```

Pitch = Δ_corr. Gap daneben.
Gap > 0 ⇒ Survivor-only hat Avoid zu freundlich gerechnet.

---

## 6. Returns, Embargo, Purge, Overlap

### 6.1 Label

```
r_{i,T,h} = P_{i,T+1+h} / P_{i,T+1} - 1
```

Close T liegt **nicht** in Feature und Label gleichzeitig.

### 6.2 Overlap und effektive n

Monatssnapshot + 6M-Label: Jan- und Feb-Fenster teilen 5/6 Monate.

Richtwert: n_eff ≈ n/4 bis n/6.
30.000 Ticker-Monate ≈ informational 5.000–7.500.
Deshalb nicht eine gepoolte t-Statistik über alle Zeilen als Beweis.

### 6.3 Purge

Purge-Handelstage ≥ h

| Train-Label-Horizont | Purge |
|---|---|
| 21 | ≥ 21 |
| 63 | ≥ 63 |
| 126 | ≥ 126 |
| 252 | ≥ 252 |

```
Train-as-of ≤ T_tr
  --h--> letztes Train-Label-Ende
           --purge ≥ h--> erstes Test-as-of
```

### 6.4 Walk-Forward-Folds (`wf_v1`, Horizont 126)

Expanding Train ab 2021-01.

| Fold | Letztes Train-as-of | Train-Label-Ende | Erstes Test-as-of | Test-Label-Ende |
|---|---|---|---|---|
| 1 | 2023-01 | 2023-07 | 2023-08 | 2024-02 |
| 2 | 2024-01 | 2024-07 | 2024-08 | 2025-02 |
| 3 | 2025-01 | 2025-07 | 2025-08 | 2026-02 |

Robustheit extra: Rolling-36M-Train, nicht Headline.

Schwellen nur an Train ansehen. Höchstens eine Threshold-Änderung. Test unberührt.

---

## 7. Cluster-Median vs. Mean

### 7.1 Cluster

Primär: (asOfMonth, signal).
Zusätzlich ausweisen: (asOfMonth, signal, GrowthProfile).

Ein Monat = eine Stimme. 40 Avoids im Januar zählen nicht 40-mal.

### 7.2 Stufen

**Stufe 1** — innerhalb Monat t, Signal s: median der Returns, n ≥ 8, sonst N/A (nicht 0).

**Stufe 2** — Monatsdelta: δ_t = m_Avoid,t - m_Buy,t

**Stufe 3** — über Test-Monate eines Folds: Δ_Fold = median_t(δ_t)

**Headline:** Δ_6M_pitch = median(Δ_Fold1, Δ_Fold2, Δ_Fold3)

Mean derselben Stufen **neben** der Headline (Vermögenslesart), nie allein.

### 7.3 Warum Median (Fakten)

Equity-Querschnitt ist rechtschief + linker Crash-Schwanz.
Mean folgt NVDA-Avoid der trotzdem +48 % macht, oder einer Insolvenz −80 %.
Median hat Bruchpunkt 50 %: Mehrheit der Namen steuert die Zahl.

Numerisches Mini-Fixture (12 Avoid-Returns, %):

```
-42, -18, -11, -9, -6, -4, -2, +1, +3, +8, +14, +48
median = -3.0
mean   = -1.5
```

Buy-Median +5.0, Buy-Mean +9.2 → δ_med = -8.0 pp, δ_mean = -10.7 pp.

Ein zusätzlicher Crash-Monat δ=-18 in sechs Monaten: Median der δ bleibt nah am Zentrum, Mean fällt stark.
Genau das darf die Pitch-Zahl nicht tun.

### 7.4 Wann Mean Pflicht ist

- T3 Equity Curve / Alpha / IR → Mean der *Portfolio*-Tagesrenditen
- „Was wäre aus 1 € Avoid-Korb geworden?“ → Mean, dann Kosten
- Gate-These „typischerweise“ → **Median**

### 7.5 Profil-Strata

δ_{t,p} nur wenn beide Seiten n≥8.
Vier Cluster-Mediane + Gesamt. Ein Tech-2024-Gegensignal muss im Satz stehen.

---

## 8. Transaktionskosten (`cost_v1`)

### 8.1 Wo Kosten hingehören

| Test | Kosten |
|---|---|
| T1 Gate-Lift | 0 |
| T2 Kohorte | 1× Entry (half spread + slippage), ausweisen |
| T3 Policy | Round-Turn voll auf gehandeltes Notional |

### 8.2 Sätze (Retail DACH, Version einfrieren)

```text
cost_v1:
  commission_bp: 0          # Zero-ähnlich, Ticket ≥ 500 €
  half_spread_bp:
    mega  (>100e9 USD): 1.5
    large (10e9–100e9): 3
    mid   (1e9–10e9):   12
  slippage_bp:
    mega/large: 2
    mid:        5
  fx_rt_bp_us_in_eur_depot: 8   # optional Flag
  delay: T+1 close
```

Round-Turn: c_rt = 2 × (commission + half spread + slippage)

| Bucket | c_rt |
|---|---|
| Mega | 7 bp |
| Large | 10 bp |
| Mid | 34 bp |

T2 Large einmal Entry ≈ 5 bp auf 6M ≈ 0,05 pp — gegenüber erwartetem δ von 1–3 pp Lärm, trotzdem reporten.

### 8.3 T3-Kostenlast (Illustration)

Quartals-Rebalance, Turnover 30 %/Q:

Kosten p.a. ≈ 4 × 0.30 × c_rt

Large-Mix 10 bp → **0,12 % p.a.**
Mid-lastig 34 bp → **0,41 % p.a.**

Alpha T3 vor Kosten 0,8 % p.a. überlebt Large knapp, Mid oft nicht.
Deshalb Cap-Floor und Bucket, kein Flachsatz 20 bp.

Trade nur wenn |Δw|>2 pp. Hold ohne Fill = 0 Kosten.

---

## 9. Signalregel (eine Funktion, Live + Replay)

Vorschlag `signal_v1` — vor dem ersten Fold einfrieren:

```
if !dataComplete:           kein Signal
if !dcfApplicable:          max Hold
if invDcf != null && invDcf < price && kein Fiscal-Qualify:
                            Avoid  (oder Reduce, aber nicht Buy)
if cappedBy in {PRICING_POWER, RELATIVE_GROWTH} und severity=hard:
                            kein Buy
if CRV < 1.5:               Avoid
if CRV < 2.0:               Hold
if CRV < 2.5:               Accumulate
else:                       Buy
```

CRV-Schwellen analog Skill/Template (≥2.5 attraktiv, 2.0–2.5 neutral, <2 Warnung).
Keine dritte Regel „nur wenn 3 Gates“, nachdem Test-Folds bekannt sind.

---

## 10. Erwartete Sample-Größen (v1-Labor)

Annahme: S&P 500 + DAX/MDAX oder Stoxx-600-Large, Cap_T ≥ 1 Mrd., Monatssnapshots, 2021–2026.

| Größe | Roh | Nach dataComplete |
|---|---|---|
| Namen / Monat | 700–900 | 500–700 |
| 5J × 12 Monate | 42.000–54.000 Events | 25.000–35.000 |
| Test-Fold ~5 Monate | 3.500–4.500 | 2.500–3.500 |
| Avoid-Anteil (Illustration) | 15–25 % | n Avoid/Fold oft 150–300 nach Filter |
| Mindest n Avoid/Fold | — | 80 sonst unzureichend |

Ohne Purge wirkt n ~3× zu groß.

---

## 11. Implementierungsschnitt (Phasen)

### Phase 0 — Vertrag (0,5 Tag)

- Signalregel `signal_v1` aus Summary ziehen, eine Funktion
- Typen in `shared/schema.ts`
- Dieses Dokument als Quelle der Wahrheit; BACKLOG-Zeile umbiegen

### Phase 1 — Snapshot + Parity (1–1,5 Tage)

- `ScoringSnapshot` nach jedem `/api/analyze` in SQLite
- `replayAt` für **heute** muss bitgleich `buildScoringForAnalysis` treffen
- Test: `test-backtest-replay-parity.ts` auf MSFT, NKE, ASML, RHM.DE

### Phase 2 — PIT-Universum (1,5–2 Tage)

- FMP historical prices + income quarterly mit Datum
- `inUniverse`, delisted + Terminal-Return
- Zwei Event-Sets naive/corr
- Laboruniversum zuerst: S&P 500 constituents-historical (ein Markt, weniger FX)

### Phase 3 — T1/T2 ohne LLM (2 Tage)

- Monatliche Replay-Stützstellen 2021–2026, ohne Katalysatoren
- `cluster.ts` + `walkforward.ts` + Purge
- Report: δ_t, Δ_Fold, Gap naive/corr, Profile-Strata, coverage_T
- Tests: Cluster-Fixture, Purge-Leakage, Survivorship-Fixture

### Phase 4 — Kalibrierungs-UI intern (1 Tag)

- Eine Seite: Headline Δ_6M_corr Median, Mean-Nebenwert, Gap, n, Folds
- Kein Marketing-Chart bevor Phase 3 grün

### Phase 5 — T3 Policy + Kosten (1,5 Tage, nach T2-Vorzeichen)

- Quartals-Rebalance, `cost_v1`, Equity Curve analog `WORK_PORTFOLIO_BACKTEST.md`
- Gross/Net-Spalten
- Erst hier Broker-Claim „Modell steuert Depot“

### Phase 6 — Fiscal-Bridge Replay (0,5–1 Tag)

- `fiscal-bridge.ts` verdrahten: Programm nur aktiv bei `publishedAt ≤ T`
- AI-Capex-Fixtures müssen `qualifies=false` bleiben (bereits Testidee in Scoring-Vorlage)

**Nicht in v1:** Grid-Search über 20 Gap-Werte, Multi-Benchmark-T3, Intraday, Shorts, Russell 2000.

---

## 12. API-Skizze

```
POST /api/backtest/run
{
  "universe": "sp500_pit",
  "from": "2021-01-01",
  "to": "2026-06-30",
  "horizonDays": 126,
  "mode": "t2_signal",
  "survivorship": "corrected",
  "scoringVersion": "v1"
}

GET /api/backtest/report?runId=...
→ FoldResult[] + headline Δ_med_corr + Δ_mean_corr + gap + coverage + strata
```

Kein LLM im Run-Pfad.

---

## 13. Testdesign (Acceptance)

```
[ ] replay(ticker, today) === live scoring fields (Score, gates, cappedBy)
[ ] kein Ticker in U_corr(T) mit cap_T < 1e9 oder listingDate > T
[ ] Delist in (T, T+h] hat Terminal-Return; Event bleibt
[ ] Train-Label-Ende + purge ≥ h ≤ erstes Test-as-of
[ ] δ_t nur wenn n_avoid≥8 und n_buy≥8
[ ] Headline = median(Δ_Fold) auf corr, Mean und naive daneben
[ ] Banken/neg. FCF: dcfApplicable false → kein Buy aus invDCF
[ ] Fiscal-Replay ohne datierte Quelle: DCF_REALITY ungemildert
[ ] cost_v1 nur T3 (und T2-Nebenzeile), nicht T1
[ ] Änderung GATE_THRESHOLDS erzeugt scoringVersion ≠ v1
[ ] n Avoid/Fold < 80 → Status insufficient_data, keine Pitch-Zahl
```

---

## 14. Report-Vertrag (was ihr nach Phase 3 sagen dürft)

Erlaubt:

> Auf [n] Monats-Clustern, Universum PIT Cap≥1 Mrd., Horizont 126, Purge 126,
> Walk-Forward 3 Test-Folds, Survivorship-corr:
> Cluster-Median Δ_6M Avoid−Buy = [x] pp
> (Mean [y] pp; Surv-Gap [g] pp; software […]; cyclical […]).

Verboten bis die Tabelle steht:

- „Avoid verhindert Story-Buys“ ohne n/Folds
- Train-Δ als Kundenclaim
- Netto-Alpha ohne T3+Kosten
- Eine gepoolte Regression über überlappende Ticker-Monate als Beweis

---

## 15. Aufwand

| Phase | Aufwand |
|---|---|
| 0 Vertrag + Signal extrahieren | 0,5 T |
| 1 Snapshot + Parity | 1–1,5 T |
| 2 PIT-Universum + Delist | 1,5–2 T |
| 3 T1/T2 Cluster + WF + Purge | 2 T |
| 4 interne Kalibrierungsseite | 1 T |
| 5 T3 + cost_v1 | 1,5 T |
| 6 Fiscal-Bridge Replay | 0,5–1 T |
| **v1 ohne T3/UI** | **~5–6 T** |
| **v1 inkl. T3 + UI** | **~8–9 T** |

---

## 16. Ein-Satz-Designabsicht

> Dieselbe Scoring-Funktion wie live, auf dem Universum das an T existierte,
> mit Labels die T nicht kennen, mit einer Stimme pro Monat statt pro überlappendem Ticker,
> und einer Headline die Tote mitzählt — sonst ist „Avoid wirkt“ nur In-Sample-Prosa.

**Regel:** Dokumentation. Implementierung lokal → Tests grün → PR.
Schwellen nur als neue `scoringVersion`, nie still im Replay.
