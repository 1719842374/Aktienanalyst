# WORK – Buffett-Indikator: Historische Verzerrung & Overlays

**Stand:** 26.10.2026  
**Ziel:** Dokumentation der historischen Verzerrung des Buffett-Indikators und der geplanten Overlays (Margin, ROIC, Kapitalintensität) im Technischen Analyse Chart.

---

## 1. Das Problem

Der Buffett-Indikator ist in Prozent, aber die Prozent beziehen sich auf unterschiedliche Index-Zusammensetzungen:

| Jahr | Buffett | Was der Index war |
|------|---------|-------------------|
| 1970 | ~80 % | Industrials, Utilities |
| 2000 | ~150 % | Telecom, Tech-Anteil steigend |
| 2026 | 245 % | Tech / Hyperscaler dominant |

80 % im Jahr 1970 und 245 % im Jahr 2026 sind nicht direkt vergleichbar, weil der Index andere Margen, anderes Wachstum und andere Kapitalintensität hatte.

---

## 2. Was nicht sauber fixbar ist

### Konzentration

| Option | Limit |
|--------|-------|
| Equal-Weight Buffett | Zeigt Breite, aber Cap-Weight bleibt relevant |
| Top-10-Abzug | Künstlich |
| Hinweis | Löst nichts |

Konzentration ist ein reales Marktmerkmal.

### Niedrigzins-Erbe

| Option | Limit |
|--------|-------|
| Realzins-adjustierte Trendlinie | Braucht Annahme |
| Zwei Linien | Zeigt Unsicherheit, löst sie nicht |
| Kein Adjust | Ehrlicher |

Der Zinseffekt ist real, aber nicht sauber quantifizierbar.

---

## 3. Overlays im Technischen Analyse Chart

| Overlay | Was er zeigt | Quelle |
|---------|--------------|--------|
| **Operating Margin** | Aggregierte Marge des Index | FMP / Top-Holdings |
| **ROIC** | Return on Invested Capital | FMP Key Metrics |
| **Kapitalintensität** | Capex / Revenue | FMP Cash Flow |
| **Buffett** | Marktwert / BIP | Bestehend |

### Darstellung
- Kurs links.
- Margin / ROIC / Capex-Intensity rechts (%).
- Buffett als zusätzliche Linie oder Unterchart.

### Beispiel

| Jahr | Buffett | Op. Margin | ROIC | Capex/Rev |
|------|---------|------------|------|-----------|
| 2000 | ~150 % | ~12 % | ~10 % | ~8 % |
| 2010 | ~90 % | ~14 % | ~12 % | ~6 % |
| 2026 | 245 % | ~18 % | ~16 % | ~5 % |

Man sieht, ob der Buffett-Anstieg mit höheren Margen und ROIC einhergeht.

---

## 4. Aufwand

| Schritt | Aufwand |
|---------|---------|
| Aggregation (Top-Holdings oder ETF) | 6–8 h |
| Overlay im Chart | 4–6 h |
| **Gesamt** | **~10–14 h** |

---

**Kurz:**  
Margin, ROIC und Kapitalintensität als Overlay neben dem Buffett-Indikator. Dann ist sichtbar, ob die Bewertung mit den Fundamentaldaten mitläuft. Konzentration und Niedrigzins-Erbe bleiben als Hinweis.
