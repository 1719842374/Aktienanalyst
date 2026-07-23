# WORK.md — BTC Dashboard Restore Plan & Langfristige Feature-Roadmap

> Erstellt: 23.07.2026 | Branch: `btc-restore-modular` (live, von `33c8e77`)
> **Regel: Kein Code-Push über GitHub API bis Plan vollständig lokal validiert.**

---

## 🔴 Diagnose — Was genau fehlt in `BTCDashboard.tsx`

Der GitHub API-Fetch bricht immer am selben Punkt ab — mitten in `Section2Halving` nach
`text-muted-fo`. Das bedeutet:

- **Sections 3–12** + der komplette `export default function BTCDashboard`
  (State-Management, Sidebar, useQuery für Miner, Main-Render-Loop) existieren in `main` **nicht mehr produktiv**.
- **Section 13** (`Section13Miner`) ist vorhanden, aber **nie eingebunden**,
  weil der Parent-Render fehlt.
- **Root cause:** Datei >100 KB Base64 → GitHub API trunciert. Identischer Bug wie bei `routes.ts`.

---

## 📋 Restore-Plan — 3 Phasen

### Phase 1 — Schadensbegrenzung ✅ (erledigt)

```bash
# Branch btc-restore-modular wurde von 33c8e77 (HEAD main) erstellt
git checkout -b btc-restore bafff3c
```

**Status:** Branch `btc-restore-modular` ist live auf GitHub.

---

### Phase 2 — BTCDashboard.tsx modular aufsplitten 🔲 (nächster Schritt, lokal)

#### Ziel-Dateistruktur

```
client/src/pages/
├── BTCDashboard.tsx          ← Shell + export default (~200 Zeilen)
└── btc/
    ├── Section13Miner.tsx    ← Puell, Hash Ribbons, Breakeven, Miner Score
    ├── Sections1to6.tsx      ← Status, Halving, Indikatoren, Power-Law, GWS, Monte Carlo
    └── Sections7to12.tsx     ← Kategorien, Zyklus, Finale Schätzung, TA, Fear&Greed, Fazit
```

#### BTCDashboard.tsx Shell

```tsx
import { Section13Miner }  from "./btc/Section13Miner";
import { Sections1to6 }    from "./btc/Sections1to6";
import { Sections7to12 }   from "./btc/Sections7to12";

export default function BTCDashboard() {
  const { data, isPending, mutate } = useMutation({ mutationFn: analyzeBTC });
  const { data: minerData, isLoading: minerLoading, isError: minerError } = useQuery({
    queryKey: ["btc-miner", data?.btcPrice],
    queryFn: () => fetch("/api/btc-miner").then(r => r.json()),
    enabled: !!data,
  });
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar: SECTIONS-Array mit ids 1–13, scrollToSection(id) über sectionRefs */}
      {/* Main: switch(activeSection) { case 1: ... case 13: return <Section13Miner .../> } */}
    </div>
  );
}
```

#### Kritische Fix-Zeile

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

---

### Phase 3 — Section 13 Validierung 🔲

| Check | Status |
|---|---|
| `MetricCard`, `SectionCard` | ✅ |
| `bg-muted/20 rounded-lg border border-border p-4` | ✅ |
| `grid-cols-2 sm:grid-cols-4 gap-3` | ✅ |
| `tooltipStyle`-Konstante | ✅ |
| Ampelfarben `text-emerald-500/text-amber-400/text-red-500` | ✅ |
| **Eingebunden in Parent `BTCDashboard`** | ❌ fehlt |

---

## ✅ Priorisierte Aufgabenliste (Restore)

| Priorität | Aufgabe | Zeit | Status |
|---|---|---|---|
| **P0** | Branch `btc-restore-modular` von `33c8e77` | 2 min | ✅ Done |
| **P0** | `export default function BTCDashboard` rekonstruieren | 30 min | 🔲 offen |
| **P1** | BTCDashboard in 4 Dateien aufsplitten | 20 min | 🔲 offen |
| **P1** | `Section13Miner` in Shell einbinden (`case 13`) | 5 min | 🔲 offen |
| **P2** | FMP-Migration Aktien-Dashboard | separat | 🔲 offen |

---

## 🔁 Follow-up Workflow-Regeln

### FU-1 — PR-Workflow & Squash-Merge

```
1. git checkout -b fix/description
2. Lokal entwickeln + npm run dev testen
3. git push origin fix/description
4. PR öffnen → Copilot-Review → Squash & Merge
   KEIN direkter push auf main
```

### FU-2 — Anti-Truncation Protokoll

```bash
wc -c client/src/pages/BTCDashboard.tsx
# Wenn > 80000 Bytes → aufsplitten vor Push
```

### FU-3 — Doublecheck-Checkliste vor Merge

- [ ] Alle Imports korrekt (keine zirkulären Dependencies)
- [ ] `export` / `export default` konsistent
- [ ] `tooltipStyle`, `MetricCard` nicht doppelt definiert
- [ ] `BTCAnalysis`-Interface nur einmal (Shell oder `btc/types.ts`)
- [ ] Section 13 Props korrekt übergeben
- [ ] `SECTIONS`-Array enthält alle 13 Einträge
- [ ] `sectionRefs` deckt alle 13 IDs ab

### FU-4 — Lokale Validierung

```bash
npm run check          # TypeScript-Fehler
npm run dev            # Sections 1–13 manuell durchklicken
find client/src/pages/btc -name '*.tsx' | xargs wc -c  # jede < 80 KB
```

---

## 🗂 Bekannte gute Commits

| SHA | Beschreibung |
|---|---|
| `33c8e77` | HEAD main — Basis btc-restore-modular |
| `5bf8a2d` | Section 13 vollständig (direkter Push) |
| `bafff3c` | PR #31 Squash — letzter valider Stand vor Truncation |

---

---

# 📋 LANGFRISTIGE FEATURE-ROADMAP

> Alle Items sind **vorzubereiten, nicht sofort zu implementieren**.
> Jedes Feature = eigener Branch + PR + Review.

---

## 📈 Stock Analysis Pro — Aktiendashboard

### Technische Grundregeln (gelten für alle Features)

- **Routing:** Jede neue Sektion erhält eine eigene `id` im `SECTIONS`-Array
  (`client/src/pages/StockDashboard.tsx`) und einen `case` im Section-Switch.
- **Backend:** Neue API-Endpunkte in `server/routes/` als eigene Datei
  (Anti-Truncation, max 80 KB). Express-Route: `router.post('/api/endpoint', handler)`.
- **Frontend-Sidebar:** Sidebar liest `SECTIONS`-Array automatisch —
  neuen Eintrag `{ id: N, label: '...', icon: IconName }` hinzufügen.
- **Formeln:** Alle Rechenformeln als unit-testbare Funktionen in `client/src/lib/calculations.ts`.
- **LLM-Search:** Perplexity `sonar-pro`-Modell via `/api/llm-search` POST
  `{ query, ticker, context }` → strukturiertes JSON-Response.

---

### ✅ Aktienkurshistorie: 10 Jahre (statt 5)

**Status:** ❌ Aktuell nur 5 Jahre.

**Backend-Fix (`server/routes/stock.ts`):**
```ts
// Zeitraum-Parameter in FMP-Request:
const from = dayjs().subtract(10, 'year').format('YYYY-MM-DD');
const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${ticker}?from=${from}&apikey=${FMP_KEY}`;
```

**Frontend-Fix (TechnicalChart-Komponente):**
```tsx
// TimeRange-Enum erweitern:
type TimeRange = "3M" | "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y";
const daysCutoff: Record<TimeRange, number> = {
  "3M": 90, "6M": 180, "1Y": 365, "2Y": 730,
  "3Y": 1095, "5Y": 1825, "10Y": 3650,  // NEU
};
// Button-Reihe:
{(["3M","6M","1Y","2Y","3Y","5Y","10Y"] as const).map(r => ...)}
```

**Sidebar:** Kein Änderungsbedarf — betrifft nur Chart-Komponente in Section 10.

---

### ✅ Equity Researcher
**Status:** ✅ Implementiert.

---

### ✅ Section 8 — Inversionsrisiko + LLM Search (unternehmensspezifisch)
**Status:** ✅ Implementiert.

**Offene Erweiterung — WACC & Terminal Value individuell einstellbar:**

```tsx
// Editierbare Parameter-Panel in Section 8:
const [wacc, setWacc] = useState(0.09);          // Default 9%
const [terminalGrowth, setTerminalGrowth] = useState(0.025); // Gordon Growth g

// Gordon Growth Model:
// Terminal Value = FCF_letztes_Jahr × (1 + g) / (WACC - g)
const terminalValue = fcfLastYear * (1 + terminalGrowth) / (wacc - terminalGrowth);

// WACC-Formel (CAPM-basiert):
// WACC = (E/V) × Re + (D/V) × Rd × (1 - Tax)
// Re = Rf + Beta × (Rm - Rf)  [CAPM]
```

**LLM-Search-Integration:**
```ts
// Backend: POST /api/llm-search
{ query: `Unternehmensspezifische Risiken ${ticker}: Regulierung, Wettbewerb, Bilanzschwächen`,
  model: 'sonar-pro', search_recency_filter: 'month' }
// Response: { risks: string[], sources: string[] }
```

**Sidebar:** Section 8 bereits vorhanden — Panel als Accordion in bestehende SectionCard einfügen.

---

### 🔲 PESTEL-Analyse — Kurstreiber & Risiken (LLM + Standard)

**Neue Section (z.B. Section 8b oder Section 14a).**

**Backend (`server/routes/pestel.ts`):**
```ts
// POST /api/pestel
// Input: { ticker, company, sector }
// Perplexity sonar-pro Query:
const query = `PESTEL-Analyse ${company} (${ticker}): Politisch, Ökonomisch, Sozial,
  Technologisch, Ökologisch, Legal. Kurstreiber und Risiken 2025-2026.`;
// Output-Schema:
{
  political: { drivers: string[], risks: string[] },
  economic:  { drivers: string[], risks: string[] },
  social:    { drivers: string[], risks: string[] },
  tech:      { drivers: string[], risks: string[] },
  env:       { drivers: string[], risks: string[] },
  legal:     { drivers: string[], risks: string[] },
  sources:   string[]
}
```

**Frontend:** Accordion-Karten pro PESTEL-Buchstabe,
ampelfarben (grün = Treiber, rot = Risiko), LLM-Badge mit Quell-Links.

**Sidebar:** `{ id: 14, label: '🌐 PESTEL', icon: Globe }` in SECTIONS.

---

### 🔲 Section 14 — Reverse DCF

**Konzept:** Statt einen fairen Wert aus Annahmen zu berechnen,
beantwortet Reverse DCF: *Welches Wachstum ist im aktuellen Kurs eingepreist?*

**Formel:**
```
Reverse DCF:
Gegebener Kurs P = Σ(FCFt / (1+WACC)^t) + TV / (1+WACC)^N

Löse nach implizitem FCF-Wachstum g* auf:
g* = WACC - FCF_1 / (P - PV_explizite_Jahre)

Interpretation:
- g* >> historisches Wachstum → Markt preist Perfektion ein (Risiko hoch)
- g* ≈ historisches Wachstum → faire Bewertung
- g* << historisches Wachstum → Margin of Safety vorhanden
```

**Backend (`server/routes/reverseDCF.ts`):**
```ts
// POST /api/reverse-dcf
// Input: { ticker, currentPrice, fcfHistory[5J], wacc, terminalGrowth, n }
// Output: { impliedGrowthRate, vsHistoricalGrowth, marginOfSafety, sensitivityTable }
```

**Frontend:** Slider für WACC (4–15%) und N (5/7/10 Jahre),
Sensitivitätstabelle (WACC × g* Matrix, heatmap-style).

**Sidebar:** `{ id: 15, label: '🔄 Reverse DCF', icon: RefreshCw }`.

---

### 🔲 Monte Carlo — Flexible Iterationen 0–50.000

**Problem:** Aktuell hardcodierte Zwischenwerte (1k, 5k, 10k, 50k).

**Fix (analog zu BTCDashboard Section 6 — bereits implementiertes Pattern):**
```tsx
// Freies Texteingabefeld mit Commit-on-blur:
const [iterInput, setIterInput] = useState('10000');
const [iterations, setIterations] = useState(10000);

<input
  type="text" inputMode="numeric"
  value={iterInput}
  onChange={e => setIterInput(e.target.value.replace(/[^0-9]/g, ''))}
  onBlur={() => {
    const v = parseInt(iterInput, 10);
    const valid = !isNaN(v) && v >= 0 && v <= 50000 ? v : iterations;
    setIterations(valid);
    setIterInput(String(valid));
  }}
/>
// Range: 0–50.000 | Default: 10.000 | Warnung bei > 30k (Performance)
```

---

### 🔲 Section 17 — Zusammenfassungstabelle

**Konzept:** Eine einzige Tabelle, die alle Sektionen komprimiert
(analog zu einem Research-Report Executive Summary).

**Struktur:**
```
| Metrik              | Wert       | Bewertung | Quelle     |
|---------------------|------------|-----------|------------|
| Aktienkurs          | $xxx       | —         | FMP        |
| KGV                 | xx.x       | 🟡 Neutral | FMP        |
| DCF Fair Value      | $xxx       | 🟢 Unterb. | Berechnet  |
| Reverse DCF g*      | x.x%       | 🔴 Hoch    | Berechnet  |
| GWS Score           | x.xxx      | 🟢 Bull.   | Modell     |
| PESTEL-Risiko       | Mittel     | 🟡         | LLM        |
| Miner Score (BTC)   | xx/100     | 🟢         | mempool    |
| Management Score    | xx/100     | 🟢         | LLM        |
| Thesis Score        | xx/100     | 🟢         | Komposit   |
```

**Frontend:** Farbcodierung 🟢/🟡/🔴 als Badge-Komponente,
exportierbar als CSV.

**Sidebar:** `{ id: 17, label: '📋 Zusammenfassung', icon: Table }`.

---

### 🔲 Management-Analyse (Warren-Buffett-Kriterien)

**Kriterien nach Buffett:**
```
1. Zukunftsorientierung: Guidance-Qualität, Kapitalallokation-Konsistenz
2. Verlässlichkeit:     Earnings-Überraschungen (Beat/Miss-Historie, 5J)
3. Skandale:            LLM-Search nach Klagen, SEC-Verfahren, Bilanzskandale
4. Reputation:          Glassdoor-Score, Analysten-Vertrauen
5. Know-how:            CEO-Tenure, Bran chenkenntnisse, Insider-Ownership %
```

**Backend (`server/routes/management.ts`):**
```ts
// POST /api/management
// FMP: /api/v3/key-executives/{ticker} → CEO, Tenure, Compensation
// Perplexity sonar-pro: Skandale, Klagen, Reputation-Check
// FMP: /api/v3/earnings-surprises/{ticker} → Beat/Miss-Historie
// Output-Schema:
{
  executives: [{ name, title, tenure, compensation }],
  earningsBeatRate: number,      // % beats letzte 5J
  scandals: string[],            // LLM-Ergebnisse
  insiderOwnership: number,      // % Insider-Anteil
  managementScore: number,       // 0-100 komposit
}
```

---

### 🔲 ROI / ROIC — Jahresvergleich 3 Jahre

**Formeln:**
```
ROIC = NOPAT / Invested Capital
     = EBIT × (1 - Tax) / (Equity + LongTermDebt - Cash)

ROE  = Net Income / Shareholders' Equity
ROA  = Net Income / Total Assets

// 3-Jahres-Trend: Balkendiagramm (BarChart) mit 3 Gruppen
// Farben: > WACC = grün, < WACC = rot
```

**Backend:** FMP `/api/v3/key-metrics/{ticker}?limit=3` liefert ROIC, ROE, ROA direkt.

---

### 🔲 Thesis Score — Kombiniert (Moat + Fiskalstimulus + FCF + Trend)

**Scoring-Formel:**
```
Thesis Score (0–100) =
  Moat Score          × 0.25  (Preissetzungsmacht, Netzwerkeffekt, Wechselkosten)
  + FCF Marge 5J     × 0.20  (> 15% = Vollpunkte, linear skaliert)
  + Fiskalstimulus   × 0.15  (Infrastruktur, Re-Industrialisierung, Defense)
  + Trend Konjunktur × 0.15  (Sektorzyklus: Early/Mid/Late/Recession)
  + Reputation Score × 0.15  (Management + Kunden + Analyst-Trust)
  + Positive Events  × 0.10  (LLM-Search: Verträge, Patente, Expansionen)

Moat-Kategorien (nach Morningstar):
  Wide Moat = 100, Narrow Moat = 60, No Moat = 20
```

---

### 🔲 Bilanzen-Screener — Red Flags & Unstimmigkeiten

**Automatische Red-Flag-Checks:**
```
❌ Goodwill > 50% Total Assets
❌ Accounts Receivable wächst schneller als Revenue (3J)
❌ Operating CF < Net Income (2 von 3 Jahren)
❌ Debt/Equity > 3x UND Zinsdeckung < 3x
❌ Gross Margin Trend: -3 Prozentpunkte p.a. über 3J
❌ Negative Free Cash Flow bei positivem Net Income
❌ CapEx > 80% Operating CF (Kapitalfalle)
```

**Frontend:** Checkliste mit ❌/⚠/✅ Badges, Erklärungstext per Flag.

---

### 🔲 Virtuelles Portfolio + Kelly-Formel (Mohnish Pabrai + CAPM)

**Kelly-Formel (adaptiert für Aktien):**
```
Kelly % = (p × b - q) / b
  p = Gewinnwahrscheinlichkeit (aus Thesis Score / 100)
  q = 1 - p (Verlustwahrscheinlichkeit)
  b = Gewinn/Verlust-Ratio (z.B. Upside/Downside aus DCF)

Pabrai-Regel: Niemals > 10% Kelly in eine Position
              „Concentrated but not reckless“

CAPM-Mindestrendite:
  Re = Rf + Beta × (Rm - Rf)
  = 4.5% + Beta × 5.5% (Markt-ERP)
  Investieren nur wenn erwartete Rendite > Re
```

**Portfolio-Tracking:** LocalStorage-basiert (keine DB nötig für V1),
Kelly-Allocation als Balkendiagramm.

---

## 📊 Rezessionsboard

### 🔲 Google Trends Score — N/A fixen

**Problem:** Google Trends API liefert `N/A` bei Quota-Limit oder ändertem Keyword.

**Fix-Strategie:**
```ts
// server/routes/recession.ts
// 1. Primär: Google Trends API (Pytrends oder SerpAPI)
// 2. Fallback: Cache-Wert vom letzten erfolgreichen Request
// 3. Fallback 2: Fixed Score = 50 (neutral) mit Hinweis "Daten veraltet"
// Fehleranzeige im Frontend: Amber-Badge "Keine Live-Daten"
```

### 🔲 Fazit Makro-Risikobeurteilung — KI-Modus + LLM Search

```ts
// POST /api/recession-summary
// Perplexity sonar-pro Query:
const query = `Aktuelles Makro-Risikobild ${new Date().toISOString().slice(0,7)}:
  US-Rezessionswahrscheinlichkeit, Fed-Politik, Geopolitik (Iran, Hormuz),
  Anleihenmärkte, Kapitalmarktzinsen. Strukturierte Risikobeurteilung.`;
// Output: { riskLevel: 'low'|'medium'|'high', summary: string, keyRisks: string[], sources: string[] }
```

### 🔲 Sektor-Rotation — Über-/Unterbewertet

**Logik (Sektor-PE vs. historisches Sektor-PE):**
```
Relativbewertung = Sektor-KGV_aktuell / Sektor-KGV_10J_Mittel
> 1.2 → überbewertet (rot)
< 0.8 → unterbewertet (grün)
0.8–1.2 → neutral (gelb)
```

**Datenquelle:** FMP `/api/v3/sector_price_earning_ratio`.
**Frontend:** Heatmap-Tabelle (11 GICS-Sektoren × Bewertungsstatus).

---

## ₿ BTC-Dashboard — Langfristige Features

### ✅ Section 3 ETF-Inflows — N/A
**Status:** N/A-Anzeige als bekanntes Issue dokumentiert.

---

### 🔲 Miner-Zone — Vollständige Indikatoren (Section 13 Erweiterung)

#### 1. Hash Ribbons (Capriole Investments)

```
Signal = MA30_Hashrate vs. MA60_Hashrate

Kapitulation:   MA30 < MA60 UND beide fallend
Kaufsignal:     MA30 kreuzt MA60 von unten nach oben (nach Kapitulation)

Datenquelle: mempool.space API → /api/v1/mining/hashrate/3y
```

**Frontend:**
```tsx
// AreaChart: MA30 (blau) vs MA60 (rot)
// ReferenceArea: rot während Kapitulation
// Marker: grüner Pfeil beim Crossover (Hash Ribbon Buy Signal)
```

#### 2. Puell Multiple

```
Puell Multiple = Tägl. Emission in USD / 365d-MA(tägl. Emission)

Tägl. Emission = 6 Blöcke/h × 24h × 3.125 BTC × BTC-Preis

Zonen:
  < 0.5  → Kapitulationszone (historisch starkes Kaufsignal)
  0.5–1.0 → Normal
  1.0–4.0 → Bullish
  > 4.0  → Überhitzt (Verkaufssignal)

Datenquelle: Berechnung aus CoinGecko Preishistorie + feste Block-Subvention
```

#### 3. Hashprice (USD/TH/s/Tag)

```
Hashprice = (Tägliche Miner-Einnahmen in USD) / (Netzwerk-Hashrate in TH/s)
          = (6.25 BTC × 144 Blöcke/Tag × BTC-Preis + Fees) / Hashrate_TH

Breakeven-Preis:
  Breakeven = Stromkosten × Effizienz_J_per_TH / (Einnahmen_per_TH)
  Referenz-Miner: Antminer S19 Pro: 29.5 J/TH, Strom: $0.05/kWh

Datenquelle: mempool.space /api/v1/mining/hashrate + BTC-Preis
```

#### 4. Mining Breakeven Price

```
Breakeven BTC-Preis = (Stromkosten_kWh × Effizienz_J_per_TH × 86400s) /
                      (Block-Subvention + Fees_per_Block / Netzwerk-TH)

Slider-Parameter im Frontend:
  - Effizienz: 18 J/TH (effizient) / 21.5 J/TH (Standard) / 30 J/TH (alt)
  - Strompreis: $0.04 / $0.05 / $0.08 / manuell
  - Presets + freie Eingabe
```

#### 5. Difficulty Ribbon Compression

```
MAs der Difficulty: 9, 14, 25, 40, 60, 90, 128, 200 Tage

Compression Score = 1 - (Spread der MAs / MA200)
  0.9+ → starke Kompression = Einstiegszone
  < 0.5 → expandierend = normale Phase

Datenquelle: mempool.space /api/v1/mining/difficulty-adjustments
```

#### 6. Miner Netflows (MPI-Proxy)

```
Miner Netflow = Miner-Wallets Ausflüsse zu Exchanges

Hohe Netflows (Zwangsverkauf): Roter Alert
Netflows nahe null (nach Kapitulation): Grünes Signal

Datenquelle: CryptoQuant (kostenpflichtig) ODER
             Proxy über Blockchain.com/Glassnode API
Alternativ: Mempool.space Miner-Adressen
```

#### 7. MVRV / Realized Price als Kontext

```
MVRV = Market Cap / Realized Cap
     = (BTC-Preis × Supply) / (Realized Price × Supply)

Realized Price = Durchschnittlicher Anschaffungspreis aller Coins
                 (aus UTXO-Daten, Glassnode)

Zonen:
  MVRV < 1.0 → Markt unter Realisiertem Wert (historisch Kapitulation)
  MVRV > 3.5 → historisch Überhitzung

Datenquelle: Glassnode API (kostenlos: MVRV 1J möglich)
```

#### Integrationsplan für Section 13 (Frontend)

```
Sidebar: { id: 13, label: '⛏ Miner-Zone', icon: Cpu } — bereits vorhanden

Section13Miner Props:
  data: BTCAnalysis          ← vom Parent per useMutation
  minerData: MinerData       ← vom Parent per useQuery /api/btc-miner
  loading: boolean
  error: boolean

Server-Route: POST /api/btc-miner (server/btc-miner.ts — bereits implementiert)
Response-Schema: MinerData {
  hashRate, hashRateMAs: { ma30, ma60 },
  puellMultiple, puellHistory,
  hashprice, breakevenPrice,
  difficultyRibbonScore, minerNetflow,
  mvrvRatio, realizedPrice,
  minerScore: number   // 0-100 Komposit
}
```

**Backend-Checkliste (server/btc-miner.ts):**
- [ ] Hash Ribbons MA30/MA60 berechnen aus Hashrate-History
- [ ] Puell Multiple berechnen aus CoinGecko + fester Emission
- [ ] Hashprice aus Hashrate + BTC-Preis + Fees
- [ ] Breakeven-Slider-Presets serverseitig vorbereiten
- [ ] Difficulty Ribbon Compression Score
- [ ] MVRV Proxy (Glassnode free tier)

---

## 💰 Gold-Dashboard (neu, vorzubereiten)

### Konzept

Analogon zum BTC-Dashboard für physisches Gold:
Makro-Treiber + Angebotsseite (AISC) + Realzins-Modell.

### Architektur

```
client/src/pages/GoldDashboard.tsx     ← Shell (~200 Zeilen, Anti-Truncation)
client/src/pages/gold/
  ├── GoldMacro.tsx                     ← Realzins, DXY, ZB-Verkäufe
  ├── GoldMining.tsx                    ← AISC-Kostenkurve, GDX/GLD-Ratio
  └── GoldSummary.tsx                   ← Zusammenfassung, Score
server/routes/gold.ts                  ← API-Handler
```

### Angebotsseite — Minenkosten-Indikatoren

#### 1. AISC (All-In Sustaining Cost)

```
AISC = Produktionskosten + Exploration-CapEx + G&A + Sustaining-Invest.
       gemessen in USD/oz

Aktueller Markt-Durchschnitt: ~$1.200–1.400/oz (World Gold Council)

Regel:
  Spot > AISC + 20%  → Minen profitabel, Produktion steigt
  Spot < AISC        → Marginale Minen unprofitabel → Angebotsreduktion

Datenquelle: World Gold Council API / S&P Global / manuell quartalsweise
```

#### 2. GDX/GLD-Ratio (Margendruck-Indikator)

```
Ratio = GDX_Preis / GLD_Preis

Fallend  → Minenaktien underperformen Gold → Margendruck
Steigend → Miner profitieren überproportional (Leverage)

Datenquelle: Yahoo Finance (GDX, GLD ETF-Preise) — kostenlos via yfinance
```

### Nachfrageseite — Makro-Indikatoren

#### 3. Realzins-Modell (10Y TIPS Yield)

```
Realzins = 10J-Nominalrendite - Inflationserwartung (10Y Breakeven)

Faustregel:
  Realzins < 0%    → Gold bullisch (Opp.kosten negativ)
  Realzins 0–1%   → Neutral
  Realzins > 1.5%  → Gold bearisch (hohe Opp.kosten)

Regressionsmodell:
  Gold_FairValue ≈ 2000 - 800 × Realzins_in_Prozent
  (vereinfachte lineare Regression, historisch robust)

Datenquelle: FRED API — kostenlos
  Nominalrendite: series IRLTLT01USM156N
  Breakeven: series T10YIE
  Realzins: series DFII10 (direkt verfügbar)
```

#### 4. DXY-Korrelation

```
Inverse Korrelation Gold/DXY: ~-0.7 (historisch)

DXY < 100  → schwacher USD → Gold bullisch
DXY > 105  → starker USD → Gold bearisch

Datenquelle: Yahoo Finance (DX-Y.NYB)
```

#### 5. Zentralbank-Nettokäufe

```
Quartalsweise Daten: World Gold Council
https://www.gold.org/goldhub/data/gold-demand-trends

Signal:
  Nettokäufe > 100t/Quartal → strukturelle Nachfrage hoch
  Nettoverkauf  → Negativsignal
```

#### 6. Gold/Silber-Ratio (Risiko-Appetit-Proxy)

```
Ratio = Goldpreis / Silberpreis

> 80  → Silber relativ billig, historisch Mean-Reversion folgt
< 50  → Risk-On-Umfeld

Datenquelle: Yahoo Finance (GC=F, SI=F)
```

### Gold-Dashboard Score (0–100)

```
Gold Score =
  Realzins-Score    × 0.35  (negativ Realzins = Vollpunkte)
  + DXY-Score       × 0.20  (schwacher USD = Vollpunkte)
  + ZB-Käufe-Score  × 0.20  (hohe Käufe = Vollpunkte)
  + AISC-Score      × 0.15  (Spot weit über AISC = Vollpunkte)
  + GDX/GLD-Score   × 0.10  (steigende Ratio = Vollpunkte)
```

### Frontend-Routing

```tsx
// App.tsx / Router:
<Route path="/gold" component={GoldDashboard} />

// Header-Navigation:
<button onClick={() => setLocation('/gold')}>
  <Coins className="w-4 h-4 text-yellow-500" /> Gold
</button>
```

---

## 🗒 Ideen-Pool (nicht priorisiert, für später)

- [ ] **Overview 2026:** Einleitungsseite vor Ticker-Eingabe
- [ ] **Einleitung:** „Aktien folgen zukünftigem Gewinnwachstum, nicht historischer Performance“
- [ ] **Makroanalyse-Sektion:** Inflation (multikausal), Fed Leitzins, Kapitalmarktzinsen,
  Ukraine, Hormuz-Blockade, Ausrüstung, Private Debt, Deglobalisierung
- [ ] **Megatrendanalyse:** Value Chain KI, Tech, Elektrifizierung, Eisenbahn
- [ ] **Blasen- und Rezessions-Indikatoren:** Schiller-KGV, Buffett-Indikator, Yield Curve
- [ ] **Mindset-Typen:** Value (fundamental + zyklisch), Growth, Momentum
- [ ] **ETF + Core-Satellite:** Nur bei Informationsvorteil in Einzelaktien
- [ ] **Asset Price Inflation 2026:** Kaufkrafterosion, Debt-Inflation-Mechanismus

---

## 🗂 Bekannte gute Commits

| SHA | Beschreibung |
|---|---|
| `33c8e77` | HEAD main — Basis btc-restore-modular |
| `5bf8a2d` | Section 13 vollständig (direkter Push) |
| `bafff3c` | PR #31 Squash — letzter valider Stand vor Truncation |

---

> **Nächste Aktion:** Lokal auf `btc-restore-modular` wechseln,
> `export default function BTCDashboard` schreiben,
> 4 Dateien aufsplitten — **kein direkter Push auf main ohne PR + Review**.
