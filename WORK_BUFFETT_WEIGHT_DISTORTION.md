# WORK – Buffett-Indikator Gewichtung: Invertierung

**Stand:** 26.10.2026  
**Frage:** Ist der Buffett-Indikator adaptiv und generisch gewichtet, oder verzerrt er die Korrektur-Wahrscheinlichkeit künstlich auf 80 %?

---

## 1. Aktuelle Gewichtung

| Indikator | Gewicht | Max | Aktuell | Beitrag |
|-----------|---------|-----|---------|---------|
| **Buffett (TMC/GDP)** | ×2 | 16 | +8 → +16 | +16 |
| **Shiller CAPE** | ×1.8 | 12.6 | +7 → +12.6 | +12.6 |
| Margin Debt | ×1 | 4 | +2 | +2 |
| Google Trends | ×1.7 | 11.9 | 0 | 0 |
| VIX | ×1 | 4 | 0 | 0 |
| VIX-Proxy | ×1 | 4 | 0 | 0 |
| **Summe** | | **52.5** | | **+30.6** |

**Formel:**
\[
P = 50\% + \frac{30.6}{52.5} \times 50\% = 79.1\% \rightarrow 80\%
\]

---

## 2. Ist das adaptiv?

**Nein.**

| Punkt | Adaptiv? | Begründung |
|-------|----------|------------|
| Gewicht ×2 / ×1.8 | Nein | Hardcoded |
| Zone >200 % = +16 | Nein | Feste Schwelle |
| Zone >35 CAPE = +12.6 | Nein | Feste Schwelle |
| z-Score / Perzentil | Nein | Nicht verwendet |

Die Gewichte und Zonen sind fest. Sie passen sich nicht an die Historie an.

---

## 3. Verzerrung

Buffett + CAPE liefern **+28.6 von +30.6** (93 % des Netto-Scores).

| Szenario | Buffett | CAPE | Summe | P |
|----------|---------|------|-------|---|
| Aktuell (245 % / 40.4) | +16 | +12.6 | +30.6 | 80 % |
| Ohne Buffett/CAPE | 0 | 0 | +2 | ~52 % |
| Nur Buffett | +16 | 0 | +18 | ~67 % |

**Ergebnis:**  
Sobald Buffett >200 % und CAPE >35 sind, geht die Korrektur-Wahrscheinlichkeit automatisch auf ~80 %. Das ist seit Jahren der Fall.

---

## 4. Ist das gewollt?

**Teilweise.**

- Hohe Bewertung soll die Korrektur-Wahrscheinlichkeit erhöhen.
- Aber die feste Schwelle und das hohe Gewicht erzeugen eine **systematische Verzerrung**, solange die Bewertung strukturell hoch bleibt (Tech-Anteil, Niedrigzins-Erbe).

---

## 5. Empfehlung

| Option | Beschreibung | Aufwand |
|--------|--------------|---------|
| **A** | Gewicht auf ×1 reduzieren | 1 h |
| **B** | z-Score / Perzentil statt fester Zone | 4–6 h |
| **C** | Beides | 5–7 h |

**Empfehlung:** Option B.  
Relative Bewertung (z-Score über 15–20 Jahre) statt fester 200 %-Schwelle. Dann ist der Beitrag hoch, wenn die Bewertung extrem relativ zur eigenen Historie ist – nicht automatisch bei jedem Wert über 200 %.

---

**Kurz:**  
Der Buffett-Indikator ist nicht adaptiv gewichtet. Die feste Zone >200 % und das Gewicht ×2 treiben die Korrektur-Wahrscheinlichkeit systematisch auf 80 %. Das ist eine künstliche Verzerrung, solange die Bewertung strukturell hoch bleibt.
