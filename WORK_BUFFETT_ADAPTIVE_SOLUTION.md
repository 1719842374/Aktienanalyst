# WORK – Buffett-Indikator: Adaptive Lösung ohne Hardcoding

**Stand:** 26.10.2026  
**Ziel:** Vollständige Dokumentation der adaptiven Lösung für die historische Verzerrung des Buffett-Indikators. Alle Zahlen, Daten, Fakten und Implementierungsschritte von A bis Z.

---

## 1. Das Problem

Der Buffett-Indikator (Marktwert / BIP) verwendet eine feste Schwelle (>200 % = +16) und eine historische Trendlinie, die unterschiedliche Index-Zusammensetzungen nicht berücksichtigt.

| Jahr | Buffett | Index-Zusammensetzung |
|------|---------|-----------------------|
| 1970 | ~80 % | Industrials, Utilities |
| 2000 | ~150 % | Telecom, Tech steigend |
| 2026 | 245 % | Tech / Hyperscaler dominant |

245 % heute sind nicht mit 80 % im Jahr 1970 vergleichbar, weil der Index andere Margen, anderes Wachstum und andere Kapitalintensität hat.

**Folge:**  
Buffett + CAPE liefern +28.6 von +30.6 (93 % des Netto-Scores). Die Korrektur-Wahrscheinlichkeit geht automatisch auf ~80 %.

---

## 2. Daten, die vorhanden sind

| Input | Quelle | Verfügbar? |
|-------|--------|------------|
| **Sektor-Anteile** | FMP ETF Holdings / historische Sektor-Gewichte | Ja |
| **EPS-CAGR** | FMP Income Statement (aggregiert) | Ja |
| **Operating Margin** | FMP Income Statement | Ja |
| **Realzins** | FRED DFII10 | Ja |
| **Buffett** | Yahoo ^W5000 / FRED GDP | Ja |

---

## 3. Lösung: Regression ohne feste Schwellen

\[
\text{Buffett}_t = \alpha + \beta_1 \times \Delta\text{Sektor}_t + \beta_2 \times \text{EPS-CAGR}_t + \beta_3 \times \text{Margin}_t + \beta_4 \times \text{Realzins}_t + \epsilon
\]

Die \(\beta\) werden aus der Historie geschätzt. Kein festes Gewicht, kein festes Perzentil, kein festes Mapping.

### Perzentile aus den Daten

Statt fester Schwellen wird der Rang innerhalb des Index verwendet:

\[
\text{Perzentil}_i = \text{Rang}(\text{EPS-CAGR}_i) \text{ innerhalb des Index}
\]

### Konzentration

Wird nicht extra behandelt. Sie steckt in den Sektor-Anteilen. Ein Sektor mit 30 % Anteil wirkt automatisch stärker in der Regression.

---

## 4. Was das löst

| Problem | Gelöst? |
|---------|---------|
| Feste 200 %-Schwelle | Ja |
| Sektor-Mix | Ja |
| Realzins | Ja |
| Margen | Ja |
| Konzentration | Ja (über Anteile) |
| Struktureller Regime-Wechsel | Ja (über Veränderung der Inputs) |

---

## 5. Übertragbarkeit

| Region | Funktioniert? |
|--------|---------------|
| **USA** | Ja |
| **Europa** | Ja (gleiche Logik, andere Daten) |
| **China** | Ja (gleiche Logik, andere Daten) |

Kein US-spezifisches Mapping.

---

## 6. Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `server/buffett-route.ts` | Regression und adjustierte Berechnung |
| `client/components/BuffettChart.tsx` | Overlay für adjustierte Linie |
| `server/services/sector-aggregation.ts` | Neu: Sektor-Anteile historisch |
| `server/services/regression.ts` | Neu: Regression für \(\beta\) |

---

## 7. Implementierungsschritte

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **1** | Historische Sektor-Anteile aus FMP holen | 4–6 h |
| **2** | EPS-CAGR und Margin aggregieren | 3–4 h |
| **3** | Realzins (FRED DFII10) holen | 1–2 h |
| **4** | Regression bauen (kein festes \(\beta\)) | 4–6 h |
| **5** | Adjustierte Linie im Chart | 2–3 h |
| **6** | Overlay und Tooltip | 2–3 h |
| **Gesamt** | | **~16–24 h** |

---

## 8. Beispielrechnung (illustrativ)

| Jahr | Buffett raw | \(\Delta\)Tech | EPS-CAGR | Margin | Realzins | Buffett adj |
|------|-------------|----------------|----------|--------|----------|-------------|
| 2000 | 150 % | +5 pp | 12 % | 12 % | +3.0 % | ~140 % |
| 2021 | 210 % | +10 pp | 15 % | 16 % | −1.0 % | ~230 % |
| 2026 | 245 % | +2 pp | 10 % | 18 % | +1.5 % | ~240 % |

*(Werte illustrativ. Echte \(\beta\) kommen aus der Regression.)*

---

## 9. Grenzen

| Punkt | Hinweis |
|-------|---------|
| Kurze Historie | Regression braucht mindestens 10–15 Jahre |
| Datenqualität Europa / China | Sektor-Historie lückenhafter als USA |
| Variablen-Auswahl | Die Inputs müssen festgelegt werden |

---

**Kurz:**  
Eine Regression auf Sektor-Veränderung, EPS-CAGR, Margin und Realzins adjustiert den Buffett-Indikator ohne feste Schwellen. Die Daten sind vorhanden. Die Logik ist auf USA, Europa und China übertragbar. Aufwand ~16–24 h.
