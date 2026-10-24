# WORK – Rezessions-Dashboard: Technische Analyse Chart (analog Aktien Sektion 12)


![Uploading image.png…]()







**Stand:** 24.10.2026  
**Ziel:** Im Rezessions-Dashboard einen interaktiven Chart mit Overlays bauen, der die relevanten Rezessions- und Korrektur-Signale in einer einzigen Ansicht zeigt – analog zur Technischen Analyse (Sektion 12) bei Aktien.

---

## 1. Referenz: Aktien Technische Analyse (Sektion 12)

**Aktueller Aufbau (MSFT-Beispiel):**
- Hauptchart: Preis + MA200 / MA50 / MA20 + Golden Cross Marker
- Untercharts: MACD (12,26,9) + Histogram, RSI(14)
- Toggle-Bar: MA200, MA100, MA50, MA20, EMA26, EMA12, EMA9, BB, Volumen, Signale, MACD, RSI
- Zeitfenster: 3M / 6M / 1Y / 2Y / 3Y / 5Y / 10Y
- Kurs A / B / C Tabs
- Status-Box: „3/4 Bedingungen – fast kaufbereit“ (Kurs > MA200, MA50 > MA200, MACD > 0, MACD steigend)
- Golden Cross Banner mit Datum

**Ziel:** Dieselbe Interaktivität und Overlay-Logik für Rezessions-/Korrektur-Signale.

---

## 1b. Design-Referenz (Mockup 24.10.2026)

**Screenshot:** „Technische Analyse – Rezessions-Signale“

Das Mockup zeigt das gewünschte Layout und dient **nur als visuelle Referenz**. Das Design soll identisch mit der bestehenden Technischen Analyse (Sektion 12) bei Aktien sein:

- Gleiche Toggle-Bar (SPY, VIX, Yield Curve, Credit Spread, Buffett, Volume, Signale, MACD, RSI)
- Gleiche Zeitfenster-Buttons und Datumsauswahl
- Golden Cross Banner
- Mehrere synchronisierte Untercharts
- Status-Banner oben mit REZESSION 12M / KORREKTUR 12M und Top-Treibern
- Rechte Seite mit kleinen Indikator-Badges (Sahm, Buffett, CAPE, RSI, CSI)

**Wichtig:** Kein neues Design erfinden – 1:1 die Komponenten und das Look & Feel aus der Aktien-Technischen-Analyse übernehmen.

---

## 2. Was ein Analyst im Rezessions-Chart braucht

| Priorität | Overlay / Plot | Quelle | Warum wichtig | Darstellung |
|-----------|----------------|--------|---------------|-------------|
| Sehr hoch | Preis (SPY / VGK / ASHR) | Yahoo | Basis für alle Signale | Hauptlinie |
| Sehr hoch | VIX / VSTOXX | FRED VIXCLS / STOXX | Sentiment / Volatilität | Unterchart oder Dual-Axis |
| Hoch | Buffett-Indikator (TMC/GDP) | Yahoo ^W5000 + FRED GDP | Bewertungsrisiko | Normalisierter Overlay oder Unterchart |
| Hoch | Yield Curve (T10Y2Y / EZ / JP) | FRED | Leading Indicator | Unterchart |
| Mittel | Credit Spread (BAA-Trs / HY) | FRED BAA10Y / BAMLHE00EHYIOAS | Kreditstress | Unterchart |
| Mittel | RSI(14) + MACD auf dem Index | Berechnet | Technische Bestätigung | Untercharts |
| Niedrig | Margin Debt (YoY) | FINRA | Hebel | Kleines Overlay oder Badge |
| Niedrig | Google Trends „Recession“ | SerpApi | Sentiment | Badge oder kleines Overlay |

---

## 3. Vorgeschlagene Pane-Struktur

```
┌────────────────────────────────────────────────────────────┐
│ Hauptpane: SPY / VGK / ASHR Preis                       │
│ + optional Buffett normalisiert (Dual-Axis)             │
│ + Golden/Death Cross Marker                             │
├────────────────────────────────────────────────────────────┤
│ Unterpane 1: VIX / VSTOXX                               │
├────────────────────────────────────────────────────────────┤
│ Unterpane 2: Yield Curve (T10Y2Y)                       │
├─────────────────────────────────────────────────────────────┤
│ Unterpane 3: Credit Spread (BAA-Trs)                    │
├─────────────────────────────────────────────────────────────┤
│ Unterpane 4: RSI(14)                                    │
├─────────────────────────────────────────────────────────────┤
│ Unterpane 5: MACD                                       │
└─────────────────────────────────────────────────────────────┘
```

**Region-Switcher:** US / Europa / Asien (Japan) – analog zu den bestehenden Tabs im Rezessions-Dashboard.  
**Zeitfenster:** 1Y / 3Y / 5Y / 10Y / Max.  
**Toggle:** Jedes Overlay einzeln ein-/ausblendbar.

---

## 4. Datenquellen (Stand 24.10.2026)

| Overlay | Quelle | Status | Fallback |
|---------|--------|--------|----------|
| SPY / VGK / ASHR | Yahoo | Verfügbar | – |
| VIXCLS | FRED | Verfügbar (19.0) | – |
| VSTOXX | STOXX | Teilweise | FMP leer |
| Buffett US | Yahoo ^W5000 + FRED GDP | 245 % (Max-Fehler behoben?) | FRED Market Cap |
| Yield Curve US | FRED T10Y2Y | 0.31 % | – |
| Yield Curve EZ | FRED IRLTLT01EZM156N − IR3TIB01EZM156N | 1.19 % | – |
| Credit Spread US | FRED BAA10Y | 1.46 % | – |
| Credit Spread EZ | FRED BAMLHE00EHYIOAS | 3.54 % | – |
| RSI / MACD | Berechnet aus Preis | Verfügbar | – |

**N/A-Punkte (müssen nicht den Chart blockieren):**  
Japan ALQ, Spreads JP, TOPIX/CAPE JP, JNVI – Overlay einfach ausblenden und Hinweis anzeigen.

---

## 5. Scoring-Integration

Der Chart zeigt die Daten, der Score bleibt separat (wie bei Aktien).  
Optional: Kleine Badges über dem Chart mit den aktuellen Untergruppen-Wahrscheinlichkeiten:

- Rezession 12M: 30 %
- Korrektur 12M: 80 %
- Top-3 Treiber: Buffett +16, CAPE +12.6, CSI +3

---

## 6. Implementierungsaufwand

| Teil | Aufwand |
|------|---------|
| Backend: Aggregations-Endpoint (SPY + VIX + Buffett + Yield + Spread) | 6–8 h |
| Frontend: Multi-Pane Chart (analog TechnicalChart.tsx) | 10–14 h |
| Region-Switcher + Toggle + Zeitfenster | 4–6 h |
| Fehlerbehandlung (N/A Overlays ausblenden) | 2–3 h |
| **Gesamt** | **~22–31 h** |

**Priorität:** Hoch (reduziert den Sprung zwischen 4–5 Sektionen).

---

## 7. Akzeptanzkriterien

1. Ein Chart zeigt Preis + mindestens VIX + Yield Curve.
2. Region-Switcher (US / Europa / Asien) funktioniert.
3. Toggle für einzelne Overlays.
4. Zeitfenster 1Y / 5Y / Max.
5. N/A-Daten (z. B. Japan Spreads) blenden den Overlay aus, blockieren den Chart nicht.
6. Golden/Death Cross Marker auf dem Preis-Pane.
7. Design identisch mit Aktien Sektion 12 (gleiche Komponenten, gleiches Look & Feel).

---

## 8. Kurzfassung

Der Rezessions-Chart soll die Logik und das Design der Aktien-Technischen-Analyse übernehmen: ein Hauptchart mit mehreren synchronisierten Untercharts und Toggles. Die wichtigsten Overlays sind Preis, VIX, Buffett, Yield Curve und Credit Spread. Fehlende Daten werden ausgeblendet, nicht als Fehler angezeigt. Das Mockup vom 24.10.2026 dient nur als visuelle Referenz.
