/**
 * Tägliche BTC-Spot-Historie für alle BTC-Charts.
 * Eine Quelle. Schlägt der Abruf fehl oder ist die Reihe kürzer als zehn Jahre,
 * wirft der Handler — es gibt keine zweite, kürzere Quelle.
 */
import {
  BTC_SPOT_SOURCE_LABEL,
  BTC_SPOT_SOURCE_URL,
  assessBtcSpotCoverage,
  normalizeBlockchainMarketPrice,
  type BtcSpotPoint,
} from "../shared/btc-spot";

export interface BtcSpotHistory {
  source: string;
  sourceUrl: string;
  points: BtcSpotPoint[];
  first: string | null;
  last: string | null;
  count: number;
}

export class BtcSpotHistoryError extends Error {
  readonly source = BTC_SPOT_SOURCE_LABEL;
  readonly sourceUrl = BTC_SPOT_SOURCE_URL;

  constructor(message: string) {
    super(message);
    this.name = "BtcSpotHistoryError";
  }
}

const CACHE_TTL_MS = 60 * 60 * 1000;
let cache: { expiresAt: number; data: BtcSpotHistory } | null = null;

export async function fetchBtcSpotHistory(now = Date.now()): Promise<BtcSpotHistory> {
  if (cache && cache.expiresAt > now) return cache.data;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let response: Response;
  try {
    response = await fetch(BTC_SPOT_SOURCE_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Netzwerkfehler";
    throw new BtcSpotHistoryError(`Abruf abgebrochen: ${reason}. Quelle: ${BTC_SPOT_SOURCE_LABEL}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new BtcSpotHistoryError(
      `Abruf abgebrochen: HTTP ${response.status}. Quelle: ${BTC_SPOT_SOURCE_LABEL}`,
    );
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new BtcSpotHistoryError(`Abruf abgebrochen: Antwort ist kein JSON. Quelle: ${BTC_SPOT_SOURCE_LABEL}`);
  }

  const points = normalizeBlockchainMarketPrice(raw);
  const coverage = assessBtcSpotCoverage(points);
  if (!coverage.ok) {
    throw new BtcSpotHistoryError(
      `Abruf abgebrochen: ${coverage.reason}. Quelle: ${BTC_SPOT_SOURCE_LABEL}. Keine Ersatzquelle.`,
    );
  }

  const data: BtcSpotHistory = {
    source: BTC_SPOT_SOURCE_LABEL,
    sourceUrl: BTC_SPOT_SOURCE_URL,
    points,
    first: coverage.first,
    last: coverage.last,
    count: points.length,
  };
  cache = { expiresAt: now + CACHE_TTL_MS, data };
  return data;
}
