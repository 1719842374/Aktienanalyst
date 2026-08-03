# Backlog — WORK.md-Docs → Umsetzungsstand

> Stand: 31.07.2026 nach Screening aller WORK-Files
> Kürzel: ✅ done · 🟡 partial · ⬜ offen · 🚫 durch Owner-Entscheidung verworfen

Alle `WORK_*.md`-Dateien tragen den Marker
> "Nur Dokumentation. Implementierung lokal → PR → Review."

Sie sind also **Design-Spezifikationen**, keine automatisch abarbeitbare Task-Liste.
Dieser Backlog extrahiert die konkreten Umsetzungs-Deltas.

---

## 1. MINER_INTEGRATION.md + WORK_BTC_MINER.md

**Doku-Ziel:** BTC-Miner-Sektion (Section 13) mit Hash Ribbons, Puell,
Breakeven, Difficulty Ribbon, MPI, Kapitulations-Zonen (rot/gelb/grün).

**Umsetzungsstand: ✅ UMGESETZT (03.08.2026, Owner-Freigabe: "Konzept +
Scoring-Logik ja, ChatGPT-Code nein")**
- `client/src/lib/btc/minerMetrics.ts` — §2/§3-Rechenlogik als reine,
  unit-testbare Funktionen (Ribbon-Signale, Breakeven, Hashprice,
  classifyMinerZone, Zonen-Serie + Segmente) ✅
- `client/src/components/sections/Section13Miner.tsx` — NATIVE Sektion 13
  im Stil der bestehenden 12 Sektionen (SectionCard, MetricCards,
  3 Recharts-Panels mit rot/gelb/grün-ReferenceAreas, Zone-Badge,
  Flags, konfigurierbare Fleet-Annahmen) ✅
- `client/src/pages/BTCDashboard.tsx` — 3 chirurgische Änderungen
  (Import, SECTIONS id 13, Render-Ref) ✅
- `server/btc-miner.ts` — additiv: classifyMinerZone + minerZone-Feld,
  Cache-Fix (GET-Ergebnis ohne Preis-Kontext blockiert POST nicht mehr) ✅
- Alte ChatGPT-Komponenten (`BtcMinerSection.tsx` ×2, nirgends
  referenziert) entfernt — inkompatibel mit Dashboard-Konventionen ✅
- `script/test-miner-metrics.ts` + CI-Workflow `miner-metrics-test.yml` ✅
- MPI (§2.6) bewusst ausgelassen: erfordert CryptoQuant/Glassnode-Key;
  geht neutral (±0) in den Score ein — kein Fake-Default.
- WICHTIG: §2.4-Spec-Code enthält einen 1000×-Fehler (doppeltes /1000
  in kwhPerThDay) — in der Implementierung korrigiert, per Unit-Test
  abgesichert.

---

## 2. WORK_DATA_PROVIDERS.md — 10Y-Chart / FMP-Plan-Limits

**Doku-Ziel:** 10Y-Timeframe darf nicht truncieren; ggf. Yahoo/Tiingo/
Polygon als Fallback wenn FMP-Plan <30Y.

**Umsetzungsstand:**
- OHLCV-Cap in analyze-route.ts auf 2600 Trading Days (~10Y) angehoben
  (Commit 84f2146) ✅
- FMP-Range 10 Jahre in getFmpFallbackData (Commit 5878407) ✅
- Alt-Provider-Fallback (Yahoo/Tiingo) **NICHT umgesetzt** 🟡

**Restaufwand falls Alt-Provider gewünscht:**
- `server/history-provider.ts` mit `fetchDailyHistory({fmpFetch, altFetch})`
  Pattern aus WORK_DATA_PROVIDERS.md §5 — 1-2h
- Nur relevant wenn du auf ein FMP-Plan mit <10Y Historie herunterstufst
  oder internationale Tickers Historie brauchen die FMP nicht liefert.

**Empfehlung:** Als latenter Fallback dokumentieren, nicht jetzt umsetzen
solange FMP Pro läuft.

---

## 3. WORK_ANTIBIAS_DCF.md — Anti-Bias Inverted DCF

**Doku-Ziel:** Symmetrie, keine hardcodierte 5-Downside-Tabelle,
Einpreisung via g*, eine Adjustierungsschicht, LLM/OpenRouter generisch.

**Umsetzungsstand:**
- `calcImpliedGStar` in catalyst-engine.ts ✅
- `calcEinpreisungsgrad` in catalyst-engine.ts ✅
- generateCompanySpecificRisks über OpenRouter (LLM-generisch) ✅
- `posOriginal` + `posAdjustment` Trennung in Catalyst-Struct ✅

**Empfehlung:** Bereits umgesetzt — kein Delta.

---

## 4. WORK_REVERSE_DCF_BRIDGE.md — Cache-Invalidierung + Fiscal Bridge

**Doku-Ziel:** Reverse-DCF + TTL-basierte Cache-Invalidierung + Fiskal-Bridge.

**Umsetzungsstand:**
- Reverse-DCF-Sektion 14 rendert `impliedG*` ✅ (7.06% für MSFT verifiziert)
- Analysis-Cache 20 min TTL in analyze-route.ts ✅
- Fiskal-Bridge (`buildCapexFiscal` per Region) in researcher.ts ✅
  (aber nur Researcher-Sektion, nicht in Stock-Analyse verdrahtet)

**Empfehlung:** Kern läuft. Falls Capex-Fiskal-Kontext auch in
Stock-Analyse durchgereicht werden soll (statt nur im Researcher-Tab),
kleiner Wiring-Aufwand von 1-2h.

---

## 5. WORK_SCORING_VORLAGE.md — Scoring-Pipeline

**Doku-Ziel:** Gates, Lookahead-Bias-Regel, Fiscal-Megatrend-Ausnahme.

**Umsetzungsstand:**
- `client/src/pages/ScreenerDashboard.tsx` vorhanden ✅
- Gate-System + Backtesting **NICHT umgesetzt** ⬜

**Empfehlung:** Größeres Feature (mehrere Tage). Nicht jetzt.

---

## 6. WORK_PORTFOLIO.md — Virtuelles Portfolio + Sharpe + Kelly

**Doku-Ziel:** Buy-Liste, Gewichtungsmodi, Sharpe-Ratio, Kelly-Kriterium.

**Umsetzungsstand:**
- Kein Portfolio-Modul im Codebase ⬜
- Kein `client/src/pages/Portfolio.tsx` ⬜

**Empfehlung:** Grundes neues Feature (mehrere Tage). Nicht jetzt.

---

## 7. WORK_TEIL0-6.md — Detail zu Halving/Hashrate

**Doku-Ziel:** BTC-Section-13-Interna (siehe Miner oben).
Zusätzlich: Detailed Breakeven Formula.

**Umsetzungsstand:**
- Breakeven-Formel in `server/btc-miner.ts` ✅
- Halving→Hashrate-Impact-Text im UI ✅ (03.08.2026: Leselogik-Footer in
  Section13Miner.tsx erklärt den vollen §6-Zyklus Halving → Hashprice-
  Einbruch → Kapitulationszone → Difficulty-Rückgang → Hash Ribbon Buy)

**Empfehlung:** Erledigt.

---

## 8. WORK_TEIL7_SCORING.md — Gold Multi-Faktor + Realzins

**Doku-Ziel:** Gold-Analyse mit Cuts/QE/QT-Phasen, WALCL-Serie,
Faktor-Priorisierung.

**Umsetzungsstand:**
- `server/gold-routes.ts` vorhanden ✅
- Phasen-Modell + WALCL — teilweise, in FRED-Aufrufen abgebildet 🟡

**Empfehlung:** Läuft. Verfeinerungen später.

---

## 9. WORK2.md — Regulatory Exposure §8 (offene Checkboxen)

**Doku-Ziel:** Generisches Regulatory-Exposure-Modell mit LLM-basiertem
Search + EPS-Impact-Berechnung.

**Umsetzungsstand: ✅ UMGESETZT (03.08.2026)** — alle 4 Checkboxen:
- [x] `regulationAxis` generisch (9 Achsen, server/regulatory.ts)
- [x] Prompt ohne Fixnamen (generische Überbegriffe, Regime werden erst
      nach Extraktion benannt — per Unit-Test abgesichert)
- [x] `buildRegulatorySearchQueries` (Sektor + Branche + Top-Umsatzländer
      ≥ 5 % aus den FMP-geoSegments)
- [x] `calcRegulatoryEpsImpact` (§8.5 exakt) + Confidence-Filter (§8.6) +
      Test-Matrix (§8.7, alle 7 Zeilen) + REGULATORY_EXPOSURE-Gate (§8.8
      inkl. 7-%-Kumulierungs-Regel)

**Wiring:** POST /api/regulatory (24h-Cache/Ticker) + lazy KI-Panel in der
PESTEL-Sektion (Section 12) mit Gate-Banner, Exposure-Karten, EPS-Impacts.
Unit-Tests: script/test-regulatory.ts (22 Tests) + CI regulatory-test.yml.
Verifiziert live für MSFT: DMA/FTC/IRA/EED vom LLM selbst entdeckt,
Gate cap 65 warn.

Das Gate-Objekt ist vorbereitet für das (noch offene) Scoring-Gate-System
aus WORK_SCORING_VORLAGE.md — sobald buildGates/applyGates existieren,
kann `assessment.gate` dort direkt eingespeist werden.

**Umgesetzt statt dessen:**
- Fest verdrahtete PESTEL-Kategorie "Legal" in analyze-helpers.ts
  `generatePESTELAnalysis` ✅
- Government-Exposure-Estimator in sector-data.ts ✅
- Deshalb blocked die fehlenden 4 Items nicht das Kern-Dashboard;
  sie würden PESTEL nur präziser machen.

**Restaufwand:** ~3-4h für `calcRegulatoryEpsImpact` (LLM-Call der
Regulierungs-News → strukturierten Impact zurück) + Wiring in Risks
und PESTEL. Bietet mittleren Mehrwert.

**Empfehlung:** Nettes 2-Tage-Feature-Paket. Nicht jetzt, aber
gut priorisierbar wenn regulatorische Präzision wichtiger wird.

---

## Zusammenfassung — was ich JETZT tun würde

**Nichts** ohne dein OK. Konkret:

| Item | Aufwand | Blocker heute? | Empfehlung |
|---|---|---|---|
| Miner-Tab in BTCDashboard verdrahten | 15 min | Nein | ❓ Owner-Entscheidung |
| Miner 3-Panel-Chart (WORK_BTC_MINER §4) | 3-5h | Nein | ❓ Falls Miner-Tab freigegeben |
| Alt-Provider für 10Y-OHLCV | 1-2h | Nein | 🚫 Solange FMP Pro läuft nicht nötig |
| WORK2 §8 Regulatory-Impact-Modell | 3-4h | Nein | 🟡 Nächste Runde |
| Screener-Gates + Backtesting | 2-3d | Nein | 🟡 Größeres Feature |
| Portfolio-Modul (Sharpe/Kelly) | 3-5d | Nein | 🟡 Größeres Feature |

**Alles andere ist schon umgesetzt oder als Design-Doku bestimmt.**
