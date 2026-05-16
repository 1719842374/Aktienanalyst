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

  // Explicit opt-out: PREFER_GROK=0 switches back to Haiku
  if (process.env.PREFER_GROK === "0") {
    return "anthropic/claude-3.5-haiku";
  }

  // Default + PREFER_GROK=1 both go to Grok. Auto-switch after retirement.
  const GROK_RETIRE_DATE = new Date("2026-05-16T00:00:00Z");
  const now = new Date();
  return now < GROK_RETIRE_DATE ? "x-ai/grok-4.1-fast" : "x-ai/grok-4.3";
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
  } = input;

  // Compact context — keep prompt under ~1500 input tokens to keep cost low.
  const ctx: string[] = [];
  ctx.push(`Company: ${companyName} (${ticker})`);
  ctx.push(`Sector: ${sector} / ${industry}`);
  ctx.push(`Description: ${description.substring(0, 600)}`);
  ctx.push(`Revenue: $${(revenue / 1e9).toFixed(1)}B | Growth: ${revenueGrowth.toFixed(1)}% | FCF Margin: ${fcfMargin.toFixed(1)}%`);
  ctx.push(`Price: $${price.toFixed(2)} | P/E: ${pe.toFixed(1)} | Market Cap: $${(marketCap / 1e9).toFixed(1)}B`);
  if (keyProjects.length > 0) {
    ctx.push(`\nKey Projects (SEC 10-K):\n${keyProjects.slice(0, 8).map(p => `  - ${p}`).join("\n")}`);
  }
  if (secFilingExcerpts.length > 0) {
    ctx.push(`\nSEC Excerpts:\n${secFilingExcerpts.slice(0, 4).map(e => `  "${e.substring(0, 200)}"`).join("\n")}`);
  }

  const newsList = newsItems
    .slice(0, 10) // cap to top 10 — saves tokens, news beyond top-10 rarely moves catalyst PoS
    .map((n, i) => `N${i + 1}: "${n.title.substring(0, 130)}" (${n.source}, ${n.relativeTime})`)
    .join("\n");

  const prompt = `You are a senior equity research analyst. Do TWO tasks in one response and return ONE JSON object.

CONTEXT:
${ctx.join("\n")}

${newsList ? `RECENT NEWS:\n${newsList}\n` : ""}

TASK 1 — Generate exactly 5 COMPANY-SPECIFIC investment catalysts. Rules:
- Reference real company-specific projects, products, markets, or strategic moves (use the SEC/news context above)
- BANNED generic names: "Revenue Growth Acceleration", "Margin Expansion", "Operating Leverage" — use specific names
- Examples: "Blue Creek Mine Ramp-up" (HCC), "FSD/Robotaxi Commercialization" (TSLA), "VMware Integration Synergies" (AVGO)
- At least 1 of the 5 must reflect genuine downside risk (lower PoS)
- Context written in GERMAN financial-analyst language (2-3 sentences explaining why it matters)

TASK 2 — For each news headline above (if any), assign sentiment + which of the 5 catalysts it relates to.

Return ONLY this JSON shape — NO markdown, NO commentary:
{
  "catalysts": [
    {
      "name": "Short company-specific name (<= 50 chars)",
      "context": "Deutsche Erklärung 2-3 Sätze",
      "timeline": "6-12M | 12-18M | 12-24M | 12-36M",
      "pos": 20-80,
      "bruttoUpside": 5-30,
      "einpreisungsgrad": 20-60
    }
    // ... 5 items total
  ],
  "newsMatches": [
    { "idx": 1, "sentiment": "bullish|bearish|neutral", "score": -1.0..1.0, "catalyst": "K1|K2|K3|K4|K5|none" }
    // ... one per news item
  ]
}`;

  try {
    console.log(`[LLM] Calling ${model} for ${ticker} (combined catalyst+news, news_count=${newsItems.length})`);
    const t0 = Date.now();
    // Grok 4.1 Fast is a REASONING model — by default it spends a large
    // fraction of completion_tokens on hidden chain-of-thought, which can
    // exhaust our 1900-token budget before the JSON is fully emitted.
    // We disable reasoning for catalyst generation since the task is well
    // structured and CoT brings no quality lift here.
    const isGrok = model.startsWith("x-ai/");
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 1900, // hard cap — keeps cost predictable
      temperature: 0.4, // a bit of creativity for catalyst diversity, but mostly deterministic
      messages: [{ role: "user", content: prompt }],
      // OpenRouter passes this through to providers that support it
      response_format: { type: "json_object" } as any,
      // Disable reasoning when calling reasoning-capable models so the full
      // 1900-token budget goes to actual JSON output, not hidden CoT.
      ...(isGrok ? { reasoning: { effort: "none" } } as any : {}),
    });
    const elapsedMs = Date.now() - t0;

    const text = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!text) {
      console.warn(`[LLM] Empty response from ${model}`);
      return null;
    }

    // Strip optional markdown fences (some models still wrap JSON despite response_format)
    let jsonStr = text;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
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

    console.log(`[LLM] Combined call OK for ${ticker}: ${catalysts.length} catalysts, ${newsMatches.length} news matched, ${elapsedMs}ms, model=${model}`);
    return {
      catalysts,
      modelUsed: model,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
    };
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);
    console.error(`[LLM] OpenRouter call failed for ${ticker} (status=${status}): ${msg.substring(0, 300)}`);
    return null;
  }
}

export function isLLMAvailable(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
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

  // riskIndex is 0-based — explicitly labelled to avoid LLM off-by-one (B fix)
  const riskList = risks.map((r, i) =>
    `riskIndex=${i}: ${r.name} | ${r.category} | EW: ${r.ew}% | Impact: ${r.impact}% | Exp.Damage: ${r.expectedDamage.toFixed(2)}%`
  ).join("\n");

  const prompt = `Du bist ein präziser Aktienresearcher. Erstelle für jedes Risiko eine Erklärung (max 120 Wörter pro Risiko).

UNTERNEHMENSKONTEXT:
${companyName} (${ticker}) | ${sector} / ${industry}
Umsatz: $${(revenue / 1e9).toFixed(1)}B | Wachstum: ${revenueGrowth.toFixed(1)}% | FCF-Marge: ${fcfMargin.toFixed(1)}% | KGV: ${pe.toFixed(1)} | Staatsabh: ${governmentExposure.toFixed(0)}%
${description.substring(0, 350)}${secContext}${newsContext}

RISIKEN (riskIndex 0-basiert — exakt so zurückgeben):
${riskList}

REGELN:
- Unternehmensspezifisch, faktenbasiert, max 120 Wörter pro Risiko
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
    console.log(`[LLM-RISK] Generating risk explanations for ${ticker} (${risks.length} risks), model=${model}`);
    const t0 = Date.now();
    const isGrok = model.startsWith("x-ai/");
    const completion = await client.chat.completions.create({
      model,
      max_tokens: 4500, // B2 fix: 6 risks x 120 words + JSON overhead + CoT buffer
      temperature: 0.25, // slightly more deterministic
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" } as any,
      // B1 fix: grok-4.3 uses { effort: "none" } not { enabled: false }
      ...(isGrok ? { reasoning: { effort: "none" } } as any : {}),
    });
    const elapsedMs = Date.now() - t0;

    const text = completion.choices?.[0]?.message?.content?.trim() || "";
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
    console.error(`[LLM-RISK] OpenRouter call failed for ${ticker} (status=${status}): ${msg.substring(0, 300)}`);
    return null;
  }
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
  const model = pickModel();
  const isGrok = model.startsWith("x-ai/");
  try {
    const messages: any[] = [];
    if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
    messages.push({ role: "user", content: opts.prompt });
    const completion = await client.chat.completions.create({
      model,
      max_tokens: opts.maxTokens ?? 2400,
      temperature: opts.temperature ?? 0.4,
      messages,
      response_format: { type: "json_object" } as any,
      ...(isGrok ? { reasoning: { effort: "none" } } as any : {}),
    });
    const text = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!text) return null;
    let jsonStr = text;
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }
    return {
      data: JSON.parse(jsonStr),
      modelUsed: model,
      promptTokens: completion.usage?.prompt_tokens,
      completionTokens: completion.usage?.completion_tokens,
    };
  } catch (err: any) {
    console.error(`[LLM-JSON] failed (model=${model}): ${(err?.message || String(err)).substring(0, 300)}`);
    return null;
  }
}
