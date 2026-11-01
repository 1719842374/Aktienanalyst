/**
 * Peer-Kurslinien (WORK_DASHBOARD_FEATURES §3).
 * Obergrenze ist die Spec-Angabe „max. 3–4 Peers“, als benannter Parameter.
 * Index = 100 am ersten gemeinsamen Tag. Absolute Kurse bleiben in der gelieferten Währung.
 */

/** Spec-Obergrenze gleichzeitiger Peer-Linien. */
export const PEER_OVERLAY_MAX = 4;

export type PeerScale = "index" | "absolute";

export interface PeerPricePoint {
  date: string;
  close: number;
}

export interface PeerSeriesInput {
  ticker: string;
  points: readonly PeerPricePoint[];
}

export interface PeerOverlayPoint {
  date: string;
  /** Index, 100 = erster Tag im Fenster. null, wenn der Peer an dem Tag fehlt. */
  index: number | null;
  close: number | null;
}

export interface PeerOverlaySeries {
  ticker: string;
  points: PeerOverlayPoint[];
  note: string | null;
}

export function limitPeerTickers(tickers: readonly string[]): { kept: string[]; dropped: string[] } {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const raw of tickers) {
    const t = raw.trim().toUpperCase();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  return { kept: unique.slice(0, PEER_OVERLAY_MAX), dropped: unique.slice(PEER_OVERLAY_MAX) };
}

export function buildPeerOverlay(
  windowDates: readonly string[],
  series: readonly PeerSeriesInput[],
): PeerOverlaySeries[] {
  const { kept } = limitPeerTickers(series.map(s => s.ticker));
  const allow = new Set(kept);
  return series.filter(s => allow.has(s.ticker.trim().toUpperCase())).map(s => {
    const byDate = new Map<string, number>();
    for (const p of s.points) {
      if (Number.isFinite(p.close)) byDate.set(p.date, p.close);
    }
    const aligned = windowDates.map(date => {
      const close = byDate.get(date);
      return { date, close: close ?? null };
    });
    const first = aligned.find(p => p.close != null && p.close !== 0);
    if (!first || first.close == null) {
      return {
        ticker: s.ticker.trim().toUpperCase(),
        points: aligned.map(p => ({ date: p.date, index: null, close: p.close })),
        note: "n/a — keine Kurse im Fenster",
      };
    }
    const base = first.close;
    return {
      ticker: s.ticker.trim().toUpperCase(),
      note: null,
      points: aligned.map(p => ({
        date: p.date,
        close: p.close,
        index: p.close == null ? null : (p.close / base) * 100,
      })),
    };
  });
}
