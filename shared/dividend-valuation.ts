// F1-14/F1-17/F1-18 (Future_1_Work §11.1): Dividendenrendite-Einordnung — reine Anzeige.
// Fließt nicht in Score, Rating, Gates oder Fazit-Signal ein.
import type { DividendOverlayPoint } from "./dividends";

/** Schwelle für „attraktive“ Dividendenrendite (Chart-Band, Hinweis in Section 20). */
export const DIVIDEND_ATTRACTIVE_PCT = 4;

export interface DividendYieldRange {
  current: number;
  min: number;
  median: number;
  max: number;
  /** Anteil der historischen TTM-Werte ≤ aktuell, 0..100. */
  percentile: number;
  /** Anzahl Kurstage mit TTM-Rendite. */
  samples: number;
  fromDate: string;
  toDate: string;
}

/** Historische Spanne der TTM-Rendite aus der Overlay-Serie (gleiche Quelle wie das TA-Chart). */
export function dividendYieldRange(points: DividendOverlayPoint[]): DividendYieldRange | null {
  const valid = points.filter(p => p.yieldPct != null && Number.isFinite(p.yieldPct));
  if (valid.length < 2) return null;
  const vals = valid.map(p => p.yieldPct as number);
  const current = vals[vals.length - 1];
  const sorted = vals.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const percentile = Math.round((sorted.filter(v => v <= current).length / sorted.length) * 100);
  return {
    current, min: sorted[0], median: Math.round(median * 100) / 100, max: sorted[sorted.length - 1],
    percentile, samples: vals.length, fromDate: valid[0].date, toDate: valid[valid.length - 1].date,
  };
}

/** Kurzhinweis für Section 20 — nur wenn die Rendite auffällig ist (≥ 4 % oder Rand der eigenen Historie). */
export function dividendSummaryNote(range: DividendYieldRange | null): string | null {
  if (!range) return null;
  const parts: string[] = [];
  if (range.current >= DIVIDEND_ATTRACTIVE_PCT) parts.push(`Rendite ≥ ${DIVIDEND_ATTRACTIVE_PCT} %`);
  if (range.percentile >= 80) parts.push(`oberes Fünftel der eigenen Historie (P${range.percentile})`);
  else if (range.percentile <= 20) parts.push(`unteres Fünftel der eigenen Historie (P${range.percentile})`);
  if (parts.length === 0) return null;
  return `Div. ${range.current.toFixed(2)} % TTM — ${parts.join(", ")}; Spanne ${range.min.toFixed(2)}–${range.max.toFixed(2)} %, Median ${range.median.toFixed(2)} %. Nur Anzeige, kein Score-Einfluss.`;
}
