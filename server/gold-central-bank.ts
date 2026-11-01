/**
 * F10-34: Zentralbankkäufe als eigener LLM-Hinweis auf den vorhandenen Gold-Schlagzeilen.
 * Das News-Flag und der GIS bleiben unberührt. Cache wie die News-Sektion (GOLD_NEWS_CACHE_HOURS).
 */
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { diskResearcherGetWithTtl, diskResearcherSet } from "./disk-cache";
import { fetchGoldNewsItems, GOLD_NEWS_CACHE_HOURS } from "./gold-news";
import {
  centralBankResponse,
  interpretCentralBankLlm,
  type GoldCbStance,
  type GoldCentralBankResponse,
} from "../shared/gold-central-bank";

export const GOLD_CB_CACHE_TTL_MS = GOLD_NEWS_CACHE_HOURS * 60 * 60 * 1000;
const CACHE_KEY = "gold_cb_purchases_v1";

export interface GoldCbCacheEntry {
  storedAt: number;
  stance: GoldCbStance;
  summary: string | null;
  updatedAt: string;
  headlineCount: number;
}

export interface GoldCbDeps {
  now: number;
  llmAvailable: boolean;
  fetchHeadlines: () => Promise<string[]>;
  complete: (headlines: string[]) => Promise<unknown>;
  cacheGet: () => GoldCbCacheEntry | null;
  cacheSet: (entry: GoldCbCacheEntry) => void;
}

function prompt(headlines: string[]): string {
  return `Schlagzeilen:
${headlines.slice(0, 8).map((headline, index) => `${index + 1}. ${headline}`).join("\n")}

Gibt es Hinweise auf Käufe oder Verkäufe von Gold durch Zentralbanken (Europa oder global)?
stance: "net_buying" | "net_selling" | "unchanged" | "unclear"
summary: 1-2 Sätze, nur was die Schlagzeilen hergeben. Keine Tonnen und keine Zahlen erfinden.
Wenn die Schlagzeilen dazu nichts sagen: stance "unclear" und summary "".
Antworte nur als JSON.`;
}

export async function loadCentralBankPurchases(deps: GoldCbDeps): Promise<GoldCentralBankResponse> {
  const cached = deps.cacheGet();
  if (cached && deps.now - cached.storedAt < GOLD_CB_CACHE_TTL_MS) {
    return centralBankResponse({
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
      headlineCount: cached.headlineCount,
      stance: cached.stance,
      summary: cached.summary,
      updatedAt: cached.updatedAt,
      reason: null,
    });
  }

  let headlines: string[] = [];
  try {
    headlines = (await deps.fetchHeadlines()).map(line => line.trim()).filter(Boolean).slice(0, 8);
  } catch (err: any) {
    return centralBankResponse({
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
      headlineCount: 0,
      stance: null,
      summary: null,
      updatedAt: null,
      reason: `n/a — Gold-News nicht abrufbar (${err?.message?.substring(0, 80) || "Fehler"})`,
    });
  }
  if (headlines.length === 0) {
    return centralBankResponse({
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
      headlineCount: 0,
      stance: null,
      summary: null,
      updatedAt: null,
      reason: "n/a — keine Gold-Meldungen",
    });
  }
  if (!deps.llmAvailable) {
    return centralBankResponse({
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
      headlineCount: headlines.length,
      stance: null,
      summary: null,
      updatedAt: null,
      reason: "n/a — OPENROUTER_API_KEY fehlt",
    });
  }

  let raw: unknown = null;
  try {
    raw = await deps.complete(headlines);
  } catch (err: any) {
    return centralBankResponse({
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
      headlineCount: headlines.length,
      stance: null,
      summary: null,
      updatedAt: null,
      reason: `n/a — OpenRouter fehlgeschlagen (${err?.message?.substring(0, 80) || "Fehler"})`,
    });
  }
  const parsed = interpretCentralBankLlm(raw, true);
  if (!parsed.stance) {
    return centralBankResponse({
      cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
      headlineCount: headlines.length,
      stance: null,
      summary: null,
      updatedAt: null,
      reason: parsed.reason,
    });
  }
  const updatedAt = new Date(deps.now).toISOString();
  deps.cacheSet({
    storedAt: deps.now,
    stance: parsed.stance,
    summary: parsed.summary,
    updatedAt,
    headlineCount: headlines.length,
  });
  return centralBankResponse({
    cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
    headlineCount: headlines.length,
    stance: parsed.stance,
    summary: parsed.summary,
    updatedAt,
    reason: null,
  });
}

let memoryCache: GoldCbCacheEntry | null = null;

export function resetCentralBankPurchaseCache(): void {
  memoryCache = null;
}

export async function getCentralBankPurchases(): Promise<GoldCentralBankResponse> {
  return loadCentralBankPurchases({
    now: Date.now(),
    llmAvailable: isLLMAvailable(),
    fetchHeadlines: async () => (await fetchGoldNewsItems()).map(item => item.title),
    complete: async headlines => {
      const result = await callLLMJson({
        prompt: prompt(headlines),
        temperature: 0.2,
        maxTokens: 400,
        systemPrompt: "Du liest nur die gelieferten Schlagzeilen auf Zentralbankkäufe von Gold. Antworte als JSON mit stance und summary. Erfinde keine Mengen.",
      });
      return result?.data ?? null;
    },
    cacheGet: () => {
      if (memoryCache && Date.now() - memoryCache.storedAt < GOLD_CB_CACHE_TTL_MS) return memoryCache;
      const disk = diskResearcherGetWithTtl(CACHE_KEY, GOLD_CB_CACHE_TTL_MS);
      if (!disk?.data || typeof disk.data.stance !== "string") return null;
      memoryCache = { ...(disk.data as GoldCbCacheEntry), storedAt: disk.storedAt };
      return memoryCache;
    },
    cacheSet: entry => {
      memoryCache = entry;
      try { diskResearcherSet(CACHE_KEY, entry); } catch { /* Disk ist der Backstop */ }
    },
  });
}
