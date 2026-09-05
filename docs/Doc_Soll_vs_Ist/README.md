# Doc_Soll_vs_Ist

> Stand: 05.09.2026 11:48 CEST | Ampel aus **Code + UI**, nicht aus Commit-Text
> Originale im **Repo-Root**. Dieser Ordner verlinkt nur.
>
> Alt: [work-offen](../work-offen/) · [work-dokumentation](../work-dokumentation/)

**Regel:** `✅` nur wenn die *erwartete Anzeige* live ist. Datei + Lib ohne KPI/Serie = `🟡` oder `⬜`.

---

## Soll — Spec, erwartete UI fehlt oder Engine fehlt

| Spec (Root) | Soll | Ist Code + UI | Ampel |
|-------------|------|---------------|-------|
| [WORK_EXEC_SUMMARY.md](../../WORK_EXEC_SUMMARY.md) | Karte über S1, Pro/Contra aus S8/S11/S12/S15, PESTEL-Raster + Porter-High | Analyze startet bei S1 Datenaktualität; keine Exec-Karte | `⬜` |
| [WORK_PORTFOLIO.md](../../WORK_PORTFOLIO.md) | CAPM/Kelly sichtbar | Gewichte + Kelly in Optimierung; **kein** E[r]-KPI Übersicht | `🟡` |
| [WORK_PORTFOLIO_BACKTEST.md](../../WORK_PORTFOLIO_BACKTEST.md) | Equity, α/β/IR, Underwater, Capture | Panel da, leer ohne Positionen+OHLCV | `🟡` |
| [WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md](../../WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md) | Katalog + Fetch | nur Markdown | `⬜` |
| [WORK_FISCAL_FRONTEND_ADAPTIVE.md](../../WORK_FISCAL_FRONTEND_ADAPTIVE.md) | s(z), kein Kalender | `BESSENT_WINDOW` in `liquidity-regime-math.ts` | `⬜` |
| [WORK_RESEARCHER_LIQUIDITY_INDEX.md](../../WORK_RESEARCHER_LIQUIDITY_INDEX.md) | LI US/EU/ASIA | C2 nur US | `⬜` |
| [WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md](../../WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md) | Buch M/F EZ/JP | kein Katalog | `⬜` |
| [WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md](../../WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md) | r, V, π, T½ | M2V US + Eimer 0.02 | `⬜` |
| [WORK_RESEARCHER_BRIEFING_REGIONAL.md](../../WORK_RESEARCHER_BRIEFING_REGIONAL.md) | 3 Regionen + Spillover | ein Prompt, NEW=`high` | `⬜` |
| [WORK_VALUECHAIN_SECTOR_ROTATION.md](../../WORK_VALUECHAIN_SECTOR_ROTATION.md) | Rang 1–9 | 1–6 live, 7–9 offen | `🟡` |
| [WORK_RECESSION_MARKET_CHARTS.md](../../WORK_RECESSION_MARKET_CHARTS.md) | VIX-Pane + PEG-Click + FINRA | nur Spec | `⬜` |
| [WORK_RECESSION_RSI_MACD.md](../../WORK_RECESSION_RSI_MACD.md) | RSI+MACD+Div im `#/recession` nach S7 | Engine+Panel+GET da; Dashboard-Import / VIX/PEG offen | `🟡` |

Detail Exec: [WORK_EXEC_SUMMARY.md](./WORK_EXEC_SUMMARY.md) · FactPack [FACTPACK_LLM.md](./FACTPACK_LLM.md) · FMP/BB [FMP_GRENZEN_BLOOMBERG.md](./FMP_GRENZEN_BLOOMBERG.md)

---

## Ist — Kern im Code und in der UI nutzbar (wenn Daten da)

| Spec (Root) | Code |
|-------------|------|
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
| [WORK_IST_VS_SOLL.md](../../WORK_IST_VS_SOLL.md) | Audit 01.09. |
| [WORK_IMPLEMENTIERUNG_OFFEN.md](../../WORK_IMPLEMENTIERUNG_OFFEN.md) | D6 7–9 |
