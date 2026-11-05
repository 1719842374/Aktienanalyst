/**
 * Aktien-Podcast in Section 2 (Datenaktualität & Plausibilität).
 * Kapitel 1: Earnings Call (FMP-Transkript, sonst SEC-Exhibit 99.1).
 * Kapitel 2: KI-Gesamtanalyse aus den geladenen App-Daten (buildStockChatContext).
 * Fehlt der Call, bleibt Kapitel 1 n/a mit Grund. Nichts wird erfunden.
 */
import type { PlayerChapter, PlayerEpisode } from "./podcast-player";
import { sentencesOfParagraphs } from "./podcast-player";

/**
 * Env-Variable, die das Skript-Modell überschreibt. Bestehender globaler Override (llm-openrouter.ts),
 * keine eigene Podcast-Variable.
 */
export const STOCK_PODCAST_MODEL_ENV = "OPENROUTER_MODEL";
/**
 * Code-Default, wenn OPENROUTER_MODEL leer oder keine OpenRouter-ID ist.
 * Haiku 4.5 (Philip, 02.11.2026: Opus 5.5 zu teuer), wie CHAT_LLM_DEFAULT_MODEL in chat-route.ts (#430).
 */
export const STOCK_PODCAST_DEFAULT_MODEL = "anthropic/claude-haiku-4.5";
/** OpenRouter-ID "anbieter/modell[:variante]", gleiches Muster wie chatLlmModels in chat-route.ts (#430). */
const OPENROUTER_MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.:-]+$/i;

/** Skript-Modell: gültiger Env-Wert vor Code-Default. Wird je Anfrage gelesen. */
export function stockPodcastModel(env: Record<string, string | undefined>): { model: string; invalidEnv: string | null } {
  const configured = env[STOCK_PODCAST_MODEL_ENV]?.trim() ?? "";
  if (!configured) return { model: STOCK_PODCAST_DEFAULT_MODEL, invalidEnv: null };
  return OPENROUTER_MODEL_ID.test(configured)
    ? { model: configured, invalidEnv: null }
    : { model: STOCK_PODCAST_DEFAULT_MODEL, invalidEnv: configured };
}

export const STOCK_PODCAST_PARAMS = {
  /** Ziellänge Kapitel 1 in Wörtern: ausführlich, rund acht Minuten bei 145 Wörtern/Minute. */
  earningsTargetWords: 1200,
  /** Ziellänge Kapitel 2 in Wörtern, rund vier Minuten. */
  analysisTargetWords: 600,
  /** Toleranz um die Ziellänge, als Anteil. */
  lengthTolerance: 0.2,
  /** Anteile in Kapitel 1. Summe 1. Q&A fällt bei SEC-Quellen weg (dort keine Fragerunde). */
  earningsShares: { guidance: 0.25, segments: 0.25, quotes: 0.25, qa: 0.25 },
  /** Höchstzahl wörtlicher Management-Zitate in Kapitel 1. */
  maxQuotes: 6,
  /** So viele Zeichen der Quelle gehen in den Prompt (rund 30.000 Token, passt in die 200.000 Token von Haiku 4.5). */
  sourceMaxChars: 120_000,
  /** Token-Decke je Kapitel-Antwort (callLLMJson deckelt bei 4000). */
  maxTokensPerChapter: 4000,
  temperature: 0.25,
  /** Timeout je Kapitel-Call. Liegt unter dem Client-Timeout. */
  llmTimeoutMs: 150_000,
  /** Client-Timeout für POST /api/stock-podcast. */
  clientTimeoutMs: 180_000,
  /** Cache eines fertigen Skripts: ein Quartal plus Puffer bis zum nächsten Call. */
  scriptTtlMs: 120 * 24 * 60 * 60 * 1000,
  /** Cache, wenn Kapitel 1 n/a ist: kurz, der Call kann kurz danach erscheinen. */
  naScriptTtlMs: 6 * 60 * 60 * 1000,
} as const;

/** Wörter eines Kapitels als Anteil der Ziellänge, z. B. für Guidance in Kapitel 1. */
export function shareWords(total: number, share: number): number {
  return Math.round(total * share);
}

export function lengthWindow(target: number): { min: number; max: number } {
  return {
    min: Math.round(target * (1 - STOCK_PODCAST_PARAMS.lengthTolerance)),
    max: Math.round(target * (1 + STOCK_PODCAST_PARAMS.lengthTolerance)),
  };
}

export type EarningsSourceKind = "fmp-transcript" | "sec-exhibit";

export interface EarningsCallMeta {
  kind: EarningsSourceKind;
  /** Fiskaljahr und Quartal laut Quelle; null, wenn die Quelle sie nicht nennt. */
  fiscalYear: number | null;
  quarter: number | null;
  /** Ende der Berichtsperiode laut Meldung („quarter ended …“), sonst null. */
  periodEnd: string | null;
  /** Datum des Calls (FMP) bzw. Einreichungsdatum des Filings (SEC). */
  date: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
  /** Symbol, unter dem die Quelle geführt wird (SAP.DE → SAP). */
  sourceSymbol: string;
}

export interface StockPodcastChapterText {
  status: "ok" | "n/a";
  reason: string | null;
  title: string;
  /** Absätze, durch Leerzeile getrennt. */
  text: string;
  wordCount: number;
}

export interface StockPodcastScript {
  symbol: string;
  cacheKey: string;
  generatedAt: string;
  model: string | null;
  earnings: StockPodcastChapterText & { meta: EarningsCallMeta | null; diagnostics: string[] };
  analysis: StockPodcastChapterText & { asOf: string | null };
  cached: boolean;
}

/** Schlüssel je Ticker und Quartal; ohne Geschäftsjahr trägt das Filing-Datum das Quartal. */
export function stockPodcastCacheKey(symbol: string, meta: { fiscalYear: number | null; quarter: number | null; date: string | null } | null): string {
  const s = symbol.toUpperCase();
  if (meta && meta.fiscalYear != null && meta.quarter != null) return `stock_podcast_v1__${s}__FY${meta.fiscalYear}Q${meta.quarter}`;
  if (meta?.date) return `stock_podcast_v1__${s}__${meta.date}`;
  return `stock_podcast_v1__${s}__na`;
}

export function quarterLabel(meta: EarningsCallMeta | null): string | null {
  if (!meta) return null;
  if (meta.fiscalYear != null && meta.quarter != null) return `Q${meta.quarter} FY${meta.fiscalYear}`;
  if (meta.quarter != null && meta.periodEnd) return `Q${meta.quarter} (bis ${meta.periodEnd.split("-").reverse().join(".")})`;
  if (meta.quarter != null) return `Q${meta.quarter}`;
  return null;
}

function chapterFrom(id: string, text: StockPodcastChapterText, sourceLabel: string | null, sourceUrl: string | null): PlayerChapter {
  return {
    id,
    title: text.title,
    status: text.status,
    reason: text.reason,
    sentences: text.status === "ok" ? sentencesOfParagraphs(text.text) : [],
    sourceLabel,
    sourceUrl,
  };
}

/** Skript → Episode des gemeinsamen Players. Reihenfolge fest: Call, dann Analyse. */
export function stockPodcastEpisode(script: StockPodcastScript, companyName: string | null): PlayerEpisode {
  const q = quarterLabel(script.earnings.meta);
  const name = companyName || script.symbol;
  return {
    id: script.symbol,
    title: `${name}: ${q ? `${q} Earnings Call` : "Earnings Call"} & KI-Analyse`,
    subtitle: `KI-Podcast · ${script.earnings.meta?.sourceLabel ?? "Earnings Call n/a"}`,
    coverLabel: script.symbol,
    chapters: [
      chapterFrom("earnings-call", script.earnings, script.earnings.meta?.sourceLabel ?? null, script.earnings.meta?.sourceUrl ?? null),
      chapterFrom("analysis", script.analysis, "App-Daten dieser Analyse", null),
    ],
  };
}
