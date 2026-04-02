// Client-side BTC analysis — runs entirely in the browser using fetch().
// Uses Blockchain.com API for full historical BTC prices (10+ years),
// CoinGecko simple/price for current price data, and alternative.me for F&G.

// === Types ===

interface BTCIndicator {
  name: string;
  value: string;
  score: number;
  weight: number;
  weighted: number;
  source: string;
}

interface MonteCarloResult {
  p10: number;
  p50: number;
  p90: number;
  mean: number;
  probBelow: number;
  probAbove120: number;
  p5: number;
  p25: number;
  p75: number;
  p95: number;
  downsideProb10: number;
  downsideProb20: number;
  histogram: { bin: string; count: number; midPrice: number }[];
}

export interface TechChartPoint {
  date: string;
  price: number;
  ma20: number | null;
  ma50: number | null;
  ma100: number | null;
  ma200: number | null;
  ema9: number | null;
  ema12: number | null;
  ema26: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  // BTC-specific overlays
  ma730: number | null;
  ma730x5: number | null;
  ma111: number | null;
  ma350x2: number | null;
  ma350: number | null;
  ma1400: number | null;
}

interface TechSignal {
  date: string;
  type: "BUY" | "SELL";
  reason: string;
  price: number;
}

export interface BTCAnalysis {
  timestamp: string;
  btcPrice: number;
  btcChange24h: number;
  btcMarketCap: number;
  lastHalvingDate: string;
  monthsSinceHalving: number;
  nextHalvingEstimate: string;
  cyclePhase: string;
  indicators: BTCIndicator[];
  gis: number;
  gisCalculation: string;
  powerLaw: {
    daysSinceGenesis: number;
    fairValue: number;
    support: number;
    resistance: number;
    deviationPercent: number;
    fairValue6M: number;
    powerSignal: number;
  };
  gws: {
    gis: number;
    powerSignal: number;
    cycleSignal: number;
    value: number;
    mu: number;
    interpretation: string;
  };
  monteCarlo: {
    sigma: number;
    sigmaAdj: number;
    mu: number;
    threeMonth: MonteCarloResult;
    sixMonth: MonteCarloResult;
  };
  categories: { label: string; range: string; probability: number }[];
  cycleAssessment: {
    position: string;
    entryPoint: string;
    halvingCatalyst: string;
  };
  finalEstimate: {
    threeMonthRange: string;
    sixMonthRange: string;
    outlook: string;
    summary: string;
  };
  fearGreedIndex: number;
  fearGreedLabel: string;
  dxy: number;
  fedFundsRate: number;
  chartData: {
    prices1Y: { date: string; price: number }[];
    prices3Y: { date: string; price: number }[];
    prices5Y: { date: string; price: number }[];
    prices10Y: { date: string; price: number }[];
    allPrices: { date: string; price: number }[];
  };
  technicalChart: TechChartPoint[];
  technicalChartFull: TechChartPoint[];
  technicalSignals: TechSignal[];
  bullConditions: {
    priceAboveMA200: boolean;
    ma50AboveMA200: boolean;
    macdAboveZero: boolean;
    macdAboveSignal: boolean;
    macdRising: boolean;
  };
  isBull: boolean;
  currentMA20: number | null;
  currentMA50: number | null;
  currentMA100: number | null;
  currentMA200: number | null;
  currentEMA9: number | null;
  currentMACD: number | null;
  currentSignal: number | null;
  fearGreedHistory: { date: string; value: number; classification: string }[];
  fearGreedStats: {
    avg30: number | null;
    avg90: number | null;
    avg365: number | null;
    yearHigh: number | null;
    yearLow: number | null;
  };
}

// === Helpers ===

function normalRandom(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function calcSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

function calcEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      ema = sum / period;
    } else {
      ema = data[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

function filterByYears(data: { date: string; price: number }[], years: number) {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  return data.filter(d => d.date >= cutoffStr);
}

async function fetchJSON(url: string, timeoutMs = 30000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string, timeoutMs = 30000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// === ETF Flow fetcher (Farside Investors via GitHub) ===
async function fetchETFFlows(): Promise<{ totalFlow: number; days: number; dailyFlows: { date: string; flow: number }[]; source: string } | null> {
  try {
    // fadetocrypto/daily-crypto-reports: folder = report_date, file contains previous trading day
    const today = new Date();
    const folders: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      folders.push(d.toISOString().split("T")[0].replace(/-/g, ""));
    }

    const results = await Promise.allSettled(
      folders.map(folder =>
        fetchText(`https://raw.githubusercontent.com/fadetocrypto/daily-crypto-reports/main/${folder}/ETF%20flow%20${folder.slice(4,6)}-${folder.slice(6,8)}-${folder.slice(0,4)}.md`, 10000)
          .then(text => {
            // The file in folder YYYYMMDD is named with date (folder-1), but URL uses folder date
            // Actually the naming is: folder=20260327, file="ETF flow 03-26-2026.md"
            // Let's just parse whatever we get
            const match = text.match(/BTC ETF Flows.*?([+-]?\$[\d.]+M)/i);
            if (match) {
              const flowStr = match[1].replace("$", "").replace("M", "");
              return { date: folder, flow: parseFloat(flowStr) };
            }
            return null;
          })
          .catch(() => null)
      )
    );

    // Also try folder+1 pattern (report published day after)
    const altResults = await Promise.allSettled(
      folders.slice(0, 5).map(folder => {
        const d = new Date(`${folder.slice(0,4)}-${folder.slice(4,6)}-${folder.slice(6,8)}`);
        d.setDate(d.getDate() + 1);
        const nextFolder = d.toISOString().split("T")[0].replace(/-/g, "");
        return fetchText(`https://raw.githubusercontent.com/fadetocrypto/daily-crypto-reports/main/${nextFolder}/ETF%20flow%20${folder.slice(4,6)}-${folder.slice(6,8)}-${folder.slice(0,4)}.md`, 10000)
          .then(text => {
            const match = text.match(/BTC ETF Flows.*?([+-]?\$[\d.]+M)/i);
            if (match) {
              const flowStr = match[1].replace("$", "").replace("M", "");
              return { date: folder, flow: parseFloat(flowStr) };
            }
            return null;
          })
          .catch(() => null);
      })
    );

    const dailyFlows: { date: string; flow: number }[] = [];
    const seenDates = new Set<string>();

    for (const r of [...results, ...altResults]) {
      if (r.status === "fulfilled" && r.value && !seenDates.has(r.value.date)) {
        dailyFlows.push(r.value);
        seenDates.add(r.value.date);
      }
    }

    if (dailyFlows.length === 0) return null;

    dailyFlows.sort((a, b) => b.date.localeCompare(a.date)); // newest first
    const totalFlow = dailyFlows.reduce((sum, d) => sum + d.flow, 0);

    return {
      totalFlow,
      days: dailyFlows.length,
      dailyFlows,
      source: "Farside Investors (GitHub)",
    };
  } catch {
    return null;
  }
}

// === Main analysis function ===

export async function analyzeBTC(): Promise<BTCAnalysis> {
  // Strategy: Fetch non-CoinGecko APIs in parallel first, then CoinGecko simple/price,
  // then Blockchain.com for full history.

  // === 1. Parallel fetch: F&G, F&G History, FRED, Blockchain.com, DXY, Hashrate (all non-CoinGecko) ===
  let fearGreedIndex = 50, fearGreedLabel = "Neutral";
  let fearGreedHistory: { date: string; value: number; classification: string }[] = [];
  let fedFundsRate = 3.64; // Updated default: Feb 2026 FRED FEDFUNDS
  let dxy = 103;
  let hashrateChange = 0; // percent change over 90 days
  let hashrateValue = "";

  const [fngResult, fngHistResult, fredResult, blockchainResult, eurusdResult, hashrateResult, etfFlowResult] = await Promise.allSettled([
    fetchJSON("https://api.alternative.me/fng/?limit=1"),
    fetchJSON("https://api.alternative.me/fng/?limit=2000&format=json"),
    fetchText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS&cosd=2024-01-01"),
    fetchJSON("https://api.blockchain.info/charts/market-price?timespan=all&format=json&cors=true", 60000),
    fetchJSON("https://data-api.binance.vision/api/v3/ticker/24hr?symbol=EURUSDT"),
    fetchJSON("https://mempool.space/api/v1/mining/hashrate/3m"),
    fetchETFFlows(),
  ]);

  if (fngResult.status === "fulfilled" && fngResult.value?.data?.[0]) {
    fearGreedIndex = parseInt(fngResult.value.data[0].value ?? "50", 10);
    fearGreedLabel = fngResult.value.data[0].value_classification ?? "Neutral";
  }

  if (fngHistResult.status === "fulfilled" && fngHistResult.value?.data) {
    fearGreedHistory = fngHistResult.value.data.map((d: any) => ({
      date: new Date(parseInt(d.timestamp) * 1000).toISOString().split("T")[0],
      value: parseInt(d.value),
      classification: d.value_classification,
    })).reverse();
  }

  if (fredResult.status === "fulfilled") {
    const fredLines = fredResult.value.trim().split("\n");
    if (fredLines.length >= 2) {
      const parts = fredLines[fredLines.length - 1].split(",");
      if (parts.length >= 2) {
        const val = parseFloat(parts[1]);
        if (!isNaN(val)) fedFundsRate = val;
      }
    }
  }

  // === 1b. Parse DXY from EUR/USDT ===
  if (eurusdResult.status === "fulfilled" && eurusdResult.value?.lastPrice) {
    const eurusd = parseFloat(eurusdResult.value.lastPrice);
    if (eurusd > 0) {
      // DXY is ~57.6% weighted by EUR. Simplified: DXY ≈ 50.14 + 55.27/EURUSD + 3.7
      // More accurate empirical approximation:
      dxy = Math.round((50.14348 + 55.274 * (1 / eurusd) + 3.7) * 100) / 100;
    }
  }

  // === 1c. Parse Hashrate trend from mempool.space ===
  if (hashrateResult.status === "fulfilled") {
    const hr = hashrateResult.value;
    const hashrates = hr?.hashrates || [];
    const currentHR = hr?.currentHashrate || 0;
    if (hashrates.length >= 2 && currentHR > 0) {
      const oldHR = hashrates[0]?.avgHashrate || 0;
      if (oldHR > 0) {
        hashrateChange = ((currentHR - oldHR) / oldHR) * 100;
        const hrEH = (currentHR / 1e18).toFixed(0);
        hashrateValue = `${hrEH} EH/s (${hashrateChange >= 0 ? "+" : ""}${hashrateChange.toFixed(1)}% 90d)`;
      }
    }
  }

  // === 1d. Parse ETF Flow data ===
  let etfFlowValue = "";
  let etfFlowScore = 0;
  let etfFlowSource = "N/A";
  if (etfFlowResult.status === "fulfilled" && etfFlowResult.value) {
    const etf = etfFlowResult.value;
    const avgDaily = etf.totalFlow / etf.days;
    etfFlowValue = `${etf.totalFlow >= 0 ? "+" : ""}$${etf.totalFlow.toFixed(0)}M (${etf.days}d)`;
    etfFlowSource = etf.source;
    // Scoring: strong inflows = bullish, strong outflows = bearish
    if (avgDaily > 50) etfFlowScore = 1;        // strong daily inflows
    else if (avgDaily > 0) etfFlowScore = 0.5;   // moderate inflows
    else if (avgDaily > -50) etfFlowScore = -0.5; // moderate outflows
    else etfFlowScore = -1;                       // strong outflows
  }

  // === 2. Parse Blockchain.com historical data ===
  let allPriceData: { date: string; price: number }[] = [];

  if (blockchainResult.status === "fulfilled" && blockchainResult.value?.values) {
    const dayMap = new Map<string, number>();
    for (const point of blockchainResult.value.values as { x: number; y: number }[]) {
      const d = new Date(point.x * 1000).toISOString().split("T")[0];
      dayMap.set(d, point.y);
    }
    allPriceData = Array.from(dayMap.entries())
      .map(([date, price]) => ({ date, price }))
      .filter(d => d.price > 0);
  }

  // Fallback: CoinGecko market_chart if Blockchain.com failed
  if (allPriceData.length === 0) {
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      const fiveYearsAgo = nowSec - 5 * 365 * 86400;
      const parsed = await fetchJSON(
        `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${fiveYearsAgo}&to=${nowSec}`,
        60000
      );
      if (parsed?.prices && Array.isArray(parsed.prices)) {
        const dayMap = new Map<string, number>();
        for (const p of parsed.prices as [number, number][]) {
          const d = new Date(p[0]).toISOString().split("T")[0];
          dayMap.set(d, p[1]);
        }
        allPriceData = Array.from(dayMap.entries()).map(([date, price]) => ({ date, price }));
      }
    } catch {
      // swallow
    }
  }

  allPriceData.sort((a, b) => a.date.localeCompare(b.date));

  // === 3. CoinGecko simple/price for current data ===
  let btcPrice = 0, btcChange24h = 0, btcMarketCap = 0;
  try {
    const cg = await fetchJSON(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"
    );
    btcPrice = cg?.bitcoin?.usd ?? 0;
    btcChange24h = cg?.bitcoin?.usd_24h_change ?? 0;
    btcMarketCap = cg?.bitcoin?.usd_market_cap ?? 0;
  } catch {
    // Fall back to last price in historical data
    if (allPriceData.length > 0) {
      btcPrice = allPriceData[allPriceData.length - 1].price;
    }
  }

  // If historical data doesn't include today, append current price
  if (allPriceData.length > 0 && btcPrice > 0) {
    const today = new Date().toISOString().split("T")[0];
    const lastDate = allPriceData[allPriceData.length - 1].date;
    if (lastDate < today) {
      allPriceData.push({ date: today, price: btcPrice });
    } else if (lastDate === today) {
      allPriceData[allPriceData.length - 1].price = btcPrice;
    }
  } else if (allPriceData.length === 0 && btcPrice > 0) {
    allPriceData = [{ date: new Date().toISOString().split("T")[0], price: btcPrice }];
  }

  // Slice into timeframes
  const prices1Y = filterByYears(allPriceData, 1);
  const prices3Y = filterByYears(allPriceData, 3);
  const prices5Y = filterByYears(allPriceData, 5);
  const prices10Y = filterByYears(allPriceData, 10);

  // === 2b. Calculate Weekly RSI from daily prices ===
  let weeklyRSI: number | null = null;
  let rsiSource = "Berechnet (Blockchain.info)";
  if (allPriceData.length > 120) { // need at least ~15 weeks of daily data
    // Resample to weekly closes (every 7th day)
    const weeklyCloses: number[] = [];
    for (let i = 6; i < allPriceData.length; i += 7) {
      weeklyCloses.push(allPriceData[i].price);
    }
    // Append last data point if not included
    if (weeklyCloses.length > 0 && allPriceData.length > 0) {
      const lastPrice = allPriceData[allPriceData.length - 1].price;
      if (weeklyCloses[weeklyCloses.length - 1] !== lastPrice) {
        weeklyCloses.push(lastPrice);
      }
    }
    // Wilder RSI (14 periods)
    if (weeklyCloses.length >= 15) {
      const changes: number[] = [];
      for (let i = 1; i < weeklyCloses.length; i++) {
        changes.push(weeklyCloses[i] - weeklyCloses[i - 1]);
      }
      const period = 14;
      let avgGain = 0, avgLoss = 0;
      for (let i = 0; i < period; i++) {
        if (changes[i] > 0) avgGain += changes[i];
        else avgLoss += Math.abs(changes[i]);
      }
      avgGain /= period;
      avgLoss /= period;
      // Smooth with Wilder method
      for (let i = period; i < changes.length; i++) {
        const gain = changes[i] > 0 ? changes[i] : 0;
        const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
      }
      if (avgLoss === 0) weeklyRSI = 100;
      else {
        const rs = avgGain / avgLoss;
        weeklyRSI = 100 - (100 / (1 + rs));
      }
      weeklyRSI = Math.round(weeklyRSI * 10) / 10;
    }
  }

  // === 2c. MVRV Z-Score approximation via Power-Law Realized Price ===
  // Realized Price ≈ Power-Law fair value * 0.6 (empirical relationship)
  // MVRV = Market Price / Realized Price
  // Z-Score = (Market Cap - Realized Cap) / StdDev(Market Cap)
  let mvrvZScore: number | null = null;
  let mvrvSource = "Power-Law Approximation";
  if (allPriceData.length > 365 && btcPrice > 0) {
    const genesisD = new Date("2009-01-03");
    const daysSG = Math.floor((Date.now() - genesisD.getTime()) / 86400000);
    const plFairValue = 1.0117e-17 * Math.pow(daysSG, 5.82);
    // Realized price tracks long-term cost basis, roughly 60% of PL fair value
    const realizedPrice = plFairValue * 0.6;
    if (realizedPrice > 0) {
      const mvrv = btcPrice / realizedPrice;
      // Z-Score: how many standard deviations above the mean MVRV (~1.5)
      // Historical MVRV mean ≈ 1.5, stddev ≈ 1.2
      mvrvZScore = Math.round(((mvrv - 1.5) / 1.2) * 100) / 100;
    }
  }

  // === 4. Halving info ===
  const lastHalvingDate = new Date("2024-04-20");
  const now = new Date();
  const monthsSinceHalving = Math.round(
    (now.getTime() - lastHalvingDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  );
  const cyclePhase = `Mid-Cycle (${monthsSinceHalving}M post-Halving)`;

  // === 5. Power-Law calculations ===
  const genesisDate = new Date("2009-01-03");
  const daysSinceGenesis = Math.floor(
    (now.getTime() - genesisDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  const fairValue = 1.0117e-17 * Math.pow(daysSinceGenesis, 5.82);
  const support = fairValue * 0.4;
  const resistance = fairValue * 2.5;
  const deviationPercent = ((btcPrice - fairValue) / fairValue) * 100;
  const daysSixMonths = daysSinceGenesis + 180;
  const fairValue6M = 1.0117e-17 * Math.pow(daysSixMonths, 5.82);

  let powerSignal: number;
  if (btcPrice > resistance) powerSignal = -1.0;
  else if (btcPrice >= fairValue) powerSignal = 0.0;
  else if (btcPrice >= support) powerSignal = 0.5;
  else powerSignal = 1.0;

  // === 6. Indicator Scoring ===
  // MVRV Z-Score scoring
  let mvrvScore = 0;
  if (mvrvZScore !== null) {
    if (mvrvZScore < -0.5) mvrvScore = 1;       // undervalued → bullish
    else if (mvrvZScore > 3) mvrvScore = -1;     // overvalued → bearish
    else if (mvrvZScore > 2) mvrvScore = -0.5;   // getting expensive
  }

  // RSI scoring
  let rsiScore = 0;
  if (weeklyRSI !== null) {
    if (weeklyRSI < 30) rsiScore = 1;            // oversold → bullish
    else if (weeklyRSI < 40) rsiScore = 0.5;     // approaching oversold
    else if (weeklyRSI > 70) rsiScore = -1;      // overbought → bearish
    else if (weeklyRSI > 60) rsiScore = -0.5;    // approaching overbought
  }

  let fgScore = 0;
  if (fearGreedIndex < 30) fgScore = 1;
  else if (fearGreedIndex > 70) fgScore = -1;

  // Hashrate scoring: growing hashrate = healthy network = bullish
  let hashrateScore = 0;
  if (hashrateValue) {
    if (hashrateChange > 5) hashrateScore = 1;   // strong growth
    else if (hashrateChange > 0) hashrateScore = 0.5; // moderate growth
    else if (hashrateChange < -10) hashrateScore = -1; // miner capitulation
    else if (hashrateChange < 0) hashrateScore = -0.5; // declining
  } else {
    hashrateValue = "Stable";
    hashrateScore = 0;
  }

  let macroScore = 0;
  if (fedFundsRate > 5.0) macroScore = -1;
  else if (fedFundsRate < 3.0) macroScore = 1;

  let dxyScore = 0;
  if (dxy < 100) dxyScore = 1;
  else if (dxy > 105) dxyScore = -1;

  const dxySource = eurusdResult.status === "fulfilled" ? "Binance EUR/USDT" : "Default";

  const indicators: BTCIndicator[] = [
    { name: "MVRV Z-Score", value: mvrvZScore !== null ? mvrvZScore.toFixed(2) : "N/A", score: mvrvScore, weight: 0.20, source: mvrvZScore !== null ? mvrvSource : "N/A", weighted: 0 },
    { name: "RSI (Weekly)", value: weeklyRSI !== null ? weeklyRSI.toFixed(1) : "N/A", score: rsiScore, weight: 0.15, source: weeklyRSI !== null ? rsiSource : "N/A", weighted: 0 },
    { name: "Fear & Greed", value: `${fearGreedIndex} (${fearGreedLabel})`, score: fgScore, weight: 0.10, source: "alternative.me", weighted: 0 },
    { name: "Hashrate Trend", value: hashrateValue || "Stable", score: hashrateScore, weight: 0.10, source: hashrateValue ? "mempool.space" : "Default", weighted: 0 },
    { name: "ETF Net Flows", value: etfFlowValue || "N/A", score: etfFlowScore, weight: 0.15, source: etfFlowSource, weighted: 0 },
    { name: "Macro (Fed/M2)", value: `FFR ${fedFundsRate.toFixed(2)}%`, score: macroScore, weight: 0.15, source: fredResult.status === "fulfilled" ? "FRED (live)" : "FRED (Stand: Feb 2026)", weighted: 0 },
    { name: "DXY", value: `${dxy.toFixed(2)}`, score: dxyScore, weight: 0.15, source: dxySource, weighted: 0 },
  ].map(ind => ({ ...ind, weighted: ind.score * ind.weight }));

  const gis = indicators.reduce((sum, ind) => sum + ind.weighted, 0);
  const gisCalculation = indicators
    .map(ind => `${ind.name}: ${ind.score} × ${ind.weight} = ${ind.weighted.toFixed(4)}`)
    .join(" + ") + ` = ${gis.toFixed(4)}`;

  // === 7. Cycle Signal ===
  let cycleSignal: number;
  if (monthsSinceHalving > 24) cycleSignal = -0.5;
  else if (monthsSinceHalving >= 18) cycleSignal = -0.3;
  else if (monthsSinceHalving >= 12) cycleSignal = 0.0;
  else if (monthsSinceHalving >= 6) cycleSignal = 0.3;
  else cycleSignal = 0.5;

  // === 8. GWS ===
  const gwsValue = gis * 0.30 + powerSignal * 0.50 + cycleSignal * 0.20;

  let mu: number;
  if (gwsValue > 0.5) mu = 0.0010;
  else if (gwsValue >= 0.2) mu = 0.0005;
  else if (gwsValue >= -0.2) mu = 0.0;
  else if (gwsValue >= -0.5) mu = -0.0005;
  else mu = -0.0010;

  let gwsInterpretation: string;
  if (gwsValue > 0.3) gwsInterpretation = "Bullish – favorable macro, cycle, and valuation signals";
  else if (gwsValue > 0) gwsInterpretation = "Slightly Bullish – mixed signals with positive tilt";
  else if (gwsValue > -0.3) gwsInterpretation = "Neutral to Slightly Bearish – caution warranted";
  else gwsInterpretation = "Bearish – unfavorable conditions across indicators";

  // === 9. Monte Carlo ===
  const sigma = 0.025;
  const sigmaAdj = sigma * (monthsSinceHalving > 18 ? 1.2 : 1.0);
  const S0 = btcPrice;

  function runMonteCarlo(T: number): MonteCarloResult {
    const results: number[] = [];
    const iterations = 10000;
    for (let i = 0; i < iterations; i++) {
      const Z = normalRandom();
      const ST = S0 * Math.exp((mu - (sigmaAdj * sigmaAdj) / 2) * T + sigmaAdj * Math.sqrt(T) * Z);
      results.push(ST);
    }
    results.sort((a, b) => a - b);
    const p5 = results[Math.floor(iterations * 0.05)];
    const p10 = results[Math.floor(iterations * 0.10)];
    const p25 = results[Math.floor(iterations * 0.25)];
    const p50 = results[Math.floor(iterations * 0.50)];
    const p75 = results[Math.floor(iterations * 0.75)];
    const p90 = results[Math.floor(iterations * 0.90)];
    const p95 = results[Math.floor(iterations * 0.95)];
    const mean = results.reduce((s, v) => s + v, 0) / iterations;
    const probBelow = (results.filter(v => v < S0).length / iterations) * 100;
    const probAbove120 = (results.filter(v => v > S0 * 1.2).length / iterations) * 100;
    const downsideProb10 = (results.filter(v => v < S0 * 0.9).length / iterations) * 100;
    const downsideProb20 = (results.filter(v => v < S0 * 0.8).length / iterations) * 100;

    // Generate histogram bins
    const binCount = 30;
    const binMin = results[Math.floor(results.length * 0.02)]; // trim 2% outliers
    const binMax = results[Math.floor(results.length * 0.98)];
    const binWidth = (binMax - binMin) / binCount;
    const histogram = Array.from({ length: binCount }, (_, i) => {
      const lo = binMin + i * binWidth;
      const hi = lo + binWidth;
      const count = results.filter(p => p >= lo && p < (i === binCount - 1 ? Infinity : hi)).length;
      return { bin: `$${(lo / 1000).toFixed(0)}k`, count, midPrice: lo + binWidth / 2 };
    });

    return { p5, p10, p25, p50, p75, p90, p95, mean, probBelow, probAbove120, downsideProb10, downsideProb20, histogram };
  }

  const mc3M = runMonteCarlo(90);
  const mc6M = runMonteCarlo(180);

  // === 10. Categories A-E (3M) ===
  function computeCategories() {
    const iterations = 10000;
    const results: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const Z = normalRandom();
      const ST = S0 * Math.exp((mu - (sigmaAdj * sigmaAdj) / 2) * 90 + sigmaAdj * Math.sqrt(90) * Z);
      results.push(ST);
    }
    let catA = (results.filter(v => v > S0 * 1.30).length / iterations) * 100;
    let catB = (results.filter(v => v > S0 * 1.10 && v <= S0 * 1.30).length / iterations) * 100;
    let catC = (results.filter(v => v >= S0 * 0.90 && v <= S0 * 1.10).length / iterations) * 100;
    let catD = (results.filter(v => v >= S0 * 0.70 && v < S0 * 0.90).length / iterations) * 100;
    let catE = (results.filter(v => v < S0 * 0.70).length / iterations) * 100;

    if (monthsSinceHalving > 18) {
      const diff = catE * 0.22;
      catE = catE * 0.78;
      catB = catB + diff;
    }

    return [
      { label: "A", range: `> $${(S0 * 1.30).toLocaleString("en-US", { maximumFractionDigits: 0 })} (>+30%)`, probability: Math.round(catA * 10) / 10 },
      { label: "B", range: `$${(S0 * 1.10).toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${(S0 * 1.30).toLocaleString("en-US", { maximumFractionDigits: 0 })} (+10% to +30%)`, probability: Math.round(catB * 10) / 10 },
      { label: "C", range: `$${(S0 * 0.90).toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${(S0 * 1.10).toLocaleString("en-US", { maximumFractionDigits: 0 })} (±10%)`, probability: Math.round(catC * 10) / 10 },
      { label: "D", range: `$${(S0 * 0.70).toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${(S0 * 0.90).toLocaleString("en-US", { maximumFractionDigits: 0 })} (-10% to -30%)`, probability: Math.round(catD * 10) / 10 },
      { label: "E", range: `< $${(S0 * 0.70).toLocaleString("en-US", { maximumFractionDigits: 0 })} (>-30%)`, probability: Math.round(catE * 10) / 10 },
    ];
  }

  const categories = computeCategories();

  // === 11. Calculate ALL moving averages & indicators ===
  const closePrices = allPriceData.map(d => d.price);

  // Standard MAs
  const ma20 = calcSMA(closePrices, 20);
  const ma50 = calcSMA(closePrices, 50);
  const ma100 = calcSMA(closePrices, 100);
  const ma200 = calcSMA(closePrices, 200);

  // EMAs
  const ema9 = calcEMA(closePrices, 9);
  const ema12 = calcEMA(closePrices, 12);
  const ema26 = calcEMA(closePrices, 26);

  // BTC-specific MAs
  const ma111 = calcSMA(closePrices, 111);       // Pi Cycle
  const ma350 = calcSMA(closePrices, 350);        // Golden Ratio base
  const ma730 = calcSMA(closePrices, 730);        // 2-Year MA
  const ma1400 = calcSMA(closePrices, 1400);      // 200-Week MA

  // Derived: Pi Cycle top = MA350 × 2, 2-Year MA upper = MA730 × 5
  const ma350x2: (number | null)[] = ma350.map(v => v !== null ? v * 2 : null);
  const ma730x5: (number | null)[] = ma730.map(v => v !== null ? v * 5 : null);

  // MACD = EMA12 - EMA26
  const macdLine: (number | null)[] = ema12.map((e12, i) => {
    const e26 = ema26[i];
    if (e12 === null || e26 === null) return null;
    return e12 - e26;
  });

  // Signal line = EMA9 of MACD
  const macdValues = macdLine.filter(v => v !== null) as number[];
  const signalRaw = calcEMA(macdValues, 9);
  let signalIdx = 0;
  const signalLine: (number | null)[] = macdLine.map(v => {
    if (v === null) return null;
    const s = signalRaw[signalIdx++];
    return s;
  });

  // Histogram
  const histogram: (number | null)[] = macdLine.map((m, i) => {
    const s = signalLine[i];
    if (m === null || s === null) return null;
    return m - s;
  });

  // Build enhanced technical chart data
  const technicalChartData: TechChartPoint[] = allPriceData.map((d, i) => ({
    date: d.date,
    price: d.price,
    ma20: ma20[i],
    ma50: ma50[i],
    ma100: ma100[i],
    ma200: ma200[i],
    ema9: ema9[i],
    ema12: ema12[i],
    ema26: ema26[i],
    macd: macdLine[i],
    signal: signalLine[i],
    histogram: histogram[i],
    ma730: ma730[i],
    ma730x5: ma730x5[i],
    ma111: ma111[i],
    ma350x2: ma350x2[i],
    ma350: ma350[i],
    ma1400: ma1400[i],
  }));

  // === 12. Signal Detection ===
  const signals: TechSignal[] = [];

  for (let i = 1; i < technicalChartData.length; i++) {
    const prev = technicalChartData[i - 1];
    const curr = technicalChartData[i];

    // Golden Cross: MA50 crosses above MA200
    if (prev.ma50 !== null && prev.ma200 !== null && curr.ma50 !== null && curr.ma200 !== null) {
      if (prev.ma50 <= prev.ma200 && curr.ma50 > curr.ma200) {
        signals.push({ date: curr.date, type: "BUY", reason: "Golden Cross (MA50 > MA200)", price: curr.price });
      }
      if (prev.ma50 >= prev.ma200 && curr.ma50 < curr.ma200) {
        signals.push({ date: curr.date, type: "SELL", reason: "Death Cross (MA50 < MA200)", price: curr.price });
      }
    }

    // MACD Bullish/Bearish Crossover
    if (prev.macd !== null && prev.signal !== null && curr.macd !== null && curr.signal !== null) {
      if (prev.macd <= prev.signal && curr.macd > curr.signal) {
        signals.push({ date: curr.date, type: "BUY", reason: "MACD Bullish Crossover", price: curr.price });
      }
      if (prev.macd >= prev.signal && curr.macd < curr.signal) {
        signals.push({ date: curr.date, type: "SELL", reason: "MACD Bearish Crossover", price: curr.price });
      }
    }

    // MACD crosses zero line
    if (prev.macd !== null && curr.macd !== null) {
      if (prev.macd <= 0 && curr.macd > 0) {
        signals.push({ date: curr.date, type: "BUY", reason: "MACD über Nulllinie", price: curr.price });
      }
      if (prev.macd >= 0 && curr.macd < 0) {
        signals.push({ date: curr.date, type: "SELL", reason: "MACD unter Nulllinie", price: curr.price });
      }
    }

    // Pi Cycle Top: MA111 crosses above MA350×2
    if (prev.ma111 !== null && prev.ma350x2 !== null && curr.ma111 !== null && curr.ma350x2 !== null) {
      if (prev.ma111 <= prev.ma350x2 && curr.ma111 > curr.ma350x2) {
        signals.push({ date: curr.date, type: "SELL", reason: "Pi Cycle Top", price: curr.price });
      }
    }

    // 2-Year MA crossover
    if (prev.ma730 !== null && curr.ma730 !== null) {
      if (prev.price >= prev.ma730 && curr.price < curr.ma730) {
        signals.push({ date: curr.date, type: "SELL", reason: "Unter 2-Year MA", price: curr.price });
      }
      if (prev.price <= prev.ma730 && curr.price > curr.ma730) {
        signals.push({ date: curr.date, type: "BUY", reason: "Über 2-Year MA", price: curr.price });
      }
    }
  }

  // Current technical status
  const lastTech = technicalChartData.length > 0 ? technicalChartData[technicalChartData.length - 1] : null;
  const prevTech = technicalChartData.length > 1 ? technicalChartData[technicalChartData.length - 2] : null;

  const macdRising = (lastTech?.macd !== null && prevTech?.macd !== null)
    ? (lastTech!.macd! > prevTech!.macd!)
    : false;

  const bullConditions = {
    priceAboveMA200: lastTech && lastTech.ma200 !== null ? lastTech.price > (lastTech.ma200 ?? 0) : false,
    ma50AboveMA200: lastTech && lastTech.ma50 !== null && lastTech.ma200 !== null ? (lastTech.ma50 ?? 0) > (lastTech.ma200 ?? 0) : false,
    macdAboveZero: lastTech && lastTech.macd !== null ? (lastTech.macd ?? 0) > 0 : false,
    macdAboveSignal: lastTech && lastTech.macd !== null && lastTech.signal !== null ? (lastTech.macd ?? 0) > (lastTech.signal ?? 0) : false,
    macdRising,
  };
  const isBull = bullConditions.priceAboveMA200 && bullConditions.ma50AboveMA200 && bullConditions.macdAboveZero && bullConditions.macdAboveSignal;

  // === 13. F&G Historical stats (data already fetched in parallel) ===
  const fgValues = fearGreedHistory.map(d => d.value);
  const fgAvg30 = fgValues.length >= 30 ? fgValues.slice(-30).reduce((a, b) => a + b, 0) / 30 : null;
  const fgAvg90 = fgValues.length >= 90 ? fgValues.slice(-90).reduce((a, b) => a + b, 0) / 90 : null;
  const fgAvg365 = fgValues.length > 0 ? fgValues.reduce((a, b) => a + b, 0) / fgValues.length : null;
  const fgYearHigh = fgValues.length > 0 ? Math.max(...fgValues) : null;
  const fgYearLow = fgValues.length > 0 ? Math.min(...fgValues) : null;

  // === 14. Cycle Assessment (German) ===
  let positionText: string;
  if (monthsSinceHalving < 12) {
    positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der frühen Expansionsphase. Historisch gesehen beginnen die stärksten Kursanstiege 12–18 Monate nach dem Halving.`;
  } else if (monthsSinceHalving < 18) {
    positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der mittleren Zyklusphase. Dies ist historisch die Phase mit dem stärksten Momentum.`;
  } else if (monthsSinceHalving < 24) {
    positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der späten Expansionsphase. Historisch gesehen nähert sich der Zyklus seinem Höhepunkt.`;
  } else {
    positionText = `Bitcoin befindet sich ${monthsSinceHalving} Monate nach dem Halving in der späten Zyklusphase. Vorsicht ist geboten, da historische Zyklen typischerweise 24–30 Monate nach dem Halving ihren Höhepunkt erreichen.`;
  }

  let entryText: string;
  if (deviationPercent < -30) {
    entryText = `Der aktuelle Preis liegt ${Math.abs(deviationPercent).toFixed(1)}% unter dem Power-Law Fair Value – eine historisch attraktive Einstiegszone.`;
  } else if (deviationPercent < 0) {
    entryText = `Der aktuelle Preis liegt ${Math.abs(deviationPercent).toFixed(1)}% unter dem Power-Law Fair Value – ein leicht unterbewertetes Niveau.`;
  } else if (deviationPercent < 50) {
    entryText = `Der aktuelle Preis liegt ${deviationPercent.toFixed(1)}% über dem Power-Law Fair Value – eine neutrale Bewertungszone.`;
  } else {
    entryText = `Der aktuelle Preis liegt ${deviationPercent.toFixed(1)}% über dem Power-Law Fair Value – zunehmend überbewertetes Territorium. Vorsicht bei Neueinstiegen.`;
  }

  const halvingCatalyst = `Das nächste Halving wird voraussichtlich im April 2028 stattfinden. Die aktuelle Angebotsverknappung durch das letzte Halving (April 2024) wirkt weiterhin als langfristiger Katalysator für den Preis.`;

  // === 15. Build final estimate ===
  const outlook = gwsValue > 0.2 ? "Bullish" : gwsValue > -0.2 ? "Neutral" : "Bearish";
  const threeMonthRange = `$${mc3M.p10.toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${mc3M.p90.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const sixMonthRange = `$${mc6M.p10.toLocaleString("en-US", { maximumFractionDigits: 0 })} – $${mc6M.p90.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  let summary: string;
  if (outlook === "Bullish") {
    summary = `Bitcoin zeigt bullische Signale bei $${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}. Die Kombination aus Zyklusphase (${monthsSinceHalving}M post-Halving), Power-Law-Bewertung und Makro-Indikatoren deutet auf weiteres Aufwärtspotenzial hin.`;
  } else if (outlook === "Neutral") {
    summary = `Bitcoin handelt bei $${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })} in einer neutralen Zone. Gemischte Signale aus Zyklusphase, Bewertung und Makro-Umfeld erfordern Geduld.`;
  } else {
    summary = `Bitcoin steht bei $${btcPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })} unter Druck. Ungünstige Makro-Bedingungen und späte Zyklusphase mahnen zur Vorsicht.`;
  }

  // === Assemble response ===
  return {
    timestamp: new Date().toISOString(),
    btcPrice,
    btcChange24h,
    btcMarketCap,

    lastHalvingDate: "2024-04-20",
    monthsSinceHalving,
    nextHalvingEstimate: "~April 2028",
    cyclePhase,

    indicators,
    gis,
    gisCalculation,

    powerLaw: {
      daysSinceGenesis,
      fairValue,
      support,
      resistance,
      deviationPercent,
      fairValue6M,
      powerSignal,
    },

    gws: {
      gis,
      powerSignal,
      cycleSignal,
      value: gwsValue,
      mu,
      interpretation: gwsInterpretation,
    },

    monteCarlo: {
      sigma,
      sigmaAdj,
      mu,
      threeMonth: mc3M,
      sixMonth: mc6M,
    },

    categories,

    cycleAssessment: {
      position: positionText,
      entryPoint: entryText,
      halvingCatalyst,
    },

    finalEstimate: {
      threeMonthRange,
      sixMonthRange,
      outlook,
      summary,
    },

    fearGreedIndex,
    fearGreedLabel,

    dxy,
    fedFundsRate,

    chartData: {
      prices1Y,
      prices3Y,
      prices5Y,
      prices10Y,
      allPrices: allPriceData,
    },

    technicalChart: technicalChartData.slice(-365 * 5),
    technicalChartFull: technicalChartData,
    technicalSignals: signals.slice(-100),
    bullConditions,
    isBull,
    currentMA20: lastTech?.ma20 ?? null,
    currentMA50: lastTech?.ma50 ?? null,
    currentMA100: lastTech?.ma100 ?? null,
    currentMA200: lastTech?.ma200 ?? null,
    currentEMA9: lastTech?.ema9 ?? null,
    currentMACD: lastTech?.macd ?? null,
    currentSignal: lastTech?.signal ?? null,

    fearGreedHistory,
    fearGreedStats: {
      avg30: fgAvg30,
      avg90: fgAvg90,
      avg365: fgAvg365,
      yearHigh: fgYearHigh,
      yearLow: fgYearLow,
    },
  };
}
