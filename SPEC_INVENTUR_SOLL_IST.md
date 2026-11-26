# SPEC_INVENTUR_SOLL_IST.md

Stand: 26.11.2026, Auftrag Philip (Stabschef). Nur Doku. Kein App-Code.

## Kopf

| | |
|---|---|
| main | `5eec205a19be43bf55bd33e51a1d94c61a4e72af` (25.11.2026 17:49 +0100, #512) |
| Code-Baum vor #512 | `65ba08dd5ea9faa00a6f8fdc8cc5277ba95c7e46` (#520) = Tree von `4220d4e9e46cecf19364d56630044b46f320d966` (#490, 11.11.2026 19:18 Europe/Madrid; Revert-Text nennt den Baum Stand 16.11.2026) |
| Nach dem Revert auf main | #521 nur Kopf von `WORK_IMPLEMENTIERUNG_OFFEN.md`; #512 DCF-Bilanz-Kalibrierung, Flag `enabled: false` |
| #523 | existiert nicht (GitHub: keine PR mit dieser Nummer). Philip-Ja zur Vorher/Nachher-Tabelle fehlt. `Offen_WORK_DCF_BILANZ_KALIBRIERUNG.md` bleibt `Offen_` |

`git diff --stat 4220d4e9 HEAD` ändert 14 Dateien. Davon Doku: `Offen_WORK_DCF_BILANZ_KALIBRIERUNG.md`, `WORK_IMPLEMENTIERUNG_OFFEN.md`, `docs/dcf-calibration-before-after.md`. Code nur die Kalibrierung hinter dem ausgeschalteten Flag (`shared/dcf-calibration.ts`, `shared/valuation-signal.ts`, `shared/bias-fixes.ts`, `shared/schema.ts`, `client/src/components/sections/Section5.tsx`, `Section6.tsx`, `server/pdf-export.ts`, Tests und Guard). Alles, was nur in den 21 First-Parent-Commits `4220d4e9..7aaa13ce` lag, ist auf main nicht mehr im Baum. Diese Punkte sind **offen**, Vermerk **revertiert durch #520**.

Geprüft ohne Live-UI. Ein ✅ ist ein Code-Beleg auf diesem SHA (Pfad und Zeile oder Merge-PR, deren Commit Ancestor von `4220d4e9` ist, plus #512). Draft-PRs zählen nicht als Ist.

## 1. Inventur Root (und docs/)

Zählung Root: `Offen_` 7, `WORK*` ohne Prefix 42 (`WORK.md` + 41 `WORK_*.md`), `Future_*` 11 (in diesem PR nach `fertig_` umbenannt), bereits `fertig_`/`Fertig_` 49. Keine eigene Datei mit Yahoo-`.DE` im Namen. `docs/` hat keine `Offen_`/`Future_`/`fertig_`-Dateien; drei `WORK*`-Dateien liegen unter `docs/` (unten).

Letzter Commit = letzter Commit auf main **vor** diesem PR.

### 1a. Offen_

| Datei | letzter Commit | Datum |
|---|---|---|
| `Offen_FUTURE_SOLL_IST.md` | `65ba08dd` | 2026-11-25 |
| `Offen_FUTURE_SOLL_IST_DETAIL.md` | `65ba08dd` | 2026-11-25 |
| `Offen_WORK_BUFFETT_ASIA_10Y.md` | `ed1e98cd` (#471) | 2026-11-09 |
| `Offen_WORK_CAPEX_SECTOR_MAP.md` | `ed1e98cd` (#471) | 2026-11-09 |
| `Offen_WORK_DCF_BILANZ_KALIBRIERUNG.md` | `5eec205a` (#512) | 2026-11-25 |
| `Offen_WORK_GOLD_MINER_BREAKEVEN.md` | `4d9c7225` (#446) | 2026-11-03 |
| `Offen_WORK_RESEARCHER_CAPEX_MAP.md` | `4d9c7225` (#446) | 2026-11-03 |

### 1b. Future_ → fertig_ (Philip 26.11.2026)

Dateistatus ist `fertig_` (klein) per Anweisung 26.11., Gegencheck. Die Umsetzungsstatus-Spalte darunter sagt, was der Code auf `5eec205a` davon enthält. Historische Sätze in anderen Dateien („Dateiname bleibt Future_…“) sind nicht umformuliert; nur Markdown-Linkziele zeigen auf den neuen Namen.

| alt | neu | letzter Commit vor diesem PR | Datum |
|---|---|---|---|
| `Future_1_Work.md` | `fertig_1_Work.md` | `170ebed1` | 2026-10-09 |
| `Future_2_NA_Fixes_Research.md` | `fertig_2_NA_Fixes_Research.md` | `671b7286` | 2026-10-09 |
| `Future_3_SerpApi_Rate_Limits.md` | `fertig_3_SerpApi_Rate_Limits.md` | `bbd5c261` | 2026-10-09 |
| `Future_4_Google_Trends_Conflict_and_Fixes.md` | `fertig_4_Google_Trends_Conflict_and_Fixes.md` | `9dfba1a6` | 2026-10-09 |
| `Future_5_Google_Trends_Cache_Implementation.md` | `fertig_5_Google_Trends_Cache_Implementation.md` | `a9719a09` | 2026-10-09 |
| `Future_6_Recession_Dashboard_Scoring_Logic.md` | `fertig_6_Recession_Dashboard_Scoring_Logic.md` | `a41f6f08` | 2026-10-09 |
| `Future_7_Scoring_Adaptivity_Historical_Crashes.md` | `fertig_7_Scoring_Adaptivity_Historical_Crashes.md` | `bf309892` | 2026-10-09 |
| `Future_8_Adaptive_Scoring_Logics_Detailed.md` | `fertig_8_Adaptive_Scoring_Logics_Detailed.md` | `e943bbe7` | 2026-10-09 |
| `Future_9_Adaptive_Macro_Framework_Complete.md` | `fertig_9_Adaptive_Macro_Framework_Complete.md` | `de3647ba` | 2026-10-09 |
| `Future_10_Gold_Adaptive_Scoring_Framework.md` | `fertig_10_Gold_Adaptive_Scoring_Framework.md` | `2172856f` | 2026-10-11 |
| `Future_Work.md` | `fertig_Work.md` | `c5f300e0` (#409) | 2026-11-01 |

### 1c. docs/

| Datei | letzter Commit | Datum | Einordnung |
|---|---|---|---|
| `docs/work-offen/WORK_RESEARCHER_BRIEFING_REGIONAL.md` | `5fc64114` (#130) | 2026-10-03 | Kopie vor dem Root-Rename. Root ist `fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md` (`191792c5`, 2026-10-04). Nicht zurück auf `Offen_` |
| `docs/Doc_Soll_vs_Ist/WORK_EXEC_SUMMARY.md` | `839d954a` (#129) | 2026-10-03 | Hub-Kopie. Root `fertig_WORK_EXEC_SUMMARY.md` |
| `docs/Doc_Soll_vs_Ist/WORK_INVENTUR_2026-11-02.md` | `d92a07e9` (#421) | 2026-11-02 | Inventur gegen `fc933a5`. Durch #520 und diese Datei überholt, nicht gelöscht |

### 1d. Bereits fertig_ / Fertig_ (49 Root-Dateien)

Nicht neu bewertet und nicht auf `Offen_` zurückgesetzt. Letzter Commit ist der Rename- oder Nachzugs-Commit, nicht ein neuer Code-Audit.

`fertig_WORK2.md` `839d954a` 2026-10-03 · `fertig_WORK.md_portfolio_3` `839d954a` · `fertig_WORK_ANALYZE_DISK_CACHE.md` `25d4be47` 2026-10-04 · `fertig_WORK_ANTIBIAS_DCF.md` `839d954a` · `fertig_WORK_BIAS_FIXES_INVERSE_DCF.md` `25d4be47` · `fertig_WORK_BTC_MINER.md` `839d954a` · `fertig_WORK_DATA_PROVIDERS.md` `839d954a` · `fertig_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md` `87151cb3` 2026-10-05 · `fertig_WORK_EXEC_SUMMARY.md` `839d954a` · `fertig_WORK_FISCAL_FRONTEND_ADAPTIVE.md` `bafdba8b` 2026-10-05 · `fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md` `25d4be47` · `fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md` `0fbc8774` 2026-10-04 · `fertig_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md` `17d08326` 2026-10-05 · `fertig_WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md` `839d954a` · `fertig_WORK_NEWS_SENTIMENT.md` `839d954a` · `fertig_WORK_PEER_ADAPTIVE.md` `25d4be47` · `fertig_WORK_PEER_PRICING_POWER.md` `25d4be47` · `fertig_WORK_PEER_ROIC_SANITY.md` `839d954a` · `fertig_WORK_PORTFOLIO.md` `839d954a` · `fertig_WORK_PORTFOLIO_BACKTEST.md` `5fc64114` · `fertig_WORK_PORTFOLIO_SOLL_IST.md` `25d4be47` · `fertig_WORK_RECESSION_2008_DRIVERS_LLM.md` `25d4be47` · `fertig_WORK_RECESSION_FRED_SAHM.md` `87379a9a` 2026-10-05 · `fertig_WORK_RECESSION_MARKET_CHARTS.md` `25d4be47` · `fertig_WORK_RECESSION_RATE_OIL_BRIDGE.md` `25d4be47` · `fertig_WORK_RECESSION_RSI_MACD.md` `25d4be47` · `fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md` `191792c5` · `fertig_WORK_RESEARCHER_BUTTONS_APPLY.md` `839d954a` · `fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md` `839d954a` · `fertig_WORK_RESEARCHER_PORTFOLIO.md` `5fc64114` · `fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md` `5fc64114` · `fertig_WORK_RESEARCHER_SECTOR_ADD.md` `839d954a` · `fertig_WORK_REVERSE_DCF_BRIDGE.md` `839d954a` · `fertig_WORK_SCORING_VORLAGE.md` `839d954a` · `fertig_WORK_SEGMENT_DEDUP.md` `839d954a` · `fertig_WORK_SEKTORROTATIONS_RAT.md` `5fc64114` · `fertig_WORK_SIGNAL_BACKTEST.md` `5fc64114` · `fertig_WORK_STABLECOIN_TBILL_GENIUS.md` `f2a59b9a` 2026-10-04 · `fertig_WORK_TAM_RESIDUAL_XBOX.md` `839d954a` · `fertig_WORK_TAM_SEGMENT_MAPPING.md` `839d954a` · `fertig_WORK_TEIL0-6.md` `5fc64114` · `fertig_WORK_TEIL7_SCORING.md` `839d954a` · `fertig_WORK_THESIS_LAB.md` `839d954a` · `fertig_WORK_VALUECHAIN_LAB_LOOKUP.md` `839d954a` · `fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md` `191792c5` · `Fertig_MINER_INTEGRATION.md` `b952469d` 2026-10-04 · `Fertig_WORK_BITCOIN_MINER_MAP.md` `db9450b2` (#405) 2026-11-01 · `Fertig_WORK_RECESSION_SOURCES.md` `83e630ab` 2026-10-05 · `Fertig_WORK_RESEARCHER_LIQUIDITY_INDEX.md` `3fd864a7` 2026-10-05 · `Fertig_WORK_SECTION4_DATA_BUGS.md` `6e125cdf` 2026-10-05.

## 2. Soll-Ist der offenen Dateien (Abschnitte)

### Offen_FUTURE_SOLL_IST.md

Die Zeilenliste mit F-IDs steht in `Offen_FUTURE_SOLL_IST_DETAIL.md`. Hier die Abschnitte der Kompakt-Datei. Vier `.DE`/Yahoo-Zeilen aus #510 sind in diesem PR wieder entfernt (Abschnitt 6); die Nummern 1 und 3 und die Mini-PR-Zeile 4 bleiben als Lücke stehen, ohne Umnummerierung.

| Abschnitt | Status | Beleg auf `5eec205a` | Rest |
|---|---|---|---|
| Future_Work (a) 1 Peer-Add | erledigt | `shared/peer-override-persist.ts`, `server/analyze-route.ts:523–534`, Test `script/test-peer-add-rest.ts`. #258/#262 | keine für diesen Satz |
| (a) 2 i18n DE/EN | offen | keine `client/src/i18n.ts` | FW-01 |
| (a) 3 Wertschöpfungskette / Kostolany | teilweise | Sektorrotation ist `fertig_WORK_SEKTORROTATIONS_RAT.md`. Kostolany: kein Treffer in `SectorRotationPanel.tsx` | FW-04, Design |
| (a) 4 Sync Analyse/Researcher/Portfolio | teilweise | #400 gemeinsamer Refresh ist vor `4220d4e9`. Volle bidirektionale Sync nicht als eine Kette belegt | FW-05 Rest |
| (a) 5 BTC M2/Fiscal, Miner, WALCL | teilweise | WALCL-Block #266. QE/QT-Bänder und Gate `BTC_QE_QT_REGIME` in der Detail-Datei weiter 🟡 | Score nur beim Gate |
| (a) 6 Gold AISC, MA, News | teilweise | MA50 #201, AISC-Sektion #398/#399, News früher. Adaptive Schicht ändert den GIS nicht | siehe Gold-Spec |
| Future_1 (a) 2 Text bei 402 | erledigt | `server/yahoo-fetcher.ts` `YAHOO_402_NOTICE` (Detail F1-04, #252) | — |
| (a) 4 Dividende KPI/Overlay | erledigt | `TechnicalChart.tsx` Overlay, #213/#227; Band ≥ 4 % #341 `shared/dividends.ts` | Klartext „> 4 %“ vs Code „≥ 4 %“ |
| (a) 5 Credit-Karte | teilweise | #368 Karte und PESTEL vor `4220d4e9`. CDS/Rating weiter ohne freie Quelle | ⛔ Kosten |
| (a) 6 Buffett robust | erledigt | #274 `server/buffett-route.ts`, `script/test-buffett-robust.ts` | — |
| (a) 7 eine Rezessions-Chart-Sektion | offen | `RecessionDashboard.tsx:194` `RecessionTaSection` und `:196` `BuffettRatioPanel` bleiben getrennte Blöcke (F1-41) | Anzeige |
| (a) 8 Regionen-Gauges | teilweise | `RegionGaugeSwitch.tsx:10` Label weiter „Asien (Japan)“. Fünf Untergruppen je Region nicht belegt | §2 Asien, Philip Gewichte |
| (a) 9 N/A-Katalog | teilweise | Katalog existiert (`Fertig_WORK_RECESSION_SOURCES.md`). Nicht jeder Slot geschlossen | — |
| Future_2 Trends + VIX | teilweise | Trends-Cache #200 `server/cache/google-trends-cache.ts`. VIX-Fallback #296/#325/#329 | Retry-Backoff F3-04 |
| Future_3 / 4 / 5 Cache | erledigt (Soft) | #200, UI `recessionDashboardPartsB1.tsx` / `B2.tsx`. In-Memory, nicht Redis. `isStale` 24 h, Skizze nannte 6 h | keine Bau-Lücke, die den Soft blockiert |
| Future_6 Scoring-Erklärung | erledigt | reine Ist-Doku, kein Bauauftrag. Detail: 13 Regeln gegen den Code | Doku-Drift bei einzelnen Formulierungen |
| Future_7 / 8 Perzentil statt Zonen | offen | Drafts #219/#220 nicht gemergt | Score, Philip |
| Future_9 Makro-Gewichte | offen | kein Live-Umschalten der P. F9-04 Lager/Nachfrage ist eine andere Karte und ✅ Soft #357 | Score, Philip hat 18.10. JA zum Zusatzobjekt gesagt; Live-P nicht ohne Prüfung 2000/2008/2022 |
| Future_10 adaptive Gold-Schicht | teilweise | Basis, MA50, AISC-Sektion. Layer-Score schreibt den GIS nicht um | Score, Philip |

### Offen_FUTURE_SOLL_IST_DETAIL.md

233 Zeilen, davon 221 eigene Punkte, Stand der Datei nach den Nachzügen bis 01.11. (im Text: 119 ✅, 33 🟡, 65 ❌, 16 ⛔; inklusive der vier Zeilen, die #510 gestrichen hatte und die dieser PR wieder streicht). Die ✅, deren Merge vor `4220d4e9` liegt, gelten auf `5eec205a` weiter. Neu offen, weil nur nach dem 16.11.-Baum umgesetzt und von #520 zurückgenommen, sind die Code-Punkte in Abschnitt 4. Die vier gestrichenen Zeilen (F1-01, F1-05, F1-11 und die Arbeitszeile F1-01/F1-11) sind keine offenen Tickets mehr: Philip hat sie am 18.11. aus der Spec genommen (#510), #520 hat sie zurückgeholt, dieser PR entfernt sie wieder.

Nicht jede der 221 Zeilen ist in diesem Lauf mit einer frischen Zeilennummer im Code gegengeprüft. Geprüft sind die Ketten in Abschnitt 3 und 4 und die Abschnitte in Abschnitt 2. Die Detail-Datei bleibt die Zeilenliste; sie ist nicht auf `5eec205a` umgeschrieben.

### Offen_WORK_BUFFETT_ASIA_10Y.md

| Abschnitt | Status | Beleg | Rest |
|---|---|---|---|
| §1 Buffett nur Rezession | erledigt | `RecessionDashboard.tsx:13` Import, `:196` `<BuffettRatioPanel />`. Kein `<BuffettMacroCard` unter `client/`. #355 `597953df`, Negativtest `script/test-buffett-stock-card.ts`. Philip 01.11. 15:20 | — |
| §1 Asia-Benchmark ^TPX | offen | kein `^TPX` in `server/buffett-route.ts`. EU/CN mit ASHR/VGK sind #320 und bleiben | Anzeige, Label „Asien“ |
| §2 Asien-Aggregation | offen | `RegionGaugeSwitch.tsx:10` „Asien (Japan)“. ASHR ist ein Growth-Index (`shared/recession-growth.ts:81`), kein aggregierter Katalog Japan+China. Draft #470/#413 nicht gemergt. #413 nicht anfassen | Philip: Gewichte (F1-54). Score der regionalen P |
| §3 10Y-Overlay S12 | erledigt | Real10Y DFII10 in `TechnicalChart.tsx` (#267). Philip 25.10. 19:33: Real 10Y reicht | — |

Datei bleibt `Offen_` wegen §2.

### Offen_WORK_CAPEX_SECTOR_MAP.md und Offen_WORK_RESEARCHER_CAPEX_MAP.md

| Teil | Status | Beleg | Rest |
|---|---|---|---|
| Capex-Layer | teilweise | #283, Mount `Researcher.tsx` `GeoMapPanel`, Route `GET /api/researcher/geo-map` | Acceptance ≥ 20 Länder / Top-Firmen-Panel nicht live geprüft |
| Sektor-Layer | teilweise | #373, Ampel im Panel | „8–10 Sektoren live“ nicht in diesem Lauf |
| Miner-Layer | teilweise | `shared/miner-map.ts`, #376/#405/#408. `Fertig_WORK_BITCOIN_MINER_MAP.md` bleibt `Fertig_` | Länderanteil-Hinweis in der Panel-Doku |
| Gold-Layer | teilweise | #411 USGS, in der Capex-Ampel 🟡 Soft | — |
| Gesamt-Acceptance | offen | beide Dateien bleiben `Offen_` | kein Rename |

### Offen_WORK_GOLD_MINER_BREAKEVEN.md

| Abschnitt | Status | Beleg | Rest |
|---|---|---|---|
| S1 AISC aus dem Preis-Chart | erledigt | #398 `ef79c90c`, Ancestor von `4220d4e9` | — |
| S2–S4, S6–S9 Block, Karten, RSI, Datenkette, BTC unberührt, QE/QT | erledigt | #399/#398/#374, `GoldDashboard.tsx` bindet die Breakeven-Sektion | — |
| S5 / feste 1,10 und 1,15 | teilweise | `shared/gold-aisc.ts:66` `GOLD_AISC_STRESS_LOW = 1.10`. Sektion 9 klassifiziert über P20/P50 | Konstanten liegen noch im Modul |
| Euphorie ≥ P90 | offen | Spec: Slot angelegt, keine Zone | Philip |
| BTC-Schwellen adaptiv | offen | nicht dieser Auftrag | Philip, Miner-Formel |

Datei bleibt `Offen_`, solange S5 und Euphorie offen sind. Nicht von Hand auf `Fertig_` drehen.

### Offen_WORK_DCF_BILANZ_KALIBRIERUNG.md

| Abschnitt | Status | Beleg | Rest |
|---|---|---|---|
| Modul und Formeln Draft 1 | teilweise | `shared/dcf-calibration.ts:20–21` `enabled: false`. Schema-Feld `shared/schema.ts` (calibration). UI-Text nur auf dem Rechenpfad `shared/valuation-signal.ts:572` und `:638` | Flag aus: keine Wirkung auf DCF, Score, Entry |
| Tests, Guard, Vorher/Nachher-Doku | teilweise | `script/test-dcf-calibration.ts`, `script/guard-approved-dcf-calibration.ts`, `docs/dcf-calibration-before-after.md`. #512 | Tabelle ist synthetisch, keine Firmen-Fixtures |
| Wirksam schalten | offen | #523 fehlt | Philip-Ja. Score, Rating, Entry. Nicht in dieser Lane |
| Folgeschritte (Konsens-Anker, sektorrelative Stufen, NVO mit FMP-Key) | offen | Spec-Abschnitte „Offen / blockiert“ und Scope 23:08 | eigener Auftrag, gleiche Freigabe |

## 3. Die 42 WORK*-Dateien ohne Prefix

„Umgesetzt“ heißt: der Soll-Satz der Datei liegt auf `5eec205a` in der Kette UI → API → Server, nicht nur als Entwurf. Kandidaten für `fertig_` stehen in Abschnitt 5 und werden hier nicht umbenannt.

| Datei | letzter Commit | Soll (kurz) | Ist auf `5eec205a` | Status | nächste baubare Restlücke |
|---|---|---|---|---|---|
| `WORK.md` | `65ba08dd` | Index | Kopf im Text noch Tip `4286b44f` / `a0979593` | teilweise | Index-Kopf auf `5eec205a` nachziehen, reiner Doku-Schritt |
| `WORK_BUFFETT_ADAPTIVE_SOLUTION.md` | `5d98312e` | Perzentil statt fester 200-%-Schwelle | Drafts #219/#220 nicht auf main | offen | nicht bauen ohne Philip (Score) |
| `WORK_BUFFETT_ADJUST_IMPL.md` | `624bd1ca` | Sektor-Mix und Realzins-Faktor | nicht verdrahtet | offen | Philip (Score) |
| `WORK_BUFFETT_OVERLAYS.md` | `b2c3b3f8` | Margin, ROIC, Kapitalintensität im Aktien-TA | nicht diese Overlays | offen | Philip, wenn der Score mitzieht; Anzeige allein wäre baubar |
| `WORK_BUFFETT_WEIGHT_DISTORTION.md` | `62f2f509` | Gewicht der Korrektur-P prüfen | Empfehlung, kein Patch | offen | Philip (Score) |
| `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` | `d3277055` | KI-Unterposten einschieben | #465 `dd30e8b7` Jahres-Tabelle, Sankey `StatementSankey.tsx`, YoY; #483 Elternsegment; #482 Namenssuche. #486 revertiert durch #520 | teilweise | KI-Schätzen mit bekannten Fakten neu aufsetzen (nicht cherry-picken). P2-3 fail-open, eigene Unterbrands |
| `WORK_CHAT_PODCAST_MCP.md` | `65ba08dd` | Verlauf, Economist-Transkript, MCP | §1 #469 Delete auf main (`server/chat-history-route.ts:299`). Zwei-Tab #489 revertiert durch #520. §2 und §3 ohne diese Pipeline | teilweise | Zwei-Tab stale-write. Podcast- und MCP-Teil offen, Env |
| `WORK_CHAT_UPLOAD_CONNECTOR.md` | `50ebaf7d` | Upload, Voice, Connector | kein `type="file"` und kein `SpeechRecognition` in `ChatWidget.tsx` | offen | Upload/Voice baubar ohne Score. Connector ist Security |
| `WORK_DASHBOARD_FEATURES_2026-10.md` | `65ba08dd` | Statements, Earnings-Marker, Peer-Kurs, Chat, Event, Screener | Sankey, `TechnicalChart.tsx:288` Earnings-Marker, `:313` Peer-Kurs, `ChatWidget.tsx`, Event #278. Screener-Custom: Draft #463 offen | teilweise | Screener-Custom nur auf geladenen Kandidaten. Kein Score |
| `WORK_EARNINGS_YIELD_ROIC_IMPLEMENTATION.md` | `65ba08dd` | EY/ROIC-Plot und Peer | Plot und Peer-Dividende auf main (#380/#423/#437). Zeile `.DE EY/ROIC` in diesem PR entfernt (war #510). #511 revertiert durch #520 | teilweise | Nicht-USD-EY gegen USD-Kurs. Do-not-touch `.DE`, Philip |
| `WORK_EARNINGS_YIELD_ROIC_PLOT.md` | `65ba08dd` | dieselben Plots | wie die Implementierungsdatei | teilweise | wie oben |
| `WORK_GURUFOCUS_METRICS_ASSESSMENT.md` | `4ea3ac3e` | Bewertung, drei optionale Badges | Bewertung ist Doku. Piotroski, Altman, WACC-vs-ROIC-Ampel nicht als diese Badges | teilweise | Badges nur mit Philip (Score/Anzeige S4–S7) |
| `WORK_HYBRID_CLASSIFICATION.md` | `a613085d` | TSLA nicht nur Zykliker | kein Hybrid-Feld als diese Spec | offen | Philip (Score, Klassifikation) |
| `WORK_HYBRID_XPENG.md` | `f39cdf2a` | dieselbe Regel ohne Hardcode | hängt an der Hybrid-Spec | offen | kein eigener Bau |
| `WORK_HYPECYCLE_EMAIL_SUPABASE.md` | `8f2152f2` | Hype-Proxy und ATTRAKTIV-Mail | #391 Mail bleibt aus. Draft #466 nicht gemergt | offen | Mail ist Env/Security. Hype-Proxy Draft existiert |
| `WORK_IMPLEMENTIERUNG_OFFEN.md` | `5b476265` (#521) | Ticket-Index | Kopf nennt `65ba08dd`, nicht `5eec205a`. Revert-Liste vollständig | teilweise | eine Zeile: HEAD ist `5eec205a`, Flag aus |
| `WORK_IST_VS_SOLL.md` | `65ba08dd` | Audit Code vs Specs | Kopf `4286b44f`. Inhalt vor #512 und vor dem Revert-Nachzug | teilweise | kein App-Code. Nicht als einzige Ampel benutzen |
| `WORK_KI_CHAT_BIG_PICTURE.md` | `8e131831` | Earnings Call, eine Geschichte | Teilkontext #289/#293, Test `script/test-chat-big-picture.ts`. SEC-Call: Draft #430 offen | teilweise | Earnings-Call-Quelle. Modellwahl ist Env |
| `fertig_WORK_KI_CHAT_ERROR.md` | `9ae49a3e` | 400-Zeichen-Cap auf der These weg | `shared/chat-context.ts:161–174`, Budget 36 000, These 18 000 Zeichen. Test `script/test-chat-fact-limit.ts` akzeptiert 1 200 | erledigt | keine. Umbenannt in #525 (Stabschef 26.11.2026) |
| `fertig_WORK_KI_CHAT_LIMIT_ALL.md` | `509c6829` | jedes Fakt-Feld mindestens 1 000 | dasselbe Budget, nicht ein festes Zod-Max 1 000. These, Rationale, Notes hängen am Budget (`chat-context.ts:161`) | erledigt | Abweichung dokumentiert. Umbenannt in #525 (Stabschef 26.11.2026) |
| `WORK_KI_CHAT_SCHEMA.md` | `9d0ffb4b` | Schema der ganzen Analyse | #289/#293 Kontext auf main. Nicht jede Beispielzeile neu gelesen | teilweise | Restfelder nur anzeigen |
| `WORK_KI_CHAT_SCHEMA_UPDATE.md` | `6e208232` | dominante Klasse immer, keine 30-%-Schwelle | `dominantThesisClass` `shared/chat-context.ts:124–132`, UI `ThesisStrengthPanel.tsx:15`, Test `script/test-chat-big-picture.ts:45` | erledigt | Kandidat `fertig_` |
| `WORK_KOMBINATIONSKURS_AMPEL.md` | `81280295` | Ampel-Segmente auf dem Aktienkurs S12 mit DCF/RSL | #445 färbt die Kurslinie nach der TA-Ampel. #358 ist der Portfolio-Kombinationskurs, andere Fläche | teilweise | Philip (Design, Rating), wenn DCF/RSL die Farbe mitbestimmen sollen |
| `WORK_KOSTENUEBERSICHT.md` | `556b0406` | Stichtag 31.10. Kosten | keine Code-Änderung verlangt | erledigt | Doku-Stichtag, kein Bau. Kein Feature-Kandidat |
| `WORK_MORNING_BRIEFING.md` | `65ba08dd` | Briefing 1:1 wie Country Macro Pulse | `Researcher.tsx:503` `BriefingModal` ist das alte Layout. #503 revertiert durch #520. Draft #180 HOLD | offen | revertiert durch #520. Philip (Design) |
| `fertig_WORK_NVO_TECHNICAL_OVERRIDE.md` | `8bb4967f` (#256) | Death Cross + RSL + schwacher Moat → höchstens NEUTRAL | `shared/bias-fixes.ts:147–187`: drei Bedingungen, Deckel auf NEUTRAL `[4.5, 6.49]`, Schwelle `TECH_MOAT_RSL_THRESHOLD = 105` (`:179`). Test `script/test-tech-moat-override.ts`. #256 | erledigt | Umbenannt in #525 (Stabschef 26.11.2026). Spec §9 erwähnt noch Philips Tabelle |
| `WORK_PEER_RELATIVE_VALUATION_BUGS.md` | `4be80cbc` | Peer-Add, Suche, KI-Darstellung | Overrides #258/#262. KI in derselben Tabelle #462 revertiert durch #520 | teilweise | revertiert durch #520. Philip (Peer), Score unangetastet lassen |
| `WORK_PEER_SELECTION.md` | `3f7aac58` | Industrie, Overrides, Cache, Tabs | #258/#260/#262/#291 auf main | teilweise | Default-Tab Forward-KGV nicht von Philip bestätigt |
| `WORK_PEER_SELECTION_DETAILED.md` | `d3adadb9` | dieselbe Lösung im Detail | wie oben, Filter-Tabs nur Ansicht | teilweise | Philip (Peer) für den Default |
| `WORK_PODCAST_PIPELINE.md` | `e513ea6a` | Rollen, OpenRouter-Audio, Kennzeichnung | `server/podcast-route.ts` ist nicht diese Pipeline | offen | Env (OpenRouter). Kein Score |
| `WORK_PODCAST_PROMPT.md` | `110fe514` | Prompt und Dual Placement | Prompt nicht als diese Spec verdrahtet | offen | hängt an der Pipeline |
| `WORK_REALZINS_ADJUST.md` | `31f4e27b` | Buffett um Realzins adjustieren | nicht im Score-Slot | offen | Philip (Score) |
| `WORK_RECESSION_EARNINGS_GROWTH_PLOT.md` | `2bfa46ce` | Gewinnwachstum Index-Ebene | `RecessionGrowthSection.tsx`, `useRecessionGrowth.ts`, `server/recession-growth-route.ts:57`, `server/routes.ts:549`. #419/#426 | teilweise | Differenz in Prozentpunkten: revertiert durch #520 (#468) |
| `WORK_RECESSION_GROWTH_GAP.md` | `65ba08dd` | Gap analog Inventory | dieselbe Kette, `GapCard` in `RecessionGrowthSection.tsx:255` | teilweise | revertiert durch #520 (#468) |
| `WORK_RECESSION_TA_CHART.md` | `a510053c` | TA wie Aktien-S12 | `RecessionDashboard.tsx:194` `RecessionTaSection`, #284 🟢 Soft | teilweise | nicht alle Pane-Wünsche neu gegengeprüft. Kein `fertig_`-Vorschlag. #525 nicht umbenannt: der Beleg zeigt nur den Mount `RecessionTaSection` (`RecessionDashboard.tsx:194`), nicht dass der Soll „TA wie Aktien-S12“ erledigt ist |
| `fertig_WORK_REMOVE_BUFFETT_STOCK.md` | `8673abff` | Buffett-Sektion aus der Aktienanalyse | kein Mount in `Dashboard.tsx`. Rezession behält das Panel (`:196`). #355 | erledigt | Umbenannt in #525 (Stabschef 26.11.2026). Pfade `StockDashboard.tsx` / `server/routes/stock.ts` in der Spec sind veraltet |
| `WORK_SCENARIO_CONE_STOCK.md` | `12cefb5e` | Kegel nur Anzeige | `TechnicalChart.tsx:33` `ScenarioCone`. Echte Wahrscheinlichkeiten in der Spec offen. Draft #497 offen | teilweise | Kegel-Formel nur mit Philip, wenn Ziele sich ändern (Draft #497) |
| `WORK_SCORING_ADDITIONS_MSFT.md` | `7590d48b` | EY, Quality, Accruals in den Score | EY ist Overlay (#380), nicht der Score | offen | Philip (Score) |
| `WORK_SECTION_WEIGHTING_ADAPTIVE.md` | `8bb4967f` | jede Sektion adaptiv gewichten | nur der Tech-Moat-Deckel #256. Volle 20-Sektionen-Gewichtung nicht | teilweise | Philip (Score). Spec §9 lässt `fertig_` nicht zu |
| `WORK_SECTORAL_MOAT_DAMPING.md` | `c4260d6b` | Dämpfung bei schwachem Moat auch im Golden Cross, Heritage | kein `heritage` in `shared/bias-fixes.ts` | offen | Philip (Score) |
| `WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md` | `53f59dc7` | PE-10J, Ampel, Reverse-DCF Sektor | Ampel #352 `shared/sector-attr-band.ts`, Pfeil `SectorRotationPanel.tsx:105`. Kein `reverseDcf` in `server/sector-rotation.ts` | teilweise | PE aus ETF und Reverse-DCF. Philip (Score/Ampel) |
| `WORK_SIMPLYWALLST_LEARNINGS.md` | `65ba08dd` | Narratives, ohne Markdown-Sterne, Verlauf | Verlauf #469. Zwei-Tab #489 revertiert durch #520. Sterne/Narratives nicht belegt | teilweise | Anzeige der Sterne baubar. Verlaufs-Fix wie Chat |

## 4. Regressionen durch #520 (Code, wieder offen)

Diese Commits sind Historie, ihr Baum ist es nicht. Spec-Prefixe der schon `fertig_`/`Fertig_`-Dateien bleiben.

| PR | SHA | Was zurück ist | Betroffene Spec |
|---|---|---|---|
| #499 | `2a572bf8` | Doku-Ampel Morning Briefing | `WORK_MORNING_BRIEFING.md` |
| #493 | `c4be9a6f` | Ampel-Badge in die Chart-Toolbar | Anzeige S12 |
| #462 | `2bc8e7bd` | KI-Peer-Vorschläge in derselben Tabelle | `WORK_PEER_RELATIVE_VALUATION_BUGS.md` |
| #494 | `58f6c237` | Katalysator-Enrich lädt bei Cache-404 einmal neu | S15 |
| #489 | `f6b88795` | Zwei-Tab: stale-write verwirft den lokalen Thread | `WORK_CHAT_PODCAST_MCP.md`, `WORK_SIMPLYWALLST_LEARNINGS.md` |
| #500 | `64447982` | KI-Katalysatoren beim Tickerwechsel verwerfen | S15 |
| #502 | `f615003c` | Badge aus dem Plot-Scroll | S12 |
| #486 | `6d9f08f3` | KI-Schätzen schickt bekannte Fakten | `WORK_BUSINESS_MODEL_AI_SUPPLEMENT.md` |
| #316 | `2911cfcf` | S9: kein stilles `?? 5` / „Global Market 5 %“ | keine eigene Spec-Datei; Lücke in `Section7.tsx` |
| #503 | `852cb493` | Briefing-Modal wie Country Macro Pulse | `WORK_MORNING_BRIEFING.md` |
| #468 | `806772f2` | Rezessions-Differenzen als Prozentpunkte | `WORK_RECESSION_GROWTH_GAP.md` |
| #505 | `7c2ea1ea` | Abschlüsse, Segmente, Jahresreihe in USD | FX, kann DCF-Inputs ändern |
| #510 | `5216d347` | zehn Doku-Zeilen `.DE`/Yahoo | in diesem PR wieder entfernt |
| #506 | `c441f5c7` | Cross erst nach Hysterese, Freeze positiv | TA-Anzeige, kann die Ampel treffen |
| #507 | `cd26c249` | KI-YoY kuratierter Segmente | Segmente. #492 baut darauf und bleibt HOLD |
| #511 | `c4975703` | EY von Nicht-USD-EPS gegen den USD-Kurs | EY-Plot. Do-not-touch `.DE` |

#501, #504, #508, #509, #513 sind Doku-Ampeln derselben Commits und ebenfalls zurück.

## 5. Kandidaten für `fertig_`

Nur Dateien, deren Soll auf main belegt ist. Philip entscheidet den Rename. Vier Zeilen sind in #525 umbenannt (Stabschef 26.11.2026, Beleg SPEC_INVENTUR_SOLL_IST.md @fdb162c4). `WORK_KI_CHAT_SCHEMA_UPDATE.md` bleibt Kandidat und wird nicht umbenannt.

| Datei | Warum | Einschränkung |
|---|---|---|
| `fertig_WORK_REMOVE_BUFFETT_STOCK.md` | Soll „Sektion weg“ erfüllt. #355, kein Mount, Panel nur in der Rezession | Umbenannt in #525 (Stabschef 26.11.2026). Pfade in der Spec sind veraltet |
| `fertig_WORK_KI_CHAT_ERROR.md` | 400-Zeichen-Fehler ist weg | Umbenannt in #525 (Stabschef 26.11.2026) |
| `fertig_WORK_KI_CHAT_LIMIT_ALL.md` | alle drei Textarten über dem alten 400er, These 18 000 ≥ 1 000 | Umbenannt in #525 (Stabschef 26.11.2026). Nicht das wörtliche Zod-Max 1 000 |
| `fertig_WORK_NVO_TECHNICAL_OVERRIDE.md` | Gate auf main. `shared/bias-fixes.ts:147–187` (Kommentar der drei Bedingungen, `TechMoatOverride`, Schwellen 105 / 4.5 / 6.49) | Umbenannt in #525 (Stabschef 26.11.2026). Spec §9 nennt weiterhin Philips Vorher/Nachher-Tabelle |
| `WORK_KI_CHAT_SCHEMA_UPDATE.md` | dominante Klasse ohne 30-%-Schwelle | — |
| `WORK_KOSTENUEBERSICHT.md` | Stichtagsnotiz ohne Code-Soll | kein Feature. Optionaler Doku-Rename |

Nicht umbenannt, und nicht als Kandidat geführt: `WORK_SECTION_WEIGHTING_ADAPTIVE.md` (nur der Deckel, nicht die 20-Sektionen-Gewichtung), `Offen_WORK_DCF_BILANZ_KALIBRIERUNG.md` (Flag aus, #523 fehlt), alle `Offen_WORK_*` mit einer offenen Zeile, die elf neuen `fertig_`-Dateien aus `Future_*` (Dateistatus ist `fertig_`, die Umsetzung nicht in jedem Punkt).

## 6. Zehn Zeilen aus #510, wieder entfernt

#510 (`5216d347`, 18.11.2026) hat genau diese zehn Zeilen gelöscht, vier Dateien, keine Umnummerierung. #520 hat den Baum von vor #510 zurückgebracht. Dieser PR löscht dieselben zehn Zeilen und sonst keine Datei.

`fertig_1_Work.md`, `fertig_2_NA_Fixes_Research.md` und `WORK_IMPLEMENTIERUNG_OFFEN.md` stehen nicht im Diff von #510. Bezüglich `.DE` sind sie nicht angefasst. Der Gate-Code von #264 bleibt unberührt: `server/yahoo-fetcher.ts:361–362` `isGermanXetraTicker`, `server/earnings-yield-roic-route.ts:488` `loadGermanEarningsYield` und `:608` der Aufruf für `.DE`.

Die vollen Zeilentexte stehen im PR-Body.

## 6b. Veraltete Ist-Aussagen (nur gelistet, nicht umgeschrieben)

| Stelle auf main `5eec205a` | Was dort steht | Was auf dem Baum stimmt |
|---|---|---|
| `Offen_FUTURE_SOLL_IST.md` Z.135–139 | „Yahoo / 402 — offen.“ und „Kein `server/yahoo-fetcher.ts`.“ | Datei ist da (`server/yahoo-fetcher.ts`, #252, Crumb-Weg #264). Dieser PR löscht zwei Zeilen davor, der Absatz rutscht nach Z.133–137 und wird nicht umformuliert |
| `WORK_EARNINGS_YIELD_ROIC_IMPLEMENTATION.md` Z.95 | „Aktuell nichts davon implementiert.“ | Plot, Peer-Route und Tooltip sind auf main (#380/#423/#437). Z.95 liegt über der gestrichenen `.DE`-Zeile und bleibt stehen |
| `WORK.md` Kopf | Stand 11.10.2026, jüngste Ampel 11.11. `63a5cbcf` | #520 (`65ba08dd`) und #512 (`5eec205a`) fehlen im Kopf |
| `WORK_IMPLEMENTIERUNG_OFFEN.md` Kopf | #520 und Tree `65ba08dd` (Z.4) | #512 / main `5eec205a` fehlt. Der Kopf nennt den Revert, nicht den Commit danach |

## 7. Priorisierte baubare Restlücken

Regressionen zuerst. Akzeptanz ist der Satz, an dem ein Folge-PR messbar ist. „Philip“ meint Design, Score, Rating, Entry, Peer, Security oder Env.

### Ohne Philip-Freigabe baubar

1. **S9 stilles +5 % (Regression #316 / #520).** `client/src/components/sections/Section7.tsx:40` `const sectorGrowth = data.tamAnalysis?.tamCAGR ?? 5`. Server-Fallback `server/sector-data.ts:525–526` `tamLabel = 'Global Market'`, `tamCAGR = 5`. Kette: Dashboard Sektion 9 `Section7` → `POST /api/analyze` → `server/analyze-route.ts` `generateTAMAnalysis` → `server/sector-data.ts`. Akzeptanz: ohne `tamCAGR` zeigt die UI `n/a` mit Grund oder einen gekennzeichneten Wert mit Quelle, nie eine nackte +5,0 %. US-Titel mit echtem `tamCAGR` bleiben. Kein Score-Pin. Draft **#522** ist offen (`cursor/s9-branchen-quelle-7dbe`); nicht ein zweites Mal anfangen. #515 ist ein anderer Revert und nicht dieser Fix.
2. **Chat Zwei-Tab (Regression #489 / #520).** Akzeptanz: Tab B zeigt einen in Tab A gelöschten Thread nach Reload nicht wieder. Kette `ChatWidget` → `client/src/hooks/useChatHistory.ts` → `DELETE/PUT /api/chat/history` → `server/chat-history-route.ts` → `shared/chat-history.ts`. Kein Score.
3. **Katalysator S15 (Regression #494 und #500 / #520).** Akzeptanz: Cache-404 lädt die Analyse einmal neu; beim Tickerwechsel verschwinden die KI-Katalysatoren des vorigen Titels. Kein Score.
4. **Chart-Badge S12 (Regression #493 und #502 / #520).** Akzeptanz: Badge sitzt in der Toolbar und scrollt nicht mit dem Plot. Nur Anzeige. #445 (Farbe der Linie) bleibt.
5. **Rezessions-Differenzen als Prozentpunkte (Regression #468 / #520).** Akzeptanz: Gap-Karten nennen Prozentpunkte, nicht eine zweite Einheit. Kette `RecessionGrowthSection.tsx` → `GET /api/recession/growth-gap/:index` → `server/recession-growth-route.ts:57`. Kein Score. Die Growth-Gap-Karte selbst (#419/#426) bleibt.

### Mit Philip-Freigabe, nicht still bauen

| Lücke | Warum Philip | Akzeptanz, sobald frei |
|---|---|---|
| DCF-Flag an | Score, Rating, Entry. #523 fehlt | Vorher/Nachher auf echten Fixtures, Pins bei `enabled: false` unverändert, dann erst `enabled: true` |
| #505 Abschlüsse in USD | Entry/DCF-Inputs | Nicht-USD-Abschlüsse, Segmente und Jahresreihe in USD, mit ausgewiesener FX-Quelle |
| #506 Cross-Hysterese | kann die TA-Ampel und damit das Rating ändern | Cross erst nach der vereinbarten Hysterese, Freeze positiv |
| #511 EY Nicht-USD | Do-not-touch `.DE`, kann die EY-Lage ändern | EY = EPS in USD / Kurs in USD. Kein neuer `.DE`-Sonderweg über die gestrichenen Spec-Zeilen |
| #462 KI-Peers in einer Tabelle | Peer | Dieselbe Tabelle, Score unverändert |
| #503 Briefing-Layout | Design | `BriefingModal` rendert `KeyEventCard` wie der Country Macro Pulse |
| §2 Asien Japan+China | Score der regionalen P, Gewichte | Label „Asien“, Treiber aus mindestens Japan und China. #413 nicht anfassen |
| Future_7/8 Zonen → Perzentil | Score | erst Zusatzzeile, Live-P erst nach Philip |
| Upload/Voice und MCP | Security, Env | kein Key im Client, keine neue Mail |
| #486 KI-Fakten an OpenRouter | Env, und #492 bleibt HOLD | bekannte Fakten im Prompt, keine erfundenen Segmente. Neu aufsetzen, nicht auf den revertierten Baum |

Do-not-touch unverändert: `server/researcher.ts`, PR #413, `feat/factpack-hook`, Miner-Kernformeln, PEG, invertierter DCF, Sentiment, Portfolio F.2. Nichts aus dieser Inventur ist ein Merge.
