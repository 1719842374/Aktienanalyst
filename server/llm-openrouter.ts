// === OpenRouter LLM Client + Combined Catalyst-and-Sentiment Call ===
//
// Cost-optimised replacement for the previous two separate Anthropic calls
// (generateLLMCatalysts + matchNewsToCatalysts).
//
// Why this exists:
// - The previous Computer-Sandbox Sonnet calls cost ~10-15 credits per analysis.
// - OpenRouter routes to cheaper models (Haiku 3.5 ~3x cheaper than Sonnet 4.5)
//   AND combines both LLM calls into ONE round trip — saves ~80% on credits.
// - Default model: anthropic/claude-3-5-haiku — best price/quality for this task
//   in May 2026. Set OPENROUTER_MODEL env var to override.
//
// Model Strategy (May 2026):
// - Default: anthropic/claude-3-5-haiku-20241022 (cheap + fast + good JSON)
// - Alternative: x-ai/grok-4-1-fast (similar tier; gets retired 15 May 2026)
//   *** IMPORTANT: x-ai/grok-4-1-fast retires on 2026-05-15. After that date
//   *** OpenRouter will return 404. Use Haiku-3.5 or Grok-4.3 instead.

import OpenAI from "openai";
import type { Catalyst, Risk, RiskExplanation } from "../shared/schema";

// Lazy singleton — created on first call so missing env var doesn't crash boot.
let openrouterClient: OpenAI | null = null;
function getClient(): OpenAI | null {
  if (openrouterClient) return openrouterClient;
  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key) {
    console.warn("[LLM] OPENROUTER_API_KEY not set — LLM features unavailable");
    return null;
  }
  openrouterClient = new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      // OpenRouter recommends these for analytics/leaderboards
      "HTTP-Referer": "https://stockanalyst.pplx.app",
      "X-Title": "Stock Analyst Pro",
    },
  });
  return openrouterClient;
}

// Pick the model based on the current date and OPENROUTER_MODEL override.
//
// MODEL STRATEGY (May 2026):
//   DEFAULT  : x-ai/grok-4.1-fast   — ~85% cheaper than Haiku 3.5, good JSON output
//   FALLBACK : anthropic/claude-3.5-haiku  (set PREFER_GROK=0 to switch back)
//
// IMPORTANT: x-ai/grok-4.1-fast is scheduled for retirement on 2026-05-15.
// After that date the date-guard auto-switches to x-ai/grok-4.3.
//
// Verified OpenRouter model IDs (queried 2026-05-08, ping confirmed):
//   x-ai/grok-4.1-fast            — DEFAULT, retires 2026-05-15 (→ grok-4.3)
//   x-ai/grok-4.3                 — auto-successor after 2026-05-16
//   x-ai/grok-4-fast              — cheapest grok variant
//   anthropic/claude-3.5-haiku    — fallback when PREFER_GROK=0
//   anthropic/claude-haiku-4.5    — newer Haiku, slightly pricier
//
// Switching guide for the user:
//   1. Default (no env)     → grok-4.1-fast (cheapest, current default)
//   2. PREFER_GROK=0        → anthropic/claude-3.5-haiku (more deterministic)
//   3. OPENROUTER_MODEL=... → hard override (any OpenRouter ID)
function pickModel(): string {
  const override = process.env.OPENROUTER_MODEL;
  if (override) return override;
  // Primary: Claude 3.5 Haiku — $0.80/$4.00 per M tokens
  // Same account (Stock_Analyst) already used this model successfully.
  // Fast structured JSON, company-specific outputs, 200K context.
  return "anthropic/claude-3.5-haiku";
}

// Fallback chain — Stock_Analyst OpenRouter account (has $0.113 credit)
// Claude 3.5 Haiku → Claude 3 Haiku (cheapest) → Grok 4.3 (was "Grok 4.1 Fast")
const MODEL_FALLBACK_CHAIN = [
  "anthropic/claude-3.5-haiku",  // $0.80/$4.00 per M — primary, best JSON
  "anthropic/claude-3-haiku",     // $0.25/$1.25 per M — cheapest fallback
  "x-ai/grok-4.3",               // $1.25/$2.50 per M — Grok fallback
];

// Make one LLM call with automatic model fallback on 429/402.
// Returns { text, modelUsed } or throws after all fallbacks exhausted.
async function callWithFallback(client: OpenAI, params: Omit<Parameters<OpenAI['chat']['completions']['create']>[0], 'model'>): Promise<{ text: string; modelUsed: string; usage?: any }> {
  const override = process.env.OPENROUTER_MODEL;
  const chain = override ? [override] : MODEL_FALLBACK_CHAIN;
  let lastErr: any;
  for (const model of chain) {
    try {
      const isGrok = model.startsWith('x-ai/');
      const completion = await (client.chat.completions.create as any)({
        ...params,
        model,
        ...(isGrok ? { reasoning: { effort: 'none' } } : {}),
      });
      const text = completion.choices?.[0]?.message?.content?.trim() || '';
      if (!text) { lastErr = new Error('Empty response'); continue; }
      return { text, modelUsed: model, usage: completion.usage };
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      if (status === 429 || status === 402) {
        console.warn(`[LLM] ${model} rate-limited (${status}) — trying next model`);
        lastErr = err;
        // Small delay before trying next model — helps rate-limit recovery
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err; // non-retryable error
    }
  }
  throw lastErr || new Error('All LLM models exhausted');
}

export interface CapexBeneficiary {
  ticker: string;
  name: string;
  rationale: string;
}

export interface CapexTailwindContext {
  sector: string;         // e.g. "Defense & Aerospace"
  impact: string;         // "positiv" | "neutral" | "negativ"
  timeline: string;       // e.g. "12-24M"
  reasoning: string;      // sector reasoning
  programmes: string[];   // programme names
  beneficiaryEntry: CapexBeneficiary; // the matched entry for this ticker
}

export interface CombinedLLMInput {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description: string;
  revenue: number;
  revenueGrowth: number;
  fcfMargin: number;
  price: number;
  pe: number;
  marketCap: number;
  analystPTMedian?: number;    // optional — used in richer prompt context
  governmentExposure?: number; // optional — used in richer prompt context
  capexContext?: CapexTailwindContext | null; // optional — Capex Fiscal Spending tailwind if ticker found in Researcher cache
  keyProjects: string[];
  secFilingExcerpts: string[];
  newsItems: {
    title: string;
    source: string;
    relativeTime: string;
    pubDate: string;
    url: string;
    sentiment?: string;
    sentimentScore?: number;
    matchedCatalyst?: string;
    matchedCatalystIdx?: number;
  }[];
}

export interface CombinedLLMResult {
  catalysts: Catalyst[];
  modelUsed: string;
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Combined LLM call — returns 5 company-specific catalysts AND tags every
 * news item with sentiment + catalyst-match in a SINGLE request.
 *
 * Replaces the previous two-call flow (generateLLMCatalysts + matchNewsToCatalysts)
 * which cost ~10-15 credits per analysis. This single call costs ~3-4 credits
 * with Haiku 3.5 — roughly 70-80% saving per KI-analysis.
 *
 * Returns null if the LLM call fails OR returns malformed JSON, so the caller
 * can fall back to sector-template catalysts and skip news sentiment.
 */
export async function generateCatalystsAndMatchNews(
  input: CombinedLLMInput
): Promise<CombinedLLMResult | null> {
  const client = getClient();
  if (!client) return null;

  const model = pickModel();
  const {
    ticker, companyName, sector, industry, description, revenue, revenueGrowth,
    fcfMargin, price, pe, marketCap, keyProjects, secFilingExcerpts, newsItems,
    analystPTMedian = 0, governmentExposure = 0, capexContext = null,
  } = input;

  // Compact context — keep prompt under ~1500 input tokens to keep cost low.
  // Build rich company context — more detail = more specific catalysts
  const ctx: string[] = [];
  ctx.push(`Unternehmen: ${companyName} (${ticker}) | Sektor: ${sector} / ${industry}`);
  // Full description — key for non-US companies with no SEC filings
  ctx.push(`Beschreibung: ${description.substring(0, 1000)}`);
  ctx.push(`Finanzen: Umsatz ${revenue > 0 ? '$' + (revenue / 1e9).toFixed(1) + 'B' : 'N/A'} | Wachstum ${revenueGrowth != null && revenueGrowth !== 0 ? revenueGrowth.toFixed(1) + '%' : 'N/A'} | FCF-Marge ${fcfMargin > 0 ? fcfMargin.toFixed(1) + '%' : 'N/A'} | KGV ${pe > 0 ? pe.toFixed(1) : 'N/A'} | MCap ${marketCap > 0 ? '$' + (marketCap / 1e9).toFixed(1) + 'B' : 'N/A'}`);
  ctx.push(`Kurs: $${price.toFixed(2)} | Analyst-PT: $${analystPTMedian > 0 ? analystPTMedian.toFixed(2) : 'N/A'} | Gov-Exposure: ${(governmentExposure * 100).toFixed(0)}%`);
  if (capexContext) {
    ctx.push(`CAPEX FISCAL TAILWIND: ${ticker} ist börsennotierter Profiteur im Sektor "${capexContext.sector}" (Impact: ${capexContext.impact}, Zeithorizont: ${capexContext.timeline}). Programme: ${capexContext.programmes.join(", ")}. Researcher-Begründung: ${capexContext.beneficiaryEntry.rationale}`);
  }
  if (keyProjects.length > 0) {
    ctx.push(`SEC-Projekte/Verträge (10-K): ${keyProjects.slice(0, 10).join(", ")}`);
  }
  if (secFilingExcerpts.length > 0) {
    ctx.push(`SEC-Auszüge: ${secFilingExcerpts.slice(0, 3).map(e => e.substring(0, 250)).join(" | ")}`);
  }

  // News list — put most recent first, use full title so deals/numbers are visible
  const newsList = newsItems
    .slice(0, 8)
    .map((n, i) => `N${i + 1} [${n.relativeTime}]: "${n.title.substring(0, 160)}" (${n.source})`)
    .join("\n");

  const prompt = `Du bist Senior Equity Analyst mit Spezialisierung auf ${sector}. Analysiere ${companyName} (${ticker}) und generiere 5 konkrete, firmenspezifische Katalysatoren.

UNTERNEHMENSDATEN:
${ctx.join("\n")}

${newsList ? `AKTUELLE NEWS (wichtig: nutze diese für konkrete Deals/Events):\n${newsList}\n` : ""}

PFLICHT-REGELN — strikte Einhaltung:
1. VERBOTEN sind generische Namen wie "Revenue Growth", "Margin Expansion", "Market Share Gains" — NUR firmenspezifische Namen erlaubt
2. Jeder Katalysator MUSS eine echte Firmenreferenz enthalten: konkrete Deal-Namen, Kapazitätszahlen (GW, MW), Partner-Namen, Produkte, Verträge oder Geographien aus den News/SEC-Daten oben
3. Wenn News einen konkreten Deal erwähnen (z.B. "Nvidia-Deal $3.4Bn", "Sweetwater Campus"), muss er als eigener Katalysator erscheinen
4. Bei fehlenden News: nutze description + sector-knowledge für plausible firmenspezifische Treiber (keine Schablonen)
5. Anti-Bias: mindestens 1 Katalysator muss echtes Downside-Risiko reflektieren (niedrigere PoS ≤ 40%)
6. context auf Deutsch, präzise mit Zahlen wenn vorhanden (z.B. "3,4 Mrd. USD Vertrag", "4,5 GW gesicherter Kapazität")
${capexContext ? `7. PFLICHT: Da ${ticker} als Capex-Profiteur im Sektor "${capexContext.sector}" identifiziert wurde (Programme: ${capexContext.programmes.join(", ")}), MUSS Katalysator K1 oder K2 einen "Capex Tailwind"-Katalysator enthalten mit dem Programmnamen im Titel (z.B. "${capexContext.sector} Capex Tailwind: ${capexContext.programmes[0] || "Gov Spending"}") und PoS ≥ 55%.` : ""}

GUTE Beispiele (firmenspezifisch):
- "Nvidia AI-Cloud-Deal Execution" (CoreWeave) — konkreter $3.4Bn Deal
- "Sweetwater Power Campus Ramp-up" (CoreWeave) — 4,5 GW Kapazität
- "FSD/Robotaxi Commercialization Q3" (TSLA) — spezifisches Produkt
- "Blue Creek Mine First Coal" (HCC) — konkretes Projekt
- "Ozempic EU Zulassung Adipositas" (NVO) — konkretes Medikament/Markt

SCHLECHTE Beispiele (verboten):
- "Revenue Growth Acceleration" — zu generisch
- "Margin Expansion / Operating Leverage" — zu generisch
- "Market Share Gains" — kein Firmenkontext
- "AI / Cloud Adoption Tailwind" — Sektor-Template, nicht firmenspezifisch

Antworte NUR mit diesem JSON (kein Markdown, keine Erklärungen):
{"catalysts":[{"name":"Firmenspezifischer Name ≤50 Zeichen","context":"Deutsche Erklärung mit konkreten Zahlen/Namen, 1-2 Sätze","timeline":"6-12M|12-18M|12-24M|12-36M","pos":20-80,"bruttoUpside":5-35,"einpreisungsgrad":20-65}],"newsMatches":[{"idx":1,"sentiment":"bullish|bearish|neutral","score":-1.0,"catalyst":"K1|K2|K3|K4|K5|none"}]}`;

  try {
    console.log(`[LLM] Calling (with fallback) for ${ticker} (combined catalyst+news, news_count=${newsItems.length})`);
    const t0 = Date.now();
    const result = await callWithFallback(client, {
      max_tokens: 900,
      temperature: 0.4,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" } as any,
    });
    const { text, modelUsed: usedModel, usage } = result;
    const elapsedMs = Date.now() - t0;
    console.log(`[LLM] Used model: ${usedModel} for ${ticker} (${elapsedMs}ms)`);
    if (!text) {
      console.warn(`[LLM] Empty response from ${usedModel}`);
      return null;
    }

    // Strip markdown fences and preamble text before JSON
    let jsonStr = text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    }
    const _preambleIdx = jsonStr.search(/[{\[]/);
    if (_preambleIdx > 0) {
      jsonStr = jsonStr.substring(_preambleIdx);
      const _lastClose = Math.max(jsonStr.lastIndexOf('}'), jsonStr.lastIndexOf(']'));
      if (_lastClose >= 0) jsonStr = jsonStr.substring(0, _lastClose + 1);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn(`[LLM] JSON parse failed for ${ticker}: ${(parseErr as any)?.message}`);
      return null;
    }

    const rawCatalysts = parsed.catalysts;
    const newsMatches = parsed.newsMatches || [];

    if (!Array.isArray(rawCatalysts) || rawCatalysts.length < 3) {
      console.warn(`[LLM] Invalid catalyst array length=${rawCatalysts?.length} for ${ticker}`);
      return null;
    }

    // Build Catalyst objects with computed fields
    const catalysts: Catalyst[] = rawCatalysts.slice(0, 5).map((c: any) => {
      const pos = Math.max(20, Math.min(80, Number(c.pos) || 50));
      const bruttoUpside = Math.max(3, Math.min(35, Number(c.bruttoUpside) || 10));
      const einpreisungsgrad = Math.max(15, Math.min(65, Number(c.einpreisungsgrad) || 35));
      const nettoUpside = +(bruttoUpside * (1 - einpreisungsgrad / 100)).toFixed(2);
      const gb = +(pos / 100 * nettoUpside).toFixed(2);
      return {
        name: String(c.name || "Unknown Catalyst").substring(0, 60),
        timeline: String(c.timeline || "12-24M"),
        pos, bruttoUpside, einpreisungsgrad, nettoUpside, gb,
        context: String(c.context || ""),
      };
    });

    // Apply news sentiment to newsItems in-place + adjust catalyst PoS
    if (Array.isArray(newsMatches) && newsMatches.length && newsItems.length) {
      for (const m of newsMatches) {
        const newsIdx = (Number(m.idx) || 0) - 1;
        if (newsIdx < 0 || newsIdx >= newsItems.length) continue;
        const item = newsItems[newsIdx];
        item.sentiment = m.sentiment === "bearish" ? "bearish" : m.sentiment === "bullish" ? "bullish" : "neutral";
        item.sentimentScore = Math.max(-1, Math.min(1, Number(m.score) || 0));
        const catMatch = String(m.catalyst || "none").match(/K(\d+)/i);
        if (catMatch) {
          const catIdx = parseInt(catMatch[1]) - 1;
          if (catIdx >= 0 && catIdx < catalysts.length) {
            item.matchedCatalyst = catalysts[catIdx].name;
            item.matchedCatalystIdx = catIdx;
          }
        }
      }

      // Aggregate sentiment per catalyst → adjust PoS by ±7 max
      for (let i = 0; i < catalysts.length; i++) {
        const matched = newsItems.filter(n => n.matchedCatalystIdx === i);
        if (!matched.length) continue;
        const avgScore = matched.reduce((s, n) => s + (n.sentimentScore || 0), 0) / matched.length;
        const cat = catalysts[i] as any;
        cat.newsCount = matched.length;
        cat.posOriginal = cat.pos;
        const bullish = matched.filter(n => n.sentiment === "bullish").length;
        const bearish = matched.filter(n => n.sentiment === "bearish").length;
        if (bullish > 0 && bearish > 0) cat.newsSentiment = "mixed";
        else if (avgScore > 0.2) cat.newsSentiment = "bullish";
        else if (avgScore < -0.2) cat.newsSentiment = "bearish";
        else cat.newsSentiment = "neutral";
        const adjustment = Math.round(avgScore * 7);
        cat.posAdjustment = adjustment;
        cat.pos = Math.max(10, Math.min(85, cat.pos + adjustment));
        cat.nettoUpside = +(cat.bruttoUpside * (1 - cat.einpreisungsgrad / 100)).toFixed(2);
        cat.gb = +(cat.pos / 100 * cat.nettoUpside).toFixed(2);
      }
    }

    console.log(`[LLM] Combined call OK for ${ticker}: ${catalysts.length} catalysts, ${newsMatches.length} news matched, ${elapsedMs}ms, model=${usedModel}`);
    return {
      catalysts,
      modelUsed: usedModel,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
    };
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);
    if (status === 402) {
      console.warn('[LLM] 402 token budget exhausted — skipping LLM');
    } else {
      console.error(`[LLM] OpenRouter call failed for ${ticker} (status=${status}): ${msg.substring(0, 300)}`);
    }
    return null;
  }
}

export function isLLMAvailable(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

// === Catalyst Deep-Dive Explanations (Section 15) ===
// Generates per-catalyst structured deep-dive, mirroring the Risk Deep-Dive in Section 8.
// Single LLM call for all catalysts to minimize credits.
export interface CatalystDeepDiveInput {
  ticker: string;
  companyName: string;
  sector: string;
  description: string;
  revenue: number;
  revenueGrowth: number;
  fcfMargin: number;
  price: number;
  analystPT: number;
  catalysts: Array<{ name: string; pos: number; bruttoUpside: number; einpreisungsgrad: number; context?: string; }>;
  newsHeadlines?: string[];
}

export async function generateCatalystDeepDives(
  input: CatalystDeepDiveInput
): Promise<Array<{ deepDive: import('../shared/schema').CatalystDeepDive }> | null> {
  const client = getClient();
  if (!client) return null;
  const model = pickModel();
  const { ticker, companyName, sector, description, revenue, revenueGrowth, fcfMargin, price, analystPT, catalysts, newsHeadlines = [] } = input;

  const newsCtx = newsHeadlines.length > 0 ? `\nAktuelle News: ${newsHeadlines.slice(0, 4).map((h, i) => `N${i + 1}: ${h}`).join(' | ')}` : '';
  const catList = catalysts.map((c, i) =>
    `K${i} (idx=${i}): ${c.name} | PoS=${c.pos}% | BruttoUpside=+${c.bruttoUpside}% | Einpreisung=${c.einpreisungsgrad}% | Kontext: ${(c.context || '').substring(0, 100)}`
  ).join('\n');

  const prompt = `Aktien-Analyst. Unternehmen: ${companyName} (${ticker}), Sektor: ${sector}.
Umsatz: $${(revenue / 1e9).toFixed(1)}B | Wachstum: ${revenueGrowth.toFixed(1)}% | FCF-Marge: ${fcfMargin.toFixed(1)}% | Kurs: $${price.toFixed(2)} | Analyst PT: $${analystPT.toFixed(2)}
Beschreibung: ${description.substring(0, 300)}${newsCtx}

Katalysatoren:
${catList}

Erstelle fuer jeden Katalysator ein strukturiertes Deep-Dive-Objekt. Antworte NUR mit JSON:
{"deepDives":[{"idx":0,"unternehmenskontext":"1 Satz warum spezifisch fuer ${companyName}","posHerleitung":"1 Satz Begruendung fuer PoS%","bewertungsauswirkung":"1 Satz Auswirkung auf Umsatz/Margen/DCF","marktumfeld":"1 Satz Wettbewerb/Regulation/Macro","risiken":"1 Satz Was koennte diesen Katalysator verhindern","unterschaetzt":false}]}`;

  try {
    const { text } = await callWithFallback(client, {
      max_tokens: 700,
      temperature: 0.25,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' } as any,
    });
    if (!text) return null;
    const parsed = JSON.parse(text);
    const dives = parsed.deepDives || [];
    if (!Array.isArray(dives) || dives.length === 0) return null;
    return dives.map((d: any) => ({
      deepDive: {
        unternehmenskontext: String(d.unternehmenskontext || ''),
        posHerleitung: String(d.posHerleitung || ''),
        bewertungsauswirkung: String(d.bewertungsauswirkung || ''),
        marktumfeld: String(d.marktumfeld || ''),
        risiken: String(d.risiken || ''),
        unterschaetzt: Boolean(d.unterschaetzt ?? false),
      },
    }));
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    if (status === 402) {
      console.warn('[LLM] 402 token budget exhausted — skipping LLM');
    } else {
      console.error(`[LLM-CATALYST-DEEPDIVE] Failed for ${ticker}: ${err?.message?.substring(0, 200)}`);
    }
    return null;
  }
}

// === Risk Deep-Dive Explanations ===
//
// Generates structured, company-specific explanations for each risk in the
// Risk Inversion table (Section 8). Mirrors the style of catalyst explanations
// in Section 15 — short, structured, fact-based, in German.
//
// Returns risks with .explanation populated, or null on failure.
// Single LLM call covers all risks to keep cost minimal (~1-2 credits).

export interface RiskExplanationInput {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description: string;
  revenue: number;
  revenueGrowth: number;
  fcfMargin: number;
  price: number;
  pe: number;
  marketCap: number;
  governmentExposure: number;
  risks: Risk[];
  // B3: optional context from SEC filings and news for more specific explanations
  keyProjects?: string[];
  recentNewsHeadlines?: string[];
  capexContext?: CapexTailwindContext | null; // optional — Capex Fiscal Spending tailwind / policy-reversal risk
}

export async function generateRiskExplanations(
  input: RiskExplanationInput
): Promise<Risk[] | null> {
  const client = getClient();
  if (!client) return null;

  const model = pickModel();
  const {
    ticker, companyName, sector, industry, description, revenue, revenueGrowth,
    fcfMargin, price, pe, marketCap, governmentExposure, risks,
    keyProjects = [], recentNewsHeadlines = [],
  } = input;

  // B3: optional SEC + news context for more specific risk explanations
  const secContext = keyProjects.length > 0
    ? `\nKey Projects (SEC):\n${keyProjects.slice(0, 5).map((p: string) => `  - ${p}`).join("\n")}`
    : "";
  const newsContext = recentNewsHeadlines.length > 0
    ? `\nAktuelle News:\n${recentNewsHeadlines.slice(0, 5).map((h: string, i: number) => `  N${i + 1}: ${h}`).join("\n")}`
    : "";

  const capexRiskContext = input.capexContext
    ? `\nCAPEX POLICY RISK: ${ticker} ist börsennotierter Profiteur von "${input.capexContext.sector}" (Programme: ${input.capexContext.programmes.join(", ")}). PFLICHT: Prüfe ob ein bestehendes Risiko in der Liste "Policy-Reversal" oder "Budget-Kürzung" abdeckt. Wenn ja, markiere dessen 'unterschaetzt' Feld als true wenn EW < 30% — Capex-Programme haben erhöhtes politisches Kürzungsrisiko. Wenn KEIN Risiko das abdeckt, füge als letzten Eintrag hinzu: riskIndex=${risks.length}, name="Policy-Reversal: ${input.capexContext.programmes[0] || input.capexContext.sector}", category="politisch".`
    : "";

  // riskIndex is 0-based — explicitly labelled to avoid LLM off-by-one (B fix)
  const riskList = risks.map((r, i) =>
    `riskIndex=${i}: ${r.name} | ${r.category} | EW: ${r.ew}% | Impact: ${r.impact}% | Exp.Damage: ${r.expectedDamage.toFixed(2)}%`
  ).join("\n");

  const prompt = `Du bist ein präziser Aktienresearcher. Erstelle für jedes Risiko eine Erklärung (max 40 Wörter pro Risiko).

UNTERNEHMENSKONTEXT:
${companyName} (${ticker}) | ${sector} / ${industry}
Umsatz: $${revenue > 0 ? (revenue / 1e9).toFixed(1) + 'B' : 'N/A'} | Wachstum: ${revenueGrowth != null && revenueGrowth !== 0 ? revenueGrowth.toFixed(1) + '%' : 'N/A'} | FCF-Marge: ${fcfMargin > 0 ? fcfMargin.toFixed(1) + '%' : 'N/A'} | KGV: ${pe > 0 ? pe.toFixed(1) : 'N/A'} | Staatsabh: ${governmentExposure.toFixed(0)}%
${description.substring(0, 350)}${secContext}${newsContext}${capexRiskContext}

RISIKEN (riskIndex 0-basiert — exakt so zurückgeben):
${riskList}

REGELN:
- Unternehmensspezifisch, faktenbasiert, max 40 Wörter pro Risiko
- Nutze SEC/News wenn vorhanden für konkrete Belege
- unterschaetzt=true wenn Expected Damage zu niedrig, sonst false
- riskIndex MUSS exakt dem Index aus der Liste entsprechen (0-basiert)

Return ONLY this JSON (no markdown, no commentary):
{
  "explanations": [
    {
      "riskIndex": 0,
      "kontext": "Kurze faktenbasierte Beschreibung warum dieses Risiko f\u00fcr ${companyName} relevant ist.",
      "gewichtungsBegrundung": "Warum EW% und Impact% so gew\u00e4hlt wurden — unternehmensspezifische Begr\u00fcndung.",
      "bewertungsAuswirkung": "Konkrete Auswirkungen auf Umsatz, Margen, FCF oder DCF-Bewertung.",
      "mitigation": "Bestehende oder m\u00f6gliche Ma\u00dfnahmen des Unternehmens zur Risikominderung.",
      "gesamtEinschaetzung": "Kritikalit\u00e4t im Gesamtkontext der These.",
      "unterschaetzt": false
    }
  ]
}`;

  try {
    console.log(`[LLM-RISK] Generating risk explanations for ${ticker} (${risks.length} risks) with fallback chain`);
    const t0 = Date.now();
    const { text, modelUsed: riskModel } = await callWithFallback(client, {
      max_tokens: 800,
      temperature: 0.25,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" } as any,
    });
    const elapsedMs = Date.now() - t0;
    console.log(`[LLM-RISK] Used model: ${riskModel} for ${ticker} (${elapsedMs}ms)`);
    if (!text) {
      console.warn(`[LLM-RISK] Empty response for ${ticker}`);
      return null;
    }

    let jsonStr = text;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn(`[LLM-RISK] JSON parse failed for ${ticker}: ${(parseErr as any)?.message}`);
      return null;
    }

    const explanations: any[] = parsed.explanations || [];
    if (!Array.isArray(explanations) || explanations.length === 0) {
      console.warn(`[LLM-RISK] No explanations returned for ${ticker}`);
      return null;
    }

    // Map explanations back onto risks
    const enrichedRisks = risks.map((r, i) => {
      const expl = explanations.find((e: any) => e.riskIndex === i) || explanations[i];
      if (!expl) return r;
      const explanation: RiskExplanation = {
        kontext: String(expl.kontext || ""),
        gewichtungsBegrundung: String(expl.gewichtungsBegrundung || ""),
        bewertungsAuswirkung: String(expl.bewertungsAuswirkung || ""),
        mitigation: String(expl.mitigation || ""),
        gesamtEinschaetzung: String(expl.gesamtEinschaetzung || ""),
        unterschaetzt: Boolean(expl.unterschaetzt ?? false),
      };
      return { ...r, explanation };
    });

    console.log(`[LLM-RISK] OK for ${ticker}: ${enrichedRisks.filter(r => r.explanation).length} explanations in ${elapsedMs}ms`);
    return enrichedRisks;
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);
    if (status === 402) {
      console.warn('[LLM] 402 token budget exhausted — skipping LLM');
    } else {
      console.error(`[LLM-RISK] OpenRouter call failed for ${ticker} (status=${status}): ${msg.substring(0, 300)}`);
    }
    return null;
  }
}

// Best-effort recovery of truncated JSON. Walks the string, tracks bracket
// depth, trims any partially-written trailing item, and closes any still-open
// brackets/braces. Returns the original string if recovery fails.
function salvageTruncatedJson(raw: string): string {
  try { JSON.parse(raw); return raw; } catch {}
  const lastBrace = raw.lastIndexOf('}');
  const lastBracket = raw.lastIndexOf(']');
  const lastClose = Math.max(lastBrace, lastBracket);
  if (lastClose <= 0) return raw;
  let s = raw.substring(0, lastClose + 1);
  let depth = 0, inStr = false, prev = '';
  for (const c of s) {
    if (c === '"' && prev !== '\\') inStr = !inStr;
    else if (!inStr) {
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') depth--;
    }
    prev = c;
  }
  while (depth > 0) { s += '}'; depth--; }
  try { JSON.parse(s); return s; } catch { return raw; }
}

// Generic JSON-mode LLM call — reused by the Researcher module so it doesn't
// have to instantiate its own OpenAI client. Returns parsed JSON or null on
// any error (network / parse / model-unavailable).
export async function callLLMJson(opts: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}): Promise<{ data: any; modelUsed: string; promptTokens?: number; completionTokens?: number } | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const messages: any[] = [];
    if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
    messages.push({ role: "user", content: opts.prompt });
    const { text, modelUsed, usage } = await callWithFallback(client, {
      max_tokens: Math.min(opts.maxTokens ?? 900, 4000),
      temperature: opts.temperature ?? 0.4,
      messages,
      response_format: { type: "json_object" } as any,
    });
    if (!text) return null;
    let jsonStr = text.trim();
    // Strip markdown fences
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    }
    // Strip any preamble text before the JSON (e.g. "Hier ist ein JSON-Objekt:\n{...}")
    // Find the first { or [ to locate the actual JSON start
    const jsonStart = jsonStr.search(/[{\[]/);
    if (jsonStart > 0) {
      jsonStr = jsonStr.substring(jsonStart);
      // Also strip anything after the last } or ]
      const jsonEnd = Math.max(jsonStr.lastIndexOf('}'), jsonStr.lastIndexOf(']'));
      if (jsonEnd >= 0) jsonStr = jsonStr.substring(0, jsonEnd + 1);
    }
    const salvaged = salvageTruncatedJson(jsonStr);
    if (salvaged !== jsonStr) {
      console.warn(`[LLM-JSON] salvaged truncated response (orig=${jsonStr.length}b, salvaged=${salvaged.length}b)`);
    }
    return {
      data: JSON.parse(salvaged),
      modelUsed,
      promptTokens: usage?.prompt_tokens,
      completionTokens: usage?.completion_tokens,
    };
  } catch (err: any) {
    console.error(`[LLM-JSON] failed: ${(err?.message || String(err)).substring(0, 300)}`);
    return null;
  }
}

export interface GrowthThesisInput {
  ticker: string;
  companyName: string;
  description: string;
  sector: string;
  industry: string;
  revenueGrowth: number;
  fcfMargin: number;
  grossMargin?: number;
  operatingMargin?: number;
  forwardPE?: number;
  evEbitda?: number;
  analystPTMedian?: number;
  currentPrice?: number;
  returnOnEquity?: number;
  topCatalysts: Array<{ name: string; context: string }>;
  capexContext?: { sector: string; programmes: string[]; rationale: string } | null;
}

/** Fingerprint for stale-thesis detection — hash of key inputs */
export function growthThesisFingerprint(input: Pick<GrowthThesisInput,
  "revenueGrowth" | "fcfMargin" | "topCatalysts" | "capexContext">): string {
  const catKey = input.topCatalysts.slice(0, 2).map(c => c.name).join("|");
  const capexKey = input.capexContext ? input.capexContext.programmes.slice(0,2).join("+") : "none";
  // Round to 1dp so minor float drift doesn't invalidate
  return `rv${input.revenueGrowth.toFixed(1)}_fcf${input.fcfMargin.toFixed(1)}_cats${catKey}_capex${capexKey}`;
}

export async function generateGrowthThesis(input: GrowthThesisInput): Promise<string | null> {
  const { ticker, companyName, description, sector, industry,
    revenueGrowth, fcfMargin, grossMargin, operatingMargin,
    forwardPE, evEbitda, analystPTMedian, currentPrice, returnOnEquity,
    topCatalysts, capexContext } = input;

  // Extract first 3 sentences from FMP description (contains product-specific details)
  const descSentences = (description || "").match(/[^.!?]+[.!?]+/g) || [];
  const descCore = descSentences.slice(0, 3).join(" ").trim().slice(0, 400);

  // Build hard metrics block — only include metrics that are non-zero/non-null
  const metrics: string[] = [];
  if (revenueGrowth !== 0) metrics.push(`Revenue-Wachstum: ${revenueGrowth.toFixed(1)}%`);
  if (fcfMargin && fcfMargin !== 0) metrics.push(`FCF-Marge: ${fcfMargin.toFixed(1)}%`);
  if (grossMargin && grossMargin > 0) metrics.push(`Bruttomarge: ${grossMargin.toFixed(1)}%`);
  if (operatingMargin && operatingMargin !== 0) metrics.push(`Operating Margin: ${operatingMargin.toFixed(1)}%`);
  if (forwardPE && forwardPE > 0) metrics.push(`Forward KGV: ${forwardPE.toFixed(1)}x`);
  if (evEbitda && evEbitda > 0) metrics.push(`EV/EBITDA: ${evEbitda.toFixed(1)}x`);
  if (returnOnEquity && returnOnEquity > 0) metrics.push(`ROE: ${(returnOnEquity * 100).toFixed(1)}%`);
  if (analystPTMedian && analystPTMedian > 0 && currentPrice && currentPrice > 0) {
    const upside = ((analystPTMedian - currentPrice) / currentPrice * 100).toFixed(0);
    metrics.push(`Analyst-PT: $${analystPTMedian} (+${upside}% Upside)`);
  }

  // Top 2 catalyst names + first context sentence each
  const catLines = topCatalysts.slice(0, 2).map(c => {
    const ctxFirst = (c.context.match(/[^.!?]+[.!?]+/) || [""])[0].trim();
    return `- ${c.name}: ${ctxFirst.slice(0, 150)}`;
  }).join("\n");

  const capexLine = capexContext
    ? `Staatliche Förderprogramme: ${capexContext.programmes.slice(0, 2).join(" & ")} (${capexContext.sector}). ${capexContext.rationale.slice(0, 120)}`
    : "";

  const prompt = `Du bist ein erfahrener Aktienanalyst. Schreibe 2-3 präzise deutsche Sätze als Investment-These für ${companyName} (${ticker}).

GESCHÄFTSMODELL (FMP):
${descCore}

HARTE KENNZAHLEN:
${metrics.length > 0 ? metrics.join(" | ") : "Keine aktuellen Daten verfügbar"}

WESENTLICHE KATALYSATOREN:
${catLines || "- Keine spezifischen Katalysatoren verfügbar"}
${capexLine ? `
FISKAL-RÜCKENWIND: ${capexLine}` : ""}

REGELN (strikt einhalten):
1. Nenne "${companyName}" in Satz 1 und erkläre KONKRET womit das Unternehmen Geld verdient (aus Geschäftsmodell)
2. Erwähne mind. 1 harte Kennzahl (FCF-Marge, Forward KGV, Analystenziel etc.)
3. Nenne mind. 1 konkreten Katalysator beim EXAKTEN Namen
4. Falls Fiskal-Rückenwind: letzter Satz nennt das Programm
5. VERBOTEN: "strategische Initiativen", "operative Effizienz", "Wachstumspotenzial" als leere Phrasen
6. Maximal 3 Sätze, klar und direkt auf Deutsch

Antworte NUR mit JSON: {"thesis": "..."}`;

  try {
    const result = await callLLMJson({ prompt, maxTokens: 200, temperature: 0.25 });
    const thesis = result?.data?.thesis;
    if (typeof thesis === "string" && thesis.trim().length > 30) {
      return thesis.trim();
    }
  } catch (e: any) {
    console.warn(`[GROWTH-THESIS] LLM call failed for ${ticker}: ${e?.message}`);
  }
  return null;
}

