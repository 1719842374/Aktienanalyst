// Client-side BTC analysis — runs entirely in the browser using fetch().
// Ports the server-side logic from routes.ts without any Node.js dependencies.

// Re-use the BTCAnalysis interface shape from BTCDashboard.tsx
// (duplicated here to avoid circular imports)

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
}

interface TechChartPoint {
  date: string;
  price: number;
  ma50: number | null;
  ma200: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
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
  technicalSignals: TechSignal[];
  bullConditions: {
    priceAboveMA200: boolean;
    ma50AboveMA200: boolean;
    macdAboveZero: boolean;
    macdAboveSignal: boolean;
  };
  isBull: boolean;
  currentMA50: number | null;
  currentMA200: number | null;
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

// === Main analysis function ===

export async function analyzeBTC(): Promise<BTCAnalysis> {
  // Strategy: Fetch non-CoinGecko APIs first (no rate limit), then CoinGecko.
  // Use only ONE CoinGecko call (market_chart) to get both historical + current price.

  // === 1. Parallel fetch: F&G, F&G History, FRED (all non-CoinGecko) ===
  let fearGreedIndex = 50, fearGreedLabel = "Neutral";
  let fearGreedHistory: { date: string; value: number; classification: string }[] = [];
  let fedFundsRate = 4.33;
  const dxy = 103;

  const [fngResult, fngHistResult, fredResult] = await Promise.allSettled([
    fetchJSON("https://api.alternative.me/fng/?limit=1"),
    fetchJSON("https://api.alternative.me/fng/?limit=365&format=json"),
    fetchText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=FEDFUNDS&cosd=2024-01-01"),
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

  // === 2. CoinGecko: Fetch historical prices (this gives us both chart data AND current price) ===
  let btcPrice = 0, btcChange24h = 0, btcMarketCap = 0;
  // Try simple/price first (small request, less likely to fail)
  try {
    const cg = await fetchJSON(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_market_cap=true"
    );
    btcPrice = cg?.bitcoin?.usd ?? 0;
    btcChange24h = cg?.bitcoin?.usd_24h_change ?? 0;
    btcMarketCap = cg?.bitcoin?.usd_market_cap ?? 0;
  } catch {
    // Will try to get price from historical data
  }

  // Wait before next CoinGecko call to avoid rate limit
  await delay(1500);

  // === 5. Halving info ===
  const lastHalvingDate = new Date("2024-04-20");
  const now = new Date();
  const monthsSinceHalving = Math.round(
    (now.getTime() - lastHalvingDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  );
  const cyclePhase = `Mid-Cycle (${monthsSinceHalving}M post-Halving)`;

  // === 6. Power-Law calculations ===
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

  // Power signal
  let powerSignal: number;
  if (btcPrice > resistance) powerSignal = -1.0;
  else if (btcPrice >= fairValue) powerSignal = 0.0;
  else if (btcPrice >= support) powerSignal = 0.5;
  else powerSignal = 1.0;

  // === 7. Indicator Scoring ===
  let fgScore = 0;
  if (fearGreedIndex < 30) fgScore = 1;
  else if (fearGreedIndex > 70) fgScore = -1;

  let macroScore = 0;
  if (fedFundsRate > 5.0) macroScore = -1;
  else if (fedFundsRate < 3.0) macroScore = 1;

  let dxyScore = 0;
  if (dxy < 100) dxyScore = 1;
  else if (dxy > 105) dxyScore = -1;

  const indicators: BTCIndicator[] = [
    { name: "MVRV Z-Score", value: "N/A (default)", score: 0, weight: 0.20, source: "Default (neutral)", weighted: 0 },
    { name: "RSI (Weekly)", value: "N/A (default)", score: 0, weight: 0.15, source: "Default (neutral)", weighted: 0 },
    { name: "Fear & Greed", value: `${fearGreedIndex} (${fearGreedLabel})`, score: fgScore, weight: 0.10, source: "alternative.me", weighted: 0 },
    { name: "Hashrate Trend", value: "Stable", score: 1, weight: 0.10, source: "Default (stable growth)", weighted: 0 },
    { name: "ETF Net Flows", value: "N/A (default)", score: 0, weight: 0.15, source: "Default (neutral)", weighted: 0 },
    { name: "Macro (Fed/M2)", value: `FFR ${fedFundsRate}%`, score: macroScore, weight: 0.15, source: "FRED", weighted: 0 },
    { name: "DXY", value: `${dxy.toFixed(2)}`, score: dxyScore, weight: 0.15, source: "Default", weighted: 0 },
  ].map(ind => ({ ...ind, weighted: ind.score * ind.weight }));

  const gis = indicators.reduce((sum, ind) => sum + ind.weighted, 0);
  const gisCalculation = indicators
    .map(ind => `${ind.name}: ${ind.score} × ${ind.weight} = ${ind.weighted.toFixed(4)}`)
    .join(" + ") + ` = ${gis.toFixed(4)}`;

  // === 9. Cycle Signal ===
  let cycleSignal: number;
  if (monthsSinceHalving > 24) cycleSignal = -0.5;
  else if (monthsSinceHalving >= 18) cycleSignal = -0.3;
  else if (monthsSinceHalving >= 12) cycleSignal = 0.0;
  else if (monthsSinceHalving >= 6) cycleSignal = 0.3;
  else cycleSignal = 0.5;

  // === 10. GWS ===
  const gwsValue = gis * 0.30 + powerSignal * 0.50 + cycleSignal * 0.20;

  // === 11. μ mapping ===
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

  // === 12. Monte Carlo ===
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
    const p10 = results[Math.floor(iterations * 0.10)];
    const p50 = results[Math.floor(iterations * 0.50)];
    const p90 = results[Math.floor(iterations * 0.90)];
    const mean = results.reduce((s, v) => s + v, 0) / iterations;
    const probBelow = (results.filter(v => v < S0).length / iterations) * 100;
    const probAbove120 = (results.filter(v => v > S0 * 1.2).length / iterations) * 100;
    return { p10, p50, p90, mean, probBelow, probAbove120 };
  }

  const mc3M = runMonteCarlo(90);
  const mc6M = runMonteCarlo(180);

  // === 13. Categories A-E (3M) ===
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

  // === 14. Extended Historical Prices ===
  let allPriceData: { date: string; price: number }[] = [];

  async function fetchCGRange(fromSec: number, toSec: number): Promise<{ date: string; price: number }[]> {
    try {
      const parsed = await fetchJSON(
        `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart/range?vs_currency=usd&from=${fromSec}&to=${toSec}`,
        60000
      );
      if (parsed?.prices && Array.isArray(parsed.prices)) {
        const dayMap = new Map<string, number>();
        for (const p of parsed.prices as [number, number][]) {
          const d = new Date(p[0]).toISOString().split("T")[0];
          dayMap.set(d, p[1]);
        }
        return Array.from(dayMap.entries()).map(([date, price]) => ({ date, price }));
      }
    } catch {
      // swallow
    }
    return [];
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // Try 1Y first (smaller request, more likely to succeed with CoinGecko free tier)
  const oneYearAgo = nowSec - 365 * 86400;
  allPriceData = await fetchCGRange(oneYearAgo, nowSec);

  // If 1Y succeeded, try to extend to 5Y for more history
  if (allPriceData.length > 0) {
    await delay(2000);
    const fiveYearsAgo = nowSec - 5 * 365 * 86400;
    const fiveYData = await fetchCGRange(fiveYearsAgo, oneYearAgo);
    if (fiveYData.length > 0) {
      allPriceData = [...fiveYData, ...allPriceData];
    }
  } else {
    // 1Y failed too — wait and retry once
    await delay(3000);
    allPriceData = await fetchCGRange(oneYearAgo, nowSec);
  }

  // If CoinGecko completely failed, extract price from simple/price at least
  if (allPriceData.length === 0 && btcPrice > 0) {
    const today = new Date().toISOString().split("T")[0];
    allPriceData = [{ date: today, price: btcPrice }];
  }

  // Sort by date
  allPriceData.sort((a, b) => a.date.localeCompare(b.date));

  // Slice into timeframes
  const prices1Y = filterByYears(allPriceData, 1);
  const prices3Y = filterByYears(allPriceData, 3);
  const prices5Y = filterByYears(allPriceData, 5);
  const prices10Y = filterByYears(allPriceData, 10);

  // === 15. Calculate MA50, MA200, EMA12, EMA26 ===
  const closePrices = allPriceData.map(d => d.price);
  const ma50 = calcSMA(closePrices, 50);
  const ma200 = calcSMA(closePrices, 200);
  const ema12 = calcEMA(closePrices, 12);
  const ema26 = calcEMA(closePrices, 26);

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

  // Build technical chart data array
  const technicalChartData: TechChartPoint[] = allPriceData.map((d, i) => ({
    date: d.date,
    price: d.price,
    ma50: ma50[i],
    ma200: ma200[i],
    macd: macdLine[i],
    signal: signalLine[i],
    histogram: histogram[i],
  }));

  // === 16. Signal Detection ===
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
  }

  // Current technical status
  const lastTech = technicalChartData.length > 0 ? technicalChartData[technicalChartData.length - 1] : null;
  const bullConditions = {
    priceAboveMA200: lastTech && lastTech.ma200 !== null ? lastTech.price > (lastTech.ma200 ?? 0) : false,
    ma50AboveMA200: lastTech && lastTech.ma50 !== null && lastTech.ma200 !== null ? (lastTech.ma50 ?? 0) > (lastTech.ma200 ?? 0) : false,
    macdAboveZero: lastTech && lastTech.macd !== null ? (lastTech.macd ?? 0) > 0 : false,
    macdAboveSignal: lastTech && lastTech.macd !== null && lastTech.signal !== null ? (lastTech.macd ?? 0) > (lastTech.signal ?? 0) : false,
  };
  const isBull = bullConditions.priceAboveMA200 && bullConditions.ma50AboveMA200 && bullConditions.macdAboveZero && bullConditions.macdAboveSignal;

  // === 17. F&G Historical stats (data already fetched above in parallel) ===
  const fgValues = fearGreedHistory.map(d => d.value);
  const fgAvg30 = fgValues.length >= 30 ? fgValues.slice(-30).reduce((a, b) => a + b, 0) / 30 : null;
  const fgAvg90 = fgValues.length >= 90 ? fgValues.slice(-90).reduce((a, b) => a + b, 0) / 90 : null;
  const fgAvg365 = fgValues.length > 0 ? fgValues.reduce((a, b) => a + b, 0) / fgValues.length : null;
  const fgYearHigh = fgValues.length > 0 ? Math.max(...fgValues) : null;
  const fgYearLow = fgValues.length > 0 ? Math.min(...fgValues) : null;

  // === 8. Cycle Assessment (German) ===
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

  // === Build final estimate ===
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
    technicalSignals: signals.slice(-100),
    bullConditions,
    isBull,
    currentMA50: lastTech?.ma50 ?? null,
    currentMA200: lastTech?.ma200 ?? null,
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
