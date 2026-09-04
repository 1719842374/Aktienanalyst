# docs/work-dokumentation — umgesetzte WORK-Specs

> Stand Einordnung: 04.09.2026
> Quelle Ampel: `WORK_IST_VS_SOLL.md` (Audit 01.09.2026, HEAD damals `9ecaf8e`) plus Code-Stichprobe 04.09.
> **Noch keine Datei hierher verschoben.** Originale liegen im Repo-Root. Nächster Commit kopiert 1:1, dann erst Root löschen.

Ist = Datei existiert im Codepfad der Ist-vs-Soll-Tabelle, Kern live.

| Datei (aktuell Root) | Ist im Code | Ampel |
|----------------------|-------------|-------|
| WORK_ANALYZE_DISK_CACHE.md | L1 20 min + L2 7 d | ✅ |
| WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md | disk-cache verdrahtet | ✅ |
| WORK2.md | PESTEL `regulatory.ts` | ✅ |
| WORK_ANTIBIAS_DCF.md | inverted DCF / g* | ✅ |
| WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | ✅ |
| WORK_BTC_MINER.md | `btc-miner.ts` | ✅ |
| WORK_DATA_PROVIDERS.md | FMP + Yahoo/Stooq | ✅ |
| WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | `LYNCH_DCF_DEFAULTS` | ✅ |
| WORK_NEWS_SENTIMENT.md | `news-sentiment.ts` | ✅ |
| WORK_PEER_ROIC_SANITY.md | `sanitizeRoic` | ✅ |
| WORK_PORTFOLIO.md | `lib/portfolio` | ✅ |
| WORK_PORTFOLIO_BACKTEST.md | `backtest.ts` | ✅ |
| WORK_RESEARCHER_BUTTONS_APPLY.md | TickerAddButtons | ✅ |
| WORK_RESEARCHER_LIQUIDITY_REGIME.md | GET `/api/researcher/liquidity` C2 **nur US** | ✅ Ist |
| WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ✅ |
| WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/HHI Fixture | ✅ |
| WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons | ✅ |
| WORK_REVERSE_DCF_BRIDGE.md | `fiscal-bridge.ts` in `/api/analyze` | ✅ |
| WORK_SCORING_VORLAGE.md | Gates + Lookahead | ✅ |
| WORK_SECTION4_DATA_BUGS.md | PEG/FCF | ✅ |
| WORK_SEGMENT_DEDUP.md | `fmp.ts` | ✅ |
| WORK_SEKTORROTATIONS_RAT.md | SectorRotationPanel | ✅ |
| WORK_SIGNAL_BACKTEST.md | `server/backtest/*` | ✅ |
| WORK_STABLECOIN_TBILL_GENIUS.md | DefiLlama live; Score/Anteile **manuell** | ✅ Kern / 🟡 GENIUS-Konstanten |
| WORK_TAM_RESIDUAL_XBOX.md | sector-data | ✅ |
| WORK_TAM_SEGMENT_MAPPING.md | assessTamQuality | ✅ |
| WORK_TEIL0-6.md | Platform/BTC/FMP | ✅ |
| WORK_TEIL7_SCORING.md | Gold + WALCL | ✅ |
| WORK_VALUECHAIN_SECTOR_ROTATION.md | Rang 1–6 live, 7–9 offen | 🟡 |
| WORK_IST_VS_SOLL.md | Audit-Snapshot | Meta |
| WORK_IMPLEMENTIERUNG_OFFEN.md | Ampel-Banner | Meta |

Nicht hierher: Specs in `docs/work-offen/` (s(z)-Index, Briefing v2, Quellenkatalog).
