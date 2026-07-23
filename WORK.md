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

**Was fmp.ts tut (isFmpAvailable()):**
```ts
export function isFmpAvailable(): boolean {
  return !!process.env.FMP_API_KEY && process.env.FMP_API_KEY.length > 10;
}
```

**Diagnose-Checkliste:**
```
[ ] GET https://aktienanalyst-pro.pplx.app/api/fmp-budget
    Erwartete Antwort: { fmp: { calls: N, budget: 750 }, fmpAvailable: true }
    Wenn fmpAvailable: false → FMP_API_KEY fehlt in credentials
[ ] Nach Analyse: console.log '[ANALYZE] Starting analysis for MSFT (useLLM=false)'
    Wenn fehlt → Request kommt gar nicht an (Routing-Bug)
[ ] Wenn 503: 'Keine Daten für X verfügbar' → FMP liefert null
```

**Fix wenn FMP nicht läuft:**
```
Branch: fix/fmp-key-check
1. publish_website credentials= FMP_API_KEY=<key> prüfen
2. isFmpAvailable() im startup loggen
3. /api/fmp-budget Endpunkt im Frontend sichtbar machen (Admin-Panel)
```

---

## BUG B — Peer-Vergleich fehlt in Section 7 (Relative Bewertung)

**Symptom (Screenshot 23.07.2026):**
- P/E (TTM) zeigt n/a statt echtem Wert
- Sector Avg: 28.0 (Hardcode-Fallback, kein echter FMP-Wert)
- Peer-Tabelle darunter fehlt komplett
- Revenue Growth vs. Branche: MSFT +14.9% vs. Branche +16.0% — korrekt, aber Quelle unklar
- TAM & Marktposition: $1.500B / 18.78% — korrekt
- Premium Breakdown: +-100.0% Moat-Justified — Darstellungsfehler (sollte z.B. +12% sein)

**Was im Code existiert (Commit ce3b1bc, 16.07.2026, news-peers.ts):**

```ts
// fetchPeerComparisonFromTickers(peerTickers) — läuft, aber Daten kommen
// nicht korrekt in Section 7 Frontend an
export async function fetchPeerComparisonFromTickers(tickers: string[]): Promise<PeerData[]> {
  // FMP /api/v3/profile/{ticker} + /api/v3/ratios/{ticker}?limit=1
  // Returns: { ticker, name, pe, forwardPE, peg, evEbitda, revenueGrowth,
  //            fcfMargin, grossMargin, marketCap, eps5YGrowth }
}
```

**Was im Backend assembled wird (analyze-route.ts Step 17):**
```ts
// peerComparison: any[] — ist im StockAnalysis-Objekt enthalten
// Problem: Frontend liest peerComparison nicht aus oder rendert es nicht
```

**Was fehlt — Peer-Metriken die gezeigt werden müssen:**

| Metrik | FMP-Quelle | Formel / Feld |
|---|---|---|
| P/E TTM | /ratios/:ticker | priceEarningsRatio |
| Forward P/E | /ratios/:ticker | priceEarningsRatioTTM |
| PEG | berechnet | PE / EPS-Wachstum 5J |
| EV/EBITDA | /ratios/:ticker | enterpriseValueMultiple |
| Revenue Growth YoY | income[0] vs income[1] | (rev0-rev1)/rev1*100 |
| Revenue Growth 3J CAGR | income[0] vs income[3] | (rev0/rev3)^(1/3)-1 |
| EPS 5J CAGR | /financial-growth/:ticker | epsgrowth (5Y avg) |
| FCF Marge | cashflow + income | (opCF - capex) / revenue * 100 |
| Gross Margin | income | grossProfit / revenue * 100 |
| ROE | /ratios/:ticker | returnOnEquity |

**Korrekte Formeln:**
```ts
// PEG (Lynch-Methode, wie bereits in catalyst-engine.ts implementiert):
PEG = forwardPE / epsGrowthFwd_percent
// Wenn EPS-Wachstum negativ oder 0: PEG = null (nicht anzeigen)

// Revenue CAGR 3 Jahre:
CAGR_3J = (income[0].revenue / income[2].revenue) ^ (1/3) - 1
// FMP: /api/v3/income-statement/:ticker?limit=3

// EPS 5J CAGR:
EPS_5J = aus /api/v3/financial-growth/:ticker Feld 'epsgrowth' (5Y average)
// Alternativ: (eps[0] / eps[4]) ^ (1/5) - 1

// FCF Marge:
FCF_Marge = (operatingCashFlow - abs(capitalExpenditure)) / revenue * 100
```

**Fix-Plan:**
```
Branch: fix/peer-comparison-section7

1. server/news-peers.ts: fetchPeerComparisonFromTickers erweitern
   + CAGR 3J: income-statement?limit=3 pro Peer
   + EPS 5J: financial-growth?limit=1 pro Peer
   Achtung: 5 Peers x 4 Calls = 20 FMP-Calls extra → Budget-Check vorher

2. shared/schema.ts: PeerData-Interface erweitern
   revenueCAGR3Y: number;
   eps5YGrowth: number;
   fcfMargin: number;
   grossMargin: number;
   roe: number;

3. Frontend Section 7: peerComparison aus StockAnalysis lesen
   + Tabelle mit allen 10 Metriken rendern
   + Farbcodierung: besser als Sektor-Median = grün, schlechter = rot
   + Sektor-Median-Zeile als letzte Zeile der Tabelle

4. P/E (TTM) n/a-Bug:
   quote.pe ist manchmal null bei FMP für unprofitable Unternehmen
   Fix: if (pe === 0 || isNaN(pe)) → anzeigen als 'n/a' (bereits so, aber
   auch priceEarningsRatio aus ratios[0] als Fallback versuchen)
```

---

## BUG C — Revenue-Segmente (Produkt + Region) fehlen in Investmentthese

**Symptom:** Investmentthese zeigt keinen Umsatz nach Produkten/Medikamenten
und keine regionale Aufschlüsselung (USA / Europa / Asien) mehr.

**Was im Code existiert (Commit fb84193, 16.07.2026):**

```ts
// analyze-route.ts Step 7:
const revenueSegments: RevenueSegment[] = [];
if (Array.isArray(segments) && segments.length > 0) {
  const segLatest = segments[0];
  // Transformiert /stable flat-object → { name, revenue, percentage }[]
  // PROBLEM: FMP /revenue-product-segmentation gibt Produkt-Segmente
  // FMP /revenue-geographic-segmentation gibt Regionen
  // Aktuell nur EINES davon abgerufen (fmpSegments in fmp.ts)
}
```

**Zwei getrennte FMP-Endpunkte nötig:**

```ts
// 1. Produkt-Segmente:
GET /api/v3/revenue-product-segmentation?symbol={ticker}&apikey={key}
// Response (stable): { date, "Intelligent Cloud": 111800000000, "Productivity...": ... }
// Transformation:
const segObj = Array.isArray(data) ? data[0] : data;
const keys = Object.keys(segObj).filter(k => !['date','symbol','reportedCurrency','period'].includes(k));
const total = keys.reduce((s, k) => s + (segObj[k] ?? 0), 0);
productSegments = keys.map(k => ({
  name: k,
  revenue: segObj[k],
  percentage: Math.round(segObj[k] / total * 1000) / 10
})).filter(s => s.revenue > 0).sort((a,b) => b.revenue - a.revenue);

// 2. Regionale Segmente:
GET /api/v3/revenue-geographic-segmentation?symbol={ticker}&apikey={key}
// Response: { date, "United States": ..., "Europe": ..., "Asia": ... }
// Gleiche Transformation wie oben
// Ergebnis: geoSegments: RevenueSegment[]
```

**Beispiel MSFT (Geschäftsjahr 2025, in $B):**
```
Produkt-Segmente:
  Intelligent Cloud:              111.8B  (39.8%)
  Productivity & Business Proc.:   91.0B  (32.4%)
  More Personal Computing:          78.0B  (27.8%)

Regionale Segmente (approximativ):
  USA:       ~55%
  Europa:    ~25%
  Rest Welt: ~20%
```

**Beispiel NVO (Novo Nordisk, DKK → USD Konvertierung):**
```
Produkt-Segmente (FY2024, in DKK):
  GLP-1 / Obesity (Wegovy):   ~60% des Umsatzes
  Diabetes (Ozempic, NovoRapid): ~35%
  Rare Disease:                   ~5%

Regionale Segmente:
  Nordamerika (USA):          ~60%
  Europa:                     ~22%
  Asien / Rest:               ~18%

WICHTIG bei NVO: Umsatz in DKK gemeldet
Konvertierung: DKK/USD ~0.146 (Stand 2025)
```

**Fix-Plan:**
```
Branch: fix/revenue-segments-product-geo

1. server/fmp.ts: fmpSegments aufsplitten in:
   fmpProductSegments(ticker): Promise<RevenueSegment[]>
   fmpGeoSegments(ticker): Promise<RevenueSegment[]>

2. server/analyze-route.ts Step 7:
   const [productSegments, geoSegments] = await Promise.all([
     fmpProductSegments(upperTicker).catch(() => []),
     fmpGeoSegments(upperTicker).catch(() => []),
   ]);
   // Kein Crash wenn ein Endpunkt fehlt (nicht alle Ticker haben Segment-Daten)

3. shared/schema.ts:
   interface StockAnalysis {
     productSegments: RevenueSegment[];  // NEU (war: revenueSegments)
     geoSegments: RevenueSegment[];      // NEU
     revenueSegments: RevenueSegment[];  // behalten für Abwärtskompatibilität
   }

4. Frontend Investmentthese-Section:
   + PieChart für productSegments (Produkte/Medikamente, sortiert nach Anteil)
   + BarChart horizontal für geoSegments (USA / Europa / Asien / Rest)
   + Wenn keine Daten: 'Segment-Aufschlüsselung nicht verfügbar' (kein Crash)
```

---

## BUG D — DCF und CRV inflationiert bei nicht-US-Titeln (z.B. NVO, ASML, SAP)

**Symptom:** DCF Fair Value und CRV (Chancen-Risiko-Verhältnis) bei dänischen,
europäischen oder anderen Nicht-USD-Titeln um Faktor 6–7x inflationiert.

**Ursache (analyze-route.ts Step 2 + 18, Commit 5a283e4):**

```ts
// Step 2: FX-Rate wird gefetcht
let fxRate = 1;
if (reportedCurrency !== 'USD') {
  fxRate = fetchFXRate(reportedCurrency) ?? 1;
}

// Step 2: Financials werden geparst — ABER:
const revenue = parseNumber(String(incomeLatest.revenue ?? 0));
// PROBLEM: revenue ist in DKK (z.B. NVO: revenue = 232.3 Mrd DKK)
// fxRate = 0.146 (DKK/USD)
// Aber convertFinancials() wird NICHT auf alle Felder angewendet!

// Step 18: DCF mit rohen DKK-Werten:
dcfFairValue = (pvFCF + terminalValue - netDebt) / sharesOutstanding
// sharesOutstanding ist in Einzel-Aktien (korrekt)
// fcfTTM ist in DKK (FALSCH — müsste in USD sein)
// netDebt ist in DKK (FALSCH)
// Ergebnis: dcfFairValue in DKK/Aktie statt USD/Aktie
// Display: zeigt z.B. 1.847 DKK als wäre es $1.847 USD → 10x zu hoch
```

**Konkrete Zahlen NVO (FY2024):**
```
NVO reported in DKK:
  Revenue:      232.3 Mrd DKK
  FCF TTM:       ~95 Mrd DKK
  Net Debt:      ~30 Mrd DKK
  Shares:       ~4.46 Mrd (ADR-adjusted)

FX: DKK/USD = 0.1456 (Jan 2025)

Korrekter DCF Fair Value:
  FCF_USD = 95 Mrd DKK * 0.1456 = ~13.8 Mrd USD
  TV = FCF_USD * (1+0.025) / (0.085 - 0.025) / (1.085)^5 = ~168 Mrd USD
  Equity = PV_FCF + TV - NetDebt_USD = ~185 Mrd USD
  FairValue/Aktie = 185 Mrd / 4.46 Mrd = ~$41 USD
  (NVO ADR tatsächlicher Kurs: ~$67, also ca. 40% überbewertet laut DCF — plausibel)

Fehlerhafte Berechnung (aktuell):
  FCF = 95 Mrd DKK (nicht konvertiert)
  FairValue/Aktie = 95 Mrd / 4.46 Mrd = ~21 DKK = als $21 angezeigt (zu niedrig)
  ODER wenn shares in Tausend: = 95.000 / 4.460 = $21.300 (viel zu hoch)
  → Je nach shares-Normalisierungsfehler entweder 10x zu hoch oder 10x zu niedrig
```

**Korrekter Fix (convert ALLE Finanzfelder vor DCF):**

```ts
// Nach Step 2 FX-Fetch, vor Step 18 DCF:
const toUSD = (val: number) => val * fxRate;

// ALLE betroffenen Felder konvertieren:
const revenue_usd        = toUSD(revenue);
const fcfTTM_usd         = toUSD(fcfTTM);
const netDebt_usd        = toUSD(netDebt);
const ebitda_usd         = toUSD(ebitda);
const grossProfit_usd    = toUSD(grossProfit);
const operatingIncome_usd = toUSD(operatingIncome);
const netIncome_usd      = toUSD(netIncome);
const totalDebt_usd      = toUSD(totalDebt);
const cashEquivalents_usd = toUSD(cashEquivalents);

// sharesOutstanding: NICHT konvertieren (Anzahl, nicht Betrag)
// price: NICHT konvertieren (FMP liefert bei ADRs bereits USD-Preis)
// marketCap: NICHT konvertieren wenn aus quote.marketCap (bereits USD bei FMP)

// Margen neu berechnen mit USD-Werten:
const grossMargin = revenue_usd > 0 ? grossProfit_usd / revenue_usd * 100 : 0;
const fcfMargin   = revenue_usd > 0 ? fcfTTM_usd / revenue_usd * 100 : 0;

// DCF mit USD-Werten:
dcfFairValue = (pvFCF_usd + terminalValue_usd - netDebt_usd) / sharesOutstanding;
```

**Zusatz: CRV (Chancen-Risiko-Verhältnis) ebenfalls betroffen:**
```
CRV = (DCF Fair Value - Kurs) / (Kurs - Stop Loss)
Wenn DCF falsch → CRV falsch

Fix: CRV erst nach DCF-Korrektur berechnen
Zusätzlich: analystPTMedian von FMP kommt für ADRs in USD → direkt nutzbar
Für europäische Listings (ASML auf Euronext): analystPTMedian in EUR → auch konvertieren
```

**Betroffene Ticker (Beispiele):**
```
NVO   — Dänische Krone (DKK), ADR auf NYSE
ASML  — Euro (EUR), ADR auf NASDAQ
SAP   — Euro (EUR), ADR auf NYSE
NOVO  — DKK, primäres Listing Kopenhagen
SHEL  — USD gemeldet (kein Problem)
NVS   — CHF, ADR auf NYSE
ROG   — CHF, primäres Listing Zürich
```

**Fix-Plan:**
```
Branch: fix/non-usd-dcf-conversion

1. server/analyze-route.ts: nach fetchFXRate() —
   alle Betrag-Felder mit fxRate multiplizieren (revenue, fcf, netDebt, etc.)
   sharesOutstanding und price NICHT konvertieren

2. server/fmp.ts: convertFmpRowsToUsd() Funktion bereits vorhanden (Commit ce3b1bc)
   Prüfen ob sie vollständig alle Felder abdeckt und korrekt aufgerufen wird

3. Test mit NVO:
   Erwarteter DCF Fair Value: ~$35-55 USD/ADR (plausible Range)
   Wenn Ergebnis > $300 oder < $5 → Konvertierungsfehler noch vorhanden

4. Test mit ASML:
   FY2024 FCF: ~8.5 Mrd EUR, EUR/USD ~1.08
   Shares: ~394 Mio
   Erwarteter DCF: ~$100-160 USD (Markt: $680 → stark überbewertet laut DCF = plausibel)

5. shared/schema.ts: CurrencyInfo-Interface prüfen:
   { reportedCurrency, fxRate, isConverted }
   Auf jedem Analyse-Ergebnis ausgeben damit Frontend anzeigen kann:
   "Financials in DKK, umgerechnet mit 1 DKK = 0.146 USD"
```

---

# TEIL 3 — FMP-MIGRATION (P0-BLOCKER)

## Status: FMP-Integration unvollständig

Hauptentrpunkte laut analyze-route.ts (Commit 5a283e4, 16.07.2026):
- getFmpFallbackData() macht 13 parallele FMP-Calls: quote, profile, income,
  cashflow, balanceSheet, ohlcv, analyst.priceTarget, analyst.estimates,
  analyst.grades, segments, peers, ratios, keyMetrics
- fmpSegments: ruft /revenue-product-segmentation ab (nicht geo)
- fetchPeerComparisonFromTickers: vorhanden, aber Output kommt nicht im Frontend an

### Korrekte FMP-Request-Struktur

```ts
const FMP_BASE = 'https://financialmodelingprep.com/api/v3';

export async function fmpGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY nicht gesetzt');
  const url = new URL(`${FMP_BASE}${path}`);
  url.searchParams.set('apikey', key);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FMP ${path} HTTP ${res.status}`);
  const data = await res.json();
  if (data && typeof data === 'object' && 'Error Message' in data)
    throw new Error(`FMP: ${(data as any)['Error Message']}`);
  return data as T;
}
```

### Migrationsplan

| Schritt | Aufgabe | Branch |
|---|---|---|
| 1 | /api/fmp-budget im Frontend sichtbar machen | fix/fmp-debug-panel |
| 2 | Non-USD Konvertierung fix (BUG D) | fix/non-usd-dcf-conversion |
| 3 | Peer-Vergleich Section 7 fix (BUG B) | fix/peer-comparison-section7 |
| 4 | Revenue-Segmente Produkt + Geo (BUG C) | fix/revenue-segments-product-geo |
| 5 | Integration-Test: MSFT, AAPL, NVO, ASML | fix/integration-test |

---

# TEIL 4 — LANGFRISTIGE FEATURE-ROADMAP

Alle Items vorzubereiten, nicht sofort implementieren.
Jedes Feature = eigener Branch + PR + Review.

## Technische Grundregeln

- Neue Section: Eintrag in SECTIONS-Array + case im Section-Switch
- Neuer Endpunkt: eigene Datei in server/routes/ (max 80 KB)
- Formeln: unit-testbare Funktionen in client/src/lib/calculations.ts
- LLM-Search: POST /api/llm-search { query, ticker, context } → sonar-pro
- Anti-Truncation: jede Datei < 80 KB vor Push

---

## Stock Analysis Pro

### Aktienkurshistorie 10 Jahre (statt 5)

```ts
const from = dayjs().subtract(10, 'year').format('YYYY-MM-DD');
// FMP: /api/v3/historical-price-full/:ticker?from={from}&apikey={key}
```

Frontend:
```tsx
type TimeRange = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y";
const daysCutoff: Record<TimeRange, number> = {
  "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "3Y": 1095, "5Y": 1825, "10Y": 3650,
};
```

### Section 8 — WACC & Terminal Value individuell einstellbar

```tsx
const [wacc, setWacc] = useState(0.09);
const [g, setG] = useState(0.025);
// Gordon Growth: TV = FCF_last * (1+g) / (WACC - g)
// CAPM: Re = Rf + Beta*(Rm-Rf)
```

### PESTEL-Analyse [Section 14]

```ts
POST /api/pestel { ticker, company, sector }
// Output: { political, economic, social, tech, env, legal } je { drivers[], risks[] }
```
Sidebar: `{ id: 14, label: 'PESTEL', icon: Globe }`

### Reverse DCF [Section 15]

```
g* = impliziertes Wachstum aus aktuellem Kurs
g* >> historisch → Bewertung preist Perfektion ein
g* << historisch → Margin of Safety
POST /api/reverse-dcf { ticker, currentPrice, fcfHistory[5J], wacc, n }
```
Sidebar: `{ id: 15, label: 'Reverse DCF', icon: RefreshCw }`

### Monte Carlo — Flexible Iterationen 0–50.000

```tsx
type="text" inputMode="numeric" — onBlur: clamp(parseInt(input), 0, 50000)
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
// sonar-pro: Skandale, Klagen, SEC-Verfahren
// Output: { executives, earningsBeatRate, scandals, insiderOwnership, managementScore }
```

### ROIC / ROE / ROA — Jahresvergleich 3 Jahre

```
ROIC = EBIT * (1 - Tax) / (Equity + LongTermDebt - Cash)
FMP: /api/v3/key-metrics/:ticker?limit=3
Frontend: BarChart 3 Gruppen, Farbe: > WACC = grün, < WACC = rot
```

### Thesis Score

```
Thesis Score (0–100) =
  Moat Score        * 0.25
  FCF Marge 5J      * 0.20
  Fiskalstimulus    * 0.15
  Konjunktur-Trend  * 0.15
  Reputation Score  * 0.15
  Positive Events   * 0.10
```

### Bilanzen Red-Flag-Screener

```
Goodwill > 50% Total Assets
AR wächst schneller als Revenue (3J)
Operating CF < Net Income (2 von 3J)
Debt/Equity > 3x UND Zinsdeckung < 3x
Gross Margin Trend < -3 Pkt./J. über 3J
FCF negativ bei positivem Net Income
CapEx > 80% Operating CF
```

### Virtuelles Portfolio + Kelly-Formel

```
Kelly % = (p*b - q) / b
  p = Thesis Score / 100
  b = Upside/Downside aus DCF
Pabrai: max 10% pro Position
CAPM-Mindestrendite: Re = 4.5% + Beta*5.5%
Tracking: LocalStorage (V1)
```

---

## Rezessionsboard

### Google Trends — N/A fixen

```ts
// 1. Google Trends API
// 2. Fallback: Cache letzter Wert
// 3. Fallback: score=50 (neutral), Amber-Badge 'Daten veraltet'
```

### Makro-Risikobeurteilung — LLM

```ts
POST /api/recession-summary
sonar-pro: US-Rezessionswahrscheinlichkeit, Fed, Geopolitik, Anleihen
Output: { riskLevel: 'low'|'medium'|'high', summary, keyRisks[], sources[] }
```

### Sektor-Rotation

```
Relativbewertung = Sektor-KGV_aktuell / Sektor-KGV_10J_Mittel
FMP: /api/v3/sector_price_earning_ratio
Heatmap: 11 GICS-Sektoren
```

---

## BTC-Dashboard — Section 13 Miner-Zone

### Hash Ribbons
```
MA30 vs MA60 Hashrate
Kaufsignal: MA30 kreuzt MA60 von unten
Datenquelle: mempool.space /api/v1/mining/hashrate/3y
```

### Puell Multiple
```
Puell = Tagesemission_USD / MA365(Tagesemission_USD)
<0.5 Kapitulation | >4 überhitzt
```

### Hashprice + Breakeven
```
Hashprice = (144 * 3.125 * BTC-Preis) / Hashrate_TH
Breakeven: Slider Effizienz 18/21.5/30 J/TH, Strom $0.04/0.05/0.08
```

### MVRV
```
MVRV = Market Cap / Realized Cap
<1.0 Kapitulation | >3.5 überhitzt
Datenquelle: Glassnode free tier
```

---

## Gold-Dashboard (vorzubereiten)

```
Architektur:
  GoldDashboard.tsx (Shell)
  gold/GoldMacro.tsx   ← TIPS Realzins, DXY, ZB-Käufe
  gold/GoldMining.tsx  ← AISC, GDX/GLD-Ratio
  gold/GoldSummary.tsx ← Score

Kernindikatoren:
  Realzins (FRED DFII10): < 0% bullisch, > 1.5% bearisch
  Gold_FairValue ≈ 2000 - 800 * Realzins_%
  AISC: ~$1.200-1.400/oz (World Gold Council)
  GDX/GLD-Ratio: fallend = Margendruck
  DXY: inverse Korrelation ~-0.7

Gold-Score = Realzins*0.35 + DXY*0.20 + ZB*0.20 + AISC*0.15 + GDX*0.10
```

---

## Ideen-Pool

- [ ] Overview-Seite 2026 vor Ticker-Eingabe
- [ ] Einleitung: Aktien folgen zukünftigem Gewinnwachstum, nicht historischer Performance
- [ ] Makroanalyse: Inflation, Fed, Geopolitik, Deglobalisierung
- [ ] Megatrendanalyse: KI, Elektrifizierung, Eisenbahn, Rüstung
- [ ] Blasen/Rezessionsindikatoren: Shiller-KGV, Buffett-Indikator, Yield Curve
- [ ] Mindset-Typen: Value, Growth, Momentum
- [ ] Asset Price Inflation 2026: Kaufkrafterosion
