# Doc_Soll_vs_Ist

> Stand: 03.10.2026 (nach #134 Peer-Set material gate Live PASS) | Ampel aus **Code + UI** (Live Render) · HEAD `b8feab3` · Bundle `index-BRhIEX2j.js`
> Originale im **Repo-Root**. Dieser Ordner verlinkt nur.
>
> Alt: [work-offen](../work-offen/) · [work-dokumentation](../work-dokumentation/)

**Regel:** `✅` nur wenn die *erwartete Anzeige* live ist. Datei + Lib ohne KPI/Serie = `🟡` oder `⬜`. „Deploy folgt“ = Code auf `main`, Live nicht geprüft → `🟡`.

**Nachzug 03.10.2026, nach #134 Peer-Set material gate Live PASS (`b8feab3`, Bundle `index-BRhIEX2j.js`, https://aktienanalyst.onrender.com, Tester PASS):** #134 Peer-Set material gate Live ✅ (tip `b8feab3` = `b8feab3183e87a2313426c2c40d83030d1abeb5f`; parent `6fedbf4` #128). Tester MSFT ($517.53): vorher 2 Fakt-Peers AAPL und NVDA. Ein Klick „N/A mit KI schätzen“ setzt eine violette Zeile GOOGL mit KI-Badge und FMP-Kennzahlen (Mkt Cap $4.2T, P/E 28.8, ROIC FY2026 21.8%). Ø Peers unverändert (P/E 36.0, ROIC 57.5%). Notiz „KI-Vorschlag: 1 Ticker · KI-Vorschlag · Kennzahlen von FMP · Relativ-Score unverändert.“ RELATIVE_GROWTH inaktiv: „Relativ nicht score-wirksam (peerMaterial)“. Banner „Peer-Set unvollständig“ fehlt zu Recht (Moat Wide, Rivalität Medium Score 3, peerCount 2; Banner nur bei Moat None/Narrow oder hoher Rivalität). Vertrag im Repo bestätigt: UI `Section7` → `POST /api/analyze/:ticker/peer-na-fill` → `requestPeerNaFills` → `assessPeerSet` / `buildGates` → Schema `PeerSetStatus` / `PeerNaFill`. KI nennt nur Ticker, Kennzahlen kommen von FMP, der Relativ-Score bleibt unverändert wenn das Set nicht material ist. 422 `INCOMPLETE_FILL` live nicht gesehen, weil FMP GOOGL geliefert hat. #128 Miner-Zone Badge 13 Live ✅ (Code `6fedbf4e` = `6fedbf4e656dc1192ca40f1f93424f9b17826f36`; auf tip `b8feab3` ohne Diff an `BTCDashboard.tsx`, `Section13Miner.tsx`, `server/btc-miner.ts`, `server/routes.ts`). Sidebar 1–14. Badge 3 bleibt Krypto-Liquidität. Badges 1–12 unverändert. Badge 13 Miner-Zone steht direkt vor Badge 14 Umfassendes Gesamt-Fazit. Live PASS am Tip `6fedbf4e`, Bundle `index-CsbicERe.js`: Puell 1.05, Miner-Breakeven $61,351.89. `POST /api/btc-miner` unverändert. Die #128-Ampel fehlte auf main und ist hier gegen tip `b8feab3` gezogen. #103✅ #99✅ #100✅ bleiben.

**Nachzug 30.09. Vormittag, nach #103 Miner Observability Live PASS (`e2bc69a2`, Bundle `index-MIF1Ml5X.js` unverändert — Client unverändert, #103 server-only; DoD PASS):** #103 Miner Observability Live ✅ (tip `e2bc69a2` = `e2bc69a233166a3242d13e9ddc78373adc19f68c`; parent `58bec00c` #101 Docs ← `c365c945` #100 ← `4c615eb3` #99). Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient (400ms); Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`). Dateien `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43. UI `Section13Miner` unverändert. Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = **Render→mempool Egress**, kein fehlender/gelöschter Code. Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt. #99✅ #100✅ #93 Label✅ #97✅ #92✅ bleiben. #96 closed ohne Merge — nicht reopen, nicht grün. #101 Docs Ampel Nachzug #99/#100 ✅ merged (`58bec00c`, MD-only).

**Nachzug 30.09. Morgen, nach #99+#100 Live PASS (`c365c945`, Bundle `index-MIF1Ml5X.js`, Dual-DoD PASS) — historisch, vor #103:** #99 TA Spec v3.2 Live ✅ (SHA `4c615eb3` → stack tip `c365c945`; Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok, Mobile soft-skip; Shots `/workspace/dod-99-ta-v32/`). #100 KI-N/A matrix (Relativ Bewertung / Section7) Live ✅ (Spalten Segment|Rev.|Anteil|Wachstum|TAM|CAGR|Anteil am TAM|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert; Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt; Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet, keine Segments/keine N/A; 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0; Shots+Probe `/workspace/dod-100-ki-na/`). #93 KI-N/A-Fill Segment-TAM ✅ Label cleared (Idle-Label Spec „N/A mit KI schätzen“ via #100; Behavior+API PASS @ `7574b12d`; Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt). #97 bleibt ✅ (superseded by v3.2 live on same chart stack). #92 bleibt ✅. #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün. Prior ✅ (#90, #74, #75–#77, #81–#86, #88, #70/#72/#73, #69, Peer/ROIC) unverändert.

**Nachzug 29.09. Abend, nach #97 Live PASS (`249841ab`) — historisch, vor #99/#100:** #97 TA Kurs A/B/C Spec v3.1 Live ✅ PASS (SHA `249841ab`; parent `1dc82683`; Bundle `index-C_rUCqgy.js`; 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder (eigene Y min–max je Band via `yDomainFromCloses` / `chart-price-bands`); `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL; DoD AAPL Shots `/workspace/dod-97-ta-kurs/`). #92 TA Zwei-Fenster Live ✅ PASS Re-DoD (SHA `c06c835e` → Fix `1dc82683` #94; Bundle `index-JP8muGsY.js`; A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster Extra An/Aus; Soft Draw-Order B-unter OK). #93 KI-N/A-Fill Segment-TAM 🟡 PARTIAL (`7574b12d`; Behavior+API PASS — MSFT amber ~59%; KI nur unmatched + violet Badge; Catalog-Coverage unverändert; Clear → n/a; core 58.5%/unreliable/`tamTotal=null`; Label Soft: UI „KI“ vs Spec „N/A mit KI schätzen“). #96 KI-Fill v2 bleibt Draft Merge-Gate — nicht grün (Label Soft #93 kann nach #96 Live weg; Soft Apollo bis Philip GO). #90 TAM Coverage-Lift Live ✅ (Bundle `index-Ca0V7H2h.js`; DoD: AMZN 75.2% ok, NVDA 98.2% weak, MSFT 58.5% unreliable — Server unmatched, `tamTotal` null). Queue Coverage-Lift ✅. #74 Batch A Live ✅ (Fake-OK `bars=[]` source:fmp fixed) · #75 Ökosystem-Chip / #76 DCF Markt-β / #77 Makro §15 Live ✅ nach Deploy · #81 Porter Prompt · #82 Exec-Boxen · #83 Fenster-Zonen · #84 Sharpe · #85 Attribution (251d AAPL+MSFT) · #86 Tooltip · #88 Pie über Performance / Chart 360px Live ✅ · #87 thin-series 🟡 PARTIAL (healthy 251d OK, thin-Banner nicht repro) · #71 4-Toggles weiter 🟡 · #70/#72/#73 Live ✅ · Exec #69 Live ✅ · Peer/ROIC ≡ `4bdc1f8`. BL §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3. Hub-Vormittag war `d517611` (#78); Hub #89 Stand Abend `f0046ee9` (`20120339`); Hub #90 `ee5f0f8b` (Docs-Tip `9895774f`); Hub-Draft #95 Inhalt `1dc82683` (#92✅ #93🟡, noch offen).

**Nachzug 13.09. (+ portfolio_3 PASS):** Exec / FactPack / VIX+EU-Vol / Portfolio OHLCV §6 ✅ · Hormuz (B) 🟡 · Liquidity-Bundle ⬜ · Rang 7–9 blockiert · Backtest weiter 🟡. OHLCV §6-Code bleibt; #74 Fake-OK source:fmp fixed; Chart #71 oft weiter leer.

---

## Soll — Spec, erwartete UI fehlt oder Engine fehlt

| Spec (Root) | Soll | Ist Code + UI | Ampel |
|-------------|------|---------------|-------|
| [fertig_WORK_PORTFOLIO_BACKTEST.md](../../fertig_WORK_PORTFOLIO_BACKTEST.md) | Equity, α/β/IR, Underwater, Capture | Panel da; braucht Positionen+OHLCV; Rest-DoD | `🟡` |
| [Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md](../../Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md) | Katalog + Fetch | nur Markdown | `⬜` |
| [Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md](../../Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md) | s(z), kein Kalender | `BESSENT_WINDOW` in `liquidity-regime-math.ts` | `⬜` |
| [Offen_WORK_RESEARCHER_LIQUIDITY_INDEX.md](../../Offen_WORK_RESEARCHER_LIQUIDITY_INDEX.md) | LI US/EU/ASIA | C2 nur US | `⬜` |
| [Offen_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md](../../Offen_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md) | Buch M/F EZ/JP | kein Katalog | `⬜` |
| [Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md](../../Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md) | r, V, π, T½ | M2V US + Eimer 0.02 | `⬜` |
| [Offen_WORK_RESEARCHER_BRIEFING_REGIONAL.md](../../Offen_WORK_RESEARCHER_BRIEFING_REGIONAL.md) | 3 Regionen + Spillover | ein Prompt, NEW=`high` | `⬜` |
| [Offen_WORK_VALUECHAIN_SECTOR_ROTATION.md](../../Offen_WORK_VALUECHAIN_SECTOR_ROTATION.md) | Rang 1–9 | 1–6 live; **Rang 7–9** xyflow blockiert | `🟡` blockiert |
| [Offen_WORK_RECESSION_MARKET_CHARTS.md](../../Offen_WORK_RECESSION_MARKET_CHARTS.md) | VIX-Pane + PEG-Click + FINRA | VIX/VSTOXX/realized live (US/EU/AS); PEG-Click + FINRA offen | `🟡` |
| [Offen_WORK_RECESSION_2008_DRIVERS_LLM.md](../../Offen_WORK_RECESSION_2008_DRIVERS_LLM.md) | SLOOS/Price-Rent/TED + OpenRouter-Driver | Hormuz-(A) Essay gelöscht (#59); **`recession-drivers.ts` fehlt** (B) | `🟡` |
| [Offen_WORK_RECESSION_FRED_SAHM.md](../../Offen_WORK_RECESSION_FRED_SAHM.md) | adaptive FRED + Sahm s(z) | Spec | `⬜` |
| [Offen_WORK_RECESSION_RATE_OIL_BRIDGE.md](../../Offen_WORK_RECESSION_RATE_OIL_BRIDGE.md) | Zins-Brücke + Öl | Spec | `⬜` |
| [Offen_WORK_RECESSION_SOURCES.md](../../Offen_WORK_RECESSION_SOURCES.md) | Quellenkatalog | Spec | `⬜` |
| [Offen_WORK_PEER_ADAPTIVE.md](../../Offen_WORK_PEER_ADAPTIVE.md) | 2-Hop+Industry | Spec; Hardcode-Map lebt | `⬜` |
| [Offen_WORK_PEER_PRICING_POWER.md](../../Offen_WORK_PEER_PRICING_POWER.md) | Relativ nur Low-Moat | Spec Companion | `⬜` |
| Performance-Chart 4 Toggles (#71) | Ein/Aus + Bench-Kurs | UI da (`60aeeb2`); OHLCV-Honesty #74; Chart oft weiter leer | `🟡` |
| thin-series Prävention (#87) | dünne Serie aus Backtest-Intersection | Code `2fb8b70a`; healthy 251d OK; thin-Banner nicht repro auf Live | `🟡` PARTIAL |

Detail Exec: [WORK_EXEC_SUMMARY.md](./WORK_EXEC_SUMMARY.md) · FactPack [FACTPACK_LLM.md](./FACTPACK_LLM.md) · FMP/BB [FMP_GRENZEN_BLOOMBERG.md](./FMP_GRENZEN_BLOOMBERG.md)

---

## Ist — Kern im Code und in der UI nutzbar (wenn Daten da)

| Spec (Root) | Code / Live |
|-------------|-------------|
| [fertig_WORK_EXEC_SUMMARY.md](../../fertig_WORK_EXEC_SUMMARY.md) | Exec-Karte über S1 live (#58); #69 Ampel+KI+FS Live PASS (XOM, FMP Premium) |
| Portfolio Dual-Line (#70) | `benchPct` vs Performance live (`358681a`) |
| Dashboard-Badges 1–20 (#72) | Exec=1, FS=4, Tech=12 · Live PASS Bundle `index-PW9HgI6J.js` @ `22d4af9`+ |
| [fertig_WORK_THESIS_LAB.md](../../fertig_WORK_THESIS_LAB.md) | `/#/lab` + 6 Fixtures Live PASS (`22d4af9`, #73) |
| Batch A (#74) | OHLCV honesty / Search / Error-UI / Recession · `e8ebd35c` · Fake-OK `bars=[]` source:fmp fixed · Live ✅ |
| Moat Ökosystem-Chip (#75) | Chip nur bei `hasEcosystem` · `08d82b2` · Live ✅ nach Deploy |
| DCF Default Markt-β (#76) | Default β = Markt-β · `ef0f31e` · Live ✅ nach Deploy |
| Makro-Korrelationsmatrix §15 (#77) | volle Matrix · `d517611` · Live ✅ nach Deploy |
| Porter Moat/Ökosystem Prompt (#81) | Option A · `c6dc39d1` · Score-DoD PASS; Narrative via force+useLLM |
| Exec Pro/Contra/Downside (#82) | 3 Boxen · `78c8521e` · Bundle H2cTedRt PASS |
| Fenster-Rendite Zonen (#83) | green≥0 / red<0 + 0%-Linie · `8a7ee044` · Bundle C61GQzdr, dann Nachfolger |
| Sharpe 5. KPI (#84) | `32466b6c` · Bundle Jx0cX7cU; Sharpe=0.947 |
| Attribution volle Historie (#85) | `f6a6a398` · Re-DoD 251 common days AAPL+MSFT |
| Fenster-Tooltip Kontrast (#86) | `7e9279db` · Bundle `index-Ca0V7H2h.js`; Datum #0f172a, Fenster #10b981 |
| Pie über Performance / Chart 360px (#88) | `f0046ee9` · Bundle `index-Ca0V7H2h.js`; grid-cols-1, h-[360px] Performance |
| TAM Coverage-Lift (#90) | `ee5f0f8b` · Live ✅ PASS Bundle `index-Ca0V7H2h.js` (same as #88 stack; Analyze path). DoD: AMZN 75.2% ok; NVDA 98.2% weak; MSFT 58.5% unreliable (Server unmatched, `tamTotal` null) |
| TA Zwei-Fenster (#92) | `c06c835e` → Fix `1dc82683` (#94) · Live ✅ PASS Re-DoD Bundle `index-JP8muGsY.js`. A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster = Extra An/Aus. Soft Draw-Order B-unter (DoD OK). |
| TA Kurs A/B/C Spec v3.1 (#97) | `249841ab` · Live ✅ PASS Bundle `index-C_rUCqgy.js`. 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder (eigene Y min–max je Band via `yDomainFromCloses` / `chart-price-bands`); `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL. DoD AAPL Shots `/workspace/dod-97-ta-kurs/`. Bleibt ✅; superseded by #99 Spec v3.2 live on same chart stack. |
| TA Spec v3.2 (#99) | `4c615eb3` → stack tip `c365c945` · Live ✅ PASS Bundle `index-MIF1Ml5X.js`. Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok (Mobile soft-skip). Shots `/workspace/dod-99-ta-v32/`. |
| KI-N/A matrix Section7 (#100) | `c365c945` · Live ✅ PASS Bundle `index-MIF1Ml5X.js`. Spalten Segment\|Rev.\|Anteil\|Wachstum\|TAM\|CAGR\|Anteil am TAM\|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert. Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt. Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet (keine Segments/keine N/A); 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0. Shots+Probe `/workspace/dod-100-ki-na/`. |
| KI-N/A-Fill Segment-TAM (#93) | `7574b12d` · Label Soft → ✅ via #100: Idle-Label Spec „N/A mit KI schätzen“. Behavior+API war schon PASS (MSFT amber ~59%; KI nur unmatched + violet Badge; Catalog-Coverage unverändert; Clear → n/a; core 58.5%/unreliable/`tamTotal=null`). Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt. |
| Miner Observability (#103) | `e2bc69a2` · Live ✅ PASS (server-only; Bundle `index-MIF1Ml5X.js` unverändert). Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient 400ms; Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`). Dateien `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43. UI `Section13Miner` unverändert. Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = Render→mempool Egress, kein Code-Delete. Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt. |
| Miner-Zone Badge 13 (#128) | `6fedbf4e` · Live ✅ PASS Bundle `index-CsbicERe.js` (Puell 1.05, Miner-Breakeven $61,351.89). Auf tip `b8feab3` ohne weiteren Diff an `BTCDashboard.tsx`, `Section13Miner.tsx`, `server/btc-miner.ts`, `server/routes.ts`. Sidebar 1–14. Badge 3 bleibt Krypto-Liquidität. Badges 1–12 unverändert. Badge 13 Miner-Zone direkt vor Badge 14 Umfassendes Gesamt-Fazit. `POST /api/btc-miner` unverändert. Ampel fehlte auf main und ist gegen tip `b8feab3` gezogen. |
| Peer-Set material gate (#134) | `b8feab3` · Live ✅ PASS Bundle `index-BRhIEX2j.js`, Tester MSFT $517.53. Vorher 2 Fakt-Peers AAPL und NVDA. Ein Klick „N/A mit KI schätzen“ → violette Zeile GOOGL, KI-Badge, FMP Mkt Cap $4.2T, P/E 28.8, ROIC FY2026 21.8%. Ø Peers unverändert (P/E 36.0, ROIC 57.5%). Notiz „KI-Vorschlag: 1 Ticker · KI-Vorschlag · Kennzahlen von FMP · Relativ-Score unverändert.“ RELATIVE_GROWTH inaktiv: „Relativ nicht score-wirksam (peerMaterial)“. Banner „Peer-Set unvollständig“ fehlt zu Recht (Moat Wide, Rivalität Medium Score 3, peerCount 2). KI nur Ticker, Kennzahlen von FMP, Relativ-Score unverändert wenn nicht material. 422 `INCOMPLETE_FILL` live nicht gesehen, weil FMP GOOGL geliefert hat. |
| [fertig_WORK_PEER_ROIC_SANITY.md](../../fertig_WORK_PEER_ROIC_SANITY.md) | sanitizeRoic intact · Tip ≡ `4bdc1f8` (kein Delete) · wieder da nach FMP Premium |
| [FACTPACK_LLM.md](./FACTPACK_LLM.md) | Analyze-Hook + UI live (#57) |
| [fertig_WORK_RECESSION_RSI_MACD.md](../../fertig_WORK_RECESSION_RSI_MACD.md) | Dashboard-Wire + Pane live |
| [Offen_WORK_RECESSION_MARKET_CHARTS.md](../../Offen_WORK_RECESSION_MARKET_CHARTS.md) | Vol-Pane: US FRED VIXCLS · EU VSTOXX STOXX `h_v2tx.txt` (#66 Live vol≈942) · AS realized20 |
| [fertig_WORK_PORTFOLIO.md](../../fertig_WORK_PORTFOLIO.md) | CAPM/Kelly + E[r]-KPI |
| [fertig_WORK.md_portfolio_3](../../fertig_WORK.md_portfolio_3) §6 | `GET /api/ohlcv` + Long-Map live — Tester AAPL 1Y/2Y PASS @ `6a1807b` (#61) |
| [fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md](../../fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md) | C2 US GET `/api/researcher/liquidity` |
| [Offen_WORK_STABLECOIN_TBILL_GENIUS.md](../../Offen_WORK_STABLECOIN_TBILL_GENIUS.md) | DefiLlama live; GENIUS-Score manuell |
| [Offen_WORK_ANALYZE_DISK_CACHE.md](../../Offen_WORK_ANALYZE_DISK_CACHE.md) | L1+L2 |
| [Offen_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md](../../Offen_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md) | Wiring |
| [fertig_WORK_ANTIBIAS_DCF.md](../../fertig_WORK_ANTIBIAS_DCF.md) | inverted DCF |
| [fertig_WORK_REVERSE_DCF_BRIDGE.md](../../fertig_WORK_REVERSE_DCF_BRIDGE.md) | fiscal-bridge |
| [Offen_WORK_BIAS_FIXES_INVERSE_DCF.md](../../Offen_WORK_BIAS_FIXES_INVERSE_DCF.md) | Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3 |
| [fertig_WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md](../../fertig_WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md) | Defaults |
| [fertig_WORK_RESEARCHER_PORTFOLIO.md](../../fertig_WORK_RESEARCHER_PORTFOLIO.md) | P1/P2/P3 Tabs |
| [fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md](../../fertig_WORK_RESEARCHER_PORTFOLIO_TEIL2.md) | δ/HHI |
| [fertig_WORK_RESEARCHER_BUTTONS_APPLY.md](../../fertig_WORK_RESEARCHER_BUTTONS_APPLY.md) | Add-Buttons |
| [fertig_WORK_NEWS_SENTIMENT.md](../../fertig_WORK_NEWS_SENTIMENT.md) | news-sentiment |
| [fertig_WORK_SEGMENT_DEDUP.md](../../fertig_WORK_SEGMENT_DEDUP.md) | fmp |
| [fertig_WORK_TAM_SEGMENT_MAPPING.md](../../fertig_WORK_TAM_SEGMENT_MAPPING.md) | TAM-Tor |
| [fertig_WORK_DATA_PROVIDERS.md](../../fertig_WORK_DATA_PROVIDERS.md) | FMP/Yahoo |
| [fertig_WORK_SCORING_VORLAGE.md](../../fertig_WORK_SCORING_VORLAGE.md) | Gates |
| [fertig_WORK_SIGNAL_BACKTEST.md](../../fertig_WORK_SIGNAL_BACKTEST.md) | server/backtest |
| [fertig_WORK_BTC_MINER.md](../../fertig_WORK_BTC_MINER.md) | Observability live (#103 `e2bc69a2`); Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt |
| [fertig_WORK_TEIL7_SCORING.md](../../fertig_WORK_TEIL7_SCORING.md) | Gold |
| [fertig_WORK2.md](../../fertig_WORK2.md) | PESTEL |
| [WORK.md](../../WORK.md) | Index |
| [WORK_IST_VS_SOLL.md](../../WORK_IST_VS_SOLL.md) | Audit 03.10.2026, nach #134 Peer-Set Live PASS (`b8feab3`, Bundle `index-BRhIEX2j.js`) |
| [WORK_IMPLEMENTIERUNG_OFFEN.md](../../WORK_IMPLEMENTIERUNG_OFFEN.md) | D6 7–9 geblockt |
