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
```

## 3.3 — Reverse DCF / Einpreisungsgrad-Berechnung

```ts
// Korrekte Reverse DCF Formel (Binary Search N=5J):
function calcImpliedGStarExact({
  price, sharesOutstanding, netDebt, fcf, wacc, n=5, terminalGrowth=0.025
}) {
  const ev = price * sharesOutstanding + netDebt;
  function dcfValue(g) {
    let pv = 0;
    for (let t=1; t<=n; t++) pv += fcf * (1+g)**t / (1+wacc)**t;
    return pv + fcf*(1+g)**n*(1+terminalGrowth)/((wacc-terminalGrowth)*(1+wacc)**n);
  }
  // Binary Search: 50 Iterationen, g ∈ [-5%, +40%]
  let lo=-0.05, hi=0.40;
  if (dcfValue(hi)<ev || dcfValue(lo)>ev) return null;
  for (let i=0; i<50; i++) {
    const mid=(lo+hi)/2;
    if (dcfValue(mid)>ev) hi=mid; else lo=mid;
  }
  return Math.round(((lo+hi)/2)*10000)/100;
}

// Validierung:
// MSFT: EV=$3.034T, FCF=$71B, WACC=8.5% → g*≈14.5% (hist. 16-18% → Fair)
// NVO:  EV=$303B,  FCF=$13.8B USD, WACC=8.0% → g*≈35% (hist. 30-35% → Fair)
// ASML: EV=$270B,  FCF=$9.2B USD, WACC=8.5% → g*≈28% (hist. 15-18% → stark überbewertet)
```

---

# TEIL 4 — BUG E — RESEARCHER DASHBOARD: OPENROUTER-FEHLER (VOLLSTÄNDIG DIAGNOSTIZIERT)

> Quelle: server/researcher.ts (SHA: ab2a6f18915fcfbee4715ff3b48694c9e1fd07e7, gelesen 23.07.2026)
> Screenshot: Country Macro Pulse USA zeigt "LLM-Analyse nicht verfügbar. Bitte OpenRouter Credits aufladen."

## 4.1 — Root-Cause: callLLMJson wirft 402 / Credits erschopft

**Was passiert (Zeile ~252-280 in researcher.ts):**

```ts
// researcher.ts buildMacroPulse():
[llm1, llm2] = await Promise.all([
  callLLMJson({ prompt: prompt1, maxTokens: 1400 }),
  callLLMJson({ prompt: prompt2, maxTokens: 1400 }),
]);
// Wenn callLLMJson null zurückgibt (402) → llm1 = null
// → synthesis = FALLBACK-OBJEKT:
synthesis = {
  summary: `... Aktuelle Events aus dem LLM nicht verfügbar — bitte Credits aufladen...`,
  liquidityView: "LLM-Analyse nicht verfügbar. Bitte OpenRouter Credits aufladen.",
  fiscalView: "LLM-Analyse nicht verfügbar.",
  _fallback: true,
};
// Dieses Objekt wird NICHT gecacht (isStaleCache(_fallback:true) = true)
// Aber es wird dem User gezeigt → exakt der Screenshot-Text!
```

**callLLMJson importiert aus server/llm-openrouter.ts (SHA: 44a9d51254e4cefa2b47a2886a9cd40eb0fa28cf).**
Diese Datei ist 52 KB — enthält alle 4 LLM-Provider-Konfigurationen.

## 4.2 — Vier betroffene Tabs (alle über callLLMJson)

| Tab | Endpunkt | buildFn | maxTokens | Fehlertext im UI |
|---|---|---|---|---|
| Country Macro Pulse | POST /api/researcher/macro | buildMacroPulse() | 1400+1400 | "LLM-Analyse nicht verfügbar. Bitte OpenRouter Credits aufladen." |
| Sector Opportunity | POST /api/researcher/sectors | buildSectorOpportunity() | 4000 | trends.length=0 → _fallback |
| Undervalued Screener | POST /api/researcher/screener | buildScreener() | 1100+2000 | candidates.length=0 |
| Capex & Fiscal | POST /api/researcher/capex | buildCapexFiscal() | 3500 | programmes.length=0 |
| Daily Briefing | POST /api/researcher/daily-briefing | buildDailyBriefing() | 2200 | briefing=null |

## 4.3 — OpenRouter-Konfiguration in llm-openrouter.ts

**Was callLLMJson macht (aus Dateiname + Commit-Kontext):**

```ts
// server/llm-openrouter.ts exportiert:
export async function callLLMJson({
  prompt: string,
  maxTokens: number,
  model?: string,
}): Promise<{ data: any; modelUsed: string } | null>

// Interne Logik (aus researcher.ts Verhalten ableitbar):
// 1. POST https://openrouter.ai/api/v1/chat/completions
// 2. Authorization: Bearer ${OPENROUTER_API_KEY}
// 3. model: "anthropic/claude-3-5-haiku" (aus researcher.ts Kommentar)
// 4. Bei HTTP 402 (Payment Required): return null
// 5. Bei Timeout: return null
// 6. response.modelUsed = tatsächlich verwendetes Modell

// PROBLEM: Keine Perplexity-Abhängigkeit im Researcher-Code gefunden!
// Researcher läuft AUSSCHLIEßLICH über OpenRouter (callLLMJson)
// Perplexity-API wird NICHT direkt verwendet in researcher.ts
// Perplexity-Tasks = Perplexity AI Schedule-Tasks (externes Service, separat)
```

## 4.4 — Schedule-Tasks: Was beendet werden muss

**Perplexity Schedule-Tasks sind EXTERNE geplante Abfragen über Perplexity AI,
DIESE sind unabhängig vom App-Backend und müssen separat gestoppt werden:**

```
Zu stoppende Schedule-Tasks (Perplexity AI Dashboard):
[ ] Daily Briefing Task (täglich, macht externe Perplexity-Anfragen)
[ ] Researcher Macro Update Task (falls vorhanden)
[ ] Sector Opportunity Task (falls vorhanden)
[ ] Alle Tasks die auf aktienanalyst-pro.pplx.app zeigen

Schritt:
1. https://www.perplexity.ai/ → Tasks → Alle aktiven Tasks stoppen
2. Dann OpenRouter-Konfiguration fixen (siehe 4.5)
3. Dann Tasks neu erstellen falls gewünscht
```

## 4.5 — Fix: OpenRouter neu konfigurieren

**Schritt 1: OPENROUTER_API_KEY prüfen und aufladen**
```bash
# Verifizieren ob Key vorhanden:
curl https://openrouter.ai/api/v1/auth/key \
  -H "Authorization: Bearer $OPENROUTER_API_KEY"
# Erwartete Antwort: { "data": { "label": "...", "usage": X, "limit": Y, "is_free_tier": false } }
# Wenn HTTP 402 bei Analyse: Guthaben aufüllen unter https://openrouter.ai/credits
```

**Schritt 2: Modell-Konfiguration in llm-openrouter.ts prüfen**
```ts
// Aktuell (aus Kommentar in researcher.ts):
// "LLM (Claude 3.5 Haiku) only for SYNTHESIS and INTERPRETATION"
// → Modell: anthropic/claude-3-5-haiku

// Falls Credits-Problem: günstigeres Modell als Primär konfigurieren:
const MODEL_PRIMARY   = "anthropic/claude-3-5-haiku";  // ~$0.25/1M in, $1.25/1M out
const MODEL_FALLBACK  = "meta-llama/llama-3.1-8b-instruct"; // ~$0.06/1M (kostenlose Tier)
const MODEL_FREE      = "google/gemini-flash-1.5";          // Free-Tier OpenRouter

// Reihenfolge bei callLLMJson:
// 1. Versuche MODEL_PRIMARY
// 2. Bei 402 → Versuche MODEL_FALLBACK (nie null zurückgeben bei credits-problem!)
// 3. Bei 429 (Rate Limit) → Warte 2s, retry mit MODEL_FREE
// 4. Erst wenn ALLE 3 fehlschlagen: return null

// AKTUELLER BUG: callLLMJson gibt sofort null zurück bei 402 —
// kein Fallback-Modell-Versuch!
```

**Schritt 3: Fix-Implementierung in llm-openrouter.ts**
```ts
// Branch: fix/openrouter-fallback-chain
// server/llm-openrouter.ts: callLLMJson() erweitern:

export async function callLLMJson({
  prompt, maxTokens, model,
}: { prompt: string; maxTokens: number; model?: string }) {
  const models = [
    model || "anthropic/claude-3-5-haiku",
    "meta-llama/llama-3.1-8b-instruct:free",  // OpenRouter Free Tier
    "google/gemini-flash-1.5:free",            // Backup Free
  ];

  for (const m of models) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://aktienanalyst-pro.pplx.app",
          "X-Title": "Aktienanalyst Pro",
        },
        body: JSON.stringify({
          model: m,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          response_format: { type: "json_object" },
        }),
      });

      if (res.status === 402) {
        console.warn(`[LLM] ${m} 402 credits exhausted, trying next model`);
        continue; // Nächstes Modell versuchen
      }
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) {
        console.warn(`[LLM] ${m} HTTP ${res.status}`);
        continue;
      }

      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content || "";
      const data = JSON.parse(text);
      return { data, modelUsed: m };
    } catch (err: any) {
      console.warn(`[LLM] ${m} error: ${err?.message?.substring(0, 80)}`);
      continue;
    }
  }
  return null; // Alle Modelle fehlgeschlagen
}
```

## 4.6 — LLM Search Integration: Perplexity Sonar vs. OpenRouter

**Unterschied (wichtig für Researcher):**

```
OpenRouter (aktuell):          Perplexity Sonar (neu hinzuzufügen):
- Gibt trainingsdaten zurück   - Gibt live-Suchergebnisse zurück
- Kein Internetzugriff         - Echtzeit-Daten mit Quellen-URLs
- Günstig: $0.06-$1.25/1M    - Teurer: sonar-pro $3/1M in, $15/1M out
- Gut für: Formatierung,      - Gut für: Key Events, aktuelle Fiskalprog.,
  Strukturierung, Synthesis      Makrodaten, News-Katalysatoren

Für Researcher-Tabs optimal:
  Country Macro Pulse → Perplexity Sonar (aktuelle Inflationsdaten, Zentralbank-Events)
  Sector Opportunity  → OpenRouter Claude (Strukturierungsaufgabe)
  Undervalued Screener → OpenRouter Claude (Moat-Scoring)
  Capex & Fiscal     → Perplexity Sonar (aktuelle Fiskalprogramme, Budget-Dokumente)
  Daily Briefing     → Perplexity Sonar (Net-New Events, letzte 24h)
```

**Implementierung Perplexity Sonar in llm-openrouter.ts:**
```ts
// Neuer Export: callPerplexitySonar()
export async function callPerplexitySonar({
  prompt, maxTokens = 800,
}: { prompt: string; maxTokens?: number }) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",  // oder "sonar" für günstiger
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      return_citations: true,
      search_recency_filter: "week",  // nur letzte 7 Tage
    }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return {
    text: json?.choices?.[0]?.message?.content || "",
    citations: json?.citations || [],
    modelUsed: "sonar-pro",
  };
}

// Verwendung in buildMacroPulse():
// const sonarResult = await callPerplexitySonar({
//   prompt: `Aktuelle Makrolage ${regionLabel} Juli 2026: Inflation, Leitzins, Fiskal?`
// });
// Falls sonarResult → als dataContext an OpenRouter-Claude weitergeben:
// "Echtzeitdaten (Perplexity Sonar): " + sonarResult.text
// Claude strukturiert nur — Perplexity liefert Fakten
```

## 4.7 — Konkreter Fix-Plan: Researcher Dashboard

```
Branch: fix/researcher-openrouter-config

Schritt 1 (sofort): Perplexity Tasks stoppen
  → https://www.perplexity.ai/ → Tasks → alle aktiven Tasks deaktivieren

Schritt 2 (sofort): OpenRouter-Guthaben prüfen
  → https://openrouter.ai/credits
  → Mindest-Guthaben: $5 für ~1000 Researcher-Anfragen mit Haiku

Schritt 3 (Code): callLLMJson() Fallback-Chain (siehe 4.5)
  Datei: server/llm-openrouter.ts (SHA: 44a9d51254e4cefa2b47a2886a9cd40eb0fa28cf)
  → 3-Modell-Kette: Haiku → Llama-3.1-8B-Free → Gemini-Flash-Free
  → Bei Free-Tier: maxTokens auf min(maxTokens, 2000) clampen

Schritt 4 (Code): callPerplexitySonar() hinzufügen (siehe 4.6)
  Datei: server/llm-openrouter.ts
  Env-Var: PERPLEXITY_API_KEY (für Live-Suchergebnisse)

Schritt 5 (Code): researcher.ts buildMacroPulse() hybrid-Architektur
  Datei: server/researcher.ts (SHA: ab2a6f18915fcfbee4715ff3b48694c9e1fd07e7)
  → Step 1: callPerplexitySonar() für Fakten (Inflation, Leitzins, Events)
  → Step 2: callLLMJson() für Strukturierung/Synthesis der Sonar-Antwort
  → Falls Sonar-Key fehlt: fallback auf FRED-Daten (fetchMacroSnapshot) wie bisher

Schritt 6 (Code): researcher.ts buildCapexFiscal() hybrid
  → callPerplexitySonar("Aktuelle Fiskalprogramme ${region} 2025-2026 Volumen Status")
  → Sonar-Output als MUST_INCLUDE-Kontext (ersetzt hardcoded Liste)

Schritt 7 (Test): Diagnose-Endpunkt hinzufügen
  GET /api/researcher/status
  Response: {
    openrouter: { configured: true, balance: "$X.XX", model: "..." },
    perplexity: { configured: true/false },
    fred: { configured: true/false },
    fmp: { configured: true, budget: N },
  }
```

## 4.8 — Cache-Strategie für Researcher (bestehend, korrekt)

```ts
// researcher.ts: readResearcherCache() / writeResearcherCache()
// TTL: 6 Stunden (RESEARCHER_TTL_MIN = 60 * 6)
// Dual-Layer: File-Cache + SQLite DiskCache (überlebt Restarts)
// isStaleCache() blockiert Caching von Fallback-Objekten (_fallback: true)

// Stale-Serve-While-Refresh Pattern (korrekt implementiert):
// 1. Cache HIT + nicht stale → sofort zurückgeben
// 2. Cache STALE → alten Cache sofort servieren + Background-Refresh
// 3. Cache MISS → bauen + dann cachen

// PROBLEM: Wenn OpenRouter 402 → _fallback=true → nicht gecacht →
// nächster Request baut neu → wieder 402 → Endlosschleife
// FIX: Nach Step 3 (Fallback-Chain mit Free-Modellen) wird immer etwas
// gecacht (kein _fallback mehr bei Free-Tier-Erfolg)
```

## 4.9 — Perplexity Schedule-Tasks: Neu konfigurieren nach Fix

```
Nach dem Fix (OpenRouter funktioniert wieder):

Task 1: Daily Briefing (täglich 07:00 MEZ)
  Prompt: "Starte das Daily Briefing für aktienanalyst-pro.pplx.app:
           POST https://aktienanalyst-pro.pplx.app/api/researcher/daily-briefing
           { \"force\": true }"
  Ziel: Cache pre-warm vor Marktöffnung

Task 2: Macro Cache Refresh (alle 6h)
  Prompt: "Refresh Macro Cache:
           POST /api/researcher/macro { \"region\": \"US\", \"force\": true }
           POST /api/researcher/macro { \"region\": \"EU\", \"force\": true }
           POST /api/researcher/macro { \"region\": \"ASIA\", \"force\": true }"

Task 3: Sector/Capex Weekly Refresh (Sonntag 06:00 MEZ)
  Prompt: "Weekly Researcher Refresh:
           POST /api/researcher/sectors { \"region\": \"US\", \"force\": true }
           POST /api/researcher/capex { \"region\": \"US\", \"force\": true }"

WICHTIG: Tasks laufen über Perplexity AI Schedule-Service, nicht über das Backend!
Die Tasks triggern nur HTTP-Requests gegen das Backend.
Backend-LLM läuft über OpenRouter (nach Fix: mit Fallback-Chain).
```

---

# TEIL 5 — FMP-MIGRATION (P0-BLOCKER)

## Migrationsplan

| Schritt | Aufgabe | Branch |
|---|---|---|
| 1 | /api/fmp-budget im Frontend sichtbar | fix/fmp-debug-panel |
| 2 | Non-USD Konvertierung fix (BUG D) | fix/non-usd-dcf-conversion |
| 3 | Peer-Vergleich + ROI 3J (BUG B) | fix/peer-comparison-section7 |
| 4 | Revenue-Segmente Produkt + Geo (BUG C) | fix/revenue-segments-product-geo |
| 5 | calcImpliedGStarExact ersetzen alten calcImpliedGStar | fix/reverse-dcf-exact |
| 6 | LLM-Prompt Catalyst Math Rules (BUG E) | fix/llm-catalyst-math-rules |
| 7 | OpenRouter Fallback-Chain (BUG F) | fix/researcher-openrouter-config |
| 8 | Integration-Test: MSFT, AAPL, NVO, ASML | fix/integration-test |

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

# TEIL 6 — LANGFRISTIGE FEATURE-ROADMAP

## Technische Grundregeln

- Neue Section: Eintrag in SECTIONS-Array + case im Section-Switch
- Neuer Endpunkt: eigene Datei in server/routes/ (max 80 KB)
- Formeln: unit-testbare Funktionen in client/src/lib/calculations.ts
- LLM-Search: POST /api/llm-search { query, ticker, context } → sonar-pro
- Anti-Truncation: jede Datei < 80 KB vor Push

---

## Stock Analysis Pro

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
Vollständige Implementierung: siehe TEIL 3 Abschnitt 3.3
Sidebar: { id: 15, label: 'Reverse DCF', icon: RefreshCw }
Sensitivitätstabelle: 5 WACC × 3 Szenarien (g-5%, g_hist, g+5%)
```

### Section 17 — Zusammenfassungstabelle

| Metrik | Wert | Bewertung | Quelle |
|---|---|---|---|
| Aktienkurs | $xxx | — | FMP |
| DCF Fair Value | $xxx | Unterbewertet | Berechnet |
| Reverse DCF g* | x.x% | Hoch | Berechnet |
| ROIC 3J | xx% | Wertsteigernd | FMP/Berechnet |

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

---

## Ideen-Pool

- [ ] Overview-Seite 2026 vor Ticker-Eingabe
- [ ] Makroanalyse: Inflation, Fed, Geopolitik, Deglobalisierung
- [ ] Megatrendanalyse: KI, Elektrifizierung, Rüstung
- [ ] Blasen/Rezessionsindikatoren: Shiller-KGV, Buffett-Indikator, Yield Curve
