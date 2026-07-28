# WORK_TEIL0-6.md — Vollständige Detailtiefe TEIL 0–6

> Restore aus Commit 975dbe93 + dokumentiertem Stand  
> Stand: 28.07.2026  
> Zugehörig: WORK.md (Index) · WORK_TEIL7_SCORING.md (TEIL 7) · WORK2.md (TEIL 8)

---

# TEIL 0 — PLATFORM-REALITÄT & SOFORT-FIXES (Stand 25.07.2026)

> Alle früheren Annahmen zu "Railway" sind falsch — das Projekt läuft NICHT auf Railway.

## 0.1 — Produktive Deployments

```
Plattform 1: Perplexity Computer (pplx.app)           [PRIMÄR]
  URL:        https://aktienanalyst-pro.pplx.app
  Deploy:     publish_website (Perplexity-internes Tool)
  Keys:       werden als credentials= beim publish_website-Aufruf injiziert

Plattform 2: Render (Docker-Container)                [SEKUNDÄR]
  URL:        https://aktienanalyst.onrender.com
  Deploy:     Dockerfile → node:20-slim, baut via npm run build, startet node dist/index.cjs
  Keys:       müssen im Render-Dashboard unter "Environment" gesetzt sein
  Port:       5000 (fest im Dockerfile: EXPOSE 5000)
  Branch:     main (auto-deploy bei Push)
```

## 0.2 — Railway: Nicht verwenden

```
RAILWAY WIRD NICHT GENUTZT.
Zu entfernen (Branch: chore/remove-railway):
[ ] railway.json löschen
[ ] .github/workflows/*.yml auf Railway-Deploy-Steps prüfen und entfernen
[ ] Kommentare/Docs Railway → Render ersetzen
[ ] README.md Deploy-Sektion auf pplx.app + Render aktualisieren
```

## 0.3 — Render Environment Variables (P0)

```
FMP_API_KEY         = <dein FMP Key>
OPENROUTER_API_KEY  = sk-or-v1-...
PERPLEXITY_API_KEY  = pplx-...          (optional, für Sonar)
NODE_ENV            = production
PORT                = 5000
PLAYWRIGHT_BROWSERS_PATH = /root/.cache/ms-playwright

Diagnose:
  curl https://aktienanalyst.onrender.com/api/health
  curl https://aktienanalyst.onrender.com/api/fmp-budget
  → Erwartung: { fmp: { calls: N, budget: 750 }, fmpAvailable: true }
```

## 0.4 — Legacy Quota Guard deaktivieren (P0)

```ts
// server/analyze-helpers.ts
// DAILY_FINANCE_LIMIT = 18 war Perplexity-Finance-Limit — auf FMP irrelevant
export function isQuotaExceeded(): boolean {
  return false; // Legacy deaktiviert
}
export function incrementQuota() { /* stub */ }
```

## 0.5 — Render Health-Check

```
Health Check Path: /api/health
Health Check Timeout: 30s
// server/index.ts:
app.get('/api/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));
```

## 0.6 — Mega-Files: Anti-Truncation Split-Plan

```
Problem: GitHub API trunciert Dateien > ~100 KB Base64 still.
REGEL: Jede Datei < 80 KB.

Kritisch:
  server/researcher.ts         69 KB
  client/src/pages/Researcher.tsx  56 KB
  server/llm-openrouter.ts     52 KB
  server/recession.ts          47 KB
  server/pdf-export.ts         42 KB

Barrel-Pattern:
  server/researcher.ts  → export { registerResearcherRoutes } from "./researcher/index";
  server/researcher/
    index.ts, macro-pulse.ts, sector.ts, screener.ts, capex.ts, briefing.ts, cache.ts, types.ts

  server/llm-openrouter.ts → export from "./llm/openrouter" + "./llm/sonar"
  server/llm/
    openrouter.ts, sonar.ts, anthropic.ts, models.ts

  client/src/pages/Researcher.tsx → export from "./researcher/index"
  client/src/pages/researcher/
    index.tsx, MacroPulse.tsx, SectorOpportunity.tsx, Screener.tsx, CapexFiscal.tsx, DailyBriefing.tsx
```

**Regel: Alle Splits lokal → npm run check → PR → Squash Merge. Nie Mega-Files über GitHub API pushen.**

## 0.7 — Checkliste Render

```
[ ] Env Vars gesetzt
[ ] Quota Guard deaktiviert
[ ] Health-Check konfiguriert
[ ] Railway-Referenzen entfernt
[ ] curl /api/health → ok
[ ] curl /api/fmp-budget → fmpAvailable: true
[ ] Analyse MSFT < 30s
[ ] OpenRouter kein 402
```

---

# TEIL 1 — BTC DASHBOARD RESTORE

## Diagnose

GitHub API trunciert `BTCDashboard.tsx` bei ~100 KB — Abbruch mitten in Section2Halving.
Sections 3–12 + `export default function BTCDashboard` fehlen in main.

## Restore-Plan

```
client/src/pages/
├── BTCDashboard.tsx        ← Shell + export default (~200 Zeilen)
└── btc/
    ├── Sections1to6.tsx
    ├── Sections7to12.tsx
    └── Section13Miner.tsx
```

Kritische Zeile im Section-Switch:

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

Bekannte gute Commits: `33c8e77`, `5bf8a2d`, `bafff3c`

---

# TEIL 2 — AKTIENANALYSE: BEKANNTE BUGS

## BUG A — FMP-Laufstatus

```
GET https://aktienanalyst-pro.pplx.app/api/fmp-budget
Erwartung: { fmp: { calls: N, budget: 750 }, fmpAvailable: true }
Wenn false → FMP_API_KEY fehlt in credentials
Branch: fix/fmp-key-check
```

## BUG B — Peer-Vergleich: ROIC 3J + ROE fehlen

**Symptom:** P/E n/a, Peer-Tabelle fehlt, nur ROE vorhanden.

**Korrekte ROIC-Formel:**

```ts
// ROIC = NOPAT / Invested Capital
// NOPAT = EBIT * (1 - TaxRate)
// Invested Capital = TotalEquity + LongTermDebt - Cash

export function calcROIC(
  ebit: number, taxExpense: number, incomeBeforeTax: number,
  longTermDebt: number, totalEquity: number, cash: number
): number {
  const taxRate = incomeBeforeTax > 0
    ? Math.max(0.10, Math.min(0.35, taxExpense / incomeBeforeTax))
    : 0.21;
  const nopat = ebit * (1 - taxRate);
  const investedCapital = totalEquity + longTermDebt - cash;
  if (investedCapital <= 0) return 0;
  return (nopat / investedCapital) * 100;
}

// 3J-Durchschnitt aus FMP /key-metrics?limit=3:
// const roic3Y = keyMetrics.slice(0,3).map(m => m.roic * 100).reduce((a,b)=>a+b,0) / 3;
```

**PeerData erweitern:** roic3Y, roa, roe, revenueCAGR3Y, eps5YGrowth, fcfMargin, grossMargin

Branch: `fix/peer-comparison-section7`

## BUG C — Revenue-Segmente (Produkt + Region)

```ts
// Produkt:  GET /api/v3/revenue-product-segmentation?symbol={ticker}
// Region:   GET /api/v3/revenue-geographic-segmentation?symbol={ticker}

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

Branch: `fix/revenue-segments-product-geo`

## BUG D — DCF/CRV bei Nicht-USD (NVO, ASML, SAP)

```ts
// ALLE Betrags-Felder mit fxRate multiplizieren:
const toUSD = (val: number) => val * fxRate;
const fcfTTM_usd  = toUSD(fcfTTM);
const netDebt_usd = toUSD(netDebt);
// sharesOutstanding und ADR-price NICHT konvertieren

// NVO Beispiel: FCF 95 Mrd DKK × 0.1456 = $13.8 Mrd
// Ohne Konvertierung: 6.9× falsch
```

Branch: `fix/non-usd-dcf-conversion`

---

# TEIL 3 — KATALYSATOREN-SEKTION 15: VOLLSTÄNDIGE FORMELN

> Quelle: catalyst-engine.ts

## Definitionen

```
PoS %            = Probability of Success (historisch, -10–15% Safety Margin)
Brutto-Upside    = Kursanstieg % bei vollständigem Eintritt
Einpreisungsgrad = Anteil bereits im Kurs (Konsens/Reverse DCF)
Netto-Upside     = Brutto-Upside × (1 - Einpreisungsgrad/100)
GB %             = PoS/100 × Netto-Upside
```

## Exakte Formeln

```ts
nettoUpside = bruttoUpside * (1 - einpreisungsgrad / 100)
// Bsp K1: 17% * (1 - 39/100) = 10.37%

gb = (pos / 100) * nettoUpside
// Bsp K1: 0.75 * 10.37 = 7.78%

sumGB = sum(gb_i)
catalystTarget = dcfFairValue * (1 + sumGB / 100)
// Bsp: $364.17 * (1 + 0.1687) = $425.61
// WICHTIG: Basis = DCF Fair Value, NICHT Analyst PT
```

## Reverse DCF (Binary Search N=5J)

```ts
function calcImpliedGStarExact({
  price, sharesOutstanding, netDebt, fcf, wacc, n = 5, terminalGrowth = 0.025
}) {
  const ev = price * sharesOutstanding + netDebt;
  function dcfValue(g: number) {
    let pv = 0;
    for (let t = 1; t <= n; t++) pv += fcf * (1 + g) ** t / (1 + wacc) ** t;
    return pv + fcf * (1 + g) ** n * (1 + terminalGrowth) / ((wacc - terminalGrowth) * (1 + wacc) ** n);
  }
  let lo = -0.05, hi = 0.40;
  if (dcfValue(hi) < ev || dcfValue(lo) > ev) return null;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (dcfValue(mid) > ev) hi = mid; else lo = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 100;
}

// Validierung:
// MSFT: g*≈14.5% (hist 16-18% → Fair)
// NVO:  g*≈35%  (hist 30-35% → Fair)
// ASML: g*≈28%  (hist 15-18% → stark überbewertet)
```

---

# TEIL 4 — RESEARCHER: OPENROUTER 402 / FALLBACK-CHAIN

## Root-Cause

`callLLMJson()` gibt bei HTTP 402 sofort `null` → Fallback-Text "LLM-Analyse nicht verfügbar. Bitte OpenRouter Credits aufladen." in allen 5 Tabs.

## Fix: 3-Modell-Kette

```ts
export async function callLLMJson({
  prompt, maxTokens, model,
}: { prompt: string; maxTokens: number; model?: string }) {
  const models = [
    model || "anthropic/claude-3-5-haiku",
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemini-flash-1.5:free",
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
      if (res.status === 402) { console.warn(`[LLM] ${m} 402, next`); continue; }
      if (res.status === 429) { await new Promise(r => setTimeout(r, 2000)); continue; }
      if (!res.ok) continue;
      const json = await res.json();
      const text = json?.choices?.[0]?.message?.content || "";
      return { data: JSON.parse(text), modelUsed: m };
    } catch { continue; }
  }
  return null;
}
```

## Hybrid: Perplexity Sonar + OpenRouter

```ts
export async function callPerplexitySonar({ prompt, maxTokens = 800 }) {
  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar-pro",
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      return_citations: true,
      search_recency_filter: "week",
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
```

**Zuordnung:**
- Country Macro / Capex / Daily Briefing → Sonar (Live-Fakten)
- Sector / Screener → OpenRouter Claude (Strukturierung)

Branch: `fix/researcher-openrouter-config`

---

# TEIL 5 — FMP-MIGRATION (P0)

| # | Aufgabe | Branch |
|---|---------|--------|
| 1 | /api/fmp-budget Frontend | fix/fmp-debug-panel |
| 2 | Non-USD DCF-Konvertierung | fix/non-usd-dcf-conversion |
| 3 | Peer + ROIC 3J | fix/peer-comparison-section7 |
| 4 | Revenue-Segmente Produkt+Geo | fix/revenue-segments-product-geo |
| 5 | calcImpliedGStarExact | fix/reverse-dcf-exact |
| 6 | LLM Catalyst Math Rules | fix/llm-catalyst-math-rules |
| 7 | OpenRouter Fallback-Chain | fix/researcher-openrouter-config |
| 8 | Integration-Test MSFT/AAPL/NVO/ASML | fix/integration-test |

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

# TEIL 6 — FEATURE-ROADMAP

## Technische Grundregeln

- Neue Section: SECTIONS-Array + case im Switch
- Neuer Endpunkt: eigene Datei in server/routes/ (max 80 KB)
- Formeln: unit-testbar in client/src/lib/calculations.ts
- LLM-Search: POST /api/llm-search → sonar-pro
- Anti-Truncation: Datei < 80 KB vor Push

## Geplante Sections

- Section 8: WACC & Terminal Value UI (Slider)
- Section 14: PESTEL (`POST /api/pestel`)
- Section 15: Reverse DCF + Sensitivitätstabelle
- Section 17: Zusammenfassungstabelle

## Thesis Score

```
Thesis Score (0-100) =
  Moat Score * 0.25 + FCF Marge 5J * 0.20 + Fiskalstimulus * 0.15
  + Konjunktur-Trend * 0.15 + Reputation * 0.15 + Positive Events * 0.10
```

## Kelly Portfolio

```
Kelly % = (p*b - q) / b
p = Thesis Score/100, b = Upside/Downside aus DCF
Pabrai: max 10% pro Position
```

## BTC Section 13 Miner

```
Puell = Tagesemission_USD / MA365(Tagesemission_USD)
  <0.5 Kapitulation | >4 überhitzt
Hash Ribbons: MA30 vs MA60 Hashrate — Kaufsignal bei Golden Cross
```

---

**Weiter:**
- TEIL 7 (volles Scoring-Code) → [WORK_TEIL7_SCORING.md](./WORK_TEIL7_SCORING.md)
- TEIL 8 (Regulatory/PESTEL/FRED) → [WORK2.md](./WORK2.md)
