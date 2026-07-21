/**
 * BTC Miner Profitability Data Fetcher
 * Sources: mempool.space API (free, no API key required)
 *
 * Provides:
 * - Hashrate time series (30d + 60d MA for Hash Ribbons)
 * - Difficulty adjustment history
 * - Breakeven price calculation (Antminer S19 XP reference miner)
 * - Puell Multiple (daily emission USD / 365d MA)
 * - Miner Score (composite 0–100 signal)
 */

const MEMPOOL_BASE = 'https://mempool.space/api/v1';

// Reference miner: Antminer S19 XP
// Power: 3010W, Hash: 140 TH/s → 21.5 J/TH
const REF_MINER = {
  hashTH: 140,               // TH/s
  powerW: 3010,              // Watts
  efficiencyJTH: 21.5,       // J/TH
  electricityCostKWh: 0.05,  // $0.05/kWh — institutional miner
};

// Post-2024-halving block reward
const BLOCK_REWARD_BTC = 3.125;
const DAILY_BLOCKS = 144;

export interface HashratePoint {
  date: string;
  hashrateEH: number; // EH/s
}

/**
 * Composite miner health score (0–100).
 *  60 = neutral / no signal
 *  > 60 = miner bullish signals
 *  < 60 = miner capitulation / stress
 */
export interface MinerScore {
  value: number;          // 0–100
  interpretation: string; // human-readable summary
  signals: {
    puell: { score: number; detail: string };
    hashRibbons: { score: number; detail: string };
    breakeven: { score: number; detail: string };
    diffRibbon: { score: number; detail: string };
  };
}

export interface MinerData {
  hashrateHistory: HashratePoint[]; // 3Y daily
  ma30: (number | null)[];          // 30d MA of hashrate
  ma60: (number | null)[];          // 60d MA of hashrate
  dates: string[];
  inCapitulation: boolean;          // ma30 < ma60
  crossoverSignal: boolean;         // most recent: ma30 crossed above ma60 (bullish)
  currentHashrateEH: number;
  breakevenPrice: number;           // USD
  hashprice: number;                // BTC/TH/s/day (multiply by btcPrice for USD)
  puellMultiple: number | null;
  puellHistory: { date: string; value: number }[];
  difficultyHistory: { date: string; difficulty: number }[];
  difficultyRibbonCompression: number; // 0–1 (1 = highly compressed = bullish)
  minerScore: MinerScore | null;
  lastUpdated: string;
}

// ─── Helper: Rolling average ──────────────────────────────────────────────────
export function rollingAvg(values: number[], window: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < window - 1) { result.push(null); continue; }
    const slice = values.slice(i - window + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / window);
  }
  return result;
}

// ─── Breakeven Price ──────────────────────────────────────────────────────────
/**
 * Calculate breakeven BTC price for reference miner at given network hashrate.
 * Formula: dailyCost / dailyBTCEarned
 * dailyCost = powerW * 24h / 1000 * electricityCostKWh
 * dailyBTCEarned = (minerTH / networkTH) * 144 * 3.125
 */
export function calcBreakevenPrice(networkHashrateEH: number): number {
  if (networkHashrateEH <= 0) return 0;
  const networkHashTH = networkHashrateEH * 1e6;
  const dailyEnergyCost =
    (REF_MINER.powerW * 24) / 1000 * REF_MINER.electricityCostKWh;
  const dailyBTC =
    (REF_MINER.hashTH / networkHashTH) * DAILY_BLOCKS * BLOCK_REWARD_BTC;
  return dailyBTC > 0 ? dailyEnergyCost / dailyBTC : 0;
}

// ─── Puell Multiple ───────────────────────────────────────────────────────────
/**
 * Puell Multiple = daily BTC emission in USD / 365d moving average
 * Values < 0.5 → historically deep bear / undervalued
 * Values > 4.0 → historically overheated / distribution zone
 */
export function calcPuellMultiple(
  btcPriceHistory: { date: string; price: number }[]
): { puellMultiple: number | null; puellHistory: { date: string; value: number }[] } {
  if (!btcPriceHistory || btcPriceHistory.length < 365) {
    return { puellMultiple: null, puellHistory: [] };
  }
  const emissionUSD = btcPriceHistory.map(p => ({
    date: p.date,
    value: BLOCK_REWARD_BTC * DAILY_BLOCKS * p.price,
  }));
  const ema365 = rollingAvg(emissionUSD.map(e => e.value), 365);
  const puellHistory: { date: string; value: number }[] = [];
  for (let i = 364; i < emissionUSD.length; i++) {
    const ma = ema365[i];
    if (ma && ma > 0) {
      puellHistory.push({
        date: emissionUSD[i].date,
        value: +(emissionUSD[i].value / ma).toFixed(4),
      });
    }
  }
  const puellMultiple =
    puellHistory.length > 0 ? puellHistory[puellHistory.length - 1].value : null;
  return { puellMultiple, puellHistory };
}

// ─── Hash Ribbons Crossover ───────────────────────────────────────────────────
/** Returns true if ma30 recently crossed above ma60 within the last 30 days. */
export function detectCrossover(
  ma30: (number | null)[],
  ma60: (number | null)[]
): boolean {
  const len = Math.min(ma30.length, ma60.length);
  for (let i = len - 1; i >= Math.max(1, len - 30); i--) {
    const cur30 = ma30[i]; const cur60 = ma60[i];
    const prev30 = ma30[i - 1]; const prev60 = ma60[i - 1];
    if (cur30 && cur60 && prev30 && prev60) {
      if (cur30 > cur60 && prev30 <= prev60) return true;
    }
  }
  return false;
}

// ─── Difficulty Ribbon Compression ───────────────────────────────────────────
/** Score 0–1: 1 = maximally compressed (bullish recovery signal). */
export function calcDifficultyRibbonCompression(
  diffHistory: { difficulty: number }[]
): number {
  if (diffHistory.length < 200) return 0;
  const diffs = diffHistory.slice(-200).map(d => d.difficulty);
  const windows = [9, 14, 25, 40, 60, 90, 128, 200];
  const mas = windows
    .map(w => {
      const slice = diffs.slice(-w);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    })
    .filter(v => v > 0);
  if (mas.length < 2) return 0;
  const mean = mas.reduce((a, b) => a + b, 0) / mas.length;
  const stdDev = Math.sqrt(
    mas.reduce((s, v) => s + (v - mean) ** 2, 0) / mas.length
  );
  const cv = stdDev / mean;
  return +Math.max(0, Math.min(1, 1 - cv / 0.12)).toFixed(3);
}

// ─── Composite Miner Score ────────────────────────────────────────────────────
/**
 * Aggregates Puell, Hash Ribbons, Breakeven distance and Difficulty Ribbon
 * into a single 0–100 score.
 *
 * Weights:
 *  Puell Multiple       35%
 *  Hash Ribbons         30%
 *  Breakeven distance   20%
 *  Difficulty Ribbon    15%
 */
export function calcMinerScore(
  puellMultiple: number | null,
  inCapitulation: boolean,
  crossoverSignal: boolean,
  breakevenPrice: number,
  btcPrice: number,
  difficultyRibbonCompression: number
): MinerScore {
  // ── Puell (35%) ──────────────────────────────────────────────
  let puellScore = 50;
  let puellDetail = 'Keine Puell-Daten';
  if (puellMultiple !== null) {
    if (puellMultiple < 0.5) { puellScore = 90; puellDetail = `Puell ${puellMultiple.toFixed(2)} — extreme Unterbewertung`; }
    else if (puellMultiple < 0.8) { puellScore = 75; puellDetail = `Puell ${puellMultiple.toFixed(2)} — Akkumulationszone`; }
    else if (puellMultiple < 1.5) { puellScore = 60; puellDetail = `Puell ${puellMultiple.toFixed(2)} — neutral`; }
    else if (puellMultiple < 2.5) { puellScore = 45; puellDetail = `Puell ${puellMultiple.toFixed(2)} — leicht erhöht`; }
    else if (puellMultiple < 4.0) { puellScore = 30; puellDetail = `Puell ${puellMultiple.toFixed(2)} — Distributionszone`; }
    else { puellScore = 15; puellDetail = `Puell ${puellMultiple.toFixed(2)} — historisches Hoch`; }
  }

  // ── Hash Ribbons (30%) ────────────────────────────────────────
  let hashScore = 50;
  let hashDetail = 'Keine Crossover-Daten';
  if (crossoverSignal) {
    hashScore = 85; hashDetail = 'MA30 kreuzte MA60 von unten — bullisches Buy-Signal';
  } else if (!inCapitulation) {
    hashScore = 65; hashDetail = 'MA30 > MA60 — Miner expandieren';
  } else {
    hashScore = 25; hashDetail = 'MA30 < MA60 — Miner-Kapitulation aktiv';
  }

  // ── Breakeven Distance (20%) ──────────────────────────────────
  let breakevenScore = 50;
  let breakevenDetail = 'Kein BTC-Preis';
  if (btcPrice > 0 && breakevenPrice > 0) {
    const ratio = btcPrice / breakevenPrice;
    if (ratio >= 3.0) { breakevenScore = 85; breakevenDetail = `${ratio.toFixed(1)}× über Breakeven — sehr profitabel`; }
    else if (ratio >= 2.0) { breakevenScore = 70; breakevenDetail = `${ratio.toFixed(1)}× über Breakeven — profitabel`; }
    else if (ratio >= 1.3) { breakevenScore = 55; breakevenDetail = `${ratio.toFixed(1)}× über Breakeven — knapp profitabel`; }
    else if (ratio >= 1.0) { breakevenScore = 40; breakevenDetail = `${ratio.toFixed(1)}× — an der Gewinnschwelle`; }
    else { breakevenScore = 15; breakevenDetail = `${ratio.toFixed(2)}× — Mining nicht profitabel`; }
  }

  // ── Difficulty Ribbon (15%) ───────────────────────────────────
  const diffScore = Math.round(30 + difficultyRibbonCompression * 55);
  const diffDetail = difficultyRibbonCompression > 0.7
    ? `Komprimierung ${(difficultyRibbonCompression * 100).toFixed(0)}% — bullisches Erholungssignal`
    : difficultyRibbonCompression > 0.4
      ? `Komprimierung ${(difficultyRibbonCompression * 100).toFixed(0)}% — neutral`
      : `Komprimierung ${(difficultyRibbonCompression * 100).toFixed(0)}% — Ribbons weit gespreizt`;

  // ── Composite ─────────────────────────────────────────────────
  const value = Math.round(
    puellScore * 0.35 +
    hashScore * 0.30 +
    breakevenScore * 0.20 +
    diffScore * 0.15
  );

  let interpretation: string;
  if (value >= 75) interpretation = 'Starkes Miner-Kaufsignal — historische Akkumulationszone';
  else if (value >= 60) interpretation = 'Miner-Umfeld bullisch — gesunde Expansion';
  else if (value >= 45) interpretation = 'Neutrales Miner-Umfeld — abwarten';
  else if (value >= 30) interpretation = 'Miner unter Druck — erhöhte Vorsicht';
  else interpretation = 'Miner-Kapitulation — potenzielle zyklische Bodenformation';

  return {
    value,
    interpretation,
    signals: {
      puell: { score: puellScore, detail: puellDetail },
      hashRibbons: { score: hashScore, detail: hashDetail },
      breakeven: { score: breakevenScore, detail: breakevenDetail },
      diffRibbon: { score: diffScore, detail: diffDetail },
    },
  };
}

// ─── In-memory cache (1 hour) ─────────────────────────────────────────────────
let _cache: MinerData | null = null;
let _cacheTime = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchMinerData(
  btcPriceHistory?: { date: string; price: number }[],
  btcPrice?: number
): Promise<MinerData | null> {
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS) return _cache;

  try {
    const timeout = AbortSignal.timeout(20000);

    const [hashrateResp, difficultyResp] = await Promise.allSettled([
      fetch(`${MEMPOOL_BASE}/mining/hashrate/3y`, { signal: timeout }),
      fetch(`${MEMPOOL_BASE}/difficulty-adjustments?interval=144`, { signal: timeout }),
    ]);

    // ── Parse hashrate ────────────────────────────────────────────
    let hashrateHistory: HashratePoint[] = [];
    if (hashrateResp.status === 'fulfilled' && hashrateResp.value.ok) {
      const raw = await hashrateResp.value.json();
      const items = raw?.hashrates || raw?.data?.hashrates || [];
      hashrateHistory = items
        .map((h: any) => ({
          date: new Date(h.timestamp * 1000).toISOString().split('T')[0],
          hashrateEH: h.avgHashrate / 1e18,
        }))
        .filter((h: HashratePoint) => h.hashrateEH > 0)
        .sort((a: HashratePoint, b: HashratePoint) => a.date.localeCompare(b.date));
    }

    if (hashrateHistory.length < 60) {
      console.warn('[BTC-MINER] Insufficient hashrate data from mempool.space');
      return null;
    }

    // ── Parse difficulty ──────────────────────────────────────────
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

    // ── Compute rolling averages ──────────────────────────────────
    const hrValues = hashrateHistory.map(h => h.hashrateEH);
    const dates = hashrateHistory.map(h => h.date);
    const ma30 = rollingAvg(hrValues, 30);
    const ma60 = rollingAvg(hrValues, 60);

    const lastMA30 = ma30[ma30.length - 1] ?? 0;
    const lastMA60 = ma60[ma60.length - 1] ?? 0;
    const inCapitulation = lastMA30 > 0 && lastMA60 > 0 && lastMA30 < lastMA60;
    const crossoverSignal = detectCrossover(ma30, ma60);
    const currentHashrateEH = hrValues[hrValues.length - 1] ?? 0;

    // ── Breakeven ─────────────────────────────────────────────────
    const breakevenPrice = calcBreakevenPrice(currentHashrateEH);

    // ── Hashprice (BTC/TH/s/day) ──────────────────────────────────
    const networkHashTH = currentHashrateEH * 1e6;
    const hashprice = networkHashTH > 0
      ? (BLOCK_REWARD_BTC * DAILY_BLOCKS) / networkHashTH
      : 0;

    // ── Puell Multiple ────────────────────────────────────────────
    const { puellMultiple, puellHistory } = calcPuellMultiple(btcPriceHistory ?? []);

    // ── Difficulty Ribbon Compression ─────────────────────────────
    const difficultyRibbonCompression = calcDifficultyRibbonCompression(difficultyHistory);

    // ── Composite Miner Score ─────────────────────────────────────
    const minerScore = calcMinerScore(
      puellMultiple,
      inCapitulation,
      crossoverSignal,
      breakevenPrice,
      btcPrice ?? 0,
      difficultyRibbonCompression
    );

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
      minerScore,
      lastUpdated: new Date().toISOString(),
    };

    _cache = result;
    _cacheTime = Date.now();
    console.log(
      `[BTC-MINER] OK — ${hashrateHistory.length} HR pts | ` +
      `Breakeven $${breakevenPrice.toFixed(0)} | ` +
      `Puell ${puellMultiple?.toFixed(2) ?? 'N/A'} | ` +
      `Score ${minerScore.value}`
    );
    return result;
  } catch (err: any) {
    console.error(`[BTC-MINER] Failed: ${err?.message?.substring(0, 150)}`);
    return null;
  }
}
