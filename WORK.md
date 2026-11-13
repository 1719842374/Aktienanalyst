# WORK.md — Index

## NEU 13.11.2026 — SOLL/IST: Technische Signalbestätigung für Long-only-Investments (BTC + Aktien Sektion 12)

**Status: OFFEN / nur Spezifikation, kein App-Code umgesetzt.** Detaillierter Research- und Datenanhang: [WORK_BTC_CYCLE_MARKET_STRUCTURE_SCORING.md](./WORK_BTC_CYCLE_MARKET_STRUCTURE_SCORING.md). Diese aktualisierte WORK.md-Spezifikation ist für die Umsetzung maßgeblich, soweit die ältere Research-Spec quantitative Trading-Backtests, neue harte Caps oder eine separate Engine vorsieht. **Kein Python, keine Tradingstrategie, kein quantitativer Strategie-Backtest, keine Optimierung auf historische Renditen.** Ziel ist ein **Long-only-Investmentfilter**, der technische Signale erklärt, bestätigt oder als widersprüchlich kennzeichnet, ohne die Fundamentalanalyse zu überschreiben.

## CHAT-ERGÄNZUNG 13.11.2026 — Vollständige fachliche Detailanforderung (Long-only, Sektion 12)

**Quelle:** Chat-Verlauf vom 13.11.2026 und hochgeladener Export „Eingefügter Text.txt“.  
**Status:** Spezifikation, keine Codeumsetzung. Dieser Abschnitt konsolidiert die vollständigen Anforderungen aus dem Chat. Zahlen sind ausdrücklich als Vorschlags-/Startwerte gekennzeichnet, sofern sie keine Code-Fakten oder historische Momentaufnahme sind.

### 1. Fachliches Ziel und explizite Nicht-Ziele

Ziel ist die Verbesserung eines **Long-only-Investmentfilters**. Die technische Analyse soll die Verlässlichkeit eines bereits erkannten Trends bewerten, nicht Trades erzeugen, Ein-/Ausstiege optimieren oder kurzfristige Renditeprognosen berechnen.

Explizit ausgeschlossen:
- keine quantitative Tradingstrategie, keine Long-/Short-Strategie;
- kein Python-Backtesting und keine Optimierung von Parametern auf historische Rendite;
- keine statistische Behauptung, dass ein Signal künftige Renditen zuverlässig prognostiziert;
- keine neue separate Market-Structure-Großengine oder Datenbank;
- keine automatische Kauf-/Verkaufsempfehlung durch Golden Cross, Death Cross, Zyklusmonat oder Liquidationsereignis;
- keine automatische Änderung des fundamentalen Quality Scores oder vorhandener Gate-Caps im ersten Release.

Statt Rendite-Backtests werden Software-Korrektheit, Datenqualität, Reproduzierbarkeit der Regeln, Regression und manuelle Plausibilitätsfälle geprüft. Das ist kein Test einer Anlagestrategie.

### 2. Vollständiger IST-Stand der technischen Aktiensektion

Geprüfte Komponente: `client/src/components/sections/TechnicalChart.tsx`; Props enthalten `sectionNumber=12`, Titel „Technische Analyse“. Der Quelltext war bei der Prüfung am 13.11.2026 etwa **160.813 Zeichen** lang.

| Bestehender Codebestandteil | Tatsächliches Verhalten |
|---|---|
| Moving Averages | MA200 und MA50 sind standardmäßig aktiv; MA100, MA20, EMA26, EMA12 und EMA9 optional. |
| 4/4-Bedingungen | `priceAboveMA200`, `ma50AboveMA200`, `macdAboveZero`, `macdRising`. |
| 4/4-Statuscopy | 4/4 „Alle Kaufbedingungen erfüllt“; 3/4 „fast kaufbereit“; 2/4 neutrales Umfeld; 1/4 Warnsignal; 0/4 kein Kaufsignal. |
| Signalfarbe | Bestehende Score-Farb-/Ampellogik wird beibehalten. |
| Golden/Death Cross | Letzten Cross durch Vergleich von MA50 und MA200 an zwei aufeinanderfolgenden Datenpunkten ermitteln; Golden bei Vorzeichenwechsel von <= auf >; Death bei >= auf <. |
| Cross-Zeitpunkt | Datum des letzten Cross plus Alter in Kalendertagen. |
| Datenhistorie | MA200/Cross nur bei ausreichender Historie; bei <200 MA-Datenpunkten wird fehlende Historie sichtbar gemacht. |
| Technische Visualisierung | Kurs-/MA-Chart, Signalmarker, Volumen, MACD, RSI, Bollinger-Bänder und weitere vorhandene Overlays. |
| Zusätzliche Anzeige-Overlays | Earnings-Marker, Treasury-/Real-Yield-/Credit-Spread-, Earnings-Yield-/ROIC- und Peer-Overlays sind vorhanden; mehrere sind explizit „nur Anzeige, kein Score“. |

Code-Ort aus der Repository-Prüfung (ungefähre Zeilen, können sich durch spätere Änderungen verschieben):
- MA-Konfiguration: ungefähr Zeile 99–104.
- Berechnung des 4/4-Scores: ungefähr Zeile 525–545.
- Darstellung der Ampel und Bedingungen: ungefähr Zeile 695–745.
- Golden-/Death-Cross-Banner: ungefähr Zeile 1089–1131.

**Schwachstelle des IST:** Kurs > MA200, MA50 > MA200 und MACD > 0 sind nicht drei voneinander unabhängige Belege. Sie stammen alle aus der Preisentwicklung und können gleichzeitig positiv sein, während Volumen und relative Stärke gegen die Aktie sprechen. Der 4/4-Indikator ist ein technischer Status, nicht der fundamentale Quality Score und kein unabhängiger Nachfrage-/Investmentnachweis.

### 3. SOLL: zweistufige Anzeige statt Ersatz der bisherigen Logik

Die existierende technische Anzeige bleibt erhalten. Ergänzt wird eine zweite Ebene direkt im Bereich des 4/4-Blocks und des Golden-/Death-Cross-Banners:

**Ebene 1 — Technischer IST-Status (unverändert):**
- 4/4-Kaufbedingungen;
- MA50/MA200 und bestehende Chartlinien;
- Golden-/Death-Cross-Datum und Signalalter;
- vorhandene RSI-/MACD-/Volumen- und Signalmarker.

**Ebene 2 — Signalbestätigung & Long-only-Risiko (neu):**
- aktueller Cross-Typ und Cross-Datum;
- Cross-Alter in Handelstagen zusätzlich zu den vorhandenen Kalendertagen;
- separate Statusampel;
- einzelne Bestätigungsfamilien mit true/false/n/a;
- konkrete Gründe und Gegensignale;
- Long-only-Text, der fundamentale Attraktivität und technische Lage trennt.

Beispiel für die gewünschte Aussage:
> „4/4 technische Bedingungen erfüllt, aber die Qualität des Signals ist noch nicht unabhängig bestätigt.“

Beispiel für Long-only:
> „Fundamentale Investmentthese kann attraktiv bleiben. Der technische Trendwechsel ist jedoch noch nicht ausreichend bestätigt. Erhöhtes Timing- und Drawdown-Risiko.“

### 4. Bestätigungsfamilien und vorgeschlagene Zahlen

| Familie | Vorgeschlagener Startwert / Prüfung | Einschränkung |
|---|---|---|
| Preisstabilität | Mindestens **3 von 5** letzten abgeschlossenen Handelstagen über MA200 bei Golden Cross; spiegelbildlich darunter bei Death Cross. | Preisbasiert. |
| Momentum | MACD-Histogramm verbessert/verschlechtert sich über **3** abgeschlossene Bars. | Preisbasiert, nicht unabhängig von Trend/Preis. |
| Volumen | Volumen relativ zum **20-Tage-Durchschnitt**, Up-/Down-Volume-Verhalten. | Exakter Spike-/Bestätigungsschwellenwert erst nach Datenprüfung definieren; keine Null-Volumen-Fallbacks. |
| Relative Stärke | **20-Handelstage** relative Rendite Aktie minus Sektor/Benchmark. | Benchmark/Sektor muss inhaltlich passend und Datenserie verfügbar sein. |
| Marktbreite | Advance/Decline oder Sektorbreite, falls verfügbar. | Optional, kein künstlicher Ersatzwert. |

Die Schwellen **3/5**, **3 MACD-Bars**, **20 Tage** sind fachliche Startwerte für die deterministische Signalinterpretation, nicht „optimierte“ Renditeparameter.

**Statusregeln:**
- `CONFIRMED`: Cross aktuell gültig, Preisstabilität erfüllt und mindestens **2 zusätzliche** Bestätigungsfamilien positiv; mindestens eine davon muss **nicht rein preisbasierte** Evidenz sein (z. B. Volumen, Relative Stärke oder Marktbreite).
- `PARTIAL`: Cross aktuell gültig, Preisstabilität erfüllt und genau eine zusätzliche Familie positiv.
- `UNCONFIRMED`: Cross erkannt, aber zusätzliche Bestätigung fehlt; keine starke Gegen-Evidenz.
- `CONFLICTED`: mindestens **2 belastbare Gegensignale**, z. B. schwache Relative Stärke plus negatives Volumenverhalten, oder klare Preisstruktur-Invalidierung.
- `SUPERSEDED`: späteres gegenteiliges Cross hat das vorherige Cross ersetzt; Historie bleibt sichtbar.
- `UNAVAILABLE`: Historie zu kurz, Daten fehlen/veraltet/ungültig oder erforderliche Vergleichsreihe nicht verfügbar.
- `false` bedeutet: geprüft und nicht erfüllt. `null` bedeutet: nicht verfügbar. Fehlende Daten sind weder false noch 0.
- Cross-Alter in Handelstagen ist genauer als Kalenderalter. Ein vorgeschlagener „frisch“-Hinweis von **20 Handelstagen** ist nur UI-Kontext, kein automatischer Signalverfall oder Timing-Countdown.

### 5. Golden Cross — Long-only-Auslegung

Das Golden Cross bleibt ein bullisches Trendereignis: MA50 kreuzt MA200 von unten nach oben. Die neue Logik darf es aber nicht automatisch als bestätigten Investmenttrend bezeichnen.

- Bestätigt: Cross intakt, Preisstruktur stabil, mehrere unabhängige Evidenzfamilien stützen es. Text „Technischer Rückenwind“.
- Teilweise: Trendstruktur positiv, weitere Bestätigungen fehlen. Text „Trend verbessert sich, Bestätigung noch unvollständig“.
- Unbestätigt: Cross erfasst, aber Volumen/Relative Stärke/Marktbreite bestätigen nicht. Text „Kein zusätzliches bullisches Vertrauenssignal“.
- Widersprüchlich: Cross bullisch, aber z. B. Sektorrelative Stärke und Volumen negativ. Text benennt den Konflikt.
- Überholt: Death Cross danach; altes Golden Cross bleibt in der Historie, ist aber nicht mehr aktueller Status.

### 6. Death Cross — Long-only-Auslegung

Das Death Cross bleibt ein bärisches Trendereignis: MA50 kreuzt MA200 von oben nach unten. Es ist **kein automatischer Verkaufsbefehl** und soll die fundamentale Investmentthese nicht überschreiben.

- Bestätigt: MA50 < MA200, Kurs unter MA200, negative relative Stärke und anhaltend schwache Struktur; Text „Erhöhtes technisches Abwärts-/Drawdown-Risiko“.
- Unbestätigt: Cross wurde erkannt, der Kurs stabilisiert sich aber, Momentum verbessert sich oder Relative Stärke dreht. Text „Vorsicht — mögliches nachlaufendes Signal“.
- Widersprüchlich: mehrere bullische Bestätigungen trotz Death Cross.
- Überholt: nachfolgendes Golden Cross; historisches Death Cross bleibt sichtbar, gilt aber nicht mehr als aktueller Cross.

Beispiel:
> „Fundamentale Bewertung attraktiv, technischer Abwärtstrend jedoch noch nicht überwunden. Erhöhtes Timing- und Drawdown-Risiko.“

### 7. Historische Zyklusvorwegnahme / Algorithmen-Hypothese

Die Nutzerbeobachtung: Marktteilnehmer bzw. regelbasierte/algorithmische Systeme könnten einen historischen Zyklus früher handeln; technische Cross-Signale erscheinen vor weiteren Bestätigungen; eine stark einseitige Positionierung könnte Liquidationen und damit eine vorgezogene Bewegung verstärken.

Produktdarstellung:
- Label „Historisches Muster / möglicher Trendvorlauf“ nur bei explizit vergleichbaren Ereignissen und einem dokumentierten Anker.
- Vergleich von Cross-Datum, Zyklusanker, Ereignisabstand und vorhandenen Bestätigungen.
- „Historischer Vorlauf“ wird als Zeitabweichung in Tagen angezeigt, nicht als Prognose eines Bodens.
- „Algorithmische Ursache“ bleibt „nicht nachgewiesen“; Algorithmus-Kausalität niemals als Fakt behaupten.
- Für BTC ist ein Halving-Anker nachvollziehbarer als ein beliebig gewählter Kalendermonat. Bei Aktien kein obligatorisches Zyklusdatum erzwingen.
- Ein in 2022 beobachtetes Tief oder ein erwarteter Dezember-Tiefmonat wird nicht hardcodiert. CoinGlass-Referenz führt das BTC-Jahrestief 2022 bei **15.599 USD am 21.11.2022**; Dezember war nicht das Datum des Intraday-Jahrestiefs.

### 8. BTC-Zahlen und Fakten aus dem Gespräch (historische Momentaufnahme, nicht Live-Konfiguration)

**Stichtag der zuvor genannten Aggregator-Snapshots: 13.11.2026; zeitabhängige Momentwerte, vor produktiver Nutzung im Originalfeed erneut prüfen.** Aggregatoren können sich wegen Zeitstempel, Börsenabdeckung und Berechnung unterscheiden.

| Kennzahl | Im Chat genannter Wert | Präzisierung |
|---|---:|---|
| BTC-Preis-Snapshot | **68.828 USD** | ca. Wert, kein Tages-Schlusskurs |
| BTC 24h-Veränderung | **−6,40 %** | Snapshot, kein permanenter Parameter |
| BTC-Futures-OI | **47,86 Mrd. USD** | USD-denominiert |
| USD-OI-Veränderung 24h | **−5,92 %** | kann teilweise durch fallenden BTC-Preis bedingt sein |
| OI in BTC/Kontrakte | **+0,51 % / 24h** | im Gespräch genannter Snapshot; zeigt, weshalb USD-OI allein keine Positionsrichtung belegt |
| 24h-Liquidationen | **919,15 Mio. USD** | Aggregator-Snapshot |
| Long-Anteil Liquidationen | **95 %** | betrifft realisierte Liquidationen, ist keine direkte Messung offener Long-Positionen |
| OI-gewichtete Funding Rate | **−0,0004 % je 8h** | nahe neutral/leicht negativ; Börsen einzeln können abweichen |
| Futures-Volumen | **94,71–101,53 Mrd. USD** | unterschiedliche Snapshot-Updates; nicht zu einer vermeintlich exakten Einzelzahl zusammenfassen |
| BTC-Abstand zur MA200 | ca. **−5,8 %** | Anbieter-/Berechnungsdefinition prüfen |
| Spot-Taker-Nettofluss | ca. **−626,76 Mio. USD** | Anbieter-Snapshot, Scope prüfen |
| US-Spot-ETF-Fluss (12.11.2026) | **−47,70 Mio. USD** | im Chat als „partial“ gemeldet; nicht als final behandeln |
| BTC-Jahresstart 2022 | **46.311,7 USD** | CoinGlass historische Jahressicht |
| BTC-Jahresendkurs 2022 | **16.547,5 USD** | Jahresperformance ca. **−64,27 %** |
| BTC-Jahrestief 2022 | **15.599 USD am 21.11.2022** | Intraday-Low laut CoinGlass; nicht mit Monatsclose verwechseln |
| Monatsclose Okt./Nov./Dez. 2022 | **20.495,8 / 17.168,6 / 16.547,5 USD** | historische Monatswerte |
| Liquidationen am 14.06.2022 | ca. **532 Mio. USD** | CoinDesk-Bericht; Scope BTC-Liquidationen |
| OI-Rückgang am 14.06.2022 | ca. **7 % in 24h** | historischer Bericht; nicht direkt mit 2026 Aggregator-Scope vergleichen |

**Interpretation der 2026 OI-Zahlen:** USD-OI −5,92 % bei BTC-/Kontrakt-OI +0,51 % ist keine eindeutige Long-Deleveraging-Meldung. Coin-/Kontrakt-OI, Preisbewegung, Funding und Liquidationen müssen getrennt gelesen werden. Ein 95%-Long-Anteil bei Liquidationen bedeutet, dass in diesem Liquidationsfenster überwiegend Longs zwangsweise geschlossen wurden; es beweist weder, dass offene Positionen weiterhin überwiegend Long sind, noch, dass der Boden erreicht ist.

**Datenquellen, im Chat verwendet:**
- CoinGlass BTC Futures: https://www.coinglass.com/currencies/BTC/futures
- CoinGlass BTC historische Daten 2022: https://www.coinglass.com/currencies/BTC/historical-data/2022
- CoinGlass BTC On-chain/Spot-Kontext: https://www.coinglass.com/de/currencies/BTC?tab=onchain
- CoinDesk, 14.06.2022: https://www.coindesk.com/markets/2022/06/14/bitcoin-liquidations-top-532m-as-open-interest-falls-7
- Weitere Cross-Check-Anbieter aus dem Research-Anhang: https://blockmetric.io/coins/BTC/historical-data und https://liqwall.com/coins/btc. Anbieterwerte nicht mischen, wenn Scope/Zeitfenster unterschiedlich sind.

### 9. Aktien-spezifische Übertragung

Die gemeinsame Logik gilt für die technische Cross-Bestätigung, aber die Datenfamilien müssen asset-gerecht sein:

| BTC | Aktien |
|---|---|
| Spot-Taker-Flow | Aktienvolumen / Up-Down-Volume |
| BTC-Funding / Futures-OI | Optional aktienbezogenes Short Interest/Optionsdaten, nur bei valider Quelle |
| BTC-ETF-Nettoflüsse | Nicht als Einzeltitel-Signal übernehmen |
| BTC-Liquidationen | Kein generischer Aktienindikator |
| BTC-Halving-/Zyklusanker | Kein zwingender Aktien-Kalenderanker |
| BTC-Spot-/Futures-Struktur | Aktie vs. passender Sektor/Benchmark |
| BTC-Makro-Liquidität | Makro-/Marktregime nur als übergeordneter Kontext |

### 10. Scoring: Nicht doppelt zählen

Bestehende Produktionswerte bleiben zunächst unverändert:
- `TREND_RULES.UPTREND = 1.10`
- `TREND_RULES.NEUTRAL = 1.00`
- `TREND_RULES.DOWNTREND = 0.90`
- fundamentale Gate-Caps: Pricing Power **55**, Relative Growth **60**, DCF Reality **65**, Inventory **70**.

SOLL:
- neue Bestätigung ist zunächst ein zusätzlicher **erklärender Status/Warnkontext**;
- keine weiteren 0–100-Signalpunkte;
- kein neuer harter Cap und keine Änderung des Fundamental Quality Scores;
- ein bereits durch 0,90 abgebildeter Abwärtstrend darf nicht ein zweites Mal bestraft werden;
- unbestätigtes Golden Cross darf keinen zusätzlichen Bull-Bonus erhalten;
- ein Death Cross ist keine automatische Verkaufsentscheidung;
- BTC-Derivatedaten sind kein Input für Einzeltitel-Gates.

### 11. Technischer Datenvertrag (Vorschlag)

```ts
interface TechnicalConfirmation {
  crossType: "GOLDEN" | "DEATH" | "NONE";
  crossDate: string | null;
  crossAgeTradingDays: number | null;
  status:
    | "CONFIRMED"
    | "PARTIAL"
    | "UNCONFIRMED"
    | "CONFLICTED"
    | "SUPERSEDED"
    | "UNAVAILABLE";
  priceConfirmed: boolean | null;
  momentumConfirmed: boolean | null;
  volumeConfirmed: boolean | null;
  relativeStrengthConfirmed: boolean | null;
  marketConfirmed: boolean | null;
  reasons: string[];
  warnings: string[];
}
```

`false` = erfolgreich geprüft und Bedingung nicht erfüllt. `null` = Messung nicht verfügbar. Status muss aus tatsächlichen vorhandenen Daten abgeleitet werden; kein LLM darf numerische Conditions erfinden.

### 12. Minimaler Integrationsplan (kein neues Framework)

1. **Shared-Funktion + Unit-Tests:** `shared/technical-confirmation.ts`; Cross-Datum, Handelstage, Status und Reasons aus vorhandenen OHLCV/MA/RSI/MACD/Volumenreihen.
2. **Aktien-Sektion 12:** `TechnicalChart.tsx) ergänzt Karte/Status unter dem vorhandenen 4/4-Block bzw. Cross-Banner. Bestehende Chart-, MA-, Signalmarker und 4/4-Bedingungen nicht ersetzen.
3. **BTC-Chart:** `btcAnalysis.ts` und `BTCDashboard.tsx` verwenden dieselbe Confirmation-Funktion; BTC-only Funding/OI/Liquidationskontext nur falls bereits valide verfügbar.
4. **Scoring:** bestehende Pipeline zunächst nicht verändern; Warnkontext allenfalls separat darstellen. Keine neuen Caps/Gewichte im ersten Release.
5. **Tests:** Golden bestätigt/unbestätigt, Death bestätigt/unbestätigt, fehlende Daten, kurze Historie, falsche/ungeprüfte Volumenserie, Cross wird superseded, keine Änderung am 4/4-Score oder Fundamental-Scoring.

### 13. Abnahmebedingungen

- [ ] Exakt gleiche OHLCV-Eingaben erzeugen unveränderten 4/4-Wert.
- [ ] Golden und Death Cross behalten ihre bereits bestehenden Ereignisdaten/-marker.
- [ ] Cross-Datum beruht auf abgeschlossenem Handelstag; keine Intraday-Scheinkreuzung.
- [ ] Alter in Handelstagen ist korrekt; Börsenkalender/Feiertage berücksichtigen.
- [ ] 4/4 und `UNCONFIRMED` können gleichzeitig angezeigt werden.
- [ ] „Bestätigt“ benötigt mindestens eine nicht rein preisbasierte Evidenzfamilie.
- [ ] `null`/stale/unavailable führt zu N/A/UNAVAILABLE und nie zu einer fingierten Bestätigung.
- [ ] Golden/Death werden bei Gegen-Cross als `SUPERSEDED` markiert; Historie bleibt sichtbar.
- [ ] Aktienvergleich nutzt passenden Sektor/Benchmark; keine stillschweigende Ersatzbenchmark.
- [ ] Long-only-Texte geben keine automatischen Kauf-/Verkaufsbefehle.
- [ ] Keine Änderung an Fundamental Quality, bestehenden Gate-Caps oder Trendmultiplikatoren.
- [ ] BTC-Funding/OI/Liquidationen wirken nicht auf Einzelaktien-Scores.
- [ ] Nur Unit-/Regressionstests und manuelle historische Faktenprüfung; kein quantitativer Strategie-Backtest.

### 14. Vorrang bei abweichenden Textstellen

Dieser Abschnitt und Abschnitt A–G der am 13.11.2026 ergänzten WORK.md sind die maßgebliche Umsetzungsanweisung. Die separate Datei `WORK_BTC_CYCLE_MARKET_STRUCTURE_SCORING.md` dient nur als ergänzender Research-/Quellenanhang für BTC-Marktstruktur, OI, Funding und Liquidationen. Ältere Abschnitte über quantitative Backtests, Renditeoptimierung, neue Score-Gewichte, harte Caps oder eine separate Engine sind **nicht Teil des aktuellen Auftrags** und dürfen nicht implementiert werden, sofern sie diesem Long-only-Scope widersprechen.

---

### A. Repository-IST (am 13.11.2026 geprüft)

| Funktion | IST / Codebeleg | SOLL |
|---|---|---|
| Technische Aktiensektion | `client/src/components/sections/TechnicalChart.tsx`, `sectionNumber=12`, Titel `Technische Analyse`; Komponente bereits ca. 160.813 Zeichen | Bestehende Sektion erweitern, nicht ersetzen. |
| Technische MAs | `MA_LINES`: MA200 und MA50 standardmäßig sichtbar; MA20/100 und EMA9/12/26 optional | Bestehende MAs unverändert; zusätzliche Cross-Qualität. |
| 4/4-Kaufbedingungen | ca. Zeilen 525–545 und 695–745: Kurs > MA200, MA50 > MA200, MACD > 0, MACD steigend | 4/4-Zähler **unverändert** lassen; eigenständigen Bestätigungsstatus daneben zeigen. |
| Statuslabels | 4/4: „Alle Kaufbedingungen erfüllt“; 3/4 „fast kaufbereit“; 2/4 neutral; 1/4 Warnung; 0/4 kein Kaufsignal | Klarer Zusatz „4/4 technische Bedingungen ≠ unabhängig bestätigter Investment-Einstieg“; optional bestehende Copy vorsichtig präzisieren, ohne Zähleränderung. |
| Cross-Erkennung | ca. Zeilen 1089–1131: SMA50 kreuzt SMA200 von unten/oben; jüngstes Ereignis und Kalendertage seit Cross | Zusätzlich Signalalter in Handelstagen, `CONFIRMED/PARTIAL/UNCONFIRMED/CONFLICTED/SUPERSEDED/UNAVAILABLE`. |
| Kurze Historie | `ti.maData.length < 200` → Hinweis, Cross nicht zuverlässig berechenbar | Bestehenden Guard behalten; keine falschen Cross-Labels. |
| RSI/MACD/Volumen | Bereits Chart-Overlays und Oszillatoren vorhanden | Daten für Erklärung/Bestätigung wiederverwenden; keine parallele Berechnung. |
| BTC-Technik | `client/src/lib/btcAnalysis.ts` (SMA/EMA/RSI/MACD, BTC-Cross- und Makro-Kontext), `client/src/pages/BTCDashboard.tsx` | Gemeinsame reine Cross-Confirmation-Funktion; BTC-spezifische Derivatedaten nur bei verlässlichem Provider. |
| Scoring-Basis | `server/scoring-integration.ts`: `TREND_RULES.UPTREND=1.10`, `NEUTRAL=1.00`, `DOWNTREND=0.90` | **Phase 1 keine Änderung** am Trendmultiplikator. |
| Fundamentale Gate-Caps | `server/scoring-gates.ts`: Pricing Power 55, Relative Growth 60, DCF Reality 65, Inventory 70 | **Keine Änderung** der bestehenden Caps; keine neuen harten Market-Structure-Caps. |

**Wichtig:** Der technische 4/4-Score ist **nicht** der fundamentale Quality Score. Drei der vier Bedingungen (Preis/MA/MACD) sind preisabgeleitet und korreliert. Ein 4/4-Score ist keine vierfach unabhängige Nachfragebestätigung.

### B. SOLL: zweite, erklärende Bewertungsebene direkt in Sektion 12

Anzeige direkt neben bzw. unter dem vorhandenen 4/4-Block und dem Golden-/Death-Cross-Banner:

- **Technischer Zustand:** 4/4 wie bisher, MA50/MA200-Werte, letzter Cross-Typ und Cross-Datum.
- **Cross-Alter:** Handelstage seit Ereignis (zusätzlich zu bestehenden Kalendertagen); historische Cross-Marker bleiben sichtbar.
- **Bestätigungsstatus:** `CONFIRMED`, `PARTIAL`, `UNCONFIRMED`, `CONFLICTED`, `SUPERSEDED`, `UNAVAILABLE`.
- **Unabhängige Evidenz:** Preisstruktur, Momentum, Volumen, Relative Stärke vs. Sektor/Benchmark, optional Marktbreite. Preisstruktur + MACD allein reichen ausdrücklich nicht für „bestätigt“.
- **Long-only-Einordnung:** „Technischer Rückenwind“, „Trend noch unbestätigt“, „erhöhtes Drawdown-/Timing-Risiko“, „Fundamentale Investmentthese separat bewerten“ — **keine automatischen Kauf-/Verkaufsempfehlungen**.
- **Transparenz:** Datenstand, Quelle, fehlende Inputs und konkrete erfüllte/nicht erfüllte Regeln.

### C. Konkrete Regeln (konfigurierbare Startwerte, nicht als Rendite-Prognose validiert)

**Cross-Ereignis:**
- Golden Cross bei `SMA50[t] > SMA200[t]` und `SMA50[t-1] <= SMA200[t-1]`.
- Death Cross bei `SMA50[t] < SMA200[t]` und `SMA50[t-1] >= SMA200[t-1]`.
- Nur abgeschlossene Handelstage, keine Intraday-Scheinkreuzungen; Split-/Dividend-Adjustierung konsistent zur bestehenden OHLCV-Pipeline.
- Ein Cross bleibt historisch, ist aber bei nachfolgendem Gegen-Cross `SUPERSEDED`. Kein „aktives“ Signal allein wegen alter Marker.

**Bestätigungsfamilien (nicht zu einem weiteren 0–100-Score summieren):**

| Familie | Startregel | Typ / Unabhängigkeit |
|---|---|---|
| Preisstabilität | Mindestens **3 von 5** letzten abgeschlossenen Handelstagen über MA200 für Golden; spiegelbildlich unter MA200 für Death | Preisbasiert |
| Momentum | MACD-Histogramm verbessert sich über **3** abgeschlossene Bars (Golden), verschlechtert sich (Death) | Preisbasiert; nicht als unabhängig von Preis zählen |
| Volumen | Volumen relativ zum **20-Tage**-Durchschnitt und Up-/Down-Volume-Verteilung prüfen; konkreter Schwellenwert erst nach Datenqualitätsprüfung festlegen | Nicht rein preisbasiert |
| Relative Stärke | **20-Handelstage**-Relative-Return gegen Sektor oder geeignete Benchmark positiv (Golden) bzw. negativ (Death) | Relativ zum Markt, kann teilweise korrelieren |
| Marktbreite | Geeignete Advance/Decline- oder Sektor-Breite, sofern verfügbar; keine erfundenen Daten | Breiter Marktkontext |

**Statusentscheidung (deterministisch):**
- `CONFIRMED`: Cross aktuell gültig + Preisstabilität erfüllt + mindestens **2 weitere Bestätigungsfamilien**, darunter mindestens **eine nicht rein preisbasierte**.
- `PARTIAL`: Cross aktuell gültig + Preisstabilität erfüllt + genau **1 weitere Familie**.
- `UNCONFIRMED`: Cross vorhanden, aber zusätzliche Bestätigung fehlt; keine starke Gegen-Evidenz.
- `CONFLICTED`: Cross formal vorhanden, aber mindestens **2 belastbare Gegensignale** (z. B. Relative Stärke und Volumen) oder Preisstruktur klar invalidiert.
- `SUPERSEDED`: nachfolgendes gegenteiliges Cross; früheres Ereignis bleibt im Verlauf.
- `UNAVAILABLE`: Cross oder notwendige Daten wegen kurzer Historie/Fehler/Staleness nicht verlässlich bestimmbar.
- `false` = geprüft und nicht erfüllt; `null` = nicht verfügbar. Fehlende Daten niemals als negative Bestätigung oder 0 zählen.
- Signalalter ist Kontext, kein automatischer Countdown zum Kauf: **20 Handelstage** können als Anzeigegrenze „frisch“ dienen, nicht als universeller Verfallstag.

**Long-only-Interpretation:**
- Bestätigtes Golden Cross: technischer Rückenwind, kein Kaufzwang.
- Unbestätigtes Golden Cross: kein zusätzliches bullisches Vertrauenssignal; fundamentale Attraktivität bleibt separat.
- Bestätigtes Death Cross: erhöhtes technisches Abwärts-/Drawdown-Risiko, **kein automatischer Verkauf**.
- Unbestätigtes Death Cross: Vorsicht, möglicher nachlaufender Indikator; Stabilisierung und Relative Stärke prüfen.
- `CONFLICTED`: Erklärung, welche Familien sich widersprechen, statt ein vereinfachtes bull/bear-Urteil.

### D. BTC-Sonderfall: Zyklusvorlauf, Crowding und Liquidationen

BTC erhält **zusätzlichen Kontext**, keine Übertragung seiner Futures-Daten auf Einzeltitel:
- historisches Ereignis relativ zu **explizit definiertem Zyklusanker** (Halving, Peak, lokales Low); Vorlauf in Tagen und ggf. normalisiert auf Zykluslänge;
- Funding-Rate mit Börse/Intervall (z. B. **8 h**), USD-Open-Interest **und** BTC-/Kontrakt-Open-Interest getrennt;
- Long-/Short-Liquidationen, jeweils **1 h / 4 h / 24 h** getrennt;
- Spot-Taker-Flow, ETF-Flows nur bei BTC, Partial-/Final-Status;
- „algorithmische Vorwegnahme“ **Hypothese, nicht bewiesene Kausalität**;
- „Liquidation Flush“ ist ein Stressereignis, **kein Boden- oder Kaufsignal**.

**Historischer Faktenblock / Snapshot (aus vorherigem Research, erneut gegen Originalanbieter zu prüfen):**

| Kennzahl | Referenz 2022 / Snapshot 13.11.2026 | Einordnung |
|---|---|---|
| BTC-Jahrestief 2022 | **15.599 USD, 21.11.2022** | Nicht erst Dezember; Jahresendkurs **16.547,5 USD**, Jahresperformance ca. **−64,27 %**. |
| BTC-Monatsschluss Oktober/November/Dezember 2022 | **20.495,8 / 17.168,6 / 16.547,5 USD** | Monatsclose nicht mit Intraday-Low verwechseln. |
| BTC-Kurs 13.11.2026 (Momentaufnahme) | ca. **68.828 USD**, **−6,40 % / 24 h** | Kein Tagesendkurs, nicht als aktueller Live-Wert hardcoden. |
| Futures-OI 13.11.2026 | ca. **47,86 Mrd. USD**, **−5,92 % USD-OI / 24 h** | Dollar-OI kann allein wegen Preisrückgang sinken. |
| BTC-/Kontrakt-OI 13.11.2026 | ca. **+0,51 % / 24 h** | Widerspruch zu USD-OI kann auf neue Positionen statt pauschalen Long-Abbau hinweisen. |
| Liquidationen 13.11.2026 | ca. **919,15 Mio. USD / 24 h**, davon **95 % Longs** | Starke einseitige Long-Liquidation, aber keine sichere Bodenbestätigung. |
| Funding 13.11.2026 | ca. **−0,0004 % je 8 h**, OI-gewichtet | Nahe neutral; nicht automatisch Short-Crowding. |
| BTC-Liquidationen 14.06.2022 | ca. **532 Mio. USD**, OI ca. **−7 % / 24 h** | Historisches Stressereignis, anderer Scope/Marktstruktur. |
| Spot-Taker-Nettofluss 13.11.2026 | ca. **−626,76 Mio. USD** | Snapshot/Provider-Abdeckung prüfen. |
| ETF-Nettofluss 12.11.2026 | ca. **−47,70 Mio. USD**, als **partial** gemeldet | Kein finaler Tagesschlusswert. |

Quellen/Verifikation:
- https://www.coinglass.com/currencies/BTC/futures
- https://www.coinglass.com/currencies/BTC/historical-data/2022
- https://www.coinglass.com/de/currencies/BTC?tab=onchain
- https://www.coindesk.com/markets/2022/06/14/bitcoin-liquidations-top-532m-as-open-interest-falls-7
- Vollständige Quellen-/Scope-Hinweise in [WORK_BTC_CYCLE_MARKET_STRUCTURE_SCORING.md](./WORK_BTC_CYCLE_MARKET_STRUCTURE_SCORING.md).

**Keine 1:1-Übertragung auf Aktien:** Aktien erhalten relative Stärke, Sektor-/Benchmarktrend, Volumen und Marktbreite. Instrumentbezogenes Short Interest/Optionen nur mit eigener valider Quelle. BTC-Funding, BTC-OI und BTC-Liquidationen sind **kein** firmenspezifischer Aktien-Gate-Input.

### E. Scoring-Gates: IST vs. SOLL und Nicht-Ziele

`server/scoring-integration.ts` hat aktuell **UPTREND 1,10**, **NEUTRAL 1,00**, **DOWNTREND 0,90**. `server/scoring-gates.ts` verwendet bestehende Caps **55/60/65/70** für Pricing Power/Relative Growth/DCF Reality/Inventory.

**SOLL Phase 1:**
1. Bestätigungsstatus als **separate erklärende Technical-Information**.
2. Warn-IDs `TECH_CROSS_UNCONFIRMED`, `TECH_CROSS_CONFLICTED`, `TECH_DEATH_CROSS_CONFIRMED`, `CYCLE_TIMING_ADVANCE` (BTC-only), `MARKET_CROWDING` und `LIQUIDATION_STRESS` (nur bei passenden Daten).
3. **Warn-only:** Keine zusätzlichen harten Caps, keine neuen Gewichte, keine Änderung von `qualityScore`, `trendMultiplier`, `finalScore`, bestehenden Gate-Caps oder bestehenden 4/4-Bedingungen.
4. Keine doppelte Bestrafung: Ein bestätigter Abwärtstrend ist bereits im 0,90-Multiplikator berücksichtigt.
5. Optionaler späterer Eingriff in den Bull-Bonus **nur nach separater Produktentscheidung**, nicht Bestandteil dieses Auftrags.

### F. Minimal-invasive Umsetzung statt neuer Engine

| Datei | Änderung |
|---|---|
| `shared/technical-confirmation.ts` (neu) | Reine Funktionen für Cross-Event, Signalalter, Confirmation/Conflict-Status und nachvollziehbare Reasons. |
| `client/src/components/sections/TechnicalChart.tsx` | Bestehenden 4/4-Block und Cross-Banner erhalten; Bestätigungs-Karte, Status und Long-only-Erklärung ergänzen. |
| `client/src/lib/btcAnalysis.ts`, `client/src/pages/BTCDashboard.tsx` | Gemeinsame Confirmation-Funktion wiederverwenden; BTC-spezifische Marktstruktur nur bei validen Daten. |
| `shared/schema.ts` | Optionales, rückwärtskompatibles `technicalConfirmation`-Feld nur falls serverseitiger Verbraucher nötig. |
| `server/scoring-gates.ts`, `server/scoring-integration.ts` | Erst nach Bedarf Warnungs-/Konfliktintegration, **keine Score-Änderung**. |
| `script/test-technical-confirmation.ts` (neu) | Deterministische Tests; kein Python, kein Strategie-Backtest. |

**Umsetzung in 3 kleinen PRs:** (1) Shared-Funktion + Tests, (2) Aktien-Sektion 12 UI, (3) BTC-UI und optional Warn-Gate-Verdrahtung. Keine neue Datenbank, keine parallele Market-Structure-Engine.

### G. Abnahme / Regression

- [ ] Bestehende 4/4-Kaufbedingungen sind für dieselben OHLCV-Daten vor/nach Änderung identisch.
- [ ] Golden und Death Cross behalten korrekte Daten/Marker; Kalendertage und Handelstage korrekt unterschieden.
- [ ] Golden 4/4 kann ausdrücklich **UNCONFIRMED** oder **CONFLICTED** sein.
- [ ] Death Cross führt nicht automatisch zu Verkauf oder fundamentalem Score-Cap.
- [ ] `CONFIRMED` verlangt mindestens eine nicht rein preisbasierte Bestätigung.
- [ ] Fehlende Volume-/Benchmark-/Breadth-Daten bleiben `null`/„n/a“, nicht 0.
- [ ] Nachfolgendes Gegen-Cross setzt früheres Ereignis auf `SUPERSEDED`.
- [ ] BTC-Derivatedaten beeinflussen keine einzelnen Aktien-Scores.
- [ ] Bestehende Gate-Caps **55/60/65/70** und Trendmultiplikatoren **0,90/1,00/1,10** bleiben identisch.
- [ ] Keine quantitative Trading-Strategie, kein Python-Backtest, keine Backtest-Optimierung.
- [ ] Nur deterministische Unit-/Regressionstests und manuelle historische Plausibilitätsfälle.
- [ ] Implementierungsstatus erst nach tatsächlichen Code-Commits und Tests von OFFEN auf erledigt setzen.

**Interpretation:** Die neue Logik beurteilt die *Verlässlichkeit eines technischen Signals für Long-only-Entscheidungen*. Sie prognostiziert weder einen exakten Boden noch behauptet sie eine nachgewiesene algorithmische Steuerung.

---


> Stand: 11.10.2026 | Tip `a0979593fe13792fd13aa7eaf183cb808b396791` (#209 Gold-Chart im BTC-Design, parent `f0943dd5e9de8fd87a1b1f7ed8f4e6791e0f9ea2` #206 Ampel Gold MA50; Feature-Tip Gold `98ccc928be5bfd0b5b1fc464ef13771207a3c9bc` #201; Index davor Tip `8add9ed1e6d599283368896127711486955855f3` #200) | Keep-Alive / `RENDER_URL` ist auf der Production-Umgebung bereits grün und **kein Ampel-ROT**.
>
> **Hub Soll vs. Ist:** [docs/Doc_Soll_vs_Ist/](./docs/Doc_Soll_vs_Ist/)
>
> Alt (nicht löschen): [docs/work-offen/](./docs/work-offen/) · [docs/work-dokumentation/](./docs/work-dokumentation/)
> Root-`WORK_*.md` bleiben die Inhaltsquelle. Wahrheit für das regionale Briefing ist Root [`fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md`](./fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md). `docs/work-offen/README.md` verlinkt dafür noch `Offen_`; die Dublette `docs/work-offen/WORK_RESEARCHER_BRIEFING_REGIONAL.md` bleibt liegen.

**Ampel-Kurz 11.11.2026, HEAD main `63a5cbcf30805280ca921dac3aca1a3ee66f2b2e`:** Ampel 🟡 TEILWEISE. #482 Squash `63a5cbcf` (DC Post-Merge KLAR mit Hinweisen, `test-segment-n29-2.ts` 22 PASS, Tester PASS @`6856db4a`: HPE Networking „n/a — Fremdmarke verworfen“, Arista kein Kind; UNTESTED: ungültige FMP-Namenssuche live, Alletra): P2-N29-2 erledigt, Kette `SegmentChildrenPanel` → GET `/api/segment-children/:ticker` → `segment-growth-route.ts:701` → `fmpSearchCompanyName` → `shared/segment-children.ts`. Offen: P2-3 fail-open, eigene Unterbrands, Flaggschiffe (24-h-KI-Cache), P3 Obergrenze `ownClaimBrandQueries` (270 s gegen 90 s). #469 Squash `fb5546ea` (DC Post-Merge KLAR): Prod-Smoke P1 Löschen+Reload PASS, P3 Chat PASS, P2 Zwei-Tab FAIL (Tab B zeigt den gelöschten Titel nach Reload wieder, trotz PUT stale-write; Client-Wiederbelebung), Fix-Lane läuft, nicht grün. Kette `useChatHistory.ts` → `chat-history-route.ts` → `shared/chat-history.ts`. `WORK_DASHBOARD_FEATURES_2026-10.md`, `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md`, `WORK_CHAT_PODCAST_MCP.md` §1 und `WORK_SIMPLYWALLST_LEARNINGS.md` §6 bleiben OFFEN, kein Rename, kein `fertig_`/`Fertig_`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Delta 11.11.2026 HEAD `63a5cbcf`.

**Ampel-Kurz 11.11.2026, HEAD main `fb5546ea9768140679e72185ba7ff50860e506de` (#483 Squash `727ca998` über `844a8c36`, PR-Head `ddea7a84`, DC Post-Merge KLAR, Tester-PASS 1–4 auf denselben Blobs):** Ampel 🟡 TEILWEISE. #483 Elternsegment nicht mehr als eigenes Kind (NVDA „Data Center Segment“, HPE „Hybrid Cloud Segment“). Kette auf main geprüft: `SegmentChildrenPanel` → GET `/api/segment-children/:ticker` → `server/segment-growth-route.ts:633` → `productChildKey` in `shared/segment-children.ts`. #465 Squash `dd30e8b7` (Jahres-Tabelle, Sankey, Segment-YoY, KI-Untersegmente mit Fremdmarken-Prüfung) steht schon als Vollblock in `WORK_IMPLEMENTIERUNG_OFFEN.md` und in den beiden Specs (Docs #481, `844a8c36`); dieser Index wiederholt den Vollblock nicht. Offen: P2-3 fail-open, eigene Unterbrands, UNTESTED-Flaggschiffe (24-h-KI-Cache), P2-N29-2 FMP-Namenssuche pro brand. Soll `WORK_DASHBOARD_FEATURES_2026-10.md` und `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` bleiben OFFEN, kein Rename, kein `fertig_`/`Fertig_`, `fertig_`/`Fertig_` nicht zurück auf `Offen_`. Neu abgeschlossen: keine Spec. Do-not-touch: Miner, PEG, invertierter DCF, Sentiment, Portfolio F.2. Kein App-Code. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Delta 11.11.2026 HEAD `fb5546ea`.

**Ampel-Kurz 11.10.2026, Tip `8add9ed1` (#200 Google Trends Cache über #195 `cc683e96`, Tester PASS Soft Production, Doublecheck GO Soft):** Google Trends Cache 🟢. Kein neues `Offen_`/`fertig_`/`Fertig_` Spec-File; [`Future_3_SerpApi_Rate_Limits.md`](./Future_3_SerpApi_Rate_Limits.md), [`Future_4_Google_Trends_Conflict_and_Fixes.md`](./Future_4_Google_Trends_Conflict_and_Fixes.md) und [`Future_5_Google_Trends_Cache_Implementation.md`](./Future_5_Google_Trends_Cache_Implementation.md) bleiben unter diesen Namen (kein Rename, kein Rückbau). Bestehende `Fertig_`/`fertig_` unberührt. Feature-Dateien des #200-Commits: 6 Dateien, +392/−41 (`server/cache/google-trends-cache.ts` added, `server/recession.ts`, `client/src/components/recession/recessionDashboardShared.tsx`, `client/src/components/recession/recessionDashboardPartsB1.tsx`, `client/src/components/recession/recessionDashboardPartsB2.tsx`, `script/test-google-trends-cache.ts` added). Datenkette: `#/recession` → `client/src/pages/RecessionDashboard.tsx` (`useMutation`, `POST /api/analyze-recession`) → `useRecessionCatalog` liest nur `regions` → `server/routes.ts` `registerRecessionRoutes` → `server/recession.ts` `runRecessionAnalysis` → `scoreGoogleTrends` → `server/cache/google-trends-cache.ts` oder `https://serpapi.com/search.json?engine=google_trends&q=Recession&geo=US&date=now 7-d` (Timeout 12s) → `googleReading` → `IndicatorTable` / `Summary`. Soll: Cache 6–12h (Future_5: 12h), Key `google-trends-recession`; bei 429/leer/Timeout letzten gültigen Wert halten; UI „letzter Wert von vor X Stunden“; ohne Wert in 48h Slot nicht verfügbar, nicht Score 0; Zonen und ×1,7 bleiben. Ist: Tip `8add9ed1`. Frisch 12h, Last-Good 48h, `isStale` erst über 24h. Live PASS Soft Production: Zeile `vor 0.0h`, Satz „61.2“ entfernt, Korrektur 12M bleibt 80 %, `ageHours`/`isStale` in `POST /api/analyze-recession`. Doublecheck GO Soft. Softs, blockieren die Ampel nicht: „veraltet“ nur nach >24h prüfbar; Cache-Hits nur im Render-Log (`Google Trends cache hit`); Cache nur In-Memory; Anzeige `0.0h` kosmetisch. Redis, Retry-Backoff, pytrends und Plan-Wechsel sind nicht in #200. Liquidity Index Panel bleibt 🟢 `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`. TAM Partial-Apply bleibt 🟢 im Index. Section4 bleibt 🟢 `Fertig_WORK_SECTION4_DATA_BUGS.md`. Recession Sources bleibt 🟢 `Fertig_WORK_RECESSION_SOURCES.md`. Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. #180 HOLD — nicht anfassen. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 11.10.2026 Tip `8add9ed1`.

**Ampel-Kurz 05.10.2026, Tip `99feff6f` (#150 Liquidity Index Panel über #189 `e3c94d11`, Tester PASS Soft, Bundle `index-xA_h1JP9.js`, Shots `/workspace/dod-150-li/`):** Researcher Liquidity Index Panel 🟢 und [`Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`](./Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md) (Philip-Dateiname, großes F; `Fertig_` bleibt, kein Rename in diesem Nachzug). Feature-Dateien des #150-Commits: 8 Dateien, +457/−7 (`client/src/components/researcher/LiquidityIndexPanel.tsx` added, `client/src/components/researcher/MacroPanel.tsx`, `client/src/components/researcher/liquidity-index-panel.ts` added, `client/src/pages/Researcher.tsx`, `script/test-liquidity-index-panel.ts` added, `script/test-liquidity-index.ts`, `server/liquidity-index-catalog.ts`, `server/liquidity-index.ts`). analyze-route und `researcher.ts` unberührt. Fertig_ Spec im Feature-Commit unberührt. Doublecheck Integrity GO Soft. Datenkette: `#/researcher` Macro → LiquidityIndexPanel → `GET /api/researcher/liquidity?region=US|EU|ASIA` → `server/liquidity-index*`. Soll: LiquidityIndexPanel({ region }) auf Macro; Region-Toggle ändert Serie/asOf; GET /api/researcher/liquidity?region=; US DFF+M2SL; C2 nur nach Analyse einmal; Briefing/RegionalStocks bleiben. Ist: live PASS Soft — Panel einmal zwischen Briefing und Country Macro Pulse; US LI 47.2 DFF+M2SL available; EU LI 42.6; ASIA Softs; Bundle `index-xA_h1JP9.js`. Softs, blockieren die Ampel nicht: Fiskal Spec-Klarstellung (Spec wollte „Fiskal-Angebot n/v“ wenn keine Quelle; Ist: BUYBACK_OPS n/v, Fiskalzeile zeigt MSPD_BILLS/QRA_IMPLIED_BILLS wenn Slot da); ASIA (BOJ_GOVDEP n/v, keine DRAIN-Karte, Kopf-Stand asOf 2024-01-01 wegen stale CN_M2); Performance (Doppel-Fetch 2×/Region; EU Erstload 15–20s). Section4 bleibt 🟢 `Fertig_WORK_SECTION4_DATA_BUGS.md`. Recession Sources bleibt 🟢 `Fertig_WORK_RECESSION_SOURCES.md`. Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. TAM Partial-Apply bleibt 🟢 im Index (kein neues Spec-File). #180 HOLD — nicht anfassen. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `99feff6f`.

**Ampel-Kurz 05.10.2026, Tip `31d9f367` (#176 TAM Partial-Apply über #188 `39d1afd6`, Tester PASS Soft AMZN, Bundle `index-BcyRdipm.js`):** Segment-TAM KI Partial-Apply + hide 0-Rev in Section7 (Rel. Bewertung / Sektion 9) 🟢. Kein neues `Offen_`/`fertig_`/`Fertig_` Spec-File; die Lane ist im Index geschlossen. `Fertig_` bleibt, kein Rename in diesem Nachzug. Feature-Dateien des #176-Commits: 5 Dateien, +214/−48 (`shared/tam-na-fill.ts`, `server/tam-na-fill.ts`, `client/src/components/sections/Section7.tsx`, `script/test-tam-na-fill.ts`, `server/analyze-route.ts` comment only). Datenkette: Section7 → `POST /api/analyze/:ticker/tam-na-fill` → `requestTamNaFills` → `shared/tam-na-fill`. Doublecheck GO Soft. Soll: Partial-Apply gültige KI-Fills behalten (violet KI-Badge), offene Zellen bleiben n/a, kein all-or-nothing 422 wenn mindestens ein Fill brauchbar; Rev null/0 aus Tabelle, Prompt und Fill-Scope (`hasPositiveSegmentRevenue`), Beispielzeile `Other / nicht segmentiert` $0; Facts (Rev, Anteil, Coverage, tamTotal, quality) nicht überschreiben/neu berechnen; Anteil am TAM / vs. TAM lokale Formeln; Peer-N/A unberührt; analyze-route Handler nur Kommentar. Ist: Tip `31d9f367` (#176 über #188 `39d1afd6`). Live PASS Soft AMZN: 7 Zeilen statt 8, KI ✓, coverage 75%, API 200, Bundle `index-BcyRdipm.js`. `npx tsx script/test-tam-na-fill.ts` 125 passed. Soft, blockiert die Ampel nicht: Partial-Lückenfall live nicht gesehen (Modell füllte alles); Unit-Tests decken Partial-Apply / offene Rest-Zellen ab. Section4 bleibt 🟢 `Fertig_WORK_SECTION4_DATA_BUGS.md`. Recession Sources bleibt 🟢 `Fertig_WORK_RECESSION_SOURCES.md`. Researcher-LI bleibt 🟢 `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`. Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. #180 HOLD — nicht anfassen. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `31d9f367`.

**Ampel-Kurz 05.10.2026, Tip `1124c6f5` (#168 Section4 Data Bugs über #187 `e045080c`, Tester PASS Soft, Bundle `index-wIPUcskT.js`, Shots `/workspace/dod-168-section4/`):** Section4 🟢 und [`Fertig_WORK_SECTION4_DATA_BUGS.md`](./Fertig_WORK_SECTION4_DATA_BUGS.md) (Philip-Dateiname, großes F; `Fertig_` bleibt, kein Rename in diesem Nachzug). Feature-Dateien des #168-Commits: 10 Dateien, +599/−41 (`client/src/components/sections/EpsGrowthChart.tsx`, `client/src/components/sections/FinancialStatements.tsx`, `client/src/components/sections/Section1.tsx`, `client/src/components/sections/Section2.tsx`, `script/test-section4-labels-moat.ts`, `server/analyze-helpers.ts`, `server/analyze-route.ts`, `server/fmp-fetcher.ts`, `server/fmp.ts`, `shared/schema.ts`). analyze-route 22/22 Deletes verified. researcher unberührt. Doublecheck GO Soft. Soll: Section4 last quarter, unique grades, one EPS CAGR per `Fertig_WORK_SECTION4_DATA_BUGS.md` / #168 DoD. Ist: Doublecheck GO Soft — 10 Dateien +599/−41; analyze-route 22/22 Deletes verified; researcher unberührt. Tester PASS Soft. Bundle `index-wIPUcskT.js`. Shots `/workspace/dod-168-section4/`. Soft, blockieren die Ampel nicht: Quartal nur Datum; BN Moat None vs Narrow-Inkonsistenz; PEG-Label. Recession Sources bleibt 🟢 `Fertig_WORK_RECESSION_SOURCES.md`. Researcher-LI bleibt 🟢 `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`. Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `1124c6f5`.

**Ampel-Kurz 05.10.2026, Tip `8acf0e46` (#186 STOXX PE Soft-Fix über #185 `ba476e0e`, Tester PASS Soft ~16:21 CEST, Shots `/workspace/dod-186-stoxx-pe/`, Bundle `index-Ubb-bF_f.js` unverändert, server-only):** Recession Sources / STOXX PE Soft-Fix 🟢 und [`Fertig_WORK_RECESSION_SOURCES.md`](./Fertig_WORK_RECESSION_SOURCES.md) (Philip-Dateiname, großes F; `Fertig_` bleibt, kein Rename in diesem Nachzug). Feature-Dateien des #186-Commits: `server/recession-regions.ts`, `script/test-recession-regions.ts` (+128/−16). analyze-route und researcher unberührt. Doublecheck GO Soft. Soll: EZ-Katalog STOXX 600 PE mit live Wert+Quelle+Zone+Score (nicht N/A, wenn EXSA KGV da ist). Ist: live PASS Soft ~16:21 CEST — `#/recession` EZ-Katalog STOXX 600 PE 18.4, Quelle iShares EXSA KGV 2026-10-02, Zone Normal (15-30), scored available:true. Vorheriges Soft N/A („FMP leer, iShares ohne KGV“) ist für den live EXSA-KGV-Pfad zu. Soft, blockieren die Ampel nicht: Margin Wert unscored; TOPIX/JNVI/JGB. [`Fertig_WORK_SECTION4_DATA_BUGS.md`](./Fertig_WORK_SECTION4_DATA_BUGS.md): Filename `Fertig_`, Feature-Lane noch offen (Draft #168, kein Tester PASS, nicht Ampel 🟢). Researcher-LI bleibt 🟢 `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`. Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `8acf0e46`.

**Ampel-Kurz 05.10.2026, Tip `37a188ef` (#184 Recession N/A fills über #183 `11e0e617`, Tester PASS Soft, Shots `/workspace/dod-184-recession-na/`):** Recession Sources / N/A fills 🟢 und [`Fertig_WORK_RECESSION_SOURCES.md`](./Fertig_WORK_RECESSION_SOURCES.md) (Philip-Dateiname, großes F; `Fertig_` bleibt, kein Rename in diesem Nachzug). Feature-Dateien des #184-Commits: `client/src/components/recession/recessionDashboardPartsA1.tsx`, `client/src/components/recession/recessionDashboardPartsA2.tsx`, `script/test-recession-regions.ts`, `script/test-recession-sources.ts`, `server/recession-regions.ts`, `server/recession.ts` (+370/−55). Soll: CAPE/Buffett/STOXX/JP-Aktivität mit Wert+Score wo möglich. Ist: live PASS Soft — CAPE 41.4 Multpl; Buffett 236% Yahoo/GDP; JP YoY +2.1% OECD; Margin Wert unscored Soft; STOXX live weiter N/A Soft (VM hatte 18.4); TOPIX/JNVI/JGB Soft. Soft, blockieren die Ampel nicht: Margin Wert unscored; STOXX live N/A (VM 18.4); TOPIX/JNVI/JGB. [`Fertig_WORK_SECTION4_DATA_BUGS.md`](./Fertig_WORK_SECTION4_DATA_BUGS.md): Filename `Fertig_`, Feature-Lane noch offen (Draft #168, kein Tester PASS, nicht Ampel 🟢). Researcher-LI bleibt 🟢 `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`. Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `37a188ef`.

**Ampel-Kurz 05.10.2026, Tip `88f4ee92` (#182 Researcher N/A fill über #181 `17847752`, Tester PASS Soft, Shots `/workspace/dod-182-researcher-na/`):** Researcher / Liquidity Index / Briefing N/A fill 🟢 und [`Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`](./Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md) (Philip-Dateiname, großes F; `Fertig_` bleibt, kein Rename in diesem Nachzug). Feature-Dateien des #182-Commits: `client/src/components/researcher/LiquidityBriefingPanel.tsx`, `script/test-liquidity-briefing-na.ts`, `script/test-liquidity-briefing.ts`, `script/test-liquidity-stocks-velocity.ts`, `server/eu-bonds-snapshot.ts`, `server/liquidity-briefing-catalog.ts`, `server/liquidity-briefing-math.ts`, `server/liquidity-briefing.ts`, `server/liquidity-index-catalog.ts`, `server/liquidity-index-math.ts`, `server/liquidity-index.ts`, `server/liquidity-stocks-series.ts`, `server/liquidity-stocks-velocity.ts`, `shared/schema.ts` (+696/−79). Soll: zuvor n/a-Zellen in Briefing und regionaler Liquidität mit Wert+Quelle+asOf. Ist: live PASS Soft — 18/20 Briefing-Nulls gefüllt; US/EU regional 0 Nulls; ASIA nur `BOJ_GOVDEP` Soft. Soft, blockiert die Ampel nicht: ASIA `BOJ_GOVDEP` bleibt N/A/null. [`Fertig_WORK_SECTION4_DATA_BUGS.md`](./Fertig_WORK_SECTION4_DATA_BUGS.md): Filename `Fertig_`, Feature-Lane noch offen (Draft #168, kein Tester PASS, nicht Ampel 🟢). Recession Sources bleibt 🟢 `Fertig_WORK_RECESSION_SOURCES.md`. Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `88f4ee92`.

**Ampel-Kurz 05.10.2026, Tip `860ff710` (#179 Fazit-Soft über #178 `71254a45`, Tester PASS 2026-10-05 ~14:52 Europe/Berlin, live `#/recession`, kein Bundle-Hash):** Recession Sources bleibt 🟢 und [`Fertig_WORK_RECESSION_SOURCES.md`](./Fertig_WORK_RECESSION_SOURCES.md) (Philip-Dateiname, großes F; `Fertig_` bleibt, kein Rename in diesem Nachzug). Feature-Dateien des #179-Commits: `server/recession.ts`, `script/test-recession-sources.ts` (+74/−4). analyze-route und researcher unberührt. Soll (Philip Soft): kein Bewertungs-Wording, wenn keine Bewertung gewertet ist; Bewertungsrisiko darf nicht leer sein. Ist: Treiber = Google Trends / CSI / Aktivität; Bewertungsrisiko zeigt „nicht gewertet“; Buffett 195%(2020-01) N/A (Stale-Gate). Soft, blockieren die Ampel nicht: negative Scores in der Treiberliste; News-Titel-Prefix in den Driver-Karten. Weiter aus dem vorigen Stand, nicht Gegenstand von #179: Regeltabelle ×2 kosmetisch; `WILL5000PR` FRED HTML/404 → Buffett dauerhaft N/A bis andere Cap-Quelle. [`Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`](./Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md) und [`Fertig_WORK_SECTION4_DATA_BUGS.md`](./Fertig_WORK_SECTION4_DATA_BUGS.md): Filename `Fertig_`, Feature-Lane noch offen (Drafts #150 / #168, kein Tester PASS, nicht Ampel 🟢). Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `860ff710`.

**Ampel-Kurz 05.10.2026, Basis `6e125cdf`, Feature-Tip `b43bc7a6` (#177 Buffett stale-gate über #167 `0c31b896`, Tester PASS HARD Buffett Re-Check 2026-10-05 ~14:35 Europe/Berlin, live Render, Doublecheck über #177):** Recession Sources 🟢 und [`Fertig_WORK_RECESSION_SOURCES.md`](./Fertig_WORK_RECESSION_SOURCES.md) (Philip-Dateiname, großes F; `Fertig_` bleibt, kein Case-Normalize in diesem Nachzug). Feature-Dateien des #177-Commits: `server/recession.ts`, `script/test-recession-sources.ts`, `script/test-recession-regions.ts`. analyze-route und researcher unberührt. Buffett-Stale-Gate: `DDDM01USA156NWDB` endet 2020-01-01 und zählt nicht als live (+10 / P_korr12 75%); Wilshire/GDP nur wenn beide Drucke im 18-Monats-Fenster liegen, sonst schließt dasselbe Stale-Gate den Slot. CAPE / FINRA N/A by design (kein xlsx), kein Blocker. Soft, blockieren `fertig_` nicht: Fazit-Vorlage „extreme Bewertungsniveaus“ bei Trends-getriebenem ≥65%; leerer Bewertungsrisiko-Block; Regeltabelle ×2 kosmetisch; `WILL5000PR` FRED HTML/404 → Buffett dauerhaft N/A bis andere Cap-Quelle. Keine Root-`Offen_` mehr. [`Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md`](./Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md) und [`Fertig_WORK_SECTION4_DATA_BUGS.md`](./Fertig_WORK_SECTION4_DATA_BUGS.md): Filename `Fertig_`, Feature-Lane noch offen (Drafts #150 / #168, kein Tester PASS, nicht Ampel 🟢). Sahm bleibt 🟢 `fertig_WORK_RECESSION_FRED_SAHM.md`. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Basis `6e125cdf`.

**Ampel-Kurz 05.10.2026, Tip `edbec6e6` (#170 Sahm EZ/JP, Tester PASS, Doublecheck GO, Bundle `index-BMeEs2YH.js`):** Sahm 🟢 und `fertig_WORK_RECESSION_FRED_SAHM.md`. Route `#/recession` Abschnitt 5. Soll = US `SAHMREALTIME` s(z), 0,50-pp-Label, regional Sahm US / EZ `une_rt_m` EA21 / JP `LRUNTTTTJPM156S`, EZ/JP nicht in der 17er-Summe, fehlende Monate leer. Soft, blockieren `fertig_` nicht: `controlOk` false, 2025-11 Δ=0.08 (Tester soft, kein FAIL); fehlende Monate leer (2025-10 fehlt in der US-Kontrolle, erwartet); Hinweis „nicht in der 17er-Summe“ für EZ/JP bestätigt (API: EZ/JP nur unter `sahmRegions`). Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Velocity Stocks bleibt 🟢 `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Drei offene Root-Specs (Drafts zählen nicht): Recession-Sources 🟡 · Researcher-LI 🟡 · Section4 🟡. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `edbec6e6`.

**Ampel-Kurz 05.10.2026, Tip `1937d389` (#149 Velocity Stocks, Tester PASS, Bundle `index-0g2LG3IP.js`):** Velocity Stocks 🟢 und `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md`. Route `#/researcher` `panel-regional-stocks` US/EU/ASIA = `GET /api/researcher/liquidity?region=`. π ehrlich „start unknown“. T½/V/V̄ konsistent. Debt/GDP bewegt `li` nicht. Soft, blockieren `fertig_` nicht: π-Zelle im Strip nicht gelb trotz `available.pi=false` (Spec sagt Gelb; Briefing-Panel ist gelb); US V 1.418 vs Briefing M2V n/a; ASIA `li` 0.1; JP T½ 683 J durch 0.1%-Boden; Capex-Cache fehlt → π „start unknown“ (kein Hardcode). Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Liquidity Briefing bleibt 🟢 `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Vier offene Root-Specs (Drafts zählen nicht): Sahm 🟡 · Recession-Sources 🟡 · Researcher-LI 🟡 · Section4 🟡. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `1937d389`.

**Ampel-Kurz 05.10.2026, Tip `d59541f5` (#166 Liquidity Briefing, Tester PASS, Bundle `index-BGJ8ARaM.js`):** Liquidity Briefing 🟢 und `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md`. Route `#/researcher` `panel-liquidity-briefing`, 40 Kacheln = `GET /api/researcher/liquidity-briefing`, 0 PLACEHOLDER. Soft, blockieren `fertig_` nicht: n/a CN 10y, π, US M2V/EMG, veraltete CPI; Japan Halbwertszeit T½ ~683 Jahre (ehrlich); Inflationszahlen JP/CN von 2025 (veraltet); API Cold-Start ~37s beim ersten Aufruf. Fiscal bleibt 🟢 `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Fünf offene Root-Specs (Drafts zählen nicht): Velocity-Stocks ⬜ · Sahm 🟡 · Recession-Sources 🟡 · Researcher-LI 🟡 · Section4 🟡. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `d59541f5`.

**Ampel-Kurz 05.10.2026, Tip `e8171961` (#145 Fiscal adaptiv, Tester PASS, Bundle `index-CDLHYWlv.js`):** Fiscal 🟢 und `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md`. Adaptives Frontend `s(z)` für Bills, TGA und SOMA auf main; GIS `macroFiscal` (Tester: GIS `S 55.6` = API `macroFiscal`); Stablecoin-Kanal sowie Karten `D_30` und GENIUS entfernt. Soft, blockieren `fertig_` nicht: Score-Badge ungerundet; FFR-Fallback nicht live reproduziert; BTC-News-RSS Nebenbefund im selben PR. Sechs offene Root-Specs (Drafts zählen nicht): Liquidity-Briefing-Quellen 🟡 · Velocity-Stocks ⬜ · Sahm 🟡 · Recession-Sources 🟡 · Researcher-LI 🟡 · Section4 🟡. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026 Tip `e8171961`.

**Ampel-Kurz 05.10.2026, Tip `191792c5` (#169 Docs-Renames, kein Live-Deploy):** Auf dem Tip bereits `fertig_`: Value-Chain, Researcher-Briefing regional, Stablecoin/T-Bill, `Fertig_MINER_INTEGRATION.md`. Sahm bleibt `Offen_WORK_RECESSION_FRED_SAHM.md`. Sieben offene Root-Specs (Code auf dem Tip, Drafts zählen nicht): Liquidity-Briefing-Quellen 🟡 · Fiscal-Frontend 🟡 · Velocity-Stocks ⬜ · Sahm 🟡 · Recession-Sources 🟡 · Researcher-LI 🟡 · Section4 🟡. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 05.10.2026.

**Ampel-Kurz 30.09. Vormittag, nach #103 Miner Observability Live PASS (DoD PASS, Bundle `index-MIF1Ml5X.js` — Client unverändert, #103 server-only):** #103 Miner Observability Live ✅ (tip `e2bc69a2`; parent `58bec00c` #101 Docs ← `c365c945` #100 ← `4c615eb3` #99; Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient 400ms; Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`); Dateien `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43; UI `Section13Miner` unverändert; Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = Render→mempool Egress, kein fehlender/gelöschter Code; Kernformeln Breakeven/Puell/Hash Ribbons unberührt) · #99 TA Spec v3.2 Live ✅ (SHA `4c615eb3` → stack tip `c365c945`; Bundle `index-MIF1Ml5X.js`; Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok, Mobile soft-skip; Shots `/workspace/dod-99-ta-v32/`) · #100 KI-N/A matrix (Relativ Bewertung / Section7) Live ✅ (tip `c365c945`; Spalten Segment|Rev.|Anteil|Wachstum|TAM|CAGR|Anteil am TAM|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert; Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt; Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet, keine Segments/keine N/A; 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0; Shots+Probe `/workspace/dod-100-ki-na/`) · #93 KI-N/A-Fill Segment-TAM ✅ Label cleared (Idle-Label jetzt Spec „N/A mit KI schätzen“ via #100 Live; Behavior+API war schon PASS @ `7574b12d`; Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt) · #97 TA Kurs A/B/C Spec v3.1 Live ✅ bleibt (superseded by v3.2 live on same chart stack; SHA `249841ab`; Bundle `index-C_rUCqgy.js`; 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder via `yDomainFromCloses` / `chart-price-bands`; `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL; DoD AAPL Shots `/workspace/dod-97-ta-kurs/`) · #92 TA Zwei-Fenster Live ✅ (SHA `c06c835e` → Fix `1dc82683` #94; Bundle `index-JP8muGsY.js`; A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster Extra An/Aus; Soft Draw-Order B-unter OK) · #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün · #90 TAM Coverage-Lift Live ✅ (DoD: AMZN 75.2% ok, NVDA 98.2% weak, MSFT 58.5% unreliable; Queue Coverage-Lift ✅) · #74 Batch A ✅ · #81–#83 ✅ · #84 Sharpe / #85 Attribution Live ✅ · #86 Tooltip / #88 Pie+360px Live ✅ · #87 thin-series 🟡 PARTIAL (healthy 251d, thin-Banner nicht repro) · #75/#76/#77 Live ✅ nach Deploy · #70/#72/#73/#69 Live ✅ · #71 4-Toggles 🟡 · Peer/ROIC intact · BL Tabelle+MC kein Scatter, Frontier ≥3 · Hormuz (B) 🟡 · Liquidity-Bundle ⬜ · Rang 7–9 blockiert. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md).

**Ampel-Kurz 11.10.2026, Tip `98ccc928` (#201 Gold MA50 und Cross-Marker, B2-Nachzug, parent `8add9ed1` #200, Tester PASS Soft vor dem Merge, Doublecheck Integrity GO):** Gold-Chart 🟡 Teil, nicht vollständig 🟢. Live-Slice #201 auf Tip `98ccc928`: 50-DMA, Golden/Death-Marker, B2 FV-Labels, ohne Score-Änderung. Kein neues `Offen_`/`fertig_`/`Fertig_` Spec-File. [`Future_10_Gold_Adaptive_Scoring_Framework.md`](./Future_10_Gold_Adaptive_Scoring_Framework.md) bleibt unter diesem Namen. [`Offen_FUTURE_SOLL_IST.md`](./Offen_FUTURE_SOLL_IST.md) und [`Future_Work.md`](./Future_Work.md) bleiben liegen. Bestehende `Fertig_`/`fertig_` unberührt. Feature-Dateien des #201-Commits: 6 Dateien, +474/−58 (`client/src/components/gold/goldChartMa.ts` added, `client/src/components/gold/GoldPriceChart.tsx`, `client/src/components/gold/GoldFairValueSection.tsx`, `client/src/pages/GoldDashboard.tsx`, `script/test-gold-ma-cross.ts` added, `script/test-gold-fv-label-layout.ts`). Datenkette: `#/gold` → `client/src/App.tsx` Route `/gold` → `client/src/pages/GoldDashboard.tsx` (`useQuery`, kein eigener Gold-Hook) → `GET /api/analyze-gold` → bei `!res.ok` `GOLD_FALLBACK_DATA` → `GoldPriceChart` / `GoldFairValueSection` → `server/routes.ts` `registerGoldRoutes` → `server/gold-routes.ts`. MA50 und Crosses entstehen im Client aus `close` und dem gelieferten `ma200` (`client/src/components/gold/goldChartMa.ts`). Kein neues Response-Feld. Soll: Mini-PR 3 in `Offen_FUTURE_SOLL_IST.md` plus Future_10 §4/§7 — MA50 aus vorhandenen Closes, Golden/Death als Marker, Volumen nicht mit Nullen füllen, `getTechnicalScore` unverändert. B2-Nachzug: nur preisbenachbarte Levels, Spot-Pill unter der Korridor-Überschrift, Kombi-Tooltip per Tap, FV-Linie endet über dem Lane-0-Label. Ist: Tip `98ccc928be5bfd0b5b1fc464ef13771207a3c9bc`. `getTechnicalScore` liest weiter nur RSI und die Betragsabweichung von der 200-DMA. GIS-Gewichte unverändert. `GoldPricePoint` hat kein `volume`. Tester PASS Soft vor dem Merge. Doublecheck Integrity GO. Softs, blockieren die Ampel nicht: Gold-Zeile im Cross-Tooltip doppelt (`Area` und `Line`, beide `dataKey="close"`); echter Touch-Input nicht verifiziert (Reducer `tap` im Unit-Test, Button über `onClick`). Adaptive Schicht, Volumen-Overlay, News-Flag, Policy-Gate und Death-Cross-Gate bleiben offen (Mini-PR 12). #209 Gold-Chart im BTC-Design gemergt auf Tip `a0979593` (parent `f0943dd5` #206). Doublecheck Integrity GO Soft: 7 Dateien byte-gleich mit dem gebauten Stand `9d14901a`, in BTC nur die JA/NEIN-Karte ausgelagert, #201-Marker erhalten, Overlays aus echten FRED-/FMP-Daten ohne Ersatzwerte. Status: live-Check ausstehend (Tester). Softs: 4 zusätzliche FRED-Abrufe pro Gold-Request, noch kein Build gelaufen. OFFEN: Volumen-Spike, relativer RSI, AISC, Future_10 Scoring-Rest (#208; 7 Layer mit Gewichtung/Habitat, adaptive Signale, Volumen-Signale, Gates Policy-Mismatch und Death Cross aktiv, Gold-News-Karte mit LLM-Flag). `Future_10_Gold_Adaptive_Scoring_Framework.md` bleibt offen, kein Rename. #180 HOLD — nicht anfassen. Der Google-Trends-Block von #205 (Abschnitt 18) bleibt unangetastet. Die Stand-Kopfzeile nennt Index-Tip `a0979593`. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) Abschnitt 11.10.2026 Tip `98ccc928`.

---

## Soll (nicht live / partial)

Keine offene Root-Feature-Lane auf Tip `8add9ed1`. #200 Google Trends Cache ist 🟢 und steht in der Ist-Tabelle. `Future_3_SerpApi_Rate_Limits.md`, `Future_4_Google_Trends_Conflict_and_Fixes.md` und `Future_5_Google_Trends_Cache_Implementation.md` bleiben unter diesen Namen (kein Rename, kein neues `Fertig_`/`fertig_`). #150 Liquidity Index Panel bleibt 🟢. Dateiname bleibt `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md` (kein Rename). #176 TAM Partial-Apply bleibt 🟢; kein neues Spec-File, Lane im Index geschlossen. Section4 bleibt 🟢. #180 HOLD — nicht anfassen.

| Datei | Inhalt |
|-------|--------|
| [Fertig_WORK_SECTION4_DATA_BUGS.md](./Fertig_WORK_SECTION4_DATA_BUGS.md) | 🟢 Tip `1124c6f5` (#168 über #187 `e045080c`, Tester PASS Soft, Bundle `index-wIPUcskT.js`, Shots `/workspace/dod-168-section4/`). Soll: last quarter, unique grades, one EPS CAGR. Ist: Doublecheck GO Soft — 10 Dateien +599/−41; analyze-route 22/22 Deletes verified; researcher unberührt. Softs blockieren nicht: Quartal nur Datum; BN Moat None vs Narrow-Inkonsistenz; PEG-Label. Dateiname bleibt `Fertig_` |

Ampel: [docs/Doc_Soll_vs_Ist/README.md](./docs/Doc_Soll_vs_Ist/README.md)

**Ampel Google Trends Cache 11.10.2026 (Tip `8add9ed1`, #200, parent `cc683e96` #195, Tester PASS Soft Production, Doublecheck GO Soft):** Google Trends Cache 🟢. Soll = `Future_3_SerpApi_Rate_Limits.md`, `Future_4_Google_Trends_Conflict_and_Fixes.md`, `Future_5_Google_Trends_Cache_Implementation.md`: Cache 6–12h (Future_5: 12h, Key `google-trends-recession`); bei 429, leerer Timeline oder Timeout den letzten gültigen Wert weiter scoren; UI „Google Trends: letzter Wert von vor X Stunden“; nur ohne Wert in 48h den Slot als nicht verfügbar schließen, nicht als Score 0; Zonen >75 / 60–75 / 30–60 / <30 und Gewicht ×1,7, Max 11,9 bleiben. Ist = Tip `8add9ed1e6d599283368896127711486955855f3` (#200, parent `cc683e96805f1732c5eecf3abec6226c69b9e30c` #195). `server/cache/google-trends-cache.ts`: frisch 12h, Last-Good 48h, `isStale` über 24h (Future_5-Skizze `> 6` ist nicht umgesetzt). `scoreGoogleTrends` in `server/recession.ts`. UI: `client/src/components/recession/recessionDashboardPartsB1.tsx`, `client/src/components/recession/recessionDashboardPartsB2.tsx`, Typen in `recessionDashboardShared.tsx`. Live PASS Soft Production: Zeile `vor 0.0h`, Satz „61.2“ entfernt, Korrektur 12M bleibt 80 %, `ageHours`/`isStale` im Body von `POST /api/analyze-recession`. Doublecheck GO Soft. Datenkette: `#/recession` → `RecessionDashboard` `useMutation` → `POST /api/analyze-recession` → `registerRecessionRoutes` → `runRecessionAnalysis` → `scoreGoogleTrends` → Cache oder SerpApi → `googleReading` → Tabelle und Summary. `useRecessionCatalog` liest nur `regions`. Keine neue Route. Feature-Dateien: 6 Dateien, +392/−41. Die 1h-Analyse-Hülle `recessionCache` ist nicht dieser Cache und bleibt. Dateinamen `Future_3`/`Future_4`/`Future_5` bleiben (dieser Nachzug benennt nicht um, kein neues `Fertig_`/`fertig_`, kein Rückbau nach `Offen_`). Softs, blockieren nicht: „veraltet“ nur nach >24h prüfbar; Cache-Hits nur im Render-Log; Cache nur In-Memory; Anzeige `0.0h` kosmetisch. Redis, Retry-Backoff, pytrends und Plan-Wechsel sind nicht in #200. Liquidity Index Panel, TAM Partial-Apply, Section4, Recession Sources, Sahm, Velocity, Briefing und Fiscal bleiben 🟢. #180 HOLD — nicht anfassen.

**Ampel Liquidity Index Panel 05.10.2026 (Tip `99feff6f`, #150, parent `e3c94d11` #189, Tester PASS Soft, Shots `/workspace/dod-150-li/`, Bundle `index-xA_h1JP9.js`):** `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX` 🟢. Soll = LiquidityIndexPanel({ region }) auf Macro; Region-Toggle ändert Serie/asOf; `GET /api/researcher/liquidity?region=US|EU|ASIA`; US DFF+M2SL; C2 LiquidityPanel nur nach Analyse einmal; ohne Analyse kein zweites LI; Briefing/RegionalStocks bleiben. Ist = Tip `99feff6f755a26e8eaa3c4114f69f3ddac1e002c` (#150 über #189 `e3c94d11`). Live PASS Soft: Panel einmal zwischen Briefing und Country Macro Pulse; US LI 47.2 DFF+M2SL available; EU LI 42.6; ASIA Softs. Bundle `index-xA_h1JP9.js`. Shots `/workspace/dod-150-li/`. Doublecheck Integrity GO Soft. Datenkette: `#/researcher` Macro → LiquidityIndexPanel → `GET /api/researcher/liquidity?region=` → `server/liquidity-index*`. Feature-Dateien: `client/src/components/researcher/LiquidityIndexPanel.tsx` (added), `client/src/components/researcher/MacroPanel.tsx`, `client/src/components/researcher/liquidity-index-panel.ts` (added), `client/src/pages/Researcher.tsx`, `script/test-liquidity-index-panel.ts` (added), `script/test-liquidity-index.ts`, `server/liquidity-index-catalog.ts`, `server/liquidity-index.ts`, 8 Dateien +457/−7. analyze-route und `researcher.ts` unberührt. Fertig_ Spec im Feature-Commit unberührt. Dateiname bleibt `Fertig_` seit `3fd864a7` (großes F; dieser Nachzug benennt nicht um, kein `fertig_`-Normalize, kein Rückbau nach `Offen_`). Softs, blockieren nicht: Fiskal Spec-Klarstellung (Spec wollte „Fiskal-Angebot n/v“ wenn keine Quelle; Ist: BUYBACK_OPS n/v, Fiskalzeile zeigt MSPD_BILLS/QRA_IMPLIED_BILLS wenn Slot da); ASIA (BOJ_GOVDEP n/v, keine DRAIN-Karte, Kopf-Stand asOf 2024-01-01 wegen stale CN_M2); Performance (Doppel-Fetch 2×/Region; EU Erstload 15–20s). TAM Partial-Apply, Section4, Recession Sources, Sahm, Velocity, Briefing und Fiscal bleiben 🟢. #180 HOLD — nicht anfassen.

**Ampel TAM Partial-Apply 05.10.2026 (Tip `31d9f367`, #176, parent `39d1afd6` #188, Tester PASS Soft AMZN, Bundle `index-BcyRdipm.js`):** Segment-TAM KI Partial-Apply + hide 0-Rev in Section7 (Rel. Bewertung / Sektion 9) 🟢. Kein neues `Offen_`/`fertig_` Spec-File; Lane im Index geschlossen. Soll = Partial-Apply: gültige KI-Fills behalten (violet KI-Badge); offene Zellen bleiben n/a; kein all-or-nothing 422 wenn mindestens ein Fill brauchbar. Rev null/0 aus Tabelle, Prompt und Fill-Scope (`hasPositiveSegmentRevenue`); Beispielzeile `Other / nicht segmentiert` $0. Facts (Rev, Anteil, Coverage, tamTotal, quality) nicht überschreiben/neu berechnen; Anteil am TAM / vs. TAM lokale Formeln; Peer-N/A unberührt; analyze-route Handler nur Kommentar. Ist = Tip `31d9f3672fc19eee584befe80dbe318953f2a868` (#176 über #188 `39d1afd6`). Live PASS Soft AMZN: 7 Zeilen statt 8, KI ✓, coverage 75%, API 200. Bundle `index-BcyRdipm.js`. Doublecheck GO Soft. `npx tsx script/test-tam-na-fill.ts` 125 passed. Datenkette: Section7 → `POST /api/analyze/:ticker/tam-na-fill` → `requestTamNaFills` → `shared/tam-na-fill`. Feature-Dateien: `shared/tam-na-fill.ts`, `server/tam-na-fill.ts`, `client/src/components/sections/Section7.tsx`, `script/test-tam-na-fill.ts`, `server/analyze-route.ts` (comment only), 5 Dateien +214/−48. Soft, blockiert nicht: Partial-Lückenfall live nicht gesehen (Modell füllte alles); Unit-Tests decken Partial-Apply / offene Rest-Zellen ab. #180 HOLD — nicht anfassen. Section4, Recession Sources, Researcher-LI, Sahm, Velocity, Briefing und Fiscal bleiben 🟢. `Fertig_` bleibt (großes F; dieser Nachzug benennt nicht um, kein `fertig_`-Normalize, kein Rückbau nach `Offen_`).

**Ampel Section4 05.10.2026 (Tip `1124c6f5`, #168, parent `e045080c` #187, Tester PASS Soft, Shots `/workspace/dod-168-section4/`, Bundle `index-wIPUcskT.js`):** `Fertig_WORK_SECTION4_DATA_BUGS` 🟢. Soll = Section4 last quarter, unique grades, one EPS CAGR per `Fertig_WORK_SECTION4_DATA_BUGS.md` / #168 DoD. Ist = Tip `1124c6f5a238e0e023bfc3e6f4e69be7320c5b9e`, Doublecheck GO Soft — 10 Dateien +599/−41; analyze-route 22/22 Deletes verified; researcher unberührt. Tester PASS Soft. Bundle `index-wIPUcskT.js`. Shots `/workspace/dod-168-section4/`. Feature-Dateien: `client/src/components/sections/EpsGrowthChart.tsx`, `client/src/components/sections/FinancialStatements.tsx`, `client/src/components/sections/Section1.tsx`, `client/src/components/sections/Section2.tsx`, `script/test-section4-labels-moat.ts`, `server/analyze-helpers.ts`, `server/analyze-route.ts`, `server/fmp-fetcher.ts`, `server/fmp.ts`, `shared/schema.ts`. Dateiname bleibt `Fertig_` seit `6e125cdf` (großes F; dieser Nachzug benennt nicht um, kein `fertig_`-Normalize, kein Rückbau nach `Offen_`). Soft, blockieren nicht: Quartal nur Datum; BN Moat None vs Narrow-Inkonsistenz; PEG-Label. Recession Sources, Researcher-LI, Sahm, Velocity, Briefing und Fiscal bleiben 🟢.

**Ampel Gold MA50 11.10.2026 (Tip `98ccc928`, #201, parent `8add9ed1` #200, Tester PASS Soft vor dem Merge, Doublecheck Integrity GO):** Gold-Chart 🟡 Teil, nicht vollständig 🟢. Live-Slice #201 auf Tip `98ccc928`: 50-DMA, Golden/Death-Marker, B2 FV-Labels, ohne Score-Änderung. Kein neues `Offen_`/`fertig_`/`Fertig_` Spec-File. Soll = `Offen_FUTURE_SOLL_IST.md` Mini-PR 3, `Future_10_Gold_Adaptive_Scoring_Framework.md` §4 und §7, `Future_Work.md` Gold-Chart: MA50 aus den Closes, die der Preis-Fetch schon liefert, neben der 200-DMA; Golden Cross = 50-MA kreuzt 200-MA von unten, Death Cross von oben, als Marker; Volumen nur zeichnen, wenn die Serie es enthält; `getTechnicalScore` bleibt. B2-Nachzug zu #194: `mergePriceAdjacentGroups` nur für Nachbarn in der Preisordnung; `corridorSpotTopPadPx` hält die Spot-Pill unter der Überschrift; `reduceComboTooltip` öffnet das Kombi-Label per Tap; `fvMarkerBottomInsetPx` stoppt die FV-Linie über einem Lane-0-Label. Ist = Tip `98ccc928be5bfd0b5b1fc464ef13771207a3c9bc`. Client `client/src/components/gold/goldChartMa.ts` (`trailingSma`, `withClientMa50`, `detectMaCrosses`), Linie `#84cc16` und Marker `GC`/`DC` in `client/src/components/gold/GoldPriceChart.tsx`. Server `server/gold-routes.ts` schreibt `historicalPrices.push({ date, close })` und `ma200`, kein `ma50`, kein `volume`. `shared/gold-schema.ts` `GoldPricePoint`: `date`, `close`, optionales `ma200`, optionales `real10y`. `getTechnicalScore` ohne Cross und ohne Volumen. Live-Kette `#/gold` → `GoldDashboard` `useQuery` → `GET /api/analyze-gold` → `registerGoldRoutes`. Bei HTTP-Fehler `GOLD_FALLBACK_DATA` (`historicalPrices: []` → Chart „Keine Preisdaten“, keine erfundene MA). Feature-Dateien: 6 Dateien, +474/−58. Tester PASS Soft vor dem Merge. Doublecheck Integrity GO. Softs, blockieren nicht: Gold-Zeile im Cross-Tooltip doppelt; echter Touch nicht verifiziert. Dateiname `Future_10` bleibt. Adaptive Gewichte, Volumen-Overlay, News-Flag, Policy-Mismatch und Gate „Death Cross aktiv“ bleiben offen. #209 Gold-Chart im BTC-Design gemergt auf Tip `a0979593` (parent `f0943dd5` #206). Doublecheck Integrity GO Soft: 7 Dateien byte-gleich mit dem gebauten Stand `9d14901a`, in BTC nur die JA/NEIN-Karte ausgelagert, #201-Marker erhalten, Overlays aus echten FRED-/FMP-Daten ohne Ersatzwerte. Status: live-Check ausstehend (Tester). Softs: 4 zusätzliche FRED-Abrufe pro Gold-Request, noch kein Build gelaufen. OFFEN: Volumen-Spike, relativer RSI, AISC, Future_10 Scoring-Rest (#208; 7 Layer mit Gewichtung/Habitat, adaptive Signale, Volumen-Signale, Gates Policy-Mismatch und Death Cross aktiv, Gold-News-Karte mit LLM-Flag). Kein Rename. Liquidity Index Panel, TAM Partial-Apply, Section4, Recession Sources, Sahm, Velocity, Briefing und Fiscal bleiben 🟢. #180 HOLD — nicht anfassen. Draft #205 (Google Trends) ist ein eigener Abschnitt und wird hier nicht umgeschrieben.

**Ampel Recession Sources STOXX PE Soft-Fix 05.10.2026 (Tip `8acf0e46`, #186, parent `ba476e0e` #185, Tester PASS Soft ~16:21 CEST, Shots `/workspace/dod-186-stoxx-pe/`, Bundle `index-Ubb-bF_f.js` unverändert, server-only):** `Fertig_WORK_RECESSION_SOURCES` 🟢. Soll = EZ-Katalog STOXX 600 PE mit live Wert+Quelle+Zone+Score (nicht N/A, wenn EXSA KGV da ist). Ist = Tip `8acf0e46d80ed81391ef8929ce715f0ad300d87d`, live PASS Soft ~16:21 CEST: `#/recession` EZ-Katalog STOXX 600 PE 18.4, Quelle iShares EXSA KGV 2026-10-02, Zone Normal (15-30), scored available:true. Vorheriges Soft N/A („FMP leer, iShares ohne KGV“) ist für den live EXSA-KGV-Pfad zu. Feature-Dateien: `server/recession-regions.ts`, `script/test-recession-regions.ts`, +128/−16. analyze-route und researcher unberührt. Doublecheck GO Soft. Dateiname bleibt `Fertig_` seit `83e630ab` (großes F; dieser Nachzug benennt nicht um, kein `fertig_`-Normalize, kein Rückbau nach `Offen_`). Soft, blockieren nicht und bleiben aus #184: Margin Wert unscored; TOPIX/JNVI/JGB. `Fertig_WORK_SECTION4_DATA_BUGS`: Filename `Fertig_`, Feature-Lane noch offen (Draft #168, nicht Ampel 🟢). Researcher-LI, Sahm, Velocity, Briefing und Fiscal bleiben 🟢.

**Ampel Recession Sources N/A fills 05.10.2026 (Tip `37a188ef`, #184, parent `11e0e617` #183, Tester PASS Soft, Shots `/workspace/dod-184-recession-na/`):** `Fertig_WORK_RECESSION_SOURCES` 🟢. Soll = CAPE/Buffett/STOXX/JP-Aktivität mit Wert+Score wo möglich. Ist = Tip `37a188efdb5f61438f92ae9920766bc71fe7ae16`, live PASS Soft: CAPE 41.4 Multpl; Buffett 236% Yahoo/GDP; JP YoY +2.1% OECD; Margin Wert unscored Soft; STOXX live weiter N/A Soft (VM hatte 18.4); TOPIX/JNVI/JGB Soft. Feature-Dateien: 6 Dateien, +370/−55. Dateiname bleibt `Fertig_` seit `83e630ab` (großes F; dieser Nachzug benennt nicht um, kein `fertig_`-Normalize, kein Rückbau nach `Offen_`). Soft, blockieren nicht: Margin Wert unscored; STOXX live N/A (VM 18.4); TOPIX/JNVI/JGB. `Fertig_WORK_SECTION4_DATA_BUGS`: Filename `Fertig_`, Feature-Lane noch offen (Draft #168, nicht Ampel 🟢). Researcher-LI, Sahm, Velocity, Briefing und Fiscal bleiben 🟢.

**Ampel Researcher N/A fill 05.10.2026 (Tip `88f4ee92`, #182, parent `17847752` #181, Tester PASS Soft, Shots `/workspace/dod-182-researcher-na/`):** `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX` 🟢. Soll = zuvor n/a-Zellen in Briefing und regionaler Liquidität mit Wert+Quelle+asOf. Ist = Tip `88f4ee92c5d8a313ebe266851e8408794a149df5`, live PASS Soft: 18/20 Briefing-Nulls gefüllt; US/EU regional 0 Nulls; ASIA nur `BOJ_GOVDEP` Soft. Feature-Dateien: 14 Dateien, +696/−79. Dateiname bleibt `Fertig_` seit `3fd864a7` (großes F; dieser Nachzug benennt nicht um, kein `fertig_`-Normalize, kein Rückbau nach `Offen_`). Soft, blockiert nicht: ASIA `BOJ_GOVDEP` bleibt N/A/null. `Fertig_WORK_SECTION4_DATA_BUGS`: Filename `Fertig_`, Feature-Lane noch offen (Draft #168, nicht Ampel 🟢). Sources, Sahm, Velocity, Briefing und Fiscal bleiben 🟢.

**Ampel Fazit-Soft 05.10.2026 (Tip `860ff710`, #179, parent `71254a45` #178, Tester PASS, live `#/recession`, kein Bundle-Hash):** `Fertig_WORK_RECESSION_SOURCES` bleibt 🟢. Soll (Philip Soft) = kein Bewertungs-Wording, wenn keine Bewertung gewertet ist; Bewertungsrisiko darf nicht leer sein. Ist = Tip `860ff710b0a04e219be50ed34fb25b7b3f56a919`, Treiber Google Trends / CSI / Aktivität, Bewertungsrisiko „nicht gewertet“, Buffett 195%(2020-01) N/A (Stale-Gate). Feature-Dateien: `server/recession.ts`, `script/test-recession-sources.ts` (+74/−4). analyze-route und researcher unberührt. Dateiname bleibt `Fertig_` seit `83e630ab` (großes F; dieser Nachzug benennt nicht um). Soft, blockieren nicht: negative Scores in der Treiberliste; News-Titel-Prefix in den Driver-Karten. Weiterhin nicht Gegenstand von #179: Regeltabelle ×2 kosmetisch; `WILL5000PR` FRED HTML/404 → Buffett dauerhaft N/A bis andere Cap-Quelle. `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX` und `Fertig_WORK_SECTION4_DATA_BUGS`: Filename `Fertig_`, Feature-Lane noch offen (Drafts #150 / #168, nicht Ampel 🟢). Sahm, Velocity, Briefing und Fiscal bleiben 🟢 `fertig_`.

**Ampel Recession Sources 05.10.2026 (Basis `6e125cdf`, Feature-Tip `b43bc7a6`, Tester PASS HARD, live Render):** `Fertig_WORK_RECESSION_SOURCES` 🟢. Soll = die neun Punkte der Spec plus EZ/JP-Raster und Buffett Wilshire/GDP oder World Bank. Ist = Feature-Tip `b43bc7a694582e1708feb3a2c4bc3a9c415b45c1` (#177 über #167 `0c31b896`), Dateiname seit `83e630ab` `Fertig_` (großes F; dieser Nachzug benennt nicht um). Tester PASS (HARD) Buffett Re-Check 2026-10-05 ~14:35 Europe/Berlin. Doublecheck über #177. Buffett-Stale-Gate: `DDDM01USA156NWDB` endet 2020-01-01 und zählt nicht als live (+10 / P_korr12 75%); Wilshire/GDP nur bei beiden Drucken im 18-Monats-Fenster, sonst schließt dasselbe Gate den Slot. CAPE / FINRA N/A by design (kein xlsx). Soft, blockieren nicht: Fazit-Vorlage „extreme Bewertungsniveaus“ bei Trends-getriebenem ≥65%; leerer Bewertungsrisiko-Block; Regeltabelle ×2 kosmetisch; `WILL5000PR` FRED HTML/404 → Buffett dauerhaft N/A bis andere Cap-Quelle. Keine Root-`Offen_` mehr. `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX` und `Fertig_WORK_SECTION4_DATA_BUGS`: Filename `Fertig_`, Feature-Lane noch offen (Drafts #150 / #168, nicht Ampel 🟢). Sahm, Velocity, Briefing und Fiscal bleiben 🟢 `fertig_`.

**Ampel Sahm 05.10.2026 (Tip `edbec6e6`, main + Tester PASS, Doublecheck GO):** `fertig_WORK_RECESSION_FRED_SAHM` 🟢. Soll = Spec `Offen_WORK_RECESSION_FRED_SAHM` (US `SAHMREALTIME` s(z), 0,50-pp-Label, regional Sahm US / EZ `une_rt_m` EA21 / JP `LRUNTTTTJPM156S`, EZ/JP nicht in der 17er-Summe, fehlende Monate leer). Ist = Tip `edbec6e6` plus live `#/recession` Abschnitt 5, Bundle `index-BMeEs2YH.js`. Soft, blockieren `fertig_` nicht: `controlOk` false, 2025-11 Δ=0.08 (Tester soft, kein FAIL); fehlende Monate leer (2025-10 fehlt in der US-Kontrolle, erwartet); Hinweis „nicht in der 17er-Summe“ für EZ/JP bestätigt (API: EZ/JP nur unter `sahmRegions`). Fiscal bleibt 🟢 `fertig_`. Liquidity Briefing bleibt 🟢 `fertig_`. Velocity Stocks bleibt 🟢 `fertig_`. Die übrigen drei `Offen_`-Specs stehen in der Soll-Tabelle. Dublette `docs/work-offen/WORK_RESEARCHER_BRIEFING_REGIONAL.md` bleibt liegen.

**Ampel Velocity-Stocks 05.10.2026 (Tip `1937d389`, main + Tester PASS):** `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY` 🟢. Soll = Stocks-Zeilen, T½, V/V̄, π (Philip: age×V/V̄, kein F-Rest) laut der Spec. Ist = Tip `1937d389` plus live `#/researcher` `panel-regional-stocks` US/EU/ASIA / `GET /api/researcher/liquidity?region=`. π ehrlich „start unknown“. T½/V/V̄ konsistent. Debt/GDP bewegt `li` nicht. Soft, blockieren `fertig_` nicht: π-Zelle im Strip nicht gelb trotz `available.pi=false` (Spec sagt Gelb; Briefing-Panel ist gelb); US V 1.418 vs Briefing M2V n/a; ASIA `li` 0.1; JP T½ 683 J durch 0.1%-Boden; Capex-Cache fehlt → π „start unknown“ (kein Hardcode). Fiscal bleibt 🟢 `fertig_`. Liquidity Briefing bleibt 🟢 `fertig_`. Die übrigen vier `Offen_`-Specs stehen in der Soll-Tabelle. Dublette `docs/work-offen/WORK_RESEARCHER_BRIEFING_REGIONAL.md` bleibt liegen.

**Ampel Liquidity-Briefing 05.10.2026 (Tip `d59541f5`, main + Tester PASS):** `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING` 🟢. Soll = Katalogquellen/Serien im Briefing. Ist = Tip `d59541f5` plus live `#/researcher` `panel-liquidity-briefing` / `GET /api/researcher/liquidity-briefing`, 40 Kacheln, 0 PLACEHOLDER. Soft, blockieren `fertig_` nicht: n/a CN 10y, π, US M2V/EMG, veraltete CPI; Japan Halbwertszeit T½ ~683 Jahre (ehrlich); Inflationszahlen JP/CN von 2025 (veraltet); API Cold-Start ~37s beim ersten Aufruf. Fiscal bleibt 🟢 `fertig_`. Die übrigen fünf `Offen_`-Specs stehen in der Soll-Tabelle.

**Ampel Fiscal-Frontend 05.10.2026 (Tip `e8171961`, main + Tester PASS):** `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE` 🟢. Adaptives `s(z)` für Bills, TGA und SOMA liegt auf main. GIS-Slot ist `macroFiscal` (Tester PASS: GIS `S 55.6` = API `macroFiscal`). Stablecoin-Kanal sowie die Karten `D_30` und GENIUS sind entfernt. Soft, blockieren `fertig_` nicht: Score-Badge ungerundet; FFR-Fallback nicht live reproduziert; BTC-News-RSS Nebenbefund im selben PR. Cron 22:00 ET / QRA-PDF bleiben optional. Die übrigen sechs `Offen_`-Specs stehen in der Soll-Tabelle.

**Ampel Fiscal-Frontend 2026-10-04:** `Offen_WORK_FISCAL_FRONTEND_ADAPTIVE` bleibt `Offen_` und 🟡. Route `GET /api/analyze-btc/fiscal-frontend`, Karten in `StablecoinLiquidityPanel`, Ops-Label im LiquidityPanel. `S_F*` aus MSPD-Monats-FE (`ΔWSHOBL` ~28T − `N^b`) plus TGA, sobald die Historie reicht. `D_30` nur im Live-`FE_30`. Step 6: der Macro-Slot in `btcAnalysis.ts` nimmt `score_MacroFiscal`, sobald `FE.available`. Step 7 (Cron 22:00 ET / QRA-PDF) ist in der Spec optional und bleibt aus. Auf `#/btc` zeigt der Slot bei `FE.available` den Wert `S` aus `GET /api/analyze-btc/fiscal-frontend`.

**Ampel 05.10.2026 (Tip `191792c5`, nur Code, kein Deploy):** Fiscal bleibt 🟡 und `Offen_` — `S_F*` aus MSPD-Monats-FE (`ΔWSHOBL` ~28T − `N^b`) plus TGA, sobald die Historie reicht; der Macro-Slot nimmt `score_MacroFiscal`, sobald `FE.available`. Cron 22:00 ET / QRA-PDF bleiben optional und aus. Die übrigen sechs offenen Specs stehen in der Soll-Tabelle.

---

## Ist (Kern im Code)

| Datei | Inhalt |
|-------|--------|
| [fertig_WORK_EXEC_SUMMARY.md](./fertig_WORK_EXEC_SUMMARY.md) | Exec vor S1 live (#58) |
| [docs/Doc_Soll_vs_Ist/FACTPACK_LLM.md](./docs/Doc_Soll_vs_Ist/FACTPACK_LLM.md) | FactPack Hook+UI live (#57) |
| [fertig_WORK_RECESSION_RSI_MACD.md](./fertig_WORK_RECESSION_RSI_MACD.md) | RSI/MACD Dashboard live |
| [fertig_WORK_RECESSION_MARKET_CHARTS.md](./fertig_WORK_RECESSION_MARKET_CHARTS.md) | Vier Märkte, Klick-Factpack, FINRA nur unter SPY |
| [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) | Audit 11.10.2026 Tip `8add9ed1` (Google Trends Cache 🟢 #200, Tester PASS Soft Production; Liquidity Index Panel 🟢; TAM Partial-Apply 🟢; Section4 🟢; Recession Sources 🟢; Keep-Alive grün, kein Ampel-ROT) |
| [fertig_WORK_THESIS_LAB.md](./fertig_WORK_THESIS_LAB.md) | `/#/lab` Live PASS (#73) |
| [WORK_IMPLEMENTIERUNG_OFFEN.md](./WORK_IMPLEMENTIERUNG_OFFEN.md) | D6 Rang 7–9, Dateiname jetzt `fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md`; Google Trends Cache #200 🟢 im Index (Tip `8add9ed1`, `Future_3`/`Future_4`/`Future_5` bleiben diese Namen; Softs „veraltet“ erst >24h, Cache-Hits nur Render-Log, nur In-Memory, `0.0h` kosmetisch); TAM Partial-Apply #176 🟢 im Index (Tip `31d9f367` über #188 `39d1afd6`, kein neues Spec-File; Soft Partial-Lückenfall live nicht gesehen); Section4 `Fertig_` 🟢 (#168 Tester PASS Soft Tip `1124c6f5`, über #187 `e045080c`; Softs Quartal nur Datum, BN Moat None vs Narrow, PEG-Label); Sources `Fertig_` 🟢 (#186 STOXX PE Soft-Fix PASS Soft Tip `8acf0e46`, über #184 `37a188ef`); Sahm `fertig_` 🟢 (#170); Liquidity-Briefing `fertig_` 🟢 (#166); Velocity-Stocks `fertig_` 🟢 (#149); Researcher-LI Panel `Fertig_` 🟢 (#150 Tester PASS Soft Tip `99feff6f` über #189 `e3c94d11`, Bundle `index-xA_h1JP9.js`; Softs Fiskal-Klarstellung, ASIA, Doppel-Fetch); #182 N/A-Fill bleibt 🟢; #180 HOLD |
| [fertig_WORK_ANALYZE_DISK_CACHE.md](./fertig_WORK_ANALYZE_DISK_CACHE.md) | 7-Tage-KI-Catch, L1+L2, force löscht beide |
| [fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md](./fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md) | Analyze-Route an die 7-Tage-Disk gehängt |
| [fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md](./fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md) | C2 US-only |
| [fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md](./fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md) | CATALOG.US/EU/ASIA, `?region=` books.M/F |
| [fertig_WORK_STABLECOIN_TBILL_GENIUS.md](./fertig_WORK_STABLECOIN_TBILL_GENIUS.md) | BTC Sektion 14 (#165, bereits `fertig_` auf dem Tip) |
| [fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md](./fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md) | 🟢 adaptives `s(z)` Bills/TGA/SOMA (#145, Tester PASS, Bundle `index-CDLHYWlv.js`); GIS `macroFiscal`; Softs blockieren nicht |
| [fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md](./fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md) | 🟢 Katalogquellen/Serien im Briefing (#166, Tester PASS, Bundle `index-BGJ8ARaM.js`); 40 Kacheln live. #182 Tip `88f4ee92` Tester PASS Soft: 18/20 zuvor n/a-Zellen mit Wert+Quelle+asOf. Ältere Softs T½ JP ~683 Jahre, Inflation JP/CN 2025, Cold-Start ~37s blockieren nicht |
| [fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md](./fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md) | 🟢 Stocks-Zeilen, T½, V/V̄, π (Philip: age×V/V̄, kein F-Rest) (#149, Tester PASS, Bundle `index-0g2LG3IP.js`); `#/researcher` `panel-regional-stocks` US/EU/ASIA = `GET /api/researcher/liquidity?region=`; π „start unknown“; Softs blockieren nicht |
| [Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md](./Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md) | 🟢 Liquidity Index Panel auf Macro (#150, Tester PASS Soft, Tip `99feff6f` über #189 `e3c94d11`, Bundle `index-xA_h1JP9.js`, Shots `/workspace/dod-150-li/`); Dateiname bleibt `Fertig_` seit `3fd864a7`; Panel einmal zwischen Briefing und Country Macro Pulse; US LI 47.2 DFF+M2SL available; EU LI 42.6; #182 N/A-Fill bleibt (18/20 Briefing-Nulls, US/EU regional 0 Nulls). Softs blockieren nicht: Fiskal-Klarstellung BUYBACK_OPS n/v vs Spec „Fiskal-Angebot n/v“; ASIA BOJ_GOVDEP n/v, keine DRAIN-Karte, asOf 2024-01-01 stale CN_M2; Doppel-Fetch 2×/Region, EU Erstload 15–20s |
| [fertig_WORK_RECESSION_FRED_SAHM.md](./fertig_WORK_RECESSION_FRED_SAHM.md) | 🟢 US `SAHMREALTIME` s(z), 0,50-pp-Label, regional Sahm US / EZ `une_rt_m` EA21 / JP `LRUNTTTTJPM156S` (#170, Tester PASS, Doublecheck GO, Bundle `index-BMeEs2YH.js`); `#/recession` Abschnitt 5; EZ/JP nicht in der 17er-Summe; fehlende Monate leer; Softs blockieren nicht |
| [Fertig_WORK_RECESSION_SOURCES.md](./Fertig_WORK_RECESSION_SOURCES.md) | 🟢 Quellenkatalog, Nachzug #186 STOXX PE Soft-Fix (Tip `8acf0e46` über #185 `ba476e0e`, Tester PASS Soft ~16:21 CEST, Shots `/workspace/dod-186-stoxx-pe/`, Bundle `index-Ubb-bF_f.js` unverändert, live `#/recession`); Dateiname bleibt `Fertig_` seit `83e630ab`; EZ-Katalog STOXX 600 PE 18.4, Quelle iShares EXSA KGV 2026-10-02, Zone Normal (15-30), available:true; Soft „STOXX live N/A“ für den live EXSA-KGV-Pfad zu; Softs blockieren nicht: Margin Wert unscored; TOPIX/JNVI/JGB |
| [Fertig_WORK_SECTION4_DATA_BUGS.md](./Fertig_WORK_SECTION4_DATA_BUGS.md) | 🟢 last quarter, unique grades, one EPS CAGR (#168, Tester PASS Soft, Tip `1124c6f5`, parent `e045080c` #187, Bundle `index-wIPUcskT.js`, Shots `/workspace/dod-168-section4/`); Dateiname bleibt `Fertig_` seit `6e125cdf`; Doublecheck GO Soft, 10 Dateien +599/−41; analyze-route 22/22 Deletes verified; researcher unberührt; Softs blockieren nicht: Quartal nur Datum; BN Moat None vs Narrow-Inkonsistenz; PEG-Label |
| [Future_10_Gold_Adaptive_Scoring_Framework.md](./Future_10_Gold_Adaptive_Scoring_Framework.md) | 🟡 Teil, nicht vollständig 🟢. Live-Slice #201 (Tip `98ccc928`, parent `8add9ed1` #200, Tester PASS Soft vor dem Merge, Doublecheck Integrity GO): 50-DMA, Golden/Death-Marker, B2 FV-Labels, Score unverändert. Dateiname bleibt `Future_10`, kein Rename. #209 BTC-Design gemergt auf `a0979593`, Doublecheck Integrity GO Soft, live-Check ausstehend (Tester). OFFEN: Volumen-Spike, relativer RSI, AISC, Future_10 Scoring-Rest (#208). Siehe Abschnitt 19 in `WORK_IST_VS_SOLL.md` |
| [Offen_FUTURE_SOLL_IST.md](./Offen_FUTURE_SOLL_IST.md) | 🟡 Teil. Mini-PR 3 (MA50, Cross-Marker, kein Volumen aus Nullen, `getTechnicalScore` unverändert) ist der Live-Slice auf Tip `98ccc928` (#201). Dateiname bleibt `Offen_`. Mini-PR 12 und der Future_10-Rest bleiben OFFEN (Agent `bc-2ccda1a5`). BTC-Design 1:1 ist mit #209 auf `a0979593` gemergt, live-Check ausstehend (Tester) |
| [fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md](./fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md) | Value-Chain (#169 Docs-Rename; kein Live-Deploy aus diesem Commit) |
| [fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md](./fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md) | Briefing 3 Regionen (#169 Docs-Rename; kein Live-Deploy aus diesem Commit) |
| [fertig_WORK_ANTIBIAS_DCF.md](./fertig_WORK_ANTIBIAS_DCF.md) | Inverted DCF |
| [fertig_WORK_REVERSE_DCF_BRIDGE.md](./fertig_WORK_REVERSE_DCF_BRIDGE.md) | Fiscal Bridge |
| [fertig_WORK_PORTFOLIO.md](./fertig_WORK_PORTFOLIO.md) | Portfolio |
| [fertig_WORK.md_portfolio_3](./fertig_WORK.md_portfolio_3) | §6 OHLCV Charts live — Tester AAPL 1Y/2Y PASS @ `6a1807b` |
| [fertig_WORK_PORTFOLIO_BACKTEST.md](./fertig_WORK_PORTFOLIO_BACKTEST.md) | Equity α/β/IR Underwater |
| [fertig_WORK_PORTFOLIO_SOLL_IST.md](./fertig_WORK_PORTFOLIO_SOLL_IST.md) | Soll vs. Ist, Active Weight, Trade-Notional |
| [fertig_WORK_BIAS_FIXES_INVERSE_DCF.md](./fertig_WORK_BIAS_FIXES_INVERSE_DCF.md) | Inverse-DCF als Basis ab zwei Triggern |
| [fertig_WORK_PEER_ADAPTIVE.md](./fertig_WORK_PEER_ADAPTIVE.md) | 2-Hop-Peers, kuratierte Map nur Notnagel |
| [fertig_WORK_PEER_PRICING_POWER.md](./fertig_WORK_PEER_PRICING_POWER.md) | Relativ nur bei peerMaterial, sonst Banner |
| [fertig_WORK_RECESSION_2008_DRIVERS_LLM.md](./fertig_WORK_RECESSION_2008_DRIVERS_LLM.md) | Ziel+z, LLM nur bei Menge A |
| [fertig_WORK_RECESSION_RATE_OIL_BRIDGE.md](./fertig_WORK_RECESSION_RATE_OIL_BRIDGE.md) | Zins- und Öl-Brücke neben den 17 Indikatoren |
| [fertig_WORK_RESEARCHER_PORTFOLIO.md](./fertig_WORK_RESEARCHER_PORTFOLIO.md) | P1/P2/P3 |
| [fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md](./fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md) | Zahlen P2 |
| [fertig_WORK_NEWS_SENTIMENT.md](./fertig_WORK_NEWS_SENTIMENT.md) | Sentiment |
| [fertig_WORK_SEGMENT_DEDUP.md](./fertig_WORK_SEGMENT_DEDUP.md) | Dedup |
| [fertig_WORK_TAM_SEGMENT_MAPPING.md](./fertig_WORK_TAM_SEGMENT_MAPPING.md) | Segment-TAM. #176 Partial-Apply + hide 0-Rev 🟢 im Index (Tip `31d9f367`, Bundle `index-BcyRdipm.js`; kein neues Spec-File). Datenkette Section7 → POST /api/analyze/:ticker/tam-na-fill → requestTamNaFills → shared/tam-na-fill |
| [fertig_WORK_TAM_RESIDUAL_XBOX.md](./fertig_WORK_TAM_RESIDUAL_XBOX.md) | Xbox |
| [fertig_WORK_DATA_PROVIDERS.md](./fertig_WORK_DATA_PROVIDERS.md) | FMP |
| [fertig_WORK_SCORING_VORLAGE.md](./fertig_WORK_SCORING_VORLAGE.md) | Gates |
| [fertig_WORK_TEIL0-6.md](./fertig_WORK_TEIL0-6.md) | Platform/BTC |
| [fertig_WORK_BTC_MINER.md](./fertig_WORK_BTC_MINER.md) | Miner |
| [fertig_WORK_TEIL7_SCORING.md](./fertig_WORK_TEIL7_SCORING.md) | Gold |
| [fertig_WORK2.md](./fertig_WORK2.md) | PESTEL |
| [Future_3_SerpApi_Rate_Limits.md](./Future_3_SerpApi_Rate_Limits.md) | 🟢 SerpApi-Rate-Limit für Google Trends „Recession“ (#200, Tester PASS Soft Production, Tip `8add9ed1`). Dateiname bleibt `Future_3` (kein Rename). Soll: Cache 6–12h, letzten Wert halten, UI-Alter. Ist: `server/cache/google-trends-cache.ts`, `server/recession.ts`. Siehe Abschnitt 11.10.2026 in `WORK_IST_VS_SOLL.md` |
| [Future_4_Google_Trends_Conflict_and_Fixes.md](./Future_4_Google_Trends_Conflict_and_Fixes.md) | 🟢 Konflikt Score-0 bei SerpApi-Fehler (#200, Tip `8add9ed1`). Dateiname bleibt `Future_4`. Soll: Last-Good 6–12h, UI-Kennzeichnung, ohne Wert in 48h nicht verfügbar. Ist: Last-Good 48h, `closedIndicator` danach, Gewicht ×1,7 bleibt. Zonen unberührt |
| [Future_5_Google_Trends_Cache_Implementation.md](./Future_5_Google_Trends_Cache_Implementation.md) | 🟢 Cache-Umsetzung (#200, Tip `8add9ed1`). Dateiname bleibt `Future_5`. Soll-Datei `server/cache/google-trends-cache.ts` liegt. Ist: In-Memory, frisch 12h, `ageHours`/`isStale` (Schwelle 24h, Skizze `> 6` nicht). UI `client/src/components/recession/recessionDashboardPartsB1.tsx` und `recessionDashboardPartsB2.tsx`. Redis nicht gebaut |
| [Future_Work.md](./Future_Work.md) | Roadmap |
