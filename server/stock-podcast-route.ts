/**
 * POST /api/stock-podcast/:symbol — Skript des Aktien-Podcasts in Section 2.
 * Kette: Section1 → useStockPodcast (apiRequest) → diese Route →
 *   Kapitel 1: earnings-call-source (FMP-Transkript, sonst SEC EX-99.1) → OpenRouter (STOCK_PODCAST_MODEL)
 *   Kapitel 2: mitgeschickter Chat-Kontext (buildStockChatContext, gleiches Zod-Schema wie /api/chat) → OpenRouter
 * Cache je Ticker und Quartal (Speicher + researcher_cache auf Disk). Kein Score, kein Schema,
 * analyze-route.ts bleibt unberührt. Fehlt der Call, bleibt Kapitel 1 n/a mit Grund.
 */
import type { Express, Request, Response } from "express";
import { fitChatContextBudget, type ChatContext } from "../shared/chat-context";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";
import { wordCount } from "../shared/podcast-player";
import {
  STOCK_PODCAST_MODEL, STOCK_PODCAST_PARAMS, lengthWindow, quarterLabel, shareWords, stockPodcastCacheKey,
  type EarningsCallMeta, type StockPodcastChapterText, type StockPodcastScript,
} from "../shared/stock-podcast";
import { chatRequestSchema, formatContextForPrompt } from "./chat-route";
import type { FetchedEarningsCall } from "./earnings-call-source";

const SYMBOL = /^[A-Za-z0-9.\-]{1,24}$/;

type LlmFn = (opts: {
  prompt: string; systemPrompt?: string; maxTokens?: number; temperature?: number; signal?: AbortSignal; model?: string;
}) => Promise<{ data: any; modelUsed: string } | null>;

export interface StockPodcastDeps {
  earnings: (symbol: string) => Promise<FetchedEarningsCall>;
  llmAvailable: () => boolean;
  llm: LlmFn;
  cacheGet: (key: string, ttlMs: number) => StockPodcastScript | null;
  cacheSet: (key: string, script: StockPodcastScript) => void;
  now: () => number;
}

const memory = new Map<string, { at: number; script: StockPodcastScript }>();

export function resetStockPodcastCache(): void {
  memory.clear();
}

function deDate(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** Fester Einstieg aus den Metadaten der Quelle, damit Datum und Quartal nie vom Modell kommen. */
export function earningsIntro(name: string, meta: EarningsCallMeta): string {
  const q = quarterLabel(meta);
  const when = deDate(meta.date);
  const what = meta.kind === "fmp-transcript" ? "Earnings Call" : "Quartalsmeldung";
  const parts = [
    `${name}, ${what}${when ? ` vom ${when}` : ""}${q ? `, ${q}` : ", Quartal laut Quelle nicht genannt"}.`,
    `Quelle: ${meta.sourceLabel}.`,
  ];
  if (meta.kind === "sec-exhibit") parts.push("Ein Transkript des Calls lag nicht vor; die Fragerunde ist deshalb nicht Teil dieser Folge.");
  return parts.join(" ");
}

/** Anteile je Block in Wörtern. Ohne Fragerunde (SEC) verteilt sich der Q&A-Anteil auf die übrigen Blöcke. */
export function earningsBlockWords(kind: EarningsCallMeta["kind"]): Record<"guidance" | "segments" | "quotes" | "qa", number> {
  const s = STOCK_PODCAST_PARAMS.earningsShares;
  const total = STOCK_PODCAST_PARAMS.earningsTargetWords;
  if (kind === "fmp-transcript") {
    return { guidance: shareWords(total, s.guidance), segments: shareWords(total, s.segments), quotes: shareWords(total, s.quotes), qa: shareWords(total, s.qa) };
  }
  const rest = s.guidance + s.segments + s.quotes;
  return { guidance: shareWords(total, s.guidance / rest), segments: shareWords(total, s.segments / rest), quotes: shareWords(total, s.quotes / rest), qa: 0 };
}

export function earningsPrompt(name: string, meta: EarningsCallMeta, source: string): { system: string; prompt: string } {
  const w = earningsBlockWords(meta.kind);
  const win = lengthWindow(STOCK_PODCAST_PARAMS.earningsTargetWords);
  const isTranscript = meta.kind === "fmp-transcript";
  const blocks = [
    `1. Guidance und Ausblick (rund ${w.guidance} Wörter): Zahlen und Spannen genau wie in der Quelle; fehlt eine Guidance, sage „Guidance: n/a, in der Quelle nicht genannt“.`,
    `2. Segmente (rund ${w.segments} Wörter): jedes Segment mit Umsatz und Wachstum, soweit genannt.`,
    `3. Management-Zitate (rund ${w.quotes} Wörter, höchstens ${STOCK_PODCAST_PARAMS.maxQuotes}): jedes Zitat mit Sprecher und Funktion, genau so wie in der Quelle genannt, sinngemäß ins Deutsche übertragen. Kein Zitat ohne Sprecher aus der Quelle.`,
    isTranscript
      ? `4. Q&A-Highlights (rund ${w.qa} Wörter): die wichtigsten Analystenfragen und Antworten, mit Namen, soweit genannt.`
      : "4. Q&A: Die Quelle ist eine Pressemitteilung ohne Fragerunde. Schreibe dazu genau einen Satz: „Q&A: n/a, die Pressemitteilung enthält keine Fragerunde.“",
  ];
  const system = [
    "Du schreibst das gesprochene Skript eines deutschen Finanz-Podcasts.",
    "Nutze ausschließlich Aussagen und Zahlen aus der QUELLE. Erfinde nichts; fehlt etwas, sage n/a.",
    "Schreibe ganze Sätze zum Vorlesen: keine Aufzählungszeichen, keine Tabellen, keine Markdown-Zeichen, Zahlen im deutschen Format.",
    "Datum, Quartal und Quelle werden vor deinem Text bereits genannt; wiederhole sie nicht und nenne kein anderes Datum oder Quartal als Bezug.",
    "Keine Anlageberatung, keine Kursziele, keine Scores.",
    "Antworte nur mit JSON: {\"paragraphs\": string[]}.",
  ].join(" ");
  const prompt = [
    `Unternehmen: ${name}. Quelle: ${meta.sourceLabel}.`,
    `Länge gesamt ${win.min} bis ${win.max} Wörter, gegliedert in diese Blöcke, je Block ein oder mehrere Absätze:`,
    ...blocks,
    "",
    "QUELLE:",
    source.slice(0, STOCK_PODCAST_PARAMS.sourceMaxChars),
  ].join("\n");
  return { system, prompt };
}

export function analysisPrompt(ctx: ChatContext): { system: string; prompt: string } {
  const win = lengthWindow(STOCK_PODCAST_PARAMS.analysisTargetWords);
  const system = [
    "Du schreibst das gesprochene Skript eines deutschen Finanz-Podcasts.",
    "Nutze ausschließlich Werte aus dem KONTEXT dieser App-Analyse. Fehlt ein Wert (n/a), sage das und erfinde nichts.",
    "Nenne keine neuen Score-Werte und keine Kursziele, die nicht im KONTEXT stehen. Keine Anlageberatung.",
    "Schreibe ganze Sätze zum Vorlesen: keine Aufzählungszeichen, keine Abkürzungen wie S4, keine Markdown-Zeichen.",
    "Antworte nur mit JSON: {\"paragraphs\": string[]}.",
  ].join(" ");
  const prompt = [
    `Länge ${win.min} bis ${win.max} Wörter. Ordne die Daten zu einem Bild, nicht Sektion für Sektion:`,
    "Wachstumstreiber, Finanzkennzahlen, Burggraben, Bewertung und was der Preis impliziert, Momentum, Risiken, und zum Schluss ein Fazit in zwei bis drei Sätzen.",
    "",
    "KONTEXT:",
    formatContextForPrompt(ctx, null),
  ].join("\n");
  return { system, prompt };
}

function paragraphsOf(data: any): string[] {
  const raw = Array.isArray(data?.paragraphs) ? data.paragraphs : typeof data?.text === "string" ? String(data.text).split(/\n\s*\n/) : [];
  return raw.filter((p: unknown): p is string => typeof p === "string").map((p: string) => p.replace(/[*#_`]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

function chapterNa(title: string, reason: string): StockPodcastChapterText {
  return { status: "n/a", reason, title, text: "", wordCount: 0 };
}

function lengthNote(words: number, target: number): string | null {
  const win = lengthWindow(target);
  if (words < win.min) return `kürzer als Ziel (${words} von ${win.min}–${win.max} Wörtern)`;
  if (words > win.max) return `länger als Ziel (${words} von ${win.min}–${win.max} Wörtern)`;
  return null;
}

async function writeChapter(deps: StockPodcastDeps, title: string, p: { system: string; prompt: string }, target: number, intro: string | null): Promise<{ chapter: StockPodcastChapterText; model: string | null }> {
  try {
    const res = await deps.llm({
      prompt: p.prompt, systemPrompt: p.system, model: STOCK_PODCAST_MODEL,
      maxTokens: STOCK_PODCAST_PARAMS.maxTokensPerChapter, temperature: STOCK_PODCAST_PARAMS.temperature,
      signal: AbortSignal.timeout(STOCK_PODCAST_PARAMS.llmTimeoutMs),
    });
    const paragraphs = paragraphsOf(res?.data);
    if (!res || !paragraphs.length) return { chapter: chapterNa(title, "n/a — OpenRouter lieferte kein Skript"), model: res?.modelUsed ?? null };
    const body = paragraphs.join("\n\n");
    const text = intro ? `${intro}\n\n${body}` : body;
    const words = wordCount(body);
    return { chapter: { status: "ok", reason: lengthNote(words, target), title, text, wordCount: wordCount(text) }, model: res.modelUsed };
  } catch {
    return { chapter: chapterNa(title, "n/a — OpenRouter-Aufruf fehlgeschlagen oder Zeitlimit erreicht"), model: null };
  }
}

export type StockPodcastBody = { context: unknown; companyName?: unknown };

export async function buildStockPodcast(symbol: string, body: StockPodcastBody, deps: StockPodcastDeps): Promise<{ http: number; script: StockPodcastScript | null; error: string | null }> {
  const key = symbol.toUpperCase();
  const rawCtx = body?.context as ChatContext | undefined;
  const fitted = rawCtx && typeof rawCtx === "object" && Array.isArray(rawCtx.sections) ? fitChatContextBudget(rawCtx) : rawCtx;
  const parsed = chatRequestSchema.shape.context.safeParse(fitted);
  if (!parsed.success) return { http: 400, script: null, error: `Ungültiger Kontext: ${parsed.error.issues[0]?.path.join(".") ?? ""}` };
  const ctx = parsed.data as unknown as ChatContext;
  if (ctx.dashboard !== "stock") return { http: 400, script: null, error: "Ungültiger Kontext: kein Aktien-Kontext" };
  if (ctx.entity.toUpperCase() !== key) return { http: 400, script: null, error: "Ungültiger Kontext: Ticker passt nicht" };
  const name = typeof body.companyName === "string" && body.companyName.trim() ? body.companyName.trim().slice(0, 80) : key;

  const call = await deps.earnings(key);
  const cacheKey = stockPodcastCacheKey(key, call.meta);
  const ttl = call.status === "ok" ? STOCK_PODCAST_PARAMS.scriptTtlMs : STOCK_PODCAST_PARAMS.naScriptTtlMs;
  const mem = memory.get(cacheKey);
  if (mem && deps.now() - mem.at < ttl) return { http: 200, script: { ...mem.script, cached: true }, error: null };
  const disk = deps.cacheGet(cacheKey, ttl);
  if (disk) {
    memory.set(cacheKey, { at: deps.now(), script: disk });
    return { http: 200, script: { ...disk, cached: true }, error: null };
  }

  const earningsTitle = `Earnings Call${quarterLabel(call.meta) ? ` ${quarterLabel(call.meta)}` : ""}`;
  const analysisTitle = "KI-Gesamtanalyse";
  const llmOk = deps.llmAvailable();
  const noKey = `n/a — ${OPENROUTER_NO_KEY_MESSAGE}`;

  const earningsJob = call.status !== "ok" || !call.meta || !call.content
    ? Promise.resolve({ chapter: chapterNa(earningsTitle, call.reason ?? "n/a — kein Earnings Call gefunden"), model: null })
    : !llmOk ? Promise.resolve({ chapter: chapterNa(earningsTitle, noKey), model: null })
    : writeChapter(deps, earningsTitle, earningsPrompt(name, call.meta, call.content), STOCK_PODCAST_PARAMS.earningsTargetWords, earningsIntro(name, call.meta));
  const analysisJob = !llmOk
    ? Promise.resolve({ chapter: chapterNa(analysisTitle, noKey), model: null })
    : writeChapter(deps, analysisTitle, analysisPrompt(ctx), STOCK_PODCAST_PARAMS.analysisTargetWords, null);
  const [earnings, analysis] = await Promise.all([earningsJob, analysisJob]);

  const script: StockPodcastScript = {
    symbol: key,
    cacheKey,
    generatedAt: new Date(deps.now()).toISOString(),
    model: earnings.model ?? analysis.model,
    earnings: { ...earnings.chapter, meta: call.meta, diagnostics: call.diagnostics },
    analysis: { ...analysis.chapter, asOf: ctx.asOf },
    cached: false,
  };
  const earningsDone = call.status !== "ok" || earnings.chapter.status === "ok";
  if (llmOk && earningsDone && analysis.chapter.status === "ok") {
    memory.set(cacheKey, { at: deps.now(), script });
    deps.cacheSet(cacheKey, script);
  }
  return { http: 200, script, error: null };
}

export function registerStockPodcastRoute(app: Express, depsOverride?: StockPodcastDeps): void {
  app.post("/api/stock-podcast/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "");
    if (!SYMBOL.test(symbol)) {
      res.status(400).json({ error: "Ungültiges Symbol" });
      return;
    }
    const deps: StockPodcastDeps = depsOverride ?? await (async () => {
      const source = await import("./earnings-call-source");
      const llm = await import("./llm-openrouter");
      const disk = await import("./disk-cache");
      return {
        earnings: (s: string) => source.resolveLatestEarningsCall(s),
        llmAvailable: llm.isLLMAvailable,
        llm: llm.callLLMJson,
        cacheGet: (k: string, ttl: number) => (disk.diskResearcherGetWithTtl(k, ttl)?.data as StockPodcastScript | undefined) ?? null,
        cacheSet: (k: string, s: StockPodcastScript) => disk.diskResearcherSet(k, s),
        now: () => Date.now(),
      };
    })();
    try {
      const out = await buildStockPodcast(symbol, req.body ?? {}, deps);
      if (out.script) res.status(out.http).json(out.script);
      else res.status(out.http).json({ error: out.error });
    } catch (err) {
      console.warn(`[STOCK-PODCAST] ${symbol}: ${String((err as Error)?.message ?? err).slice(0, 160)}`);
      res.status(500).json({ error: "Podcast-Skript konnte nicht erstellt werden" });
    }
  });
}
