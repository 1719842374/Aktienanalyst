/**
 * GET /api/btc/miner-map — Standorte aus shared/miner-map plus Live-Kontext
 * aus der bestehenden Pipeline server/btc-miner.ts. Kein neuer Datenanbieter.
 * Fehlende Pipeline: Standorte bleiben, Kontext ist „n/a — Grund“.
 */
import { fetchMinerData } from "./btc-miner";
import {
  applyHashpriceUsd,
  buildMinerMapBody,
  MINER_MAP_PIPELINE_WAIT_MS,
  pipelineFromMiner,
  type BtcSpotQuote,
  type MinerMapPipeline,
  type MinerMapResponse,
} from "@shared/miner-map";

/** Dieselbe simple/price-URL wie client/src/lib/btcAnalysis.ts. */
export const BTC_SPOT_PIPELINE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true";

/** Gleicher Anbieter wie die Kurs-Historie in btcAnalysis.ts (api.blockchain.info/charts), hier der Spot-Ticker. */
export const BTC_SPOT_FALLBACK_URL = "https://blockchain.info/ticker";

function positiveUsd(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

async function readJson(url: string, timeoutMs: number): Promise<unknown> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchBtcSpotFromPipeline(timeoutMs = 4_000): Promise<BtcSpotQuote | null> {
  const asOf = new Date().toISOString();
  const gecko = await readJson(BTC_SPOT_PIPELINE_URL, timeoutMs);
  const geckoUsd = positiveUsd(
    gecko && typeof gecko === "object" && "bitcoin" in gecko
      ? (gecko as { bitcoin?: { usd?: unknown } }).bitcoin?.usd
      : null,
  );
  if (geckoUsd != null) {
    return {
      usd: geckoUsd,
      asOf,
      sourceLabel: "CoinGecko simple/price, dieselbe URL wie die BTC-Preis-Pipeline",
      sourceUrl: BTC_SPOT_PIPELINE_URL,
    };
  }
  const ticker = await readJson(BTC_SPOT_FALLBACK_URL, timeoutMs);
  const tickerUsd = positiveUsd(
    ticker && typeof ticker === "object" && "USD" in ticker
      ? (ticker as { USD?: { last?: unknown } }).USD?.last
      : null,
  );
  if (tickerUsd != null) {
    return {
      usd: tickerUsd,
      asOf,
      sourceLabel: "Blockchain.com Ticker USD.last, Fallback der Preis-Pipeline",
      sourceUrl: BTC_SPOT_FALLBACK_URL,
    };
  }
  return null;
}

export interface MinerMapDeps {
  fetchMiner: () => Promise<{
    currentHashrateEH?: number | null;
    hashprice?: number | null;
    breakevenPrice?: number | null;
    puellMultiple?: number | null;
    hashrateSource?: string | null;
    lastUpdated?: string | null;
    stale?: boolean;
  } | null>;
  /** Fehlt der Abruf, bleibt Hashprice-USD beim bisherigen n/a. */
  fetchBtcSpot?: () => Promise<BtcSpotQuote | null>;
  waitMs: number;
  now: () => number;
}

export const defaultMinerMapDeps: MinerMapDeps = {
  fetchMiner: () => fetchMinerData(),
  fetchBtcSpot: () => fetchBtcSpotFromPipeline(),
  waitMs: MINER_MAP_PIPELINE_WAIT_MS,
  now: Date.now,
};

async function loadPipeline(deps: MinerMapDeps): Promise<MinerMapPipeline> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      deps.fetchMiner(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), deps.waitMs);
      }),
    ]);
    if (!result) {
      return pipelineFromMiner(null, `Miner-Pipeline nicht innerhalb von ${deps.waitMs} ms erreichbar (mempool.space / blockchain.info). Standorte bleiben aus den Filings.`);
    }
    return pipelineFromMiner(result, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return pipelineFromMiner(null, `Miner-Pipeline: ${message.slice(0, 180)}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function buildMinerMap(deps: MinerMapDeps = defaultMinerMapDeps): Promise<MinerMapResponse> {
  const spotPromise = deps.fetchBtcSpot
    ? deps.fetchBtcSpot().catch(() => null)
    : Promise.resolve(null);
  const [loaded, spot] = await Promise.all([loadPipeline(deps), spotPromise]);
  const pipeline = deps.fetchBtcSpot ? applyHashpriceUsd(loaded, spot) : loaded;
  return buildMinerMapBody(pipeline, new Date(deps.now()).toISOString());
}
