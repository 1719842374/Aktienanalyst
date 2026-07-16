/**
 * BTC Miner Profitability Data Fetcher
 * Sources: mempool.space API (free, no API key required)
 * 
 * Provides:
 * - Hashrate time series (30d + 60d MA for Hash Ribbons)
 * - Difficulty adjustment history
 * - Breakeven price calculation (Antminer S19 XP reference miner)
 * - Puell Multiple (daily emission USD / 365d MA)
 */

const MEMPOOL_BASE = 'https://mempool.space/api/v1';

// Reference miner: Antminer S19 XP
// Power: 3010W, Hash: 140 TH/s → 21.5 J/TH
const REF_MINER = {
  hashTH: 140,           // TH/s
  powerW: 3010,          // Watts
  efficiencyJTH: 21.5,   // J/TH
  electricityCostKWh: 0.05, // $0.05/kWh — institutional miner
};

// Post-2024-halving block reward
const BLOCK_REWARD_BTC = 3.125;
const DAILY_BLOCKS = 144;

export interface HashratePoint {
  date: string;
  hashrateEH: number;  // EH/s
}

export interface MinerData {
  hashrateHistory: HashratePoint[];  // 3Y daily
  ma30: (number | null)[];           // 30d MA of hashrate
  ma60: (number | null)[];           // 60d MA of hashrate
  dates: string[];
  inCapitulation: boolean;           // ma30 < ma60
  crossoverSignal: boolean;          // most recent: ma30 crossed above ma60
  currentHashrateEH: number;
  breakevenPrice: number;            // USD
  hashprice: number;                 // USD/TH/s/day
  puellMultiple: number | null;
  puellHistory: { date: string; value: number }[];
  difficultyHistory: { date: string; difficulty: number }[];
  difficultyRibbonCompression: number; // 0-1 score (1 = highly compressed)
  lastUpdated: string;
}

/** Rolling average helper */
function rollingAvg(values: number[], window: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) { result.push(null); continue; }
    const slice = values.slice(i - window + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / window);
  }
  return result;
}

/** Calculate breakeven BTC price for reference miner at given network hashrate */
export function calcBreakevenPrice(networkHashrateEH: number): number {
  if (networkHashrateEH <= 0) return 0;
  const networkHashTH = networkHashrateEH * 1e6; // EH → TH
  const dailyEnergyCost = REF_MINER.powerW * 24 / 1000 * REF_MINER.electricityCostKWh; // $ per day
  const dailyBTC = (REF_MINER.hashTH / networkHashTH) * DAILY_BLOCKS * BLOCK_REWARD_BTC;
  return dailyBTC > 0 ? dailyEnergyCost / dailyBTC : 0;
}

/** Detect most recent crossover: returns true if ma30 recently crossed above ma60 (bullish) */
function detectCrossover(
  ma30: (number | null)[],
  ma60: (number | null)[]
): boolean {
  const len = Math.min(ma30.length, ma60.length);
  // Look back up to 30 days for a crossover signal
  for (let i = len - 1; i >= Math.max(1, len - 30); i--) {
    const cur30 = ma30[i]; const cur60 = ma60[i];
    const prev30 = ma30[i - 1]; const prev60 = ma60[i - 1];
    if (cur30 && cur60 && prev30 && prev60) {
      if (cur30 > cur60 && prev30 <= prev60) return true; // bullish crossover
    }
  }
  return false;
}

/** Difficulty Ribbon Compression Score (0 = no compression, 1 = max compression) */
function calcDifficultyRibbonCompression(diffHistory: { difficulty: number }[]): number {
  if (diffHistory.length < 200) return 0;
  const diffs = diffHistory.slice(-200).map(d => d.difficulty);
  const windows = [9, 14, 25, 40, 60, 90, 128, 200];
  const mas = windows.map(w => {
    const slice = diffs.slice(-w);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }).filter(v => v > 0);
  if (mas.length < 2) return 0;
  const mean = mas.reduce((a, b) => a + b, 0) / mas.length;
  const stdDev = Math.sqrt(mas.reduce((s, v) => s + (v - mean) ** 2, 0) / mas.length);
  // Normalize: stdDev / mean → smaller = more compressed
  const cv = stdDev / mean; // coefficient of variation
  // Typical cv range: 0.01 (compressed) to 0.15 (wide ribbons)
  const compression = Math.max(0, Math.min(1, 1 - cv / 0.12));
  return +compression.toFixed(3);
}

// In-memory cache (1 hour)
let _cache: MinerData | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function fetchMinerData(btcPriceHistory?: { date: string; price: number }[]): Promise<MinerData | null> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) return _cache;

  try {
    const timeout = AbortSignal.timeout(20000);

    // Fetch hashrate + difficulty in parallel
    const [hashrateResp, difficultyResp] = await Promise.allSettled([
      fetch(`${MEMPOOL_BASE}/mining/hashrate/3y`, { signal: timeout }),
      fetch(`${MEMPOOL_BASE}/difficulty-adjustments?interval=144`, { signal: timeout }),
    ]);

    // Parse hashrate
    let hashrateHistory: HashratePoint[] = [];
    if (hashrateResp.status === 'fulfilled' && hashrateResp.value.ok) {
      const raw = await hashrateResp.value.json();
      // mempool.space returns: { hashrates: [{timestamp, avgHashrate}], difficulty: [{...}] }
      const items = raw?.hashrates || raw?.data?.hashrates || [];
      hashrateHistory = items
        .map((h: any) => ({
          date: new Date(h.timestamp * 1000).toISOString().split('T')[0],
          hashrateEH: h.avgHashrate / 1e18, // H/s → EH/s
        }))
        .filter((h: HashratePoint) => h.hashrateEH > 0)
        .sort((a: HashratePoint, b: HashratePoint) => a.date.localeCompare(b.date));
    }

    if (hashrateHistory.length < 60) {
      console.warn('[BTC-MINER] Insufficient hashrate data from mempool.space');
      return null;
    }

    // Parse difficulty
    let difficultyHistory: { date: string; difficulty: number }[] = [];
    if (difficultyResp.status === 'fulfilled' && difficultyResp.value.ok) {
      const raw = await difficultyResp.value.json();
      const items = Array.isArray(raw) ? raw : (raw?.difficultyAdjustments || raw?.data || []);
      difficultyHistory = items
        .map((d: any) => ({
          date: new Date((d.time || d.timestamp || 0) * 1000).toISOString().split('T')[0],
          difficulty: d.difficulty || d.difficultyNew || 0,
        }))
        .filter((d: { date: string; difficulty: number }) => d.difficulty > 0)
        .sort((a: { date: string; difficulty: number }, b: { date: string; difficulty: number }) => a.date.localeCompare(b.date));
    }

    // Compute MAs
    const hrValues = hashrateHistory.map(h => h.hashrateEH);
    const dates = hashrateHistory.map(h => h.date);
    const ma30 = rollingAvg(hrValues, 30);
    const ma60 = rollingAvg(hrValues, 60);

    const lastMA30 = ma30[ma30.length - 1] ?? 0;
    const lastMA60 = ma60[ma60.length - 1] ?? 0;
    const inCapitulation = lastMA30 > 0 && lastMA60 > 0 && lastMA30 < lastMA60;
    const crossoverSignal = detectCrossover(ma30, ma60);
    const currentHashrateEH = hrValues[hrValues.length - 1] ?? 0;

    // Breakeven price
    const breakevenPrice = calcBreakevenPrice(currentHashrateEH);

    // Hashprice: estimated USD/TH/s/day at current price
    // hashprice = (block_reward_USD * 144) / (network_hashrate_TH)
    // We return raw hashprice without BTC price — multiply by btcPrice at render time
    const networkHashTH = currentHashrateEH * 1e6;
    const hashprice = networkHashTH > 0
      ? (BLOCK_REWARD_BTC * DAILY_BLOCKS) / networkHashTH
      : 0; // in BTC/TH/s/day — multiply by btcPrice for USD

    // Puell Multiple — needs BTC price history
    let puellMultiple: number | null = null;
    const puellHistory: { date: string; value: number }[] = [];
    if (btcPriceHistory && btcPriceHistory.length >= 365) {
      const prices = btcPriceHistory;
      // Daily emission USD = BLOCK_REWARD_BTC * DAILY_BLOCKS * price
      const emissionUSD = prices.map(p => ({
        date: p.date,
        value: BLOCK_REWARD_BTC * DAILY_BLOCKS * p.price,
      }));
      const ema365 = rollingAvg(emissionUSD.map(e => e.value), 365);
      for (let i = 364; i < emissionUSD.length; i++) {
        const ma = ema365[i];
        if (ma && ma > 0) {
          puellHistory.push({
            date: emissionUSD[i].date,
            value: +(emissionUSD[i].value / ma).toFixed(4),
          });
        }
      }
      if (puellHistory.length > 0) {
        puellMultiple = puellHistory[puellHistory.length - 1].value;
      }
    }

    // Difficulty Ribbon Compression
    const difficultyRibbonCompression = calcDifficultyRibbonCompression(difficultyHistory);

    const result: MinerData = {
      hashrateHistory,
      ma30,
      ma60,
      dates,
      inCapitulation,
      crossoverSignal,
      currentHashrateEH,
      breakevenPrice,
      hashprice,
      puellMultiple,
      puellHistory,
      difficultyHistory,
      difficultyRibbonCompression,
      lastUpdated: new Date().toISOString(),
    };

    _cache = result;
    _cacheTime = Date.now();
    console.log(`[BTC-MINER] OK — ${hashrateHistory.length} hashrate points, breakeven $${breakevenPrice.toFixed(0)}, Puell ${puellMultiple?.toFixed(2) ?? 'N/A'}`);
    return result;
  } catch (err: any) {
    console.error(`[BTC-MINER] Failed: ${err?.message?.substring(0, 150)}`);
    return null;
  }
}
