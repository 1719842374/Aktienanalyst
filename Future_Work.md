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
| **Virtuelles Portfolio** + CAPM / Kelly / Sharpe / Gewichtungsmodi A/B/C + Pie-Chart + Positions-Tracker + „Aus Analyse übernehmen“ + Watchlist + Researcher-Portfolios | ✅ (stark erweitert seit BACKLOG 05.08.) | `client/src/pages/PortfolioPage.tsx`, `client/src/lib/portfolio/*`, `fertig_WORK_PORTFOLIO.md` |
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
→ [fertig_WORK_RESEARCHER_SECTOR_ADD.md](./fertig_WORK_RESEARCHER_SECTOR_ADD.md)

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
→ [fertig_WORK_PORTFOLIO_BACKTEST.md](./fertig_WORK_PORTFOLIO_BACKTEST.md)

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
  **Detail-Spec:** [fertig_WORK_SEGMENT_DEDUP.md](./fertig_WORK_SEGMENT_DEDUP.md)  
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
| **Hoch**  | **Portfolio Performance Attribution / Backtesting vs. Benchmark** | neu 19.08.2026 → [fertig_WORK_PORTFOLIO_BACKTEST.md](./fertig_WORK_PORTFOLIO_BACKTEST.md) |
| **Mittel**| Monte-Carlo flexibel                       | offen                                   |
| **Mittel**| Bilanzen-Red-Flag-Screener                 | offen                                   |
| **Mittel**| Rezession: Google Trends + KI-Fazit        | offen                                   |
| **Mittel**| Konfliktmatrix im Fazit                    | teilweise                               |
| **Mittel**| Segment-Deduplizierung (Produkt/Geo)       | offen (Quick-Win ~1–2 h) → [fertig_WORK_SEGMENT_DEDUP.md](./fertig_WORK_SEGMENT_DEDUP.md) |
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
4. **Segment-Deduplizierung** als Quick-Win (~1–2 h) – verhindert doppelte AWS-/Cloud-Balken bei AMZN, MSFT etc. → [fertig_WORK_SEGMENT_DEDUP.md](./fertig_WORK_SEGMENT_DEDUP.md)
5. **Researcher Sector Opportunity Add-Buttons** als Quick-Win (~30–60 min) → [fertig_WORK_RESEARCHER_SECTOR_ADD.md](./fertig_WORK_RESEARCHER_SECTOR_ADD.md)
6. **Portfolio Performance Attribution (erster Backtesting-Block)** → [fertig_WORK_PORTFOLIO_BACKTEST.md](./fertig_WORK_PORTFOLIO_BACKTEST.md)

---

*Erstellt am 16.08.2026 · Aktualisiert 17.08.2026 (Segment-Dedup + Detail-Spec) · Aktualisiert 19.08.2026 (WALCL / QE-QT Phase-2 + Researcher Sector Add-Buttons + Portfolio Backtest Spec) · Referenz-Repo: https://github.com/1719842374/Aktienanalyst*

### NEU (11.10.2026) — Peer hinzufügen funktioniert nicht zuverlässig

**Bug / Feature-Gap (hohe Priorität)**

Im Peer-Vergleich (Sektion 7 / `PeerComparison.tsx`) funktioniert das manuelle Hinzufügen eines Tickers nicht zuverlässig:

- Manuelle Eingabe eines Tickers (z. B. „LLY“) lädt nicht oder wird nicht angezeigt.
- Nach Reload der Seite ist der hinzugefügte Peer verschwunden.
- Caching-Probleme: Overrides werden nicht korrekt im Analyse-Cache berücksichtigt oder die Response wird nicht neu geladen.
- Die UI zeigt den Peer nicht sofort nach dem Klick auf „+ Peer hinzufügen“.

**Ursachenanalyse (Code-Fakten):**

1. **Frontend (`PeerComparison.tsx`)**  
   - `handleAdd()` ruft nur `onOverridesChange({ add: [...], remove: [...] })` auf.  
   - Es gibt keinen direkten API-Call oder Trigger für einen erneuten Analyse-Request.  
   - Die Anzeige hängt davon ab, dass der Parent (`StockAnalysis` / Dashboard) die Overrides an `/api/analyze` weitergibt und die neue Response zurückliefert.  
   - Wenn der Parent nicht sofort neu analysiert oder der Cache den alten Key verwendet, bleibt die Tabelle unverändert.

2. **Cache-Key (`peer-cache-key.ts`)**  
   - `buildAnalyzeCacheKey` berücksichtigt `peerAddList` und `peerRemoveList`.  
   - Root-Cause früherer Bugs: Listen wurden nicht sortiert/dedupliziert → unterschiedliche Keys für semantisch gleiche Overrides.  
   - Aktuell normalisiert, aber wenn der Client die Overrides nicht korrekt an den Analyse-Call anhängt oder der Cache nicht invalidiert wird, greift der alte Eintrag.

3. **Backend-Anwendung (`applyPeerOverrides`)**  
   - Overrides werden nur angewendet, wenn der Analyse-Endpoint mit den neuen `peerOverrides` aufgerufen wird.  
   - Kein separater Lightweight-Endpoint für Peer-Updates (immer volle Analyse nötig).

4. **Fehlende Analogie zu TickerSearch**  
   - Die Haupt-Ticker-Suche (`TickerSearch.tsx`) hat Autocomplete, Validierung und direkten Analyse-Trigger.  
   - Das Peer-Input-Feld ist ein einfaches `<input>` ohne Suche, ohne Validierung und ohne sofortiges Feedback.

**Anforderungen / Fix-Vorschlag:**

- Peer-Hinzufügen soll **analog zur Aktienanalyse-Ticker-Suche** funktionieren:  
  - Autocomplete / Vorschläge (optional).  
  - Sofortiges Feedback (Loading-State).  
  - Trigger eines neuen Analyse-Calls mit den aktualisierten `peerOverrides`.  
  - Persistenz über Reload (Overrides im Request-Body oder localStorage + Cache-Key).  
  - Korrekte Cache-Invalidierung oder Force-Refresh bei Override-Änderung.

- Minimaler Fix:  
  1. Parent-Komponente muss bei `onOverridesChange` sofort `/api/analyze` mit neuem Body aufrufen.  
  2. Cache-Key muss die normalisierten Overrides enthalten (bereits implementiert).  
  3. UI zeigt Loading und aktualisiert die Tabelle aus der neuen Response.

**Aufwand:** 2–4 Stunden (Frontend-Trigger + Cache-Prüfung + Test).

**Priorität:** Hoch (Peer-Vergleich ist Kern der relativen Bewertung).

### NEU (11.10.2026) — Credit Spread / CDS-Overlay in der Technischen Analyse

**Ziel:** Unternehmens-Anleihenrenditen oder Credit Spreads (bzw. CDS) als Overlay im technischen Chart plotten, um Kreditwürdigkeitsrisiken sichtbar zu machen. Steigende Risk Premia signalisieren höhere Ausfallwahrscheinlichkeit.

**Oracle als aktuelles Beispiel (Stand 2026):**
- 5Y CDS von ~50–60 bp auf 198–260 bp gestiegen (Allzeithoch).
- Langfristige Anleihenrenditen ~7,5–8,1 % (deutlich über Treasury).
- S&P-Rating auf BBB- (unterste Investment-Grade-Stufe).
- Aktienkurs unter Druck, während der Bond-/CDS-Markt die Verschlechterung früher und klarer zeigte.
- Interpretation: Steigender Credit Spread / CDS = Markt verlangt mehr Entschädigung für höheres Ausfallrisiko.

**1. Datenquelle**
| Serie | Quelle | Verfügbarkeit | Hinweis |
|-------|--------|---------------|---------|
| Credit Spread (Bond Yield – Treasury) | FMP / Yahoo Bonds / Trace | Teilweise | Für liquide Titel (ORCL, META, AVGO etc.) machbar |
| CDS Spread (5Y) | Markit / ICE / Anbieter | Eingeschränkt | Oft nicht frei; Fallback auf Bond Spread |
| Bond Yield (langfristig) | Unternehmensanleihe | Mittel | Absolute Finanzierungskosten |

**2. Chart-Overlay (Technische Analyse)**
- Dual-Axis oder eigener Unterchart unter dem Preis.
- Steigender Spread als Warnband oder Overlay markieren.
- Toggle „Credit Spread / CDS“ analog zu bestehenden Makro-Overlays.
- Tooltip: aktueller Spread in bp, Veränderung, Quelle.

**3. Scoring-Integration**
- Spread-Anstieg (z-Score oder relative Veränderung über 3–6 Monate) als negatives Signal in der Risk-/Credit-Dimension.
- Bei starkem Anstieg (z. B. z > 1,5 oder +100 bp) Gewicht der Valuation dämpfen (analog zu Death Cross / Technical-Stärke).
- Optionaler Gate `CREDIT_SPREAD_STRESS` (Warnung, kein harter Cap).
- Integration in die adaptive Layer-Gewichtung: Credit-Stärke erhöht das Gewicht der Risk-Dimension und dämpft Valuation bei Extremen.

**Einschränkungen**
- CDS-Daten sind oft nicht frei verfügbar.
- Bond-Yields über FMP/Yahoo sind machbar, aber nicht für alle Titel liquide.
- Relevant vor allem für große, hochverschuldete Titel (Oracle, Meta, Broadcom etc.).

**Aufwand:** 1–2 Tage (Daten-Fetch, Chart-Overlay, Scoring-Verdrahtung, Tests mit ORCL).
**Priorität:** Mittel–Hoch (starker Early-Warning-Indikator für Kreditrisiken).

### NEU (11.10.2026) — Volle Adaptivität im Aktien-Scoring (Philip-Vorschlag)

> Quelle: Philip, 11.10.2026 22:37 (Europe/Berlin), Inhalt wörtlich übernommen. Hier ist er nur strukturiert, die Formeln sind unverändert.

**Ziel:** Der Score soll generisch und vollständig adaptiv sein, ohne feste Schwellen. Dazu kommen relative Stärke für alle Signale, dynamische Basisgewichte und ein kalibrierter Dämpfungsfaktor. Low-Beta ist kein automatischer Kaufgrund. Das Fazit kommt aus einem gewichteten Score statt aus einer Zählung.

**NVO-Erwartung:** **negativ (rot).**

#### 1. Relative Stärke für alle Signale (z-Score / Perzentil)

```ts
interface Signal {
  id: string;
  direction: 1 | -1 | 0;
  strength: number; // 0–1
}

function toStrength(z: number): number {
  return Math.min(1, Math.abs(z) / 2.5);
}

function technicalStrength(t: { deathCross: number; belowMA200: number; macdNeg: number; rslWeak: number }): Signal {
  const raw = t.deathCross * 0.4 + t.belowMA200 * 0.3 + t.macdNeg * 0.2 + t.rslWeak * 0.1;
  return { id: "technical", direction: raw > 0.5 ? -1 : 1, strength: Math.min(1, raw) };
}

function moatStrength(moat: number): Signal {
  const z = (moat - 2.5) / 1.5;
  return { id: "moat", direction: z > 0 ? 1 : -1, strength: toStrength(z) };
}
```

**Datenbedarf:** historische Verteilung von RSL, MA-Lage und Moat pro Aktie bzw. Sektor. Fallback ist ein rollierendes Fenster von 2–5 Jahren.

#### 2. Basisgewichte aus relativer Stärke

Keine festen Gewichte wie 1,6 / 1,4 mehr. Das Gewicht liegt etwa bei 0,8–1,5.

```ts
function deriveBaseWeights(signals: Signal[]): Record<string, number> {
  const weights: Record<string, number> = {};
  for (const s of signals) weights[s.id] = 0.8 + s.strength * 0.7;
  return weights;
}
```

#### 3. Dämpfungsfaktor kalibrieren statt fest 0,45

```ts
function calibrateDamping(historicalCases: { techStrength: number; subsequentReturn: number }[]): number {
  // Grid f = 0.2 .. 0.6, step 0.05 → das f mit maximaler Korrelation
  // (gedämpfte Valuation vs. subsequentReturn) gewinnt.
  let best = 0.2, bestCorr = -Infinity;
  for (let f = 0.2; f <= 0.6 + 1e-9; f += 0.05) {
    const corr = correlationFor(historicalCases, f); // Hilfsfunktion, offline
    if (corr > bestCorr) { bestCorr = corr; best = f; }
  }
  return best;
}

// online:
const effectiveValuation = baseValuation * (1 - techStrength * dampingFactor);
```

Zum Start gilt ein fester Wert von 0,35–0,45. Die Kalibrierung läuft parallel (Offline-Skript plus Config).

#### 4. Low-Beta relativ

```ts
function lowBetaSignal(beta: number, techStrength: number): Signal | null {
  if (!(beta < 0.7)) return null;
  return { id: "lowBeta", direction: techStrength > 0.6 ? -1 : 1, strength: 0.3 };
}
```

#### 5. Gesamtfluss

```ts
function computeAdaptiveScore(signals: Signal[]): number {
  const baseWeights = deriveBaseWeights(signals);
  const tech = signals.find(s => s.id === "technical");
  let net = 0, max = 0;
  for (const s of signals) {
    let w = baseWeights[s.id];
    if (s.id === "valuation" && tech && tech.strength > 0.5) w *= (1 - tech.strength * 0.4);
    net += s.direction * s.strength * w;
    max += w;
  }
  return max > 0 ? net / max : 0;
}
```

#### 6. Umsetzungsschritte

| Schritt | Datei | Aufwand |
|---|---|---|
| Relative Stärke für Technical & Moat | `server/scoring-integration.ts` oder neu `adaptive-signals.ts` | mittel |
| Basisgewichte dynamisch | neu | niedrig |
| Dämpfung kalibrieren | Offline-Skript + Config | mittel |
| Low-Beta relativ | Summary / Scoring | niedrig |
| Fazit aus gewichtetem Score statt Zählung | `client/src/components/sections/SummarySection.tsx` | mittel |
| Tests: NVO + weitere | `script/` | mittel |

#### 7. NVO qualitativ

- Die Technical-Stärke ist hoch. Damit steigt ihr Gewicht, und die Valuation wird gedämpft.
- Moat ist negativ und bekommt ein eigenes Gewicht.
- Low-Beta gibt kein Plus.
- Der Gesamtscore fällt defensiver aus als die 9/6-Zählung. Erwartung: **negativ (rot)**.

**Fazit (Philip):** Relative Stärke, dynamische Basisgewichte und ein kalibrierter Dämpfungsfaktor machen den Score vollständig adaptiv und generisch, ohne feste Schwellen. Low-Beta ist kein automatischer Kaufgrund.

#### Bezug zum Ist-Stand (Befunde W5, main `4d4dd00`)

- **Gesamtscore:** Technik wirkt nur als weiche Komponente, maximal ±0,5 (`technicalComponentOf` in `shared/bias-fixes.ts`). Das entspricht `fertig_WORK_BIAS_FIXES_INVERSE_DCF.md` §6 („Technical analysis remains a separate soft component“). NVO kam so auf 8,17 ATTRAKTIV, die Technik kostete nur −0,5.
- **PDF:** `server/pdf-export.ts` `buildFazit` hatte eine eigene, veraltete Fazit-Logik: anderer DCF ohne gehärteten Inverse-DCF, andere Schwellen, Max-Entry `/4` statt `/3`. Daher stand im PDF für NVO STARK UNATTRAKTIV, in der App ATTRAKTIV.
- **Doppelzählung:** RSL und Technik zählten im Signal-Score (`client/src/lib/fazit-signal.ts`) zusätzlich je ±1, also doppelt neben der ±0,5-Komponente.
- **Low-Beta-Plus:** Beta < 0,8 ergibt pauschal einen Positivpunkt („Niedrige Volatilität – defensiv“), auch bei schwacher Technik. Punkt 4 oben ersetzt das.
- **W5** (Branch `werki/w5-ta-weight`: Technik weich im Signal-Score, PDF = App-Logik) ist **zurückgestellt (ON HOLD)**. Mit W5 käme NVO auf ATTRAKTIV und nicht auf negativ, das widerspricht der Erwartung oben. Die Umsetzung folgt diesem Abschnitt.

**Priorität:** Hoch (Konsistenz von Fazit, App und PDF, NVO-Erwartung).
