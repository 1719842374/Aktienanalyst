# WORK_TEIL7_SCORING.md

> TEIL 7 + Gold + Realzins-Modell (Implementierung + Details)  
> Stand: 28.07.2026 | Nur Dokumentation

---

# TEIL 7 — TREND-GATES & REALZINS-MODELL

## 7.1–7.7 Scoring (Kurz)

Nike Level-vs-Delta · pricingPower · relativeMomentum · gates · trendMult · Catalyst · buildVerdict  
→ Code in Git-History / vorherige Commits.

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
goldRealYieldInverseScore / goldFairValueModel / goldRateScenarios
deriveGoldRegimeZones / runRealYieldGoldModel
Gates: GOLD_REAL_YIELD_REGIME, GOLD_AISC_STRESS
```

---

## 7.8.9 Realzins-Modell — Details

### 1) Ökonomische Begründung

Gold zahlt keinen Coupon. Opportunitätskosten = realer risikofreier Zins (invers).

- Realzins hoch → Druck auf Gold  
- Realzins tief → Rückenwind  

**Real10Y** = DFII10 (primär) oder DGS10 − T10YIE (Fallback).  
**Real Fed Funds** = FEDFUNDS − CPI YoY (kurzfristige Policy).

### 2)–5) Fair-Value OLS, Zahlenbeispiel, Korrelation vs FV, Edge Cases

Siehe Git-History dieser Datei für Vollformeln (1-Faktor MVP).

---

### 6) Multi-Faktor-Erweiterung (optional, Phase 2)

#### 6.1 Gleichung

$$
G_t = \alpha + \beta_1 R_t + \beta_2 \,\mathrm{DXY}_t + \beta_3 \log(B_t) + \varepsilon_t
$$

| Faktor | Serie | Vorzeichen | Rolle |
| --- | --- | --- | --- |
| Real10Y \(R_t\) | DFII10 | β₁ negativ | dominant — Opportunitätskosten |
| DXY | DTWEXBGS (FRED) bzw. DXY | β₂ negativ | USD-Stärke drückt Goldpreis in USD |
| Fed-Bilanz \(B_t\) | WALCL (FRED) | β₃ positiv | Liquidität / QE-QT-Proxy |

**MVP bleibt 1-Faktor Realzins.** Phase 2 nur wenn DXY- und WALCL-Serien business-day-aligned sind.

#### 6.2 Fed-Bilanz (WALCL) — Daten & Fakten

| | |
| --- | --- |
| **FRED-Serie** | `WALCL` — Assets: Total Assets (Less Eliminations from Consolidation) |
| **Frequenz** | wöchentlich (Fed H.4.1) |
| **Transformation** | \(\log(B_t)\) wegen Skala; optional YoY-% als Robustheitscheck |
| **Alignment** | Wochenwerte auf business days forward-fill (LOCF), kein Interpolieren |
| **QE** | Bilanz steigt (Anleihekäufe) → mehr Systemliquidität → typisch goldpositiv |
| **QT** | Bilanz schrumpft → gegenläufig |

**Wichtig:** Zinssenkung ungleich automatische Bilanzausweitung.  
Cuts können mit stabiler Bilanz, QT oder QE einhergehen — deshalb eigener Faktor β₃.

#### 6.3 DXY — eigener FX-Kanal

| | |
| --- | --- |
| **FRED** | `DTWEXBGS` (Broad Dollar) oder Marktdaten DXY |
| **Kanal** | Gold notiert in USD; starker Dollar → Gold in USD oft schwächer |
| **Nicht identisch mit Zins** | Rate cuts schwächen den USD oft, aber nicht immer (Safe-Haven, relatives Wachstum) |

Zinssenkungsphasen werden **nicht** „durch den Dollar abgebildet“, sondern über **Real10Y (β₁)**.

#### 6.4 Wann welcher Faktor zieht (Cuts / QE / QT)

| Phase | Real10Y | DXY | Fed-Bilanz (WALCL) | Netto-Lesart für Gold |
| --- | --- | --- | --- | --- |
| Klassische Cuts, USD weich | sinkt (Gold+) | sinkt (Gold+) | oft stabil | Zins + FX beide Rückenwind |
| Cuts + Safe-Haven-USD | sinkt (Gold+) | steigt (Gold−) | stabil | Zins+ vs. FX− — Reststreuung |
| QE bei niedrigen / fallenden Zinsen | tief / sinkt (Gold+) | variabel | steigt (Gold+) | Zins + Liquidität |
| QT + hohe / steigende Realzinsen | steigt (Gold−) | variabel | sinkt (Gold−) | Zins + Liquidität Gegenwind |
| Nur Realzins-Move, Bilanz flat, USD flat | bewegt sich | stabil | stabil | **MVP reicht** (nur β₁) |

**Lesen der Tabelle:**

1. **Spalte Real10Y** = was der MVP schon erfasst (Zinssenkungen / -erhöhungen, Realrenditen).  
2. **Spalte DXY** = residualer FX-Effekt, der übrig bleibt, *nachdem* Realzinsen kontrolliert sind.  
3. **Spalte Fed-Bilanz** = Mengenpolitik (QE/QT), die **nicht** in Real10Y und **nicht** in DXY aufgeht.

```
MVP (Phase 1):  nur Real10Y     → erste Spalte
Phase 2:        + DXY + WALCL   → Reststreuung erklären, wenn β stabil und Serien aligned
```

#### 6.5 Was Phase 2 nicht tun soll

- β₁ durch DXY ersetzen (Zinskanal bleibt dominant)  
- WALCL mit Leitzins verwechseln (Preis- vs. Mengenpolitik)  
- Multi-Faktor erzwingen, wenn Korrelation Real10Y↔Gold bereits stark und stabil ist  
- Lookahead: WALCL/DXY nur as-of verfügbar

#### 6.6 Implementierungsnotiz Phase 2

```
[ ] FRED WALCL wöchentlich → LOCF auf Gold-Kalender
[ ] FRED DTWEXBGS daily (oder DXY) aligned
[ ] Rolling multivariate OLS (Window 252) nur wenn alle drei Serien non-null
[ ] Vorzeichen-Check: β1 negativ, β2 negativ, β3 positiv — sonst Flag REGIME_UNSTABLE
[ ] UI: optional FV-Linie „1-Faktor“ vs „3-Faktor“ vergleichen
[ ] Default-Anzeige bleibt 1-Faktor Realzins
```

---

### 7) Kalibrierungs-Defaults

| Parameter | Default |
| --- | --- |
| OLS Window | 252 |
| Inverse Window | 60 |
| Fair-Band | ±10 Prozent |
| Stress Real | ±15 bp |
| Stress Gold | ±2 Prozent |
| Decoupling-Gate | corr über −0.25 |
| Szenario-Shocks | −100 bis +150 bp |

### 8) Datenfrequenz

Gold daily · DGS10/DFII10/T10YIE daily · CPI monthly LOCF · **WALCL weekly LOCF** · DXY/DTWEXBGS daily · AISC quarterly step

### 9)–10) UI + Test-Vektoren

Unverändert (Chart dual-axis, Szenarien, Unit-Tests) — Git-History.

---

## 7.9 Checkliste Implementierung

```
[ ] goldMacro.ts (1-Faktor MVP)
[ ] FRED: DFII10, DGS10, T10YIE, FEDFUNDS, CPIAUCSL
[ ] Phase 2 optional: WALCL, DTWEXBGS + Phasen-Logik §6.4
[ ] Chart + KPI + Szenarien
[ ] Gate GOLD_REAL_YIELD_REGIME
```

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
