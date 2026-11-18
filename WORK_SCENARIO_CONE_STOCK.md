# WORK – Szenario-Kegel im Aktien-Chart (nur Visualisierung)

**Stand:** 26.10.2026  
**Ziel:** Szenario-Kegel als Overlay ab dem letzten Kurs im Technical-Analysis-Chart. Nur Visualisierung, keine neue Scoring-Logik.

---

## 1. Szenario-Kegel im Aktien-Chart

Ab dem letzten Kurs wird ein Kegel angehängt:

| Linie | Berechnung | PoS |
|-------|------------|-----|
| **Trendszenario** | Kurs × (1 + g*) | 50 % (Platzhalter) |
| **Bull-Szenario** | Kurs × (1 + Forward-Konsens) | 30 % (Platzhalter) |
| **Bear-Szenario** | Kurs × (1 − Expected Damage) | 20 % (Platzhalter) |

**PoS** kommt aus den bestehenden Katalysatoren (Sektion 17) oder aus dem Monte-Carlo (Sektion 18).

---

## 2. Reverse DCF in Sektion 16

\[
g^* = \text{WACC} - \frac{\text{FCF}}{\text{EV}}
\]

Das ist bereits berechnet. Der Kegel nutzt g* als Trendlinie.

---

## 3. Wahrscheinlichkeiten

### Aktuell: Platzhalter

Die 50 % / 30 % / 20 % sind **nicht berechnet**. Sie sind Platzhalter.

### Echte Wahrscheinlichkeiten

| Szenario | Mögliche Quelle | Wie berechnet |
|----------|-----------------|---------------|
| **Trendszenario** | Monte Carlo P50 | Anteil der Pfade im Intervall [P40, P60] |
| **Bull-Szenario** | Monte Carlo P75 oder Katalysator-PoS | Anteil der Pfade > Forward-Konsens oder Summe der positiven Katalysator-PoS |
| **Bear-Szenario** | Monte Carlo P25 oder Expected Damage | Anteil der Pfade < Worst Case oder Expected Damage aus Risikoinversion |

### Beispiel (MSFT)

- Monte Carlo: P(Verlust) = 22,7 % → Bear ≈ 23 %
- Katalysatoren: Σ positive GB = +17,5 %
- g* = 8,39 % → Trend

### Formeln

\[
P_{\text{trend}} = \text{Anteil der Monte-Carlo-Pfade im Intervall } [P40, P60]
\]

\[
P_{\text{bull}} = \text{Anteil der Pfade } > \text{Forward-Konsens}
\]

\[
P_{\text{bear}} = \text{Anteil der Pfade } < \text{Worst Case}
\]

---

## 4. Aufwand

| Schritt | Aufwand |
|---------|---------|
| Backend: Szenario-Daten für Aktie | 4–6 h |
| Frontend: Kegel ab letztem Kurs | 4–6 h |
| PoS-Label | 2–3 h |
| **Gesamt** | **~10–15 h** |

---

**Kurz:**  
Der Kegel lässt sich direkt auf den Aktien-Chart übertragen. g* aus Sektion 16 ist die Trendlinie. Echte PoS kommen aus dem Monte Carlo oder den Katalysatoren. Die 50/30/20 sind Platzhalter.
