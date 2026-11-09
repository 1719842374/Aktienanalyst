# WORK_SECTOR_PE_ATTRACTIVITY_REVERSEDCF.md

**Stand:** 2026-10-28  
**Status:** Offen / Implementierungsvorschlag  
**Sektion:** Researcher → Sector Opportunity / Sektorrotation  
**Aktuelle Phase:** Spätkonjunktur (Konfidenz 50 %)

---

## 1. PE-10J wird nicht geladen (0/9)

### Ist-Zustand (Screenshot)

| Punkt | Beobachtung |
|-------|-------------|
| Warnung | „PE-10J unvollständig (0/9). Fehlende Werte → Fallback-Label, pe10yCoverage sinkt.“ |
| Bewertung-Spalte | Alle Sektoren „n.v.“ |
| Folge | Keine historische Bewertung, kein Vergleich zu 10J-Durchschnitt |

### Theoretische Lösung: PE aus ETF + Gewichtung

Sektor-PE lässt sich aus den Top-Holdings eines Sektor-ETFs berechnen:

```
Sektor-PE ≈ Σ (Gewicht_i × PE_i) / Σ Gewicht_i
```

Oder gewichteter harmonischer Mittelwert für bessere Genauigkeit.

### Datenquellen

| Quelle | Endpoint / Methode | Verfügbarkeit |
|--------|--------------------|-----------------|
| FMP ETF Holdings | `/stable/etf-holder` oder Holdings-Endpoint | Top 10–20 Holdings |
| FMP Key Metrics / Ratios | `/stable/key-metrics` oder `/stable/ratios` | PE pro Aktie |
| FMP Historical | `/stable/historical-price-eod` + Earnings | Historische PE |
| Fallback | Sektor-ETF selbst (XLK, XLV etc.) | Trailing PE des ETFs |

### Implementierung

1. Pro Sektor-ETF (XLK, XLC, XLY, XLI, XLF, XLE, XLV, XLP, XLU) Top-Holdings holen.
2. Für jede Holding aktuelles PE (TTM oder Forward) laden.
3. Gewichteten Sektor-PE berechnen.
4. Historischen 10J-Durchschnitt analog (jährlich oder quartalsweise aggregieren).
5. In der Tabelle „Bewertung“ anzeigen (z. B. „28,4 (10J Ø 22,1)“).

### Aufwand

| Schritt | Aufwand |
|---------|---------|
| Holdings + PE Aggregation | 4–6 h |
| Historischer 10J-Durchschnitt | 3–4 h |
| Frontend-Anzeige | 2 h |
| **Gesamt** | **~9–12 h** |

---

## 2. Attraktivität – Ampel-Logik und Pfeile fehlen

### Ist-Zustand

| Punkt | Beobachtung |
|-------|-------------|
| Attraktivität | Zahl (z. B. 3.0, 4.3) ohne Kontext |
| Ampel | Keine Farbcodierung (grün/gelb/rot) |
| Pfeile | Keine Pfeile wie im Morning Briefing, die zeigen, dass der Sektor in der aktuellen Phase positiv ist |

### Erwartetes Verhalten

| Attraktivitäts-Score | Ampel | Bedeutung |
|---------------------|-------|-----------|
| ≥ 4.0 | Grün | Stark attraktiv |
| 3.0 – 3.9 | Gelb | Neutral / moderat |
| < 3.0 | Rot | Weniger attraktiv |

Zusätzlich:
- Pfeil nach oben (grün) bei Phase-Fit ≥ 4 und positiver 6M-Performance.
- Pfeil nach unten (rot) bei Phase-Fit ≤ 2 oder stark negativer Performance.

### Implementierung

1. Attraktivitäts-Score in Ampel-Farbe umsetzen (CSS oder Badge).
2. Kleines Icon/Pfeil neben dem Score oder in der Phase-Fit-Spalte.
3. Logik an bestehende Phase-Fit- und Performance-Daten koppeln.

### Aufwand

| Schritt | Aufwand |
|---------|---------|
| Ampel-Logik + Farben | 2 h |
| Pfeile / Icons | 1–2 h |
| **Gesamt** | **~3–4 h** |

---

## 3. Reverse DCF für Sektoren / ETFs fehlt

### Ist-Zustand

- Bei Einzelaktien gibt es gehärteten Inverse-DCF + g* (Sektion 16).
- Bei Sektoren / ETFs fehlt eine analoge Anzeige: „Wie viel Wachstum ist bereits eingepreist?“

### Ziel

Pro Sektor (oder Sektor-ETF) anzeigen:

| Metrik | Bedeutung |
|--------|-----------|
| g* (impliziert) | Wachstum, das der aktuelle Kurs bereits einpreist |
| Realized Growth | Tatsächliches Wachstum der letzten Jahre |
| Gap | Differenz (eingepreist vs. realisiert) in Prozentpunkten |
| Prozentual | „XX % des erwarteten Wachstums bereits im Kurs“ |

### Berechnung (analog Einzelaktie)

```
g* ≈ WACC − (FCF / EV)
```

Oder aus Forward-Konsens / Analysten-Schätzungen des ETFs bzw. der Top-Holdings.

### Datenquellen

| Quelle | Verwendung |
|--------|------------|
| FMP ETF Holdings | Top-Holdings für Aggregation |
| FMP Key Metrics / Cash Flow | FCF, EV pro Holding |
| FMP Analyst Estimates | Forward-Wachstum |
| Sektor-ETF selbst | Fallback (Dividendenrendite + Wachstum) |

### Anzeige

- Neue Spalte oder Tooltip: „Eingepreist: 12,4 % (Realized 8,1 % → Gap +4,3 pp)“.
- Optional: Prozentuale Anzeige „68 % des erwarteten Wachstums bereits im Kurs“.

### Aufwand

| Schritt | Aufwand |
|---------|---------|
| Aggregation g* über Holdings | 5–7 h |
| Realized Growth + Gap | 3–4 h |
| Frontend-Anzeige | 2–3 h |
| **Gesamt** | **~10–14 h** |

---

## 4. Gesamtaufwand und Priorisierung

| Feature | Aufwand | Priorität |
|---------|---------|------------|
| PE aus ETF-Gewichtung + 10J-Ø | 9–12 h | Hoch |
| Attraktivitäts-Ampel + Pfeile | 3–4 h | Mittel |
| Reverse DCF für Sektoren | 10–14 h | Mittel–Hoch |
| **Gesamt** | **~22–30 h** | – |

---

## 5. Akzeptanzkriterien

1. PE-10J wird für alle 9 Sektoren angezeigt (aktuell + historischer Durchschnitt).
2. Attraktivität hat Ampel-Farbe und Pfeile bei Phase-Fit.
3. Pro Sektor wird angezeigt, wie viel Wachstum bereits eingepreist ist (g* + Gap in %).
4. Keine „n.v.“ mehr in der Bewertung-Spalte, wenn Holdings-Daten verfügbar sind.
5. Fallback auf ETF-eigenes PE, wenn Holdings unvollständig sind.

**Quellen:** Screenshots (Sector Opportunity, PE-Warnung), FMP ETF Holdings / Key Metrics, bestehende Inverse-DCF-Logik aus Sektion 16.
