# WORK.md – Bias Fixes & Scoring Logic Overhaul (Aktienanalyst)

**Status:** Draft based on analysis session 14.08.2026  
**Priority:** High – Core bias corrections before further feature work  
**Focus:** Make Inverse / Risk-Adjusted DCF the decision-relevant foundation when classic DCF is extrapolating unsustainable historical growth.

---

## 1. Critical Principle (Anti-Bias Core)

When the **Conservative DCF** is primarily an extrapolation of past EPS / FCF growth **and** one or more of the following risk flags are active, the system **must** switch the decision-relevant valuation base to the **Inverse / Risk-Adjusted / Hardened DCF**:

### Mandatory Switch Triggers (at least 2 required)

| Trigger | Threshold | Rationale |
|---------|-----------|---------|
| Total Expected Damage | ≥ 25% | High probability-weighted downside |
| Moat Rating | `None` or `Narrow` | No structural protection |
| Government Exposure | ≥ 25% | Regulatory price risk |
| DCF Upside vs Analyst Upside | ≥ 80 percentage points difference | Extreme model vs market divergence |
| Existing Gates active | Inventory build-up, Pricing Power erosion, SEC contradictions, etc. | Already implemented reality checks |
| Reverse DCF g* | Significantly below model growth assumptions | Market prices lower growth than model |

**Rule:**  
If ≥ 2 triggers are true → **Hardened / Inverse DCF becomes the base** for:
- Catalyst-Adjusted Target
- Decision-relevant CRV
- Executive Summary / Fazit upside numbers

The unadjusted Conservative DCF may still be shown for transparency (labelled “Unadjusted / Extrapolative”), but must not drive the main upside narrative.

---

## 2. WACC & Growth Hardening Rules

When the switch is triggered, apply the following adjustments **before** calculating the decision-relevant Base DCF:

### 2.1 WACC Adjustment

| Number of Triggers | WACC Uplift | Additional Floors |
|--------------------|-------------|-------------------|
| 2 | +0.50 – 0.75 pp | — |
| 3 | +0.90 – 1.20 pp | — |
| 4+ | +1.40 – 1.80 pp | — |

**Hard Floors (always applied when condition met):**
- Healthcare / Pharma + Gov Exposure ≥ 25% → WACC Floor **7.50%**
- Moat = None + Expected Damage ≥ 30% → WACC Floor **7.80%**

### 2.2 Growth Adjustment

**Near-term Growth (explicit forecast years):**
- Expected Damage 25–35% → –15% relative
- Expected Damage > 35% → –25% relative
- Moat = None → additional –10% relative
- Pricing Power Gate active → additional –10% relative

**Terminal Growth (g):**
- High regulatory exposure → max 2.0 – 2.3%
- Moat = None + high Expected Damage → max 1.8 – 2.0%

Only after these adjustments is the DCF used for Catalyst overlay and Fazit.

---

## 3. Negative Catalyst Classification (K5 Fix)

### Problem
Negative catalysts (▼) currently can receive a positive Brutto-Upside and still contribute positively to the GB-Summe (example K5: +0.87%).

### Required Fix – Variant A (Recommended)

```text
IF catalyst.direction == "negative" OR catalyst.flag == "▼":
    exclude from positive GB-Summe completely
    route only to Downside-Katalysatoren section
    GB contribution to upside = 0
```

**Alternative (Variant B):** Force negative sign on Brutto-Upside for ▼ events.

**Decision:** Implement **Variant A**.

---

## 4. Moat-Weighted Management & Thesis Scores

Management-Score and Thesis-Score must influence the overall score, but the strength of that influence depends on Moat quality.

### Moat Multiplier Table

| Moat Rating | Multiplier for Mgmt + Thesis Impact | Effect |
|-------------|-------------------------------------|------|
| Strong / Wide | 0.40 – 0.55 | Weaknesses heavily dampened |
| Moderate | 0.70 – 0.85 | Normal impact |
| Narrow / Limited | 1.00 – 1.15 | Full to slightly amplified |
| None | 1.20 – 1.40 | Weaknesses amplified |

**Formula sketch:**
```text
mgmt_adj = (Management_Score - 5.0) * mgmt_weight
thesis_adj = (Thesis_Score - 5.0) * thesis_weight

weighted_adj = (mgmt_adj * 0.60 + thesis_adj * 0.40) * moat_multiplier
```

This prevents strong-moat companies from being over-penalized and weak-moat companies from being under-penalized.

---

## 5. PESTEL Integration

PESTEL Exposure Score (0–10) is converted into a multiplicative dampening factor on the quantitative base score:

| PESTEL Exposure | Dampening Factor |
|-----------------|------------------|
| 0 – 3 (Low) | 1.00 |
| 4 – 6 (Medium) | 0.92 – 0.96 |
| 7 – 8 (High) | 0.82 – 0.88 |
| 9 – 10 (Very High) | 0.70 – 0.78 |

Additional flag: If Political = High **and** Government Exposure ≥ 25% → mandatory mention in Executive Summary.

---

## 6. Overall Score Formula (Target Architecture)

```text
Gesamtscore =
    (Quantitative_Base_Score × PESTEL_Factor)
  + (Management_Adjustment × Moat_Multiplier)
  + (Thesis_Adjustment × Moat_Multiplier)
  + Technical_Score_Component          # soft, not hard gate
  + Catalyst_Adjustment                # only positive GB after K5 fix
```

**Notes:**
- No hard binary gates that can produce extreme bull/bear flips.
- Technical analysis remains a separate soft component.
- Inverse / Hardened DCF feeds into Quantitative_Base_Score when triggers are active.

---

## 7. Executive Summary Requirements

The top Executive Summary must:

1. Show clear overall Ampel / recommendation.
2. Contain 3–5 sentences covering:
   - Business model / Moat quality
   - Valuation (explicitly stating whether Base DCF is hardened / inverse-based)
   - Technical / timing situation
3. Prominently surface the largest Red Flags (no Moat, high Expected Damage, DCF extrapolation risk, weak Management Score if applicable).
4. Only use the **decision-relevant** (hardened) valuation numbers for upside statements.

---

## 8. Implementation Priority

| Priority | Task | Status |
|----------|------|------|
| P0 | Negative catalyst (▼) exclusion from positive GB (Variant A) | To do |
| P0 | Inverse / Hardened DCF becomes base when ≥2 triggers active | To do |
| P0 | WACC uplift + Growth reduction rules | To do |
| P1 | Moat multiplier for Management + Thesis scores | To do |
| P1 | PESTEL dampening factor | To do |
| P1 | Executive Summary forced to use hardened numbers + Red Flag priority | To do |
| P2 | Fine-tune exact weights after testing on 10–15 names | Later |

---

## 9. Open Decisions (for next iteration)

- Exact numeric weights inside Management vs Thesis split (currently sketched 60/40).
- Exact WACC uplift ranges per trigger count (calibration needed).
- Whether Thesis Strength Score should also receive its own Moat-scaled treatment.

---

## 10. Zwei-Pfad-Logik: Daten-Modus vs. KI-Modus (NEU)

### Problemstellung

Wenn der KI-Button aktiviert ist, ändern sich mehrere Inputs fundamental:

- **Sektion 15 (Katalysatoren):** Generische/sektor-basierte Katalysatoren werden durch firmenspezifische ersetzt (andere Namen, andere PoS, andere Brutto-Upside, andere Einpreisungsgrade).
- Daraus resultieren **andere GB-Summen** und damit andere Catalyst-Adj. Targets.
- KI kann zusätzliche regulatorische Risiken, Moat-Einschätzungen oder Red Flags liefern, die im reinen Daten-Modus fehlen.

Ohne klare Trennung der beiden Pfade ist nicht nachvollziehbar, warum Upside-Zahlen und Fazit bei KI-Modus anders aussehen.

### Zwei-Pfad-Architektur

| Aspekt | Pfad A: Daten-Modus (ohne KI) | Pfad B: KI-Modus |
|--------|------------------------------|------------------|
| Katalysatoren | Generisch / sektor-basiert | Firmenspezifisch (andere Namen + andere PoS/Upside) |
| GB-Summe / Catalyst-Adj. Target | Basieren auf generischen Katalysatoren | Basieren auf KI-Katalysatoren |
| Moat / regulatorische Scores | Rein regelbasiert aus vorhandenen Daten | Können durch KI-Analyse ergänzt oder korrigiert werden |
| Expected Damage / Risiken | Aus regelbasierter Risikoinversion | Können durch KI-angereicherte Risiken erweitert werden |
| Executive Summary | Muss klar kennzeichnen: „Basis: Daten-Modus (generische Katalysatoren)“ | Muss klar kennzeichnen: „Basis: KI-angereicherte Inputs“ |

### Implementierungsanforderungen

1. **Flag im Data-Objekt**  
   `data.llmMode: boolean` (existiert bereits) und ggf. `data.catalystsSource: "generic" | "llm"` explizit setzen.

2. **Executive Summary** muss den Modus anzeigen:  
   - „Katalysatoren: generisch (Sektor)“ oder  
   - „Katalysatoren: KI-firmenspezifisch (Stand: [Timestamp])“

3. **Scoring / Upside-Berechnung**  
   Darf nicht einfach „die aktuellen Katalysatoren“ nehmen, sondern muss wissen, aus welchem Pfad sie stammen.  
   Bei Modus-Wechsel (KI an/aus) müssen GB-Summe und Catalyst-Adj. Target neu berechnet werden.

4. **Nachvollziehbarkeit**  
   Im Fazit und in der Control-Calculation muss sichtbar sein, welcher DCF-Base und welche Katalysatoren-Quelle verwendet wurden.

### Zahlenbeispiel (NVO-Typ)

| Metrik | Daten-Modus (generisch) | KI-Modus (firmenspezifisch) | Differenz |
|--------|-------------------------|-----------------------------|-----------|
| Anzahl Katalysatoren | 4–5 generisch | 4–5 firmenspezifisch | — |
| Σ GB (nach PoS) | z. B. +12–18 % | z. B. +35–45 % | +20–30 Pp möglich |
| Catalyst-Adj. Target | basiert auf niedrigerer GB | basiert auf höherer GB | deutlich höher |
| Moat-Rating | regelbasiert (None) | kann durch KI bestätigt oder nuanciert werden | — |

**Fazit:** Die Zwei-Pfad-Logik ist Pflicht, sonst sind die Upside-Zahlen und das Fazit zwischen den Modi nicht vergleichbar und nicht erklärbar.

---

## 11. Moat-Score Berechnungsmethoden (NEU)

### Aktueller Stand

- Moat-Rating kommt primär aus regelbasierten Heuristiken + optionaler KI-Analyse (Sektion 11).
- Werte: `Wide` / `Narrow` / `None` (teilweise auch numerische Porter-Scores).

### Empfohlene Berechnungslogik (generisch)

**A. Regelbasierter Basis-Moat (ohne KI)**

| Kriterium | Beitrag zum Moat-Score |
|-----------|------------------------|
| Bruttomarge dauerhaft > 60 % | +1 (Pricing Power Signal) |
| ROIC 5Y-Durchschnitt > Sektor-Median + 5 Pp | +1 |
| FCF-Marge stabil / steigend | +0.5 |
| Switching Costs / Network Effects erkennbar | +1 (wenn Daten vorhanden) |
| Intangible Assets (Patente, Marken) stark | +1 |
| Government Exposure ≥ 25 % | –1 (regulatorische Verletzlichkeit) |
| Hohe Rivalität (Porter) | –1 |

Ergebnis wird auf `Wide` (≥ 3), `Narrow` (1–2.5), `None` (< 1) gemappt.

**B. KI-angereicherter Moat (wenn llmMode = true)**

- KI kann qualitative Faktoren hinzufügen (z. B. „Ökosystem-Stärke“, „regulatorische Eintrittsbarrieren“, „Switching Costs durch Daten“).
- Diese dürfen den regelbasierten Score **ergänzen**, aber nicht vollständig überschreiben.
- Empfohlen: KI-Beitrag max. ±1.5 Punkte auf den Basis-Score, mit Transparenzhinweis.

**C. Verwendung im Scoring**

Der finale Moat-Rating steuert den Multiplikator für Management- und Thesis-Score (siehe Abschnitt 4).

---

## 12. Ergänzte Implementation Priority (inkl. Zwei-Pfad + Moat)

| Priority | Task | Status |
|----------|------|--------|
| P0 | Negative catalyst (▼) exclusion from positive GB (Variant A) | To do |
| P0 | Inverse / Hardened DCF becomes base when ≥2 triggers active | To do |
| P0 | WACC uplift + Growth reduction rules | To do |
| P0 | Zwei-Pfad-Logik: Flag + Kennzeichnung Daten-Modus vs. KI-Modus in Executive Summary und Upside-Berechnung | To do |
| P1 | Moat multiplier for Management + Thesis scores | To do |
| P1 | PESTEL dampening factor | To do |
| P1 | Executive Summary forced to use hardened numbers + Red Flag priority | To do |
| P1 | Moat-Score: klare regelbasierte Basis + begrenzter KI-Beitrag | To do |
| P2 | Fine-tune exact weights after testing on 10–15 names | Later |

---

## 13. Sektions-Reihenfolge ändern: Management-Score vor Zusammenfassung (NEU)

### Aktuelle Reihenfolge (Sidebar + Dashboard)

| Nr | Label |
|----|-------|
| 16 | Monte Carlo |
| 17 | Zusammenfassung (Fazit) |
| 18 | Management-Score |

### Gewünschte Reihenfolge

| Nr | Label |
|----|-------|
| 16 | Monte Carlo |
| **17** | **Management-Score** |
| **18** | **Zusammenfassung (Fazit)** |

### Begründung

- Der Management-Score muss **vor** dem Fazit berechnet und sichtbar sein, damit die Executive Summary (Sektion 18) ihn direkt in die Ampel-Logik, die positiven/negativen Faktoren und den Fließtext einbeziehen kann.
- Aktuell steht Management-Score nach dem Fazit → das Fazit kann den Score nicht zuverlässig referenzieren.
- Durch den Tausch wird die logische Abhängigkeitskette eingehalten: alle Inputs (inkl. Management-Score) → dann Fazit.

### Technische Stellen, die angepasst werden müssen

1. **`client/src/pages/Dashboard.tsx`**
   - Array `SECTIONS`: Label und id von 17 und 18 tauschen.
   - Render-Reihenfolge der Section-Komponenten tauschen (`ManagementScoreSection` vor `SummarySection`).
   - `sectionRefs` / `scrollToSection` bleiben über die id konsistent, solange die ids mitgetauscht werden.

2. **Sidebar-Navigation**  
   Wird über das `SECTIONS`-Array gesteuert → automatisch korrekt nach dem Tausch.

3. **SummarySection (neues Nr. 18)**  
   Kann danach zuverlässig auf `data.managementScore` (bzw. das Ergebnis von Sektion 17) zugreifen und es in positive/negative Listen + Gesamtscore einbauen.

### Priorität

**P1** – sollte zusammen mit der Integration des Management-Scores in die Executive Summary umgesetzt werden.

---

## 14. BTC Chart Mobile-Höhen & ResponsiveContainer (NEU)

### Problem

Auf Mobile wird der BTC-Technische-Analyse-Chart (Sektion 10) **zusammengedrückt**, obwohl noch Platz auf der Seite vorhanden ist.

### Aktuelle Höhenwerte (BTCDashboard.tsx → Section10TechnicalChart)

| Chart-Teil | Aktuell (Mobile) | Aktuell (sm+) | Problem |
|------------|------------------|---------------|--------|
| Haupt-Preis-Chart | `h-[320px]` | `sm:h-[380px]` | Zu niedrig auf Phone (~390–430px Viewport-Höhe nutzbar) |
| MACD | `h-[140px]` | `sm:h-[160px]` | Eng |
| RSI | feste `height={110}` | — | Starr, keine Breakpoint-Staffelung |

### Tailwind Breakpoints (relevant für Charts)

| Prefix | Min-Width | Typische Geräte |
|--------|-----------|-----------------|
| (keine) | 0 px | Smartphones (Portrait) |
| `sm:` | 640 px | Große Phones / kleine Tablets |
| `md:` | 768 px | Tablets |
| `lg:` | 1024 px | Desktop / Landscape |
| `xl:` | 1280 px | Große Desktops |

**Wichtig:** `h-[320px]` gilt von 0 px bis 639 px. Ab 640 px greift `sm:h-[380px]`.

### ResponsiveContainer – Funktionsweise

```tsx
<div className="h-[320px] sm:h-[380px] w-full">
  <ResponsiveContainer width="100%" height="100%">
    <ComposedChart ... />
  </ResponsiveContainer>
</div>
```

- `ResponsiveContainer` nimmt **100 % der Höhe und Breite des Parent-Divs**.
- Die Höhe kommt **nur** vom Parent (`h-[…]`).
- Wenn der Parent zu klein ist, wird der Chart gestaucht – unabhängig davon, wie viel Platz die Seite insgesamt hat.

### Empfohlene neue Höhenwerte

| Chart-Teil | Mobile (< 640 px) | sm (≥ 640 px) | md (≥ 768 px) |
|------------|-------------------|---------------|---------------|
| Haupt-Preis-Chart | `h-[380px]` | `sm:h-[420px]` | `md:h-[460px]` |
| MACD | `h-[160px]` | `sm:h-[180px]` | — |
| RSI | `height={130}` | — | — |

### Priorität

**P2** (UI/UX).

---

## 15. Auto-Trigger Thesis-Score + Management-Score (Variante B) (NEU)

Siehe vorheriger Stand: Background nach Analyze-Success, 24h-Cache, FMP-Kontingente. **P1**.

---

## 16. Portfolio: CAPM E[R], Reverse Opt, Black-Litterman, DCF-Hybrid, MC (NEU)

### 16.1–16.8 (Kurz)

- CAPM: `E[R]_i = r_f + β_i × ERP` (generisch, keine Ticker-Hardcodes)
- Reverse Opt: `Π = λ Σ w`
- BL: Views aus DCF/Thesis/Moat
- Hybrid: `(1-α)·CAPM + α·DCF_hardened`
- P1: CAPM-E[R] pro Ticker + Portfolio-E[R]; P2/P3: Reverse Opt, Hybrid, BL

### 16.9 Black-Litterman – Formel (erklärt)

```text
E[R]_BL = [ (τΣ)⁻¹ + Pᵀ Ω⁻¹ P ]⁻¹ · [ (τΣ)⁻¹ Π + Pᵀ Ω⁻¹ Q ]
```

| Symbol | Bedeutung | Generische Quelle |
|--------|-----------|-------------------|
| Π | Gleichgewichtsrenditen | Reverse Opt oder CAPM-Vektor |
| Q | View-Renditen | aus Analyse (DCF-Upside, Thesis) – **nicht hardcodiert** |
| P | Pick-Matrix | 1 in Spalte des betroffenen Tickers |
| Ω | View-Unsicherheit | diagonal; größer = View schwächer |
| τ | Skalar | Policy 0,01–0,05 |
| Σ | Kovarianz | aus historischen Returns der Portfolio-Ticker |

**Ohne Views (Q leer):** E[R]_BL = Π (reines CAPM / Reverse Opt).  
**Mit Views:** Analyse-Edge fließt gewichtet ein.

### 16.10 Black-Litterman – Sensitivitätsanalyse

| Hebel | ↑ | Wirkung auf E[R]_BL / Zielgewichte |
|-------|---|-------------------------------------|
| τ | ↑ | Views stärker |
| Ω_ii | ↑ | View i schwächer |
| λ | ↑ | Implied Returns Π sinken |
| α (Hybrid) | ↑ | DCF-Anteil steigt |

**Regel:** τ, Ω, λ, α als Policy-Parameter – keine festen Ticker-Werte.  
UI: bei Änderung E[R]_BL und Zielgewichte neu; Anzeige „View-Einfluss: schwach/mittel/stark“ aus |E[R]_BL − Π|.

### 16.11 Portfolio-Monte-Carlo – aus Dashboard-GBM (generisch)

**Quelle im Repo:** `client/src/lib/calculations.ts` → `gbmMonteCarlo` + `calculateGBMParams`  
(Aktien-Analyse Sektion 16, Einzeltitel). Für das **Portfolio** dieselbe Mathematik, multi-asset, **ohne Ticker-Hardcodes**.

#### Einzeltitel-GBM (bereits implementiert)

```ts
// Parameter: alles aus Daten, nichts hardcodiert
interface GBMMonteCarloParams {
  currentPrice: number;  // Kurs
  mu: number;            // Drift aus calculateGBMParams(historicalPrices)
  sigma: number;         // Vol aus calculateGBMParams(historicalPrices)
  iterations: number;    // z.B. 5000–10000 (Policy)
  tradingDays: number;   // z.B. 252
}

// Kernschritt (GBM):
// S_{t+1} = S_t · exp( (μ − ½σ²)·dt + σ·√dt · Z ),  Z ~ N(0,1)
// dt = 1/252
```

`calculateGBMParams(prices)` leitet μ und σ **nur** aus der Kursreihe ab (Log-Returns, annualisiert) – Fallback nur wenn History < 30 Punkte (μ=0,08, σ=0,25 als neutrale Defaults, nicht ticker-spezifisch).

#### Portfolio-Erweiterung (generisch, zu implementieren)

```ts
// Pro Ticker i im Portfolio (beliebige Menge):
//   μ_i, σ_i  aus calculateGBMParams(historicalPrices_i)
//   oder μ_i = E[R]_i^{CAPM|Hybrid}  (aus Policy wählbar)
// Σ = Kovarianzmatrix aus gemeinsamen Returns (gleiche Tage)
// L = Cholesky(Σ)
// Pro Pfad: Z ~ N(0,I), ε = L·Z  → korrelierte Schocks
// R_P = Σ_i w_i · R_i
// Output: Verteilung von R_P, VaR, CVaR, P(R_P < 0), max DD
```

| Input | Quelle (generisch) |
|-------|--------------------|
| w_i | Ist-Gewichte oder CAPM-Zielgewichte |
| μ_i | CAPM / Hybrid / historische Drift – Policy |
| σ_i, Σ | historische Returns der **aktuellen** Portfolio-Ticker |
| iterations, horizon | Policy (z. B. 5000, 252 Tage) |

**Kein** Hardcode von MSFT/NVDA/LLY/NVO – funktioniert für jedes Portfolio mit n ≥ 2.

#### Kennzahlen (Output)

| Metrik | Definition |
|--------|------------|
| E[R]_P | Mittel der Pfad-Endrenditen |
| σ_P | Std. der Pfad-Endrenditen |
| VaR 5 % | 5%-Quantil |
| CVaR 5 % | Mittel unter VaR 5 % |
| P(R_P < 0) | Anteil negativer Pfade |
| maxDD (mean) | mittlerer Max-Drawdown über Pfade |

Zwei Läufe vergleichen: **Ist-Gewichte** vs. **CAPM-Zielgewichte** (gleiche μ/Σ).

### 16.12 Implementierungs-Reihenfolge (Portfolio)

| Prio | Task |
|------|------|
| P1 | E[R]_i = r_f + β_i × ERP + Portfolio-E[R] |
| P1 | Spalte in Investments + Übersicht |
| P2 | Reverse Opt Π = λ Σ w |
| P2 | Hybrid E[R] mit gehärtetem DCF |
| P2 | Portfolio-MC (GBM multi-asset, aus Dashboard-Logik) |
| P3 | BL Views + Sensitivität (τ, Ω) |

---

**Document Owner:** Aktienanalyst Project  
**Last Updated:** 14.08.2026 (§16: BL-Formel, Sensitivität, generischer Portfolio-MC aus calculations.ts GBM)  
**Next Action:** P0 Bias-Fixes + Sektions-Tausch + Variante B + Portfolio CAPM E[R]
