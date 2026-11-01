/**
 * GET /api/btc/miner-map — Standorte aus shared/miner-map plus Live-Kontext
 * aus der bestehenden Pipeline server/btc-miner.ts. Kein neuer Datenanbieter.
 * Fehlende Pipeline: Standorte bleiben, Kontext ist „n/a — Grund“.
 */
import { fetchMinerData } from "./btc-miner";
import {
  buildMinerMapBody,
  MINER_MAP_PIPELINE_WAIT_MS,
  pipelineFromMiner,
  type MinerMapPipeline,
  type MinerMapResponse,
} from "@shared/miner-map";

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
  waitMs: number;
  now: () => number;
}

export const defaultMinerMapDeps: MinerMapDeps = {
  fetchMiner: () => fetchMinerData(),
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
  const pipeline = await loadPipeline(deps);
  return buildMinerMapBody(pipeline, new Date(deps.now()).toISOString());
}
