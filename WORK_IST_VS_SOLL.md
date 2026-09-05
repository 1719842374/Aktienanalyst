# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 05.09.2026 23:10 CEST  
> **Repo:** `1719842374/Aktienanalyst`  
> **HEAD:** `68327f5` (Doc-Hub `docs/Doc_Soll_vs_Ist/` Stand 05.09. 12:20 CEST)  
> **Regel:** Ist nur aus Code + UI. ✅ erwartete Anzeige live · 🟡 Kern da, Spec-/UI-Zusatz fehlt · ⬜ Spec ohne Engine/UI.  
> **Quelle Nachzug:** Doc_Soll_vs_Ist/README (9⬜ + 4🟡) · Companion `WORK_IMPLEMENTIERUNG_OFFEN.md`  
> **tsc-Baseline:** 97 Fehler (unverändert).

---

## 0. Zahlen / Fakten

| Kennzahl | Wert |
|----------|------|
| WORK-Dateien Root (Feature, ohne Index) | **~45+** (gewachsen seit 01.09.) |
| Analyze-Cache TTL | **L1 20 min RAM + L2 7 d SQLite** |
| Researcher-Cache TTL | **6 h** + SQLite (Liquidity 6h, Value-Chain 18-24h) |
| Disk-Schema | `2026-08-29-v2` |
| OHLCV Cap in Analyze | **2600** |

Scoreboard Feature-Docs (ohne Index `WORK.md`; Ampel nach Doc-Hub + Code-Check):

| Ampel | Bedeutung |
|-------|-----------|
| ✅ | Kern + erwartete UI live |
| 🟡 | Engine/Partial da, Wire oder Spec-Zusatz fehlt · oder Rang 7–9 geblockt |
| ⬜ | Spec ohne Engine/UI |

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
| GET | `/api/analyze-recession/markets` | RAM 6h (RSI/MACD Charts seit `52ed940`) |
| GET | `/api/health` | unberührt |

Kein Portfolio-Backend — `/#/portfolio` ist `localStorage`. D2 client-seitig.

---

## 1. Mastertabelle Soll vs. Ist

### 1a. Kern (weiterhin ✅)

| # | Datei | Soll | Ist | Ampel | Code |
|---|-------|------|-----|-------|------|
| 1 | WORK.md | Index | Navigation + Cache-Docs | 📄 | Root |
| 1b | WORK_ANALYZE_DISK_CACHE.md | 7d KI-Catch | L2-Schicht + Patch | ✅ | disk-cache |
| 1c | WORK_IMPLEMENTIERUNG_ANALYZE_CACHE.md | Wiring | disk-cache live | ✅ | |
| 2 | WORK2.md | Regulatory/PESTEL | PESTEL-Risks live | ✅ | regulatory.ts (`c83e543`) |
| 3 | WORK_ANTIBIAS_DCF.md | eine Schicht, g* | ja | ✅ | invertedDcf |
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | BL, Cholesky-MC | ✅ | blackLitterman.ts (`08e8938`) |
| 5 | WORK_BTC_MINER.md | Hash Ribbons/Puell | ja | ✅ | btc-miner.ts · **nicht neu anfassen** |
| 6 | WORK_DATA_PROVIDERS.md | 5Y + Alternative | FMP + Yahoo/Stooq | ✅ | history-fallback.ts |
| 7 | WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults | 6 Klassen | ✅ | lynch-dcf-defaults.ts |
| 8 | WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | · **nicht neu anfassen** |
| 9 | WORK_PEER_ROIC_SANITY.md | LITB kappen | sanitizeRoic | ✅ | news-peers.ts |
| 10 | WORK_PORTFOLIO.md | F.2 + CAPM sichtbar | F.2 + Kelly + **E[r]-KPI CAPM live** (`0021be6`/`32133b4`) | ✅ | Doc-Hub 05.09. noch 🟡 CAPM — Code korrigiert |
| 12 | WORK_RESEARCHER_BUTTONS_APPLY.md | Phase-2 Buttons | verdrahtet | ✅ | |
| 13 | WORK_RESEARCHER_LIQUIDITY_REGIME.md | WALCL/RRP/TGA | GET `/api/researcher/liquidity` | ✅ | C2 `f0931d86` |
| 14 | WORK_RESEARCHER_PORTFOLIO.md | P1/P2/P3 | ja | ✅ | |
| 15 | WORK_RESEARCHER_PORTFOLIO_TEIL2.md | δ/Cap/HHI | Fixture Q | ✅ | `d6b41b3` |
| 16 | WORK_RESEARCHER_SECTOR_ADD.md | Add-Buttons | ja | ✅ | |
| 17 | WORK_REVERSE_DCF_BRIDGE.md | Fiscal in DCF | Hook live | ✅ | fiscal-bridge · inverted Kern **nicht anfassen** |
| 18 | WORK_SCORING_VORLAGE.md | Gates + Lookahead | Pipeline + Fixture | ✅ | `9215cee` |
| 19 | WORK_SECTION4_DATA_BUGS.md | PEG + FCF | PEG+FCF | ✅ | PEG **nicht neu anfassen** |
| 20 | WORK_SEGMENT_DEDUP.md | Cross-Dedup | ja | ✅ | |
| 21 | WORK_SEKTORROTATIONS_RAT.md | Radar P0–P3 | live inkl. Layout #49–#51 | ✅ | |
| 22 | WORK_SIGNAL_BACKTEST.md | PIT | Phase 0–6 | ✅ | |
| 23 | WORK_STABLECOIN_TBILL_GENIUS.md | Stablecoin | DefiLlama live | ✅ | |
| 24 | WORK_TAM_RESIDUAL_XBOX.md | Residuum | ja | ✅ | |
| 25 | WORK_TAM_SEGMENT_MAPPING.md | Quality-Tor | ja | ✅ | |
| 26 | WORK_TEIL0-6.md | Platform/BTC/FMP | Kern | ✅ | |
| 27 | WORK_TEIL7_SCORING.md | Gold + WALCL | Multi-OLS | ✅ | |

### 1b. Neu aus Doc-Hub (05.09.) — 🟡 / ⬜

| # | Datei | Soll | Ist | Ampel |
|---|-------|------|-----|-------|
| 28 | WORK_VALUECHAIN_SECTOR_ROTATION.md | Rang 1–9 | 1–6 + Phase 1–2 live; **Rang 7–9** xyflow | 🟡 blockiert |
| 29 | WORK_PORTFOLIO_BACKTEST.md | Equity α/β/IR Underwater | Panel da, leer ohne Position+OHLCV; Rest-DoD | 🟡 |
| 30 | WORK_RECESSION_RSI_MACD.md | RSI+MACD+Div in `#/recession` | Engine+GET+Panel da; **Dashboard-Import / VIX/PEG offen** | 🟡 |
| 31 | WORK_EXEC_SUMMARY.md | Karte über S1 | Analyze startet bei S1; keine Exec-Karte | ⬜ |
| 32 | WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md | Katalog + Fetch | nur Markdown | ⬜ |
| 33 | WORK_FISCAL_FRONTEND_ADAPTIVE.md | s(z), kein Kalender | noch `BESSENT_WINDOW` | ⬜ |
| 34 | WORK_RESEARCHER_LIQUIDITY_INDEX.md | LI US/EU/ASIA | C2 nur US | ⬜ |
| 35 | WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md | Buch M/F EZ/JP | kein Katalog | ⬜ |
| 36 | WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md | r, V, π, T½ | Spec; M2V-Teil | ⬜ |
| 37 | WORK_RESEARCHER_BRIEFING_REGIONAL.md | 3 Regionen + Spillover | ein Prompt, US-lastig | ⬜ |
| 38 | WORK_RECESSION_MARKET_CHARTS.md | VIX-Pane + PEG-Click + FINRA | nur Spec | ⬜ |
| 39 | WORK_RECESSION_2008_DRIVERS_LLM.md | s(z)+OpenRouter-Driver | Kurve live; **Hormuz hardcodiert** | ⬜ |
| 40 | WORK_RECESSION_FRED_SAHM.md | adaptive FRED + Sahm s(z) | Spec | ⬜ |
| 41 | WORK_RECESSION_RATE_OIL_BRIDGE.md | Zins-Brücke + Öl | Spec | ⬜ |
| 42 | WORK_RECESSION_SOURCES.md | Quellenkatalog | Spec | ⬜ |
| 43 | WORK_PEER_ADAPTIVE.md | 2-Hop+Industry | Spec; Hardcode-Map lebt | ⬜ |
| 44 | WORK_PEER_PRICING_POWER.md | Relativ nur Low-Moat | Spec Companion | ⬜ |
| 45 | FactPack (`docs/.../FACTPACK_LLM.md`) | Validate+Hook | Validator da, Analyze-Hook fehlt | 🟡 |

---

## 2. Bereits umgesetzt (✅) — Kurz

- Sprint A/B, C1 (inkl. #49/#50/#51), C2, D1–D6c, Valuechain Phase 1–2 (Kupfer ehrlich rot).
- P1.1–P1.3: `c83e543` / `d6b41b3` / `9215cee`.
- CAPM E[r]-KPI auf Portfolio-Übersicht live.

**Nicht neu bauen / nicht anfassen:** Miner, PEG, inverted DCF, Sentiment, Portfolio F.2.

---

## 3. Offen 🟡 / ⬜ (workable, Rang 7–9 ausgenommen)

**🟡 Partial:** RSI/MACD Dashboard-Wire · Portfolio-Backtest Rest-DoD · FactPack-Hook · Valuechain Rang 7–9 (**blockiert**, `@xyflow/react`).

**⬜ Spec:** Exec-Summary UI · Hormuz/2008-Drivers · Regional LI + Books + Velocity + Data Sources · Fiscal Adaptive · Briefing regional · Market Charts · FRED/Sahm · Rate/Oil · Recession Sources · Peer Adaptive + Pricing-Power.

Reihenfolge sinnvoll: RSI-Wire → FactPack → Exec UI → Rezession-Rest → Liquidity-Bundle → Peer → Backtest-Rest.

---

## 4. Blockiert

- **D6 Rang 7–9** — Custom Edges / Animation / Redis. Nur nach Entscheidung `@xyflow/react`. CSS-Karten bleiben. **Kein workable Ticket.**

`Future_Work.md` = Roadmap, kein Ticket. Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md` und `docs/Doc_Soll_vs_Ist/`.
