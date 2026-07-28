# WORK_ANTIBIAS_DCF.md — Anti-Bias bei Katalysatoren & Inverted DCF

> Stand: 28.07.2026 | Nur Dokumentation  
> Fix: **keine** hardcodierte 5-Downside-Tabelle · **eine** Adjustierungsschicht ·  
> Symmetrie + GB + Einpreisung über Reverse DCF · LLM-Search über **OpenRouter**

---

## 0. Was weg muss (Anti-Hardcoding)

### Verboten im Prompt und in Defaults

```
❌ Feste Liste: Macro Recession, Earnings Miss, Multiple Compression,
   Drug Pricing / Patent Cliff, Government Policy Dependency
   mit festen EW × Impact für JEDE Aktie
❌ Sektor-spezifische Eigennamen als Suchpflicht (Patent Cliff, Medicaid, IRA, CBAM, …)
❌ Pharma-Downside auf Nicht-Pharma-Titel
❌ Gleichzeitig: Damage auf FV  UND  WACC↑  UND  g↓  (Dreifach-Abschlag)
```

### Erlaubt

```
✅ Generische Achsen als Suchhilfe (nicht als Fix-Impact)
✅ LLM/OpenRouter findet material Upside/Downside mit Quelle + Datum
✅ Symmetrie-Pflicht Upside ↔ Downside
✅ GB = PoS × Netto-Impact
✅ Einpreisung an Reverse-DCF g* / gapRatio koppeln
✅ Genau EINE risikoadjustierte DCF-Schicht (Inverted)
```

Abgleich Regulatory: [WORK2.md §8.4](./WORK2.md) — dieselben Anti-Hardcoding-Regeln.

---

## 1. Architektur (eine Wahrheitsebene pro Schritt)

```
A) Base DCF              → FV_base (WACC, g, FCF unverfälscht)
B) Reverse DCF           → g*, gapRatio = g*/realized8Q   [clean]
C) LLM Katalysatoren     → Upside[] + Downside[] (symmetrisch, Quellen)
D) GB-Aggregation        → Σ GB_up + Σ GB_down
E) Catalyst-Adjusted FV  → FV_base × (1 + Σ GB)     // eine additive EV-Schicht
F) Inverted DCF (optional, EINE Adjustierung)
      entweder WACC_adj  ODER  g_adj — nie beides voll
G) Anti-Bias-Warnung     → wenn FV_inv < Preis oder Symmetrie verletzt
```

**Keine** parallele „Total Expected Damage“-Tabelle mit Hardcodes zusätzlich zu C–F.

---

## 2. Katalysatoren — Datenmodell

```ts
export type CatalystAxis =
  | 'demand_macro'
  | 'earnings_guidance'
  | 'margin_cost'
  | 'multiple_rates'
  | 'regulation_policy'
  | 'competition_share'
  | 'product_pipeline'
  | 'balance_sheet_liquidity'
  | 'other';

export interface BiasCatalyst {
  id: string;
  direction: 'up' | 'down';
  axis: CatalystAxis;           // generisch — kein Programmname
  title: string;                // konkreter Name erst nach Discovery
  description: string;
  /** Brutto-Impact auf Equity-Value oder EPS-Pfad, als Dezimal (0.10 = +10 %) */
  grossImpact: number;
  pos: number;                  // 0–1 Probability of Success / materialization
  /** 0–1: wie stark schon im Preis (aus Reverse DCF / Konsens) */
  pricedIn: number;
  source: { url: string; publishedAt: string; snippet: string };
  confidence: 'low' | 'medium' | 'high';
  pairId?: string;              // Verknüpfung Upside↔Downside
}
```

---

## 3. Symmetrie-Pflicht

```
Für jeden Upside-Katalysator mit confidence ≥ medium:
  → mindestens ein Downside auf derselben oder komplementären Achse
  → pairId verknüpft

Wenn LLM nur Upside liefert:
  → Prompt-Retry „formulieren Sie die komplementäre Downside-These mit Quelle"
  → oder synthetische Downside-Achse mit niedriger confidence (nur UI, kein GB)
```

Regel im Code:

```ts
export function symmetryOk(list: BiasCatalyst[]): boolean {
  const ups = list.filter(c => c.direction === 'up' && c.confidence !== 'low');
  return ups.every(u => list.some(d =>
    d.direction === 'down' && (d.pairId === u.id || d.pairId === u.pairId || d.axis === u.axis)
  ));
}
```

---

## 4. PoS, Einpreisung, GB

### 4.1 PoS

```
PoS aus Quellenstatus (nicht aus Hardcode-Historie „60 % − 15 %“):
  enacted / guided / contracted     → base 0.55–0.75
  proposed / early                 → base 0.30–0.50
  rumor / weak source              → ≤ 0.25 → oft verworfen

Policy-Sicherheitsmarge: PoS_final = max(0.05, PoS_base − margin)
margin default 0.10 (UI 0.05–0.15)
```

### 4.2 Einpreisung über Reverse DCF (beibehalten)

```ts
// gapRatio = gStar / max(0.01, realizedGrowth8Q)
export function pricedInFromReverse(gapRatio: number): number {
  // hoher gapRatio = Markt preist schon viel Wachstum → stärker einpreisen
  if (gapRatio > 2.0) return 0.60;   // hoch eingepreist
  if (gapRatio > 1.3) return 0.40;   // moderat
  return 0.20;                      // niedrig
}
```

Netto-Impact:

$$
\mathrm{Netto} = \mathrm{Gross} \times (1 - \mathrm{pricedIn})
$$

(Alternativ zu den alten Stufen 0.4/0.6/0.8 auf „Brutto-Upside“ — hier direkt am Katalysator.)

### 4.3 Gewichteter Beitrag

$$
GB_k = \mathrm{PoS}_k \times \mathrm{Netto}_k
$$

Downside: \(\mathrm{Gross} < 0\) → GB negativ.

$$
\Sigma GB = \sum_k GB_k
$$

$$
FV_{\mathrm{catalyst}} = FV_{\mathrm{base}} \times (1 + \Sigma GB)
$$

Cap optional: \(|\Sigma GB| \le 0.35\) damit einzelne LLM-Ausreißer nicht dominieren.

```ts
export function aggregateGb(catalysts: BiasCatalyst[]): number {
  const raw = catalysts
    .filter(c => c.confidence !== 'low' && c.pos >= 0.25)
    .reduce((s, c) => s + c.pos * c.grossImpact * (1 - c.pricedIn), 0);
  return Math.max(-0.35, Math.min(0.35, raw));
}
```

---

## 5. Inverted DCF — genau **eine** Adjustierung

### 5.1 Verbotene Doppel-/Dreifach-Strafe

```
❌ FV × (1 − TotalExpectedDamage)  UND  WACC_adj  UND  Growth_adj
```

### 5.2 Gewählte Mechanik (Default)

Katalysatoren stecken bereits in \(FV_{\mathrm{catalyst}}\).  
**Inverted DCF** = zweite Lesart nur über **einen** Hebel, abgeleitet aus dem **Downside-Teil** von Σ GB:

$$
D^{-} = -\min(0, \Sigma GB_{\mathrm{down\ only}}) \in [0, 0.35]
$$

**Variante G (Default — Growth-Pfad):**

$$
g_{\mathrm{adj}} = g_{\mathrm{base}} \times (1 - D^{-})
$$

WACC unverändert. FV_inv = DCF(FCF, g_adj, WACC).

**Variante W (optional — nur wenn Policy „Diskont“):**

$$
WACC_{\mathrm{adj}} = WACC + \frac{D^{-}}{2} \times 0.01\text{-Punkte-Skalierung policy}
$$

Nur **eine** Variante aktiv (`invertMode: 'growth' | 'wacc'`).

```ts
export function invertedDcf(opts: {
  fcf0: number;
  gBase: number;
  wacc: number;
  n?: number;
  gTerm?: number;
  netDebt: number;
  shares: number;
  sigmaGbDown: number;       // Summe GB nur Downsides (negativ)
  mode: 'growth' | 'wacc';
}): { fvInv: number; gAdj: number; waccAdj: number; Dminus: number } {
  const Dminus = Math.min(0.35, Math.max(0, -opts.sigmaGbDown));
  const gAdj = opts.mode === 'growth' ? opts.gBase * (1 - Dminus) : opts.gBase;
  // WACC: Dminus als Anteil → Spread in Dezimal z.B. Dminus * 0.02 (max +70 bp bei 0.35)
  const waccAdj = opts.mode === 'wacc' ? opts.wacc + Dminus * 0.02 : opts.wacc;
  // … standard N-Jahr DCF mit gAdj / waccAdj …
  const fvInv = /* dcf */ 0; // Implementierung analog forwardDcf
  return { fvInv, gAdj, waccAdj, Dminus };
}
```

### 5.3 Anti-Bias-Warnung

```
WARN wenn:
  1) FV_inv < Preis
  2) FV_catalyst < Preis  (nach GB)
  3) symmetryOk === false
  4) Σ GB_up > 2 × |Σ GB_down|  bei confidence≥medium   // asymmetrischer Optimismus
  5) hard Gate aktiv (PRICING_POWER, …) — unabhängig vom DCF
```

---

## 6. LLM-Search über OpenRouter (generisch)

### 6.1 Query-Builder (keine Eigennamen-Pflicht)

```ts
export function buildCatalystSearchQueries(opts: {
  ticker: string;
  sector: string;
  industry?: string;
  topCountries: string[];
}): string[] {
  const branch = opts.industry || opts.sector;
  const q = [
    `${opts.ticker} earnings guidance OR margin OR demand ${branch}`,
    `${branch} competition OR market share OR pricing pressure`,
    `${branch} regulation OR policy OR subsidy risk ${opts.topCountries.slice(0, 2).join(' ')}`,
    `${opts.ticker} downside risk OR headwind OR impairment`,
  ];
  return q;
}
```

### 6.2 Prompt (OpenRouter — Extraktion, kein Urteil)

```text
Du bist Extraktions-Assistent für Investment-Katalysatoren (Upside und Downside).

Kontext:
- Ticker: {ticker} ({companyName})
- Sektor/Branche: {sector} / {industry}
- Umsatzländer: {topCountries}
- Datum: {asOf}
- Optional Snippets aus Search: {sourceCandidates}

Auftrag:
Finde material relevante Upside- UND Downside-Faktoren der letzten ~18 Monate.
Arbeite entlang generischer Achsen — KEINE Fixliste von Gesetzen oder Pharma-Klischees:
  demand_macro | earnings_guidance | margin_cost | multiple_rates |
  regulation_policy | competition_share | product_pipeline | balance_sheet_liquidity | other

Regeln:
1. Für jeden Upside mit Substanz: komplementäre Downside-These (Symmetrie).
2. Nur Fakten mit URL und publishedAt. Keine Kauf-/Verkaufsempfehlung.
3. Keine pauschalen Patent-Cliff-/Medicaid-/IRA-Einträge, nur wenn Quelle + Sektor passt.
4. grossImpact als Dezimalzahl schätzen nur wenn aus Quelle ableitbar, sonst null.
5. Wenn nichts Materiales: leere Arrays.

Output JSON:
{
  "upside": [ { "axis", "title", "description", "grossImpact", "posHint",
               "source": { "url", "publishedAt", "snippet" } } ],
  "downside": [ … gleiche Felder … ],
  "pairs": [ { "upsideTitle", "downsideTitle" } ]
}
```

### 6.3 OpenRouter-Anbindung (Skizze)

```
1. buildCatalystSearchQueries → optional Sonar/Tavily/X Snippets
2. OpenRouter Chat Completions (Modell-Fallback wie WORK TEIL 4:
   primär starkes Modell → bei 402/Fail Haiku/Llama/Gemini-Free)
3. JSON parse → BiasCatalyst[]
4. pricedInFromReverse(gapRatio) auf jeden Katalysator legen
5. PoS = posHint − margin (geclampt)
6. symmetryOk prüfen → ggf. zweiter LLM-Pass nur für fehlende Downsides
7. aggregateGb → FV_catalyst
8. invertedDcf(mode: 'growth') → FV_inv
9. Warn-Flags setzen
```

Low confidence → kein GB, nur UI-Badge (wie Regulatory).

---

## 7. UI-Ausgabe

```
FV base            $X
Σ GB (up/down)     +a % / −b %
FV catalyst        $Y
FV inverted        $Z   (mode: growth | wacc)
g* / realized8Q    …
Warnungen          [Symmetrie | FV_inv < Preis | Asymmetrie | Gate]
Katalysator-Tabelle: Achse | Richtung | Title | PoS | pricedIn | GB | Quelle
```

---

## 8. Abgleich alte vs. neue Logik

| Alt (problematisch) | Neu |
| --- | --- |
| 5 Fix-Downsides inkl. Patent Cliff | generische Achsen + LLM |
| EW×Impact hardcodiert | PoS × Netto aus Extraktion |
| Damage auf FV + WACC↑ + g↓ | nur Σ GB auf FV_base, Inverted = **ein** Hebel |
| Einpreisung 0.4/0.6/0.8 pauschal | pricedInFromReverse(gapRatio) |
| PoS = Historie − 15 % ohne Basis | Status/Quelle − margin |

---

## 9. Checkliste

```
[ ] Hardcode-Tabelle 5 Downsides entfernt (Code + Prompt)
[ ] Prompt ohne Medicaid/IRA/Patent-Cliff-Pflicht
[ ] buildCatalystSearchQueries generisch
[ ] OpenRouter + Fallback-Kette
[ ] symmetryOk + Retry
[ ] pricedInFromReverse
[ ] aggregateGb mit Cap ±35 %
[ ] invertedDcf genau ein mode
[ ] Warnungen 1–5
[ ] low confidence ohne GB
[ ] Unit-Tests: nur Upside → symmetry fail; Pharma-Ticker ohne Patent-Quelle → kein Patent-GB
```

**Weiter:** Reverse g* → [WORK_REVERSE_DCF_BRIDGE.md](./WORK_REVERSE_DCF_BRIDGE.md) · Gates → [WORK_SCORING_VORLAGE.md](./WORK_SCORING_VORLAGE.md) · Regulatory generisch → [WORK2.md](./WORK2.md)

**Regel:** Design-Dokumentation. Implementierung lokal → PR → Review.
