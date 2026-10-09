# N/A-Datenquellen-Recherche & Google Trends Fix (Stand 2026-10-09)

## 1. Warum Google Trends "Recession" Score nicht zuverlässig funktioniert

### Aktueller Stand im Dashboard
- Quelle: Google Trends via SerpApi
- Anzeige: 7d Ø = 59.1, Latest = 53, Peak = 100
- Scoring: +7 bis -6.8 / N/A = 0, Gewicht ×1.7, Max 11.9
- Zone: Normal (59.1 liegt in 30–60)

### Häufige Fehlerursachen (Recherche)

| Fehler | Ursache | Häufigkeit | Lösung |
|--------|---------|------------|--------|
| HTTP 429 | SerpApi Rate-Limit (Free: ~10 req/min, 1000/Monat) oder Google-interne Limits | Hoch | Caching (min. 1h), Retry mit Backoff, höherer Plan |
| Leere Ergebnisse | Keyword hat in der Region/Zeitraum zu wenig Volumen oder SerpApi-Bug | Mittel | Geo auf "US" oder "Worldwide" erweitern, Zeitraum vergrößern |
| Timeout / Error | SerpApi hatte in der Vergangenheit wiederholte Performance-Probleme (siehe Release Notes 2024–2026) | Mittel | Fallback auf letzten gecachten Wert |
| N/A = 0 | Wenn kein gültiger Wert zurückkommt, wird Score auf 0 gesetzt | Aktuell so implementiert | Besser: letzten gültigen Wert halten + Warnung |

### SerpApi Google Trends Fakten
- Endpoint: `https://serpapi.com/search?engine=google_trends`
- Parameter: `q=Recession`, `geo=US`, `date=today 12-m` oder kürzer
- Cache: SerpApi cached 1 Stunde (kostenlos)
- Bekannte Probleme: Mehrfach "Searches Failing", "Empty Results", "Performance Degradation" in 2024–2026
- Offizielle Google Trends API: Seit Juli 2025 in Alpha, Zugang nur auf Antrag

### Empfohlener Fix
1. Caching von mindestens 6–12 Stunden für den Google-Trends-Wert.
2. Bei Fehler oder leerem Ergebnis: letzten gültigen Wert weiterverwenden (nicht auf 0 setzen).
3. Optional: Fallback auf pytrends (unofficial, rate-limited) oder manuellen Export.
4. Im UI klar kennzeichnen, wenn der Wert älter als 24h ist.

---

## 2. Datenquellen-Recherche für N/A-Fixes

### VIX (FRED VIXCLS)
- **Status:** Daten sind verfügbar (aktuell ~15.4 am 2026-10-08)
- **Direkter CSV:** `https://fred.stlouisfed.org/graph/fredgraph.csv?id=VIXCLS`
- **Yahoo Fallback:** `^VIX` (funktioniert mit yahoo-finance2)
- **Fix:** Retry + Timeout erhöhen im FRED-Fetcher; Fallback auf Yahoo `^VIX`

### VSTOXX
- **Yahoo:** `V2TX.DE` oder `^V2TX` (Daten vorhanden, z. B. ~19–20 aktuell)
- **STOXX:** Offizielle historische Dateien unter stoxx.com (teilweise login-pflichtig)
- **Fix:** Direkten Yahoo-Call für `^V2TX` oder `V2TX.DE` implementieren statt FMP

### Eurozone Yield Curve
- **FRED:** `IRLTLT01EZM156N` (10Y, monatlich, Daten bis Jan 2026 vorhanden)
- **ECB:** Tägliche Yield Curves unter ecb.europa.eu (ab 2004)
- **Fix:** FRED-Serie validieren; bei Lücken ECB-CSV oder Yahoo-Proxy nutzen

### Buffett-Indikator
- **Yahoo:** `^W5000` (Wilshire)
- **FRED Fallback:** `NCBEILQ027S` + `FBCELLQ027S`
- **Fix:** Retry + längerer Timeout; period2 immer aktuell setzen

### SPY Fundamentals (PE, EPS, Ratios)
- **Yahoo:** `quoteSummary` mit Modulen `defaultKeyStatistics`, `financialData`
- **Fix:** Yahoo-Fallback für Factpack, wenn FMP leer ist

---

## 3. Priorisierte Fix-Liste mit konkreten Quellen

| Priorität | Datenpunkt | Primärquelle | Fallback | Betroffene Datei |
|-----------|------------|--------------|----------|------------------|
| 1 | Buffett | Yahoo ^W5000 + FRED GDP | FRED Financial Accounts | buffett-route.ts |
| 2 | VIX | FRED VIXCLS | Yahoo ^VIX | FRED-Fetcher + Charts |
| 3 | VSTOXX | Yahoo ^V2TX / V2TX.DE | STOXX CSV | Chart-Datenlayer |
| 4 | Google Trends | SerpApi | Gecachter letzter Wert | Scoring-Pipeline |
| 5 | EZ Yield Curve | FRED IRLTLT01EZM156N | ECB Yield Curves | Scoring EZ |
| 6 | SPY PE/EPS | FMP | Yahoo quoteSummary | Factpack |

---

## 4. Nächste Schritte

1. Google-Trends-Caching + Fallback auf letzten Wert implementieren.
2. VIX und VSTOXX über Yahoo als Fallback absichern.
3. Buffett-Indikator Retry-Logik in buffett-route.ts.
4. Regionale Scoring-Logik (US/EZ/Asien) mit den gefixten Datenquellen testen.
