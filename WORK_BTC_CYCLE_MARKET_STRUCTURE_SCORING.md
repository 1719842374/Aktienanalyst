# WORK — Zyklus-Antizipation, Market Structure & Technical-Confirmation Layer

> **Stand:** 13.11.2026  
> **Status:** Spezifikation / Implementierungsauftrag — noch keine Codeänderung  
> **Zielprojekt:** Aktienanalyst  
> **Betroffene Bereiche:** Technische Analyse, Trend-Multiplikator, Scoring-Gates, Erklärbarkeit, Datenqualität und Backtesting  
> **Branch:** `work/btc-cycle-market-structure-scoring`  
> **Wichtig:** Die Bitcoin-Beobachtung ist zunächst ein Research-Case für Marktstruktur und Timing. BTC-Daten dürfen nicht unbesehen in einzelne Aktien-Scores einfließen. Für Aktien werden entsprechende Signale nur aus dem jeweils passenden Instrument (Aktie, Benchmark, Sektor-ETF, Volatilitäts-/Kreditdaten) abgeleitet.

---

## CHAT-SCOPE-KLARSTELLUNG (13.11.2026) — maßgeblicher Produktumfang

Diese Datei bleibt der **BTC-Research- und Datenanhang**. Für Produktimplementierung und Long-only-Scope ist `WORK.md` maßgeblich, insbesondere „CHAT-ERGÄNZUNG 13.11.2026“. Die beiden Dateien dürfen nicht als Aufforderung zu einer quantitativen Handelsstrategie gelesen werden.

**Verbindlicher Scope:**
- Kein Python, keine Tradingstrategie, kein quantitativer Rendite-Backtest oder Parameter-Fitting.
- Keine separate große Market-Structure-Engine: Wiederverwendung der bestehenden technischen Daten und der Cross-Logik.
- Aktien-Sektion 12: Signalbestätigung / Konfliktstatus für Golden und Death Cross, Volumen, Relative Stärke gegen Sektor/Benchmark, Marktbreite sofern verfügbar.
- Der bestehende 4/4-Score, Fundamental Quality Score, Trendmultiplikatoren und Gate-Caps bleiben im ersten Release unverändert.
- BTC-spezifische Funding-, Open-Interest-, Liquidations- und ETF-Daten bleiben BTC-Kontext und werden nicht auf Einzeltitel-Scores übertragen.
- Deterministische Softwaretests und manuelle historische Plausibilitätsprüfung sind erwünscht und sind ausdrücklich **keine** Trading-Backtests.

**Korrektur zur ursprünglichen Research-Roadmap:** Die früheren Abschnitte „Backtest- und Validierungsplan“, „Walk-forward“, Renditeoptimierung sowie vorgeschlagene zusätzliche Score-Caps sind Research-Ideen aus der ersten Fassung und **nicht Teil des aktuellen freigegebenen Umsetzungsumfangs**. Sie dürfen nicht gegen die Long-only-Anweisung in `WORK.md` umgesetzt werden.

**Fakten-/Datenhinweis:** Alle BTC-Werte im Snapshot vom 13.11.2026 sind historische Momentaufnahmen aus den im Abschnitt 17 aufgeführten Aggregatorquellen. Sie sind keine Live-Werte, die im Code hardcodiert werden dürfen. Der Wert „BTC-OI in BTC/Kontrakten +0,51 %“ ist getrennt vom USD-OI (−5,92 %) zu führen. Liquidationsanteil (95 % Longs) beschreibt realisierte Liquidationen, nicht die vollständige offene Marktpositionierung.

---

## 1. Auftrag und Zusammenfassung

Die technische Analyse und die Scoring-Gate-Logik sollen künftig zwischen folgenden Sachverhalten unterscheiden:

1. **Trend-/Mustererkennung:** Preis und gleitende Durchschnitte ähneln einer historischen Zyklusphase.
2. **Antizipation / Vorlauf:** Ein technisches Signal (z. B. Golden Cross) tritt zeitlich früher auf als im historischen Vergleich oder bevor andere Bestätigungskriterien erfüllt sind.
3. **Crowded positioning:** Viele Marktteilnehmer sind in dieselbe Richtung positioniert; Open Interest, Funding und Long/Short-Verteilung zeigen ein asymmetrisches Risiko.
4. **Liquidationsereignis:** Zwangsliquidationen verstärken eine Bewegung. Das kann Longs oder Shorts treffen.
5. **Bestätigung:** Spot-Nachfrage, Volumen, Marktbreite, Trendstruktur, Makro-Liquidität und Folgeperioden bestätigen eine nachhaltige Wende.
6. **Fehlende Bestätigung / False positive:** Ein Golden Cross oder ähnliches Muster tritt auf, ohne dass die übrigen Bestätigungen vorliegen.

Die Kernhypothese aus der BTC-Beobachtung lautet:

> Marktteilnehmer und regelbasierte Systeme könnten einen erwarteten historischen Zyklus-/Tiefpunkt zeitlich vorwegnehmen. Dadurch könnten technische Muster und Positionierungen früher auftreten als in der Vergleichsperiode. Wenn ein großer Teil des Marktes denselben historischen Zeitpunkt oder dasselbe Muster handelt, kann der Trade crowded werden. Eine Liquidationskaskade kann das erwartete Ereignis zeitlich vorziehen, aber auch nur eine Zwischenkorrektur erzeugen.

Diese Hypothese ist **nicht als bewiesene Algorithmen-Kausalität** zu behandeln. Der Code darf nicht behaupten, Algorithmen hätten historische Daten „übertragen“ oder bewusst ein Tief vorgezogen. Er soll beobachtbare Signale erfassen, die Hypothese quantifizierbar machen und konkurrierende Erklärungen ausweisen.

### Gewünschtes Ergebnis in der Produktanalyse

- Technische Sektion: klare Kennzeichnung „technisch vorlaufend / noch unbestätigt“.
- Scoring: keine automatische bullische oder bearische Umkehr allein aufgrund eines Golden Cross, Death Cross, Kalendermonats oder historischen Zyklusdatums.
- Gate-Logik: Crowd-/Liquidations-Stress kann Risiko und Score begrenzen; die Bereinigung selbst ist **kein** Kaufsignal.
- Bestätigungslogik: ein möglicher Boden wird erst nach unabhängigen Bestätigungen als bestätigt geführt.
- Erklärung: Rohdaten, Quelle, Zeitraum, Datenalter, Berechnung, Schwellen und fehlende Werte müssen nachvollziehbar sein.

---

## 2. Projektbestand und Integrationspunkte (Code-Fakten)

Der Projektcode enthält bereits passende Grundlagen:

| Bereich | Vorhandene Datei / Funktion | Relevanz |
|---|---|---|
| Technischer BTC-Chart | `client/src/lib/btcAnalysis.ts` | Berechnet SMA/EMA, RSI, MACD, BTC-spezifische MAs und technische Signale. |
| BTC-Dashboard | `client/src/pages/BTCDashboard.tsx` | Rendert technische Chart-Sektion, Signalmarker und BTC-Makro-Overlays. |
| BTC-Liquidität | `shared/btc-liquidity.ts`, `server/btc-macro.ts` (abhängig von bestehendem Datenfluss) | WALCL/Bills/DGS10/QE-QT-Kontext. |
| Technische Aktienanalyse | `client/src/components/sections/TechnicalChart.tsx` / zugehörige Analyse- und Schema-Dateien | Aktien-Chart und technische Signale; vor Implementierung genaue aktuelle Datenkette prüfen. |
| Scoring-Gates | `server/scoring-gates.ts` | Generisches `Gate`-Interface, `applyGates()`, `buildGates()`, Caps und Thresholds. |
| Scoring-Integration | `server/scoring-integration.ts` | Mappt vorhandene technische Indikatoren über `mapTrendMultiplier()` in Score. |
| Gemeinsame Typen | `shared/schema.ts` | Analyse-/Technik-Datenmodell; neue Felder nur additiv und rückwärtskompatibel. |
| Scoring-Vorlage | `WORK_SCORING_VORLAGE.md` | Kanonische Vorgaben zu Gates, Caps und Lookahead-Sperren. |
| Arbeitsindex | `WORK.md` | Index/Status-Referenz; nach Implementierung mit Commit/Testergebnis nachziehen. |

### Bereits vorhandene Trendlogik (Code-Fakt)

In `server/scoring-integration.ts` ist derzeit dokumentiert:

- UPTREND: Kurs > MA200 **und** MA50 > MA200 → `trendMultiplier = 1.10`
- NEUTRAL: gemischte Signale → `1.00`
- DOWNTREND: Kurs < MA200 → `0.90`

Diese Regel bleibt als Baseline erhalten. Der neue Layer ergänzt sie um Signalqualität, Vorlauf, Crowding und Bestätigung. Er darf nicht stillschweigend die Bedeutung bestehender Regeln ändern.

In `server/scoring-gates.ts` existieren bereits generische Gates mit `id`, `active`, `cap`, `severity` und `rationale`. `applyGates()` deckelt über den strengsten aktiven Cap. Neue Gates müssen in diese Infrastruktur passen und benannte Schwellen verwenden.

**Vor Codeänderung zwingend:** Aktuelle `main`-Version der oben genannten Dateien erneut lesen, exakte Aktien-Technical-Data-Flow-Kette nachvollziehen und Tests/Schema-Konventionen prüfen. Diese Spezifikation ist kein Ersatz für Code-Review.

---

## 3. Research-Fall BTC: Fakten und Grenzen (Snapshot 13.11.2026)

### 3.1 2022-Referenz

Laut CoinGlass betrug der BTC-Jahresstart 2022 rund **46.311,7 USD**, der Jahresendkurs **16.547,5 USD**, die Jahresperformance **−64,27 %**. Das ausgewiesene Jahrestief lag am **21.11.2022 bei 15.599 USD**. Monatsendkurse: Oktober 2022 **20.495,8 USD**, November **17.168,6 USD**, Dezember **16.547,5 USD**. Quelle: CoinGlass Historical Data 2022, Abruf 13.11.2026.

Wichtige Präzisierung: Das Tief von 2022 lag nach dieser Datenquelle am 21. November, nicht „normalerweise erst im Dezember“. Die Behauptung, Dezember sei der erwartete Tiefmonat, darf daher nicht als historischer Fakt kodiert werden. Zyklusanalysen können unterschiedliche Definitionen (Intraday-Low, Close, lokales Tief, später bestätigtes Tief) verwenden.

Weitere historische Liquidationsreferenz: CoinDesk berichtete am 14.06.2022 über ca. **532 Mio. USD BTC-Liquidationen** und einen Rückgang des Open Interest um ca. **7 % binnen 24 Stunden**. Die damalige Liquidationsverteilung war nicht identisch mit der aktuellen einseitigen Long-Liquidation. Daher kein 1:1-Vergleich.

### 3.2 Snapshot 13.11.2026 — aggregierte BTC-Derivate (CoinGlass)

CoinGlass-Snapshot, am 13.11.2026 gegen 08:41 UTC (Daten ändern sich laufend):

| Messgröße | Wert | Interpretation / Caveat |
|---|---:|---|
| BTC-Spotpreis | ca. **68.828 USD** | Snapshot-Wert; kein Tagesendkurs. |
| 24h Preisänderung | **−6,40 %** | Starker kurzfristiger Preisrückgang. |
| BTC-Futures-Open-Interest | **47,86 Mrd. USD** | Aggregierter USD-Wert über erfasste Börsen. |
| USD-OI-Veränderung 24h | **−5,92 %** | Dollar-OI fällt; allein keine saubere Positionszählung. |
| OI in BTC/Kontraktperspektive | ca. **+0,51 %** | CoinGlass ordnet den 24h-Zustand als Short-Build-up ein. |
| 24h Liquidationen | **919,15 Mio. USD** | Aggregierter Snapshot; Coverage und Nachmeldungen beachten. |
| Anteil Long-Liquidationen | **95 %** | Starke Long-Liquidationsasymmetrie. |
| Funding Rate (OI-gewichtet, 8h) | **−0,0004 %** | Nahe null / leicht negativ; Aggregat, Börsen divergieren. |
| Futures-Volumen 24h | **94,71–101,53 Mrd. USD** | Abweichung je Snapshot/Uhrzeit/Abdeckung; nicht als einzelne exakte Zahl verwenden. |
| BTC-Abstand zur 200-DMA | ca. **−5,8 %** | Technischer Kontext, Anbieterberechnung prüfen. |
| Spot-Taker-Nettofluss | ca. **−626,76 Mio. USD** | Nettoverkaufsdruck in CoinGlass-Snapshot. |
| US-Spot-ETF-Nettofluss 12.11.2026 | **−47,70 Mio. USD** | CoinGlass als „partial“ gekennzeichnet; nicht final. |

**Wichtige OI-Regel:** USD-OI kann durch Preisrückgang sinken, selbst wenn die Anzahl der offenen BTC-Kontrakte zunimmt. Für die Zustandsklassifikation müssen daher mindestens USD-denominiertes OI und coin-/kontrakt-denominiertes OI getrennt gespeichert und interpretiert werden. Beispiel 13.11.2026: BTC-Preis fällt, USD-OI fällt, OI in BTC steigt. Das ist nicht einfach „Long-Positionsabbau“, sondern kann mit neuer Short-Eröffnung zusammenfallen.

Andere Anbieter zeigten am selben Morgen abweichende Werte (z. B. ca. 789 Mio. USD Liquidationen und 97 % Longs auf einem anderen Börsen-/Datensatz-Scope). Abweichungen kommen aus Börsenabdeckung, Zeitfenster, Update-Zeitpunkt und Aggregationslogik. Daher niemals Anbieterwerte vermischen, ohne Scope und Timestamp zu speichern.

### 3.3 Schlussfolgerung aus dem Snapshot

Belegt ist:
- starker kurzfristiger BTC-Kursrückgang;
- große und überwiegend Long-seitige Zwangsliquidationen;
- hohe Futures-Aktivität;
- negative oder neutrale Funding-Rate je nach Aggregator;
- USD-OI und BTC-OI können gegensätzliche Signale liefern;
- Spot-Nettoverkäufe und ETF-Abflüsse können parallel wirken.

Nicht belegt ist:
- dass Algorithmen denselben Chart von 2022 „kopiert“ haben;
- dass der Markt das Zyklustief gezielt von Dezember in November verlegt hat;
- dass ein Golden Cross allein den Zykluswechsel bestätigt;
- dass die Liquidationswelle bereits das endgültige Tief markiert;
- dass BTC-Derivatepositionen direkt die Scores einzelner Aktien bestimmen.

---

## 4. Hypothesen als messbare Research-Fragen

### H1 — Historischer Zyklus-Vorlauf
Technische Ereignisse (z. B. Golden Cross, Death Cross, RSI-Regimewechsel, MA-Reclaim) treten in einem späteren Zyklus früher relativ zu einem definierten Zyklusanker auf als in der Referenzperiode.

**Test:** Event-Zeit relativ zu Halving, Zyklus-Peak und nachfolgendem Low; keine festen Monatsannahmen. Ergebnis in Tagen und als Anteil der Zyklusdauer darstellen.

### H2 — Crowded Positioning erhöht die Tail-Risk-Sensitivität
Hohe OI/Market-Cap-Perzentile, extreme Funding-Rates und einseitige Long/Short-Verteilungen erhöhen die Wahrscheinlichkeit, dass eine kleine Gegenbewegung zu überproportionalen Liquidationen führt.

**Test:** Forward-Return-Verteilungen, maximale adverse Bewegung und Liquidationsintensität nach Perzentil-Buckets vergleichen.

### H3 — Liquidation Flush ist nicht gleich Boden
Nach großen Long-Liquidationen kann der Markt weiter fallen, seitwärts laufen oder drehen. Das Liquidationsereignis allein hat keine bullische Richtung.

**Test:** Forward Returns 1D/3D/5D/10D/20D nach Liquidationsereignissen; getrennt nach Spot-Flow, OI-Veränderung, Funding und Trendbestätigung.

### H4 — Golden Cross ohne Bestätigung ist ein schwächeres Signal
Ein Golden Cross mit schwacher Spot-Nachfrage, negativem Marktbreiten-/Sektortrend, weiter fallendem Kurs unter MA200 oder erhöhtem Volatilitätsstress soll geringer gewichtet werden als ein Cross mit Bestätigungen.

**Test:** Cross-Events in confirmed vs. unconfirmed klassifizieren; False-positive-Rate und Forward Returns messen.

### H5 — Crowding kann das erwartete Ereignis vorziehen
Wenn viele Marktteilnehmer dieselbe historische Zyklusphase antizipieren, kann die Positionierung vor dem kalenderbasiert erwarteten Datum aufgebaut und anschließend liquidiert werden.

**Test:** OI/Funding-Anomalien und Positionierungswechsel relativ zu Zyklusdaten messen. Kausalität darf aus Korrelation nicht abgeleitet werden.

---

## 5. Definitionen / Berechnungen

### 5.1 Trend und Moving Averages

- Golden Cross: SMA50 kreuzt SMA200 von unten nach oben.
- Death Cross: SMA50 kreuzt SMA200 von oben nach unten.
- `cross_date`: erster Tagesabschluss, an dem das Verhältnis gewechselt hat; keine Intraday-Vorwegnahme.
- `cross_distance_pct = (SMA50 / SMA200 - 1) * 100`.
- MA200-Abstand: `(close / SMA200 - 1) * 100`.
- Trendvorlauf: zeitliche Abweichung eines Ereignisses gegenüber dem gleichen, vorher explizit definierten Ereignis im Referenzzyklus.
- Signalalter: Handelstage seit Cross. Ein 40 Handelstage altes Golden Cross ist nicht „frisch“.

Kein Cross wird allein als „Boden“ bezeichnet. Event-Labels: `EARLY_BULL_CROSS`, `EARLY_BEAR_CROSS`, `UNCONFIRMED_CROSS`, `CONFIRMED_CROSS`, `STALE_CROSS`.

### 5.2 Open Interest

Pro Symbol und Börse/Quelle getrennt speichern:
- `open_interest_usd`
- `open_interest_coin` bzw. Kontraktanzahl
- `oi_change_1d_pct`, `oi_change_7d_pct`
- `oi_market_cap_pct`
- `oi_percentile_1y` (nur bei ausreichender Historie)
- `exchange_coverage`, `source_scope`, `timestamp`

Interpretationsmatrix:

| Preis | Coin-/Kontrakt-OI | Vorläufige Lesart |
|---|---|---|
| steigt | steigt | neue Positionen / Long-Build-up möglich; Funding/Positioning prüfen |
| steigt | fällt | Short-Covering möglich |
| fällt | steigt | neue Positionen / Short-Build-up möglich |
| fällt | fällt | Deleveraging / Positionsabbau möglich |
  
Diese Lesarten sind keine sicheren Identifikationen einzelner Händlerpositionen. Funding und Liquidationsdaten ergänzen, nicht ersetzen.

**Pflicht:** Wenn nur USD-OI vorhanden ist und der Preis stark schwankt, OI-Zustand auf `AMBIGUOUS` setzen; kein hartes Gate aus USD-OI allein.

### 5.3 Funding und Positionierungsasymmetrie

Speichern:
- aggregierte, OI-gewichtete Funding Rate (klar definierter 8h- oder Annualized-Standard);
- Börsenwerte separat;
- Funding-Perzentil (mind. 180/365 Tage);
- Long/Short Account Ratio und/oder Position Ratio, jeweils mit Kennzeichnung, ob Anzahl Accounts oder Notional;
- Quelle und Update-Zeit.

Nicht verschiedene Funding-Intervalle vergleichen, ohne auf dieselbe Einheit zu normieren. Ein positiver Funding-Wert ist nicht automatisch „überhebelt“; Perzentile und Dauer der Extremposition sind entscheidend.

### 5.4 Liquidationen

- `liquidations_total_usd`
- `liquidations_long_usd`
- `liquidations_short_usd`
- `long_liquidation_share`
- `liquidation_to_futures_volume_pct`
- Zeitfenster 1h, 4h, 24h; nicht mischen.
- Event-Perzentil gegenüber eigener Historie.

Liquidation-Spike nur aktiv, wenn Quelle/Scope/Zeitfenster bekannt sind und die Daten vollständig genug sind. Long-Liquidations-Spike bedeutet Zwangsverkäufe von Long-Positionen, aber nicht automatisch endgültige Kapitulation oder Boden.

### 5.5 Spot-Bestätigung / Marktbreite

Mindestens:
- Spot-Taker-Buy/Sell oder Netto-Taker-Flow;
- Spot-Volumen vs. Futures-Volumen;
- Börsen-Netflows, sofern valide;
- ETF-Nettoflüsse, wenn das Instrument BTC ist;
- bei Aktien: Benchmark-/Sektor-ETF-Breite, Advance/Decline, relative Stärke und Volumenbestätigung.

ETF-Flows gehören **nur** in BTC-/Krypto-Analyse. Für Einzelaktien keine ETF-BTC-Flows als firmenspezifisches Signal einsetzen.

---

## 6. Technische Analyse — neue Darstellung und Interpretation

### 6.1 Neue Teilkomponente: Market Structure & Confirmation

Zusätzlich zu bestehenden Trend-, RSI-, MACD- und Volumen-Signalen soll die technische Analyse einen separaten Block zeigen:

1. **Trendstatus:** MA50/MA200, Preis vs. MA200, Cross-Datum und Alter.
2. **Vorlaufstatus:** Ist das Cross früher als im festgelegten historischen Vergleich? Ausgabe in Tagen/Prozent der Zyklusdauer; nur bei sauberem Anchor.
3. **Positioning/Crowding:** OI/Market-Cap-Perzentil, OI-Veränderung in USD und Coin/Contracts, Funding-Perzentil, Long/Short-Notional/Accounts.
4. **Liquidationsdruck:** Long-/Short-Anteil sowie Liquidationen relativ zu Futures-Volumen und historischem Perzentil.
5. **Spot-Bestätigung:** Spot-Taker-Flow, Spot-Volumen, ETF-Flow (BTC-Only) bzw. Marktbreite bei Aktien.
6. **Bestätigungsgrad:** `UNCONFIRMED`, `PARTIALLY_CONFIRMED`, `CONFIRMED`, `CONFLICTED`, `UNAVAILABLE`.

### 6.2 Golden Cross / Death Cross: Bestätigungsregeln

Ein Cross erhält zunächst nur einen technischen Event-Status. Eine bestätigte bullische Einordnung setzt mindestens zwei voneinander unabhängige Bestätigungsfamilien voraus, darunter mindestens eine nicht rein preisbasierte:

- Preis hält den MA200 zurück oder schließt an mindestens 3 von 5 Folgetagen darüber (konfigurierbar/backtestbar);
- Spot-Käufe/Spot-Volumen bestätigen (bei BTC);
- Relative Stärke gegen Benchmark/Sektor steigt (bei Aktien);
- Marktbreite verbessert sich;
- MACD-Histogramm steigt über mehrere Perioden oder Momentum dreht positiv;
- Volatilität normalisiert sich nach Stress, ohne dass das Volumen kollabiert.

**Nicht ausreichend:** Golden Cross + RSI allein, oder Golden Cross + nur kalenderbasierte Zykluserwartung.

Unbestätigtes Cross:
- bleibt im Chart sichtbar;
- darf den Trendmultiplikator nicht auf den maximal bullischen Wert heben;
- soll in der technischen Zusammenfassung als „Vorlaufsignal ohne ausreichende Bestätigung“ erklärt werden.

### 6.3 Visuelle Elemente

Vorschlag für die technische Sektion:
- Cross-Marker mit Datum und Signalalter.
- Badge „früh / vorlaufend“ nur wenn historische Zeitreihen tatsächlich verglichen wurden.
- Bestätigungsleiste mit unabhängigen Familien (Trend, Spot/Volumen, Relative Stärke/Breite, Derivate, Makro).
- Crowding- und Liquidationspanel bei verfügbaren Derivate-Daten.
- Tooltip: Rohwert, Einheit, Zeitraum, Quelle, Timestamp, Percentile, Limitations.
- Datenlücke sichtbar als „nicht verfügbar“, niemals als 0 oder neutraler Messwert.

---

## 7. Neue Scoring-Komponente: Market Structure Quality

### 7.1 Leitlinie

Die bestehende Fundamental-Quality bleibt der Anker. Market Structure soll den Trendmultiplikator feinjustieren bzw. begrenzte Soft-Gates liefern. Es soll weder Unternehmensqualität noch Bewertung ersetzen.

**Empfehlung für Phase 1:** nur Anzeige/Telemetry und Warn-Gates, ohne zusätzliche Score-Wirkung.  
**Phase 2:** nach Backtest maximal kleiner Multiplikator-Effekt.  
**Phase 3:** erst nach stabiler Out-of-sample-Validierung begrenzte Score-Caps.

### 7.2 Score-Modell (Vorschlag, nicht live)

`marketStructureScore ∈ [-1, +1]` aus vier unabhängigen Subscores:

| Komponente | Gewicht | Inhalt |
|---|---:|---|
| Trend-Confirmation | 35 % | MA-Struktur, Cross-Alter, Preis vs. MA200 |
| Spot / Breadth Confirmation | 30 % | Spot-Flow/Volumen; bei Aktien RelStrength/Market Breadth |
| Positioning / Crowding | 20 % | OI-Perzentil, Funding-Perzentil, Long/Short-Skew |
| Liquidation / Volatility Stress | 15 % | Liquidation-Spikes, Volatilitätsstress, Nachlaufverhalten |

Gewichte sind Startwerte für Forschung, keine kalibrierte Wahrheit. Fehlende Subscores dürfen nicht auf 0 gesetzt werden. Gewichte der verfügbaren Komponenten werden nur nach dokumentierter Renormalisierung angepasst; zugleich `coverage_pct` ausgeben. Unter 60 % Coverage ist der Score `UNAVAILABLE` und nicht scorewirksam.

Beispiel-Skala:
- +1,0: klar bestätigter Aufwärtstrend mit Spot-/Breitenbestätigung, kein extremes Crowding;
- 0: gemischt / neutral;
- −1,0: bestätigter Abwärtstrend bzw. erheblicher, bestätigter Stress.

**Liquidation Flush-Sonderregel:** Ein hoher Liquidationswert darf nie direkt als positiver Teilscore gewertet werden. Er ist ein Stressereignis. Ein positives Reversal-Signal entsteht erst aus nachfolgenden Bestätigungen.

### 7.3 Begrenzter Multiplikator (Phase 2, nur nach Backtest)

Vorgeschlagene Bandbreite:
- bestätigt bullisch: zusätzlich maximal +0,02;
- neutral/unbestätigt: 0;
- bestätigter Stress / bearish: maximal −0,03.

Die bestehende Baseline `TREND_RULES` bleibt erhalten. Der additive Overlay-Effekt ist auf einen Gesamtmultiplikator von 0,87 bis 1,12 zu begrenzen. Keine additive Score-Wirkung, bevor Backtest-Akzeptanz erfüllt ist.

---

## 8. Scoring-Gates — Vorschlag für `server/scoring-gates.ts`

Gates sind zunächst Warn-Gates (severity `warn`) und nur nach Validierung scoredeckelnd. Ein Gate braucht eine konkrete Begründung, Datenquellen, Zeitstempel und Konfidenz.

### 8.1 Gate-Kandidaten

| Gate-ID | Aktivierungsbedingung (Startwerte) | Phase-1-Wirkung | Phase-2 Cap (Vorschlag) |
|---|---|---|---:|
| `TECH_CROSS_UNCONFIRMED` | Golden Cross jünger als 20 Handelstage, aber weniger als 2 unabhängige Bestätigungsfamilien | Warnung; kein Bull-Bonus | 75 |
| `MARKET_CROWDING_LONG` | OI/Market-Cap >= 90. Perzentil (1Y) UND Funding >= 90. Perzentil ODER Long-Notional-Skew >= 80. Perzentil | Warnung / Stressflag | 70 |
| `LIQUIDATION_CASCADE` | 24h-Liquidationen >= 95. Perzentil und Long-Share >= 85 % bzw. Short-Share >= 85 % | Stresswarnung, Richtung separat | 70 |
| `OI_DATA_AMBIGUOUS` | USD-OI und Coin-OI widersprüchlich oder Contract-Mapping/Scope fehlt | Datenwarnung; Gate inaktiv | kein Cap |
| `CYCLE_TIMING_ADVANCE` | Cross-/Event-Abstand zur definierten historischen Referenz deutlich früher als Referenz (z. B. > 15 % der Zyklusdauer) | Research-Flag, kein Score | kein Cap |
| `MARKET_CONFIRMATION_MISSING` | Trend-Event vorhanden, aber unabhängige Bestätigung < 2 Familien | verhindert Trendbonus | 75 |
| `MARKET_STRESS_CONFIRMED` | mindestens zwei unabhängige Stressfamilien, z. B. Trend + Spot/Breadth + Volatilität/Derivate | Warnung | 60–70 nach Backtest |

### 8.2 Wichtig: Richtung des Gates

- `MARKET_CROWDING_LONG` ist ein Downside-Tail-Risk-Hinweis. Es kann bei fallendem Kurs und Liquidationsdruck bearish sein.
- Ein Crowd-Short-Gate ist spiegelbildlich zu modellieren und kann bei plötzlicher positiver Spot-/Trendbestätigung einen Short-Squeeze-Risikohinweis erzeugen.
- `LIQUIDATION_CASCADE` ist richtungsneutral als Ereignis. Die betroffene Seite muss separat angegeben werden.
- `CYCLE_TIMING_ADVANCE` ist **kein** Kauf-/Verkaufsgate.
- `TECH_CROSS_UNCONFIRMED` begrenzt einen möglichen Trendbonus, darf aber nicht fundamental starke Unternehmen pauschal abstrafen.

### 8.3 Aktien vs. Krypto — Scope-Guard

Für die Aktienanalyse werden BTC-Futures-Funding/OI/Liquidationen nicht für jeden Titel kopiert. Es gilt:

- Einzeltitel: Derivate-/Short-Interest-Daten nur für denselben Titel, mit passender Coverage.
- Index-/Sektorrisiko: passende Benchmark- und Sektor-ETF-Daten.
- Makroregime: VIX, Kreditspreads, Rates, Dollar, Liquidität etc. gemäß vorhandenen Researcher-/Macro-Daten.
- BTC-Derivate: ausschließlich BTC-Dashboard bzw. explizit als Cross-Asset-Makro-Kontext mit eigenem Flag, nie unkommentiert in den Einzeltitel-Score.
- Kein Symbol-spezifisches Hardcoding.

---

## 9. Datenmodell-Vorschlag

Additiv und optional in `shared/schema.ts` oder dedizierten `shared/market-structure.ts`:

```ts
type ConfirmationStatus =
  | "UNCONFIRMED"
  | "PARTIALLY_CONFIRMED"
  | "CONFIRMED"
  | "CONFLICTED"
  | "UNAVAILABLE";

type MarketStructureDirection = "BULLISH" | "BEARISH" | "NEUTRAL" | "UNKNOWN";

interface MarketStructureObservation {
  instrument: string;
  assetClass: "equity" | "index" | "crypto";
  asOf: string;
  source: string;
  sourceUrl?: string | null;
  sourceScope: string;
  dataAgeHours: number | null;
  coveragePct: number;
  priceVsMa200Pct: number | null;
  ma50VsMa200Pct: number | null;
  crossType: "GOLDEN" | "DEATH" | null;
  crossDate: string | null;
  crossAgeTradingDays: number | null;
  cycleEventLeadDays: number | null;
  openInterestUsd: number | null;
  openInterestUnits: number | null;
  oiChangeUsd1dPct: number | null;
  oiChangeUnits1dPct: number | null;
  oiMarketCapPct: number | null;
  oiPercentile1y: number | null;
  fundingRate8hPct: number | null;
  fundingPercentile1y: number | null;
  longLiquidationsUsd24h: number | null;
  shortLiquidationsUsd24h: number | null;
  longLiquidationSharePct: number | null;
  liquidationPercentile1y: number | null;
  spotFlowUsd: number | null;
  spotVolumeConfirmation: boolean | null;
  relativeStrengthPct: number | null;
  breadthConfirmation: boolean | null;
  confirmationStatus: ConfirmationStatus;
  direction: MarketStructureDirection;
  reasons: string[];
  limitations: string[];
}
```

Nicht jedes Asset liefert alle Felder. `null` bedeutet nicht verfügbar. Die Schnittstelle muss sourceScope und asOf tragen, damit Werte aus verschiedenen Aggregatoren oder Zeitfenstern nicht versehentlich kombiniert werden.

---

## 10. Datenquellen und Datenqualität

Mögliche Quellen, vor Integration anhand Lizenz/API-Verfügbarkeit und Rate Limits prüfen:

| Datenfamilie | Mögliche Quelle | Hinweise |
|---|---|---|
| BTC Spot History | bestehende Blockchain.info-/Spot-Historie, CoinGlass | bestehende BTC-Pipeline wiederverwenden, Preiseinheit/UTC klar halten. |
| BTC OI/Funding/Liquidations | CoinGlass, Börsen-APIs, aggregierte Anbieter | Abdeckung je Exchange, Vertragstyp und Datenlücken speichern. |
| ETF Flows | Farside / Issuer / Anbieter | Tagesfinalität prüfen; partial nicht als final behandeln. |
| Aktien-OHLCV / MA | bestehende FMP-/OHLCV-Pipeline | keine zusätzliche Quelle, falls aktuelle Historie ausreicht. |
| Aktien Short Interest / Optionen | lizenzierte Datenquelle | Veröffentlichungsverzug und unterschiedliche Definitionen offenlegen. |
| Marktbreite / Relative Stärke | bestehende Benchmark- und Sektorserien | konsistente Kalender/Adjusted Prices. |
| Macro Risk | FRED / vorhandene Researcher-Makroserien | Daten-Lag und Release-Datum beachten. |

### Datenqualitätsregeln

1. Timestamp in UTC; UI zusätzlich lokalisierbar.
2. Einheit und Aggregationsintervall explizit.
3. Quelle/URL, Scope, Börsenabdeckung, Partial-/Final-Status speichern.
4. Kein Forward-Fill für Derivateereignisse und Liquidationen.
5. Maximal zulässiges Alter konfigurieren; stale Daten als unavailable.
6. Keine 0-Ersatzwerte bei fehlenden Messungen.
7. Percentile erst mit Mindesthistorie (z. B. 180 Tagesbeobachtungen) rechnen; 1Y-Perzentile erst bei 250 Tagesbeobachtungen.
8. Datenprovider-Wechsel markiert Bruch in Zeitreihe und verhindert unkommentierten Backtest.
9. Preisadjustierung (Splits/Dividenden) für Aktien-MAs konsistent definieren.
10. Alle Scoring-Inputs müssen as-of-zeitlich verfügbar gewesen sein (kein Lookahead).

---

## 11. Backtest- und Validierungsplan

### 11.1 Zeiträume

- BTC-Referenz 2021–2023 inkl. 2022-Bärenmarkt.
- BTC-Zyklus 2024–13.11.2026; 2026-Low-Definition erst ex post festschreiben.
- Aktienuniversum: liquide US/EU-Aktien mit ausreichender Historie, Survivorship-Bias vermeiden.
- Ereignisfenster: Cross-Tag sowie Forward-Horizonte 1/3/5/10/20/60 Handelstage.

### 11.2 Baselines

Vergleichen:
1. bestehende MA50/MA200-Logik ohne neuen Layer;
2. MA50/MA200 + Bestätigungsfamilien;
3. MA50/MA200 + Crowding/Derivate (wo verfügbar);
4. vollständiger Market-Structure-Score;
5. Kalender-/Zyklusmodell ohne technische Signale als Nullmodell.

### 11.3 Messgrößen

- Precision/Recall für Cross-Events und Boden-/Trendwechseldefinitionen;
- False-positive-Rate von Golden Cross und „Boden“-Labels;
- Forward Return Mittelwert/Median je Eventklasse;
- Max adverse excursion / max drawdown nach Signal;
- Sharpe/Sortino und Turnover, falls Strategie-Simulation;
- Coverage und Anteil ausgeschlossener Events;
- Score-Stabilität und Gate-Frequenz;
- Performance pro Marktregime und Assetklasse.

### 11.4 Akzeptanzkriterien vor Score-Wirkung

Keine Score-Wirkung, bis alle erfüllt:
- Walk-forward statt zufälligem Train/Test-Split;
- keine Lookahead-/Survivorship-Leaks;
- Mindest-Coverage und Datenanbieter-Stabilität dokumentiert;
- Verbesserte Out-of-sample-Kennzahl gegenüber Baseline, nicht nur In-sample;
- keine unverhältnismäßige Gate-Aktivierung oder Sektorverzerrung;
- dokumentierter Review und Regressionstests.

---

## 12. Scoring-Gate Datenstruktur und Pseudocode

Pseudocode — keine direkte Codeänderung in diesem Commit:

```ts
function buildMarketStructureGates(
  input: MarketStructureObservation | null
): Gate[] {
  if (!input || input.coveragePct < 60 || isStale(input)) {
    return [{
      id: "MARKET_STRUCTURE_DATA_UNAVAILABLE",
      active: false,
      cap: 100,
      severity: "warn",
      rationale: "Insufficient or stale market-structure data"
    }];
  }

  const gates: Gate[] = [];

  const unconfirmedBullCross =
    input.crossType === "GOLDEN" &&
    (input.crossAgeTradingDays ?? Infinity) <= 20 &&
    input.confirmationStatus !== "CONFIRMED";

  gates.push({
    id: "TECH_CROSS_UNCONFIRMED",
    active: unconfirmedBullCross,
    cap: 75,
    severity: "warn",
    rationale: "Golden Cross is early/unconfirmed; no automatic bullish uplift"
  });

  const crowdedLong =
    (input.oiPercentile1y ?? -Infinity) >= 90 &&
    (
      (input.fundingPercentile1y ?? -Infinity) >= 90 ||
      (input.longLiquidationSharePct ?? 0) >= 80
    );

  gates.push({
    id: "MARKET_CROWDING_LONG",
    active: crowdedLong,
    cap: 70,
    severity: "warn",
    rationale: "Crowded long positioning increases downside tail risk"
  });

  const liquidationSpike =
    (input.liquidationPercentile1y ?? -Infinity) >= 95 &&
    (
      (input.longLiquidationSharePct ?? 0) >= 85 ||
      (input.longLiquidationSharePct ?? 0) <= 15
    );

  gates.push({
    id: "LIQUIDATION_CASCADE",
    active: liquidationSpike,
    cap: 70,
    severity: "warn",
    rationale: "Extreme one-sided liquidation event; direction is not a reversal signal"
  });

  return gates;
}
```

**Pseudocode-Reviewhinweise:**
- Beispiel dient nur als Struktur, nicht zur direkten Übernahme.
- Fehlende Werte dürfen keine Schwellen erfüllen. `Infinity`-/Null-Coalescing-Ausdrücke sind im Produktionscode gegen negative/positive Fehlinterpretationen zu prüfen.
- `longLiquidationSharePct` alleine kann keine Crowding-Position beweisen: es beschreibt realisierte Liquidationen, nicht offene Positionen.
- Liquidation-Cascade benötigt ein eigenes `liquidationSharePct` für die dominierende Seite statt nur Long-Anteil.
- `sourceScope` und `asOf` müssen für alle Subsignale kompatibel sein.

---

## 13. Tests (Pflicht)

Neue Tests mindestens:

1. Golden Cross ohne Bestätigung → Event sichtbar, kein bullischer Trendbonus.
2. Golden Cross mit 2 unabhängigen Bestätigungsfamilien → `CONFIRMED`.
3. Cross über 20 Tage alt → `STALE_CROSS`, Unconfirmed-Gate nicht mehr allein aufgrund des Alters aktiv.
4. Death Cross und überverkauftes RSI → nicht automatisch bullisch.
5. Hoher USD-OI bei fallendem Preis, aber steigendem Coin-OI → OI-Status `SHORT_BUILD_UP`/ambiguous according to provider contract mapping; niemals „Longs geschlossen“ allein aus USD-OI.
6. Fallender Preis + fallendes Coin-OI + Long-Liquidationen → Deleveraging-Kandidat, keine automatische Bodenbestätigung.
7. Liquidationsspike ohne Spot-Reversal → Stressflag bleibt, kein Buy-Signal.
8. Negative Funding Rate nach Long-Liquidation → nicht automatisch „Short Crowding“; Perzentil/Long-Short-Notional ergänzen.
9. Partial ETF flow → im UI partial label, nicht als finaler Wert.
10. Stale/fehlende Daten → keine 0-Füllung, kein Gate-Cap.
11. Gemischte Provider/Timeframes → observation unavailable/invalid.
12. Aktieninstrument ohne Derivateabdeckung → technischer Aktien-Score läuft ohne Krypto-OI/Liquidationseinfluss.
13. Aktien-Split/Dividenden-Adjustierung → Cross-Datum und MA identisch zur OHLCV-Konvention.
14. As-of-Test: Daten mit `publishedAt` nach `asOfDate` dürfen nicht in Signal/Backtest einfließen.
15. Regressionsschutz der bestehenden `TREND_RULES` und aller vorhandenen Gate-Caps.

---

## 14. UI-/Erklärtext (Vorschläge)

**Frühes Golden Cross:**
> Technisches Vorlaufsignal: Der 50-Tage-Durchschnitt liegt über dem 200-Tage-Durchschnitt. Die unabhängigen Bestätigungen (Spot-/Volumenverhalten, relative Stärke und/oder Marktbreite) sind noch nicht vollständig. Das Signal wird deshalb nicht als bestätigter Trendwechsel gewertet.

**Crowded Longs:**
> Erhöhte Long-Konzentration: Open Interest und Funding liegen im oberen historischen Bereich. Bei einer Gegenbewegung kann zusätzlicher Verkaufsdruck durch Zwangsliquidationen entstehen. Das ist ein Risikohinweis, keine Kursprognose.

**Liquidationsereignis:**
> Außergewöhnliche Liquidationen wurden registriert. Liquidationen verstärken Kursbewegungen, belegen aber für sich allein weder Kapitulation noch einen endgültigen Boden.

**Zyklus-Vorlauf:**
> Das technische Ereignis liegt zeitlich vor dem gewählten historischen Vergleichsfenster. Das ist eine beobachtete Zeitabweichung, kein Beweis für algorithmische Steuerung oder einen vorgezogenen Zyklusboden.

---

## 15. Implementierungsphasen

### Phase 0 — Discovery (vor Implementierung)
- Aktuelle Datenkette der Aktien-Technik und BTC-Technik lesen.
- Bestehende MA-/Cross-Berechnung identifizieren; Doppelberechnung verhindern.
- Scoring-Gates, Trend-Mapping und Integration lesen.
- Test-Konvention und Schema-Migration prüfen.

### Phase 1 — Datenmodell + Visualisierung, kein Score
- Shared Market Structure Types.
- Cross-Alter, Bestätigungsstatus, Crowding- und Liquidationsdaten.
- Datenquelle, Scope, Aktualität und Coverage sichtbar.
- Golden/Death Cross als Event, nicht als Prognose.

### Phase 2 — Warn-Gates / Trendbonus-Schutz
- `TECH_CROSS_UNCONFIRMED`
- `MARKET_CROWDING_LONG`
- `LIQUIDATION_CASCADE`
- `MARKET_CONFIRMATION_MISSING`
- Warn-only; unbestätigtes Cross erhält keinen zusätzlichen Bonus.

### Phase 3 — Walk-forward Backtest
- BTC 2022 und 2024–2026 vergleichen.
- Cross-Events und Liquidationsevents eventbasiert auswerten.
- Für Aktien eigenes Universum/Benchmark-Backtest.
- Schwellen anhand train-only Perioden bestimmen, im Testzeitraum einfrieren.

### Phase 4 — Begrenzte Score-Wirkung
- Nur bei nachgewiesener Out-of-sample-Verbesserung.
- Begrenzter Overlay-Multiplikator.
- Gate-Caps zunächst konservativ und warn-only; Hard-Gates nur mit gesondertem Beleg.

---

## 16. Konkrete Umsetzungs-Checkliste

- [ ] Aktien-Technik-Datenfluss und exakte Datei der technischen Sektion verifizieren.
- [ ] BTC-Datenfluss / BTC-Dashboard für Research-Snapshot verifizieren.
- [ ] Dedizierten Typ `MarketStructureObservation` additiv definieren.
- [ ] Golden/Death Cross Event-Datum und Signalalter berechnen.
- [ ] Cross-Bestätigungsfamilien ohne Lookahead implementieren.
- [ ] OI USD und Coin/Contracts als getrennte Zeitreihen erfassen.
- [ ] Funding auf eine einheitliche Rate/Periode normalisieren.
- [ ] Liquidationsrichtung und Exchange-Coverage erfassen.
- [ ] Spot-/Breadth-Bestätigung hinzufügen.
- [ ] Datenqualität/Staleness/Coverage-Guards einbauen.
- [ ] Warn-Gates in bestehendes `Gate`-Interface integrieren.
- [ ] `mapTrendMultiplier()` zunächst unverändert lassen; neues Layer nur separat evaluieren.
- [ ] Backtest- und Regressionstests ergänzen.
- [ ] WORK-Index / Future_Work / Backlog nur nach Umsetzung und Test aktualisieren.
- [ ] PR mit Datenquellen, Testläufen, Grenzen und Score-Diff erstellen.

---

## 17. Quellen und Research-Snapshot

Abruf-/Stichtag: 13.11.2026. Live-/aggregierte Werte sind zeitpunktabhängig.

1. CoinGlass — BTC Futures / Open Interest / Funding / Liquidations:  
   https://www.coinglass.com/currencies/BTC/futures  
   Snapshot: BTC ca. 68.828 USD, −6,40 %/24h, USD-OI 47,86 Mrd. USD (−5,92 %), OI in BTC ca. +0,51 %, Liquidationen 919,15 Mio. USD (95 % Longs), Funding −0,0004 % je 8h, Futures-Volumen ca. 94,71–101,53 Mrd. USD je nach Update.
2. CoinGlass — BTC Historische Daten 2022:  
   https://www.coinglass.com/currencies/BTC/historical-data/2022  
   Jahrestief 15.599 USD am 21.11.2022; Jahresperformance −64,27 %; Dezember-Schluss 16.547,5 USD.
3. CoinGlass — BTC Tages-/Spot-Kontext:  
   https://www.coinglass.com/de/currencies/BTC?tab=onchain  
   Spot-Taker-Nettoverkauf ca. 626,76 Mio. USD; US-Spot-ETF-Nettofluss 12.11.2026 −47,70 Mio. USD (partial).
4. CoinDesk — Bitcoin Liquidations / Open Interest im Juni 2022:  
   https://www.coindesk.com/markets/2022/06/14/bitcoin-liquidations-top-532m-as-open-interest-falls-7  
   Bericht über ca. 532 Mio. USD BTC-Liquidationen und ca. 7 % OI-Rückgang innerhalb von 24h.
5. Galaxy Research — Bitcoin Four-Year Cycle / Bottom Framework (2026):  
   https://www.galaxy.com/insights/research/bitcoin-four-year-cycle-where-is-the-bottom  
   Mehrdimensionale Bottom-Methodik: Bewertung, Profit-taking, Miner, Trend und Sentiment; betont Unsicherheit bei Echtzeit-Bodenerkennung.
6. Blockmetric — BTC Historical Data (seit 15.10.2026 für den sichtbaren 30-Tage-Slice):  
   https://blockmetric.io/coins/BTC/historical-data  
   Nützliche unabhängige Cross-Check-Quelle für tägliche Kurse, OI, Funding und Liquidationen; Scope auf Hyperliquid plus verfügbare Venue-Liquidationen beachten.
7. Liqwall — BTC Liquidations / Funding / OI:  
   https://liqwall.com/coins/btc  
   Alternativer Snapshot vom 13.11.2026, dessen Werte wegen Venue-/Aggregationsunterschieden nicht mit CoinGlass vermischt werden dürfen.

### Research-Verwendung / Disclaimer

Diese Datei ist ein technischer Implementierungsauftrag und keine Anlageempfehlung. Historische Muster sind keine Garantie für Wiederholung. „Algorithmische Antizipation“ bleibt eine zu testende Hypothese. Der Snapshot vom 13.11.2026 ist kein dauerhaft gültiger Marktzustand. Alle Schwellen sind Startwerte für Backtesting, nicht als bereits validierte Parameter zu verstehen.

---

## 18. Änderungsprotokoll

- **13.11.2026:** Erste Spezifikation erstellt. Enthält 2022-/2026-BTC-Marktstrukturvergleich, Vorlauf-/Zyklus-Hypothese, technische Bestätigung, Crowding- und Liquidationsmetriken, Warn-Gate-Design, Datenqualitätsregeln und Backtest-Anforderungen.
