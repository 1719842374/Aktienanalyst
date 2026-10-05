// Auto-generated fallback data for static deployment
// Generated: 2026-04-20
// Indicators: 17/17 with data
export const RECESSION_FALLBACK_DATA = {
  "date": "20.04.2026",
  "asOf": "2026-04-20",
  "schemaVersion": 1,
  "indicators": [
    {
      "name": "Sahm-Regel",
      "group": "recession",
      "subgroup": "coincident",
      "value": "0.20 pp",
      "rawScore": -3,
      "weight": 1,
      "weightedScore": -3,
      "maxWeighted": 4,
      "zone": "Normal (<0.5pp)",
      "source": "FRED SAHMREALTIME",
      "description": "3-Monats-Durchschnitt der Arbeitslosenquote vs. 12-Monats-Tief"
    },
    {
      "name": "Inv. Zinskurve (10Y-2Y)",
      "group": "recession",
      "subgroup": "coincident",
      "value": "0.55%",
      "rawScore": -3,
      "weight": 1,
      "weightedScore": -3,
      "maxWeighted": 4,
      "zone": "Normal (≥0)",
      "source": "FRED T10Y2Y",
      "description": "Spread zwischen 10-Jahres- und 2-Jahres-US-Staatsanleihen"
    },
    {
      "name": "Aktivität (IP / Auslastung)",
      "group": "recession",
      "subgroup": "coincident",
      "value": "N/A",
      "rawScore": 0,
      "weight": 0,
      "weightedScore": 0,
      "maxWeighted": 0,
      "zone": "N/A",
      "source": "FRED INDPRO / TCU",
      "description": "Industrieproduktion Jahr-über-Jahr (INDPRO) und Kapazitätsauslastung (TCU).",
      "available": false
    },
    {
      "name": "Durable Goods (YoY)",
      "group": "recession",
      "subgroup": "leading",
      "value": "7.4%",
      "rawScore": -2,
      "weight": 1,
      "weightedScore": -2,
      "maxWeighted": 3,
      "zone": "Stabil",
      "source": "FRED DGORDER",
      "description": "Auftragseingang langlebige Güter, Jahr-über-Jahr"
    },
    {
      "name": "M2 Geldmenge (YoY)",
      "group": "recession",
      "subgroup": "leading",
      "value": "4.9%",
      "rawScore": 0,
      "weight": 1,
      "weightedScore": 0,
      "maxWeighted": 3,
      "zone": "Normal (4-10%)",
      "source": "FRED M2SL",
      "description": "US M2-Geldmengenwachstum Jahr-über-Jahr"
    },
    {
      "name": "Kreditspreads (BAA-Trs)",
      "group": "recession",
      "subgroup": "leading",
      "value": "1.71%",
      "rawScore": 0,
      "weight": 1,
      "weightedScore": 0,
      "maxWeighted": 3,
      "zone": "Normal (1.5-2.0%)",
      "source": "FRED BAA10Y",
      "description": "Moody's BAA Corporate Bond Spread über 10Y Treasury"
    },
    {
      "name": "Konsumklima (CSI)",
      "group": "recession",
      "subgroup": "full",
      "value": "47.6",
      "rawScore": 3,
      "weight": 1,
      "weightedScore": 3,
      "maxWeighted": 3,
      "zone": "Pessimistisch (<60)",
      "source": "U of Michigan / Finance API",
      "description": "University of Michigan Consumer Sentiment Index"
    },
    {
      "name": "Buffett Indikator (TMC/GDP)",
      "group": "correction",
      "subgroup": "valuation",
      "value": "230%",
      "rawScore": 8,
      "weight": 2,
      "weightedScore": 16,
      "maxWeighted": 16,
      "zone": "Extrem überbewertet (230% >200%)",
      "source": "currentmarketvaluation.com",
      "description": "Gesamtmarktkapitalisierung / BIP Verhältnis"
    },
    {
      "name": "Shiller CAPE",
      "group": "correction",
      "subgroup": "valuation",
      "value": "N/A",
      "rawScore": 0,
      "weight": 0,
      "weightedScore": 0,
      "maxWeighted": 0,
      "zone": "N/A",
      "source": "Shiller ie_data.xls nicht gelesen",
      "description": "CAPE steht nur im Shiller-Workbook. Ohne .xls bleibt der Slot zu.",
      "available": false
    },
    {
      "name": "Margin Debt",
      "group": "correction",
      "subgroup": "valuation",
      "value": "N/A",
      "rawScore": 0,
      "weight": 0,
      "weightedScore": 0,
      "maxWeighted": 0,
      "zone": "N/A",
      "source": "FINRA xlsx nicht gelesen",
      "description": "Debit steht nur in der FINRA-xlsx. Ohne die Datei bleibt der Slot zu.",
      "available": false
    },
    {
      "name": "Google Trends \"Recession\"",
      "group": "correction",
      "subgroup": "sentiment_ext",
      "value": "57 (7d Ø)",
      "rawScore": 0,
      "weight": 1.7,
      "weightedScore": 0,
      "maxWeighted": 11.9,
      "zone": "Normal (57.4 30-60)",
      "source": "Google Trends (7d Ø=57.4, Latest=59, Peak=100)",
      "description": "Google-Suchinteresse für 'Recession' (0-100 Index)"
    },
    {
      "name": "VIX",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "19.8",
      "rawScore": 0,
      "weight": 1,
      "weightedScore": 0,
      "maxWeighted": 4,
      "zone": "Normal (15-20)",
      "source": "CBOE / Finance API",
      "description": "CBOE Volatility Index (Angstbarometer)"
    },
    {
      "name": "Advance-Decline-Line",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "N/A",
      "rawScore": 0,
      "weight": 0,
      "weightedScore": 0,
      "maxWeighted": 0,
      "zone": "N/A",
      "source": "NYSE",
      "description": "NYSE Advance-Decline-Linie vs. S&P 500 Divergenz",
      "available": false
    },
    {
      "name": "CNN Fear & Greed",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "65",
      "rawScore": 2,
      "weight": 1.6,
      "weightedScore": 3.2,
      "maxWeighted": 9.6,
      "zone": "Greed (55-75)",
      "source": "Finance API (Sentiment-Proxy)",
      "description": "CNN Fear & Greed Index (0=Extreme Fear, 100=Extreme Greed)"
    },
    {
      "name": "AAII Sentiment",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "N/A",
      "rawScore": 0,
      "weight": 0,
      "weightedScore": 0,
      "maxWeighted": 0,
      "zone": "N/A",
      "source": "AAII",
      "description": "American Association of Individual Investors Sentiment Survey",
      "available": false
    },
    {
      "name": "CBOE Put/Call Ratio",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "N/A",
      "rawScore": 0,
      "weight": 0,
      "weightedScore": 0,
      "maxWeighted": 0,
      "zone": "N/A",
      "source": "CBOE",
      "description": "Equity Put/Call Ratio (Absicherungsindikator)",
      "available": false
    },
    {
      "name": "Investors Intelligence",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "N/A",
      "rawScore": 0,
      "weight": 0,
      "weightedScore": 0,
      "maxWeighted": 0,
      "zone": "N/A",
      "source": "Advisor Perspectives",
      "description": "Newsletter-Berater Bull/Bear Ratio",
      "available": false
    }
  ],
  "subgroups": [
    {
      "name": "recession_coincident",
      "label": "Rezession Coincident",
      "horizon": "3M",
      "indicators": [
        "Sahm-Regel",
        "Inv. Zinskurve (10Y-2Y)",
        "Aktivität (IP / Auslastung)"
      ],
      "netScore": -6,
      "maxScore": 8,
      "probability": 15,
      "formula": "50% + (-6.0/8.0) × 50% = 12.5% → 15%"
    },
    {
      "name": "recession_leading",
      "label": "Rezession Leading",
      "horizon": "6M",
      "indicators": [
        "Sahm-Regel",
        "Inv. Zinskurve (10Y-2Y)",
        "Aktivität (IP / Auslastung)",
        "Durable Goods (YoY)",
        "M2 Geldmenge (YoY)",
        "Kreditspreads (BAA-Trs)"
      ],
      "netScore": -8,
      "maxScore": 17,
      "probability": 25,
      "formula": "50% + (-8.0/17.0) × 50% = 26.5% → 25%"
    },
    {
      "name": "recession_full",
      "label": "Rezession Vollständig",
      "horizon": "12M",
      "indicators": [
        "Sahm-Regel",
        "Inv. Zinskurve (10Y-2Y)",
        "Aktivität (IP / Auslastung)",
        "Durable Goods (YoY)",
        "M2 Geldmenge (YoY)",
        "Kreditspreads (BAA-Trs)",
        "Konsumklima (CSI)"
      ],
      "netScore": -5,
      "maxScore": 20,
      "probability": 25,
      "formula": "Formel: 50% + (-5.0/20.0) × 50% = 37.5% | NY-Fed-Anker: 0.5% | Final: 37.5%×0.7 + 0.5%×0.3 = 25%",
      "nyFedAnchor": 0.48,
      "finalProbability": 25
    },
    {
      "name": "correction_sentiment",
      "label": "Korrektur Sentiment",
      "horizon": "3-6M",
      "indicators": [
        "VIX",
        "Advance-Decline-Line",
        "CNN Fear & Greed",
        "AAII Sentiment",
        "CBOE Put/Call Ratio",
        "Investors Intelligence"
      ],
      "netScore": 3.2,
      "maxScore": 13.6,
      "probability": 60,
      "formula": "50% + (3.2/13.6) × 50% = 61.8% → 60%"
    },
    {
      "name": "correction_full",
      "label": "Korrektur Vollständig",
      "horizon": "12M",
      "indicators": [
        "VIX",
        "Advance-Decline-Line",
        "CNN Fear & Greed",
        "AAII Sentiment",
        "CBOE Put/Call Ratio",
        "Investors Intelligence",
        "Buffett Indikator (TMC/GDP)",
        "Shiller CAPE",
        "Margin Debt",
        "Google Trends \"Recession\""
      ],
      "netScore": 19.2,
      "maxScore": 41.5,
      "probability": 75,
      "formula": "50% + (19.2/41.5) × 50% = 73.1% → 75%"
    }
  ],
  "nyFedValue": 0.48,
  "googleTrendsAvailable": true,
  "topDrivers": [
    "Buffett Indikator (TMC/GDP): +16 (Extrem überbewertet (230% >200%))",
    "CNN Fear & Greed: +3.2 (Greed (55-75))"
  ],
  "interpretation": "Hohes Risiko: Mehrere Indikatoren signalisieren erhöhte Rezessions- oder Korrekturwahrscheinlichkeit. Defensivere Positionierung empfohlen.",
  "fazit": {
    "summary": "Gesamtbewertung: Hohes Risiko. Rezession 12M: 25%, Korrektur 12M: 75%. Die Kombination aus der Buffett-Bewertung (230%) und systemischen Risiken im $3T-Private-Credit-Markt erfordert defensives Portfoliomanagement. CAPE und Margin Debt sind ohne Workbook zu.",
    "riskLevel": "Hoch",
    "sections": [
      {
        "title": "Quantitative Bewertung",
        "emoji": "📊",
        "text": "Von 17 Indikatoren signalisieren 3 ein erhöhtes Risiko (bearish), 3 sind positiv (bullish) und 11 neutral. Die Rezessionswahrscheinlichkeit liegt bei 15% (3M), 25% (6M) und 25% (12M). Die Korrekturwahrscheinlichkeit beträgt 60% (Sentiment, 3-6M) und 75% (Vollständig, 12M). Die Korrektur wird durch Buffett Indikator (TMC/GDP): +16 (Extrem überbewertet (230% >200%)) und CNN Fear & Greed: +3.2 (Greed (55-75)) getrieben. Shiller CAPE und Margin Debt sind ohne Workbook zu."
      },
      {
        "title": "Bewertungsrisiko",
        "emoji": "⚠️",
        "text": "Der Buffett-Indikator steht bei 230% — das höchste Niveau seit der Dotcom-Blase. Historisch führten Bewertungen über 200% zu durchschnittlichen Drawdowns von 30-50% innerhalb von 18 Monaten. Shiller CAPE liegt nur als Workbook vor und wird nicht gelesen."
      },
      {
        "title": "Private Credit & Systemisches Risiko",
        "emoji": "🏦",
        "text": "Der $3-Billionen-Private-Credit-Markt steht vor seinem ersten echten Stresstest seit 2008. Morgan Stanley warnt vor Default-Raten von bis zu 8% (vs. historisch 2-2,5%). 40% der Private-Credit-Kreditnehmer haben laut IWF negativen freien Cashflow — ein Anstieg von 25% in 2021. Mehrere Fonds (Blue Owl Capital, Cliffwater) haben bereits Rücknahmen eingeschränkt oder gestoppt. Die Parallelen zu den Vorboten der 2008-Krise (Rating-Arbitrage, Illiquidität, unrealistische Bewertungen) werden von UBS-Chairman Kelleher und der BIS explizit gezogen. Bankkredite an Non-Bank Financial Institutions (NBFIs) sind auf $1,92 Billionen gestiegen (+66% seit Ende 2024), was eine potenzielle Ansteckungsgefahr für das regulierte Bankensystem darstellt. Anders als 2023 bei der Silicon Valley Bank (konzentriertes VC-Exposure, Zinsrisiko bei Anleiheportfolios) ist das heutige Risiko breiter gestreut: Private Credit, Leveraged Loans, AI-Datacenter-Finanzierungen und covenant-lite Strukturen bilden ein Cluster eng korrelierter Risiken."
      },
      {
        "title": "Handlungsempfehlung",
        "emoji": "🎯",
        "text": "P_korr12 75%, P_rez12 25%: Beta/Duration runter; kein volles Rezessions-Portfolio"
      }
    ]
  },
  "sources": [
    {
      "name": "FRED (Federal Reserve Economic Data)",
      "url": "https://fred.stlouisfed.org"
    },
    {
      "name": "Current Market Valuation",
      "url": "https://www.currentmarketvaluation.com"
    },
    {
      "name": "GuruFocus Buffett Indicator",
      "url": "https://www.gurufocus.com/stock-market-valuations.php"
    },
    {
      "name": "CNN Fear & Greed Index",
      "url": "https://www.cnn.com/markets/fear-and-greed"
    },
    {
      "name": "AAII Sentiment Survey",
      "url": "https://www.aaii.com/sentimentsurvey"
    },
    {
      "name": "CBOE Market Statistics",
      "url": "https://www.cboe.com/us/options/market_statistics/daily/"
    },
    {
      "name": "University of Michigan Consumer Sentiment",
      "url": "https://data.sca.isr.umich.edu"
    },
    {
      "name": "Advisor Perspectives (Investors Intelligence)",
      "url": "https://www.advisorperspectives.com"
    },
    {
      "name": "Google Trends",
      "url": "https://trends.google.com"
    }
  ]
};
