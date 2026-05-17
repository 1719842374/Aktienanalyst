// === Researcher Module ===
//
// 4-Tab autonomous research mode for the Stock Analyst Pro dashboard.
// Hybrid architecture: REAL data via finance_macro_snapshot / FMP screener,
// LLM (Grok 4.1 Fast or Haiku 3.5) only for SYNTHESIS and INTERPRETATION,
// never for generating numeric facts.
//
// Tabs:
//   1. /api/researcher/macro       — Country Macro Pulse (US/EU/Asia)
//   2. /api/researcher/sectors     — Sector Opportunity Map (12 megatrends, scored)
//   3. /api/researcher/screener    — Undervalued Stock Screener (FMP + LLM moat scoring)
//   4. /api/researcher/capex       — Capex & Fiscal Tracker (programmes per region)
//
// All 4 endpoints use a shared 7-day file cache mirroring the main dashboard's
// caching contract — same TTL, same per-request cache-key strategy. Cache is
// keyed on the relevant input parameters (country/region/filter) so different
// requests do not collide.
//
// Anti-bias mechanic for Tab 2 (Sector Opportunity):
//   The LLM is REQUIRED to score each of 12 fixed megatrend categories on a
//   1-10 scale. It cannot just return "AI is hottest" — it must explicitly
//   evaluate Defense, Renewables, Biotech, Robotics, Cloud, Semis, Consumer,
//   Infrastructure, Financials, Real Estate, Transport, and Materials in
//   every response. Ranking emerges from the scores, not from LLM bias.

import type { Express } from "express";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { callLLMJson } from "./llm-openrouter";

// ============================================================
// Cache Layer (mirrors main dashboard 7-day TTL)
// ============================================================

const CACHE_DIR = path.join(process.cwd(), ".cache", "researcher");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
const RESEARCHER_TTL_MIN = 60 * 24 * 7; // 7 days

function safeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 80);
}

function readResearcherCache(tab: string, params: string): any | null {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    const cachedAt = parsed?._cachedAt ? new Date(parsed._cachedAt).getTime() : 0;
    const ageMin = (Date.now() - cachedAt) / 60000;
    if (ageMin >= RESEARCHER_TTL_MIN) return null;
    parsed._cached = true;
    parsed._cacheAge = Math.round(ageMin);
    return parsed;
  } catch {
    return null;
  }
}

function writeResearcherCache(tab: string, params: string, data: any) {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    const toSave = { ...data, _cachedAt: new Date().toISOString() };
    fs.writeFileSync(file, JSON.stringify(toSave, null, 2));
  } catch (err: any) {
    console.warn(`[RESEARCHER-CACHE] save failed: ${err?.message}`);
  }
}

// ============================================================
// Finance API helper (synchronous, throttled — same pattern as recession.ts)
// ============================================================

let lastFinanceCallAt = 0;
const MIN_SPACING_MS = 250;
function sleepSync(ms: number) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}
function callFinanceTool(toolName: string, args: Record<string, any>): any {
  const elapsed = Date.now() - lastFinanceCallAt;
  if (elapsed < MIN_SPACING_MS) sleepSync(MIN_SPACING_MS - elapsed);
  let result: any = null;
  try {
    const params = JSON.stringify({ source_id: "finance", tool_name: toolName, arguments: args });
    const escaped = params.replace(/'/g, "'\\''");
    const raw = execSync(`external-tool call '${escaped}'`, {
      timeout: 60000, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024,
    });
    result = JSON.parse(raw);
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("RATE_LIMITED") || msg.includes("429") || msg.includes("UNAUTHORIZED") || msg.includes("401")) {
      console.warn(`[RESEARCHER] ${toolName} rate-limited, backing off 4s`);
      sleepSync(4000);
      try {
        const params = JSON.stringify({ source_id: "finance", tool_name: toolName, arguments: args });
        const escaped = params.replace(/'/g, "'\\''");
        const raw = execSync(`external-tool call '${escaped}'`, {
          timeout: 60000, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024,
        });
        result = JSON.parse(raw);
      } catch { result = null; }
    } else {
      console.error(`[RESEARCHER] ${toolName} failed:`, msg.substring(0, 200));
      result = null;
    }
  }
  lastFinanceCallAt = Date.now();
  return result;
}

// ============================================================
// Region -> Country mapping
// ============================================================

const REGION_COUNTRIES: Record<string, string[]> = {
  US: ["United States"],
  EU: ["Germany", "France", "Italy", "Spain", "Netherlands", "United Kingdom"],
  ASIA: ["China", "Japan", "South Korea", "India", "Taiwan"],
};

const REGION_LABELS: Record<string, string> = {
  US: "USA",
  EU: "Europa",
  ASIA: "Asien",
};

// ============================================================
// 12 Megatrend Categories — Anti-Bias Anchor
// ============================================================

const MEGATRENDS_12 = [
  { id: "defense", label: "Defense / Rüstung / Geopolitik" },
  { id: "renewables", label: "Renewables / Energy Transition / Wasserstoff" },
  { id: "biotech", label: "Biotech / Pharma / Genomics" },
  { id: "robotics", label: "Robotics / Industrial Automation" },
  { id: "cloud", label: "Cloud Infrastructure & Software" },
  { id: "semiconductors", label: "Semiconductors (breit, nicht nur AI)" },
  { id: "consumer", label: "Consumer Electronics & E-Commerce" },
  { id: "infrastructure", label: "Infrastructure & Construction (Reshoring/Onshoring)" },
  { id: "financials", label: "Financials / Fintech / Insurance" },
  { id: "realestate", label: "Real Estate & Data Centers" },
  { id: "transport", label: "Transportation & Logistics (EV / Autonomous)" },
  { id: "materials", label: "Materials & Commodities (Cu / Li / Uran)" },
];

// ============================================================
// Tab 1: Country Macro Pulse
// ============================================================

interface MacroPulseResult {
  region: string;
  regionLabel: string;
  asOf: string;
  indicators: Array<{
    country: string;
    category: string;
    latestValue: string;
    previousValue: string;
    unit: string;
    date: string;
    source: string;
  }>;
  llmSynthesis: {
    summary: string;
    keyDrivers: string[];
    riskFreeRateView: string;
    liquidityView: string;
    fiscalView: string;
    investmentImplications: string[];
    actionRecommendation: "Buy" | "Watch" | "Avoid";
    actionRationale: string;
    keyEvents: Array<{
      title: string;
      category: "Geopolitik" | "Zentralbank" | "Wahl/Politik" | "Lieferkette" | "Energie/Rohstoffe" | "Naturkatastrophe" | "Tech/Regulierung" | "Sonstiges";
      severity: "high" | "medium" | "low";
      timeframe: string;
      description: string;
      inflationImpact: "steigend" | "fallend" | "neutral";
      rateImpact: "steigend" | "fallend" | "neutral";
      equityImpact: "positiv" | "negativ" | "gemischt";
      affectedSectors: string[];
      rationale: string;
    }>;
  } | null;
  modelUsed?: string;
  _cached?: boolean;
  _cacheAge?: number;
  _cachedAt?: string;
}

async function buildMacroPulse(region: string): Promise<MacroPulseResult> {
  const countries = REGION_COUNTRIES[region] || REGION_COUNTRIES.US;
  const regionLabel = REGION_LABELS[region] || region;

  // Fetch real macro data
  const macroResult = callFinanceTool("finance_macro_snapshot", {
    countries,
    keywords: ["interest rate", "M2", "GDP", "inflation", "Government Spending", "Government Debt"],
    action: `Macro pulse for ${regionLabel}`,
  });

  const indicators: MacroPulseResult["indicators"] = [];
  if (macroResult?.content) {
    const lines = String(macroResult.content).split("\n");
    for (const line of lines) {
      if (!line.startsWith("|") || line.includes("---")) continue;
      const cells = line.split("|").map(c => c.trim()).filter(Boolean);
      if (cells.length < 7 || cells[0] === "country") continue;
      indicators.push({
        country: cells[0],
        category: cells[1],
        latestValue: cells[2],
        date: cells[3],
        previousValue: cells[4],
        unit: cells[5],
        source: cells[6],
      });
    }
  }

  // Compact summary for LLM (avoid token blowup)
  const compactIndicators = indicators
    .filter(i => ["Interest Rate", "Inflation Rate", "GDP Annual Growth Rate", "Money Supply M2", "Government Spending to GDP", "Government Debt to GDP", "Core Inflation Rate"].includes(i.category))
    .slice(0, 60);

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  const prompt = `Du bist Hedge-Fund-Stratege bei einem globalen Macro-Fonds (Bridgewater / Brevan Howard Stil). Analysiere die folgenden REAL-DATEN für die Region ${regionLabel} (Länder: ${countries.join(", ")}) — Stand ${today}.

ECHTE MAKRO-DATEN (Trading Economics / FRED):
${compactIndicators.map(i => `- ${i.country}: ${i.category} = ${i.latestValue} ${i.unit} (vorher: ${i.previousValue}, ${i.date})`).join("\n") || "(keine Daten verfügbar — bewerte qualitativ)"}

=== KRITISCHE PFLICHT: AUTONOME KEY-EVENT-ERKENNUNG ===

Du MUSST eigenständig die 4-7 wichtigsten AKTUELLEN Key Events identifizieren, die ${currentYear} und in den letzten 30-90 Tagen die Märkte und Makro-Lage in ${regionLabel} prägen. KEINE Hard-Coded-Liste — finde sie selbst aus deinem aktuellen Wissen.

Kategorien (alle gleichberechtigt prüfen):
- **Geopolitik / Konflikte**: Straße von Hormuz, Nahost (Iran-Israel-Saudi), Ukraine-Russland, Taiwan-Straße, Südchinesisches Meer, NATO-Spannungen
- **Zentralbank-Entscheidungen**: Fed/EZB/BoJ/PBoC-Sitzungen, Zinsentscheide, QT/QE-Wenden, Forward-Guidance-Shifts
- **Wahlen / Politik**: US-Präsidentschaftswahl-Folgen 2025+, EU-Wahlen, Regierungswechsel, Ampel-Aus, Trump-Administration-Policies
- **Tech / Regulierung**: US-China Tech War, Chip-Exportrestriktionen, AI-Regulation, EU AI Act, Antitrust
- **Energie / Rohstoffe**: Ölpreis-Schocks, OPEC+-Entscheidungen, LNG-Engpässe, Strompreise, Kupfer/Lithium-Verknappung
- **Lieferketten**: Suez/Bab-el-Mandeb (Houthi), Panama-Kanal, Halbleiter-Allokation, Hafenstreiks
- **Naturkatastrophen / Pandemie**: Hurricanes, Dürren, neue Virus-Wellen
- **Finanzmarkt-Stress**: Bond-Sell-Offs, Spread-Blowouts, Carry-Trade-Unwinds, Yen-Carry-Probleme

Für JEDES Event MUSST du explizit ableiten:
1. Inflation-Impact (steigend / fallend / neutral)
2. Risk-Free-Rate-Impact (steigend / fallend / neutral)
3. Equity-Impact (positiv / negativ / gemischt)
4. Betroffene Sektoren
5. Mechanismus (1-2 Sätze: WIE wirkt das Event?)

=== AUSGABE ===

JSON, ausschließlich auf Deutsch:
{
  "summary": "3-4 Sätze Gesamtbild der Makro-Lage in ${regionLabel} — inkl. Erwähnung der wichtigsten 1-2 Key Events",
  "keyDrivers": ["3-5 wichtigste Treiber als Bullet-Punkte (Mix aus Daten + Events)"],
  "riskFreeRateView": "1-2 Sätze: Trend Risk-Free Rate, Implikation für Equity-Bewertungen — inkl. Event-Auswirkung",
  "liquidityView": "1-2 Sätze: Geldmengenwachstum / Liquiditätszyklus / QT-vs-QE-Position",
  "fiscalView": "1-2 Sätze: Fiskalprogramme / Government Spending Trend",
  "keyEvents": [
    {
      "title": "Kurzer prägnanter Event-Titel (z.B. 'Iran-Israel-Eskalation in der Straße von Hormuz')",
      "category": "Geopolitik" | "Zentralbank" | "Wahl/Politik" | "Lieferkette" | "Energie/Rohstoffe" | "Naturkatastrophe" | "Tech/Regulierung" | "Sonstiges",
      "severity": "high" | "medium" | "low",
      "timeframe": "z.B. 'Akut', 'Letzte 30 Tage', 'Q1 ${currentYear}', 'Anhaltend'",
      "description": "2-3 Sätze: Was ist passiert? Konkreter Sachverhalt + Datum/Zeitraum.",
      "inflationImpact": "steigend | fallend | neutral",
      "rateImpact": "steigend | fallend | neutral",
      "equityImpact": "positiv | negativ | gemischt",
      "affectedSectors": ["Sektor1", "Sektor2", "Sektor3"],
      "rationale": "1-2 Sätze: Mechanismus — WIE wirkt das Event auf Inflation/Rate/Equity? Konkrete Transmissions-Kette."
    }
  ],
  "investmentImplications": ["3-5 konkrete Implikationen für Anleger — müssen die Key Events explizit berücksichtigen (Sektor-Tilts, Duration, Currency-Hedges, Energie-Long, Defensive-Rotation, etc.)"],
  "actionRecommendation": "Buy | Watch | Avoid",
  "actionRationale": "1-2 Sätze warum diese Empfehlung — muss Daten UND Events berücksichtigen"
}

REGELN:
- DATENGETRIEBEN: Leite jede Aussage aus den obigen Zahlen UND aus konkreten Events ab. Keine generischen Floskeln.
- AKTUALITÄT: Events müssen ${currentYear} bzw. in den letzten 30-90 Tagen relevant sein.
- PROAKTIV: Liste auch Events, die noch nicht jeder kennt — z.B. neue Sanktionen, Zentralbank-Speeches, Pipeline-Vorfälle.
- 4-7 Events. Lieber zu viele als zu wenige.
- Wenn USA: erwähne Trump-Era Policies, Tariff-Eskalation, Fed-Pivot-Diskussion. Wenn EU: erwähne EZB-Pfad, Deutschland-Schuldenbremse-Debatte, Sondervermögen, Frankreich-Fiskal-Krise. Wenn Asien: erwähne BoJ-Hike-Pfad, China-Property/Stimulus, Taiwan-Spannungen, Indien-Capex.

JSON, keine Prosa drumherum. Ausschließlich Deutsch.`;

  const llm = await callLLMJson({ prompt, maxTokens: 2200 });
  return {
    region,
    regionLabel,
    asOf: new Date().toISOString(),
    indicators: compactIndicators,
    llmSynthesis: llm?.data || null,
    modelUsed: llm?.modelUsed,
  };
}

// ============================================================
// Tab 2: Sector Opportunity Map (12 megatrends scored)
// ============================================================

interface SectorOpportunityResult {
  region: string;
  regionLabel: string;
  asOf: string;
  trends: Array<{
    id: string;
    label: string;
    growthScore: number;       // 1-10
    moatScore: number;         // 1-10 (margin durability vs commoditization)
    marginRisk: "low" | "medium" | "high";
    timeline: string;          // "6-12M" / "12-24M" / "24-36M+"
    reasoning: string;         // 2-3 Sätze
    topPlayers: string[];      // 3-5 Tickers/Names
    actionRecommendation: "Buy" | "Watch" | "Avoid";
  }>;
  topPicks: string[];          // top 3 trend ids by combined score
  modelUsed?: string;
  _cached?: boolean;
  _cacheAge?: number;
  _cachedAt?: string;
}

async function buildSectorOpportunity(region: string): Promise<SectorOpportunityResult> {
  const regionLabel = REGION_LABELS[region] || region;

  const prompt = `Du bist Sector-Strategist bei einem Hedge-Fund mit Multi-Asset-Mandate. Bewerte für die Region ${regionLabel} (Stand: ${new Date().toISOString().slice(0, 10)}) ALLE 12 fixen Megatrend-Kategorien gleichberechtigt.

WICHTIG — Anti-Bias-Regel:
- Du MUSST jede der 12 Kategorien einzeln scoren — auch die "langweiligen"
- Vermeide Hype: Score basiert auf REALEN Wachstumsraten, Margenstabilität, Wettbewerbsdynamik
- Margin-Risiko-Frage: kann Wettbewerb in dieser Branche die Margen frühzeitig erodieren? (Cloud-SaaS = niedriges Risiko, Solar-Module = hoch)

DIE 12 KATEGORIEN:
${MEGATRENDS_12.map((m, i) => `${i + 1}. ${m.id}: ${m.label}`).join("\n")}

Gib für jede Kategorie zurück:
- growthScore (1-10): erwartetes 3-5J Branchenwachstum
- moatScore (1-10): wie geschützt sind Margen vor Commoditization (10 = Oligopol/IP-Schutz)
- marginRisk: "low" | "medium" | "high"
- timeline: wann manifestiert sich der Treiber ("6-12M" / "12-24M" / "24-36M+")
- reasoning: 2-3 datengetriebene Sätze (DEUTSCH, hedge-fund-style)
- topPlayers: 3-5 echte Tickers/Firmen aus der Region (US-Tickers, EU-Tickers, Asia-Tickers je nach Region)
- actionRecommendation: "Buy" | "Watch" | "Avoid"

Antworte mit JSON:
{
  "trends": [
    { "id": "defense", "growthScore": 7, "moatScore": 8, "marginRisk": "low", "timeline": "12-24M", "reasoning": "...", "topPlayers": ["LMT", "RTX", "GD"], "actionRecommendation": "Buy" },
    ... // alle 12 Kategorien
  ]
}

Sortierung egal — wir ranken anschließend nach (growthScore × moatScore).`;

  const llm = await callLLMJson({ prompt, maxTokens: 1800 });
  if (!llm?.data?.trends || !Array.isArray(llm.data.trends)) {
    return {
      region, regionLabel, asOf: new Date().toISOString(),
      trends: [], topPicks: [],
    };
  }

  // Hydrate with full label from MEGATRENDS_12 + clamp scores
  const trendsById = new Map(MEGATRENDS_12.map(t => [t.id, t.label]));
  const trends = (llm.data.trends as any[])
    .filter(t => t && trendsById.has(t.id))
    .map(t => ({
      id: t.id,
      label: trendsById.get(t.id)!,
      growthScore: Math.max(1, Math.min(10, Number(t.growthScore) || 5)),
      moatScore: Math.max(1, Math.min(10, Number(t.moatScore) || 5)),
      marginRisk: (["low", "medium", "high"].includes(t.marginRisk) ? t.marginRisk : "medium") as "low" | "medium" | "high",
      timeline: String(t.timeline || "12-24M"),
      reasoning: String(t.reasoning || ""),
      topPlayers: Array.isArray(t.topPlayers) ? t.topPlayers.slice(0, 5).map(String) : [],
      actionRecommendation: (["Buy", "Watch", "Avoid"].includes(t.actionRecommendation) ? t.actionRecommendation : "Watch") as "Buy" | "Watch" | "Avoid",
    }));

  // Rank by combined growth*moat score
  trends.sort((a, b) => (b.growthScore * b.moatScore) - (a.growthScore * a.moatScore));
  const topPicks = trends.slice(0, 3).map(t => t.id);

  return {
    region, regionLabel, asOf: new Date().toISOString(),
    trends, topPicks, modelUsed: llm.modelUsed,
  };
}

// ============================================================
// Tab 3: Undervalued Stock Screener
// ============================================================

interface ScreenerFilters {
  region: string;
  marketCapMin?: number;     // in millions
  marketCapMax?: number;
  peMax?: number;
  revenueGrowthMin?: number; // percent
  sector?: string;           // FMP sector name
}

interface ScreenerResult {
  region: string;
  filters: ScreenerFilters;
  asOf: string;
  candidates: Array<{
    ticker: string;
    companyName: string;
    sector: string;
    industry: string;
    marketCap: number;
    pe: number;
    revenueGrowth: number;
    price: number;
    moatScore: number;       // 1-10 from LLM
    marginRiskScore: number; // 1-10 from LLM (10 = high risk)
    growthDrivers: string[];
    risks: string[];
    actionRecommendation: "Buy" | "Watch" | "Avoid";
    rationale: string;
  }>;
  modelUsed?: string;
  _cached?: boolean;
  _cacheAge?: number;
  _cachedAt?: string;
}

async function buildScreener(filters: ScreenerFilters): Promise<ScreenerResult> {
  // Try FMP screener first (real data, no LLM hallucination)
  const fmpKey = process.env.FMP_API_KEY;
  let candidates: any[] = [];
  if (fmpKey) {
    try {
      const params = new URLSearchParams();
      if (filters.marketCapMin) params.set("marketCapMoreThan", String(filters.marketCapMin * 1e6));
      if (filters.marketCapMax) params.set("marketCapLowerThan", String(filters.marketCapMax * 1e6));
      if (filters.peMax) params.set("peLowerThan", String(filters.peMax));
      if (filters.sector) params.set("sector", filters.sector);
      params.set("limit", "30");
      params.set("isActivelyTrading", "true");
      params.set("apikey", fmpKey);
      const url = `https://financialmodelingprep.com/stable/company-screener?${params.toString()}`;
      const out = execSync(`curl -sL --max-time 15 "${url}"`, { encoding: "utf-8" });
      const parsed = JSON.parse(out);
      if (Array.isArray(parsed)) candidates = parsed;
    } catch (err: any) {
      console.warn(`[RESEARCHER] FMP screener failed: ${err?.message}`);
    }
  }

  // Fallback: ask LLM for representative undervalued names per region
  if (!candidates.length) {
    const fallbackPrompt = `Liste 12 attraktive, potenziell unterbewertete Aktien für die Region ${REGION_LABELS[filters.region] || filters.region} (Stand: ${new Date().toISOString().slice(0, 10)}). Maximale Sektor-Diversifikation aus den 12 Megatrend-Kategorien (Defense, Renewables, Biotech, Robotics, Cloud, Semis, Consumer, Infrastructure, Financials, RealEstate, Transport, Materials).

Filter:
- Market Cap: ${filters.marketCapMin || 1000}M-${filters.marketCapMax || 500000}M USD
- P/E max: ${filters.peMax || 30}
- Revenue Growth min: ${filters.revenueGrowthMin || 5}%

JSON: { "candidates": [{ "ticker": "...", "companyName": "...", "sector": "...", "industry": "...", "marketCap": 50000000000, "pe": 18.5, "revenueGrowth": 12.3, "price": 100 }] }`;
    const fb = await callLLMJson({ prompt: fallbackPrompt, maxTokens: 1500 });
    if (fb?.data?.candidates && Array.isArray(fb.data.candidates)) {
      candidates = fb.data.candidates.slice(0, 12);
    }
  }

  candidates = candidates.slice(0, 12);
  if (!candidates.length) {
    return {
      region: filters.region, filters, asOf: new Date().toISOString(),
      candidates: [], modelUsed: undefined,
    };
  }

  // Now LLM ranks them by Moat & Margin-Risk
  const compactList = candidates.map(c => ({
    ticker: c.symbol || c.ticker,
    companyName: c.companyName || c.name || c.ticker,
    sector: c.sector || "",
    industry: c.industry || "",
    marketCap: Number(c.marketCap || c.mktCap || 0),
    pe: Number(c.pe || c.priceEarningsRatio || 0),
    revenueGrowth: Number(c.revenueGrowth || 0),
    price: Number(c.price || 0),
  })).filter(c => c.ticker);

  const rankPrompt = `Du bist Equity-Analyst bei einem Long-Only Value-Hedge-Fund. Bewerte folgende ${compactList.length} Aktien (Stand: ${new Date().toISOString().slice(0, 10)}) auf Moat-Stärke und Margin-Risiko.

KANDIDATEN:
${compactList.map((c, i) => `${i + 1}. ${c.ticker} (${c.companyName}) — ${c.sector}/${c.industry}, MCap $${(c.marketCap / 1e9).toFixed(1)}B, P/E ${c.pe}, RevGrowth ${c.revenueGrowth}%`).join("\n")}

Für JEDE Aktie liefere:
- moatScore (1-10): wie verteidigungsfähig ist die Wettbewerbsposition? (10 = quasi-Monopol mit IP/Switching-Costs)
- marginRiskScore (1-10): Risiko, dass Wettbewerb die Margen erodiert (10 = sehr hoch)
- growthDrivers: 2-3 BREITE Wachstumstreiber (NICHT nur AI/Capex — denke an alle Megatrends)
- risks: 2-3 konkrete Risiken
- actionRecommendation: "Buy" | "Watch" | "Avoid"
- rationale: 1-2 Sätze (DEUTSCH)

JSON-Format:
{
  "rankings": [
    { "ticker": "AAPL", "moatScore": 9, "marginRiskScore": 3, "growthDrivers": ["Service Subscriptions", "Vision Pro Adoption"], "risks": ["China Slowdown"], "actionRecommendation": "Watch", "rationale": "..." }
  ]
}`;

  const llm = await callLLMJson({ prompt: rankPrompt, maxTokens: 1500 });
  const rankingsByTicker = new Map<string, any>();
  if (llm?.data?.rankings && Array.isArray(llm.data.rankings)) {
    for (const r of llm.data.rankings) {
      if (r?.ticker) rankingsByTicker.set(String(r.ticker).toUpperCase(), r);
    }
  }

  const enriched = compactList.map(c => {
    const r = rankingsByTicker.get(c.ticker.toUpperCase()) || {};
    return {
      ...c,
      moatScore: Math.max(1, Math.min(10, Number(r.moatScore) || 5)),
      marginRiskScore: Math.max(1, Math.min(10, Number(r.marginRiskScore) || 5)),
      growthDrivers: Array.isArray(r.growthDrivers) ? r.growthDrivers.slice(0, 3).map(String) : [],
      risks: Array.isArray(r.risks) ? r.risks.slice(0, 3).map(String) : [],
      actionRecommendation: (["Buy", "Watch", "Avoid"].includes(r.actionRecommendation) ? r.actionRecommendation : "Watch") as "Buy" | "Watch" | "Avoid",
      rationale: String(r.rationale || ""),
    };
  });

  // Sort: Buy first, then highest moat-vs-risk diff
  enriched.sort((a, b) => {
    const aw = a.actionRecommendation === "Buy" ? 2 : a.actionRecommendation === "Watch" ? 1 : 0;
    const bw = b.actionRecommendation === "Buy" ? 2 : b.actionRecommendation === "Watch" ? 1 : 0;
    if (aw !== bw) return bw - aw;
    return (b.moatScore - b.marginRiskScore) - (a.moatScore - a.marginRiskScore);
  });

  return {
    region: filters.region, filters, asOf: new Date().toISOString(),
    candidates: enriched, modelUsed: llm?.modelUsed,
  };
}

// ============================================================
// Tab 4: Capex & Fiscal Tracker
// ============================================================

interface CapexFiscalResult {
  region: string;
  regionLabel: string;
  asOf: string;
  programmes: Array<{
    name: string;
    category: "Fiscal Stimulus" | "Tax Cut/Incentive" | "Capex Programme" | "Deregulation" | "Subsidy";
    region: string;
    amountUSD?: string;
    timeline: string;
    sectors: string[];
    beneficiaries: string[];
    status: "Active" | "Announced" | "In Implementation" | "Phasing Out";
    impact: "high" | "medium" | "low";
    rationale: string;
  }>;
  totalCapexEstimate: string;
  govSpendingTrend: string;
  modelUsed?: string;
  _cached?: boolean;
  _cacheAge?: number;
  _cachedAt?: string;
}

async function buildCapexFiscal(region: string): Promise<CapexFiscalResult> {
  const countries = REGION_COUNTRIES[region] || REGION_COUNTRIES.US;
  const regionLabel = REGION_LABELS[region] || region;

  // Real data: Government Spending to GDP trend
  const macroResult = callFinanceTool("finance_macro_snapshot", {
    countries,
    keywords: ["Government Spending", "Government Debt", "Budget"],
    action: `Capex/Fiscal data for ${regionLabel}`,
  });

  let macroSnippet = "";
  if (macroResult?.content) {
    const lines = String(macroResult.content).split("\n");
    const dataLines = lines.filter(l => l.startsWith("|") && !l.includes("---") && !l.includes("country |"));
    macroSnippet = dataLines.slice(0, 20).join("\n");
  }

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = new Date().getFullYear();

  // Region-spezifische Pflicht-Programme — verhindern, dass der LLM aktuelle Mega-Pakete
  // übersieht (z.B. One Big Beautiful Bill Act 2025, EU Sondervermögen 2024, Japan Stimulus 2025)
  const MUST_INCLUDE: Record<string, string[]> = {
    US: [
      "One Big Beautiful Bill Act (OBBBA, July 2025) — TCJA-Verlängerung, Bonus-Depreciation, neue Tax-Breaks, ~$3-4T fiscal package",
      "CHIPS and Science Act ($280B, 2022-2032)",
      "Inflation Reduction Act (IRA, $369B+, 2022-2032)",
      "Infrastructure Investment and Jobs Act (IIJA, $1.2T, 2021-2026)",
      "Defense Budget / NDAA FY2025-2026 (~$886-895B jährlich)",
      "Trump Tariffs & Reshoring-Incentives 2025",
      "AI Action Plan / Stargate $500B (Jan 2025)",
      "Section 232 / 301 Tariffs auf Stahl/Aluminium/China-Importe",
    ],
    EU: [
      "NextGenerationEU / Recovery and Resilience Facility (€806B, 2021-2026)",
      "EU Chips Act (€43B, 2023-2030)",
      "REPowerEU (€300B Energie-Unabhängigkeit)",
      "Sondervermögen Bundeswehr (€100B, Deutschland)",
      "Deutsches Sondervermögen Infrastruktur 2025 (€500B, neu beschlossen)",
      "France 2030 (€54B)",
      "PNRR Italien (€191B)",
      "EU Critical Raw Materials Act",
      "EU Net-Zero Industry Act",
    ],
    ASIA: [
      "China Belt & Road Initiative (>$1T)",
      "China Made in 2025 / 2030 Industriepläne",
      "Japan New Capitalism Plan & 2025 Supplementary Budget",
      "Japan TSMC/Rapidus Semiconductor Subsidies (¥4T+)",
      "India Production-Linked Incentive (PLI, $26B+)",
      "South Korea K-Chips Act (₩26T)",
      "China Stimulus Package Sep 2024 / 2025 Property Rescue",
      "Indien Union Budget 2025-26 Capex (₹11.2L Cr)",
    ],
  };
  const mustInclude = (MUST_INCLUDE[region] || MUST_INCLUDE.US).map(s => `  - ${s}`).join("\n");

  const prompt = `Du bist Fiscal-Policy-Analyst bei einem Macro Hedge-Fund (Bridgewater-Style). Aufgabe: Erstelle einen AKTUELLEN, BREITEN Überblick über die wichtigsten Fiskal-/Capex-/Subventions-/Tarif-Programme für die Region ${regionLabel} (Länder: ${countries.join(", ")}) — Stand ${today}.

ECHTE GOVERNMENT-SPENDING-DATEN (Trading Economics):
${macroSnippet || "(keine — bewerte qualitativ)"}

=== KRITISCHE REGELN ===

1. **AKTUALITÄT**: Du MUSST Programme aus ${currentYear - 1} und ${currentYear} mit aufnehmen — nicht nur 2021-2023er Klassiker. Beispiele für ${currentYear}er Pakete in dieser Region:
${mustInclude}

2. **VOLLSTÄNDIGKEIT**: Wenn das genannte Programm tatsächlich existiert (selbst wenn nur angekündigt), liste es. Du darfst KEINE der oben genannten Pflicht-Programme weglassen, sofern sie für diese Region relevant sind.

3. **BREITE statt TIEFE**: Anti-Bias-Pflicht — listet alle Kategorien gleichberechtigt:
   - Defense / Geopolitik / Rüstungsbudgets
   - Energy Transition / Renewables / Wasserstoff
   - Semiconductors / Chips / Tech-Sovereignty
   - Infrastructure / Construction / Transport
   - Healthcare / Biotech / Pandemie-Vorsorge
   - Tax Reforms / TCJA-Extensions / Bonus-Depreciation
   - Tariffs / Trade Policy / Reshoring-Incentives
   - AI / Compute / Datenzentren
   - Reshoring / Onshoring / Buy-American-Style

4. **PROAKTIV**: Suche selbst nach bekannten Mega-Paketen, die ${currentYear} aktuell sind (auch falls oben nicht aufgelistet). Beispiele für die Art von Programmen, die du finden solltest: Mega-Steuerpakete, neue Defense Authorization Acts, neue Sondervermögen, Trump-Era Executive Orders zu Tariffs/Energy, China Property Rescue Packages, Japan Supplementary Budgets, Indien Union Budget Capex.

5. **MENGE**: 10-15 Programme. Liste lieber zu viele als zu wenige.

Ausgabe als JSON:
{
  "programmes": [
    {
      "name": "Programm-Name (mit Jahr falls eindeutig)",
      "category": "Capex Programme" | "Fiscal Stimulus" | "Tax Cut/Incentive" | "Subsidy" | "Deregulation",
      "region": "Land oder Region",
      "amountUSD": "$XXXB oder €XXXB",
      "timeline": "YYYY-YYYY",
      "sectors": ["Sektor1", "Sektor2"],
      "beneficiaries": ["TICKER1", "TICKER2", "Branche"],
      "status": "Active" | "Announced" | "In Implementation" | "Phasing Out",
      "impact": "high" | "medium" | "low",
      "rationale": "1-2 Sätze: WARUM relevant + Marktauswirkung (DEUTSCH)"
    }
  ],
  "totalCapexEstimate": "Aggregierte Schätzung über alle Programme",
  "govSpendingTrend": "1-2 Sätze: Trend Government Spending to GDP basierend auf den echten Daten oben"
}

Antwort ausschließlich auf Deutsch. JSON, keine Prosa drumherum.`;

  const llm = await callLLMJson({ prompt, maxTokens: 1800 });
  if (!llm?.data?.programmes) {
    return {
      region, regionLabel, asOf: new Date().toISOString(),
      programmes: [], totalCapexEstimate: "", govSpendingTrend: "",
    };
  }
  const programmes = (llm.data.programmes as any[]).slice(0, 12).map(p => ({
    name: String(p.name || "Unknown"),
    category: (["Fiscal Stimulus", "Tax Cut/Incentive", "Capex Programme", "Deregulation", "Subsidy"].includes(p.category) ? p.category : "Capex Programme") as any,
    region: String(p.region || regionLabel),
    amountUSD: p.amountUSD ? String(p.amountUSD) : undefined,
    timeline: String(p.timeline || ""),
    sectors: Array.isArray(p.sectors) ? p.sectors.slice(0, 5).map(String) : [],
    beneficiaries: Array.isArray(p.beneficiaries) ? p.beneficiaries.slice(0, 6).map(String) : [],
    status: (["Active", "Announced", "In Implementation", "Phasing Out"].includes(p.status) ? p.status : "Active") as any,
    impact: (["high", "medium", "low"].includes(p.impact) ? p.impact : "medium") as any,
    rationale: String(p.rationale || ""),
  }));
  return {
    region, regionLabel, asOf: new Date().toISOString(),
    programmes,
    totalCapexEstimate: String(llm.data.totalCapexEstimate || ""),
    govSpendingTrend: String(llm.data.govSpendingTrend || ""),
    modelUsed: llm.modelUsed,
  };
}

// ============================================================
// Daily Briefing — Cross-Region Net-New Event Detection
// ============================================================

interface DailyBriefingResult {
  asOf: string;
  generatedAt: string;
  briefing: {
    headline: string;
    summary: string;
    topChanges: Array<{
      rank: number;
      title: string;
      region: string;
      severity: "high" | "medium" | "low";
      changeType: "NEW" | "ESCALATED" | "DIRECTION_FLIP";
      description: string;
      dcfImplications: {
        waccDeltaBps: string; // e.g. "+15 bps" or "-8 bps"
        affectedSectors: string[];
        exposureType: "long" | "short" | "hedge" | "reduce";
      };
      action: string;
    }>;
    keyMetricsShift: {
      inflationView: string;
      rateView: string;
      equityView: string;
    };
    recommendation: string;
  } | null;
  diagnostics: {
    eventsScanned: number;
    netNewEvents: number;
    regionsAnalyzed: string[];
  };
  modelUsed?: string;
}

// Snapshot stores last-known fingerprints per event-title for diff detection
type EventFingerprint = {
  title: string;
  region: string;
  severity: string;
  inflationImpact: string;
  rateImpact: string;
  equityImpact: string;
};

function readBriefingSnapshot(): EventFingerprint[] {
  try {
    const file = path.join(CACHE_DIR, "briefing-snapshot.json");
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(data?.events) ? data.events : [];
  } catch { return []; }
}

function writeBriefingSnapshot(events: EventFingerprint[]) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, "briefing-snapshot.json");
    fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), events }, null, 2));
  } catch (e: any) {
    console.error("[BRIEFING] snapshot write failed:", e?.message);
  }
}

// Daily briefing result cache — keyed by Berlin-date (TZ Europe/Berlin),
// so a Cron-Run um 07:00 morgens und ein User-Klick um 12:00 nachmittags
// teilen sich den gleichen Cache-Eintrag.
function getBerlinDateKey(): string {
  // Europe/Berlin via Intl — robust gegen Sommerzeit-Wechsel
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date()); // "2026-05-10"
}

function readBriefingResultCache(): DailyBriefingResult | null {
  try {
    const file = path.join(CACHE_DIR, "briefing-result.json");
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!raw?.dateKey || raw.dateKey !== getBerlinDateKey()) return null;
    const cached = raw.result as DailyBriefingResult;
    // Mark as cached for the client so the UI can show cache age
    const ageMin = Math.round((Date.now() - new Date(raw.savedAt).getTime()) / 60000);
    return { ...cached, _cached: true, _cacheAgeMin: ageMin, _cachedAt: raw.savedAt } as any;
  } catch (e: any) {
    console.error("[BRIEFING] result cache read failed:", e?.message);
    return null;
  }
}

function writeBriefingResultCache(result: DailyBriefingResult) {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, "briefing-result.json");
    fs.writeFileSync(file, JSON.stringify({
      dateKey: getBerlinDateKey(),
      savedAt: new Date().toISOString(),
      result,
    }, null, 2));
  } catch (e: any) {
    console.error("[BRIEFING] result cache write failed:", e?.message);
  }
}

function normalizeTitle(t: string): string {
  return String(t || "").toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function buildDailyBriefing(): Promise<DailyBriefingResult> {
  const regions = ["US", "EU", "ASIA"];
  const lastSnapshot = readBriefingSnapshot();
  const lastByKey = new Map<string, EventFingerprint>();
  for (const fp of lastSnapshot) lastByKey.set(`${fp.region}|${normalizeTitle(fp.title)}`, fp);

  // Fix: run all 3 regions in PARALLEL (was sequential US→EU→ASIA ~90s)
  const macroResults: Array<{ region: string; data: MacroPulseResult }> = [];
  const macroSettled = await Promise.all(regions.map(async (region) => {
    try {
      const data = await buildMacroPulse(region);
      writeResearcherCache("macro", region, data);
      return { region, data } as { region: string; data: MacroPulseResult };
    } catch (e: any) {
      console.error(`[BRIEFING] macro ${region} failed:`, e?.message);
      return null;
    }
  }));
  for (const r of macroSettled) { if (r) macroResults.push(r); }

  // Diff: net-new = (a) title not in last snapshot, OR (b) severity=high, OR (c) impact direction flipped
  type DiffedEvent = EventFingerprint & {
    description: string;
    rationale: string;
    affectedSectors: string[];
    changeType: "NEW" | "ESCALATED" | "DIRECTION_FLIP";
  };
  const diffed: DiffedEvent[] = [];
  const newSnapshot: EventFingerprint[] = [];

  for (const { region, data } of macroResults) {
    const events = (data?.llmSynthesis?.keyEvents || []) as any[];
    for (const ev of events) {
      const fp: EventFingerprint = {
        title: String(ev.title || ""),
        region,
        severity: String(ev.severity || "low"),
        inflationImpact: String(ev.inflationImpact || "neutral"),
        rateImpact: String(ev.rateImpact || "neutral"),
        equityImpact: String(ev.equityImpact || "gemischt"),
      };
      newSnapshot.push(fp);

      const key = `${region}|${normalizeTitle(fp.title)}`;
      const last = lastByKey.get(key);
      let changeType: "NEW" | "ESCALATED" | "DIRECTION_FLIP" | null = null;

      if (!last) {
        if (fp.severity === "high") changeType = "NEW";
        // Skip net-new low/medium events to keep briefing focused
      } else {
        const flipped =
          last.inflationImpact !== fp.inflationImpact ||
          last.rateImpact !== fp.rateImpact ||
          last.equityImpact !== fp.equityImpact;
        const escalated = last.severity !== "high" && fp.severity === "high";
        if (escalated) changeType = "ESCALATED";
        else if (flipped) changeType = "DIRECTION_FLIP";
      }

      if (changeType) {
        diffed.push({
          ...fp,
          description: String(ev.description || ""),
          rationale: String(ev.rationale || ""),
          affectedSectors: Array.isArray(ev.affectedSectors) ? ev.affectedSectors : [],
          changeType,
        });
      }
    }
  }

  // Persist new snapshot for next diff
  writeBriefingSnapshot(newSnapshot);

  const totalScanned = newSnapshot.length;
  const netNew = diffed.length;

  // No material changes — skip LLM, return stub
  if (netNew === 0) {
    return {
      asOf: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      briefing: {
        headline: "Keine materiellen Veränderungen seit gestern",
        summary: "Alle erkannten Events bleiben in Severity und Impact-Richtung stabil. Risk-Free Rate, Inflation und Equity-Outlook unverändert. Kein Handlungsbedarf vor Open.",
        topChanges: [],
        keyMetricsShift: {
          inflationView: "unverändert",
          rateView: "unverändert",
          equityView: "unverändert",
        },
        recommendation: "Beobachten. Bestehende Positionierung beibehalten.",
      },
      diagnostics: { eventsScanned: totalScanned, netNewEvents: 0, regionsAnalyzed: regions },
    };
  }

  // LLM-Briefing-Prompt — hedge-fund style, < 600 tokens, DCF-focused
  const today = new Date().toISOString().slice(0, 10);
  const eventBlock = diffed.map(e =>
    `- [${e.region}/${e.changeType}/${e.severity}] ${e.title}\n  Inflation: ${e.inflationImpact} | Rate: ${e.rateImpact} | Equity: ${e.equityImpact}\n  Sektoren: ${e.affectedSectors.join(", ") || "—"}\n  ${e.description}\n  Mechanismus: ${e.rationale}`
  ).join("\n\n");

  const prompt = `Du bist Senior Macro Strategist eines Multi-Strategy Hedge-Fund. Verfasse das Pre-Market-Briefing für ${today}, basierend auf den NET-NEW Key Events seit dem letzten Run (gestern).

NET-NEW EVENTS (${diffed.length} Stk., bereits gefiltert auf Severity=high oder DIRECTION_FLIP oder NEW):

${eventBlock}

Aufgabe: Top 3 Changes ranken (nach DCF-Impact + Severity), pro Change DCF-Implikationen ableiten:
- WACC-Delta in Basispunkten (z.B. "+15 bps" wenn Risk-Free Rate steigt) — KONKRETE ZAHL
- Betroffene Sektoren (max 4)
- Exposure-Typ: long | short | hedge | reduce
- Konkrete Action (1 Satz, handlungsrelevant)

JSON-Output, ausschließlich Deutsch, hedge-fund-knapp:
{
  "headline": "1 Zeile: Was ist die wichtigste Änderung? (max 80 Zeichen)",
  "summary": "3-4 Sätze: Pre-Market State of the World. Wie haben sich die Bedingungen seit gestern geshiftet?",
  "topChanges": [
    {
      "rank": 1,
      "title": "Event-Titel",
      "region": "US|EU|ASIA",
      "severity": "high|medium|low",
      "changeType": "NEW|ESCALATED|DIRECTION_FLIP",
      "description": "1-2 Sätze: Kontext + warum es heute matters",
      "dcfImplications": {
        "waccDeltaBps": "+12 bps" | "-8 bps" | "~0 bps",
        "affectedSectors": ["Sektor1", "Sektor2"],
        "exposureType": "long|short|hedge|reduce"
      },
      "action": "1 Satz, hedge-fund-knapp, handlungsrelevant"
    }
  ],
  "keyMetricsShift": {
    "inflationView": "1 Satz: Welche Richtung in den nächsten 30 Tagen?",
    "rateView": "1 Satz: 10Y-Yield-Erwartung / Fed-Pfad",
    "equityView": "1 Satz: Risk-On/Off, Sektor-Rotation"
  },
  "recommendation": "1-2 Sätze: Konkrete Pre-Market-Handlung. Defensive Rotation? Energy-Long? Duration-Cut?"
}

KEINE Floskeln. Jeder Satz muss handlungsrelevant sein. JSON ohne Prosa drumherum.`;

  const llm = await callLLMJson({ prompt, maxTokens: 1400 });
  const briefing = llm?.data || null;

  // Limit to top 3 changes
  if (briefing && Array.isArray(briefing.topChanges)) {
    briefing.topChanges = briefing.topChanges.slice(0, 3);
  }

  return {
    asOf: new Date().toISOString(),
    generatedAt: new Date().toISOString(),
    briefing,
    diagnostics: { eventsScanned: totalScanned, netNewEvents: netNew, regionsAnalyzed: regions },
    modelUsed: llm?.modelUsed,
  };
}

// ============================================================
// Express Routes
// ============================================================

export function registerResearcherRoutes(app: Express) {
  // Tab 1: Country Macro Pulse
  // === Researcher Route Helper ===
  // Chat-First mode: no proxy guard (the 30s pplx.app proxy cut doesn't apply in-chat).
  // Simply run the build, write to cache, return result.
  // In-flight deduplication prevents parallel builds for the same key.
  const inFlight = new Map<string, Promise<any>>();

  async function withProxyGuard<T>(
    res: any,
    cacheKey: string,
    cacheType: string,
    buildFn: () => Promise<T>,
    writeFn: (result: T) => void,
  ): Promise<void> {
    const dedupeKey = `${cacheType}:${cacheKey}`;

    // Deduplicate: if a build is already running for this key, wait for it
    let buildPromise = inFlight.get(dedupeKey);
    if (!buildPromise) {
      buildPromise = buildFn()
        .then((result) => {
          writeFn(result);
          inFlight.delete(dedupeKey);
          return result;
        })
        .catch((err) => {
          inFlight.delete(dedupeKey);
          throw err;
        });
      inFlight.set(dedupeKey, buildPromise);
    } else {
      console.log(`[RESEARCHER] Reusing in-flight build for ${dedupeKey}`);
    }

    try {
      const result = await buildPromise;
      res.json(result);
    } catch (err: any) {
      console.error(`[RESEARCHER] Build failed for ${dedupeKey}:`, err?.message);
      res.status(500).json({ error: err?.message || "analysis failed" });
    }
  }

  app.post("/api/researcher/macro", async (req, res) => {
    const region = String(req.body?.region || "US").toUpperCase();
    const force = req.body?.force === true;
    if (!REGION_COUNTRIES[region]) {
      return res.status(400).json({ error: "Invalid region. Use US, EU, or ASIA." });
    }
    if (!force) {
      const cached = readResearcherCache("macro", region);
      if (cached) {
        console.log(`[RESEARCHER/macro] cache HIT region=${region} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
    }
    console.log(`[RESEARCHER/macro] building region=${region}`);
    await withProxyGuard(res, region, "macro",
      () => buildMacroPulse(region),
      (r) => writeResearcherCache("macro", region, r),
    );
  });

  // Tab 2: Sector Opportunity Map
  app.post("/api/researcher/sectors", async (req, res) => {
    const region = String(req.body?.region || "US").toUpperCase();
    const force = req.body?.force === true;
    if (!REGION_COUNTRIES[region]) {
      return res.status(400).json({ error: "Invalid region. Use US, EU, or ASIA." });
    }
    if (!force) {
      const cached = readResearcherCache("sectors", region);
      if (cached) {
        console.log(`[RESEARCHER/sectors] cache HIT region=${region} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
    }
    console.log(`[RESEARCHER/sectors] building region=${region}`);
    await withProxyGuard(res, region, "sectors",
      () => buildSectorOpportunity(region),
      (r) => writeResearcherCache("sectors", region, r),
    );
  });

  // Tab 3: Undervalued Stock Screener
  app.post("/api/researcher/screener", async (req, res) => {
    const filters: ScreenerFilters = {
      region: String(req.body?.region || "US").toUpperCase(),
      marketCapMin: req.body?.marketCapMin ? Number(req.body.marketCapMin) : undefined,
      marketCapMax: req.body?.marketCapMax ? Number(req.body.marketCapMax) : undefined,
      peMax: req.body?.peMax ? Number(req.body.peMax) : undefined,
      revenueGrowthMin: req.body?.revenueGrowthMin ? Number(req.body.revenueGrowthMin) : undefined,
      sector: req.body?.sector ? String(req.body.sector) : undefined,
    };
    const force = req.body?.force === true;
    const cacheKey = `${filters.region}_mc${filters.marketCapMin || 0}-${filters.marketCapMax || 0}_pe${filters.peMax || 0}_rg${filters.revenueGrowthMin || 0}_${filters.sector || "all"}`;
    if (!force) {
      const cached = readResearcherCache("screener", cacheKey);
      if (cached) {
        console.log(`[RESEARCHER/screener] cache HIT key=${cacheKey} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
    }
    console.log(`[RESEARCHER/screener] building key=${cacheKey}`);
    await withProxyGuard(res, cacheKey, "screener",
      () => buildScreener(filters),
      (r) => writeResearcherCache("screener", cacheKey, r),
    );
  });

  // Tab 4: Capex & Fiscal Tracker
  app.post("/api/researcher/capex", async (req, res) => {
    const region = String(req.body?.region || "US").toUpperCase();
    const force = req.body?.force === true;
    if (!REGION_COUNTRIES[region]) {
      return res.status(400).json({ error: "Invalid region. Use US, EU, or ASIA." });
    }
    if (!force) {
      const cached = readResearcherCache("capex", region);
      if (cached) {
        console.log(`[RESEARCHER/capex] cache HIT region=${region} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
    }
    console.log(`[RESEARCHER/capex] building region=${region}`);
    await withProxyGuard(res, region, "capex",
      () => buildCapexFiscal(region),
      (r) => writeResearcherCache("capex", region, r),
    );
  });

  // Daily Briefing — cross-region net-new event detection (manual + cron)
  // Now parallel (3 regions) + withProxyGuard (was ~90s sequential, now ~30s parallel)
  app.post("/api/researcher/daily-briefing", async (req, res) => {
    const force = req.body?.force === true;
    if (!force) {
      const cached = readBriefingResultCache();
      if (cached) {
        console.log(`[BRIEFING] cache HIT (Berlin-date) age=${(cached as any)._cacheAgeMin}min`);
        return res.json(cached);
      }
    }
    console.log(`[BRIEFING] starting daily briefing build (force=${force})...`);
    await withProxyGuard(res, "daily", "briefing",
      async () => {
        const result = await buildDailyBriefing();
        console.log(`[BRIEFING] complete: ${result.diagnostics.netNewEvents} net-new of ${result.diagnostics.eventsScanned} events`);
        return result;
      },
      (r) => writeBriefingResultCache(r),
    );
  });
}
