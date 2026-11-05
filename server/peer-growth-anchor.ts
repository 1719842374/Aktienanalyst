/**
 * Peer-Umsatz-YoY aus den bereits verdrahteten FMP-Income-Statements.
 * Kein neuer Anbieter. Leer, wenn der Key fehlt oder keine zwei Jahre da sind.
 */
import { fmpIncomeStatement, fmpPeers, isFmpAvailable } from "./fmp";
import { adrCandidatesFor } from "./fmp-adr-map";
import { roundGrowthPct } from "../shared/segment-growth-calc";
import {
  PEER_ANCHOR_LIMIT,
  peerGrowthAnchorFromYoys,
  type PeerGrowthAnchor,
} from "../shared/peer-growth-anchor";

export interface PeerAnchorDeps {
  peers: (symbol: string) => Promise<string[]>;
  income: (symbol: string) => Promise<unknown>;
  available: () => boolean;
}

const defaultDeps: PeerAnchorDeps = {
  peers: async (symbol) => {
    const rows = await fmpPeers(symbol);
    return (Array.isArray(rows) ? rows : [])
      .map((row: unknown) => typeof row === "string" ? row : String((row as { symbol?: string })?.symbol ?? ""))
      .filter((s) => s.length > 0);
  },
  income: (symbol) => fmpIncomeStatement(symbol, 2),
  available: isFmpAvailable,
};

/**
 * Listing zuerst, danach das US-/ADR-Symbol aus der bestehenden Map.
 * SAP.DE hat bei FMP keine Peers (Plan 402); SAP hat sie. Ohne diesen Schritt
 * bleibt der Peer-Anker leer und der Prompt verwirft die Schätzung.
 */
export function peerLookupSymbols(ticker: string): string[] {
  const out: string[] = [];
  const push = (symbol: string) => {
    const upper = symbol.trim().toUpperCase();
    if (!upper || out.includes(upper)) return;
    out.push(upper);
  };
  push(ticker);
  for (const candidate of adrCandidatesFor(ticker)) push(candidate.symbol);
  return out;
}

async function anchorForSymbol(symbol: string, deps: PeerAnchorDeps): Promise<PeerGrowthAnchor | null> {
  let symbols: string[] = [];
  try {
    symbols = (await deps.peers(symbol))
      .map((s) => s.toUpperCase())
      .filter((s) => s && s !== symbol.toUpperCase())
      .slice(0, PEER_ANCHOR_LIMIT);
  } catch {
    return null;
  }
  const yoys: number[] = [];
  await Promise.all(symbols.map(async (peer) => {
    try {
      const raw = await deps.income(peer);
      const rows = Array.isArray(raw) ? raw : [];
      const newest = Number((rows[0] as { revenue?: unknown })?.revenue);
      const prior = Number((rows[1] as { revenue?: unknown })?.revenue);
      const growth = roundGrowthPct(newest, prior);
      if (growth != null) yoys.push(growth);
    } catch {
      // Ein Peer ohne Statement fällt aus der Stichprobe, er erfindet keine Zahl.
    }
  }));
  const anchor = peerGrowthAnchorFromYoys(yoys);
  if (!anchor) return null;
  return { ...anchor, source: `${anchor.source} ${symbol}` };
}

export async function loadPeerGrowthAnchor(ticker: string, deps: PeerAnchorDeps = defaultDeps): Promise<PeerGrowthAnchor | null> {
  if (!deps.available()) return null;
  for (const symbol of peerLookupSymbols(ticker)) {
    const anchor = await anchorForSymbol(symbol, deps);
    if (anchor) return anchor;
  }
  return null;
}
