/**
 * Aktuelles Beta der Aktienanalyse: letzte 252 Handelstage, täglich, gegen den Markt.
 * Nicht der 5-Jahres-Schnitt und nicht das Mehrjahres-Beta aus dem Firmenprofil.
 * DCF, WACC-Default und CRV lesen weiter `beta5Y`.
 */
export const LIVE_BETA_SESSIONS = 252;
export const LIVE_BETA_MIN_OBS = 60;

export interface ClosePoint {
  date: string;
  close: number;
}

/** OLS-Steigung der Aktienrendite auf die Marktrendite. Zu wenig gemeinsame Tage → null. */
export function liveBeta(
  stock: readonly ClosePoint[],
  market: readonly ClosePoint[],
  sessions = LIVE_BETA_SESSIONS,
): number | null {
  const marketByDate = new Map<string, number>();
  for (const point of market) {
    if (point.date && point.close > 0 && Number.isFinite(point.close)) marketByDate.set(point.date, point.close);
  }
  const sorted = stock
    .filter((point) => point.date && point.close > 0 && Number.isFinite(point.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  const stockReturns: number[] = [];
  const marketReturns: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const marketPrev = marketByDate.get(prev.date);
    const marketCur = marketByDate.get(cur.date);
    if (marketPrev == null || marketCur == null || marketPrev <= 0 || prev.close <= 0) continue;
    stockReturns.push(cur.close / prev.close - 1);
    marketReturns.push(marketCur / marketPrev - 1);
  }
  const n = Math.min(sessions, stockReturns.length);
  if (n < LIVE_BETA_MIN_OBS) return null;
  const stockWindow = stockReturns.slice(-n);
  const marketWindow = marketReturns.slice(-n);
  let meanStock = 0;
  let meanMarket = 0;
  for (let i = 0; i < n; i++) {
    meanStock += stockWindow[i];
    meanMarket += marketWindow[i];
  }
  meanStock /= n;
  meanMarket /= n;
  let cov = 0;
  let varMarket = 0;
  for (let i = 0; i < n; i++) {
    const ds = stockWindow[i] - meanStock;
    const dm = marketWindow[i] - meanMarket;
    cov += ds * dm;
    varMarket += dm * dm;
  }
  if (!(varMarket > 0)) return null;
  const beta = cov / varMarket;
  if (!Number.isFinite(beta)) return null;
  return Math.round(beta * 100) / 100;
}
