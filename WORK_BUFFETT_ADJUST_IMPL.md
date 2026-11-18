# WORK – Buffett-Indikator Adjustierung: Implementierungsvorschlag

**Stand:** 26.10.2026  
**Ziel:** Detaillierter Implementierungsvorschlag für die Adjustierung des Buffett-Indikators anhand der Index-Zusammensetzung (Thesis-Score-Logik) und des Realzinses.

---

## 1. Grundidee

Der Buffett-Indikator wird nicht mehr roh verwendet, sondern adjustiert:

\[
\text{Buffett}_{\text{adj}} = \text{Buffett}_{\text{raw}} \times f(\text{Sektor-Mix}) \times g(\text{Realzins})
\]

---

## 2. Sektor-Mix (Thesis-Score-Logik)

### Schritt 1: Sektor-Anteile holen

| Quelle | Endpoint / Methode |
|--------|--------------------|
| FMP | `/stable/etf-holdings?symbol=SPY` oder Sector Performance |
| Alternativ | Top-50-Holdings aggregieren und nach Sektor gruppieren |

**Beispiel (aktuell):**

| Sektor | Anteil |
|--------|--------|
| Technology | 32 % |
| Healthcare | 12 % |
| Financials | 13 % |
| Consumer Discretionary | 10 % |
| Industrials | 8 % |
| Sonstige | 25 % |

### Schritt 2: Thesis-Score-Äquivalent für den Index

| Klasse | Anteil (Beispiel) | Gewichtungsfaktor |
|--------|-------------------|-------------------|
| **Fast Grower** | 35 % | +0.15 |
| **Stalwart** | 40 % | 0 |
| **Cyclical** | 15 % | −0.10 |
| **Value** | 10 % | −0.05 |

### Schritt 3: Sektor-Faktor

\[
f(\text{Sektor}) = 1 + 0.15 \times \text{FastGrower} - 0.10 \times \text{Cyclical} - 0.05 \times \text{Value}
\]

**Beispiel:**
\[
f = 1 + 0.15 \times 0.35 - 0.10 \times 0.15 - 0.05 \times 0.10 = 1.0375
\]

---

## 3. Realzins-Faktor

\[
g(\text{Realzins}) = 1 + \beta \times (\text{Realzins}_t - \text{Realzins}_{\text{avg}})
\]

| Parameter | Wert |
|-----------|------|
| \(\beta\) | −0.10 |
| \(\text{Realzins}_{\text{avg}}\) | 1.5 % |

**Beispiel (2026):**
\[
g = 1 + (-0.10) \times (1.5\% - 1.5\%) = 1.0
\]

---

## 4. Gesamtformel

\[
\text{Buffett}_{\text{adj}} = \text{Buffett}_{\text{raw}} \times f(\text{Sektor}) \times g(\text{Realzins})
\]

**Beispiel (2026):**
- Buffett raw = 245 %
- f = 1.0375
- g = 1.0
- **Buffett adj = 245 % × 1.0375 × 1.0 = 254 %**

---

## 5. Implementierung

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **Sektor-Anteile** | FMP ETF Holdings oder Top-Holdings aggregieren | 4–6 h |
| **Thesis-Score-Mapping** | Sektor → Fast Grower / Cyclical / Value | 3–4 h |
| **Realzins** | FRED DFII10 holen | 2–3 h |
| **Formel** | Backend-Berechnung | 2–3 h |
| **Overlay** | Adjustierte Linie im Chart | 3–4 h |
| **Gesamt** | | **~14–20 h** |

---

## 6. Grenzen

| Punkt | Hinweis |
|-------|---------|
| Sektor-Mapping | Annahme, welche Sektoren Fast Grower sind |
| \(\beta\) | Annahme für Realzins-Sensitivität |
| Konzentration | Wird nicht adjustiert, nur angezeigt |

---

**Kurz:**  
Der Buffett-Indikator wird mit einem Sektor-Faktor (analog Thesis Score) und einem Realzins-Faktor multipliziert. Beide Faktoren brauchen Annahmen, machen die Linie aber vergleichbarer über Regime.
