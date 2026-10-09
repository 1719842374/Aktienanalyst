# Adaptive Macro Framework – Rezessions- und Korrektur-Wahrscheinlichkeit
## Vollständige Dokumentation (Stand 2026-10-09)

### Ziel
Ein nicht-hardcodiertes, adaptives Scoring-System für Rezessions- und Korrektur-Wahrscheinlichkeiten, das sich an das Marktumfeld (Habitat) anpasst – analog zu Thesis- und Managing-Score bei Aktien.

---

## 1. Kernkonzept

Das Framework kombiniert:
- Adaptive quantitative Signale (z-Score / Perzentil über 15–20 Jahre)
- Ökonomische Dimensionen
- Managing-Score (Materialisierung von Narrativen)
- Makro-Bilanzwidersprüche
- Realized Growth Gap und Inventory/Demand Gap
- Habitat-basierte Layer-Gewichtung
- Optionalen LLM-Call

---

## 2. Datenquellen und Datenpunkte

| Signal | Quelle | Datenpunkt | Frequenz |
|--------|--------|------------|----------|
| Gewinnwachstum vs. Trend | Multpl / Shiller / FMP | S&P TTM EPS YoY | Quartalsweise |
| Realized Growth Gap | FMP / Earnings Aggregate | Surprise-Rate, Forward-Revisionen | Quartalsweise |
| Inventory/Demand Gap | FRED | Inventory-to-Sales, DGORDER vs Shipments | Monatlich |
| Sahm-Regel | FRED SAHMREALTIME | ALQ-Veränderung | Monatlich |
| Zinskurve | FRED T10Y2Y / T10Y3M | Spread | Täglich |
| Kreditspreads | FRED BAA10Y | Spread | Täglich |
| Margin Debt | FINRA | Debit Balances YoY | Monatlich |
| VIX | FRED VIXCLS | Close | Täglich |
| Buffett | Yahoo ^W5000 + FRED GDP | TMC/GDP | Täglich |
| CAPE | Multpl | Shiller PE10 | Monatlich |
| Realzins | FRED DFII10 | 10J Real Yield | Täglich |
| Konzentration | Berechnung | Cap-Weight RSL − Equal-Weight RSL | Täglich |
| CAPEX Hyperscaler | Aggregate / Berichte | YoY CAPEX | Quartalsweise |

---

## 3. Historische Prüfung (2001, 2008, 2022)

| Konzept | 2001 | 2008 | 2022 | Kommentar |
|---------|------|------|------|-----------|
| Reine Bewertung | Teilweise/spät | Nein | Ja | Sieht Level, nicht den Bruch |
| Realized Growth Gap | Nein/spät | Nein/spät | Mittel | Oft zu spät |
| Inventory/Demand Gap | Nein | Teilweise | Nein | Nur bei Lagerzyklen |
| Kredit / Margin Debt | Schwach | **Ja** | Mittel | 2008 klar |
| Managing-Score | **Besser** | Mittel | **Ja** | Zinsen + Earnings |
| Habitat-Gewichtung | **Besser** | Gut | **Ja** | Verstärkt richtige Signale |
| Managing + Habitat | **Am besten** | Gut | **Am besten** | Beste Kombi für 2001/2022 |

**Fazit:** Managing-Score + Habitat-Gewichtung am stärksten für bewertungs-/zinsgetriebene Phasen. Kredit-/Widerspruchs-Seite nötig für 2008.

---

## 4. Layer-Gewichtung (Code-Schema)

```typescript
function calculateAdaptiveWeights(habitat, signals) {
  const base = {
    bewertung: 1.8,
    kredit: 1.2,
    realwirtschaft: 1.0,
    geldpolitik: 1.0,
    sentiment: 0.8,
    managing: 1.5,
    widersprueche: 1.3,
  };

  // Habitat
  if (habitat.regime === "restrictive") {
    base.bewertung *= 1.3;
    base.managing *= 1.2;
    base.geldpolitik *= 1.2;
  }
  if (habitat.concentration > 0.4) {
    base.bewertung *= 1.15;
  }

  // Layer: Stärke erhöht Gewicht
  for (const s of signals) {
    const dim = mapToDimension(s.indicator);
    if (dim && base[dim]) {
      base[dim] *= (0.7 + s.strength * 0.6);
    }
  }
  return base;
}
```

---

## 5. Managing-Score (Korrektur)

Prüft Materialisierung:
- CAPEX vs. Trend
- EPS-Wachstum vs. Trend
- Realzins vs. Trend
- Konzentration (Cap − Equal RSL)

Negativer Score erhöht Korrektur-Wahrscheinlichkeit.

---

## 6. Vergleich zu Aktien-Thesis/Managing

| Aktien | Makro |
|--------|-------|
| Thesis prüft Narrativ vs. Zahlen | Managing prüft CAPEX/EPS im Zyklus |
| Managing prüft Umsetzung | Widersprüche prüfen Inkonsistenzen |
| Dynamische Gewichtung | Habitat + Layer-Gewichtung |
| Qualitative Einschätzung | LLM-Call |

---

## 7. Grenzen

- Datenverzug (Quartalsdaten)
- Exogene Schocks ohne Vorlauf
- Europa: teilweise schwächere Daten (Surprise-Rate, Equal-Weight, CAPEX)
- LLM nur leichte Kalibrierung

---

## 8. Verbesserungsvorschläge

- Europa-Fallbacks definieren
- Habitat-Erkennung verfeinern
- LLM-Output strukturiert (JSON) + Cache
- Transparenz im Dashboard (welche Gewichte angepasst wurden)
- Historische Validierung auf 2000/2008/2022

---

**Status:** Konzept vollständig dokumentiert. Umsetzung über Analyse-Button mit adaptiver Gewichtung und optionalem LLM-Call vorgesehen.
