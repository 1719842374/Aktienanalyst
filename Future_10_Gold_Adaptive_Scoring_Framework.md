# Gold Adaptive Scoring Framework
## Vollständige Dokumentation (Stand 2026-10-09)

### Ziel
Adaptives Scoring für Gold analog zur 1–20-Aktienanalyse und dem Makro-Framework. Bestehende Modelle (Real-Yield, Multi-Faktor, Gates) bleiben Basis, werden um Layer-Gewichtung, Policy-Signale und technische Bestätigung erweitert.

---

## 1. Bestehende Gold-Logik (Ist-Zustand)

| Komponente | Datei | Beschreibung |
|------------|-------|--------------|
| Technical Score | gold-routes.ts | RSI + MA200-Abweichung, feste Schwellen |
| Real-Yield-Modell | gold-realyield-model.ts | OLS Gold ~ Real10Y (252 Tage), Fair Value |
| Multi-Faktor | gold-realyield-model.ts | Real10Y + DXY + WALCL |
| Gates | gold-realyield-model.ts | GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS, Decoupling |
| Monte Carlo | gold-routes.ts | GBM |
| Chart | Client | Gold vs Real10Y (Dual-Axis) |

---

## 2. Neue adaptive Struktur

### Dimensionen und Signale

| Dimension | Signale | Datenquelle | Richtung |
|-----------|---------|-------------|----------|
| **Real Yield** | Fair-Value-Premium (z-Score), Real10Y-Trend | FRED DFII10 | Fallend = bullish |
| **Policy** | Fed Funds Änderung, Realzins-Rückgang | FRED FEDFUNDS, DFII10 | Senkung = bullish |
| **Liquidity** | M2 YoY, WALCL, Netto-Liquidität | FRED M2SL, WALCL | Steigend = bullish |
| **Inflation** | Breakeven (T10YIE) | FRED T10YIE | Steigend = bullish (bedingt) |
| **Supply** | AISC-Margin, Kapitulationszone | Aggregate / Berichte | Preis << AISC = Stress |
| **Technical** | RSI, MA200-Abweichung, Golden/Death Cross | Preisdaten | Cross = Bestätigung |
| **Macro** | DXY-Trend | FRED DTWEXBGS / Yahoo | Fallend = bullish |

### Datenpunkte

| Signal | FRED / Quelle | Frequenz |
|--------|---------------|----------|
| Real10Y | DFII10 | Täglich |
| M2 | M2SL | Monatlich |
| Fed Bilanz | WALCL | Wöchentlich |
| Breakeven | T10YIE | Täglich |
| DXY | DTWEXBGS | Täglich |
| Fed Funds | FEDFUNDS | Monatlich |
| Gold Preis | GCUSD / Yahoo | Täglich |
| AISC | Unternehmensaggregate | Quartalsweise |

---

## 3. Layer-Gewichtung

```typescript
const baseWeights = {
  realYield: 1.8,
  policy: 1.3,
  liquidity: 1.2,
  inflation: 0.8,
  supply: 0.9,
  technical: 1.0,
  macro: 0.9,
};

// Habitat
if (regime === "stress") baseWeights.realYield *= 1.25;
if (realRateTrend < -0.3) baseWeights.policy *= 1.2;
if (m2GrowthZ > 1) baseWeights.liquidity *= 1.15;

// Stärke-Layer
effectiveWeight = baseWeight * (0.7 + strength * 0.6);
```

---

## 4. Technische Analyse (analog BTC)

| Signal | Definition | Einbindung |
|--------|------------|------------|
| Golden Cross | 50-MA kreuzt 200-MA von unten | Technical +1 |
| Death Cross | 50-MA kreuzt 200-MA von oben | Technical -1 |
| Preis vs 200-MA | Abweichung als z-Score | Technical Stärke |
| RSI | Relativ zur eigenen Historie | Technical |

---

## 5. Angebotsseite (Miner)

| Signal | Beschreibung | Status |
|--------|--------------|--------|
| AISC-Margin | (Preis - AISC) / AISC | Gate vorhanden, als Signal erweitern |
| Kapitulationszone | Preis nahe AISC + Produktionsrückgang | Fehlt |
| Angebotsreaktion | Veränderung Minenproduktion | Fehlt |

---

## 6. Policy- und Liquiditätssignale

| Treiber | Positiv wenn | Daten |
|---------|--------------|-------|
| Zinsenkungen | Real10Y fällt, Fed Funds sinkt | DFII10, FEDFUNDS |
| Fiskal | Defizitwachstum | Treasury / FRED |
| M2-Expansion | M2 YoY hoch | M2SL |
| Fed-Bilanz | WALCL steigt | WALCL |

---

## 7. Makro-Overlays für den Gold-Chart

| Overlay | Quelle | Priorität | Begründung |
|---------|--------|-----------|------------|
| Real10Y (DFII10) | FRED | **Sehr hoch** | Bereits teilweise da, Kern-Treiber |
| M2 YoY | FRED M2SL | Hoch | Liquidität |
| DXY | FRED / Yahoo | Hoch | Inverser Treiber |
| Breakeven (T10YIE) | FRED | Mittel | Inflationserwartungen |
| WALCL | FRED | Mittel | Fed-Bilanz |
| 50/200 MA | Berechnet | Mittel | Golden/Death Cross |
| AISC-Linie | Aggregate | Niedrig–Mittel | Angebotsseite |

---

## 8. Gates (bestehend + Erweiterung)

| Gate | Bedingung | Wirkung |
|------|-----------|---------|
| GOLD_REAL_YIELD_REGIME | Stress-Regime + nicht decoupled | Warnung |
| GOLD_AISC_STRESS | Preis < AISC × 1.15 | Warnung |
| Decoupling | corr > -0.25 | Modell unzuverlässig |
| Neu: Policy-Mismatch | Hoher Preis bei steigendem Realzins | Warnung |

---

## 9. Gesamtfluss

1. Daten laden (FRED + Preis)
2. Adaptive Signale berechnen (z-Score / Stärke)
3. Regime / Habitat bestimmen
4. Layer-Gewichtung anwenden
5. Technical (inkl. MA-Cross) einbeziehen
6. Supply-Signale (AISC) ergänzen
7. Score aggregieren
8. Gates als Warnungen anzeigen
9. Chart mit Makro-Overlays (Real10Y, M2, DXY, MA)

---

## 10. Offene Punkte

- AISC-Zeitreihe beschaffen (Aggregate oder große Minen)
- Kapitulationszone definieren
- Europa-/globale Zentralbank-Käufe (qualitativ / LLM)
- Backtest der adaptiven Gewichtung auf historische Gold-Bewegungen

---

**Status:** Konzept dokumentiert. Umsetzung als Erweiterung von gold-realyield-model.ts und gold-routes.ts vorgesehen.
