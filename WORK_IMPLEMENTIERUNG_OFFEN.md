# WORK_IMPLEMENTIERUNG_OFFEN.md — Tickets für den aktuellen Gap

> Stand 30.08.2026 · HEAD `9aa6f9a` (C1 P0+P1 squash PR #40) · Companion `WORK_IST_VS_SOLL.md`
> Root-`WORK.md` unverändert (Index).
> Portfolio hat **keine** Server-Route. Analyze = `POST /api/analyze` in `server/analyze-route.ts`.

## Sprint

```
A P0  TAM-Quality + Xbox-Residuum + FCF=0 + Segment-Alias-Dedup   -- DONE 30.08.2026 (d277527/dc2bc64/c484b3e/d18ac4a)
B P1  OHLCV-10Y-Fallback → Portfolio-Backtest → PIT-Signal-Backtest  -- DONE 30.08.2026
C1 P1 Sektorradar P0+P1 (Engine+Route+Tabelle)  -- DONE 30.08.2026 (9aa6f9a, PR #40)
C2 P1 Liquidity WALCL/RRP/TGA  -- IN ARBEIT (feat/c2-liquidity-regime)
C1 P2/P3 Donut + Zyklus-Karten  -- nach C2, nicht parallel
D P2  D3 Fiscal-Hook → D1 Lynch → D5 Gold → D4 GENIUS → D2 BL+MC → D6 Valuechain-Rest
```

Nicht anfassen: Miner, PEG, inverted DCF, Sentiment, Portfolio F.2.

## Betroffene Routen

| Ticket | Route / Datei |
|--------|----------------|
| A1/A2 TAM | `POST /api/analyze` → `generateTAMAnalysis` (`server/sector-data.ts`), UI `Section7.tsx` |
| A3 FCF=0 | dieselbe Route, `financials.cashflow[0]`, Felder `fcfTTM` / `fcfMargin` |
| A4 Dedup-Rest | dieselbe Route nach `dedupeSegmentsByName` / `geoWithoutOverlap` |
| B1 OHLCV | `fmpHistoricalPrices` + Yahoo/Stooq Fallback; Cap 2600 |
| B2 Backtest | `client/src/lib/portfolio/backtest.ts`; Page `/#/portfolio` |
| B3 Signal-BT | `server/backtest/*` Phase 0–6 |
| C1 Radar | **live** `GET /api/researcher/sector-rotation` (additiv, `researcher.ts` unberührt) |
| C2 Liquidity | `GET /api/researcher/liquidity`; Cache-Key `macro_v2__US`, TTL 6h; `liquidity-regime.ts` |
| D3 Fiscal | Hook in `registerAnalyzeRoute` **vor** DCF; Modul `server/fiscal-bridge.ts` existiert |
| D5 Gold | `/api/analyze-gold` + `gold-realyield-model.ts` TODO Z. 541 |
| Miner | `GET/POST /api/btc-miner` nicht anfassen |

Researcher-Cache: `.cache/researcher/{tab}__{params}.json` + `diskResearcherSet`.

---

## A1–A4 / B1–B3 / C1 P0+P1 — done

Acceptance in den Ursprungs-WORK bzw. Ampel `WORK_IST_VS_SOLL.md`. C1: `server/sector-rotation*.ts` + `researcher-sector-rotation-route.ts`. PR #39 Draft geschlossen, nicht mergen.

## C2 Liquidity-Regime

Spec `WORK_RESEARCHER_LIQUIDITY_REGIME.md`. Serien FRED **WALCL, RRPONTSYD, WTREGEN (TGA)**. Dateien: neues `liquidity-regime.ts` (split ok), Route additiv über `routes-register.ts`, Panel analog MacroPanel. **`researcher.ts` nicht umschreiben.** `/api/health` unberührt.

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
