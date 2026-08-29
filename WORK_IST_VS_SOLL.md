# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 29.08.2026 12:40 CEST  
> **Repo:** `1719842374/Aktienanalyst`  
> **Cache-Fix:** `bfa64b9` disk-cache L2 + `bc5b10d` WORK/Patch  
> **Regel:** Ist nur aus Code. ✅ Kern im Code · 🟡 Kern da, Spec-Zusatz fehlt · ⬜ Spec ohne Engine/UI.

---

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien inkl. Index | **32** |
| Code-Dateien gescannt | **234** |
| Server-Module `server/*.ts` | 37 |
| Portfolio-Engine-Dateien | **11** (kein `backtest.ts`) |
| Test-Skripte `script/test-*.ts` | **40** |
| Backtest-/PIT-Engine | **0** |
| FMP Historie Free/Starter | **5 Jahre** (Premium 30+) |
| Analyze-Cache TTL | **L1 20 min RAM + L2 7 d SQLite** (Key = `buildAnalyzeCacheKey`) |
| Researcher-Cache TTL | **6 h** + SQLite |
| Disk-Schema | `2026-08-29-v2` |
| Regulatory / Management / Thesis Cache | **24 h / Ticker** |
| OHLCV Cap in Analyze | **2600** Punkte |
| Portfolio `maxWeight` | 0,30 |
| Shrinkage δ | 0,25 |
| Score-Tilt κ | 0,35 |
| Kelly | 0,50 / maxF 0,25 |
| HHI-Schwellen | 0,60 / 0,70 / 0,90 |
| Spec-Beispiel Ist-Gewicht | MSFT ~48 % vs. Cap 30 % |

Scoreboard Feature-Docs (ohne Index `WORK.md`):

| Ampel | Anzahl | Anteil |
|-------|--------|--------|
| ✅ Kern umgesetzt | 16 | 52 % |
| 🟡 teilweise | 9 | 31 % |
| ⬜ offen | 6 | 21 % |

Route-Patch für L2-Read/Write: `git apply patches/0001-analyze-l2-disk-cache.patch`.

---

## 0b. Server-Routing + Cache

| Methode | Pfad | Cache |
|---------|------|-------|
| POST | `/api/analyze` | L1 20 min + L2 7 d (nach Patch) |
| POST | `/api/catalyst-enrich` | L1+L2 nach Patch |
| POST | `/api/risk-explanations` | kein Persist (v1.1) |
| POST | `/api/policy-context` | kein Persist (v1.1) |
| POST | `/api/regulatory` | 24h RAM |
| POST | `/api/researcher/*` | 6 h File / 1 d SQLite |

Kein Portfolio-Backend — `/#/portfolio` ist `localStorage`.

Offene Routen unverändert: Portfolio-Backtest, Signal-PIT, Liquidity/WALCL, Sektor-Radar, OHLCV-Zweitprovider, Fiscal-Hook, TAM-Quality.

---

## 1. Mastertabelle Soll vs. Ist

| # | Datei | Soll | Ist | Ampel | Code |
|---|-------|------|-----|-------|------|
| 1 | WORK.md | Index | Navigation + Cache-Docs | 📄 | Root |
| 1b | WORK_ANALYZE_DISK_CACHE.md | 7d KI-Catch | L2-Schicht + Patch | ✅ | disk-cache + patch |
| 1c | WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md | Wiring | disk-cache live, Route via Patch | ✅ | |
| 2 | WORK2.md | Regulatory/PESTEL | Gate da, Risks lazy | 🟡 | regulatory.ts |
| 3 | WORK_ANTIBIAS_DCF.md | eine Schicht, g* | ja | ✅ | invertedDcf |
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | nur Einzeltitel-GBM | 🟡 | MonteCarloSection |
| 5 | WORK_BTC_MINER.md | Hash Ribbons/Puell | ja | ✅ | btc-miner.ts |
| 6 | WORK_DATA_PROVIDERS.md | 5Y + Alternative | nur FMP | 🟡 | fmp.ts |
| 7 | WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults | nur lynchClass | 🟡 | classifyLynch |
| 8 | WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | news-sentiment.ts |
| 9 | WORK_PEER_ROIC_SANITY.md | LITB 469% kappen | sanitizeRoic | ✅ | news-peers.ts |
| 10 | WORK_PORTFOLIO.md | F.2 complete | ja + Tests | ✅ | lib/portfolio |
| 11 | WORK_PORTFOLIO_BACKTEST.md | Depot vs Benchmark | keine Engine | ⬜ | — |
| 12 | WORK_RESEARCHER_BUTTONS_APPLY.md | Phase-2 Buttons | verdrahtet | ✅ | TickerAddButtons |
| 13 | WORK_RESEARCHER_LIQUIDITY_REGIME.md | WALCL/RRP/TGA | nicht gebaut | ⬜ | |
| 14 | WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ja | ✅ | |
| 15 | WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/Cap/HHI | Konstanten ja | 🟡 | |
| 16 | WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons | Code hat Buttons | ✅ | |
| 17 | WORK_REVERSE_DCF_BRIDGE.md | Fiscal in DCF | Modul unwired | 🟡 | fiscal-bridge.ts |
| 18 | WORK_SCORING_VORLAGE.md | Gates + Lookahead | Pipeline ja | 🟡 | scoring-gates.ts |
| 19 | WORK_SECTION4_DATA_BUGS.md | PEG done, FCF offen | PEG ja | 🟡 | Section4.tsx |
| 20 | WORK_SEGMENT_DEDUP.md | Cross-Dedup | Name-Dedup | 🟡 | |
| 21 | WORK_SEKTORROTATIONS_RAT.md | Radar | leer | ⬜ | |
| 22 | WORK_SIGNAL_BACKTEST.md | PIT-Backtest | leer | ⬜ | |
| 23 | WORK_STABLECOIN_TBILL_GENIUS.md | Stablecoin-Kanal | leer | ⬜ | |
| 24 | WORK_TAM_RESIDUAL_XBOX.md | Mix 2,5% | Spec only | ⬜ | |
| 25 | WORK_TAM_SEGMENT_MAPPING.md | Quality-Tor | alte matchSegmentTAM | 🟡 | sector-data.ts |
| 26 | WORK_TEIL0-6.md | Platform/BTC/FMP | Kern | ✅ | |
| 27 | WORK_TEIL7_SCORING.md | Gold + WALCL | OLS ja | 🟡 | |
| 28 | WORK_VALUECHAIN_SECTOR_ROTATION.md | 9 Tasks | 1–3 ja | 🟡 | |

## 2. Bereits umgesetzt (✅)

- ANALYZE_DISK_CACHE: L2 7 d in disk-cache.ts, Route-Hunks im Patch
- ANTIBIAS, BTC_MINER, NEWS_SENTIMENT, PEER_ROIC, PORTFOLIO F.2
- BUTTONS_APPLY + SECTOR_ADD + RESEARCHER_PORTFOLIO
- TEIL0-6 Kern

## 3. Offen (⬜)

PORTFOLIO_BACKTEST, SIGNAL_BACKTEST, SEKTORROTATIONS_RAT, LIQUIDITY_REGIME, STABLECOIN_TBILL_GENIUS, TAM_RESIDUAL_XBOX.

Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md` und `WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md`.
