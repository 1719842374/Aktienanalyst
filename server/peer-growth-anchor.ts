/**
 * Peer-Umsatz-YoY aus den bereits verdrahteten FMP-Income-Statements.
 * Kein neuer Anbieter. Leer, wenn der Key fehlt oder keine zwei Jahre da sind.
 */
import { fmpIncomeStatement, fmpPeers, isFmpAvailable } from "./fmp";
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

export async function loadPeerGrowthAnchor(ticker: string, deps: PeerAnchorDeps = defaultDeps): Promise<PeerGrowthAnchor | null> {
  if (!deps.available()) return null;
  const self = ticker.toUpperCase();
  let symbols: string[] = [];
  try {
    symbols = (await deps.peers(self))
      .map((s) => s.toUpperCase())
      .filter((s) => s && s !== self)
      .slice(0, PEER_ANCHOR_LIMIT);
  } catch {
    return null;
  }
  const yoys: number[] = [];
  await Promise.all(symbols.map(async (symbol) => {
    try {
      const raw = await deps.income(symbol);
      const rows = Array.isArray(raw) ? raw : [];
      const newest = Number((rows[0] as { revenue?: unknown })?.revenue);
      const prior = Number((rows[1] as { revenue?: unknown })?.revenue);
      const growth = roundGrowthPct(newest, prior);
      if (growth != null) yoys.push(growth);
    } catch {
      // Ein Peer ohne Statement fällt aus der Stichprobe, er erfindet keine Zahl.
    }
  }));
  return peerGrowthAnchorFromYoys(yoys);
}
