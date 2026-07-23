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

Shell-Gerüst:

```tsx
import { Section13Miner } from "./btc/Section13Miner";
import { Sections1to6 }   from "./btc/Sections1to6";
import { Sections7to12 }  from "./btc/Sections7to12";

export default function BTCDashboard() {
  const { data, isPending, mutate } = useMutation({ mutationFn: analyzeBTC });
  const { data: minerData, isLoading: minerLoading, isError: minerError } = useQuery({
    queryKey: ["btc-miner", data?.btcPrice],
    queryFn: () => fetch("/api/btc-miner").then(r => r.json()),
    enabled: !!data,
  });
  // Sidebar: SECTIONS ids 1–13, scrollToSection via sectionRefs
  // Main: switch(activeSection) { case 1..12: <Sections1to6/7to12> case 13: <Section13Miner> }
}
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

### Phase 3 — Section 13 Validierung [OFFEN]

| Check | Status |
|---|---|
| MetricCard, SectionCard | OK |
| bg-muted/20 rounded-lg border border-border p-4 | OK |
| grid-cols-2 sm:grid-cols-4 gap-3 | OK |
| tooltipStyle-Konstante | OK |
| Ampelfarben text-emerald-500/text-amber-400/text-red-500 | OK |
| Eingebunden in Parent BTCDashboard | FEHLT |

## Aufgabenliste Restore

| Priorität | Aufgabe | Zeit | Status |
|---|---|---|---|
| P0 | Branch btc-restore-modular von 33c8e77 | 2 min | DONE |
| P0 | export default function BTCDashboard rekonstruieren | 30 min | OFFEN |
| P1 | BTCDashboard in 4 Dateien aufsplitten | 20 min | OFFEN |
| P1 | Section13Miner in Shell einbinden (case 13) | 5 min | OFFEN |

## Workflow-Regeln

```bash
# Anti-Truncation: vor jedem Push prüfen
wc -c client/src/pages/BTCDashboard.tsx
# Wenn > 80000 Bytes → aufsplitten

# Lokale Validierung
npm run check
npm run dev
find client/src/pages/btc -name '*.tsx' | xargs wc -c

# Push-Workflow
git checkout -b fix/description
# entwickeln + testen
git push origin fix/description
# PR öffnen → Copilot-Review → Squash & Merge
# KEIN direkter push auf main
```

Doublecheck vor Merge:
- [ ] Keine zirkulären Imports
- [ ] export / export default konsistent
- [ ] tooltipStyle, MetricCard nicht doppelt definiert
- [ ] BTCAnalysis-Interface nur einmal (Shell oder btc/types.ts)
- [ ] SECTIONS-Array hat alle 13 Einträge
- [ ] sectionRefs deckt alle 13 IDs ab

## Bekannte gute Commits

| SHA | Beschreibung |
|---|---|
| 33c8e77 | HEAD main — Basis btc-restore-modular |
| 5bf8a2d | Section 13 vollständig (direkter Push) |
| bafff3c | PR #31 Squash — letzter valider Stand vor Truncation |

---

# TEIL 2 — FMP-MIGRATION (P0-BLOCKER für Aktienanalyse)

## Status: FMP-Integration unvollständig — Aktienanalyse funktioniert nicht

### Problem

Die FMP-API-Calls im Backend sind nicht korrekt implementiert.
Die Aktienanalyse liefert keine oder fehlerhafte Daten.
Das betrifft alle Sektionen, die auf FMP-Daten angewiesen sind.

### Betroffene Endpunkte (server/routes/)

| Endpunkt | FMP-Quelle | Status |
|---|---|---|
| GET /api/stock/:ticker | /api/v3/profile/:ticker | FEHLERHAFT |
| GET /api/stock/:ticker/history | /api/v3/historical-price-full/:ticker | FEHLERHAFT |
| GET /api/stock/:ticker/financials | /api/v3/income-statement/:ticker | FEHLERHAFT |
| GET /api/stock/:ticker/metrics | /api/v3/key-metrics/:ticker | FEHLERHAFT |
| GET /api/stock/:ticker/dcf | /api/v3/discounted-cash-flow/:ticker | FEHLERHAFT |
| GET /api/stock/:ticker/earnings | /api/v3/earnings-surprises/:ticker | FEHLERHAFT |

### Korrekte FMP-Request-Struktur

```ts
// Alle FMP-Calls folgen diesem Pattern:
const FMP_BASE = 'https://financialmodelingprep.com/api/v3';
const FMP_KEY  = process.env.FMP_API_KEY; // in .env, nie hardcoded

async function fmpGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${FMP_BASE}${path}`);
  url.searchParams.set('apikey', FMP_KEY!);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`FMP ${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// Beispiel Nutzung:
const profile = await fmpGet<FMPProfile[]>(`/profile/${ticker}`);
const history = await fmpGet<{ historical: FMPHistoricalPrice[] }>(
  `/historical-price-full/${ticker}`,
  { from: dayjs().subtract(10, 'year').format('YYYY-MM-DD') }
);
const income  = await fmpGet<FMPIncomeStatement[]>(`/income-statement/${ticker}`, { limit: '5' });
const metrics = await fmpGet<FMPKeyMetrics[]>(`/key-metrics/${ticker}`, { limit: '3' });
```

### Fehlerbehandlung + Fallback

```ts
// Jeder Route-Handler:
try {
  const data = await fmpGet(...);
  if (!data || (Array.isArray(data) && data.length === 0)) {
    return res.status(404).json({ error: 'Keine FMP-Daten für diesen Ticker' });
  }
  return res.json(data);
} catch (err) {
  console.error('[FMP]', err);
  return res.status(502).json({ error: 'FMP-API nicht erreichbar', detail: String(err) });
}
```

### Frontend-Rendering (StockDashboard.tsx)

```tsx
// React Query für jeden FMP-Endpunkt:
const { data: profile, isLoading, isError, error } = useQuery({
  queryKey: ['stock-profile', ticker],
  queryFn: () => fetch(`/api/stock/${ticker}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }),
  enabled: !!ticker && ticker.length > 0,
  retry: 2,
  staleTime: 5 * 60 * 1000, // 5 Minuten Cache
});

// Loading/Error-States in jeder Section:
if (isLoading) return <SectionCard number={N} title="..."><LoadingSpinner /></SectionCard>;
if (isError)   return <SectionCard number={N} title="..."><ErrorBanner message={error.message} /></SectionCard>;
if (!data)     return null;
```

### Sidebar + Section-Routing (StockDashboard.tsx)

```tsx
// SECTIONS-Array — jede Section hat id, label, icon
const SECTIONS = [
  { id: 1,  label: 'Übersicht',        icon: BarChart3   },
  { id: 2,  label: 'Finanzkennzahlen', icon: Calculator  },
  { id: 3,  label: 'Bilanz',           icon: Scale       },
  { id: 4,  label: 'Cashflow',         icon: TrendingUp  },
  { id: 5,  label: 'Bewertung (DCF)',  icon: Target      },
  { id: 6,  label: 'Technische Analyse', icon: LineChartIcon },
  { id: 7,  label: 'Gewinnwachstum',   icon: Activity    },
  { id: 8,  label: 'Risikoanalyse',    icon: AlertTriangle },
  { id: 9,  label: 'Equity Researcher', icon: Eye        },
  // neue Sektionen werden hier angehängt
];

// Sidebar rendert SECTIONS automatisch:
<nav>
  {SECTIONS.map(s => (
    <button key={s.id}
      className={activeSection === s.id ? 'bg-primary/20 text-primary' : 'text-muted-foreground'}
      onClick={() => scrollToSection(s.id)}
    >
      <s.icon className="w-4 h-4" />
      <span>{s.label}</span>
    </button>
  ))}
</nav>

// Main-Render-Switch:
const renderSection = (id: number) => {
  switch (id) {
    case 1: return <Section1Overview data={profile} />;
    case 2: return <Section2Financials data={income} />;
    // ...
    default: return null;
  }
};
```

### Server-Routing (server/routes/stock.ts)

```ts
import { Router } from 'express';
const router = Router();

// Alle Stock-Endpunkte in dieser Datei (max 80 KB)
// Größere Handler auslagern: server/routes/stock-dcf.ts etc.

router.get('/:ticker', async (req, res) => { ... });
router.get('/:ticker/history', async (req, res) => { ... });
router.get('/:ticker/financials', async (req, res) => { ... });
router.get('/:ticker/metrics', async (req, res) => { ... });

export default router;

// In server/index.ts:
// import stockRouter from './routes/stock';
// app.use('/api/stock', stockRouter);
```

### Migrationsplan FMP

| Schritt | Aufgabe | Branch |
|---|---|---|
| 1 | fmpGet Helper + .env FMP_API_KEY prüfen | fix/fmp-helper |
| 2 | /api/stock/:ticker profile + history 10J | fix/fmp-profile |
| 3 | /api/stock/:ticker/financials income + balance | fix/fmp-financials |
| 4 | /api/stock/:ticker/metrics key-metrics + ratios | fix/fmp-metrics |
| 5 | /api/stock/:ticker/dcf | fix/fmp-dcf |
| 6 | Frontend React Query + Loading/Error States | fix/fmp-frontend |
| 7 | Integration-Test: 5 Ticker durchlaufen lassen | fix/fmp-test |

---

# TEIL 3 — LANGFRISTIGE FEATURE-ROADMAP

Alle Items vorzubereiten, nicht sofort implementieren.
Jedes Feature = eigener Branch + PR + Review.

## Technische Grundregeln (für alle neuen Features)

- Neue Section: Eintrag in SECTIONS-Array + case im Section-Switch (StockDashboard.tsx)
- Neuer Endpunkt: eigene Datei in server/routes/ (max 80 KB)
- Express-Registrierung: `app.use('/api/endpunkt', router)` in server/index.ts
- Formeln: unit-testbare Funktionen in client/src/lib/calculations.ts
- LLM-Search: POST /api/llm-search { query, ticker, context } → sonar-pro
- Anti-Truncation: jede Datei < 80 KB vor Push

---

## Stock Analysis Pro

### Aktienkurshistorie 10 Jahre (statt 5)

Backend:
```ts
const from = dayjs().subtract(10, 'year').format('YYYY-MM-DD');
// GET /api/v3/historical-price-full/:ticker?from={from}&apikey={key}
```

Frontend (TechnicalChart):
```tsx
type TimeRange = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y";
const daysCutoff: Record<TimeRange, number> = {
  "3M": 90, "6M": 180, "1Y": 365, "2Y": 730, "3Y": 1095, "5Y": 1825, "10Y": 3650,
};
```

---

### Section 8 — WACC & Terminal Value individuell einstellbar

```tsx
const [wacc, setWacc] = useState(0.09);
const [g, setG] = useState(0.025);

// Gordon Growth: TV = FCF_last * (1+g) / (WACC - g)
// WACC = (E/V)*Re + (D/V)*Rd*(1-Tax)
// CAPM: Re = Rf + Beta*(Rm-Rf)
```

LLM-Search für unternehmensspezifische Risiken:
```ts
POST /api/llm-search
{ query: `Risiken ${ticker}: Regulierung, Wettbewerb, Bilanzschwächen`,
  model: 'sonar-pro', search_recency_filter: 'month' }
// Response: { risks: string[], sources: string[] }
```

---

### PESTEL-Analyse [Section 14]

```ts
// POST /api/pestel { ticker, company, sector }
// sonar-pro Query: PESTEL ${company} Kurstreiber Risiken 2026
// Output: { political, economic, social, tech, env, legal } je { drivers[], risks[] }
```
Sidebar: `{ id: 14, label: 'PESTEL', icon: Globe }`

---

### Reverse DCF [Section 15]

```
Reverse DCF: Löse g* aus P = Σ FCFt/(1+WACC)^t + TV/(1+WACC)^N
g* = impliziertes Wachstum im aktuellen Kurs

g* >> historisches Wachstum  → Bewertung einpreist Perfektion
g* ≈ historisches Wachstum   → faire Bewertung
g* << historisches Wachstum  → Margin of Safety

POST /api/reverse-dcf { ticker, currentPrice, fcfHistory[5J], wacc, n }
Output: { impliedGrowthRate, vsHistoricalGrowth, marginOfSafety, sensitivityTable }
```
Frontend: Slider WACC 4–15%, N 5/7/10J, Heatmap-Sensitivitätstabelle.
Sidebar: `{ id: 15, label: 'Reverse DCF', icon: RefreshCw }`

---

### Monte Carlo — Flexible Iterationen 0–50.000

```tsx
// Freies Texteingabefeld, commit-on-blur
const [iterInput, setIterInput] = useState('10000');
onBlur: clamp(parseInt(input), 0, 50000)
// Warnung bei > 30k: "Performance-Warnung: kann Browser verlangsamen"
```

---

### Section 17 — Zusammenfassungstabelle

Komprimierte Tabelle aller Sektionen:

| Metrik | Wert | Bewertung | Quelle |
|---|---|---|---|
| Aktienkurs | $xxx | — | FMP |
| KGV | xx.x | Neutral | FMP |
| DCF Fair Value | $xxx | Unterbewertet | Berechnet |
| Reverse DCF g* | x.x% | Hoch | Berechnet |
| PESTEL-Risiko | Mittel | — | LLM |
| Management Score | xx/100 | — | LLM+FMP |
| Thesis Score | xx/100 | — | Komposit |

Farb-Badges: Unterbewertet/Neutral/Überbewertet. CSV-Export.
Sidebar: `{ id: 17, label: 'Zusammenfassung', icon: Table }`

---

### Management-Analyse (Buffett-Kriterien)

```ts
// POST /api/management { ticker }
// FMP: /api/v3/key-executives/:ticker → CEO, Tenure, Compensation
// FMP: /api/v3/earnings-surprises/:ticker → Beat/Miss-Rate 5J
// sonar-pro: Skandale, Klagen, SEC-Verfahren
// Output: { executives, earningsBeatRate, scandals, insiderOwnership, managementScore }

Kriterien:
  Zukunftsorientierung: Guidance-Qualität, Kapitalallokation-Konsistenz
  Verlässlichkeit:      Beat/Miss-Rate letzte 5 Jahre
  Skandale:             LLM-Search (SEC, Klagen, Bilanzskandale)
  Insider-Ownership:    % Anteil (FMP key-executives)
```

---

### ROIC / ROE / ROA — Jahresvergleich 3 Jahre

```
ROIC = EBIT * (1 - Tax) / (Equity + LongTermDebt - Cash)
ROE  = Net Income / Shareholders' Equity
ROA  = Net Income / Total Assets

Datenquelle: FMP /api/v3/key-metrics/:ticker?limit=3
Frontend: BarChart 3 Gruppen, Farbe > WACC = grün, < WACC = rot
```

---

### Thesis Score

```
Thesis Score (0–100) =
  Moat Score        * 0.25  (Wide=100, Narrow=60, None=20)
  FCF Marge 5J      * 0.20  (>15% = 100, linear)
  Fiskalstimulus    * 0.15  (Infrastruktur, Defense, Re-Industrialisierung)
  Konjunktur-Trend  * 0.15  (Sektorzyklus Early/Mid/Late/Recession)
  Reputation Score  * 0.15  (Management + Analyst-Trust)
  Positive Events   * 0.10  (LLM: Verträge, Patente, Expansionen)
```

---

### Bilanzen Red-Flag-Screener

```
Automatische Checks:
  Goodwill > 50% Total Assets
  Accounts Receivable wächst schneller als Revenue (3J)
  Operating CF < Net Income (2 von 3 Jahren)
  Debt/Equity > 3x UND Zinsdeckung < 3x
  Gross Margin Trend < -3 Prozentpunkte p.a. über 3J
  Freier Cashflow negativ bei positivem Net Income
  CapEx > 80% Operating CF

Frontend: Checkliste FAIL/WARN/PASS mit Erklärungstext
```

---

### Virtuelles Portfolio + Kelly-Formel

```
Kelly % = (p*b - q) / b
  p = Gewinnwahrscheinlichkeit (Thesis Score / 100)
  q = 1 - p
  b = Upside/Downside aus DCF

Pabrai-Regel: max 10% Kelly pro Position
CAPM-Mindestrendite: Re = Rf + Beta*(Rm-Rf) = 4.5% + Beta*5.5%
Investieren nur wenn erwartete Rendite > Re

Tracking: LocalStorage (V1, keine DB nötig)
Frontend: Kelly-Allocation BarChart
```

---

## Rezessionsboard

### Google Trends Score — N/A fixen

```ts
// server/routes/recession.ts
// 1. Google Trends API (SerpAPI oder Pytrends)
// 2. Fallback: Cache letzter erfolgreicher Wert
// 3. Fallback: score = 50 (neutral), Badge "Daten veraltet"
```

### Makro-Risikobeurteilung — LLM-Modus

```ts
POST /api/recession-summary
sonar-pro Query: US-Rezessionswahrscheinlichkeit, Fed-Politik,
  Geopolitik (Hormuz, Ukraine), Kapitalmarktzinsen, Anleihenmärkte
Output: { riskLevel: 'low'|'medium'|'high', summary, keyRisks[], sources[] }
```

### Sektor-Rotation — Über-/Unterbewertet

```
Relativbewertung = Sektor-KGV_aktuell / Sektor-KGV_10J_Mittel
> 1.2 → überbewertet
< 0.8 → unterbewertet

Datenquelle: FMP /api/v3/sector_price_earning_ratio
Frontend: Heatmap-Tabelle 11 GICS-Sektoren
```

---

## BTC-Dashboard — Langfristige Features

### Miner-Zone Section 13 — vollständige Indikatoren

#### Hash Ribbons

```
MA30 vs MA60 der Netzwerk-Hashrate
Kapitulation:  MA30 < MA60 und beide fallend
Kaufsignal:    MA30 kreuzt MA60 von unten (nach Kapitulation)
Datenquelle:   mempool.space /api/v1/mining/hashrate/3y
Frontend:      AreaChart MA30 (blau) / MA60 (rot), ReferenceArea rot bei Kapitulation
```

#### Puell Multiple

```
Puell = Tagesemission_USD / MA365(Tagesemission_USD)
Tagesemission = 144 Blöcke * 3.125 BTC * BTC-Preis
Zonen: <0.5 Kapitulation | 0.5-1 normal | 1-4 bullish | >4 überhitzt
Datenquelle: CoinGecko Preishistorie + feste Blocksubvention
```

#### Hashprice

```
Hashprice = (144 * 3.125 * BTC-Preis + Fees_tägl.) / Hashrate_TH
Breakeven = Stromkosten_kWh * Effizienz_J_per_TH * 86400 / Hashprice
Referenz:  Antminer S19 Pro 29.5 J/TH, $0.05/kWh
Frontend-Slider: Effizienz 18/21.5/30 J/TH, Strompreis 0.04/0.05/0.08/manuell
```

#### Difficulty Ribbon Compression

```
MAs: 9, 14, 25, 40, 60, 90, 128, 200 Tage
Compression Score = 1 - (Spread der MAs / MA200)
>0.9 = starke Kompression (Einstiegszone)
Datenquelle: mempool.space /api/v1/mining/difficulty-adjustments
```

#### MVRV / Realized Price

```
MVRV = Market Cap / Realized Cap
<1.0 → unter Realized Price (Kapitulationszone)
>3.5 → historisch überhitzt
Datenquelle: Glassnode free tier
```

#### Section 13 Props + Server-Route

```ts
// server/btc-miner.ts (bereits vorhanden)
type MinerData = {
  hashRate: number;
  hashRateMAs: { ma30: number; ma60: number };
  puellMultiple: number;
  puellHistory: { date: string; value: number }[];
  hashprice: number;
  breakevenPrice: number;
  difficultyRibbonScore: number;
  mvrvRatio: number;
  realizedPrice: number;
  minerScore: number;  // 0-100 Komposit
};

// Section13Miner Props:
// data: BTCAnalysis, minerData: MinerData|null, loading: boolean, error: boolean
```

Backend-Checklist:
- [ ] Hash Ribbons MA30/MA60 aus Hashrate-History
- [ ] Puell Multiple aus CoinGecko + Blocksubvention
- [ ] Hashprice aus Hashrate + BTC-Preis
- [ ] Breakeven-Slider-Presets
- [ ] Difficulty Ribbon Compression Score
- [ ] MVRV via Glassnode free tier

---

## Gold-Dashboard (neu, vorzubereiten)

### Architektur

```
client/src/pages/GoldDashboard.tsx  ← Shell (~200 Zeilen)
client/src/pages/gold/
  GoldMacro.tsx    ← Realzins, DXY, Zentralbank-Käufe
  GoldMining.tsx   ← AISC-Kostenkurve, GDX/GLD-Ratio
  GoldSummary.tsx  ← Score, Zusammenfassung
server/routes/gold.ts
```

### Indikatoren

#### AISC (All-In Sustaining Cost)

```
AISC = Förderkosten + Exploration-CapEx + G&A + Sustaining-Invest.  [USD/oz]
Markt-Durchschnitt: ~$1.200–1.400/oz
Spot < AISC → marginale Minen unrentabel → Angebotsreduktion
Datenquelle: World Gold Council (quartalsweise)
```

#### Realzins-Modell (10Y TIPS)

```
Realzins = 10J-Nominalrendite - 10Y-Breakeven-Inflation
Realzins < 0%   → Gold bullisch
Realzins > 1.5% → Gold bearisch

Regressionsformel (historisch robust):
Gold_FairValue ≈ 2000 - 800 * Realzins_Prozent

Datenquelle: FRED API (kostenlos)
  Realzins:   series DFII10
  Breakeven:  series T10YIE
```

#### GDX/GLD-Ratio

```
Ratio = GDX_Preis / GLD_Preis
Fallend  → Margendruck bei Minern
Steigend → Miner profitieren überproportional
Datenquelle: Yahoo Finance
```

#### DXY-Korrelation

```
Inverse Korrelation Gold/DXY ~-0.7
DXY < 100 → schwacher USD → bullisch für Gold
DXY > 105 → starker USD → bearisch
Datenquelle: Yahoo Finance (DX-Y.NYB)
```

#### Gold/Silber-Ratio

```
> 80 → Silber relativ günstig, Mean-Reversion historisch wahrscheinlich
< 50 → Risk-On-Umfeld
Datenquelle: Yahoo Finance (GC=F, SI=F)
```

#### Gold-Score (0–100)

```
Realzins-Score   * 0.35
DXY-Score        * 0.20
ZB-Käufe-Score   * 0.20
AISC-Score       * 0.15
GDX/GLD-Score    * 0.10
```

### Routing

```tsx
// App.tsx:
<Route path="/gold" component={GoldDashboard} />
// Header-Nav: <button onClick={() => setLocation('/gold')}>Gold</button>
```

---

## Ideen-Pool

- [ ] Overview-Seite 2026 vor Ticker-Eingabe
- [ ] Einleitung: Aktien folgen zukünftigem Gewinnwachstum, nicht historischer Performance
- [ ] Makroanalyse-Sektion: Inflation, Fed, Kapitalmarktzinsen, Geopolitik, Deglobalisierung
- [ ] Megatrendanalyse: Value Chain KI, Elektrifizierung, Eisenbahn, Rüstung
- [ ] Blasen- und Rezessionsindikatoren: Shiller-KGV, Buffett-Indikator, Yield Curve
- [ ] Mindset-Typen: Value, Growth, Momentum
- [ ] ETF + Core-Satellite: nur bei Informationsvorteil in Einzelaktien
- [ ] Asset Price Inflation 2026: Kaufkrafterosion, Debt-Inflation-Mechanismus
