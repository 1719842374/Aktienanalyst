# WORK_STABLECOIN_TBILL_GENIUS.md

> Stand: 24.08.2026 | Adaptive / generische Logik (nicht hardcodiert)

---

## Ziel

Integration eines **Stablecoin → T-Bill Nachfrage-Kanals** + **GENIUS Act Impact** in das BTC- und Gold-Dashboard.

Die Logik ist **adaptiv** (Z-Scores, Percentiles, dynamische Multiplikatoren), nicht hardcodiert.

---

## 1. Kern-Metriken (täglich / wöchentlich)

| Metrik | Quelle | Warum relevant | Darstellung |
|--------|--------|----------------|-------------|
| Total Stablecoin Market Cap | DefiLlama / CoinGecko | Gesamtgröße der Nachfrage | Absolute + 30d Change |
| USDT + USDC Market Cap | DefiLlama | Dominante Player (~85–90 %) | Stacked Bar / Linie |
| Geschätzte T-Bill Holdings | Issuer Reports (Tether/Circle) + dynamischer Multiplikator | Direkte Nachfrage | Absolute $ + Anteil |
| Stablecoin → T-Bill Multiplikator | Gewichteter Durchschnitt aus aktuellen Transparency Reports | Realitätsnah statt fest 0.75 | Live-Wert |
| GENIUS Act Status / Strength | Manuell + Perplexity | Regulatorischer Treiber | Score 0–1.5 |

**Fakten:**
- Tether hält historisch ca. **70–80 %** der Reserves in US T-Bills.
- Circle (USDC) hält hohen Anteil in Cash + T-Bills.
- Bei aktuellem Stablecoin-Markt ~$250–300 Mrd. und Projektionen auf $1–3 Bio. entsteht strukturelle, anhaltende T-Bill-Nachfrage.
- GENIUS Act (seit Juli 2025 in Kraft) schafft den regulatorischen Rahmen für institutionelles Wachstum.

---

## 2. Adaptive Signal-Logik (empfohlen)

```python
# 1. Stablecoin-Wachstum relativ zum eigenen Verlauf
stablecoin_zscore = (current_30d_change - rolling_mean_30d_change) / rolling_std_30d_change

if stablecoin_zscore > 1.5:          # Stark überdurchschnittliches Wachstum
    score += 1.5
elif stablecoin_zscore > 0.8:
    score += 1.0

# 2. T-Bill Share relativ zur eigenen Historie (seit 2021)
t_bill_percentile = percentile_rank(current_t_bill_share, historical_t_bill_shares)

if t_bill_percentile > 80:           # Oberes Quintil
    score += 1.0
elif t_bill_percentile > 60:
    score += 0.5

# 3. Multiplikator dynamisch aus Issuer-Reports
# Statt fest 0.75 → gleitender / gewichteter Durchschnitt der realen Tether/Circle T-Bill-Quoten
dynamic_multiplier = weighted_avg([tether_tbill_ratio, usdc_tbill_ratio], weights=[0.7, 0.3])
estimated_demand = 30d_stablecoin_change * dynamic_multiplier

# 4. GENIUS Act nicht nur boolean, sondern Stärke
# 0 = nicht aktiv, 1 = in Kraft, 1.5 = Implementation weit fortgeschritten + messbarer Effekt
genius_strength = get_genius_impact_score()   # via Perplexity oder manuell gepflegt
score += genius_strength * 0.8
```

### Vergleich Hardcoded vs. Adaptive

| Element | Hardcoded (alt) | Adaptive Version |
|---------|------------------|------------------|
| Wachstumsschwelle | > $5 Mrd. | Z-Score oder Percentile der eigenen 30d-Veränderungen |
| T-Bill Share | > 20 % | Percentile Rank seit 2021 |
| Multiplikator | fest 0.75 | Gewichteter Durchschnitt aus aktuellen Issuer-Reports |
| GENIUS Act | True/False | Stärke-Score (0–1.5) |
| Gewichtung im Gesamt-Score | fest +1 | Dynamisch je nach Regime (z. B. höher wenn Real Yields steigen) |

---

## 3. Dashboard-Layout Vorschlag

```
Liquidity & Fiscal Impulse
├── Fed Balance Sheet + Net Liquidity
├── T-Bill Share & Net Issuance
└── Stablecoin Liquidity Channel          ← NEU
    ├── Stablecoin Market Cap (USDT/USDC)
    ├── Geschätzte T-Bill Nachfrage (dynamischer Multiplikator)
    ├── GENIUS Act Impact Tracker (Strength-Score)
    └── Signal: Stablecoin-getriebene Liquidität (adaptiv)
```

---

## 4. Datenquellen

| Datenpunkt | Beste Quelle | API / Methode | Aktualisierung |
|------------|--------------|---------------|----------------|
| Stablecoin Market Cap | DefiLlama | `/stablecoins` Endpoint | Täglich |
| USDT / USDC einzeln | DefiLlama oder CoinGecko | Einfach | Täglich |
| Tether T-Bill Holdings | Tether Transparency Report | Manuell oder gescraped | Monatlich |
| Circle Reserves | Circle Transparency | Manuell | Monatlich |
| GENIUS Act Status | Perplexity Prompt oder manuell | „GENIUS Act implementation status“ | Wöchentlich |
| Geschätzte Bill-Nachfrage | Eigene Formel mit dynamic_multiplier | Berechnet | Täglich |

**Beispiel-Berechnung:**
```
Geschätzte zusätzliche T-Bill Nachfrage =
  (Aktuelle Stablecoin MCap – MCap vor 30 Tagen) × dynamic_multiplier
```

---

## 5. Historischer Vergleich (Kontext)

| Phase | Stablecoin MCap | Geschätzte T-Bill Nachfrage | BTC-Reaktion |
|-------|-----------------|-----------------------------|--------------|
| 2022 (Bärenmarkt) | ~150 Mrd. | Begrenzt | Stark negativ |
| 2023 Erholung | Wachstum auf ~130–160 Mrd. | Steigend | +154 % |
| 2026 aktuell | ~250–300 Mrd. + GENIUS | Strukturell höher | Sofortige Reaktion auf Twist |

---

## 6. Integration in bestehendes Scoring (Trend-Gates / Thesis-Strength)

- **+1.0 bis +1.5 Punkte** bei hohem Stablecoin-Z-Score (> 0.8 / > 1.5)
- **+0.5 bis +1.0 Punkte** bei T-Bill-Share im oberen Percentile (> 60 / > 80)
- **+0.8 × genius_strength** (0–1.5)

Das unterscheidet klar zwischen zyklischer (Yellen 2023) und struktureller (GENIUS + Stablecoins) Nachfrage und bleibt regime-robust.

---

## 7. Empfohlene Umsetzungsschritte

1. **Basis-Version** (schnell): Hardcoded Thresholds behalten + klar als „Rule-based“ kennzeichnen.
2. **Adaptive Layer** (nächster Schritt):
   - Rolling Z-Scores und Percentiles berechnen
   - Multiplikator aus den letzten 3–4 Transparency Reports ableiten
   - GENIUS-Impact als manuellen oder Perplexity-gesteuerten Score (0–1.5)

So bleibt die Logik nachvollziehbar und wird deutlich weniger anfällig für Regime-Wechsel.

---

**Nächster praktischer Schritt:** Streamlit-/React-Code-Block für die „Stablecoin Liquidity Channel“-Sektion (inkl. DefiLlama-Abfrage + Z-Score/Percentile-Logik) ausformulieren.
