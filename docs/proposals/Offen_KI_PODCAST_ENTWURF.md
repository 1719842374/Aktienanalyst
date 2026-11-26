# Entwurf: KI-Podcast-Button (Ideengenerierung)

Stand der Prüfung: 26.11.2026. Nur Dokumentation. Kein Produktcode, kein Score, kein Rating, kein Entry, kein Merge auf `main`.

**main-SHA:** `0247d57bd00ff456318a5e8427b1143c8513b829` (`ci: Sperre DCF_CALIBRATION.enabled auf false`, #526).

**Platzierung und Look sind eine Design-Frage.** Philip gibt frei über Stabschef/Designer, bevor gebaut wird. Dieser Text legt die Technik fest und entscheidet das Aussehen nicht.

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

Nicht mergen, nicht als Ist behandeln.

| PR | Bezug | Folge für diesen Entwurf |
|---|---|---|
| [#435](https://github.com/1719842374/Aktienanalyst/pull/435) `cursor/stock-podcast-player-a101` | Aktien-Player, Piper, `POST /api/stock-podcast/:symbol`, Browser-Fallback. Skript lässt das Modell Zahlen schreiben. Cache-Key ist Ticker+Quartal, nicht der Hash der Kennzahlen. Liegt in Section 2, nicht an der g*-Zeile | Vom Platzhalter-Validator abgelöst. Nicht mergen. Player-Chrom nur nach diesem Entwurf und nach Philip-OK neu schneiden |
| [#464](https://github.com/1719842374/Aktienanalyst/pull/464) `cursor/podcast-browser-speech-428a` | `speechSynthesis` für den Researcher-Podcast | Kein Media-Session-Ziel, nicht der Aktien-Slot. Nicht mergen |
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
| Umsatz „YTD“ | **kein Feld** | Jahres-YoY: `financialStatements.incomeStatement.revenueGrowth`, berechnet als letztes Geschäftsjahr gegen das Vorjahr (`analyze-route.ts` 688–693) | kein Kalender-YTD, kein Geschäftsjahr-YTD, Quartalsreihen nicht auf dem Payload (`quarterlyRevenueChronological` nur intern fürs Scoring, Zeilen 1655–1668 und 1869) |
| Top-Segment | `revenueSegments[]` (`name`, `revenue`, `percentage`, `growth`, `fiscalYear`, `source`) | ja, wenn FMP/SEC/kuratiert etwas lief. Sonst `revenueSegmentsSource: "none"` und `revenueSegmentsMessage` | `segment-gap-route.ts` ist nicht auf main (nur PR #492) |
| Earnings-Call-**Termin** | `nextEarningsDate`, `lastReportedQuarter`, `nextEarningsIsEstimate` | ja | das ist der Termin, nicht das Transkript |
| Earnings-Call-**Transkript** | nicht auf `StockAnalysis` | separater, schon vorhandener Pfad: `useEarningsBrief` → `GET /api/chat/earnings-brief/:symbol` → `buildEarningsBrief` (`server/chat-earnings-route.ts`). Zwei FMP-Calls: `fmpEarningCallTranscriptDates` und `fmpEarningCallTranscript` (`server/fmp.ts` 1228–1238). Cache ist eine `Map` im Prozess, Schlüssel nur das Symbol | nicht im Analyze-Payload. Für Phase 2, nicht für Phase 1 |
| News | `newsItems[]` (`title`, `source`, `pubDate`, `url`, `relativeTime`), gefüllt in `analyze-route.ts` etwa 1340 über `fetchNewsFromGoogleRSS` (`server/news-peers.ts` 97–102) | ja, mit dem Analyze | keine eigene `/api/news`-Route. Alter und 14-Tage-Filter für den Podcast existieren nicht |

Berichtswährung: Listing `data.currency`. Statement-Währung für DCF/Entry wie in `exec-summary.ts` `currencyWord` (JOB D). Jahresumsatzwachstum ist der Geschäftsjahresvergleich, nicht „year to date“.

### B4. DCF-Spanne WACC ±1 Prozentpunkt

Vorhanden, aber nicht als Serverfeld und nicht als reine ±1-Funktion.

`client/src/components/sections/Section5.tsx` `sensitivityMatrix` (Zeilen 186–209) ruft `calculateFCFFDCF` (`shared/valuation-signal.ts` Zeile 609) mit `waccDeltas = [-1, 0, 1]` **und** `growthDeltas = [-2, 0, 2]`. Die Zelle Wachstum 0 und WACC ±1 ist dieselbe Pipeline wie der angezeigte DCF, nur mit `waccOverride: mainResult.wacc + wd`.

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

KI: kein eigenes Token-Kontingent im Repo. OpenRouter antwortet 402, `llm-openrouter.ts` loggt „token budget exhausted“ und bricht die Runde ab. `callLLMJson` deckelt `max_tokens` bei 4000. Der Markt-Podcast nutzt 2800 Tokens und 30 s (`PODCAST_LLM_TIMEOUT_MS` = `CHAT_LLM_TIMEOUT_MS`).

---

## C. Soll

### C1. Grundsatz

Der Button liest den **schon geladenen** Analyse-Stand. Er ruft nicht `POST /api/analyze` auf, schreibt `scoring`, `dcfFairValue`, `maxEntryCrv3`, Rating und Entry nicht zurück und erzeugt kein eigenes Kursziel und kein eigenes Rating.

Zahlen erzeugt das Modell nicht. Es schreibt Fließtext mit Platzhaltern. Code setzt Werte ein, rundet und spricht sie aus.

### C2. Platzhalter

Geschlossene Liste. Alles andere ist ein unbekannter Platzhalter und verwirft den Satz.

`{ticker}` `{company}` `{as_of}` `{currency_word}` `{statement_currency_word}` `{price}` `{score}` `{ampel}` `{wacc}` `{g_star}` `{dcf_fair}` `{dcf_low}` `{dcf_high}` `{entry}` `{crv}` `{fy_yoy}` `{top_segment}` `{top_segment_share}` `{call_date}` `{call_quarter}` `{news_1}` `{news_2}` `{news_3}` `{news_age}`.

`{ytd_growth}` steht in der Wunschliste, hat auf `main` keinen Wert. Der Builder nimmt ihn nicht in das JSON auf. Der Validator entfernt den Satz oder setzt „liegt nicht vor“. Erfindet kein YTD.

`{dcf_low}` und `{dcf_high}` nur, wenn die Spanne aus C5 zustande kommt. Sonst ebenso weglassen.

Validator, rein, ohne Netz, geplante Datei `shared/podcast-script.ts`, Test `script/test-ki-podcast-placeholders.ts`:

- (a) Im LLM-Text steht keine Ziffer (`/\d/`). Prozentzeichen, Währungskürzel und Daten schreibt das Modell nicht.
- (b) Jeder `{name}`-Treffer steht in der Liste.
- (c) Jeder erlaubte Platzhalter im Satz hat einen endlichen Wert oder einen freigegebenen Text im JSON. Sonst fällt der Satz weg. Bleibt vom Kapitel nichts, spricht das Kapitel „liegt nicht vor“.
- Ein Satz mit einer Ziffer oder einem fremden Platzhalter wird verworfen, nicht nachgebessert durch das Modell in derselben Antwort. Ein zweiter Versuch ist erlaubt, höchstens einer, mit demselben JSON. Scheitert er, fällt das Kapitel auf die festen Sätze ohne Modell zurück (nur Platzhalter aus dem JSON, plus „liegt nicht vor“).

Rundung vor der Sprechform, eine Stelle, danach Worte:

- Prozent eine Nachkommastelle: `11,4` wird „elf Komma vier Prozent“.
- Kurs ganzzahlig in der gesprochenen Form: `149,3` wird „einhundertneunundvierzig“ plus Währungswort. Die g*-Zeile auf dem Schirm bleibt bei der heutigen Anzeige (`fmtPx`, bis zwei Nachkommastellen). Der Player ändert die Zeile nicht.
- Beträge ab 1e9: „… Milliarden“ plus Währungswort. Ab 1e12: „Billionen“. Darunter „Millionen“, wenn der bestehende `fmtMoney` in `exec-summary.ts` 106–110 die Schwelle 1e6 nutzt; dieselbe Schwelle, ausgeschrieben.
- Datum `24.02.2027` wird „vierundzwanzigster Februar zweitausendsiebenundzwanzig“.

### C3. Kapitel, Länge, Ausgewogenheit

Feste Reihenfolge. Ziel 800–1000 Wörter gesamt, gesprochen etwa 6–7 Minuten bei 140 Wörtern je Minute. Kürzer als 3 Minuten nur, wenn mehrere Kapitel „liegt nicht vor“ sind. Nicht künstlich strecken. Jedes Kapitel endet mit einem Hinweis, der im Player anspringbar ist.

| # | Kapitel | Phase | Quelle, nur vorhandene Felder |
|---|---|---|---|
| 1 | Einstieg | 1 | Ticker, Name, Datenstand (`dataTimestamp` oder `_cachedAt`), Ampel-Wort. Erster Satz nennt den Stand |
| 2 | Executive Summary | 1 | `execSummary.pro` / `contra`, Fazit-Sätze. Pro wird auf die Länge des Contra-Blocks gekürzt, nie umgekehrt mit erfundenen Punkten gefüllt |
| 3 | These | 1 | `growthThesis`, sonst „liegt nicht vor“ |
| 4 | Umsatz | 1 | Jahres-YoY als Geschäftsjahr gegen Vorjahr, Berichtswährung ansagen. Top-Segment mit `percentage` und `fiscalYear`. Kein YTD |
| 5 | Earnings Call | 2 | Nur Phase 2. Transkript älter als `lastReportedQuarter`: Kapitel entfällt mit einem Satz, der das Alter nennt. Fehlende Quelle: „liegt nicht vor“ |
| 6 | DCF | 1 | fair, optional Spanne, g*, WACC, Entry, CRV. Kein neues Kursziel |
| 7 | S17 | 1 | Katalysatoren mit Name, PoS, GB, nur als Platzhalter |
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

**Design-Frage, nicht entschieden:** ob der Player überhaupt neben der g*-Zeile sitzt, und wie er aussieht. Philip über Stabschef/Designer.

**Technik, sobald der Slot freigegeben ist:** kein fester Breakpoint, kein `sm:`/`md:`-Wechsel zwischen „inline“ und „eigene Zeile“. Ein Wrapper um Absatz und Player:

`className="flex flex-wrap items-center gap-x-3 gap-y-2"`.

- Die g*-Zeile bleibt **ein** Textknoten (`execSummary.headline`). `min-w-0 max-w-full w-fit break-words`. Kein `truncate`, kein `whitespace-nowrap`.
- Der Player ist das nächste Flex-Kind, `shrink-0 min-w-[min(100%,16rem)] max-w-full`. Die 16 rem sind die Mindestbreite des Players, nicht eine Viewport-Grenze. Reicht der Rest der Zeile nicht, setzt `flex-wrap` ihn in die nächste Zeile, volle verfügbare Breite.
- Der Hinweis `exec-summary-mode` („Katalysatoren: generisch (Sektor)“) bleibt **unter** dem Wrapper, Reihenfolge wie heute: Ampel, dann Zeile+Player, dann Hinweis.
- Kein `position: fixed` und kein Andocken unten rechts. Dort liegt der KI-Chat (`bottom-4 right-4 z-40`).
- `SectionCard` hat `overflow-hidden`. Der Wrapper lebt im normalen Fluss der Karte, damit die Zeile nicht abgeschnitten wird.

Die bestehende `<p>`-Zeile erlaubt das **nicht ohne diesen Wrapper**. `buildExecSummary` und die Ampel-Klassen bleiben. Die Ampel-Zeile (`justify-between`) wird nicht zum Player-Container.

Akzeptanz Layout, fünf Ticker, Viewports 375, 768 und 1280 px: die g*-Zeile ist vollständig lesbar, der Player überlappt sie nicht. Darunter ein Ticker mit langem Namen und einer ohne Call-Datum oder ohne WACC (`Call n/v` bzw. g* ohne WACC-Klammer, beides kann der heutige Builder). Der Live-Befund (1920 px viel freier Raum, 500 px wenig, 375 px Umbruch des Absatzes) begründet nur, warum Wrap nötig ist. Er wird nicht als `@media` abgeschrieben.

Komponente, neu, erst nach Freigabe: `client/src/components/sections/PodcastPlayer.tsx`. Vorhandene Bausteine: `client/src/components/ui/button.tsx`, `client/src/components/ui/slider.tsx` (Radix/shadcn, schon im Repo). Steuerung: Play/Pause, Geschwindigkeit, Fortschritt, Sprung ±15 s, Kapitelliste. Phase 0 spricht über `speechSynthesis` (Rate nativ, Sprung nur satzweise). Ziel-Audio ist `<audio>` mit `playbackRate` und Media Session (C8).

Hook `client/src/hooks/usePodcast.ts`: liest `data` aus dem Dashboard, kein `useMutation` auf `/api/analyze`. Skript: `POST /api/podcast/script` mit dem Fakten-JSON. Audio, erst nach Freigabe: `GET /api/podcast/audio/:id` je Kapitel.

### C5. DCF-Spanne im MVP

Die Spanne kommt nur aus dem vorhandenen Aufruf:

`calculateFCFFDCF({ ...dieselben Parameter wie der angezeigte Hauptdurchlauf in Section 5, waccOverride: angezeigteWacc ± 1 })`.

Wachstum, Margin und ERP bleiben die des angezeigten Laufs (die Matrix-Zelle mit Wachstumsdifferenz 0). Optimistic und Macro-Stress sind verboten. `DCF_CALIBRATION.enabled` bleibt `false`.

Liefern die beiden Läufe keine endliche Zahl je Aktie, fehlen `{dcf_low}` und `{dcf_high}`. Es wird keine zweite DCF-Formel geschrieben. Die Ergebnisse werden nicht nach `dcfFairValue` oder in den Score zurückgeschrieben.

### C6. Server, Schema, Cache, Budget

| Stufe | Neu, additiv | Tut |
|---|---|---|
| Fakten | `shared/podcast-facts.ts` `buildPodcastFacts(analysis)` | Nur kopieren und die eine erlaubte `calculateFCFFDCF`-Spanne rechnen. Fehlendes Feld bleibt `null` |
| Skript | `shared/podcast-script.ts` | Prompt mit der Platzhalterliste, Validator, Rundung, Sprechform, Kapitel, Disclaimer |
| Schema | `shared/schema.ts` | `podcastScriptRequestSchema` (Zod): Ticker, `facts`, `promptVersion`. Antwort: Kapitel `{ id, title, template, spoken }`, `asOf`, `cacheKey`, `voice`. Kein Feld, das Score oder Entry schreibt |
| Route | `server/stock-podcast-route.ts` `POST /api/podcast/script` | Baut Fakten aus dem **mitgeschickten** Analyse-Objekt, ruft das bestehende `callLLMJson` (Haiku-Kette, kein Audio-Modell), validiert, cacht. Timeout 30 s wie der Chat. Kein FMP in Phase 1 |
| Audio | `GET /api/podcast/audio/:chapterId` | Erst Phase Audio. `Content-Type: audio/mpeg`, je Kapitel, nicht Base64 im Skript-JSON |
| Registrierung | `server/routes-register.ts` | neben der bestehenden Markt-Route, die unverändert bleibt |

Cache-Key = SHA-256 des kanonischen Fakten-JSON plus `promptVersion` plus `voice`. Preis, Score oder ein Katalysator im JSON ändern den Key. Anzeige am Player: „Stand: …“ aus `asOf` (ISO des `dataTimestamp`). TTL wie der Disk-Cache, 7 Tage, zusätzlich an den Hash gebunden: abgelaufener Eintrag wird neu erzeugt, ein neuer Hash auch vorher. Der Markt-Key `podcast_transcript__SYMBOL` wird nicht wiederverwendet.

Budget: ein Skript-Call, Deckel 1500 Ausgabe-Tokens (800–1000 Wörter plus JSON-Gerüst; der heutige `callLLMJson`-Deckel 4000 bleibt die harte Grenze). Cache-Treffer kosten keinen Call. Phase 2 zusätzlich höchstens die zwei schon vorhandenen FMP-Transcript-Calls, und nur wenn der Earnings-Brief für das Symbol nicht schon im Prozess-Cache liegt. 402 von OpenRouter: Kapitel „liegt nicht vor“, kein Retry-Sturm.

### C7. Phasen

| Phase | Inhalt | Audio |
|---|---|---|
| 0 | kein eigener Lieferumfang | `speechSynthesis` nur als Notnagel, siehe D |
| 1 | Kapitel 1–4, 6–8, 10, Player, Cache, Validator, Flex-Wrap-Slot | Notnagel Phase 0, bis Phase Audio da ist. Gesperrtes iPhone ist damit nicht erfüllt |
| 2 | Kapitel 5, bestehender Earnings-Brief, Altersvergleich mit `lastReportedQuarter` | dasselbe Audio wie die anderen Kapitel |
| 3 | Kapitel 9 aus `newsItems`, 14 Tage, max. 3, Quelle und Datum | dasselbe |
| Audio | MP3 je Kapitel, `<audio>`, Media Session, Seek, `playbackRate` | **blockiert**, bis Philip einen TTS-Zugang freigibt (neuer Key oder ausdrückliche Freigabe, den bestehenden OpenRouter-Key für `/api/v1/audio/speech` zu benutzen) |

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

Ein TTS-Call über den bestehenden `OPENROUTER_API_KEY` ist ein neuer Kostenpfad auf demselben Konto, auch wenn kein zweiter Key nötig ist. Das bleibt die offene Freigabe-Frage (F).

### 3. Dedizierte TTS-API, MP3, echtes `<audio>`

Damit funktionieren Seek, `playbackRate` und Media Session.

| Weg | Beleg 26.11.2026 | Grobe Kosten je Ticker |
|---|---|---|
| OpenAI `tts-1` / `tts-1-hd` | [Pricing](https://developers.openai.com/api/docs/pricing): 15 USD bzw. 30 USD je 1 Mio. Zeichen. Dieselben Modelle plus `gpt-4o-mini-tts` sind zur Abschaltung am 06.01.2027 genannt ([AssemblyAI, 19.11.2026](https://www.assemblyai.com/blog/tts-api-pricing)) | 800–1000 deutsche Wörter, grob 6–8 Tausend Zeichen: etwa 0,09–0,12 USD (`tts-1`) bzw. 0,18–0,24 USD (`tts-1-hd`). Nicht bauen auf ein Modell, das in sechs Wochen abgeschaltet wird, ohne den Nachfolger zu prüfen |
| OpenAI `gpt-4o-mini-tts` | dieselbe Pricing-Seite: 0,60 USD je 1 Mio. Text-Tokens Input, 12 USD je 1 Mio. Audio-Tokens Output. Kein Zeichenpreis. Drittschätzung etwa 0,06 USD je 1000 Zeichen ([LLM Data Hub, Nov 2026](https://llm.okamomedia.tokyo/en/speech-api-pricing/)) | grob 0,36–0,50 USD, unsicher, weil die Audio-Token je Sekunde nicht von OpenAI veröffentlicht sind |
| Google Cloud TTS / ElevenLabs direkt | nicht als Zeichenpreis in diesem Lauf von der Herstellerseite gezogen. OpenRouter listet Eleven und Gemini-TTS bereits (oben). Ein eigener Key ist ein neuer Tool-Zugang | vor der Freigabe die dann gültige Preisseite lesen. Nicht aus dem Gedächtnis einsetzen |
| Skript-LLM, getrennt von der Stimme | bestehendes Haiku 4.5, Kommentar `llm-openrouter.ts` Zeilen 46–49: 1 USD / 5 USD je 1 Mio. Tokens | ein Kapitel-JSON, grob 2–4 Tausend Tokens Input und unter 1500 Output: unter 0,02 USD. Cache-Treffer 0 |

Empfehlung: Phase 1 liefert Skript, Validator, Cache und den Flex-Wrap-Slot. Abspielen in Phase 1 nur über Phase 0, mit sichtbarem Hinweis „nicht im gesperrten Display“. Phase Audio, sobald Philip freigibt: MP3, vorzugsweise eine Stimme mit `de-DE` im Katalog (`microsoft/mai-voice-2.1` über den bestehenden OpenRouter-Key **oder** ein eigener TTS-Key). Gemini-TTS auf OpenRouter liefert im Katalog kein MP3; das wäre ein zusätzlicher PCM/WAV-Schritt und ist nicht der kürzeste Weg zu `<audio>`. Haiku bleibt das Schreibmodell und spricht nicht.

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
- Jahres-YoY als „YTD“ zu sprechen wäre eine falsche Zahl. Das Feld heißt im Skript `{fy_yoy}` und der Satz nennt Geschäftsjahr und Währung.
- `DCF_CALIBRATION.enabled` anzufassen, um eine Spanne zu bekommen, ist verboten (#526).
- Ein Podcast-Handler, der `POST /api/analyze` oder `trackFmpCall` in Phase 1 auslöst, verbraucht Budget und kann den Score-Pfad berühren. Phase 1 hat keinen FMP-Call.
- Ephemerer Render-Disk: Audio-Dateien dort gelten als weg.

### Abnahme

1. Fünf Ticker, darunter einer mit langem Firmennamen und einer ohne Call-Datum oder ohne WACC. Viewports 375, 768 und 1280 px. Die g*-Zeile ist komplett sichtbar und wird vom Player nicht überdeckt. Wrap ohne Media-Query: bei wenig Restbreite steht der Player in der Zeile unter der g*-Zeile und über dem Katalysator-Hinweis.
2. Ampel-Klassen und der Wortlaut der g*-Zeile bleiben. Einziger DOM-Zuwachs im Slot ist der Wrapper plus der Player.
3. Kein `n/a` an einer Stelle, an der heute ein Wert steht. Fehlendes heißt „liegt nicht vor“. `Call n/v` in der sichtbaren Zeile bleibt, wie `formatEarningsCall` es heute schreibt; der gesprochene Satz sagt „ein Call-Termin liegt nicht vor“.
4. Validator-Test grün: keine Ziffer im Modelltext, nur bekannte Platzhalter, fehlender Wert entfernt den Satz, Contra-Länge ≥ Pro-Länge, Inversion immer ein Kapitel, Disclaimer immer, Cache-Key ändert sich mit dem Kurs.
5. Score, Rating, Entry, `dcfFairValue` vor und nach dem Abspielen identisch. Kein Aufruf von `POST /api/analyze` aus `usePodcast`.
6. Gesperrtes iPhone ist erst mit Phase Audio abgenommen. Phase 0 dokumentiert die Lücke im Player.

### Aufwand, technisch, keine Kalenderdauer

- Phase 1: neue Module `podcast-facts`, `podcast-script`, Route, Zod, Hook, Player, ein Wrapper in `ExecSummaryCard.tsx`. `analyze-route.ts`, `fazit-signal.ts` und `buildExecSummary` bleiben. Tests als `script/test-ki-podcast-placeholders.ts` nach dem Muster der bestehenden `tsx`-Skripte, ohne Netz.
- Phase 2: Anbindung an `buildEarningsBrief`, Vergleich mit `lastReportedQuarter`, zwei FMP-Zähler wie heute. Kein neuer FMP-Endpunkt.
- Phase 3: Filter auf `newsItems` (14 Tage, drei Stück, Quelle, Datum, Alterssatz). Keine neue News-Route.
- Phase Audio: Provider hinter einer Schnittstelle, Streaming-Route, Media Session, Cache-Key um `voice` ergänzt (ist von Anfang an Teil des Hash, auch wenn Phase 0 die Stimme `browser` heißt). Abhängigkeit: Freigabe des TTS-Zugangs.

### Offene Fragen an Philip

1. Slot neben der g*-Zeile und das Aussehen des Players. Flex-Wrap ist der technische Vorschlag, nicht die Freigabe.
2. TTS-Zugang: neuer Anbieter-Key, oder der bestehende OpenRouter-Key für `/api/v1/audio/speech` (Katalogmodell mit MP3 und `de-DE`, zum Beispiel `microsoft/mai-voice-2.1`). Ohne diese Antwort bleibt es bei Phase 0.
3. Darf `{fy_yoy}` im Umsatz-Kapitel vorkommen, ausdrücklich als Geschäftsjahr gegen Vorjahr und nicht als YTD? Ein echtes YTD liegt auf `main` nicht.
4. PR #435 und #464 schließen, sobald dieser Entwurf gilt, damit niemand den alten Zahlen-Pfad merget.

---

## Soll gegen Ist

| Wunsch | Ist auf `0247d57b` | Soll, ohne den Wunsch umzudeuten |
|---|---|---|
| Player rechts unter der Ampel, neben der g*-Zeile | Absatz 111–114, volle Breite, kein Player | Wrapper `flex flex-wrap`, Player-Kind mit Mindestbreite, Hinweis bleibt darunter. Look offen |
| Fester Breakpoint 375/Desktop | keiner an der Zeile | keiner. Wrap. Abnahme bei 375, 768, 1280 |
| KI-Analyse-Button liefert den Text | Toolbar „KI“ startet `/api/analyze`. Chat ist separat. g*-Zeile ist schon `execSummary` | Podcast liest den geladenen Stand. These nur wenn `growthThesis` schon da ist |
| Zahlen nie vom Modell | Markt-Podcast bittet nur darum; #435 prüft es nicht hart | Platzhalter, Validator (a)(b)(c), Test |
| WACC ±1 Pp | Matrix in Section 5, gekoppelt mit Wachstum ±2 | nur die Zelle Wachstum 0, sonst keine Spanne |
| YTD und Top-Segment | Jahres-YoY und `revenueSegments` | YoY mit Jahr und Währung; Segment oder „liegt nicht vor“; kein erfundenes YTD |
| Earnings-Transkript | FMP-Route des Chats, 2 Budget-Calls, nicht im Payload | Phase 2, sonst Kapitel „liegt nicht vor“ |
| News | `newsItems` im Analyze, keine News-Route | Phase 3, max. 3 aus 14 Tagen |
| Cache Ticker+Stand+Version | Markt-Cache nur Symbol, 7 Tage | Hash(JSON)+`promptVersion`+`voice`, sichtbarer Stand |
| Seek, Tempo, gesperrtes iPhone | nichts | MP3 + Media Session nach Freigabe; `speechSynthesis` nur Phase 0 |
| Kein Einfluss auf Score/Entry/Rating | Markt-Route liest die Analyse nicht | bleibt so; kein Schreiben in die Analyse |
