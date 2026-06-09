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
// Model Strategy: Claude 3.5 Haiku only (cheap + fast + good JSON; this is what
// production billing actually shows being used — see MODEL_FALLBACK_CHAIN).

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
      "HTTP-Referer": "https://stockanalyst.pplx.app",
      "X-Title": "Stock Analyst Pro",
    },
  });
  return openrouterClient;
}

function pickModel(): string {
  const override = process.env.OPENROUTER_MODEL;
  if (override) return override;
  return "anthropic/claude-3.5-haiku";
}

const MODEL_FALLBACK_CHAIN = [
  "anthropic/claude-3.5-haiku",
];

async function callWithFallback(client: OpenAI, params: Omit<Parameters<OpenAI['chat']['completions']['create']>[0], 'model'>): Promise<{ text: string; modelUsed: string; usage?: any }> {
  const override = process.env.OPENROUTER_MODEL;
  const chain = override ? [override] : MODEL_FALLBACK_CHAIN;
  let lastErr: any;
  for (const model of chain) {
    try {
      const completion = await (client.chat.completions.create as any)({
        ...params,
        model,
      });
      const text = completion.choices?.[0]?.message?.content?.trim() || '';
      if (!text) { lastErr = new Error('Empty response'); continue; }
      return { text, modelUsed: model, usage: completion.usage };
    } catch (err: any) {
      const status = err?.status || err?.response?.status;
      if (status === 429 || status === 402) {
        console.warn(`[LLM] ${model} rate-limited (${status}) — trying next model`);
        lastErr = err;
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      throw err;
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
  sector: string;
  impact: string;
  timeline: string;
  reasoning: string;
  programmes: string[];
  beneficiaryEntry: CapexBeneficiary;
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
  analystPTMedian?: number;
  governmentExposure?: number;
  impliedGStar?: number | null; // Reverse-DCF implizites Marktwachstum g* = WACC - FCF/EV (in %)
  capexContext?: CapexTailwindContext | null;
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

export async function generateCatalystsAndMatchNews(
  input: CombinedLLMInput
): Promise<CombinedLLMResult | null> {
  const client = getClient();
  if (!client) return null;

  const {
    ticker, companyName, sector, industry, description, revenue, revenueGrowth,
    fcfMargin, price, pe, marketCap, keyProjects, secFilingExcerpts, newsItems,
    analystPTMedian = 0, governmentExposure = 0, capexContext = null, impliedGStar = null,
  } = input;

  const ctx: string[] = [];
  ctx.push(`Unternehmen: ${companyName} (${ticker}) | Sektor: ${sector} / ${industry}`);
  ctx.push(`Beschreibung: ${description.substring(0, 1000)}`);
  ctx.push(`Finanzen: Umsatz ${revenue > 0 ? '$' + (revenue / 1e9).toFixed(1) + 'B' : 'N/A'} | Wachstum ${revenueGrowth != null && revenueGrowth !== 0 ? revenueGrowth.toFixed(1) + '%' : 'N/A'} | FCF-Marge ${fcfMargin > 0 ? fcfMargin.toFixed(1) + '%' : 'N/A'} | KGV ${pe > 0 ? pe.toFixed(1) : 'N/A'} | MCap ${marketCap > 0 ? '$' + (marketCap / 1e9).toFixed(1) + 'B' : 'N/A'}`);
  ctx.push(`Kurs: $${price.toFixed(2)} | Analyst-PT: $${analystPTMedian > 0 ? analystPTMedian.toFixed(2) : 'N/A'} | Gov-Exposure: ${(governmentExposure * 100).toFixed(0)}%`);
  if (impliedGStar !== null && isFinite(impliedGStar)) {
    ctx.push(`REVERSE-DCF g* (impliziertes Marktwachstum, bereits im Kurs eingepreist): ${impliedGStar.toFixed(1)}% — abgeleitet aus g* = WACC - FCF/EV. Dieser Wert ist die mathematische Grundlage für 'einpreisungsgrad' (siehe Regel unten).`);
  }
  if (capexContext) {
    ctx.push(`CAPEX FISCAL TAILWIND: ${ticker} ist börsennotierter Profiteur im Sektor "${capexContext.sector}" (Impact: ${capexContext.impact}, Zeithorizont: ${capexContext.timeline}). Programme: ${capexContext.programmes.join(", ")}. Researcher-Begründung: ${capexContext.beneficiaryEntry.rationale}`);
  }
  if (keyProjects.length > 0) {
    ctx.push(`SEC-Projekte/Verträge (10-K): ${keyProjects.slice(0, 10).join(", ")}`);
  }
  if (secFilingExcerpts.length > 0) {
    ctx.push(`SEC-Auszüge: ${secFilingExcerpts.slice(0, 3).map(e => e.substring(0, 250)).join(" | ")}`);
  }

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
${impliedGStar !== null && isFinite(impliedGStar) ? `6b. PFLICHT für 'einpreisungsgrad': mathematisch herleiten als g* / bruttoUpside (auf 15-70 geklemmt), mit g* = ${impliedGStar.toFixed(1)}% aus REVERSE-DCF oben. Beispiel: g*=${impliedGStar.toFixed(1)}% und bruttoUpside=20% → einpreisungsgrad ≈ ${Math.round(Math.max(0.15, Math.min(0.70, Math.max(0, impliedGStar) / 20)) * 100)}%. KEINE freie Schätzung — der Wert wird serverseitig anhand dieser Formel überprüft/korrigiert.` : ""}
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
  keyProjects?: string[];
  recentNewsHeadlines?: string[];
  capexContext?: CapexTailwindContext | null;
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

  const secContext = keyProjects.length > 0
    ? `\nKey Projects (SEC):\n${keyProjects.slice(0, 5).map((p: string) => `  - ${p}`).join("\n")}`
    : "";
  const newsContext = recentNewsHeadlines.length > 0
    ? `\nAktuelle News:\n${recentNewsHeadlines.slice(0, 5).map((h: string, i: number) => `  N${i + 1}: ${h}`).join("\n")}`
    : "";

  const capexRiskContext = input.capexContext
    ? `\nCAPEX POLICY RISK: ${ticker} ist börsennotierter Profiteur von "${input.capexContext.sector}" (Programme: ${input.capexContext.programmes.join(", ")}). PFLICHT: Prüfe ob ein bestehendes Risiko in der Liste "Policy-Reversal" oder "Budget-Kürzung" abdeckt. Wenn ja, markiere dessen 'unterschaetzt' Feld als true wenn EW < 30% — Capex-Programme haben erhöhtes politisches Kürzungsrisiko. Wenn KEIN Risiko das abdeckt, füge als letzten Eintrag hinzu: riskIndex=${risks.length}, name="Policy-Reversal: ${input.capexContext.programmes[0] || input.capexContext.sector}", category="politisch".`
    : "";

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
      "kontext": "Kurze faktenbasierte Beschreibung warum dieses Risiko fuer ${companyName} relevant ist.",
      "gewichtungsBegrundung": "Warum EW% und Impact% so gewaehlt wurden — unternehmensspezifische Begruendung.",
      "bewertungsAuswirkung": "Konkrete Auswirkungen auf Umsatz, Margen, FCF oder DCF-Bewertung.",
      "mitigation": "Bestehende oder moegliche Massnahmen des Unternehmens zur Risikominderung.",
      "gesamtEinschaetzung": "Kritikalitaet im Gesamtkontext der These.",
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

// ============================================================
// Policy Context Enrichment (Moat/Porter & PESTEL — manual KI trigger)
// ============================================================
// Adds current regulatory, fiscal-programme and monetary-policy context for
// USA, Europe and Asia, tailored to the specific company/sector — analog zur
// Risiko-Erklärungen-Architektur (single LLM call, Claude 3.5 Haiku).
export interface PolicyContextInput {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description: string;
  governmentExposure: number;
  capexContextUS?: CapexTailwindContext | null;
  capexContextEU?: CapexTailwindContext | null;
  capexContextASIA?: CapexTailwindContext | null;
}

export interface PolicyContextResult {
  usa: string;
  europa: string;
  asien: string;
  moatImpact: string;
}

export async function generatePolicyContext(
  input: PolicyContextInput
): Promise<PolicyContextResult | null> {
  const client = getClient();
  if (!client) return null;

  const {
    ticker, companyName, sector, industry, description, governmentExposure,
    capexContextUS, capexContextEU, capexContextASIA,
  } = input;

  const regionBlock = (label: string, ctx?: CapexTailwindContext | null) =>
    ctx ? `\n${label}: Profiteur von "${ctx.sector}" (Programme: ${ctx.programmes.join(", ") || "—"}; Impact: ${ctx.impact}; Horizont: ${ctx.timeline}). ${ctx.reasoning}` : "";

  const capexContext = `${regionBlock("USA-Fiskalprogramme", capexContextUS)}${regionBlock("EU-Fiskalprogramme", capexContextEU)}${regionBlock("Asien-Fiskalprogramme", capexContextASIA)}`;

  const prompt = `Du bist ein präziser Makro-/Regulierungsanalyst. Erkläre für ${companyName} (${ticker}, ${sector} / ${industry}, Staatsabh.: ${governmentExposure.toFixed(0)}%), wie aktuelle (2026) Gesetzesregulierung, Fiskalprogramme und Geldpolitik in USA, Europa und Asien das Unternehmen konkret betreffen.

UNTERNEHMENSKONTEXT:
${description.substring(0, 350)}${capexContext}

REGELN:
- Max 50 Wörter je Region, unternehmens-/branchenspezifisch (keine generischen Floskeln)
- Nenne konkrete Regulierungsthemen, Fiskalprogramme oder Zentralbankpolitik mit Bezug zu ${sector}/${industry}
- moatImpact: max 50 Wörter — wie diese Politikfaktoren den Burggraben (Moat) und die Wettbewerbsposition von ${companyName} stärken oder schwächen

Return ONLY this JSON (no markdown, no commentary):
{
  "usa": "Konkrete regulatorische/fiskal-/geldpolitische Einordnung für USA, bezogen auf ${companyName}.",
  "europa": "Konkrete regulatorische/fiskal-/geldpolitische Einordnung für Europa, bezogen auf ${companyName}.",
  "asien": "Konkrete regulatorische/fiskal-/geldpolitische Einordnung für Asien, bezogen auf ${companyName}.",
  "moatImpact": "Wie diese Faktoren den Moat von ${companyName} beeinflussen."
}`;

  try {
    console.log(`[LLM-POLICY] Generating policy context for ${ticker} with fallback chain`);
    const t0 = Date.now();
    const { text, modelUsed } = await callWithFallback(client, {
      max_tokens: 600,
      temperature: 0.25,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" } as any,
    });
    const elapsedMs = Date.now() - t0;
    console.log(`[LLM-POLICY] Used model: ${modelUsed} for ${ticker} (${elapsedMs}ms)`);
    if (!text) {
      console.warn(`[LLM-POLICY] Empty response for ${ticker}`);
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
      console.warn(`[LLM-POLICY] JSON parse failed for ${ticker}: ${(parseErr as any)?.message}`);
      return null;
    }

    if (!parsed.usa && !parsed.europa && !parsed.asien) {
      console.warn(`[LLM-POLICY] No policy context returned for ${ticker}`);
      return null;
    }

    const result: PolicyContextResult = {
      usa: String(parsed.usa || ""),
      europa: String(parsed.europa || ""),
      asien: String(parsed.asien || ""),
      moatImpact: String(parsed.moatImpact || ""),
    };
    console.log(`[LLM-POLICY] OK for ${ticker} in ${elapsedMs}ms`);
    return result;
  } catch (err: any) {
    const status = err?.status || err?.response?.status;
    const msg = err?.message || String(err);
    if (status === 402) {
      console.warn('[LLM] 402 token budget exhausted — skipping LLM');
    } else {
      console.error(`[LLM-POLICY] OpenRouter call failed for ${ticker} (status=${status}): ${msg.substring(0, 300)}`);
    }
    return null;
  }
}

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
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    }
    const jsonStart = jsonStr.search(/[{\[]/);
    if (jsonStart > 0) {
      jsonStr = jsonStr.substring(jsonStart);
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

export function growthThesisFingerprint(input: Pick<GrowthThesisInput,
  "revenueGrowth" | "fcfMargin" | "topCatalysts" | "capexContext">): string {
  const catKey = input.topCatalysts.slice(0, 2).map(c => c.name).join("|");
  const capexKey = input.capexContext ? input.capexContext.programmes.slice(0,2).join("+") : "none";
  return `rv${input.revenueGrowth.toFixed(1)}_fcf${input.fcfMargin.toFixed(1)}_cats${catKey}_capex${capexKey}`;
}

export async function generateGrowthThesis(input: GrowthThesisInput): Promise<string | null> {
  const { ticker, companyName, description, sector, industry,
    revenueGrowth, fcfMargin, grossMargin, operatingMargin,
    forwardPE, evEbitda, analystPTMedian, currentPrice, returnOnEquity,
    topCatalysts, capexContext } = input;

  const descSentences = (description || "").match(/[^.!?]+[.!?]+/g) || [];
  const descCore = descSentences.slice(0, 3).join(" ").trim().slice(0, 400);

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
${capexLine ? `\nFISKAL-RÜCKENWIND: ${capexLine}` : ""}

REGELN (strikt einhalten):
1. Nenne "${companyName}" in Satz 1 und erkläre KONKRET womit das Unternehmen Geld verdient (aus Geschäftsmodell)
2. Erwähne mind. 1 harte Kennzahl (FCF-Marge, Forward KGV, Analystenziel etc.)
3. Nenne mind. 1 konkreten Katalysator beim EXAKTEN Namen
4. Falls Fiskal-Rückenwind: letzter Satz nennt das Programm
5. VERBOTEN: "strategische Initiativen", "operative Effizienz", "Wachstumspotenzial" als leere Phrasen
6. Maximal 3 Sätze, klar und direkt auf Deutsch

Antworte NUR mit JSON: {"thesis": "..."}`;

  try {
    const result = await callLLMJson({ prompt, maxTokens: 300, temperature: 0.25 });
    const thesis = result?.data?.thesis;
    if (typeof thesis === "string" && thesis.trim().length > 30) {
      return thesis.trim();
    }
  } catch (e: any) {
    console.warn(`[GROWTH-THESIS] LLM call failed for ${ticker}: ${e?.message}`);
  }
  return null;
}

// ============================================================
// generateCompanySpecificRisks — ENHANCED VERSION
// Fix: maxTokens 600→1200, retry on partial (<5) results,
// stronger prompt with explicit "GENAU 5" mandate and
// concrete good/bad examples mirror catalyst prompt style.
// ============================================================
export async function generateCompanySpecificRisks(input: {
  ticker: string;
  companyName: string;
  description: string;
  sector: string;
  industry: string;
  revenue: number;
  revenueGrowth: number;
  fcfMargin: number;
  grossMargin: number;
  forwardPE: number;
  beta: number;
  governmentExposure: number;
  topCatalysts: Array<{ name: string; context: string }>;
  capexContext?: { sector: string; programmes: string[]; rationale: string } | null;
  recentNewsHeadlines?: string[];
}): Promise<Array<{ name: string; category: string; ew: number; impact: number }> | null> {
  const client = getClient();
  if (!client) return null;

  const {
    ticker, companyName, description, sector, industry, revenue, revenueGrowth,
    fcfMargin, grossMargin, forwardPE, beta, governmentExposure,
    topCatalysts, capexContext, recentNewsHeadlines = [],
  } = input;

  const descSentences = (description || "").match(/[^.!?]+[.!?]+/g) || [];
  const descCore = descSentences.slice(0, 5).join(" ").trim().slice(0, 700);

  // Use all catalyst context for richer inversion anchors
  const catContext = topCatalysts.slice(0, 5).map((c, i) =>
    `K${i+1} - ${c.name}: ${c.context.slice(0, 250)}`
  ).join("\n");

  // All news headlines for concrete event anchors
  const newsCtx = recentNewsHeadlines.slice(0, 8).map((h, i) => `N${i + 1}: ${h}`).join("\n");

  const capexCtx = capexContext
    ? `PFLICHT: Das Unternehmen hängt von ${capexContext.programmes.slice(0, 2).join(" & ")} ab — Risiko 5 MUSS Programmkürzung/Budget-Freeze adressieren: z.B. "${capexContext.programmes[0] || capexContext.sector} Budget-Freeze".`
    : "";

  const metrics = [
    revenue > 0 ? `Umsatz $${(revenue / 1e9).toFixed(1)}B` : null,
    revenueGrowth !== 0 ? `RevWachstum ${revenueGrowth.toFixed(1)}%` : null,
    fcfMargin !== 0 ? `FCF-Marge ${fcfMargin.toFixed(1)}%` : null,
    grossMargin > 0 ? `Bruttomarge ${grossMargin.toFixed(1)}%` : null,
    forwardPE > 0 ? `Fwd-KGV ${forwardPE.toFixed(1)}x` : null,
    `Beta ${beta.toFixed(2)}`,
    governmentExposure > 0.1 ? `Gov-Exposure ${(governmentExposure * 100).toFixed(0)}%` : null,
  ].filter(Boolean).join(" | ");

  const buildPrompt = (attempt: number) => `Du bist ein kritischer Sell-Side-Analyst. Generiere GENAU 5 unternehmensspezifische Inversionsrisiken für ${companyName} (${ticker}).
${ attempt > 1 ? "WICHTIG: Vorheriger Versuch lieferte weniger als 5 Risiken. Diesmal GENAU 5 vollständige Risiken generieren.\n" : ""}
GESCHÄFTSMODELL:
${descCore}

KENNZAHLEN: ${metrics}

UPSIDE-KATALYSATOREN als Inversionsanker (was passiert wenn diese NICHT eintreten?):
${catContext}

${newsCtx ? `AKTUELLE NEWS (Pflicht: nutze konkrete Events/Zahlen als Risikoankerpunkte):\n${newsCtx}\n` : ""}${capexCtx ? `\n${capexCtx}\n` : ""}

REGELN — strikte Einhaltung:
1. GENAU 5 Risiken — nicht mehr, nicht weniger
2. Jedes Risiko MUSS den Firmennamen "${companyName}", "${ticker}", ein konkretes Produkt/Segment oder einen echten Gegenpartei-Namen nennen
3. VERBOTEN: generische Namen ohne Firmenbezug ("Macro Recession", "Multiple Compression", "Rising Rates", "Competition Intensifies")
4. EW% (Eintrittswahrscheinlichkeit 12-24M): 10-45%
5. Impact% (Kursrückgang wenn Risiko eintritt): 10-45%
6. Category: "Binary" (abruptes Event) | "Gradual" (schleichend) | "Correlated" (Makro-korreliert)
7. Risikoname: max 6 Wörter, konkret mit Firmenbezug
8. Pflicht: Risiko 1 = wichtigste Katalysator-Inversion (Inversion von K1)
9. Pflicht: Risiko 2 = zweite wichtigste Inversion (Inversion von K2 oder K3)

GUTE Beispiele (firmenspezifisch — Pflichtformat):
- "Azure Gov-Cloud FedRAMP Revocation" (MSFT) — konkretes Produkt + Regulation
- "Ozempic Patent-Herausforderung EU" (NVO) — konkretes Medikament
- "CoreWeave Nvidia-Vertrag Nicht-Verlängerung" (CRWV) — konkrete Gegenpartei
- "F-35 Exportstop Nahost-Embargo" (LMT) — konkretes Programm + Trigger
- "GLP-1 Medicare Price Cap Erweiterung" (LLY) — konkretes Produkt + Policy

SCHLECHTE Beispiele (VERBOTEN — kein Firmenbezug):
- "Macro Recession / Demand Shock" → FALSCH
- "Multiple Compression (Rising Rates)" → FALSCH
- "Regulatory / Antitrust Action" → FALSCH (zu generisch, kein Produkt)
- "Competitive Pressure" → FALSCH (kein Wettbewerber genannt)

Antworte NUR mit diesem JSON (GENAU 5 risks-Objekte, kein Markdown):
{"risks":[{"name":"Konkreter Name max 6 Wörter","category":"Binary|Gradual|Correlated","ew":25,"impact":20},{"name":"...","category":"...","ew":20,"impact":30},{"name":"...","category":"...","ew":15,"impact":25},{"name":"...","category":"...","ew":30,"impact":15},{"name":"...","category":"...","ew":20,"impact":20}]}`;

  const validate = (risks: any[]): Array<{ name: string; category: string; ew: number; impact: number }> | null => {
    if (!Array.isArray(risks) || risks.length < 3) return null;
    return risks.slice(0, 5).map((r: any) => ({
      name: String(r.name || "Unbekanntes Risiko").slice(0, 80),
      category: ["Binary", "Gradual", "Correlated"].includes(r.category) ? r.category : "Gradual",
      ew: Math.min(Math.max(Number(r.ew) || 20, 5), 50),
      impact: Math.min(Math.max(Number(r.impact) || 15, 5), 50),
    }));
  };

  // Up to 2 attempts — second attempt has a stronger mandate in the prompt
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      console.log(`[RISK-SPECIFIC] Attempt ${attempt}/2 for ${ticker} (desc=${description.length}chars, cats=${topCatalysts.length}, news=${recentNewsHeadlines.length})`);
      // Increased token limit: 1200 ensures all 5 risks fit even with long names
      const result = await callLLMJson({ prompt: buildPrompt(attempt), maxTokens: 1200, temperature: attempt === 1 ? 0.3 : 0.5 });
      if (!result) {
        console.warn(`[RISK-SPECIFIC] callLLMJson returned null for ${ticker} (attempt ${attempt})`);
        if (attempt < 2) continue;
        return null;
      }
      const risks = result?.data?.risks;
      console.log(`[RISK-SPECIFIC] LLM returned ${risks?.length ?? 0} risks for ${ticker}: ${JSON.stringify(risks)?.substring(0, 300)}`);
      const validated = validate(risks);
      if (!validated) {
        console.warn(`[RISK-SPECIFIC] Invalid/incomplete risks array for ${ticker} (attempt ${attempt}): got ${risks?.length ?? 0}`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 800)); continue; }
        return null;
      }
      // Accept if ≥4 risks on first attempt, ≥3 on second
      const minRequired = attempt === 1 ? 4 : 3;
      if (validated.length < minRequired) {
        console.warn(`[RISK-SPECIFIC] Only ${validated.length} risks (need ${minRequired}) for ${ticker} (attempt ${attempt})`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 800)); continue; }
      }
      console.log(`[RISK-SPECIFIC] Success for ${ticker} (attempt ${attempt}): ${validated.map(r => r.name).join(" | ")}`);
      return validated;
    } catch (e: any) {
      console.error(`[RISK-SPECIFIC] Exception attempt ${attempt} for ${ticker}: ${e?.message} status=${e?.status}`);
      if (attempt < 2) { await new Promise(r => setTimeout(r, 800)); continue; }
      return null;
    }
  }
  return null;
}

// ============================================================
// generatePorterFiveForces — NEW: Company-specific Porter analysis
// Called in routes.ts when useLLM=true alongside catalyst generation.
// Returns structured Porter analysis with LLM-written company-specific
// assessments for all 5 forces.
// ============================================================
export interface PorterFiveForceInput {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description: string;
  revenue: number;
  revenueGrowth: number;
  fcfMargin: number;
  grossMargin: number;
  marketCap: number;
  topCatalysts: Array<{ name: string; context: string }>;
  recentNewsHeadlines?: string[];
  keyProjects?: string[];
}

export interface PorterForceResult {
  force: string;           // e.g. "Rivalität unter Wettbewerbern"
  rating: string;          // "Hoch" | "Mittel" | "Niedrig"
  score: number;           // 1-10 (10 = most threatening)
  summary: string;         // 1-2 German sentences, company-specific
  keyFactors: string[];    // 2-3 concrete factors
}

export async function generatePorterFiveForces(
  input: PorterFiveForceInput
): Promise<PorterForceResult[] | null> {
  const client = getClient();
  if (!client) return null;

  const {
    ticker, companyName, sector, industry, description,
    revenue, revenueGrowth, fcfMargin, grossMargin, marketCap,
    topCatalysts, recentNewsHeadlines = [], keyProjects = [],
  } = input;

  const descCore = (description || "").slice(0, 600);
  const catCtx = topCatalysts.slice(0, 3).map(c => `- ${c.name}: ${c.context.slice(0, 120)}`).join("\n");
  const newsCtx = recentNewsHeadlines.slice(0, 5).map((h, i) => `N${i+1}: ${h}`).join("\n");
  const projCtx = keyProjects.slice(0, 5).map(p => `- ${p}`).join("\n");
  const metrics = [
    revenue > 0 ? `Umsatz $${(revenue / 1e9).toFixed(1)}B` : null,
    revenueGrowth !== 0 ? `RevWachstum ${revenueGrowth.toFixed(1)}%` : null,
    fcfMargin !== 0 ? `FCF-Marge ${fcfMargin.toFixed(1)}%` : null,
    grossMargin > 0 ? `Bruttomarge ${grossMargin.toFixed(1)}%` : null,
    marketCap > 0 ? `MCap $${(marketCap / 1e9).toFixed(0)}B` : null,
  ].filter(Boolean).join(" | ");

  const prompt = `Du bist Senior Equity Research Analyst. Erstelle eine firmenspezifische Porter's Five Forces Analyse für ${companyName} (${ticker}).

UNTERNEHMEN: ${companyName} (${ticker}) | ${sector} / ${industry}
KENNZAHLEN: ${metrics}
GESCHÄFTSMODELL: ${descCore}
${catCtx ? `\nHAUPT-KATALYSATOREN:\n${catCtx}` : ""}
${newsCtx ? `\nAKTUELLE NEWS:\n${newsCtx}` : ""}
${projCtx ? `\nKEY PROJEKTE:\n${projCtx}` : ""}

ANALYSE-REGELN:
1. JEDE Kraft muss ${companyName} konkret benennen — Konkurrenten namentlich, Produkte spezifisch
2. VERBOTEN: generische Aussagen ohne Firmenbezug
3. score: 1-10 (10 = maximale Bedrohung/Stärke)
4. rating: "Hoch" (score 7-10) | "Mittel" (score 4-6) | "Niedrig" (score 1-3)
5. keyFactors: 2-3 konkrete Faktoren mit Firmenbezug
6. summary: 1-2 Sätze Deutsch, faktenbasiert, mit Zahlen wenn vorhanden

Antworte NUR mit JSON:
{"forces":[{"force":"Rivalität unter Wettbewerbern","rating":"Hoch|Mittel|Niedrig","score":7,"summary":"Firmenspezifische Beschreibung 1-2 Sätze.","keyFactors":["Faktor 1","Faktor 2","Faktor 3"]},{"force":"Bedrohung durch Neueinsteiger","rating":"...","score":4,"summary":"...","keyFactors":["..."]},{"force":"Verhandlungsmacht Lieferanten","rating":"...","score":5,"summary":"...","keyFactors":["..."]},{"force":"Verhandlungsmacht Kunden","rating":"...","score":6,"summary":"...","keyFactors":["..."]},{"force":"Bedrohung durch Substitute","rating":"...","score":5,"summary":"...","keyFactors":["..."]}]}`;

  try {
    console.log(`[PORTER] Generating Porter Five Forces for ${ticker}`);
    const result = await callLLMJson({ prompt, maxTokens: 1400, temperature: 0.3 });
    if (!result) return null;
    const forces = result.data?.forces;
    if (!Array.isArray(forces) || forces.length < 4) {
      console.warn(`[PORTER] Invalid forces for ${ticker}: got ${forces?.length ?? 0}`);
      return null;
    }
    const VALID_FORCES = ["Rivalität unter Wettbewerbern", "Bedrohung durch Neueinsteiger", "Verhandlungsmacht Lieferanten", "Verhandlungsmacht Kunden", "Bedrohung durch Substitute"];
    const validated: PorterForceResult[] = forces.slice(0, 5).map((f: any, i: number) => ({
      force: String(f.force || VALID_FORCES[i] || `Kraft ${i+1}`),
      rating: ["Hoch", "Mittel", "Niedrig"].includes(f.rating) ? f.rating : "Mittel",
      score: Math.min(Math.max(Number(f.score) || 5, 1), 10),
      summary: String(f.summary || "").slice(0, 300),
      keyFactors: Array.isArray(f.keyFactors) ? f.keyFactors.slice(0, 3).map((x: any) => String(x).slice(0, 120)) : [],
    }));
    console.log(`[PORTER] OK for ${ticker}: ${validated.map(f => `${f.force}(${f.score})`).join(", ")}`);
    return validated;
  } catch (e: any) {
    console.error(`[PORTER] Exception for ${ticker}: ${e?.message}`);
    return null;
  }
}

// ============================================================
// generatePESTELAnalysis — NEW: Company-specific PESTEL analysis
// Returns 6 PESTEL dimensions with LLM-written company-specific assessments.
// ============================================================
export interface PESTELInput {
  ticker: string;
  companyName: string;
  sector: string;
  industry: string;
  description: string;
  revenue: number;
  revenueGrowth: number;
  fcfMargin: number;
  governmentExposure: number;
  beta: number;
  topCatalysts: Array<{ name: string; context: string }>;
  capexContext?: { sector: string; programmes: string[]; rationale: string } | null;
  recentNewsHeadlines?: string[];
  keyProjects?: string[];
}

export interface PESTELDimensionResult {
  dimension: string;       // "Politisch" | "Ökonomisch" | "Sozial" | "Technologisch" | "Ökologisch" | "Rechtlich"
  impact: string;          // "positiv" | "neutral" | "negativ" | "gemischt"
  score: number;           // -5 (sehr negativ) bis +5 (sehr positiv)
  summary: string;         // 1-2 German sentences, company-specific
  keyFactors: string[];    // 2-3 concrete factors
}

export async function generatePESTELAnalysis(
  input: PESTELInput
): Promise<PESTELDimensionResult[] | null> {
  const client = getClient();
  if (!client) return null;

  const {
    ticker, companyName, sector, industry, description,
    revenue, revenueGrowth, fcfMargin, governmentExposure, beta,
    topCatalysts, capexContext, recentNewsHeadlines = [], keyProjects = [],
  } = input;

  const descCore = (description || "").slice(0, 600);
  const catCtx = topCatalysts.slice(0, 3).map(c => `- ${c.name}: ${c.context.slice(0, 120)}`).join("\n");
  const newsCtx = recentNewsHeadlines.slice(0, 5).map((h, i) => `N${i+1}: ${h}`).join("\n");
  const projCtx = keyProjects.slice(0, 5).map(p => `- ${p}`).join("\n");
  const capexLine = capexContext
    ? `FISKAL: ${companyName} profitiert von ${capexContext.programmes.slice(0,2).join(" & ")} (${capexContext.sector})`
    : "";
  const metrics = [
    revenue > 0 ? `Umsatz $${(revenue / 1e9).toFixed(1)}B` : null,
    revenueGrowth !== 0 ? `RevWachstum ${revenueGrowth.toFixed(1)}%` : null,
    fcfMargin !== 0 ? `FCF-Marge ${fcfMargin.toFixed(1)}%` : null,
    governmentExposure > 0.05 ? `Gov-Exposure ${(governmentExposure * 100).toFixed(0)}%` : null,
    `Beta ${beta.toFixed(2)}`,
  ].filter(Boolean).join(" | ");

  const prompt = `Du bist Senior Equity Research Analyst. Erstelle eine firmenspezifische PESTEL-Analyse für ${companyName} (${ticker}).

UNTERNEHMEN: ${companyName} (${ticker}) | ${sector} / ${industry}
KENNZAHLEN: ${metrics}
GESCHÄFTSMODELL: ${descCore}
${capexLine ? `\n${capexLine}` : ""}
${catCtx ? `\nKATALYSATOREN:\n${catCtx}` : ""}
${newsCtx ? `\nNEWS:\n${newsCtx}` : ""}
${projCtx ? `\nPROJEKTE:\n${projCtx}` : ""}

REGELN:
1. JEDE Dimension muss ${companyName} konkret benennen — Gesetze, Produkte, Regionen spezifisch
2. VERBOTEN: generische PESTEL-Templates ohne Firmenbezug
3. score: -5 bis +5 (-5=stark negativ, 0=neutral, +5=stark positiv)
4. impact: "positiv" (score>1) | "negativ" (score<-1) | "neutral" (score -1 bis 1) | "gemischt"
5. keyFactors: 2-3 konkrete firmenspezifische Faktoren
6. summary: 1-2 Sätze Deutsch, mit Zahlen/Produktnamen wenn vorhanden

Antworte NUR mit JSON:
{"dimensions":[{"dimension":"Politisch","impact":"positiv|negativ|neutral|gemischt","score":2,"summary":"Firmenspezifisch 1-2 Sätze.","keyFactors":["Faktor 1","Faktor 2"]},{"dimension":"Ökonomisch","impact":"...","score":1,"summary":"...","keyFactors":["..."]},{"dimension":"Sozial","impact":"...","score":0,"summary":"...","keyFactors":["..."]},{"dimension":"Technologisch","impact":"...","score":3,"summary":"...","keyFactors":["..."]},{"dimension":"Ökologisch","impact":"...","score":-1,"summary":"...","keyFactors":["..."]},{"dimension":"Rechtlich","impact":"...","score":-2,"summary":"...","keyFactors":["..."]}]}`;

  try {
    console.log(`[PESTEL] Generating PESTEL for ${ticker}`);
    const result = await callLLMJson({ prompt, maxTokens: 1400, temperature: 0.3 });
    if (!result) return null;
    const dimensions = result.data?.dimensions;
    if (!Array.isArray(dimensions) || dimensions.length < 5) {
      console.warn(`[PESTEL] Invalid dimensions for ${ticker}: got ${dimensions?.length ?? 0}`);
      return null;
    }
    const VALID_DIMS = ["Politisch", "Ökonomisch", "Sozial", "Technologisch", "Ökologisch", "Rechtlich"];
    const VALID_IMPACTS = ["positiv", "negativ", "neutral", "gemischt"];
    const validated: PESTELDimensionResult[] = dimensions.slice(0, 6).map((d: any, i: number) => ({
      dimension: String(d.dimension || VALID_DIMS[i] || `Dim ${i+1}`),
      impact: VALID_IMPACTS.includes(d.impact) ? d.impact : "neutral",
      score: Math.min(Math.max(Number(d.score) || 0, -5), 5),
      summary: String(d.summary || "").slice(0, 300),
      keyFactors: Array.isArray(d.keyFactors) ? d.keyFactors.slice(0, 3).map((x: any) => String(x).slice(0, 120)) : [],
    }));
    console.log(`[PESTEL] OK for ${ticker}: ${validated.map(d => `${d.dimension}(${d.score})`).join(", ")}`);
    return validated;
  } catch (e: any) {
    console.error(`[PESTEL] Exception for ${ticker}: ${e?.message}`);
    return null;
  }
}
