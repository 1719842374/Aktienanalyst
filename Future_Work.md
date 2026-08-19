# Future Work — Offene Roadmap Stock Analyst Pro (Aktienanalyst)

> **Stand: 19.08.2026**  
> Abgeglichen mit aktuellem Code-Stand auf `main`, README.md, BACKLOG.md (05.08.2026) und den live vorhandenen Komponenten (PortfolioPage, BTC Section 13, Gold Realyield, Scoring-Gates, Researcher, etc.).

Dieses Dokument listet die **noch nicht (vollständig) umgesetzten Ideen** und verweist explizit auf den bereits erreichten Implementierungsstand.

---

## Bereits umgesetzte Kernbereiche (Referenz)

Die folgenden Punkte aus der ursprünglichen Feature-Liste sind **bereits umgesetzt oder sehr weit fortgeschritten** und dienen als Baseline:

| Feature | Status | Referenz / Code |
|---------|--------|-----------------|
| **18-Sektionen Aktien-Analyse** (DCF, CRV-Härtung, Reverse DCF, Monte Carlo, Thesis Strength, Management Score, PESTEL, Porter, Technical Chart 10Y, etc.) | ✅ | `client/src/components/sections/*`, `server/analyze-route.ts`, README „Die 18 Sektionen“ |
| **Virtuelles Portfolio** + CAPM / Kelly / Sharpe / Gewichtungsmodi A/B/C + Pie-Chart + Positions-Tracker + „Aus Analyse übernehmen“ + Watchlist + Researcher-Portfolios | ✅ (stark erweitert seit BACKLOG 05.08.) | `client/src/pages/PortfolioPage.tsx`, `client/src/lib/portfolio/*`, `WORK_PORTFOLIO.md` |
| **Equity Researcher** (4 Tabs: Macro, Sectors, Screener, Capex) + Daily Briefing + Caching | ✅ | `server/researcher.ts`, `client/src/pages/Researcher.tsx` |
| **13F / Screener** + Ticker-Links | ✅ | `server/screener.ts`, ScreenerDashboard |
| **BTC-Dashboard 12 Sektionen** inkl. Miner-Sektion (Hash Ribbons, Puell, Breakeven, Difficulty Ribbon, Kapitulationszonen) | ✅ (Kern) | `client/src/pages/BTCDashboard.tsx`, `server/btc-miner.ts`, `MINER_INTEGRATION.md` |
| **Gold-Dashboard** + Realyield-Modell (OLS, Regime, Gates) | ✅ (Kern + Realyield) | `server/gold-realyield-model.ts`, `GoldFairValueSection.tsx` |
| **Rezessions-Dashboard** (17 Indikatoren + Scoring) | ✅ (Kern) | `server/recession.ts`, `RecessionDashboard.tsx` |
| **Scoring-Pipeline + Gates** (DCF_REALITY, RELATIVE_GROWTH, PRICING_POWER, INVENTORY, REGULATORY, GOLD_*) + Summary | ✅ | `server/scoring-gates.ts`, `scoring-integration.ts`, `SummarySection.tsx` |
| **Thesis Strength Score** (0–10, Guards, Sektor-adaptiv, Moat/Trend/Fiskal/FCF/Reputation) | ✅ | `server/thesis-strength.ts`, `docs/CHANGELOG_THESIS_SCORE.md` |
| **Management-Execution-Score** (Delivery, Kapitalallokation, Glaubwürdigkeit, Insider etc.) | ✅ | `server/management-score.ts`, Section 18 |
| **ROIC / ROI 5-Jahres-Vergleich**, FCF YoY, Segment-Wachstum YoY, Earnings-Call-Datum | ✅ | Section 1 + Financials |
| **Peer-Overrides** (manuelles Hinzufügen/Entfernen) | ✅ | Section 7 |
| **Anti-Bias / Inverted DCF / CRV-Härtung** (WACC-Floor, TV-Guard, Margin-Stress …) | ✅ | Section 6 + 8 |
| **Cache-System** (Analyse-Cache, Researcher Disk-Cache, Force-Refresh) | ✅ (Basis) | `server/disk-cache.ts`, analyze-route |

> Hinweis: Der BACKLOG vom 05.08.2026 listete die Portfolio-UI-Anbindung noch als offen. Seitdem wurde `PortfolioPage.tsx` deutlich weiterentwickelt (Analyse-Cache-Anbindung, CAPM/Kelly-Engine, Watchlist, Researcher-Portfolios). Der aktuelle Stand ist daher weiter als der damalige BACKLOG.

---

## Noch nicht (vollständig) umgesetzte Ideen

### 1. Sprach- & UI-Grundlagen

- **Komplettes Dashboard auf Englisch und Deutsch** (i18n / Language-Switch)  
  Aktuell nur Deutsch-dominiert. Vollständige Internationalisierung (UI-Strings, Labels, Tooltips, Fazit-Texte) fehlt.

### 2. Industrie- & Sektor-Visualisierung

- **Industrie-Wertschöpfungskette**  
  Auswählbare Branchen, graphisch visualisiert (z. B. für KI / Tech / Elektrifizierung).  
  LLM befüllt die Kette mit allen börsennotierten Unternehmen ab ca. 1 Mrd. Market Cap.

- **Sektorrotations-Rat**  
  Anhand von Risiken, Bewertungen und Zykluseinordnung (aggressiv Tech → defensiv UNH / Pharma).  
  Explizite Empfehlung: Wann im Konjunkturzyklus welche Sektoren am besten performen.

- **Sektorrotation nach Kostolany-Rad**  
  Growth / Value / Defensiv-Rotation visualisiert und regelbasiert.

### 3. Cache- & Modul-Kommunikation

- Gecachte Analysen (Aktienanalyse ↔ Researcher ↔ Portfolio) müssen **vollständig miteinander kommunizieren** und manuell refreshbar sein.  
  Teilweise Bridge existiert (`portfolioBridge`, Watchlist, „Aus Analyse übernehmen“), aber volle bidirektionale Synchronisation + konsistenter Cross-Modul-Refresh ist noch offen.

### 3.1 NEU (19.08.2026) — Researcher Sector Opportunity: fehlende Portfolio-/Watchlist-Add-Buttons

**Bug / Feature-Gap**  
Im Tab **Sector Opportunity** können die angezeigten Kandidaten-Ticker (`topPlayers`) **nicht** zum Portfolio oder zur Watchlist hinzugefügt werden.  
Im **Undervalued Screener** und im **Daily Briefing** funktioniert der Add einwandfrei.

**Ursache (Code-Fakt):**  
`SectorsPanel.tsx` rendert die Ticker nur als statische `<span>`-Tags. Der Import und die Verwendung von `TickerAddButtons` + `bulkAddToWatchlist` fehlen komplett (im Gegensatz zu `ScreenerPanel.tsx` und `BriefingChangeCard`).

**Detail-Dokumentation + Fix-Vorschlag:**  
→ [WORK_RESEARCHER_SECTOR_ADD.md](./WORK_RESEARCHER_SECTOR_ADD.md)

**Aufwand:** ~30–60 Minuten (UI-only, keine Backend-Änderung).

### 3.2 NEU (19.08.2026) — Portfolio Performance Attribution / Backtesting vs. Benchmark

**Feature-Gap**  
Das Portfolio-Modul ist aktuell stark forward-looking (CAPM/Kelly/Sharpe). Es fehlt eine professionelle **ex-post Performance-Attribution**:

- Equity Curve Portfolio vs. Benchmark
- Alpha, Beta, Information Ratio
- Max Drawdown + Underwater-Chart mit markierten Perioden
- Up-/Down-Capture, Hit Rate, Profit Factor
- Contribution-Attribution pro Titel und Sektor

**Vollständige Spec (Formeln, Datenmodell, Rechenschritte, Chart-Design, UI-Platzierung, Acceptance):**  
→ [WORK_PORTFOLIO_BACKTEST.md](./WORK_PORTFOLIO_BACKTEST.md)

**Aufwand v1:** ≈ 1,5–2 Tage  
**Priorität:** Hoch (starke Differenzierung + direkter Nutzen für Diagnose und Bewerbungen)

### 4. BTC-Dashboard – Erweiterungen

- **M2 Year / Fiscal Spending (US + Global)** auf den technischen BTC-Chart plotten.  
  Growth-Zonen und Verlangsamung erkennbar machen + Balance-Sheet-Scoring (Fed / EZB / China).

- Vollständige, live-verdrahtete **Miner-Profitabilitäts-Indikatoren**  
  Hash Ribbons, Puell Multiple, Hashprice, Mining-Breakeven / Cost-of-Production, Difficulty Ribbon Compression, Miner Position Index / Netflows, MVRV / Realized Price als Kontext.  
  Inkl. klarer Kapitulationszonen-Visualisierung.  
  *(Kern bereits in Section 13 / `btc-miner.ts` vorhanden, aber nicht alle Indikatoren live + konsistent und die dokumentierte Inkonsistenz `inCapitulation` vs. `minerZone.zone` ist noch offen.)*

#### 4.1 NEU (19.08.2026): Fed-Bilanzsumme (WALCL) + QE/QT-Regime für BTC

**Ziel:** Die Logik „Asset / Fed Balance Sheet“ (wie beim SPX/FARBAST-Chart) + explizites QE/QT-Regime in BTC integrieren — sowohl als **technisches Overlay** im Chart als auch als **Scoring-Faktor**.

**Datenquellen & Fakten (FRED):**
- `WALCL` = Federal Reserve Total Assets (wöchentlich, in Mio. USD)
- Historische Peak-Werte: ~$8,96 Tn (April 2022), ~$8,9 Tn (Mai 2022)
- QT-Phase 2022–2025: Abbau um ca. $2,2 Tn → Stand Frühjahr/Sommer 2026 ca. $6,7–6,8 Tn
- QE-Phasen: 2008–2014, 2020–2022 (COVID + Nachwirkungen)
- Ratio-Logik analog SPX: `BTC_Price / WALCL` (oder log-transformiert). Sinkender Ratio bei steigendem BTC = Bilanzsumme wächst relativ stärker (QE-Effekt).

**Technische Analyse Overlay (Plot):**
- Dual-Axis oder normale Overlay-Linie: `log(WALCL)` oder normalisierte WALCL-Wachstumsrate (4W/13W/52W YoY bzw. Change).
- QE/QT-Regime-Bänder farblich markieren (grün = QE-Expansion, rot = QT-Kontraktion, grau = neutral/stagnierend).
- Analog zur bereits vorhandenen M2-Absolute + M2-YoY + Real10Y Overlay-Pipeline in `server/btc-macro.ts` und `client/src/lib/btcAnalysis.ts` (Forward-Fill + Lag-Option).
- Optional: Ratio-Chart (BTC / WALCL) als separater Sub-Chart oder Toggle, vergleichbar dem SPX/Fed-Balance-Sheet-Chart.

**Scoring-Logik (Vorschlag):**
- Neuer Indikator „Fed Balance Sheet Regime“ (Gewicht z. B. 0.10–0.15 in der GIS-/GWS-Berechnung).
- Score-Regeln (Beispiele):
  - WALCL 13W-Change > +1,5 % → +1 (QE-Rückenwind)
  - WALCL 13W-Change < –1,0 % → –1 (QT-Gegenwind)
  - Dazwischen → 0 (neutral)
- Zusätzlicher Gate `BTC_QE_QT_REGIME` (warn/hard), der bei starkem QT + gleichzeitig hohem BTC-Bewertungsniveau (Power-Law-Deviation / MVRV) aktiv wird.
- Integration in bestehende Macro-Score-Komponente (aktuell nur Fed Funds + DXY + M2).

**Aufwand:** 1–2 Tage (Daten-Fetch + Forward-Fill analog M2, Chart-Overlay, Scoring-Verdrahtung, Tests).

**Abhängigkeit:** Wiederverwendung der bestehenden FRED-Fetch-Helfer aus `btc-macro.ts` und `gold-realyield-model.ts`.

### 5. Gold-Dashboard – Erweiterungen

- Analoge **Minenkosten-Indikatoren**  
  AISC, Cash Cost (C1) vs. All-In Cost (C3), Gold Miners’ Cost Curve, GDX/GLD-Ratio, P/NAV der Miner.

- Erweiterte Makro-Indikatoren  
  Realzins-Modell / 10Y TIPS (bereits teilweise), Realzins-Gold-Regression, DXY, realer Leitzins, Gold/Silber-Ratio, Zentralbank-Nettokäufe, Gold/Bond-Ratio.

- Kombinierte Visualisierung **Realzins + AISC-Kostenkurve** (Python-backed Chart).  
  *(Realyield-Modell + Gates bereits live; AISC + kombinierte Kurve noch offen.)*

#### 5.1 NEU (19.08.2026): Multi-Faktor Phase 2 – log(WALCL) + QE/QT-Regime für Gold

**Ziel:** Das bestehende 1-Faktor-Realzins-Modell (`gold-realyield-model.ts`) um den explizit als Phase 2 dokumentierten Multi-Faktor erweitern und QE/QT-Regime-Scoring + Overlay hinzufügen.

**Bereits dokumentierter Code-Stand (TODO in `server/gold-realyield-model.ts`):**
```
// PHASE 2 (explizit NICHT umgesetzt, nur TODO)
// Multi-Faktor-Erweiterung G_t = α + β1·R_t + β2·DXY_t + β3·log(WALCL_t) + ε_t
// Voraussetzung: DXY (DTWEXBGS) und WALCL business-day-aligned (WALCL wöchentlich → LOCF-Forward-Fill)
```

**Datenquellen & Fakten:**
- `WALCL` (FRED) – Fed Total Assets, wöchentlich
- `DTWEXBGS` (FRED) – Trade Weighted U.S. Dollar Index (Broad)
- Peak WALCL ~$8,96 Tn (2022) → QT-Abbau auf ~$6,7–6,8 Tn (2026)
- Ökonomische Erwartung der Vorzeichen: β1 < 0 (Realzins), β2 < 0 (DXY), β3 > 0 (log(WALCL) = Liquiditäts-/Bilanzexpansion stützt Gold)

**Technische Analyse Overlay (Plot):**
- In `GoldPriceChart.tsx` zusätzliche Toggle-fähige Linien:
  - `log(WALCL)` (oder normalisierte WALCL-Wachstumsrate)
  - Optional DXY
- QE/QT-Regime-Hintergründe (farbige Bänder) analog zum BTC-Vorschlag.
- Ratio-Visualisierung `Gold / WALCL` als optionaler Sub-Chart (gleiche Logik wie SPX/Fed-Balance-Sheet).

**Scoring- & Modell-Logik:**
1. **Multi-OLS** (Rolling Window 252 Handelstage) nur wenn alle drei Serien (Real10Y, DXY, log(WALCL)) non-null und aligned sind.
2. Vorzeichen-Check: Wenn β3 nicht positiv oder β1/β2 nicht negativ → `REGIME_UNSTABLE`-Flag und Fallback auf reines 1-Faktor-Modell.
3. Neuer Gate `GOLD_QE_QT_REGIME` (warn):
   - Aktiv bei starkem QT (WALCL 13W-Change < –1 %) + gleichzeitigem Realzins-Stress.
4. Fair-Value-Anzeige bleibt standardmäßig 1-Faktor (Realzins); Multi-Faktor erscheint als Vergleichslinie / „Liquidity-Adjusted Fair Value“.
5. Integration in bestehende `GOLD_REAL_YIELD_REGIME` und `GOLD_AISC_STRESS` Gates (keine Doppelzählung).

**Aufwand:** 1–2 Tage (wie bereits in BACKLOG geschätzt).  
**Priorität:** Hoch (explizites TODO im Produktionscode + starke ökonomische Relevanz für Gold).

### 6. Analyse-Engine & Parameter

- **Monte-Carlo-Parameter flexibel** (0–50.000 Iterationen, nicht hardcoded ~10k).

- **Konsistente Analyse**  
  Formeln und Ergebnisse müssen überall übereinstimmen.  
  Noch dokumentierte Inkonsistenzen (z. B. `inCapitulation` vs. `minerZone`).

- **Bilanzen-Screener**  
  Hochladen von Bilanzen → automatische Red-Flag- und Unstimmigkeits-Erkennung.

- **Segment-Deduplizierung (Produkt vs. Geographic)**  
  **Problem:** FMP liefert bei manchen Titeln (z. B. AMZN) denselben Segmentnamen sowohl in `/revenue-product-segmentation` als auch in `/revenue-geographic-segmentation` (AWS erscheint doppelt). Der generische Pipeline-Code (`fmp.ts` → `normaliseSegmentRows` + `analyze-route.ts` + `Section2.tsx`) dedupliziert nicht nach Name → doppelte Balken in der UI.  
  **Lösung (ticker-agnostisch):**  
  1. Zentrale `dedupeSegmentsByName()`-Helper in `server/fmp.ts` (normalisierter Name, behält höheren Revenue).  
  2. Sofort nach Laden auf `revenueSegments` und `geoSegments` anwenden.  
  3. Optional Cross-Dedup: Name, der in beiden Listen vorkommt, nur in der Produktliste behalten.  
  **Aufwand:** ~1–2 h.  
  **Detail-Spec:** [WORK_SEGMENT_DEDUP.md](./WORK_SEGMENT_DEDUP.md)  
  **Referenz:** Chat 17.08.2026 (Amazon-Screenshot + Analyse der Segment-Pipeline).

### 7. Rezessions-Dashboard

- Google-Trend-Score fixen (aktuell oft N/A).

- **Fazit Makro-Risikobewertung** im KI-Modus + LLM-Search.

- Sektorrotation Unter-/Überbewertet-Logik.

### 8. Scoring & Fazit

- **Fazit-Sektion als Konfliktmatrix** statt einfachem Rating  
  Vektor mit expliziter Divergenzanzeige:  
  Qualität (fundamental) · Trend/Delta · Reverse DCF · Technik-Regime · Katalysatoren-Erwartungswert.  
  *(Teilweise Elemente bereits in SummarySection vorhanden, aber noch keine klare Konfliktmatrix-Darstellung.)*

### 9. Konzeptionelle / Content-Ideen (noch nicht als Feature)

- Overview 2026 + Einleitungstext: „Aktien folgen dem zukünftigen Gewinnwachstum, nicht der historischen Performance“.
- ETF + Core-Satellite-Strategie nur bei Informationsvorteil / Bigger Picture in Einzelaktien (Debt & Cashflow).
- Asset-Price-Inflation eroding Purchasing Power 2026.
- Mindset der verschiedenen Investoren (Value / Growth / Momentum).
- Tiefere **Makroanalyse** (Inflation multikausal/angebotsgetrieben, Fed/Kapitalmarktzinsen im Kontext Ukraine/Hormuz, BIP + BIP/Kopf, Aufrüstung, Private Debt, Protektionismus, multipolare Welt).
- **Megatrend-Analyse** aus Equity-Researcher-Sicht inkl. Wertschöpfungskette / Supply Chain (KI, Tech, Elektrifizierung, Eisenbahn etc.).
- Dediziertes **Stockpicking 17-Step-Analyse-Metriken-Framework** (über die bestehenden 18 Sektionen hinaus).
- Erweiterte BTC-Korrelationen-Metriken.
- Blasen- und Rezessions-/Korrektur-Indikatoren (Erweiterung des bestehenden Rezessions-Dashboards).

---

## Prioritäten-Übersicht

| Priorität | Thema                                      | Status-Hinweis                          |
|-----------|--------------------------------------------|-----------------------------------------|
| **Hoch**  | i18n DE/EN                                 | komplett offen                          |
| **Hoch**  | Industrie-Wertschöpfungskette + LLM        | komplett offen                          |
| **Hoch**  | Sektorrotation / Kostolany                 | komplett offen                          |
| **Hoch**  | BTC M2/Fiscal + erweiterte Miner-Indikatoren | teilweise (Section 13)                 |
| **Hoch**  | **BTC + Gold: WALCL / QE-QT Regime + Overlay + Scoring (Phase 2)** | neu detailliert 19.08.2026 |
| **Hoch**  | Gold AISC + Realzins-Kombination           | teilweise (Realyield schon da)          |
| **Hoch**  | **Researcher Sector Opportunity — fehlende Add-Buttons** | neu 19.08.2026 (Quick-Win ~30–60 min) |
| **Hoch**  | **Portfolio Performance Attribution / Backtesting vs. Benchmark** | neu 19.08.2026 → [WORK_PORTFOLIO_BACKTEST.md](./WORK_PORTFOLIO_BACKTEST.md) |
| **Mittel**| Monte-Carlo flexibel                       | offen                                   |
| **Mittel**| Bilanzen-Red-Flag-Screener                 | offen                                   |
| **Mittel**| Rezession: Google Trends + KI-Fazit        | offen                                   |
| **Mittel**| Konfliktmatrix im Fazit                    | teilweise                               |
| **Mittel**| Segment-Deduplizierung (Produkt/Geo)       | offen (Quick-Win ~1–2 h) → [WORK_SEGMENT_DEDUP.md](./WORK_SEGMENT_DEDUP.md) |
| **Niedrig**| Content / Overview-Ideen 2026             | rein konzeptionell                      |

---

## Verbleibende offene Punkte aus älterem BACKLOG (05.08.2026)

Diese Punkte aus dem vorherigen Backlog bleiben relevant und sind hier der Vollständigkeit halber aufgeführt:

| Item | Aufwand (Schätzung) | Status | Hinweis |
|------|---------------------|--------|--------|
| Fiscal-Bridge an echten Discovery-Workflow anschließen | ~1 Tag | ⬜ offen | Modul fertig (`server/fiscal-bridge.ts`), nur Anschluss fehlt |
| `inCapitulation` vs. `minerZone.zone` Namensklärung / Konsistenz | ~2 h | ⬜ offen | Dokumentierte Inkonsistenz, kein Crash |
| **Gold Multi-Faktor-Modell Phase 2 (WALCL, DXY, Multi-OLS) + QE/QT-Regime** | 1–2 Tage | ⬜ offen | Explizit als TODO in `gold-realyield-model.ts` + neu detailliert für BTC und Gold (19.08.2026) |
| Screener-Gates + Backtesting (Vollversion) | 2–3 Tage | 🟡 teilweise | Kern-Gate-System läuft |
| Regulatory-Impact auch direkt in Risks/PESTEL-Sektion integrieren | ~3–4 h | 🟡 teilweise | Lazy über PESTEL-KI-Panel vorhanden |

---

## Nächste Schritte (Vorschlag)

1. **Priorisierte Umsetzungs-Roadmap** mit Aufwandsschätzung und Abhängigkeiten erstellen.
2. Detaillierte Specs für die Hoch-Priorität-Items (i18n, Wertschöpfungskette, Sektorrotation, BTC M2/Fiscal, **Gold/BTC WALCL-QE-QT Phase 2**, Gold AISC).
3. Konsistenz-Fixes (`inCapitulation` / `minerZone`) als Quick-Win.
4. **Segment-Deduplizierung** als Quick-Win (~1–2 h) – verhindert doppelte AWS-/Cloud-Balken bei AMZN, MSFT etc. → [WORK_SEGMENT_DEDUP.md](./WORK_SEGMENT_DEDUP.md)
5. **Researcher Sector Opportunity Add-Buttons** als Quick-Win (~30–60 min) → [WORK_RESEARCHER_SECTOR_ADD.md](./WORK_RESEARCHER_SECTOR_ADD.md)
6. **Portfolio Performance Attribution (erster Backtesting-Block)** → [WORK_PORTFOLIO_BACKTEST.md](./WORK_PORTFOLIO_BACKTEST.md)

---

*Erstellt am 16.08.2026 · Aktualisiert 17.08.2026 (Segment-Dedup + Detail-Spec) · Aktualisiert 19.08.2026 (WALCL / QE-QT Phase-2 + Researcher Sector Add-Buttons + Portfolio Backtest Spec) · Referenz-Repo: https://github.com/1719842374/Aktienanalyst*
