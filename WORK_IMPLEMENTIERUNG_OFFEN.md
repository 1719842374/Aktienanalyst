# WORK_IMPLEMENTIERUNG_OFFEN.md — Tickets für den aktuellen Gap

> Stand 01.09.2026 · HEAD `9215cee` (P1.3 Scoring-Lookahead, PR #45) · Companion `WORK_IST_VS_SOLL.md`
> Root-`WORK.md` unverändert (Index). `Future_Work.md` = Roadmap, kein Ticket.
> Portfolio hat **keine** Server-Route. Analyze = `POST /api/analyze`.

## Sprint

```
A P0  TAM-Quality + Xbox-Residuum + FCF=0 + Segment-Alias-Dedup   -- DONE 30.08.2026
B P1  OHLCV-10Y-Fallback → Portfolio-Backtest → PIT-Signal-Backtest  -- DONE 30.08.2026
C1 P0+P1 Sektorradar Engine+Route+Tabelle  -- DONE 30.08.2026 (9aa6f9a, PR #40)
C2    Liquidity WALCL/RRP/TGA               -- DONE 30.08.2026 (f0931d86, PR #41)
C1 P2/P3 Donut + 3D-Ring + Zyklus-Karten   -- DONE 01.09.2026 (u. a. 480e98a / ce68d10 / ed71688)
D1–D6c Lynch, BL+MC, Fiscal-Hook, GENIUS, Gold Multi-OLS, Valuechain-Kern -- DONE 31.08.2026
Valuechain Phase 1–2 (GICS-Ketten)         -- DONE 01.09.2026 (4401ce6 / a02ad19)
P1.1 WORK2 TEIL 8 PESTEL-Risks             -- DONE 01.09.2026 (c83e543, PR #43)
P1.2 Portfolio TEIL2 Kapitel Q             -- DONE 01.09.2026 (d6b41b3, PR #44)
P1.3 Scoring Lookahead Kap. 17–18          -- DONE 01.09.2026 (9215cee, PR #45)
```

Nächste Lane: **keine sequentielle P1 mehr.** P1.1–P1.3 nicht neu bauen.

Rang 7–9 Valuechain (xyflow Custom Edges / Animation / Redis) **nicht starten** ohne Entscheidung: neue Dependency `@xyflow/react`.

`Future_Work.md` = Roadmap, kein Ticket.

Nicht anfassen: Miner, PEG, inverted DCF, Sentiment, Portfolio F.2.

## Betroffene Routen (live)

| Ticket | Route / Datei |
|--------|----------------|
| C1 Radar | `GET /api/researcher/sector-rotation` — Tabelle + Donut/Ring + Zyklus |
| C2 Liquidity | `GET /api/researcher/liquidity` — Cache `macro_v2__US`, TTL 6h |
| D3 Fiscal | Hook in `registerAnalyzeRoute` vor DCF — `fiscal-bridge.ts` |
| D4 GENIUS | `GET /api/analyze-btc/stablecoin-liquidity` |
| D5 Gold | `GET /api/analyze-gold` Multi-Faktor optional |
| D6 Valuechain | `GET /api/valuechain`, `POST /api/valuechain/enrich` |
| Miner | `GET/POST /api/btc-miner` nicht anfassen |

Researcher-Cache: `.cache/researcher/{tab}__{params}.json` + `diskResearcherSet`.

---

## P1.1 WORK2 Regulatory/PESTEL — DONE

SHA `c83e543` (PR #43). `derivePestelRisks` + Disk 24h + `GET /api/regulatory/cached/:ticker`. Gate nicht neu bauen.

## P1.2 Portfolio Teil 2 — δ/Cap/HHI — DONE

SHA `d6b41b3` (PR #44). Fixture Q: HHI 0.28, Effective-N ≈ 3.57, δ=0.25 bei n=4, weightMarket-Summe=1. UI lag schon auf main. F.2 nicht aufmachen.

## P1.3 Scoring-Vorlage — Lookahead — DONE

SHA `9215cee` (PR #45). Fixture AI qualifies=false, NATO DCF 65→75, PP/SHARE hart. Pipeline `scoring-gates.ts` nicht neu bauen.

## D6 Rang 7–9 (geblockt)

Custom Edges / Animation / Redis. Würde `@xyflow/react` brauchen. CSS-Karten-Layout ist der bewusste Ersatz. Kupfer-Downstream-Gate (Phase 1) ehrlich fehlgeschlagen — kein Fake-Fill.

## Nicht nochmal bauen

C2, C1 P2/P3, Valuechain Phase 1–2, P1.1–P1.3, Portfolio F.2, P1/P2/P3 Buttons, News-Sentiment-Override, sanitizeRoic, Trailing-PEG-Box, Miner Section 13, Scoring-Gates-Kern, invertedDcf, Einzeltitel-GBM, D1–D5.

## DoD

1. Acceptance in Ursprungs-WORK auf [x] oder Abweichung notieren
2. `script/test-*.ts` grün
3. Ampel in `WORK_IST_VS_SOLL.md` ziehen
4. BACKLOG Portfolio-UI nicht wieder öffnen
