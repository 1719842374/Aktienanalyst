/**
 * Identität eines Peer-Tickers vor dem Request.
 * Großschreibung, Börsen-Suffix und ADR-Abbildung (FMP_ADR_MAP) zählen als derselbe Titel.
 */
import { FMP_ADR_MAP } from "../server/fmp-adr-map";

export const PEER_ADD_ALREADY = "bereits Peer";
export const PEER_ADD_SUBJECT = "Hauptticker";

/** Suffixe, die nur für den Identitätsvergleich abgestreift werden. Der Request-Ticker bleibt das eingegebene Kürzel. */
export const PEER_IDENTITY_EXCHANGE_SUFFIXES = [
  ".DE", ".F", ".L", ".TO", ".PA", ".AS", ".SW", ".HK", ".T", ".SS", ".NS", ".US",
] as const;

export function peerIdentityKeys(raw: string): string[] {
  const upper = String(raw ?? "").trim().toUpperCase();
  if (!upper) return [];
  const keys = new Set<string>([upper]);
  const addSuffixBase = (symbol: string) => {
    for (const suffix of PEER_IDENTITY_EXCHANGE_SUFFIXES) {
      if (symbol.endsWith(suffix) && symbol.length > suffix.length) keys.add(symbol.slice(0, -suffix.length));
    }
  };
  addSuffixBase(upper);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [listing, candidates] of Object.entries(FMP_ADR_MAP)) {
      const group = [listing.toUpperCase(), ...candidates.map(c => c.symbol.toUpperCase())];
      if (!group.some(symbol => keys.has(symbol))) continue;
      for (const symbol of group) {
        if (keys.has(symbol)) continue;
        keys.add(symbol);
        addSuffixBase(symbol);
        grew = true;
      }
    }
  }
  return Array.from(keys);
}

function sameListing(left: string, right: string): boolean {
  const keys = new Set(peerIdentityKeys(left));
  return peerIdentityKeys(right).some(key => keys.has(key));
}

export interface PeerAddDecision {
  kind: "empty" | "subject" | "already" | "new";
  ticker: string;
  notice: string | null;
  request: boolean;
}

/** Vor dem Request: schon Peer oder Hauptticker → kein Request, sofortiger Hinweis. */
export function classifyPeerAdd(input: {
  raw: string;
  subject: string;
  peers: readonly string[];
  activeAdd?: readonly string[];
}): PeerAddDecision {
  const ticker = String(input.raw ?? "").trim().toUpperCase();
  if (!ticker) return { kind: "empty", ticker: "", notice: null, request: false };
  if (sameListing(ticker, input.subject)) return { kind: "subject", ticker, notice: PEER_ADD_SUBJECT, request: false };
  const known = [...input.peers, ...(input.activeAdd ?? [])];
  if (known.some(peer => sameListing(ticker, peer))) return { kind: "already", ticker, notice: PEER_ADD_ALREADY, request: false };
  return { kind: "new", ticker, notice: null, request: true };
}
