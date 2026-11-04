import { liveBeta, type ClosePoint } from "../shared/live-beta";
import { yahooFetch } from "./history-fallback";

const SPY_TTL_MS = 6 * 60 * 60 * 1000;
const SPY_LOOKBACK_DAYS = 450;

let spyCache: { at: number; points: ClosePoint[] } | null = null;

export async function loadSpyCloses(now = Date.now()): Promise<ClosePoint[]> {
  if (spyCache && now - spyCache.at < SPY_TTL_MS && spyCache.points.length > 0) return spyCache.points;
  const to = new Date(now).toISOString().slice(0, 10);
  const fromDate = new Date(now);
  fromDate.setUTCDate(fromDate.getUTCDate() - SPY_LOOKBACK_DAYS);
  const from = fromDate.toISOString().slice(0, 10);
  const bars = await yahooFetch("SPY", from, to);
  const points = bars
    .filter((bar) => bar.close > 0 && Number.isFinite(bar.close))
    .map((bar) => ({ date: bar.date, close: bar.close }));
  if (points.length > 0) spyCache = { at: now, points };
  return points;
}

/** Aktuelles Beta aus den Schlusskursen. Fehlender Markt oder zu wenig Tage → null, kein Wurf. */
export async function liveBetaForCloses(
  stock: readonly ClosePoint[] | null | undefined,
  loadMarket: () => Promise<readonly ClosePoint[]> = () => loadSpyCloses(),
): Promise<number | null> {
  if (!stock || stock.length === 0) return null;
  try {
    const market = await loadMarket();
    return liveBeta(stock, market);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[LIVE-BETA] SPY nicht gelesen: ${message.slice(0, 120)}`);
    return null;
  }
}
