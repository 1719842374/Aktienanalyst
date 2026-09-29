# Doc_Soll_vs_Ist

> Stand: 29.09.2026 | Ampel aus **Code + UI** (Live Render) · HEAD `d517611`
> Originale im **Repo-Root**. Dieser Ordner verlinkt nur.
>
> Alt: [work-offen](../work-offen/) · [work-dokumentation](../work-dokumentation/)

**Regel:** `✅` nur wenn die *erwartete Anzeige* live ist. Datei + Lib ohne KPI/Serie = `🟡` oder `⬜`. „Deploy folgt“ = Code auf `main`, Live nicht geprüft → `🟡`.

**Nachzug 29.09.:** #70 Dual-Line Live ✅ · #72 Badges 1–20 Live ✅ · #73 Thesis Lab `/#/lab` Live ✅ · Exec #69 Live ✅ (XOM, FMP Premium) · Peer/ROIC Code intact ✅ (≡ `4bdc1f8`) · #71 4-Toggles 🟡 (UI ok, Chart oft leer: `/api/ohlcv` Fake-OK `bars=[]`/`n=0`) · #75 Ökosystem-Chip 🟡 (Deploy/Tester, nur `hasEcosystem`) · #76 DCF Markt-β Code ✅ Deploy folgt · #77 Makro §15 Code ✅ Deploy folgt. Docs-Hub war 13.09.

**Nachzug 13.09. (+ portfolio_3 PASS):** Exec / FactPack / VIX+EU-Vol / Portfolio OHLCV §6 ✅ · Hormuz (B) 🟡 · Liquidity-Bundle ⬜ · Rang 7–9 blockiert · Backtest weiter 🟡. OHLCV §6-Code bleibt; Live 29.09. oft Fake-OK (siehe #71).

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
| Performance-Chart 4 Toggles (#71) | Ein/Aus + Bench-Kurs | UI da (`60aeeb2`); Chart oft leer (`/api/ohlcv` Fake-OK `bars=[]`/`n=0`) | `🟡` |
| Moat Ökosystem-Chip (#75) | Chip nur bei `hasEcosystem` | Code `08d82b2`; Live Deploy/Tester nach Bundle-Wechsel | `🟡` |
| DCF Default Markt-β (#76) | Default β = Markt-β, Sektor-Anker als Modus | Code `ef0f31e`; Deploy folgt | `🟡` |
| Makro-Korrelationsmatrix §15 (#77) | volle Matrix statt 4-Faktor-Stub | Code `d517611`; Deploy folgt | `🟡` |

Detail Exec: [WORK_EXEC_SUMMARY.md](./WORK_EXEC_SUMMARY.md) · FactPack [FACTPACK_LLM.md](./FACTPACK_LLM.md) · FMP/BB [FMP_GRENZEN_BLOOMBERG.md](./FMP_GRENZEN_BLOOMBERG.md)

---

## Ist — Kern im Code und in der UI nutzbar (wenn Daten da)

| Spec (Root) | Code / Live |
|-------------|-------------|
| [WORK_EXEC_SUMMARY.md](../../WORK_EXEC_SUMMARY.md) | Exec-Karte über S1 live (#58); #69 Ampel+KI+FS Live PASS (XOM, FMP Premium) |
| Portfolio Dual-Line (#70) | `benchPct` vs Performance live (`358681a`) |
| Dashboard-Badges 1–20 (#72) | Exec=1, FS=4, Tech=12 · Live PASS Bundle `index-PW9HgI6J.js` @ `22d4af9`+ |
| [WORK_THESIS_LAB.md](../../WORK_THESIS_LAB.md) | `/#/lab` + 6 Fixtures Live PASS (`22d4af9`, #73) |
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
| [WORK_BIAS_FIXES_INVERSE_DCF.md](../../WORK_BIAS_FIXES_INVERSE_DCF.md) | BL + MC |
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
| [WORK_BTC_MINER.md](../../WORK_BTC_MINER.md) | miner |
| [WORK_TEIL7_SCORING.md](../../WORK_TEIL7_SCORING.md) | Gold |
| [WORK2.md](../../WORK2.md) | PESTEL |
| [WORK.md](../../WORK.md) | Index |
| [WORK_IST_VS_SOLL.md](../../WORK_IST_VS_SOLL.md) | Audit 29.09. |
| [WORK_IMPLEMENTIERUNG_OFFEN.md](../../WORK_IMPLEMENTIERUNG_OFFEN.md) | D6 7–9 geblockt |
