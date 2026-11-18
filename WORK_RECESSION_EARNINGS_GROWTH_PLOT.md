# WORK – Gewinnwachstum-Plot im Rezessions-Dashboard

**Stand:** 26.10.2026  
**Ziel:** Plot des Gewinnwachstums (historisch + erwartet) auf Index-Ebene im Rezessions-Dashboard. Keine Einzelaktien.

---

## 1. Macht es Sinn?

**Ja.**  
Gewinnwachstum ist der wichtigste fundamentale Treiber für den Index. Ein Overlay zeigt, ob der Kursanstieg durch reales Wachstum oder nur durch Multiple-Expansion getrieben ist – analog zur Earnings-Yield-Idee bei Einzelaktien, aber auf Index-Ebene.

---

## 2. Welcher Index

| Region | Index | Quelle |
|--------|-------|--------|
| **USA** | S&P 500 (SPY) | FMP oder Yahoo |
| **Europa** | Euro Stoxx 600 (EXSA / VGK) | FMP oder Yahoo |
| **Asien** | Nikkei 225 oder ASHR | FMP oder Yahoo |

**Kein Einzelaktien-Overlay.** Nur Index-Level.

---

## 3. Formeln

### Historisches Gewinnwachstum (YoY)

\[
g_t = \frac{\text{EPS}_t}{\text{EPS}_{t-1}} - 1
\]

**Quelle:** FMP `/stable/income-statement` für den ETF oder aggregiert über Top-Holdings.

### Erwartetes Gewinnwachstum (Forward)

\[
g_{\text{fwd}} = \frac{\text{EPS}_{\text{consensus}}}{\text{EPS}_{\text{TTM}}} - 1
\]

**Quelle:** FMP `/stable/analyst-estimates` für den ETF oder gewichtet über Top-Holdings.

### Reverse-DCF-Implied Growth (Index)

\[
g^* = \text{WACC} - \frac{\text{FCF}_{\text{Index}}}{\text{EV}_{\text{Index}}}
\]

**Quelle:** Aggregiert aus FMP Enterprise Values + Free Cash Flow der Top-Holdings oder ETF-Level.

---

## 4. Plot-Aufbau

| Linie | Achse | Quelle |
|-------|-------|--------|
| **Index-Kurs** | Links | Yahoo / FMP |
| **EPS YoY (historisch)** | Rechts (%) | FMP Income Statement |
| **EPS Forward (Konsens)** | Rechts (%) | FMP Analyst Estimates |
| **g* (Reverse DCF)** | Rechts (%) | Berechnet |

**Zeitfenster:** 5Y / 10Y / Max.

---

## 5. Implementierung

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **Backend** | Endpoint `/api/recession/earnings-growth/:index` | 8–10 h |
| **Aggregation** | Top-Holdings oder ETF-Level EPS / FCF | 4–6 h |
| **Frontend** | Overlay im bestehenden Rezessions-Chart | 4–6 h |
| **Caching** | 6 h | 1–2 h |
| **Gesamt** | | **~17–24 h** |

---

## 6. Beispiel (S&P 500)

| Jahr | EPS YoY | Forward EPS | g* |
|------|---------|-------------|-----|
| 2023 | +5 % | +8 % | ~6 % |
| 2024 | +9 % | +12 % | ~7 % |
| 2025 | +12 % | +14 % | ~8 % |
| 2026 TTM | +10 % | +11 % | ~7 % |

*(Werte illustrativ.)*

---

**Kurz:**  
Ja, es macht Sinn. Index-Level (SPY / EXSA / Nikkei), historisches + erwartetes EPS-Wachstum + Reverse-DCF g* als Overlay. Aufwand ~17–24 h.
