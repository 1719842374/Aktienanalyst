# Doc_Soll_vs_Ist

> Stand: 04.09.2026 | Hub Soll vs. Ist
> Originale bleiben im **Repo-Root**. Dieser Ordner ist nur die Verlinkung.
>
> Altpfade (noch da, nicht löschen): [work-offen](../work-offen/) · [work-dokumentation](../work-dokumentation/)

---

## Soll — Spec, Engine fehlt

| Spec (Root) | Soll | Ist im Code |
|-------------|------|-------------|
| [WORK_FISCAL_FRONTEND_ADAPTIVE.md](../../WORK_FISCAL_FRONTEND_ADAPTIVE.md) | s(z) Bills/TGA/SOMA/DFF, kein Kalender | `BESSENT_WINDOW` in `liquidity-regime-math.ts` |
| [WORK_RESEARCHER_LIQUIDITY_INDEX.md](../../WORK_RESEARCHER_LIQUIDITY_INDEX.md) | LI US/EU/ASIA, 4 Kanäle s(z) | C2 nur US WALCL/RRP/TGA |
| [WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md](../../WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md) | Buch M/F, APP/PEPP, BoJ/MoF | kein `CATALOG[EU\|ASIA]` |
| [WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md](../../WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md) | Debt/GDP, r, V, π, T½ | `M2V` US-only, Eimer ΔV=0.02 |
| [WORK_RESEARCHER_BRIEFING_REGIONAL.md](../../WORK_RESEARCHER_BRIEFING_REGIONAL.md) | 3 Regionen + Spillover + Handel | ein Prompt, NEW nur `high` |
| Kopie im Offen-Ordner | — | [work-offen/WORK_RESEARCHER_BRIEFING_REGIONAL.md](../work-offen/WORK_RESEARCHER_BRIEFING_REGIONAL.md) |
| [WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md](../../WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md) | Serien-IDs, Prints, X-Allowlist | kein `liqidx_v1__*` |

Audit-Ist (älter, 01.09.): [WORK_IST_VS_SOLL.md](../../WORK_IST_VS_SOLL.md) · Rest-Offen D6: [WORK_IMPLEMENTIERUNG_OFFEN.md](../../WORK_IMPLEMENTIERUNG_OFFEN.md)

---

## Ist — Kern im Code (Dokumentation)

| Spec (Root) | Code |
|-------------|------|
| [WORK_RESEARCHER_LIQUIDITY_REGIME.md](../../WORK_RESEARCHER_LIQUIDITY_REGIME.md) | GET `/api/researcher/liquidity` C2 US |
| [WORK_STABLECOIN_TBILL_GENIUS.md](../../WORK_STABLECOIN_TBILL_GENIUS.md) | `stablecoin-liquidity.ts` |
| [WORK_ANALYZE_DISK_CACHE.md](../../WORK_ANALYZE_DISK_CACHE.md) | L1+L2 |
| [WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md](../../WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md) | disk-cache Wiring |
| [WORK_ANTIBIAS_DCF.md](../../WORK_ANTIBIAS_DCF.md) | inverted DCF |
| [WORK_REVERSE_DCF_BRIDGE.md](../../WORK_REVERSE_DCF_BRIDGE.md) | `fiscal-bridge.ts` |
| [WORK_BIAS_FIXES_INVERSE_DCF.md](../../WORK_BIAS_FIXES_INVERSE_DCF.md) | BL + MC |
| [WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md](../../WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md) | Lynch-Defaults |
| [WORK_PORTFOLIO.md](../../WORK_PORTFOLIO.md) | `lib/portfolio` |
| [WORK_PORTFOLIO_BACKTEST.md](../../WORK_PORTFOLIO_BACKTEST.md) | `backtest.ts` |
| [WORK_RESEARCHER_PORTFOLIO.md](../../WORK_RESEARCHER_PORTFOLIO.md) | P1/P2/P3 |
| [WORK_RESEARCHER_PORTFOLIO_TEIL2.md](../../WORK_RESEARCHER_PORTFOLIO_TEIL2.md) | δ/HHI |
| [WORK_RESEARCHER_BUTTONS_APPLY.md](../../WORK_RESEARCHER_BUTTONS_APPLY.md) | Add-Buttons |
| [WORK_RESEARCHER_SECTOR_ADD.md](../../WORK_RESEARCHER_SECTOR_ADD.md) | Sector-Add |
| [WORK_NEWS_SENTIMENT.md](../../WORK_NEWS_SENTIMENT.md) | `news-sentiment.ts` |
| [WORK_PEER_ROIC_SANITY.md](../../WORK_PEER_ROIC_SANITY.md) | `sanitizeRoic` |
| [WORK_SEGMENT_DEDUP.md](../../WORK_SEGMENT_DEDUP.md) | `fmp.ts` |
| [WORK_SECTION4_DATA_BUGS.md](../../WORK_SECTION4_DATA_BUGS.md) | PEG/FCF |
| [WORK_TAM_SEGMENT_MAPPING.md](../../WORK_TAM_SEGMENT_MAPPING.md) | assessTamQuality |
| [WORK_TAM_RESIDUAL_XBOX.md](../../WORK_TAM_RESIDUAL_XBOX.md) | Residuum |
| [WORK_DATA_PROVIDERS.md](../../WORK_DATA_PROVIDERS.md) | FMP/Yahoo |
| [WORK_SCORING_VORLAGE.md](../../WORK_SCORING_VORLAGE.md) | Gates |
| [WORK_SIGNAL_BACKTEST.md](../../WORK_SIGNAL_BACKTEST.md) | `server/backtest/*` |
| [WORK_SEKTORROTATIONS_RAT.md](../../WORK_SEKTORROTATIONS_RAT.md) | SectorRotationPanel |
| [WORK_VALUECHAIN_SECTOR_ROTATION.md](../../WORK_VALUECHAIN_SECTOR_ROTATION.md) | Rang 1–6, 7–9 offen |
| [WORK_BTC_MINER.md](../../WORK_BTC_MINER.md) | `btc-miner.ts` |
| [WORK_TEIL0-6.md](../../WORK_TEIL0-6.md) | Platform/BTC |
| [WORK_TEIL7_SCORING.md](../../WORK_TEIL7_SCORING.md) | Gold/WALCL |
| [WORK2.md](../../WORK2.md) | PESTEL |
| [Future_Work.md](../../Future_Work.md) | Roadmap |
| [WORK.md](../../WORK.md) | Root-Index |

---

**Regel:** Links zeigen auf Root-`WORK_*.md`. Kein Bulk-Move.
