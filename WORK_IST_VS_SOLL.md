# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 30.08.2026 20:45 CEST
> **Repo:** `1719842374/Aktienanalyst`
> **HEAD:** `9aa6f9a` (C1 P0+P1 squash PR #40)
> **Regel:** Ist nur aus Code. ✅ Kern im Code · 🟡 Kern da, Spec-Zusatz fehlt · ⬜ Spec ohne Engine/UI.

---

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien inkl. Index | **32** |
| Analyze-Cache TTL | **L1 20 min RAM + L2 7 d SQLite** |
| Researcher-Cache TTL | **6 h** + SQLite |
| Disk-Schema | `2026-08-29-v2` |
| OHLCV Cap in Analyze | **2600** |

Scoreboard Feature-Docs (ohne Index `WORK.md`):

| Ampel | Anzahl | Anteil |
|-------|--------|--------|
| ✅ Kern umgesetzt | 21 | 68 % |
| 🟡 teilweise | 6 | 19 % |
| ⬜ offen | 4 | 13 % |

---

## 0b. Server-Routing + Cache

| Methode | Pfad | Cache |
|---------|------|-------|
| POST | `/api/analyze` | L1 20 min + L2 7 d |
| POST | `/api/catalyst-enrich` | L1+L2 |
| POST | `/api/researcher/*` | 6 h File / 1 d SQLite |
| GET | `/api/researcher/sector-rotation` | 6 h (C1, additiv) |
| GET | `/api/health` | unberührt |

Kein Portfolio-Backend — `/#/portfolio` ist `localStorage`.

Offene Routen: Liquidity/WALCL, Fiscal-Hook, C1 P2/P3 Donut.

---

## 1. Mastertabelle Soll vs. Ist

| # | Datei | Soll | Ist | Ampel | Code |
|---|-------|------|-----|-------|------|
| 1 | WORK.md | Index | Navigation + Cache-Docs | 📄 | Root |
| 1b | WORK_ANALYZE_DISK_CACHE.md | 7d KI-Catch | L2-Schicht + Patch | ✅ | disk-cache + patch |
| 1c | WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md | Wiring | disk-cache live | ✅ | |
| 2 | WORK2.md | Regulatory/PESTEL | Gate da, Risks lazy | 🟡 | regulatory.ts |
| 3 | WORK_ANTIBIAS_DCF.md | eine Schicht, g* | ja | ✅ | invertedDcf |
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | nur Einzeltitel-GBM | 🟡 | MonteCarloSection |
| 5 | WORK_BTC_MINER.md | Hash Ribbons/Puell | ja | ✅ | btc-miner.ts |
| 6 | WORK_DATA_PROVIDERS.md | 5Y + Alternative | FMP + Yahoo/Stooq Fallback | ✅ | history-fallback.ts |
| 7 | WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults | nur lynchClass | 🟡 | classifyLynch |
| 8 | WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | news-sentiment.ts |
| 9 | WORK_PEER_ROIC_SANITY.md | LITB 469% kappen | sanitizeRoic | ✅ | news-peers.ts |
| 10 | WORK_PORTFOLIO.md | F.2 complete | ja + Tests | ✅ | lib/portfolio |
| 11 | WORK_PORTFOLIO_BACKTEST.md | Depot vs Benchmark | Equity-Curve+Underwater+Attribution | ✅ | lib/portfolio/backtest.ts |
| 12 | WORK_RESEARCHER_BUTTONS_APPLY.md | Phase-2 Buttons | verdrahtet | ✅ | TickerAddButtons |
| 13 | WORK_RESEARCHER_LIQUIDITY_REGIME.md | WALCL/RRP/TGA | nicht gebaut | ⬜ | |
| 14 | WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ja | ✅ | |
| 15 | WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/Cap/HHI | Konstanten ja | 🟡 | |
| 16 | WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons | Code hat Buttons | ✅ | |
| 17 | WORK_REVERSE_DCF_BRIDGE.md | Fiscal in DCF | Modul unwired | 🟡 | fiscal-bridge.ts |
| 18 | WORK_SCORING_VORLAGE.md | Gates + Lookahead | Pipeline ja | 🟡 | scoring-gates.ts |
| 19 | WORK_SECTION4_DATA_BUGS.md | PEG done, FCF offen | PEG ja + FCF-Fix | ✅ | Section4.tsx |
| 20 | WORK_SEGMENT_DEDUP.md | Cross-Dedup | Name-Dedup + Alias-Dedup | ✅ | fmp.ts |
| 21 | WORK_SEKTORROTATIONS_RAT.md | Radar | P0+P1 Engine+Route+Tabelle live (`9aa6f9a`); P2/P3 Donut/Karten offen | ✅ | sector-rotation*.ts |
| 22 | WORK_SIGNAL_BACKTEST.md | PIT-Backtest | Phase 0-6 komplett | ✅ | server/backtest/* |
| 23 | WORK_STABLECOIN_TBILL_GENIUS.md | Stablecoin-Kanal | leer | ⬜ | |
| 24 | WORK_TAM_RESIDUAL_XBOX.md | Mix 2,5% | Residuum-Zeile + Xbox-n/a | ✅ | sector-data.ts |
| 25 | WORK_TAM_SEGMENT_MAPPING.md | Quality-Tor | assessTamQuality + Alias + DCF | ✅ | sector-data.ts |
| 26 | WORK_TEIL0-6.md | Platform/BTC/FMP | Kern | ✅ | |
| 27 | WORK_TEIL7_SCORING.md | Gold + WALCL | OLS ja | 🟡 | |
| 28 | WORK_VALUECHAIN_SECTOR_ROTATION.md | 9 Tasks | 1–3 ja | 🟡 | |

C1 Ampel ✅ trotz P2/P3-Lücke: Kern (9 ETF-Proxies, Risiko 1–5, Bewertung, Attraktivität, Phase aus Recession, GET, 6h-Cache, Quellenzeile) sitzt auf main. Donut/Zyklus-Karten nach C2.

## 2. Bereits umgesetzt (✅)

- ANALYZE_DISK_CACHE, ANTIBIAS, BTC_MINER, NEWS_SENTIMENT, PEER_ROIC, PORTFOLIO F.2
- BUTTONS_APPLY + SECTOR_ADD + RESEARCHER_PORTFOLIO, TEIL0-6 Kern
- **Sprint A (30.08.2026):** TAM Quality, Xbox-n/a, FCF-Fix, AWS-Alias
- **Sprint B (30.08.2026):** OHLCV-Fallback Cap 2600, Portfolio-Backtest, PIT Phase 0–6
- **Sprint C1 P0+P1 (30.08.2026, `9aa6f9a`):** `sector-rotation-math/score.ts` + live fetch, `GET /api/researcher/sector-rotation`, Tabelle in SectorRotationPanel. `researcher.ts` unberührt.

## 3. Offen (⬜)

LIQUIDITY_REGIME (C2), STABLECOIN_TBILL_GENIUS, SEKTORROTATION P2/P3 (Donut/Karten), Valuechain-Rest / Lynch / Fiscal-Hook / Gold Multi-OLS / BL+MC (Sprint D, 🟡 oder ⬜).

Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md`.
