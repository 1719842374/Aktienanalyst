# WORK – Dashboard Features (Oktober 2026)

**Stand:** 18.10.2026 (aktualisiert 24.10.2026)  
**Ziel:** Design- und Funktionsziele für das Aktienanalyst-Dashboard dokumentieren, damit Agents die visuellen Referenzen und Anforderungen sehen.

---

## 1. Financial Statements – mehr Tiefe + Sankey

### Ist (aktuell)
- TTM-Werte in drei Karten (Income, Balance, Cash Flow)
- Margen-Wasserfall (Brutto → EBITDA → Operativ → Netto → FCF)
- Keine Multi-Jahr-Tabelle, keine YoY pro Zeile

### Soll (Inspiration: TIKR + Sankey-Bilder)

| Feature | Beschreibung | FMP-Quelle | Aufwand |
|---------|--------------|------------|---------|
| 8–10 Jahres-Tabelle | Annual Income / Balance / Cash Flow | `/stable/income-statement?period=annual` etc. | Mittel |
| YoY-Veränderung | Pro Zeile in Klammern, farbig (grün/rot) | Lokal berechnet | Niedrig |
| Margen-Historie | Gross, Operating, Net, FCF pro Jahr | Aus Income Statement | Niedrig |
| Sankey Income Statement | „How the company makes money“ – Segmente → Revenue → Gross Profit → Op. Income → Net Income + Kostenabflüsse | Segmente + Income Statement | Hoch |
| Sankey Balance Sheet | Assets (links) → Total Assets → Liabilities + Equity (rechts) | Balance Sheet | Hoch |

**Sankey-Referenz (Microsoft FY2026):**
- Productivity & Business Processes $140.0B (42.2 %)
- Intelligent Cloud $137.8B (41.5 %)
- More Personal Computing $54.1B (16.3 %)
- Revenue $331.8B → Gross Profit $225.5B (67.9 %) → Op. Income $155.2B (46.8 %) → Net Income $133.7B (40.3 %)
- COGS $106.4B, SG&A $34.7B, R&D $35.6B, Tax $32.2B

**Empfehlung:**  
Zuerst die Multi-Jahr-Tabelle mit YoY. Sankey als optionale zweite Ansicht in Sektion 4.

---

## 2. Earnings Beat/Miss Overlay in Technischer Analyse (Sektion 12)

### Ziel
Auf dem bestehenden Kurs-Chart Earnings-Events als Marker einzeichnen.

| Element | Beschreibung |
|---------|--------------|
| Marker | Grün = Beat, Rot = Miss, Grau = Inline |
| Position | Auf dem Kurs zum Earnings-Datum |
| Tooltip | Revenue Actual/Estimate, Surprise %, EPS Surprise % |
| Beat-Rate Badge | „Revenue Beat 32/39 (82 %)“ oben rechts |
| Toggle | Ein-/ausblendbar analog zu MA, RSI, MACD |

**Datenquelle:**  
`/stable/earnings-surprises?symbol=NVO` + Fallback auf Income Statement + Analyst Estimates.

**Aufwand:** ~8–10 Stunden.

---

## 3. Peer-Kurs-Historie in Technischer Analyse (Sektion 12)

### Ist
- 3 separate Fenster (Kurs A / B / C)
- Kein Peer-Overlay im Hauptchart

### Soll
- Im Hauptchart und in den Fenstern Peer-Ticker als zusätzliche Kurslinie hinzufügen können
- Toggle pro Peer (ein-/ausblenden)
- Normalisiert oder absolut (wählbar)
- Max. 3–4 Peers gleichzeitig

**Beispiel:**  
NVO-Hauptchart + LLY und PFE als Overlay-Linien.

**Aufwand:** ~6–8 Stunden (Daten holen, Chart-Overlay, Toggle-UI).

---

## 4. AI-Chatbot im Interface (Aktien)

### Ziel
Schwebendes Chat-Fenster, das auf den aktuellen Analysedaten antwortet und direkt an die Scoring-Gate-Logik und die 20 Sektionen angebunden ist.

**Visuelle Beispiele (Screenshots 24.10.2026 – SAP-Analyse):**
1. Erstes Widget: Schwebendes Chat-Fenster unten rechts mit „Was sollen wir erkunden?“ über der Executive Summary.
2. Zweites Widget: Fenster mit Titelleiste (Zurück, Minimieren, Maximieren, Schließen) und Resize-Handle unten rechts.

**UI-Anforderungen:**
- **Verschiebbar:** Das Widget kann per Drag & Drop frei auf dem Bildschirm positioniert werden.
- **Vergrößer- / Verkleinerbar:** Der User kann die Größe des Chat-Fensters ändern (Resize-Handles an den Ecken oder Rändern).
- **Fenster-Controls:** Minimieren, Maximieren, Schließen in der Titelleiste.
- Die Position und Größe werden im LocalStorage gespeichert, damit sie nach Reload erhalten bleiben.

**Funktionen:**
- Automatische Anbindung an die aktuelle Analyse (alle 20 Sektionen + Scoring-Gates).
- User kann sich jede Sektion detailliert und beispielhaft erklären lassen.
- Die KI kann Szenarien automatisch overriden (DCF, Gates, Ampel neu berechnen).
- Kontext: Earnings-Call, Beat/Miss-Raten, Peers, Scoring-Pipeline.

**Technik:** Claude Haiku / GPT-4o-mini (oder OpenRouter), Streaming.

**Aufwand:** ~12–16 Stunden (inkl. Drag, Resize und Fenster-Controls).

---

## 4b. Event hinzufügen Button in Sektion 17 (Katalysatoren / DCF)

### Ziel
In Sektion 17 einen „Event hinzufügen“-Button analog zum Peer-Ticker-Hinzufügen in Sektion 9. Events werden per KI-Schema berechnet und fließen in den DCF ein.

**Mechanismus:** Freitext oder strukturierte Eingabe → KI berechnet Impact nach Schema (Variable, Delta, Horizont, Wahrscheinlichkeit) → DCF und Gates werden aktualisiert.

**Aufwand:** ~8–10 Stunden.

---

## 4c. Vollständige interaktive KI-Chatbot-Anbindung für alle Assets

### Ziel
Die interaktive Chatbot-Logik (Sektions-Erklärung + Szenario-Override + Event-Hinzufügen) soll nicht nur für die Aktien-Analyse, sondern auch für die anderen Assets im Projekt übertragen werden.

### Assets

| Asset | Sektionen / Module | Beispiel-Override | Aufwand (zusätzlich) |
|-------|---------------------|-------------------|--------------------------|
| **Aktien** | 1–20 + Gates | g1, WACC, Margen, Events | Basis (siehe 4 + 4b) |
| **BTC** | Liquidität, Miner, Technische Analyse, Gates | Hashrate, Fee-Market, Liquiditäts-Index | ~6–8 h |
| **Gold** | Adaptive Gates, AISC, Makro-Overlays, Technische Analyse | Realzinsen, AISC-Stress, Geopolitik-Event | ~5–7 h |
| **Rezession** | Scoring (5 Untergruppen), Buffett, VIX, Yield Curve | Habitat, Konzentration, LLM-Flag | ~6–8 h |

### Gemeinsame Architektur
- Ein gemeinsames Chat-Widget, das den aktuellen Kontext (Asset + geladene Daten) erkennt.
- Pro Asset ein Schema für Szenario-Overrides und Events.
- Die KI nutzt die jeweilige Scoring-/Gate-Logik des Assets (nicht hardcodiert).
- Persistenz der User-Events / Overrides pro Asset und Ticker/Zeitpunkt.
- **Das Widget ist überall verschiebbar, in der Größe anpassbar und hat Fenster-Controls** (gleiche UI-Anforderungen wie bei Aktien).

### Beispiel-Fragen pro Asset
- **BTC:** „Was passiert, wenn die Hashrate um 20 % fällt?“
- **Gold:** „Override: Realzinsen steigen um 50 bp – wie ändert sich das Stress-Signal?“
- **Rezession:** „Was, wenn der Buffett-Indikator auf 180 % fällt?“

**Gesamtaufwand für Übertragung:** ~17–23 Stunden (nachdem die Aktien-Basis steht).

---

## 5. Screener – Custom Criteria

### Ist
- Preset-Screens (Buffett, GARP, 13F-Holdings)
- Keine individuellen Filter

### Soll
- Custom Screen mit Filtern (Market Cap, Industry, Country, ROIC, Forward P/E, etc.).

**Aufwand:** ~8–12 Stunden.

---

## 6. Priorisierung

| Feature | Nutzen | Aufwand | Priorität |
|---------|--------|---------|-----------|
| Detailed Financials (10 Jahre + YoY) | Hoch | Mittel | 1 |
| Peer-Kurs-Overlay (Sektion 12) | Hoch | Mittel | 2 |
| Earnings Beat/Miss Overlay | Hoch | Mittel | 3 |
| Screener Custom Criteria | Hoch | Mittel | 4 |
| Sankey Income / Balance | Mittel | Hoch | 5 |
| AI-Chatbot Aktien (Sektions-Erklärung + Override + Drag/Resize + Controls) | Mittel–Hoch | Hoch | 6 |
| Event hinzufügen (Sektion 17) | Mittel | Mittel | 7 |
| KI-Chatbot Übertragung auf BTC / Gold / Rezession | Mittel | Hoch | 8 |

---

## 7. Design-Referenzen (Bilder aus Chat)

- TIKR Detailed Financials, Earnings Call, Sankey, Fiscal.ai, Screener, GuruAI
- **Screenshot 24.10.2026 (1):** Schwebendes Chat-Widget über der SAP-Executive-Summary
- **Screenshot 24.10.2026 (2):** Chat-Widget mit Titelleiste (Minimieren, Maximieren, Schließen) und Resize-Handle

---

**Nächster Schritt:**  
Agents können die Prioritäten abarbeiten. Die Aktien-Chatbot-Basis sollte vor der Übertragung auf die anderen Assets stehen.
