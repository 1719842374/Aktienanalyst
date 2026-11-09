# Rezessions-Dashboard – Scoring-Logik erklärt (Stand 2026-10-09)

## Übersicht

Das Dashboard berechnet fünf Wahrscheinlichkeiten:

| Untergruppe | Horizont | Netto-Score | Max-Score | Wahrscheinlichkeit |
|-------------|----------|-------------|-----------|--------------------|
| Rezession Coincident | 3M | -2.0 | 11.0 | **40%** |
| Rezession Leading | 6M | -5.0 | 20.0 | **40%** |
| Rezession Vollständig | 12M | -2.0 | 23.0 | **30%** |
| Korrektur Sentiment | 3-6M | 0.0 | 8.0 | **50%** |
| Korrektur Vollständig | 12M | +30.6 | 52.5 | **80%** |

---

## 1. Grundformel für die Wahrscheinlichkeit

Für die meisten Untergruppen gilt:

\[
P = 50\% + \left( \frac{\text{Netto-Score}}{\text{Max-Score}} \right) \times 50\%
\]

- Netto-Score positiv → Wahrscheinlichkeit > 50%
- Netto-Score negativ → Wahrscheinlichkeit < 50%
- Ergebnis wird gerundet

**Beispiel Korrektur Vollständig (12M):**
\[
50\% + \left( \frac{30.6}{52.5} \right) \times 50\% = 79.1\% \approx 80\%
\]

---

## 2. Rezession Vollständig (12M) – Sonderfall mit NY-Fed-Anker

Hier wird der reine Score mit dem NY-Fed-Wert gemischt:

\[
P_{\text{final}} = P_{\text{score}} \times 0.7 + \text{NY-Fed} \times 0.3
\]

- Reiner Score: 50% + (-2.0 / 23.0) × 50% = **45.7%**
- NY-Fed-Anker: **0.62%**
- Final: 45.7% × 0.7 + 0.62% × 0.3 = **~32% → 30%**

Der NY-Fed-Wert (RECPROUSM156N) wirkt hier stark dämpfend.

---

## 3. Indikatoren und Gewichtung

### Rezessions-Indikatoren (8) – Max 23.0

| Indikator | Aktueller Wert | Raw | Gewicht | Gewichtet |
|-----------|----------------|-----|---------|-----------|
| Sahm-Regel | 0.00 pp | -1 | ×1 | -1 |
| Inv. Zinskurve | T10Y2Y 0.47% | +1 | ×1 | +1 |
| Aktivität (IP) | YoY +1.4% | -2 | ×1 | -2 |
| Durable Goods | 8.4% | -2 | ×1 | -2 |
| M2 | 5.7% | 0 | ×1 | 0 |
| Kreditspreads | 1.46% | -1 | ×1 | -1 |
| Konsumklima (CSI) | 51.7 | +3 | ×1 | +3 |
| Weekly Nowcast | 2.71 | 0 | ×0 | 0 |
| **Summe** | | | | **-2.0** |

### Korrektur-Indikatoren (6) – Max 52.5

| Indikator | Aktueller Wert | Raw | Gewicht | Gewichtet |
|-----------|----------------|-----|---------|-----------|
| Buffett (TMC/GDP) | 249% | +8 | ×2 | **+16** |
| Shiller CAPE | 41.6 | +7 | ×1.8 | **+12.6** |
| Margin Debt | YoY +37.2% | +2 | ×1 | +2 |
| Google Trends | 59 (7d Ø) | 0 | ×1.7 | 0 |
| VIX | 15.4 | 0 | ×1 | 0 |
| VIX-Proxy | 15.4 | 0 | ×1 | 0 |
| **Summe** | | | | **+30.6** |

---

## 4. Wichtige Scoring-Zonen (Auszug)

| Indikator | Zone → Score |
|-----------|--------------|
| Buffett | >200%: +16 \| 165-200%: +10 \| 140-165%: +4 \| <140%: -8 |
| Shiller CAPE | >35: +12.6 \| 30-35: +5.4 \| 15-30: 0 \| <15: -9 |
| VIX | >30: +4 \| 20-30: +1 \| 15-20: 0 \| <15: -3 |
| Google Trends | >75: +11.9 \| 60-75: +6.8 \| 30-60: 0 \| <30: -6.8 |
| Konsumklima | CSI <60: +3 |
| Kreditspreads | 1.0-1.5%: -1 |

---

## 5. Regionale Kataloge

- **USA** (Gewicht 0.70): Katalog Rez. 40%, Katalog Korr. 95%
- **Eurozone** (Gewicht 0.20): Katalog Rez. 30%, Katalog Korr. 55%
- **Japan** (Gewicht 0.10): Katalog Rez. 65%, Katalog Korr. N/A

**Gewichtete Gesamtwerte:**
- Gewichtete Rezession 12M: **35%**
- Gewichtete Korrektur 12M: **75%**

Die Handlungsempfehlung basiert jedoch weiterhin auf den **US-Büchern** (P_korr12 = 80%, P_rez12 = 30%).

---

## 6. Top-Treiber der aktuellen Bewertung

1. **Buffett Indikator**: +16 (Extrem überbewertet 249%)
2. **Shiller CAPE**: +12.6 (Extrem hoch 41.6)
3. **Konsumklima (CSI)**: +3 (Pessimistisch <60)

Diese drei Treiber erklären den Großteil der 80% Korrektur-Wahrscheinlichkeit.

---

## 7. Zusammenfassung der Logik

1. Jeder Indikator bekommt einen Raw-Score nach festen Zonen.
2. Raw-Score wird mit dem Gewicht multipliziert.
3. Die gewichteten Scores werden pro Untergruppe summiert (Netto-Score).
4. Netto-Score / Max-Score wird in eine Wahrscheinlichkeit umgerechnet (50% ± 50%).
5. Bei der 12M-Rezession wird zusätzlich der NY-Fed-Anker (30%) eingemischt.
6. Regionale Kataloge existieren parallel, fließen aber nicht in die Haupt-Gauges ein.

**Aktuelles Ergebnis (09.10.2026):**  
Niedrige Rezessionswahrscheinlichkeit (30–40%), aber hohe Korrekturwahrscheinlichkeit (80%) durch extreme Bewertung (Buffett + CAPE).
