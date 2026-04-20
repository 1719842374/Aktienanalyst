// Auto-generated fallback data for static deployment
// Generated: 2026-04-20
// Indicators: 17/17 with data
export const RECESSION_FALLBACK_DATA = {
  "date": "20.04.2026",
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
      "name": "PMI (Mfg+Serv Ø)",
      "group": "recession",
      "subgroup": "coincident",
      "value": "53.4 (Mfg: 52.8, Svc: 54.0)",
      "rawScore": -3,
      "weight": 1,
      "weightedScore": -3,
      "maxWeighted": 3,
      "zone": "Expansion (≥45)",
      "source": "ISM / Finance API",
      "description": "Durchschnitt ISM Manufacturing + Services PMI"
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
      "value": "40.4",
      "rawScore": 7,
      "weight": 1.8,
      "weightedScore": 12.6,
      "maxWeighted": 12.6,
      "zone": "Extrem hoch (40.4 >35)",
      "source": "multpl.com",
      "description": "Cyclically Adjusted Price-to-Earnings Ratio (Shiller PE)"
    },
    {
      "name": "Margin Debt",
      "group": "correction",
      "subgroup": "valuation",
      "value": "$2025T",
      "rawScore": 4,
      "weight": 1,
      "weightedScore": 4,
      "maxWeighted": 4,
      "zone": "Erhöht / Überbewertet",
      "source": "currentmarketvaluation.com",
      "description": "NYSE Margin Debt (Wertpapierkredite)"
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
      "value": "Parallel",
      "rawScore": -2,
      "weight": 1,
      "weightedScore": -2,
      "maxWeighted": 3,
      "zone": "Parallel (AD↑ ≥ Index↑)",
      "source": "NYSE / Finance API",
      "description": "NYSE Advance-Decline-Linie vs. S&P 500 Divergenz"
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
      "value": "Bullish (Proxy)",
      "rawScore": 2,
      "weight": 1,
      "weightedScore": 2,
      "maxWeighted": 4,
      "zone": "Bullish (Sentiment-Proxy)",
      "source": "Finance API (Sentiment-Proxy)",
      "description": "American Association of Individual Investors Sentiment Survey"
    },
    {
      "name": "CBOE Put/Call Ratio",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "Niedrig (Proxy)",
      "rawScore": 2,
      "weight": 1,
      "weightedScore": 2,
      "maxWeighted": 4,
      "zone": "Niedrig (Sentiment-Proxy: Bullish)",
      "source": "Finance API (Sentiment-Proxy)",
      "description": "Equity Put/Call Ratio (Absicherungsindikator)"
    },
    {
      "name": "Investors Intelligence",
      "group": "correction",
      "subgroup": "sentiment",
      "value": "Bullish (Proxy)",
      "rawScore": 2,
      "weight": 1,
      "weightedScore": 2,
      "maxWeighted": 4,
      "zone": "Optimistisch (Sentiment-Proxy)",
      "source": "Finance API (Sentiment-Proxy)",
      "description": "Newsletter-Berater Bull/Bear Ratio"
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
        "PMI (Mfg+Serv Ø)"
      ],
      "netScore": -9,
      "maxScore": 11,
      "probability": 10,
      "formula": "50% + (-9.0/11.0) × 50% = 9.1% → 10%"
    },
    {
      "name": "recession_leading",
      "label": "Rezession Leading",
      "horizon": "6M",
      "indicators": [
        "Sahm-Regel",
        "Inv. Zinskurve (10Y-2Y)",
        "PMI (Mfg+Serv Ø)",
        "Durable Goods (YoY)",
        "M2 Geldmenge (YoY)",
        "Kreditspreads (BAA-Trs)"
      ],
      "netScore": -11,
      "maxScore": 20,
      "probability": 20,
      "formula": "50% + (-11.0/20.0) × 50% = 22.5% → 20%"
    },
    {
      "name": "recession_full",
      "label": "Rezession Vollständig",
      "horizon": "12M",
      "indicators": [
        "Sahm-Regel",
        "Inv. Zinskurve (10Y-2Y)",
        "PMI (Mfg+Serv Ø)",
        "Durable Goods (YoY)",
        "M2 Geldmenge (YoY)",
        "Kreditspreads (BAA-Trs)",
        "Konsumklima (CSI)"
      ],
      "netScore": -8,
      "maxScore": 23,
      "probability": 25,
      "formula": "Formel: 50% + (-8.0/23.0) × 50% = 32.6% | NY-Fed-Anker: 4.8% | Final: 32.6%×0.7 + 4.8%×0.3 = 25%",
      "nyFedAnchor": 4.8,
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
      "netScore": 7.2,
      "maxScore": 28.6,
      "probability": 65,
      "formula": "50% + (7.2/28.6) × 50% = 62.6% → 65%"
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
      "netScore": 39.8,
      "maxScore": 73.1,
      "probability": 75,
      "formula": "50% + (39.8/73.1) × 50% = 77.2% → 75%"
    }
  ],
  "nyFedValue": 0.48,
  "googleTrendsAvailable": true,
  "topDrivers": [
    "Buffett Indikator (TMC/GDP): +16 (Extrem überbewertet (230% >200%))",
    "Shiller CAPE: +12.6 (Extrem hoch (40.4 >35))",
    "Margin Debt: +4 (Erhöht / Überbewertet)"
  ],
  "interpretation": "Hohes Risiko: Mehrere Indikatoren signalisieren erhöhte Rezessions- oder Korrekturwahrscheinlichkeit. Defensivere Positionierung empfohlen.",
  "fazit": {
    "summary": "Gesamtbewertung: Hoches Risiko. Rezession 12M: 25%, Korrektur 12M: 75%. Die Kombination aus historisch extremen Bewertungen (Buffett 230%, CAPE 40.4), dem Iran/Hormuz-Ölpreisschock mit Stagflationspotenzial, und systemischen Risiken im $3T-Private-Credit-Markt bildet ein Dreifach-Risiko-Cluster, das defensives Portfoliomanagement erfordert.",
    "riskLevel": "Hoch",
    "sections": [
      {
        "title": "Quantitative Bewertung",
        "emoji": "📊",
        "text": "Von 17 Indikatoren signalisieren 8 ein erhöhtes Risiko (bearish), 5 sind positiv (bullish) und 4 neutral. Die Rezessionswahrscheinlichkeit liegt bei 10% (3M), 20% (6M) und 25% (12M). Die Korrekturwahrscheinlichkeit beträgt 65% (Sentiment, 3-6M) und 75% (Vollständig, 12M). Die hohe Korrekturwahrscheinlichkeit von 75% wird maßgeblich durch extreme Bewertungsniveaus getrieben: Buffett Indikator (TMC/GDP): +16 (Extrem überbewertet (230% >200%)); Shiller CAPE: +12.6 (Extrem hoch (40.4 >35)); Margin Debt: +4 (Erhöht / Überbewertet)."
      },
      {
        "title": "Bewertungsrisiko",
        "emoji": "⚠️",
        "text": "Der Buffett-Indikator steht bei 230% — das höchste Niveau seit der Dotcom-Blase. Historisch führten Bewertungen über 200% zu durchschnittlichen Drawdowns von 30-50% innerhalb von 18 Monaten. Das Shiller CAPE-Ratio von 40.4 liegt über dem Durchschnitt der letzten 140 Jahre (ca. 17) und signalisiert, dass zukünftige Aktienrenditen (10J) mit hoher Wahrscheinlichkeit unterdurchschnittlich ausfallen. Die NYSE Margin Debt ($2025T) zeigt erhöhte Hebelwirkung im Markt — ein klassischer Vorlauf-Indikator für abrupte Sell-Offs."
      },
      {
        "title": "Geopolitik & Makro: Iran/Hormuz, Inflation, Zinsen",
        "emoji": "🌍",
        "text": "Die Sperrung der Straße von Hormuz durch den Iran-Konflikt stellt den gravierendsten exogenen Schock dar. Rund 20% der globalen Ölversorgung und ein Fünftel des weltweiten LNG-Handels fließen durch diese Meerenge. Die Dallas Fed schätzt einen WTI-Ölpreis von $98-132/Barrel bei andauernder Sperrung, mit einem BIP-Wachstumsrückgang von bis zu 2,9 Prozentpunkten. Goldman Sachs rechnet mit einem Inflationsanstieg um ~1 Prozentpunkt und hat die US-Rezessionswahrscheinlichkeit auf 30% angehoben. Die Fed steht vor einem Stagflations-Dilemma: Zinssenkungen würden die Inflation anheizen, Zinserhöhungen die Konjunktur belasten. Natixis prognostiziert, dass die Fed-Funds-Rate bei 3,50-3,75% verharrt, mit einem Bias Richtung \"keine Senkung in 2026\" oder sogar mögliche Zinserhöhungen. Für den Aktienmarkt bedeutet das: Höhere Kapitalmarktzinsen drücken Equity-Bewertungen durch steigende Diskontierungsraten — besonders bei Growth-Aktien mit langer Duration."
      },
      {
        "title": "Private Credit & Systemisches Risiko",
        "emoji": "🏦",
        "text": "Der $3-Billionen-Private-Credit-Markt steht vor seinem ersten echten Stresstest seit 2008. Morgan Stanley warnt vor Default-Raten von bis zu 8% (vs. historisch 2-2,5%). 40% der Private-Credit-Kreditnehmer haben laut IWF negativen freien Cashflow — ein Anstieg von 25% in 2021. Mehrere Fonds (Blue Owl Capital, Cliffwater) haben bereits Rücknahmen eingeschränkt oder gestoppt. Die Parallelen zu den Vorboten der 2008-Krise (Rating-Arbitrage, Illiquidität, unrealistische Bewertungen) werden von UBS-Chairman Kelleher und der BIS explizit gezogen. Bankkredite an Non-Bank Financial Institutions (NBFIs) sind auf $1,92 Billionen gestiegen (+66% seit Ende 2024), was eine potenzielle Ansteckungsgefahr für das regulierte Bankensystem darstellt. Anders als 2023 bei der Silicon Valley Bank (konzentriertes VC-Exposure, Zinsrisiko bei Anleiheportfolios) ist das heutige Risiko breiter gestreut: Private Credit, Leveraged Loans, AI-Datacenter-Finanzierungen und covenant-lite Strukturen bilden ein Cluster eng korrelierter Risiken."
      },
      {
        "title": "Handlungsempfehlung",
        "emoji": "🎯",
        "text": "Angesichts einer Korrekturwahrscheinlichkeit von 75% und einer Rezessionswahrscheinlichkeit von 25% empfiehlt sich eine defensive Positionierung: (1) Reduktion der Aktienquote zugunsten von Cash und kurzlaufenden Staatsanleihen. (2) Underweight bei Growth/Tech zugunsten von Value und defensiven Sektoren (Healthcare, Utilities, Consumer Staples). (3) Goldallokation als Absicherung gegen Stagflation und geopolitisches Risiko. (4) Kritische Prüfung von Private-Credit-Exposure — Liquiditätsrisiken werden in Stressphasen typischerweise unterschätzt. (5) VIX-Hedge (Optionen, VIX-Calls) bei VIX unter 25 als günstige Absicherung."
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
      "name": "ISM Reports",
      "url": "https://www.ismworld.org"
    },
    {
      "name": "University of Michigan Consumer Sentiment",
      "url": "https://data.sca.isr.umich.edu"
    },
    {
      "name": "Multpl.com (Shiller CAPE)",
      "url": "https://www.multpl.com/shiller-pe"
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
