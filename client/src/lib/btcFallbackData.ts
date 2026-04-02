import type { BTCAnalysis } from "./btcAnalysis";

// Pre-computed BTC analysis data for static hosting fallback
// Heavy arrays (charts, history) excluded to reduce bundle size
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
    {
      "name": "MVRV Z-Score",
      "value": "N/A (default)",
      "score": 0,
      "weight": 0.2,
      "source": "Default (neutral)",
      "weighted": 0
    },
    {
      "name": "RSI (Weekly)",
      "value": "N/A (default)",
      "score": 0,
      "weight": 0.15,
      "source": "Default (neutral)",
      "weighted": 0
    },
    {
      "name": "Fear & Greed",
      "value": "13 (Extreme Fear)",
      "score": 1,
      "weight": 0.1,
      "source": "alternative.me",
      "weighted": 0.1
    },
    {
      "name": "Hashrate Trend",
      "value": "Stable",
      "score": 1,
      "weight": 0.1,
      "source": "Default (stable growth)",
      "weighted": 0.1
    },
    {
      "name": "ETF Net Flows",
      "value": "N/A (default)",
      "score": 0,
      "weight": 0.15,
      "source": "Default (neutral)",
      "weighted": 0
    },
    {
      "name": "Macro (Fed/M2)",
      "value": "FFR 3.64%",
      "score": 0,
      "weight": 0.15,
      "source": "FRED",
      "weighted": 0
    },
    {
      "name": "DXY",
      "value": "103.00",
      "score": 0,
      "weight": 0.15,
      "source": "Yahoo Finance",
      "weighted": 0
    }
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
      "p5": 40500,
      "p10": 46079.285215408316,
      "p25": 56000,
      "p50": 66421.5984186999,
      "p75": 79000,
      "p90": 94772.06568670017,
      "p95": 105000,
      "mean": 68928.33420674666,
      "probBelow": 48.86,
      "probAbove120": 26.31,
      "downsideProb10": 22.5,
      "downsideProb20": 11.3,
      "histogram": []
    },
    "sixMonth": {
      "p5": 33000,
      "p10": 39962.826028124204,
      "p25": 52000,
      "p50": 66697.27120401715,
      "p75": 86000,
      "p90": 112371.59736018641,
      "p95": 130000,
      "mean": 72487.6122486988,
      "probBelow": 49,
      "probAbove120": 33.7,
      "downsideProb10": 28.1,
      "downsideProb20": 16.4,
      "histogram": []
    }
  },
  "categories": [
    {
      "label": "A",
      "range": "> $85,777 (>+30%)",
      "probability": 17.8
    },
    {
      "label": "B",
      "range": "$72,580 – $85,777 (+10% to +30%)",
      "probability": 21.7
    },
    {
      "label": "C",
      "range": "$59,384 – $72,580 (±10%)",
      "probability": 27.6
    },
    {
      "label": "D",
      "range": "$46,187 – $59,384 (-10% to -30%)",
      "probability": 24.7
    },
    {
      "label": "E",
      "range": "< $46,187 (>-30%)",
      "probability": 8.1
    }
  ],
  "cycleAssessment": {
    "position": "Bitcoin befindet sich 23 Monate nach dem Halving in der späten Expansionsphase. Historisch gesehen nähert sich der Zyklus seinem Höhepunkt.",
    "entryPoint": "Der aktuelle Preis liegt 49.3% unter dem Power-Law Fair Value – eine historisch attraktive Einstiegszone.",
    "halvingCatalyst": "Das nächste Halving wird voraussichtlich im April 2028 stattfinden. Die aktuelle Angebotsverknappung durch das letzte Halving (April 2024) wirkt weiterhin als langfristiger Katalysator für den Preis."
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
    "prices1Y": [],
    "prices3Y": []
  },
  "technicalChart": [],
  "technicalSignals": [
    {
      "date": "2025-05-06",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 94758.8237105546
    },
    {
      "date": "2025-05-09",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 103076.27555512934
    },
    {
      "date": "2025-05-18",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 103212.36483885496
    },
    {
      "date": "2025-05-22",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 109665.86371625263
    },
    {
      "date": "2025-05-25",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 107831.36374380375
    },
    {
      "date": "2025-06-11",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 110212.73252109604
    },
    {
      "date": "2025-06-13",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 105979.22902375912
    },
    {
      "date": "2025-06-22",
      "type": "SELL",
      "reason": "MACD unter Nulllinie",
      "price": 101532.5683847329
    },
    {
      "date": "2025-06-27",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 106984.01253775663
    },
    {
      "date": "2025-06-27",
      "type": "BUY",
      "reason": "MACD über Nulllinie",
      "price": 106984.01253775663
    },
    {
      "date": "2025-07-22",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 117482.46977767294
    },
    {
      "date": "2025-07-23",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 119955.79570607653
    },
    {
      "date": "2025-07-24",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 118629.05588130427
    },
    {
      "date": "2025-08-11",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 119266.92516880555
    },
    {
      "date": "2025-08-18",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 117542.83687778088
    },
    {
      "date": "2025-08-21",
      "type": "SELL",
      "reason": "MACD unter Nulllinie",
      "price": 114252.39755195397
    },
    {
      "date": "2025-09-07",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 110209.1888247784
    },
    {
      "date": "2025-09-14",
      "type": "BUY",
      "reason": "MACD über Nulllinie",
      "price": 115970.58488443034
    },
    {
      "date": "2025-09-24",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 112022.16587861195
    },
    {
      "date": "2025-09-26",
      "type": "SELL",
      "reason": "MACD unter Nulllinie",
      "price": 108963.53013595635
    },
    {
      "date": "2025-10-02",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 118503.24451752483
    },
    {
      "date": "2025-10-02",
      "type": "BUY",
      "reason": "MACD über Nulllinie",
      "price": 118503.24451752483
    },
    {
      "date": "2025-10-11",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 113201.74064138904
    },
    {
      "date": "2025-10-16",
      "type": "SELL",
      "reason": "MACD unter Nulllinie",
      "price": 110708.66960879423
    },
    {
      "date": "2025-10-27",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 114476.01227508577
    },
    {
      "date": "2025-11-04",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 106521.08673825761
    },
    {
      "date": "2025-11-17",
      "type": "SELL",
      "reason": "Death Cross (MA50 < MA200)",
      "price": 94411.32947182967
    },
    {
      "date": "2025-11-28",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 91279.06057176423
    },
    {
      "date": "2025-12-18",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 86064.94716216
    },
    {
      "date": "2025-12-21",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 88347.94310567998
    },
    {
      "date": "2026-01-06",
      "type": "BUY",
      "reason": "MACD über Nulllinie",
      "price": 93926.7956485658
    },
    {
      "date": "2026-01-21",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 88312.84053255555
    },
    {
      "date": "2026-01-25",
      "type": "SELL",
      "reason": "MACD unter Nulllinie",
      "price": 89170.87364531498
    },
    {
      "date": "2026-02-16",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 68716.58337486399
    },
    {
      "date": "2026-03-16",
      "type": "BUY",
      "reason": "MACD über Nulllinie",
      "price": 72681.9132538886
    },
    {
      "date": "2026-03-23",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 67848.87605821833
    },
    {
      "date": "2026-03-23",
      "type": "SELL",
      "reason": "MACD unter Nulllinie",
      "price": 67848.87605821833
    },
    {
      "date": "2026-03-24",
      "type": "BUY",
      "reason": "MACD über Nulllinie",
      "price": 70892.82823994374
    },
    {
      "date": "2026-03-26",
      "type": "BUY",
      "reason": "MACD Bullish Crossover",
      "price": 71309.26403856269
    },
    {
      "date": "2026-03-27",
      "type": "SELL",
      "reason": "MACD Bearish Crossover",
      "price": 68791.11093800364
    },
    {
      "date": "2026-03-27",
      "type": "SELL",
      "reason": "MACD unter Nulllinie",
      "price": 68791.11093800364
    }
  ],
  "bullConditions": {
    "priceAboveMA200": false,
    "ma50AboveMA200": false,
    "macdAboveZero": false,
    "macdAboveSignal": false
  },
  "isBull": false,
  "currentMA50": 68864.88857108662,
  "currentMA200": 91761.35809776108,
  "currentMACD": -25.852450760023203,
  "currentSignal": 68.9214442364292,
  "fearGreedHistory": [],
  "fearGreedStats": {
    "avg30": 14.533333333333333,
    "avg90": 19.333333333333332,
    "avg365": 41.24383561643835,
    "yearHigh": 79,
    "yearLow": 5
  }
} as unknown as BTCAnalysis;
