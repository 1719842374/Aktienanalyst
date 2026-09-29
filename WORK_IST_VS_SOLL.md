# WORK_IST_VS_SOLL.md — Code vs. WORK-Specs

> **Stand Audit:** 29.09.2026 (Abend)  
> **Repo:** `1719842374/Aktienanalyst`  
> **HEAD:** `f0046ee9` (#88 Selektierte Aktien über Performance, Chart 360px)  
> **Regel:** Ist nur aus Code + UI. ✅ erwartete Anzeige live · 🟡 Kern da, Spec-/UI-Zusatz fehlt · ⬜ Spec ohne Engine/UI.  
> **Quelle Nachzug:** Doc_Soll_vs_Ist/README · Companion `WORK_IMPLEMENTIERUNG_OFFEN.md`  
> **Delta 29.09. Abend (#74–#88):** #74 Batch A Live ✅ (Fake-OK `bars=[]` source:fmp fixed) · #75 Ökosystem / #76 DCF Markt-β / #77 Makro §15 Live ✅ nach Deploy · #81 Porter Prompt · #82 Exec-Boxen · #83 Fenster-Zonen · #84 Sharpe · #85 Attribution · #86 Tooltip · #88 Pie/360px Live ✅ · #87 thin-series Code ✅ Live 🟡 PARTIAL (healthy 251d OK, thin-Banner nicht repro) · #71 4-Toggles weiter 🟡 · BL §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3. Hub war 29.09. / `d517611` (#78).  
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
| GET | `/api/analyze-recession/markets` | RAM 6h (RSI/MACD + Vol-Pane; EU VSTOXX live `#66`) |
| GET | `/api/ohlcv` | 24h Cache, max 12 Tickers (`#61` portfolio §6) |
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
| 4 | WORK_BIAS_FIXES_INVERSE_DCF.md | BL + Portfolio-MC | Tabelle Π / E[R]_BL + MC-Cards (kein Scatter/Chart-Soll); Frontier ≥3 Ticker; Cholesky-MC | ✅ | blackLitterman.ts (`08e8938`) |
| 5 | WORK_BTC_MINER.md | Hash Ribbons/Puell | ja | ✅ | btc-miner.ts · **nicht neu anfassen** |
| 6 | WORK_DATA_PROVIDERS.md | 5Y + Alternative | FMP + Yahoo/Stooq | ✅ | history-fallback.ts |
| 7 | WORK_LYNCH_DCF_PARAMS_AND_GSTAR.md | Klassen-Defaults | 6 Klassen | ✅ | lynch-dcf-defaults.ts |
| 8 | WORK_NEWS_SENTIMENT.md | keine −100-False-Negatives | Keyword-Override | ✅ | · **nicht neu anfassen** |
| 9 | WORK_PEER_ROIC_SANITY.md | LITB kappen | sanitizeRoic · Tip ≡ `4bdc1f8` (kein Delete) · Live wieder da nach FMP Premium | ✅ | news-peers.ts |
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

### 1b. Nachzug Doc-Hub (13.09.) — ✅ / 🟡 / ⬜

| # | Datei | Soll | Ist | Ampel |
|---|-------|------|-----|-------|
| 28 | WORK_VALUECHAIN_SECTOR_ROTATION.md | Rang 1–9 | 1–6 + Phase 1–2 live; **Rang 7–9** xyflow | 🟡 blockiert |
| 29 | WORK_PORTFOLIO_BACKTEST.md | Equity α/β/IR Underwater | Panel da; braucht Position+OHLCV; Rest-DoD | 🟡 |
| 29b | WORK.md_portfolio_3 §6 | `GET /api/ohlcv` + Long-Map | Live PASS Tester AAPL 1Y/2Y @ `6a1807b` (`#61`). #74: Fake-OK `bars=[]` source:fmp fixed (Live ✅); Code §6 nicht gelöscht. Chart #71 oft weiter leer | ✅ |
| 30 | WORK_RECESSION_RSI_MACD.md | RSI+MACD+Div in `#/recession` | Dashboard-Wire + Pane live | ✅ |
| 31 | WORK_EXEC_SUMMARY.md | Karte über S1 | Exec-Karte live `#58`; `#69` Analyze Ampel+KI+FS Live PASS (XOM; FMP Premium aktiv) | ✅ |
| 32 | WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md | Katalog + Fetch | nur Markdown | ⬜ |
| 33 | WORK_FISCAL_FRONTEND_ADAPTIVE.md | s(z), kein Kalender | noch `BESSENT_WINDOW` | ⬜ |
| 34 | WORK_RESEARCHER_LIQUIDITY_INDEX.md | LI US/EU/ASIA | C2 nur US | ⬜ |
| 35 | WORK_LIQUIDITY_INDEX_REGIONAL_BOOKS.md | Buch M/F EZ/JP | kein Katalog | ⬜ |
| 36 | WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY.md | r, V, π, T½ | Spec; M2V-Teil | ⬜ |
| 37 | WORK_RESEARCHER_BRIEFING_REGIONAL.md | 3 Regionen + Spillover | ein Prompt, US-lastig | ⬜ |
| 38 | WORK_RECESSION_MARKET_CHARTS.md | VIX-Pane + PEG-Click + FINRA | Vol-Pane live US/EU/AS (`#60`/`#66`); PEG+FINRA offen | 🟡 |
| 39 | WORK_RECESSION_2008_DRIVERS_LLM.md | s(z)+OpenRouter-Driver | Hormuz-(A) weg `#59`; **`recession-drivers.ts` fehlt** (B) | 🟡 |
| 40 | WORK_RECESSION_FRED_SAHM.md | adaptive FRED + Sahm s(z) | Spec | ⬜ |
| 41 | WORK_RECESSION_RATE_OIL_BRIDGE.md | Zins-Brücke + Öl | Spec | ⬜ |
| 42 | WORK_RECESSION_SOURCES.md | Quellenkatalog | Spec | ⬜ |
| 43 | WORK_PEER_ADAPTIVE.md | 2-Hop+Industry | Spec; Hardcode-Map lebt | ⬜ |
| 44 | WORK_PEER_PRICING_POWER.md | Relativ nur Low-Moat | Spec Companion | ⬜ |
| 45 | FactPack (`docs/.../FACTPACK_LLM.md`) | Validate+Hook | Hook+UI live `#57` | ✅ |

### 1c. Nachzug 29.09. Abend — #70–#88

Ampel folgt dem Live-Stand: ✅ nur bei bestätigter Anzeige. Vormittag-Hub war `d517611` (#78); Tip `f0046ee9`.

| # | Item | Soll | Ist (Code / Live) | Ampel |
|---|------|------|-------------------|-------|
| #70 | Portfolio Dual-Line | `benchPct` vs Performance | Code ✅ `358681a` · Live ✅ | ✅ |
| #71 | Performance-Chart 4 Toggles | Ein/Aus + Bench-Kurs | Code ✅ `60aeeb2` · UI ok · OHLCV-Honesty #74 · Chart oft weiter leer | 🟡 |
| #72 | Dashboard-Badges 1–20 | Exec=1, FS=4, Tech=12 | Code ✅ `a7bfb15` · Live PASS Bundle `index-PW9HgI6J.js` @ `22d4af9`+ | ✅ |
| #73 | WORK_THESIS_LAB.md | `/#/lab` + 6 Fixtures | Code ✅ `22d4af9` · Live PASS `/#/lab` + 6 Fixtures | ✅ |
| #74 | Batch A (OHLCV honesty / Search / Error-UI / Recession) | Fake-OK `bars=[]` ehrlich | Code ✅ `e8ebd35c` · Live ✅ source:fmp fixed | ✅ |
| #75 | Moat Ökosystem-Chip | Chip nur bei `hasEcosystem` | Code ✅ `08d82b2` · Live ✅ nach Deploy | ✅ |
| #76 | DCF Default-β | Default = Markt-β (Sektor-Anker bleibt Modus) | Code ✅ `ef0f31e` · Live ✅ nach Deploy | ✅ |
| #77 | Makro-Korrelationsmatrix §15 | volle Matrix statt 4-Faktor-Stub | Code ✅ `d517611` · Live ✅ nach Deploy | ✅ |
| #81 | Porter Moat/Ökosystem Prompt (Option A) | Prompt-Kontext Moat + Ökosystem | Code ✅ `c6dc39d1` · Live ✅ Score-DoD PASS; Narrative via force+useLLM | ✅ |
| #82 | Exec Pro/Contra/Downside Boxen | 3 Boxen | Code ✅ `78c8521e` · Live ✅ Bundle H2cTedRt PASS | ✅ |
| #83 | Fenster-Rendite Zonen | green≥0 / red<0 + 0%-Linie | Code ✅ `8a7ee044` · Live ✅ Bundle C61GQzdr, dann Nachfolger | ✅ |
| #84 | Sharpe 5. KPI | 5. KPI-Card Overview | Code ✅ `32466b6c` · Live ✅ Bundle Jx0cX7cU; Sharpe=0.947 | ✅ |
| #85 | Attribution volle Historie | volle OHLCV-Historie vs Benchmark | Code ✅ `f6a6a398` · Live ✅ Re-DoD 251 common days AAPL+MSFT | ✅ |
| #86 | Fenster-Tooltip Kontrast | lesbare Tooltip-Zeile | Code ✅ `7e9279db` · Live ✅ Bundle `index-Ca0V7H2h.js`; Datum #0f172a, Fenster #10b981 | ✅ |
| #87 | thin-series Prävention | dünne Serie aus Backtest-Intersection | Code ✅ `2fb8b70a` · Live 🟡 PARTIAL: healthy 251d OK; thin-Banner nicht repro | 🟡 |
| #88 | Pie über Performance / Chart 360px | Selektierte Aktien über Performance, Chart 360px | Code ✅ `f0046ee9` · Live ✅ Bundle `index-Ca0V7H2h.js`; grid-cols-1, h-[360px] Performance | ✅ |

FMP Billing: Premium aktiv (Analyze 200). Peer/ROIC ≡ `4bdc1f8`. Exec #69 Live ✅. BL §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter; Frontier ≥3 Ticker.

---

## 2. Bereits umgesetzt (✅) — Kurz

- Sprint A/B, C1 (inkl. #49/#50/#51), C2, D1–D6c, Valuechain Phase 1–2 (Kupfer ehrlich rot).
- P1.1–P1.3: `c83e543` / `d6b41b3` / `9215cee`.
- CAPM E[r]-KPI auf Portfolio-Übersicht live.
- FactPack Hook+UI (`#57`), Exec-Summary UI (`#58`), VIX-Pane (`#60`), EU VSTOXX STOXX+CA (`#66` Live vol≈942).
- Portfolio `GET /api/ohlcv` (`#61`) — Live PASS Tester AAPL 1Y/2Y @ `6a1807b`. #74 Batch A Live ✅: Fake-OK `bars=[]` source:fmp fixed. Chart #71 oft weiter leer.
- Dual-Line Benchmark (`#70` `358681a`) live. Dashboard-Badges 1–20 (`#72` `a7bfb15`) Live PASS. Thesis Lab `/#/lab` (`#73` `22d4af9`) Live PASS, 6 Fixtures.
- Exec `#69` Live PASS (XOM; FMP Premium). Peer/ROIC Code intact (Tip ≡ `4bdc1f8`, kein Delete).
- Abend `f0046ee9`: #75/#76/#77 Live ✅ nach Deploy · #81 `c6dc39d1` · #82 `78c8521e` · #83 `8a7ee044` · #84 `32466b6c` · #85 `f6a6a398` · #86 `7e9279db` · #88 `f0046ee9` Live ✅. #87 `2fb8b70a` Code ✅, Live 🟡 PARTIAL (healthy 251d, thin-Banner nicht repro).

**Nicht neu bauen / nicht anfassen:** Miner-Kern, PEG, inverted DCF Core, Sentiment, Portfolio F.2, Rang 7–9 ohne Entscheidung.

---

## 3. Offen 🟡 / ⬜ (workable, Rang 7–9 auszunehmen)

**🟡 Partial:** Portfolio-Backtest Rest-DoD · Market-Charts PEG/FINRA · Hormuz (B) `recession-drivers.ts` · Valuechain Rang 7–9 (**blockiert**, `@xyflow/react`) · #71 4-Toggles (Chart oft leer; OHLCV-Honesty #74) · #87 thin-series (healthy 251d OK, thin-Banner nicht repro).

**⬜ Spec (Liquidity-Bundle + Rest):** Regional LI + Books + Velocity + Data Sources · Fiscal Adaptive · Briefing regional · FRED/Sahm · Rate/Oil · Recession Sources · Peer Adaptive + Pricing-Power.

**Kein Gap:** Black-Litterman §4 = Tabelle Π / E[R]_BL + MC-Cards, kein Scatter/Chart-Soll. Efficient Frontier ≥3 Ticker.

**Queue 29.09. Abend:**

1. Batch A: Search / 429-Transparenz / OHLCV Fake-OK ehrlich surface (Prompt 5) — **done** (`e8ebd35c`, #74 Live ✅).
2. TAM Coverage-Lift — Spec `WORK_TAM_SEGMENT_MAPPING.md` Tor ok; Gap = unmatched Labels.
3. Miner: kein Delete (≡ `b584446f`); Live 503 mempool Egress Render — Observability. Kern nicht anfassen.
4. Ökosystem Scoring-Weichzeichnung (Zykliker-Grad) = Folge-Lane nach Chip (#75 Live ✅).
5. Gated unverändert: Hormuz (B) `recession-drivers.ts`, Liquidity-Bundle, Valuechain Rang 7–9.

Reihenfolge sinnvoll: TAM Coverage-Lift → Hormuz (B) / Liquidity-Bundle / Rang 7–9 bleiben gegated.

---

## 4. Blockiert

- **D6 Rang 7–9** — Custom Edges / Animation / Redis. Nur nach Entscheidung `@xyflow/react`. CSS-Karten bleiben. **Kein workable Ticket.**

`Future_Work.md` = Roadmap, kein Ticket. Siehe `WORK_IMPLEMENTIERUNG_OFFEN.md` und `docs/Doc_Soll_vs_Ist/`.
