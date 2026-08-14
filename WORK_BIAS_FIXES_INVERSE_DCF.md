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

**Code-Vorschlag:**

```tsx
{/* Haupt-Chart */}
<div className="h-[380px] sm:h-[420px] md:h-[460px] w-full">
  <ResponsiveContainer width="100%" height="100%">
    ...
  </ResponsiveContainer>
</div>

{/* MACD */}
<div className="h-[160px] sm:h-[180px] w-full">
  <ResponsiveContainer width="100%" height="100%">
    ...
  </ResponsiveContainer>
</div>

{/* RSI */}
<ResponsiveContainer width="100%" height={130}>
  ...
</ResponsiveContainer>
```

### Warum das hilft (Zahlen)

- iPhone 14 Viewport-Höhe (ohne Browser-Chrome): ca. **650–720 px**
- Header + Sidebar-Button + Padding: ca. **80–100 px**
- Verbleibend für Content: ca. **550–620 px**
- Aktuell belegter Chart-Block (320 + 140 + 110 + Abstände): ca. **600 px** → Chart wirkt gestaucht
- Neu (380 + 160 + 130): ca. **700 px** → nutzt den verfügbaren Platz besser, Scrollen bleibt möglich

### Betroffene Datei

- `client/src/pages/BTCDashboard.tsx`
  - Section10TechnicalChart: drei Höhen-Stellen (Preis-Chart, MACD, RSI)

### Priorität

**P2** (UI/UX) – unabhängig von den Bias-Fixes, aber schnell umsetzbar und spürbar auf Mobile.

---

## 15. Auto-Trigger Thesis-Score + Management-Score (Variante B) (NEU)

### Problem

Thesis Strength Score und Management-Execution-Score müssen aktuell **manuell** per Button gestartet werden. Das unterbricht den Analyse-Flow und verhindert, dass beide Scores zuverlässig in die Executive Summary einfließen.

### Aktueller Stand (bewusst lazy)

| Score | Endpoint | Warum manuell? | Cache |
|-------|----------|----------------|-------|
| Thesis Strength | `POST /api/thesis-strength` | Viele FMP-Calls + Peer-Analyse | 24h / Ticker |
| Management-Execution | `POST /api/management-score` | Comp/Insider-Daten + optional LLM | 24h / Ticker |

Code-Kommentar (routes.ts):  
*„lazy (Frontend ruft ihn separat, nicht bei jedem /api/analyze auf) … kostenintensive FMP-Comp/Insider-Calls + optionaler LLM-Call sollen nicht bei jedem Klick neu laufen.“*

### Kosten bei automatischem Start (Zahlen / Daten / Fakten)

**Thesis Strength – Call-Profil:**

| Call | Anzahl | Typische Dauer |
|------|--------|----------------|
| Income Statement (5J) | 1 | 0,3–0,8 s |
| Cash Flow (5J) | 1 | 0,3–0,8 s |
| Balance Sheet (5J) | 1 | 0,3–0,8 s |
| Peers | 1 | 0,2–0,5 s |
| Analyst Estimates | 1 | 0,3–0,6 s |
| SEC RPO | 1 | 0,5–1,5 s |
| Peer-Statements (bis 5 Peers × 4 Calls) | bis ~20 | **2–6 s** |
| Berechnung | — | 0,1–0,3 s |

| Szenario | Dauer |
|----------|-------|
| Cache-Hit | < 50 ms |
| Cache-Miss | **3–8 s** |

**Management-Score – Call-Profil:**

| Call | Typische Dauer |
|------|----------------|
| FMP Governance / Compensation / Insider | 1–3 s |
| Optional LLM (Qual+News) | 2–6 s |
| Berechnung | < 0,2 s |

| Szenario | Dauer |
|----------|-------|
| Cache-Hit | < 50 ms |
| Cache-Miss (ohne LLM) | 1–3 s |
| Cache-Miss (mit LLM) | 4–9 s |

**Kombiniert (beide Scores):**

| Szenario | Zusätzliche Wartezeit |
|----------|------------------------|
| Beide im Cache (< 24h) | praktisch 0 |
| Beide Cache-Miss, **parallel** | **ca. 4–9 s** |
| Sequentiell | ca. 6–15 s |

Die Hauptanalyse (`/api/analyze`) dauert bereits oft 5–15 s. Ein blockierender Auto-Start würde die gefühlte Ladezeit spürbar verlängern.

### Varianten-Vergleich

| Variante | Vorteil | Nachteil |
|----------|---------|----------|
| **A. Komplett manuell** (aktuell) | Schnelle Erstanalyse, User steuert Kosten | Extra-Klicks, Scores fehlen oft im Fazit |
| **B. Auto nach Analyse (Background)** | Kein Extra-Klick, UI bleibt responsiv | Scores erscheinen verzögert |
| **C. Auto parallel zum Analyze** | Alles fertig, wenn die Seite da ist | Längere Wartezeit beim ersten Load |
| **D. Auto nur bei Cache-Hit** | Fast instant bei Wiederholung | Beim ersten Mal weiterhin manuell |

### Entscheidung: Variante B (empfohlen)

**Ablauf:**

1. User gibt Ticker ein → normale Analyse (`/api/analyze`) läuft.
2. Sobald `StockAnalysis` erfolgreich geladen ist, feuern Frontend **parallel im Hintergrund**:
   - `POST /api/thesis-strength`
   - `POST /api/management-score`
3. Sektionen zeigen „wird berechnet…“ und füllen sich nach, ohne den Rest zu blockieren.
4. 24h-Cache bleibt aktiv → zweiter Besuch desselben Tickers ist fast instant.
5. Sobald beide Scores da sind, kann die Executive Summary (nach Sektions-Tausch) sie einbeziehen.

### Implementierung Background-Trigger (Frontend)

**Ort:** `client/src/pages/Dashboard.tsx` (oder Analyse-Success-Handler)

```ts
// Nach erfolgreichem analyzeMutation.onSuccess:
onSuccess: (result) => {
  setData(result);
  // Variante B: Background-Trigger (nicht blockierend)
  void triggerThesisStrength(result);
  void triggerManagementScore(result);
}
```

- Beide Calls laufen parallel (`Promise.all` oder separate `void`-Aufrufe).
- UI-State: `thesisStatus: "idle" | "loading" | "done" | "error"` (analog Management).
- Fehler in einem Score dürfen den anderen und die Hauptanalyse nicht abbrechen.
- Manuelle Buttons bleiben als Fallback / Force-Refresh erhalten.

### FMP-API-Kontingente – Optimierung

| Maßnahme | Wirkung |
|----------|--------|
| 24h-Cache pro Ticker (bereits aktiv) | Wiederholte Analysen desselben Tickers verbrauchen 0 zusätzliche Calls |
| Parallel statt sequentiell | Keine doppelte Wartezeit, gleiche Call-Anzahl |
| Peer-Limit bei Thesis (max. 5) | Begrenzt teure Peer-Statement-Calls |
| Optional: Management-Score ohne LLM beim Auto-Trigger | Spart 2–6 s und LLM-Budget; LLM nur bei manuellem „KI interpretieren“ |
| FMP-Budget-Tracking (`/api/fmp-budget`) | Sichtbarkeit, wann Kontingent eng wird |

**Richtwert:** Ein Cache-Miss für Thesis + Management (ohne LLM) verbraucht grob **15–30 FMP-Calls**. Bei 50 neuen Ticker/Tag ≈ 750–1.500 Calls nur für diese beiden Scores – deshalb Cache und Background (nicht blockierend) Pflicht.

### Priorität

**P1** – direkt nach dem Sektions-Tausch (Management vor Fazit), damit die Scores automatisch verfügbar sind, wenn die Executive Summary sie braucht.

---

## 16. Portfolio: CAPM E[R], Reverse Optimization, Black-Litterman, DCF-Korrektur (NEU)

### 16.1 Problem

Im Virtuellen Portfolio fehlt die **generische** Berechnung der erwarteten Rendite pro Ticker und die konsistente Verknüpfung mit CAPM, Reverse Optimization und (optional) Black-Litterman. „Ziel-Gewicht CAPM“ ist aktuell ein Label ohne ticker-spezifisches E[R].

### 16.2 CAPM-Formel (korrekt)

```text
E[R]_i = r_f + β_i × ERP
```

| Parameter | Typischer Wert (2026) | Quelle |
|-----------|----------------------|--------|
| r_f | 4,0 % | US 10Y / Policy |
| ERP | 4,5 % | Damodaran / Policy |
| β_i | FMP 5Y | Sektion 1 Analyse |

**Zahlenbeispiel (Portfolio aus UI):**

| Ticker | β | E[R] CAPM | Ist-Gewicht |
|--------|---|-----------|-------------|
| LLY | 0,45 | 4,0 + 0,45×4,5 = **6,03 %** | 61 % |
| MSFT | 1,10 | 4,0 + 1,10×4,5 = **8,95 %** | 25 % |
| NVDA | 1,70 | 4,0 + 1,70×4,5 = **11,65 %** | 12 % |
| NVO | 0,35 | 4,0 + 0,35×4,5 = **5,58 %** | 2 % |

**Portfolio-E[R] (Ist-Gewichte):**

```text
E[R]_P = 0,61×6,03% + 0,25×8,95% + 0,12×11,65% + 0,02×5,58%
       ≈ 3,68 + 2,24 + 1,40 + 0,11 = 7,43 %
```

Konzentration auf LLY (niedriges β) drückt die erwartete Portfolio-Rendite.

### 16.3 Beta-Schätzung (generisch)

| Methode | Formel / Regel | Wann |
|---------|----------------|------|
| Raw Beta | Cov(R_i, R_m) / Var(R_m), 5Y | Standard (FMP) |
| Adjusted Beta | (2/3)·β_raw + (1/3)·1 | wenn \|β_raw − 1\| > 0,5 |
| Sektor-Fallback | Damodaran Industry Beta | History < 2J oder fehlend |

### 16.4 Reverse Optimization

Gleichgewichtsrenditen aus **Marktgewichten** (nicht aus CAPM-β):

```text
Π = λ × Σ × w_mkt
```

| Symbol | Bedeutung | Typischer Wert |
|--------|-----------|----------------|
| Π | Implied Returns (Vektor) | — |
| λ | Risk Aversion | 2,0 – 3,0 |
| Σ | Kovarianzmatrix der Returns | aus historischen Returns |
| w_mkt | Marktgewichte (oder Ist-Portfolio-Gewichte) | z. B. LLY 61 %, … |

**Praxis-Schritt für Aktienanalyst:**

1. Σ aus historischen Returns der Portfolio-Ticker schätzen (ggf. Shrinkage).
2. w = Ist-Gewichte (oder CAPM-Ziel, sobald vorhanden).
3. λ so kalibrieren, dass Σ w · Π ≈ beobachtbare Marktrisikoprämie.
4. Π_i als „marktimplizite“ E[R]_i ausweisen und mit CAPM-E[R]_i vergleichen.

Differenz CAPM vs. Reverse-Opt = Signal, ob Gewicht und β konsistent sind.

### 16.5 Black-Litterman Views

CAPM/Reverse-Opt liefert Prior Π. Views Q mischen Analysten-Edge ein:

```text
E[R]_BL = [ (τΣ)⁻¹ + Pᵀ Ω⁻¹ P ]⁻¹ · [ (τΣ)⁻¹ Π + Pᵀ Ω⁻¹ Q ]
```

| Symbol | Bedeutung |
|--------|-----------|
| Π | Gleichgewichtsrenditen (aus Reverse Opt oder CAPM) |
| Q | View-Vektor (z. B. „NVDA +3 Pp über Gleichgewicht“) |
| P | Pick-Matrix (welche Assets die View betrifft) |
| Ω | Unsicherheit der Views (diagonal, größer = weniger Einfluss) |
| τ | Skalar, typisch 0,025 – 0,05 |

**Views aus Aktienanalyst-Daten (generisch):**

| View-Quelle | Beispiel | Konfidenz |
|-------------|---------|-----------|
| DCF-Upside (gehärtet) | MSFT Fair Value impliziert +X % vs. Kurs | mittel–hoch |
| Thesis Strength | starker Score → leichte Übergewichtung E[R] | mittel |
| Management-Score < 5 | Abschlag auf E[R] | mittel |
| Moat = None | Abschlag / höhere Ω | hoch |

**Ohne Views** = reines CAPM / Reverse Opt.  
**Mit Views** = BL, sobald DCF/Thesis zuverlässig pro Ticker vorliegen.

### 16.6 Portfolio-E[R] mit DCF korrigieren

Rein CAPM ignoriert fundamentalen Edge. Hybrid:

```text
E[R]_i^{hybrid} = (1 − α) · E[R]_i^{CAPM} + α · E[R]_i^{DCF}
```

| α | Bedeutung |
|---|-----------|
| 0 | reines CAPM |
| 0,3 – 0,5 | ausgewogen (empfohlen Start) |
| 1 | nur DCF-implizite Rendite |

**DCF-implizite Rendite (Näherung):**

```text
E[R]_i^{DCF} ≈ (Fair Value_hardened − Kurs) / Kurs   +   r_f
```

oder aus Reverse-DCF g* + Dividenden/FCF-Yield, konsistent zur Analyse.

**Wichtig:** Nur **gehärteten** DCF verwenden (siehe §1–2), nie unbereinigte Extrapolation.

**Zahlenbeispiel MSFT (illustrativ):**

| Quelle | Wert |
|--------|------|
| CAPM E[R] | 8,95 % |
| Hardened FV | $428 | Kurs $495 → implizite Underperformance |
| Hybrid α=0,4 | zieht E[R] nach unten Richtung fundamentaler Realität |

So wird Portfolio-E[R] nicht nur von Beta/Konzentration, sondern auch von der Analyse-Ampel getrieben.

### 16.7 Implementierungs-Reihenfolge (Portfolio)

| Prio | Task |
|------|------|
| P1 | E[R]_i = r_f + β_i × ERP pro Ticker (generisch) |
| P1 | Portfolio-E[R] = Σ w_i E[R]_i (Ist + Ziel) |
| P1 | Spalte in Investments-Tabelle + Übersicht |
| P2 | Reverse Optimization Π = λ Σ w |
| P2 | Hybrid E[R] mit gehärtetem DCF (α konfigurierbar) |
| P3 | Black-Litterman Views aus Thesis/DCF/Moat |

### 16.8 Portfolio-Optimierungs-Tools (Referenz)

| Tool / Lib | Nutzen |
|------------|--------|
| eigene JS/TS-Implementierung | volle Kontrolle, keine Extra-Dependency |
| PyPortfolioOpt (falls Backend-Python) | Mean-Variance, BL, Efficient Frontier |
| quantstats / empyrical | Performance-Metriken |
| manuelle Matrix-Inversion (mathjs) | BL-Formel im Frontend für kleine n (4–15 Ticker) |

Für n ≤ 15 Ticker ist eine schlanke Eigenimplementierung (CAPM → optional BL) ausreichend und hält den Stack einfach.

### Priorität

**P1** für CAPM-E[R] pro Ticker + Portfolio-E[R].  
**P2/P3** für Reverse Opt, DCF-Hybrid und Black-Litterman.

---

**Document Owner:** Aktienanalyst Project  
**Last Updated:** 14.08.2026 (erweitert §16: Beta-Methoden, Reverse Opt, BL Views, DCF-Hybrid Portfolio E[R])  
**Next Action:** Implement P0 items + Sektions-Tausch + Variante B + Portfolio CAPM E[R]
