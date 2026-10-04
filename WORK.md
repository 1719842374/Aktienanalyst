# WORK.md — Index

> Stand: 30.09.2026 (Vormittag, nach #103 Miner Observability Live PASS) | Branch: `main` @ `e2bc69a2` | Bundle `index-MIF1Ml5X.js`
>
> **Hub Soll vs. Ist:** [docs/Doc_Soll_vs_Ist/](./docs/Doc_Soll_vs_Ist/)
>
> Alt (nicht löschen): [docs/work-offen/](./docs/work-offen/) · [docs/work-dokumentation/](./docs/work-dokumentation/)
> Root-`WORK_*.md` bleiben die Inhaltsquelle.

**Ampel-Kurz 30.09. Vormittag, nach #103 Miner Observability Live PASS (DoD PASS, Bundle `index-MIF1Ml5X.js` — Client unverändert, #103 server-only):** #103 Miner Observability Live ✅ (tip `e2bc69a2`; parent `58bec00c` #101 Docs ← `c365c945` #100 ← `4c615eb3` #99; Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient 400ms; Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`); Dateien `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43; UI `Section13Miner` unverändert; Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = Render→mempool Egress, kein fehlender/gelöschter Code; Kernformeln Breakeven/Puell/Hash Ribbons unberührt) · #99 TA Spec v3.2 Live ✅ (SHA `4c615eb3` → stack tip `c365c945`; Bundle `index-MIF1Ml5X.js`; Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok, Mobile soft-skip; Shots `/workspace/dod-99-ta-v32/`) · #100 KI-N/A matrix (Relativ Bewertung / Section7) Live ✅ (tip `c365c945`; Spalten Segment|Rev.|Anteil|Wachstum|TAM|CAGR|Anteil am TAM|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert; Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt; Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet, keine Segments/keine N/A; 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0; Shots+Probe `/workspace/dod-100-ki-na/`) · #93 KI-N/A-Fill Segment-TAM ✅ Label cleared (Idle-Label jetzt Spec „N/A mit KI schätzen“ via #100 Live; Behavior+API war schon PASS @ `7574b12d`; Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt) · #97 TA Kurs A/B/C Spec v3.1 Live ✅ bleibt (superseded by v3.2 live on same chart stack; SHA `249841ab`; Bundle `index-C_rUCqgy.js`; 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder via `yDomainFromCloses` / `chart-price-bands`; `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL; DoD AAPL Shots `/workspace/dod-97-ta-kurs/`) · #92 TA Zwei-Fenster Live ✅ (SHA `c06c835e` → Fix `1dc82683` #94; Bundle `index-JP8muGsY.js`; A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster Extra An/Aus; Soft Draw-Order B-unter OK) · #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün · #90 TAM Coverage-Lift Live ✅ (DoD: AMZN 75.2% ok, NVDA 98.2% weak, MSFT 58.5% unreliable; Queue Coverage-Lift ✅) · #74 Batch A ✅ · #81–#83 ✅ · #84 Sharpe / #85 Attribution Live ✅ · #86 Tooltip / #88 Pie+360px Live ✅ · #87 thin-series 🟡 PARTIAL (healthy 251d, thin-Banner nicht repro) · #75/#76/#77 Live ✅ nach Deploy · #70/#72/#73/#69 Live ✅ · #71 4-Toggles 🟡 · Peer/ROIC intact · BL Tabelle+MC kein Scatter, Frontier ≥3 · Hormuz (B) 🟡 · Liquidity-Bundle ⬜ · Rang 7–9 blockiert. Detail: [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md).

---

## Soll (nicht live / partial)

| Datei | Inhalt |
|-------|--------|
| [Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md](./Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md) | s(z), N^b, FE, QRA — Code 🟡; GIS-Slot und Cron/QRA-LLM ausgelassen |
| [Offen_WORK_RESEARCHER_LIQUIDITY_INDEX.md](./Offen_WORK_RESEARCHER_LIQUIDITY_INDEX.md) | LI US/EU/ASIA |
| [Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md](./Offen_WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md) | r, V, π, T½ |
| [Offen_WORK_RESEARCHER_BRIEFING_REGIONAL.md](./Offen_WORK_RESEARCHER_BRIEFING_REGIONAL.md) | Briefing 3 Regionen |
| [Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md](./Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md) | Serien-IDs + Prints |

Ampel: [docs/Doc_Soll_vs_Ist/README.md](./docs/Doc_Soll_vs_Ist/README.md)

**Ampel Fiscal-Frontend 2026-10-03:** `Offen_WORK_FISCAL_FRONTEND_ADAPTIVE` 🟡. Route `GET /api/analyze-btc/fiscal-frontend`, Karten in `StablecoinLiquidityPanel`, Ops-Label im LiquidityPanel. Step 6 (`btcAnalysis.ts`, erst wenn `FE.available`, nicht im selben PR wie der Fetch) und Step 7 (Cron / QRA-LLM) sind ausgelassen. Live-Render nicht geprüft.

---

## Ist (Kern im Code)

| Datei | Inhalt |
|-------|--------|
| [fertig_WORK_EXEC_SUMMARY.md](./fertig_WORK_EXEC_SUMMARY.md) | Exec vor S1 live (#58) |
| [docs/Doc_Soll_vs_Ist/FACTPACK_LLM.md](./docs/Doc_Soll_vs_Ist/FACTPACK_LLM.md) | FactPack Hook+UI live (#57) |
| [fertig_WORK_RECESSION_RSI_MACD.md](./fertig_WORK_RECESSION_RSI_MACD.md) | RSI/MACD Dashboard live |
| [fertig_WORK_RECESSION_MARKET_CHARTS.md](./fertig_WORK_RECESSION_MARKET_CHARTS.md) | Vier Märkte, Klick-Factpack, FINRA nur unter SPY |
| [WORK_IST_VS_SOLL.md](./WORK_IST_VS_SOLL.md) | Audit 30.09. Vormittag, nach #103 Miner Observability Live PASS (`e2bc69a2`, Bundle `index-MIF1Ml5X.js`) |
| [fertig_WORK_THESIS_LAB.md](./fertig_WORK_THESIS_LAB.md) | `/#/lab` Live PASS (#73) |
| [WORK_IMPLEMENTIERUNG_OFFEN.md](./WORK_IMPLEMENTIERUNG_OFFEN.md) | D6 Rang 7–9 |
| [fertig_WORK_ANALYZE_DISK_CACHE.md](./fertig_WORK_ANALYZE_DISK_CACHE.md) | 7-Tage-KI-Catch, L1+L2, force löscht beide |
| [fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md](./fertig_WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md) | Analyze-Route an die 7-Tage-Disk gehängt |
| [fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md](./fertig_WORK_RESEARCHER_LIQUIDITY_REGIME.md) | C2 US-only |
| [fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md](./fertig_WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md) | CATALOG.US/EU/ASIA, `?region=` books.M/F |
| [Offen_WORK_STABLECOIN_TBILL_GENIUS.md](./Offen_WORK_STABLECOIN_TBILL_GENIUS.md) | BTC Sektion 14 |
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
| [fertig_WORK_TAM_SEGMENT_MAPPING.md](./fertig_WORK_TAM_SEGMENT_MAPPING.md) | Segment-TAM |
| [fertig_WORK_TAM_RESIDUAL_XBOX.md](./fertig_WORK_TAM_RESIDUAL_XBOX.md) | Xbox |
| [fertig_WORK_DATA_PROVIDERS.md](./fertig_WORK_DATA_PROVIDERS.md) | FMP |
| [fertig_WORK_SCORING_VORLAGE.md](./fertig_WORK_SCORING_VORLAGE.md) | Gates |
| [fertig_WORK_TEIL0-6.md](./fertig_WORK_TEIL0-6.md) | Platform/BTC |
| [fertig_WORK_BTC_MINER.md](./fertig_WORK_BTC_MINER.md) | Miner |
| [fertig_WORK_TEIL7_SCORING.md](./fertig_WORK_TEIL7_SCORING.md) | Gold |
| [fertig_WORK2.md](./fertig_WORK2.md) | PESTEL |
| [Future_Work.md](./Future_Work.md) | Roadmap |
