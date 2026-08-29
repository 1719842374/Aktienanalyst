# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 29.08.2026 12:15 CEST  
> **Repo:** `1719842374/Aktienanalyst`  
> **Branch / SHA-Basis:** `main` @ `d9760fc` (28.08.2026 23:29 +0200)  
> **Methode:** Tree 324 Objekte + 30 WORK-Dateien + 234 Code-Dateien + `BACKLOG.md` + `Future_Work.md` + `server/routes.ts` / `analyze-route.ts` / `researcher.ts` / `App.tsx`.  
> **Regel:** Ist nur aus Code. ✅ Kern im Code · 🟡 Kern da, Spec-Zusatz fehlt · ⬜ Spec ohne Engine/UI.

---

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien inkl. Index | **30** |
| Code-Dateien gescannt | **234** |
| Server-Module `server/*.ts` | 37 |
| Portfolio-Engine-Dateien | **11** (kein `backtest.ts`) |
| Test-Skripte `script/test-*.ts` | **40** |
| Backtest-/PIT-Engine | **0** |
| FMP Historie Free/Starter | **5 Jahre** (Premium 30+) |
| Analyze-Cache TTL | **20 min** |
| Researcher-Cache TTL | **6 h** + SQLite |
| Regulatory / Management / Thesis Cache | **24 h / Ticker** |
| OHLCV Cap in Analyze | **2600** Punkte |
| Portfolio `maxWeight` | 0,30 |
| Shrinkage δ | 0,25 |
| Score-Tilt κ | 0,35 |
| Kelly | 0,50 / maxF 0,25 |
| HHI-Schwellen | 0,60 / 0,70 / 0,90 |
| Spec-Beispiel Ist-Gewicht | MSFT ~48 % vs. Cap 30 % |

Scoreboard Feature-Docs (29, ohne Index `WORK.md`):

| Ampel | Anzahl | Anteil |
|-------|--------|--------|
| ✅ Kern umgesetzt | 14 | 48 % |
| 🟡 teilweise | 9 | 31 % |
| ⬜ offen | 6 | 21 % |

---

## 0b. Server-Routing + Client-Pages

Orchestrator: `registerRoutes()` in `server/routes.ts`.  
**Kein Portfolio-Backend** — `/#/portfolio` ist rein client-side (`localStorage` + `client/src/lib/portfolio/*`).

### Client (`client/src/App.tsx`, Hash-Router)

| Hash | Page | APIs |
|------|------|------|
| `/#/` | `Dashboard.tsx` | `POST /api/analyze` + lazy regulatory / thesis / management / enrich |
| `/#/portfolio` | `PortfolioPage.tsx` | keine Server-Route |
| `/#/researcher` | `Researcher.tsx` | `POST /api/researcher/{macro,sectors,screener,capex,daily-briefing}` |
| `/#/btc` | `BTCDashboard.tsx` | `GET/POST /api/btc-miner`, `/api/analyze-btc/macro-history` |
| `/#/gold` | `GoldDashboard.tsx` | `/api/analyze-gold` |
| `/#/recession` | `RecessionDashboard.tsx` | `/api/analyze-recession` |
| `/#/screener` | `ScreenerDashboard.tsx` | 13F `screener.ts` |
| `/#/compare` | `Compare.tsx` | mehrfach `/api/analyze` |

### API-Ist

| Methode | Pfad | Modul | Cache | WORK |
|---------|------|-------|-------|------|
| POST | `/api/analyze` | `analyze-route.ts` | 20 min inkl. Peer-Overrides | TAM, PEG, Sentiment, Scoring, g*, Segmente, FCF |
| GET | `/api/fmp-budget` | `analyze-route.ts` | — | DATA_PROVIDERS |
| POST | `/api/catalyst-enrich` | `analyze-route.ts` | Analyze-Cache | Katalysatoren |
| POST | `/api/risk-explanations` | `analyze-route.ts` | — | WORK2 |
| POST | `/api/policy-context` | `analyze-route.ts` | — | PESTEL |
| POST | `/api/regulatory` | `routes.ts` | 24h `regulatory.ts` | WORK2 + Gate REGULATORY_EXPOSURE |
| GET | `/api/search-ticker` | `routes.ts` | fail-open [] | Suffix-Markierung .HK/.T … |
| POST | `/api/researcher/macro` | `researcher.ts` | 6h | kein WALCL/RRP/TGA |
| POST | `/api/researcher/sectors` | `researcher.ts` | 6h | Buttons client |
| POST | `/api/researcher/screener` | `researcher.ts` | 6h | Buttons |
| POST | `/api/researcher/capex` | `researcher.ts` | 6h nur reiche Results | Buttons |
| POST | `/api/researcher/daily-briefing` | `researcher.ts` | Berlin-Tag | Briefing |
| GET/POST | `/api/btc-miner` | `btc-miner.ts` | mempool.space | BTC_MINER |
| | `/api/analyze-btc/macro-history` | `btc-routes.ts` | FRED DFII10+M2SL | Liquidity-Vorstufe |
| | `/api/analyze-gold` | `gold-routes.ts` | | TEIL7 |
| POST | `/api/management-score` | `routes.ts` | 24h | |
| POST | `/api/management-score-interpret` | `routes.ts` | | |
| POST | `/api/thesis-strength` | `routes.ts` | 24h + Catalyst-Sig | Lynch/Scoring |
| | `/api/analyze-recession` | `recession.ts` | | |
| | `/api/regression-scan` | `regression-scan.ts` | | |

### Routen die fehlen (Soll)

| Soll | WORK | Ist |
|------|------|-----|
| `POST /api/portfolio/backtest` | PORTFOLIO_BACKTEST | nicht registriert |
| `POST /api/signal-backtest` | SIGNAL_BACKTEST | nicht registriert |
| `/api/researcher/liquidity` oder Macro+WALCL | LIQUIDITY_REGIME | fehlt |
| `/api/researcher/rotation` | SEKTORROTATIONS_RAT | fehlt |
| OHLCV-Fallback-Provider | DATA_PROVIDERS | nur FMP |
| Fiscal-Hook in `/api/analyze` | REVERSE_DCF_BRIDGE | `fiscal-bridge.ts` unwired |
| `tamAnalysis.quality` | TAM_MAPPING | `generateTAMAnalysis` ohne Quality |

### `/api/analyze` Schrittfolge (betroffene Stellen)

1. `getFmpFallbackData` — Quote/IS/CF/BS/OHLCV/Segments/Geo/Peers/Ratios  
2. `fcfTTM = operatingCF - capex` — Statement-`freeCashFlow` nicht primär; 0 bleibt 0  
3. OHLCV slice(-2600) — 10Y nur wenn FMP sie liefert (Free oft 5Y)  
4. `fmpEarningsCalendar`  
5. Segmente: FMP → curated Map → SEC EDGAR → `dedupeSegmentsByName` → `geoWithoutOverlap`  
6. `generateTAMAnalysis` ohne Quality-Tor  
7. News RSS → `applyKeywordSentimentToNews` → `reconcileNewsSentiment`  
8. `buildScoringForAnalysis` + `getCachedRegulatoryAssessment` (lazy)  
9. Response: `tamAnalysis`, `pegRatio`, `lynchClass`, `impliedGStar`, `fcfTTM`, `revenueSegments`

Portfolio / Backtest / Radar / Liquidity / GENIUS: **kein Schritt**.

---

## 1. Mastertabelle Soll vs. Ist

| # | Datei | Soll | Ist | Ampel | Code |
|---|-------|------|-----|-------|------|
| 1 | WORK.md | Index | nur Navigation | 📄 | Root |
| 2 | WORK2.md | Regulatory/PESTEL | Gate da, Risks lazy | 🟡 | `regulatory.ts`, PESTEL, scoring-gates |
| 3 | WORK_ANTIBIAS_DCF.md | eine Schicht, g* | ja | ✅ | `invertedDcf`, `calcImpliedGStar` |
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | nur Einzeltitel-GBM | 🟡 | MonteCarloSection; BL nur Kommentar |
| 5 | WORK_BTC_MINER.md | Hash Ribbons/Puell/Hashprice | ja | ✅ | `btc-miner.ts`, Section13, Tests |
| 6 | WORK_DATA_PROVIDERS.md | 5Y-Limit + Alternative | nur FMP | 🟡 | `fmp.ts` |
| 7 | WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults | nur `lynchClass` Feld | 🟡 | schema + classifyLynch |
| 8 | WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | `news-sentiment.ts` |
| 9 | WORK_PEER_ROIC_SANITY.md | LITB 469% kappen | sanitizeRoic | ✅ | `news-peers.ts` |
| 10 | WORK_PORTFOLIO.md | F.2 complete | ja + Tests | ✅ | `lib/portfolio/*` |
| 11 | WORK_PORTFOLIO_BACKTEST.md | Depot vs Benchmark | keine Engine | ⬜ | — |
| 12 | WORK_RESEARCHER_BUTTONS_APPLY.md | Phase-2 Buttons | verdrahtet | ✅ | TickerAddButtons |
| 13 | WORK_RESEARCHER_LIQUIDITY_REGIME.md | WALCL/RRP/TGA | nicht gebaut | ⬜ | Gold-TODO only |
| 14 | WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ja | ✅ | ResearcherPortfoliosPanel |
| 15 | WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/Cap/HHI/Frontier | Konstanten ja, Frontier teilw. | 🟡 | weighting/covariance |
| 16 | WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons Sector | Code hat Buttons | ✅ | SectorsPanel.tsx |
| 17 | WORK_REVERSE_DCF_BRIDGE.md | Fiscal in DCF | Modul unwired | 🟡 | `fiscal-bridge.ts` |
| 18 | WORK_SCORING_VORLAGE.md | Gates + Lookahead | Pipeline ja, Signal-BT nein | 🟡 | scoring-gates.ts |
| 19 | WORK_SECTION4_DATA_BUGS.md | PEG done, FCF offen | PEG ja, FCF=0 offen | 🟡 | Section4.tsx |
| 20 | WORK_SEGMENT_DEDUP.md | Cross-Dedup | Name-Dedup + grober Geo-Filter | 🟡 | `dedupeSegmentsByName`, `geoWithoutOverlap` |
| 21 | WORK_SEKTORROTATIONS_RAT.md | Radar | leer | ⬜ | — |
| 22 | WORK_SIGNAL_BACKTEST.md | PIT-Backtest | leer | ⬜ | — |
| 23 | WORK_STABLECOIN_TBILL_GENIUS.md | Stablecoin-Kanal | leer | ⬜ | — |
| 24 | WORK_TAM_RESIDUAL_XBOX.md | Mix 2,5% / Xbox n/a | Spec only | ⬜ | — |
| 25 | WORK_TAM_SEGMENT_MAPPING.md | Quality-Tor | alte matchSegmentTAM | 🟡 | sector-data.ts |
| 26 | WORK_TEIL0-6.md | Platform/BTC/FMP | Kern | ✅ | |
| 27 | WORK_TEIL7_SCORING.md | Gold + WALCL | OLS ja, Multi-OLS nein | 🟡 | gold-realyield-model.ts |
| 28 | WORK_VALUECHAIN_SECTOR_ROTATION.md | 9 Tasks | 1–3 ja, Rest offen | 🟡 | valuechain + withBackoff |

---

## 2. Bereits umgesetzt (✅)

- ANTIBIAS: `invertedDcf`, `calcImpliedGStar`, `test-inverted-dcf.ts`
- BTC_MINER: Section 13 + `test-miner-metrics.ts` + `test-puell-multiple.ts`
- NEWS_SENTIMENT: Keyword schlägt LLM bei Vorzeichenkonflikt
- PEER_ROIC: `sanitizeRoic`, null nicht 0
- PORTFOLIO F.2: Sharpe/Kelly/A/B/C, `/#/portfolio`
- BUTTONS_APPLY + SECTOR_ADD + RESEARCHER_PORTFOLIO: TickerAddButtons in Screener/Capex/Sectors/Briefing
- TEIL0-6 Kern

## 3. Teilweise (🟡) — gleiche Namen, andere Regeln

- TAM: `weightedTAM = Σ tamSize * share/100` existiert; Quality-Tor / kein Konzern-Fallback / DCF-g-Gate fehlen
- SECTION4: Trailing PEG = PE_TTM / g_5Y; FCF $0 offen
- REVERSE_DCF_BRIDGE: Modul + Tests, `registerAnalyzeRoute` ruft es nicht
- LYNCH: Klassifikation ja, Default-Matrix g1/g2/WACC-Add-on nein
- BIAS §16: GBM Einzeltitel ja; BL + Cholesky-Portfolio-MC nein
- SCORING: Gates + Lookahead ja; Signal-Backtest nein
- TEIL7: Realzins-OLS ja; log(WALCL)+DXY nein
- VALUECHAIN: Nodes/Backoff/Farben ja; Selector/Edges/Live-Capex nein
- DATA_PROVIDERS: 5Y dokumentiert, kein Zweitprovider
- WORK2: Gate MSFT 88→65 wenn Cache warm; sonst lazy leer
- SEGMENT_DEDUP: exakter Key-Filter; AWS ≠ Amazon Web Services überlebt

## 4. Offen (⬜)

PORTFOLIO_BACKTEST, SIGNAL_BACKTEST, SEKTORROTATIONS_RAT, LIQUIDITY_REGIME, STABLECOIN_TBILL_GENIUS, TAM_RESIDUAL_XBOX (Addendum).

## 5. Formeln Soll/Ist

Trailing PEG (ist = Soll): `PEG = PE_TTM / EPS_Growth_5Y_%`  
BN-Repro: 88,3 / 10,9 ≈ 8,1 (nicht 0,04).

Portfolio Soll: `w_i = min(0,30, tilt_i)`, κ=0,35, δ=0,25.

TAM Ist: `weightedTAM = Σ tamSize_s * (share_s/100)`.

TAM Soll Quality: DCF-g Segment nur wenn `quality=ok`. Residuum genau 1 Loch: Mix 2,5 % / MSFT $8,3B. Xbox-YoY nicht aus 17,8 vs 21,3 invertierbar → n/a.

ROIC: `sanitizeRoic = null` wenn `|pct| > CAP`.

Sentiment: Keyword vs LLM, Konflikt → Keyword.

Gold Phase 2 Soll: `log P = α + β1 Real10Y + β2 log DXY + β3 log WALCL`; Vorzeichen β1,β2 < 0, β3 > 0.

## 6. Doku-Widersprüche

1. BACKLOG 05.08. Portfolio-UI ⬜ — Code und Future_Work 19.08. sind weiter.  
2. WORK.md Index ≠ Fertigstatus.  
3. SECTOR_ADD Spec „Buttons fehlen“ — Code hat sie.  
4. matchSegmentTAM Name gleich, Regeln der 28.08-Spec nicht implementiert.

Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md` für Tickets.
