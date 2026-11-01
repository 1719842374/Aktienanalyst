/**
 * Timeout und Ladehinweis für Peer-Nachladen.
 * Beides ist der Median der bisherigen Aufrufe, mal PEER_LATENCY_SAMPLE_WEIGHT.
 * Kein Floor, kein Cap. Ohne Messung gibt es keinen Timeout und keinen erfundenen Sekundenwert.
 */
export const PEER_LATENCY_SAMPLE_WEIGHT = 1;

const samples: number[] = [];

export function clearPeerCallSamples(): void {
  samples.length = 0;
}

export function peerCallSamples(): readonly number[] {
  return samples.slice();
}

export function recordPeerCallMs(ms: number): void {
  if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) samples.push(ms);
}

export function medianCallMs(samplesMs: readonly number[]): number | null {
  const sorted = samplesMs.filter(ms => typeof ms === "number" && Number.isFinite(ms) && ms > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** null = noch keine Messung, der Aufruf wird nicht nach einer festen Grenze abgebrochen. */
export function peerTimeoutFromSamples(samplesMs: readonly number[], weight = PEER_LATENCY_SAMPLE_WEIGHT): number | null {
  const median = medianCallMs(samplesMs);
  if (median == null) return null;
  return median * weight;
}

export function peerLoadingLabel(samplesMs: readonly number[], weight = PEER_LATENCY_SAMPLE_WEIGHT): string {
  const timeout = peerTimeoutFromSamples(samplesMs, weight);
  if (timeout == null) return "Peer wird geladen…";
  const seconds = timeout / 1000;
  const shown = Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
  return `Peer wird geladen… typisch ${shown}s`;
}
