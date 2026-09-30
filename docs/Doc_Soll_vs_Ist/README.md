# Doc_Soll_vs_Ist

> Stand: 30.09.2026 (Vormittag, nach #103 Miner Observability Live PASS) | Ampel aus **Code + UI** (Live Render) · HEAD `e2bc69a2` · Bundle `index-MIF1Ml5X.js`
> Originale im **Repo-Root**. Dieser Ordner verlinkt nur.
>
> Alt: [work-offen](../work-offen/) · [work-dokumentation](../work-dokumentation/)

**Regel:** `✅` nur wenn die *erwartete Anzeige* live ist. Datei + Lib ohne KPI/Serie = `🟡` oder `⬜`. „Deploy folgt“ = Code auf `main`, Live nicht geprüft → `🟡`.

**Nachzug 30.09. Vormittag, nach #103 Miner Observability Live PASS (`e2bc69a2`, Bundle `index-MIF1Ml5X.js` unverändert — Client unverändert, #103 server-only; DoD PASS):** #103 Miner Observability Live ✅ (tip `e2bc69a2` = `e2bc69a233166a3242d13e9ddc78373adc19f68c`; parent `58bec00c` #101 Docs ← `c365c945` #100 ← `4c615eb3` #99). Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient (400ms); Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`). Dateien `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43. UI `Section13Miner` unverändert. Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = **Render→mempool Egress**, kein fehlender/gelöschter Code. Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt. #99✅ #100✅ #93 Label✅ #97✅ #92✅ bleiben. #96 closed ohne Merge — nicht reopen, nicht grün. #101 Docs Ampel Nachzug #99/#100 ✅ merged (`58bec00c`, MD-only).

**Nachzug 30.09. Morgen, nach #99+#100 Live PASS (`c365c945`, Bundle `index-MIF1Ml5X.js`, Dual-DoD PASS) — historisch, vor #103:** #99 TA Spec v3.2 Live ✅ (SHA `4c615eb3` → stack tip `c365c945`; Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok, Mobile soft-skip; Shots `/workspace/dod-99-ta-v32/`). #100 KI-N/A matrix (Relativ Bewertung / Section7) Live ✅ (Spalten Segment|Rev.|Anteil|Wachstum|TAM|CAGR|Anteil am TAM|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert; Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt; Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet, keine Segments/keine N/A; 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0; Shots+Probe `/workspace/dod-100-ki-na/`). #93 KI-N/A-Fill Segment-TAM ✅ Label cleared (Idle-Label Spec „N/A mit KI schätzen“ via #100; Behavior+API PASS @ `7574b12d`; Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt). #97 bleibt ✅ (superseded by v3.2 live on same chart stack). #92 bleibt ✅. #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün. Prior ✅ (#90, #74, #75–#77, #81–#86, #88, #70/#72/#73, #69, Peer/ROIC) unverändert.

**Nachzug 29.09. Abend, nach #97 Live PASS (`249841ab`) — historisch, vor #99/#100:** #97 TA Kurs A/B/C Spec v3.1 Live ✅ PASS (SHA `249841ab`; parent `1dc82683`; Bundle `index-C_rUCqgy.js`; 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder (eigene Y min–max je Band via `yDomainFromCloses` / `chart-price-bands`); `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL; DoD AAPL Shots `/workspace/dod-97-ta-kurs/`). #92 TA Zwei-Fenster Live ✅ PASS Re-DoD (SHA `c06c835e` → Fix `1dc82683` #94; Bundle `index-JP8muGsY.js`; A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster Extra An/Aus; Soft Draw-Order B-unter OK). #93 KI-N/A-Fill Segment-TAM 🟡 PARTIAL (`7574b12d`; Behavior+API PASS — MSFT amber ~59%; KI nur unmatched + violet Badge; Catalog-Coverage unverändert; Clear → n/a; core 58.5%/unreliable/`tamTotal=null`; Label Soft: UI „KI“ vs Spec „N/A mit KI schätzen“). #96 KI-Fill v2 bleibt Draft Merge-Gate — nicht grün (Label Soft #93 kann nach #96 Live weg; Soft Apollo bis Philip GO). #90 TAM Coverage-Lift Live ✅ (Bundle `index-Ca0V7H2h.js`; DoD: AMZN 75.2% ok, NVDA 98.2% weak, MSFT 58.5% unreliable — Server unmatched, `tamTotal` null). Queue Coverage-Lift ✅. #74 Batch A Live ✅ (Fake-OK `bars=[]` source:fmp fixed) · #75 Ökosystem-Chip / #76 DCF Markt-β / #77 Makro §15 Live ✅ nach Deploy · #81 Porter Prompt · #82 Exec-Boxen · #83 Fenster-Zonen · #84 Sharpe · #85 Attribution (251d AAPL+MSFT) · #86 Tooltip · #88 Pie über Performance / Chart 360px Live ✅ · #87 thin-series 🟡 PARTIAL (healthy 251d OK, thin-Banner nicht repro) · #71 4-Toggles weiter 🟡 · #70/#72/#73 Live ✅ · Exec #69 Live ✅ · Peer/ROIC ≡ `4bdc1f8`. BL §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3. Hub-Vormittag war `d517611` (#78); Hub #89 Stand Abend `f0046ee9` (`20120339`); Hub #90 `ee5f0f8b` (Docs-Tip `9895774f`); Hub-Draft #95 Inhalt `1dc82683` (#92✅ #93🟡, noch offen).

**Nachzug 13.09. (+ portfolio_3 PASS):** Exec / FactPack / VIX+EU-Vol / Portfolio OHLCV §6 ✅ · Hormuz (B) 🟡 · Liquidity-Bundle ⬜ · Rang 7–9 blockiert · Backtest weiter 🟡. OHLCV §6-Code bleibt; #74 Fake-OK source:fmp fixed; Chart #71 oft weiter leer.

---

## Soll — Spec, erwartete UI fehlt oder Engine fehlt

| Spec (Root) | Soll | Ist Code + UI | Ampel |
|-------------|------|---------------|-------|
| [WORK_PORTFOLIO_BACKTEST.md](../../WORK_PORTFOLIO_BACKTEST.md) | Equity, α/β/IR, Underwater, Capture | Panel da; braucht Positionen+OHLCV; Rest-DoD | `🟡` |
| [WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md](../../WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md) | Katalog + Fetch | nur Markdown | `⬜` |
| [WORK_FISCAL_FRONTEND_ADAPTIVE.md](../../WORK_FISCAL_FRONTEND_ADAPTIVE.md) | s(z), kein Kalender | `BESSENT_WINDOW` in `liquidity-regime-math.ts` | `⬜` |
| [WORK_RESEARCHER_LIQUIDITY_INDEX.md](../../WORK_RESEARCHER_LIQUIDITY_INDEX.md) | LI US/EU/ASIA | C2 nur US | `⬜` |
| [WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md](../../WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md) | Buch M/F EZ/JP | kein Katalog | `⬜` |
| [WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md](../../WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md) | r, V, π, T½ | M2V US + Eimer 0.02 | `⬜` |
| [WORK_RESEARCHER_BRIEFING_REGIONAL.md](../../WORK_RESEARCHER_BRIEFING_REGIONAL.md) | 3 Regionen + Spillover | ein Prompt, NEW=`high` | `⬜` |
| [WORK_VALUECHAIN_SECTOR_ROTATION.md](../../WORK_VALUECHAIN_SECTOR_ROTATION.md) | Rang 1–9 | 1–6 live; **Rang 7–9** xyflow blockiert | `🟡` blockiert |
| [WORK_RECESSION_MARKET_CHARTS.md](../../WORK_RECESSION_MARKET_CHARTS.md) | VIX-Pane + PEG-Click + FINRA | VIX/VSTOXX/realized live (US/EU/AS); PEG-Click + FINRA offen | `🟡` |
| [WORK_RECESSION_2008_DRIVERS_LLM.md](../../WORK_RECESSION_2008_DRIVERS_LLM.md) | SLOOS/Price-Rent/TED + OpenRouter-Driver | Hormuz-(A) Essay gelöscht (#59); **`recession-drivers.ts` fehlt** (B) | `🟡` |
| [WORK_RECESSION_FRED_SAHM.md](../../WORK_RECESSION_FRED_SAHM.md) | adaptive FRED + Sahm s(z) | Spec | `⬜` |
| [WORK_RECESSION_RATE_OIL_BRIDGE.md](../../WORK_RECESSION_RATE_OIL_BRIDGE.md) | Zins-Brücke + Öl | Spec | `⬜` |
| [WORK_RECESSION_SOURCES.md](../../WORK_RECESSION_SOURCES.md) | Quellenkatalog | Spec | `⬜` |
| [WORK_PEER_ADAPTIVE.md](../../WORK_PEER_ADAPTIVE.md) | 2-Hop+Industry | Spec; Hardcode-Map lebt | `⬜` |
| [WORK_PEER_PRICING_POWER.md](../../WORK_PEER_PRICING_POWER.md) | Relativ nur Low-Moat | Spec Companion | `⬜` |
| Performance-Chart 4 Toggles (#71) | Ein/Aus + Bench-Kurs | UI da (`60aeeb2`); OHLCV-Honesty #74; Chart oft weiter leer | `🟡` |
| thin-series Prävention (#87) | dünne Serie aus Backtest-Intersection | Code `2fb8b70a`; healthy 251d OK; thin-Banner nicht repro auf Live | `🟡` PARTIAL |

Detail Exec: [WORK_EXEC_SUMMARY.md](./WORK_EXEC_SUMMARY.md) · FactPack [FACTPACK_LLM.md](./FACTPACK_LLM.md) · FMP/BB [FMP_GRENZEN_BLOOMBERG.md](./FMP_GRENZEN_BLOOMBERG.md)

---

## Ist — Kern im Code und in der UI nutzbar (wenn Daten da)

| Spec (Root) | Code / Live |
|-------------|-------------|
| [WORK_EXEC_SUMMARY.md](../../WORK_EXEC_SUMMARY.md) | Exec-Karte über S1 live (#58); #69 Ampel+KI+FS Live PASS (XOM, FMP Premium) |
| Portfolio Dual-Line (#70) | `benchPct` vs Performance live (`358681a`) |
| Dashboard-Badges 1–20 (#72) | Exec=1, FS=4, Tech=12 · Live PASS Bundle `index-PW9HgI6J.js` @ `22d4af9`+ |
| [WORK_THESIS_LAB.md](../../WORK_THESIS_LAB.md) | `/#/lab` + 6 Fixtures Live PASS (`22d4af9`, #73) |
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
| [WORK_PEER_ROIC_SANITY.md](../../WORK_PEER_ROIC_SANITY.md) | sanitizeRoic intact · Tip ≡ `4bdc1f8` (kein Delete) · wieder da nach FMP Premium |
| [FACTPACK_LLM.md](./FACTPACK_LLM.md) | Analyze-Hook + UI live (#57) |
| [WORK_RECESSION_RSI_MACD.md](../../WORK_RECESSION_RSI_MACD.md) | Dashboard-Wire + Pane live |
| [WORK_RECESSION_MARKET_CHARTS.md](../../WORK_RECESSION_MARKET_CHARTS.md) | Vol-Pane: US FRED VIXCLS · EU VSTOXX STOXX `h_v2tx.txt` (#66 Live vol≈942) · AS realized20 |
| [WORK_PORTFOLIO.md](../../WORK_PORTFOLIO.md) | CAPM/Kelly + E[r]-KPI |
| [WORK.md_portfolio_3](../../WORK.md_portfolio_3) §6 | `GET /api/ohlcv` + Long-Map live — Tester AAPL 1Y/2Y PASS @ `6a1807b` (#61) |
| [WORK_RESEARCHER_LIQUIDITY_REGIME.md](../../WORK_RESEARCHER_LIQUIDITY_REGIME.md) | C2 US GET `/api/researcher/liquidity` |
| [WORK_STABLECOIN_TBILL_GENIUS.md](../../WORK_STABLECOIN_TBILL_GENIUS.md) | DefiLlama live; GENIUS-Score manuell |
| [WORK_ANALYZE_DISK_CACHE.md](../../WORK_ANALYZE_DISK_CACHE.md) | L1+L2 |
| [WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md](../../WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md) | Wiring |
| [WORK_ANTIBIAS_DCF.md](../../WORK_ANTIBIAS_DCF.md) | inverted DCF |
| [WORK_REVERSE_DCF_BRIDGE.md](../../WORK_REVERSE_DCF_BRIDGE.md) | fiscal-bridge |
| [WORK_BIAS_FIXES_INVERSE_DCF.md](../../WORK_BIAS_FIXES_INVERSE_DCF.md) | Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3 |
| [WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md](../../WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md) | Defaults |
| [WORK_RESEARCHER_PORTFOLIO.md](../../WORK_RESEARCHER_PORTFOLIO.md) | P1/P2/P3 Tabs |
| [WORK_RESEARCHER_PORTFOLIO_TEIL2.md](../../WORK_RESEARCHER_PORTFOLIO_TEIL2.md) | δ/HHI |
| [WORK_RESEARCHER_BUTTONS_APPLY.md](../../WORK_RESEARCHER_BUTTONS_APPLY.md) | Add-Buttons |
| [WORK_NEWS_SENTIMENT.md](../../WORK_NEWS_SENTIMENT.md) | news-sentiment |
| [WORK_SEGMENT_DEDUP.md](../../WORK_SEGMENT_DEDUP.md) | fmp |
| [WORK_TAM_SEGMENT_MAPPING.md](../../WORK_TAM_SEGMENT_MAPPING.md) | TAM-Tor |
| [WORK_DATA_PROVIDERS.md](../../WORK_DATA_PROVIDERS.md) | FMP/Yahoo |
| [WORK_SCORING_VORLAGE.md](../../WORK_SCORING_VORLAGE.md) | Gates |
| [WORK_SIGNAL_BACKTEST.md](../../WORK_SIGNAL_BACKTEST.md) | server/backtest |
| [WORK_BTC_MINER.md](../../WORK_BTC_MINER.md) | Observability live (#103 `e2bc69a2`); Kernformeln Breakeven/Puell/Hash Ribbons/`classifyMinerZone` unberührt |
| [WORK_TEIL7_SCORING.md](../../WORK_TEIL7_SCORING.md) | Gold |
| [WORK2.md](../../WORK2.md) | PESTEL |
| [WORK.md](../../WORK.md) | Index |
| [WORK_IST_VS_SOLL.md](../../WORK_IST_VS_SOLL.md) | Audit 30.09. Vormittag, nach #103 Miner Observability Live PASS (`e2bc69a2`, Bundle `index-MIF1Ml5X.js`) |
| [WORK_IMPLEMENTIERUNG_OFFEN.md](../../WORK_IMPLEMENTIERUNG_OFFEN.md) | D6 7–9 geblockt |
