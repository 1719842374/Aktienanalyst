# Backlog — Umsetzungsstand Stock Analyst Pro (Aktienanalyst)

> Stand: 05.08.2026 — nach Rest-Verifikation + 3-Punkte-Fix-Ticket (REGULATORY-Gate,
> Gold-Realyield-Modell, dieses Update)
> Kürzel: ✅ done · 🟡 partial/unwired · ⬜ offen · 🚫 durch Owner-Entscheidung verworfen

Dieser Backlog spiegelt den tatsächlich verifizierten Code-Stand auf `main`
(per direktem `grep`/`read` gegen den Live-Branch, nicht aus Erinnerung).
Frühere Stände (31.07.2026 und älter) sind durch diese Version ersetzt —
mehrere dort als offen markierte Punkte sind inzwischen umgesetzt.

---

## Arbeiten vom 03.–05.08.2026

### Scoring-Pipeline (WORK_SCORING_VORLAGE.md)

**Umsetzungsstand: ✅ UMGESETZT (03.–05.08.2026)**
- `server/scoring-gates.ts` — `buildGates()`, `runScoringPipeline()`,
  `GateInputs`-Interface (PRICING_POWER, RELATIVE_GROWTH, DCF_REALITY_CHECK,
  INVENTORY, REGULATORY_EXPOSURE, GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS) ✅
- `server/scoring-integration.ts` — `buildScoringForAnalysis()`,
  `deriveGateInputs()` (inkl. Peer-Median-Outlier-Fix), qualityScore-Mapping,
  Moat-Bonus, Trend-Multiplikator, `calcRealizedGrowth8QServer()`
  (drift-geschützt gegen Client-Berechnung) ✅
- Lookahead-Bias-Sperre + Fiscal-Megatrend-Ausnahme
  (`fiscalMegatrendQualifies`, `softenGatesForFiscalMegatrend`) ✅
- UI: `SummarySection.tsx` rendert `data.scoring` (finalScore, gates,
  rationale, GateInputs) generisch über `gates.map()` ✅
- Tests: `test-scoring-gates.ts`, `test-scoring-integration.ts`,
  `test-scoring-pipeline.ts` — alle grün ✅
- **REGULATORY-Gate-Verdrahtung** (dieses Ticket, Punkt 1, 05.08.2026):
  `analyze-route.ts` liest `getCachedRegulatoryAssessment(ticker)` (neuer,
  rein lesender Cache-Getter in `regulatory.ts`) und übergibt das Gate an
  `buildScoringForAnalysis()`. Kein neuer LLM-Call — die Regulatory-Analyse
  bleibt lazy (PESTEL-KI-Panel löst sie aus), das Gate erscheint automatisch
  im Scoring, sobald für den Ticker bereits eine Analyse im 24h-Cache liegt.
  Live verifiziert an MSFT: Gate `REGULATORY_EXPOSURE` (cap 65, FTC-
  Kartellverfahren) erscheint korrekt in `scoring.gates` und deckelt
  `finalScore` von 88 auf 65. ✅
- Seiteneffekt-Fix: `force`-Parameter in `/api/analyze` wurde zuvor als
  `forceRefresh` destrukturiert (Feld existiert im Zod-Schema nicht unter
  diesem Namen) — jeder `force: true`-Request wurde dadurch STILL ignoriert,
  Cache griff immer. Behoben (`force: forceRefresh = false`). ✅

### ROIC-Null-Handling

**Umsetzungsstand: ✅ UMGESETZT** — `server/news-peers.ts:195`:
`const raw = field == null ? NaN : Number(field);` — verhindert, dass
fehlende FMP-Felder als `0` statt `n/a` interpretiert werden.
Test: `test-roic.ts` grün. ✅

### Segment-Wachstum (n/a-Anzeige)

**Umsetzungsstand: ✅ UMGESETZT** — `client/src/components/sections/Section7.tsx:159-168`
zeigt `n/a` statt `0%`/`NaN`, wenn Segmentdaten fehlen.
Test: `test-segment-growth.ts` grün. ✅

### Asien-Ticker

**Umsetzungsstand: ✅ UMGESETZT** — Test: `test-asian-tickers.ts` grün,
`test-sector-classification.ts` grün (u.a. IFX.DE korrekt als Semiconductors
statt Financial Services klassifiziert).

### Researcher-Routen-Fix

**Umsetzungsstand: ✅ UMGESETZT** — `server/researcher.ts`, alle 5
Researcher-Tabs × 3 Regionen (US/EU/ASIA). `researcherDiskKey()` nutzt
`safeKey()` (case-preserving: `capex__US`, nicht `capex__us`).
Cron `0f0e9984` (Researcher Morning Refresh) läuft täglich Mo-Fr 06:45 CEST.

### Inverted-DCF-Fix

**Umsetzungsstand: ✅ UMGESETZT** — Test: `test-inverted-dcf.ts` grün.
Symmetrische Einpreisung via `calcImpliedGStar`/`calcEinpreisungsgrad`,
keine hardcodierte Downside-Tabelle (siehe auch WORK_ANTIBIAS_DCF.md,
bereits seit Juli erledigt).

### Fiscal-Bridge-Modul

**Umsetzungsstand: 🟡 MODUL FERTIG, NICHT VERDRAHTET** —
`server/fiscal-bridge.ts` vollständig implementiert (TTL-Tabelle,
`invalidateProgram`, `detectContradiction`, Lookahead-Lock) und
unit-getestet (`test-fiscal-bridge.ts`, `test-fiscal-dcf.ts` — beide grün).
`grep -rln "fiscal-bridge" server/*.ts | grep -v test` → 0 Treffer außerhalb
von Tests — kein Produktionsroute nutzt das Modul.

**Bewusst NICHT in diesem Ticket angefasst** (siehe Auftrag 05.08.2026):
Anschluss an den echten Discovery-Workflow bleibt offen.

### Portfolio-Mathematik

**Umsetzungsstand: 🟡 MATHEMATIK FERTIG, UI NICHT ANGEBUNDEN** —
Sharpe-Ratio, Kelly-Kriterium und Gewichtungsmodi sind implementiert und
unit-getestet (`test-portfolio-sharpe.ts`, `test-portfolio-kelly.ts`,
`test-portfolio-weighting.ts` — alle grün). `client/src/pages/PortfolioPage.tsx`
existiert, hat aber `grep -n "fetch|apiRequest|useQuery"` → 0 Treffer:
reine manuelle Text-Eingabefelder für Score/µ/σ, keine Anbindung an
`/api/analyze` oder den Analyse-Cache.

**Bewusst NICHT in diesem Ticket angefasst** (siehe Auftrag 05.08.2026):
Anbindung von PortfolioPage an `/api/analyze`/Analyse-Cache bleibt offen.

### Gold-Historie (Dual-Axis-Chart)

**Umsetzungsstand: ✅ UMGESETZT** — `GoldPriceChart.tsx` mit `showReal10y`-
Toggle, `historicalPrices[].real10y`-Feld gemergt aus FRED DFII10 über
denselben bis-zu-10J-Zeitraum wie der Gold-Chart.

### Gold-Realyield-Modell (dieses Ticket, Punkt 2, 05.08.2026)

**Umsetzungsstand: ✅ UMGESETZT (05.08.2026)** — `server/gold-realyield-model.ts`
(`runRealYieldGoldModel`, OLS-Fair-Value-Regression Gold~Real10Y,
Inverse-Score, Rate-Szenarien -100..+150bp, Regime-Klassifikation,
`GOLD_REAL_YIELD_REGIME`/`GOLD_AISC_STRESS`-Gates) jetzt produktiv an
`server/gold-routes.ts` (`GET /api/analyze-gold`) angebunden. Nutzt die
bereits geladenen Daten (kein zusätzlicher FRED-Call). Additiv als
`realYieldModel`-Feld in der Response, altes 1980/2011-Fair-Value-Modell
bleibt unverändert als Hauptpfad/Fallback bestehen. UI-Karte in
`GoldFairValueSection.tsx` (Fair-Value-Band, Decoupling-Hinweis, Regime-
Zone, aktive Gates) additiv unterhalb des bestehenden 10-Schritte-Modells.
Live verifiziert: `fairValue=$4286` vs. `actualPrice=$4090`
(`premiumPct=-4.6%`), `regime=stress`, Decoupling-Gate korrekt ausgelöst
(252T-Korrelation zu schwach → `GOLD_REAL_YIELD_REGIME` bleibt inaktiv,
verhindert falsches Signal). Tests: `test-gold-realyield-model.ts` (8 Checks,
Modell-Mathematik) + `test-gold-realyield-wiring.ts` (13 Checks, neue
Verdrahtung) — beide grün.

### Regulatory-Exposure-Modell (WORK2.md §8)

**Umsetzungsstand: ✅ UMGESETZT (03.08.2026), Gate-Verdrahtung 05.08.2026** —
9 generische Achsen (`server/regulatory.ts:32-36`), LLM-Discovery ohne
Fixnamen, `calcRegulatoryEpsImpact`, 7-%-Kumulierungsregel
(`server/regulatory.ts:214`), `POST /api/regulatory` (24h-Cache/Ticker,
lazy vom PESTEL-KI-Panel ausgelöst). Scoring-Gate-Verdrahtung siehe
Scoring-Pipeline-Abschnitt oben (Punkt 1 dieses Tickets).

---

## Ältere Arbeiten (vor 03.08.2026) — weiterhin gültig, ungeändert

### BTC-Miner-Sektion (MINER_INTEGRATION.md, WORK_BTC_MINER.md)

**Umsetzungsstand: ✅ UMGESETZT** — Section 13, Hash Ribbons, Puell,
Breakeven, Difficulty Ribbon, Kapitulationszonen. `classifyMinerZone()`
in `server/btc-miner.ts`.

**Bekannte offene Inkonsistenz (bewusst nicht in diesem Ticket angefasst):**
`inCapitulation` (`server/btc-miner.ts:466`, reine Hash-Ribbon-Bedingung
`ma30 < ma60`) kann von `minerZone.zone` (breitere `classifyMinerZone()`-
Aggregation) abweichen — beide können im selben Response widersprüchliche
Zustände zeigen. Dokumentiert, Fix bewusst zurückgestellt.

### 10Y-Chart / FMP-Fallback

**Umsetzungsstand: ✅ UMGESETZT** — OHLCV-Cap auf 2600 Trading Days (~10J)
angehoben, FMP-Fallback greift wenn `closingPrices2Y.length < 100`.
Alt-Provider-Fallback (Yahoo/Tiingo) weiterhin nicht umgesetzt — nicht
nötig solange FMP Pro läuft.

### Anti-Bias Inverted DCF (WORK_ANTIBIAS_DCF.md)

**Umsetzungsstand: ✅ UMGESETZT** — `calcImpliedGStar`, `calcEinpreisungsgrad`,
generische LLM-Risiken, `posOriginal`/`posAdjustment`-Trennung.

### Fiscal Bridge Reverse-DCF (WORK_REVERSE_DCF_BRIDGE.md)

**Umsetzungsstand: ✅ Kern umgesetzt** — Reverse-DCF-Sektion 14, 20min-TTL-
Cache. Fiskal-Bridge-Modul selbst siehe oben (unwired, bewusst offen).

### Halving/Hashrate-Zyklus (WORK_TEIL0-6.md)

**Umsetzungsstand: ✅ UMGESETZT** — Breakeven-Formel, Halving→Hashrate-
Impact-Erklärtext im UI.

---

## Verbleibende offene Punkte (klar als offen markiert)

| Item | Aufwand | Status | Hinweis |
|---|---|---|---|
| Fiscal-Bridge an echten Discovery-Workflow anschließen | ~1 Tag | ⬜ offen | Bewusst nicht in diesem Ticket — Modul fertig, nur Anschluss fehlt |
| PortfolioPage an `/api/analyze`/Analyse-Cache anbinden | ~0,5–1 Tag | ⬜ offen | Bewusst nicht in diesem Ticket — Mathematik fertig, nur UI-Anbindung fehlt |
| `inCapitulation` vs. `minerZone.zone` Namensklärung | ~2h | ⬜ offen | Bewusst nicht in diesem Ticket — dokumentierte Inkonsistenz, kein Crash |
| Alt-Provider-Fallback für 10Y-OHLCV (Yahoo/Tiingo) | 1-2h | 🚫 zurückgestellt | Nicht nötig solange FMP Pro läuft |
| Screener-Gates + Backtesting (WORK_SCORING_VORLAGE.md, Vollversion) | 2-3 Tage | 🟡 teilweise | Kern-Gate-System läuft (siehe oben); Backtesting-Layer noch offen |
| Gold Multi-Faktor-Modell Phase 2 (WALCL, DXY, Multi-OLS) | 1-2 Tage | ⬜ offen | Explizit in `gold-realyield-model.ts` als TODO vermerkt, nicht Teil dieses Tickets |
| Regulatory-Impact auch in Risks/PESTEL-Sektion direkt integrieren (statt nur PESTEL-KI-Panel) | ~3-4h | 🟡 teilweise | Fest verdrahtete PESTEL-Kategorie "Legal" existiert bereits als einfacherer Pfad |

**Alle anderen Punkte aus früheren Backlog-Ständen (31.07.2026 und älter)
sind entweder umgesetzt oder oben explizit als offen/zurückgestellt markiert.**
