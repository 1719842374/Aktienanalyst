# WORK – Prognostiziertes Wachstum & Gap-Analyse im Rezessions-Dashboard

**Stand:** 26.10.2026  
**Status 21:30 Europe/Madrid (18.11.2026) · #468 · main `806772f2`:** DC-Lauf `run-d8063a19` GO (test-recession-growth-pp-render Exit 0, 10/10, 0 HTTP; tsc 76, Normdiff 0; Hook, Route und `shared/recession-growth.ts` bytegleich). Ampel 🟡 nur noch bis Prod-Smoke `806772f2` (Tester läuft, SPY 1440/375 hell+dunkel, EU/Asien als Stichprobe). Testlücken bleiben: Implied Gap als Zahl, negative und Null-Werte. Spec bleibt offen, kein `fertig_`-Rename.  
**Status 21:21 Europe/Madrid (18.11.2026) · #468 · main `806772f2`:** Pp-Darstellung der Differenzen (Growth Gap, Implied Gap, Abstand Median) auf main `806772f2c9a25b0c92c21b82e4ef7458520c395d` (#468). Tester-PASS eng (SPY 1440/375 light/dark). Nicht getestet: Implied Gap als Zahl, negative und Null-Werte, EU (VGK) und Asien (ASHR). Spec bleibt offen, kein `fertig_`-Rename.  
**Ziel:** Markt-prognostiziertes Wachstum als Plot + Gap-Analyse analog Inventory Gap im Aktien-Dashboard. Index-Ebene.

---

## 1. Plots

| Linie | Was sie zeigt | Quelle |
|-------|---------------|--------|
| **Index-Kurs** | Preis | Yahoo / FMP |
| **Historisches EPS YoY** | Realisiertes Wachstum | FMP Income Statement |
| **Forward-Konsens** | Analysten-Erwartung | FMP Analyst Estimates |
| **g* (Reverse DCF)** | Vom Markt eingepreistes Wachstum | Berechnet |
| **Realistisches Wachstum** | Eigenes Modell (z. B. 5Y-Trend oder Median der letzten 10 Jahre) | Berechnet |

---

## 2. Gap-Analyse (analog Inventory Gap)

### Growth Gap

\[
\text{Growth Gap} = g_{\text{fwd}} - g_{\text{realized}}
\]

| Gap | Bedeutung |
|-----|-----------|
| **Positiv** | Markt erwartet mehr Wachstum als zuletzt realisiert → Upside-Risiko oder Überoptimismus |
| **Negativ** | Markt erwartet weniger als realisiert → Downside-Risiko oder Unterbewertung |
| **Nahe 0** | Erwartung und Realität im Takt |

### Realized vs. Implied Gap

\[
\text{Implied Gap} = g^* - g_{\text{realized}}
\]

Zeigt, wie weit der Markt vom realisierten Wachstum entfernt ist.

---

## 3. Analogie zu Inventory Gap

| Aktien-Dashboard | Rezessions-Dashboard |
|------------------|----------------------|
| Inventory Gap | Growth Gap |
| Lageraufbau ohne Nachfrage | Erwartetes Wachstum ohne Realisierung |
| Frühindikator für Schwäche | Frühindikator für Multiple-Compression |

---

## 4. Szenario-Kegel (aus dem Bild)

- **Trendszenario:** Realistisches Wachstum (Median 10Y oder 5Y-Trend).
- **Extremszenarien:** +2σ / −2σ vom Trend.
- **Störereignis:** Exogener Schock (LLM-Flag oder VIX-Spike).
- **Entscheidungspunkt:** Wenn Gap > Schwelle → Warnung im Dashboard.

---

## 5. Implementierung

| Schritt | Beschreibung | Aufwand |
|---------|--------------|---------|
| **Backend** | `/api/recession/growth-gap/:index` | 8–10 h |
| **Berechnung** | g*, Forward, Realized, Gap | 4–6 h |
| **Frontend** | Overlay + Gap-Label | 4–6 h |
| **Szenario-Kegel** | Optional als Band um den Trend | 3–4 h |
| **Gesamt** | | **~19–26 h** |

---

**Kurz:**  
Ja. Forward-Konsens + g* + realistisches Wachstum als Plots. Growth Gap analog Inventory Gap. Aufwand ~19–26 h.
