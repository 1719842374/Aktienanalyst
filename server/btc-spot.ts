/**
 * Tägliche BTC-Spot-Historie für alle BTC-Charts.
 * Eine Quelle. Schlägt der Abruf fehl oder ist die Reihe kürzer als zehn Jahre,
 * wirft der Handler — es gibt keine zweite, kürzere Quelle.
 * Das USD-Volumen ist das tägliche On-Chain-Volumen derselben Quelle
 * (estimated-transaction-volume-usd, sampled=false), an jedem Kurstag.
 */
import {
  BTC_SPOT_SOURCE_LABEL,
  BTC_SPOT_SOURCE_URL,
  BTC_VOLUME_SOURCE_LABEL,
  BTC_VOLUME_SOURCE_URL,
  assessBtcSpotCoverage,
  assessBtcTradeVolumeCoverage,
  attachBtcTradeVolume,
  normalizeBlockchainMarketPrice,
  normalizeBlockchainTradeVolume,
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

async function fetchBlockchainChart(url: string, label: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : "Netzwerkfehler";
    throw new BtcSpotHistoryError(`Abruf abgebrochen: ${reason}. Quelle: ${label}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new BtcSpotHistoryError(`Abruf abgebrochen: HTTP ${response.status}. Quelle: ${label}`);
  }

  try {
    return await response.json();
  } catch {
    throw new BtcSpotHistoryError(`Abruf abgebrochen: Antwort ist kein JSON. Quelle: ${label}`);
  }
}

export async function fetchBtcSpotHistory(now = Date.now()): Promise<BtcSpotHistory> {
  if (cache && cache.expiresAt > now) return cache.data;

  const [priceRaw, volumeRaw] = await Promise.all([
    fetchBlockchainChart(BTC_SPOT_SOURCE_URL, BTC_SPOT_SOURCE_LABEL),
    fetchBlockchainChart(BTC_VOLUME_SOURCE_URL, BTC_VOLUME_SOURCE_LABEL),
  ]);

  const prices = normalizeBlockchainMarketPrice(priceRaw);
  const coverage = assessBtcSpotCoverage(prices);
  if (!coverage.ok) {
    throw new BtcSpotHistoryError(
      `Abruf abgebrochen: ${coverage.reason}. Quelle: ${BTC_SPOT_SOURCE_LABEL}. Keine Ersatzquelle.`,
    );
  }

  const volumes = normalizeBlockchainTradeVolume(volumeRaw);
  const volumeCoverage = assessBtcTradeVolumeCoverage(prices, volumes);
  if (!volumeCoverage.ok) {
    throw new BtcSpotHistoryError(
      `Abruf abgebrochen: ${volumeCoverage.reason}. Quelle: ${BTC_VOLUME_SOURCE_LABEL}. Keine Ersatzquelle.`,
    );
  }

  const points: BtcSpotPoint[] = attachBtcTradeVolume(prices, volumes);
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
