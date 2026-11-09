# Google Trends Score – Konflikt, Problem und Lösung (Stand 2026-10-09)

## 1. Der Konflikt mit dem Google-Trends-Score

### Was passiert aktuell?

Im Rezessions-Dashboard wird der Google-Trends-Wert für „Recession“ als Korrektur-Indikator genutzt:

| Feld | Wert (Beispiel) | Bedeutung |
|------|-----------------|-----------|
| 7d Ø | 59.1 | Durchschnitt der letzten 7 Tage |
| Latest | 53 | Letzter verfügbarer Wert |
| Peak | 100 | Maximalwert im Zeitraum |
| Score | 0 | Wird bei N/A oder Fehler auf 0 gesetzt |
| Gewicht | ×1.7 | Relativ hohes Gewicht im Korrektur-Scoring |
| Max | 11.9 | Maximal möglicher Beitrag |

**Scoring-Zonen (aus dem Dashboard):**
- >75 → +11.9
- 60–75 → +6.8
- 30–60 → 0
- <30 → -6.8
- N/A → 0

### Der eigentliche Konflikt

Wenn SerpApi einen Fehler zurückgibt (429 Rate-Limit, Timeout, leeres Ergebnis), wird der Score auf **0** gesetzt.  
Das ist problematisch, weil:

1. Ein temporärer API-Fehler wird wie ein „normaler“ Trendwert behandelt.
2. Der Indikator hat ein relativ hohes Gewicht (×1.7) und kann die Korrektur-Wahrscheinlichkeit spürbar beeinflussen.
3. Der Nutzer sieht keinen Hinweis, dass der Wert nicht aktuell oder fehlerhaft ist.
4. Die Logik „N/A = 0“ ist für einen Sentiment-Indikator ungünstig, weil 0 als „neutral“ interpretiert wird, obwohl der Wert eigentlich fehlt.

**Kurz:** Ein Datenproblem wird als Markt-Signal gewertet.

---

## 2. Warum das Problem auftritt

### SerpApi Rate-Limits (Stand 2026)

| Plan | Requests/Minute | Requests/Monat |
|------|-----------------|----------------|
| Free | ~10 | 1.000 |
| Developer | ~100 | 5.000 |
| Production | höher | 15.000+ |

- SerpApi cached Ergebnisse **1 Stunde**.
- Bei Überschreitung kommt HTTP **429**.
- Google Trends selbst hat zusätzlich interne Limits.
- SerpApi hatte 2024–2026 wiederholt Performance-Probleme („Searches Failing“, „Empty Results“).

### Typische Fehler im Dashboard

| Fehler | Häufigkeit | Folge im Scoring |
|--------|------------|------------------|
| HTTP 429 | Hoch | Score = 0 |
| Leeres Ergebnis | Mittel | Score = 0 |
| Timeout | Mittel | Score = 0 |
| Cache abgelaufen | Regelmäßig | Neuer Call → Risiko 429 |

---

## 3. Wie das Problem gelöst werden kann

### Lösung A – Minimal (ohne Kosten, sofort umsetzbar)

**Ziel:** Fehlerhafte Werte nicht mehr als Score 0 behandeln.

1. **Letzten gültigen Wert cachen** (6–12 Stunden, besser 24h).
2. Bei Fehler (429, leer, Timeout):
   - Den letzten gültigen Wert weiterverwenden.
   - Im UI klar kennzeichnen: „Google Trends: letzter Wert von vor X Stunden“.
3. Nur wenn **kein** gültiger Wert in den letzten 48h existiert → Score als „nicht verfügbar“ behandeln (nicht als 0).

**Code-Skizze (Pseudocode):**
```typescript
const cached = await cache.get("google-trends-recession");
if (cached && Date.now() - cached.timestamp < 12 * 60 * 60 * 1000) {
  return cached.value; // gültigen Wert verwenden
}

try {
  const fresh = await serpApi.getTrends("Recession");
  if (fresh && fresh.value != null) {
    await cache.set("google-trends-recession", { value: fresh.value, timestamp: Date.now() });
    return fresh.value;
  }
} catch (err) {
  // 429 oder anderer Fehler
}

// Fallback: letzten bekannten Wert oder explizit N/A
return cached?.value ?? null;
```

### Lösung B – Mittelfristig

1. **Retry mit exponential Backoff** bei 429.
2. **Fallback auf pytrends** (unofficial, kostenlos, aber ebenfalls rate-limited).
3. Im Scoring: Wenn der Wert älter als 24h ist, das Gewicht temporär reduzieren oder den Indikator ausblenden.

### Lösung C – Langfristig

1. SerpApi-Plan prüfen (Developer oder höher).
2. Offizielle Google Trends API (Alpha seit Juli 2025) evaluieren.
3. Alternative Anbieter testen (Scrape.do, Bright Data etc.).

---

## 4. Empfohlene Umsetzung im Code

| Stelle | Änderung | Priorität |
|--------|----------|-----------|
| Scoring-Pipeline (Google Trends Call) | Caching + Fallback auf letzten Wert | Hoch |
| Error-Handling | 429 / leer ≠ Score 0 | Hoch |
| Frontend (Heatmap / Scoring) | Zeitstempel + „letzter gültiger Wert“ anzeigen | Mittel |
| Scoring-Logik | Optional: Gewicht reduzieren, wenn Wert >24h alt | Niedrig |

---

## 5. Zusammenfassung

**Konflikt:**  
Ein SerpApi-Fehler (429 oder leer) wird aktuell als Score 0 gewertet und beeinflusst die Korrektur-Wahrscheinlichkeit, obwohl es kein Markt-Signal ist.

**Lösung (Minimal):**  
Letzten gültigen Wert 6–12h cachen und bei Fehler weiterverwenden + im UI kennzeichnen.  
Nur wenn kein Wert verfügbar ist, den Indikator als „nicht verfügbar“ behandeln statt als 0.

**Nächster Schritt:**  
Die Caching- und Fallback-Logik in der Scoring-Pipeline implementieren.
