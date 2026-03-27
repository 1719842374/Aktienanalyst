import type { GoldAnalysis } from "../../../shared/gold-schema";

// Pre-computed Gold analysis data for static hosting fallback
// Generated: 27.03.2026, 20:18
export const GOLD_FALLBACK_DATA: GoldAnalysis = {
  "timestamp": "2026-03-27T20:18:42.003Z",
  "analysisDate": "27.03.2026, 20:18",
  "spotPrice": 4500,
  "priceTimestamp": "2026-03-27T20:18:42.003Z",
  "currency": "USD",
  "changePercent": 0,
  "yearHigh": 4725,
  "yearLow": 3825,
  "ma200": 4500,
  "deviationFromMA200": 0,
  "plausibilityChecks": [
    "Spot-Preis $4500.00 plausibel (✅)",
    "200-DMA $4500.00 (⚠️ nur 0 Datenpunkte)",
    "RSI 50.0 (✅)",
    "Volatilität 20.0% (✅ plausibel)",
    "CPI 326.785 für Fair Value (✅)"
  ],
  "indicators": [
    {
      "name": "Zentralbankkäufe",
      "weight": 0.2,
      "score": 1,
      "value": "863t (2025), Prognose ~850t (2026)",
      "details": "Zentralbanken kaufen weiterhin massiv Gold (De-Dollarisierung, Rekordnachfrage seit 2022)",
      "thresholds": {
        "bullish": "≥700t/Jahr",
        "neutral": "-",
        "bearish": "<700t/Jahr"
      }
    },
    {
      "name": "ETF-Flows",
      "weight": 0.15,
      "score": 1,
      "value": "YTD >10 Mrd. $; 7T-Trend positiv",
      "details": "Starke ETF-Zuflüsse signalisieren institutionelles Interesse (Feb +5,3 Mrd.)",
      "thresholds": {
        "bullish": "YTD >10 Mrd. $",
        "neutral": "-10 bis +10 Mrd. $",
        "bearish": "<-10 Mrd. $"
      }
    },
    {
      "name": "Breakeven (T10YIE)",
      "weight": 0.1,
      "score": 0,
      "value": "2.34%",
      "details": "Moderate Inflationserwartungen",
      "thresholds": {
        "bullish": ">2.5%",
        "neutral": "2.0-2.5%",
        "bearish": "<1.5%"
      }
    },
    {
      "name": "Realzinsen (DFII10)",
      "weight": 0.15,
      "score": 0,
      "value": "2.08%",
      "details": "Moderate Realzinsen – neutrale Wirkung",
      "thresholds": {
        "bullish": "<0% oder 0-1.5%",
        "neutral": "1.5-2.5%",
        "bearish": ">2.5%"
      }
    },
    {
      "name": "M2 YoY",
      "weight": 0.05,
      "score": -1,
      "value": "1.0%",
      "details": "Geringe Geldmengenausweitung",
      "thresholds": {
        "bullish": ">5%",
        "neutral": "3-5%",
        "bearish": "<3%"
      }
    },
    {
      "name": "DXY",
      "weight": 0.1,
      "score": 0,
      "value": "100.0",
      "details": "Dollar im neutralen Bereich",
      "thresholds": {
        "bullish": "<98",
        "neutral": "98-104",
        "bearish": ">104"
      }
    },
    {
      "name": "Geopolitik (GPR)",
      "weight": 0.15,
      "score": 1,
      "value": ">155 (Nahost, Asien-Eskalation)",
      "details": "Erhöhtes geopolitisches Risiko treibt Safe-Haven-Nachfrage (Ukraine 2022: Gold stieg trotz Zinsanstieg)",
      "thresholds": {
        "bullish": ">150",
        "neutral": "100-150",
        "bearish": "<100"
      }
    },
    {
      "name": "Technisch (RSI+200DMA)",
      "weight": 0.1,
      "score": 1,
      "value": "RSI 50.0 | Abw. 0.0%",
      "details": "RSI 50.0 im Bereich 35-60 → Bullish",
      "thresholds": {
        "bullish": "RSI 35-60",
        "neutral": "RSI 60-75",
        "bearish": "RSI >75 UND Abw >25%"
      }
    }
  ],
  "gis": 0.55,
  "gisCalculation": "(+1 × 0.20) + (+1 × 0.15) + (0 × 0.10) + (0 × 0.15) + (-1 × 0.05) + (0 × 0.10) + (+1 × 0.15) + (+1 × 0.10) = 0.55",
  "fairValue": {
    "cpiToday": 326.785,
    "fv1980": 3371,
    "fv2011": 2790,
    "fvBasis": 3080,
    "premium": 0.45,
    "premiumReason": "GIS ≥ 0.40 → 45% Premium",
    "fvAdj": 4467,
    "support1": 4050,
    "support2": 3080,
    "resistance1": 4950,
    "resistance2": 5625
  },
  "monteCarlo3M": {
    "horizon": "3 Monate",
    "days": 90,
    "mu": 0.1,
    "sigma": 0.2,
    "iterations": 10000,
    "median": 4599,
    "p10": 4052,
    "p25": 4297,
    "p75": 4917,
    "p90": 5202,
    "min": 3080,
    "max": 6672,
    "distribution": [
      {
        "bin": 3080,
        "count": 1
      },
      {
        "bin": 3151,
        "count": 1
      },
      {
        "bin": 3223,
        "count": 0
      },
      {
        "bin": 3295,
        "count": 5
      },
      {
        "bin": 3367,
        "count": 13
      },
      {
        "bin": 3439,
        "count": 15
      },
      {
        "bin": 3511,
        "count": 39
      },
      {
        "bin": 3583,
        "count": 55
      },
      {
        "bin": 3654,
        "count": 65
      },
      {
        "bin": 3726,
        "count": 91
      },
      {
        "bin": 3798,
        "count": 137
      },
      {
        "bin": 3870,
        "count": 172
      },
      {
        "bin": 3942,
        "count": 251
      },
      {
        "bin": 4014,
        "count": 317
      },
      {
        "bin": 4086,
        "count": 363
      },
      {
        "bin": 4157,
        "count": 465
      },
      {
        "bin": 4229,
        "count": 532
      },
      {
        "bin": 4301,
        "count": 547
      },
      {
        "bin": 4373,
        "count": 596
      },
      {
        "bin": 4445,
        "count": 629
      },
      {
        "bin": 4517,
        "count": 615
      },
      {
        "bin": 4589,
        "count": 633
      },
      {
        "bin": 4660,
        "count": 597
      },
      {
        "bin": 4732,
        "count": 566
      },
      {
        "bin": 4804,
        "count": 509
      },
      {
        "bin": 4876,
        "count": 526
      },
      {
        "bin": 4948,
        "count": 411
      },
      {
        "bin": 5020,
        "count": 380
      },
      {
        "bin": 5092,
        "count": 322
      },
      {
        "bin": 5163,
        "count": 264
      },
      {
        "bin": 5235,
        "count": 198
      },
      {
        "bin": 5307,
        "count": 173
      },
      {
        "bin": 5379,
        "count": 126
      },
      {
        "bin": 5451,
        "count": 90
      },
      {
        "bin": 5523,
        "count": 88
      },
      {
        "bin": 5595,
        "count": 42
      },
      {
        "bin": 5666,
        "count": 47
      },
      {
        "bin": 5738,
        "count": 28
      },
      {
        "bin": 5810,
        "count": 27
      },
      {
        "bin": 5882,
        "count": 22
      },
      {
        "bin": 5954,
        "count": 11
      },
      {
        "bin": 6026,
        "count": 9
      },
      {
        "bin": 6098,
        "count": 8
      },
      {
        "bin": 6169,
        "count": 5
      },
      {
        "bin": 6241,
        "count": 5
      },
      {
        "bin": 6313,
        "count": 2
      },
      {
        "bin": 6385,
        "count": 0
      },
      {
        "bin": 6457,
        "count": 1
      },
      {
        "bin": 6529,
        "count": 0
      },
      {
        "bin": 6601,
        "count": 1
      }
    ]
  },
  "monteCarlo6M": {
    "horizon": "6 Monate",
    "days": 180,
    "mu": 0.1,
    "sigma": 0.2,
    "iterations": 10000,
    "median": 4683,
    "p10": 3924,
    "p25": 4266,
    "p75": 5152,
    "p90": 5623,
    "min": 2794,
    "max": 8119,
    "distribution": [
      {
        "bin": 2794,
        "count": 6
      },
      {
        "bin": 2900,
        "count": 5
      },
      {
        "bin": 3007,
        "count": 7
      },
      {
        "bin": 3113,
        "count": 16
      },
      {
        "bin": 3220,
        "count": 34
      },
      {
        "bin": 3326,
        "count": 40
      },
      {
        "bin": 3433,
        "count": 91
      },
      {
        "bin": 3539,
        "count": 150
      },
      {
        "bin": 3646,
        "count": 203
      },
      {
        "bin": 3752,
        "count": 261
      },
      {
        "bin": 3859,
        "count": 348
      },
      {
        "bin": 3965,
        "count": 480
      },
      {
        "bin": 4072,
        "count": 456
      },
      {
        "bin": 4178,
        "count": 495
      },
      {
        "bin": 4285,
        "count": 610
      },
      {
        "bin": 4391,
        "count": 606
      },
      {
        "bin": 4498,
        "count": 711
      },
      {
        "bin": 4604,
        "count": 647
      },
      {
        "bin": 4711,
        "count": 607
      },
      {
        "bin": 4817,
        "count": 621
      },
      {
        "bin": 4924,
        "count": 539
      },
      {
        "bin": 5030,
        "count": 485
      },
      {
        "bin": 5137,
        "count": 458
      },
      {
        "bin": 5243,
        "count": 414
      },
      {
        "bin": 5350,
        "count": 326
      },
      {
        "bin": 5456,
        "count": 248
      },
      {
        "bin": 5563,
        "count": 240
      },
      {
        "bin": 5669,
        "count": 216
      },
      {
        "bin": 5776,
        "count": 166
      },
      {
        "bin": 5882,
        "count": 120
      },
      {
        "bin": 5989,
        "count": 88
      },
      {
        "bin": 6095,
        "count": 84
      },
      {
        "bin": 6202,
        "count": 64
      },
      {
        "bin": 6308,
        "count": 36
      },
      {
        "bin": 6415,
        "count": 40
      },
      {
        "bin": 6521,
        "count": 26
      },
      {
        "bin": 6628,
        "count": 17
      },
      {
        "bin": 6734,
        "count": 13
      },
      {
        "bin": 6841,
        "count": 9
      },
      {
        "bin": 6947,
        "count": 4
      },
      {
        "bin": 7054,
        "count": 3
      },
      {
        "bin": 7160,
        "count": 5
      },
      {
        "bin": 7267,
        "count": 2
      },
      {
        "bin": 7373,
        "count": 2
      },
      {
        "bin": 7480,
        "count": 0
      },
      {
        "bin": 7586,
        "count": 0
      },
      {
        "bin": 7693,
        "count": 0
      },
      {
        "bin": 7799,
        "count": 0
      },
      {
        "bin": 7906,
        "count": 0
      },
      {
        "bin": 8012,
        "count": 0
      }
    ]
  },
  "monteCarlo12M": {
    "horizon": "12 Monate",
    "days": 365,
    "mu": 0.1,
    "sigma": 0.2,
    "iterations": 10000,
    "median": 4867,
    "p10": 3772,
    "p25": 4256,
    "p75": 5593,
    "p90": 6322,
    "min": 2301,
    "max": 10439,
    "distribution": [
      {
        "bin": 2301,
        "count": 3
      },
      {
        "bin": 2464,
        "count": 1
      },
      {
        "bin": 2627,
        "count": 20
      },
      {
        "bin": 2789,
        "count": 35
      },
      {
        "bin": 2952,
        "count": 64
      },
      {
        "bin": 3115,
        "count": 117
      },
      {
        "bin": 3278,
        "count": 183
      },
      {
        "bin": 3440,
        "count": 235
      },
      {
        "bin": 3603,
        "count": 327
      },
      {
        "bin": 3766,
        "count": 422
      },
      {
        "bin": 3929,
        "count": 496
      },
      {
        "bin": 4092,
        "count": 593
      },
      {
        "bin": 4254,
        "count": 622
      },
      {
        "bin": 4417,
        "count": 651
      },
      {
        "bin": 4580,
        "count": 695
      },
      {
        "bin": 4743,
        "count": 701
      },
      {
        "bin": 4905,
        "count": 646
      },
      {
        "bin": 5068,
        "count": 592
      },
      {
        "bin": 5231,
        "count": 531
      },
      {
        "bin": 5394,
        "count": 475
      },
      {
        "bin": 5556,
        "count": 454
      },
      {
        "bin": 5719,
        "count": 368
      },
      {
        "bin": 5882,
        "count": 328
      },
      {
        "bin": 6045,
        "count": 269
      },
      {
        "bin": 6208,
        "count": 230
      },
      {
        "bin": 6370,
        "count": 180
      },
      {
        "bin": 6533,
        "count": 166
      },
      {
        "bin": 6696,
        "count": 115
      },
      {
        "bin": 6859,
        "count": 96
      },
      {
        "bin": 7021,
        "count": 88
      },
      {
        "bin": 7184,
        "count": 74
      },
      {
        "bin": 7347,
        "count": 51
      },
      {
        "bin": 7510,
        "count": 51
      },
      {
        "bin": 7672,
        "count": 29
      },
      {
        "bin": 7835,
        "count": 24
      },
      {
        "bin": 7998,
        "count": 15
      },
      {
        "bin": 8161,
        "count": 7
      },
      {
        "bin": 8323,
        "count": 13
      },
      {
        "bin": 8486,
        "count": 9
      },
      {
        "bin": 8649,
        "count": 5
      },
      {
        "bin": 8812,
        "count": 6
      },
      {
        "bin": 8975,
        "count": 3
      },
      {
        "bin": 9137,
        "count": 3
      },
      {
        "bin": 9300,
        "count": 0
      },
      {
        "bin": 9463,
        "count": 1
      },
      {
        "bin": 9626,
        "count": 3
      },
      {
        "bin": 9788,
        "count": 2
      },
      {
        "bin": 9951,
        "count": 0
      },
      {
        "bin": 10114,
        "count": 0
      },
      {
        "bin": 10277,
        "count": 0
      }
    ],
    "scenarios": {
      "bullish": 46.5,
      "neutral": 35.9,
      "bearish": 17.6
    }
  },
  "priceEstimate": {
    "threeMonth": {
      "low": 4052,
      "mid": 4599,
      "high": 5202
    },
    "sixMonth": {
      "low": 3924,
      "mid": 4683,
      "high": 5623
    },
    "twelveMonth": {
      "low": 3772,
      "mid": 4867,
      "high": 6322
    }
  },
  "cycleAssessment": {
    "historicalCycles": "1976-1980: +700% (Stagflation). 2001-2011: +650% (Post-DotCom/GFC). 2018-heute: laufender Zyklus (De-Dollarisierung, Pandemie-Stimulus, Geopolitik). Wichtig: 2022 stieg Gold trotz steigender Zinsen wegen Ukraine-Krieg + Lieferengpässe + Inflation → Geopolitik kann Zinseffekte überkompensieren.",
    "currentPhase": "Aktive Bullphase – unterstützt durch multiple strukturelle Treiber",
    "drivers": [
      "✅ Zentralbankkäufe",
      "✅ ETF-Flows",
      "✅ Geopolitik (GPR)",
      "✅ Technisch (RSI+200DMA)",
      "⚠️ M2 YoY (negativ)"
    ],
    "outlook": "Starker GIS (0.55) signalisiert weiteres Aufwärtspotenzial. 4 von 8 Indikatoren bullish."
  },
  "summaryTable": [
    {
      "metric": "Gold Spot",
      "value": "$4500.00"
    },
    {
      "metric": "200-DMA",
      "value": "$4500.00"
    },
    {
      "metric": "Abweichung 200-DMA",
      "value": "+0.0%"
    },
    {
      "metric": "RSI (14)",
      "value": "50.0"
    },
    {
      "metric": "GIS (Gold Indicator Score)",
      "value": "0.55"
    },
    {
      "metric": "Sentiment",
      "value": "Bullish"
    },
    {
      "metric": "Fair Value (adj.)",
      "value": "$4467"
    },
    {
      "metric": "30d Volatilität (ann.)",
      "value": "20.0%"
    },
    {
      "metric": "3M Prognose (P10-P90)",
      "value": "$4052 – $5202"
    },
    {
      "metric": "6M Prognose (P10-P90)",
      "value": "$3924 – $5623"
    },
    {
      "metric": "12M Prognose (P10-P90)",
      "value": "$3772 – $6322"
    },
    {
      "metric": "DXY",
      "value": "100.0"
    },
    {
      "metric": "Realzinsen (DFII10)",
      "value": "2.08%"
    },
    {
      "metric": "Breakeven (T10YIE)",
      "value": "2.34%"
    }
  ],
  "finalAssessment": "Gold zeigt ein starkes bullisches Setup mit einem GIS von 0.55. 4 von 8 Indikatoren sind positiv. Die Fair Value (inflationsbereinigt) liegt bei $4467, der aktuelle Preis liegt darüber – Vorsicht. Die Monte-Carlo-Simulation (12M) zeigt eine 47% Wahrscheinlichkeit für >10% Aufwertung. Strukturelle Treiber (Zentralbankkäufe, De-Dollarisierung) bleiben intakt.",
  "sentiment": "Bullish",
  "sources": [
    "Gold-Preis: Kitco/TradingView/GoldPrice.org via Finance API",
    "Zentralbankkäufe: gold.org (WGC Gold Demand Trends 2025)",
    "ETF-Flows: gold.org/goldhub (Feb +5,3 Mrd., YTD >10 Mrd.)",
    "Breakeven: FRED (T10YIE, 26.03.2026: 2,34%)",
    "Realzinsen: FRED (DFII10, 25.03.2026: 2,02%)",
    "M2: YCharts (Feb 2026: +4,88% YoY)",
    "DXY: Yahoo Finance (27.03.2026: 100,01)",
    "Geopolitik: GPR Index (matteoiacoviello.com, >150)",
    "Technisch: RSI/200-DMA aus OHLCV, Investing.com, Barchart",
    "CPI: BLS (Feb 2026: 326,785)",
    "Volatilität: GVZ ~42, σ=0.20 (konservativ)"
  ],
  "historicalPrices": [],
  "rsi14": 50
} as GoldAnalysis;
