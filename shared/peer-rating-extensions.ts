/**
 * Industry-Fallback und Thesis-Peer-Set.
 * Beide können das Peer-Set und damit Relativ-Score bzw. Thesis-Stärke bewegen.
 * Default AUS. Kein Env-Schalter, keine hartkodierte Tickerliste.
 * Das Band ist die Peer-Position: gewichteter |z| gegen den Basistitel,
 * Schwelle = Median dieser Abstände in der Kandidatenmenge.
 */
import { PEER_SET_MIN } from "./peer-material";

export const PEER_RATING_EXTENSIONS = {
  industryFallback: false,
  thesisPeerSet: false,
} as const;

/** Benannte Gewichte der beiden Abstandsmaße. Gleichgewichtet, keine stille Konstante im Rechenweg. */
export const PEER_BAND_WEIGHTS = {
  marketCap: 1,
  pe: 1,
} as const;

export interface PeerPoint {
  ticker: string;
  sector: string;
  industry: string;
  marketCap: number | null;
  pe: number | null;
}

export interface PeerExtensionResult {
  tickers: string[];
  applied: boolean;
  reason: string;
}

function positive(v: number | null): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function populationStdev(xs: number[], m: number): number | null {
  if (xs.length < 2) return null;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Gewichteter Absolut-z der Peer-Position zum Basistitel. null = Kennzahl fehlt, nicht 0. */
export function peerDistanceScores(
  subject: { marketCap: number | null; pe: number | null },
  candidates: PeerPoint[],
  weights: { marketCap: number; pe: number } = PEER_BAND_WEIGHTS,
): Map<string, number | null> {
  const caps = candidates.map(c => c.marketCap).filter(positive).map(v => Math.log(v));
  const pes = candidates.map(c => c.pe).filter(positive);
  const capMean = mean(caps);
  const peMean = mean(pes);
  const capSd = capMean == null ? null : populationStdev(caps, capMean);
  const peSd = peMean == null ? null : populationStdev(pes, peMean);
  const out = new Map<string, number | null>();
  for (const c of candidates) {
    const parts: { z: number; w: number }[] = [];
    if (positive(c.marketCap) && positive(subject.marketCap) && capSd != null && capSd > 0) {
      parts.push({ z: Math.abs(Math.log(c.marketCap) - Math.log(subject.marketCap)) / capSd, w: weights.marketCap });
    }
    if (positive(c.pe) && positive(subject.pe) && peSd != null && peSd > 0) {
      parts.push({ z: Math.abs(c.pe - subject.pe) / peSd, w: weights.pe });
    }
    if (parts.length === 0 || parts.every(p => !(p.w > 0))) {
      out.set(c.ticker.toUpperCase(), null);
      continue;
    }
    const w = parts.reduce((s, p) => s + p.w, 0);
    out.set(c.ticker.toUpperCase(), parts.reduce((s, p) => s + p.w * p.z, 0) / w);
  }
  return out;
}

/**
 * Flag aus: dieselbe Ticker-Liste (gleiche Referenz).
 * Flag an: nur auffüllen, wenn die Basis unter minCount liegt und das adaptive
 * Band genug Industrie-Peers liefert. Sonst Basis unverändert und Grund „n/a — …“.
 */
export function selectExtendedPeerSet(args: {
  enabled: boolean;
  baseTickers: string[];
  subject: PeerPoint;
  candidates: PeerPoint[];
  sameIndustry: (candidate: PeerPoint) => boolean;
  minCount?: number;
}): PeerExtensionResult {
  if (!args.enabled) {
    return { tickers: args.baseTickers, applied: false, reason: "Flag aus — Industry-Fallback und Thesis-Peer-Set nicht angewendet" };
  }
  const minCount = args.minCount ?? PEER_SET_MIN;
  const base = args.baseTickers.map(t => t.toUpperCase());
  if (base.length >= minCount) {
    return { tickers: args.baseTickers, applied: false, reason: `Basis bereits ≥ ${minCount} — Fallback nicht nötig` };
  }
  const scores = peerDistanceScores(args.subject, args.candidates);
  const finite = Array.from(scores.values()).filter((v): v is number => v != null && Number.isFinite(v));
  const cutoff = median(finite);
  if (cutoff == null) {
    return { tickers: args.baseTickers, applied: false, reason: "n/a — keine Industrie-Kandidaten mit belastbarer Peer-Position" };
  }
  const have = new Set(base);
  have.add(args.subject.ticker.toUpperCase());
  const ranked = args.candidates
    .map(c => ({ c, score: scores.get(c.ticker.toUpperCase()) ?? null }))
    .filter(row => row.score != null && row.score <= cutoff && !have.has(row.c.ticker.toUpperCase()) && args.sameIndustry(row.c))
    .sort((a, b) => (a.score as number) - (b.score as number));
  const added: string[] = [];
  for (const row of ranked) {
    if (base.length + added.length >= minCount) break;
    const ticker = row.c.ticker.toUpperCase();
    if (added.includes(ticker)) continue;
    added.push(ticker);
  }
  if (base.length + added.length < minCount) {
    return { tickers: args.baseTickers, applied: false, reason: "n/a — adaptives Band erreicht die Mindestgröße nicht" };
  }
  return {
    tickers: [...args.baseTickers, ...added],
    applied: true,
    reason: `Thesis-/Industry-Set ergänzt um ${added.join(", ")} (Median-|z| ≤ ${cutoff.toFixed(3)})`,
  };
}
