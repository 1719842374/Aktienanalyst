# WORK – Dashboard Features (Oktober 2026)

**Stand:** 18.10.2026  
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

## 4. AI-Chatbot im Interface

### Ziel
Schwebendes Chat-Fenster, das auf den aktuellen Analysedaten antwortet.

**Kontext, den der Bot kennt:**
- Alle 20 Sektionen der aktuellen Analyse
- Letzter Earnings-Call (Datum + Inhalt)
- Historische Beat/Miss-Raten
- Peer-Vergleiche

**Beispiel-Fragen:**
- „Warum ist der Inverse-DCF so viel höher als der Kurs?“
- „Was hat das Management im letzten Call zu Pricing gesagt?“
- „Wie hat sich die Bruttomarge in den letzten 8 Quartalen entwickelt?“

**Technik:**  
Claude Haiku / GPT-4o-mini, Streaming, kein freier Chat (nur zum aktuellen Ticker).

**Aufwand:** ~12–16 Stunden.

---

## 5. Screener – Custom Criteria

### Ist
- Preset-Screens (Buffett, GARP, 13F-Holdings)
- Keine individuellen Filter

### Soll
- Custom Screen mit Filtern:
  - Market Cap (z. B. > 10 Mrd.)
  - Industry (Multi-Select)
  - Country (USA, CAN, AUS …)
  - ROIC > x %
  - Forward P/E < x
  - Revenue Growth
  - EBIT Margin

**FMP-Quelle:** `/stable/stock-screener` + Company Profile + Key Metrics.

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
| AI-Chatbot | Mittel–Hoch | Hoch | 6 |

---

## 7. Design-Referenzen (Bilder aus Chat)

- TIKR Detailed Financials (Multi-Jahr-Tabelle mit YoY)
- TIKR Earnings Call Transcript
- Sankey „How Microsoft Makes Its Money“ (Income Statement Flow)
- Sankey Balance Sheet (Assets → Liabilities + Equity)
- Fiscal.ai Earnings Chart (Beat/Miss Marker)
- TIKR Global Screener (Custom Criteria)
- TIKR Custom Dashboard (Watchlist-Tabelle)
- GuruAI Chat-Interface

Diese Referenzen dienen als visuelles Ziel für die Umsetzung.

---

**Nächster Schritt:**  
Agents können die Prioritäten abarbeiten. Detailed Financials und Peer-Overlay haben den höchsten unmittelbaren Nutzen.
