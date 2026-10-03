/**
 * Session-only KI names for a short peer set.
 *
 * The model may only suggest missing tickers. Kennzahlen are not accepted
 * from the model. FMP fills the numbers later, or the row is left out.
 * These rows do not enter RELATIVE_GROWTH.
 */

import { PEER_SET_MIN } from "./peer-material";

export const PEER_NA_INCOMPLETE_ERROR = "KI-Schätzung unvollständig — nichts übernommen";

export const PEER_NA_NOTE = "KI-Vorschlag · Kennzahlen von FMP · Relativ-Score unverändert.";

/** Extra names the model may offer so one unlisted ticker can be replaced. */
export const PEER_NA_ALTERNATES = 2;

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

/** One KI-suggested peer whose numbers, if any, came from FMP. */
export interface PeerNaFill {
  ticker: string;
  /** FMP quote name, otherwise the ticker. Never the model's free-text name. */
  name: string;
  suggestedBy: "ki";
  marketCap: number | null;
  pe: number | null;
  peg: number | null;
  ps: number | null;
  pb: number | null;
  epsGrowth1Y: number | null;
  epsGrowth5Y: number | null;
  revenueGrowth: number | null;
  roic: number | null;
  roic5Y: number | null;
  roicFiscalYear: string | null;
}

/** How many KI peers are required to reach the factual minimum of 3. */
export function peersNeeded(factPeerCount: number): number {
  if (!Number.isFinite(factPeerCount) || factPeerCount <= 0) return PEER_SET_MIN;
  return Math.max(0, PEER_SET_MIN - Math.floor(factPeerCount));
}

export function peerFillClosesGap(fills: PeerNaFill[] | null | undefined, factPeerCount: number): boolean {
  const needed = peersNeeded(factPeerCount);
  return needed > 0 && Array.isArray(fills) && fills.length >= needed;
}

/** True when FMP actually returned something. All-null is not a row. */
export function peerRowHasFmpData(row: Pick<
  PeerNaFill,
  "marketCap" | "pe" | "ps" | "pb" | "epsGrowth1Y" | "epsGrowth5Y" | "revenueGrowth" | "roic" | "roic5Y"
>): boolean {
  return row.marketCap != null
    || row.pe != null
    || row.ps != null
    || row.pb != null
    || row.epsGrowth1Y != null
    || row.epsGrowth5Y != null
    || row.revenueGrowth != null
    || row.roic != null
    || row.roic5Y != null;
}

function extractRawFills(llmData: unknown): unknown[] {
  if (Array.isArray(llmData)) return llmData;
  if (llmData && typeof llmData === "object") {
    const o = llmData as Record<string, unknown>;
    if (Array.isArray(o.fills)) return o.fills;
    if (Array.isArray(o.peers)) return o.peers;
    if (Array.isArray(o.tickers)) return o.tickers;
  }
  return [];
}

export function normalizePeerTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const ticker = raw.trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return null;
  return ticker;
}

/**
 * Tickers only. Numeric fields on the model payload are ignored.
 * Existing fact peers and the subject are dropped.
 */
export function validatePeerNaTickers(
  subject: string,
  existing: string[],
  llmData: unknown,
): string[] {
  const subjectTicker = normalizePeerTicker(subject) ?? "";
  const blocked = new Set<string>();
  if (subjectTicker) blocked.add(subjectTicker);
  for (const raw of existing) {
    const ticker = normalizePeerTicker(raw);
    if (ticker) blocked.add(ticker);
  }

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of extractRawFills(llmData)) {
    const ticker = typeof raw === "string"
      ? normalizePeerTicker(raw)
      : (raw && typeof raw === "object" ? normalizePeerTicker((raw as { ticker?: unknown }).ticker) : null);
    if (!ticker || blocked.has(ticker) || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
  }
  return out;
}
