# WORK_IMPLEMENTIERUNG_OFFEN.md — Tickets für den aktuellen Gap

> Stand 29.08.2026 · Basis HEAD `d9760fc` · Companion `WORK_IST_VS_SOLL.md`  
> Root-`WORK.md` unverändert (Index).  
> Portfolio hat **keine** Server-Route. Analyze = `POST /api/analyze` in `server/analyze-route.ts`.

## Sprint

```
A P0  TAM-Quality + Xbox-Residuum + FCF=0 + Segment-Alias-Dedup   -- DONE 30.08.2026 (d277527/dc2bc64/c484b3e/d18ac4a)
B P1  OHLCV-10Y-Fallback → Portfolio-Backtest → PIT-Signal-Backtest  -- IN ARBEIT
C P1  Sektorradar + Liquidity WALCL/RRP/TGA
D P2  Lynch-Matrix, BL+Portfolio-MC, Fiscal-Wiring, Valuechain-Rest, GENIUS, Gold Multi-OLS
```

## Betroffene Routen

| Ticket | Route / Datei |
|--------|----------------|
| A1/A2 TAM | `POST /api/analyze` → `generateTAMAnalysis` (`server/sector-data.ts`), UI `Section7.tsx` |
| A3 FCF=0 | dieselbe Route, `financials.cashflow[0]`, Felder `fcfTTM` / `fcfMargin` |
| A4 Dedup-Rest | dieselbe Route nach `dedupeSegmentsByName` / `geoWithoutOverlap` |
| B1 OHLCV | `fmpHistoricalPrices` + neuer Fallback; Cap 2600 in analyze-route |
| B2 Backtest | neu `client/src/lib/portfolio/backtest.ts`; optional spaeter `POST /api/portfolio/backtest`; Page `/#/portfolio` |
| B3 Signal-BT | neu Script/Route; Input = historische Scoring-Outputs |
| C1 Radar | neu `GET/POST /api/researcher/rotation` + Tab; Sectors bleibt Megatrend-LLM |
| C2 Liquidity | `POST /api/researcher/macro` erweitern oder `/api/researcher/liquidity`; Cache-Key versionieren (`macro_v2__US`), TTL 6h |
| D3 Fiscal | Hook in `registerAnalyzeRoute` **vor** DCF; Modul `server/fiscal-bridge.ts` existiert |
| D5 Gold | `/api/analyze-gold` + `gold-realyield-model.ts` TODO Z. 541 |
| Miner | `GET/POST /api/btc-miner` nicht anfassen |

Researcher-Cache: `.cache/researcher/{tab}__{params}.json` + `diskResearcherSet`.

---

## A1 Segment-TAM Quality-Tor

Spec: `WORK_TAM_SEGMENT_MAPPING.md`  
Dateien: `server/sector-data.ts` (`matchSegmentTAM`, `generateTAMAnalysis`), `Section7.tsx`, DCF-Pfad in `analyze-route.ts` / `calculations.ts`, Test `script/test-tam-segment-mapping.ts`.

Acceptance:
- kein Konzern-desc-Fallback auf jedes Segment
- Aliase 365 / Xbox / LinkedIn / Dynamics
- `quality = ok|weak|unreliable` aus Coverage, Labels, Share>25%
- unreliable ⇒ tamTotal null, DCF bleibt Konzern-g + Reverse DCF
- kein LLM im Hot Path

## A2 Residuum + Xbox-YoY

Spec: `WORK_TAM_RESIDUAL_XBOX.md`

```
genau 1 Loch: residualMix = 2,5 %, residualRev = Konzernumsatz * 0,025  (MSFT $8,3B)
Xbox-YoY aus 17,8 vs 21,3 nicht invertierbar → n/a (nicht 0, nicht negativ)
```

## A3 P0 FCF = $0

Spec: `WORK_SECTION4_DATA_BUGS.md` Item 1  
Ist: `fcfTTM = OCF - capex` in analyze-route; 0 wird als 0 angezeigt.  
Soll: `freeCashFlow` Statement → sonst OCF-Capex → sonst **n/a**, nie stilles $0.  
PEG-Fix Commit `9df4055` nicht anfassen.

## A4 Segment-Dedup Rest

Ist: `dedupeSegmentsByName` (`fmp.ts`) + `geoWithoutOverlap` (alphanumerischer Key).  
Fehlt: Alias AWS ↔ Amazon Web Services. Dateien: `fmp.ts`, `analyze-route.ts`. Test AMZN.

## B1 OHLCV > 5Y

FMP Free = 5Y. Fallback ein Provider (Yahoo/Stooq/Tiingo/Polygon). Flag `source` + `firstDate` in Chart.

## B2 Portfolio-Backtest

Neu: `client/src/lib/portfolio/backtest.ts`, `script/test-portfolio-backtest.ts`, Block in `PortfolioOverview.tsx`.  
n ≥ 20 gemeinsame Tage sonst `insufficient_data`. Gewicht(t) nur Info ≤ t. Default-Benchmark SPY.

## B3 PIT Signal-Backtest

Spec `WORK_SIGNAL_BACKTEST.md`. Nicht mit B2 verwechseln. n Avoid/Fold < 80 ⇒ insufficient_data.

## C1 Sektorradar

Spec `WORK_SEKTORROTATIONS_RAT.md`. Nicht neu bauen: Valuechain Nodes/Backoff. Neu: ETF-Proxy-Map, RS-Rating, Subtab Rotation.

## C2 Liquidity-Regime

Spec `WORK_RESEARCHER_LIQUIDITY_REGIME.md`. Serien FRED WALCL, RRP, TGA. Dateien: `researcher.ts` oder `liquidity-regime.ts` + `MacroPanel.tsx`.

## D1 Lynch-DCF-Matrix

`lynchClass` existiert. Defaults g1/g2/terminal/Haircut/WACC-Add-on je Klasse in `calculations.ts` + Section 5. g* bleibt eigene Schicht.

## D2 BL + Portfolio-MC

```
μ_BL = π + τΣP'(PτΣP' + Ω)^{-1}(Q - Pπ)
Pfade: Cholesky(Σ) * GBM, nicht n unabhängige Sims
```

`covariance.ts` + neues `portfolioMc.ts`.

## D3 Fiscal-Bridge verdrahten

`server/fiscal-bridge.ts` + `test-fiscal-bridge.ts` / `test-fiscal-dcf.ts` grün. In `registerAnalyzeRoute` einhaengen. g* invariant.

## D4 Stablecoin / GENIUS

Spec `WORK_STABLECOIN_TBILL_GENIUS.md`. Score 0 / 1 / 1,5. Nicht im Analyze-Hot-Path hardcoden.

## D5 Gold Multi-OLS

TODO in `gold-realyield-model.ts`: WALCL LOCF, DXY DTWEXBGS, Vorzeichen β1<0 β2<0 β3>0.

## D6 Valuechain Rest

Offen Rang 4–7+9 der Spec. Tasks 1–3 nicht wiederholen.

## Nicht nochmal bauen

Portfolio F.2, P1/P2/P3 Buttons, News-Sentiment-Override, sanitizeRoic, Trailing-PEG-Box, Miner Section 13, Scoring-Gates-Kern, invertedDcf, Einzeltitel-GBM.

## DoD

1. Acceptance in Ursprungs-WORK auf [x] oder Abweichung notieren  
2. `script/test-*.ts` grün  
3. Ampel in `WORK_IST_VS_SOLL.md` ziehen  
4. BACKLOG Portfolio-UI nicht wieder öffnen
