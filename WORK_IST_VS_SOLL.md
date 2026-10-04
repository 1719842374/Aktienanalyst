# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 05.10.2026  
> **Repo:** `1719842374/Aktienanalyst`  
> **HEAD:** `191792c5b09e67658641d49fc73991df14be3bbc` (#169 Docs-Renames; Doublecheck GO; parent `b952469d` `Fertig_MINER_INTEGRATION.md`; davor `f2a59b9` #165 Stablecoin-Rename)  
> **Keep-Alive:** CI rot auf main wegen leerem `RENDER_URL` ist bekannt und kein Ampel-ROT für diesen Tip. Die Renames sind kein Live-Deploy.  
> **Regel:** Ist nur aus Code + UI auf diesem Tip. Draft-PRs zählen nicht. ✅ erwartete Anzeige live · 🟡 Kern da, Spec-/UI-Zusatz fehlt · ⬜ Spec ohne Engine/UI.  
> **Quelle Nachzug:** Doc_Soll_vs_Ist/README · Companion `WORK_IMPLEMENTIERUNG_OFFEN.md`  
> **Delta 05.10.2026, Tip `191792c5`:** Dateinamen `fertig_` für Value-Chain, Researcher-Briefing regional und Stablecoin/T-Bill liegen schon auf dem Tip. Sahm bleibt `Offen_`. Sieben Soll-Ist-Blöcke stehen in Abschnitt 6. Kein App-Code in diesem Nachzug.  
> **Delta 30.09. Vormittag, nach #103 Miner Observability Live PASS:** #103 Miner Observability Live ✅ (tip `e2bc69a2` = `e2bc69a233166a3242d13e9ddc78373adc19f68c`; parent `58bec00c` #101 Docs ← `c365c945` #100 ← `4c615eb3` #99; Bundle `index-MIF1Ml5X.js` unverändert — Client unverändert, #103 server-only). Error-Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient (400ms); Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`). Dateien: `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43. UI `Section13Miner` unverändert. Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = **Render→mempool Egress**, kein Code-Delete/Stub. Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt. #99✅ #100✅ #93 Label✅ #97✅ #92✅ bleiben. #96 closed ohne Merge — nicht reopen, nicht grün. **Delta 30.09. Morgen, nach #99+#100 Live PASS:** #99 TA Spec v3.2 Live ✅ (SHA `4c615eb3` → stack tip `c365c945`; Bundle `index-MIF1Ml5X.js`; Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok, Mobile soft-skip; Shots `/workspace/dod-99-ta-v32/`). #100 KI-N/A matrix (Relativ Bewertung / Section7) Live ✅ (tip `c365c945`; Spalten Segment|Rev.|Anteil|Wachstum|TAM|CAGR|Anteil am TAM|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert; Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt; Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet, keine Segments/keine N/A; 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0; Shots+Probe `/workspace/dod-100-ki-na/`). #93 KI-N/A-Fill Segment-TAM Label Soft → ✅ (Idle-Label jetzt Spec „N/A mit KI schätzen“ via #100 Live; Behavior+API war schon PASS @ `7574b12d`; Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt). #97 bleibt ✅ (superseded by v3.2 live on same chart stack). #92 bleibt ✅. #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün. **Delta 29.09. Abend, nach #97 Live PASS:** #97 TA Kurs A/B/C Spec v3.1 Live ✅ (SHA `249841ab`; parent `1dc82683`; Bundle `index-C_rUCqgy.js`; 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder (eigene Y min–max je Band via `yDomainFromCloses` / `chart-price-bands`); `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL; DoD AAPL Shots `/workspace/dod-97-ta-kurs/`). #92 TA Zwei-Fenster Live ✅ (SHA `c06c835e` → Fix `1dc82683` #94; Bundle `index-JP8muGsY.js`; DoD: A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster Extra An/Aus; Soft Draw-Order B-unter OK). #93 KI-N/A-Fill Segment-TAM Live 🟡 PARTIAL (`7574b12d`; Behavior+API PASS — MSFT amber ~59%; KI nur unmatched + violet Badge; Catalog-Coverage unverändert; Clear → n/a; core 58.5%/unreliable/`tamTotal=null`; Label Soft: UI „KI“ vs Spec „N/A mit KI schätzen“). #96 KI-Fill v2 bleibt Draft Merge-Gate — nicht grün (Label Soft #93 kann nach #96 Live weg; Soft Apollo bis Philip GO). #90 TAM Coverage-Lift Live ✅ (Bundle `index-Ca0V7H2h.js`; DoD: AMZN 75.2% ok, NVDA 98.2% weak, MSFT 58.5% unreliable — Server unmatched, `tamTotal` null). Queue Coverage-Lift ✅. #74 Batch A Live ✅ (Fake-OK `bars=[]` source:fmp fixed) · #75 Ökosystem / #76 DCF Markt-β / #77 Makro §15 Live ✅ nach Deploy · #81 Porter Prompt · #82 Exec-Boxen · #83 Fenster-Zonen · #84 Sharpe · #85 Attribution · #86 Tooltip · #88 Pie/360px Live ✅ · #87 thin-series Code ✅ Live 🟡 PARTIAL (healthy 251d OK, thin-Banner nicht repro) · #71 4-Toggles weiter 🟡 · BL §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3. Hub war 29.09. / `d517611` (#78); danach Abend `f0046ee9` (#89, Docs-Tip `20120339`); danach Abend #90 `ee5f0f8b` (Docs-Tip `9895774f`); Hub-Draft #95 Inhalt `1dc82683` (#92✅ #93🟡, noch offen); Tip `249841ab`.  
> **tsc-Baseline:** 97 Fehler (unverändert).

---

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien Root (Feature, ohne Index) | **~45+** (gewachsen seit 01.09.) |
| Analyze-Cache TTL | **L1 20 min RAM + L2 7 d SQLite** |
| Researcher-Cache TTL | **6 h** + SQLite (Liquidity 6h, Value-Chain 18-24h) |
| Disk-Schema | `2026-08-29-v2` |
| OHLCV Cap in Analyze | **2600** |

Scoreboard Feature-Docs (ohne Index `WORK.md`; Ampel nach Doc-Hub + Code-Check):

| Ampel | Bedeutung |
|-------|-----------|
| ✅ | Kern + erwartete UI live |
| 🟡 | Engine/Partial da, Wire oder Spec-Zusatz fehlt |
| ⬜ | Spec ohne Engine/UI |

---

## 0b. Server-Routing + Cache

| Methode | Pfad | Cache |
|---------|------|-------|
| POST | `/api/analyze` | L1 20 min + L2 7 d, inkl. Fiscal-Overlay (D3) |
| POST | `/api/catalyst-enrich` | L1+L2 |
| POST | `/api/researcher/*` | 6 h File / 1 d SQLite |
| GET | `/api/researcher/sector-rotation` | 6 h (C1 P0–P3, additiv) |
| GET | `/api/researcher/liquidity` | 6 h (C2, `macro_v2__US`) |
| GET | `/api/analyze-btc/stablecoin-liquidity` | 5 min RAM + Disk (D4) |
| GET | `/api/analyze-btc/fiscal-frontend` | Serien-TTL 6–24 h (`fiscal__*`), Request-Cache |
| GET | `/api/analyze-gold` | 1-Faktor + optionales Multi-Faktor (D5) |
| GET | `/api/valuechain` | 18-24h Disk (D6a + Phase 1–2) |
| POST | `/api/valuechain/enrich` | 7 d Disk, LLM (D6c) |
| GET | `/api/analyze-recession/markets` | RAM 6h (RSI/MACD + Vol-Pane; EU VSTOXX live `#66`) |
| GET | `/api/ohlcv` | 24h Cache, max 12 Tickers (`#61` portfolio §6) |
| GET | `/api/health` | unberührt |

Kein Portfolio-Backend — `/#/portfolio` ist `localStorage`. D2 client-seitig.

---

## 1. Mastertabelle Soll vs. Ist

### 1a. Kern (weiterhin ✅)

| # | Datei | Soll | Ist | Ampel | Code |
|---|-------|------|-----|-------|------|
| 1 | WORK.md | Index | Navigation + Cache-Docs | 📄 | Root |
| 1b | WORK_ANALYZE_DISK_CACHE.md | 7d KI-Catch | L2-Schicht + Patch | ✅ | disk-cache |
| 1c | WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md | Wiring | disk-cache live | ✅ | |
| 2 | fertig_WORK2.md | Regulatory/PESTEL | PESTEL-Risks live | ✅ | regulatory.ts (`c83e543`) |
| 3 | fertig_WORK_ANTIBIAS_DCF.md | eine Schicht, g* | ja | ✅ | invertedDcf |
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | Tabelle Π / E[R]_BL + MC-Cards (kein Scatter/Chart-Soll); Frontier ≥3 Ticker; Cholesky-MC | ✅ | blackLitterman.ts (`08e8938`) |
| 5 | fertig_WORK_BTC_MINER.md | Hash Ribbons/Puell | Observability live (#103 `e2bc69a2`); Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt | ✅ | btc-miner.ts · routes.ts `minerUnavailableBody` · `script/test-btc-miner-observability.ts` |
| 6 | fertig_WORK_DATA_PROVIDERS.md | 5Y + Alternative | FMP + Yahoo/Stooq | ✅ | history-fallback.ts |
| 7 | fertig_WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults | 6 Klassen | ✅ | lynch-dcf-defaults.ts |
| 8 | fertig_WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | · **nicht neu anfassen** |
| 9 | fertig_WORK_PEER_ROIC_SANITY.md | LITB kappen | sanitizeRoic · Tip ≡ `4bdc1f8` (kein Delete) · Live wieder da nach FMP Premium | ✅ | news-peers.ts |
| 10 | fertig_WORK_PORTFOLIO.md | F.2 + CAPM sichtbar | F.2 + Kelly + **E[r]-KPI CAPM live** (`0021be6`/`32133b4`) | ✅ | Doc-Hub 05.09. noch 🟡 CAPM — Code korrigiert |
| 12 | fertig_WORK_RESEARCHER_BUTTONS_APPLY.md | Phase-2 Buttons | verdrahtet | ✅ | |
| 13 | fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md | WALCL/RRP/TGA | GET `/api/researcher/liquidity` | ✅ | C2 `f0931d86` |
| 14 | fertig_WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ja | ✅ | |
| 15 | WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/Cap/HHI | Fixture Q | ✅ | `d6b41b3` |
| 16 | fertig_WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons | ja | ✅ | |
| 17 | fertig_WORK_REVERSE_DCF_BRIDGE.md | Fiscal in DCF | Hook live | ✅ | fiscal-bridge · inverted Kern **nicht anfassen** |
| 18 | fertig_WORK_SCORING_VORLAGE.md | Gates + Lookahead | Pipeline + Fixture | ✅ | `9215cee` |
| 19 | Offen_WORK_SECTION4_DATA_BUGS.md | PEG + FCF + Dedup + Rest | Trailing-PEG, signed FCF, Geo-Dedup auf dem Tip; Earnings, Analysten, Growth, Moat offen. PEG-Formel und inverted DCF nicht angefasst | 🟡 | Section4.tsx · analyze-helpers · analyze-route |
| 20 | fertig_WORK_SEGMENT_DEDUP.md | Cross-Dedup | ja | ✅ | |
| 21 | fertig_WORK_SEKTORROTATIONS_RAT.md | Radar P0–P3 | live inkl. Layout #49–#51 | ✅ | |
| 22 | fertig_WORK_SIGNAL_BACKTEST.md | PIT | Phase 0–6 | ✅ | |
| 23 | fertig_WORK_STABLECOIN_TBILL_GENIUS.md | Stablecoin | `fertig_` auf dem Tip seit #165. Dieser Nachzug öffnet die Spec nicht wieder und behauptet kein neues Live-Deploy | ✅ | |
| 24 | fertig_WORK_TAM_RESIDUAL_XBOX.md | Residuum | ja | ✅ | |
| 25 | fertig_WORK_TAM_SEGMENT_MAPPING.md | Quality-Tor | ja | ✅ | |
| 26 | WORK_TEIL0-6.md | Platform/BTC/FMP | Kern | ✅ | |
| 27 | fertig_WORK_TEIL7_SCORING.md | Gold + WALCL | Multi-OLS | ✅ | |

### 1b. Nachzug Doc-Hub (13.09.) — ✅ / 🟡 / ⬜

| # | Datei | Soll | Ist | Ampel |
|---|-------|------|-----|-------|
| 28 | fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md | Rang 1–9 | Dateiname `fertig_` auf Tip #169 (Docs-Rename). Rang 7–9 bleibt Code (xyflow, Redis optional). Kein Live-Deploy aus diesem Commit | ✅ |
| 29 | WORK_PORTFOLIO_BACKTEST.md | Equity α/β/IR Underwater | Panel da; braucht Position+OHLCV; Rest-DoD | 🟡 |
| 29b | WORK.md_portfolio_3 §6 | `GET /api/ohlcv` + Long-Map | Live PASS Tester AAPL 1Y/2Y @ `6a1807b` (`#61`). #74: Fake-OK `bars=[]` source:fmp fixed (Live ✅); Code §6 nicht gelöscht. Chart #71 oft weiter leer | ✅ |
| 30 | fertig_WORK_RECESSION_RSI_MACD.md | RSI+MACD+Div in `#/recession` | Dashboard-Wire + Pane live | ✅ |
| 31 | fertig_WORK_EXEC_SUMMARY.md | Karte über S1 | Exec-Karte live `#58`; `#69` Analyze Ampel+KI+FS Live PASS (XOM; FMP Premium aktiv) | ✅ |
| 32 | Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md | Katalog + Fetch | EZ-M3, BoJ-M2, APP/PEPP und JP-NGDP auf dem Tip; MoF-CSV, Realzins-Live und X-Bot fehlen. Siehe Abschnitt 6 | 🟡 |
| 33 | Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md | s(z), N^b, FE, QRA-Anker | Route + Karten; `S_F*` aus MSPD-Monats-FE sobald die Historie reicht; GIS-Slot bei `FE.available`; Cron/QRA-LLM optional, nicht gebaut; Datei bleibt `Offen_`. Siehe Abschnitt 6 | 🟡 |
| 34 | Offen_WORK_RESEARCHER_LIQUIDITY_INDEX.md | LI US/EU/ASIA | `?region=` liefert `li` + Bücher; `LiquidityPanel` ohne Region. Siehe Abschnitt 6 | 🟡 |
| 35 | fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md | Buch M/F EZ/JP | `CATALOG` + `GET ?region=` `books.M`/`books.F`; Panel bleibt offen | 🟡 |
| 36 | Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md | r, V, π, T½ | kein Regions-Widget auf dem Tip. Siehe Abschnitt 6 | ⬜ |
| 37 | fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md | 3 Regionen + Spillover | Dateiname `fertig_` auf Tip #169 (Docs-Rename). Kein Live-Deploy aus diesem Commit | ✅ |
| 38 | fertig_WORK_RECESSION_MARKET_CHARTS.md | VIX-Pane + PEG-Click + FINRA | SPY/QQQ/VGK/ASHR, Factpack, FINRA nur SPY | ✅ |
| 39 | fertig_WORK_RECESSION_2008_DRIVERS_LLM.md | s(z)+OpenRouter-Driver | Ziel+z auf main, LLM nur wenn Menge A nicht leer | ✅ |
| 40 | Offen_WORK_RECESSION_FRED_SAHM.md | adaptive FRED + Sahm s(z) | US-Karte `SAHMREALTIME` + s(z); letzte-12-Kontrolle nicht ±0.02; EZ/JP fehlen. Dateiname bleibt `Offen_`. Siehe Abschnitt 6 | 🟡 |
| 41 | fertig_WORK_RECESSION_RATE_OIL_BRIDGE.md | Zins-Brücke + Öl | `recession-bridge.ts`, nicht in der 17er-Summe | ✅ |
| 42 | Offen_WORK_RECESSION_SOURCES.md | Quellenkatalog | NY-Fed ohne ×10, `asOf` + `schemaVersion`, Aktivität ohne ISM-Label; Kurve, AD, Sentiment, FINRA und EZ/JP offen. Siehe Abschnitt 6 | 🟡 |
| 43 | fertig_WORK_PEER_ADAPTIVE.md | 2-Hop+Industry | `peers2hop`, Map nur wenn F leer | ✅ |
| 44 | fertig_WORK_PEER_PRICING_POWER.md | Relativ nur Low-Moat | `peerMaterial`-Gate und Banner | ✅ |
| 45 | FactPack (`docs/.../FACTPACK_LLM.md`) | Validate+Hook | Hook+UI live `#57` | ✅ |

### 1c. Nachzug 29.09. Abend / 30.09. Morgen / 30.09. Vormittag — #70–#103

Ampel folgt dem Live-Stand: ✅ nur bei bestätigter Anzeige. Vormittag-Hub war `d517611` (#78); Hub #89 Stand Abend `f0046ee9` (`20120339`); Hub #90 `ee5f0f8b` (Docs-Tip `9895774f`); Hub-Draft #95 Inhalt `1dc82683` (#92✅ #93🟡); Abend-Tip `249841ab` (parent `1dc82683`); Morgen-Tip `c365c945` (PR #100; parent `4c615eb3` #99; Bundle `index-MIF1Ml5X.js`; #99✅ #100✅ #93 Label ✅; #96 closed ohne Merge, nicht grün); Vormittag-Tip `e2bc69a2` (PR #103 Miner Observability; parent `58bec00c` #101 Docs; Bundle `index-MIF1Ml5X.js` unverändert, server-only; #103✅; Soft `MEMPOOL_NETWORK` = Render→mempool Egress).

| # | Item | Soll | Ist (Code / Live) | Ampel |
|---|------|------|-------------------|-------|
| #70 | Portfolio Dual-Line | `benchPct` vs Performance | Code ✅ `358681a` · Live ✅ | ✅ |
| #71 | Performance-Chart 4 Toggles | Ein/Aus + Bench-Kurs | Code ✅ `60aeeb2` · UI ok · OHLCV-Honesty #74 · Chart oft weiter leer | 🟡 |
| #72 | Dashboard-Badges 1–20 | Exec=1, FS=4, Tech=12 | Code ✅ `a7bfb15` · Live PASS Bundle `index-PW9HgI6J.js` @ `22d4af9`+ | ✅ |
| #73 | fertig_WORK_THESIS_LAB.md | `/#/lab` + 6 Fixtures | Code ✅ `22d4af9` · Live PASS `/#/lab` + 6 Fixtures | ✅ |
| #74 | Batch A (OHLCV honesty / Search / Error-UI / Recession) | Fake-OK `bars=[]` ehrlich | Code ✅ `e8ebd35c` · Live ✅ source:fmp fixed | ✅ |
| #75 | Moat Ökosystem-Chip | Chip nur bei `hasEcosystem` | Code ✅ `08d82b2` · Live ✅ nach Deploy | ✅ |
| #76 | DCF Default-β | Default = Markt-β (Sektor-Anker bleibt Modus) | Code ✅ `ef0f31e` · Live ✅ nach Deploy | ✅ |
| #77 | Makro-Korrelationsmatrix §15 | volle Matrix statt 4-Faktor-Stub | Code ✅ `d517611` · Live ✅ nach Deploy | ✅ |
| #81 | Porter Moat/Ökosystem Prompt (Option A) | Prompt-Kontext Moat + Ökosystem | Code ✅ `c6dc39d1` · Live ✅ Score-DoD PASS; Narrative via force+useLLM | ✅ |
| #82 | Exec Pro/Contra/Downside Boxen | 3 Boxen | Code ✅ `78c8521e` · Live ✅ Bundle H2cTedRt PASS | ✅ |
| #83 | Fenster-Rendite Zonen | green≥0 / red<0 + 0%-Linie | Code ✅ `8a7ee044` · Live ✅ Bundle C61GQzdr, dann Nachfolger | ✅ |
| #84 | Sharpe 5. KPI | 5. KPI-Card Overview | Code ✅ `32466b6c` · Live ✅ Bundle Jx0cX7cU; Sharpe=0.947 | ✅ |
| #85 | Attribution volle Historie | volle OHLCV-Historie vs Benchmark | Code ✅ `f6a6a398` · Live ✅ Re-DoD 251 common days AAPL+MSFT | ✅ |
| #86 | Fenster-Tooltip Kontrast | lesbare Tooltip-Zeile | Code ✅ `7e9279db` · Live ✅ Bundle `index-Ca0V7H2h.js`; Datum #0f172a, Fenster #10b981 | ✅ |
| #87 | thin-series Prävention | dünne Serie aus Backtest-Intersection | Code ✅ `2fb8b70a` · Live 🟡 PARTIAL: healthy 251d OK; thin-Banner nicht repro | 🟡 |
| #88 | Pie über Performance / Chart 360px | Selektierte Aktien über Performance, Chart 360px | Code ✅ `f0046ee9` · Live ✅ Bundle `index-Ca0V7H2h.js`; grid-cols-1, h-[360px] Performance | ✅ |
| #90 | TAM Coverage-Lift | unmatched FMP segment labels | Code ✅ `ee5f0f8b` · Live ✅ PASS Bundle `index-Ca0V7H2h.js` (same as #88 stack; Analyze path). DoD: AMZN 75.2% ok; NVDA 98.2% weak; MSFT 58.5% unreliable (Server unmatched, `tamTotal` null) | ✅ |
| #92 | TA Zwei-Fenster | zwei Kalenderfenster, echte closeB-Linie | Code ✅ `c06c835e` → Fix `1dc82683` (#94) · Live ✅ PASS Re-DoD Bundle `index-JP8muGsY.js`. Zwei echte Linien: A close/primary/1.5 unverfärbt; eigene closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster = Extra An/Aus. Soft Draw-Order B-unter (DoD OK). | ✅ |
| #93 | KI-N/A-Fill Segment-TAM | KI-Schätzung unmatched Segment-TAM | Code ✅ `7574b12d` · Behavior+API war schon PASS (MSFT amber ~59%; KI nur unmatched + violet Badge; Catalog-Coverage unverändert; Clear → n/a; core 58.5%/unreliable/`tamTotal=null`). Label Soft → ✅ via #100 Live: Idle-Label jetzt Spec „N/A mit KI schätzen“. Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt. | ✅ |
| #97 | TA Kurs A/B/C Spec v3.1 | 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder | Code ✅ `249841ab` · Live ✅ PASS Bundle `index-C_rUCqgy.js`. 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder (eigene Y min–max je Band via `yDomainFromCloses` / `chart-price-bands`); `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL. DoD AAPL Shots `/workspace/dod-97-ta-kurs/`. Bleibt ✅; superseded by #99 Spec v3.2 live on same chart stack (Bundle `index-MIF1Ml5X.js`). | ✅ |
| #99 | TA Spec v3.2 | Default nur Kurs A; A+B gestapelte Bänder; MACD/RSI je Band; Desktop-Controls | Code ✅ `4c615eb3` → stack tip `c365c945` · Live ✅ PASS Bundle `index-MIF1Ml5X.js`. Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok (Mobile soft-skip). Shots `/workspace/dod-99-ta-v32/`. | ✅ |
| #100 | KI-N/A matrix (Relativ Bewertung / Section7) | volle Spaltenlabels; Idle „N/A mit KI schätzen“; fail-closed UI | Code ✅ `c365c945` · Live ✅ PASS Bundle `index-MIF1Ml5X.js`. Spalten Segment\|Rev.\|Anteil\|Wachstum\|TAM\|CAGR\|Anteil am TAM\|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert. Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt. Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet (keine Segments/keine N/A); 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0. Shots+Probe `/workspace/dod-100-ki-na/`. | ✅ |
| #101 | Docs Ampel Nachzug #99/#100 | MD-only Ampel auf tip nach #99+#100 | Docs ✅ `58bec00c` (MD-only; parent `c365c945`) · merged | ✅ |
| #103 | Miner Observability | Error-Body / 1× Retry / Stale-Cache; Kernformeln unberührt | Code ✅ `e2bc69a2` · Live ✅ PASS (server-only; Bundle `index-MIF1Ml5X.js` unverändert). Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient 400ms; Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`). Dateien `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43. UI `Section13Miner` unverändert. Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = Render→mempool Egress, kein Code-Delete. Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt. | ✅ |

FMP Billing: Premium aktiv (Analyze 200). Peer/ROIC ≡ `4bdc1f8`. Exec #69 Live ✅. BL §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3 Ticker.

---

## 2. Bereits umgesetzt (✅) — Kurz

- Sprint A/B, C1 (inkl. #49/#50/#51), C2, D1–D6c, Valuechain Phase 1–2 (Kupfer ehrlich rot).
- P1.1–P1.3: `c83e543` / `d6b41b3` / `9215cee`.
- CAPM E[r]-KPI auf Portfolio-Übersicht live.
- FactPack Hook+UI (`#57`), Exec-Summary UI (`#58`), VIX-Pane (`#60`), EU VSTOXX STOXX+CA (`#66` Live vol≈942).
- Portfolio `GET /api/ohlcv` (`#61`) — Live PASS Tester AAPL 1Y/2Y @ `6a1807b`. #74 Batch A Live ✅: Fake-OK `bars=[]` source:fmp fixed. Chart #71 oft weiter leer.
- Dual-Line Benchmark (`#70` `358681a`) live. Dashboard-Badges 1–20 (`#72` `a7bfb15`) Live PASS. Thesis Lab `/#/lab` (`#73` `22d4af9`) Live PASS, 6 Fixtures.
- Exec `#69` Live PASS (XOM; FMP Premium). Peer/ROIC Code intact (Tip ≡ `4bdc1f8`, kein Delete).
- Abend `f0046ee9`: #75/#76/#77 Live ✅ nach Deploy · #81 `c6dc39d1` · #82 `78c8521e` · #83 `8a7ee044` · #84 `32466b6c` · #85 `f6a6a398` · #86 `7e9279db` · #88 `f0046ee9` Live ✅. #87 `2fb8b70a` Code ✅, Live 🟡 PARTIAL (healthy 251d, thin-Banner nicht repro).
- Abend nach #92 Fix #94 (`1dc82683`, parent `7574b12d`): #92 TA Zwei-Fenster Live ✅ (`c06c835e` → Fix `1dc82683` #94, Bundle `index-JP8muGsY.js`; A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`). #93 `7574b12d` Code ✅, Live 🟡 PARTIAL (Label Soft UI „KI“ vs Spec „N/A mit KI schätzen“).
- Abend nach #97 (`249841ab`, parent `1dc82683`): #97 TA Kurs A/B/C Spec v3.1 Live ✅ PASS (Bundle `index-C_rUCqgy.js`; 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder, eigene Y min–max je Band via `yDomainFromCloses` / `chart-price-bands`; `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL; DoD AAPL Shots `/workspace/dod-97-ta-kurs/`). #96 damals Draft, nicht grün.
- Morgen 30.09. (`c365c945`, parent `4c615eb3`): #99 TA Spec v3.2 Live ✅ PASS (Bundle `index-MIF1Ml5X.js`; Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok, Mobile soft-skip; Shots `/workspace/dod-99-ta-v32/`). #100 KI-N/A matrix Live ✅ PASS (Section7 Spalten Segment|Rev.|Anteil|Wachstum|TAM|CAGR|Anteil am TAM|vs.TAM; Idle „N/A mit KI schätzen“; fail-closed UI; Soft Success-Badge `KI ✓` nicht geübt; Soft-Note `{}` → 400 `BAD_REQUEST` erwartet, 422 `INCOMPLETE_FILL` nur nach LLM Rest-n/a ≠ 0; Shots+Probe `/workspace/dod-100-ki-na/`). #93 Label Soft → ✅ via #100. #97 und #92 bleiben ✅. #96 closed ohne Merge — nicht reopen, nicht grün.
- Vormittag 30.09. (`e2bc69a2`, parent `58bec00c` #101 Docs): #103 Miner Observability Live ✅ PASS (Bundle `index-MIF1Ml5X.js` unverändert, server-only; Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry 400ms; Stale-Cache → 200 + `stale:true` bei Prior-Success, sonst 503 `error`+`code`(+`cause`); Unit `script/test-btc-miner-observability.ts` 43/43; UI `Section13Miner` unverändert; Soft-Note `MEMPOOL_NETWORK` / `fetch failed` = Render→mempool Egress, kein Code-Delete). Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt. #99/#100/#93/#97/#92 bleiben ✅. #96 closed ohne Merge — nicht reopen, nicht grün.

**Nicht neu bauen / nicht anfassen:** Miner-Kern, PEG, inverted DCF Core, Sentiment, Portfolio F.2, Valuechain Rang 1–9 (CSS-Karten plus xyflow-Stufenfluss).

---

## 3. Offen 🟡 / ⬜ (workable; Rang 7–9 nicht neu bauen)

**🟡 Partial:** Portfolio-Backtest Rest-DoD · #71 4-Toggles (Chart oft leer; OHLCV-Honesty #74) · #87 thin-series (healthy 251d OK, thin-Banner nicht repro) · Fiscal-Frontend (`S_F*` bei Historie, GIS bei `FE.available`, Cron/QRA optional) · Liquidity-Briefing-Quellen (MoF/Realzins/X-Bot offen) · Researcher-LI (Panel ohne Region) · Sahm (letzte 12 nicht ±0.02, EZ/JP fehlen) · Recession-Sources (Kurve/AD/Sentiment/FINRA/EZ-JP) · Section4 (Earnings/Analysten/Growth/Moat). #93 KI-N/A-Fill Label Soft → ✅ via #100 (nicht mehr Partial). #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün.

**⬜ Spec:** Velocity-Stocks (kein Regions-Widget r/V/π/T½). Value-Chain und Briefing regional sind auf dem Tip `fertig_` (#169), kein Live-Deploy aus dem Rename. Sahm bleibt `Offen_`.

**Kein Gap:** Black-Litterman §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter/Chart-Soll. Efficient Frontier ≥3 Ticker.

**Queue 29.09. Abend:**

1. Batch A: Search / 429-Transparenz / OHLCV Fake-OK ehrlich surface (Prompt 5) — **done** (`e8ebd35c`, #74 Live ✅).
2. TAM Coverage-Lift — Spec `fertig_WORK_TAM_SEGMENT_MAPPING.md` Tor ok; Gap = unmatched Labels — **done** ✅ (`ee5f0f8b`, #90 Live ✅). DoD: AMZN 75.2% ok; NVDA 98.2% weak; MSFT 58.5% unreliable (Server unmatched, `tamTotal` null).
3. Miner Observability — **done** ✅ (#103 `e2bc69a2`; kein Delete, ≡ `b584446f` Kern). Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient 400ms; Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`). Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = Render→mempool Egress, kein Code-Delete. Kernformeln Breakeven/Puell/Hash Ribbons unberührt. UI `Section13Miner` unverändert.
4. Ökosystem Scoring-Weichzeichnung (Zykliker-Grad) = Folge-Lane nach Chip (#75 Live ✅).
5. Ziel+z-Treiber liegen auf main (`fertig_WORK_RECESSION_2008_DRIVERS_LLM.md`). Gated unverändert: Liquidity-Bundle. Valuechain Rang 7–9 ist Code, nicht neu bauen.

Reihenfolge sinnvoll: TAM Coverage-Lift done ✅ (#90) · Liquidity-Bundle bleibt gegated. Valuechain Rang 7–9 nicht neu bauen.

**Queue 30.09. Morgen:** #99 TA Spec v3.2 Live ✅ (`4c615eb3`, Bundle `index-MIF1Ml5X.js`) · #100 KI-N/A matrix Live ✅ (`c365c945`) · #93 Label ✅ via #100 · #96 nicht reopen.

**Queue 30.09. Vormittag:** #103 Miner Observability Live ✅ (tip `e2bc69a2`; Bundle `index-MIF1Ml5X.js` unverändert, server-only) · Soft Egress `MEMPOOL_NETWORK` = Render→mempool, kein Code-Delete · #99✅ #100✅ #93 Label✅ #97✅ #92✅ bleiben · #96 nicht reopen.

#96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün (vormals Draft Merge-Gate, Soft Apollo bis Philip GO; Label Soft #93 ist via #100 Live ✅, nicht über #96).

---

## 4. Blockiert

- **D6 Rang 7–9** — Dateiname `fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md` auf Tip `191792c5` (#169 Docs-Rename). Custom Edges / Animation / optionales Redis sind im Code (`@xyflow/react`). CSS-Karten bleiben. Ohne Redis-URL: In-Process. Nicht neu bauen. Live-Deploy nicht behauptet. Sahm bleibt `Offen_WORK_RECESSION_FRED_SAHM.md`.

`Future_Work.md` = Roadmap, kein Ticket. Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md` und `docs/Doc_Soll_vs_Ist/`.

---

## 5. Dateinamen 2026-10-03 (tip `839d954`)

Historischer Snapshot. Dateinamen auf Tip `191792c5` stehen in Abschnitt 6. Diese Liste nicht als aktuellen Stand lesen.

Gelesen am Code von `839d954`, nicht an Dateialter. Drei Index-Dateien bleiben ohne Präfix: `WORK.md`, `WORK_IST_VS_SOLL.md`, `WORK_IMPLEMENTIERUNG_OFFEN.md`. Bestehende `fertig_*`-Namen sind unverändert.

### Offen

- `Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md` — EZ-M3, BoJ-M2 und der asiatische Realzins sind nicht als Fetch für Velocity oder Briefing im Code.
- `Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md` — `GET /api/analyze-btc/fiscal-frontend` rechnet s(z) für N^b, SOMA und ΔDFF. `S_F*` nutzt MSPD-Monats-FE (`ΔWSHOBL` ~28T − `N^b_Δm`) plus `s(−z_ΔTGA)`, sobald mindestens 12 Vormonate und die TGA-Historie da sind. `D_30` bleibt im Live-`FE_30`; die Spec-Quelle DefiLlama hat keine 24-Monats-Reihe. Der Macro-Slot in `btcAnalysis.ts` wird `score_MacroFiscal`, sobald `FE.available`. Cron 22:00 ET und der QRA-PDF-Extrakt sind optional und nicht gebaut. Die Datei bleibt `Offen_`.
- `Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md` — kein Regions-Widget für Debt/GDP, Realzins, Velocity und Halbwertszeit.
- `Offen_WORK_RECESSION_FRED_SAHM.md` — `scoreSahm` in `server/recession.ts` ist weiter `>= 0.5 ? 4 : -3`, nicht s(z) über 20 Jahre.
- `Offen_WORK_RECESSION_SOURCES.md` — der NY-Fed-Anker wird mit ×10 gebildet, Sahm und Kurve bleiben Schwellen-Scores, PMI nutzt Chicago als ISM-Proxy, und die Response hat kein `schemaVersion`.
- `Offen_WORK_RESEARCHER_BRIEFING_REGIONAL.md` — ein `briefing-result.json` und ein globales `topChanges`, keine drei Blöcke money, fiscal und trade.
- `Offen_WORK_RESEARCHER_LIQUIDITY_INDEX.md` — `LiquidityPanel` holt immer `GET /api/researcher/liquidity` ohne Region.
- `Offen_WORK_SECTION4_DATA_BUGS.md` — Trailing-PEG in `Section4.tsx` ist `peRatio / epsGrowth5Y`; FCF bleibt eine Cashflow-Zeile (`cashflow?.[0]`) in `server/fmp-fetcher.ts`.
- `Offen_WORK_STABLECOIN_TBILL_GENIUS.md` — DefiLlama-Marktkapitalisierung liegt in `server/stablecoin-liquidity.ts`; Z-Score, dynamischer T-Bill-Multiplikator und GENIUS-Stärke-Score fehlen.
- `Offen_WORK_VALUECHAIN_SECTOR_ROTATION.md` — CSS-Karten bleiben. Rang 7–9: `@xyflow/react` Custom Edges und Animation im Stufenfluss; Redis optional, ohne URL In-Process. Dateiname bleibt `Offen_`.

### Neu fertig

- `fertig_WORK_ANALYZE_DISK_CACHE.md` — `POST /api/analyze` liest und schreibt L1 (20 min) und L2 (7 Tage, gleicher Key); `force` löscht beide.
- `fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md` — dieselben Route-Hunks liegen in `server/analyze-route.ts`, Schema `2026-08-29-v2`.
- `fertig_WORK_BIAS_FIXES_INVERSE_DCF.md` — ab zwei Triggern ist der gehärtete Inverse-DCF die Basis in Fazit, Katalysatoren und Executive Summary.
- `fertig_WORK_PEER_ADAPTIVE.md` — 2-Hop unter `peers2hop:{TICKER}`; `CURATED_PEER_FALLBACK` nur wenn das Peer-Set leer ist.
- `fertig_WORK_PEER_PRICING_POWER.md` — `RELATIVE_GROWTH` nur bei `peerMaterial` und mindestens drei Peers, sonst Banner.
- `fertig_WORK_PORTFOLIO_SOLL_IST.md` — `TargetVsActualWeights` in `PortfolioOverview`: Soll, Ist, Active, Trade.
- `fertig_WORK_RECESSION_2008_DRIVERS_LLM.md` — Ziel+z-Matrix in `server/recession-drivers.ts`; `callLLMJson` nur wenn Menge A nicht leer ist; Dashboard zeigt „unauffällig“ oder Driver-Karten.
- `fertig_WORK_RECESSION_MARKET_CHARTS.md` — `GET /api/analyze-recession/markets` für SPY, QQQ, VGK, ASHR, Klick-Factpack und FINRA-Streifen nur unter SPY.
- `fertig_WORK_RECESSION_RATE_OIL_BRIDGE.md` — `server/recession-bridge.ts` hängt `bridge` an die Response; die 17 Indikatoren bleiben ohne diesen Score.
- `fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md` — `server/liquidity-index-catalog.ts` (`CATALOG.US` / `.EU` / `.ASIA`), `server/liquidity-index.ts`, `GET /api/researcher/liquidity?region=` mit `books.M` und `books.F`.
- `fertig_WORK.md_portfolio_3` — `server/ohlcv-route.ts` (`GET /api/ohlcv`) und die Long-Map in `client/src/pages/PortfolioPage.tsx`, Badge in `PortfolioOverview.tsx`.
- `fertig_WORK_PORTFOLIO_BACKTEST.md` — `client/src/lib/portfolio/backtest.ts` und `client/src/components/portfolio/PortfolioBacktestPanel.tsx`.
- `fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md` — `client/src/lib/portfolio/engine.ts` mit `weighting.ts` und `frontier.ts`, Ist/Ziel-Toggle in `PortfolioOverview.tsx`.
- `fertig_WORK_TEIL0-6.md` — `client/src/pages/BTCDashboard.tsx` und `server/btc-miner.ts` (`calcBreakevenPrice`, `calcPuellMultiple`, `classifyMinerZone`).

---

## 6. 05.10.2026 Tip 191792c5

Gelesen am Tip `191792c5b09e67658641d49fc73991df14be3bbc`. Draft-PRs zählen nicht. Keep-Alive (leeres `RENDER_URL`) ist kein Ampel-ROT. Kein Live-Deploy aus den Docs-Renames.

Bereits `fertig_` auf diesem Tip, nicht wieder geöffnet: `fertig_WORK_STABLECOIN_TBILL_GENIUS.md` (#165), `fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md` (#169), `fertig_WORK_RESEARCHER_BRIEFING_REGIONAL.md` (#169), `Fertig_MINER_INTEGRATION.md` (parent `b952469d`). Sahm bleibt `Offen_WORK_RECESSION_FRED_SAHM.md`.

### 1. `Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md` — 🟡

**Soll:** Katalog ohne tote FRED-IDs; EZ-M3 und JP-M2 direkt von EZB/BoJ; APP/PEPP; Realzins inkl. MoF-Tageszins und `DFII10`; Spillover; EM; X-Bot-Allowlist; DoD-Fixtures §9.

**Ist:** `server/liquidity-briefing.ts` holt sieben Quellen (EZB-M3, M3-YoY, EZ-NGDP, APP-CSV, PEPP-CSV, BoJ-M2, FRED `JPNNGDP`). Tote Serien aus §0 stehen in `DEAD_FRED_SERIES` und fehlen in den URLs. `GET /api/researcher/liquidity-briefing` und `LiquidityBriefingPanel` zeigen EZ/JP-Velocity und APP/PEPP. `halfLifeYears` und die Fixtures M2V, APP −27.170, PEPP −24.821, `DFII10` 2.42, `IRLTLT01JPM156N` 2.670, Bills-Diff 298.202 liegen im Parser-Test, nicht als Live-Fetch. `LIVE_FRED_SERIES` ist nur `JPNNGDP`. Keine MoF-CSV (`mof.go.jp`), kein Live-`DFII10`, kein X-Bot. Spec bleibt `Offen_`.

### 2. `Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md` — 🟡

**Soll:** `N^b`, `FE`, `S_M` / `S_F*` / `S_D`, QRA-Anker ohne Score-Eingang, GIS-Slot erst bei `FE.available`, Cron/QRA-LLM optional in Step 7.

**Ist:** `GET /api/analyze-btc/fiscal-frontend`, `fiscal-frontend-math.ts`, `qra-snapshot.ts` und die Karten in `StablecoinLiquidityPanel`. `S_F*` nutzt MSPD-Monats-FE (`ΔWSHOBL` ~28T − `N^b`) plus TGA, sobald mindestens 12 Vormonate und die TGA-Historie da sind. Der Macro-Slot in `btcAnalysis.ts` nimmt `score_MacroFiscal`, sobald `FE.available`; sonst bleibt `FFR > 5` → −1 und `< 3` → +1. Cron 22:00 ET und der QRA-PDF-Extrakt sind optional; `QRA_SNAPSHOT` bleibt statisches JSON. Spec bleibt `Offen_`.

### 3. `Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md` — ⬜

**Soll:** Widget-Zeile über dem LI für drei Regionen: Debt/GDP, Bondmarkt, Realzins `r`, Fiscal- und Geldtrend, Velocity `V`, Einpreisung `π`, Halbwertszeit `T½`.

**Ist:** Kein `RegionalStocks`-Payload und keine solche Zeile im Client. `halfLifeYears` in `liquidity-briefing-math.ts` ist der T½-Helfer der Quellen-Spec, nicht dieses Widget. Drafts außerhalb des Tips zählen nicht. Spec bleibt `Offen_`.

### 4. `Offen_WORK_RECESSION_FRED_SAHM.md` — 🟡

**Soll:** `S` aus der Arbeitslosenquote, Kontrolle gegen `SAHMREALTIME` über die letzten 12 Monate mit max |Diff| 0.02, dann `s(z)` über 20 Jahre. Die 0.50-pp-Marke ist nur das UI-Label. EZ `une_rt_m` und JP `LRUNTTTTJPM156S` dieselbe Formel. `n < 24` → `available: false`.

**Ist:** `scoreSahm` in `server/recession.ts` holt `UNRATE` und `SAHMREALTIME` und zeigt die Realtime-Serie. `scoreSahmLevels` rechnet `s(z)` (H 240, unter 24 Monaten Score 50). Die Fixture in `script/test-recession-sahm.ts` (Prints 2026-10-03, UNRATE Oktober 2025 leer) setzt `controlOk === false`: nur 2025-09 liegt bei ±0.02, 11 der letzten 12 Kontrollmonate sind leer. Der UNRATE-Backup ist `available: false` und `s = 50`, kein 20-Jahres-z über die Lücke. `une_rt_m` und `LRUNTTTTJPM156S` werden nicht geholt. Dateiname bleibt `Offen_`.

### 5. `Offen_WORK_RECESSION_SOURCES.md` — 🟡

**Soll:** Neun Punkte: `available: false` aus Netto/Max, AD live oder weg, Sentiment = VIX plus höchstens ein Crowd-Bein, NY-Fed in Prozent ohne ×10, Sahm und Kurve als `s(z)` über 20 Jahre, Fazit aus zwei P, FINRA in Mrd. $ mit YoY, Slotname ohne ISM-Label, `asOf` + `schemaVersion`. EZ/JP eigenes Raster.

**Ist:** `nyFedAnchorPct` gibt `RECPROUSM156N` unverändert zurück. Response hat `asOf` und `schemaVersion`. Aktivität heißt „Aktivität (IP / Auslastung)“ und liest `INDPRO` plus `TCU`. `scoredTotals` lässt `available === false` aus Netto und Max. `generateFazit` hat eine Handlung aus `P_korr12` und `P_rez12`. Offen auf dem Tip: die Zinskurve bleibt `invertiert ? 4 : -3`; die Advance-Decline-Linie setzt weiter den Default −2; Sentiment zählt VIX, CNN, AAII, Put/Call und Investors Intelligence; Margin Debt liest das Meta-Tag von currentmarketvaluation statt FINRA-XLS; EZ- und JP-Serien fehlen im Scorer. Spec bleibt `Offen_`.

### 6. `Offen_WORK_RESEARCHER_LIQUIDITY_INDEX.md` — 🟡

**Soll:** `LiquidityIndexPanel({ region })` mit `GET /api/researcher/liquidity?region=US|EU|ASIA`, Slots A–D, `s(z)`, verfügbare Maske. `LiquidityPanel` darf die Region nicht ignorieren.

**Ist:** Die Route nimmt `region` an und `buildLiquidityIndex` liefert `li`, Label und `books.M` / `books.F` (`liquidity-index-math.ts`). `LiquidityPanel` ruft `GET /api/researcher/liquidity` ohne Region; `MacroPanel` reicht `region` nicht durch. Leere Fetches auf dem Tip: EU-Assets und APP/PEPP, Asien JGB-Käufe, BoJ-M2, JGB-Emission, Gov-Deposits (`points: []`). Spec bleibt `Offen_`.

### 7. `Offen_WORK_SECTION4_DATA_BUGS.md` — 🟡

**Soll:** Trailing-PEG = `peRatio / epsGrowth5Y`. FCF mehrperiodig mit Vorzeichen, nie stilles $0. Geo-Dedup über Name+Revenue und `NON_GEO_PATTERN`. Earnings, Analysten, Growth-Labels und Moat bleiben in der Spec offen, bis ihr DoD zu ist. PEG-Formel und inverted DCF nicht neu schreiben.

**Ist:** `Section4.tsx` zeigt die Trailing-Division und den Server-`pegRatio` nur als Zusatzzeile. `computeFcfTTM` in `analyze-helpers.ts` behält negatives GAAP-FCF, geht bis zu drei Perioden und gibt `null` statt $0 zurück; `fmp-fetcher.ts` hängt das an `fcfTTM` plus `fcfCapexHint`. `analyze-route.ts` ruft `filterGeographicDuplicates` und `dropAliasRevenueDuplicates` auf. Earnings-Datum, Analystenzahl, Growth-Labels und Moat sind in dieser Spec nicht zu. PEG-Box und inverted DCF wurden in diesem Nachzug nicht angefasst. Spec bleibt `Offen_`, bis das DoD der restlichen Zeilen erfüllt ist.
