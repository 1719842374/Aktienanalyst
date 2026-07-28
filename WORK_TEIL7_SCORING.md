# WORK_TEIL7_SCORING.md

> TEIL 7 + Gold + Realzins-Modell (Implementierung + **Details**)  
> Stand: 28.07.2026 | Nur Dokumentation

---

# TEIL 7 — TREND-GATES & REALZINS-MODELL

## 7.1–7.7 Scoring (Kurz)

Nike Level-vs-Delta · pricingPower · relativeMomentum · gates (Cap 55/60/65/70) · trendMult · Catalyst · buildVerdict  
→ voller Code in Git-History dieser Datei / vorherige Commits.

---

# 7.8 Gold & Realzins

## 7.8.1–7.8.3 Indikatoren + Chart

Angebot: AISC, Cost Curve, GDX/GLD  
Makro: Real Yield, DXY, Fed Funds  
Chart: Gold (links) vs Real10Y (rechts), Stress rot / Tailwind grün

## 7.8.8 Implementierung (Code-Kern)

```
resolveReal10Y: DFII10 primär | DGS10−T10YIE Fallback
buildGoldMacroSeries → GoldMacroPoint[]
goldRealYieldInverseScore (Pearson, window 60)
goldFairValueModel (rolling OLS, window 252, Band ±10%)
goldRateSensitivity / goldRateScenarios (−100…+150 bp)
deriveGoldRegimeZones / runRealYieldGoldModel
Gates: GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS
```

---

## 7.8.9 Realzins-Modell — Details

### 1) Ökonomische Begründung

Gold zahlt keinen Coupon und keine Dividende. Die **Opportunitätskosten** des Haltens  
sind der reale risikofreie Zins:

- Realzins ↑ → Anleihen/Cash werden real attraktiver → Kapitalrotation weg von Gold → Preisdruck  
- Realzins ↓ → Opportunitätskosten sinken → Gold relativ attraktiver → Rückenwind  

Deshalb ist die Beziehung **invers**. Nominalzinsen allein reichen nicht: bei hoher Inflation  
kann der Nominalzins steigen und Gold trotzdem steigen (Realzins fällt oder bleibt tief).

$$
\text{Real10Y} = \underbrace{\text{DFII10}}_{\text{TIPS-Markt}} \approx \text{DGS10} - \text{T10YIE}
$$

| Komponente | FRED | Bedeutung |
|------------|------|-----------|
| DGS10 | Nominal 10Y Treasury | „roher“ Zins |
| T10YIE | 10Y Breakeven Inflation | implizite Inflationserwartung |
| DFII10 | 10Y TIPS Yield | **direkter** Realzins (bevorzugt) |

Differenz DFII10 vs. (DGS10−T10YIE): meist klein (Liquidity-/Technical-Spread).  
**Regel:** DFII10 primär; Fallback nur wenn DFII10 fehlt.

Kurzfristig parallel:

$$
\text{Real Fed Funds} = \text{FEDFUNDS} - \text{CPI YoY}
$$

= aktuelle Policy-Straffung in Echtzeit (TIPS = Marktpreis für 10J).

---

### 2) Fair-Value-Gleichung im Detail

**1-Faktor (Standard):**

$$
G_t = \alpha_t + \beta_t \, R_t + \varepsilon_t
$$

- \(G_t\): Gold Spot $/oz  
- \(R_t\): Real10Y in % (z.B. 1.5 = 1,5 %)  
- \(\beta_t\): **negativ** erwartet (z.B. −150 bis −400 $/oz pro Prozentpunkt)  
- \(\alpha_t, \beta_t\): rolling OLS über Window \(W\) (Default 252 Handelstage ≈ 1J)

**OLS-Schätzer im Window \([t-W+1, t]\):**

$$
\hat\beta = \frac{\sum (R_i - \bar R)(G_i - \bar G)}{\sum (R_i - \bar R)^2}, \quad
\hat\alpha = \bar G - \hat\beta \, \bar R
$$

$$
FV_t = \hat\alpha + \hat\beta \, R_t, \quad
\text{Residual\%} = \frac{G_t - FV_t}{FV_t}
$$

| Residual% | Regime |
|-----------|--------|
| < −10 % | undervalued |
| −10 % … +10 % | fair |
| > +10 % | overvalued |

**Interpretation von β:**

```
β = −250  →  +100 bp Realzins ≈ −$250/oz Gold
Bei Gold = $2.500:  −250/2500 = −10 % je 100 bp
→ durationProxy ≈ 10  (Modell; Literatur oft ~15–20)
```

---

### 3) Zahlenbeispiel (illustrativ)

```
Window-Schätzung:
  mean(Real10Y) = 1.8 %
  mean(Gold)    = 2.400
  β             = −280 $/oz je pp
  α             = 2.400 − (−280)*1.8 = 2.904

Aktuell: Real10Y = 2.2 %, Spot = 2.650
  FV = 2.904 + (−280)*2.2 = 2.288
  Residual% = (2.650 − 2.288) / 2.288 ≈ +15.8 % → overvalued

Szenario +100 bp (Real → 3.2 %):
  implied = 2.650 + (−280)*1.0 = 2.370  (−10.6 %)

Szenario −100 bp (Real → 1.2 %):
  implied = 2.650 + (−280)*(−1.0) = 2.930  (+10.6 %)
```

---

### 4) Korrelation vs. Fair-Value (zwei getrennte Ebenen)

| Metrik | Frage | Fenster |
|--------|-------|--------|
| **Pearson Inverse-Score** | Bewegt sich Gold *gegen* ΔRealzins? | 60–120 Tage (kurz, Regime) |
| **Fair-Value OLS** | Wo *sollte* Gold bei aktuellem Niveau liegen? | 252 Tage (Niveau-Beziehung) |

- Starke Inverse (corr < −0.5) + Spot ≈ FV → klassisches Regime, wenig Edge  
- Decoupling (corr > −0.2) → Gate GOLD_REAL_YIELD_REGIME; FV weniger verlässlich  
- Spot ≫ FV bei intakter Inverse → überbewertet *innerhalb* des Zinsmodells  
- Spot ≪ FV → unterbewertet (Zinsmodell sieht Upside, wenn Inverse hält)

---

### 5) Edge Cases & Robustheit

| Fall | Handling |
|------|----------|
| DFII10 fehlt an Tag t | Fallback DGS10−T10YIE; Flag `source: 'DGS10-T10YIE'` |
| Beide fehlen | Punkt aus Serie droppen oder real10Y forward-fill max 3 Tage |
| Window < 252 am Serienanfang | fairValue = null, regime = 'n/a' bis genug Historie |
| den = 0 (konstante Realzinsen im Window) | FV null, kein β |
| Extrem-β (\|β\| > 1000) | Cap/Warnung — wahrscheinlich Datenfehler oder Regimebruch |
| Gold- und FRED-Kalender misaligned | As-of merge: FRED daily, Gold daily; Missing = previous business day |
| Wochenende/Feiertage | business-day alignment; kein Interpolieren von Preisen |

**Decoupling-Phasen (historisch):**  
Starke geopolitische Schocks, Zentralbank-Kaufwellen oder extreme USD-Moves können  
die Inverse temporär brechen. Dann: Korrelations-Flag setzen, FV-Gewicht in UI senken,  
nicht blind Szenarien als Prognose verkaufen.

---

### 6) Multi-Faktor-Erweiterung (optional, Phase 2)

$$
G_t = \alpha + \beta_1 R_t + \beta_2 \text{DXY}_t + \beta_3 \log(\text{FedBalance}_t) + \varepsilon
$$

| Faktor | Erwartetes Vorzeichen | Rolle |
|--------|----------------------|--------|
| Real10Y | β₁ < 0 | dominant |
| DXY | β₂ < 0 | USD-Stärke drückt Gold |
| Fed-Bilanz | β₃ > 0 | Liquidität / QE-Proxy |

Implementierung: 2×2 oder 3×3 Normalgleichungen; nur wenn DXY- und Bilanz-Serien  
sauber aligned sind. **MVP bleibt 1-Faktor Realzins.**

---

### 7) Kalibrierungs-Defaults

| Parameter | Default | Begründung |
|-----------|---------|------------|
| OLS Window | 252 | ~1 Handelsjahr, stabil aber regimesensitiv |
| Inverse Window | 60 | ~3 Monate, schneller Regime-Check |
| Fair-Band | ±10 % | pragmatisch; engere Bänder → mehr „over/under“-Signale |
| Stress-Schwelle Real | ±15 bp über lookback | vermeidet Rauschen |
| Stress-Schwelle Gold | ±2 % über lookback | symmetrisch zum Zins-Move |
| Decoupling-Gate | corr > −0.25 | unterhalb klassischer −0.5-Stärke |
| Szenario-Shocks | −100…+150 bp | realistischer Policy-Korridor |

---

### 8) Datenfrequenz & Alignment

```
Gold:   daily close (USD/oz)
FRED:   daily (DGS10, DFII10, T10YIE) / monthly (CPI) für realFedFunds
Merge:  inner join auf gemeinsame business days
CPI:    last-observation-carried-forward auf daily für realFedFunds-Serie
AISC:   quartalsweise (WGC) → step-function auf daily Chart
```

---

### 9) UI-Mapping (was der User sieht)

```
┌─ Chart ─────────────────────────────────────────┐
│ Gold Spot + Fair-Value-Linie (aus OLS)          │
│ Real10Y (rechte Achse)                          │
│ Residual-Band ±10 % als leichte Schattierung    │
│ Stress/Tailwind ReferenceAreas                  │
├─ KPI-Zeile ─────────────────────────────────────┤
│ Spot | FV | Residual% | Regime-Badge            │
│ Real10Y | Quelle (DFII10/Fallback)              │
│ Corr(60d) | Inverse-Score | Flags               │
│ Duration-Proxy (% / 100bp)                      │
├─ Szenario-Tabelle ──────────────────────────────┤
│ Shock bp | Implied Gold | Δ%                    │
│ −100 | … | …                                    │
│ …                                               │
└─────────────────────────────────────────────────┘
```

---

### 10) Test-Vektoren (für spätere Unit-Tests)

```
1) Konstanter Realzins, Gold steigt → β≈0, FV≈mean(Gold), Residual driftet
2) Perfekte Inverse: Gold = 3000 − 200*Real → β≈−200, Residual≈0, regime fair
3) DFII10 null, DGS10=4.0, T10YIE=2.2 → real=1.8, source=DGS10-T10YIE
4) Window 10 bei Serie Länge 5 → alle FV null
5) +100bp Shock, β=−250, Gold=2500 → implied=2250 (−10%)
6) corr berechnet auf synthetischer Serie mit corr=−0.7 → score ≈ 80–90
```

---

## 7.9 Checkliste Implementierung

```
[ ] goldMacro.ts mit allen Funktionen aus 7.8.8 + Defaults aus 7.8.9§7
[ ] FRED: DFII10, DGS10, T10YIE, FEDFUNDS, CPIAUCSL (WORK2 §8.12)
[ ] Business-day Merge Gold ↔ FRED
[ ] Chart + KPI + Szenario-Tabelle
[ ] Unit-Tests gemäß §10
[ ] Gate GOLD_REAL_YIELD_REGIME an Verdict
```

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
