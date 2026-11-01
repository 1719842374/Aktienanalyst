# WORK – Realzins-Adjustierung des Buffett-Indikators

**Stand:** 26.10.2026  
**Ziel:** Erklärung, wie der Realzins die Bewertung beeinflusst, wie eine Adjustierung funktioniert und ein illustrativer Backtest.

---

## 1. Wie wirkt sich der Realzins auf die Bewertung aus

Der Realzins beeinflusst den Diskontierungssatz:

\[
\text{WACC} \approx \text{Realzins} + \text{Inflationserwartung} + \text{Risikoprämie}
\]

| Realzins | Effekt auf Bewertung |
|----------|----------------------|
| **Niedrig / negativ** | Niedrigerer Diskontierungssatz → höhere Fair Values → höhere Multiples |
| **Hoch** | Höherer Diskontierungssatz → niedrigere Fair Values → niedrigere Multiples |

**Beispiel:**
- Realzins −1 % → Buffett kann 20–30 % höher liegen, ohne dass die Bewertung „teurer“ ist.
- Realzins +2 % → Buffett sollte niedriger liegen.

---

## 2. Wie funktioniert die Realzins-Adjustierung

### Formel

\[
\text{Buffett}_{\text{adj}} = \text{Buffett}_{\text{raw}} \times (1 + \beta \times (\text{Realzins}_t - \text{Realzins}_{\text{avg}}))
\]

| Parameter | Bedeutung | Annahme |
|-----------|-----------|---------|
| \(\beta\) | Sensitivität | −0.10 (d. h. −10 % Buffett pro +1 % Realzins) |
| \(\text{Realzins}_{\text{avg}}\) | Langfristiger Durchschnitt | ~1.5 % |

### Beispiel

| Jahr | Buffett raw | Realzins | Buffett adj |
|------|-------------|----------|-------------|
| 2021 | 210 % | −1.0 % | 210 % × (1 + (−0.10)×(−1.0−1.5)) = 210 % × 1.25 = **262 %** |
| 2026 | 245 % | +1.5 % | 245 % × (1 + (−0.10)×(1.5−1.5)) = **245 %** |

2021 war der adjustierte Wert höher, weil der negative Realzins die Bewertung gestützt hat.

---

## 3. Illustrativer Backtest

| Jahr | Buffett raw | Realzins | Buffett adj | Zone (adj) |
|------|-------------|----------|-------------|------------|
| 2000 | 150 % | +3.0 % | 135 % | Normal |
| 2008 | 80 % | +1.0 % | 84 % | Niedrig |
| 2021 | 210 % | −1.0 % | 262 % | Extrem |
| 2022 | 180 % | +0.5 % | 198 % | Hoch |
| 2026 | 245 % | +1.5 % | 245 % | Extrem |

**Beobachtung:**  
2021 war der adjustierte Buffett höher als der raw-Wert. 2026 ist er gleich, weil der Realzins nahe am Durchschnitt liegt.

---

## 4. Grenzen

| Punkt | Limit |
|-------|-------|
| \(\beta = -0.10\) | Annahme, nicht empirisch kalibriert |
| Realzins-Daten | FRED DFII10 verfügbar, aber nicht für alle Zeiträume |
| Andere Faktoren | Tech-Anteil, Margen, Konzentration bleiben |

---

## 5. Aufwand

| Schritt | Aufwand |
|---------|---------|
| Realzins-Serie holen | 2–3 h |
| Adjustierung berechnen | 2–3 h |
| Overlay im Chart | 2–3 h |
| **Gesamt** | **~6–9 h** |

---

**Kurz:**  
Die Realzins-Adjustierung verschiebt den Buffett-Indikator um eine angenommene Sensitivität. Sie macht die Linie vergleichbarer über Zinsregime, bleibt aber eine Annahme.
