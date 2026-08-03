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

// Post-2024-halving block reward (current era — used for live hashprice/breakeven,
// which only ever look at TODAY's reward, so a constant is correct there).
const BLOCK_REWARD_BTC = 3.125;
const DAILY_BLOCKS = 144;

// Historical halving schedule (block reward halves every 210,000 blocks;
// dates below are the actual halving block-confirmation dates). Puell
// Multiple's 365-day rolling emission average spans multiple eras across
// 2012, 2016, 2020, and 2024 — using today's constant reward for the whole
// history silently overstates the multiple around every halving boundary
// (verified: with the flat constant, Puell Multiple never dropped below
// 0.70 anywhere in the full history, when the real 2018/2022 bear-market
// floors are documented around 0.4–0.5). Emission must use the reward that
// was actually in effect on each date.
const HALVING_SCHEDULE: { date: string; reward: number }[] = [
  { date: '2009-01-03', reward: 50 },
  { date: '2012-11-28', reward: 25 },
  { date: '2016-07-09', reward: 12.5 },
  { date: '2020-05-11', reward: 6.25 },
  { date: '2024-04-20', reward: 3.125 },
];

export function blockRewardForDate(dateStr: string): number {
  let reward = HALVING_SCHEDULE[0].reward;
  for (const h of HALVING_SCHEDULE) {
    if (dateStr >= h.date) reward = h.reward;
    else break;
  }
  return reward;
}

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

/**
 * WORK_BTC_MINER.md §3 — aggregierte Zonen-Klassifikation.
 * Additives Feld; MPI geht mangels Datenquelle (CryptoQuant/Glassnode-Key
 * erforderlich) als 'neutral' ein (±0 Punkte — kein Fake-Default).
 */
export interface MinerZoneResult {
  zone: 'capitulation' | 'transition' | 'profitable' | 'euphoria';
  score: number; // 0 = max Kapitulation, 100 = max Profit/Euphorie
  flags: string[];
}

export function classifyMinerZone(i: {
  spotPrice: number;
  breakeven: number;
  puell: number | null;
  hashRibbonSignal: 'capitulation' | 'buy' | 'neutral';
  difficultyCompression: 'compressed' | 'neutral' | 'expanded';
  mpiZone: 'distribution' | 'neutral' | 'accumulation';
}): MinerZoneResult {
  const flags: string[] = [];
  let score = 50;

  const premium = i.breakeven > 0 ? (i.spotPrice - i.breakeven) / i.breakeven : 0;
  if (premium < -0.05) { score -= 25; flags.push('SPOT_BELOW_BREAKEVEN'); }
  else if (premium > 0.20) { score += 15; flags.push('SPOT_ABOVE_BREAKEVEN'); }

  if (i.puell != null) {
    if (i.puell < 0.5) { score -= 20; flags.push('PUELL_CAPITULATION'); }
    else if (i.puell > 4) { score += 20; flags.push('PUELL_EUPHORIA'); }
  }

  if (i.hashRibbonSignal === 'capitulation') { score -= 15; flags.push('HASH_RIBBON_CAPITULATION'); }
  if (i.hashRibbonSignal === 'buy') { score += 20; flags.push('HASH_RIBBON_BUY'); }

  if (i.difficultyCompression === 'compressed') { score -= 10; flags.push('DIFFICULTY_COMPRESSION'); }

  if (i.mpiZone === 'distribution') { score -= 10; flags.push('MINER_DISTRIBUTION'); }
  if (i.mpiZone === 'accumulation') { score += 10; flags.push('MINER_ACCUMULATION'); }

  score = Math.max(0, Math.min(100, score));

  const zone: MinerZoneResult['zone'] =
    score < 30 ? 'capitulation' :
    score < 45 ? 'transition' :
    score > 80 ? 'euphoria' : 'profitable';

  return { zone, score, flags };
}

export interface MinerData {
  hashrateHistory: HashratePoint[]; // Voller Verlauf (siehe fetchMinerData-Kommentar zu mempool.space-Limits)
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
  /** WORK_BTC_MINER §3 — nur gesetzt wenn btcPrice übergeben wurde (POST) */
  minerZone?: MinerZoneResult | null;
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
  // Use the block reward actually in effect on each date (see
  // blockRewardForDate / HALVING_SCHEDULE above) — a flat constant here
  // silently overstates emission (and therefore Puell Multiple) for every
  // date before the most recent halving, which erases genuine capitulation
  // readings around historical bear-market floors.
  const emissionUSD = btcPriceHistory.map(p => ({
    date: p.date,
    value: blockRewardForDate(p.date) * DAILY_BLOCKS * p.price,
  }));

  // rollingAvg() (used elsewhere for hashrate MA30/MA60) averages over N
  // ARRAY INDICES, which is only equivalent to N calendar days when the
  // input has one point per day. btcPriceHistory here comes from
  // blockchain.info's `timespan=all`, which is downsampled to ~91
  // points/year (~4-day spacing) — a 365-INDEX window over that spans
  // roughly 4 CALENDAR YEARS, not 365 days. That silently smears every
  // bear-market floor across surrounding bull years, which is why the
  // multiple never dropped below ~0.6-0.7 even after fixing the halving
  // reward bug above (documented 2018/2022 floors are ~0.4-0.5). Use an
  // explicit calendar-day window instead, keyed off actual dates.
  const emissionByDate = new Map(emissionUSD.map(e => [e.date, e.value]));
  const sortedDates = emissionUSD.map(e => e.date); // already chronological
  const WINDOW_DAYS = 365;
  const puellHistory: { date: string; value: number }[] = [];
  let windowStart = 0;
  let windowSum = 0;
  let windowCount = 0;
  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    windowSum += emissionByDate.get(date) ?? 0;
    windowCount++;
    // Advance the window start past any dates older than WINDOW_DAYS from `date`.
    const cutoff = new Date(date);
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    while (windowStart < i && sortedDates[windowStart] < cutoffStr) {
      windowSum -= emissionByDate.get(sortedDates[windowStart]) ?? 0;
      windowCount--;
      windowStart++;
    }
    // Only emit once the window actually covers ~1 full year of history,
    // so early-history points (before day 365) don't get a falsely low MA.
    const firstDateInWindow = new Date(sortedDates[windowStart]);
    const spanDays = (new Date(date).getTime() - firstDateInWindow.getTime()) / 86400000;
    if (spanDays < WINDOW_DAYS - 30) continue; // require near-full window coverage
    const ma = windowSum / windowCount;
    if (ma > 0) {
      puellHistory.push({
        date,
        value: +((emissionByDate.get(date) ?? 0) / ma).toFixed(4),
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
  // Cache-Hit nur wenn der Cache mindestens so viel Kontext hat wie der Call:
  // Ein GET (ohne Preis) darf einem POST (mit Preis) kein Ergebnis ohne
  // Puell/minerZone unterschieben — sonst zeigt die Miner-Sektion 1h lang
  // "keine Daten" obwohl die Preishistorie mitgeschickt wurde.
  const callHasPriceContext = (btcPriceHistory?.length ?? 0) > 0 || (btcPrice ?? 0) > 0;
  const cacheHasPriceContext = _cache != null && (_cache.puellMultiple != null || _cache.minerZone != null);
  if (_cache && Date.now() - _cacheTime < CACHE_TTL_MS && (!callHasPriceContext || cacheHasPriceContext)) {
    return _cache;
  }

  try {
    const timeout = AbortSignal.timeout(20000);

    // WICHTIG (BTC-Miner-Zone 5Y-Feature): mempool.space liefert unter
    // /mining/hashrate/3y NUR 3 Jahre Historie (verifiziert 2026-08:
    // 1096 Tage, erster Tag = heute-3y). Für den geforderten 5-Jahres-
    // Zeitraum (~2021-08 bis 2026-08) wird stattdessen /mining/hashrate/all
    // verwendet — liefert die volle mempool.space-Historie zurück bis 2009
    // (verifiziert: 6422 Tagespunkte, erster Punkt 2009-01-03). Es werden
    // KEINE synthetischen/erfundenen Werte für fehlende Jahre erzeugt; die
    // tatsächlich verfügbare Historie deckt den 5Y-Zeitraum vollständig ab.
    //
    // Bugfix: die Difficulty-Adjustments-URL zeigte fälschlich auf
    // /api/v1/difficulty-adjustments (404) statt /api/v1/mining/difficulty-
    // adjustments — dadurch war difficultyHistory bisher immer leer und
    // difficultyRibbonCompression immer 0. Response-Format ist außerdem ein
    // Array von Tupeln [timestamp, height, difficulty, change], nicht ein
    // Objekt-Array — Parsing unten entsprechend angepasst.
    const [hashrateResp, difficultyResp] = await Promise.allSettled([
      fetch(`${MEMPOOL_BASE}/mining/hashrate/all`, { signal: timeout }),
      fetch(`${MEMPOOL_BASE}/mining/difficulty-adjustments?interval=144`, { signal: timeout }),
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
    // mempool.space liefert hier ein Array von Tupeln:
    // [timestamp(sec), blockHeight, difficulty, percentChange] — absteigend
    // sortiert (neuester Eintrag zuerst). Objekt-Format (d.time/d.difficulty)
    // wird zur Sicherheit weiter unterstützt, falls die API sich ändert.
    let difficultyHistory: { date: string; difficulty: number }[] = [];
    if (difficultyResp.status === 'fulfilled' && difficultyResp.value.ok) {
      const raw = await difficultyResp.value.json();
      const items = Array.isArray(raw) ? raw : (raw?.difficultyAdjustments || raw?.data || []);
      difficultyHistory = items
        .map((d: any) => {
          if (Array.isArray(d)) {
            const [ts, , difficulty] = d;
            return { date: new Date((ts || 0) * 1000).toISOString().split('T')[0], difficulty: difficulty || 0 };
          }
          return {
            date: new Date((d.time || d.timestamp || 0) * 1000).toISOString().split('T')[0],
            difficulty: d.difficulty || d.difficultyNew || 0,
          };
        })
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

    // ── §3 Zonen-Klassifikation (nur mit Preis-Kontext sinnvoll) ─────────────
    const minerZone = (btcPrice ?? 0) > 0
      ? classifyMinerZone({
          spotPrice: btcPrice!,
          breakeven: breakevenPrice,
          puell: puellMultiple,
          hashRibbonSignal: crossoverSignal ? 'buy' : (inCapitulation ? 'capitulation' : 'neutral'),
          difficultyCompression:
            difficultyRibbonCompression > 0.7 ? 'compressed'
            : difficultyRibbonCompression < 0.4 ? 'expanded' : 'neutral',
          mpiZone: 'neutral',
        })
      : null;

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
      minerZone,
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
