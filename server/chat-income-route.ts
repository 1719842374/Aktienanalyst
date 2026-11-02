/**
 * GET /api/chat/income-statement/:symbol — GuV-Posten samt Unterposten für den KI-Chat.
 * Kette: useIncomeStatementBrief → routes.ts → dieser Handler → SEC EDGAR (companyfacts/XBRL,
 * Filing-Dokument für Link und Erklärungssätze), zweite Quelle FMP-Quartals-GuV (bestehender Key).
 * Nur Anzeige im Chat-Kontext: kein Score, server/analyze-route.ts bleibt unberührt.
 */
import type { Express, Request, Response } from "express";
import {
  incomeBriefFromCompanyFacts, incomeBriefFromFmp, incomeBriefNa, secFiscalYearEnd, withFilingExplanations, withFiscalYearEnd,
  type IncomeStatementBrief,
} from "../shared/chat-income";
import type { SecFiler } from "./sec-edgar";

const SYMBOL = /^[A-Za-z0-9.\-]{1,24}$/;
/** Neue 10-Q/10-K kommen quartalsweise; nach dieser Zeit wird neu geholt. */
export const INCOME_BRIEF_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** So viele FMP-Quartale reichen für aktuelles Quartal und Vorjahresquartal. */
export const INCOME_FMP_QUARTERS = 8;

export interface IncomeBriefDeps {
  secFiler: (symbol: string) => Promise<SecFiler | null>;
  companyFacts: (cik10: string) => Promise<unknown>;
  submissions: (cik10: string) => Promise<unknown>;
  filingDocUrl: (cik10: string, submissions: unknown, accession: string) => string | null;
  filingText: (url: string) => Promise<string>;
  fmpAvailable: () => boolean;
  fmpQuarterly: (symbol: string) => Promise<unknown>;
  /** Symbole, unter denen FMP den Titel führen kann (Listing zuerst, dann ADR). */
  fmpSymbols?: (symbol: string) => string[];
}

const cache = new Map<string, { at: number; brief: IncomeStatementBrief }>();

export function resetIncomeBriefCache(): void {
  cache.clear();
}

function errText(err: unknown): string {
  const e = err as { secStatus?: number; fmpStatus?: number; fmpMessage?: string | null; message?: string };
  if (typeof e?.secStatus === "number") return `HTTP ${e.secStatus}`;
  if (typeof e?.fmpStatus === "number") return `HTTP ${e.fmpStatus}${e.fmpMessage ? `: ${e.fmpMessage}` : ""}`;
  return String(e?.message ?? err).slice(0, 120);
}

async function secBrief(key: string, deps: IncomeBriefDeps): Promise<IncomeStatementBrief> {
  let filer: SecFiler | null;
  try {
    filer = await deps.secFiler(key);
  } catch (err) {
    return incomeBriefNa(key, `n/a — SEC-Tickerliste nicht erreichbar (${errText(err)})`);
  }
  if (!filer) return incomeBriefNa(key, `n/a — ${key} ist kein SEC-Filer (auch kein ADR in der Zuordnung)`);
  let facts: unknown;
  try {
    facts = await deps.companyFacts(filer.cik10);
  } catch (err) {
    return incomeBriefNa(key, `n/a — SEC companyfacts für CIK ${filer.cik10} (${errText(err)})`);
  }
  const base = incomeBriefFromCompanyFacts(key, facts, null);
  if (base.status !== "ok" || !base.accession) return base;
  const viaAdr = filer.secTicker !== key ? [`SEC-Filer ist ${filer.secTicker} (ADR von ${key})`] : [];
  let url: string | null = null;
  let urlWhy = "n/a — Filing nicht in den SEC submissions";
  let submissions: unknown = null;
  try {
    submissions = await deps.submissions(filer.cik10);
    url = deps.filingDocUrl(filer.cik10, submissions, base.accession);
  } catch (err) {
    urlWhy = `n/a — SEC submissions (${errText(err)})`;
  }
  const fiscal = withFiscalYearEnd(base, secFiscalYearEnd(submissions));
  const withUrl: IncomeStatementBrief = { ...fiscal, filingUrl: url, notes: [...viaAdr, ...fiscal.notes] };
  if (!url) return withFilingExplanations(withUrl, null, `${urlWhy}; ohne Filing-Text keine Erklärung`);
  try {
    return withFilingExplanations(withUrl, await deps.filingText(url), "n/a — Filing-Text leer");
  } catch (err) {
    return withFilingExplanations(withUrl, null, `n/a — Filing-Text nicht abrufbar (${errText(err)})`);
  }
}

async function fmpBrief(key: string, deps: IncomeBriefDeps): Promise<IncomeStatementBrief> {
  if (!deps.fmpAvailable()) return incomeBriefNa(key, "n/a — FMP_API_KEY nicht konfiguriert");
  const symbols = Array.from(new Set([key, ...(deps.fmpSymbols?.(key) ?? [])]));
  const reasons: string[] = [];
  for (const sym of symbols) {
    try {
      const brief = incomeBriefFromFmp(key, await deps.fmpQuarterly(sym));
      if (brief.status === "ok") return sym === key ? brief : { ...brief, notes: [`FMP-Symbol ${sym}`, ...brief.notes] };
      reasons.push(`${sym}: ${brief.reason}`);
    } catch (err) {
      reasons.push(`${sym}: n/a — FMP Income Statement (${errText(err)})`);
    }
  }
  return incomeBriefNa(key, reasons.join(" | "));
}

/** SEC zuerst, FMP als zweite Quelle. Beide n/a: n/a mit beiden Gründen. */
export async function buildIncomeStatementBrief(symbol: string, deps: IncomeBriefDeps): Promise<IncomeStatementBrief> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < INCOME_BRIEF_CACHE_TTL_MS) return hit.brief;
  const sec = await secBrief(key, deps);
  if (sec.status === "ok") {
    cache.set(key, { at: Date.now(), brief: sec });
    return sec;
  }
  const fmp = await fmpBrief(key, deps);
  if (fmp.status === "ok") {
    const brief = { ...fmp, notes: [`SEC: ${sec.reason}`, ...fmp.notes] };
    cache.set(key, { at: Date.now(), brief });
    return brief;
  }
  return incomeBriefNa(key, `SEC: ${sec.reason} | FMP: ${fmp.reason}`);
}

export function registerChatIncomeRoute(app: Express, depsOverride?: IncomeBriefDeps): void {
  app.get("/api/chat/income-statement/:symbol", async (req: Request, res: Response) => {
    const symbol = String(req.params.symbol ?? "");
    if (!SYMBOL.test(symbol)) {
      res.status(400).json(incomeBriefNa(symbol, "n/a — ungültiges Symbol"));
      return;
    }
    const deps: IncomeBriefDeps = depsOverride ?? await (async () => {
      const sec = await import("./sec-edgar");
      const fmp = await import("./fmp");
      const adr = await import("./fmp-adr-map");
      return {
        secFiler: sec.secFilerFor,
        companyFacts: sec.secCompanyFacts,
        submissions: sec.secSubmissions,
        filingDocUrl: sec.secFilingDocUrl,
        filingText: sec.secFilingText,
        fmpAvailable: fmp.isFmpAvailable,
        fmpQuarterly: (s: string) => fmp.fmpIncomeStatementQuarterly(s, INCOME_FMP_QUARTERS),
        fmpSymbols: (s: string) => adr.adrCandidatesFor(s).map(c => c.symbol),
      };
    })();
    try {
      res.status(200).json(await buildIncomeStatementBrief(symbol, deps));
    } catch (err) {
      console.warn(`[CHAT] GuV-Brief fehlgeschlagen (${symbol}): ${errText(err)}`);
      res.status(200).json(incomeBriefNa(symbol.toUpperCase(), `n/a — GuV-Abruf fehlgeschlagen (${errText(err)})`));
    }
  });
}
