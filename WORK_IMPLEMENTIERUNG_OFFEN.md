# WORK_IMPLEMENTIERUNG_OFFEN.md — Tickets für den aktuellen Gap

> Stand 05.10.2026 · HEAD `191792c5b09e67658641d49fc73991df14be3bbc` (#169 Docs-Renames; Doublecheck GO) · Companion `WORK_IST_VS_SOLL.md`
> Keep-Alive CI rot auf main (leeres `RENDER_URL`) ist bekannt und kein Ampel-ROT für diesen Tip. Kein Live-Deploy aus den Renames.
> Index-Hinweis in `WORK.md`. Sprint-Log unten bleibt historisch (01.09.). `Future_Work.md` = Roadmap, kein Ticket.
> Portfolio hat **keine** Server-Route. Analyze = `POST /api/analyze`.
> **Ampel 05.10.2026:** D6 Rang 7–9 Dateiname ist `fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md` (#169). Code (xyflow, Redis optional) nicht neu bauen; Live-Deploy dieses Rangs nicht behauptet. Sahm bleibt `Offen_WORK_RECESSION_FRED_SAHM.md` (US-Karte `SAHMREALTIME` + s(z); letzte-12-DoD ±0.02 nicht erfüllt; EZ `une_rt_m` und JP `LRUNTTTTJPM156S` fehlen).
> **Ampel 30.09. Vormittag, nach #103 Miner Observability Live PASS:** #103 Miner Observability Live ✅ (tip `e2bc69a2`; Codes `MEMPOOL_HTTP`/`MEMPOOL_TIMEOUT`/`MEMPOOL_NETWORK`/`INSUFFICIENT_HASHRATE`/`PARSE`/`UNKNOWN`; 1× Retry transient 400ms; Stale-Cache-on-Error → 200 + `stale:true` wenn Prior-Success, sonst 503 mit `error`+`code`(+`cause`); Dateien `server/btc-miner.ts`, `server/routes.ts` (+`minerUnavailableBody`), `script/test-btc-miner-observability.ts` 43/43; UI `Section13Miner` unverändert; Soft-Note: Live Soft-Probe `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = Render→mempool Egress, kein fehlender/gelöschter Code; Kernformeln Breakeven/Puell/Hash Ribbons unberührt) · #99 TA Spec v3.2 Live ✅ (`4c615eb3` → stack tip `c365c945`; Bundle `index-MIF1Ml5X.js`; Default nur Kurs A; A+B gestapelte Bänder/Y; MACD/RSI unter A und B; Desktop-Controls ok, Mobile soft-skip; Shots `/workspace/dod-99-ta-v32/`) · #100 KI-N/A matrix (Relativ Bewertung / Section7) Live ✅ (tip `c365c945`; Spalten Segment|Rev.|Anteil|Wachstum|TAM|CAGR|Anteil am TAM|vs.TAM; Idle-Button exakt „N/A mit KI schätzen“; fail-closed UI: Fill → „KI-Schätzung unvollständig — nichts übernommen“, kein Overlay/Badge, N/A unverändert; Soft: Success-Badge `KI ✓` in Dual-DoD nicht geübt; Soft-Note API: Body `{}` → HTTP 400 `BAD_REQUEST` „Keine N/A-Zellen“ — erwartet, keine Segments/keine N/A; 422 `INCOMPLETE_FILL` nur nach LLM mit Rest-n/a ≠ 0; Shots+Probe `/workspace/dod-100-ki-na/`) · #93 KI-N/A-Fill Segment-TAM ✅ Label cleared (Idle-Label Spec „N/A mit KI schätzen“ via #100; Behavior+API PASS @ `7574b12d`; Soft: violet KI-Badge Success-Pfad nicht in Dual-DoD geübt) · #97 TA Kurs A/B/C Spec v3.1 Live ✅ bleibt (superseded by v3.2 live on same chart stack; `249841ab`; Bundle `index-C_rUCqgy.js`; 3 An/Aus Kurs A/B/C; Default nur A; ≥2 an → versetzte Bänder via `yDomainFromCloses` / `chart-price-bands`; `closeB` entfernt; absolute-Y / closeB-Overlap = FAIL; DoD AAPL Shots `/workspace/dod-97-ta-kurs/`) · #92 TA Zwei-Fenster Live ✅ (`c06c835e` → Fix `1dc82683` #94; Bundle `index-JP8muGsY.js`; A close/primary/1.5 unverfärbt; closeB `#a78bfa` strokeWidth 2.5 `connectNulls=false`; Eye off = nur A; 3 normale Kurs-Plots unberührt; Zwei-Fenster Extra An/Aus; Soft Draw-Order B-unter OK) · #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün · #90 TAM Coverage-Lift ✅ · #70 Dual-Line ✅ · #72 Badges ✅ · #73 Lab ✅ · #69 Exec ✅ (FMP Premium) · Peer/ROIC intact (≡ `4bdc1f8`) · #74 Batch A ✅ · #75/#76/#77 Live ✅ · #81–#83 ✅ · #84 Sharpe / #85 Attribution ✅ · #86 Tooltip / #88 Pie+360px ✅ · #87 🟡 PARTIAL (healthy 251d, thin-Banner nicht repro) · #71 4-Toggles 🟡 (Chart oft leer; Honesty #74).
> **Queue:** #103 Miner Observability Live ✅ tip `e2bc69a2` (Bundle `index-MIF1Ml5X.js` unverändert, server-only; Soft: Live `POST /api/btc-miner` → 503 `code=MEMPOOL_NETWORK` `cause=fetch failed` = Render→mempool Egress, kein Code-Delete; Kernformeln unberührt) · #99+#100 Live ✅ (parent stack `58bec00c` #101 Docs ← `c365c945`) · Batch A done (`e8ebd35c`) · TAM Coverage-Lift done ✅ (#90, `ee5f0f8b`) · Ökosystem-Scoring Folge-Lane. Ziel+z-Treiber sind auf main (`fertig_WORK_RECESSION_2008_DRIVERS_LLM.md`). Gated: Liquidity-Bundle. Rang 7–9 Code, nicht neu bauen. #96 KI-Fill v2 closed ohne Merge — nicht reopen, nicht grün (vormals Draft Merge-Gate, Soft Apollo bis Philip GO; Label Soft #93 ist via #100 Live ✅, nicht über #96).

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

Rang 7–9 Valuechain (xyflow Custom Edges / Animation / optionales Redis) ist im Code. `@xyflow/react` ist freigegeben. CSS-Karten bleiben. Redis nur mit URL, sonst In-Process. Nicht neu bauen. Kupfer-Downstream-Gate bleibt ein ehrlicher Fail.

`Future_Work.md` = Roadmap, kein Ticket.

Nicht anfassen: Miner-Kernformeln (Breakeven/Puell/Hash Ribbons/`classifyMinerZone` — Observability #103 ist live, Formeln unberührt), PEG, inverted DCF, Sentiment, Portfolio F.2.

## Betroffene Routen (live)

| Ticket | Route / Datei |
|--------|----------------|
| C1 Radar | `GET /api/researcher/sector-rotation` — Tabelle + Donut/Ring + Zyklus |
| C2 Liquidity | `GET /api/researcher/liquidity` — Cache `macro_v2__US`, TTL 6h |
| D3 Fiscal | Hook in `registerAnalyzeRoute` vor DCF — `fiscal-bridge.ts` |
| D4 GENIUS | `GET /api/analyze-btc/stablecoin-liquidity` |
| D5 Gold | `GET /api/analyze-gold` Multi-Faktor optional |
| D6 Valuechain | `GET /api/valuechain`, `POST /api/valuechain/enrich` |
| Miner | `GET/POST /api/btc-miner` — Observability live (#103 `e2bc69a2`); Kernformeln nicht anfassen. Soft: 503 `MEMPOOL_NETWORK` = Render→mempool Egress |

Researcher-Cache: `.cache/researcher/{tab}__{params}.json` + `diskResearcherSet`.

---

## P1.1 WORK2 Regulatory/PESTEL — DONE

SHA `c83e543` (PR #43). `derivePestelRisks` + Disk 24h + `GET /api/regulatory/cached/:ticker`. Gate nicht neu bauen.

## P1.2 Portfolio Teil 2 — δ/Cap/HHI — DONE

SHA `d6b41b3` (PR #44). Fixture Q: HHI 0.28, Effective-N ≈ 3.57, δ=0.25 bei n=4, weightMarket-Summe=1. UI lag schon auf main. F.2 nicht aufmachen.

## P1.3 Scoring-Vorlage — Lookahead — DONE

SHA `9215cee` (PR #45). Fixture AI qualifies=false, NATO DCF 65→75, PP/SHARE hart. Pipeline `scoring-gates.ts` nicht neu bauen.

## D6 Rang 7–9 (Code)

Dateiname auf Tip `191792c5`: `fertig_WORK_VALUECHAIN_SECTOR_ROTATION.md` (#169 Docs-Rename). Custom Edges, Animation und optionales Redis liegen auf dem Stufenfluss (`@xyflow/react`) über den CSS-Karten. Ohne Redis-URL bleibt das In-Process-Limit. Kupfer-Downstream-Gate (Phase 1) ehrlich fehlgeschlagen — kein Fake-Fill. Live-Deploy dieses Rangs nicht behauptet. Sahm bleibt `Offen_WORK_RECESSION_FRED_SAHM.md`.

## Nicht nochmal bauen

C2, C1 P2/P3, Valuechain Phase 1–2, P1.1–P1.3, Portfolio F.2, P1/P2/P3 Buttons, News-Sentiment-Override, sanitizeRoic, Trailing-PEG-Box, Miner Section 13, Scoring-Gates-Kern, invertedDcf, Einzeltitel-GBM, D1–D5.

## DoD

1. Acceptance in Ursprungs-WORK auf [x] oder Abweichung notieren
2. `script/test-*.ts` grün
3. Ampel in `WORK_IST_VS_SOLL.md` ziehen
4. BACKLOG Portfolio-UI nicht wieder öffnen
