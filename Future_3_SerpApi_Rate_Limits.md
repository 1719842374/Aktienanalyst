# SerpApi Rate-Limit-Probleme – Detaillierte Erklärung (Stand 2026-10-09)

## 1. Was ist SerpApi?

SerpApi ist ein kostenpflichtiger Dienst, der Google-Suchergebnisse (inkl. Google Trends) über eine stabile API bereitstellt.  
Im Aktienanalyst-Dashboard wird SerpApi für den **Google Trends „Recession“**-Score genutzt.

**Endpoint:**  
`https://serpapi.com/search?engine=google_trends&q=Recession&geo=US&api_key=...`

---

## 2. Aktuelle Rate-Limits (Stand 2026)

| Plan | Requests pro Minute | Requests pro Monat | Kosten (ca.) |
|------|---------------------|--------------------|--------------|
| Free | ~10 | 1.000 | 0 € |
| Developer | ~100 | 5.000 | ~75 $/Monat |
| Production | höher | 15.000+ | ~150+ $/Monat |
| Enterprise | individuell | individuell | individuell |

**Wichtige Details:**
- SerpApi cached Ergebnisse **1 Stunde** (kostenlos, zählt nicht gegen das Kontingent).
- Bei Überschreitung kommt HTTP **429 Too Many Requests**.
- Sowohl Minuten-Limit als auch Monats-Quota lösen 429 aus.
- Google Trends selbst hat zusätzlich interne Limits → SerpApi kann auch bei gültigem Plan leere Ergebnisse oder Fehler zurückgeben.

---

## 3. Warum der Google-Trends-Score im Dashboard Probleme macht

### Beobachtetes Verhalten
- Score wird manchmal auf **0** gesetzt (N/A = 0).
- Anzeige zeigt z. B. „7d Ø = 59.1, Latest = 53“, aber gelegentlich fehlen Daten.
- Scoring-Gewicht: ×1.7, Max 11.9.

### Häufige Fehlerursachen

| Fehler | Ursache | Auswirkung im Dashboard |
|--------|---------|-------------------------|
| HTTP 429 | Minuten- oder Monats-Limit überschritten | Score fällt auf 0 |
| Leeres Ergebnis | Keyword/Region/Zeitraum hat zu wenig Volumen oder SerpApi-Bug | Score = 0 |
| Timeout / Error | SerpApi hatte 2024–2026 wiederholt Performance-Probleme | Score = 0 |
| Cache-Miss | Nach Ablauf der 1h-Cache-Zeit wird neu abgefragt | Risiko von 429 |

### SerpApi Release Notes (Auszug 2024–2026)
- Mehrfach: „Searches Failing“, „Empty Results“, „Performance Degradation“
- „Returning Empty Results Most of the Time“ (2023)
- „All Searches Failing“ (2024)
- Wiederholte Performance-Probleme bis 2026

---

## 4. Konkrete Auswirkungen auf das Scoring

Aktuelle Logik (vereinfacht):
```
Wenn SerpApi gültigen Wert zurückgibt → Score berechnen (z. B. 59 → 0 Punkte)
Wenn Fehler / leer / 429 → Score = 0 (N/A)
```

**Problem:**  
Ein temporärer 429 oder leeres Ergebnis setzt den Score auf 0 und verzerrt die Korrektur-Wahrscheinlichkeit (Gewicht ×1.7).

---

## 5. Empfohlene Fixes

### Sofort (ohne Kosten)
1. **Caching auf 6–12 Stunden** erhöhen (nicht nur 1h).
2. **Letzten gültigen Wert halten** statt auf 0 zu setzen.
3. Im UI anzeigen: „Google Trends: letzter Wert von vor X Stunden“.

### Mittelfristig
1. Retry mit exponential Backoff bei 429.
2. Fallback auf pytrends (unofficial, kostenlos, aber ebenfalls rate-limited).
3. Bei dauerhaftem 429: Score als „nicht verfügbar“ kennzeichnen statt 0.

### Langfristig
1. SerpApi-Plan prüfen (Developer oder höher).
2. Offizielle Google Trends API (Alpha seit Juli 2025) evaluieren (Zugang auf Antrag).
3. Alternative Anbieter (Scrape.do, Bright Data etc.) testen.

---

## 6. Technische Stellen im Code

| Stelle | Aktion |
|--------|--------|
| Scoring-Pipeline (Google Trends Call) | Caching + Fallback auf letzten Wert |
| Frontend (Sektion Scoring / Heatmap) | Anzeige „letzter gültiger Wert“ + Zeitstempel |
| Error-Handling | 429 nicht als Score 0 behandeln |

---

## 7. Zusammenfassung

Der Google-Trends-Score fällt häufig auf 0, weil SerpApi Rate-Limits (429) oder leere Ergebnisse zurückgibt.  
Die aktuelle Logik behandelt das als N/A = 0 und verzerrt damit das Korrektur-Scoring.

**Empfohlener Minimal-Fix:**  
Letzten gültigen Wert cachen (6–12h) und bei Fehler weiterverwenden + im UI kennzeichnen.
