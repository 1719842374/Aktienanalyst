# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 01.09.2026 20:30 CEST
> **Repo:** `1719842374/Aktienanalyst`
> **HEAD:** `9ecaf8e` (Banner P1.1–P1.3 done)
> **Regel:** Ist nur aus Code. ✅ Kern im Code · 🟡 Kern da, Spec-Zusatz fehlt · ⬜ Spec ohne Engine/UI.
> **tsc-Baseline:** 97 Fehler.

---

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien inkl. Index | **32** |
| Analyze-Cache TTL | **L1 20 min RAM + L2 7 d SQLite** |
| Researcher-Cache TTL | **6 h** + SQLite (Liquidity 6h, Value-Chain 18-24h) |
| Disk-Schema | `2026-08-29-v2` |
| OHLCV Cap in Analyze | **2600** |

Scoreboard Feature-Docs (ohne Index `WORK.md`):

| Ampel | Anzahl | Anteil |
|-------|--------|--------|
| ✅ Kern umgesetzt | 30 | 97 % |
| 🟡 teilweise | 1 | 3 % |
| ⬜ offen | 0 | 0 % |

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
| GET | `/api/analyze-gold` | 1-Faktor + optionales Multi-Faktor (D5) |
| GET | `/api/valuechain` | 18-24h Disk (D6a + Phase 1–2) |
| POST | `/api/valuechain/enrich` | 7 d Disk, LLM (D6c) |
| GET | `/api/health` | unberührt |

Kein Portfolio-Backend — `/#/portfolio` ist `localStorage`. D2 client-seitig.

Keine offene Radar-/Liquidity-Route.

---

## 1. Mastertabelle Soll vs. Ist

| # | Datei | Soll | Ist | Ampel | Code |
|---|-------|------|-----|-------|------|
| 1 | WORK.md | Index | Navigation + Cache-Docs | 📄 | Root |
| 1b | WORK_ANALYZE_DISK_CACHE.md | 7d KI-Catch | L2-Schicht + Patch | ✅ | disk-cache |
| 1c | WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md | Wiring | disk-cache live | ✅ | |
| 2 | WORK2.md | Regulatory/PESTEL | PESTEL-Risks live, kein Hardcoding | ✅ | regulatory.ts (`c83e543`, PR #43) |
| 3 | WORK_ANTIBIAS_DCF.md | eine Schicht, g* | ja | ✅ | invertedDcf |
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | Reverse Opt Π, BL, Cholesky-MC | ✅ | blackLitterman.ts (D2, `08e8938`) |
| 5 | WORK_BTC_MINER.md | Hash Ribbons/Puell | ja | ✅ | btc-miner.ts |
| 6 | WORK_DATA_PROVIDERS.md | 5Y + Alternative | FMP + Yahoo/Stooq | ✅ | history-fallback.ts |
| 7 | WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults | `LYNCH_DCF_DEFAULTS` 6 Klassen | ✅ | shared/lynch-dcf-defaults.ts (D1) |
| 8 | WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | news-sentiment.ts |
| 9 | WORK_PEER_ROIC_SANITY.md | LITB kappen | sanitizeRoic | ✅ | news-peers.ts |
| 10 | WORK_PORTFOLIO.md | F.2 complete | ja + Tests | ✅ | lib/portfolio |
| 11 | WORK_PORTFOLIO_BACKTEST.md | Depot vs Benchmark | Equity-Curve+Underwater | ✅ | backtest.ts |
| 12 | WORK_RESEARCHER_BUTTONS_APPLY.md | Phase-2 Buttons | verdrahtet | ✅ | TickerAddButtons |
| 13 | WORK_RESEARCHER_LIQUIDITY_REGIME.md | WALCL/RRP/TGA | live GET `/api/researcher/liquidity` | ✅ | liquidity-regime.ts (C2, `f0931d86`) |
| 14 | WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ja | ✅ | |
| 15 | WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/Cap/HHI | Fixture Q + UI auf main | ✅ | test-portfolio-teil2.ts (`d6b41b3`, PR #44) |
| 16 | WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons | Code hat Buttons | ✅ | |
| 17 | WORK_REVERSE_DCF_BRIDGE.md | Fiscal in DCF | Teil 3 live in `/api/analyze` | ✅ | fiscal-bridge.ts (D3) |
| 18 | WORK_SCORING_VORLAGE.md | Gates + Lookahead | Pipeline + Lookahead-Fixture | ✅ | scoring-gates.ts (`9215cee`, PR #45) |
| 19 | WORK_SECTION4_DATA_BUGS.md | PEG + FCF | PEG ja + FCF-Fix | ✅ | Section4.tsx |
| 20 | WORK_SEGMENT_DEDUP.md | Cross-Dedup | Name + Alias | ✅ | fmp.ts |
| 21 | WORK_SEKTORROTATIONS_RAT.md | Radar | P0–P3 Engine+Route+Tabelle+Donut/Ring+Zyklus-Karten live | ✅ | SectorRotationPanel (`480e98a`/`ce68d10`/`ed71688`) |
| 22 | WORK_SIGNAL_BACKTEST.md | PIT-Backtest | Phase 0-6 | ✅ | server/backtest/* |
| 23 | WORK_STABLECOIN_TBILL_GENIUS.md | Stablecoin-Kanal | DefiLlama + GENIUS-Score | ✅ | stablecoin-liquidity.ts (D4) |
| 24 | WORK_TAM_RESIDUAL_XBOX.md | Mix 2,5% | Residuum + Xbox-n/a | ✅ | sector-data.ts |
| 25 | WORK_TAM_SEGMENT_MAPPING.md | Quality-Tor | assessTamQuality | ✅ | sector-data.ts |
| 26 | WORK_TEIL0-6.md | Platform/BTC/FMP | Kern | ✅ | |
| 27 | WORK_TEIL7_SCORING.md | Gold + WALCL | 1-Faktor + Multi-OLS | ✅ | gold-realyield-model.ts (D5) |
| 28 | WORK_VALUECHAIN_SECTOR_ROTATION.md | 9 Tasks | Rang 1–6 + Phase 1–2 GICS-Ketten live (`4401ce6`/`a02ad19`); Rang 7–9 xyflow bewusst zurück | 🟡 | valuechain-catalog.ts, valuechain-routes.ts |

## 2. Bereits umgesetzt (✅)

- Sprint A/B, C1 P0+P1 (`9aa6f9a`), C2 (`f0931d86`)
- **C1 P2/P3 (01.09.2026):** Donut/3D-Ring, 2D-Radar, Zyklusfortschritt-Leiste in `SectorRotationPanel.tsx` (`480e98a`/`ce68d10`/`ed71688` + Follow-ups). Nicht neu bauen.
- Sprint D1–D6c (Lynch, BL+MC, Fiscal, GENIUS, Gold Multi-OLS, Valuechain-Kern+Nav+KI)
- **Valuechain Phase 1–2 (01.09.2026):** `4401ce6` Pharma/Medtech/Renewables/Data-Center/Kupfer/Chemie-Stahl; `a02ad19` 8 weitere GICS-Ketten. Kupfer-Downstream-Gate ehrlich rot. Rang 7–9 nicht angefasst.
- **P1.1 WORK2 (01.09.2026):** `c83e543` PR #43, PESTEL-Risks. Nicht neu bauen.
- **P1.2 TEIL2 (01.09.2026):** `d6b41b3` PR #44, Fixture Q. Nicht neu bauen.
- **P1.3 Scoring (01.09.2026):** `9215cee` PR #45, Lookahead-Fixture. Nicht neu bauen.

## 3. Offen (🟡)

- **D6 Rang 7–9** — Custom Edges/Animation/Redis; `@xyflow/react` nur nach Entscheidung. CSS-Karten bleiben.

`Future_Work.md` ist Roadmap, kein Ticket. Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md`.
