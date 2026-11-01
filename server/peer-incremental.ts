/**
 * Peer hinzufügen ohne Neuanalyse.
 * Holt nur die Kennzahlen des neuen Tickers über fetchPeerComparisonFromTickers
 * (dasselbe Market-Cap-Band und dieselbe Zeile) und setzt Ø, Peer-Gate und Score
 * mit denselben Funktionen neu.
 */
import type { PeerCompany, StockAnalysis } from "../shared/schema";
import { assessPeerSet } from "../shared/peer-material";
import { classifyPeerAdd } from "../shared/peer-identity";
import { peerAvgFromPeers } from "../shared/peer-metrics";
import { peerRevenueGrowthDeltaPp } from "../shared/peer-growth-delta";
import { normalizePeerOverrides } from "./peer-cache-key";
import { scoringWithPeerDelta } from "./scoring-integration";

const NOT_ADOPTED = "nicht übernommen (ungültig, außerhalb des Market-Cap-Bands oder ohne Kennzahlen)";

type FetchedComparison = { subject: any; peers: any[]; peerAvg: any } | null;

export type FetchPeerComparison = (
  ticker: string,
  peerTickers: string[],
  pe: number,
  peg: number,
  revenue: number,
  marketCap: number,
  revenueGrowth: number,
  epsGrowth5Y: number,
  subjectExtras?: { pb?: number | null; epsGrowth1Y?: number | null },
) => Promise<FetchedComparison>;

export type AppendPeerResult =
  | { ok: true; adopted: true; analysis: StockAnalysis; notice: null; reason: null }
  | { ok: true; adopted: false; analysis: StockAnalysis; notice: string | null; reason: string | null }
  | { ok: false; error: string };

function subjectGrowth(analysis: StockAnalysis): number | null {
  const fromPeer = analysis.peerComparison?.subject?.revenueGrowth;
  if (typeof fromPeer === "number" && Number.isFinite(fromPeer)) return fromPeer;
  const fromStatements = analysis.financialStatements?.incomeStatement?.revenueGrowth;
  return typeof fromStatements === "number" && Number.isFinite(fromStatements) ? fromStatements : null;
}

function withOverrides(analysis: StockAnalysis, add: string[], remove: string[]): StockAnalysis {
  return { ...analysis, activePeerOverrides: { add, remove } };
}

export async function appendPeerFromCachedAnalysis(args: {
  analysis: StockAnalysis;
  addTicker: string;
  peerOverrides: { add?: string[] | null; remove?: string[] | null };
}, deps: { fetchPeerComparisonFromTickers: FetchPeerComparison }): Promise<AppendPeerResult> {
  const addTicker = args.addTicker.trim().toUpperCase();
  const overrides = normalizePeerOverrides(args.peerOverrides);
  const peers = args.analysis.peerComparison?.peers ?? [];
  const decision = classifyPeerAdd({
    raw: addTicker,
    subject: args.analysis.ticker,
    peers: peers.map(peer => peer.ticker),
    activeAdd: args.analysis.activePeerOverrides?.add ?? [],
  });
  if (!decision.request) {
    return {
      ok: true,
      adopted: false,
      analysis: args.analysis,
      notice: decision.notice,
      reason: null,
    };
  }

  try {
    const subject = args.analysis.peerComparison?.subject;
    const revenue = args.analysis.financialStatements?.incomeStatement?.revenue ?? 0;
    const growth = subjectGrowth(args.analysis) ?? 0;
    const fetched = await deps.fetchPeerComparisonFromTickers(
      args.analysis.ticker,
      [addTicker],
      args.analysis.peRatio ?? 0,
      args.analysis.pegRatio ?? 0,
      revenue,
      args.analysis.marketCap ?? subject?.marketCap ?? 0,
      growth,
      subject?.epsGrowth5Y ?? args.analysis.epsGrowth5Y ?? 0,
      { pb: subject?.pb ?? null, epsGrowth1Y: subject?.epsGrowth1Y ?? null },
    );
    const row = fetched?.peers?.find(peer => String(peer?.ticker ?? "").toUpperCase() === addTicker) as PeerCompany | undefined;
    if (!row || !args.analysis.peerComparison) {
      return {
        ok: true,
        adopted: false,
        analysis: withOverrides(args.analysis, overrides.add, overrides.remove),
        notice: null,
        reason: `${addTicker} ${NOT_ADOPTED}`,
      };
    }

    const nextPeers = [...args.analysis.peerComparison.peers, row];
    const peerAvg = peerAvgFromPeers(nextPeers);
    const peerSet = assessPeerSet({
      moatRating: args.analysis.moatRating,
      porterForces: args.analysis.moatAssessment?.porterForces ?? [],
      peerCount: nextPeers.length,
    });
    const delta = peerRevenueGrowthDeltaPp(subjectGrowth(args.analysis), nextPeers.map(peer => peer.revenueGrowth ?? null));
    const scoring = args.analysis.scoring
      ? scoringWithPeerDelta({
          scoring: args.analysis.scoring,
          catalysts: args.analysis.catalysts ?? [],
          price: args.analysis.currentPrice ?? 0,
          asOfDate: (args.analysis.dataTimestamp ?? new Date().toISOString()).slice(0, 10),
          relativeGrowthDeltaYoYPp: delta,
          relativeScoreApplies: peerSet.relativeApplies,
        })
      : args.analysis.scoring;

    return {
      ok: true,
      adopted: true,
      notice: null,
      reason: null,
      analysis: {
        ...args.analysis,
        peerComparison: { ...args.analysis.peerComparison, peers: nextPeers, peerAvg },
        peerSet,
        activePeerOverrides: { add: overrides.add, remove: overrides.remove },
        scoring,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    return { ok: false, error: message || "Peer konnte nicht geladen werden." };
  }
}
