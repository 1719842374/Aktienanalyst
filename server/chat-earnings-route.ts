/**
 * GET /api/chat/earnings-brief/:symbol
 * Kette: Hook → routes.ts → dieser Handler → FMP (bestehender Key) + optional
 * die bestehende OpenRouter-Zusammenfassung. Kein neuer Anbieter, kein Score,
 * server/analyze-route.ts bleibt unberührt.
 */
import type { Express, Request, Response } from "express";
import { chatFactAllowedChars } from "../shared/chat-context";
import {
  clipTranscriptExcerpt, earningsBriefNa, latestTranscriptSlot, transcriptContent,
  type EarningsCallBrief,
} from "../shared/chat-earnings";

const SYMBOL = /^[A-Za-z0-9.\-]{1,24}$/;
export const EARNINGS_BRIEF_SOURCE = "fmp/earning-call-transcript";

type LlmFn = (opts: { prompt: string; maxTokens?: number; temperature?: number; systemPrompt?: string }) =>
  Promise<{ data: any; modelUsed: string } | null>;

export interface EarningsBriefDeps {
  dates: (symbol: string) => Promise<unknown>;
  transcript: (symbol: string, year: number, quarter: number) => Promise<unknown>;
  llmAvailable: () => boolean;
  llm: LlmFn;
}

const cache = new Map<string, EarningsCallBrief>();

export function resetEarningsBriefCache(): void {
  cache.clear();
}

function fmpReason(err: unknown): string {
  const e = err as { message?: string; fmpStatus?: number };
  if (typeof e?.message === "string" && e.message.includes("FMP_API_KEY")) return "n/a — FMP_API_KEY nicht konfiguriert";
  if (typeof e?.fmpStatus === "number") return `n/a — FMP Earnings-Call antwortete HTTP ${e.fmpStatus}`;
  return "n/a — FMP Earnings-Call nicht erreichbar";
}

export async function buildEarningsBrief(symbol: string, deps: EarningsBriefDeps): Promise<EarningsCallBrief> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit) return hit;
  let dates: unknown;
  try {
    dates = await deps.dates(key);
  } catch (err) {
    return earningsBriefNa(key, fmpReason(err));
  }
  const slot = latestTranscriptSlot(dates);
  if (!slot) {
    const brief = earningsBriefNa(key, "n/a — FMP lieferte keinen Earnings-Call-Termin");
    cache.set(key, brief);
    return brief;
  }
  let raw: unknown;
  try {
    raw = await deps.transcript(key, slot.year, slot.quarter);
  } catch (err) {
    return earningsBriefNa(key, fmpReason(err));
  }
  const content = transcriptContent(raw);
  if (!content) {
    const brief = earningsBriefNa(key, `n/a — FMP lieferte kein Transkript für FY${slot.year} Q${slot.quarter}`);
    brief.year = slot.year;
    brief.quarter = slot.quarter;
    brief.date = slot.date;
    cache.set(key, brief);
    return brief;
  }
  const clipped = clipTranscriptExcerpt(content, chatFactAllowedChars("notes"));
  let summary: string | null = null;
  let reason: string | null = null;
  if (!deps.llmAvailable()) {
    reason = "n/a — keine KI-Zusammenfassung, OpenRouter-Key fehlt; der Auszug steht im Kontext";
  } else {
    try {
      const res = await deps.llm({
        systemPrompt: "Fasse den Earnings-Call-Auszug auf Deutsch zusammen. Nur Aussagen, die im Auszug stehen. Fehlt Beat/Miss oder der Ausblick, schreibe das ausdrücklich als n/a. Antworte nur mit JSON: {\"summary\": string}.",
        prompt: clipped.excerpt,
        temperature: 0.2,
      });
      const text = typeof res?.data?.summary === "string" ? res.data.summary.trim() : "";
      if (!text) reason = "n/a — OpenRouter lieferte keine Zusammenfassung; der Auszug steht im Kontext";
      else {
        const sumClip = clipTranscriptExcerpt(text, chatFactAllowedChars("notes"));
        summary = sumClip.excerpt;
        if (clipped.truncated) reason = "Auszug am Chat-Budget gekürzt";
      }
    } catch {
      reason = "n/a — OpenRouter-Zusammenfassung fehlgeschlagen; der Auszug steht im Kontext";
    }
  }
  const brief: EarningsCallBrief = {
    symbol: key,
    status: "ok",
    reason,
    year: slot.year,
    quarter: slot.quarter,
    date: slot.date,
    summary,
    excerpt: clipped.excerpt,
    excerptTruncated: clipped.truncated,
    source: EARNINGS_BRIEF_SOURCE,
  };
  cache.set(key, brief);
  return brief;
}

export function registerChatEarningsRoute(app: Express, depsOverride?: EarningsBriefDeps): void {
  app.get("/api/chat/earnings-brief/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "");
    if (!SYMBOL.test(symbol)) {
      res.status(400).json(earningsBriefNa(symbol, "n/a — ungültiges Symbol"));
      return;
    }
    const deps: EarningsBriefDeps = depsOverride ?? await (async () => {
      const source = await import("./earnings-call-source");
      const llm = await import("./llm-openrouter");
      return {
        dates: (s) => source.fetchTranscriptDates(s),
        transcript: (s, year, quarter) => source.fetchTranscript(s, year, quarter),
        llmAvailable: llm.isLLMAvailable,
        llm: llm.callLLMJson,
      };
    })();
    try {
      const brief = await buildEarningsBrief(symbol, deps);
      res.status(200).json(brief);
    } catch (err) {
      console.warn(`[CHAT] Earnings-Brief fehlgeschlagen (${symbol}): ${fmpReason(err)}`);
      res.status(200).json(earningsBriefNa(symbol.toUpperCase(), fmpReason(err)));
    }
  });
}
