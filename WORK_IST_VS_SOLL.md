# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 01.09.2026 08:55 CEST
> **Repo:** `1719842374/Aktienanalyst`
> **HEAD:** `20fb037` (Sprint D6c: Value-Chain Nav + KI-Anreicherung + Batching-Fix)
> **Regel:** Ist nur aus Code. ✅ Kern im Code · 🟡 Kern da, Spec-Zusatz fehlt · ⬜ Spec ohne Engine/UI.
> **tsc-Baseline:** 97 Fehler (verifiziert, unverändert seit Sprint D6a — 3 vorbestehende tote
> `@xyflow/react`-Importe wurden beim D6a-Refactor mitbehoben).

---

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien inkl. Index | **32** |
| Analyze-Cache TTL | **L1 20 min RAM + L2 7 d SQLite** |
| Researcher-Cache TTL | **6 h** + SQLite (Liquidity-Regime 6h, Value-Chain 18-24h) |
| Disk-Schema | `2026-08-29-v2` |
| OHLCV Cap in Analyze | **2600** |

Scoreboard Feature-Docs (ohne Index `WORK.md`):

| Ampel | Anzahl | Anteil |
|-------|--------|--------|
| ✅ Kern umgesetzt | 26 | 84 % |
| 🟡 teilweise | 4 | 13 % |
| ⬜ offen | 1 | 3 % |

---

## 0b. Server-Routing + Cache

| Methode | Pfad | Cache |
|---------|------|-------|
| POST | `/api/analyze` | L1 20 min + L2 7 d, inkl. Fiscal-Overlay (D3) |
| POST | `/api/catalyst-enrich` | L1+L2 |
| POST | `/api/researcher/*` | 6 h File / 1 d SQLite |
| GET | `/api/researcher/sector-rotation` | 6 h (C1, additiv) |
| GET | `/api/researcher/liquidity` | 6 h (C2, additiv, `macro_v2__US`) |
| GET | `/api/analyze-btc/stablecoin-liquidity` | 5 min RAM + täglicher Disk-Backstop (D4) |
| GET | `/api/analyze-gold` | 1-Faktor Default + optionales Multi-Faktor-Feld (D5) |
| GET | `/api/valuechain` | 18-24h Disk-Cache (D6a) |
| POST | `/api/valuechain/enrich` | 7 Tage Disk-Cache, echter LLM-Call (D6c) |
| GET | `/api/health` | unberührt |

Kein Portfolio-Backend — `/#/portfolio` ist `localStorage`, Black-Litterman/Portfolio-MC (D2) laufen
client-seitig in `client/src/lib/portfolio/`.

Offene Route: C1 P2/P3 Sektorradar-Donut (aktuell nur Tabelle, kein Graph/Donut).

---

## 1. Mastertabelle Soll vs. Ist

| # | Datei | Soll | Ist | Ampel | Code |
|---|-------|------|-----|-------|------|
| 1 | WORK.md | Index | Navigation + Cache-Docs | 📄 | Root |
| 1b | WORK_ANALYZE_DISK_CACHE.md | 7d KI-Catch | L2-Schicht + Patch | ✅ | disk-cache + patch |
| 1c | WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md | Wiring | disk-cache live | ✅ | |
| 2 | WORK2.md | Regulatory/PESTEL | Gate da, Risks lazy | 🟡 | regulatory.ts |
| 3 | WORK_ANTIBIAS_DCF.md | eine Schicht, g* | ja | ✅ | invertedDcf |
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | **Reverse Opt Π, BL-Formel (§16.9), Sensitivität, Cholesky-Portfolio-MC mit VaR/CVaR/maxDD** | ✅ | `blackLitterman.ts`, `portfolioMonteCarlo.ts` (D2, `08e8938`) |
| 5 | WORK_BTC_MINER.md | Hash Ribbons/Puell | ja | ✅ | btc-miner.ts |
| 6 | WORK_DATA_PROVIDERS.md | 5Y + Alternative | FMP + Yahoo/Stooq Fallback | ✅ | history-fallback.ts |
| 7 | WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults + RSL-Malus + g*-Gap | **`LYNCH_DCF_DEFAULTS` alle 6 Klassen, klassenabhängiger RSL-Malus, g*-Gap-Analyse in Sektion 14** | ✅ | `shared/lynch-dcf-defaults.ts` (D1, `84f6fe4`) |
| 8 | WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | news-sentiment.ts |
| 9 | WORK_PEER_ROIC_SANITY.md | LITB 469% kappen | sanitizeRoic | ✅ | news-peers.ts |
| 10 | WORK_PORTFOLIO.md | F.2 complete | ja + Tests | ✅ | lib/portfolio |
| 11 | WORK_PORTFOLIO_BACKTEST.md | Depot vs Benchmark | Equity-Curve+Underwater+Attribution | ✅ | lib/portfolio/backtest.ts |
| 12 | WORK_RESEARCHER_BUTTONS_APPLY.md | Phase-2 Buttons | verdrahtet | ✅ | TickerAddButtons |
| 13 | WORK_RESEARCHER_LIQUIDITY_REGIME.md | WALCL/RRP/TGA | **live, `GET /api/researcher/liquidity`, LiquidityPanel** | ✅ | `liquidity-regime.ts`, `liquidity-regime-math.ts` (C2, `f0931d8`) |
| 14 | WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ja | ✅ | |
| 15 | WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/Cap/HHI | Konstanten ja | 🟡 | |
| 16 | WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons | Code hat Buttons | ✅ | |
| 17 | WORK_REVERSE_DCF_BRIDGE.md | Fiscal in DCF | **Teil 3 (`allocateProgramToFcf`/`capOverlays`/`forwardDcfWithFiscal`) live in `/api/analyze` verdrahtet, additives `fiscalOverlay`-Feld, g*/CRV bleiben clean** | ✅ | `fiscal-bridge.ts` + `analyze-route.ts` (D3, `9e635be`) |
| 18 | WORK_SCORING_VORLAGE.md | Gates + Lookahead | Pipeline ja | 🟡 | scoring-gates.ts |
| 19 | WORK_SECTION4_DATA_BUGS.md | PEG done, FCF offen | PEG ja + FCF-Fix | ✅ | Section4.tsx |
| 20 | WORK_SEGMENT_DEDUP.md | Cross-Dedup | Name-Dedup + Alias-Dedup | ✅ | fmp.ts |
| 21 | WORK_SEKTORROTATIONS_RAT.md | Radar | P0+P1 Engine+Route+Tabelle live; **P2/P3 Donut + Zyklus-Karten weiterhin offen** | 🟡 | sector-rotation*.ts |
| 22 | WORK_SIGNAL_BACKTEST.md | PIT-Backtest | Phase 0-6 komplett | ✅ | server/backtest/* |
| 23 | WORK_STABLECOIN_TBILL_GENIUS.md | Stablecoin-Kanal | **live via DefiLlama (Total/USDT/USDC MCap), T-Bill-Nachfrage-Schätzung, GENIUS-Score als klar gekennzeichnete Rule-based-Policy-Konstante** | ✅ | `stablecoin-liquidity.ts` (D4, `7bdaa40`) |
| 24 | WORK_TAM_RESIDUAL_XBOX.md | Mix 2,5% | Residuum-Zeile + Xbox-n/a | ✅ | sector-data.ts |
| 25 | WORK_TAM_SEGMENT_MAPPING.md | Quality-Tor | assessTamQuality + Alias + DCF | ✅ | sector-data.ts |
| 26 | WORK_TEIL0-6.md | Platform/BTC/FMP | Kern | ✅ | |
| 27 | WORK_TEIL7_SCORING.md | Gold + WALCL | **1-Faktor MVP + Phase-2 Multi-Faktor-OLS (Real10Y+DXY+log(WALCL)) als optionale Vergleichslinie, Vorzeichen-Gate** | ✅ | `gold-realyield-model.ts` (D5, `01bdb8e`) |
| 28 | WORK_VALUECHAIN_SECTOR_ROTATION.md | 9 Tasks | **Rang 1-6 live (Node-Typen, Backoff, CAPEX-Helper, Branchen-Selector+API, FMP-Enrichment+Rate-Limits, CAPEX live) + Nav-Verknüpfung + KI-Anreicherung (D6c); Rang 7-9 (Custom Edges/Animation/Redis) bewusst zurückgestellt** | 🟡 | `valuechain-routes.ts`, `valuechain-fmp-enrichment.ts`, `ValueChainDashboard.tsx` (D6a/b/c) |

---

## 2. Bereits umgesetzt (✅)

- ANALYZE_DISK_CACHE, ANTIBIAS, BTC_MINER, NEWS_SENTIMENT, PEER_ROIC, PORTFOLIO F.2
- BUTTONS_APPLY + SECTOR_ADD + RESEARCHER_PORTFOLIO, TEIL0-6 Kern
- **Sprint A (30.08.2026):** TAM Quality, Xbox-n/a, FCF-Fix, AWS-Alias
- **Sprint B (30.08.2026):** OHLCV-Fallback Cap 2600, Portfolio-Backtest, PIT Phase 0–6
- **Sprint C1 P0+P1 (30.08.2026, `9aa6f9a`):** `sector-rotation-math/score.ts` + live fetch, `GET /api/researcher/sector-rotation`, Tabelle in SectorRotationPanel. `researcher.ts` unberührt.
- **Sprint C2 (30.08.2026, `f0931d8`):** Liquidity-Regime FRED WALCL/RRPONTSYD/WTREGEN(TGA), `GET /api/researcher/liquidity`, `LiquidityPanel.tsx`, `researcher.ts` unberührt.
- **Sprint D1 (31.08.2026, `84f6fe4`):** Lynch-DCF-Default-Matrix für alle 6 Klassen, klassenabhängiger RSL-Malus, g*-Gap-Analyse (Sektion 14), FMP-DCF-Endpoints explizit ausgeschlossen.
- **Sprint D2 (31.08.2026, `08e8938`):** Black-Litterman (Reverse Opt Π, BL-Formel, Sensitivitätsklassifikation), Portfolio-Monte-Carlo (Cholesky-korrelierte Multi-Asset-GBM, VaR/CVaR/maxDD, Ist- vs. CAPM-Vergleich).
- **Sprint D3 (31.08.2026, `9e635be`):** Fiscal-Bridge Teil 3 (`allocateProgramToFcf`/`capOverlays`/`forwardDcfWithFiscal`) live in `/api/analyze` verdrahtet, additives `fiscalOverlay`-Feld, g*/gehärtete CRV bleiben unverändert. tsc-Baseline 101→100 (echte Verbesserung).
- **Sprint D4 (31.08.2026, `7bdaa40`):** Stablecoin-Liquidity-Kanal (DefiLlama live), T-Bill-Nachfrage-Schätzung, GENIUS-Act-Score als transparent gekennzeichnete Rule-based-Policy-Konstante, neue BTC-Dashboard-Sektion.
- **Sprint D5 (31.08.2026, `01bdb8e`):** Gold Multi-Faktor-OLS Phase 2 (Real10Y+DXY+log(WALCL)), Rolling-OLS Window 252, Vorzeichen-Check-Gate, optionale Vergleichslinie neben 1-Faktor-Default.
- **Sprint D6a-c (31.08.2026, `9170135`/`7b6e230`/`20fb037`):** Value-Chain Branchen-Selector + API, FMP-Enrichment mit Rate-Limit-Schichten (Concurrency-Gate + Backoff + Cache), live CAPEX-Intensity, Dashboard-Redesign (Dark-Theme, Stufen-Layout, KPI-Kacheln), Top-Bar-Navigation verknüpft, KI-Anreicherungs-Button mit echtem LLM-Call (Batching-Fix: 57/57 Firmen statt vorher 47/57 bei großen Branchen).

## 3. Offen (⬜/🟡)

- **C1 P2/P3** (🟡): Sektorradar-Donut + Zyklus-Karten — aktuell nur Tabelle, kein Graph. Kein aktives Ticket.
- **D6 Rang 7-9** (🟡, bewusst zurückgestellt): Custom-Edges/React-Flow-Graph-Renderer für Value-Chain (würde `@xyflow/react` als neue Dependency erfordern — auf Nutzerwunsch aufgeschoben, stattdessen CSS-Karten-Layout gebaut), Edge-Animationen, Redis-basiertes Rate-Limiting (In-Process-Lösung gilt als für aktuelle Last ausreichend).
- **WORK_RESEARCHER_PORTFOLIO_TEIL2** (🟡): δ/Cap/HHI-Konstanten vorhanden, vollständige Spec-Abdeckung nicht verifiziert.
- **WORK2 (Regulatory/PESTEL)** (🟡): Gate vorhanden, Risks-Herleitung weiterhin lazy/teilweise.
- **WORK_SCORING_VORLAGE** (🟡): Kern-Pipeline da, nicht alle Lookahead-Detailregeln verifiziert.

Kein vollständig offener (⬜) Punkt mehr aus der vorherigen Fassung — LIQUIDITY_REGIME, STABLECOIN_TBILL_GENIUS,
Lynch, Fiscal-Hook, Gold Multi-OLS, BL+MC und Valuechain-Kern sind alle seit Sprint C/D umgesetzt.

Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md` (Stand dort ist älter, C2/D1-D6 dort noch als "offen" markiert — durch
dieses Dokument überholt).
