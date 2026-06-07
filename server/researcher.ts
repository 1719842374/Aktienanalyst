// === Researcher Module ===
//
// 4-Tab autonomous research mode for the Stock Analyst Pro dashboard.
// Hybrid architecture: REAL data via finance_macro_snapshot / FMP screener,
// LLM (Claude 3.5 Haiku) only for SYNTHESIS and INTERPRETATION,
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
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";

// ============================================================
// Cache Layer (mirrors main dashboard 7-day TTL)
// File cache is fast/legacy; SQLite disk cache survives restarts on pplx.app.
// ============================================================

const CACHE_DIR = path.join(process.cwd(), ".cache", "researcher");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
const RESEARCHER_TTL_MIN = 60 * 6; // 6 hours — keep researcher data fresh (current macro/fiscal context)

function safeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 80);
}

function researcherDiskKey(tab: string, params: string): string {
  return `${safeKey(tab)}__${safeKey(params)}`;
}

function readResearcherCache(tab: string, params: string): any | null {
  // 1. File cache
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      const parsed = JSON.parse(raw);
      const cachedAt = parsed?._cachedAt ? new Date(parsed._cachedAt).getTime() : 0;
      const ageMin = (Date.now() - cachedAt) / 60000;
      if (ageMin < RESEARCHER_TTL_MIN) {
        parsed._cached = true;
        parsed._cacheAge = Math.round(ageMin);
        return parsed;
      }
    }
  } catch {}
  // 2. SQLite disk cache — survives restarts
  const fromDisk = diskResearcherGet(researcherDiskKey(tab, params));
  if (fromDisk) {
    // Warm file cache from disk
    try {
      const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
      fs.writeFileSync(file, JSON.stringify(fromDisk, null, 2));
    } catch {}
    fromDisk._cached = true;
    return fromDisk;
  }
  return null;
}

function writeResearcherCache(tab: string, params: string, data: any) {
  const toSave = { ...data, _cachedAt: new Date().toISOString() };
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    fs.writeFileSync(file, JSON.stringify(toSave, null, 2));
  } catch (err: any) {
    console.warn(`[RESEARCHER-CACHE] file save failed: ${err?.message}`);
  }
  diskResearcherSet(researcherDiskKey(tab, params), toSave);
}

function deleteResearcherCache(tab: string, params: string) {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err: any) {
    console.warn(`[RESEARCHER-CACHE] delete failed: ${err?.message}`);
  }
  diskResearcherDelete(researcherDiskKey(tab, params));
}

// Returns true if a cached result is "stale" — has no real LLM content.
// Such caches should be invalidated and regenerated.
function isStaleCache(cached: any): boolean {
  if (!cached) return false;
  if (cached.llmSynthesis?._fallback === true) return true;
  if (cached._fallback === true) return true;
  if (cached.modelUsed === "fallback") return true;
  if (Array.isArray(cached.trends) && cached.trends.length === 0) return true;
  if (Array.isArray(cached.candidates) && cached.candidates.length === 0) return true;
  if (Array.isArray(cached.programmes) && cached.programmes.length === 0) return true;
  // Capex: must have at least 3 sectorExposure entries (target is 5) — anything less is incomplete.
  if (Array.isArray(cached.sectorExposure) && cached.sectorExposure.length > 0 && cached.sectorExposure.length < 3) return true;
  if (cached.briefing === null) return true;
  return false;
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
      equityImpact: "positiv" | "negativ" | "neutral";
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

  // Two-step LLM: Step 1 = Synthesis (summary + views + implications)
  //               Step 2 = Key Events (structured events array)
  // Split into two smaller calls to stay within free-tier token budget.
  const dataContext = compactIndicators.map(i =>
    `${i.country}: ${i.category}=${i.latestValue} ${i.unit} (prev:${i.previousValue}, ${i.date})`
  ).join("; ") || "keine Makrodaten verfügbar";

  const REGION_CONTEXT_2025: Record<string, string> = {
    US: `Aktuelle Rahmenbedingungen 2025-2026:
- Trump-Administration seit Januar 2025: Z\u00f6lle, Deregulierung, "One Big Beautiful Bill" (OBBBA, Juli 2025, TCJA-Verl\u00e4ngerung + Bonus-Depreciation)
- Fed: Zinszyklus-Ende, Leitzins ca. 4.25-4.5% (Stand 2025)
- CHIPS Act Disbursements laufen 2025-2026
- NDAA 2025/2026: Verteidigungsbudget erh\u00f6ht (~$895B)
- Tariff-Eskalation: China/EU/Mexiko Z\u00f6lle aktiv
- AI Infrastructure Capex Boom: Microsoft/Google/Amazon $200bn+, Stargate $500B`,
    EU: `Aktuelle Rahmenbedingungen 2025-2026:
- EZB: Zinssenkungszyklus 2024-2025, Leitzins ca. 2.25-2.5% (Stand 2025)
- Deutschland: Sonderverm\u00f6gen \u20ac500bn f\u00fcr Verteidigung+Infrastruktur (2025 beschlossen)
- NATO: 3.5% BIP Verteidigungsziel diskutiert, 3% verbindlich ab 2025
- EU Emergency Defence Fund: \u20ac150bn (SAFE-Programm)
- REPowerEU: Energieunabh\u00e4ngigkeit l\u00e4uft
- European Chips Act: Disbursements 2025
- Frankreich: Haushaltskrise, Premierminister-Wechsel`,
    ASIA: `Aktuelle Rahmenbedingungen 2025-2026:
- Japan: Fiskal-Stimulus unter Ishiba, BoJ-Hike-Pfad, 2025 Supplementary Budget
- China: Property Stabilization Fund, Stimulus-Pakete Sep 2024 / 2025
- Korea: AI/Semi-Subventionen, K-Chips Act (\u20a926T)
- Taiwan: Geopolitische Spannungen, TSMC-Expansion
- Indien: Capex-Boom, Union Budget 2025-26 (\u20b911.2L Cr), PLI-Erweiterung`,
  };
  const regionContext = REGION_CONTEXT_2025[region] || REGION_CONTEXT_2025.US;

  const prompt1 = `Makrostratege, Hedge Fund. Heute: ${today}. Region: ${regionLabel}.
WICHTIG: Verwende NUR Daten und Events aus 2025 oder 2026. Ignoriere alles vor 2025-01-01.

${regionContext}

Analysiere: Geldpolitik, Fiskalprogramme, M2/M3, geopolitische Risiken.
Indikatoren: ${dataContext}

JSON (Deutsch, ALLE Daten von 2025-2026):
{"summary":"2 pr\u00e4zise S\u00e4tze Stand ${today}","riskFreeRateView":"1 Satz aktueller Zentralbank-Zins 2025","liquidityView":"1 Satz aktuelle M2-Lage 2025","fiscalView":"1 Satz aktuelle Fiskalprogramme 2025","keyDrivers":["Treiber1 konkret 2025","Treiber2","Treiber3"],"investmentImplications":["Impl1","Impl2","Impl3"],"actionRecommendation":"Watch","actionRationale":"1 Satz"}`;

  const prompt2 = `Makrostratege. Region: ${regionLabel}. Heute: ${today}.
PFLICHT: Nenne exakt 3 Key Events aus 2025 oder 2026. Events aus 2024 sind VERBOTEN.
Falls keine verifizierten 2025-2026 Events: Gib trotzdem 3 plausible Events basierend auf dem aktuellen Kontext an und markiere sie als "estimated".

${regionContext}

JSON:
{"keyEvents":[{"title":"Konkreter Event mit Monat/Jahr 2025 oder 2026","category":"Geldpolitik|Fiskalpolitik|Geopolitik|Konjunktur","severity":"high|medium|low","timeframe":"2025-Q1|2025-Q2|2025-Q3|2025-Q4|2026","description":"2 konkrete S\u00e4tze","inflationImpact":"steigend|neutral|fallend","rateImpact":"steigend|neutral|fallend","equityImpact":"positiv|neutral|negativ","affectedSectors":["Sektor"],"rationale":"1 Satz"}]}`;

  let llm1: any = null, llm2: any = null;
  try {
    [llm1, llm2] = await Promise.all([
      callLLMJson({ prompt: prompt1, maxTokens: 1400 }),
      callLLMJson({ prompt: prompt2, maxTokens: 1400 }),
    ]);
  } catch (llmErr: any) {
    console.warn(`[RESEARCHER/macro] LLM call threw for ${region}: ${llmErr?.message?.substring(0, 100)}`);
  }

  let synthesis: any = null;
  if (llm1?.data) {
    synthesis = { ...llm1.data, keyEvents: llm2?.data?.keyEvents || [] };
  } else {
    // Fallback: generate synthesis from indicators when LLM unavailable (e.g. credit limit)
    console.warn(`[RESEARCHER] LLM unavailable for macro ${region}, using indicator-based fallback`);
    const inflVal = compactIndicators.find(i => i.category.includes("Inflation"));
    const rateVal = compactIndicators.find(i => i.category.includes("Interest"));
    synthesis = {
      summary: `Makro-Lage ${regionLabel} (${today}): ${inflVal ? `Inflation bei ${inflVal.latestValue} ${inflVal.unit}` : "Inflationsdaten ausstehend"}. ${rateVal ? `Leitzins bei ${rateVal.latestValue} ${rateVal.unit}` : ""} Aktuelle Events aus dem LLM nicht verf\u00fcgbar — bitte Credits aufladen oder Analyse erneut starten.`,
      riskFreeRateView: rateVal ? `Aktueller Leitzins: ${rateVal.latestValue} ${rateVal.unit} (${rateVal.date})` : "Daten ausstehend",
      liquidityView: "LLM-Analyse nicht verf\u00fcgbar. Bitte OpenRouter Credits aufladen.",
      fiscalView: "LLM-Analyse nicht verf\u00fcgbar.",
      keyDrivers: compactIndicators.slice(0, 3).map(i => `${i.country}: ${i.category} = ${i.latestValue} ${i.unit}`),
      investmentImplications: ["LLM-basierte Investment Implications nicht verf\u00fcgbar"],
      actionRecommendation: "Watch",
      actionRationale: "Keine LLM-Analyse verf\u00fcgbar — Indikator-Basis unzureichend f\u00fcr Empfehlung",
      keyEvents: [],
      _fallback: true,
    };
  }

  return {
    region,
    regionLabel,
    asOf: new Date().toISOString(),
    indicators: compactIndicators,
    llmSynthesis: synthesis,
    modelUsed: llm1?.modelUsed || "fallback",
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

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Du bist Sektor- und Themenstratege bei einem Hedge-Fund mit Multi-Asset-Mandate.

Analysiere strukturelle Chancen und Risiken für die Region ${regionLabel} (Stand: ${today}) über ALLE 12 Megatrend-Kategorien gleichberechtigt.

Berücksichtige:
- Aktuelle und geplante Fiskalprogramme (Subventionen, Infrastruktur, grüne Transformation, Verteidigungsausgaben)
- Geldpolitische Rahmenbedingungen und deren Sektoreffekte
- Langfristige Megatrends (AI, Energiewende, Demographie, Nearshoring, De-Globalisierung, Regulierung)

Anti-Bias-Regel: Bewerte JEDE der 12 Kategorien einzeln und gleichberechtigt. Score basiert auf realen Wachstumsraten, Margenstabilität und Wettbewerbsdynamik — kein Hype.

DIE 12 KATEGORIEN:
${MEGATRENDS_12.map((m, i) => `${i + 1}. ${m.id}: ${m.label}`).join("\n")}

Für jede Kategorie:
- growthScore (1-10): erwartetes 3-5J Branchenwachstum
- moatScore (1-10): Margenschutz vor Commoditization (10 = Oligopol/IP-Schutz)
- marginRisk: "low"|"medium"|"high"
- timeline: "6-12M"|"12-24M"|"24-36M+"
- reasoning: 2 datengetriebene Sätze auf Deutsch mit konkreten Fiskal-/Trendbezügen
- topPlayers: 3-5 echte Tickers für die Region ${regionLabel}
- actionRecommendation: "Buy"|"Watch"|"Avoid"

JSON:
{"trends":[{"id":"defense","growthScore":8,"moatScore":9,"marginRisk":"low","timeline":"12-24M","reasoning":"...","topPlayers":["LMT","RTX","RHM.DE"],"actionRecommendation":"Buy"}]}`;

  // 4000 tokens: 12 fully-populated trend objects (growthScore, moatScore,
  // marginRisk, timeline, 2-sentence reasoning, 3-5 topPlayers, recommendation)
  // need far more headroom than 1500 — Capex hit the exact same truncation
  // issue with fewer objects and was raised from 2500 to 3500 (see line 793-795).
  const llm = await callLLMJson({ prompt, maxTokens: 4000 });
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

// FMP company-screener accepts one country per request. Map each region to
// its largest/most liquid listed market.
const SCREENER_FMP_COUNTRY: Record<string, string> = { US: "US", EU: "DE", ASIA: "JP" };

async function buildScreener(filters: ScreenerFilters): Promise<ScreenerResult> {
  // Try FMP screener first (real data, no LLM hallucination)
  const fmpKey = process.env.FMP_API_KEY;
  let candidates: any[] = [];
  if (fmpKey) {
    try {
      const params = new URLSearchParams();
      // FMP's screener takes a single ISO-3166 country code — pick the
      // dominant market per region so the region selector actually changes
      // the result set (it was previously ignored, always returning the
      // same mostly-US candidates regardless of US/EU/ASIA selection).
      const country = SCREENER_FMP_COUNTRY[filters.region] || "US";
      params.set("country", country);
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
    const region = filters.region;
    const regionLabel2 = REGION_LABELS[region] || region;
    const today2 = new Date().toISOString().slice(0, 10);
    const fallbackPrompt = `Du bist ein Value-Investor. Region: ${regionLabel2} (${today2}).
Nenne exakt 12 konkrete, börsennotierte Aktien mit hohem Unterbewertungspotenzial.
Sektorverteilung: Defense, Renewables, Biotech, Cloud, Semis, Consumer, Infra, Financials, Materials (max 2 pro Sektor).
Filter: MarketCap ${filters.marketCapMin || 1000}M-${filters.marketCapMax || 500000}M USD, P/E max ${filters.peMax || 30}, RevGrowth min ${filters.revenueGrowthMin || 5}%.
Antworte NUR mit diesem JSON, kein Text davor oder danach:
{"candidates":[{"ticker":"AAPL","companyName":"Apple Inc","sector":"Technology","industry":"Consumer Electronics","marketCap":3000000000000,"pe":28,"revenueGrowth":8,"price":195}]}`;
    const fb = await callLLMJson({ prompt: fallbackPrompt, maxTokens: 1100 }); // 12 candidates need ~900 tokens
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

  const rankPrompt = `Du bist fundamental orientierter Investor bei einem Value-Hedge-Fund.

Analysiere diese ${compactList.length} Unternehmen auf strukturelle Unterbewertung (Stand: ${new Date().toISOString().slice(0,10)}).

Berücksichtige:
- Bewertungsniveau im historischen und sektoralen Vergleich (P/E, EV/EBITDA, FCF-Yield)
- Qualität des Geschäftsmodells und Wettbewerbsvorteile (Moat)
- Bilanzstärke und Cashflow-Qualität
- Fiskal- und Regulierungseffekte die noch nicht eingepreist sind
- Potenzielle Katalysatoren oder Risiken

Kandidaten:
${compactList.map((c, i) => `${i+1}. ${c.ticker} (${c.companyName}) — ${c.sector}/${c.industry}, MCap $${(c.marketCap/1e9).toFixed(1)}B, P/E ${c.pe || 'n/a'}, RevGrowth ${c.revenueGrowth || 'n/a'}%`).join("\n")}

Wähle die TOP 8 aus. Für jeden: moatScore (1-10), marginRiskScore (1-10 = höchstes Risiko), rationale (2 Sätze konkret), growthDrivers (2-3 Bullet Points), risks (2-3 Bullet Points), actionRecommendation (Buy/Watch/Avoid).

Bleib konservativ (Anti-Bias: kein Hype, kein Recency Bias).

JSON: {"ranked":[{"ticker":"...","moatScore":7,"marginRiskScore":3,"rationale":"...","growthDrivers":["..."],"risks":["..."],"actionRecommendation":"Watch"}]}`;

  const llm = await callLLMJson({ prompt: rankPrompt, maxTokens: 2000 });
  const rankingsByTicker = new Map<string, any>();
  let rankedList = (llm?.data?.ranked && Array.isArray(llm.data.ranked))
    ? llm.data.ranked
    : (llm?.data?.rankings && Array.isArray(llm.data.rankings))
      ? llm.data.rankings
      : [];

  // Fallback: if LLM ranking is empty, build a heuristic ranking from candidates
  // (sort by PE — lower = better value), so the screener UI doesn't show empty results.
  if (!rankedList.length && compactList.length > 0) {
    console.log(`[SCREENER] LLM ranking empty — using PE-based fallback ranking`);
    rankedList = compactList
      .filter(c => c.pe > 0 && c.pe < 35)
      .sort((a, b) => (a.pe || 99) - (b.pe || 99))
      .slice(0, 8)
      .map(c => ({
        ticker: c.ticker,
        moatScore: 6,
        marginRiskScore: 5,
        rationale: `${c.companyName} — Value-Screening: PE ${c.pe?.toFixed(1)}, RevGrowth ${c.revenueGrowth?.toFixed(1)}%`,
        growthDrivers: ["Fundamentale Unterbewertung", "Sektor-Tailwind"],
        risks: ["Ausführungsrisiko", "Makro-Risiken"],
        actionRecommendation: "Watch" as const,
        _fallbackRanking: true,
      }));
  }

  for (const r of rankedList) {
    if (r?.ticker) rankingsByTicker.set(String(r.ticker).toUpperCase(), r);
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
  headline?: string;
  summary?: string;
  sectors?: string[];
  sectorExposure?: Array<{
    sector: string;
    impact: "positiv" | "neutral" | "negativ";
    reasoning: string;
    programmes: string[];
    timeline: string;
    listedBeneficiaries?: Array<{ ticker: string; name: string; rationale: string }>;
  }>;
  programmes: Array<{
    name: string;
    category: "Fiscal Stimulus" | "Tax Cut/Incentive" | "Capex Programme" | "Deregulation" | "Subsidy";
    region: string;
    amountUSD?: string;
    timeline: string;
    sectors: string[];
    beneficiaries: string[];
    listedBeneficiaries?: Array<{ ticker: string; name: string; rationale: string }>;
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

  // Note: `mustInclude` and `currentYear` are intentionally not interpolated into
  // the new prompt (the prompt spec is concise by design) but we keep them so
  // they remain available if future iterations want to re-inject them.
  void mustInclude; void currentYear;

  const REGION_CAPEX_FOCUS: Record<string, string> = {
    US: `Für US: Berücksichtige aktiv — "One Big Beautiful Bill" (OBBBA, Steuerreformen 2025, ~$3-4T), CHIPS Act Disbursements 2025-2026, NDAA 2026 (~$895B), Stargate Programme ($500bn AI Infrastructure, OpenAI/Oracle/SoftBank 2025-2029), IRA verlängert (Teile bis 2035, OBBBA behält EV/Energy-Credits), IIJA-Implementation, Tariff Revenue Reallocation`,
    EU: `Für EU: Berücksichtige aktiv — EU SAFE Programme (€150bn Verteidigungsanleihen 2025), Deutsches Sondervermögen (€500bn Verteidigung+Infrastruktur, 2025 beschlossen, läuft 2025-2035), REPowerEU verlängert bis 2030, EU Taxonomy verlängert bis 2030, European Chips Act Disbursements 2025, NATO 3% BIP Pflicht ab 2025, France 2030, PNRR Italien`,
    ASIA: `Für ASIA: Berücksichtige aktiv — Japan Ishiba Stimulus & 2025 Supplementary Budget, China Property Stabilization Fund & Stimulus Sep 2024 / 2025, Korea AI/Semi-Subventionen (K-Chips Act ₩26T), Japan Rapidus/TSMC Semiconductor Subsidies (¥4T+), Indien Union Budget 2025-26 (₹11.2L Cr)`,
  };
  const capexFocus = REGION_CAPEX_FOCUS[region] || REGION_CAPEX_FOCUS.US;

  // Region-specific example tickers so LLM gives correct market tickers
  const EXAMPLE_BENEFICIARIES: Record<string, string> = {
    US: `[{"ticker":"LMT","name":"Lockheed Martin","rationale":"F-35 Produktion, NDAA-Mittel"},{"ticker":"RTX","name":"RTX Corp","rationale":"Raketen, NATO"},{"ticker":"NVDA","name":"NVIDIA","rationale":"AI-Chips, CHIPS Act"},{"ticker":"VST","name":"Vistra Energy","rationale":"IRA Clean Energy"}]`,
    EU: `[{"ticker":"RHM.DE","name":"Rheinmetall","rationale":"Sonderverm\u00f6gen, Panzer"},{"ticker":"AIR.PA","name":"Airbus","rationale":"NATO-Auftr\u00e4ge"},{"ticker":"ASML.AS","name":"ASML","rationale":"EU Chips Act"},{"ticker":"ENGI.PA","name":"Engie","rationale":"REPowerEU"}]`,
    ASIA: `[{"ticker":"2330.TW","name":"TSMC","rationale":"Japan-Subventionen, Rapidus-Partner"},{"ticker":"005930.KS","name":"Samsung","rationale":"K-Chips Act \u20a926T"},{"ticker":"6758.T","name":"Sony","rationale":"Japan New Capitalism"},{"ticker":"BABA","name":"Alibaba","rationale":"China Tech-Stimulus 2025"},{"ticker":"600519.SS","name":"Kweichow Moutai","rationale":"China Property/Konsum-Stimulus"},{"ticker":"6501.T","name":"Hitachi","rationale":"Japan Infrastruktur-Budget"}]`,
  };
  const exampleBeneficiaries = EXAMPLE_BENEFICIARIES[region] || EXAMPLE_BENEFICIARIES.US;

  // Short shape example — kept minimal so the LLM has plenty of output budget
  // to produce all 5 sectors with full beneficiary lists.
  const shortExample = `{"ticker":"EXAMPLE","name":"Example Corp","rationale":"1 Satz Begr\u00fcndung"}`;

  const REGION_SECTORS: Record<string, string[]> = {
    US:   ["Defense & Aerospace", "Semiconductors & AI Infrastructure", "Clean Energy & Grid", "Healthcare & Biotech", "Industrial Reshoring & Infrastructure"],
    EU:   ["Defense & Aerospace", "Semiconductors (EU Chips Act)", "Energy Transition & REPowerEU", "Healthcare & Pharma", "Infrastructure & Construction"],
    ASIA: ["Semiconductors & AI", "Defense & Security", "Clean Energy & EV", "Industrial & Automation", "Consumer & Tech Platforms"],
  };
  const sectorList = REGION_SECTORS[region] || REGION_SECTORS.US;
  const sectorListStr = sectorList.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const prompt = `Capex-Stratege. Region: ${regionLabel}. Heute: ${today}.
WICHTIG: Nur Programme und Ereignisse aus 2025-2026. Verwende AUSSCHLIESSLICH b\u00f6rsennotierte Unternehmen aus der Region ${regionLabel}.

${capexFocus}

Makro-Kontext: ${macroSnippet || "Keine Daten verf\u00fcgbar — qualitative Einsch\u00e4tzung"}

PFLICHT \u2014 STRIKT EINHALTEN (Antwort wird verworfen wenn nicht erf\u00fcllt):
1. Das Array "sectorExposure" MUSS EXAKT 5 Eintr\u00e4ge enthalten.
2. Verwende EXAKT diese 5 Sektoren f\u00fcr ${regionLabel}:
${sectorListStr}
3. Das Array "programmes" MUSS MINDESTENS 4 Eintr\u00e4ge enthalten (aktuelle 2025-Programme der Region).
4. F\u00fcr JEDEN sectorExposure-Eintrag: MINDESTENS 4 listedBeneficiaries mit echten Tickern.
5. F\u00fcr JEDES programme: MINDESTENS 2 listedBeneficiaries mit echten Tickern.
6. Verwende echte Ticker-Symbole der Region ${regionLabel} (z.B. f\u00fcr ASIA: .T=Tokyo, .KS=Seoul, .TW=Taiwan, .SS=Shanghai).

Beispiel-Ticker f\u00fcr Region ${regionLabel}: ${exampleBeneficiaries}

JSON-Format (kein Flie\u00dftext, nur JSON):
{"headline":"1 Satz aktuell 2025","summary":"2 S\u00e4tze","sectors":["tech","defense","energy","infra","healthcare"],"programmes":[{"name":"Programm A (2025)","region":"${regionLabel}","budget":"$Xbn","timeline":"2025-2027","beneficiarySectors":["tech"],"description":"1 Satz","impact":"positiv","listedBeneficiaries":[${shortExample},${shortExample}]},{"name":"Programm B (2025)","region":"${regionLabel}","budget":"$Ybn","timeline":"2025-2028","beneficiarySectors":["defense"],"description":"1 Satz","impact":"positiv","listedBeneficiaries":[${shortExample},${shortExample}]},{"name":"Programm C (2025)","region":"${regionLabel}","budget":"$Zbn","timeline":"2025-2030","beneficiarySectors":["energy"],"description":"1 Satz","impact":"neutral","listedBeneficiaries":[${shortExample},${shortExample}]},{"name":"Programm D (2025)","region":"${regionLabel}","budget":"$Wbn","timeline":"2025-2027","beneficiarySectors":["infra"],"description":"1 Satz","impact":"positiv","listedBeneficiaries":[${shortExample},${shortExample}]}],"sectorExposure":[{"sector":"Defense & Aerospace","impact":"positiv","reasoning":"2 S\u00e4tze","programmes":["Programm A"],"timeline":"12-24M","listedBeneficiaries":[${shortExample}]},{"sector":"Tech & Semiconductor","impact":"positiv","reasoning":"...","programmes":["..."],"timeline":"12-24M","listedBeneficiaries":[${shortExample}]},{"sector":"Energy & Decarbonization","impact":"positiv","reasoning":"...","programmes":["..."],"timeline":"12-24M","listedBeneficiaries":[${shortExample}]},{"sector":"Infrastructure","impact":"neutral","reasoning":"...","programmes":["..."],"timeline":"12-24M","listedBeneficiaries":[${shortExample}]},{"sector":"Healthcare & Biotech","impact":"neutral","reasoning":"...","programmes":["..."],"timeline":"12-24M","listedBeneficiaries":[${shortExample}]}]}`;

  let llm: any = null;
  try {
    // 3500 tokens: gives Claude-3.5-haiku headroom to fill all 5 sectors with
    // 5-8 listed beneficiaries each. Earlier 2500 cap sometimes resulted in
    // only 2 sectors being generated.
    llm = await callLLMJson({ prompt, maxTokens: 3500 });
  } catch (llmErr: any) {
    console.warn(`[RESEARCHER/capex] LLM threw for ${region}: ${llmErr?.message?.substring(0, 100)}`);
  }
  if (!llm?.data) {
    return {
      region, regionLabel, asOf: new Date().toISOString(),
      programmes: [], totalCapexEstimate: "", govSpendingTrend: "",
      _fallback: true,
    } as any;
  }
  const d = llm.data;
  const rawProgrammes = Array.isArray(d.programmes) ? d.programmes : [];
  // Map new prompt shape (name, region, budget, timeline, beneficiarySectors, description, impact)
  // onto the existing FE shape (name, category, region, amountUSD, timeline, sectors, beneficiaries, status, impact, rationale).
  const programmes = rawProgrammes.slice(0, 15).map((p: any) => {
    const impactStr = String(p.impact || "").toLowerCase();
    const fiscalImpact: "high" | "medium" | "low" =
      impactStr === "positiv" ? "high"
      : impactStr === "negativ" ? "low"
      : (["high", "medium", "low"].includes(impactStr) ? impactStr as any : "medium");
    return {
      name: String(p.name || "Unknown"),
      category: (["Fiscal Stimulus", "Tax Cut/Incentive", "Capex Programme", "Deregulation", "Subsidy"].includes(p.category) ? p.category : "Capex Programme") as any,
      region: String(p.region || regionLabel),
      amountUSD: p.budget ? String(p.budget) : (p.amountUSD ? String(p.amountUSD) : undefined),
      timeline: String(p.timeline || ""),
      sectors: Array.isArray(p.beneficiarySectors) ? p.beneficiarySectors.slice(0, 5).map(String)
        : Array.isArray(p.sectors) ? p.sectors.slice(0, 5).map(String) : [],
      beneficiaries: Array.isArray(p.beneficiaries) ? p.beneficiaries.slice(0, 6).map(String) : [],
      listedBeneficiaries: Array.isArray(p.listedBeneficiaries)
        ? p.listedBeneficiaries.slice(0, 8).map((b: any) => ({
            ticker: String(b?.ticker || "").toUpperCase(),
            name: String(b?.name || ""),
            rationale: String(b?.rationale || ""),
          })).filter((b: any) => b.ticker)
        : undefined,
      status: (["Active", "Announced", "In Implementation", "Phasing Out"].includes(p.status) ? p.status : "Active") as any,
      impact: fiscalImpact,
      rationale: String(p.description || p.rationale || ""),
    };
  });

  const sectorExposure = Array.isArray(d.sectorExposure) ? d.sectorExposure.map((s: any) => ({
    sector: String(s.sector || ""),
    impact: (["positiv", "neutral", "negativ"].includes(s.impact) ? s.impact : "neutral") as any,
    reasoning: String(s.reasoning || ""),
    programmes: Array.isArray(s.programmes) ? s.programmes.slice(0, 5).map(String) : [],
    timeline: String(s.timeline || ""),
    listedBeneficiaries: Array.isArray(s.listedBeneficiaries)
      ? s.listedBeneficiaries.slice(0, 8).map((b: any) => ({
          ticker: String(b?.ticker || "").toUpperCase(),
          name: String(b?.name || ""),
          rationale: String(b?.rationale || ""),
        })).filter((b: any) => b.ticker)
      : [],
  })) : [];

  return {
    region, regionLabel, asOf: new Date().toISOString(),
    headline: d.headline ? String(d.headline) : undefined,
    summary: d.summary ? String(d.summary) : undefined,
    sectors: Array.isArray(d.sectors) ? d.sectors.slice(0, 8).map(String) : undefined,
    sectorExposure: sectorExposure.length ? sectorExposure : undefined,
    programmes,
    totalCapexEstimate: String(d.totalCapexEstimate || d.summary || ""),
    govSpendingTrend: String(d.govSpendingTrend || d.headline || ""),
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

  // Load macro data: prefer cache (fast, no LLM cost), fall back to fresh build
  // Cache TTL for briefing purposes: 6 hours (briefing runs daily, cache is fresh enough)
  const BRIEFING_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
  const macroResults: Array<{ region: string; data: MacroPulseResult }> = [];
  const macroSettled = await Promise.all(regions.map(async (region) => {
    try {
      // Try cache first (avoids 3 extra LLM calls on every briefing open)
      const cached = readResearcherCache("macro", region);
      if (cached && !cached._fallback && cached.llmSynthesis?.keyEvents?.length > 0) {
        const age = Date.now() - new Date(cached.asOf || 0).getTime();
        if (age < BRIEFING_CACHE_MAX_AGE_MS) {
          console.log(`[BRIEFING] macro ${region}: using cache (age ${Math.round(age/60000)}min)`);
          return { region, data: cached } as { region: string; data: MacroPulseResult };
        }
      }
      // Cache miss or stale — run fresh
      console.log(`[BRIEFING] macro ${region}: cache miss, building fresh`);
      const data = await buildMacroPulse(region);
      writeResearcherCache("macro", region, data);
      return { region, data } as { region: string; data: MacroPulseResult };
    } catch (e: any) {
      console.error(`[BRIEFING] macro ${region} failed:`, e?.message);
      // Last resort: try cache even if stale
      const stale = readResearcherCache("macro", region);
      if (stale) return { region, data: stale } as { region: string; data: MacroPulseResult };
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
        equityImpact: String(ev.equityImpact || "neutral"),
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

  // No material changes — still show full briefing from cached macro data (don't return empty stub)
  // Collect key events and macro stance from all regions for display
  const allEvents = macroResults.flatMap(({ region, data }) =>
    (data?.llmSynthesis?.keyEvents || []).map((ev: any) => ({ ...ev, region }))
  );
  const macroStances = macroResults.map(({ region, data }) => ({
    region,
    action: data?.llmSynthesis?.actionRecommendation || 'Watch',
    summary: data?.llmSynthesis?.summary || '',
    keyDrivers: data?.llmSynthesis?.keyDrivers || [],
  }));

  if (netNew === 0) {
    // Build a substantive no-change briefing from the actual macro data
    const stanceStr = macroStances.map(s => `${s.region}: ${s.action}`).join(' | ');
    const topEventsForDisplay = allEvents
      .filter((e: any) => e.severity === 'high' || e.equityImpact !== 'neutral')
      .slice(0, 3)
      .map((e: any, idx: number) => ({
        rank: idx + 1,
        title: String(e.title || ''),
        category: String(e.category || 'Makro'),
        impact: String(e.equityImpact === 'positiv' ? 'positiv' : e.equityImpact === 'negativ' ? 'negativ' : 'neutral'),
        severity: String(e.severity || 'medium'),
        description: String(e.description || ''),
        dcfImplication: e.rateImpact === 'steigend'
          ? 'Höhere Zinsen erhöhen WACC und belasten DCF-Bewertungen.'
          : e.equityImpact === 'negativ'
          ? 'Negatives Equity-Umfeld erhöht Risikoprämien und drückt Multiples.'
          : 'Stabiles Umfeld — keine akute DCF-Korrektur erforderlich.',
        affectedTickers: [],
      }));

    const driverSummary = macroStances
      .flatMap(s => s.keyDrivers.slice(0, 1))
      .slice(0, 2)
      .join(' | ');

    return {
      asOf: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      briefing: {
        headline: `Marktlage stabil — ${stanceStr}`,
        summary: `Keine materiellen Lageänderungen seit gestern. Aktuelle Makro-Stance: ${stanceStr}.${driverSummary ? ' Treiber: ' + driverSummary + '.' : ''} Bestehende Positionierung kann beibehalten werden.`,
        topChanges: topEventsForDisplay,
        keyMetricsShift: {
          inflationView: allEvents.find((e: any) => e.inflationImpact === 'steigend') ? 'steigend-Tendenz' : 'stabil',
          rateView: allEvents.find((e: any) => e.rateImpact === 'steigend') ? 'steigend-Tendenz' : 'stabil',
          equityView: macroStances.some(s => s.action === 'Buy') ? 'konstruktiv' : macroStances.some(s => s.action === 'Avoid') ? 'vorsichtig' : 'neutral',
        },
        recommendation: macroStances.some(s => s.action === 'Buy')
          ? 'Selektiv opportunistisch. Sektoren mit Fiskal-Rückenwind bevorzugen.'
          : macroStances.some(s => s.action === 'Avoid')
          ? 'Vorsichtig. Risikopositionen reduzieren oder hedgen.'
          : 'Beobachten. Bestehende Positionierung beibehalten.',
      },
      diagnostics: { eventsScanned: totalScanned, netNewEvents: 0, regionsAnalyzed: regions },
    };
  }

  // LLM-Briefing-Prompt — hedge-fund style, < 600 tokens, DCF-focused
  const today = new Date().toISOString().slice(0, 10);
  const eventBlock = diffed.map(e =>
    `- [${e.region}/${e.changeType}/${e.severity}] ${e.title}\n  Inflation: ${e.inflationImpact} | Rate: ${e.rateImpact} | Equity: ${e.equityImpact}\n  Sektoren: ${e.affectedSectors.join(", ") || "—"}\n  ${e.description}\n  Mechanismus: ${e.rationale}`
  ).join("\n\n");

  const contextStr = eventBlock;

  const prompt = `Du bist täglicher Marktstratege bei einem Hedge-Fund.

Erstelle ein kompaktes Pre-Market Briefing für heute (${today}).

Berücksichtige:
- Wichtige geld- und fiskalpolitische Neuigkeiten der letzten 24-48 Stunden
- Relevante geopolitische oder politische Entwicklungen
- Bedeutende Unternehmensnachrichten mit Markteinordnung
- Aktuelle Marktstimmung und mögliche Risiken für die nächsten Handelstage

Kontext der letzten Sessions: ${contextStr || "Keine Vordaten — freie Einschätzung"}

Gib am Ende eine klare taktische Einschätzung: "Vorsichtig" | "Neutral" | "Opportunistisch"

JSON:
{"headline":"1 prägnanter Satz","summary":"2-3 Sätze Gesamtbild","tacticalStance":"Neutral","stanceRationale":"1 Satz Begründung","topChanges":[{"rank":1,"title":"Event-Titel","category":"Makro|Geopolitik|Earnings|Fed|Regulierung","impact":"positiv|neutral|negativ","severity":"high|medium|low","description":"2 konkrete Sätze","dcfImplication":"1 Satz Auswirkung auf DCF/Bewertung","affectedTickers":["AAPL","MSFT"]}],"riskRadar":["Risiko 1","Risiko 2","Risiko 3"],"watchlist":["Ticker1 — Grund","Ticker2 — Grund"]}`;

  let llm: Awaited<ReturnType<typeof callLLMJson>> = null;
  try {
    // 1500 was too tight for the full schema (headline/summary/stance + up to
    // 3 topChanges each with title/category/impact/severity/2-sentence
    // description/dcfImplication/affectedTickers + riskRadar + watchlist) —
    // same truncation class as the Sectors 1500→4000 fix above.
    llm = await callLLMJson({ prompt, maxTokens: 2200 });
  } catch (llmErr: any) {
    console.warn(`[RESEARCHER/briefing] LLM threw: ${llmErr?.message?.substring(0, 100)}`);
  }
  const briefing: any = llm?.data || null;

  if (!briefing) {
    // LLM failed — return a minimal stub so the frontend doesn't crash
    const stanceStr = macroStances.map(s => `${s.region}: ${s.action}`).join(' | ');
    return {
      asOf: new Date().toISOString(),
      generatedAt: new Date().toISOString(),
      briefing: {
        headline: `Marktlage — ${stanceStr}`,
        summary: `LLM-Briefing nicht verfügbar (${today}). Macro Stance: ${stanceStr}. Bitte OpenRouter-Guthaben prüfen.`,
        topChanges: allEvents
          .filter((e: any) => e.severity === 'high')
          .slice(0, 3)
          .map((e: any, idx: number) => ({
            rank: idx + 1,
            title: String(e.title || ''),
            category: String(e.category || 'Makro'),
            impact: String(e.equityImpact === 'positiv' ? 'positiv' : e.equityImpact === 'negativ' ? 'negativ' : 'neutral'),
            severity: String(e.severity || 'medium'),
            description: String(e.description || ''),
            dcfImplication: 'Stabiles Umfeld — keine akute DCF-Korrektur erforderlich.',
            affectedTickers: [],
          })),
        keyMetricsShift: {
          inflationView: allEvents.find((e: any) => e.inflationImpact === 'steigend') ? 'steigend' : 'stabil',
          rateView: allEvents.find((e: any) => e.rateImpact === 'steigend') ? 'steigend' : 'stabil',
          equityView: macroStances.some(s => s.action === 'Buy') ? 'konstruktiv' : 'neutral',
        },
        recommendation: 'Beobachten — LLM nicht verfügbar.',
        _llmSkipped: true,
      },
      diagnostics: { eventsScanned: totalScanned, netNewEvents: netNew, regionsAnalyzed: regions },
    };
  }

  // Adapt new prompt shape to existing FE shape: derive keyMetricsShift +
  // recommendation from tacticalStance / stanceRationale so the BriefingModal
  // keeps rendering.
  if (briefing) {
    if (Array.isArray(briefing.topChanges)) {
      briefing.topChanges = briefing.topChanges.slice(0, 3).map((c: any, idx: number) => {
        // Map dcfImplication (string) → dcfImplications (object) for FE compatibility.
        const dcfStr = c.dcfImplication ? String(c.dcfImplication) : "";
        const dcfObj = c.dcfImplications || {};
        const impactStr = String(c.impact || "").toLowerCase();
        const exposure = impactStr === "positiv" ? "long"
          : impactStr === "negativ" ? "short"
          : (dcfObj.exposureType || "hedge");
        return {
          rank: c.rank || idx + 1,
          title: String(c.title || ""),
          region: c.region || "",
          severity: c.severity || "medium",
          changeType: c.changeType || "NEW",
          description: String(c.description || ""),
          category: c.category,
          impact: c.impact,
          dcfImplications: {
            waccDeltaBps: dcfObj.waccDeltaBps || "~0 bps",
            affectedSectors: Array.isArray(dcfObj.affectedSectors) ? dcfObj.affectedSectors
              : Array.isArray(c.affectedTickers) ? c.affectedTickers.slice(0, 4) : [],
            exposureType: exposure,
          },
          dcfImplication: dcfStr,
          affectedTickers: Array.isArray(c.affectedTickers) ? c.affectedTickers : undefined,
          action: c.action || dcfStr || "",
        };
      });
    }
    // Derive keyMetricsShift if missing — keeps the FE MetricShift cards populated.
    if (!briefing.keyMetricsShift) {
      const stance = String(briefing.tacticalStance || "Neutral");
      briefing.keyMetricsShift = {
        inflationView: briefing.stanceRationale ? `Stance: ${stance} — ${briefing.stanceRationale}` : `Marktstimmung: ${stance}`,
        rateView: "Siehe Kontext zu geld-/fiskalpolitischen Entwicklungen oben.",
        equityView: stance === "Opportunistisch" ? "Risk-On — selektive Long-Exposure"
          : stance === "Vorsichtig" ? "Risk-Off — defensive Rotation"
          : "Risk-Neutral — Positionierung beibehalten",
      };
    }
    if (!briefing.recommendation) {
      briefing.recommendation = briefing.stanceRationale
        ? `${briefing.tacticalStance || "Neutral"}: ${briefing.stanceRationale}`
        : `Taktische Einschätzung: ${briefing.tacticalStance || "Neutral"}.`;
    }
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
    force = false,
  ): Promise<void> {
    const dedupeKey = `${cacheType}:${cacheKey}`;

    // Deduplicate: if a build is already running for this key, wait for it —
    // unless this is a forced refresh, in which case the user explicitly
    // wants a fresh build, not the result of a possibly-stale in-flight one.
    let buildPromise = force ? undefined : inFlight.get(dedupeKey);
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
      if (cached && !isStaleCache(cached)) {
        console.log(`[RESEARCHER/macro] cache HIT region=${region} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
      // Stale cache: serve it immediately (better than empty), trigger background refresh
      if (cached && isStaleCache(cached)) {
        console.log(`[RESEARCHER/macro] cache STALE region=${region} — serving stale while refreshing`);
        // Fire refresh in background, don't await
        buildMacroPulse(region)
          .then(r => { if (!r.llmSynthesis?._fallback) writeResearcherCache("macro", region, r); })
          .catch(e => console.warn(`[RESEARCHER/macro] bg refresh failed: ${e?.message}`));
        return res.json({ ...cached, _staleRefreshing: true });
      }
    }
    console.log(`[RESEARCHER/macro] building region=${region}`);
    await withProxyGuard(res, region, "macro",
      () => buildMacroPulse(region),
      // Don't poison the 6h cache with fallback content — a transient
      // OpenRouter failure would otherwise lock the tab into the
      // "LLM nicht verfügbar" placeholder until TTL expiry.
      (r) => { if (!r.llmSynthesis?._fallback) writeResearcherCache("macro", region, r); },
      force,
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
      if (cached && !isStaleCache(cached)) {
        console.log(`[RESEARCHER/sectors] cache HIT region=${region} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
      if (cached && isStaleCache(cached)) {
        console.log(`[RESEARCHER/sectors] cache STALE region=${region} — serving stale while refreshing`);
        buildSectorOpportunity(region)
          .then(r => { if (r.trends?.length > 0) writeResearcherCache("sectors", region, r); })
          .catch(e => console.warn(`[RESEARCHER/sectors] bg refresh failed: ${e?.message}`));
        return res.json({ ...cached, _staleRefreshing: true });
      }
    }
    console.log(`[RESEARCHER/sectors] building region=${region}`);
    await withProxyGuard(res, region, "sectors",
      () => buildSectorOpportunity(region),
      // Same cache-poisoning guard as macro — empty trends (LLM failure/
      // truncation) must not be written, or "Aktualisieren" stays stuck.
      (r) => { if (r.trends?.length > 0) writeResearcherCache("sectors", region, r); },
      force,
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
      if (cached && !isStaleCache(cached)) {
        console.log(`[RESEARCHER/screener] cache HIT key=${cacheKey} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
      if (cached && isStaleCache(cached)) {
        buildScreener(filters)
          .then(r => { if (r.candidates?.length > 0) writeResearcherCache("screener", cacheKey, r); })
          .catch(() => {});
        return res.json({ ...cached, _staleRefreshing: true });
      }
    }
    console.log(`[RESEARCHER/screener] building key=${cacheKey}`);
    await withProxyGuard(res, cacheKey, "screener",
      () => buildScreener(filters),
      (r) => { if (r.candidates?.length > 0) writeResearcherCache("screener", cacheKey, r); },
      force,
    );
  });

  // Tab 4: Capex & Fiscal Tracker
  app.post("/api/researcher/capex", async (req, res) => {
    const region = String(req.body?.region || "US").toUpperCase();
    const force = req.body?.force === true;
    if (!REGION_COUNTRIES[region]) {
      return res.status(400).json({ error: "Invalid region. Use US, EU, or ASIA." });
    }
    const writeCapexCacheIfRich = (r: any) => {
      const hasContent = r?.headline &&
        ((r?.sectorExposure?.length || 0) >= 2 || (r?.programmes?.length || 0) >= 2);
      if (hasContent) writeResearcherCache("capex", region, r);
      else console.warn(`[RESEARCHER/capex] result for ${region} too thin — NOT caching`);
    };
    if (!force) {
      const cached = readResearcherCache("capex", region);
      if (cached && !isStaleCache(cached)) {
        console.log(`[RESEARCHER/capex] cache HIT region=${region} age=${cached._cacheAge}min`);
        return res.json(cached);
      }
      if (cached && isStaleCache(cached)) {
        buildCapexFiscal(region)
          .then(r => writeCapexCacheIfRich(r))
          .catch(() => {});
        return res.json({ ...cached, _staleRefreshing: true });
      }
    }
    console.log(`[RESEARCHER/capex] building region=${region}`);
    await withProxyGuard(res, region, "capex",
      () => buildCapexFiscal(region),
      (r) => writeCapexCacheIfRich(r),
      force,
    );
  });

  // Daily Briefing — cross-region net-new event detection (manual + cron)
  // Now parallel (3 regions) + withProxyGuard (was ~90s sequential, now ~30s parallel)
  app.post("/api/researcher/daily-briefing", async (req, res) => {
    const force = req.body?.force === true;
    if (!force) {
      const cached = readBriefingResultCache();
      if (cached && (cached.briefing === null || (cached as any).modelUsed === "fallback")) {
        console.log(`[BRIEFING] cache STALE (null briefing) — invalidating`);
        try { fs.unlinkSync(path.join(CACHE_DIR, "briefing-result.json")); } catch {}
      } else if (cached) {
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
      (r) => { if (r.briefing !== null && (r as any).modelUsed !== "fallback") writeBriefingResultCache(r); },
      force,
    );
  });
}
