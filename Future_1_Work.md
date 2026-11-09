# Work.md – FMP 402-Fehler bei deutschen Aktien (VOW3.DE) + Yahoo-Finance-Fallback

**Stand:** 09. Oktober 2026  
**Projekt:** Aktienanalyst (https://aktienanalyst.onrender.com)  
**GitHub:** https://github.com/1719842374/Aktienanalyst  
**Fehlerbild:** „Analyse fehlgeschlagen – FMP-Fehler HTTP 402 für VOW3.DE“

---

## 1. Problembeschreibung

### Beobachtetes Verhalten
- Analyse von **VOW3.DE** (Volkswagen Vorzugsaktie, Xetra) schlägt fehl.
- Fehlermeldung im Frontend:  
  `Analyse fehlgeschlagen`  
  `FMP-Fehler HTTP 402 für VOW3.DE.`
- **BMW** funktionierte (auch ohne `.DE`-Suffix).
- VW wurde im Interface als anderer Ticker angezeigt, hat aber trotzdem nicht geladen (auch ohne `.DE`).

### Technische Einordnung
| HTTP-Code | Bedeutung bei FMP          | Typischer Grund                          |
|-----------|----------------------------|------------------------------------------|
| 401       | Unauthorized               | API-Key fehlt oder ungültig              |
| 402       | Payment Required           | Plan deckt Endpoint/Symbol/Exchange nicht |
| 403       | Forbidden                  | Key abgelehnt oder missbraucht           |
| 429       | Too Many Requests          | Rate-Limit überschritten                 |

**402 = Plan-Entitlement-Problem**, kein Rate-Limit und kein Key-Fehler.

---

## 2. Datenquellen-Architektur (aktuell)

Laut `DATA_SOURCES.md` und Code:

1. **Primär:** Perplexity Finance Connector (CLI / external-tool)
2. **Fallback:** Financial Modeling Prep (FMP)  
   - Dateien: `server/fmp.ts`, `server/fmp-fetcher.ts`
   - Funktion: `fetchFmpAnalysisData(ticker)`
3. **Kein Yahoo Finance** aktuell integriert

Fallback-Kette bei Analyse:
```
Perplexity Finance → Cache → FMP → (bei Fehler) null → Frontend-Fehler
```

---

## 3. Warum VOW3.DE mit 402 scheitert und BMW funktionierte

### FMP Plan-Abdeckung (Stand 2026)

| Plan       | Geografische Abdeckung (vereinfacht) | Deutsche Aktien (.DE / Xetra)     |
|------------|--------------------------------------|-----------------------------------|
| Basic      | Stark US-lastig, EOD                 | Meist blockiert                   |
| Starter    | Primär US                            | Meist blockiert                   |
| Premium    | US + UK + Canada                     | Teilweise / unzuverlässig         |
| Ultimate   | Global (inkl. Europa)                | Funktioniert                      |

**VOW3.DE** ist ein reines Xetra-Symbol (Vorzugsaktie, ISIN DE0007664039).  
Auf unteren Plänen wird es mit **402** abgelehnt.

### Warum BMW funktionierte
- BMW wurde vermutlich **ohne `.DE`** aufgelöst (z. B. zu einem anderen Listing oder über den primären Connector).
- Der primäre Perplexity-Finance-Connector hat die Daten geliefert → FMP-Fallback wurde nicht ausgelöst.
- Bei VOW3.DE ist der Primärweg gescheitert → FMP wurde gerufen → 402.

### Interface vs. Backend
- **Backend:** Der 402 kommt eindeutig vom FMP-Call in `fmp-fetcher.ts` / `fmp.ts`.
- **Interface:** Zeigt den Fehler nur an. Es gibt keine zusätzliche Blockade im Frontend.
- Beobachtung „VW als anderer Ticker angezeigt, aber nicht geladen“:  
  Die Symbol-Auflösung (Search) hat ein Symbol zurückgegeben, der anschließende Daten-Fetch (FMP) ist aber am Plan-Limit gescheitert.

---

## 4. Konkrete Fakten zu den Tickern

| Ticker     | Unternehmen              | Exchange | ISIN          | Typische FMP-Behandlung auf unteren Plänen |
|------------|--------------------------|----------|---------------|--------------------------------------------|
| VOW3.DE    | Volkswagen AG (Vz.)      | Xetra    | DE0007664039  | 402                                        |
| BMW.DE     | Bayerische Motoren Werke | Xetra    | DE0005190003  | Oft ebenfalls 402                          |
| BMW        | (ohne Suffix)            | variabel | –             | Kann über US-OTC oder anderes Listing laufen |
| SAP.DE     | SAP SE                   | Xetra    | DE0007164600  | Meist 402                                  |

**Symbol-Format bei FMP:**  
Deutsche Aktien werden in der Regel mit `.DE` erwartet. Ohne Suffix kann die Suche auf ein anderes Listing (OTC, ADR etc.) fallen, das auf dem aktuellen Plan freigeschaltet ist.

---

## 5. Yahoo Finance als Workaround

### Status (Oktober 2026)
- Keine offizielle Yahoo-Finance-API seit 2017.
- Unoffizielle Endpoints + Library `yahoo-finance2` funktionieren aktuell für `VOW3.DE`.
- **Zuverlässigkeit:** Mittel. Rate-Limits und plötzliche Endpoint-Änderungen möglich.
- **Geeignet für:** Quote + historische OHLCV (Charts / Technicals).
- **Nicht geeignet für:** Vollständige mehrjährige Fundamentals wie bei FMP.

### Empfohlene Library
```bash
npm install yahoo-finance2
```

---

## 6. Integrationsvorschlag: Yahoo als dritten Fallback

### Ziel-Kette
```
1. Perplexity Finance Connector
2. FMP
3. Yahoo Finance (nur bei FMP-Fehler, besonders 402)
4. Fehler an Frontend
```

### Neue Datei: `server/yahoo-fetcher.ts`

```typescript
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance();

export interface YahooBasicData {
  symbol: string;
  price: number | null;
  currency: string | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  historical: Array<{
    date: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

export async function fetchYahooAnalysisData(ticker: string): Promise<YahooBasicData | null> {
  try {
    console.log(`[Yahoo] Fallback for ${ticker}`);

    const [quote, chart] = await Promise.all([
      yahooFinance.quote(ticker).catch(() => null),
      yahooFinance.chart(ticker, {
        period1: new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000),
        interval: "1d",
      }).catch(() => null),
    ]);

    if (!quote && !chart) return null;

    const historical = (chart?.quotes ?? [])
      .filter((q: any) => q.close != null)
      .map((q: any) => ({
        date: q.date,
        open: q.open ?? 0,
        high: q.high ?? 0,
        low: q.low ?? 0,
        close: q.close ?? 0,
        volume: q.volume ?? 0,
      }));

    return {
      symbol: quote?.symbol ?? ticker,
      price: quote?.regularMarketPrice ?? null,
      currency: quote?.currency ?? null,
      marketCap: quote?.marketCap ?? null,
      pe: quote?.trailingPE ?? null,
      eps: quote?.epsTrailingTwelveMonths ?? null,
      historical,
    };
  } catch (err: any) {
    console.error(`[Yahoo] ${ticker}: ${err?.message}`);
    return null;
  }
}
```

### Einbindung in die bestehende Fallback-Logik

In der Stelle, die `fetchFmpAnalysisData` aufruft (z. B. `analyze-route.ts` oder Analyze-Helper):

```typescript
import { fetchYahooAnalysisData } from "./yahoo-fetcher";

let analysisData = await fetchFmpAnalysisData(ticker);

if (!analysisData) {
  const yahooData = await fetchYahooAnalysisData(ticker);
  if (yahooData) {
    analysisData = mapYahooToInternalShape(yahooData); // Mapping implementieren
    console.log(`[Fallback] Yahoo used for ${ticker}`);
  }
}

if (!analysisData) {
  // Beide Quellen gescheitert → 503 oder klare Fehlermeldung
}
```

### Mapping-Hinweis
Yahoo liefert kein vollständiges Income Statement / Balance Sheet.  
Nur die Felder mappen, die für den Minimal-Betrieb nötig sind (Kurs, Market Cap, PE, historische Preise).

---

## 7. Empfohlene Fixes (priorisiert)

| Priorität | Maßnahme                                      | Aufwand | Wirkung                                      |
|-----------|-----------------------------------------------|---------|----------------------------------------------|
| 1         | Yahoo-Fallback für Quote + History einbauen   | Mittel  | Deutsche Ticker funktionieren wieder (eingeschränkt) |
| 2         | Klarere Fehlermeldung bei 402 im Frontend     | Gering  | Nutzer versteht, dass Plan-Limit vorliegt    |
| 3         | Symbol-Normalisierung prüfen (.DE erzwingen)  | Gering  | Verhindert falsche Auflösung                 |
| 4         | FMP-Plan auf Ultimate prüfen / upgraden       | Kosten  | Volle Fundamentals für .DE-Ticker            |
| 5         | Alternative Datenquelle evaluieren (EODHD etc.)| Mittel | Stabilere Europa-Abdeckung                   |

### Sofort-Maßnahmen im Code
1. In `fmp-fetcher.ts` den 402-Status explizit loggen und weiterreichen.
2. Yahoo nur bei 402 (oder generellem FMP-Fail) aufrufen.
3. Caching für Yahoo-Ergebnisse analog zu FMP (z. B. 24h–7 Tage).
4. Rate-Limit-Schutz bei Yahoo (Delay oder sequenziell).

---

## 8. Testfälle

| Ticker     | Erwartetes Verhalten nach Fix                     |
|------------|---------------------------------------------------|
| VOW3.DE    | Yahoo-Fallback liefert Kurs + History             |
| BMW.DE     | Gleiches Verhalten                                |
| AAPL       | Weiterhin über FMP (kein Yahoo nötig)             |
| Ungültig   | Klare Fehlermeldung, kein Crash                   |

### Manueller Test
```typescript
const data = await fetchYahooAnalysisData("VOW3.DE");
console.log(data?.price, data?.historical?.length);
```

---

## 9. Risiken und Einschränkungen

- **Yahoo ist inoffiziell:** Kann ohne Vorwarnung brechen.
- **Datenqualität:** Delayed Quotes, fehlende Felder bei europäischen Titeln möglich.
- **Rechtliches:** Unoffizielles Scraping – nur für private Nutzung empfohlen.
- **Keine vollständigen Fundamentals:** Für tiefgehende DCF-Analysen reicht Yahoo nicht.

---

## 10. Nächste Schritte

1. `yahoo-finance2` installieren.
2. `server/yahoo-fetcher.ts` anlegen.
3. Fallback-Logik in der Analyse-Route einbauen.
4. Mapping auf internes Datenformat implementieren.
5. Frontend-Fehlermeldung bei 402 verbessern („Plan deckt dieses Symbol nicht ab – Fallback auf Yahoo aktiv“).
6. Testen mit VOW3.DE, BMW.DE, SAP.DE.
7. Optional: FMP-Dashboard prüfen und Ultimate-Plan evaluieren.

---

**Zusammenfassung:**  
Der 402-Fehler bei VOW3.DE ist ein reines FMP-Plan-Problem. Es gibt keine Blockade im Interface – das Backend scheitert am FMP-Call. BMW funktionierte, weil der primäre Connector ausgereicht hat oder das Symbol anders aufgelöst wurde. Yahoo Finance kann als dritter Fallback für Kurse und historische Preise dienen und deutsche Ticker wieder nutzbar machen, bis eine bessere langfristige Datenquelle (FMP Ultimate oder Alternative) verfügbar ist.

---

## 11. Neue Feature-Anforderungen

### 11.1 Dividend Yield als Plot im Technischen Chart

**Anforderung:**  
Im technischen Chart (aktuell Sektion 10) soll die **Dividend Yield** als zusätzliche Plot-Funktion / Overlay angezeigt werden, **falls Dividenden gezahlt werden**.

**Nutzen:**
- Visuelle Darstellung der historischen Dividend Yield über die Zeit.
- Schnelle Einschätzung, ob die Aktie aktuell attraktiv verzinst ist.
- Kombination mit Kursverlauf (z. B. hohe Yield bei fallendem Kurs = Value-Signal).

**Datenquelle:**
- Yahoo Finance: `quote.dividendYield` oder historische Dividenden via `chart` / `quoteSummary`.
- FMP: `/stable/dividends` oder Key Metrics (falls Plan es erlaubt).
- Berechnung: \( \text{Dividend Yield}_t = \frac{\text{Dividende}_{t}}{\text{Kurs}_{t}} \times 100 \)

**Implementierungsvorschlag:**

1. **Daten holen** (in `yahoo-fetcher.ts` oder eigenes Modul):
   ```typescript
   const dividends = await yahooFinance.quoteSummary(ticker, { modules: ["summaryDetail"] });
   const trailingYield = dividends.summaryDetail?.dividendYield ?? null;
   // Historische Dividenden über chart oder separate Endpoint
   ```

2. **Chart-Overlay** in `TechnicalChart.tsx` (Sektion 10):
   - Zweite Y-Achse oder separate Linie unter dem Hauptchart.
   - Nur anzeigen, wenn `dividendYield > 0` oder historische Dividenden vorhanden.
   - Farbe: z. B. grün/orange für Yield-Bereiche (>4 % attraktiv).

3. **Plot-Logik:**
   - X-Achse: Zeit (gleich wie Kurs).
   - Y-Achse: Dividend Yield in %.
   - Optional: Markierungen bei Ex-Dividend-Dates.

**Zuordnung zu Sektionen:**

| Sektion | Name                          | Dividend Yield Integration                          | Priorität |
|---------|-------------------------------|-----------------------------------------------------|-----------|
| 1       | Datenaktualität & Plausibilität | Aktuelle Trailing Dividend Yield als KPI anzeigen  | Hoch     |
| 10      | Technische Analyse            | **Hauptstelle**: Yield als Plot/Overlay im 10Y-Chart | Sehr hoch |
| 4       | Bewertungskennzahlen          | Dividend Yield vs. Sektor / historische Spanne      | Mittel   |
| 17      | Zusammenfassung & Fazit       | Kurzer Hinweis, falls Yield signifikant             | Niedrig  |

**Empfehlung:**  
Primär in **Sektion 10 (Technische Analyse)** als visuellen Overlay.  
Sekundär in **Sektion 1** als aktuelle Kennzahl (neben FCF Yield).

---

### 11.2 Kreditausfallrisiken über Anleiherenditen (Oracle-Beispiel)

**Anforderung:**  
Kreditausfallrisiken über **Anleiherenditen** und CDS-Spreads sichtbar machen (Beispiel Oracle: 5Y-CDS auf Rekordniveau ~230 bps, 2056-Bonds >8 % Yield bei BBB-/Baa2 Rating).

**Nutzen:**
- Frühwarnsignal für hohe Verschuldung / Refinanzierungsrisiko (besonders relevant bei AI-Capex-Boom).
- Vergleich Equity-Risiko vs. Credit-Markt.
- Oracle-Case zeigt: Aktienkurs kann noch stabil sein, während der Bond-Markt bereits höhere Prämien verlangt.

**Datenquellen (Herausforderung):**
- CDS-Spreads und einzelne Anleiherenditen sind **nicht frei** über FMP oder Yahoo verfügbar.
- Mögliche Quellen:
  - FRED (für Treasury Yields als Benchmark).
  - Manuelle Eingabe oder externe API (z. B. Bloomberg Terminal, Refinitiv, oder spezialisierte Credit-APIs).
  - Für erste Version: Statische Kennzahlen oder LLM-gestützte Zusammenfassung aus aktuellen News.

**Implementierungsvorschlag:**

1. **Neue Datenfelder** im Analyse-Response:
   ```typescript
   interface CreditRiskData {
     cdsSpread5Y?: number;          // in bps
     longestBondYield?: number;     // %
     creditRating?: string;         // z.B. "BBB-"
     debtToEquity?: number;
     interestCoverage?: number;
     notes?: string;                // z.B. "CDS auf Rekordniveau"
   }
   ```

2. **UI-Integration:**
   - Kleine Credit-Risk-Karte oder Warnhinweis.
   - Optional: Chart mit Anleiherendite vs. Aktienkurs (falls Daten vorhanden).

**Zuordnung zu Sektionen:**

| Sektion | Name                          | Credit-Risk Integration                              | Priorität |
|---------|-------------------------------|------------------------------------------------------|-----------|
| 8       | Risikoinversion               | **Hauptstelle**: Credit-Risiko als Top-Risiko mit Expected Damage | Sehr hoch |
| 6       | Risikoadjustiertes CRV        | Credit-Spread als Input für Worst-Case-Szenario      | Hoch     |
| 12      | PESTEL-Analyse                | Finanzielle Risiken unter "Economic" oder eigenes Unterfeld | Mittel |
| 1       | Datenaktualität & Plausibilität | Aktuelles CDS / Bond Yield als Warn-KPI             | Mittel   |
| 3       | Zyklus- & Strukturanalyse     | Verschuldungszyklus / Refinanzierungsrisiko          | Niedrig  |

**Empfehlung:**  
Primär in **Sektion 8 (Risikoinversion)** als eigenes Risiko-Modul „Credit / Refinanzierung“.  
Sekundär in **Sektion 6 (CRV)** als zusätzlicher Stress-Faktor.

**Oracle-Beispiel (Stand Ende September 2026):**
- 5Y CDS: ~227–232 bps (Rekord)
- 2056 Bonds: Yield >8 %
- Rating: S&P BBB- / Moody’s Baa2 (unterstes Investment Grade)
- Risiko: Downgrade → Forced Selling von ~120 Mrd. USD Bonds aus IG-Indizes

---

## 12. Zusammengefasster Implementierungsplan (Sektionen 1–18)

| Sektion | Feature                          | Art der Integration                     | Datenquelle          |
|---------|----------------------------------|-----------------------------------------|----------------------|
| 1       | Dividend Yield (aktuell)         | KPI-Karte                               | Yahoo / FMP          |
| 1       | Credit-Warnung (CDS/Bond)        | Optionaler Warn-Badge                   | Manuell / News / API |
| 4       | Dividend Yield historisch        | Vergleichstabelle                       | Yahoo                |
| 6       | Credit-Spread im CRV             | Stress-Parameter                        | Manuell / extern     |
| 8       | Credit-Risiko (Hauptstelle)      | Risiko-Karte + Expected Damage          | Manuell / extern     |
| 10      | Dividend Yield Plot              | Chart-Overlay (2. Y-Achse)              | Yahoo / FMP          |
| 12      | Credit unter PESTEL              | Unterpunkt Economic                     | Manuell              |

**Priorität der Umsetzung:**
1. Dividend Yield Plot in **Sektion 10** + KPI in **Sektion 1**.
2. Credit-Risiko-Karte in **Sektion 8**.
3. Integration in CRV (**Sektion 6**) als optionales Stress-Szenario.

---

## 13. Offene Punkte

- Datenquelle für CDS-Spreads und einzelne Anleiherenditen (kostenpflichtig?).
- Historische Dividend-Datenqualität bei Yahoo für europäische Ticker.
- Performance-Impact durch zusätzlichen Chart-Overlay.
- UI-Design für duale Y-Achse im technischen Chart.

**Nächster Schritt:**  
Yahoo-Fallback + Dividend-Yield-Plot in Sektion 10 als erstes Feature umsetzen.

---

## 14. Buffett-Indikator im Rezessions-Dashboard – Fixes & Globalisierungsadjustierung

**Aktueller Stand im Code (aus `server/buffett-route.ts`):**

Der Buffett-Indikator für die USA wird aktuell so berechnet:

\[
\text{Ratio}_t = \frac{\text{Wilshire 5000 Close}_t \times 1{,}05\,\text{Mrd. \$}}{\text{GDP}_t} \times 100
\]

- Wilshire kommt von Yahoo (`^W5000`), GDP und historische Financial Accounts von FRED.
- Es gibt eine logarithmische Trendlinie + 1σ/2σ-Bänder über die gesamte Historie.
- Cache: 6 Stunden.
- Für EU/China werden Weltbank-Quoten über FRED genutzt.

### Probleme, die zum Screenshot passen

1. **Daten nicht aktuell / „Max“ lädt nicht**  
   Der Yahoo-Call für `^W5000` und die FRED-Abfragen können fehlschlagen (Timeout, Rate-Limit, leere Antwort). Wenn weniger als 500 Wilshire-Bars oder zu wenige GDP-Punkte da sind, wirft der Code einen Fehler → Frontend zeigt „Daten konnten nicht geladen werden“.

2. **Blaue Box (Annotation)**  
   Die Box mit „Jun 30, 2026 – 244 % …“ kommt aus dem Chart-Code (vermutlich `client`). Wenn die Zeitreihe nicht bis zum aktuellen Datum reicht oder der letzte Punkt fehlt, kann die Annotation nicht korrekt positioniert oder berechnet werden.

3. **Klassische Buffett-Formel ist strukturell unvollständig**  
   Die einfache Formel \(\text{Market Cap / GDP}\) ignoriert:
   - Dass die USA eine **Importnation** ist (Handelsdefizit).
   - Dass die größten Unternehmen (Hyperscaler: Apple, Microsoft, Nvidia, Alphabet, Amazon, Meta) einen hohen Anteil ihres Umsatzes **außerhalb der USA** machen.
   - Den **Reservewährungsstatus** des US-Dollars, der die Bewertung von US-Aktien global stützt.

### Vorschlag: Nicht-hardcodierter, globalisierungsadjustierter Buffett-Indikator

Statt fester Faktoren sollte die Formel dynamisch aus Daten + optionalem LLM-Call abgeleitet werden.

**Angepasste Formel (Konzept):**

\[
\text{Adjusted Buffett}_t = \frac{\text{Domestic Market Cap}_t}{\text{GDP}_t} \times \left(1 + \alpha \cdot \text{Trade Adjustment}_t\right) \times \left(1 + \beta \cdot \text{Reserve Premium}_t\right)
\]

wobei:

- \(\text{Domestic Market Cap}_t = \text{Total Market Cap}_t \times (1 - \phi_{\text{foreign revenue}})\)
- \(\phi_{\text{foreign revenue}}\) = geschätzter Anteil des Marktcap, der auf ausländische Umsätze entfällt (**nicht hardcoded**).
- \(\text{Trade Adjustment}\) basiert auf dem aktuellen Handelsbilanzsaldo / BIP (Importnation → leichter Abschlag oder Aufschlag je nach Interpretation).
- \(\text{Reserve Premium}\) = dynamischer Faktor für den Reservewährungsstatus (z. B. abgeleitet aus Dollar-Anteil an globalen Reserven oder LLM-Einschätzung).

**Datenquellen für die dynamischen Faktoren (nicht hardcoded):**

| Faktor | Mögliche Quelle | Aktualisierung |
|--------|-----------------|----------------|
| Foreign Revenue Share der Top-Unternehmen | Perplexity / OpenRouter LLM-Call oder SEC 10-K Segmentdaten | On-demand oder wöchentlich |
| Handelsbilanzsaldo / BIP | FRED (`BOPGSTB`, `GDP`) | Monatlich |
| Dollar-Anteil an globalen Reserven | IMF COFER oder LLM-Zusammenfassung | Quartalsweise |
| Wilshire / GDP | Bereits vorhanden (Yahoo + FRED) | Täglich / Quartalsweise |

**Integrierter LLM-Call (Beispiel-Prompt-Skizze):**

```text
Schätze für die USA den aktuellen Anteil des gesamten Aktienmarkt-Werts,
der auf Umsätze außerhalb der USA entfällt (Top 10 Unternehmen gewichtet).
Berücksichtige die Rolle des USD als Reservewährung.
Gib nur eine Zahl zwischen 0.25 und 0.55 zurück (foreign revenue share).
```

Das Ergebnis \(\phi\) fließt dann in die Formel ein. Fallback: letzter gecachter Wert oder ein konservativer Default (z. B. 0.40), der aber klar als Fallback markiert wird.

### Konkrete Fixes für den aktuellen Fehler

1. **Robusteres Datenholen**
   - Yahoo-Call für `^W5000` mit Retry + längerem Timeout.
   - Wenn Wilshire fehlschlägt: Fallback auf FRED-Market-Cap-Serien (`NCBEILQ027S` + `FBCELLQ027S`) auch für aktuelle Werte, nicht nur historisch.

2. **„Max“ und aktuelles Datum**
   - `period2` immer auf `Math.floor(Date.now()/1000) + 86400` setzen (bereits ansatzweise vorhanden, aber absichern).
   - Letzten verfügbaren Punkt explizit als „aktuell“ markieren und die blaue Box darauf ausrichten.

3. **Frontend-Fehlerbehandlung**
   - Die rote Box „Daten konnten nicht geladen werden“ sollte den konkreten Backend-Fehler (Timeout, zu wenige Bars, etc.) anzeigen, statt nur generisch.

4. **Cache**
   - 6 h Cache ist ok, aber bei Fehler nicht cachen und nach kurzer Zeit erneut versuchen.

### Nächste Umsetzungsschritte

- Robuste Datenabfrage + Fallback in `buffett-route.ts`.
- Dynamischen Foreign-Revenue-Faktor (LLM oder Fallback) in die Formel integrieren.
- Annotation (blaue Box) zuverlässig auf den letzten Datenpunkt setzen.
- Optional: Adjusted Buffett als zweiten Chart oder zusätzliche Kennzahl im Rezessions-Dashboard anzeigen.

---

## 15. Gesamt-Prioritäten für Work.md

1. **FMP 402 + Yahoo-Fallback** für deutsche Ticker (VOW3.DE etc.).
2. **Dividend Yield Plot** in Sektion 10 + KPI in Sektion 1.
3. **Credit-Risiko** (CDS/Bond Yield) in Sektion 8.
4. **Buffett-Indikator robust machen** + globalisierungsadjustierte Formel (nicht hardcoded).
5. Bessere Fehlermeldungen im Frontend bei Datenlade-Fehlern.

---

## 16. Konsolidierung der Rezessions-Dashboard-Charts in eine Technische-Analyse-Sektion

**Ziel:** Alle relevanten Rezessions- und Korrektur-Signale in **einer** interaktiven Chart-Sektion mit Overlays bündeln – analog zur BTC-Technischen-Analyse. Aktuell sind die Informationen über Sektionen 9 (Markt-RSI/MACD), 10 (Vier Märkte Vol/Preis), 11 (Buffett) und Scoring-Tabellen verteilt.

### Empfohlene Overlays / Plots für eine „Rezession & Korrektur – Technische Analyse“

| Priorität | Overlay / Plot | Quelle | Warum wichtig für Rezession/Korrektur | Darstellung |
|-----------|----------------|--------|---------------------------------------|-------------|
| **Sehr hoch** | **Preis (SPY oder VGK)** | Yahoo | Basis für alle Signale | Hauptlinie |
| **Sehr hoch** | **RSI(14)** | Berechnet | Überkauft/Überverkauft + Divergenzen | Unterchart |
| **Sehr hoch** | **MACD (12,26,9)** | Berechnet | Momentum-Shift, Signal-Kreuz | Unterchart |
| **Hoch** | **VIX / VSTOXX** | FRED VIXCLS / STOXX | Fear-Gauge, Korrektur-Sentiment | Zweite Y-Achse oder Unterchart |
| **Hoch** | **Buffett-Indikator (TMC/GDP)** | Yahoo ^W5000 + FRED GDP | Extrembewertung als Korrektur-Treiber | Zweite Y-Achse (normalisiert) oder separater Unterchart |
| **Hoch** | **Shiller CAPE** | Multpl / FRED | Langfristige Überbewertung | Unterchart oder Marker |
| **Mittel** | **Margin Debt YoY** | FINRA | Hebel-Risiko, Korrektur-Verstärker | Unterchart oder Marker |
| **Mittel** | **Yield Curve (T10Y2Y)** | FRED | Leading-Indikator für Rezession | Unterchart (invertiert oder als Spread) |
| **Mittel** | **Credit Spread (BAA10Y)** | FRED | Kreditstress | Unterchart |
| **Niedrig** | **M2 YoY** | FRED | Liquiditätsregime | Optionaler Overlay |
| **Niedrig** | **Google Trends „Recession“** | SerpApi | Sentiment-Extrem | Optionaler Marker |

### Vorgeschlagene Chart-Struktur (1 Chart, mehrere Panes)

```
┌────────────────────────────────────────────────────────────┐
│ Hauptchart: SPY / VGK Close + MA200 / MA50             │
│ + optional: Buffett-Indikator (normalisiert, 2. Achse)│
├──────────────────────────────────────────────────────────┤
│ Pane 1: RSI(14) mit 30/70-Bändern + Divergenz-Marker   │
├──────────────────────────────────────────────────────────┤
│ Pane 2: MACD + Signal + Histogram                      │
├──────────────────────────────────────────────────────────┤
│ Pane 3: VIX / VSTOXX (0–90) mit Fear-Bändern           │
│          + Credit Spread (BAA-Trs) als Overlay         │
├──────────────────────────────────────────────────────────┤
│ Pane 4 (optional): Margin Debt YoY oder Yield Curve    │
└──────────────────────────────────────────────────────────┘
```

### Was konkret umgesetzt werden muss

1. **Neue Sektion** im Rezessions-Dashboard (z. B. „Technische Analyse – Rezession & Korrektur“).
2. **Daten-Aggregation** im Backend: Ein Endpoint, der SPY/VGK + VIX + Buffett + Yield Curve + Credit Spread in einem Call liefert (mit den bestehenden Fallbacks).
3. **Frontend-Chart-Komponente** (ähnlich `TechnicalChart.tsx` beim Aktien-/BTC-Dashboard):
   - Mehrere synchronisierte Panes.
   - Toggle für einzelne Overlays.
   - Zeitfenster (1Y / 3Y / 5Y / 10Y / Max).
   - Aktuelle Werte als Labels (RSI, MACD, VIX, Buffett %).
4. **Fehlerbehandlung**: Wenn VIXCLS oder Buffett leer ist, den Overlay ausblenden und einen kleinen Hinweis anzeigen („VIX nicht verfügbar“), statt den ganzen Chart zu blockieren.

### Priorisierung der Overlays für den ersten Schritt

1. **Preis + RSI + MACD** (funktioniert schon teilweise in Sektion 9).
2. **VIX / VSTOXX** (aktuell oft leer – hier zuerst den Datenfeed stabilisieren).
3. **Buffett-Indikator** als normalisierter Overlay (sobald der Datenfehler behoben ist).
4. **Credit Spread** und **Yield Curve** als zusätzliche Untercharts.

### Nutzen

Damit erhält der Nutzer die relevanten Rezessions-/Korrektur-Signale in einem einzigen Chart, ohne zwischen 4–5 Sektionen springen zu müssen. Die bestehende Scoring-Logik und die Tabellen bleiben parallel verfügbar.

---

## 17. Regionale Scoring-Logik mit Auswahl-Buttons (US / Europa / Asien)

**Anforderung:**  
Die aktuellen Bewertungs-Gauges und die Scoring-Logik (Rezession Coincident / Leading / Vollständig, Korrektur Sentiment / Vollständig) müssen **per Auswahl-Button** für alle drei Regionen funktionieren:

- **USA**
- **Europa** (Eurozone)
- **Asien** (Japan / ASHR)

Aktuell gibt es in Sektion 8 die „Regionalen Kataloge“, die die Rohdaten und Scores pro Region zeigen. Es fehlt jedoch die direkte Umschaltung der **Wahrscheinlichkeits-Gauges** (Sektion 1) und der zugehörigen Scoring-Berechnung auf die jeweilige Region.

### Gewünschtes Verhalten

1. **Auswahl-Buttons** oben in der Bewertungs-Sektion (oder global):
   - `US` | `Europa` | `Asien`
2. Beim Klick auf eine Region:
   - Die fünf Gauges (Rezession 3M/6M/12M, Korrektur 3-6M/12M) zeigen die **regionsspezifischen Wahrscheinlichkeiten**.
   - Die Scoring-Tabelle und die Top-3-Treiber passen sich der gewählten Region an.
   - Die regionale Katalog-Ansicht (Sektion 8) bleibt als Detailansicht erhalten.
3. Die Gewichtungen (aktuell US 0.70 / EZ 0.20 / JP 0.10) bleiben für die **aggregierte** Sicht bestehen, aber die Einzelregionen müssen separat abrufbar sein.

### Technische Umsetzung

- **Backend:** Die Scoring-Pipeline muss pro Region (US, EZ, JP/Asien) die Netto-Scores und Wahrscheinlichkeiten berechnen können (viele Slots sind aktuell bereits regionsspezifisch vorhanden, z. B. Sahm, Zinskurve, Aktivität, M2, VIX/VSTOXX).
- **Frontend:**
  - State für `selectedRegion` (`'US' | 'EZ' | 'AS'`).
  - Die Gauge-Komponenten und die Score-Übersicht lesen die Daten der ausgewählten Region.
  - Fallback: Wenn für eine Region zu viele N/A-Werte vorliegen (z. B. Japan), die Gauges mit Hinweis „unzureichende Daten“ anzeigen statt falsche Werte.
- **Datenlücken:** Für Europa und Asien sind einige Serien (VSTOXX, Yield Curve, Credit Spreads, CAPE) aktuell unvollständig – diese müssen entweder gefüllt oder sauber als N/A behandelt werden, damit die Scoring-Logik nicht verzerrt wird.

### Priorität

Mittel bis hoch – verbessert die Nutzbarkeit des Dashboards für internationale Nutzer deutlich, ohne die bestehende US-zentrierte Aggregation zu brechen.

---

## 18. Regionale Scoring-Logik für alle Regionen (US / Europa / Asien)

**Anforderung:**  
Die komplette Scoring-Logik (Gauges, Netto-Scores, Wahrscheinlichkeiten, Top-Treiber) muss per Auswahl-Button für alle drei Regionen funktionieren:

- **USA**
- **Europa** (Eurozone)
- **Asien** (Japan / ASHR)

Beim Klick auf eine Region sollen die fünf Wahrscheinlichkeits-Gauges (Rezession Coincident 3M, Leading 6M, Vollständig 12M, Korrektur Sentiment 3-6M, Korrektur Vollständig 12M) sowie die zugehörigen Score-Tabellen und Top-3-Treiber die **regionsspezifischen Werte** anzeigen.

Die bestehende aggregierte Sicht (US 0.70 / EZ 0.20 / JP 0.10) bleibt für die Gesamtbewertung erhalten.

### Technische Anforderungen

- Backend: Scoring-Pipeline muss pro Region laufen (viele Slots existieren bereits regionsspezifisch).
- Frontend: `selectedRegion`-State steuert Gauges, Tabellen und Heatmap.
- Fehlende Daten: Slots mit N/A zählen weder im Netto noch im Max (bereits so implementiert) und müssen klar gekennzeichnet werden.
- Fallback: Bei zu vielen N/A-Werten in einer Region Hinweis „unzureichende Daten für vollständige Bewertung“ anzeigen.

---

## 19. Dokumentation aller N/A-Datenpunkte (Stand 2026-10-09)

Diese Datenpunkte sind aktuell N/A und müssen nach den Änderungen gefixt oder sauber als nicht verfügbar behandelt werden:

### Eurozone (EZ)

| Slot | Quelle | Status | Priorität Fix |
|------|--------|--------|---------------|
| Kurve EZ (10J−3M) | FRED IRLTLT01EZM156N − IR3TIB01EZM156N | **N/A** | Hoch |
| Spreads EZ HY | FRED BAMLHE00EHYIOAS | **N/A** | Hoch |
| VSTOXX (in Charts) | STOXX V2TX | Teilweise leer in Charts | Hoch |
| STOXX 600 PE | iShares EXSA | Vorhanden (18.4) | – |

### Japan (JP / Asien)

| Slot | Quelle | Status | Priorität Fix |
|------|--------|--------|---------------|
| ALQ Japan | FRED LRUNTTTTJPM156S | **N/A** | Hoch |
| Kurve JP 10J | FRED IRLTLT01JPM156N | **N/A** | Hoch |
| Aktivität JP | FRED JPNPROINDMISMEI | **N/A** | Mittel |
| Spreads JP | JGB-Corp (keine freie OAS-Serie) | **N/A** | Mittel |
| TOPIX/CAPE JP | FMP leer; JPX-PER nur xlsx | **N/A** | Hoch |
| JNVI | keine freie Serie | **N/A** | Mittel |

### Allgemeine / Chart-bezogene N/A

| Bereich | Problem | Status | Priorität |
|---------|---------|--------|-----------|
| Buffett-Indikator | Daten konnten nicht geladen werden (Max) | **Fehler** | Sehr hoch |
| FRED VIXCLS | Leer in Charts (Sektion 9 & 10) | **Leer** | Hoch |
| VSTOXX | „FMP leer“ / via STOXX h_v2tx.txt | Teilweise | Hoch |
| PE / EPS / Ratios für SPY | Viele FMP-Endpoints leer (income-statement, ratios, key-metrics etc.) | **n/a** | Mittel |
| Analyst Estimates SPY | GET /stable/analyst-estimates leer | **n/a** | Mittel |
| Margin Debt Chart | Nur SPY, kein EU/Asien-Klon | Eingeschränkt | Niedrig |

### Fix-Prioritäten nach Änderungen

1. **Buffett-Indikator** stabilisieren (Yahoo ^W5000 + FRED GDP) – blockiert Sektion 11.
2. **VIXCLS und VSTOXX** für Charts verfügbar machen (FRED / STOXX).
3. **Eurozone Yield Curve und HY Spreads** (FRED-Serien prüfen oder alternative Quellen).
4. **Japan-Daten** (ALQ, Yield Curve, Aktivität, CAPE) – alternative Quellen oder klar als N/A belassen.
5. **SPY Fundamentals** (PE, EPS, Ratios) – FMP-Endpoints oder Fallback auf Yahoo.

**Hinweis:** Fehlende Slots sollen weiterhin weder Netto- noch Max-Score verzerren. Nach dem Fix der Datenfeeds müssen die regionalen Scoring-Berechnungen neu validiert werden.

---

## 20. Detaillierte N/A-Datenpunkte – Betroffene Dateien, Datenquellen & Fix-Ansätze

**Stand:** 2026-10-09  
**Ziel:** Alle N/A-Stellen so dokumentieren, dass sie im Code nachvollziehbar und fixbar sind.

### Betroffene Hauptdateien (Code)

| Bereich | Wahrscheinliche Dateien | Rolle |
|---------|-------------------------|-------|
| Rezessions-Scoring | `server/recession-*.ts`, Scoring-Pipeline | Berechnung der Scores pro Region |
| Buffett-Indikator | `server/buffett-route.ts` | Datenholen & Berechnung |
| Charts (RSI/MACD/VIX) | `client/src/components/sections/` (Markt-RSI, Vier Märkte) | Frontend-Darstellung |
| FRED-Daten | `server/` (FRED-Fetcher-Module) | Abruf der Serien |
| Regionale Kataloge | Scoring-Logik + Frontend Sektion 8 | Anzeige der Slots |

### Eurozone – Detailliert

| Slot | Quelle | Status | Betroffene Stelle | Fix-Ansatz / Alternative Quelle |
|------|--------|--------|-------------------|---------------------------------|
| Kurve EZ (10J−3M) | FRED `IRLTLT01EZM156N` − `IR3TIB01EZM156N` | **N/A** | Scoring EZ-Katalog | FRED-Serien-Verfügbarkeit prüfen; alternativ ECB-Daten oder Yahoo `^TNX`-Proxy + EZ-Kurzlauf |
| Spreads EZ HY | FRED `BAMLHE00EHYIOAS` | **N/A** | Scoring EZ-Katalog | FRED-Serie validieren; Fallback auf iShares HY-ETF Yield oder manueller Proxy |
| VSTOXX | STOXX V2TX / `h_v2tx.txt` | Teilweise leer | Charts Sektion 9/10 | Direkten STOXX- oder Yahoo-Call (`^V2TX`) implementieren; FMP-Fallback entfernen |
| STOXX 600 PE | iShares EXSA | Vorhanden | – | Kein Fix nötig |

### Japan – Detailliert

| Slot | Quelle | Status | Betroffene Stelle | Fix-Ansatz / Alternative Quelle |
|------|--------|--------|-------------------|---------------------------------|
| ALQ Japan | FRED `LRUNTTTTJPM156S` | **N/A** | Scoring JP-Katalog | FRED-Serie prüfen; alternativ Japan Statistics Bureau oder Trading Economics |
| Kurve JP 10J | FRED `IRLTLT01JPM156N` | **N/A** | Scoring JP-Katalog | FRED-Verfügbarkeit; alternativ BoJ oder Yahoo Japan Government Bond |
| Aktivität JP | FRED `JPNPROINDMISMEI` | **N/A** | Scoring JP-Katalog | FRED-Serie oder METI Industrial Production |
| Spreads JP | JGB-Corp | **N/A** | Scoring JP-Katalog | Keine freie OAS-Serie → als N/A belassen oder Proxy über Corporate Bond ETF |
| TOPIX/CAPE JP | FMP / JPX-PER | **N/A** | Scoring JP-Katalog | Yahoo `^TPX` + Earnings-Daten oder manueller Import |
| JNVI | keine freie Serie | **N/A** | Scoring JP-Katalog | Als N/A belassen oder VIX-Proxy nutzen |

### Allgemeine / Chart-bezogene N/A – Detailliert

| Bereich | Problem | Status | Betroffene Datei(en) | Fix-Ansatz |
|---------|---------|--------|----------------------|------------|
| Buffett-Indikator | Max lädt nicht | **Fehler** | `server/buffett-route.ts` | Retry + längerer Timeout für Yahoo `^W5000`; Fallback auf FRED `NCBEILQ027S` + `FBCELLQ027S`; `period2` absichern |
| FRED VIXCLS | Leer in Charts | **Leer** | Chart-Komponenten + FRED-Fetcher | FRED-Call mit Retry; Cache prüfen; Fallback auf Yahoo `^VIX` |
| VSTOXX | Teilweise / FMP leer | Teilweise | Chart-Logik | Direkten STOXX- oder Yahoo-Call implementieren |
| PE / EPS / Ratios SPY | FMP-Endpoints leer | **n/a** | Factpack / Vier Märkte | Yahoo Finance Fallback für Quote + Key Stats; oder FMP-Plan prüfen |
| Analyst Estimates SPY | FMP leer | **n/a** | Factpack | Yahoo oder Perplexity Finance Connector als Fallback |
| Margin Debt Chart | Nur SPY | Eingeschränkt | Chart Sektion 10 | EU/Asien-Klone optional; FINRA bleibt US-only |

### Konkrete Datenquellen zum Hinzufügen / Absichern

| Datenpunkt | Primärquelle | Fallback-Quelle | Hinzufügbar in |
|------------|--------------|-----------------|----------------|
| Buffett US | Yahoo `^W5000` + FRED `GDP` | FRED Financial Accounts | `buffett-route.ts` |
| VIX | FRED `VIXCLS` | Yahoo `^VIX` | FRED-Fetcher + Charts |
| VSTOXX | STOXX V2TX | Yahoo `^V2TX` | Chart-Datenlayer |
| EZ Yield Curve | FRED Serien | ECB Statistical Data Warehouse | Scoring EZ |
| JP ALQ / Curve | FRED | BoJ / Statistics Bureau | Scoring JP |
| SPY PE / EPS | FMP | Yahoo Finance `quoteSummary` | Factpack-Logik |

### Fix-Prioritäten (nach Code-Impact)

1. **Buffett-Indikator** (`buffett-route.ts`) – blockiert Sektion 11 komplett.
2. **VIXCLS + VSTOXX** in den Chart-Komponenten – betrifft Sektionen 9 und 10.
3. **Eurozone Yield Curve + HY Spreads** – verbessert EZ-Scoring.
4. **Japan-Kerndaten** (ALQ, Curve, Aktivität) – reduziert N/A-Anteil in JP-Katalog.
5. **SPY Fundamentals** – Factpack in Sektion 10.

**Wichtig:** Alle N/A-Slots müssen weiterhin weder Netto- noch Max-Score verzerren. Nach dem Fix der Datenfeeds die regionalen Scoring-Berechnungen (US / EZ / JP) neu validieren.

---

## 21. Buffett-Indikator für Europa und Asien (3 Benchmarks)

**Anforderung:**  
Der Buffett-Indikator (Marktwert / BIP) muss nicht nur für die USA, sondern auch für **Europa** und **Asien** berechnet werden können – jeweils auf Basis der passenden Benchmark-Indizes.

### Ziel-Benchmarks

| Region | Benchmark | Symbol / Quelle | BIP-Quelle |
|--------|-----------|-----------------|------------|
| **USA** | Wilshire 5000 | Yahoo `^W5000` | FRED `GDP` |
| **Europa** | STOXX 600 oder Euro Stoxx 50 | Yahoo `^STOXX` / `^STOXX50E` oder VGK als Proxy | Eurostat / FRED EZ-GDP |
| **Asien** | TOPIX oder MSCI Asia / ASHR | Yahoo `^TPX` / `ASHR` als Proxy | Japan Statistics / FRED JP-GDP oder aggregiert |

### Berechnungslogik (analog zu US)

\[
\text{Buffett}_{\text{Region}} = \frac{\text{Market Cap Proxy}_{\text{Region}}}{\text{GDP}_{\text{Region}}} \times 100
\]

- Für Europa: STOXX 600 Market Cap (oder VGK AUM/Price als Proxy) / EZ-BIP.
- Für Asien: TOPIX oder ASHR-basierter Market Cap Proxy / Japan-BIP (oder Asia-ex-Japan aggregiert).
- Trendlinie + 1σ/2σ-Bänder analog zur US-Implementierung in `buffett-route.ts`.

### Technische Umsetzung

- **Backend:** `buffett-route.ts` um zwei weitere Regionen erweitern (oder separaten Endpoint).
- **Datenquellen:**
  - Europa: Yahoo `^STOXX` oder VGK + Eurostat/FRED GDP.
  - Asien: Yahoo `^TPX` oder ASHR + verfügbare GDP-Serie.
- **Frontend:** Die bestehenden Tabs (US / Europa / China) im Buffett-Chart müssen die jeweiligen berechneten Reihen laden.
- **Fallback:** Wenn kein sauberer Market-Cap-Index verfügbar ist, ETF-Proxy (VGK, ASHR) mit bekannter Markt-Kapitalisierung verwenden und klar kennzeichnen.

### Priorität

Hoch – ergänzt die regionale Scoring-Logik (Abschnitt 18) und macht den Buffett-Indikator in allen drei Regionen nutzbar.

**Hinweis:** Die aktuelle Implementierung in `buffett-route.ts` unterstützt bereits US / EU / CN über unterschiedliche Quellen (Wilshire vs. Weltbank-Quoten). Diese müssen auf echte Benchmark-basierte Berechnungen umgestellt oder ergänzt werden.
