# Audit offene Specs — Architektur, plus Fachlichkeit für die übernommenen Specs

**Repo:** `1719842374/Aktienanalyst`  
**main-SHA:** `ed1e98cdf17bca6251650d2eb2c1825e850c6530` (09.11.2026, `docs: Ampel-Nachzug main 01bf6089 … #471`). `git fetch origin main` bestätigt denselben SHA.  
**Prüfart:** Ist nur aus dem Baum dieses SHA. Draft-PRs zählen nicht als Ist.  
**Urteil je Datei genau eines:** `BAUBAR`, `NACHSCHÄRFEN`, `BLOCKIERT` oder `ERLEDIGT`. Wo für die übernommenen Specs Technik und Fachlichkeit auseinanderlaufen, gilt die strengere Stufe.  
**Nicht angefasst:** keine Spec umbenannt, kein Score, kein Rating, kein Entry, kein Push auf `main`.

Fachlich mitgeprüft (die anderen Prüf-Agenten sind gestoppt): `Offen_WORK_CAPEX_SECTOR_MAP.md`, `Offen_WORK_RESEARCHER_CAPEX_MAP.md`, `Offen_FUTURE_SOLL_IST.md`, `Offen_FUTURE_SOLL_IST_DETAIL.md`, `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md`, `WORK_CHAT_PODCAST_MCP.md`, `WORK_CHAT_UPLOAD_CONNECTOR.md`, `WORK_DASHBOARD_FEATURES_2026-10.md`. Alle übrigen Dateien nur Architektur.

`WORK_KI_CHAT_*.md` hat das Präfix `WORK_KI_CHAT_`, nicht `WORK_CHAT_`. Dafür gilt nur die Architekturprüfung.

## Stilles 1:1, das mehrere Ketten trifft

`getFxRateToUsd` gibt bei USD bewusst `1` zurück (`server/fmp.ts:840`). Schlägt der Abruf `XXXUSD` fehl und liegt kein Cache, gibt dieselbe Funktion ebenfalls `1` zurück (`server/fmp.ts:850–854`). `convertFmpRowsToUsd` bricht bei `rate === 1` ab und lässt die Zeile in `reportedCurrency` (`server/fmp.ts:899–904`). Der Aufrufer kann „war schon USD“ und „Kurs fehlte“ nicht unterscheiden. Felder heißen danach oft weiter USD (`capexUsd` in `server/researcher-geo-map.ts:261`). Offener PR zur Trennung: [#474](https://github.com/1719842374/Aktienanalyst/pull/474) (Draft, nicht auf main).

---

## Übersicht

| Spec | Soll kurz | Ist (`ed1e98cd`) | Datenkette-Lücken | Urteil | nötige Freigabe | Abhängigkeiten |
|---|---|---|---|---|---|---|
| `Offen_WORK_CAPEX_SECTOR_MAP.md` | 2D-Karte Capex + Sektor, ≥20 Länder, Side-Panel in USD | Kette liegt. Zuordnung ist Firmensitz, nicht Geo-Capex. 25 feste Länder, Top 6, ≥ 2 Mrd. USD | FX-Ausfall bleibt in der Landeswährung unter dem Namen USD. Budget vor dem Fächer nicht geprüft | NACHSCHÄRFEN | nein, solange nur Anzeige | gleiche Kette wie `Offen_WORK_RESEARCHER_CAPEX_MAP.md` |
| `Offen_WORK_RESEARCHER_CAPEX_MAP.md` | dieselbe Karte plus Miner- und Gold-Layer | dieselben Routen, `layer=miner\|gold\|valuechain` zusätzlich | Miner-Länderanteil n/a. Capex-Logik wie die Schwester-Spec | NACHSCHÄRFEN | nein | nicht ein zweites Panel bauen |
| `Offen_FUTURE_SOLL_IST.md` | Inventar Future_1–10 / Future_Work, Stand 11.10. gegen `5849ed15` | viele Punkte haben inzwischen Route und UI. Die Datei nennt Lücken, die zu sind | kein einzelner Endpunkt. Status nicht gegen `ed1e98cd` | NACHSCHÄRFEN | ja für jeden Punkt, der P, GIS oder Score ersetzt | `Offen_FUTURE_SOLL_IST_DETAIL.md` ist die jüngere Liste und ebenfalls veraltet |
| `Offen_FUTURE_SOLL_IST_DETAIL.md` | Zeilenkatalog, Basis `29fdf1d5`, Nachträge bis 01.11. | trennt Anzeige und Score besser. Mehrere „fehlt“-Zeilen sind auf main (Makro-Schicht, Growth, TA, Balance-Screen) | Bauen aus der Zählung würde Vorhandenes neu anlegen | NACHSCHÄRFEN | ja, Tabelle B der Datei | nicht parallel zur Kurzfassung bauen |
| `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` | FMP-Segmente bleiben 100 %. KI-Unterposten nur innen, als Override | kein Feld, keine Route, keine UI | Kette fehlt. Eltern-Umsatz erbt das stille FX-1 | NACHSCHÄRFEN | ja, sobald eine Wachstumszahl in DCF, TAM oder Score läuft | Peer-Override ist nur Analogie, nicht dieselbe Route |
| `WORK_CHAT_PODCAST_MCP.md` | Verlauf pro User, Economist-Transkript, FMP-MCP | Verlauf ist Session-RAM + `sessionStorage`. Transkript-Route da. MCP fehlt | kein User-Store. MCP ohne Budget-Deckel. Key stünde in der URL | NACHSCHÄRFEN | nein für Verlauf und Layout. MCP vervielfacht FMP-Calls | `WORK_PODCAST_*`, `WORK_KI_CHAT_*`, `WORK_SIMPLYWALLST_LEARNINGS.md` |
| `WORK_CHAT_UPLOAD_CONNECTOR.md` | Upload, Voice, Connector `GET /api/scoring/:symbol` | kein Upload, kein Voice, kein API-Key. Chat ist `POST /api/chat` Text | kein dauerhafter Speicher. Render-Disk ist flüchtig | BLOCKIERT | Connector liest Scores, ändert sie nicht. Trotzdem Auth-Entscheid | nicht auf die lokale Platte schreiben |
| `WORK_DASHBOARD_FEATURES_2026-10.md` | Jahrestabelle, Sankey, Earnings-Marker, Peer-Linie, Chat mit Override, Event in den DCF, Custom-Screener | Chat-Widget und Statements da. Sankey, Marker, Peer-Linie, Custom-Filter nicht auf main | sechs Ketten in einer Datei. §4 und §4b schreiben DCF, Gates, Ampel | NACHSCHÄRFEN | ja vor §4, §4b, §4c | Anzeige-Teile getrennt und ohne Score bauen |
| `Offen_WORK_BUFFETT_ASIA_10Y.md` | §1 Buffett nur Rezession. §2 Asien = JP+CN. §3 10J im Aktien-Chart | §1 und §3 liegen. §2 ist weiter Katalog `JP` / Label „Asien (Japan)“ | Aggregat-Handler fehlt. Drei Drafts dafür | BAUBAR | ja, sobald die aggregierte Katalog-P die bisherige JP-P ersetzt | nicht mit den Buffett-Formel-Specs in einem Diff |
| `Offen_WORK_GOLD_MINER_BREAKEVEN.md` | AISC-Block Sektion 9, nicht im Preis-Chart, `inScore: false` | Kette bis `GoldAnalysis.aiscZone` | Euphorie-Slot unbenutzt. 1,10/1,15 bleiben im Modul, nicht auf der Preisachse | ERLEDIGT | nur falls Euphorie oder GIS doch den Score trifft | nicht den BTC-Miner anfassen |
| `WORK_BUFFETT_ADAPTIVE_SOLUTION.md` | Perzentile statt fester Zonen | Buffett-Route zeigt Zonen. Kein Regression-Objekt auf main | Zusatzfeld vs. Ersatz der Live-P nicht festgelegt | NACHSCHÄRFEN | ja, wenn die Live-P wechselt | Drafts #422 und #375 widersprechen sich |
| `WORK_BUFFETT_ADJUST_IMPL.md` | Sektor-Mix × Realzins auf den Indikator | keine solche Funktion | kein Feld, überlappt drei Buffett-Specs | BLOCKIERT | ja | erst eine Formel-Spec behalten |
| `WORK_BUFFETT_OVERLAYS.md` | 10J und Realzins als Chart-Overlay | `DGS10` und `DFII10` in `TechnicalChart` | keine für den Overlay | ERLEDIGT | nein | §3 von `Offen_WORK_BUFFETT_ASIA_10Y.md` ist dieselbe Fläche |
| `WORK_BUFFETT_WEIGHT_DISTORTION.md` | Gewichtung prüfen, Empfehlung | kein neuer Handler | kein Soll-Endpunkt | NACHSCHÄRFEN | ja, falls die Empfehlung in den Score geht | Input für `WORK_BUFFETT_ADJUST_IMPL.md`, nicht selbst bauen |
| `WORK_REALZINS_ADJUST.md` | Realzins-Adjustierung des Buffett-Indikators | DFII10-Serie da, nicht auf die Quote angewendet | Ansatzpunkt Score vs. Linie offen | NACHSCHÄRFEN | ja, wenn die Quote sich ändert | Daten aus `WORK_BUFFETT_OVERLAYS.md` |
| `WORK_REMOVE_BUFFETT_STOCK.md` | Karte aus der Aktienanalyse | `Dashboard.tsx` mountet `BuffettMacroCard` nicht | keine | ERLEDIGT | nein | Datei `BuffettMacroCard.tsx` bleibt ungenutzt liegen |
| `WORK_EARNINGS_YIELD_ROIC_IMPLEMENTATION.md` | Earnings Yield und ROIC in Sektion 12, Peer-Dividende | `GET /api/chart/earnings-yield/:symbol` und `/roic/:symbol`, Chips im Chart | keine architektonische Lücke | ERLEDIGT | nein (Anzeige) | eine Kette mit `WORK_EARNINGS_YIELD_ROIC_PLOT.md` |
| `WORK_EARNINGS_YIELD_ROIC_PLOT.md` | dasselbe Plot-Soll | dieselbe Kette | keine zweite Route bauen | ERLEDIGT | nein | siehe Implementierungs-Datei |
| `WORK_GURUFOCUS_METRICS_ASSESSMENT.md` | welche Metriken sich lohnen | kein Soll-Endpunkt | kein Bauauftrag | NACHSCHÄRFEN | — | nicht als Ticket lesen |
| `WORK_HYBRID_CLASSIFICATION.md` | zwei Sektoren für TSLA-artige Firmen | ein Sektor aus dem FMP-Profil (`peer-adaptive`) | kein Schemafeld | NACHSCHÄRFEN | ja, wenn der Sektor den Score wählt | `WORK_HYBRID_XPENG.md` ist nur die Übertragung |
| `WORK_HYBRID_XPENG.md` | dasselbe auf XPEV | XPEV nur in der Peer-Notnagel-Liste | keine eigene Kette | NACHSCHÄRFEN | wie die Klassifikation | nicht vor dem Schemafeld |
| `WORK_HYPECYCLE_EMAIL_SUPABASE.md` | Proxy-Hype und Mail bei ATTRAKTIV | Mail-Route antwortet `sent: false`, kein Supabase. Hype-Proxy nicht auf main | zwei Produkte. Mail ohne Store | NACHSCHÄRFEN | Mail ja (Konto). Hype nur Anzeige: nein | Drafts #466 und #390, nicht beide mergen |
| `WORK.md` | Index, Abschnitt „Soll“ | Kopf 11.10. behauptet keine offene Root-Lane | die offenen Dateien dieser Tabelle fehlen im Soll-Block | NACHSCHÄRFEN | — | kein Bauauftrag |
| `WORK_IMPLEMENTIERUNG_OFFEN.md` | Ticket-Log | Sprint P1.1–P1.3 erledigt. Kopf 09.11. markiert Morning Briefing rot | historisch gemischt mit erledigten Ampeln | NACHSCHÄRFEN | — | offener Zeiger ist `WORK_MORNING_BRIEFING.md` |
| `WORK_IST_VS_SOLL.md` | Audit-Log bis Tip `4286b44f` | Abschnitt 3 sagt, es gebe keine Root-`Offen_` mehr | Log, nicht der Baum `ed1e98cd` | NACHSCHÄRFEN | — | nicht als Lückenliste verwenden |
| `WORK_KI_CHAT_BIG_PICTURE.md` | Big Picture statt Sektionsliste | `POST /api/chat` und `shared/chat-context.ts` | Prompt-Soll, keine zweite Route | NACHSCHÄRFEN | nein, solange der Chat nicht rechnet | eine Chat-Kette mit den Schema-Dateien |
| `WORK_KI_CHAT_ERROR.md` | 400-Zeichen-Limit auf `wachstumsthese` | Limit ist Budget, nicht 400 (`shared/chat-context.ts:161–173`, `:607–609`) | die beschriebene Sperre ist nicht mehr die Decke | ERLEDIGT | nein | nicht erneut auf 1000 festnageln |
| `WORK_KI_CHAT_LIMIT_ALL.md` | alle Fakten auf 1000 | dieselbe Budget-Kappung | festes 1000 ist nicht das Ist und nicht nötig | ERLEDIGT | nein | siehe ERROR |
| `WORK_KI_CHAT_SCHEMA.md` | neun Blöcke, KI-Antworten sichtbar | Kontext existiert. Porter-Begründung nur in Draft #467 | „KI-Antwort je Sektion“ nicht als Feld auf main | NACHSCHÄRFEN | nein | #430 und #467 nicht doppelt |
| `WORK_KI_CHAT_SCHEMA_UPDATE.md` | Thesis immer, dominante Klasse, keine 30-%-Schwelle | widerspricht `WORK_KI_CHAT_SCHEMA.md` §8 | welche Datei gilt, steht nicht im Code-Kommentar als Vertrag | NACHSCHÄRFEN | nein | die 30-%-Zeile in der Schema-Datei streichen, bevor jemand sie baut |
| `WORK_KOMBINATIONSKURS_AMPEL.md` | Ampel-Overlay Sektion 12 mit DCF/RSL | Ampel liegt auf dem Portfolio-Chart (`comboBands.ts`), nicht auf Sektion 12 | falsche Fläche | NACHSCHÄRFEN | nein, wenn nur Farbe | das Portfolio-Objekt nicht noch einmal bauen |
| `WORK_KOSTENUEBERSICHT.md` | Abos und Fixkosten | kein Endpunkt | kein Feature | NACHSCHÄRFEN | — | — |
| `WORK_MORNING_BRIEFING.md` | Briefing-Karten wie Country Macro Pulse | `BriefingModal` ist der dichte Drei-Spalten-Stand. `KeyEventCard` nur in `MacroPanel` | UI-Wiederverwendung, Payload muss zur Karte passen | BAUBAR | nein | Draft #180 HOLD. Nicht den Makro-Tab umbauen |
| `WORK_NVO_TECHNICAL_OVERRIDE.md` | Tech-Moat-Deckel | `bias.techMoatOverride` in `shared/bias-fixes.ts`, sichtbar in `SummarySection.tsx:374` | keine neue Route. Score ist schon angeschlossen | ERLEDIGT | bereits auf main. Formel nicht erneut öffnen | `WORK_SECTION_WEIGHTING_ADAPTIVE.md` nicht darüberlegen |
| `WORK_PEER_RELATIVE_VALUATION_BUGS.md` | Peer hinzufügen, Vorschläge, KI in derselben Tabelle | Add-Feld da. KI sitzt in `KiSideList`, nicht in der Score-Tabelle | Anzeige-Spalte | BAUBAR | nein, wenn Ø und Score bleiben | Drafts #462, #420, #353. Einen mergen |
| `WORK_PEER_SELECTION.md` | Default-Peers, User-Kontrolle, Cache | `peers2hop` in `analyze-route.ts:1298`, Add in `PeerComparison.tsx:527` | Autocomplete nicht auf main (Draft #311) | ERLEDIGT | nein | die Detail-Datei nicht als zweite Pipeline |
| `WORK_PEER_SELECTION_DETAILED.md` | dieselbe Pipeline plus Filter-Tabs | Kern wie oben. Tabs aus #291 laut Ampel auf main, hier nicht neu vermessen | überlappt die kurze Datei | NACHSCHÄRFEN | nein | nur Rest gegen die kurze Datei, nicht neu |
| `WORK_PODCAST_PIPELINE.md` | Rollen, regional, Voice | `POST /api/podcast/brief`, Panel im Researcher | Server-Audio nicht als sprechbare Datei auf main (Draft #435, #464) | NACHSCHÄRFEN | nein | eine Pipeline mit `WORK_PODCAST_PROMPT.md` |
| `WORK_PODCAST_PROMPT.md` | Prompt, RSI-Memory, Dual Placement | Prompt-Modul und Researcher-Button da | eigenes Memory und zweite Asset-Sektion nicht als eigene Kette belegt | NACHSCHÄRFEN | nein | nicht neben der Pipeline neu verdrahten |
| `WORK_RECESSION_EARNINGS_GROWTH_PLOT.md` | Gewinnwachstum im Rezessions-Chart | `RecessionGrowthSection` → `useRecessionGrowth` → `GET /api/recession/earnings-growth/:index` | keine | ERLEDIGT | nein | eine Route mit der Gap-Datei |
| `WORK_RECESSION_GROWTH_GAP.md` | Gap-Karten | `GET /api/recession/growth-gap/:index`, dieselbe Sektion | keine | ERLEDIGT | nein | Draft #468 ändert nur die Einheit Pp |
| `WORK_RECESSION_TA_CHART.md` | TA-Sektion wie Aktien-S12 | `RecessionTaSection` in `RecessionDashboard.tsx:194`, `registerRecessionTaRoute` | keine | ERLEDIGT | nein | nicht in die Aktien-Sektion 12 ziehen |
| `WORK_SCENARIO_CONE_STOCK.md` | Kegel nur Visualisierung | `scenarioConeFromAnalysis` in `TechnicalChart.tsx` | keine Server-Route, Client aus der Analyse | ERLEDIGT | nein | — |
| `WORK_SCORING_ADDITIONS_MSFT.md` | ob Ergänzungen in die 20 Sektionen gehören | kein Flag `scoringAdditions` auf main | Empfehlung, kein Feld | NACHSCHÄRFEN | ja vor jedem Score-Einbau | Draft #366 hält das Flag default aus |
| `WORK_SECTION_WEIGHTING_ADAPTIVE.md` | Gewichte der Sektionen, Deckel | nicht im Score-Pfad | würde `bias-fixes` ein zweites Mal verändern | BLOCKIERT | ja | nach `WORK_NVO_TECHNICAL_OVERRIDE.md`, das schon auf main liegt |
| `WORK_SECTORAL_MOAT_DAMPING.md` | Moat-Dämpfung und Heritage | keine Funktion dieses Namens | Score-Änderung ohne Feldvertrag | BLOCKIERT | ja | nicht neben der Sektions-Gewichtung |
| `WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md` | PE-10J, Ampel, Reverse-DCF für Sektoren | `GET /api/researcher/sector-pe`, Ampel `shared/sector-attr-band.ts` | Reverse-DCF für ETF/Sektor ohne eigene Route | NACHSCHÄRFEN | ja nur für den DCF-Teil, falls er ein Rating setzt | PE und Ampel nicht neu bauen |
| `WORK_SIMPLYWALLST_LEARNINGS.md` | Chat, Narrativ, Podcast, MCP | keine eigene Route | Duplikat der Chat- und Podcast-Specs | NACHSCHÄRFEN | wie die Ziel-Specs | nicht als viertes Chat-Ticket |

---

## Fachlichkeit und Robustheit der übernommenen Specs

### `Offen_WORK_CAPEX_SECTOR_MAP.md`

**Soll.** Blasen oder Heatmap, Größe = Capex TTM/FY in Mrd. USD oder YoY. Klick öffnet Top-Firmen. Sektor-Layer umschaltbar, 8–10 Sektoren, Prozent im Side-Panel. Quelle: FMP Capex plus Geographic Segments.

**Annahme, die der Code nicht trifft.** Die Spec verteilt Investment auf das Land, in dem es stattfindet (Taiwan = TSMC-Capex). Der Handler summiert den Capex der Top-Firmen **nach Firmensitz** und sagt das ausdrücklich: „Umsatz-Geosegmente hängen an der Firma und verteilen den Capex nicht um“ (`server/researcher-geo-map.ts:327`). Ein deutsches Autowerk in Mexiko bleibt bei Deutschland. Das ist eine andere Kennzahl als die Spec.

**Einheit.** `capitalExpenditure` wird per Absolutbetrag positiv (`server/researcher-geo-map.ts:254–256`), dann `convertFmpRowsToUsd` (`:253`). Das Feld heißt `capexUsd` (`:261`). Bei FX-Fehler bleibt die Originalwährung in diesem Feld, `reportedCurrency` zeigt die Quelle nur, wenn `_fxConverted` fehlt (`:261` mit `server/fmp.ts:904`). Market Cap der Screener-Schwelle ist USD, wie FMP sie liefert (`MIN_MARKET_CAP = 2_000_000_000`, `server/researcher-geo-map.ts:21`).

**Zeit.** Zwei FY-Zeilen (`fmpCashFlow(symbol, 2)`, `:252`). YoY nur, wenn beide Jahre eine Zahl haben (`:292`). `asOf` ist der Request-Zeitpunkt (`:325`), das Geschäftsjahr hängt an der Firma (`fiscalYear`).

**Score.** Kein Score. Freigabe nicht nötig.

**Kette.** `#/researcher` Tab capex → `Researcher.tsx:466` `GeoMapPanel` (kein eigener Hook; `apiRequest` aus `queryClient`, `GeoMapPanel.tsx:16` und `:231`) → `GET /api/researcher/geo-map?layer=capex|sector` (`server/researcher-geo-map-route.ts:403`) → `routes-register.ts:16–17` → `buildGeoMapCapex` (`server/researcher-geo-map.ts:316`) → FMP Screener + Cashflow + Geo-Segmente → Typen in `shared/geo-map.ts`, nicht in `shared/schema.ts`. Darunter hängt weiterhin `CapexPanel` an der LLM-Researcher-Antwort (`Researcher.tsx:489`, `CapexPanel.tsx:19`). Zwei Capex-Bilder auf einem Tab.

**Robustheit**

| Fall | Verhalten | Beleg |
|---|---|---|
| Fehlende Daten | Land `status: "n/a"`, Summe null, Note. Firma ohne Capex bleibt mit `capexUsd: null`. YoY null, nicht 0 | `shared/geo-map.ts:185`; `server/researcher-geo-map.ts:291`, `:9` |
| Fremdwährung / ADR | FX siehe oben. Fremdlisting am Sitz (z. B. `*.NE` bei US) fliegt aus dem Cache-Treffer und aus der Auswahl | `server/researcher-geo-map.ts:193–204`, `selectPrimaryListings` `:247` |
| Fehlende Jahre | Nur zwei FY. Fehlt das Vorjahr, ist YoY null. Ein Capex von 0 gilt als fehlend (`v !== 0`) | `server/researcher-geo-map.ts:252–262` |
| FMP-Budget | Kein `wouldExceedBudget` vor dem Fächer. 25 Länder × Top 6 × Cashflow und Geo-Segmente. `!resp.ok` wirft; das Land bekommt eine Note, die Firma fällt auf n/a. 402 ist nicht von „leer“ getrennt | `server/fmp.ts:72`, `:146–147`; `server/researcher-geo-map.ts:233`, `:284–291` |
| Leerer Cache nach Neustart | Datei `.cache/researcher` und SQLite `diskResearcherSet` (`researcher-geo-map-route.ts:40–107`). Beides liegt auf der flüchtigen Render-Platte. Kaltstart baut neu und trifft das Budget. TTL 24 h (`shared/geo-map.ts:11`) | Route `:348–361` |
| Harte Schwellen | Top 6, 2 Mrd. USD, feste 25 Länder (`shared/geo-map.ts:44–69`), Farbmitte 0,5 nur für die Skala (`shared/geo-map.ts:295`) | `server/researcher-geo-map.ts:20–21` |

**Urteil NACHSCHÄRFEN.** Die Kette ist da, deshalb nicht neu bauen. Die Spec beschreibt Geo-Capex, der Code beschreibt Sitz-Capex und kann Fremdwährung als USD führen. Bevor ein Folgeauftrag „fertig“ sagt, müssen diese beiden Sätze in der Spec oder im Tooltip stehen. Die Zahl „≥ 20 Länder“ ist die feste Liste (25), nicht `coverage.withData`.

### `Offen_WORK_RESEARCHER_CAPEX_MAP.md`

Dieselbe Capex- und Sektor-Kette, plus `layer=miner|gold|valuechain` (`GeoMapPanel.tsx:2–5`, `:46–50`; Route `:403–412`).

**Miner.** Blasen aus Standorten. Länderanteil der Hashrate bleibt n/a, weil Cambridge ohne Captcha HTTP 400 liefert (`shared/geo-map.ts:176`, Kommentar `GeoMapPanel.tsx:4`). Die Spec will 8–10 Regionen mit Hashrate oder MW und eine Liste MARA, RIOT, …. Der Netz-Breakeven aus `btc-miner.ts` ist nicht je Land angeschlossen. BTC-Kernformeln nicht anfassen.

**Gold-Layer.** USGS-Produktion, nicht die Firmen-AISC. Das ist die richtige Trennung zur Breakeven-Spec. `productionOz` der Firmen bleibt null (Spec §4).

**Dublette.** Capex und Sektor sind `Offen_WORK_CAPEX_SECTOR_MAP.md`. Ein Panel, eine Route. Ein zweites Ticket würde die Kette doppeln.

**Robustheit.** Capex wie oben. Miner ohne Länderquelle: beschriftetes n/a, keine aufgefüllte Prozentzahl (`shared/geo-map.ts:176`). Gold ohne Weltzeile oder Koordinate: n/a, keine Ersatzkoordinate (Spec §4, Builder `buildGoldMapLayer` in der Route `:407`).

**Score.** Nein.

**Urteil NACHSCHÄRFEN.** Dieselbe Sitz-gegen-Geo-Lücke und dasselbe FX-1. Der Miner-Layer erfüllt die Hashrate-je-Land-Annäherung nicht. Nicht neu bauen; die Schwester-Spec und diese Datei als ein Auftrag führen.

### `Offen_FUTURE_SOLL_IST.md` und `Offen_FUTURE_SOLL_IST_DETAIL.md`

**Soll.** Die Kurzfassung (11.10., Vergleichs-SHA `5849ed15`) und die Detail-Liste (Basis `29fdf1d5`, 233 Zeilen, Nachträge bis 01.11.) sind Inventare über `Future_1` … `Future_10` und `Future_Work.md`, keine einzelne User-Story.

**Dublette.** Die Detail-Datei sagt selbst, dass die Kurzfassung an mehreren Stellen überholt ist (Abschnitt „Wo `Offen_FUTURE_SOLL_IST.md` (11.10.) überholt ist“). Beide heißen weiter `Offen_`. Bauen aus der Kurzfassung würde Trends-Cache, Dividenden-Plot und Gold-MA50 noch einmal anlegen. Die Detail-Datei ist die jüngere, aber ihr „fehlt“ ist nicht `ed1e98cd`.

**Was auf diesem SHA schon eine Kette hat** (nicht neu bauen):

| Punkt | Kette |
|---|---|
| F9 Makro-Schicht | `RecessionDashboard.tsx:211` `MacroAdaptiveLayerCard` → `POST /api/macro/adaptive-layer` (`server/routes.ts:577–578`, `server/macro-adaptive-layer-route.ts:40`). `scoreSwitch` bleibt aus (`MacroAdaptiveLayerCard.tsx:39`) |
| F9-04 Lagerlücke | `InventoryDemandGapCard` `:210` → `GET /api/macro/inventory-demand-gap` (`server/routes.ts:547–548`) |
| F1-39 Dollarreserven | `DollarReserveShareCard` `RecessionDashboard.tsx:197` |
| Growth und TA | siehe die beiden Recession-Specs, die hier `ERLEDIGT` sind |
| FW-27 Bilanzen-Screener | `App.tsx:71` `/balance-screen` → `POST /api/balance-screen` (`routes-register.ts:74–76`) |
| Google-Trends-Cache | `server/cache/google-trends-cache.ts`, Last-Good. Retry-Varianten nur in Drafts #461, #371, #298 |

**Bewertungslogik.** Die Detail-Datei trennt Anzeige und Ersatz der Live-P. Die Kurzfassung mischt das. Alles, was Buffett-Zonen, CAPE-Zonen, Gold-GIS, Credit-Gate oder die regionale P ersetzt, steht in Tabelle B und braucht Philip. Autonom genannt sind Zusatzobjekte. Ein Folgeauftrag, der „Future_9 einbauen“ sagt, ohne `scoreSwitch: aus`, ändert die Rezessions-P.

**Währung und Stichtag.** Kein gemeinsames FX. FMP-Statement-Punkte laufen durch `convertFmpRowsToUsd` (`server/analyze-helpers.ts:585–588`) und erben das stille 1. FRED-Reihen sind Index oder Prozent mit eigenem `asOf`. Die Inventare nennen den Stichtag nicht je Punkt.

**Robustheit der Inventare selbst.** Sie legen kein Verhalten für n/a, ADR, fehlende Jahre, 402, leeren Cache oder Schwellen fest. Das liegt in den jeweiligen Handlern. Ein Bauauftrag aus der Zählung hat damit keinen Vertrag. Harte Schwellen, die Philip noch nicht freigegeben hat, stehen in Tabelle B (20-Jahres-Perzentil statt Zonen, Trends-Gewicht, Gold-GIS).

**Offene Drafts, die diese Dateien berühren und sich überlappen:** #375 adaptive Schwellen, #383 Makro-Gewichte, #422 Buffett-Regression (Score), #378 φ-Buffett, #461/#371 Trends, #379/#372 Gold-Zusatz, #315 Kostolany, #365 Sektorrotation im Rezessions-Dashboard. Nicht zwei Drafts zum selben Punkt mergen.

**Urteil beider Dateien: NACHSCHÄRFEN.** Die Detail-Datei ist die bessere Trennung, aber gegen `ed1e98cd` nicht aktuell genug für einen Bauauftrag. Die Kurzfassung nicht mehr als Soll verwenden. Score-Punkte bleiben gesperrt, bis Philip den einzelnen Punkt freigibt. Kein Sammel-PR.

### `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md`

**Soll.** Offizielle FMP-Segmente bleiben die Top-Ebene, Summe 100 %. Nicht ausgewiesenes (FSD, Optimus) wird eingerückt, Anteil **vom Eltern-Segment**, Badge Override. Ohne Basis: „nicht schätzbar“. Zusätzlich Perplexity-Footer entfernen.

**Ist.** Kein Supplement-Feld, keine Route, keine eingerückte Zeile. Segment-Umsatz kommt mit der Analyse und ist bereits FX-konvertiert, wo `convertFmpRowsToUsd` einen Kurs hatte (`server/analyze-helpers.ts:572–588`). PR #465 spricht Unterposten an und lässt sie in Produktion bei 0. Das ist nicht diese Spec und nicht gemergt.

**Annahmen.** Die Beispielzahlen (TSLA 73,3 %) sind ein Screenshot, keine Schwellen. Die Schätzlogik ist ein LLM-Range („−5 % bis +5 %“). Das ist kein Score, solange die Zahl nicht in TAM, DCF oder `bias` geschrieben wird. Die Spec sagt das nicht ausdrücklich für den Score-Pfad. Peer-Override ist eine andere UI (`PeerComparison`).

**Währung.** Ein Unterposten in Prozent des Elternteils ist einheitenfrei. Ein Dollarbetrag übernähme die Statement-Währung und damit das stille FX-1. Die Spec zeigt Dollar und Prozent nebeneinander, ohne Feldnamen.

**Zeit.** „Nächstes Jahr“ ist nicht an ein Geschäftsjahr oder einen Call-Stichtag gebunden.

**Robustheit (Soll der Spec, weil kein Handler existiert)**

| Fall | In der Spec | Im Code daneben |
|---|---|---|
| Fehlende Basis | „nicht schätzbar“, kein erfundener Top-Level-Anteil (Spec Z. 79–80) | kein Zweig, der das erzwingt |
| Fremdwährung / ADR | nicht genannt | Elternzahlen: `convertFmpRowsToUsd`, ADR-Map `server/fmp-adr-map.ts` für die Analyse, nicht für einen Unterposten |
| Fehlende Jahre | Wachstum nur aus Historie, sonst nicht schätzen | kein Jahres-Fallback |
| FMP-Budget | zusätzlicher LLM-Call, nicht im `wouldExceedBudget`-Zähler | `server/fmp.ts:146` gilt für Analyze, nicht für einen neuen Call |
| Leerer Cache | nicht genannt | Analyze-Cache L1/L2 würde ein neues Feld mitspeichern, wenn es in die Analyse-Response kommt. Das wäre ein Cache-Shape, kein Breaking der alten Keys, solange das Feld optional ist |
| Harte Schwellen | keine im Vertrag. Die TSLA-Prozente sind Beispiele | — |

**Score.** Freigabe nötig, sobald das geschätzte Wachstum ein DCF-, TAM- oder Score-Input wird. Reine Badge-Zeile: nein.

**Urteil NACHSCHÄRFEN.** Vor dem Bau fehlen der Response-Feldname, die Regel „Percent bleibt Percent, Dollar nur mit Währung nach FX“, und der Satz, dass nichts in den Score läuft. Der Perplexity-Satz ist ein eigener, kleiner UI-Punkt und trägt das Urteil nicht.

### `WORK_CHAT_PODCAST_MCP.md`

**§1 Verlauf.** Spec: Speicher pro User und Asset, New, Öffnen, Löschen, Verlauf an das LLM. Ist: `useChatHistory` (`client/src/hooks/useChatHistory.ts:55–98`) → `GET/PUT/DELETE /api/chat/history` (`server/chat-history-route.ts:169–194`, Registrierung `server/routes.ts:559–560`) → `Map` im Prozess (`:37`). Typen `shared/chat-history.ts`. Zusätzlich `sessionStorage`. Kein User, kein Supabase. Nach Neustart ist die Map leer (`sessions` lebt nur im RAM). Der Client kann einen Verlauf zeigen, den der Server nicht mehr hat. Draft [#469](https://github.com/1719842374/Aktienanalyst/pull/469) schließt die Lösch-Race, nicht den Speicher. Idle 60 Minuten (`shared/chat-history.ts:31–33`) ist eine harte Frist, kein Score.

**§2 Transkript.** `GET/POST /api/podcast-transcript/:symbol` (`server/podcast-transcript-route.ts:51–56`) und `PodcastTranscript.tsx`. Der Look (Drop-Cap, Serif) ist Frontend. Ohne Audiodatei gibt es nichts, worauf ein Zeitstempel springt. Das ist Anzeige, kein Score.

**§3 MCP.** Im Repo keine MCP-Client-Anbindung an `financialmodelingprep.com/mcp`. Die Spec legt den API-Key in die URL. Ein Modell, das `profile`, Statements und News selbst zieht, umgeht `wouldExceedBudget` (`server/fmp.ts:146`) und kann das Tagesbudget leeren. Podcast heute holt Daten über die bestehenden Server-Module (`server/podcast-sources.ts`), nicht über MCP.

**Fremdwährung.** Der Chat rechnet nicht selbst. Er gibt die Analyse weiter. Steckt darin ein stilles FX-1, wiederholt der Chat die falsche Einheit.

**Fehlende Daten.** Ohne Session-Header: `400` und `n/a — keine Chat-Session` (`chat-history-route.ts:171`). Fakten, die fehlen, werden im Kontext als n/a-Sätze gebaut (Beispiel Beat/Miss `shared/chat-context.ts:280`).

**Score.** Nein.

**Urteil NACHSCHÄRFEN.** §1 ist eine andere Speicherform als „pro User“. §3 ist ohne Budget-Deckel und ohne Key-Ablage nicht baubar. §2 kann als CSS folgen, ändert das Urteil der Datei nicht, solange §1 und §3 offen und widersprüchlich zum Ist sind.

### `WORK_CHAT_UPLOAD_CONNECTOR.md`

**Soll.** PDF/PNG/JPG und Whisper, Ablage pro Chat. Zweiter Teil: API-Key und `GET /api/scoring/:symbol`, `GET /api/analysis/:symbol`, `POST /api/podcast/:symbol`.

**Ist.** `POST /api/chat` nimmt Text (`server/chat-route.ts:201`). Kein Multipart, kein Voice, kein API-Key-Store. Podcast existiert als `POST /api/podcast/brief`, nicht als `/api/podcast/:symbol`. Die Analyse ist `POST /api/analyze`, nicht `GET /api/analysis/:symbol`. Ein Connector, der die drei Pfade neu erfindet, bricht die bestehenden Clients nicht, legt aber eine zweite Tür auf dieselben Scores.

**Warum blockiert.** Die Spec speichert Uploads „pro Chat“. Der Chat-Verlauf liegt im RAM (`server/chat-history-route.ts:37`). Die Render-Platte ist flüchtig. Ohne genanntes Object-Storage ist die Datei nach dem Neustart weg, und der Prompt zeigt auf eine Leiche. Voice (Whisper über OpenRouter) ist ein zweiter bezahlter Kanal ohne Budget-Zeile. Der Connector braucht eine Auth-Entscheidung, die es im Dashboard heute nicht gibt. `GET /api/scoring/:symbol` würde Ampel und Gates nach außen geben. Das ändert die Rechnung nicht, ist aber eine Veröffentlichung.

**Robustheit.** Für Upload, FX, fehlende Jahre, 402 und Schwellen gibt es keinen Handler. N/a-Verhalten ist nicht definiert. Ein leerer Cache nach Neustart löscht RAM-Chats und lokale Dateien.

**Urteil BLOCKIERT.** Zuerst Speicher und Auth benennen. Vorher ist ein Bauauftrag ein Schreibvorgang auf eine Platte, die den Deploy nicht überlebt.

### `WORK_DASHBOARD_FEATURES_2026-10.md`

Sechs Soll-Ketten. Ein Urteil für die Datei.

| Teil | Ist auf `ed1e98cd` | Score |
|---|---|---|
| §1 Jahrestabelle und Sankey | Statements in `FinancialStatements.tsx`, Sektion 4 `Dashboard.tsx:699`. Kein Sankey, keine 8–10-Jahres-Ansicht als eigene Tabelle im gelesenen Modul | Anzeige. Dollar über `convertFmpRowsToUsd` (`analyze-helpers.ts:585–588`), also das stille 1 |
| §2 Earnings-Marker | Chat setzt Beat/Miss auf n/a, wenn es nicht in der Analyse liegt (`shared/chat-context.ts:280`). Kein Marker-Layer | Anzeige. Draft #386 |
| §3 Peer-Kurslinie | Drei Fenster A/B/C existieren aus älteren TA-Specs. Keine zusätzliche Peer-Linie im Hauptchart | Anzeige. Dieselbe #386 sagt, keine zweite Peer-Linie |
| §4 Chat | `ChatWidget` `Dashboard.tsx:780` → `useDashboardChat` → `POST /api/chat`. Drag und Szenario-Override, der DCF, Gates und Ampel neu rechnet, sind Soll und nicht als Route belegt | **ja, Philip, bevor ein Override schreibt** |
| §4b Event in Sektion 17 | Politur aus #288 ist laut Ampel auf main. „Event fließt in den DCF“ ist eine Score-Änderung | **ja** |
| §4c alle Assets | Ein Widget, mehrere Kontexte in `shared/chat-context.ts`. Override je Asset nicht vorhanden | **ja**, sobald BTC-, Gold- oder Rezessions-Score neu gerechnet wird |
| §5 Custom Screener | `GET /api/screener` (`server/screener.ts:496`). Kein Custom-Filter auf main | Anzeige, solange nur die geladene Liste gefiltert wird. Draft #463 und #392 |

**Annahmen.** Beat = grün, Miss = rot, Inline = grau ist eine feste Farbschwelle. Die Spec sagt nicht, ab welchem Surprise-% „Inline“ gilt. Peer-Linie „normalisiert oder absolut“ ohne Formel. Sankey-Beispiel MSFT FY2026 ist eine Illustration, keine zu treffende Zahl.

**Zeit.** Jahres-Tabelle: FMP `period=annual`, Stichtag = `date` der Zeile. Earnings-Marker: Datum der Meldung. Beides nicht im Code dieser Spec.

**Robustheit der vorhandenen Stücke**

| Fall | Verhalten |
|---|---|
| Fehlende Daten | Chat: n/a-Satz statt erfundenem Beat (`chat-context.ts:280`). Statements: bestehende n/a-Pfade der Analyse, hier nicht neu spezifiziert |
| Fremdwährung / ADR | Statements: `convertFmpRowsToUsd` plus ADR-Map der Analyse. Ein Sankey, der die Zeilen nur zeichnet, zeigt den FX-Fehler als USD |
| Fehlende Jahre | Spec will 8–10 Jahre. FMP liefert, was der Plan hergibt. Kein Vertrag, kürzere Historie als n/a-Spalten zu zeigen |
| FMP-Budget | Ein zusätzlicher `/stable/earnings-surprises`-Call je Chart-Toggle ist nicht im Analyze-Budget. Kalt und für jeden Peer noch einmal |
| Leerer Cache | Analyze L1/L2 kommt nach Neustart von der flüchtigen Platte. Der Chart hätte dann keine Surprise-Serie, bis neu geladen wird. Die Spec sagt dazu nichts |
| Harte Schwellen | Farbregeln Beat/Miss ohne Prozentgrenze. Chat-Kontext: Budget 40 000 Zeichen, nicht die alten 400 (`chat-context.ts:173`) |

**Urteil NACHSCHÄRFEN.** Die Datei ist sechs Aufträge. §4, §4b und §4c dürfen nicht gebaut werden, solange ein Override DCF, Gates oder Ampel schreibt, ohne Freigabe und ohne Flag default aus. Die Anzeige-Teile (Tabelle, Marker, Peer-Linie, Screener-Filter) sind je für sich baubar, aber nicht als ein PR und nicht, bevor Beat/Inline und die FX-Beschriftung festliegen. Drafts #465/#394 (Statements), #386 (Chart), #463/#392 (Screener) nicht kreuzen.

---

## Architektur der übrigen Specs

### `Offen_WORK_BUFFETT_ASIA_10Y.md`

§1. Soll seit 01.11. nur das Rezessions-Dashboard. Ist: `RecessionDashboard.tsx:196` `<BuffettRatioPanel />` → `fetch /api/analyze-recession/buffett?region=` (`BuffettRatioPanel.tsx:366`) → `server/buffett-route.ts:643`, registriert `routes-register.ts:31–32`. `Dashboard.tsx` importiert die Aktien-Karte nicht. Negativtest `script/test-buffett-stock-card.ts:84`. Die Komponente `BuffettMacroCard.tsx:20` bleibt im Baum.

§3. Nominal `GET /api/treasury-10y/market` (`server/treasury10y-route.ts:104`, `routes-register.ts:50–51`, FRED `DGS10`, `shared/treasury10y.ts:16`). Real `useMarketReal10Y` → `GET /api/analyze-btc/real10y-history` (`client/src/lib/useMarketReal10Y.ts:11–12`, `server/btc-routes.ts:67`, FRED `DFII10`). Beide Chips in `TechnicalChart.tsx:239–251` und `:878–885`. Philip hat Real 10J als ausreichend erklärt. Die nominale Linie ist zusätzlich da. Nichts neu bauen.

§2. Lücke. `buildRegionCatalogs` endet bei `region("JP", "Japan", jp)` (`server/recession-regions.ts:494–497`). Die Gewichte mischen diese JP-P in `blendedRecession12m` (`:498–501`). Das UI-Label ist „Asien (Japan)“ (`client/src/components/recession/RegionGaugeSwitch.tsx:10`). ASHR existiert in den Markt-Charts (`shared/recession-market-charts.ts`, `RegionRsiPanel.tsx:69`) und ist nicht dieses Aggregat. Drafts [#470](https://github.com/1719842374/Aktienanalyst/pull/470), #413, #377. Nur einen mergen. Eine neue Region-Id statt `JP` bricht Clients, die `regions[]` fest auf drei Ids lesen. Die aggregierte P ist eine andere Zahl als die bisherige Japan-P. Dafür die Freigabe, auch wenn die Technik sonst klar ist.

**Urteil BAUBAR** für den Rest §2, additiv und mit Freigabe, sobald die Antwort die alten Ids weiterführt oder die neue Id benennt. §1 und §3 nicht anfassen.

### `Offen_WORK_GOLD_MINER_BREAKEVEN.md`

Kette wie in der Spec: `server/data/gold-aisc.json` → `shared/gold-aisc.ts` → `server/gold-routes.ts` setzt `aiscZone` (`:916`) neben `aiscLine` → `shared/gold-schema.ts:313` optionales Feld → `GoldDashboard.tsx:54` `useQuery(["/api/analyze-gold"])` → Sektion 9 `GoldDashboard.tsx:239`. Kein neuer Endpunkt. Offline-Fallback ohne Zone. `inScore: false`. BTC-Dateien nicht in diesem Pfad. Die Faktoren 1,10 und 1,15 liegen noch in `shared/gold-aisc.ts:66–67` und werden von Sektion 9 nicht als Zonengrenze benutzt. Euphorie ≥ P90 ist ein Typ-Slot ohne Zone. Das ist eine offene Produktfrage, keine Lücke in der Kette.

**Urteil ERLEDIGT.** Nicht neu bauen.

### Buffett-Formel-Dateien

`WORK_BUFFETT_OVERLAYS.md` ist durch die beiden Linien in §3 erledigt.  
`WORK_REMOVE_BUFFETT_STOCK.md` ist erledigt.  
`WORK_BUFFETT_ADAPTIVE_SOLUTION.md`: die Regression ist nicht auf main. #422 will sie in den Score, #375 nur als Zusatzobjekt. Ohne diese Wahl **NACHSCHÄRFEN**. Freigabe, wenn die Live-P wechselt.  
`WORK_BUFFETT_ADJUST_IMPL.md`: Sektor-Faktor und Realzins-Faktor gibt es nicht. Dieselbe Quote würden auch Adaptive Solution und Realzins-Adjust beschreiben. **BLOCKIERT**, bis eine Datei übrig ist und Philip die Score-Änderung freigibt.  
`WORK_BUFFETT_WEIGHT_DISTORTION.md`: Text ohne Endpunkt. **NACHSCHÄRFEN**.  
`WORK_REALZINS_ADJUST.md`: die Serie existiert (DFII10), die Anwendung auf die Buffett-Quote nicht. **NACHSCHÄRFEN**. Freigabe bei Anwendung auf die Quote.

Schema heute: die Buffett-Response bleibt die bestehende Route. Ein Zusatzobjekt ist kein Bruch. Ein Ersetzen der Zonen ändert die Bedeutung der Felder, die das Dashboard als Zone liest.

### Earnings Yield, Rezession, Kegel, Peers, Podcast, NVO

Earnings Yield und ROIC: `server/routes.ts:567–568` registriert `server/earnings-yield-roic-route.ts:682` und `:687`. Typen re-exportiert `shared/schema.ts:1193–1200` aus `shared/earnings-yield-roic.ts`. Chart-Chips `TechnicalChart.tsx:903`. Beide WORK-Dateien beschreiben diese eine Kette. **ERLEDIGT.**

Growth: `server/routes.ts:549–551`, `useRecessionGrowth.ts:8`, UI `RecessionGrowthSection.tsx:102`, Mount `RecessionDashboard.tsx:212`. Plot und Gap sind zwei GETs, eine Sektion. **ERLEDIGT.** #468 ändert nur die Einheit der Differenz auf Pp.

TA: `registerRecessionTaRoute` in `routes-register.ts:29–30`, UI `RecessionDashboard.tsx:194`. **ERLEDIGT.**

Kegel: Client `TechnicalChart.tsx` importiert `scenarioConeFromAnalysis`. Keine neue Route, kein Score. **ERLEDIGT.**

Peers: Add `PeerComparison.tsx:527`. 2-Hop `server/analyze-route.ts:1298–1302`. KI-Zeilen `KiSideList` (`PeerComparison.tsx:170–177`), nicht die Score-Tabelle. **BAUBAR** als reine Anzeige (#462). Die kurze Selection-Spec ist damit **ERLEDIGT**. Die Detail-Spec **NACHSCHÄRFEN**, weil sie dieselbe Pipeline noch einmal beschreibt. Autocomplete nur Draft #311.

Podcast: `routes-register.ts:68–71`, Button im Researcher `Researcher.tsx:117` und `:378`. Hörbare Datei nicht auf main. **NACHSCHÄRFEN** für Pipeline und Prompt gemeinsam.

NVO-Override: schon im Bias und im Fazit (`SummarySection.tsx:374–380`). **ERLEDIGT** als Verdrahtung. Die Formel nicht in einem neuen PR aufmachen.

### Score-Sperren und der Rest

`WORK_SECTION_WEIGHTING_ADAPTIVE.md` und `WORK_SECTORAL_MOAT_DAMPING.md`: kein Feld, beide würden den Gesamtscore ändern, beide lägen auf `shared/bias-fixes.ts` neben dem schon aktiven Override. **BLOCKIERT** ohne Freigabe und ohne ein Flag, das default aus ist (Muster Draft #366, nicht auf main).

`WORK_SCORING_ADDITIONS_MSFT.md`: Empfehlungstext. **NACHSCHÄRFEN.** Freigabe vor dem Einbau.

`WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md`: PE-Route `server/routes.ts:571–572`, Hook `useSectorPeDisplay` in `SectorRotationPanel.tsx:585`, Ampel `shared/sector-attr-band.ts`. Reverse-DCF für den Sektor hat keine Route in `routes-register.ts`. **NACHSCHÄRFEN** nur für diesen dritten Teil. Freigabe, wenn daraus ein Rating wird.

`WORK_HYBRID_CLASSIFICATION.md` und `WORK_HYBRID_XPENG.md`: kein Zweit-Sektor. XPEV steht in `CURATED_PEER_FALLBACK` (`server/news-peers.ts:117`). **NACHSCHÄRFEN.** Freigabe, wenn die Klasse den Score wählt.

`WORK_HYPECYCLE_EMAIL_SUPABASE.md`: `POST /api/attraktiv-notify` gibt `sent: false` zurück und ruft weder Mail noch Supabase (`server/attraktiv-notify-route.ts:1–23`). Hype-Proxy nur in #466 und #390. **NACHSCHÄRFEN.**

`WORK_KOMBINATIONSKURS_AMPEL.md`: Portfolio `PortfolioPerformanceChart.tsx` nutzt `comboBands.ts`. Die Spec nennt Sektion 12 und `getAmpelStatus` mit DCF und RSL. **NACHSCHÄRFEN.**

`WORK_MORNING_BRIEFING.md`: **BAUBAR** als UI. Daten `POST /api/researcher/daily-briefing` (`server/researcher.ts:1497`, Client `Researcher.tsx:138`). Soll-Karten `MacroPanel.tsx:92` und `:187`. Ist-Modal `Researcher.tsx:515` mit `topChanges` (`:591`). #180 nicht mergen, bis die Payload-Felder der Karte entsprechen. Kein Score.

`WORK_KI_CHAT_ERROR.md` und `WORK_KI_CHAT_LIMIT_ALL.md`: die 400-Zeichen-Sperre ist nicht mehr die Decke. `CHAT_LIMITS.maxContextChars` ist 40 000, Fakten hängen am Budget (`shared/chat-context.ts:161–173`). **ERLEDIGT.** Nicht auf ein festes 1000 zurückdrehen.

`WORK_KI_CHAT_SCHEMA.md`: **NACHSCHÄRFEN**, KI-Antworten je Sektion fehlen als belegtes Feld. #467 reicht vorhandene Porter-Texte durch und ist nicht gemergt.  
`WORK_KI_CHAT_SCHEMA_UPDATE.md`: widerspricht der 30-%-Bedingung in der Schema-Datei. **NACHSCHÄRFEN**, bis eine Datei gilt.  
`WORK_KI_CHAT_BIG_PICTURE.md`: Prompt auf derselben Route. **NACHSCHÄRFEN** nur als Text, nicht als neue API.

`WORK_GURUFOCUS_METRICS_ASSESSMENT.md`, `WORK_KOSTENUEBERSICHT.md`, `WORK_SIMPLYWALLST_LEARNINGS.md`, `WORK.md`, `WORK_IMPLEMENTIERUNG_OFFEN.md`, `WORK_IST_VS_SOLL.md`: keine bau-baren Endpunkte. Die drei Index-Dateien beschreiben einen älteren Tip und behaupten stellenweise, es gebe keine offenen Root-Specs. **NACHSCHÄRFEN** heißt hier: nicht als Auftragsquelle verwenden.

Breaking, das diese übrigen Specs anrichten würden, wenn man sie naiv baut: Region-Id `JP` tauschen, Buffett-Zonenfelder umdeuten, `scoringAdditions` default an (L2-Cache der Analyse würde andere Scores halten), neue Pflichtfelder in `POST /api/analyze`. Alles andere in dieser Liste ist additiv oder schon da.

---

## Bau-Reihenfolge

Nicht anfassen, die Kette liegt: Gold-Breakeven, Buffett §1 und §3, Remove-Buffett, Earnings-Yield/ROIC, Growth-Plot und Gap, Rezessions-TA, Szenario-Kegel, NVO-Override, Peer-Default (2-Hop und Add), die 400-Zeichen-Chat-Sperre, Future-Punkte mit der Kette in der Tabelle oben.

1. **Morning Briefing** (`WORK_MORNING_BRIEFING.md`) auf der bestehenden Briefing-Route, Karten aus `MacroPanel` wiederverwenden. Kein Score. #180 prüfen, nicht daneben neu öffnen.
2. **KI-Peers in die vorhandene Tabelle** (`WORK_PEER_RELATIVE_VALUATION_BUGS.md`), nur Anzeige. Einen der Drafts #462 / #420 / #353.
3. **Asien-Katalog** (`Offen_WORK_BUFFETT_ASIA_10Y.md` §2) erst nach Freigabe der aggregierten P. Einen der Drafts #470 / #413 / #377. Alte Region-Ids behalten oder den Bruch nennen.
4. **Capex-Karten nicht neu bauen.** Ein Nachschärfen-Text: Sitz statt Geo-Capex, und USD nur wenn `_fxConverted` gesetzt ist (`convertFmpRowsToUsd` / #474). `Offen_WORK_CAPEX_SECTOR_MAP.md` und `Offen_WORK_RESEARCHER_CAPEX_MAP.md` sind ein Panel.
5. **Dashboard-Anzeige einzeln**, jeder Draft für sich: Jahrestabelle #465 oder #394, Earnings-Marker und Peer-Linie nicht gegen den Satz in #386, Screener-Filter #463 oder #392. FX-Beschriftung mitziehen. §4/§4b/§4c nicht in diese PRs.
6. **Chat-Verlauf** nur die Race #469. Kein zweiter Store, kein MCP, kein Upload.
7. **Hype-Proxy** nur als Anzeige, einer von #466 und #390. Mail bleibt `sent: false`, bis ein Store und ein Konto da sind.

Gesperrt, bis Philip den einzelnen Punkt freigibt und nur eine Spec übrig ist: Buffett-Adjust, adaptive Zonen als Ersatz der Live-P, Sektions-Gewichte, sektorale Moat-Dämpfung, Scoring-Additions in den Live-Score, Hybrid-Klasse als Score-Wahl, Chat-Override auf DCF/Gates/Ampel, Event in den DCF, Future-Tabelle B.

Blockiert an der Plattform: `WORK_CHAT_UPLOAD_CONNECTOR.md`, solange Dateien auf der flüchtigen Platte landen würden.

---

## Top-Befunde

Die meisten offenen Dateien sind keine leeren Baustellen. Earnings Yield, Rezessions-Wachstum, Rezessions-TA, Gold-AISC, Buffett im Rezessions-Panel, der 10J-Overlay und der Tech-Moat-Override haben eine Kette auf `ed1e98cd`. Ein Auftrag, der diese Dateinamen als „fehlt“ liest, baut sie doppelt.

Die Capex-Karten sind angeschlossen und rechnen etwas anderes als die Spec: Firmensitz der Top 6 statt Capex am Investitionsort. Fällt der FX-Kurs aus, bleibt die Landeswährung im Feld `capexUsd`. Das ist der strengere Befund gegenüber „Kette existiert“.

`Offen_FUTURE_SOLL_IST.md` und die Detail-Datei sind dasselbe Inventar in zwei Altern. Die Detail-Datei ist die jüngere und gegen diesen SHA trotzdem zu alt, um eine Lücke zu beweisen. Score-Ersatz und Anzeige liegen darin ineinander. Nur Tabelle B plus ein frischer Abgleich gegen `ed1e98cd` ist ein Auftrag, und auch dann Punkt für Punkt.

`WORK_DASHBOARD_FEATURES_2026-10.md` mischt harmlose Chart-Marker mit einem Chat, der DCF, Gates und Ampel überschreiben soll. Das zweite braucht Philip und ein Flag, das default aus ist. `WORK_CHAT_UPLOAD_CONNECTOR.md` hat keinen dauerhaften Speicher. `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` hat keinen Feldnamen und würde Dollar aus dem stillen FX-1 erben, sobald aus dem Prozent ein Betrag wird.

Die drei Index-Dateien `WORK.md`, `WORK_IMPLEMENTIERUNG_OFFEN.md` und `WORK_IST_VS_SOLL.md` sind Ampel-Logs. Sie sind nicht die Liste der offenen Specs auf diesem SHA.
