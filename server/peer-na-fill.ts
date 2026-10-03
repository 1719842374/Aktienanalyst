/**
 * POST /api/analyze/:ticker/peer-na-fill
 *
 * OpenRouter may only name missing peer tickers. Every multiple, growth
 * rate, ROIC and market cap is loaded from FMP for that ticker. A ticker
 * FMP does not return is not given invented numbers. Fail-closed: if fewer
 * than the missing slots come back with FMP data, nothing is applied.
 * Does not write the analysis cache and does not change the score.
 */

import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { fmpBatchQuote, fmpRatios } from "./fmp";
import { fetchRoicForTickers, sanitizeRoic } from "./news-peers";
import {
  PEER_NA_ALTERNATES,
  PEER_NA_INCOMPLETE_ERROR,
  PEER_NA_NOTE,
  normalizePeerTicker,
  peerFillClosesGap,
  peerRowHasFmpData,
  peersNeeded,
  validatePeerNaTickers,
  type PeerNaFill,
} from "../shared/peer-na-fill";

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/i;

export interface PeerNaFillArgs {
  ticker: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  description?: string;
  /** Fact peer tickers already on screen. The gap is counted from this list. */
  existingPeers?: string[];
  /** Echoed only. This route does not recompute the score. */
  relativeApplies?: boolean | null;
}

export type PeerNaFillSuccess = {
  ok: true;
  fills: PeerNaFill[];
  needed: number;
  factPeerCount: number;
  relativeApplies: boolean | null;
  note: string;
  modelUsed: string;
};

export type PeerNaFillFailure = {
  ok: false;
  status: number;
  error: string;
  code: "BAD_REQUEST" | "LLM_UNAVAILABLE" | "LLM_FAILED" | "INCOMPLETE_FILL";
};

export type PeerNaFillResult = PeerNaFillSuccess | PeerNaFillFailure;

type LlmJson = (opts: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}) => Promise<{ data: unknown; modelUsed: string } | null>;

type LoadFmp = (tickers: string[]) => Promise<PeerNaFill[]>;

function clip(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

function factTickers(subject: string, existing: unknown): string[] {
  if (!Array.isArray(existing)) return [];
  const subjectTicker = normalizePeerTicker(subject);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of existing) {
    const ticker = normalizePeerTicker(raw);
    if (!ticker || ticker === subjectTicker || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
    if (out.length >= 8) break;
  }
  return out;
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function cagr(endValue: number | undefined, startValue: number | undefined, years: number): number | null {
  if (!endValue || !startValue || years <= 0) return null;
  if (endValue <= 0 || startValue <= 0) return null;
  return +((Math.pow(endValue / startValue, 1 / years) - 1) * 100).toFixed(1);
}

/**
 * Same FMP fields as the fact peer table. No market-cap band: a KI ticker
 * with a real FMP quote stays visible. No subject-growth fallback for PEG.
 * Returns nothing for a ticker FMP did not answer.
 */
export async function loadFmpPeerMetrics(tickers: string[]): Promise<PeerNaFill[]> {
  if (tickers.length === 0) return [];
  const [quotes, ratiosPerPeer, roicByTicker] = await Promise.all([
    fmpBatchQuote(tickers),
    Promise.all(tickers.map((t) => fmpRatios(t, 6).catch(() => []))),
    fetchRoicForTickers(tickers),
  ]);
  const quoteByTicker = new Map<string, any>((quotes || []).map((q: any) => [String(q?.symbol ?? "").toUpperCase(), q]));
  const out: PeerNaFill[] = [];
  tickers.forEach((t, idx) => {
    const q = quoteByTicker.get(t);
    const ratios: any[] = Array.isArray(ratiosPerPeer[idx]) ? ratiosPerPeer[idx] : [];
    const r0 = ratios[0];
    const r1 = ratios[1];
    const peerRoic = roicByTicker[t];
    const quotePe = q?.price && q?.eps > 0 ? q.price / q.eps : null;
    const ratioPe = num(r0?.priceToEarningsRatio ?? r0?.priceEarningsRatio);
    const peerPE = ratioPe && ratioPe !== 0 ? ratioPe : quotePe;
    const peerPS = num(r0?.priceToSalesRatio);
    const peerPB = num(r0?.priceToBookRatio);
    let epsGrowth1Y: number | null = null;
    if (r0?.netIncomePerShare != null && r1?.netIncomePerShare != null && r1.netIncomePerShare > 0) {
      epsGrowth1Y = +(((r0.netIncomePerShare / r1.netIncomePerShare) - 1) * 100).toFixed(1);
    }
    let epsGrowth5Y: number | null = null;
    if (ratios.length >= 3) {
      const lookback = Math.min(5, ratios.length - 1);
      epsGrowth5Y = cagr(r0?.netIncomePerShare, ratios[lookback]?.netIncomePerShare, lookback);
    }
    let revenueGrowth: number | null = null;
    if (r0?.revenuePerShare != null && r1?.revenuePerShare != null && r1.revenuePerShare > 0) {
      revenueGrowth = +(((r0.revenuePerShare / r1.revenuePerShare) - 1) * 100).toFixed(1);
    }
    const growthForPEG = epsGrowth1Y && epsGrowth1Y > 0
      ? epsGrowth1Y
      : (epsGrowth5Y && epsGrowth5Y > 0 ? epsGrowth5Y : null);
    const peerPEG = peerPE && growthForPEG && growthForPEG > 0 ? +(peerPE / growthForPEG).toFixed(2) : null;
    const marketCap = num(q?.marketCap);
    const row: PeerNaFill = {
      ticker: t,
      name: typeof q?.name === "string" && q.name.trim() ? q.name.trim() : t,
      suggestedBy: "ki",
      marketCap: marketCap && marketCap > 0 ? marketCap : null,
      pe: peerPE ? +Number(peerPE).toFixed(1) : null,
      peg: peerPEG,
      ps: peerPS && peerPS !== 0 ? +peerPS.toFixed(1) : null,
      pb: peerPB && peerPB !== 0 ? +peerPB.toFixed(1) : null,
      epsGrowth1Y,
      epsGrowth5Y,
      revenueGrowth,
      roic: sanitizeRoic(peerRoic?.roicPercent ?? null),
      roic5Y: sanitizeRoic(peerRoic?.roic5YPercent ?? null),
      roicFiscalYear: peerRoic?.fiscalYear ?? null,
    };
    if (!q && !r0 && row.roic == null && row.roic5Y == null) return;
    if (!peerRowHasFmpData(row)) return;
    out.push(row);
  });
  return out;
}

export function buildPeerNaFillPrompt(
  args: PeerNaFillArgs,
  existing: string[],
  needed: number,
): string {
  const profile = clip(args.description, 500);
  const listed = existing.length > 0 ? existing.join(", ") : "keine";
  const alternates = Math.min(PEER_NA_ALTERNATES, needed);
  return `Nenne fehlende Vergleichs-Ticker, damit das Peer-Set vollständig wird. Nur Namen bzw. Börsenkürzel.

UNTERNEHMEN: ${clip(args.companyName, 120) || args.ticker} (${args.ticker})
SEKTOR: ${clip(args.sector, 80) || "n/a"} | BRANCHE: ${clip(args.industry, 80) || "n/a"}
${profile ? `PROFIL: ${profile}\n` : ""}
BEREITS IN DER TABELLE (nicht wiederholen): ${listed}

Es fehlen ${needed} Wettbewerber. Nenne ${needed} Ticker${alternates > 0 ? ` und bis zu ${alternates} Ersatz-Ticker` : ""}.

Antworte ausschließlich mit JSON:
{"fills":[{"ticker":"LLY"}]}

REGELN:
- Nur das Feld ticker. Keine Kennzahlen, keine Kurse, keine Multiples, kein ROIC, kein Umsatz, keine Margen.
- Mindestens ${needed} neue Börsenkürzel. Nicht ${args.ticker}. Keiner aus der bestehenden Liste.
- ticker ist das Börsenkürzel, nicht der Firmenname.`;
}

export async function requestPeerNaFills(
  args: PeerNaFillArgs,
  deps: { isLLMAvailable: () => boolean; callLLMJson: LlmJson; loadFmpPeerMetrics: LoadFmp } = {
    isLLMAvailable,
    callLLMJson,
    loadFmpPeerMetrics,
  },
): Promise<PeerNaFillResult> {
  const ticker = clip(args.ticker, 16).toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return { ok: false, status: 400, error: "ticker fehlt oder ist ungültig", code: "BAD_REQUEST" };
  }
  const existing = factTickers(ticker, args.existingPeers);
  const needed = peersNeeded(existing.length);
  if (needed === 0) {
    return { ok: false, status: 400, error: "Keine N/A-Zellen", code: "BAD_REQUEST" };
  }

  const relativeApplies = typeof args.relativeApplies === "boolean" ? args.relativeApplies : null;

  if (!deps.isLLMAvailable()) {
    return { ok: false, status: 503, error: "LLM nicht verfügbar", code: "LLM_UNAVAILABLE" };
  }

  const llm = await deps.callLLMJson({
    prompt: buildPeerNaFillPrompt({ ...args, ticker }, existing, needed),
    maxTokens: 400,
    temperature: 0.2,
    systemPrompt: "Du nennst nur fehlende Peer-Ticker. Du lieferst keine Kennzahlen. Antworte ausschließlich mit JSON.",
  });
  if (!llm || llm.data == null) {
    return { ok: false, status: 502, error: "KI-Antwort fehlgeschlagen", code: "LLM_FAILED" };
  }

  const suggested = validatePeerNaTickers(ticker, existing, llm.data).slice(0, needed + PEER_NA_ALTERNATES);
  if (suggested.length < needed) {
    return { ok: false, status: 422, error: PEER_NA_INCOMPLETE_ERROR, code: "INCOMPLETE_FILL" };
  }

  let fmpRows: PeerNaFill[];
  try {
    fmpRows = await deps.loadFmpPeerMetrics(suggested);
  } catch {
    return { ok: false, status: 502, error: "FMP-Daten fehlgeschlagen", code: "LLM_FAILED" };
  }
  const byTicker = new Map(fmpRows.filter(peerRowHasFmpData).map((row) => [row.ticker, row]));
  const fills: PeerNaFill[] = [];
  for (const symbol of suggested) {
    const row = byTicker.get(symbol);
    if (!row) continue;
    fills.push(row);
    if (fills.length === needed) break;
  }
  if (!peerFillClosesGap(fills, existing.length)) {
    return { ok: false, status: 422, error: PEER_NA_INCOMPLETE_ERROR, code: "INCOMPLETE_FILL" };
  }

  return {
    ok: true,
    fills,
    needed,
    factPeerCount: existing.length,
    relativeApplies,
    note: PEER_NA_NOTE,
    modelUsed: llm.modelUsed,
  };
}
