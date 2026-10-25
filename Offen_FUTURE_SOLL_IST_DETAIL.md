# Soll-Ist im Detail: alle 11 Future-Dateien gegen main `29fdf1d5`

**Stand:** 18.10.2026, ca. 23:20 Uhr Berlin (MESZ, UTC+2); Basis 22:45 Uhr
**Geprüfter Code:** `main` = `35ead515c4c4380e8a194b9e3f4d6195fa0ec399` (#263, 10J-Treasury-Overlay). Eigener Klon in `/workspace/soll-ist-35ead515`, nur gelesen. Nichts geändert, nichts gepusht, keine PRs. **Nachzug auf `main` = `29fdf1d5e19cc458005469098701d8190d1d374d` (#266, über #264 `4dd43ab8`):** nur die Zeilen zu #264, #265, #266, #267 und die Zählung, geprüft über die öffentliche GitHub-API und Raw-Dateien, ohne Klon. Alle übrigen Zeilen sind unverändert Stand `35ead515`. **Nachzug `09750838` (#320, 25.10.2026):** F1-71/F1-74, dazu F1-30/F1-31/F1-34 (#274 `99a06d1b`, gegen den Code auf `09750838` belegt) und die Zählung.
**Erstellt von:** Grok Bot (Executor im Auftrag von Stabschef)

## Wie diese Liste entstanden ist

1. Alle 11 Dateien vollständig gelesen, Zeile für Zeile. Jede konkrete Anforderung ist eine eigene Zeile mit Dateizeile („Z.“).
2. Jede Zeile gegen den Code auf `35ead515` geprüft, mit `rg` (Volltextsuche) und Lesen der Fundstelle. Bei Anzeige-Punkten habe ich die Kette verfolgt: Oberfläche (`client/src`) → Hook → API-Route → Server → Quelle bzw. `shared/`-Schema.
3. Die Commit-Kennung (SHA) stammt aus `git log` auf dem Klon (der Commit, der die Datei oder Stelle eingeführt hat).
4. FRED-Reihen für den Rezessions-Katalog habe ich am 18.10. gegen 22:35 Uhr Berlin einmal direkt abgerufen. Das zeigt nur, ob die Quelle liefert, nicht, was das Dashboard live anzeigt. Live in der Oberfläche getestet (Tester) habe ich nichts.
5. Offene PRs habe ich über GitHub abgefragt (Stand 22:40 Uhr Berlin). Einen PR für BTC-WALCL (Werki), ADR-Mapping (dr eggbot) oder Real10Y in Sektion 12 (Grok Bot) gibt es noch nicht. Die Punkte stehen deshalb als „in Arbeit, noch kein PR“. Nachtrag 18.10., ca. 23:20 Uhr Berlin: BTC-WALCL ist gemergt (#266, `29fdf1d5`), ADR-Mapping ist Draft #265 (Head `dbdd7475`), Real10Y in Sektion 12 ist Draft #267 (Head `c224e2c9`).

## Status-Zeichen

| Zeichen | Bedeutung |
|---|---|
| ✅ | erledigt, mit Datei:Zeile und, wo möglich, SHA |
| 🟡 | teilweise erledigt; was fehlt, steht in „Nächster Schritt“ |
| ❌ | fehlt |
| ⛔ | blockiert durch eine gefallene Entscheidung von Philip oder durch Kosten ohne Freigabe |
| ℹ️ | reine Beschreibung oder Konzepttext ohne Bau-Auftrag, **nicht gezählt** |

## Begriffe und Abkürzungen

- **Soll / Ist:** Soll = was die Future-Datei verlangt. Ist = was auf `main` wirklich im Code steht.
- **PR:** Pull Request (Änderungsvorschlag auf GitHub). **SHA:** die Kennung eines Commits (hier die ersten 7 Zeichen).
- **TA:** technische Analyse (Kurs-Chart mit Indikatoren). Im Aktien-Dashboard ist das heute **Sektion 12**.
- **KPI:** einzelne Kennzahl in einer Kachel. **Overlay:** zusätzliche Linie im Chart, per Schalter („Chip“) ein- und ausblendbar.
- **FRED:** Datenbank der Federal Reserve St. Louis (kostenlos). **FMP:** Financial Modeling Prep (bezahlte Kursdaten-Quelle). **SerpApi:** bezahlter Dienst für Google-Trends-Abfragen.
- **LLM / KI:** Sprachmodell, hier über OpenRouter angebunden.
- **P:** Wahrscheinlichkeit im Rezessions-Dashboard. **Netto / Max:** Summe der gewerteten Punkte bzw. maximal mögliche Punkte.
- **N/A:** kein Wert vorhanden. **EZ:** Eurozone. **JP:** Japan.
- **GIS:** Gesamt-Score des Gold-Dashboards. **AISC:** All-In Sustaining Cost, die vollen Förderkosten der Goldminen pro Unze.
- **WALCL:** Bilanzsumme der US-Notenbank (FRED). **QE / QT:** Bilanzausweitung bzw. Bilanzabbau der Notenbank.
- **DFII10 / Real10Y:** reale 10-Jahres-Rendite (inflationsbereinigt). **DGS10:** nominale 10-Jahres-Rendite. **BAA10Y:** Renditeabstand Baa-Firmenanleihen zu 10-jährigen Staatsanleihen.
- **CDS:** Kreditausfallversicherung auf ein Unternehmen. **YTM:** Rendite einer Anleihe bis zur Fälligkeit. **OAS:** Renditeaufschlag einer Anleihegruppe über Staatsanleihen (ICE-BofA-Indizes).
- **z-Score / Perzentil:** Wie ungewöhnlich ist der heutige Wert im Vergleich zur eigenen Geschichte (Standardabweichungen bzw. Rangplatz in Prozent).
- **MC:** Monte-Carlo-Simulation.

## Sektionsnummern: alt in Future_1, heute im Aktien-Dashboard

Future_1 nummeriert die Sektionen nach dem Stand vom 09.10. Heute (`client/src/pages/Dashboard.tsx:631–675`) gilt:

| Future_1 sagt | heute | Komponente |
|---|---|---|
| Sektion 1 „Datenaktualität“ | Sektion 2 | `Section1.tsx` |
| Sektion 3 „Zyklus“ | Sektion 5 | `Section3.tsx` |
| Sektion 4 „Bewertungskennzahlen“ | Sektion 6 | `Section4.tsx` (Sektion 4 ist heute „Financial Statements“) |
| Sektion 6 „CRV“ | Sektion 8 | `Section6.tsx` |
| Sektion 8 „Risikoinversion“ | Sektion 10 | `Section8.tsx` |
| Sektion 10 „Technische Analyse“ | **Sektion 12** | `TechnicalChart.tsx` |
| Sektion 12 „PESTEL“ | Sektion 14 | `PestelSection.tsx` |
| Sektion 17 „Zusammenfassung“ | Sektion 20 | `SummarySection.tsx` |

Philips Entscheidungen vom 18.10., die hier gewertet sind: BTC-Score mit WALCL, T-Bill und Zinsen (JA, gemergt #266 `29fdf1d5`) · Makro-Gewichte darf die KI wählen (JA) · Weltkarte 2D (JA) · keine zweite Quelle für .L-Analystenziele · ETFs bleiben blockiert · Credit nur über BAA10Y · DCF-Währung alles in USD (#261 offen) · Nicht-US-Titel über ADR bei FMP, Fallback Yahoo (dr eggbot baut, Draft #265 „HOLD Philip“, Head `dbdd7475`) · Yahoo-Fallback #264 gemergt (`4dd43ab8`) · Real10Y aus BTC kommt in Sektion 12 (Grok Bot baut, Draft #267, Head `c224e2c9`) · Firmenanleihen-Quellen (Leeway, Terrapin) nicht freigegeben.

---
## Future_1_Work.md (782 Zeilen)

Themen: FMP-Fehler 402 mit Yahoo-Ersatz, Dividendenrendite, Kreditrisiko, Buffett-Indikator, Rezessions-TA, Regionen-Umschalter, N/A-Datenpunkte, Buffett für Europa/Asien. Z.1–105 und Z.244–266 sind Problembeschreibung (ℹ️).

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F1-01 | Z.108–114, 253–258 | Kette „FMP → Yahoo (nur bei FMP-Fehler, besonders 402) → Fehler an Frontend“ | `server/analyze-helpers.ts:552–555` (nur bei `fmpStatus === 402`), `:614–642` `yahooFallbackData`; `server/analyze-route.ts:631–632` `yahooOnly`. SHA `093cdd0` (#252). Tester auf Prod 18.10. vor #264: VOW3.DE/SAP.DE lieferten Marktkapitalisierung, KGV und EPS = 0 (Yahoo verlangt dort einen „Crumb“ und antwortet 429). **#264 gemergt:** Squash `4dd43ab8` (Head `5b244253`), nur `server/yahoo-fetcher.ts` +276/−4 plus Tests: Name/Währung aus Chart-Meta, MCap/EPS/KGV aus fundamentals-timeseries, ohne Crumb. Doublecheck Post-Merge GO; Tester Prod PASS Soft: VOW3.DE/SAP.DE MCap/KGV/EPS in EUR, AAPL unverändert | ✅ (Soft) | Soft-Rest: Börse wird nicht angezeigt, Analysten Buy 0/Hold 0/Sell 0, S9 forwardPE 0 → „Fwd P/E 0.0“. Parallel: ADR-Weg über FMP (dr eggbot, Draft #265 „HOLD Philip“, Head `dbdd7475`, offen) |
| F1-02 | Z.116–179, 255–256 | Neue Datei `server/yahoo-fetcher.ts` mit Kurs, Währung, MCap, KGV, EPS, Historie | `server/yahoo-fetcher.ts:167–247` (`getYahooSnapshot`). Abweichung: Bibliothek `yahoo-finance2` ist nicht installiert (`package.json`), eigener `fetch` auf Yahoo. SHA `093cdd0` | ✅ | Keiner (Prod-Lücke siehe F1-01) |
| F1-03 | Z.203–205, 258 | Nur Minimal-Felder mappen (Kurs, MCap, KGV, Historie), keine Fundamentals erfinden | `server/analyze-helpers.ts:614–642`; `server/analyze-route.ts:2095–2112` (DCF, Upside, Score = null bei Yahoo); `client/src/components/YahooNoValuationCard.tsx:13–33`. SHA `093cdd0`, Rest n/a statt 0 `2b3bf0e` (#257) | ✅ | Keiner |
| F1-04 | Z.214, 259 | Klarere Fehlermeldung bei 402 („Plan deckt Symbol nicht ab – Fallback aktiv“) | `server/yahoo-fetcher.ts:261` `YAHOO_402_NOTICE`; `server/analyze-helpers.ts:496–498` (402 ohne Yahoo-Kurs); `YahooNoValuationCard.tsx:19`. SHA `093cdd0` | ✅ | Keiner |
| F1-05 | Z.215 | Symbol-Normalisierung prüfen („.DE erzwingen“), keine falsche Auflösung | `server/yahoo-fetcher.ts:9` (.DE wird nicht auf ein anderes Listing umgelöst). Für die Ticker-Suche (`TickerSearch.tsx`) nicht nachgewiesen | 🟡 | Mit dem ADR-Mapping (dr eggbot) festlegen, wann .DE bleibt und wann das ADR genommen wird |
| F1-06 | Z.216, 261 | FMP-Plan „Ultimate“ prüfen / upgraden | kein Nachweis | ⛔ | Kosten ohne Freigabe. Philip hat stattdessen ADR bei FMP + Yahoo-Fallback entschieden |
| F1-07 | Z.217 | Alternative Datenquelle evaluieren (EODHD u. a.) | 0 Treffer `eodhd` | ⛔ | Durch Philips Entscheidung „ADR bei FMP, Fallback Yahoo“ ersetzt; neue bezahlte Quelle nicht freigegeben |
| F1-08 | Z.220 | 402-Status explizit loggen und weiterreichen | `server/analyze-helpers.ts:496–498` (`fmpStatus` im Body), Log `[YAHOO-402]` `:623,626` | ✅ | Keiner |
| F1-09 | Z.222 | Yahoo-Ergebnisse cachen „24 h – 7 Tage“ | `server/yahoo-fetcher.ts:22` 15 Minuten, Fehlschläge 2 Minuten (`:23`) | 🟡 | Nur auf Wunsch verlängern; 15 min ist bewusst kurz für Kurse. Abweichung dokumentieren |
| F1-10 | Z.223 | Rate-Limit-Schutz bei Yahoo (Abstand / sequenziell) | `server/yahoo-fetcher.ts:42` `spaceYahooCall` | ✅ | Keiner |
| F1-11 | Z.229–234, 260 | Tests: VOW3.DE/BMW.DE/SAP.DE über Yahoo, AAPL bleibt FMP, ungültiger Ticker ohne Absturz | Code-Tests aus #252 vorhanden; Prod-Test 18.10. vor #264 FAIL. Nach #264 (`4dd43ab8`, Tests `script/test-yahoo-chart-meta.ts`, `script/test-yahoo-timeseries-fundamentals.ts`): Tester Prod PASS Soft, VOW3.DE/SAP.DE MCap/KGV/EPS in EUR, AAPL unverändert | 🟡 | Rest: BMW.DE und ungültiger Ticker noch nicht live geprüft (Tester auf Prod). Soft-Rest wie F1-01 |
| F1-12 | Z.272–275, 296–297, 391 | Dividendenrendite als Overlay im technischen Chart (heute Sektion 12), eigene Achse | `client/src/components/sections/TechnicalChart.tsx:153–158, 362–369, 585–590` → `client/src/lib/useDividendHistory.ts` → `GET /api/dividends/:ticker` (`server/dividend-route.ts:85`) → FMP/Yahoo → `shared/dividends.ts`. SHA `50980b3` (#213), `a91261b` (#227) | ✅ | Keiner |
| F1-13 | Z.298 | Nur anzeigen, wenn Dividende > 0 | `TechnicalChart.tsx:364, 369` (Overlay nur bei Ereignissen und Yield-Werten), Währungs-Schutz `:368` | ✅ | Keiner |
| F1-14 | Z.299 | Farbe für attraktive Yield-Bereiche (> 4 %) | 0 Treffer für eine 4-%-Schwelle in `shared/dividends.ts` / `TechnicalChart.tsx` | ❌ | Klein, autonom: farbiges Band ab 4 % auf der Dividendenachse |
| F1-15 | Z.304 | Markierungen bei Ex-Dividenden-Tagen | `TechnicalChart.tsx:1460` `dividendMarkerLines` (Ex-Tage im Tooltip), `shared/dividends.ts:265` | ✅ | Keiner |
| F1-16 | Z.310, 317, 382 | Aktuelle Dividendenrendite als KPI in Sektion 1 (heute Sektion 2) | `client/src/components/sections/Section1.tsx:43, 181` (`useDividendKpi`). SHA `744075c` (#237); dieselbe Kachel in Financial Statements `582844e` (#246) | ✅ | Keiner |
| F1-17 | Z.312, 384 | Sektion 4 alt (heute 6 „Bewertung“): Dividendenrendite gegen Sektor und historische Spanne | `client/src/components/sections/Section4.tsx`: 0 Treffer „dividend“. Es gibt nur die KPI-Kachel in Financial Statements | ❌ | Autonom: Spanne aus der vorhandenen Dividenden-Historie (`/api/dividends`) in Sektion 6 zeigen; Sektor-Vergleich braucht Peer-Daten |
| F1-18 | Z.313 | Sektion 17 alt (heute 20): kurzer Hinweis, wenn Yield auffällig | `SummarySection.tsx`, `ExecSummaryCard.tsx`: 0 Treffer „dividend“ | ❌ | Klein, autonom (nur Text, kein Score) |
| F1-19 | Z.340–349 | Neue Felder im Analyse-Ergebnis: 5J-CDS, längste Anleihe-Rendite, Rating | `shared/schema.ts`: 0 Treffer `cdsSpread`, `longestBondYield`, `creditRating` | ⛔ | Emittenten-Daten nur über bezahlte Quelle; Leeway/Terrapin nicht freigegeben, Credit nur über BAA10Y |
| F1-20 | Z.346–347 | Felder Verschuldung/Eigenkapital und Zinsdeckung im Credit-Kontext | 0 Treffer `interestCoverage` in `shared/schema.ts`; FMP liefert die Rohdaten | ❌ | Autonom baubar aus FMP (keine neue Quelle), als Teil der Credit-Karte F1-21 |
| F1-21 | Z.352–353, 360, 367, 386, 392 | Credit-Risiko-Karte / Warnhinweis, Hauptstelle Sektion 8 alt (heute 10 „Risikoinversion“) mit „Expected Damage“ | `client/src/components/sections/Section8.tsx:26` nur generischer Risikoname „Credit Quality Deterioration“, keine Karte | ❌ | Autonom: Karte aus BAA10Y-Markt-Spread (`/api/credit-spread/market`) + FMP-Verschuldung. Ohne CDS (⛔). Kein Score ohne Philip |
| F1-22 | Z.354 | Optional: Chart Anleiherendite gegen Aktienkurs | Markt-Spread BAA10Y als Overlay `TechnicalChart.tsx:159–163, 592–598` → `useMarketCreditSpread.ts` → `server/credit-route.ts:110` → `server/fred-csv.ts` (`ba760a8`, #253); 10J-Treasury `TechnicalChart.tsx:164–168, 602` → `server/treasury10y-route.ts:104` (`35ead51`, #263). Emittenten-Anleihe fehlt | 🟡 | Rest (Firmenanleihe) ⛔ wegen Kosten |
| F1-23 | Z.361, 368, 385, 393 | Sektion 6 alt (heute 8 „CRV“): Credit-Spread als Stress-Faktor im Worst Case | 0 Treffer in `Section6.tsx` | ❌ | Ändert das CRV-Ergebnis → **braucht Philip** |
| F1-24 | Z.362, 388 | PESTEL (heute Sektion 14): Kreditrisiko unter „Economic“ | 0 Treffer „credit/kredit“ in `PestelSection.tsx` | ❌ | Autonom (Textzeile aus BAA10Y-Stand) |
| F1-25 | Z.363, 383 | Sektion 1 alt (heute 2): CDS / Anleiherendite als Warn-KPI | 0 Treffer | ⛔ | Braucht Emittenten-Daten (nicht freigegeben) |
| F1-26 | Z.364 | Sektion 3 alt (heute 5): Verschuldungs- / Refinanzierungszyklus | 0 Treffer in `Section3.tsx` | ❌ | Niedrige Priorität, autonom aus FMP-Schuldenfälligkeiten |
| F1-27 | Z.399 | Offener Punkt: Datenquelle CDS / Einzelanleihen (kostenpflichtig?) | Philip 18.10.: Leeway/Terrapin nicht freigegeben | ⛔ | Kostenfrage bei Philip |
| F1-28 | Z.400 | Offener Punkt: Qualität historischer Dividenden bei EU-Tickern | Währungsprüfung `TechnicalChart.tsx:368` (`dividendCurrencyCheck`), LSE-Pence/Rendite `6fb9f6d` (#249), `b0e990e` (#244) | ✅ | Keiner |
| F1-29 | Z.401–402 | Offene Punkte: Performance des Overlays, Design der zweiten Y-Achse | Overlays laden nur bei eingeschaltetem Chip (`TechnicalChart.tsx:158, 163, 168`); eigene rechte Achsen. Tester #263: drei rechte Achsen gleichzeitig lesbar, ohne Überlappung (bei 375 px erst nach Scrollen) | ✅ | Soft-Punkt aus #263: 10J-Antwort 566 KB ohne gzip |
| F1-30 | Z.477–478, 493 | Buffett: Yahoo `^W5000` mit Retry und längerem Timeout | ✅ `99a06d1b` (#274), belegt auf `09750838`: `server/buffett-route.ts:37–39` `BUFFETT_FETCH_ATTEMPTS = 2`, Pause 1500 ms, `YAHOO_TIMEOUT_MS = 35000` (FRED 25000); `:66–90` `fetchTextWithRetry`; `:210` `^W5000` mit 2 Versuchen und Yahoo-Timeout; FRED ebenfalls 2 Versuche (`:119–124`). Vorher: `:94–98` ein Versuch, 25 s Timeout; FRED `:50` ebenfalls ein Versuch | ✅ | Keiner |
| F1-31 | Z.479 | Wenn Wilshire fehlt: FRED `NCBEILQ027S` + `FBCELLQ027S` auch für aktuelle Werte | ✅ `99a06d1b` (#274), belegt auf `09750838`: `server/buffett-route.ts:286–300` wenn `wilshireResult.bars` fehlt → Reihe aus NCBEILQ027S + FBCELLQ027S als Quartalsreihe mit eigenem Trend, `fallback` mit Quelle/Grund/`asOf` (`:223, 297`), Cache 5 min (`:33`); Kennzeichnung im Panel `BuffettRatioPanel.tsx:402–409` „Ersatzquelle … Wilshire 5000 nicht verfügbar“. Vorher: `:163–164, 172–181` nur Historie vor Indexstart; `:187` „Wilshire-Quote leer“; Proxy-Fortschreibung bis 30 Tage (`37127f1` #245) | ✅ | Keiner |
| F1-32 | Z.482 | `period2` immer auf jetzt + 1 Tag | `server/buffett-route.ts:94` | ✅ | Keiner |
| F1-33 | Z.483, 495 | Letzten Punkt als „aktuell“ markieren, blaue Box darauf ausrichten | `client/src/components/recession/BuffettRatioPanel.tsx:238–251` (`lastPointLabel`). SHA `37127f1` (#245) | ✅ | Keiner |
| F1-34 | Z.486, 506 | Konkreten Backend-Fehler anzeigen statt generischer roter Box | ✅ `99a06d1b` (#274), belegt auf `09750838`: `server/buffett-route.ts:609–615` 502 mit `error: "Buffett-Quote nicht verfügbar: <Grund>"`, `errorCode`, `reason`; Gründe aus `BuffettSourceError` (`:51–56`, z. B. Timeout `:61`, „zu wenige Tagesschlüsse“ `:211`, „BIP-Reihe leer“ `:273`); Panel `BuffettRatioPanel.tsx:388–400` `ApiErrorBanner` + „n/a — <Grund>“ (`errorReason` `:47`). Vorher: `:258` immer „Buffett-Quote nicht verfügbar“ | ✅ | Keiner |
| F1-35 | Z.488–489 | Bei Fehler nicht cachen, später neu versuchen | `server/buffett-route.ts:254` cacht nur bei Punkten > 0. Cache heute 15 min (`:29`) statt 6 h | ✅ | Keiner |
| F1-36 | Z.438–453, 494 | Globalisierungsbereinigter Buffett (Auslandsumsatz-Anteil φ, nicht fest codiert) | `server/buffett-ratio.ts:83–105` `buildBuffettSeries` rechnet `foreignShare`, wird aber nur in `script/test-buffett-ratio.ts` aufgerufen, nicht in der Route | ❌ | Erst als **Zusatzkennzahl** autonom. In den Score-Slot nur mit Philip |
| F1-37 | Z.459, 464–473 | φ über LLM-Call schätzen, Fallback klar markiert | 0 Treffer in `buffett-*.ts` | ❌ | Mit F1-36, LLM-Kosten gering; Fallback 0,40 markieren |
| F1-38 | Z.460 | Handelsbilanz/BIP (FRED `BOPGSTB`) | 0 Treffer | ❌ | Mit F1-36 |
| F1-39 | Z.461 | Dollar-Anteil an Weltreserven (IMF COFER) | 0 Treffer | ❌ | Mit F1-36 |
| F1-40 | Z.496 | Optional: bereinigter Buffett als zweiter Chart / Kennzahl | 0 Treffer | ❌ | Mit F1-36 |
| F1-41 | Z.512, 550 | Eine Sektion „Technische Analyse – Rezession & Korrektur“ | Weiter getrennt: Sektion 9 `RecessionRsiSection`, Sektion 10 `RecessionMarketChartsSection`, Sektion 11 Buffett (`client/src/pages/RecessionDashboard.tsx:135–139`) | 🟡 | Autonom (groß). Erst Datenpunkte F1-58/F1-66 stabil |
| F1-42 | Z.551 | Ein Backend-Endpunkt für SPY/VGK + VIX + Buffett + Kurve + Credit | `server/recession-markets.ts` liefert Preis/Vol je Region; Buffett eigener Endpunkt `/api/analyze-recession/buffett` | ❌ | Mit F1-41 |
| F1-43 | Z.552–556 | Synchronisierte Panes, Overlay-Schalter, Zeitfenster 1/3/5/10/Max, aktuelle Werte als Label | `client/src/components/recession/RecessionMarketChartsSection.tsx:415–459` Fenster 1/3/5/10/MAX ✅; Overlay-Schalter für Buffett/Credit/Kurve fehlen | 🟡 | Mit F1-41 |
| F1-44 | Z.557 | Leerer Overlay → kleiner Hinweis statt Blockade | `server/recession-markets.ts:277` „FRED VIXCLS leer“, `:281` „VSTOXX nicht lieferbar …“ | ✅ | Keiner |
| F1-45 | Z.518–528 | Overlays: Buffett, CAPE, Margin Debt, Zinskurve, Credit Spread, M2, Google Trends | Margin-Debt-Streifen (FINRA) `server/recession-market-charts.ts:216–235`. Buffett, CAPE, Kurve, BAA10Y, M2, Trends nicht im Chart | 🟡 | Mit F1-41 |
| F1-46 | Z.575–586, 611–615 | Auswahl-Buttons US / Europa / Asien | `client/src/components/recession/RegionGaugeSwitch.tsx:7–11, 42–55`. SHA `101c3c0` (#211). Label heißt „Asien (Japan)“ | ✅ | Keiner (Asien-Inhalt siehe F1-54) |
| F1-47 | Z.588, 617 | Die **fünf** Gauges (Rez. 3M/6M/12M, Korr. 3–6M/12M) regionsspezifisch | `RegionGaugeSwitch.tsx:62–63`: für EZ/JP nur **zwei** Katalog-Gauges (Rezession, Korrektur 12M) | 🟡 | Backend muss die 5 Untergruppen je Region rechnen (F1-52). Nur Anzeige, US-Handlung bleibt |
| F1-48 | Z.589, 617, 624 | Scoring-Tabelle (und Heatmap) passt sich der Region an | Sektionen 5/6 (`RecessionDashboard.tsx:120–126`) zeigen immer US | ❌ | Mit F1-52 |
| F1-49 | Z.589, 617 | Top-3-Treiber je Region | `RegionGaugeSwitch.tsx:73–84` | ✅ | Keiner |
| F1-50 | Z.590 | Regionale Katalog-Ansicht (Sektion 8) bleibt | `RecessionDashboard.tsx:131–133` | ✅ | Keiner |
| F1-51 | Z.591, 619 | Aggregat US 0,70 / EZ 0,20 / JP 0,10 bleibt | `shared/recession-regions.ts:7` `REGION_WEIGHT`; Hinweis `RegionGaugeSwitch.tsx:86–87` | ✅ | Keiner |
| F1-52 | Z.595, 623 | Backend: Scoring-Pipeline pro Region (Netto-Scores, P der 5 Untergruppen) | `server/recession-regions.ts` rechnet je Region nur Katalog-P Rezession/Korrektur, keine 5 Untergruppen | 🟡 | Autonom (Anzeige), mit Vorher/Nachher für US = unverändert |
| F1-53 | Z.599, 626 | Hinweis „unzureichende Daten“ bei zu vielen N/A | `RegionGaugeSwitch.tsx:65–70` („Zu viele Slots ohne Druck (N/A)…“) | ✅ | Keiner |
| F1-54 | Z.579, 615 | Region „Asien (Japan / ASHR)“ | Nur Japan-Slots `server/recession-regions.ts:478–484`, kein China/ASHR | ⛔ | Asien-Zuschnitt (welche Länder, welche Gewichte) liegt noch bei Philip |
| F1-55 | Z.625, 673, 742 | N/A-Slots zählen weder in Netto noch in Max | `server/recession.ts:677` `scoredTotals`; Regionen `closedSlot` (`server/recession-regions.ts:371, 389, 419`) | ✅ | Keiner |
| F1-56 | Z.638, 696 | Kurve EZ (10J − 3M), FRED `IRLTLT01EZM156N − IR3TIB01EZM156N`, sonst ECB | `server/recession-regions.ts:324–325, 462`; Abruf 18.10.: beide Reihen enden Januar 2026 (innerhalb der 18-Monats-Grenze `shared/recession-regions.ts:9`). Kein ECB-Ersatz | 🟡 | Live prüfen, ob der Slot gewertet wird; ECB-Tageskurve als Ersatz, falls die Monatsreihe veraltet |
| F1-57 | Z.639, 697 | Spreads EZ HY, FRED `BAMLHE00EHYIOAS` | `server/recession-regions.ts:326, 467–469`; Abruf 18.10.: letzter Wert 15.10.2026 = 3,36 | ✅ | Live-Anzeige durch Tester bestätigen lassen |
| F1-58 | Z.640, 698, 718 | VSTOXX in Charts: direkter STOXX- oder Yahoo-Call, FMP-Erstversuch entfernen | `server/recession-markets.ts:199–224`: FMP zuerst, dann STOXX-Datei `h_v2tx.txt`; Yahoo nicht (Kommentar `:199` „Yahoo delisted“) | 🟡 | Quelle prüfen, ob Yahoo `^V2TX` heute liefert; FMP-Erstversuch nur entfernen, wenn STOXX stabil ist |
| F1-59 | Z.647, 705 | ALQ Japan, FRED `LRUNTTTTJPM156S` | `server/recession-regions.ts:327, 478`; Abruf 18.10.: Wert August 2026 | ✅ | Keiner |
| F1-60 | Z.648, 706 | Kurve JP 10J, FRED `IRLTLT01JPM156N` | `server/recession-regions.ts:328, 479`; Abruf 18.10.: Wert September 2026 | ✅ | Keiner |
| F1-61 | Z.649, 707 | Aktivität JP, FRED `JPNPROINDMISMEI` oder METI | `server/recession-regions.ts:361`: OECD-Reihe über DBnomics zuerst, FRED als Ersatz (FRED-Reihe am 18.10. leer) | ✅ | Keiner |
| F1-62 | Z.650, 708 | Spreads JP: keine freie Serie → N/A lassen | Slot bleibt N/A (geschlossen) | ✅ | Keiner (Soll erlaubt N/A) |
| F1-63 | Z.651, 709 | TOPIX / CAPE JP über Yahoo `^TPX` + Gewinne oder manueller Import | `server/recession-regions.ts:274–276`: nur FMP `^TPX`/`1306.T`, sonst N/A | 🟡 | Yahoo-Versuch ergänzen (verändert JP-Katalog-P, nicht US) |
| F1-64 | Z.652, 710 | JNVI: N/A lassen oder VIX-Ersatz | N/A | ✅ | Keiner (Soll erlaubt N/A) |
| F1-65 | Z.658, 667, 716, 736 | Buffett „Max“ lädt nicht (Sektion 11 blockiert) | US-Chart läuft; Robustheit siehe F1-30, F1-31, F1-34 | 🟡 | F1-30 + F1-34 bauen |
| F1-66 | Z.659, 668, 717, 737 | FRED VIXCLS leer in Charts → Retry, Yahoo `^VIX` als Ersatz | Score: Yahoo-Ersatz `server/recession.ts:1277–1287` (`27332f3`, #210). Chart: `server/recession-markets.ts:276–277` nur FRED, kein Yahoo. FRED lieferte am 18.10. (15.10. = 16,46) | 🟡 | Autonom, klein: Yahoo `^VIX` auch im Chart-Pfad |
| F1-67 | Z.661, 671, 719, 740 | SPY KGV / EPS / Kennzahlen: Yahoo `quoteSummary` als Ersatz | 0 Treffer `quoteSummary` außerhalb `server/yahoo-fetcher.ts`; Vier-Märkte-Factpack nur FMP | ❌ | Autonom, klein. Achtung: Yahoo-Crumb-Problem aus #264 gilt auch hier |
| F1-68 | Z.662, 720 | Analystenschätzungen SPY: Ersatz über Yahoo oder Perplexity | `server/recession-market-charts.ts:389` nur FMP `/stable/analyst-estimates` | ❌ | Mit F1-67 |
| F1-69 | Z.663, 721 | Optional: Margin-Debt-Chart auch für EU/Asien | FINRA nur USA (Soll sagt selbst „FINRA bleibt US-only“) | ❌ | Niedrig; keine freie EU/JP-Quelle bekannt |
| F1-70 | Z.673, 742 | Nach den Daten-Fixes regionale Berechnung neu validieren | kein Nachweis | ❌ | Tester-Auftrag: US/EZ/JP-Katalog live mit Vorher/Nachher |
| F1-71 | Z.749–757, 765–766, 771–774, 782 | Buffett Europa (STOXX 600 / VGK) und Asien (TOPIX / ASHR) mit echten Benchmarks | ✅ `09750838` (#320, 25.10.2026): `BuffettRatioPanel.tsx` + `buffettChartScale.ts` → `server/buffett-route.ts` → FRED EUNNGDP/DEXUSEU/DDDM01CNA156NWDB/MKTGDPCNA646NWDB + STOXX/VGK/ASHR-Proxy (Fixtures 2026-10-25); Test `test-buffett-f171-benchmarks.ts`. Vorher: `server/buffett-route.ts:219–223` Weltbank-Jahresquoten `DDDM01EZA156NWDB` / `DDDM01CNA156NWDB` | ✅ | Asia (^TPX) bleibt offen |
| F1-72 | Z.767 | Trendlinie + 1σ/2σ-Bänder je Region | `server/buffett-route.ts:150–154` `withTrend` für alle Regionen | ✅ | Keiner |
| F1-73 | Z.775 | Tabs US / Europa / China laden die Reihen | `BuffettRatioPanel.tsx:35–38, 296–302` | ✅ | Bei F1-71 Tab „China“ → „Asien“ nur nach Philips Asien-Entscheidung |
| F1-74 | Z.776 | ETF-Proxy (VGK, ASHR) klar kennzeichnen | ✅ `09750838` (#320, 25.10.2026): ETF-Proxy-Kennzeichnung (Ist-Kette siehe F1-71). Vorher: 0 Treffer | ✅ | Mit F1-71. Hinweis: „ETFs blockiert“ betrifft die ETF-Analyse, nicht ETFs als Datenquelle; im Zweifel bei Philip nachfragen |

## Future_2_NA_Fixes_Research.md (82 Zeilen)

Z.1–26 und Z.37–60 enthalten Recherche (Quellen, Fakten) als Begründung (ℹ️). Bau-Anforderungen stehen in §1 „Empfohlener Fix“, §2 „Fix:“-Zeilen und §4.

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F2-01 | Z.28, 79 | Google Trends mindestens 6–12 h cachen | `server/cache/google-trends-cache.ts:9` (12 h). SHA `8add9ed` (#200) | ✅ | Keiner |
| F2-02 | Z.29, 79 | Bei Fehler letzten gültigen Wert weiterverwenden, nicht 0 | `google-trends-cache.ts:81–108`; `server/recession.ts:532–540` | ✅ | Keiner |
| F2-03 | Z.30 | Optional: Ersatz über pytrends oder manuellen Export | 0 Treffer `pytrends` | ❌ | Niedrig; Python-Abhängigkeit auf Render fraglich |
| F2-04 | Z.31 | Im UI kennzeichnen, wenn Wert älter als 24 h | `google-trends-cache.ts:13, 57–60`; `client/src/components/recession/recessionDashboardPartsB2.tsx:65–72` | ✅ | Keiner |
| F2-05 | Z.41, 80 | VIX: FRED-Abruf mit Retry/Timeout, Ersatz Yahoo `^VIX` | Score ✅ (`server/recession.ts:1277–1287`, `27332f3` #210); Chart nur FRED (`server/recession-markets.ts:276–277`) | 🟡 | = F1-66 |
| F2-06 | Z.46, 80 | VSTOXX direkt über Yahoo `^V2TX`/`V2TX.DE` statt FMP | FMP → STOXX-Datei (`server/recession-markets.ts:199–224`), kein Yahoo | 🟡 | = F1-58 |
| F2-07 | Z.51 | EZ-Kurve: FRED-Reihe validieren, sonst ECB oder Yahoo | FRED-Slot da, kein ECB-Ersatz (`server/recession-regions.ts:324–325, 462`) | 🟡 | = F1-56 |
| F2-08 | Z.56, 81 | Buffett: Retry + längerer Timeout, `period2` aktuell | `period2` ✅ (`server/buffett-route.ts:94`); Retry ❌ | 🟡 | = F1-30 |
| F2-09 | Z.60 | SPY-Fundamentals: Yahoo-Ersatz für das Factpack | fehlt | ❌ | = F1-67 |
| F2-10 | Z.82 | Regionale Logik (US/EZ/Asien) mit den gefixten Quellen testen | kein Nachweis | ❌ | = F1-70 |

## Future_3_SerpApi_Rate_Limits.md (102 Zeilen)

Z.1–65 erklären SerpApi, Limits und Fehlerbild (ℹ️). §6 (Z.86–93) und §7 wiederholen die Punkte aus §5 und sind unten nicht doppelt gezählt.

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F3-01 | Z.70, 102 | Cache auf 6–12 h erhöhen | `server/cache/google-trends-cache.ts:9` 12 h, `server/recession.ts:513–517` Treffer ohne SerpApi-Call. SHA `8add9ed` | ✅ | Keiner |
| F3-02 | Z.71, 90 | Letzten gültigen Wert halten statt 0 | `google-trends-cache.ts:81–108` | ✅ | Keiner |
| F3-03 | Z.72, 91 | UI: „Google Trends: letzter Wert von vor X Stunden“ | `recessionDashboardPartsB2.tsx:72` (wörtlich so) | ✅ | Keiner |
| F3-04 | Z.75 | Retry mit exponentiellem Backoff bei 429 | `server/recession.ts:519–531` ein Versuch, 12 s Timeout | ❌ | Autonom, klein (vorsichtig: jeder Retry kostet SerpApi-Kontingent) |
| F3-05 | Z.76 | Ersatz über pytrends | 0 Treffer | ❌ | = F2-03 |
| F3-06 | Z.77, 92 | Bei dauerhaftem 429 „nicht verfügbar“ statt 0 | `server/recession.ts:535–536` → `googleReading(null)`; Slot aus Netto und Max (`:677`) | ✅ | Keiner |
| F3-07 | Z.80 | SerpApi-Plan prüfen (Developer ca. 75 $/Monat oder höher) | kein Nachweis | ⛔ | Kosten, keine Freigabe |
| F3-08 | Z.81 | Offizielle Google-Trends-API (Alpha, Zugang auf Antrag) evaluieren | 0 Treffer | ❌ | **Braucht Philip** (Antrag mit seinem Konto) |
| F3-09 | Z.82 | Andere Anbieter testen (Scrape.do, Bright Data) | 0 Treffer | ⛔ | Bezahlte Anbieter, keine Freigabe |

## Future_4_Google_Trends_Conflict_and_Fixes.md (133 Zeilen)

Z.1–63 beschreiben den Konflikt (ℹ️). §4-Tabelle (Z.114–119) wiederholt §3 und ist nicht doppelt gezählt.

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F4-01 | Z.71, 116, 129 | Letzten gültigen Wert cachen (6–12 h, besser 24 h) | 12 h frisch + 48 h letzter guter Wert (`google-trends-cache.ts:9, 11`). SHA `8add9ed` | ✅ | Keiner |
| F4-02 | Z.72–73, 117 | Bei 429 / leer / Timeout letzten gültigen Wert verwenden | `server/recession.ts:529–540` | ✅ | Keiner |
| F4-03 | Z.74, 118 | UI: „letzter Wert von vor X Stunden“ | `recessionDashboardPartsB2.tsx:65–72` | ✅ | Keiner |
| F4-04 | Z.75, 130 | Nur wenn 48 h kein gültiger Wert: „nicht verfügbar“, nicht 0 | `google-trends-cache.ts:11, 97, 108`; `server/recession.ts:535–536` | ✅ | Keiner |
| F4-05 | Z.100 | Retry mit exponentiellem Backoff | fehlt | ❌ | = F3-04 |
| F4-06 | Z.101 | Ersatz über pytrends | fehlt | ❌ | = F2-03 |
| F4-07 | Z.102, 119 | Wert älter als 24 h: Gewicht senken oder Indikator ausblenden | `server/recession.ts:192` „zone weight stays ×1.7“, `googleReading` Gewicht 1,7 fest | ❌ | Score-Änderung → **braucht Philip** |
| F4-08 | Z.106 | SerpApi-Plan prüfen | kein Nachweis | ⛔ | = F3-07 (Kosten) |
| F4-09 | Z.107 | Offizielle Trends-API evaluieren | fehlt | ❌ | = F3-08, **braucht Philip** |
| F4-10 | Z.108 | Andere Anbieter testen | fehlt | ⛔ | = F3-09 (Kosten) |

## Future_5_Google_Trends_Cache_Implementation.md (152 Zeilen)

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F5-01 | Z.10, 139 | Neue Datei `server/cache/google-trends-cache.ts` (In-Memory) | vorhanden, `:43` In-Memory. SHA `8add9ed` (#200) | ✅ | Keiner |
| F5-02 | Z.18 | Cache-Dauer 12 h | `google-trends-cache.ts:9` | ✅ | Keiner |
| F5-03 | Z.21–34 | Funktionen „Wert lesen / schreiben / Alter in Stunden“ | `:49–60` (`readGoogleTrendsCache`, `writeGoogleTrendsCache`, `googleTrendsFreshness`) | ✅ | Keiner |
| F5-04 | Z.41–67, 140 | In die Scoring-Pipeline einbauen, bei Fehler auch abgelaufenen Wert nehmen | `server/recession.ts:505–540`; abgelaufener Wert gilt bis 48 h (strenger als Skizze, passt zu Future_4) | ✅ | Keiner |
| F5-05 | Z.77–84, 141 | Kein Wert → „nicht verfügbar“ statt 0 | `server/recession.ts:535–536`, `:677` | ✅ | Keiner |
| F5-06 | Z.86–92 | Antwort enthält `value`, `score`, `ageHours`, `isStale` (veraltet ab **6 h**) | `server/recession.ts:190–193`; `isStale` erst ab **24 h** (`google-trends-cache.ts:13`) | 🟡 | Abweichung bewusst (Future_2/3/4 nennen 24 h). Klären, ob 6 h gewünscht ist; sonst Doku angleichen |
| F5-07 | Z.97–108, 142 | Frontend „letzter Wert vor X h (veraltet)“ | `recessionDashboardPartsB2.tsx:65–72` | ✅ | Keiner |
| F5-08 | Z.112–131, 143 | Redis-Variante für Produktion | nur In-Memory (`google-trends-cache.ts:43`); `ioredis` steht in `package.json:63`, ist nicht angebunden | ❌ | Niedrig. Hinweis: Render startet neu → In-Memory-Wert geht verloren |

## Future_6_Recession_Dashboard_Scoring_Logic.md (129 Zeilen)

Diese Datei beschreibt den Stand vom 09.10. und verlangt keinen Bau. Ich habe jede Regel gegen den Code geprüft. Die Beispielzahlen (40 %/40 %/30 %/50 %/80 %, Indikatorwerte) sind ein Tagesbild (ℹ️).

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F6-01 | Z.19–27 | P = 50 % + (Netto / Max) × 50 %, gerundet | `server/recession.ts:647` `probabilityFromNet`; `:619` begrenzt auf 5–95 % und rundet auf 5er-Schritte | ✅ | Doku ergänzen: Begrenzung und 5er-Rundung |
| F6-02 | Z.36–48, 125 | 12M-Rezession: P_score × 0,7 + NY-Fed × 0,3 (`RECPROUSM156N`) | `server/recession.ts:626–639`, `:579`. SHA `8375df6` (#151) | ✅ | Keiner |
| F6-03 | Z.54–66 | 8 Rezessions-Indikatoren, Weekly Nowcast ×0 | Sahm, Kurve, Aktivität, Durable (`:332–334`), M2, Kredit, Konsumklima; WEI ohne Score (`:964–968`) | ✅ | Keiner |
| F6-04 | Z.72, 86 | Buffett: >200 % +16 / 165–200 % +10 / 140–165 % +4 / <140 % −8 | `server/recession.ts:974ff` (Rohwert 8/5/2/−4 × Gewicht 2) | ✅ | Keiner |
| F6-05 | Z.73, 87 | CAPE: >35 +12,6 / 30–35 +5,4 / 15–30 0 / <15 −9 | `server/recession.ts:1186ff` (7/3/0/−5 × 1,8) | ✅ | Keiner |
| F6-06 | Z.74 | Margin Debt: YoY +37,2 % → Rohwert +2 × 1 | `server/recession.ts:1226–1240`: Wertung über z-Score 5 Jahre statt YoY-Zone. SHA `fe6de61` (#193) | ✅ | Doku veraltet, Code ist der gewollte neuere Stand |
| F6-07 | Z.75, 89 | Google Trends: >75 +11,9 / 60–75 +6,8 / 30–60 0 / <30 −6,8 / N/A = 0 | Zonen `server/recession.ts:1244ff` (7/4/0/−4 × 1,7) ✅. N/A wird heute aus Netto **und** Max genommen statt „0 bei vollem Max“ | ✅ | Doku zu N/A anpassen |
| F6-08 | Z.76, 88 | VIX: >30 +4 / 20–30 +1 / 15–20 0 / <15 −3 | `server/recession.ts:1290ff` | ✅ | Keiner |
| F6-09 | Z.90 | Konsumklima: CSI < 60 → +3 | `server/recession.ts:940–949` | ✅ | Keiner |
| F6-10 | Z.91 | Kreditspreads 1,0–1,5 % → −1 | `server/recession.ts:913–928` | ✅ | Keiner |
| F6-11 | Z.97–103 | Regionen-Gewichte US 0,70 / EZ 0,20 / JP 0,10 | `shared/recession-regions.ts:7` | ✅ | Keiner |
| F6-12 | Z.105, 126 | Handlungsempfehlung bleibt auf den US-Büchern | `RegionGaugeSwitch.tsx:86–87`, `shared/recession-regions.ts:4` | ✅ | Keiner |
| F6-13 | Z.109–115 | Top-3-Treiber nach absolutem Gewicht | `recessionDashboardPartsB2.tsx:30–34` | ✅ | Keiner |

## Future_7_Scoring_Adaptivity_Historical_Crashes.md (105 Zeilen)

Z.1–83 sind eine historische Einordnung (ℹ️). Bau-Anforderung ist §6 (Z.91–105) plus die Aussagen „bleibt fest“ zu VIX und Sahm.

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F7-01 | Z.87, 93–99 | Buffett und CAPE über z-Score der letzten 20 Jahre statt fester Zonen | feste Zonen `server/recession.ts:974ff` (Buffett), `:1186ff` (CAPE); 0 Treffer z-Score im Bewertungsslot | ❌ | **In Arbeit als Draft #219 (CAPE, `96889f7`) und #220 (Buffett, `a651b54`)**, beide nur Zusatzzeile ohne Score. Zonen ersetzen → **braucht Philip** (Buffett/CAPE-Perzentile stehen auf seiner Liste) |
| F7-02 | Z.101–103 | Oder Perzentil: > 90. → hoher Score, < 10. → negativ | wie F7-01 | ❌ | wie F7-01 |
| F7-03 | Z.60–66 | VIX-Zonen bleiben (gut adaptiv) | `server/recession.ts:1290ff` unverändert | ✅ | Keiner |
| F7-04 | Z.70–72 | Sahm-Regel bleibt (bereits adaptiv) | `server/recession-sahm.ts` | ✅ | Keiner |

## Future_8_Adaptive_Scoring_Logics_Detailed.md (146 Zeilen)

Z.1–35 und §4, §6, §7 sind Erklärung (ℹ️).

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F8-01 | Z.38–45 | Funktion `zScoreToScore` (begrenzt ±4, × 1,5) | 0 Treffer in `server/`, `shared/` | ❌ | Mit F7-01, **braucht Philip** für den Score |
| F8-02 | Z.57–74 | Funktion `percentileScore` (>90 → +4, >75 → +2, <25 → −2, <10 → −4) | nur in `server/stablecoin-channel-math.ts` (anderes Thema), nicht im Rezessionspfad | ❌ | wie F8-01 (Draft #219/#220 enthalten die Perzentil-Zeile) |
| F8-03 | Z.97–115 | `calculateAdaptiveScore` mit Mindestlänge 60 Monate | 0 Treffer | ❌ | wie F8-01 |
| F8-04 | Z.121 | Buffett: Perzentil oder z-Score über 20–25 Jahre | feste Zonen | ❌ | **In Arbeit Draft #220** (Zusatzzeile); Score → Philip |
| F8-05 | Z.122 | CAPE: Perzentil über 20–30 Jahre | feste Zonen | ❌ | **In Arbeit Draft #219** (Zusatzzeile); Score → Philip |
| F8-06 | Z.123 | VIX: fest oder z-Score 10–15 Jahre | fest (`server/recession.ts:1290ff`) | ✅ | Keiner (Soll erlaubt „fest“) |
| F8-07 | Z.124 | Sahm: fest | `server/recession-sahm.ts` | ✅ | Keiner |

## Future_9_Adaptive_Macro_Framework_Complete.md (252 Zeilen)

Philip hat am 18.10. entschieden: **Makro-Gewichte darf die KI wählen (JA).** Damit ist der Bau freigegeben. Weil die Gewichte die Rezessions-/Korrektur-P verändern, gilt trotzdem: erst als Zusatzobjekt mit Vorher/Nachher-Tabelle, dann umschalten. §3, §6, §7 sind Einordnung (ℹ️).

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F9-01 | Z.12 | Adaptive Signale (z-Score / Perzentil über 15–20 Jahre) | im Rezessionspfad nur Margin Debt z 5 Jahre (`server/recession.ts:1226`) | ❌ | Autonom (freigegeben), als Zusatzobjekt |
| F9-02 | Z.26 | Gewinnwachstum vs. Trend (S&P-EPS YoY) | 0 Treffer | ❌ | Autonom; Quelle Multpl/FMP |
| F9-03 | Z.27 | Realized Growth Gap (Überraschungsquote, Prognose-Revisionen) | 0 Treffer im Makropfad (nur Aktien-Factpack `server/factpack-validate.ts:244`) | ❌ | Autonom; Datenquelle klären |
| F9-04 | Z.28 | Lager/Nachfrage-Lücke (Inventory-to-Sales, DGORDER vs. Shipments) | DGORDER nur als YoY-Slot (`server/recession.ts:332–334`), keine Lücke | ❌ | Autonom (FRED, kostenlos) |
| F9-05 | Z.29–35 | Sahm, Zinskurve, BAA10Y, Margin Debt, VIX, Buffett, CAPE als Signale | alle als Slots vorhanden (`server/recession.ts`) | ✅ | Keiner (nur in den Layer übernehmen) |
| F9-06 | Z.36 | Realzins DFII10 im Makro-Layer | DFII10 nur in Gold/BTC/Liquidität (`server/liquidity-briefing-catalog.ts:179`), nicht im Rezessionspfad | ❌ | Autonom |
| F9-07 | Z.37 | Konzentration: Cap-Weight-RSL minus Equal-Weight-RSL | 0 Treffer | ❌ | Autonom (SPY gegen RSP aus vorhandenen Kursen) |
| F9-08 | Z.38 | CAPEX der Hyperscaler, YoY | 0 Treffer im Makropfad | ❌ | Autonom; FMP-Cashflow der 4–5 Hyperscaler |
| F9-09 | Z.58–91 | `calculateAdaptiveWeights`: Basisgewichte, Habitat „restrictive“, Konzentration > 0,4, Stärke-Layer | 0 Treffer; nur das Gold-Gegenstück `server/gold-adaptive-score.ts:17–105` | ❌ | Autonom (freigegeben); Muster aus Gold übernehmen |
| F9-10 | Z.95–103 | Managing-Score Makro (CAPEX, EPS, Realzins, Konzentration gegen Trend) | 0 Treffer | ❌ | Autonom, nach F9-02/06/07/08 |
| F9-11 | Z.14, 69 | Dimension „Makro-Bilanzwidersprüche“ | 0 Treffer | ❌ | Spec ist hier unscharf → vor Bau Definition schärfen |
| F9-12 | Z.141–232 | OpenRouter-Call `getAIWeightSuggestion`: JSON, max ±25 %, Fehler → quantitative Gewichte | Infrastruktur `server/llm-openrouter.ts` (`callLLMJson`) vorhanden; Rezession nutzt LLM nur für Treiber-Text (`server/recession-drivers.ts:422–477`, `bc72953` #152) | ❌ | Autonom (Philip JA 18.10.); bestehenden `callLLMJson` nutzen, keinen zweiten Client |
| F9-13 | Z.235–239 | API-Key über Umgebungsvariable, Modell frei, Antwort 6–12 h cachen | Key vorhanden (`OPENROUTER_API_KEY`), Cache für diesen Call fehlt | ❌ | Mit F9-12 |
| F9-14 | Z.129 | Europa-Ersatzdaten definieren | 0 Treffer | ❌ | Nach F9-09 |
| F9-15 | Z.130 | Habitat-Erkennung verfeinern | kein Habitat im Rezessionspfad | ❌ | Mit F9-09 |
| F9-16 | Z.132 | Im Dashboard zeigen, welche Gewichte angepasst wurden | 0 Treffer | ❌ | Mit F9-12 (Muster `client/src/components/gold/GoldAdaptiveLayersCard.tsx`) |
| F9-17 | Z.133 | Historische Validierung 2000 / 2008 / 2022 | 0 Treffer | ❌ | Vor dem Umschalten der Live-P Pflicht |
| F9-18 | Z.137, 218–232 | Umsetzung über einen Analyse-Button | 0 Treffer | ❌ | Mit F9-12 |

## Future_10_Gold_Adaptive_Scoring_Framework.md (279 Zeilen)

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| F10-01 | Z.11–18 | Bestehende Basis bleibt (Technical Score, Real-Yield-OLS, Multi-Faktor, Gates, Monte Carlo, Chart) | `server/gold-routes.ts:278` `getTechnicalScore`; `server/gold-realyield-model.ts:539–655, 728–741`; `GoldMonteCarloSection.tsx` | ✅ | Keiner |
| F10-02 | Z.26–35 | Acht Dimensionen inkl. News | Signale `server/gold-adaptive-score.ts`: Realzins (`:324, 344`), Policy (`:357, 365`), Liquidität (`:383, 391, 410`), Inflation (`:425`), Angebot (`:442`), Technik (`:489–615`), Makro/DXY (`:642`); News-Flag `server/gold-routes.ts:850`. SHA `153bed0` (#208) | ✅ | Keiner |
| F10-03 | Z.56–74 | Layer-Gewichte (1,8/1,3/1,2/0,8/0,9/1,0/0,9), Habitat, `effectiveWeight = base × (0,7 + Stärke × 0,6)` | `server/gold-adaptive-score.ts:17–24, 30–39, 85–105` | ✅ | Keiner |
| F10-04 | Z.84–85 | Golden Cross +1 / Death Cross −1 im Score | MA-Spread als z-Signal (`gold-adaptive-score.ts:510–522`) in der Zusatzschicht; `getTechnicalScore` (`server/gold-routes.ts:278`) liest nur RSI + MA200-Abweichung | 🟡 | Kreuz-Wertung im GIS ist Score-Änderung → **braucht Philip** (Gold QE/QT und Gold-Score stehen auf seiner Liste) |
| F10-05 | Z.84–85, 177 | 50-MA + 200-MA als Chart-Overlay, Kreuz-Marker | `client/src/components/gold/GoldPriceChart.tsx:36–38`; `goldChartMa.ts`. SHA `98ccc92` (#201) | ✅ | Keiner |
| F10-06 | Z.86–87 | Preis über/unter 200-MA als Signal | `gold-adaptive-score.ts:495–509` (`technical.ma200`) | ✅ | Keiner |
| F10-07 | Z.93 | Volumen-Spike > 1,5 × 20-Tage-Schnitt bestätigt Kreuze | `gold-adaptive-score.ts:41, 585–612` | ✅ | Keiner |
| F10-08 | Z.94 | Volumen-Trend: steigendes Volumen bei Aufwärtsbewegung = bullisch | kein eigenes Signal; nur Spike (mit Preisimpuls) und Divergenz | 🟡 | Klein, autonom (nur Zusatzschicht) |
| F10-09 | Z.95 | Volumen-Divergenz (Preis steigt, Volumen fällt) = Warnung | `gold-adaptive-score.ts:615ff` | ✅ | Keiner |
| F10-10 | Z.101 | RSI(14) relativ zur eigenen 1–2-Jahres-Historie | `gold-adaptive-score.ts:489` (`technical.rsi` als z-Wert). SHA `575d788` (#214) | ✅ | Keiner |
| F10-11 | Z.102 | MACD 12/26/9 | `gold-adaptive-score.ts:535–545` | ✅ | Keiner |
| F10-12 | Z.103 | Optional: Bollinger-Band | 0 Treffer | ❌ | Niedrig, autonom |
| F10-13 | Z.104 | Optional: ATR | 0 Treffer | ❌ | Niedrig, autonom |
| F10-14 | Z.134, 175, 270 | Chip „Breakeven“ umbenennen in „Inflations-BE (T10YIE)“ | `GoldPriceChart.tsx:50`. SHA `dedfb99` (#254) | ✅ | Keiner |
| F10-15 | Z.139–140 | AISC aus Quartalsberichten NEM/B/AEM, statische Datei mit Quelle + Datum | `server/data/gold-aisc.json`, `server/gold-aisc.ts`. SHA `dedfb99` (#254) | ✅ | Keiner |
| F10-16 | Z.141, 151, 179, 269 | AISC als gestufte Linie auf der Preisachse | `GoldPriceChart.tsx:22, 164–178`; Daten `server/gold-routes.ts:954` (`aiscLine`) | ✅ | Keiner |
| F10-17 | Z.142 | Stresszone Preis < AISC × 1,10–1,15 | `GoldPriceChart.tsx:66–70, 170–171` | ✅ | Keiner |
| F10-18 | Z.143 | Fehlende Quartale n/a, nichts schätzen | `GoldPriceChart.tsx:164` (Stufen nur auf echten Quartalswerten, sonst „AISC n/a“) | ✅ | Keiner |
| F10-19 | Z.144 | Optional: Mittel der drei Produzenten als Linie, Einzelwerte im Tooltip | Mittelwert-Linie ✅ (#254 „Ø NEM/B/AEM“); Einzelwerte im Tooltip nicht geprüft | 🟡 | Tester prüfen lassen |
| F10-20 | Z.150, 258 | AISC-Marge als Signal, nicht nur Gate | Signal `supply.aisc` existiert (`gold-adaptive-score.ts:442`), bekommt aber `aisc: null` (`server/gold-routes.ts:848`) → immer n/a | 🟡 | Quartals-AISC an die Zusatzschicht geben (kein GIS); GIS nur mit Philip |
| F10-21 | Z.152, 271 | Kapitulationszone definieren | `GoldPriceChart.tsx:67` „Preis unter AISC — Kapitulationszone“ | ✅ | Keiner |
| F10-22 | Z.153 | Angebotsreaktion (Veränderung Minenproduktion) | 0 Treffer | ❌ | Autonom; Quelle (Quartalsberichte / WGC) festlegen |
| F10-23 | Z.161–164 | Policy/Liquidität: Fed Funds, Realzins-Rückgang, M2, WALCL | `gold-adaptive-score.ts:357–398` | ✅ | Keiner |
| F10-24 | Z.162 | Fiskal: Defizitwachstum als positiver Treiber | 0 Treffer im Gold-Pfad | ❌ | Autonom (FRED/Treasury, kostenlos) |
| F10-25 | Z.172–179 | Overlays Real10Y, M2 YoY, DXY, Inflations-BE, WALCL, Volumen, AISC | `GoldPriceChart.tsx:47–51, 81, 83`; M2 echt `ff4cc6e` (#242) | ✅ | Keiner |
| F10-26 | Z.187–189 | Gates GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS, Decoupling | `server/gold-realyield-model.ts` (Gates), Ausgabe `server/gold-routes.ts:861–865` | ✅ | Keiner |
| F10-27 | Z.190 | Neues Gate Policy-Mismatch | `gold-adaptive-score.ts:663–682` `GOLD_POLICY_MISMATCH`. SHA `153bed0` | ✅ | Keiner |
| F10-28 | Z.191 | Neues Gate „Death Cross aktiv“ | `gold-adaptive-score.ts:694–710` `GOLD_DEATH_CROSS_ACTIVE`. SHA `153bed0` | ✅ | Keiner |
| F10-29 | Z.195–242, 273 | Gold-News-Sektion, LLM-Flag −1…+1, Cache 6–12 h, leichte Einbindung | `server/gold-news.ts`, `client/src/components/gold/GoldNewsCard.tsx`, Flag `server/gold-routes.ts:850`. SHA `153bed0` (#208), `4d4dd00` (#239), `f4881ed` (#241) | ✅ | Keiner |
| F10-30 | Z.244–247 | Anzeige: Zusammenfassung, Flag, Zeitstempel | `GoldNewsCard.tsx:80–88` („Stand …“, „Letzter guter Stand …“) | ✅ | Keiner |
| F10-31 | Z.256–260 | Score aus den Layern aggregieren | Layer-Score wird berechnet und nur als „Δ GIS“ gezeigt (`server/gold-routes.ts:859`, `GoldAdaptiveLayersCard.tsx:43`); der GIS selbst bleibt unverändert | 🟡 | GIS umschalten = Score-Änderung → **braucht Philip** |
| F10-32 | Z.272 | Volumendaten zuverlässig anbinden | `server/gold-routes.ts:11` `volumeReadingsAreReal`, Volumen im Chart (`GoldPriceChart.tsx:81`). SHA `575d788` (#214) | ✅ | Keiner |
| F10-33 | Z.274 | Backtest der MA-Kreuz-Signale auf Gold | 0 Treffer in `server/backtest*` | ❌ | Autonom |
| F10-34 | Z.275 | Käufe der Zentralbanken (Europa/global) per LLM | 0 Treffer in `server/gold-news.ts` | ❌ | Autonom (kleiner LLM-Zusatz zur News-Sektion) |
| F10-35 | Z.151–152, 269–270 | Doku: AISC-Linie und Kapitulationszone stehen noch als „Offen“ | Code erledigt (#254), Text in Future_10 veraltet | ❌ | Nur Doku-Nachzug (Philip will Doku-PRs nur auf Ansage) |

## Future_Work.md (461 Zeilen)

Z.10–31 („Bereits umgesetzte Kernbereiche“) ist eine Referenzliste; geprüft, dass die genannten Dateien existieren (ℹ️, nicht gezählt). Die Prioritäten-Tabelle (Z.227–244) und „Nächste Schritte“ (Z.262–269) wiederholen Punkte und sind nicht doppelt gezählt.

| # | Zeile | Soll (wörtlich-knapp) | Ist (Datei:Zeile/SHA) | Status | Nächster Schritt |
|---|---|---|---|---|---|
| FW-01 | Z.39–40, 231 | Komplettes Dashboard Deutsch und Englisch (Sprachumschalter) | 0 Treffer `i18next`, `useTranslation`, Sprachumschalter | ❌ | Autonom, groß (alle UI-Texte) |
| FW-02 | Z.44–46, 232 | Industrie-Wertschöpfungskette, wählbare Branchen, LLM befüllt Firmen ab ca. 1 Mrd. Marktwert | `client/src/pages/ValueChainDashboard.tsx` (`9170135`), `server/valuechain-routes.ts:650` (`enrichValueChainStages`), Mindest-Marktwert `server/valuechain-catalog.ts:445` (1 Mrd. USD) | ✅ | Keiner |
| FW-03 | Z.48–50, 233 | Sektorrotations-Rat nach Risiko, Bewertung, Zyklus | `client/src/components/researcher/SectorRotationPanel.tsx` (`9aa6f9a`), `GET /api/researcher/sector-rotation` (`server/researcher-sector-rotation-route.ts:62`); Spec `fertig_WORK_SEKTORROTATIONS_RAT.md` | ✅ | Keiner |
| FW-04 | Z.52–53, 233 | Sektorrotation nach Kostolany-Rad, visualisiert und regelbasiert | 0 Treffer `Kostolany` | ❌ | Autonom (auf FW-03 aufbauen) |
| FW-05 | Z.57–58 | Analysen ↔ Researcher ↔ Portfolio vollständig gekoppelt und manuell aktualisierbar | Teil-Brücken: „Aus Analyse übernehmen“, Watchlist `client/src/lib/portfolio/watchlist.ts:145`, Researcher-Buttons `client/src/pages/Researcher.tsx:10, 582`; Caches getrennt (`server/disk-cache.ts`, Researcher, Portfolio im Browser) | 🟡 | Autonom: gemeinsamen Refresh-Knopf und Invalidierung definieren |
| FW-06 | Z.60–72, 237 | Researcher „Sector Opportunity“: Add-Buttons für Portfolio/Watchlist | `client/src/components/researcher/SectorsPanel.tsx:6, 103` (`TickerAddButtons`) | ✅ | Keiner |
| FW-07 | Z.74–89, 238 | Portfolio-Performance-Attribution / Backtest gegen Benchmark | `client/src/components/portfolio/PortfolioBacktestPanel.tsx` (`d3a6534`), Spec `fertig_WORK_PORTFOLIO_BACKTEST.md` | ✅ | Keiner |
| FW-08 | Z.93 | BTC: M2 auf den technischen Chart | `client/src/pages/BTCDashboard.tsx:951–956, 1041–1043` (M2 YoY, absolut, mit Verzögerung) | ✅ | Keiner |
| FW-09 | Z.93–94 | BTC: Fiscal Spending (US + global) im Chart, Wachstumszonen | Fiscal nur als Panel/Score (`client/src/components/btc/StablecoinLiquidityPanel.tsx`, `client/src/lib/btcAnalysis.ts:248–252`), nicht im Chart | 🟡 | Autonom (Overlay, ohne Score) |
| FW-10 | Z.94 | Balance-Sheet-Scoring Fed / EZB / China | Fed: Liquiditätsblock (WALCL 13W, T-Bill-Anteil Z.1, DGS10) im BTC-Score, `shared/btc-liquidity.ts:109–126` → `client/src/lib/btcAnalysis.ts:792–796`. SHA `29fdf1d5` (#266). QE/QT-Bänder und Gate `BTC_QE_QT_REGIME` fehlen. EZB/China fehlen | 🟡 | Fed-Rest siehe FW-14/FW-15. EZB/China als Anzeige; Score nur mit Philip |
| FW-11 | Z.96–99, 234 | Miner-Indikatoren vollständig live: Hash Ribbons, Puell, Hashprice, Breakeven, Difficulty Ribbon, Miner Position Index, MVRV | `server/btc-miner.ts` (Hash Ribbons, Puell, Breakeven, Difficulty); MPI fest „neutral“ ohne Datenquelle (`:80, 95`); MVRV nur als Annäherung im Score (`client/src/lib/btcAnalysis.ts:635`) | 🟡 | MPI/MVRV brauchen CryptoQuant/Glassnode (bezahlt) → Kostenfrage an Philip |
| FW-12 | Z.99, 183, 255, 266 | Widerspruch `inCapitulation` vs. `minerZone.zone` klären | getrennte Logik: `server/btc-miner.ts:132` (MA30 < MA60) vs. `:89` `classifyMinerZone`; Anzeige `client/src/components/sections/Section13Miner.tsx:236, 280` | ❌ | Laut Work.MD sind Miner-Kernformeln „nicht anfassen“ → nur Benennung/Anzeige, Formel nur mit Philip |
| FW-13 | Z.101–110, 235, 256 | BTC: Fed-Bilanz WALCL als Datenquelle (Forward-Fill wie M2) | `client/src/pages/BTCDashboard.tsx:314, 1648–1658` → `client/src/lib/btcAnalysis.ts:256` (`GET /api/analyze-btc/liquidity`), Forward-Fill auf Kurstage `:929` → `server/btc-routes.ts:95` → `server/btc-liquidity.ts:97–103` → FRED WALCL, BOGZ1FL313161110Q/…275Q (T-Bills), DGS10; Schema `shared/btc-liquidity.ts` (Forward-Fill `:288–289`), `shared/schema.ts`. SHA `29fdf1d5` (#266, Head `f87ac8b2`). Doublecheck Post-Merge GO, Tester PASS Soft | ✅ (Soft) | Soft-Rest: n/a-Zeile heißt „Abdeckung 0 %“ statt „FRED nicht erreichbar“; Toggle verschwindet ohne Hinweis; Tabelle bricht bei 375 px stark um |
| FW-14 | Z.112–116 | BTC-Chart: log(WALCL)/Wachstumsrate als Linie, QE/QT-Bänder grün/rot/grau, optional BTC/WALCL-Verhältnis | WALCL-Linie (Bio. USD, eigene Achse, Schalter „Fed-Bilanz (WALCL)“) im BTC-Chart: `BTCDashboard.tsx:1648–1658, 1979–1984`. SHA `29fdf1d5` (#266). QE/QT-Bänder und BTC/WALCL-Verhältnis fehlen | 🟡 | QE/QT-Bänder grün/rot/grau, optional BTC/WALCL-Verhältnis |
| FW-15 | Z.118–125 | Score-Indikator „Fed Balance Sheet Regime“ (13W-Änderung > +1,5 % → +1, < −1 % → −1, Gewicht 0,10–0,15) + Gate `BTC_QE_QT_REGIME` | Regel 13W > +1,5 % → +1, < −1 % → −1 `shared/btc-liquidity.ts:45, 109–126`; Block mit Gewicht 0,15 im GIS `client/src/lib/btcAnalysis.ts:792–796`; Vorher/Nachher-Tabelle (QE 2020, QT 2022, heute) `script/fixtures/btc-liquidity/history-table.md`. SHA `29fdf1d5` (#266). Gate `BTC_QE_QT_REGIME` fehlt | 🟡 | Gate `BTC_QE_QT_REGIME` bauen |
| FW-16 | Z.133–134 | Gold-Minenkosten: AISC, C1 vs. C3, Kostenkurve, GDX/GLD-Verhältnis, P/NAV | AISC ✅ (#254); C1/C3, Kostenkurve, GDX/GLD, P/NAV: 0 Treffer | 🟡 | GDX/GLD autonom (Kurse frei); C1/C3/P/NAV brauchen Berichtsdaten |
| FW-17 | Z.136–137 | Gold-Makro: Realzins, DXY, realer Leitzins, Gold/Silber, Zentralbank-Nettokäufe, Gold/Bond-Verhältnis | Realzins/DXY im Chart (`GoldPriceChart.tsx:47, 49`), realer Leitzins `gold-adaptive-score.ts:365`, Gold/Silber `server/gold-silver-ratio.ts` (`565ac7d` #243). Zentralbankkäufe, Gold/Bond fehlen | 🟡 | Gold/Bond autonom; Zentralbankkäufe = F10-34 |
| FW-18 | Z.139–140, 236 | Kombinierte Ansicht Realzins + AISC-Kostenkurve | Realzins und AISC-Linie gemeinsam im Gold-Chart schaltbar (`GoldPriceChart.tsx:47, 83`); keine Kostenkurve über Minen | 🟡 | Kostenkurve braucht Daten je Mine |
| FW-19 | Z.142–151, 167 | Gold Multi-Faktor Phase 2: Real10Y + DXY + log(WALCL), rollierend 252 Tage | `server/gold-realyield-model.ts:539–655` (vor dem 11.10.) | ✅ | Keiner |
| FW-20 | Z.161–162 | Gold-Chart: log(WALCL) und DXY als schaltbare Linien | `GoldPriceChart.tsx:49, 51` | ✅ | Keiner |
| FW-21 | Z.163 | Gold-Chart: QE/QT-Hintergrundbänder | 0 Treffer `QE/QT`, `qeQt` | ❌ | Anzeige autonom; „Gold QE/QT“ steht aber auf Philips Liste → vorher fragen |
| FW-22 | Z.164 | Gold/WALCL-Verhältnis als Unterchart | 0 Treffer | ❌ | wie FW-21 |
| FW-23 | Z.168 | Vorzeichen-Prüfung → `REGIME_UNSTABLE`, Rückfall auf 1-Faktor | `server/gold-realyield-model.ts:728–741` `GOLD_MULTIFACTOR_REGIME_UNSTABLE` | ✅ | Keiner |
| FW-24 | Z.169–170, 172 | Gate `GOLD_QE_QT_REGIME` (starkes QT + Realzins-Stress), keine Doppelzählung | 0 Treffer | ❌ | **Braucht Philip** (Gold QE/QT auf seiner Liste) |
| FW-25 | Z.171 | Multi-Faktor als Vergleichslinie „Liquidity-Adjusted Fair Value“ | `client/src/components/gold/GoldFairValueSection.tsx:13, 80–84` (Schalter Multi-Faktor) | ✅ | Keiner |
| FW-26 | Z.179, 239 | Monte-Carlo-Iterationen frei 0–50.000 statt fest ~10.000 | **Regler vorhanden**: `client/src/components/sections/MonteCarloSection.tsx:206–214` (1.000–50.000, Schritt 1.000), mindestens seit `c181d41` (07.06.). Fazit/Sektion 20 nutzen fest 10.000 (`client/src/pages/Dashboard.tsx:101`) | 🟡 | Untergrenze 0 statt 1.000 ist sinnlos (0 Pfade); offen nur, ob das Fazit dem Regler folgen soll → Philip (steht als „D1“ auf seiner Liste) |
| FW-27 | Z.185–186, 240 | Bilanzen-Screener: Bilanz hochladen → Red Flags | 0 Treffer Upload-Funktion für Bilanzen | ❌ | Autonom, groß |
| FW-28 | Z.188–196, 243 | Segment-Deduplizierung Produkt vs. Geographie | `server/fmp.ts:347` `dedupeSegmentsByName`. SHA `5e7b60a` (20.08.) | ✅ | Keiner |
| FW-29 | Z.200, 241 | Google-Trend-Score fixen (oft N/A) | siehe Future_3–5, `8add9ed` (#200) | ✅ | Keiner (Rest F3-04, F4-07) |
| FW-30 | Z.202, 241 | Fazit Makro-Risikobewertung im KI-Modus + LLM-Suche | KI-Fazit `server/recession-drivers.ts:422–477` (`bc72953` #152), Anzeige `RecessionDashboard.tsx:144–146`; LLM-Websuche fehlt | 🟡 | „LLM-Search“ ist nicht spezifiziert → Spec schärfen |
| FW-31 | Z.204 | Rezession: Sektorrotation unter-/überbewertet | im Rezessions-Dashboard 0 Treffer; Sektorrotation nur im Researcher | ❌ | Autonom: Researcher-Sektorrotation im Rezessions-Dashboard verlinken/einbetten |
| FW-32 | Z.208–211, 242 | Fazit als Konfliktmatrix (Qualität, Trend, Reverse DCF, Technik, Katalysatoren) | `client/src/components/sections/ConflictMatrixPanel.tsx` (`0c7809a` #218), `shared/conflict-matrix.ts`, PDF `server/pdf-conflict-matrix.ts` (`157f478` #221) | ✅ | PDF-Route auf Prod laut Ampel noch nicht live geprüft |
| FW-33 | Z.216 | ETF + Core-Satellite-Strategie | — | ⛔ | Philip 18.10.: ETFs bleiben blockiert |
| FW-34 | Z.254 | Fiscal-Bridge an echten Discovery-Workflow anschließen | genutzt im Backtest-Replay (`server/backtest/fiscal-replay.ts:64`) und als Client-Gegenstück (`client/src/lib/calculations.ts:448–451`); kein Anschluss an Discovery | 🟡 | Autonom |
| FW-35 | Z.257 | Screener-Gates + Backtesting Vollversion | Kern `server/backtest-routes.ts`, `server/backtest/`; „Vollversion“ ist nicht definiert | 🟡 | Spec schärfen |
| FW-36 | Z.258 | Regulatory-Impact direkt in Risiken/PESTEL | PESTEL: `client/src/components/sections/PestelSection.tsx:280–281` (`RegulatoryExposurePanel`), `server/regulatory-risks.ts:65`. In Risikoinversion (Sektion 10) nicht | 🟡 | Autonom (Anzeige in Sektion 10) |
| FW-37 | Z.307–319 | Peer hinzufügen: sofortiger Analyse-Call, Loading, Persistenz über Reload, Cache-Key mit Overrides | `client/src/pages/Dashboard.tsx:165–201` (Overrides im Analyse-Body, auch im Poll), Loading `client/src/components/sections/PeerComparison.tsx:503–506`, Speicher im Browser `client/src/lib/peerOverrideLimits.ts`. SHA `1955015` (#199), `33c1419` (#258), `6d245b4` (#260), `122762b` (#262) | ✅ | Keiner |
| FW-38 | Z.310 | Optional: Autocomplete/Validierung im Peer-Feld wie TickerSearch | 0 Treffer `TickerSearch`/Vorschläge in `PeerComparison.tsx` | ❌ | Autonom, klein (UI) |
| FW-39 | Z.343–347, 389–390 | Credit-Spread-Overlay im technischen Chart: Schalter, eigene Achse, Tooltip mit bp, Änderung, Quelle, Warnhinweis | Markt-Spread BAA10Y: `TechnicalChart.tsx:159–163, 370–375, 592–598` → `useMarketCreditSpread.ts` → `server/credit-route.ts:110` → `server/fred-csv.ts` → `shared/credit.ts:82–86` (Stress-Hinweis in bp über 3 Monate). SHA `ba760a8` (#253) | ✅ | Keiner (Markt-Ebene) |
| FW-40 | Z.336–341, 368, 393–402, 440–457 | Unternehmens-Anleihen-Spread / CDS je Ticker (company-notes → ISIN → YTM → Spread) | 0 Treffer `company-notes`, `bond-fetcher`, `cdsSpread` | ⛔ | Leeway (~70 €/Monat) / Terrapin (~299 $/Monat) nicht freigegeben |
| FW-41 | Z.349–353 | Scoring: Spread-Anstieg negativ, Valuation dämpfen, Gate `CREDIT_SPREAD_STRESS` | 0 Treffer `CREDIT_SPREAD_STRESS`; Overlay hat „kein Score-Einfluss“ (`TechnicalChart.tsx:594`) | ❌ | Score-Änderung → **braucht Philip** |
| FW-42 | Z.379, 389–390, 422 | FRED ICE-BofA-OAS (Rating-Buckets) als Overlay | 0 Treffer BAML-OAS im Aktienpfad | ⛔ | Philip 18.10.: Credit nur über BAA10Y |
| FW-43 | Z.380, 391 | FINRA: einzelne Anleihen, YTM selbst rechnen | 0 Treffer | ⛔ | Credit nur über BAA10Y; Firmenanleihen-Quellen nicht freigegeben |
| FW-44 | Z.404–412 | Dateien: `bond-fetcher.ts`, Analyse-Route, `shared/schema.ts`, Disk-Cache für Anleihen | fehlt | ⛔ | Folgt aus FW-40 |
| FW-45 | Z.422 | Leeway-Free-Tier für 1–2 Emittenten (ORCL) testen | 0 Treffer | ⛔ | Firmenanleihen-Quellen nicht freigegeben (auch nicht der Gratis-Test) |

Nicht gezählt (ℹ️, Konzept- und Content-Ideen ohne Bau-Auftrag): Z.215 Einleitungstext 2026, Z.217 Kaufkraft-Inflation, Z.218 Investoren-Mindset, Z.219 tiefere Makroanalyse, Z.220 Megatrend-Analyse, Z.221 17-Step-Framework, Z.222 BTC-Korrelationen, Z.223 Blasen-Indikatoren. Diese brauchen erst eine Spec.

---

## Gesamtzählung

### Je Status (alle Zeilen)

| Status | Zeilen | davon Wiederholung (mit „=“ markiert) | eigene Punkte |
|---|---:|---:|---:|
| ✅ erledigt | 108 | 0 | 108 |
| 🟡 teilweise | 38 | 4 | 34 |
| ❌ fehlt | 71 | 6 | 65 |
| ⛔ blockiert | 16 | 2 | 14 |
| **Summe** | **233** | **12** | **221** |

Hinweis: Die 13 ✅ aus Future_6 sind eine Prüfung der Doku gegen den Code (die Datei verlangt keinen Bau). Ohne Future_6 bleiben 95 erledigte Bau-Punkte.

### Je Datei

| Datei | ✅ | 🟡 | ❌ | ⛔ | Summe |
|---|---:|---:|---:|---:|---:|
| Future_1_Work.md | 35 | 14 | 19 | 6 | 74 |
| Future_2_NA_Fixes_Research.md | 3 | 4 | 3 | 0 | 10 |
| Future_3_SerpApi_Rate_Limits.md | 4 | 0 | 3 | 2 | 9 |
| Future_4_Google_Trends_Conflict_and_Fixes.md | 4 | 0 | 4 | 2 | 10 |
| Future_5_Google_Trends_Cache_Implementation.md | 6 | 1 | 1 | 0 | 8 |
| Future_6_Recession_Dashboard_Scoring_Logic.md | 13 | 0 | 0 | 0 | 13 |
| Future_7_Scoring_Adaptivity_Historical_Crashes.md | 2 | 0 | 2 | 0 | 4 |
| Future_8_Adaptive_Scoring_Logics_Detailed.md | 2 | 0 | 5 | 0 | 7 |
| Future_9_Adaptive_Macro_Framework_Complete.md | 1 | 0 | 17 | 0 | 18 |
| Future_10_Gold_Adaptive_Scoring_Framework.md | 23 | 5 | 7 | 0 | 35 |
| Future_Work.md | 15 | 14 | 10 | 6 | 45 |
| **Summe** | **108** | **38** | **71** | **16** | **233** |

### In Arbeit (laufend, mit PR-Nummer)

| Punkt | Wer | PR | Stand |
|---|---|---|---|
| F1-01, F1-11 Yahoo-Ersatz auf Prod (MCap/KGV/EPS = 0) | GitHub-Lane / Builder | **#264** gemergt (Squash `4dd43ab8`, Head `5b244253`) | F1-01 ✅ Soft (Doublecheck Post-Merge GO, Tester Prod PASS Soft); F1-11 🟡: BMW.DE und ungültiger Ticker noch nicht live geprüft |
| F1-01, F1-05 Nicht-US-Titel über ADR bei FMP | dr eggbot | **#265** (Draft „HOLD Philip“, Head `dbdd7475`) | Philip-Entscheidung 18.10.; offen |
| FW-13, FW-14, FW-15 BTC-Score mit WALCL, T-Bill, Zinsen + WALCL-Linie | Werki | **#266** gemergt (Squash `29fdf1d5`, Head `f87ac8b2`) | FW-13 ✅ Soft; FW-14/FW-15 🟡: QE/QT-Bänder, BTC/WALCL-Verhältnis, Gate `BTC_QE_QT_REGIME` offen |
| F7-01, F8-04, F8-05 Buffett/CAPE-Perzentil als Zusatzzeile | – | **#220**, **#219** (Drafts seit 11.10.) | Ersetzen der Zonen braucht Philip |
| (nicht aus Future-Dateien) Real10Y aus BTC in Sektion 12 | Grok Bot | **#267** (Draft, Head `c224e2c9`) | Philip 18.10.; offen |
| (nicht aus Future-Dateien) DCF-Währung alles in USD | – | **#261** (Draft) | wartet auf Philip |

---

## Was wirklich fehlt: priorisiert

### A) Autonom baubar (kein Philip nötig, kein Score-Umbau ohne Zusatzobjekt)

Reihenfolge nach Nutzen und Aufwand (S = klein, M = mittel, L = groß).

1. **Makro-Layer mit KI-Gewichten (Future_9)** – F9-09, F9-12, F9-13, F9-16, F9-17 (L). Philip hat am 18.10. JA gesagt. Heute 0 Code im Rezessionspfad. Erst als Zusatzobjekt mit Anzeige der angepassten Gewichte und Prüfung an 2000/2008/2022, erst danach die Live-P umschalten. Datenreihen F9-02/04/06/07/08 (FRED/FMP, kostenlos) gehören dazu.
2. **Buffett robust machen** – F1-34 Fehlergrund statt generischem 502, F1-30 zweiter Versuch, F1-31 FRED-Marktwert als Ersatz (S).
3. **VIX im Rezessions-Chart mit Yahoo-Ersatz** – F1-66 (S). Der Score hat ihn schon (#210).
4. **Credit-Risiko-Karte in Sektion 10 (Risikoinversion)** – F1-21 mit F1-20 (Verschuldung, Zinsdeckung aus FMP) und F1-24 (PESTEL-Zeile) (M). Basis ist der Markt-Spread BAA10Y; kein CDS, kein Score.
5. **Regionen-Umschalter vollständig** – F1-52 Backend rechnet die 5 Untergruppen je Region, F1-47 fünf Gauges, F1-48 Tabellen folgen der Region (M). Nur Anzeige, US-Handlung bleibt.
6. **Dividende fertig machen** – F1-17 Spanne/Sektor in Sektion 6, F1-18 Hinweis in Sektion 20, F1-14 Band ab 4 % (S).
7. **Rezessions-TA in einer Sektion** – F1-41, F1-42, F1-43, F1-45 (L), nach Punkt 3.
8. **Buffett Europa/Asien mit echten Benchmarks** – F1-71, F1-74 (M, nur Chart). Das Label „Asien“ erst nach Philips Asien-Entscheidung. ✅ `09750838` (#320); Asia ^TPX und Label „Asien“ offen.
9. **SPY-Fundamentals und Analystenschätzungen mit Yahoo-Ersatz** – F1-67, F1-68 (S). Erst nach #264, weil dasselbe Crumb-Problem gilt.
10. **Google Trends: Retry mit Backoff** – F3-04 (S).
11. **Gold-Zusatzschicht ergänzen** – F10-20 AISC-Marge (Quartalswerte an die Schicht, nicht an den GIS), F10-24 Fiskaldefizit, F10-08 Volumen-Trend, F10-33 Backtest der Kreuze, F10-34 Zentralbankkäufe, F10-12/13 Bollinger/ATR (S–M).
12. **Bereinigter Buffett als Zusatzkennzahl** – F1-36 bis F1-40 (M), ohne den Score-Slot.
13. **Kleinere Lücken** – F1-63 TOPIX über Yahoo, F1-56 ECB-Ersatz EZ-Kurve, FW-09 BTC-Fiscal als Overlay, FW-31 Sektorrotation im Rezessions-Dashboard, FW-36 Regulatory in Sektion 10, FW-38 Peer-Autocomplete, FW-16/17 GDX/GLD und Gold/Bond.
14. **Große Blöcke ohne jeden Code** – FW-01 Deutsch/Englisch, FW-04 Kostolany-Rad, FW-27 Bilanzen-Screener, FW-05 gemeinsamer Refresh über Analyse/Researcher/Portfolio.
15. **Nur Doku** – F10-35 (Future_10 nennt erledigte AISC-Punkte noch „Offen“), F6-01/F6-07 (Doku an Code angleichen), F5-06 (6 h oder 24 h).

### B) Braucht Philip

| Punkt | Frage an Philip | Warum |
|---|---|---|
| F7-01, F7-02, F8-01–F8-05 | Buffett/CAPE: feste Zonen durch 20-Jahres-Perzentil ersetzen? (Drafts #219/#220 zeigen es erst als Zusatzzeile) | starke Änderung der Korrektur-P |
| F4-07 | Google-Trends-Gewicht senken, wenn der Wert älter als 24 h ist? | Score-Änderung |
| F1-23, FW-41 | Credit-Spread als Stress im CRV und als Score-Signal / Gate `CREDIT_SPREAD_STRESS`? | CRV- und Score-Änderung |
| F10-04, F10-31 | Gold-GIS: Kreuze und Layer-Score in den Gesamt-Score übernehmen? | Score-Änderung |
| FW-21, FW-22, FW-24 | Gold QE/QT: Bänder, Gold/WALCL, Gate `GOLD_QE_QT_REGIME`? | steht auf seiner Liste |
| F1-54 | Asien = nur Japan oder auch China/Korea/Taiwan/Indien, mit welchen Gewichten? | ändert die regionale P |
| FW-26 | Monte Carlo: soll das Fazit dem Iterations-Regler folgen oder fest bei 10.000 bleiben? | Fazit-Rating |
| FW-12 | `inCapitulation` / `minerZone` vereinheitlichen? | Miner-Formel |
| FW-11 | MPI / MVRV brauchen CryptoQuant oder Glassnode | Kosten |
| F3-08, F4-09 | Antrag für die offizielle Google-Trends-API stellen? | braucht sein Konto |
| F1-36 | Bereinigten Buffett auch im Score-Slot nutzen? | Score-Änderung |
| ⛔ Kosten (nur falls Philip neu entscheiden will) | F1-06/07 FMP Ultimate/EODHD, F1-19/25/27 und FW-40/43/44/45 Firmenanleihen und CDS (Leeway, Terrapin, FINRA), F3-07/09 SerpApi-Plan/andere Anbieter | bisher nicht freigegeben |
| ⛔ Entscheidung gefallen | FW-42 ICE-BofA-OAS (Credit nur BAA10Y), FW-33 ETF/Core-Satellite (ETFs blockiert) | bleibt gesperrt |

---

## Abweichungen zum alten Vergleich

Abgeglichen mit: `/home/box/agent-data/shared/Future_SOLL_IST_122762b3.md` und der Fassung `/home/box/agent-data/shared/Future_SOLL_IST_35ead515.md` (Work.MD; inhaltlich gleich, nur ein Stand-Vermerk zu #263), `/workspace/future-inventory-2026-10-18.md` (Grok Bot, Basis) und `Offen_FUTURE_SOLL_IST.md` im Repo (Stand 11.10., `5849ed15`).

### Wo der alte Vergleich falsch oder ungenau war

| # | Thema | Alter Vergleich sagte | Tatsächlich auf `35ead515` |
|---|---|---|---|
| A-01 | Monte-Carlo-Iterationen (FW-26, alt D1) | „`Dashboard.tsx:101` `iterations: 10000` fest“, offen, auf Philips Liste | **Falsch.** Regler 1.000–50.000 existiert in Sektion 18 (`MonteCarloSection.tsx:206–214`), mindestens seit 07.06. (`c181d41`). Fest ist nur der Lauf für Fazit/Sektion 20. → 🟡; die Philip-Frage ist enger: Soll das Fazit dem Regler folgen? |
| A-02 | Region-Buttons (F1-46–F1-53, alt „erledigt #211“) | in Liste (4) „Erledigt“ | **Nur teilweise.** EZ/JP zeigen 2 statt 5 Gauges, Sektionen 5/6 bleiben US, Backend rechnet keine 5 Untergruppen je Region |
| A-03 | Future_9 Makro-Gewichte (alt G3) | „Score hoch → braucht Philip“ (so auch in Liste (3)) | Philip hat am 18.10. JA gesagt → **autonom baubar**. Der Vermerk unten in der Work.MD-Datei stimmt, Liste (3) ist nicht nachgezogen |
| A-04 | Sektorrotations-Rat (FW-03, alt D4) | mit Kostolany zusammen „offen“ | Sektorrotations-Rat ist **live** (`SectorRotationPanel.tsx`, `fertig_WORK_SEKTORROTATIONS_RAT.md`). Offen ist nur das Kostolany-Rad (FW-04) |
| A-05 | N/A-Katalog EZ/JP (alt F8) | „Ob die Serien heute liefern: unklar“ | FRED-Abruf 18.10.: EZ-HY (15.10.), JP-ALQ (08/2026), JP-10J (09/2026) liefern; EZ-Kurve bis 01/2026 (innerhalb 18 Monate); JP-Aktivität kommt aus OECD/DBnomics (alt nicht erwähnt). Live-Anzeige weiter ungeprüft |
| A-06 | Credit-Teil von Future_1 §11.2 (F1-20 bis F1-26) | nur „E1 Firmenanleihen-YTM/CDS → Philip“ | Die Credit-**Karte** in Sektion 10, PESTEL-Zeile und Verschuldungs-Kennzahlen gehen ohne bezahlte Quelle (BAA10Y + FMP) und fehlen komplett. Nur CDS/Anleihe/Rating sind ⛔ |
| A-07 | Dividende (F1-14, F1-17, F1-18) | „Dividende KPI/Overlay erledigt“ | Overlay und KPI ja. Es fehlen: Vergleich in Sektion 6 (Bewertung), Hinweis in Sektion 20, Farbband ab 4 % |
| A-08 | Gold-Kreuze (F10-04, alt H1) | „Crosses wirken nur als Gates“ | Kreuze wirken **auch** als z-Signal in der Zusatzschicht (`gold-adaptive-score.ts:510–522`), dazu MACD und Volumen-Divergenz. Der GIS selbst bleibt unverändert (F10-31) – das stand im alten Vergleich nicht |
| A-09 | Gold-Schicht „erledigt“ (alt Liste (4)) | adaptive Gold-Schicht erledigt | Schicht ✅, aber der Layer-Score ändert den GIS nicht (nur „Δ GIS“ angezeigt) und die AISC-Marge bekommt `aisc: null` (F10-20) |
| A-10 | Buffett-Robustheit (F1-31, F1-35, alt F4) | „Annotation erledigt, sonst Retry/Fallback fehlen“ | Ergänzung: Fortschreibung über Proxy bis 30 Tage existiert (#245) als Teil-Ersatz; Cache ist 15 min, nicht 6 h wie in `Offen_FUTURE_SOLL_IST.md` |
| A-11 | MVRV (FW-11, alt C5) | „MVRV/Realized Price 0 Treffer“ | MVRV-Z als Annäherung im BTC-Score (`btcAnalysis.ts:635`) |
| A-12 | ETF + Core-Satellite (FW-33) | nicht bewertet | ⛔ – Philip: ETFs bleiben blockiert |
| A-13 | SerpApi-Plan / andere Anbieter (F3-07, F3-09) | ℹ️ „Entscheidung bei Philip“ | ⛔ Kosten ohne Freigabe |
| A-14 | Future_2 bis Future_9 | Basis-Inventur: nur über Überschriften geprüft, „unklar“ | Diesmal Zeile für Zeile; Future_6 komplett gegen den Code geprüft (13 Regeln stimmen; Doku veraltet bei Margin Debt und Trends-N/A) |
| A-15 | Segment-Dedup (FW-28) | „SHA vor diesem Fenster“ | SHA `5e7b60a` (20.08.) |
| A-16 | GDX/GLD (FW-16, alt D9) | „nicht gesucht“ | 0 Treffer → fehlt |
| A-17 | Yahoo bei 402 (F1-01) | Work.MD: 🔴 Prod / 🟡 Code | Hier 🟡: Code und Fehlermeldungen sind da (F1-02 bis F1-04 ✅), auf Prod fehlen MCap/KGV/EPS → in Arbeit #264. Gleicher Befund, andere Einstufung. Nachtrag: #264 gemergt (`4dd43ab8`), F1-01 jetzt ✅ (Soft) |
| A-18 | Zählung | 66 Zeilen (6 🟢 / 17 🟡 / 1 🔴 / 42 offen) | Der alte Vergleich mischt Future-Dateien mit `Offen_WORK_*`, `WORK_*` und Ampel-Merges. Diese Liste zählt **nur die 11 Future-Dateien**: 233 Zeilen, 221 eigene Punkte |

### Wo `Offen_FUTURE_SOLL_IST.md` (11.10.) überholt ist

Die Datei im Repo ist eine Woche alt und an diesen Stellen nicht mehr richtig: „kein `server/yahoo-fetcher.ts`“ (jetzt da, #252), „kein Trends-Cache, kein Last-Good, UI-Satz 61.2“ (jetzt da, #200), „kein Dividenden-Plot“ (jetzt da, #213/#227), „Gold ohne MA50, Volumen, News, Policy-Gate“ (jetzt da, #201/#208/#214/#239), „Peer-Add-Bug: Poll ohne Overrides, kein Reload“ (behoben, #199), „Gauges ohne `selectedRegion`“ (teilweise, #211). Die Datei bleibt `Offen_`; ein Nachzug gehört in einen Docs-PR, wenn Philip ihn will.

### Was diese Liste bewusst nicht abdeckt

- `Offen_WORK_BUFFETT_ASIA_10Y.md`, `Offen_WORK_CAPEX_SECTOR_MAP.md`, `Offen_WORK_RESEARCHER_CAPEX_MAP.md`, `Offen_WORK_BITCOIN_MINER_MAP.md` (darin die 2D-Weltkarte), `WORK_PEER_SELECTION*.md`, `WORK_DASHBOARD_FEATURES_2026-10.md`, `WORK_GURUFOCUS_METRICS_ASSESSMENT.md`: keine Future-Dateien, deshalb hier nicht gezählt. Sie stehen weiter im Work.MD-Vergleich.
- Keine Live-Tests in der Oberfläche. Alle ✅ sind Code-Belege; für UI-Punkte gilt laut Regel erst mit Tester-PASS als abgenommen.
