# Scoring-Logik – Adaptivität und historische Crashes (2001, 2008, 2022)

## Frage
Ist die Scoring-Logik des Rezessions-Dashboards adaptiv genug, dass sie die Börsencrashes bzw. Korrekturen 2001 (Dotcom), 2008 (GFC) und 2022 (Inflation/Rate-Hike) **ohne Hardcodings** richtig erkannt hätte?

## Kurzantwort
**Teilweise.** Die Logik ist größtenteils zonenbasiert und damit adaptiv für aktuelle Daten. Die festen Schwellen (z. B. Buffett >200% = +16, CAPE >35 = +12.6, VIX >30 = +4) sind jedoch historisch kalibriert und hätten in den drei Fällen unterschiedlich gut funktioniert.

---

## 1. Buffett-Indikator (TMC/GDP)

**Aktuelle Zonen:**
- >200%: +16
- 165–200%: +10
- 140–165%: +4
- <140%: -8

**Historische Werte (ungefähre Spitzen):**
| Jahr | Buffett (ca.) | Zone nach aktueller Logik | Score |
|------|---------------|---------------------------|-------|
| 2000 | ~150–160% | 140–165% | +4 |
| 2008 | ~100–120% | <140% | -8 |
| 2021/22 | ~200–210% | >200% | +16 |

**Bewertung:**  
2000 und 2022 wären erkannt worden, 2008 **nicht** (der Crash kam aus dem Kreditmarkt, nicht aus extremer Equity-Bewertung). Die Schwellen sind nicht rein adaptiv – sie sind an die letzten 25 Jahre kalibriert.

---

## 2. Shiller CAPE

**Aktuelle Zonen:**
- >35: +12.6
- 30–35: +5.4
- 15–30: 0
- <15: -9

**Historische Werte:**
| Jahr | CAPE (ca.) | Zone | Score |
|------|------------|------|-------|
| 2000 | ~44 | >35 | +12.6 |
| 2008 | ~24–27 | 15–30 | 0 |
| 2021 | ~38 | >35 | +12.6 |
| 2022 (Tief) | ~27 | 15–30 | 0 |

**Bewertung:**  
2000 und 2021 klar erkannt. 2008 und der 2022-Tiefpunkt nicht über CAPE (der Crash war kreditgetrieben). Die Schwelle >35 ist historisch sinnvoll, aber nicht dynamisch an den langfristigen Median angepasst.

---

## 3. VIX

**Aktuelle Zonen:**
- >30: +4
- 20–30: +1
- 15–20: 0
- <15: -3

**Historische Spitzen:**
- 2008: ~80 → klar +4
- 2020: ~82 → klar +4
- 2022: ~35–36 → +4

**Bewertung:**  
Sehr gut adaptiv. Die Zonen hätten alle drei Crashes klar signalisiert.

---

## 4. Sahm-Regel

Die Sahm-Regel (0,5 pp Anstieg der Arbeitslosenquote) ist **adaptiv** und hat 2001 und 2008 korrekt signalisiert. 2022 war kein klassischer Rezessions-Crash, sondern eine Korrektur – die Sahm-Regel hat 2022 nicht getriggert (korrekt).

---

## 5. Gesamtbewertung der Adaptivität

| Crash | Buffett | CAPE | VIX | Sahm | Gesamt |
|-------|---------|------|-----|------|--------|
| 2001 (Dotcom) | Schwach (+4) | Stark (+12.6) | Mittel | Ja | Gut |
| 2008 (GFC) | Schlecht (-8) | Neutral (0) | Stark (+4) | Ja | Mittel |
| 2022 | Stark (+16) | Stark (2021) | Stark (+4) | Nein | Gut |

**Fazit:**
- Die Logik ist **nicht vollständig adaptiv**. Die wichtigsten Bewertungsschwellen (Buffett >200%, CAPE >35) sind hardcoded und an die jüngere Historie angepasst.
- 2008 wäre über VIX + Sahm erkannt worden, aber **nicht** über die Bewertungsindikatoren.
- Eine rein adaptive Variante würde z. B. z-Scores oder Perzentile über rollierende 20–30 Jahre verwenden statt fester Schwellen.

---

## 6. Empfohlene Verbesserung (adaptiver)

Statt fester Zonen:

```typescript
// Beispiel: z-Score über 20 Jahre
const zScore = (current - rollingMean20y) / rollingStd20y;
const score = Math.min(4, Math.max(-4, zScore * 1.5));
```

Oder Perzentil-basiert:
- >90. Perzentil → hoher Score
- <10. Perzentil → negativer Score

Damit wäre die Logik weniger abhängig von festen Schwellen und hätte 2008 und 2001 konsistenter erkannt.
