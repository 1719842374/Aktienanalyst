# WORK_PORTFOLIO.md — Virtuelles Portfolio (Buy-Basket · CAPM · Kelly)

> Stand: 28.07.2026 | Nur Dokumentation  
> Ziel: Verifizierte „Buy/attraktiv“-Titel → **eine Liste** → **virtuelles Portfolio**  
> mit automatischer **CAPM-Diversifikation** (Basket) und **separatem Kelly** (Einzeltitel-Anteil).

---

## 1. Produktidee

```
Researcher-Tab  ──┐
                  ├──► „verifizierter Buy / attraktiv“ ──► Watch/Buy-Liste
Manuelle Analyse ─┘                                              │
                                                                  ▼
                                                    Virtuelles Portfolio
                                                    ├── CAPM-Gewichte (Basket)
                                                    └── Kelly % (optional, 1 Titel)
                                                                  │
                                                    Input: Kapital K (€/$)
                                                                  ▼
                                                    Soll-Stück / Soll-€ je Methode
```

| Baustein | Frage | Methode |
| --- | --- | --- |
| **Buy-Liste** | Welche Titel sind „drin“? | Scoring/Verdict + manuelles Flag |
| **CAPM-Basket** | Wie diversifiziert gewichten? | Beta, Σ, erwartete Überschussrenditen |
| **Kelly (separat)** | Wenn ich **nur diese eine** Aktie im bestehenden Portfolio aufstocke — wie viel %? | Kelly / Half-Kelly |
| **Kapital-Input** | Bei K Euro — wie viel €/Stück nach CAPM bzw. nach Kelly? | `w × K` |

**Wichtig:** Kelly ersetzt CAPM nicht.  
- **CAPM** = Gewichte **im Basket mehrerer** verifizierter Buys.  
- **Kelly** = Größenordnung für **eine** Position (allein oder als Cap neben CAPM).

---

## 2. Aufnahme in die Buy-Liste (Intake)

### 2.1 Quellen

| Quelle | Regel |
| --- | --- |
| Researcher-Tab | Sektor/Screening-Lauf markiert Titel als attraktiv / Buy-Kandidat |
| Manuelle 17-Sektionen-Analyse | User-Flag „Buy“ **oder** automatische Regel aus Verdict |

### 2.2 Automatische Regel (Vorschlag, ohne Narrativ)

```
Kandidat für Liste wenn:
  score >= scoreMin          // z.B. 65 nach Gates
  UND kein hard Gate aktiv   // PRICING_POWER / RELATIVE_GROWTH / REGULATORY hard aus
  UND conflicts leer oder nur warn
  UND technicalRegime != 'breakdown'   // optional
```

Manuell immer überschreibbar: `include: true | false`, `conviction: low|medium|high`.

### 2.3 Datenmodell Liste

```ts
export interface PortfolioCandidate {
  ticker: string;
  name: string;
  addedAt: string;                 // ISO
  source: 'researcher' | 'manual' | 'both';
  analysisId?: string;             // Link zur Analyse
  score: number;                   // nach Gates
  conviction: 'low' | 'medium' | 'high';
  expectedReturn?: number;         // μ̂ annualisiert, optional aus Reverse-DCF/Research
  beta?: number;                   // vs. Benchmark
  price: number;
  currency: string;
  status: 'active' | 'removed' | 'watch_only';
}

export interface VirtualPortfolio {
  id: string;
  name: string;
  benchmark: string;               // z.B. 'SPY' | 'STOXX50E'
  rf: number;                      // risk-free annualisiert
  candidates: PortfolioCandidate[];
  capitalBase: number;             // Input K
  updatedAt: string;
}
```

---

## 3. CAPM-Diversifikation (Basket-Gewichte)

### 3.1 Idee

Für **n ≥ 2** aktive Kandidaten: Gewichte so wählen, dass das Portfolio  
im Mean-Variance- / CAPM-Sinn sinnvoll diversifiziert ist — **generisch**,  
kein Hardcoding einzelner Ticker.

### 3.2 Bausteine der Finanzmathematik

**CAPM-erwartete Rendite** (falls kein eigenes μ̂):

$$
\mu_i = r_f + \beta_i \,(\mu_m - r_f)
$$

**Überschussrendite:** \(\tilde\mu_i = \mu_i - r_f\)

**Kovarianzmatrix** \(\Sigma\) aus historischen Returns (z. B. 1Y–3Y daily → annualisiert).

**Unconstrained Max-Sharpe / Tangency (ohne Shorts oft mit Projektion):**

$$
w \propto \Sigma^{-1} \tilde\mu
$$

Danach:

1. Negative Gewichte auf 0 setzen (long-only) und renormalisieren, **oder**  
2. Quadratische Optimierung long-only:

$$
\max_w \; w^\top \tilde\mu - \frac{\lambda}{2} w^\top \Sigma w
\quad\text{s.t.}\quad w_i \ge 0,\; \sum w_i = 1
$$

**Risk-Parity-Fallback** (wenn μ unzuverlässig):

$$
w_i \propto 1/\sigma_i \quad\text{(oder inverse Vol, renormalisiert)}
$$

### 3.3 Praktische Defaults

| Parameter | Default | Hinweis |
| --- | --- | --- |
| Benchmark | SPY (US) / regional wählbar | Beta-Schätzung |
| rf | FRED DGS3MO oder 10Y | konsistent zur Analyse |
| Σ-Fenster | 252 Handelstage | shrink optional (Ledoit-Wolf) |
| λ (Risikoaversion) | 2–3 | UI-Slider |
| Max-Gewicht einzeln | 25–35 % | Konzentrations-Cap |
| Min-Gewicht | 0 % oder 5 % | sonst 0 = raus aus aktivem Basket |
| Min. Titel für CAPM-Basket | 2 | sonst nur Kelly-Einzel |

### 3.4 Output CAPM

```ts
export interface CapmAllocation {
  ticker: string;
  weight: number;          // 0–1, Summe ≈ 1
  beta: number;
  mu: number;              // erwartet p.a.
  sigma: number;           // Vol p.a.
  amount: number;          // weight * capitalBase
  sharesHint: number;      // amount / price (floor optional)
}

export function allocateCapmBasket(opts: {
  candidates: PortfolioCandidate[];
  cov: number[][];         // aligned order
  mu: number[];            // expected returns p.a.
  rf: number;
  capitalBase: number;
  maxWeight?: number;
}): CapmAllocation[]
```

---

## 4. Kelly — separat (Einzeltitel-Sizing)

### 4.1 Wann

User will **nur eine** Aktie aus der Liste (oder im bestehenden Portfolio)  
sizen: „Wie groß darf der prozentuale Anteil sein?“

Nicht: Kelly über alle Titel als Ersatz für CAPM (das wäre ein anderes Modell).

### 4.2 Formeln

**Diskret (Edge / Odds-Nähe), oft für Setup mit geschätztem Upside:**

$$
f^* = \frac{p \cdot b - q}{b}
$$

- \(p\) = Gewinnwahrscheinlichkeit (aus Conviction/Research, konservativ)  
- \(q = 1-p\)  
- \(b\) = Netto-Gewinnquote (z. B. erwarteter Upside / Risiko, „Gewinn pro Einsatz“)  

**Kontinuierlich (log-optimal, Normalnäherung):**

$$
f^* = \frac{\mu - r_f}{\sigma^2}
$$

**Half-Kelly (Default in der UI):**

$$
f_{\text{half}} = \frac{1}{2} f^*
$$

Cap: z. B. \(f \le 0.25\) (nie mehr als 25 % in einen Titel per Kelly-Hinweis).

### 4.3 Output Kelly

```ts
export interface KellySizing {
  ticker: string;
  fStar: number;           // Full Kelly
  fHalf: number;           // Half Kelly (Default-Empfehlung)
  fCapped: number;         // nach Max-Cap
  amount: number;          // fCapped * capitalBase
  sharesHint: number;
  inputs: { mu?: number; sigma?: number; p?: number; b?: number; method: 'continuous' | 'discrete' };
}

export function sizeKellySingle(opts: {
  candidate: PortfolioCandidate;
  capitalBase: number;
  mu: number;              // expected excess or total — klar dokumentieren
  sigma: number;
  rf: number;
  fraction?: number;       // 0.5 = half Kelly
  maxF?: number;           // default 0.25
}): KellySizing
```

---

## 5. Kapital-Input → beide Methoden

User gibt **K** ein (z. B. 10 000 €).

| Methode | Ergebnis je Titel |
| --- | --- |
| **CAPM-Basket** | \(w_i^{\text{CAPM}} \times K\) für alle aktiven Titel |
| **Kelly einzeln** | \(f^{\text{half}}_j \times K\) nur für gewählten Titel j |

UI-Tabelle:

```
Ticker | Score | CAPM-Gewicht | CAPM-€ | Kelly-Half-% | Kelly-€ | Kurs | Stück-CAPM | Stück-Kelly
```

Hinweistext:

```
CAPM = Vorschlag für den gesamten verifizierten Basket (Diversifikation).
Kelly = Vorschlag nur für diese eine Position (Wachstum/Edge) — nicht summiert als 100 % über alle Titel.
```

---

## 6. Zusammenspiel mit Scoring / Gates

```
runScoringPipeline → score, gates, conflicts
        │
if qualifies as Buy → PortfolioCandidate (active)
        │
VirtualPortfolio.candidates
        │
        ├─► allocateCapmBasket   (n ≥ 2)
        └─► sizeKellySingle      (pro Titel on demand)
```

Hard-Gates → kein Auto-Add; User kann trotzdem `watch_only` setzen.

Fiscal-Catalysts / Reverse-DCF fließen nur über **score / μ̂ / conviction** ein —  
kein separates Portfolio-Narrativ.

---

## 7. Researcher-Tab & manuelle Analyse

| Flow | Aktion |
| --- | --- |
| Researcher markiert Buy | `source: 'researcher'`, upsert Candidate |
| Manuelle Analyse speichert Buy | `source: 'manual'` oder `'both'` |
| Entfernen / Gate bricht später | status `removed` oder Re-Score Job |
| Re-Score Batch | nächtlich oder on-demand: Scores/Betas/Preise aktualisieren |

---

## 8. Grenzen & Anti-Bias

```
[ ] Kelly-Full nie als Default (Half + Cap)
[ ] CAPM-μ nicht aus reinem Storytelling — Reverse-DCF / hist. + rf/β
[ ] Ein Titel allein → kein CAPM-Basket, nur Kelly-Hinweis
[ ] Korrelationen schätzen; bei n klein Σ instabil → Risk-Parity-Fallback
[ ] Keine automatische Order-Ausführung — nur Soll-Allokation
[ ] Währung: capitalBase und prices alignen (FX)
```

---

## 9. UI-Skizze

```
┌─ Virtuelles Portfolio ─────────────────────────────┐
│ Kapital K: [ 10000 ] €    Benchmark: [ SPY ▾ ]     │
│ rf: 3.5 %   Max single CAPM: 30 %   Kelly: Half    │
├─ Buy-Liste (aktiv) ────────────────────────────────┤
│ ☑ Ticker  Score  β   CAPM-w  CAPM-€  Kelly-%  €   │
│ …                                                  │
├─ Summary ──────────────────────────────────────────┤
│ Σ CAPM-€ = K (vollständig allokiert)               │
│ Kelly ist Einzeltitel-Hinweis, Summe ≠ K           │
└────────────────────────────────────────────────────┘
```

---

## 10. Checkliste Umsetzung

```
[ ] PortfolioCandidate + VirtualPortfolio Types
[ ] Intake aus Researcher + Manual (Flag + Auto-Regel)
[ ] Beta/μ/Σ-Schätzung (FMP Historie; 5Y-Limit beachten → WORK_DATA_PROVIDERS)
[ ] allocateCapmBasket (long-only, maxWeight)
[ ] sizeKellySingle (continuous + half + cap)
[ ] Kapital-Input → € und Stück-Hinweise
[ ] UI-Tabelle + Disclaimer
[ ] Re-Score / Remove bei hard Gate
```

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
