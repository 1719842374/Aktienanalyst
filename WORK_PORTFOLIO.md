# WORK_PORTFOLIO.md — Virtuelles Portfolio

> Stand: 28.07.2026 | Nur Dokumentation  
> Buy-Liste · Gewichtungsmodi · **Sharpe (vertieft)** · **Kelly (Anwendungsregeln)** · Kapital

---

# Kapitel A — Zielbild & Architektur

## A.1 Produktidee

```
Researcher + Manual Analyse
        → Buy-Liste (verifizierte attraktive Titel)
        → Virtuelles Portfolio
              ├── Gewichtungsmodus A/B/C (Basket)
              ├── Sharpe-Kennzahlen (Messung)
              └── Kelly (separat, Einzeltitel-Sizing)
        → Input Kapital K → Soll-€ / Stück
```

| Baustein | Frage |
| --- | --- |
| Buy-Liste | Welche Titel sind aktiv? |
| Modus A/B/C | Wie im **Basket** gewichten? |
| Sharpe | Wie gut ist die gewählte Allokation risikoadjustiert? |
| Kelly | Wie groß **eine** Position maximal/sinnvoll? |
| Kapital K | Konkrete €-Beträge |

**Trennlinie:** Kelly ersetzt die Basket-Gewichtung nicht. Sharpe steuert die Gewichte nicht allein — er **misst** sie.

## A.2 Datenmodell (Kern)

```ts
PortfolioCandidate  // ticker, score, conviction, mu?, beta?, price, status, source
VirtualPortfolio    // candidates[], benchmark, rf, capitalBase
BasketResult        // mode, rows[], sharpePortfolio, sharpeEqualWeight
KellySizing         // fStar, fHalf, fCapped, amount
```

## A.3 Intake Buy-Liste

```
Auto: score ≥ scoreMin ∧ kein hard Gate ∧ conflicts ∈ {leer, warn}
Manual: include / conviction override
source: researcher | manual | both
```

---

# Kapitel B — Gewichtungsalgorithmen (Basket)

## B.1 Drei Modi

| Modus | Kern | Wann |
| --- | --- | --- |
| **A Max-Sharpe long-only** | \(w \propto \Sigma^{-1}\tilde\mu\), clip, renorm, cap | n≥3, Σ stabil, μ ok |
| **B Risk-Parity** | \(w_i \propto 1/\sigma_i\) | μ schwach / Σ instabil / n klein |
| **C Score-Tilt** | Basis Equal/RP × (1+κ z(score)) | Brücke Scoring → Portfolio |

## B.2 Guards

long-only · Σ w=1 · maxWeight≈0.30 · optional minWeight · Shrinkage bei kleiner n · n=1 → kein Basket, nur Kelly

## B.3 Auto-Mode

```
n < 2        → Kelly only
n < 3 oder μ low oder Σ instabil → Risk-Parity
μ high + Σ stabil → Max-Sharpe
sonst → Score-Tilt
```

---

# Kapitel C — Sharpe-Ratio (Implementierung vertieft)

## C.1 Definitionen

**Portfolio-Sharpe (ex ante):**

$$
\mathrm{Sharpe}_p(w) = \frac{w^{\top}\mu - r_f}{\sqrt{w^{\top}\Sigma w}} = \frac{w^{\top}\tilde\mu}{\sigma_p}
$$

**Einzeltitel:**

$$
\mathrm{Sharpe}_i = \frac{\mu_i - r_f}{\sigma_i}, \quad \sigma_i=\sqrt{\Sigma_{ii}}
$$

**Equal-Weight-Referenz:** dieselbe Formel mit \(w_i=1/n\).

## C.2 Was implementiert wird (API)

```ts
export function portfolioVariance(w: number[], Sigma: number[][]): number {
  let v = 0;
  const n = w.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      v += w[i] * Sigma[i][j] * w[j];
  return Math.max(v, 0);
}

export function portfolioVol(w: number[], Sigma: number[][]): number {
  return Math.sqrt(portfolioVariance(w, Sigma));
}

export function portfolioMean(w: number[], mu: number[]): number {
  return w.reduce((s, wi, i) => s + wi * mu[i], 0);
}

export function sharpeRatio(
  w: number[],
  mu: number[],
  Sigma: number[][],
  rf: number
): number | null {
  const vol = portfolioVol(w, Sigma);
  if (vol < 1e-12) return null;
  return (portfolioMean(w, mu) - rf) / vol;
}

export function sharpeReport(opts: {
  w: number[];
  mu: number[];
  Sigma: number[][];
  rf: number;
}): {
  sharpePortfolio: number | null;
  sharpeEqualWeight: number | null;
  deltaVsEqual: number | null;
  sharpeSingle: (number | null)[];
  muP: number;
  sigmaP: number;
} {
  const n = opts.w.length;
  const eq = Array(n).fill(1 / n);
  const sharpePortfolio = sharpeRatio(opts.w, opts.mu, opts.Sigma, opts.rf);
  const sharpeEqualWeight = sharpeRatio(eq, opts.mu, opts.Sigma, opts.rf);
  const sharpeSingle = opts.mu.map((m, i) => {
    const sig = Math.sqrt(Math.max(opts.Sigma[i][i], 0));
    return sig < 1e-12 ? null : (m - opts.rf) / sig;
  });
  const deltaVsEqual =
    sharpePortfolio != null && sharpeEqualWeight != null
      ? sharpePortfolio - sharpeEqualWeight
      : null;
  return {
    sharpePortfolio,
    sharpeEqualWeight,
    deltaVsEqual,
    sharpeSingle,
    muP: portfolioMean(opts.w, opts.mu),
    sigmaP: portfolioVol(opts.w, opts.Sigma),
  };
}
```

## C.3 Annualisierung

| Input-Frequenz | μ | Σ | Sharpe |
| --- | --- | --- | --- |
| Daily returns | × 252 | × 252 | **nicht** nochmal ×√252 |
| Monthly | × 12 | × 12 | ebenso |

Regel: Sharpe aus **bereits annualisierten** μ und Σ berechnen.

## C.4 Numerische Stabilität

```
1. Σ symmetrisieren: Σ ← (Σ+Σ')/2
2. falls min Eigenwert < ε → Ledoit-Wolf oder Σ ← Σ + εI
3. vol < 1e-12 → Sharpe null (nicht Inf)
4. Gewichte vor Sharpe auf Summe 1 prüfen (|Σw−1| > 1e-6 → renorm)
```

## C.5 Interpretation in der UI

| Größe | Lesart |
| --- | --- |
| sharpePortfolio | Risikoadjustierte Überschussrendite des Baskets |
| vs Equal-Weight | Ob Optimierer/Tilt gegenüber 1/n lohnt |
| sharpeSingle | Vergleich Titel untereinander — nicht summierbar |
| negativ | erwartete Rendite unter rf oder fragile μ |

**Sharpe steuert keine Orders.** Er ist Diagnose neben den Gewichten.

## C.6 Test-Vektoren Sharpe

```
1) n=1, μ=0.10, rf=0.03, σ=0.20 → Sharpe = 0.35
2) zwei unkorrelierte Titel, gleiche μ/σ, w=(0.5,0.5)
   → σ_p = σ/√2, Sharpe_p = Sharpe_i × √2
3) w nicht summiert auf 1 → vor Berechnung renorm; Test auf API-Guard
4) Σ = 0 → Sharpe null
5) Equal vs konzentriert: bei gleicher μ-Struktur oft Equal ≥ konzentriert in Sample-Risk
```

---

# Kapitel D — Kelly-Kriterium (Anwendung geprüft)

## D.1 Zwecktrennung (wichtig)

| | CAPM / Modus A–C | Kelly |
| --- | --- | --- |
| Objekt | **mehrere** Titel gleichzeitig | **ein** Titel |
| Output | Gewichte Summe 1 | Anteil f am **Gesamtkapital** |
| Default | Max-Sharpe / RP / Tilt | **Half-Kelly + Cap** |
| Summe über Liste | = 100 % | **nicht** über Titel addieren |

Falsch: Full-Kelly für jeden Buy berechnen und als Portfolio-Gewichte interpretieren.  
Richtig: Kelly nur als Antwort auf „Wie groß darf Position X sein?“.

## D.2 Formeln

**Kontinuierlich (Default, wenn μ und σ geschätzt):**

$$
f^{*} = \frac{\mu - r_f}{\sigma^{2}}
$$

**Diskret (wenn p und Payoff-Quote b aus Research):**

$$
f^{*} = \frac{p b - (1-p)}{b}
$$

**Anwendungsschicht:**

$$
f_{\mathrm{half}} = \tfrac12 f^{*}, \quad
f_{\mathrm{capped}} = \min(f_{\mathrm{half}},\, f_{\max}), \quad
f_{\max} = 0.25\ \text{(Default)}
$$

Negatives f∗ → 0 (kein Build aus Kelly).

## D.3 Wann welcher Input

| Situation | Methode | Inputs |
| --- | --- | --- |
| Vol + erwartete Rendite vorhanden | continuous | μ, σ, rf |
| Szenario Upside/Downside, subjektives p | discrete | p, b |
| Nur Score, kein μ/σ | **kein Kelly** oder sehr konservatives p aus Conviction-Map |

Conviction-Map (nur wenn discrete genutzt wird):

```
high   → p ≤ 0.55  (bewusst gedeckelt, kein 0.80 aus Bauchgefühl)
medium → p ≤ 0.52
low    → Kelly aus
```

b z. B. = erwarteter Upside% / erwarteter Drawdown% (Research), floor bei b>0.

## D.4 Anwendungsregeln (Checkliste „geprüft“)

```
[+] Half-Kelly ist UI-Default, nicht Full
[+] f_max = 25 % hart
[+] Kelly nie als Ersatz für Basket-Diversifikation
[+] Bei n≥2: CAPM/Modus-Gewichte primär; Kelly optional pro Zeile
[+] Bei n=1: nur Kelly-Hinweis (+ Single-Sharpe)
[+] μ aus Storytelling → Kelly verweigern oder confidence low
[+] σ zu niedrig geschätzt (Overfit) → f explodiert → Cap rettet
[+] Bestehendes Portfolio: Kelly-f bezieht sich auf Gesamtkapital K,
    nicht auf „Restcash only“, sofern UI nicht explizit „Cash-Bucket“ wählt
[+] Keine automatische Order — nur Soll-Größe
```

## D.5 Zusammenspiel mit CAPM-Gewicht

Optionaler **Hinweis**, kein Hard-Override:

```
w_capm_i = 12 %,  f_kelly_half = 18 %
→ UI: „CAPM-Basket 12 % · Kelly-Hinweis 18 % (Half, capped)“
→ User wählt; System forciert nicht max(w,f)
```

Strenger Modus (optional Flag): `amount = min(w_capm, f_capped) * K`  
Default: **beide Spalten zeigen**, keine stille Übernahme.

## D.6 Code-Kern Kelly

```ts
export function kellyContinuous(mu: number, sigma: number, rf: number): number {
  if (sigma <= 1e-12) return 0;
  return (mu - rf) / (sigma * sigma);
}

export function kellyDiscrete(p: number, b: number): number {
  if (b <= 0 || p <= 0 || p >= 1) return 0;
  return (p * b - (1 - p)) / b;
}

export function applyKellyPolicy(fStar: number, opts?: { fraction?: number; maxF?: number }): {
  fStar: number; fHalf: number; fCapped: number;
} {
  const fraction = opts?.fraction ?? 0.5;
  const maxF = opts?.maxF ?? 0.25;
  const fStarPos = Math.max(0, fStar);
  const fHalf = fStarPos * fraction;
  const fCapped = Math.min(fHalf, maxF);
  return { fStar: fStarPos, fHalf, fCapped };
}

export function sizeKellySingle(opts: {
  mu?: number; sigma?: number; rf?: number;
  p?: number; b?: number;
  capitalBase: number; price: number;
  method: 'continuous' | 'discrete';
}): {
  fStar: number; fHalf: number; fCapped: number;
  amount: number; sharesHint: number;
} {
  const fStar =
    opts.method === 'continuous'
      ? kellyContinuous(opts.mu!, opts.sigma!, opts.rf!)
      : kellyDiscrete(opts.p!, opts.b!);
  const { fHalf, fCapped } = applyKellyPolicy(fStar);
  const amount = fCapped * opts.capitalBase;
  return {
    fStar: Math.max(0, fStar),
    fHalf,
    fCapped,
    amount,
    sharesHint: opts.price > 0 ? amount / opts.price : 0,
  };
}
```

## D.7 Test-Vektoren Kelly

```
1) μ=0.12, rf=0.03, σ=0.20 → f*=(0.09)/0.04=2.25 → half=1.125 → capped=0.25
2) μ=rf → f*=0
3) p=0.55, b=1.5 → f*=(0.55*1.5-0.45)/1.5=0.25 → half=0.125
4) p=0.4, b=1 → f* negativ → 0
5) Policy: nie fCapped > 0.25
```

---

# Kapitel E — Kapital, UI, Pipeline

## E.1 Kapital K

| Spalte | Formel |
| --- | --- |
| Basket-€ | w_i × K |
| Kelly-€ | f_capped × K |
| Stück | € / price |

## E.2 UI-Gliederung

```
1. Kopf: K, Benchmark, rf, Mode (Auto|A|B|C), maxWeight, Kelly-Policy Half
2. Kennzahlen: Sharpe_p | Sharpe_equal | Δ
3. Tabelle: Ticker, Score, w%, €, Sharpe_i, Kelly-Half%, Kelly-€
4. Footer: Disclaimer CAPM≠Kelly; keine Order-Ausführung
```

## E.3 End-to-End-Pipeline

```
1 Intake Buy-Liste
2 μ, Σ, β, rf schätzen (Historie: WORK_DATA_PROVIDERS)
3 pickWeightMode → allocate A|B|C → maxWeight
4 sharpeReport(w, μ, Σ, rf)
5 optional pro Zeile sizeKellySingle
6 × K → Tabelle
```

---

# Kapitel F — Defaults & Checkliste

## F.1 Defaults

| Parameter | Wert |
| --- | --- |
| maxWeight | 0.30 |
| Kelly fraction | 0.5 |
| Kelly maxF | 0.25 |
| Σ-Fenster | 252 |
| scoreMin | 65 |
| κ Score-Tilt | 0.35 |
| Sharpe-Floor vol | 1e-12 |

## F.2 Umsetzung

```
[ ] Kapitel-C API: sharpeRatio, sharpeReport, Annualisierung, Shrinkage
[ ] Kapitel-D API: kellyContinuous/Discrete, applyKellyPolicy, sizeKellySingle
[ ] Tests C.6 und D.7
[ ] Modi A/B/C + pickWeightMode
[ ] UI-Kennzahlen + Zwei-Spalten-€ (Basket vs Kelly)
[ ] n=1-Pfad ohne Basket-Optimierer
```

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
