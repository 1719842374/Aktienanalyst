# WORK – Earnings Yield & ROIC 5Y Plot in Technischer Analyse

**Stand:** 26.10.2026  
**Ziel:** Earnings Yield und ROIC 5Y als Plots in Sektion 12 (Technische Analyse), mit Möglichkeit, andere Ticker aus derselben Branche als Kurs- oder ROIC-Plot hinzuzufügen.

---

## 1. Was geplottet wird

| Plot | Formel | Quelle | Achse |
|------|--------|--------|-------|
| **Earnings Yield** | EBIT / EV | FMP Income + Enterprise Value | Rechte Achse (%) |
| **ROIC 5Y** | NOPAT / Invested Capital | FMP Key Metrics oder berechnet | Rechte Achse (%) |
| **Kurs** | Close | Yahoo / FMP | Linke Achse |
| **Peer-Kurs** | Close (Peer) | Yahoo / FMP | Linke Achse |
| **Peer-ROIC** | ROIC (Peer) | FMP | Rechte Achse |

---

## 2. UI in Sektion 12

**Bestehender Chart bleibt.** Neue Toggles:

| Toggle | Funktion |
|--------|----------|
| **Earnings Yield** | EBIT/EV als Linie auf rechter Achse. |
| **ROIC 5Y** | ROIC der letzten 5 Jahre als Linie auf rechter Achse. |
| **Peer hinzufügen** | Ticker-Suche (analog Rel. Bewertung). Peer wird als Kurs- oder ROIC-Linie eingeblendet. |

**Beispiel:**
- MSFT Kurs (links)
- MSFT Earnings Yield (rechts)
- ORCL ROIC (rechts, gestrichelt)
- SAP Kurs (links, gestrichelt)

---

## 3. Datenfluss

```
1. Frontend: Toggle Earnings Yield / ROIC / Peer
2. Backend: 
   - Earnings Yield: /stable/income-statement + /stable/enterprise-values
   - ROIC: /stable/key-metrics oder berechnet aus NOPAT / Invested Capital
   - Peer: gleiche Endpoints für Peer-Ticker
3. Chart: Dual-Axis (Kurs links, Yield/ROIC rechts)
```

---

## 4. Implementierung

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **Backend Endpoint** | `/api/chart/earnings-yield/:symbol` und `/api/chart/roic/:symbol` | 6–8 h |
| **Peer-Suche** | Analog Rel. Bewertung (Sektion 9) | 3–4 h |
| **Frontend Toggles** | Earnings Yield, ROIC, Peer-Selector | 4–6 h |
| **Dual-Axis Chart** | Bestehenden Chart erweitern | 3–4 h |
| **Caching** | 6 h Cache für Yield/ROIC | 1–2 h |
| **Gesamt** | | **~17–24 h** |

---

## 5. Beispiel-Daten (MSFT)

| Jahr | EBIT | EV | Earnings Yield | ROIC |
|------|------|----|----------------|------|
| 2022 | ~$83B | ~$2.0T | ~4.2 % | ~28 % |
| 2023 | ~$89B | ~$2.4T | ~3.7 % | ~30 % |
| 2024 | ~$109B | ~$3.1T | ~3.5 % | ~32 % |
| 2025 | ~$128B | ~$3.5T | ~3.7 % | ~31 % |
| 2026 TTM | ~$155B | ~$4.0T | ~3.9 % | ~32 % |

*(Werte geschätzt aus bestehenden Dashboard-Daten.)*

---

**Kurz:**  
Earnings Yield und ROIC 5Y als Dual-Axis-Plots in Sektion 12. Peer-Ticker können als Kurs oder ROIC eingeblendet werden. Aufwand ~17–24 h.
