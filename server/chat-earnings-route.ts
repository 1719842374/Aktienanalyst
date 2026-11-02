/**
 * GET /api/chat/earnings-brief/:symbol
 * Kette: Hook → routes.ts → dieser Handler → FMP (bestehender Key) + optional
 * die bestehende OpenRouter-Zusammenfassung. Fällt FMP aus (Key, Plan/HTTP 402,
 * kein Transkript), greift der kostenlose Fallback: letzter Earnings Release bei
 * der SEC (8-K Item 2.02 bzw. 6-K, Exhibit 99.1) mit Datum, Link und Zitaten.
 * Kein Score, server/analyze-route.ts bleibt unberührt.
 */
import type { Express, Request, Response } from "express";
import { chatEarningsPartChars } from "../shared/chat-context";
import {
  clipTranscriptExcerpt, earningsBriefNa, extractReleaseQuotes, extractTranscriptQuotes, latestTranscriptSlot, transcriptContent,
  type EarningsCallBrief,
} from "../shared/chat-earnings";
import type { SecEarningsRelease } from "./sec-edgar";

const SYMBOL = /^[A-Za-z0-9.\-]{1,24}$/;
export const EARNINGS_BRIEF_SOURCE = "fmp/earning-call-transcript";
/** Neue Quartalszahlen kommen alle paar Wochen; nach dieser Zeit wird neu geholt. */
export const EARNINGS_BRIEF_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type LlmFn = (opts: { prompt: string; maxTokens?: number; temperature?: number; systemPrompt?: string }) =>
  Promise<{ data: any; modelUsed: string } | null>;

export interface EarningsBriefDeps {
  dates: (symbol: string) => Promise<unknown>;
  transcript: (symbol: string, year: number, quarter: number) => Promise<unknown>;
  llmAvailable: () => boolean;
  llm: LlmFn;
  /** Symbole, unter denen FMP den Titel führen kann (Listing zuerst, dann ADR). Ohne Angabe nur das Listing. */
  fmpSymbols?: (symbol: string) => string[];
  /** Kostenloser Fallback: letzter Earnings Release bei der SEC. Ohne Angabe kein Fallback. */
  release?: (symbol: string) => Promise<{ release: SecEarningsRelease | null; reason: string | null }>;
}

const cache = new Map<string, { at: number; brief: EarningsCallBrief }>();

export function resetEarningsBriefCache(): void {
  cache.clear();
}

function remember(key: string, brief: EarningsCallBrief): EarningsCallBrief {
  cache.set(key, { at: Date.now(), brief });
  return brief;
}

/** Grund mit dem Text, den FMP selbst schickt (z. B. Plan-Hinweis bei 402). */
export function fmpReason(err: unknown): string {
  const e = err as { message?: string; fmpStatus?: number; fmpMessage?: string | null };
  if (typeof e?.message === "string" && e.message.includes("FMP_API_KEY")) return "n/a — FMP_API_KEY nicht konfiguriert";
  if (typeof e?.fmpStatus === "number") {
    const detail = typeof e.fmpMessage === "string" && e.fmpMessage ? `: ${e.fmpMessage}` : "";
    const plan = e.fmpStatus === 402 ? " (FMP meldet 402, wenn der Endpoint oder das Symbol nicht im Abo enthalten ist)" : "";
    return `n/a — FMP Earnings-Call antwortete HTTP ${e.fmpStatus}${plan}${detail}`;
  }
  return "n/a — FMP Earnings-Call nicht erreichbar";
}

const SUMMARY_PROMPT: Record<NonNullable<EarningsCallBrief["kind"]>, string> = {
  transcript: "Fasse den Earnings-Call-Auszug auf Deutsch zusammen. Nur Aussagen, die im Auszug stehen. Fehlt Beat/Miss oder der Ausblick, schreibe das ausdrücklich als n/a. Antworte nur mit JSON: {\"summary\": string}.",
  "earnings-release": "Fasse den Earnings Release (Pressemitteilung zu den Quartalszahlen) auf Deutsch zusammen: Umsatz, Ergebnis, Veränderung zum Vorjahr, Ausblick. Nur Aussagen und Zahlen, die im Text stehen. Fehlt etwas, schreibe n/a. Antworte nur mit JSON: {\"summary\": string}.",
};

/** KI-Zusammenfassung des Auszugs. Ohne Key oder bei Fehler: null plus Grund. */
async function summarize(excerpt: string, kind: NonNullable<EarningsCallBrief["kind"]>, deps: EarningsBriefDeps): Promise<{ summary: string | null; reason: string | null }> {
  if (!deps.llmAvailable()) return { summary: null, reason: "n/a — keine KI-Zusammenfassung, OpenRouter-Key fehlt; der Auszug steht im Kontext" };
  try {
    const res = await deps.llm({ systemPrompt: SUMMARY_PROMPT[kind], prompt: excerpt, temperature: 0.2 });
    const text = typeof res?.data?.summary === "string" ? res.data.summary.trim() : "";
    if (!text) return { summary: null, reason: "n/a — OpenRouter lieferte keine Zusammenfassung; der Auszug steht im Kontext" };
    return { summary: clipTranscriptExcerpt(text, chatEarningsPartChars("zusammenfassung")).excerpt, reason: null };
  } catch {
    return { summary: null, reason: "n/a — OpenRouter-Zusammenfassung fehlgeschlagen; der Auszug steht im Kontext" };
  }
}

/** FMP-Transkript des jüngsten Calls laut Terminliste. Liefert den Brief oder den Grund, warum nicht. */
async function fmpTranscriptBrief(key: string, deps: EarningsBriefDeps): Promise<{ brief: EarningsCallBrief | null; reason: string; slotOnly?: EarningsCallBrief }> {
  const symbols = Array.from(new Set([key, ...(deps.fmpSymbols?.(key) ?? [])]));
  const reasons: string[] = [];
  for (const sym of symbols) {
    let dates: unknown;
    try {
      dates = await deps.dates(sym);
    } catch (err) {
      reasons.push(symbols.length > 1 ? `${sym}: ${fmpReason(err)}` : fmpReason(err));
      continue;
    }
    const slot = latestTranscriptSlot(dates);
    if (!slot) { reasons.push(symbols.length > 1 ? `${sym}: n/a — FMP lieferte keinen Earnings-Call-Termin` : "n/a — FMP lieferte keinen Earnings-Call-Termin"); continue; }
    let raw: unknown;
    try {
      raw = await deps.transcript(sym, slot.year, slot.quarter);
    } catch (err) {
      reasons.push(fmpReason(err));
      continue;
    }
    const content = transcriptContent(raw);
    if (!content) {
      const na = earningsBriefNa(key, `n/a — FMP lieferte kein Transkript für FY${slot.year} Q${slot.quarter}`);
      na.year = slot.year;
      na.quarter = slot.quarter;
      na.date = slot.date;
      return { brief: null, reason: na.reason as string, slotOnly: na };
    }
    const clipped = clipTranscriptExcerpt(content, chatEarningsPartChars("auszug"));
    const sum = await summarize(clipped.excerpt, "transcript", deps);
    return {
      brief: {
        symbol: key, status: "ok",
        reason: sum.reason ?? (sum.summary && clipped.truncated ? "Auszug am Chat-Budget gekürzt" : null),
        year: slot.year, quarter: slot.quarter, date: slot.date,
        summary: sum.summary, excerpt: clipped.excerpt, excerptTruncated: clipped.truncated,
        source: sym === key ? EARNINGS_BRIEF_SOURCE : `${EARNINGS_BRIEF_SOURCE} (${sym})`,
        sourceUrl: null, kind: "transcript", quotes: extractTranscriptQuotes(content),
      },
      reason: "",
    };
  }
  return { brief: null, reason: reasons.join(" | ") || "n/a — FMP Earnings-Call nicht erreichbar" };
}

/** Brief aus dem SEC-Earnings-Release (Exhibit 99.1). */
async function releaseBrief(key: string, rel: SecEarningsRelease, fmpWhy: string, deps: EarningsBriefDeps): Promise<EarningsCallBrief> {
  const clipped = clipTranscriptExcerpt(rel.text, chatEarningsPartChars("auszug"));
  const sum = await summarize(clipped.excerpt, "earnings-release", deps);
  const parts = [`FMP-Transkript ${fmpWhy.replace(/^n\/a — /, "n/a: ")}; stattdessen SEC Earnings Release vom ${rel.filingDate}`];
  if (sum.reason) parts.push(sum.reason);
  if (clipped.truncated) parts.push("Auszug am Chat-Budget gekürzt");
  return {
    symbol: key, status: "ok", reason: parts.join(" | "),
    year: null, quarter: null, date: rel.filingDate,
    summary: sum.summary, excerpt: clipped.excerpt, excerptTruncated: clipped.truncated,
    source: `sec-edgar/${rel.form} Exhibit 99.1 (Accession ${rel.accession})`,
    sourceUrl: rel.url, kind: "earnings-release", quotes: extractReleaseQuotes(rel.text),
  };
}

export async function buildEarningsBrief(symbol: string, deps: EarningsBriefDeps): Promise<EarningsCallBrief> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < EARNINGS_BRIEF_CACHE_TTL_MS) return hit.brief;
  const fmp = await fmpTranscriptBrief(key, deps);
  if (fmp.brief) return remember(key, fmp.brief);
  if (deps.release) {
    const sec = await deps.release(key).catch((err: unknown) => ({ release: null, reason: `n/a — SEC nicht erreichbar (${String((err as Error)?.message ?? err).slice(0, 80)})` }));
    if (sec.release) return remember(key, await releaseBrief(key, sec.release, fmp.reason, deps));
    const reason = `${fmp.reason} | Fallback ${sec.reason ?? "n/a — SEC lieferte keinen Earnings Release"}`;
    return fmp.slotOnly ? remember(key, { ...fmp.slotOnly, reason }) : earningsBriefNa(key, reason);
  }
  if (fmp.slotOnly) return remember(key, fmp.slotOnly);
  const na = earningsBriefNa(key, fmp.reason);
  return /keinen Earnings-Call-Termin/.test(fmp.reason) ? remember(key, na) : na;
}

export function registerChatEarningsRoute(app: Express, depsOverride?: EarningsBriefDeps): void {
  app.get("/api/chat/earnings-brief/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "");
    if (!SYMBOL.test(symbol)) {
      res.status(400).json(earningsBriefNa(symbol, "n/a — ungültiges Symbol"));
      return;
    }
    const deps: EarningsBriefDeps = depsOverride ?? await (async () => {
      const fmp = await import("./fmp");
      const llm = await import("./llm-openrouter");
      const sec = await import("./sec-edgar");
      const adr = await import("./fmp-adr-map");
      return {
        dates: (s) => fmp.fmpEarningCallTranscriptDates(s),
        transcript: (s, year, quarter) => fmp.fmpEarningCallTranscript(s, year, quarter),
        llmAvailable: llm.isLLMAvailable,
        llm: llm.callLLMJson,
        fmpSymbols: (s) => adr.adrCandidatesFor(s).map(c => c.symbol),
        release: async (s) => {
          const filer = await sec.secFilerFor(s);
          if (!filer) return { release: null, reason: `n/a — kein SEC-Filer zu ${s} (auch kein ADR)` };
          return sec.secLatestEarningsRelease(filer.cik10);
        },
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
