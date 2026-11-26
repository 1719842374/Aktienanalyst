# Entwurf: KI-Podcast-Button (Ideengenerierung)

Stand der Prüfung: 26.11.2026. Nur Dokumentation. Kein Produktcode, kein Score, kein Rating, kein Entry, kein Merge auf `main`.

**main-SHA:** `0247d57bd00ff456318a5e8427b1143c8513b829` (`ci: Sperre DCF_CALIBRATION.enabled auf false`, #526).

**Slot ist entschieden** (C4, Philip 26.11.2026 13:10 Europe/Madrid, über den Stabschef): auf dem Desktop rechts neben der g*-Zeile, auf Mobile per Flex-Wrap darunter. Look und Bau warten auf den Designer-Mock und Philips OK.

Live-Check NVDA, Render-Prod, 26.11. gegen 12:58 Europe/Madrid, plus Layout-Nachtrag Idea-Inverter 12:59: im Kopf gibt es keinen eigenen Button „KI-Analyse“. Die g*-Zeile steht unter der Ampel. Der Player nutzt Flex-Wrap und keinen festen Breakpoint.

---

## A. Git und offene PRs

### Historie seit 19.11.2026

Auf `main` liegt seit #393 (Commit `9d0ffb4b`, 01.11.2026) ein **Markt-Podcast** des Researcher (`POST /api/podcast/brief`, Symbol `MARKT`). Seit 19.11.2026 kam dazu kein Podcast-, TTS- oder Audio-Commit. Die Commits seit dem 19.11. betreffen Doku, den Revert #520 und die Sperre `DCF_CALIBRATION.enabled = false` (#526). `speechSynthesis` kommt im Produktcode von `main` nicht vor (`script/test-segment-statements-rest.ts` verbietet das Wort in Section 2).

### Was der Markt-Podcast ist und was er nicht ist

| Auf main | Pfad | Rolle |
|---|---|---|
| Route | `server/podcast-route.ts` `registerPodcastRoute`, `POST /api/podcast/brief` | Key-Driver-Skript für den Markt, kein Einzeltitel |
| Audio | `server/podcast-audio.ts` `CursorVoiceAudioAdapter` | Liefert immer `audioUrl: null`. Cursor Voice hat keinen dokumentierten TTS-Endpoint (Kommentar Stand 01.11.2026) |
| Cache | `shared/podcast-transcript.ts` `podcastCacheKey` → `podcast_transcript__${symbol}`, TTL 7 Tage, nur Symbol | Nicht Hash der Zahlen, nicht Stimme |
| UI | `client/src/pages/Researcher.tsx` `data-testid="button-podcast"`; `PodcastProbePanel` | Researcher-Kopf, nicht die Aktien-Ampel |

Diesen Pfad nicht zum Aktien-Button ausbauen. Anderes Publikum, anderer Cache, das Modell darf dort Zahlen in Prosa schreiben (`server/podcast-prompt.ts`).

### Offene PRs, die spätere Baudateien berühren

#435 und #464 bleiben offen, nicht mergen (Philip 26.11.2026 13:11). Grund: Philip kann nicht beurteilen, ob dort OpenRouter benutzt wurde, und der Player saß dort an der falschen Stelle. Die übrigen Zeilen nicht mergen und nicht als Ist behandeln.

| PR | Bezug | Folge für diesen Entwurf |
|---|---|---|
| [#435](https://github.com/1719842374/Aktienanalyst/pull/435) `cursor/stock-podcast-player-a101` | Aktien-Player, Piper, `POST /api/stock-podcast/:symbol`, Browser-Fallback. Skript lässt das Modell Zahlen schreiben. Cache-Key ist Ticker+Quartal, nicht der Hash der Kennzahlen. Liegt in Section 2, nicht an der g*-Zeile | Bleiben offen, nicht mergen (Philip 26.11.2026 13:11). Grund: Philip kann nicht beurteilen, ob dort OpenRouter benutzt wurde, und der Player saß dort an der falschen Stelle |
| [#464](https://github.com/1719842374/Aktienanalyst/pull/464) `cursor/podcast-browser-speech-428a` | `speechSynthesis` für den Researcher-Podcast | Bleiben offen, nicht mergen (Philip 26.11.2026 13:11). Grund: Philip kann nicht beurteilen, ob dort OpenRouter benutzt wurde, und der Player saß dort an der falschen Stelle |
| [#475](https://github.com/1719842374/Aktienanalyst/pull/475) | `ExecSummaryCard.tsx`, `server/exec-summary.ts` | Gleicher Slot wie der Player. Vor einem Bau gegen den dann aktuellen `main` lesen |
| [#491](https://github.com/1719842374/Aktienanalyst/pull/491), [#492](https://github.com/1719842374/Aktienanalyst/pull/492) | Section 2, #492 zusätzlich `Dashboard.tsx` und ein noch nicht auf `main` liegendes `server/segment-gap-route.ts` | Segment-Lücken sind nicht die Umsatzquelle des Podcasts |

Weitere offene PRs (Auszug 26.11., `gh pr list`): #522, #517, #516, #515, #514, #498, #497, #496, #495, #488, #484, #480, #478, #477, #476, #474, #473, #470, #467, #466, #463, #461, #448, #439, #434, #432, #431, #430, #425, #422, #420 und ältere. Sie ändern die g*-Zeile oder den Podcast-Slot auf `main` nicht. #430 (KI-Chat, Earnings-Brief) ist offen und beschreibt denselben FMP-Transkript-Pfad, der auf `main` schon in `server/chat-earnings-route.ts` liegt.

---

## B. Ist auf main

### B1. Ampel und g*-Zeile

Die Zeile aus dem Live-Check (`NVDA · 149,3 · g* 11.4 % (WACC 14.1 %) · Call 24.02.2027`) ist `execSummary.headline`.

Aufbau, `server/exec-summary.ts` `buildExecSummary` (Zeilen 373–384):

`ticker · formatierter Kurs · scoreCapped falls endlich · g* x,x % (WACC x,x %) falls g* endlich · Call-Kurzdatum oder „Call n/v“`.

`formatEarningsCall` (Zeilen 133–159): fehlendes oder ungültiges Datum wird `Call n/v`, nicht weggelassen. WACC fehlt in der Klammer, wenn `waccPct` nicht endlich ist (Zeile 382). `scoreCapped` steht nur dann in der Zeile, wenn `scoring.scoreCapped` oder `analysis.scoreCapped` endlich ist (`server/exec-summary-attach.ts` Zeile 107). Die NVDA-Zeile vom 26.11. enthält keine Score-Zahl; der Code lässt sie weg, wenn sie fehlt.

Render, `client/src/components/ExecSummaryCard.tsx`:

| Stück | Zeilen | Props / Klassen |
|---|---|---|
| Karte | 35–43, 100 | Props `data: StockAnalysis`, optional `sharedMonteCarlo`. `SectionCard number={1}` |
| Kartenrumpf | `SectionCard.tsx` 17–20, 51 | `overflow-hidden` auf der Karte. Inhalt `px-4 pb-4 space-y-4` |
| Ampel | `ExecSummaryCard.tsx` 103–109 | `flex items-center justify-between gap-2` plus `fazit.ratingBg`. Links „Ampel (S17)“, rechts `data-testid="exec-summary-ampel"` = `fazit.rating` |
| g*-Zeile | 111–114 | Ein `<p className="font-semibold text-foreground tracking-tight">`, `data-testid="exec-summary-headline"`. Kein Flex, kein Grid, kein `truncate`, kein `whitespace-nowrap`, kein Breakpoint |
| Hinweis direkt darunter | 116–118 | `data-testid="exec-summary-mode"`, `text-[11px] text-muted-foreground`. Text `bias.modeLabel`, sonst `s.modeLine` |

`STARK UNATTRAKTIV` ist der Ampel-Text, nicht die g*-Zeile. `client/src/lib/fazit-signal.ts` `buildFazitSignal` Zeilen 325–339: `positive.length - negative.length <= -4` setzt Rating, Farbe `text-red-500`, Hintergrund `bg-red-500/10 border-red-500/30`. Dieselbe Funktion liefert die Ampel. `shared/bias-fixes.ts` `overallRatingFromScore` (Zeilen 276–281) ist eine andere Skala und steht laut Kommentar in Zeile 104–106 bewusst nicht in dieser Ampel.

`Katalysatoren: generisch (Sektor)` kommt aus `catalystsModeLabel` (`shared/bias-fixes.ts` 268–273), wenn `catalystsSource !== "llm"`. Mit LLM: `Katalysatoren: KI-firmenspezifisch (Stand: …)`. Das ist der Hinweis unter der g*-Zeile, nicht ein eigener KI-Button.

Eltern der drei Blöcke ist `space-y-3` (Zeile 101): Ampel, g*-Absatz und Hinweis stehen untereinander über die volle Inhaltsbreite. Der Absatz ist ein Block. Der freie Raum rechts neben dem Text (Live-Check: bei 1920 px etwa 1200 px, bei 500 px etwa 60–70 px) ist ungenutzte Zeilenbreite **innerhalb** dieses Blocks, kein leeres Flex-Kind. Bei 375 px bricht der Absatz selbst um, weil er weder `nowrap` noch `truncate` hat. Ein Player als Geschwister existiert nicht. **Flex-Wrap der bestehenden Zeile allein nimmt den Player nicht auf.**

Dashboard-Montage: `client/src/pages/Dashboard.tsx` Zeile 694, `ExecSummaryCard`, wenn `data` kein ETF/Fonds ist. Der Sticky-Streifen Zeilen 684–688 ist nur der Ladehinweis beim Neuanalysieren.

### B2. Was im Kopf „KI“ ist

Im Kopfbereich gibt es keinen Button mit dem Text „KI-Analyse“. Live sichtbar und im Code:

1. **Toolbar „KI“.** `Dashboard.tsx` Zeilen 514–544, `data-testid="button-llm-toggle"`. Klick kippt `useLLM` und ruft `startAnalyze({ ticker, llm })` auf. Das ist `useMutation` Zeilen 206–217: `apiRequest("POST", "/api/analyze", …)`. Modell der Katalysator-/News-Runde: `server/llm-openrouter.ts` `pickModel` Zeilen 40–44, Default `anthropic/claude-haiku-4.5`, Fallback-Kette Zeilen 51–55. Cache-Key der Analyse: `buildAnalyzeCacheKey` in `server/peer-cache-key.ts` Zeilen 36–39, Form `analyze:TICKER:llm:0|1` plus Peer-Overrides. L1 20 Minuten (`analyze-route.ts` Zeile 193), L2 sieben Tage (`server/disk-cache.ts` `CACHE_TTL_DAYS`). Es gibt keine `promptVersion` auf diesem Key.
2. **Schwebender KI-Chat.** `ChatWidget`, Mount `Dashboard.tsx` Zeilen 780–788. Geschlossen: `fixed bottom-4 right-4 z-40` (`ChatWidget.tsx` Zeilen 114–124, `data-testid="chat-launcher"`, Label „KI-Chat“). Hook `useDashboardChat` (`client/src/hooks/useDashboardChat.ts` Zeilen 18–33) sendet erst beim Absenden `POST /api/chat` (`server/chat-route.ts` Zeile 201). Der Kontext ist der schon geladene Analyse-Stand (`buildStockChatContext` plus Earnings-Brief), kein neuer Score.
3. **Hinweis unter der g*-Zeile.** Siehe B1, `exec-summary-mode`.

Weiter unten, nicht im Kopf, gibt es Buttons mit dem Text „KI Analyse“: `Section8.tsx` Risiko (`POST /api/risk-explanations`), `CatalystsSection.tsx` (`POST /api/catalyst-enrich`), `PolicyContextPanel.tsx` (`POST /api/policy-context`). Die liefern Zusatztexte für ihre Sektion. Sie sind nicht die Quelle der g*-Zeile und nicht der Podcast-Auslöser.

### B3. Welcher Text schon auf dem Client liegt

Nach `POST /api/analyze` (der Lauf, der die Seite füllt) liegt `StockAnalysis` inklusive `execSummary` auf dem Client. `attachExecSummary` baut Pro, Contra, Fazit, CRV-Satz und die g*-Zeile **ohne** zweiten Klick aus den schon gerechneten Feldern.

| Podcast-Inhalt | Feld auf dem Payload | Liegt ohne Extra-Klick | Fehlt |
|---|---|---|---|
| Einstieg, Datenstand | `dataTimestamp`, `_cachedAt`, `_cacheAge`, `currency` | ja | — |
| Ampel-Wort | `execSummary` plus client `buildFazitSignal` | ja, Anzeige clientseitig aus dem Payload | — |
| Score-Zahl in der Zeile | `scoring.scoreCapped` | nur wenn der Server sie gesetzt hat | sonst nicht in der Zeile |
| g*, WACC | `impliedGStar`, `scoring.gateInputs.impliedGrowthPercent`; WACC über `safeCompanyDcfWaccPct` / DCF-Parameter | g* serverseitig; die angezeigte WACC rechnet Section 5 mit `calculateFCFFDCF` | Podcast darf nur den angezeigten Wert sprechen |
| DCF fair | `dcfFairValue` | ja, sonst null und `dcfNaReason` | keine fertige Spanne auf dem Payload |
| Entry, CRV | `maxEntryCrv3`, `crvBase`, `crvRiskAdj` (`analyze-route.ts` etwa 2372–2374) | ja, wenn die Server-CRV-Rechnung lief | — |
| These | `growthThesis` | **nur wenn `useLLM` beim Analyze wahr war** (`analyze-route.ts` 1546–1580). Sonst null | nicht per Podcast-Klick nachladen |
| Pro/Contra | `execSummary.pro`, `execSummary.contra` | ja, auch im generischen Modus | Länge ist nicht ausgeglichen |
| Inversion | Section 8 rechnet `invertedDcf` clientseitig aus `data`; Serverfeld `invertedDcf` kann im Exec-Input stehen | die Funktion existiert (`shared/valuation-signal.ts` `invertedDcf`) | Podcast-Kapitel existiert nicht |
| S17-Katalysatoren | `catalysts[]` (`name`, `pos`, `gb`, `timeline`, `context`) | ja. KI-Text in `context`/`deepDive` nur nach LLM bzw. `/api/catalyst-enrich` | — |
| Umsatz, Quartal gegen Vorjahresquartal | kein Feld auf `StockAnalysis` | — | Die Quartalszeilen laufen in `analyze-route.ts` 1655–1668 (`fmpIncomeStatementQuarterly`) und werden zu `quarterlyRevenueChronological` (nur Zahlen, ohne Datum) für `calcRealizedGrowth8QServer` (`server/scoring-integration.ts` 111–137). Auf dem Payload bleibt `scoring.gateInputs.realizedGrowth8QPercent` plus `realizedGrowthMethod` (`yoy_8q` oder `qoq_annualized`) und `realizedGrowthQuartersUsed` (`shared/schema.ts` 589–593). Das ist die Summe der letzten vier Quartale gegen die vier davor, oder ein annualisiertes Quartal-zu-Quartal. Es ist nicht ein Quartal gegen dasselbe Quartal im Vorjahr, und es hat kein Periodenende |
| Umsatz, rollierende vier Quartale | kein Umsatzfeld | `fcfTTM` und `epsTTM` sind Cashflow und Gewinn je Aktie (`schema.ts` 479, 497), nicht der Umsatz | `revenueTTM` gibt es in `server/valuechain-fmp-enrichment.ts` 86 und in `server/backtest/pit-valuation.ts` 475. Beides hängt nicht am Analyse-Payload. `financialStatements.incomeStatement.revenue` und `.revenueGrowth` (`schema.ts` 539–540) sind das letzte Geschäftsjahr gegen das Vorjahr (`analyze-route.ts` 688–693), ohne Periodenende |
| Periodenende des Umsatzes | `lastReportedQuarter` | Label wie `Q3 FY2026` aus `lastReportedQuarterLabel` (`server/analyze-helpers.ts` 381–431). Das Datum der Zeile wird nur zum Sortieren benutzt und nicht mitgeliefert | kein ISO-Periodenende auf `StockAnalysis`. `revenueSegments[].fiscalYear` ist optional und ein Jahr oder ein Datum der Segmentquelle, nicht der Umsatzperiode des Gesamtkonzerns |
| Top-Segment | `revenueSegments[]` (`name`, `revenue`, `percentage`, `growth`, `fiscalYear`, `source`) | ja, wenn FMP, SEC oder die kuratierte Liste etwas lief. Sonst `revenueSegmentsSource: "none"` und `revenueSegmentsMessage` | `segment-gap-route.ts` ist nicht auf main (nur PR #492). Fehlt die Aufteilung, sagt der Podcast „Hauptumsatzträger liegt nicht vor“ und schätzt nichts |
| Earnings-Call-**Termin** | `nextEarningsDate`, `lastReportedQuarter`, `nextEarningsIsEstimate` | ja | das ist der Termin, nicht das Transkript |
| Earnings-Call-**Transkript** | nicht auf `StockAnalysis` | separater, schon vorhandener Pfad: `useEarningsBrief` → `GET /api/chat/earnings-brief/:symbol` → `buildEarningsBrief` (`server/chat-earnings-route.ts`). Zwei FMP-Calls: `fmpEarningCallTranscriptDates` und `fmpEarningCallTranscript` (`server/fmp.ts` 1228–1238). Cache ist eine `Map` im Prozess, Schlüssel nur das Symbol | nicht im Analyze-Payload. Für Phase 2, nicht für Phase 1 |
| News | `newsItems[]` (`title`, `source`, `pubDate`, `url`, `relativeTime`), gefüllt in `analyze-route.ts` etwa 1340 über `fetchNewsFromGoogleRSS` (`server/news-peers.ts` 97–102) | ja, mit dem Analyze | keine eigene `/api/news`-Route. Alter und 14-Tage-Filter für den Podcast existieren nicht |

Berichtswährung: Listing `data.currency`. Statement-Währung für DCF und Entry wie in `exec-summary.ts` `currencyWord` (JOB D).

Geschäftsjahr, Philip 26.11.2026 13:10: der Umsatzsatz spricht `financialStatements.incomeStatement.revenueGrowth`. Formel in `analyze-route.ts` 688–693: `revenue` aus `financials.income[0]`, `revenueY1` aus `financials.income[1]`, `revenueGrowth = (revenue − revenueY1) / revenueY1 × 100`, wenn `revenueY1 > 0`, sonst 0. Geschrieben auf das Payload in Zeilen 1814–1815. Feld im Schema: `shared/schema.ts` 540. Ist `revenueY1` nicht positiv, fehlt der Vorjahresumsatz. Dann heißt der Satz „liegt nicht vor“, nicht „0 Prozent“.

GJ-Bezeichnung: `latestFiscalYear` in `analyze-route.ts` 864, `incomeLatest.fiscalYear`, sonst `calendarYear`. Das Token wird an `lastReportedQuarterLabel` übergeben (867–872 und 1674) und steht nicht als eigenes Feld auf `StockAnalysis`. `lastReportedQuarter` ist das zuletzt gemeldete Quartal (`Q3 FY…`, `analyze-helpers.ts` 381–431) und wird nicht als Geschäftsjahr dieses YoY gesprochen. `incomeLatest.date` bleibt im Analyze-Lauf und kommt nicht auf das Payload. Steht die vierstellige Jahreszahl aus Zeile 864 im mitgeschickten Objekt, lautet der Satz „Geschäftsjahr“ plus diese Zahl. Steht sie nicht, heißt es nur „Geschäftsjahr“, ohne erfundenes Jahr und ohne das Wort seit Jahresbeginn.

### B4. DCF-Spanne WACC ±1 Prozentpunkt

Vorhanden, aber nicht als Serverfeld und nicht als reine ±1-Funktion.

`client/src/components/sections/Section5.tsx` `sensitivityMatrix` (Zeilen 189–208, `useMemo` nur in dieser Datei) ruft `calculateFCFFDCF` (`shared/valuation-signal.ts` Zeile 609) mit `waccDeltas = [-1, 0, 1]` und `growthDeltas = [-2, 0, 2]`. Die Schleife steht nicht in `shared/` und nicht auf dem Server. `calculateFCFFDCF` und `buildDefaultDCFParams` (Zeile 508) sind schon gemeinsam. `g_TV` ist `params.terminalG` (Eingabe Section 5, Zeile 401 „Terminal g“). In `calculateFCFFDCF` Zeilen 707–716 wird daraus `gDecimal = params.terminalG / 100`. Der Nenner ist `waccDecimal - gDecimal`. Ist der Nenner nicht positiv, setzt Zeile 715 den Endwert auf das 25-Fache von FCFF₁₁.

Die Szenarien Conservative / Optimistic / Macro-Stress (Zeilen 211–215) ändern Wachstum, Margin und ERP. Das ist **nicht** die Spanne ±1 Prozentpunkt.

`DCF_CALIBRATION.enabled` ist `false` (`shared/dcf-calibration.ts` Zeile 21, CI #526). `resolveGrowthAnchor` (Zeile 204) läuft dadurch nicht in die angezeigte Bewertung. Der gesprochene g*-Wert ist der angezeigte Reverse-DCF, nicht dieser Anker.

### B5. Unsicherheit, wie die Anzeige sie schon kennt

Zwei verschiedene n-Regeln, beide lassen:

- Peer-Banner der Relativ-Sektion: `PEER_SET_MIN = 3` in `shared/peer-material.ts` Zeilen 10–13. `assessPeerSet` setzt `peerSet.banner` = „Peer-Set unvollständig — Relativ nicht score-wirksam.“, wenn das Set material ist und `peerCount < 3`. Anzeige `Section7.tsx` etwa Zeile 733, `data-testid="peer-set-incomplete-banner"`.
- These-Sektorreferenz: `sectorReferenceFallback` in `server/thesis-strength.ts` Zeile 483, `peerCount < 5` → Flag „Sektor-Referenz nicht belastbar (<5 Peers)“. Anzeige `ThesisStrengthPanel.tsx` Zeilen 36–37, wenn der Thesis-Lauf gelaufen ist.

Schätzung ohne Datum: `nextEarningsIsEstimate` (Section 1, `Section1.tsx` 189–190, Text „geschätzt“). Segmentwachstum ohne `fiscalYear` bleibt eine Zahl ohne Periode. g*-Anker der Kalibrierung ist aus und wird nicht als bepreister Wert gesprochen.

### B6. Budgets

FMP, `GET /api/fmp-budget` (`analyze-route.ts` 496–502), Zähler `getFmpBudgetStatus` (`analyze-helpers.ts` 32–73):

- Tageslimit Default **15000** (`FMP_DAILY_LIMIT`), Warnung 10000, Planung 13 Calls je Analyse. Der Kommentar in Zeile 28 sagt „default 750“; der Code setzt 15000. Es gilt der Code.
- Jeder `fmpFetch` zählt **1**, auch bei 429, **bevor** die Antwort da ist (`fmp.ts` 56–57). Ein Transkript kostet im App-Budget **2** (Daten + Inhalt), Retries zusätzlich. Einen höheren FMP-Listenpreis für Transkripte kodiert die App nicht. Kein Live-Call in dieser Prüfung.

KI: kein eigenes Token-Kontingent im Repo. OpenRouter antwortet 402, `llm-openrouter.ts` loggt „token budget exhausted“ und bricht die Runde ab. `callLLMJson` deckelt `max_tokens` bei 4000. Der Markt-Podcast nutzt 2800 Tokens und 30 s (`PODCAST_LLM_TIMEOUT_MS` = `CHAT_LLM_TIMEOUT_MS`). Rate-Limit je IP, 20 Anfragen je 60 Sekunden: `CHAT_RATE_LIMIT` und `chatRateLimited` in `server/chat-route.ts` 21 und 190–204. Segment-Kinder: `takeSegmentChildrenSlot` in `server/segment-growth-route.ts` 155–164.

### B7. PDF

`client/src/lib/exportPdf.ts` liest `execSummary.headline` nicht. Die Zeichenkette kommt im Client-Fallback nicht vor: `buildClientPdf` Zeilen 98–106 setzt Kurs, Worst Case, Fair Value, CRV, Max-Entry und `scoring.finalScore`.

Die sichtbare g*-Zeile kommt ins PDF nur als Pixel. `captureSections` Zeilen 61–82 fotografiert das DOM. Zeile 62 lädt `html2canvas` 1.4.1 (`package-lock.json`, `node_modules/html2canvas` Version 1.4.1). Zeile 71 ruft es ohne `ignoreElements` auf. In dieser Version lässt `DocumentCloner.appendChildNode` Kinder mit `data-html2canvas-ignore` aus (`src/dom/document-cloner.ts` der Bibliothek, Konstante Zeile 46, Prüfung Zeile 280). `Dashboard.tsx` übergibt die Sektions-Refs. `windowWidth` ist mindestens 1024 (Zeile 71).

`server/pdf-export.ts` hat ein eigenes Feld `narrative.execSummary` (Zeilen 294–325 und 480–483), ein LLM-Absatz, nicht `execSummary.headline`.

---

## C. Soll

### C1. Grundsatz

Der Button liest den **schon geladenen** Analyse-Stand. Er ruft nicht `POST /api/analyze` auf, schreibt `scoring`, `dcfFairValue`, `maxEntryCrv3`, Rating und Entry nicht zurück und erzeugt kein eigenes Kursziel und kein eigenes Rating.

Zahlen erzeugt das Modell nicht. Es schreibt Fließtext mit Platzhaltern. Code setzt Werte ein, rundet und spricht sie aus.

### C2. Platzhalter

Geschlossene Liste. Alles andere ist ein unbekannter Platzhalter und verwirft den Satz.

`{ticker}` `{company}` `{as_of}` `{currency_word}` `{statement_currency_word}` `{price}` `{score}` `{ampel}` `{wacc}` `{g_star}` `{dcf_fair}` `{dcf_low}` `{dcf_high}` `{entry}` `{crv}` `{quarter_yoy}` `{quarter_period_end}` `{ttm_revenue}` `{ttm_period_end}` `{top_segment}` `{top_segment_share}` `{call_date}` `{call_quarter}` `{catalyst_mode}` `{news_1}` `{news_2}` `{news_3}` `{news_age}`.

`{fy_yoy}` ist `financialStatements.incomeStatement.revenueGrowth` (B3). `{gj_year}` nur die vier Stellen aus `latestFiscalYear` (`analyze-route.ts` 864), wenn sie im Objekt stehen. `{quarter_yoy}`, `{quarter_period_end}`, `{ttm_revenue}` und `{ttm_period_end}` bleiben `null` und werden nicht gesprochen. `{dcf_low}` und `{dcf_high}` nur nach C5.

Validator, rein, ohne Netz, geplante Datei `shared/podcast-script.ts`, Test `script/test-ki-podcast-placeholders.ts`. Ablauf auf dem Modelltext, bevor Platzhalter ersetzt werden:

1. Platzhalter `{name}` heraustrennen und gegen die Liste prüfen (b, c).
2. Positivliste aus dem Rest entfernen, erst danach nach Ziffern suchen.
3. Zahlwörter prüfen.

Positivliste, damit Q3, S&P 500, H100, B200, 3-nm und GJ2027 nicht als erfundene Zahl gelten:

- Fest: `S` plus ein oder zwei Ziffern (deckt S17), `Q` plus 1–4, `GJ` oder `FY` plus vier Ziffern, eine vierstellige Jahreszahl 19xx oder 20xx, `S&P 500`, ein Muster `Ziffern-nm` (deckt 3-nm), die Produktkürzel `H100` und `B200`.
- Dazu jedes Token, das genau so in den Fakten steht: Ticker, Firmenname, Segmentname, Katalysatorname, `keyProjects`. Steht „H100“ nur im freien Satz und nicht in den Fakten, trägt es die feste Liste trotzdem.

(a) Nach dem Entfernen bleibt keine Ziffer. Eine erfundene `14` oder `149` im Freitext fällt durch. (b) Jeder `{name}`-Treffer steht in der Liste. (c) Jeder erlaubte Platzhalter im Satz hat einen endlichen Wert oder einen freigegebenen Text im JSON. Sonst fällt der Satz weg. Bleibt vom Kapitel nichts, spricht das Kapitel „liegt nicht vor“.

Deutsche Zahlwörter: ein Wort oder eine Kette aus der Reihe null bis zwölf, dreizehn bis neunzehn, die Zehner, hundert, tausend, optional mit „Komma“ dazwischen. Bis zu zwei Füllwörter dürfen davor stehen und bis zu zwei zwischen der Kette und der Einheit. Einheiten: Prozent, Milliarden, Millionen, Dollar, Euro, US-Dollar, Prozentpunkte, Punkte, Mal, Quartale. Zusätzlich gesperrt, auch ohne Einheit: Hälfte, Drittel, Viertel, verdoppelt, verdreifacht, halbiert und Wörter auf „-fach“. „vierzehn Prozent“, „elf Komma vier Prozent“, „rund fünfzig Dollar“ und „fünfzig US-Dollar“ werden abgelehnt. „um ein Drittel gestiegen“ wird abgelehnt, weil „Drittel“ auf der Sperrliste steht. „H100“ bleibt.

Akzeptanztests in derselben Datei, ohne Netz: ein NVDA-Skript mit Produktnamen, Q3, S17, GJ-Kürzel, 3-nm und S&P 500 läuft ohne Fehlalarm durch; ein Freitext mit erfundener Ziffer wird abgelehnt; der Satz nur mit „H100“ besteht; „vierzehn Prozent“, „elf Komma vier Prozent“, „fünfzig US-Dollar“ und „um ein Drittel gestiegen“ werden abgelehnt. Ein Skript, das „YTD“ oder „seit Jahresbeginn“ enthält, wird abgelehnt. Das Geschäftsjahr heißt im gesprochenen Text „Geschäftsjahr“.

Ein verworfener Satz wird nicht in derselben Antwort nachgebessert. Ein zweiter Versuch ist erlaubt, höchstens einer, mit demselben JSON. Scheitert er, fällt das Kapitel auf die festen Sätze ohne Modell zurück.

Rundung vor der Sprechform, danach Worte. Kurs, fair, `dcf_low`, `dcf_high` und Entry auf drei signifikante Stellen: 149 bleibt 149, 52,76 wird 52,8, 3,472 wird 3,47. Die g*-Zeile auf dem Schirm bleibt bei der heutigen Anzeige. Der Player ändert sie nicht.

Test `script/test-ki-podcast-rounding.ts`: die Rangfolge von Kurs, Entry, fair, low und high ist nach dem Runden dieselbe wie davor. Entsteht ein Gleichstand, wird einmal mit vier signifikanten Stellen gesprochen. Bleibt der Gleichstand, fällt der Satz weg, der die Reihenfolge behauptet.

- Prozent eine Nachkommastelle: `11,4` wird „elf Komma vier Prozent“. Diese Form schreibt nur der Code, nie das Modell.
- Beträge ab 1e9: „… Milliarden“ plus Währungswort, der Zahlenkern weiter mit drei signifikanten Stellen. Ab 1e12: „Billionen“. Darunter „Millionen“, Schwelle wie `fmtMoney` in `exec-summary.ts` 106–110.
- Datum `24.02.2027` wird „vierundzwanzigster Februar zweitausendsiebenundzwanzig“.

### C3. Kapitel, Länge, Ausgewogenheit

Feste Reihenfolge. Ziel 800–1000 Wörter gesamt, gesprochen etwa 6–7 Minuten bei 140 Wörtern je Minute. Kürzer als 3 Minuten nur, wenn mehrere Kapitel „liegt nicht vor“ sind. Nicht künstlich strecken. Jedes Kapitel endet mit einem Hinweis, der im Player anspringbar ist.

| # | Kapitel | Phase | Quelle, nur vorhandene Felder |
|---|---|---|---|
| 1 | Einstieg | 1 | Ticker, Name, Datenstand (`dataTimestamp` oder `_cachedAt`), Ampel-Wort. Erster Satz nennt den Stand |
| 2 | Executive Summary | 1 | `execSummary.pro` / `contra`, Fazit-Sätze. Pro wird auf die Länge des Contra-Blocks gekürzt, nie umgekehrt mit erfundenen Punkten gefüllt |
| 3 | These | 1 | `growthThesis`, sonst „liegt nicht vor“ |
| 4 | Umsatz | 1 | Geschäftsjahres-Wachstum YoY, Feld `financialStatements.incomeStatement.revenueGrowth` (`analyze-route.ts` 688–693 und 1814–1815). Der Satz sagt „Geschäftsjahr“ und, wenn vorhanden, die Jahreszahl aus `latestFiscalYear` (Zeile 864). Fehlt der Wert, weil `revenueY1` nicht positiv ist: „liegt nicht vor“. Fehlt `revenueSegments`: „Hauptumsatzträger liegt nicht vor“. Kein Schätzwert |
| 5 | Earnings Call | 2 | Nur Phase 2. Transkript älter als `lastReportedQuarter`: Kapitel entfällt mit einem Satz, der das Alter nennt. Fehlende Quelle: „liegt nicht vor“ |
| 6 | DCF | 1 | fair, optional Spanne, g*, WACC, Entry, CRV. Kein neues Kursziel |
| 7 | S17 | 1 | Katalysatoren mit Name, PoS, GB, nur als Platzhalter. Steht der Modus auf generisch, wird `{catalyst_mode}` zum Wortlaut aus `catalystsModeLabel` (`shared/bias-fixes.ts` 268–273): „Katalysatoren: generisch (Sektor)“. Derselbe Text steht in der Karte (`ExecSummaryCard.tsx` 116–118). Das Kapitel darf diese Katalysatoren nicht als unternehmensspezifisch bezeichnen. Nur `catalystsSource === "llm"` erlaubt „KI-firmenspezifisch“ |
| 8 | Inversion | 1 | Immer vorhanden, auch wenn die Zahl fehlt („liegt nicht vor“). Inhalt aus der bestehenden Inversion (`invertedDcf` / Section-8-Text), nicht aus einem neuen Modell |
| 9 | News | 3 | Höchstens 3 Einträge mit `pubDate` innerhalb von 14 Tagen, Quelle und Datum. Alter der ältesten gesprochenen Meldung im letzten Satz des Kapitels |
| 10 | Schluss | 1 | „Dies ist keine Anlageberatung.“ Immer, auch wenn das Modell ihn vergisst (`PODCAST_DISCLAIMER` bleibt die Formulierung) |

Contra-Länge nach dem Einsetzen der Platzhalter, in Zeichen: Contra-Kapitel einschließlich Inversion ≥ Pro-Kapitel. Test in `script/test-ki-podcast-placeholders.ts`. Die Inversion zählt zum Contra-Block, damit die Länge aus vorhandenen Risiken kommt.

Unsicherheit mit dem Wortlaut der Anzeige, nicht mit einer dritten Schwelle:

- Relativ-Satz: bei `peerSet.banner` denselben Banner sprechen (`n < 3` und nur wenn `peerMaterial`).
- These-Sektorreferenz: die Flag aus `sectorReferenceFallback` sprechen, wenn sie in `result.flags` steht (`n < 5`).
- `nextEarningsIsEstimate`: „geschätzt“ wie Section 1.
- Segment ohne `fiscalYear`: „Periode liegt nicht vor“.
- g*-Anker: nicht sprechen. `DCF_CALIBRATION.enabled` ist false. Ein Satz, der ihn als bepreist behandelt, ist verboten.

### C4. UI-Slot und Flex-Wrap

**Slot, fest.** Philips Worte, bestätigt durch den Stabschef, 26.11.2026 13:10 Europe/Madrid: auf dem Desktop sitzt der Player rechts neben der g*-Zeile (`execSummary.headline`, `ExecSummaryCard.tsx` 111–114), in der Lücke unter der Ampel (103–109). Auf Mobile bricht er per Flex-Wrap unter die Zeile um. Das gilt bei jeder Aktie, die diese Karte zeigt. Die Steuerung ist Spotify-artig: Play/Pause, Vor- und Zurückspulen, Geschwindigkeit. Der Look bleibt offen, bis ein Designer-Mock vorliegt und Philip ihn freigibt. Vor diesem OK gibt es keinen Bauauftrag.

**Technik:** kein fester Breakpoint, kein `sm:`/`md:`-Wechsel zwischen „inline“ und „eigene Zeile“. Ein Wrapper um Absatz und Player:

`className="flex flex-wrap items-center gap-x-3 gap-y-2"`.

- Die g*-Zeile bleibt **ein** Textknoten (`execSummary.headline`). `min-w-0 max-w-full w-fit break-words`. Kein `truncate`, kein `whitespace-nowrap`.
- Der Player ist das nächste Flex-Kind, `shrink-0 min-w-[min(100%,16rem)] max-w-full`. Die 16 rem sind die Mindestbreite des Players, nicht eine Viewport-Grenze. Reicht der Rest der Zeile nicht, setzt `flex-wrap` ihn in die nächste Zeile, volle verfügbare Breite.
- Der Hinweis `exec-summary-mode` („Katalysatoren: generisch (Sektor)“) bleibt **unter** dem Wrapper, Reihenfolge wie heute: Ampel, dann Zeile+Player, dann Hinweis.
- Kein `position: fixed` und kein Andocken unten rechts. Dort liegt der KI-Chat (`bottom-4 right-4 z-40`).
- `SectionCard` hat `overflow-hidden`. Der Wrapper lebt im normalen Fluss der Karte, damit die Zeile nicht abgeschnitten wird.

Die bestehende `<p>`-Zeile erlaubt das **nicht ohne diesen Wrapper**. `buildExecSummary` und die Ampel-Klassen bleiben. Die Ampel-Zeile (`justify-between`) wird nicht zum Player-Container.

Akzeptanz Layout, fünf Ticker, Viewports 375, 768 und 1280 px: die g*-Zeile ist vollständig lesbar, der Player überlappt sie nicht. Darunter ein Ticker mit langem Namen und einer ohne Call-Datum oder ohne WACC (`Call n/v` bzw. g* ohne WACC-Klammer, beides kann der heutige Builder). Der Live-Befund (1920 px viel freier Raum, 500 px wenig, 375 px Umbruch des Absatzes) begründet nur, warum Wrap nötig ist. Er wird nicht als `@media` abgeschrieben.

Komponente, neu: `client/src/components/sections/PodcastPlayer.tsx`. Vorhandene Bausteine: `client/src/components/ui/button.tsx`, `client/src/components/ui/slider.tsx` (Radix/shadcn, schon im Repo). Steuerung, Spotify-artig: Play/Pause, Vor- und Zurückspulen (±15 s), Geschwindigkeit, dazu Fortschritt und anspringbare Kapitelliste. Look-Details nach dem Designer-Mock. Phase 0 spricht über `speechSynthesis` (Rate nativ, Sprung nur satzweise). Ziel-Audio ist `<audio>` mit `playbackRate` und Media Session (C8). Der Player trägt `data-html2canvas-ignore` (B7, Abnahme 7).

Hook `client/src/hooks/usePodcast.ts`: liest `data` aus dem Dashboard, kein `useMutation` auf `/api/analyze`. Skript: `POST /api/podcast/script` mit dem Fakten-JSON. Audio, erst nach Freigabe: `GET /api/podcast/audio/:id` je Kapitel.

### C5. DCF-Spanne

Die Zelle steht in `client/src/components/sections/Section5.tsx` `sensitivityMatrix`, Zeilen 189–208. `waccDeltas` ist `[-1, 0, 1]`, `growthDeltas` ist `[-2, 0, 2]` (Zeilen 190–191). Die Schleife Zeilen 193–204 ruft `calculateFCFFDCF` mit `waccOverride: mainResult.wacc + wd` und verschiebt das Wachstum um `gd`. Die Spanne ±1 Prozentpunkt sind nur die beiden Ergebnisse mit `wd` gleich −1 oder +1 und `gd` gleich 0. Die Funktion liegt in `shared/valuation-signal.ts` Zeile 609, die Default-Parameter in `buildDefaultDCFParams` Zeile 508 derselben Datei.

Benennung, eindeutig: `dcf_low` ist `value(WACC+1)`, der niedrigere Wert. `dcf_high` ist `value(WACC−1)`, der höhere Wert. `fair` ist derselbe Aufruf mit `wd` 0 und `gd` 0, also `mainResult.perShare` der Matrix, nicht ein anderes Feld. Der Test lautet `value(WACC+1) ≤ fair ≤ value(WACC−1)`. Gilt er nicht, wird die Spanne nicht gesprochen.

Konvergenz-Sperre auf den Eingangsgrößen, vor dem Aufruf von `calculateFCFFDCF`. `g_TV` ist `params.terminalG` in Prozent (Section 5 Zeile 401). Bedingung: `(WACC − 1 − params.terminalG) < 1` Prozentpunkt. Trifft sie zu, werden die beiden Span-Aufrufe nicht ausgeführt und `{dcf_low}` sowie `{dcf_high}` bleiben draußen. Der 25-fach-Deckel in `calculateFCFFDCF` Zeile 715 liefert sonst einen endlichen, aber verzerrten Wert. Ein Test nur auf Endlichkeit und auf `value(WACC+1) ≤ fair ≤ value(WACC−1)` ließe ihn durch. Zusätzlicher Testfall: die Eingaben würden den Deckel auslösen (`waccDecimal ≤ gDecimal` im Zweig Zeilen 712–716), und die Spanne fällt trotzdem weg, weil die Prüfung vor dem Aufruf stoppt. Optimistic und Macro-Stress (Zeilen 211–215) sind verboten. `DCF_CALIBRATION.enabled` bleibt `false`.

Die Schleife liegt heute nur im Client. Die Extraktion nach `shared/valuation-signal.ts` ist ein reines Verschieben ohne Formeländerung: dieselbe Schleife, dieselben Argumente an `calculateFCFFDCF`. Section 5 und der Server rufen die verschobene Funktion. Nichts davon wird nach `dcfFairValue`, Score oder Entry zurückgeschrieben. Schreibt P1 die Funktion nicht, bleiben `{dcf_low}` und `{dcf_high}` draußen.

Regressionsschutz für eine sichtbare Sektion. Abnahme in `script/test-ki-podcast-dcf-span.ts` mit fünf Tester-Tickern: jede Zelle der Section-5-Matrix ist vor und nach dem Verschieben bitgleich (`Object.is`), nicht nur die Span-Zelle `gd === 0`. Dazu ein Screenshot der Sektion 5 vorher und nachher.

### C6. Server, Schema, Cache, Budget

| Stufe | Neu, additiv | Tut |
|---|---|---|
| Fakten | `shared/podcast-facts.ts` `buildPodcastFacts(analysis)` | Nur kopieren und die eine erlaubte `calculateFCFFDCF`-Spanne rechnen. Fehlendes Feld bleibt `null` |
| Skript | `shared/podcast-script.ts` | Prompt mit der Platzhalterliste, Validator, Rundung, Sprechform, Kapitel, Disclaimer |
| Schema | `shared/schema.ts` | `podcastScriptRequestSchema` (Zod): Ticker, `facts`, `promptVersion`. Antwort: Kapitel `{ id, title, template, spoken }`, `asOf`, `cacheKey`, `voice`. Kein Feld, das Score oder Entry schreibt |
| Route | `server/stock-podcast-route.ts` `POST /api/podcast/script` | Baut Fakten aus dem **mitgeschickten** Analyse-Objekt, ruft das bestehende `callLLMJson` (Haiku-Kette, kein Audio-Modell), validiert, cacht. Timeout 30 s wie der Chat. Kein FMP in Phase 1 |
| Audio | `GET /api/podcast/audio/:chapterId` | Erst Phase Audio. `Content-Type: audio/mpeg`, je Kapitel, nicht Base64 im Skript-JSON |
| Registrierung | `server/routes-register.ts` | neben der bestehenden Markt-Route, die unverändert bleibt |

Erzeugung nur auf Klick. `usePodcast` startet weder beim Laden der Seite noch am Ende von `/api/analyze`. Skript und Audio entstehen erst im Click-Handler.

Cache-Key des Skripts = SHA-256 des kanonischen Fakten-JSON plus `promptVersion` plus `voice`. Eine alte MP3-Datei wird nur wieder abgespielt, wenn die eingesetzten Kapitelzahlen gleich sind und das gesprochene Skript keine kursabhängige Zahl enthält. Kursabhängig sind der Kurs selbst, die Upside zum DCF, das KGV und der Abstand zum Entry. Enthält das Skript eine davon, nimmt der Hash den Kurs auf, und der Player zeigt sichtbar „Stand {Datum}, Kurs {Kurs}“. Ohne diese Zahl darf die MP3 bei gleichem Zahlenstand und gleicher Stimme bleiben. Anzeige „Stand: …“ aus `asOf` (`dataTimestamp`) gilt in jedem Fall. TTL des Skripttexts wie der Disk-Cache, 7 Tage, zusätzlich an den Hash gebunden. Der Markt-Key `podcast_transcript__SYMBOL` wird nicht wiederverwendet.

Budget, vorhandene Muster, kein zweiter Zähler für FMP:

- Tagesobergrenze je Ticker nach `chatRateLimited` (`server/chat-route.ts` 21, 190–198, Aufruf 202–204): eine `Map` von Zeitstempeln, Schlüssel ist der Ticker, Fenster bis zur nächsten Mitternacht Europe/Madrid, Konstante `PODCAST_DAILY_MAX`. Gezählt wird nur ein Klick, der neu erzeugt. Ein Cache-Treffer zählt nicht. Über der Grenze HTTP 429, Text in der Art der Chat-Antwort „Zu viele Chat-Anfragen. Bitte kurz warten.“, für den Client dasselbe `errorCode: "RATE_LIMITED"` wie `analyze-route.ts` 644–647.
- Das globale FMP-Tagesbudget (`isFmpBudgetLow`, `analyze-route.ts` 637–648) bleibt die Grenze für Phase 2. Phase 1 ruft FMP nicht auf. Ein 402 von OpenRouter beendet den Skript-Call, Kapitel „liegt nicht vor“, kein Retry-Sturm.
- Dieselbe Slot-Form wie `takeSegmentChildrenSlot` (`server/segment-growth-route.ts` 155–164) ist die zweite vorhandene Vorlage (Zeitstempel je Schlüssel, Fenster, Maximum). Der Podcast nimmt die Chat-Variante, weil sie schon 429 an einer KI-Route ausliefert.

Token-Deckel ein Skript-Call, 1500 Ausgabe-Tokens (800–1000 Wörter plus JSON-Gerüst). Der heutige `callLLMJson`-Deckel 4000 bleibt die harte Grenze. Phase 2 zusätzlich höchstens die zwei schon vorhandenen FMP-Transcript-Calls, und nur wenn der Earnings-Brief für das Symbol nicht schon im Prozess-Cache liegt.

### C7. Phasen

| Phase | Inhalt | Audio |
|---|---|---|
| 0 | kein eigener Lieferumfang | `speechSynthesis` nur als Notnagel, siehe D |
| 1 | Kapitel 1–4, 6–8, 10, Player, Cache, Validator, Flex-Wrap-Slot | Notnagel Phase 0, bis Phase Audio da ist. Gesperrtes iPhone ist damit nicht erfüllt |
| 2 | Kapitel 5, bestehender Earnings-Brief, Altersvergleich mit `lastReportedQuarter` | dasselbe Audio wie die anderen Kapitel |
| 3 | Kapitel 9 aus `newsItems`, 14 Tage, max. 3, Quelle und Datum | dasselbe |
| Audio | MP3 je Kapitel, `<audio>`, Media Session, Seek, `playbackRate` | Bestehender `OPENROUTER_API_KEY`, `POST /api/v1/audio/speech`. Kein neuer Key, keine neue Env-Variable. Dieselbe Tagesobergrenze und dasselbe 429-Muster wie in C6. Bau erst nach Mock und Philips OK |

### C8. iPhone, gesperrtes Display

`speechSynthesis` spielt nicht als HTML-Audio. Safari auf iOS bricht die Ausgabe ab, wenn die Seite in den Hintergrund geht oder das Gerät gesperrt wird (Belege in D). Media Session steuert ein Medienelement, nicht die Systemsprache. Ziel ist deshalb MP3 über `<audio>` plus [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API) (`metadata`, `play`, `pause`, `seekto`). Phase 0 bleibt der Fallback im entsperrten Tab und ist kein Abnahmekriterium fürs gesperrte Display.

---

## D. TTS-Vergleich

Geprüft am 26.11.2026 ohne API-Key: öffentlicher Katalog `GET https://openrouter.ai/api/v1/audio/speech/models` (39 Einträge) und `GET https://openrouter.ai/api/v1/models?output_modalities=audio` (4 Einträge). Kein Generate-Call.

### 1. Browser `speechSynthesis`

Kosten 0. Sofort, keine neue Abhängigkeit. `utterance.rate` ist die Geschwindigkeit. Seek nur über Abbruch und Neustart beim Satz. Stimmen und Deutsch hängen am Gerät.

Belege: [MDN SpeechSynthesis](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis); [WebOutLoud, Safari](https://weboutloud.io/bulletin/speech_synthesis_in_safari/) (Abbruch, wenn iOS Safari in den Hintergrund geht, beobachtet ab Safari 15.4); [TryDeputize, 09.09.2026](https://www.trydeputize.com/blog/build-notes/speechsynthesis-crash-course) (iOS und Android brechen ab, wenn der Tab in den Hintergrund geht oder das Display sperrt; die API liefert keine Audiodatei). iOS verlangt den ersten `speak()` in der direkten Geste ([Stack Overflow 67655133](https://stackoverflow.com/questions/67655133/when-will-speechsynthesis-speak-work-on-ios-safari)).

Das ist Phase 0, nicht das Ziel.

### 2. OpenRouter

Der Analyse-Default `anthropic/claude-haiku-4.5` steht in keinem der beiden Kataloge als Audio-Ausgabe. Ein „Gemini mit Audio“ im heutigen Chat-Call ist auf diesem Stand nicht belegt.

Chat-Modelle mit Output-Modalität `audio` (Katalog 26.11.2026): `openai/gpt-audio`, `openai/gpt-audio-mini`, `google/lyria-3-pro-preview`, `google/lyria-3-clip-preview`. Lyria ist nicht das Analyse-Modell. Ob diese vier ein Kapitel als MP3 für `<audio>` zurückgeben, sagt die Modalitätsliste nicht; die Chat-Audio-Doku verlangt `modalities: ["text","audio"]` und streamt Base64-Stücke ([OpenRouter Audio](https://openrouter.ai/docs/guides/overview/multimodal/audio)). Das ist ein anderer Vertrag als `callLLMJson`.

Dedizierte Sprache, `POST /api/v1/audio/speech`, Rohbytes ([OpenRouter TTS](https://openrouter.ai/docs/guides/overview/multimodal/tts)):

| Modell-ID im Katalog | Format | Deutsch im Katalog erkennbar |
|---|---|---|
| `google/gemini-2.5-flash-tts`, `google/gemini-2.5-pro-tts`, `google/gemini-3.8-flash-tts`, `google/gemini-3.8-flash-lite-tts`, `google/gemini-3.1-flash-tts-preview` | `pcm`, `wav`, nicht `mp3` | Stimmen heißen Zephyr, Puck, Kore, …; kein `de-DE` im Stimmnamen |
| `microsoft/mai-voice-2.1`, `microsoft/mai-voice-2.1-flash` | `mp3`, `pcm` | `de-DE-Klaus`, `de-DE-Mia`, `de-DE-Grant`, `de-DE-Harper` |
| `deepgram/aura-2` | `mp3`, `pcm` | Stimmen mit Suffix `-de` (unter anderem `aura-2-viktoria-de`) |
| `elevenlabs/eleven-multilingual-v2` und weitere Eleven-IDs | `mp3`, `pcm` | Stimmennamen ohne Sprachkennzeichen; Mehrsprachigkeit nicht aus der ID ableiten |
| `mistralai/voxtral-mini-tts-2603` | `mp3`, `pcm` | Stimmen `en_*`, `gb_*`, `fr_marie_*`; kein `de_` |

Philip, 26.11.2026 13:10, über den Stabschef: die Stimme läuft über den bestehenden `OPENROUTER_API_KEY` und `POST /api/v1/audio/speech`. Kein neuer Key, keine neue Env-Variable. Das ist ein zusätzlicher Kostenpfad auf demselben Konto. Die Tagesobergrenze je Ticker und das 429-Muster aus C6 gelten auch für diesen Aufruf. Ein 402 von OpenRouter beendet die Runde, ohne einen zweiten Anbieter aufzurufen.

### 3. Dedizierte TTS-API, MP3, echtes `<audio>`

Damit funktionieren Seek, `playbackRate` und Media Session.

| Weg | Beleg 26.11.2026 | Grobe Kosten je Ticker |
|---|---|---|
| OpenAI `tts-1` / `tts-1-hd` | [Pricing](https://developers.openai.com/api/docs/pricing): 15 USD bzw. 30 USD je 1 Mio. Zeichen. Dieselben Modelle plus `gpt-4o-mini-tts` sind zur Abschaltung am 06.01.2027 genannt ([AssemblyAI, 19.11.2026](https://www.assemblyai.com/blog/tts-api-pricing)) | 800–1000 deutsche Wörter, grob 6–8 Tausend Zeichen: etwa 0,09–0,12 USD (`tts-1`) bzw. 0,18–0,24 USD (`tts-1-hd`). Nicht bauen auf ein Modell, das in sechs Wochen abgeschaltet wird, ohne den Nachfolger zu prüfen |
| OpenAI `gpt-4o-mini-tts` | dieselbe Pricing-Seite: 0,60 USD je 1 Mio. Text-Tokens Input, 12 USD je 1 Mio. Audio-Tokens Output. Kein Zeichenpreis. Drittschätzung etwa 0,06 USD je 1000 Zeichen ([LLM Data Hub, Nov 2026](https://llm.okamomedia.tokyo/en/speech-api-pricing/)) | grob 0,36–0,50 USD, unsicher, weil die Audio-Token je Sekunde nicht von OpenAI veröffentlicht sind |
| Google Cloud TTS / ElevenLabs direkt | nicht als Zeichenpreis in diesem Lauf von der Herstellerseite gezogen. OpenRouter listet Eleven und Gemini-TTS bereits (oben). Ein eigener Key ist ein neuer Tool-Zugang | vor der Freigabe die dann gültige Preisseite lesen. Nicht aus dem Gedächtnis einsetzen |
| Skript-LLM, getrennt von der Stimme | bestehendes Haiku 4.5, Kommentar `llm-openrouter.ts` Zeilen 46–49: 1 USD / 5 USD je 1 Mio. Tokens | ein Kapitel-JSON, grob 2–4 Tausend Tokens Input und unter 1500 Output: unter 0,02 USD. Cache-Treffer 0 |

Empfehlung: Phase 1 liefert Skript, Validator, Cache und den Flex-Wrap-Slot, aber erst nach Designer-Mock und Philips OK (Abnahme, Gate). Abspielen bis die MP3 da ist nur über Phase 0, mit sichtbarem Hinweis „nicht im gesperrten Display“. Die MP3 kommt über den bestehenden OpenRouter-Key. Im Katalog vom 26.11. hat `microsoft/mai-voice-2.1` MP3 und eine `de-DE`-Stimme. Gemini-TTS auf OpenRouter liefert dort kein MP3. Haiku bleibt das Schreibmodell und spricht nicht.

---

## E. Hosting

Im Repo liegen **keine** `vercel.json` und **keine** `render.yaml`. Belegt ist:

- `Dockerfile`: `node:20-slim`, `EXPOSE 5000`, `CMD ["node", "dist/index.cjs"]`, Cache-Verzeichnis `.cache` im Image.
- `server/index.ts` Zeilen 138–147: `listen` auf `0.0.0.0` und `PORT` oder 5000. Kommentar Zeilen 31–32 und 90–96: Render sitzt davor, Keep-Alive gegen Einschlafen des Free-Plans. Dateisystem dort ist flüchtig (Render-Doku zum ephemeren Filesystem; der bestehende Disk-Cache liegt in SQLite unter `.cache` und überlebt keinen neuen Container ohne Disk).

Folgerung für Audio:

- Der Dienst ist ein langlebiger Node-Prozess, keine Vercel-Function. Vercel-Grenzen gelten hier nicht, solange niemand den Podcast dorthin verschiebt: Antwortkörper ohne Streaming 4,5 MB, Laufzeit je nach Plan ([Vercel Function Limits](https://vercel.com/docs/functions/limitations)). Ein Kapitel-MP3 von ein bis zwei Minuten liegt darunter; das ganze Skript als Base64 in einem JSON wäre der schlechte Weg.
- Render erlaubt HTTP-Antworten bis 100 Minuten ([Render vs Vercel](https://render.com/docs/render-vs-vercel-comparison)). Der Engpass im Repo ist der eigene 30-s-LLM-Timeout, nicht das Plattformlimit. Audio je Kapitel streamen, nicht 100 Minuten blockieren.
- MP3 nicht als einzige Kopie nach `.cache` auf der Instanz schreiben. Prozess-Cache plus Neuerzeugung aus dem Skript-Hash reicht, solange Philip keinen Blob-Speicher freigibt. Der Skript-Text darf in den bestehenden Disk-Cache (7 Tage, Schlüssel = Hash), weil er klein ist und bei Verlust neu entsteht.

---

## F. Risiken, Abnahme, Aufwand

### Risiken

- #435 und #464 nicht versehentlich mergen: sie lassen das Modell Zahlen schreiben bzw. bleiben bei `speechSynthesis`.
- #475 ändert dieselbe Karte. Ein Bau ohne Rebase überschreibt die Ampel.
- `SectionCard` `overflow-hidden` schneidet einen zu breiten Player ab, wenn er nicht umbricht.
- Flex-Kind ohne `min-w-0` / `w-fit` macht die g*-Zeile entweder immer zur vollen Breite (Player immer darunter) oder überläuft (Zeile abgeschnitten).
- Das Geschäftsjahres-Wachstum als Quartalsvergleich, als Umsatz über vier Quartale oder mit „seit Jahresbeginn“ zu sprechen wäre eine falsche Zahl. Es heißt „Geschäftsjahr“ und kommt aus `revenueGrowth` (B3). Fehlt die Segmentliste, heißt der Satz „Hauptumsatzträger liegt nicht vor“.
- Ein Flex-Player im DOM von Sektion 1 verändert das PDF, weil `captureSections` die Karte fotografiert (`exportPdf.ts` 61–82, `windowWidth` mindestens 1024).
- `DCF_CALIBRATION.enabled` anzufassen, um eine Spanne zu bekommen, ist verboten (#526).
- Ein Podcast-Handler, der `POST /api/analyze` oder `trackFmpCall` in Phase 1 auslöst, verbraucht Budget und kann den Score-Pfad berühren. Phase 1 hat keinen FMP-Call.
- Ephemerer Render-Disk: Audio-Dateien dort gelten als weg.

### Abnahme

0. Gate: Vor dem Designer-Mock und vor Philips OK dazu gibt es keinen Bauauftrag. Slot und Flex-Wrap sind schon festgelegt und werden nicht noch einmal entschieden.
1. Fünf Ticker, darunter einer mit langem Firmennamen und einer ohne Call-Datum oder ohne WACC. Viewports 375, 768 und 1280 px. Auf dem Desktop steht der Player rechts neben der g*-Zeile, auf Mobile per Flex-Wrap darunter, über dem Katalysator-Hinweis. Die Zeile wird nicht abgeschnitten und nicht überdeckt. Kein fester Breakpoint.
2. Ampel-Klassen und der Wortlaut der g*-Zeile bleiben. Einziger DOM-Zuwachs im Slot ist der Wrapper plus der Player.
3. Kein `n/a` an einer Stelle, an der heute ein Wert steht. Fehlendes heißt „liegt nicht vor“. `Call n/v` in der sichtbaren Zeile bleibt, wie `formatEarningsCall` es heute schreibt; der gesprochene Satz sagt „ein Call-Termin liegt nicht vor“.
4. Validator-Test grün: Positivliste lässt S17, Q3, H100, B200, 3-nm, eine Jahreszahl, ein GJ-Kürzel und S&P 500 durch. Ein NVDA-Skript mit Produktnamen hat keinen Fehlalarm. Eine erfundene Ziffer im Freitext wird abgelehnt. „H100“ besteht. „vierzehn Prozent“ wird abgelehnt. „YTD“ und „seit Jahresbeginn“ werden abgelehnt. Fehlender Wert entfernt den Satz. Contra-Länge ≥ Pro-Länge. Inversion immer ein Kapitel. Disclaimer immer. Steht S17 auf „generisch (Sektor)“, sagt das Skript diesen Wortlaut und nennt die Katalysatoren nicht unternehmensspezifisch. Die DCF-Spanne fehlt, solange der Server die Zelle aus `Section5.tsx` 193–204 mit `gd === 0` und `wd` ±1 nicht ins JSON schreibt.
5. Score, Rating, Entry, `dcfFairValue` vor und nach dem Abspielen identisch. Kein Aufruf von `POST /api/analyze` aus `usePodcast`. Erzeugung nur auf Klick. Ein zweiter Klick desselben Tickers am selben Tag in Europe/Madrid erhält 429, ein Cache-Treffer nicht.
6. Gesperrtes iPhone ist erst mit Phase Audio abgenommen. Phase 0 dokumentiert die Lücke im Player.
7. PDF: Vorher- und Nachher-Export desselben Tickers bleibt Pflicht. Der Player trägt `data-html2canvas-ignore`. `captureSections` (`exportPdf.ts` 62 und 71) nutzt html2canvas 1.4.1 ohne eigene `ignoreElements`-Funktion. Die Bibliothek überspringt das Attribut in `appendChildNode` (B7). Im Bild ist kein Player. Der Nachweis zeigt denselben Umbruch der g*-Zeile wie vor dem Wrapper.
8. DCF-Spanne: `dcf_low` ist WACC+1, `dcf_high` ist WACC−1. Test `value(WACC+1) ≤ fair ≤ value(WACC−1)`, wenn die Spanne gesprochen wird. Die Sperre `(WACC − 1 − params.terminalG) < 1` Prozentpunkt läuft vor `calculateFCFFDCF`. Testfall: der 25-fach-Deckel in Zeile 715 würde greifen, die Spanne wird trotzdem nicht gesprochen.
9. Verschieben der Matrix nach `shared/valuation-signal.ts` ohne Formeländerung. Fünf Tester-Ticker: jede Section-5-Zelle vor und nach dem Umbau bitgleich (`Object.is`). Screenshot der Sektion 5 vorher und nachher. Regressionsschutz für eine sichtbare Sektion.
10. Rundung auf drei signifikante Stellen für Kurs, fair, low, high und Entry. Die Rangfolge dieser fünf Werte bleibt nach dem Runden erhalten. Ein Gleichstand wird mit vier Stellen gesprochen oder der Satz fällt weg.

### Aufwand, technisch, keine Kalenderdauer

- Phase 1: neue Module `podcast-facts`, `podcast-script`, Route, Zod, Hook, Player, ein Wrapper in `ExecSummaryCard.tsx`. `analyze-route.ts`, `fazit-signal.ts` und `buildExecSummary` bleiben. Tests als `script/test-ki-podcast-placeholders.ts` nach dem Muster der bestehenden `tsx`-Skripte, ohne Netz.
- Phase 2: Anbindung an `buildEarningsBrief`, Vergleich mit `lastReportedQuarter`, zwei FMP-Zähler wie heute. Kein neuer FMP-Endpunkt.
- Phase 3: Filter auf `newsItems` (14 Tage, drei Stück, Quelle, Datum, Alterssatz). Keine neue News-Route.
- Phase Audio: Provider hinter einer Schnittstelle, Streaming-Route, Media Session, Cache-Key um `voice` ergänzt (ist von Anfang an Teil des Hash, auch wenn Phase 0 die Stimme `browser` heißt). Abhängigkeit: Freigabe des TTS-Zugangs.

### Entscheidungen vom 26.11.2026, 13:10 Europe/Madrid, über den Stabschef

1. Platz: Desktop rechts neben der g*-Zeile, Mobile per Flex-Wrap darunter. Look offen bis Designer-Mock und Philips OK. Vor diesem OK kein Bauauftrag (Abnahme, Gate).
2. TTS: bestehender `OPENROUTER_API_KEY`, `POST /api/v1/audio/speech`. Kein neuer Key, keine neue Env-Variable. Tagesobergrenze und 429 wie in C6.
3. Umsatz: Geschäftsjahres-Wachstum aus `revenueGrowth` (`analyze-route.ts` 688–693), gesprochen als „Geschäftsjahr“. „liegt nicht vor“ nur, wenn der Vorjahresumsatz fehlt. „Hauptumsatzträger liegt nicht vor“ bleibt bei fehlenden Segmenten.
4. #435 und #464 bleiben offen, nicht mergen (Philip 26.11.2026 13:11). Grund: Philip kann nicht beurteilen, ob dort OpenRouter benutzt wurde, und der Player saß dort an der falschen Stelle.

Offen bleibt nur die Mock-Freigabe des Looks.

---

## Soll gegen Ist

| Wunsch | Ist auf `0247d57b` | Soll, ohne den Wunsch umzudeuten |
|---|---|---|
| Player rechts unter der Ampel, neben der g*-Zeile | Absatz 111–114, volle Breite, kein Player | Philip 26.11. 13:10: Desktop rechts neben der Zeile, Mobile per Flex-Wrap darunter. Look-Mock und Philips OK sind das Bau-Gate |
| Fester Breakpoint 375/Desktop | keiner an der Zeile | keiner. Wrap. Abnahme bei 375, 768, 1280 |
| KI-Analyse-Button liefert den Text | Toolbar „KI“ startet `/api/analyze`. Chat ist separat. g*-Zeile ist schon `execSummary` | Podcast liest den geladenen Stand. These nur wenn `growthThesis` schon da ist |
| Zahlen nie vom Modell | Markt-Podcast bittet nur darum; #435 prüft es nicht hart | Platzhalter, Positivliste, Zahlwörter vor Prozent und Größen, Test |
| WACC ±1 Pp | Matrix nur im Client, Zeilen 189–208, gekoppelt mit Wachstum ±2. `g_TV` ist `terminalG`. Zeile 715 deckelt auf das 25-Fache | Reines Verschieben nach `shared/`, Zellen bitgleich, Screenshot Sektion 5. `dcf_low` = WACC+1, `dcf_high` = WACC−1. Sperre `(WACC − 1 − terminalG) < 1` Pp vor `calculateFCFFDCF` |
| Umsatz und Top-Segment | `revenueGrowth` Zeilen 688–693 und 1814–1815, GJ-Jahr nur lokal in Zeile 864. Segmente optional | Gesprochen als „Geschäftsjahr“. „liegt nicht vor“ nur ohne Vorjahresumsatz. Segment fehlt: „Hauptumsatzträger liegt nicht vor“. „YTD“ und „seit Jahresbeginn“ sind verboten |
| S17 generisch | `catalystsModeLabel`, Karte zeigt den Wortlaut | Podcast spricht denselben Wortlaut und nennt die Liste nicht firmenspezifisch |
| PDF | Screenshot der Sektion, Headline nicht als Textfeld. html2canvas 1.4.1 ohne `ignoreElements` | Player mit `data-html2canvas-ignore`, Vorher/Nachher-PDF Pflicht |
| Kosten | FMP-Tagesbudget global, Chat 20 je Minute je IP | Erzeugung nur auf Klick, Tagesobergrenze je Ticker nach `chatRateLimited`, MP3 ohne kursabhängige Zahl wiederverwendbar |
| Earnings-Transkript | FMP-Route des Chats, 2 Budget-Calls, nicht im Payload | Phase 2, sonst Kapitel „liegt nicht vor“ |
| News | `newsItems` im Analyze, keine News-Route | Phase 3, max. 3 aus 14 Tagen |
| Cache Ticker+Stand+Version | Markt-Cache nur Symbol, 7 Tage | Hash(JSON)+`promptVersion`+`voice`, sichtbarer Stand |
| Seek, Tempo, gesperrtes iPhone | nichts | MP3 + Media Session nach Freigabe; `speechSynthesis` nur Phase 0 |
| Kein Einfluss auf Score/Entry/Rating | Markt-Route liest die Analyse nicht | bleibt so; kein Schreiben in die Analyse |
