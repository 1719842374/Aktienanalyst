/**
 * Full Makro-Korrelationsmatrix (Aktienanalyst §15).
 *
 * Ported verbatim from commit 1b386991c2c226ff0e12197bbcc84adca64f27ad
 * (`server/routes.ts`, `generateMacroCorrelations`). Sector/industry
 * heuristics and conditional assets (NatGas, Lithium, CNY, JPY, …) are
 * unchanged.
 */
import type { MacroCorrelation, MacroCorrelations } from "../shared/schema";

export function generateMacroCorrelations(
  sector: string, industry: string, description: string,
  beta: number, reportedCurrency: string
): MacroCorrelations {
  const s = sector.toLowerCase();
  const ind = industry.toLowerCase();
  const desc = description.toLowerCase();
  const correlations: MacroCorrelation[] = [];

  const isDefense = ind.includes("defense") || ind.includes("aerospace") || desc.includes("defense") || desc.includes("military");
  const isTech = s.includes("tech");
  const isEnergy = s.includes("energy");
  const isBank = ind.includes("bank") || s.includes("financ");
  const isRealEstate = s.includes("real estate");
  const isConsumer = s.includes("consumer");
  const isIndustrial = s.includes("industrial");
  const isSemiconductor = ind.includes("semicon") || desc.includes("semiconductor") || desc.includes("chip");
  const isCloud = desc.includes("cloud") || desc.includes("aws") || desc.includes("azure");
  const isMining = ind.includes("mining") || ind.includes("metals");
  const isAuto = ind.includes("auto");

  // === INDICES ===
  correlations.push({
    name: "S&P 500",
    category: "Index",
    correlation: "Positiv",
    strength: beta > 1.3 ? "Stark" : beta > 0.7 ? "Moderat" : "Schwach",
    mechanism: `β = ${beta} → Aktie bewegt sich ${beta > 1 ? "überproportional" : "unterproportional"} mit dem Gesamtmarkt. ${beta > 1.3 ? "Hohe Sensitivität bei Markteinbrüchen (Risk-on/off)." : "Moderate Markt-Korrelation."}`,
  });

  correlations.push({
    name: "NASDAQ 100",
    category: "Index",
    correlation: isTech || isSemiconductor || isCloud ? "Positiv" : "Neutral",
    strength: isTech ? "Stark" : "Moderat",
    mechanism: isTech
      ? "Tech-Aktie korreliert stark mit NASDAQ-Momentum. Growth-Rotation und Multiple-Expansion/-Compression wirken direkt."
      : "Moderate Korrelation über allgemeine Risk-on/off-Dynamik. Kein direkter Tech-Index-Treiber.",
  });

  if (isIndustrial || isAuto || isDefense) {
    correlations.push({
      name: "DAX / Euro Stoxx 50",
      category: "Index",
      correlation: "Positiv",
      strength: "Moderat",
      mechanism: "Industrieaktien korrelieren mit europäischer Konjunktur und Exportnachfrage. PMI-Eurozone als Vorlaufindikator.",
    });
  }

  if (desc.includes("china") || desc.includes("asia") || isSemiconductor) {
    correlations.push({
      name: "Hang Seng / CSI 300",
      category: "Index",
      correlation: "Positiv",
      strength: "Moderat",
      mechanism: "China-Exposure über Absatzmärkte oder Lieferketten. Chinesische Stimulus-Maßnahmen wirken als indirekter Kurstreiber.",
    });
  }

  // VIX (inverse for most stocks)
  correlations.push({
    name: "VIX (Volatilitätsindex)",
    category: "Index",
    correlation: "Invers",
    strength: beta > 1.2 ? "Stark" : "Moderat",
    mechanism: `VIX-Spikes signalisieren Risk-off → Abverkauf von Growth/Cyclicals. β=${beta} verstärkt den Effekt. VIX > 30 historisch mit -${Math.round(10 + beta * 8)}% bis -${Math.round(20 + beta * 10)}% Drawdown korreliert.`,
  });

  // === MACRO INDICATORS ===
  correlations.push({
    name: "ISM Manufacturing PMI",
    category: "Macro-Indikator",
    correlation: isIndustrial || isAuto || isSemiconductor ? "Positiv" : isBank ? "Positiv" : isTech && isCloud ? "Neutral" : "Positiv",
    strength: isIndustrial || isSemiconductor ? "Stark" : isTech && isCloud ? "Schwach" : "Moderat",
    mechanism: isIndustrial
      ? "PMI > 50 = Expansion → steigende Auftragseingänge und Capex-Zyklen treiben Industrieaktien direkt."
      : isTech && isCloud
      ? "Cloud/Software-Spending teils unabhängig von Manufacturing PMI. Korrelation über Gesamtkonjunktur aber vorhanden."
      : "PMI als Vorlaufindikator für Konjunktur. PMI-Einbrüche unter 48 signalisieren Rezessionsrisiko für alle Sektoren.",
  });

  correlations.push({
    name: "US 10Y Treasury Yield",
    category: "Macro-Indikator",
    correlation: isTech ? "Invers" : isBank ? "Positiv" : isRealEstate ? "Invers" : "Invers",
    strength: isTech || isRealEstate || isBank ? "Stark" : "Moderat",
    mechanism: isTech
      ? "Steigende Zinsen komprimieren Growth-Multiples (DCF-Diskontierung). 10Y Yield +100bps → ca. -10-15% auf Tech-Bewertungen."
      : isBank
      ? "Höhere Langfristzinsen erweitern Nettozinsmarge (NIM) → direkte EPS-Steigerung. Positiver Effekt bei normaler Zinsstrukturkurve."
      : isRealEstate
      ? "Immobilien-Finanzierungskosten steigen direkt mit 10Y Yield. Cap Rates müssen adjustieren → Bewertungsdruck."
      : "Höhere Zinsen erhöhen WACC und komprimieren Equity-Bewertungen. Moderate Sensitivität bei etablierten Geschäftsmodellen.",
  });

  correlations.push({
    name: "US Consumer Confidence Index",
    category: "Macro-Indikator",
    correlation: isConsumer ? "Positiv" : "Neutral",
    strength: isConsumer ? "Stark" : "Schwach",
    mechanism: isConsumer
      ? "Consumer Confidence direkt korreliert mit diskretionären Ausgaben. Index < 80 historisch mit Retail-Underperformance verbunden."
      : "Indirekter Einfluss über Gesamtkonjunktur. Nicht-Konsumwerte reagieren verzögert und schwächer.",
  });

  correlations.push({
    name: "Fed Funds Rate (Zinserwartungen)",
    category: "Macro-Indikator",
    correlation: isTech || isRealEstate ? "Invers" : isBank ? "Positiv" : "Invers",
    strength: "Stark",
    mechanism: isTech
      ? "Hawkish Fed → höherer Diskontierungssatz → Growth-Derating. Fed-Pivot ist stärkster Einzelkatalysator für Tech-Multiple-Expansion."
      : isBank
      ? "Steigende Kurzfristzinsen erhöhen Deposit-Spreads und NIM. Allerdings: Yield-Curve-Inversion negativ (Kreditrisikoprämie)."
      : "Restriktive Geldpolitik erhöht Kapitalkosten und bremst Investment-Zyklen. Zinssenkungserwartungen wirken als Bewertungshebel.",
  });

  // === COMMODITIES (Energy) ===
  correlations.push({
    name: "WTI Crude Oil (Rohöl)",
    category: "Commodity",
    correlation: isEnergy ? "Positiv" : isAuto || (isConsumer && !ind.includes("stapl")) ? "Invers" : "Neutral",
    strength: isEnergy ? "Stark" : isAuto ? "Moderat" : "Schwach",
    mechanism: isEnergy
      ? "Direkte Umsatz-/Gewinnkorrelation. Rohöl +10% → EBITDA +15-25% bei Upstream-Produzenten. Hedge-Positionen können Korrelation verzögern."
      : isAuto
      ? "Hohe Ölpreise belasten Verbraucher-Budgets und verschieben Kaufentscheidungen. EV-Nachfrage profitiert aber indirekt."
      : "Moderate indirekte Korrelation über Transport-/Energiekosten. Kein primärer Kurstreiber für diesen Sektor.",
  });

  if (isEnergy || isIndustrial || isMining) {
    correlations.push({
      name: "Natural Gas (Henry Hub)",
      category: "Commodity",
      correlation: isEnergy ? "Positiv" : "Neutral",
      strength: isEnergy ? "Moderat" : "Schwach",
      mechanism: isEnergy
        ? "Gaspreis beeinflusst Utility-/LNG-Einnahmen. Saisonale Schwankungen und Geopolitik (Europa-Abhängigkeit) als Volatilitätstreiber."
        : "Indirekter Kosteneinfluss über Energiepreise. Kein primärer Kurstreiber.",
    });
  }

  // === EDELMETALLE (Precious Metals) ===
  correlations.push({
    name: "Gold (XAU)",
    category: "Edelmetall",
    correlation: isMining && (ind.includes("gold") || desc.includes("gold")) ? "Positiv"
      : isTech || isSemiconductor ? "Invers"
      : isBank ? "Invers"
      : "Neutral",
    strength: isMining && (ind.includes("gold") || desc.includes("gold")) ? "Stark"
      : isTech ? "Moderat"
      : "Schwach",
    mechanism: isMining && (ind.includes("gold") || desc.includes("gold"))
      ? "Direkte Korrelation: Gold-Preis × Fördervolumen = Umsatz. Margenhebelung bei steigenden Preisen (Fixkostendegression)."
      : isTech || isSemiconductor
      ? "Gold als Safe-Haven steigt in Risk-off-Phasen, während Tech-Multiples komprimieren → kurzfristig invers. Gold-Rally signalisiert Inflations-/Rezessionssorgen."
      : isBank
      ? "Gold-Stärke korreliert mit Zinsunsicherheit und Vertrauensverlust ins Finanzsystem → negativ für Banken-Sentiment."
      : "Indirekter Hedge-Indikator: Steigendes Gold signalisiert Risikoaversion und potenzielle Umschichtung aus Aktien.",
  });

  correlations.push({
    name: "Silber (XAG)",
    category: "Edelmetall",
    correlation: isMining ? "Positiv"
      : isIndustrial || isSemiconductor ? "Positiv"
      : isTech ? "Neutral"
      : "Neutral",
    strength: isMining ? "Stark" : isIndustrial || isSemiconductor ? "Moderat" : "Schwach",
    mechanism: isMining
      ? "Silber-Mining direkt an Spotpreis gekoppelt. Hybrides Asset: 50% Industrienachfrage (Solar, Elektronik) + 50% Edelmetall-Nachfrage."
      : isIndustrial || isSemiconductor
      ? "Silber als Industriemetall in Elektronik, Solar-PV und Halbleiterfertigung. Steigende Preise signalisieren Tech-Industrienachfrage."
      : "Silber folgt Gold-Trend mit höherer Volatilität (Gold/Silber-Ratio ~80). Schwächerer Safe-Haven als Gold, stärkerer Konjunkturindikator.",
  });

  // === INDUSTRIEMETALLE ===
  correlations.push({
    name: "Kupfer (Dr. Copper)",
    category: "Industriemetall",
    correlation: isMining || isIndustrial || isAuto ? "Positiv"
      : isRealEstate ? "Positiv"
      : isTech && (desc.includes("data center") || desc.includes("infrastructure")) ? "Positiv"
      : "Neutral",
    strength: isMining ? "Stark" : isIndustrial || isAuto ? "Moderat" : "Schwach",
    mechanism: isMining
      ? "Direkte Korrelation mit Kupfer-Spotpreis. Kupfer +10% → Mining-EBITDA +15-30%. Elektrifizierung und AI-Datacenter treiben Langfristnachfrage."
      : isIndustrial || isAuto
      ? "Kupfer als Konjunkturbarometer (\"Dr. Copper\"). Steigende Preise signalisieren starke Industrienachfrage. EV-Produktion benötigt 3-4x mehr Kupfer als Verbrenner."
      : isRealEstate
      ? "Bauindustrie verbraucht ~30% der globalen Kupferproduktion. Kupferpreis-Rallyes korrelieren mit Immobilien-Boom-Phasen."
      : "Kupfer als globaler Konjunkturindikator. Moderate indirekte Korrelation über Wirtschaftswachstum und Investitionszyklen.",
  });

  correlations.push({
    name: "Aluminium (LME)",
    category: "Industriemetall",
    correlation: isIndustrial || isAuto || isMining ? "Positiv" : "Neutral",
    strength: isMining || isAuto ? "Moderat" : "Schwach",
    mechanism: isIndustrial || isAuto
      ? "Aluminium als Key-Input für Automotive (Leichtbau), Verpackung und Bauwesen. Preisanstieg belastet Margen bei Verarbeitern, stützt Produzenten."
      : isMining
      ? "Aluminium-Preis direkt umsatzrelevant für Basismetall-Miner. Energiekosten (Schmelze) als Preistreiber."
      : "Geringe direkte Korrelation. Aluminium reflektiert globale Industriekonjunktur als Hintergrundindikator.",
  });

  if (isTech || isSemiconductor || isIndustrial || isMining || isAuto || desc.includes("battery") || desc.includes("electric")) {
    correlations.push({
      name: "Lithium (Spodumen-Index)",
      category: "Industriemetall",
      correlation: desc.includes("battery") || desc.includes("electric") || desc.includes("lithium") || desc.includes("ev") ? "Positiv" : isMining ? "Positiv" : "Neutral",
      strength: desc.includes("lithium") || desc.includes("battery") ? "Stark" : isMining ? "Moderat" : "Schwach",
      mechanism: desc.includes("battery") || desc.includes("electric")
        ? "Lithium als Schlüsselrohstoff für Batterietechnologie (EV, ESS). Preis-Volatilität beeinflusst BOM-Kosten und Margenentwicklung."
        : isMining
        ? "Lithium-Produzenten direkt an Spotpreis gekoppelt. Zyklische Überkapazitäten vs. struktureller EV-Nachfragetrend."
        : "Lithium als Indikator für EV/Energiewende-Momentum. Preis-Crashs signalisieren Nachfragesorgen im Green-Tech-Sektor.",
    });
  }

  // === CRYPTO ===
  const isCryptoExposed = desc.includes("crypto") || desc.includes("bitcoin") || desc.includes("blockchain") || desc.includes("mining") && s.includes("financ");
  correlations.push({
    name: "Bitcoin (BTC)",
    category: "Crypto",
    correlation: isCryptoExposed ? "Positiv"
      : isTech || isSemiconductor ? "Positiv"
      : isBank ? "Neutral"
      : "Neutral",
    strength: isCryptoExposed ? "Stark"
      : isTech ? "Moderat"
      : "Schwach",
    mechanism: isCryptoExposed
      ? "Direkte Geschäftsmodell-Korrelation mit Kryptomarkt. BTC-Preis treibt Trading-Volumen, Custody-Gebühren und On-Chain-Aktivität."
      : isTech || isSemiconductor
      ? "BTC als Risk-on-Proxy: Korrelation mit NASDAQ/Tech seit 2020 bei ρ ≈ 0.5-0.7. BTC-Crash signalisiert Liquiditäts-/Risiko-Aversions-Shift. BTC-Rally → positive Stimmung für Wachstumswerte."
      : isBank
      ? "Moderate Korrelation: Krypto-Adoption bringt neue Revenue-Streams (Custody, Trading), aber Regulierungsrisiken. BTC-Crash kann Risk-off auslösen."
      : "BTC als globaler Liquiditäts- und Risikoappetit-Indikator. Korrelation mit Aktienmarkt seit 2020 gestiegen (ρ ≈ 0.3-0.5). BTC-Stärke signalisiert Risk-on-Umfeld.",
  });

  // === WÄHRUNG ===
  correlations.push({
    name: "USD Index (DXY)",
    category: "Währung",
    correlation: isEnergy || isMining ? "Invers" : isTech ? "Invers" : "Neutral",
    strength: isEnergy || isMining ? "Stark" : isTech ? "Moderat" : "Moderat",
    mechanism: isEnergy || isMining
      ? "Rohstoffe in USD gepreist → starker USD drückt Nachfrage und Preise. Inverse Korrelation historisch ρ ≈ -0.6 bis -0.8."
      : isTech
      ? "Starker USD belastet internationale Umsätze (>50% Auslandsanteil bei Big Tech). FX-Translation reduziert berichtete Gewinne."
      : "Starker USD belastet Unternehmen mit hohem Auslandsanteil (Umsatz-Translation). Für US-Binnenwirtschaft weniger relevant.",
  });

  correlations.push({
    name: "EUR/USD",
    category: "Währung",
    correlation: desc.includes("europe") || desc.includes("eu") || reportedCurrency === "EUR" ? "Positiv" : "Neutral",
    strength: reportedCurrency === "EUR" ? "Stark" : desc.includes("europe") ? "Moderat" : "Schwach",
    mechanism: reportedCurrency === "EUR"
      ? `Finanzdaten in EUR gemeldet. EUR-Schwäche vs USD reduziert USD-äquivalente Bewertung. EUR/USD -10% → ca. -10% auf Market Cap in USD.`
      : desc.includes("europe")
      ? "Signifikante Europa-Exposure. EUR-Stärke stützt USD-bewertete Umsätze aus EU-Region. ECB-Zinsentscheide als Treiber."
      : "Indirekter Indikator: EUR/USD reflektiert relative Konjunktur USA vs. Europa. Starker EUR signalisiert europäische Stärke.",
  });

  if (desc.includes("china") || desc.includes("asia") || isSemiconductor || desc.includes("yuan") || desc.includes("renminbi")) {
    correlations.push({
      name: "USD/CNY (Yuan)",
      category: "Währung",
      correlation: "Invers",
      strength: desc.includes("china") ? "Moderat" : "Schwach",
      mechanism: "Yuan-Abwertung signalisiert China-Schwäche und Kapitalabflüsse → negativ für China-exponierte Unternehmen. PBoC-Interventionen als Volatilitätstreiber.",
    });
  }

  if (desc.includes("japan") || desc.includes("yen") || ind.includes("auto")) {
    correlations.push({
      name: "USD/JPY (Yen)",
      category: "Währung",
      correlation: isAuto ? "Positiv" : "Neutral",
      strength: isAuto ? "Moderat" : "Schwach",
      mechanism: isAuto
        ? "Schwacher Yen stärkt japanische Wettbewerber (Toyota, Honda). Yen-Stärke reduziert Wettbewerbsdruck für US/EU-Autobauer."
        : "JPY als Carry-Trade-Währung. Yen-Stärke signalisiert Risk-off (Carry-Trade-Unwind). BOJ-Politik als globaler Volatilitätstreiber.",
    });
  }

  if (reportedCurrency !== "USD" && reportedCurrency !== "EUR") {
    const ccyName = reportedCurrency === "GBP" ? "GBP/USD" : `${reportedCurrency}/USD`;
    correlations.push({
      name: ccyName,
      category: "Währung",
      correlation: "Positiv",
      strength: "Stark",
      mechanism: `Finanzdaten in ${reportedCurrency} gemeldet. Währungsabwertung vs USD reduziert USD-äquivalente Gewinne. FX-Hedging kann Effekt mildern.`,
    });
  }

  // Determine overall macro sensitivity
  const strongCount = correlations.filter(c => c.strength === "Stark").length;
  const overallMacroSensitivity: "Hoch" | "Mittel" | "Niedrig" =
    strongCount >= 5 ? "Hoch" : strongCount >= 3 ? "Mittel" : "Niedrig";

  // Key insight
  const primaryCorr = correlations.find(c => c.strength === "Stark" && c.category === "Macro-Indikator") ||
    correlations.find(c => c.strength === "Stark");
  const keyInsight = primaryCorr
    ? `Primärer Makro-Treiber: ${primaryCorr.name} (${primaryCorr.correlation}, ${primaryCorr.strength}). ${primaryCorr.mechanism.split(".")[0]}.`
    : "Moderate Makro-Sensitivität – kein einzelner Indikator dominiert die Kursentwicklung.";

  return { correlations, overallMacroSensitivity, keyInsight };
}
