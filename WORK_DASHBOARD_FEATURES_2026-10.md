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

## 4. AI-Chatbot im Interface

### Ziel
Schwebendes Chat-Fenster, das auf den aktuellen Analysedaten antwortet und direkt an die Scoring-Gate-Logik und die 20 Sektionen angebunden ist.

**Visuelles Beispiel (Screenshot 24.10.2026 – SAP-Analyse):**
- Schwebendes Chat-Widget unten rechts mit der Frage „Was sollen wir erkunden?“
- Eingabefeld: „Geben Sie @ ein, um Ihre Apps zu suchen (KI-Agent)“
- Das Widget liegt über der Executive Summary und den positiven/negativen Faktoren.

**Funktionen:**
- Automatische Anbindung an die aktuelle Analyse (alle 20 Sektionen + Scoring-Gates).
- User kann sich jede Sektion detailliert und beispielhaft erklären lassen (z. B. „Erkläre mir den gehärteten Inverse-DCF bei SAP“ oder „Warum greift hier kein Gate?“).
- Die KI kann Szenarien automatisch overriden (z. B. „Was passiert, wenn das Wachstum auf 3 % fällt?“ → DCF und Ampel werden neu berechnet und erklärt).
- Kontext: Letzter Earnings-Call, historische Beat/Miss-Raten, Peer-Vergleiche, aktuelle Scoring-Pipeline.

**Beispiel-Fragen:**
- „Warum ist der Inverse-DCF so viel höher als der Kurs?“
- „Erkläre mir die Scoring-Gates bei dieser Analyse.“
- „Was hat das Management im letzten Call zu Pricing gesagt?“
- „Wie hat sich die Bruttomarge in den letzten 8 Quartalen entwickelt?“
- „Override: Was passiert, wenn das Revenue-Wachstum nur noch 3 % ist?“

**Technik:**  
Claude Haiku / GPT-4o-mini (oder OpenRouter), Streaming, kein freier Chat (nur zum aktuellen Ticker und dessen Analyse).

**Aufwand:** ~12–16 Stunden.

---

## 4b. Event hinzufügen Button in Sektion 17 (Katalysatoren / DCF)

### Ziel
In Sektion 17 (Katalysatoren) einen „Event hinzufügen“-Button analog zum Peer-Ticker-Hinzufügen in Sektion 9 (Relative Bewertung). User kann Events mit KI-Logik hinzufügen; diese fließen automatisch in den DCF ein.

### Mechanismus
- Button „Event hinzufügen“ neben den bestehenden Katalysatoren.
- Eingabe: Freitext oder strukturierte Felder (z. B. „Cloud-Adoption beschleunigt sich 2027“).
- KI berechnet nach festem Schema den Impact:
  - Betroffene Variable (Revenue Growth, Margin, Capex, etc.)
  - Richtung und Stärke (+ / −)
  - Zeitlicher Horizont (1–3 Jahre)
  - Wahrscheinlichkeit
- Der berechnete Impact wird als zusätzlicher Katalysator gespeichert und in den gehärteten Inverse-DCF und die Scoring-Gates eingerechnet.
- User kann das Event später entfernen oder anpassen (wie Peer-Overrides).

### Schema (KI-Vorgabe)
```json
{
  "event": "Cloud-Adoption beschleunigt sich",
  "impactOn": "revenueGrowth",
  "delta": "+1.5pp",
  "horizon": "2027–2028",
  "probability": 0.6,
  "dcfEffect": "g1 +1.2pp"
}
```

### Beispiel
User fügt hinzu: „SAP gewinnt großen Public-Cloud-Deal 2027“.  
KI schlägt vor: Revenue Growth +1.5 pp in 2027, Wahrscheinlichkeit 55 %.  
Der DCF wird neu gerechnet und der Effekt in Sektion 17 und im Executive Summary angezeigt.

**Aufwand:** ~8–10 Stunden (UI-Button, KI-Schema, DCF-Integration, Persistenz).

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
| AI-Chatbot (mit Sektions-Erklärung + Szenario-Override) | Mittel–Hoch | Hoch | 6 |
| Event hinzufügen (Sektion 17) | Mittel | Mittel | 7 |

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
- **Screenshot 24.10.2026:** Schwebendes Chat-Widget („Was sollen wir erkunden?“) über der SAP-Executive-Summary

Diese Referenzen dienen als visuelles Ziel für die Umsetzung.

---

**Nächster Schritt:**  
Agents können die Prioritäten abarbeiten. Detailed Financials und Peer-Overlay haben den höchsten unmittelbaren Nutzen.
