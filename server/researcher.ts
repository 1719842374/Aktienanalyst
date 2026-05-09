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

  const prompt = `Du bist Hedge-Fund-Stratege bei einem globalen Macro-Fonds. Analysiere die folgenden REAL-DATEN für die Region ${regionLabel} (Länder: ${countries.join(", ")}).

ECHTE MAKRO-DATEN (aus Trading Economics / FRED, ${new Date().toISOString().slice(0, 10)}):
${compactIndicators.map(i => `- ${i.country}: ${i.category} = ${i.latestValue} ${i.unit} (vorher: ${i.previousValue}, ${i.date})`).join("\n") || "(keine Daten verfügbar — bewerte qualitativ)"}

Gib eine professionelle Bewertung als JSON zurück:
{
  "summary": "3-4 Sätze Gesamtbild der Makro-Lage in ${regionLabel}",
  "keyDrivers": ["3-5 wichtigste Treiber als Bullet-Punkte"],
  "riskFreeRateView": "1-2 Sätze: Trend Risk-Free Rate, Implikation für Equity-Bewertungen",
  "liquidityView": "1-2 Sätze: Geldmengenwachstum / Liquiditätszyklus / QT-vs-QE-Position",
  "fiscalView": "1-2 Sätze: Fiskalprogramme / Government Spending Trend",
  "investmentImplications": ["3-5 konkrete Implikationen für Anleger (Sektor-Tilts, Duration, Currency, etc.)"],
  "actionRecommendation": "Buy | Watch | Avoid",
  "actionRationale": "1-2 Sätze warum diese Empfehlung"
}

Sei DATENGETRIEBEN — leite jede Aussage aus den obigen Zahlen ab. Keine generischen Floskeln. Antwort ausschließlich auf Deutsch.`;

  const llm = await callLLMJson({ prompt, maxTokens: 1500 });
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

  const llm = await callLLMJson({ prompt, maxTokens: 3000 });
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

  const llm = await callLLMJson({ prompt: rankPrompt, maxTokens: 2400 });
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

  const prompt = `Du bist Fiscal-Policy-Analyst bei einem Macro Hedge-Fund. Liste die wichtigsten AKTIVEN Fiskal-/Capex-Programme und Steueranreize für die Region ${regionLabel} (Länder: ${countries.join(", ")}) — Stand ${new Date().toISOString().slice(0, 10)}.

ECHTE GOVERNMENT-SPENDING-DATEN (Trading Economics):
${macroSnippet || "(keine — bewerte qualitativ)"}

WICHTIG — Anti-Bias-Regel:
- Listing soll BREIT sein, nicht nur AI-Capex
- Berücksichtige: Defense (NATO 2%, BIP-Sondervermögen), Energy Transition (IRA, EU Green Deal, EU Net Zero), Infrastructure (CHIPS Act, US Infrastructure Bill, EU Connecting Europe Facility), Tax Reforms (Steuersenkungen), Health (BARDA, EU4Health), Reshoring/Onshoring, Semiconductor (CHIPS Act, EU Chips Act, Made in China 2025)

Liste 8-12 KONKRETE Programme mit JSON:
{
  "programmes": [
    {
      "name": "CHIPS and Science Act",
      "category": "Capex Programme",
      "region": "United States",
      "amountUSD": "$280B",
      "timeline": "2022-2032",
      "sectors": ["Semiconductors", "Manufacturing"],
      "beneficiaries": ["INTC", "TSM", "MU"],
      "status": "In Implementation",
      "impact": "high",
      "rationale": "1-2 Sätze warum dieses Programm relevant ist (DEUTSCH)"
    }
  ],
  "totalCapexEstimate": "Aggregierte Schätzung der Programmsumme über alle gelisteten Programme",
  "govSpendingTrend": "1-2 Sätze: Trend Government Spending to GDP basierend auf den echten Daten oben"
}

Antwort ausschließlich auf Deutsch.`;

  const llm = await callLLMJson({ prompt, maxTokens: 2400 });
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
// Express Routes
// ============================================================

export function registerResearcherRoutes(app: Express) {
  // Tab 1: Country Macro Pulse
  app.post("/api/researcher/macro", async (req, res) => {
    try {
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
      const result = await buildMacroPulse(region);
      writeResearcherCache("macro", region, result);
      res.json(result);
    } catch (err: any) {
      console.error("[RESEARCHER/macro] error:", err?.message);
      res.status(500).json({ error: err?.message || "macro analysis failed" });
    }
  });

  // Tab 2: Sector Opportunity Map
  app.post("/api/researcher/sectors", async (req, res) => {
    try {
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
      const result = await buildSectorOpportunity(region);
      writeResearcherCache("sectors", region, result);
      res.json(result);
    } catch (err: any) {
      console.error("[RESEARCHER/sectors] error:", err?.message);
      res.status(500).json({ error: err?.message || "sectors analysis failed" });
    }
  });

  // Tab 3: Undervalued Stock Screener
  app.post("/api/researcher/screener", async (req, res) => {
    try {
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
      const result = await buildScreener(filters);
      writeResearcherCache("screener", cacheKey, result);
      res.json(result);
    } catch (err: any) {
      console.error("[RESEARCHER/screener] error:", err?.message);
      res.status(500).json({ error: err?.message || "screener failed" });
    }
  });

  // Tab 4: Capex & Fiscal Tracker
  app.post("/api/researcher/capex", async (req, res) => {
    try {
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
      const result = await buildCapexFiscal(region);
      writeResearcherCache("capex", region, result);
      res.json(result);
    } catch (err: any) {
      console.error("[RESEARCHER/capex] error:", err?.message);
      res.status(500).json({ error: err?.message || "capex analysis failed" });
    }
  });
}
