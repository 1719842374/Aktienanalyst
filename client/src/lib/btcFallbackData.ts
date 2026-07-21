import type { BTCAnalysis } from "./btcAnalysis";

// Helper: simple price series for fallback charts
function genPrices(days: number, startPrice: number, endPrice: number): { date: string; price: number }[] {
  const result: { date: string; price: number }[] = [];
  const now = new Date("2026-03-27");
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const t = (days - i) / days;
    const trend = startPrice + (endPrice - startPrice) * t;
    const noise = trend * 0.02 * (Math.sin(i * 0.3) + Math.cos(i * 0.17));
    result.push({ date: d.toISOString().slice(0, 10), price: Math.round(trend + noise) });
  }
  return result;
}

function genFearGreed(days: number): { date: string; value: number; classification: string }[] {
  const result: { date: string; value: number; classification: string }[] = [];
  const now = new Date("2026-03-27");
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const v = Math.max(5, Math.min(80, 40 + 30 * Math.sin(i * 0.07) + 10 * Math.cos(i * 0.2)));
    const val = Math.round(v);
    result.push({
      date: d.toISOString().slice(0, 10),
      value: val,
      classification: val < 25 ? "Extreme Fear" : val < 45 ? "Fear" : val < 55 ? "Neutral" : val < 75 ? "Greed" : "Extreme Greed",
    });
  }
  return result;
}

function genTechChart(days: number): any[] {
  const prices = genPrices(days, 45000, 65982);
  return prices.map((p, i) => ({
    date: p.date,
    price: p.price,
    ma20:  i >= 20  ? Math.round(prices.slice(i - 20,  i).reduce((s, x) => s + x.price, 0) / 20)  : null,
    ma50:  i >= 50  ? Math.round(prices.slice(i - 50,  i).reduce((s, x) => s + x.price, 0) / 50)  : null,
    ma100: i >= 100 ? Math.round(prices.slice(i - 100, i).reduce((s, x) => s + x.price, 0) / 100) : null,
    ma200: i >= 200 ? Math.round(prices.slice(i - 200, i).reduce((s, x) => s + x.price, 0) / 200) : null,
    ema9: null, ema12: null, ema26: null,
    macd: -25.85, signal: 68.92, histogram: -94.77,
    ma730: null, ma730x5: null, ma111: null, ma350x2: null, ma350: null, ma1400: null,
    rsi14: 38,
  }));
}

const techChart  = genTechChart(365);
const prices1Y   = genPrices(365,       28000, 65982);
const prices3Y   = genPrices(3 * 365,   18000, 65982);
const prices5Y   = genPrices(5 * 365,    8000, 65982);
const prices10Y  = genPrices(10 * 365,   4000, 65982);
const allPrices  = genPrices(10 * 365,   4000, 65982);
const fgHistory  = genFearGreed(365);

export const BTC_FALLBACK_DATA: BTCAnalysis = {
  "timestamp": "2026-03-27T20:22:25.081Z",
  "btcPrice": 65982,
  "btcChange24h": -4.698354110323257,
  "btcMarketCap": 1320080150124.3665,
  "lastHalvingDate": "2024-04-20",
  "monthsSinceHalving": 23,
  "nextHalvingEstimate": "~April 2028",
  "cyclePhase": "Mid-Cycle (23M post-Halving)",
  "indicators": [
    { "name": "MVRV Z-Score",   "value": "N/A (default)",     "score": 0, "weight": 0.20, "source": "Default (neutral)",      "weighted": 0    },
    { "name": "RSI (Weekly)",   "value": "N/A (default)",     "score": 0, "weight": 0.15, "source": "Default (neutral)",      "weighted": 0    },
    { "name": "Fear & Greed",   "value": "13 (Extreme Fear)", "score": 1, "weight": 0.10, "source": "alternative.me",         "weighted": 0.1  },
    { "name": "Hashrate Trend", "value": "Stable",            "score": 1, "weight": 0.10, "source": "Default (stable growth)","weighted": 0.1  },
    { "name": "ETF Net Flows",  "value": "N/A (default)",     "score": 0, "weight": 0.15, "source": "Default (neutral)",      "weighted": 0    },
    { "name": "Macro (Fed/M2)", "value": "FFR 3.64%",         "score": 0, "weight": 0.15, "source": "FRED",                   "weighted": 0    },
    { "name": "DXY",            "value": "103.00",            "score": 0, "weight": 0.15, "source": "Yahoo Finance",          "weighted": 0    }
  ],
  "gis": 0.2,
  "gisCalculation": "MVRV Z-Score: 0 × 0.2 = 0.0000 + RSI (Weekly): 0 × 0.15 = 0.0000 + Fear & Greed: 1 × 0.1 = 0.1000 + Hashrate Trend: 1 × 0.1 = 0.1000 + ETF Net Flows: 0 × 0.15 = 0.0000 + Macro (Fed/M2): 0 × 0.15 = 0.0000 + DXY: 0 × 0.15 = 0.0000 = 0.2000",
  "powerLaw": {
    "daysSinceGenesis": 6292,
    "fairValue": 130017.57607136024,
    "support": 52007.030428544094,
    "resistance": 325043.9401784006,
    "deviationPercent": -49.25147661283445,
    "fairValue6M": 153213.08949213868,
    "powerSignal": 0.5
  },
  "gws": {
    "gis": 0.2,
    "powerSignal": 0.5,
    "cycleSignal": -0.3,
    "value": 0.25,
    "mu": 0.0005,
    "interpretation": "Slightly Bullish – mixed signals with positive tilt"
  },
  "monteCarlo": {
    "sigma": 0.025,
    "sigmaAdj": 0.03,
    "mu": 0.0005,
    "threeMonth": {
      "p5": 40500, "p10": 46079, "p25": 56000, "p50": 66421,
      "p75": 79000, "p90": 94772, "p95": 105000,
      "mean": 68928, "probBelow": 48.86, "probAbove120": 26.31,
      "downsideProb10": 22.5, "downsideProb20": 11.3, "histogram": []
    },
    "sixMonth": {
      "p5": 33000, "p10": 39962, "p25": 52000, "p50": 66697,
      "p75": 86000, "p90": 112371, "p95": 130000,
      "mean": 72487, "probBelow": 49, "probAbove120": 33.7,
      "downsideProb10": 28.1, "downsideProb20": 16.4, "histogram": []
    }
  },
  "categories": [
    { "label": "A", "range": "> $85,777 (>+30%)",                 "probability": 0.178 },
    { "label": "B", "range": "$72,580 – $85,777 (+10% to +30%)", "probability": 0.217 },
    { "label": "C", "range": "$59,384 – $72,580 (±10%)",         "probability": 0.276 },
    { "label": "D", "range": "$46,187 – $59,384 (-10% to -30%)", "probability": 0.247 },
    { "label": "E", "range": "< $46,187 (>-30%)",                "probability": 0.081 }
  ],
  "cycleAssessment": {
    "position": "Bitcoin befindet sich 23 Monate nach dem Halving in der späten Expansionsphase.",
    "entryPoint": "Der aktuelle Preis liegt 49.3% unter dem Power-Law Fair Value – eine historisch attraktive Einstiegszone.",
    "halvingCatalyst": "Das nächste Halving wird voraussichtlich im April 2028 stattfinden."
  },
  "finalEstimate": {
    "threeMonthRange": "$46,079 – $94,772",
    "sixMonthRange": "$39,963 – $112,372",
    "outlook": "Bullish",
    "summary": "Bitcoin zeigt bullische Signale bei $65,982. Die Kombination aus Zyklusphase (23M post-Halving), Power-Law-Bewertung und Makro-Indikatoren deutet auf weiteres Aufwärtspotenzial hin."
  },
  "fearGreedIndex": 13,
  "fearGreedLabel": "Extreme Fear",
  "dxy": 103,
  "fedFundsRate": 3.64,
  "chartData": {
    "prices1Y":  prices1Y,
    "prices3Y":  prices3Y,
    "prices5Y":  prices5Y,
    "prices10Y": prices10Y,
    "allPrices": allPrices
  },
  "technicalChart":     techChart.slice(-90),
  "technicalChartFull": techChart,
  "technicalSignals": [
    { "date": "2026-02-16", "type": "BUY",  "reason": "MACD Bullish Crossover", "price": 68716 },
    { "date": "2026-03-16", "type": "BUY",  "reason": "MACD über Nulllinie",    "price": 72681 },
    { "date": "2026-03-23", "type": "SELL", "reason": "MACD Bearish Crossover", "price": 67848 },
    { "date": "2026-03-27", "type": "SELL", "reason": "MACD Bearish Crossover", "price": 68791 }
  ],
  "bullConditions": {
    "priceAboveMA200": false,
    "ma50AboveMA200":  false,
    "macdAboveZero":   false,
    "macdAboveSignal": false,
    "macdRising":      false
  },
  "isBull": false,
  "currentMA20":   67200,
  "currentMA50":   68864,
  "currentMA100":  74500,
  "currentMA200":  91761,
  "currentEMA9":   66100,
  "currentMACD":   -25.85,
  "currentSignal":  68.92,
  "fearGreedHistory": fgHistory,
  "fearGreedStats": {
    "avg30":   14.5,
    "avg90":   19.3,
    "avg365":  41.2,
    "yearHigh": 79,
    "yearLow":   5
  },
  "historicalVol": {
    "vol30d":    0.025,
    "vol90d":    0.025,
    "vol365d":   0.022,
    "volAnn30d": 0.478,
    "volAnn90d": 0.478,
    "volAnn365d":0.421
  }
} as unknown as BTCAnalysis;
