# WORK.md

> Stand: 23.07.2026 | Branch: `btc-restore-modular` (live, von `33c8e77`)
> Regel: Kein Code-Push über GitHub API ohne lokale Validierung + PR + Review.

---

# TEIL 1 — BTC DASHBOARD RESTORE

## Diagnose

GitHub API trunciert `BTCDashboard.tsx` bei ~100 KB Base64, Abbruch mitten in `Section2Halving`.

- Sections 3–12 + `export default function BTCDashboard` fehlen in `main`
- `Section13Miner` vorhanden aber nie eingebunden (kein Parent-Render)
- Identischer Bug wie `routes.ts` — Lösung: Datei aufsplitten

## Restore-Plan

### Phase 1 — Backup-Branch [DONE]

```bash
git checkout -b btc-restore bafff3c
# Branch btc-restore-modular ist live von 33c8e77
```

### Phase 2 — Modular aufsplitten [OFFEN, lokal]

```
client/src/pages/
├── BTCDashboard.tsx        ← Shell + export default (~200 Zeilen)
└── btc/
    ├── Sections1to6.tsx    ← Status, Halving, Indikatoren, Power-Law, Monte Carlo
    ├── Sections7to12.tsx   ← Kategorien, Zyklus, Finale Schätzung, TA, Fear&Greed, Fazit
    └── Section13Miner.tsx  ← Puell, Hash Ribbons, Breakeven, Miner Score
```

Kritische fehlende Zeile im Section-Switch:

```tsx
case 13: return (
  <Section13Miner
    data={btcData}
    minerData={minerData ?? null}
    loading={minerLoading}
    error={minerError}
  />
);
```

### Doublecheck vor Merge

- [ ] Keine zirkulären Imports
- [ ] export / export default konsistent
- [ ] tooltipStyle, MetricCard nicht doppelt definiert
- [ ] BTCAnalysis-Interface nur einmal
- [ ] SECTIONS-Array hat alle 13 Einträge
- [ ] sectionRefs deckt alle 13 IDs ab

## Bekannte gute Commits

| SHA | Beschreibung |
|---|---|
| 33c8e77 | HEAD main — Basis btc-restore-modular |
| 5bf8a2d | Section 13 vollständig (direkter Push) |
| bafff3c | PR #31 Squash — letzter valider Stand vor Truncation |

---

# TEIL 2 — AKTIENANALYSE: BEKANNTE BUGS (mit Commit-Referenz)

## BUG A — FMP-Laufstatus (doublecheck ob Analyse über FMP läuft)

**Frage:** Läuft https://aktienanalyst-pro.pplx.app über FMP oder nicht?

**Was im Code steht (analyze-route.ts, Commit 5a283e4, 16.07.2026):**

```ts
// Step 1: getFmpFallbackData(upperTicker) — 13 parallele FMP-Calls
const { quote, profile, financials, analyst, ohlcv, segments, peers, ratios } = fmpData;
// Wenn fmpData null → 503 zurück, KEIN Sektor-Fallback
```

**Diagnose-Checkliste:**
```
[ ] GET https://aktienanalyst-pro.pplx.app/api/fmp-budget
    Erwartete Antwort: { fmp: { calls: N, budget: 750 }, fmpAvailable: true }
    Wenn fmpAvailable: false → FMP_API_KEY fehlt in credentials
```

**Fix wenn FMP nicht läuft:**
```
Branch: fix/fmp-key-check
1. Deploy-credentials FMP_API_KEY prüfen
2. isFmpAvailable() im startup loggen
3. /api/fmp-budget Endpunkt im Frontend sichtbar machen
```

---

## BUG B — Peer-Vergleich: ROI (3J) + ROE fehlen, falsche Darstellung Section 7

**Symptom (Screenshot 23.07.2026):**
- P/E (TTM) zeigt n/a
- Peer-Tabelle fehlt komplett
- Nur ROE im Peer-Objekt — ROI (Return on Invested Capital / ROIC) 3-Jahres-Vergleich fehlt

**Was im Code existiert (news-peers.ts, Commit ce3b1bc, 16.07.2026):**
```ts
export async function fetchPeerComparisonFromTickers(tickers: string[]): Promise<PeerData[]>
// Gibt zurück: { ticker, name, pe, forwardPE, peg, evEbitda, revenueGrowth }
// FEHLT: roic3Y, roe, roa, revenueCAGR3Y, eps5YGrowth, fcfMargin, grossMargin
```

**Was fehlt — vollständige Peer-Metriken:**

| Metrik | FMP-Endpunkt | Formel / Feld |
|---|---|---|
| P/E TTM | `/ratios/:ticker` | `priceEarningsRatio` |
| Forward P/E | `/ratios/:ticker` | `priceEarningsRatioTTM` |
| PEG | berechnet | `forwardPE / epsGrowthFwd_%` |
| EV/EBITDA | `/ratios/:ticker` | `enterpriseValueMultiple` |
| Revenue CAGR 3J | `/income-statement?limit=3` | `(rev[0]/rev[2])^(1/3)-1` |
| EPS 5J CAGR | `/financial-growth?limit=1` | Feld `epsgrowth` |
| FCF Marge | cashflow + income | `(opCF-|capex|)/revenue*100` |
| Gross Margin | income | `grossProfit/revenue*100` |
| ROE | `/ratios/:ticker` | `returnOnEquity` |
| **ROIC 3J (NEU)** | `/key-metrics/:ticker?limit=3` | siehe Formel unten |
| ROA | `/key-metrics/:ticker?limit=3` | `netIncome/totalAssets` |

**Korrekte ROIC-Formel (muss exakt implementiert werden):**

```ts
// ROIC = NOPAT / Invested Capital
// NOPAT = EBIT * (1 - effektiver Steuersatz)
// Invested Capital = Eigenkapital + langfristige Schulden - Cash
//
// FMP-Felder:
// EBIT            = incomeLatest.operatingIncome
// Tax Rate        = incomeLatest.incomeTaxExpense / incomeLatest.incomeBeforeTax
//                   (clamp: 0.10 – 0.35; wenn negativ → 0.21 Standard)
// LongTermDebt    = balanceSheet.longTermDebt
// TotalEquity     = balanceSheet.totalStockholdersEquity
// Cash            = balanceSheet.cashAndCashEquivalents
//
// Invested Capital = TotalEquity + LongTermDebt - Cash
// NOPAT           = EBIT * (1 - TaxRate)
// ROIC            = NOPAT / InvestedCapital * 100
//
// 3J-Durchschnitt:
// ROIC_3Y = (ROIC[0] + ROIC[1] + ROIC[2]) / 3
// FMP-Daten: /api/v3/key-metrics/:ticker?limit=3 liefert roic direkt

export function calcROIC(ebit: number, taxExpense: number, incomeBeforeTax: number,
  longTermDebt: number, totalEquity: number, cash: number): number {
  const taxRate = incomeBeforeTax > 0
    ? Math.max(0.10, Math.min(0.35, taxExpense / incomeBeforeTax))
    : 0.21;
  const nopat = ebit * (1 - taxRate);
  const investedCapital = totalEquity + longTermDebt - cash;
  if (investedCapital <= 0) return 0;
  return (nopat / investedCapital) * 100;
}

// Alternativ direkt aus FMP /key-metrics:
// const roic3Y = keyMetrics.slice(0,3).map(m => m.roic * 100).reduce((a,b)=>a+b,0) / 3;
```

**Fix-Plan:**
```
Branch: fix/peer-comparison-section7

1. server/news-peers.ts: fetchPeerComparisonFromTickers erweitern
   + ROIC 3J: /key-metrics?limit=3 pro Peer (Feld: roic)
   + ROA: netIncome/totalAssets
   + CAGR 3J: income-statement?limit=3 pro Peer
   + EPS 5J: financial-growth?limit=1 pro Peer
   Budget: 5 Peers × 5 Calls = 25 extra FMP-Calls — vorher prüfen

2. shared/schema.ts: PeerData-Interface erweitern:
   roic3Y: number;  // ROIC 3-Jahres-Durchschnitt in %
   roa: number;     // Return on Assets in %
   roe: number;     // Return on Equity in %
   revenueCAGR3Y: number;
   eps5YGrowth: number;
   fcfMargin: number;
   grossMargin: number;

3. Frontend Section 7:
   + Tabelle alle 11 Metriken
   + Farbcodierung: besser als Sektor-Median = grün, schlechter = rot
   + ROIC vs. WACC: wenn ROIC > WACC → grünes Badge "Wertsteigernd"
   + Sektor-Median als letzte Zeile
```

---

## BUG C — Revenue-Segmente (Produkt + Region) fehlen in Investmentthese

**Zwei getrennte FMP-Endpunkte nötig:**

```ts
// 1. Produkt-Segmente:
GET /api/v3/revenue-product-segmentation?symbol={ticker}&apikey={key}

// 2. Regionale Segmente:
GET /api/v3/revenue-geographic-segmentation?symbol={ticker}&apikey={key}

// Transformation (identisch für beide):
const segObj = Array.isArray(data) ? data[0] : data;
const keys = Object.keys(segObj).filter(k =>
  !['date','symbol','reportedCurrency','period'].includes(k)
);
const total = keys.reduce((s, k) => s + (segObj[k] ?? 0), 0);
const segments = keys
  .map(k => ({ name: k, revenue: segObj[k], percentage: Math.round(segObj[k]/total*1000)/10 }))
  .filter(s => s.revenue > 0)
  .sort((a,b) => b.revenue - a.revenue);
```

**Beispiel MSFT FY2025:**
```
Produkt: Intelligent Cloud $111.8B (39.8%) | Productivity $91.0B (32.4%) | Personal Computing $78.0B (27.8%)
Region:  USA ~55% | Europa ~25% | Rest ~20%
```

**Beispiel NVO FY2024 (DKK → umrechnen!):**
```
Produkt: GLP-1/Wegovy ~60% | Diabetes/Ozempic ~35% | Rare Disease ~5%
Region:  Nordamerika ~60% | Europa ~22% | Asien ~18%
```

**Fix-Plan:**
```
Branch: fix/revenue-segments-product-geo
server/fmp.ts: fmpSegments aufsplitten in fmpProductSegments() + fmpGeoSegments()
Frontend: PieChart (Produkte) + Horizontal BarChart (Regionen)
```

---

## BUG D — DCF und CRV inflationiert bei Nicht-USD-Titeln (NVO, ASML, SAP)

**Ursache:** fxRate wird gefetcht, aber fcfTTM, netDebt etc. werden nicht konvertiert.

**Konkrete Zahlen NVO:**
```
FCF TTM = 95 Mrd DKK × 0.1456 = $13.8 Mrd USD
Korrekter DCF Fair Value/ADR: ~$35-55 (Kurs $67 → plausibel overvalued)
Fehler ohne Konvertierung: Ergebnis in DKK als $ angezeigt → 6.9× falsch
```

**Fix:**
```ts
// ALLE Betrags-Felder mit fxRate multiplizieren:
const toUSD = (val: number) => val * fxRate;
const fcfTTM_usd  = toUSD(fcfTTM);
const netDebt_usd = toUSD(netDebt);
// sharesOutstanding und ADR-price NICHT konvertieren
```

---

# TEIL 3 — KATALYSATOREN-SEKTION 15: VOLLSTÄNDIGE MATHEMATISCHE FORMELN

> Quelle: catalyst-engine.ts (Commit 18c2e09, vollständig gelesen 23.07.2026)
> Diese Formeln MÜSSEN exakt so im LLM-Prompt (OpenRouter/llm-openrouter.ts)
> UND im Template-Fallback (catalyst-engine.ts) verwendet werden.

## 3.1 — Definitionen aller Katalysator-Felder

```
PoS %           = Probability of Success (historisch begründet, -10-15% Safety Margin)
Brutto-Upside   = Kursanstieg in % wenn der Katalysator sich vollständig materialisiert
Einpreisungsgrad = Anteil des Katalysators der bereits im Kurs steckt (via Konsens/Reverse DCF)
Netto-Upside    = Brutto-Upside × (1 - Einpreisungsgrad/100)
GB %            = Gewichteter Beitrag = PoS/100 × Netto-Upside
```

## 3.2 — Exakte Formeln

```ts
// 1. Netto-Upside:
nettoUpside = bruttoUpside * (1 - einpreisungsgrad / 100)
// Beispiel Screenshot K1: 17% * (1 - 39/100) = 17% * 0.61 = 10.37% ✓

// 2. Gewichteter Beitrag (GB):
gb = (pos / 100) * nettoUpside
// Beispiel Screenshot K1: (75/100) * 10.37 = 7.78% ✓
// Beispiel Screenshot K2: (60/100) * 2.70 = 1.62% ✓
// Beispiel Screenshot K3: (60/100) * 8.40 = 5.04% ✓
// Beispiel Screenshot K4: (45/100) * 5.40 = 2.43% ✓

// 3. Σ Netto-Upside (vor PoS-Gewichtung):
sumNettoUpside = sum(nettoUpside_i)
// Screenshot: 10.37 + 2.70 + 8.40 + 5.40 = 26.87% ✓

// 4. GB-Summe (nach PoS):
sumGB = sum(gb_i)
// Screenshot: 7.78 + 1.62 + 5.04 + 2.43 = 16.87% ✓

// 5. Catalyst-Adjusted Target:
catalystTarget = dcfFairValue * (1 + sumGB / 100)
// Screenshot: $364.17 * (1 + 16.87/100) = $364.17 * 1.1687 = $425.61 ✓
// WICHTIG: Basis ist DCF Fair Value (konservativer Anker), NICHT Analyst PT!
// Analyst PT wird separat als Referenz gezeigt.
```

## 3.3 — Reverse DCF / Einpreisungsgrad-Berechnung

**Was aktuell in catalyst-engine.ts steht (calcImpliedGStar, Commit 18c2e09):**

```ts
export function calcImpliedGStar(params: {
  price: number; sharesOutstanding: number; netDebt: number;
  fcf: number; wacc: number;
}): number | null {
  const ev = price * sharesOutstanding + netDebt;
  // g* = (WACC/100 - FCF/EV) * 100
  const impliedGrowth = (wacc / 100 - fcf / ev) * 100;
  return isFinite(impliedGrowth) ? impliedGrowth : null;
}
```

**PROBLEM: Diese Formel ist eine Näherung (Perpetuity-Approximation), keine exakte Lösung.**

**Korrekte Reverse DCF Formel — algebraisch exakt für N=5 Jahre:**

```ts
/**
 * Reverse DCF: Löse g* aus
 *   EV = FCF * Σ(t=1..N) [(1+g)^t / (1+WACC)^t]
 *       + FCF * (1+g)^N * (1+g_terminal) / [(WACC - g_terminal) * (1+WACC)^N]
 *
 * Wo:
 *   EV              = price * sharesOutstanding + netDebt  (Enterprise Value)
 *   FCF             = Free Cash Flow TTM
 *   WACC            = Weighted Avg Cost of Capital (dezimal, z.B. 0.085)
 *   N               = 5 (Planungshorizont Jahre)
 *   g_terminal      = 0.025 (2.5% = BIP-Wachstum langfristig — fix)
 *   g*              = gesuchtes implizites Wachstum
 *
 * Lösung: Binary Search über g* (numerisch, da keine geschlossene algebraische Lösung)
 */
export function calcImpliedGStarExact(params: {
  price: number;
  sharesOutstanding: number;
  netDebt: number;
  fcf: number;
  wacc: number;
  n?: number;
  terminalGrowth?: number;
}): number | null {
  const { price, sharesOutstanding, netDebt, fcf, wacc, n = 5, terminalGrowth = 0.025 } = params;

  if (fcf <= 0 || price <= 0 || sharesOutstanding <= 0) return null;
  const waccD = wacc / 100;
  const ev = price * sharesOutstanding + netDebt;
  if (ev <= 0) return null;

  // DCF-Wert berechnen bei gegebenem g
  function dcfValue(g: number): number {
    let pv = 0;
    for (let t = 1; t <= n; t++) {
      pv += fcf * Math.pow(1 + g, t) / Math.pow(1 + waccD, t);
    }
    // Terminal Value (Gordon Growth):
    const tv = fcf * Math.pow(1 + g, n) * (1 + terminalGrowth)
              / ((waccD - terminalGrowth) * Math.pow(1 + waccD, n));
    return pv + tv;
  }

  // Binary Search: suche g* so dass dcfValue(g*) = EV
  // Bereich: -5% bis +40% Wachstum
  let lo = -0.05, hi = 0.40;
  if (dcfValue(hi) < ev) return null; // EV nicht erreichbar
  if (dcfValue(lo) > ev) return null; // EV schon bei Schrumpfung zu hoch

  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (dcfValue(mid) > ev) hi = mid;
    else lo = mid;
    if (hi - lo < 0.0001) break;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100; // in Prozent, 2 Nachkommastellen
}

// Beispiel Validierung MSFT (Stand 2025):
// price = $415, shares = 7.43B, netDebt = -$50B (netto Cash)
// FCF TTM = $71B, WACC = 8.5%
// EV = 415 * 7.43B + (-50B) = $3.034T
// calcImpliedGStarExact → g* ≈ 14.5%
// Interpretation: Markt preist ~14.5% FCF-Wachstum p.a. über 5J ein
// Historisches FCF-Wachstum MSFT: ~15-18% → leicht überbewertet
```

## 3.4 — Einpreisungsgrad aus g* ableiten

```ts
/**
 * Einpreisungsgrad: Wie viel % des Brutto-Upsides steckt bereits im Kurs?
 *
 * Methode (aktuell in catalyst-engine.ts calcEinpreisungsgrad):
 *   1. g* berechnen (impliziertes Wachstum aus aktuellem Kurs)
 *   2. Einpreisungsgrad = g* / bruttoUpside_als_g-Äquivalent
 *   3. Clamp: min 15%, max 70%
 *
 * PROBLEM: g* und bruttoUpside haben unterschiedliche Einheiten!
 *   bruttoUpside ist Kursanstieg in %, g* ist FCF-Wachstum in %/Jahr
 *   Direkte Division ist dimensionsunstimmig.
 *
 * KORREKTE Methode:
 *   Schritt 1: DCF Fair Value bei historischem Wachstum berechnen (g_hist)
 *   Schritt 2: DCF Fair Value bei g* (aktueller Kurs) berechnen
 *   Schritt 3: Einpreisungsgrad = (price - dcf_gHist) / (dcf_gStar - dcf_gHist)
 *   Interpretation: Wie viel der Differenz zwischen Fair Value und Markt
 *                  ist durch impliziertes Wachstum erklärt?
 *
 * Vereinfachte Formel (pragmatisch, bis exakte Methode implementiert):
 *   Einpreisungsgrad_approx = clamp(g* / (historischesWachstum * 1.2), 0.15, 0.70)
 *   d.h.: wenn g* ≈ historisches Wachstum → ~83% eingepreist (hohes g*)
 *         wenn g* << historisch → niedrig eingepreist (Discount)
 */
export function calcEinpreisungsgradV2(params: {
  gStar: number;         // impliziertes Wachstum in % (aus calcImpliedGStarExact)
  historicalGrowth: number; // historisches FCF/Revenue-Wachstum in %
  bruttoUpside: number;  // Brutto-Upside % des Katalysators
  catalystType: string;
}): number {
  const { gStar, historicalGrowth, bruttoUpside, catalystType } = params;

  // Wenn g* verfügbar: relative Einpreisung
  if (gStar > 0 && historicalGrowth > 0) {
    const relEinpreisung = gStar / (historicalGrowth * 1.2);
    return Math.round(Math.max(0.15, Math.min(0.70, relEinpreisung)) * 100);
  }

  // Fallback: Sektor-Basisraten (unverändert aus aktuellem Code)
  const growthFactor = Math.min(historicalGrowth / 30, 1.0);
  const baseRate: Record<string, number> = {
    growth:  35 + Math.round(growthFactor * 20),
    margin:  30 + Math.round(growthFactor * 15),
    product: 25 + Math.round(growthFactor * 15),
    ai:      45 + Math.round(growthFactor * 20),
    macro:   35,
  };
  return baseRate[catalystType] ?? 35;
}
```

## 3.5 — LLM-Prompt für OpenRouter: Pflicht-Formeln und Regeln

> Diese Regeln müssen in llm-openrouter.ts → generateCatalystsAndMatchNews()
> als System-Prompt-Block eingefügt werden. Aktuell fehlt die mathematische
> Spezifikation. Commit: llm-openrouter.ts noch nicht gelesen — Aufgabe:
> sicherstellen dass dieser Prompt-Block exakt so enthalten ist.

```ts
// server/llm-openrouter.ts — Prompt-Block für Katalysator-Generierung:
const CATALYST_MATH_RULES = `
MATHEMATISCHE REGELN (ZWINGEND — keine Abweichung erlaubt):

1. Netto-Upside = Brutto-Upside × (1 - Einpreisungsgrad/100)
   Beispiel: Brutto-Upside=17%, Einpreisungsgrad=39% → Netto-Upside = 17 × 0.61 = 10.37%

2. GB (Gewichteter Beitrag) = (PoS/100) × Netto-Upside
   Beispiel: PoS=75%, Netto-Upside=10.37% → GB = 0.75 × 10.37 = 7.78%

3. PoS (Probability of Success) MUSS historisch begründet sein:
   - Basiere auf tatsächlichen Erfüllungsraten ähnlicher Katalysatortypen
   - Ziehe IMMER 10-15 Prozentpunkte Safety Margin ab
   - Beispiele: Phase-3 FDA: 60-65% Erfolg → PoS max 50%; Cloud-Wachstum: ~75% → PoS max 65%
   - Niemals PoS > 80% oder < 20%

4. Einpreisungsgrad = Anteil der bereits im Konsens/Forward-Schätzungen steckt:
   - Hohe Forward-PE relative zu Peers → hoher Einpreisungsgrad (40-60%)
   - Stock unter 52W-Hoch, Konsens-PT weit über Kurs → niedriger Einpreisungsgrad (20-35%)
   - Niemals Einpreisungsgrad > 70% (dann wäre Netto-Upside minimal)

5. Brutto-Upside MUSS an konkrete Szenarien geknüpft sein:
   - Revenue Catalyst: Brutto-Upside ≈ Revenue-Schock × Revenue/MarketCap-Multiplikator
   - Margin Catalyst: Brutto-Upside ≈ Margenhebel × EBIT-Multiplikator
   - Beispiel MSFT: +1% Margin → +$2.8B EBIT → bei 30x EV/EBIT ≈ +$84B EV ≈ +3% Kurs

6. KEIN Katalysator darf generisch sein:
   VERBOTEN: "Revenue Growth Acceleration", "Margin Expansion" (Template-Namen)
   PFLICHT: Unternehmensname/Produkt/Projekt im Katalysator-Namen
   Beispiele: "Azure OpenAI Enterprise Adoption", "Wegovy US Market Penetration",
   "VMware Integration Synergies $3B by FY26"
`;

// Timestamp-Verifikation der News:
// Jeder News-Treffer muss auf den Katalysator passen:
// 1. publishedAt muss innerhalb der letzten 90 Tage liegen
// 2. Headline muss das Unternehmen ODER das Produkt/Projekt explizit nennen
// 3. Wenn Timestamp > 90 Tage: News nicht verwenden (veraltet)
// 4. Cache-Key: `${ticker}:${catalystName}:${date.slice(0,10)}`
//    Wenn Cache-Hit (< 20 Min): direkter Return ohne LLM-Call
```

## 3.6 — Reverse DCF Section 15: Vollständige Implementierung

**Was fehlt (Section 15 noch nicht implementiert laut WORK.md Roadmap):**

```ts
// server/routes/reverse-dcf.ts — NEUER Endpunkt
// POST /api/reverse-dcf
// Body: { ticker: string, currentPrice: number, wacc: number, n: number }

interface ReverseDCFResult {
  impliedGrowthRate: number;   // g* in % p.a.
  historicalGrowth: number;    // FCF CAGR 5J aus FMP
  delta: number;               // g* - historicalGrowth (positiv = überbewertet)
  marginOfSafety: number;      // (dcfFairValue - price) / price * 100
  dcfFairValue: number;        // DCF bei g=historicalGrowth
  interpretation: string;      // 'Unterbewertet' | 'Fair' | 'Leicht überbewertet' | 'Stark überbewertet'
  sensitivityTable: SensitivityRow[];
}

interface SensitivityRow {
  wacc: number;        // 7% | 8% | 9% | 10% | 11%
  g5Y_bear: number;   // -5%: resultierender Fair Value
  g5Y_base: number;   // historisch
  g5Y_bull: number;   // +5% über historisch
}

// Interpretation-Schwellen:
function interpretDelta(delta: number, marginOfSafety: number): string {
  if (marginOfSafety > 20) return 'Unterbewertet';     // DCF > 120% Kurs
  if (marginOfSafety > 0)  return 'Fair';               // DCF 100-120% Kurs
  if (delta < 5)           return 'Leicht überbewertet'; // g* nur 5% über hist.
  return 'Stark überbewertet';                           // g* >> historisch
}

// Sensitivitätstabelle:
// WACC-Range: [0.07, 0.08, 0.09, 0.10, 0.11]
// Growth-Range: [hist-5%, hist, hist+5%]
// 5×3 = 15 DCF-Berechnungen, Heatmap im Frontend
// Farbe: > aktueller Kurs = grün, < aktueller Kurs = rot

// Frontend:
// Sidebar: { id: 15, label: 'Reverse DCF', icon: RefreshCw }
// Slider: WACC 4–15% (Schritt 0.5%)
// Dropdown: N = 5J / 7J / 10J
// Heatmap: 5 WACC × 3 Szenarien
// Badge: Interpretation mit Farbe

// Pflicht-Formel laut Reverse DCF Definition:
// "Aktienkurs preist g* = X% FCF-Wachstum p.a. ein.
//  Historisch: Y% — Kurs preist [X-Y]% Prämie auf historisches Wachstum ein."
```

**Validierungsbeispiele für Tests:**

```
MSFT (Stand Jan 2025):
  price=$415, shares=7.43B, netDebt=-$50B, FCF=$71B, WACC=8.5%
  EV = 415*7.43B - 50B = $3.034T
  calcImpliedGStarExact → g* ≈ 14.5%
  FCF CAGR 5J (FMP financial-growth) ≈ 16-18%
  → delta = 14.5 - 17 = -2.5% → Kurs preist weniger ein als historisch → Fair/leicht unterbewertet

NVO (ADR, Stand Jan 2025):
  price=$67 (ADR), shares_adj=4.46B, FCF_USD=$13.8B (nach DKK-Konvertierung), netDebt_USD=$4.4B
  WACC=8.0% (Pharma)
  EV = 67*4.46B + 4.4B = $303B
  calcImpliedGStarExact → g* ≈ 35%+
  FCF CAGR 5J ≈ 30-35% (GLP-1 Boom)
  → delta ≈ 0-5% → Fair bis leicht überbewertet

ASML (ADR, Stand Jan 2025):
  price=$680, shares=394M, FCF_USD=$8.5B*1.08=$9.2B, netDebt_USD=$2B
  WACC=8.5%
  EV = 680*394M + 2B = $270B
  calcImpliedGStarExact → g* ≈ 28%
  FCF CAGR 5J ≈ 15-18%
  → delta ≈ +12% → stark überbewertet (Prämium gerechtfertigt durch EUV-Monopol?)
```

---

# TEIL 4 — FMP-MIGRATION (P0-BLOCKER)

## Migrationsplan

| Schritt | Aufgabe | Branch |
|---|---|---|
| 1 | /api/fmp-budget im Frontend sichtbar | fix/fmp-debug-panel |
| 2 | Non-USD Konvertierung fix (BUG D) | fix/non-usd-dcf-conversion |
| 3 | Peer-Vergleich + ROI 3J (BUG B) | fix/peer-comparison-section7 |
| 4 | Revenue-Segmente Produkt + Geo (BUG C) | fix/revenue-segments-product-geo |
| 5 | calcImpliedGStarExact ersetzen alten calcImpliedGStar | fix/reverse-dcf-exact |
| 6 | LLM-Prompt Catalyst Math Rules (BUG E) | fix/llm-catalyst-math-rules |
| 7 | Integration-Test: MSFT, AAPL, NVO, ASML | fix/integration-test |

### Korrekte FMP-Request-Struktur

```ts
export async function fmpGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY nicht gesetzt');
  const url = new URL(`https://financialmodelingprep.com/api/v3${path}`);
  url.searchParams.set('apikey', key);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FMP ${path} HTTP ${res.status}`);
  const data = await res.json();
  if (data && 'Error Message' in data) throw new Error(`FMP: ${(data as any)['Error Message']}`);
  return data as T;
}
```

---

# TEIL 5 — LANGFRISTIGE FEATURE-ROADMAP

## Technische Grundregeln

- Neue Section: Eintrag in SECTIONS-Array + case im Section-Switch
- Neuer Endpunkt: eigene Datei in server/routes/ (max 80 KB)
- Formeln: unit-testbare Funktionen in client/src/lib/calculations.ts
- LLM-Search: POST /api/llm-search { query, ticker, context } → sonar-pro
- Anti-Truncation: jede Datei < 80 KB vor Push

---

## Stock Analysis Pro

### Aktienkurshistorie 10 Jahre

```ts
const from = dayjs().subtract(10, 'year').format('YYYY-MM-DD');
// FMP: /api/v3/historical-price-full/:ticker?from={from}&apikey={key}
```

### Section 8 — WACC & Terminal Value individuell

```tsx
const [wacc, setWacc] = useState(0.09);
const [g, setG] = useState(0.025);
// TV = FCF_last * (1+g) / (WACC - g)
// CAPM: Re = Rf + Beta*(Rm-Rf)
```

### PESTEL-Analyse [Section 14]
```ts
POST /api/pestel { ticker, company, sector }
Sidebar: { id: 14, label: 'PESTEL', icon: Globe }
```

### Reverse DCF [Section 15]
```
Vollständige Implementierung: siehe TEIL 3.6
Sidebar: { id: 15, label: 'Reverse DCF', icon: RefreshCw }
```

### Monte Carlo — Flexible Iterationen 0–50.000
```tsx
onBlur: clamp(parseInt(input), 0, 50000)
// Warnung bei > 30k
```

### Section 17 — Zusammenfassungstabelle

| Metrik | Wert | Bewertung | Quelle |
|---|---|---|---|
| Aktienkurs | $xxx | — | FMP |
| KGV | xx.x | Neutral | FMP |
| DCF Fair Value | $xxx | Unterbewertet | Berechnet |
| Reverse DCF g* | x.x% | Hoch | Berechnet |
| PESTEL-Risiko | Mittel | — | LLM |
| Management Score | xx/100 | — | LLM+FMP |
| Thesis Score | xx/100 | — | Komposit |

### Management-Analyse (Buffett-Kriterien)
```ts
POST /api/management { ticker }
// FMP: /api/v3/key-executives/:ticker, /api/v3/earnings-surprises/:ticker
// sonar-pro: Skandale, SEC-Verfahren
```

### ROIC / ROE / ROA — Jahresvergleich 3 Jahre
```
ROIC = EBIT*(1-Tax) / (Equity+LongTermDebt-Cash)
ROE  = NetIncome / Equity
ROA  = NetIncome / TotalAssets
FMP: /api/v3/key-metrics/:ticker?limit=3
BarChart 3 Gruppen, ROIC > WACC = grün
```

### Thesis Score
```
Thesis Score (0-100) =
  Moat Score * 0.25 + FCF Marge 5J * 0.20 + Fiskalstimulus * 0.15
  + Konjunktur-Trend * 0.15 + Reputation * 0.15 + Positive Events * 0.10
```

### Virtuelles Portfolio + Kelly
```
Kelly % = (p*b - q) / b
p = Thesis Score/100, b = Upside/Downside aus DCF
Pabrai: max 10% pro Position
CAPM: Re = 4.5% + Beta*5.5%
Tracking: LocalStorage (V1)
```

---

## Rezessionsboard

### Google Trends — N/A fixen
```ts
// Fallback: Cache letzter Wert → score=50, Amber-Badge 'Daten veraltet'
```

### Sektor-Rotation
```
Relativbewertung = Sektor-KGV_aktuell / Sektor-KGV_10J_Mittel
FMP: /api/v3/sector_price_earning_ratio — Heatmap 11 GICS-Sektoren
```

---

## BTC-Dashboard — Section 13 Miner-Zone

### Puell Multiple
```
Puell = Tagesemission_USD / MA365(Tagesemission_USD)
<0.5 Kapitulation | >4 überhitzt
```

### Hash Ribbons
```
MA30 vs MA60 Hashrate — Kaufsignal: MA30 kreuzt MA60 von unten
```

### MVRV
```
MVRV = Market Cap / Realized Cap — <1.0 Kapitulation | >3.5 überhitzt
```

---

## Gold-Dashboard (vorzubereiten)

```
Realzins-Modell: Gold_FairValue ≈ 2000 - 800 * Realzins_%  (FRED DFII10)
AISC: ~$1.200-1.400/oz (World Gold Council)
Gold-Score = Realzins*0.35 + DXY*0.20 + ZB*0.20 + AISC*0.15 + GDX*0.10
```

---

## Ideen-Pool

- [ ] Overview-Seite 2026 vor Ticker-Eingabe
- [ ] Einleitung: Aktien folgen zukünftigem Gewinnwachstum, nicht historischer Performance
- [ ] Makroanalyse: Inflation, Fed, Geopolitik, Deglobalisierung
- [ ] Megatrendanalyse: KI, Elektrifizierung, Eisenbahn, Rüstung
- [ ] Blasen/Rezessionsindikatoren: Shiller-KGV, Buffett-Indikator, Yield Curve
- [ ] Asset Price Inflation 2026: Kaufkrafterosion
