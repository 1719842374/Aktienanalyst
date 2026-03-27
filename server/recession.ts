import type { Express } from "express";
import { execSync } from "child_process";

// === Finance API Helper (reused pattern from routes.ts) ===
function callFinanceTool(toolName: string, args: Record<string, any>): any {
  try {
    const params = JSON.stringify({ source_id: "finance", tool_name: toolName, arguments: args });
    const escaped = params.replace(/'/g, "'\\''");
    const result = execSync(`external-tool call '${escaped}'`, {
      timeout: 60000,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch (err: any) {
    console.error(`Finance API error (${toolName}):`, err?.message?.substring(0, 300));
    return null;
  }
}

function fetchUrl(url: string, timeoutMs = 30000): string {
  try {
    return execSync(`curl -sL --max-time ${Math.floor(timeoutMs / 1000)} "${url}"`, {
      encoding: "utf-8",
      timeout: timeoutMs + 5000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

function parseNumber(s: string | undefined | null): number {
  if (!s) return NaN;
  let cleaned = s.replace(/,/g, "").replace(/\$/g, "").replace(/%/g, "").trim();
  let multiplier = 1;
  if (/[Tt]$/.test(cleaned)) { multiplier = 1e12; cleaned = cleaned.slice(0, -1); }
  else if (/[Bb]$/.test(cleaned)) { multiplier = 1e9; cleaned = cleaned.slice(0, -1); }
  else if (/[Mm]$/.test(cleaned)) { multiplier = 1e6; cleaned = cleaned.slice(0, -1); }
  else if (/[Kk]$/.test(cleaned)) { multiplier = 1e3; cleaned = cleaned.slice(0, -1); }
  const n = parseFloat(cleaned);
  return isNaN(n) ? NaN : n * multiplier;
}

// ============================================================
// Data-fetching helpers
// ============================================================

interface FredObs { date: string; value: string }

function fetchFredSeries(seriesId: string, limit = 12): FredObs[] {
  // Use FRED CSV download endpoint (no API key needed for small requests)
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${getDateNMonthsAgo(24)}`;
  const csv = fetchUrl(url);
  if (!csv) return [];
  const lines = csv.trim().split("\n").slice(1); // skip header
  return lines.map(line => {
    const [date, value] = line.split(",");
    return { date: date?.trim(), value: value?.trim() };
  }).filter(o => o.value && o.value !== ".");
}

function getDateNMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split("T")[0];
}

function getLatestFredValue(seriesId: string): number {
  const obs = fetchFredSeries(seriesId, 6);
  if (obs.length === 0) return NaN;
  return parseFloat(obs[obs.length - 1].value);
}

// ============================================================
// Indicator scoring functions (methodology-compliant)
// ============================================================

export interface IndicatorResult {
  name: string;
  group: "recession" | "correction";
  subgroup: string;
  value: string;
  rawScore: number;
  weight: number;
  weightedScore: number;
  maxWeighted: number;
  zone: string;
  source: string;
  description: string;
}

// 1. Sahm Rule
function scoreSahm(): IndicatorResult {
  // SAHMREALTIME series from FRED
  const val = getLatestFredValue("SAHMREALTIME");
  const triggered = !isNaN(val) && val >= 0.5;
  const rawScore = triggered ? 4 : -3;
  return {
    name: "Sahm-Regel",
    group: "recession",
    subgroup: "coincident",
    value: isNaN(val) ? "N/A" : `${val.toFixed(2)} pp`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 4,
    zone: triggered ? "Ausgelöst (≥0.5pp)" : "Normal (<0.5pp)",
    source: "FRED SAHMREALTIME",
    description: "3-Monats-Durchschnitt der Arbeitslosenquote vs. 12-Monats-Tief",
  };
}

// 2. Inverted Yield Curve (10Y - 2Y)
function scoreYieldCurve(): IndicatorResult {
  const val = getLatestFredValue("T10Y2Y");
  const inverted = !isNaN(val) && val < 0;
  const rawScore = inverted ? 4 : -3;
  return {
    name: "Inv. Zinskurve (10Y-2Y)",
    group: "recession",
    subgroup: "coincident",
    value: isNaN(val) ? "N/A" : `${val.toFixed(2)}%`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 4,
    zone: inverted ? "Invertiert (<0)" : "Normal (≥0)",
    source: "FRED T10Y2Y",
    description: "Spread zwischen 10-Jahres- und 2-Jahres-US-Staatsanleihen",
  };
}

// 3. PMI (Manufacturing + Services avg)
function scorePMI(): IndicatorResult {
  // Use ISM Manufacturing PMI from FRED (MANEMP or NAPM)
  const mfg = getLatestFredValue("MANEMP"); // ISM Mfg Employment (proxy)
  // Try direct PMI - use finance tool for more reliable data
  let pmiVal = NaN;
  try {
    const ecoData = callFinanceTool("finance_economic_data", {
      indicator: "ISM Manufacturing PMI",
      query: "Latest US ISM Manufacturing PMI and Services PMI",
    });
    if (ecoData?.content) {
      const match = ecoData.content.match(/(?:PMI|Manufacturing)[\s\S]*?(\d{2}\.?\d*)/i);
      if (match) pmiVal = parseFloat(match[1]);
    }
  } catch {}

  // If no data, use FRED NAPM composite
  if (isNaN(pmiVal)) {
    pmiVal = getLatestFredValue("NAPM");
  }

  const below45 = !isNaN(pmiVal) && pmiVal < 45;
  const rawScore = below45 ? 3 : -3;
  return {
    name: "PMI (Mfg+Serv Ø)",
    group: "recession",
    subgroup: "coincident",
    value: isNaN(pmiVal) ? "N/A" : `${pmiVal.toFixed(1)}`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 3,
    zone: below45 ? "Kontraktion (<45)" : "Expansion (≥45)",
    source: "ISM / FRED NAPM",
    description: "Durchschnitt ISM Manufacturing + Services PMI",
  };
}

// 4. Durable Goods Orders (YoY)
function scoreDurableGoods(): IndicatorResult {
  // FRED series: DGORDER (Durable Goods New Orders)
  const obs = fetchFredSeries("DGORDER", 24);
  let yoy = NaN;
  if (obs.length >= 13) {
    const latest = parseFloat(obs[obs.length - 1].value);
    const yearAgo = parseFloat(obs[obs.length - 13].value);
    if (!isNaN(latest) && !isNaN(yearAgo) && yearAgo !== 0) {
      yoy = ((latest - yearAgo) / yearAgo) * 100;
    }
  }
  const decline = !isNaN(yoy) && yoy < -5;
  const rawScore = decline ? 3 : -2;
  return {
    name: "Durable Goods (YoY)",
    group: "recession",
    subgroup: "leading",
    value: isNaN(yoy) ? "N/A" : `${yoy.toFixed(1)}%`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 3,
    zone: decline ? "Starker Rückgang (>-5%)" : "Stabil",
    source: "FRED DGORDER",
    description: "Auftragseingang langlebige Güter, Jahr-über-Jahr",
  };
}

// 5. M2 Money Supply Growth (YoY)
function scoreM2(): IndicatorResult {
  // FRED: M2SL
  const obs = fetchFredSeries("M2SL", 24);
  let yoy = NaN;
  if (obs.length >= 13) {
    const latest = parseFloat(obs[obs.length - 1].value);
    const yearAgo = parseFloat(obs[obs.length - 13].value);
    if (!isNaN(latest) && !isNaN(yearAgo) && yearAgo !== 0) {
      yoy = ((latest - yearAgo) / yearAgo) * 100;
    }
  }

  let rawScore = 0;
  let zone = "Neutral (4-10%)";
  if (!isNaN(yoy)) {
    if (yoy < 0) { rawScore = 3; zone = "Kontraktion (<0%)"; }
    else if (yoy < 2) { rawScore = 3; zone = "Sehr niedrig (<2%)"; }
    else if (yoy < 4) { rawScore = 1; zone = "Niedrig (2-4%)"; }
    else if (yoy <= 10) { rawScore = 0; zone = "Normal (4-10%)"; }
    else { rawScore = -2; zone = "Expansiv (>10%)"; }
  }

  return {
    name: "M2 Geldmenge (YoY)",
    group: "recession",
    subgroup: "leading",
    value: isNaN(yoy) ? "N/A" : `${yoy.toFixed(1)}%`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 3,
    zone,
    source: "FRED M2SL",
    description: "US M2-Geldmengenwachstum Jahr-über-Jahr",
  };
}

// 6. Credit Spreads (BAA - 10Y Treasury)
function scoreCreditSpreads(): IndicatorResult {
  const baa = getLatestFredValue("BAA10Y");
  // BAA10Y is already the spread
  let val = baa;
  if (isNaN(val)) {
    // Fallback: compute BAA - GS10
    const baaYield = getLatestFredValue("BAA");
    const gs10 = getLatestFredValue("GS10");
    if (!isNaN(baaYield) && !isNaN(gs10)) {
      val = baaYield - gs10;
    }
  }

  let rawScore = 0;
  let zone = "Normal (1.5-2.0%)";
  if (!isNaN(val)) {
    if (val > 2.5) { rawScore = 3; zone = "Stress (>2.5%)"; }
    else if (val >= 2.0) { rawScore = 2; zone = "Erhöht (2.0-2.5%)"; }
    else if (val >= 1.5) { rawScore = 0; zone = "Normal (1.5-2.0%)"; }
    else if (val >= 1.0) { rawScore = -1; zone = "Eng (1.0-1.5%)"; }
    else { rawScore = -2; zone = "Sehr eng (<1.0%)"; }
  }

  return {
    name: "Kreditspreads (BAA-Trs)",
    group: "recession",
    subgroup: "leading",
    value: isNaN(val) ? "N/A" : `${val.toFixed(2)}%`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 3,
    zone,
    source: "FRED BAA10Y",
    description: "Moody's BAA Corporate Bond Spread über 10Y Treasury",
  };
}

// 7. Consumer Confidence (CCI / CSI)
function scoreConsumerConfidence(): IndicatorResult {
  // FRED: UMCSENT (Michigan Consumer Sentiment)
  const csi = getLatestFredValue("UMCSENT");
  const triggered = !isNaN(csi) && csi < 60;
  const rawScore = triggered ? 3 : -2;
  return {
    name: "Konsumklima (CSI)",
    group: "recession",
    subgroup: "full",
    value: isNaN(csi) ? "N/A" : `${csi.toFixed(1)}`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 3,
    zone: triggered ? "Pessimistisch (<60)" : "Normal (≥60)",
    source: "FRED UMCSENT",
    description: "University of Michigan Consumer Sentiment Index",
  };
}

// === CORRECTION INDICATORS ===

// 8. Buffett Indicator (TMC/GDP)
function scoreBuffett(): IndicatorResult {
  // Try to get from web
  let ratio = NaN;
  let source = "GuruFocus";
  try {
    const html = fetchUrl("https://www.gurufocus.com/stock-market-valuations.php");
    if (html) {
      // Look for "Total Market Index / GDP" or "Buffett Indicator"
      const match = html.match(/(?:Buffett\s+Indicator|Total\s+Market.*?GDP)[\s\S]*?(\d{2,3}\.?\d*)%/i);
      if (match) ratio = parseFloat(match[1]);
    }
  } catch {}

  // Fallback: FRED WILSHIRE/GDP
  if (isNaN(ratio)) {
    const wilshire = getLatestFredValue("WILL5000IND");
    const gdp = getLatestFredValue("GDP");
    if (!isNaN(wilshire) && !isNaN(gdp) && gdp > 0) {
      // Wilshire 5000 index * scaling factor / GDP
      ratio = (wilshire * 1e8 / (gdp * 1e9)) * 100;
    }
    source = "FRED WILL5000IND/GDP";
  }

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(ratio)) {
    if (ratio > 200) { rawScore = 8; zone = "Extrem überbewertet (>200%)"; }
    else if (ratio >= 165) { rawScore = 5; zone = "Stark überbewertet (165-200%)"; }
    else if (ratio >= 140) { rawScore = 2; zone = "Überbewertet (140-165%)"; }
    else { rawScore = -4; zone = "Fair/unterbewertet (<140%)"; }
  }

  return {
    name: "Buffett Indikator (TMC/GDP)",
    group: "correction",
    subgroup: "valuation",
    value: isNaN(ratio) ? "N/A" : `${ratio.toFixed(1)}%`,
    rawScore,
    weight: 2,
    weightedScore: rawScore * 2,
    maxWeighted: 16,
    zone,
    source,
    description: "Gesamtmarktkapitalisierung / BIP Verhältnis",
  };
}

// 9. Shiller CAPE
function scoreCAPE(): IndicatorResult {
  let cape = NaN;
  try {
    const html = fetchUrl("https://www.multpl.com/shiller-pe");
    if (html) {
      const match = html.match(/Current\s+Shiller\s+PE\s+Ratio.*?(\d{1,3}\.\d{1,2})/is);
      if (match) cape = parseFloat(match[1]);
    }
  } catch {}

  // Fallback via finance tool
  if (isNaN(cape)) {
    try {
      const data = callFinanceTool("finance_economic_data", {
        indicator: "Shiller PE ratio CAPE",
        query: "Current Shiller CAPE PE ratio S&P 500",
      });
      if (data?.content) {
        const match = data.content.match(/(\d{2,3}\.\d{1,2})/);
        if (match) cape = parseFloat(match[1]);
      }
    } catch {}
  }

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(cape)) {
    if (cape > 35) { rawScore = 7; zone = "Extrem hoch (>35)"; }
    else if (cape >= 30) { rawScore = 3; zone = "Hoch (30-35)"; }
    else if (cape >= 15) { rawScore = 0; zone = "Normal (15-30)"; }
    else { rawScore = -5; zone = "Günstig (<15)"; }
  }

  return {
    name: "Shiller CAPE",
    group: "correction",
    subgroup: "valuation",
    value: isNaN(cape) ? "N/A" : `${cape.toFixed(1)}`,
    rawScore,
    weight: 1.8,
    weightedScore: Math.round(rawScore * 1.8 * 10) / 10,
    maxWeighted: 12.6,
    zone,
    source: "multpl.com",
    description: "Cyclically Adjusted Price-to-Earnings Ratio (Shiller PE)",
  };
}

// 10. Margin Debt
function scoreMarginDebt(): IndicatorResult {
  // FRED does not have margin debt directly. Check FINRA data.
  // We'll try to get it via finance tool
  let elevated = false;
  let valueStr = "N/A";
  let rawScore = -2; // default: not elevated

  try {
    const data = callFinanceTool("finance_economic_data", {
      indicator: "FINRA margin debt",
      query: "Latest US FINRA margin debt level trend",
    });
    if (data?.content) {
      // Look for "record" or "elevated" or "high" keywords
      const content = data.content.toLowerCase();
      if (content.includes("record") || content.includes("all-time high") || content.includes("elevated")) {
        elevated = true;
      }
      // Try to extract a number
      const match = data.content.match(/\$?([\d,.]+)\s*(billion|B)/i);
      if (match) {
        valueStr = `$${match[1]}B`;
      }
    }
  } catch {}

  rawScore = elevated ? 4 : -2;

  return {
    name: "Margin Debt",
    group: "correction",
    subgroup: "valuation",
    value: valueStr,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 4,
    zone: elevated ? "Erhöht / Rekordhoch" : "Normal / Rückläufig",
    source: "FINRA",
    description: "NYSE Margin Debt (Wertpapierkredite)",
  };
}

// 11. Google Trends "Recession"
function scoreGoogleTrends(): IndicatorResult {
  // Google Trends is hard to programmatically fetch without an API.
  // Per methodology: if unavailable, Score 0, max adjusts to 61.2
  let trendValue = NaN;
  let rawScore = 0;
  let zone = "N/A (Daten nicht verfügbar)";

  // Try fetching Google Trends via their exploration URL (often blocked)
  // Fallback: FRED proxy via JTSJOL or UMCSENT
  // Per methodology rule: Score 0 if all fail

  return {
    name: "Google Trends \"Recession\"",
    group: "correction",
    subgroup: "sentiment_ext",
    value: isNaN(trendValue) ? "N/A" : `${trendValue}`,
    rawScore,
    weight: 1.7,
    weightedScore: 0,
    maxWeighted: 11.9,
    zone,
    source: "Google Trends (N/A)",
    description: "Google-Suchinteresse für 'Recession' (0-100 Index)",
  };
}

// 12. VIX
function scoreVIX(): IndicatorResult {
  const vix = getLatestFredValue("VIXCLS");
  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(vix)) {
    if (vix > 30) { rawScore = 4; zone = "Panik (>30)"; }
    else if (vix >= 20) { rawScore = 1; zone = "Erhöht (20-30)"; }
    else if (vix >= 15) { rawScore = 0; zone = "Normal (15-20)"; }
    else { rawScore = -3; zone = "Sorglosigkeit (<15)"; }
  }

  return {
    name: "VIX",
    group: "correction",
    subgroup: "sentiment",
    value: isNaN(vix) ? "N/A" : `${vix.toFixed(1)}`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 4,
    zone,
    source: "FRED VIXCLS",
    description: "CBOE Volatility Index (Angstbarometer)",
  };
}

// 13. Advance-Decline Line
function scoreADLine(): IndicatorResult {
  // AD Line divergence analysis - use finance tool
  let rawScore = 0;
  let zone = "Parallel";
  let valueStr = "N/A";

  try {
    const data = callFinanceTool("finance_economic_data", {
      indicator: "NYSE Advance Decline Line breadth",
      query: "S&P 500 advance decline line market breadth divergence 2025 2026",
    });
    if (data?.content) {
      const content = data.content.toLowerCase();
      if (content.includes("divergen") && (content.includes("decline") || content.includes("narrow"))) {
        rawScore = 3;
        zone = "Divergenz (AD↓, Index↑)";
        valueStr = "Divergenz";
      } else if (content.includes("weak") || content.includes("schwäche") || content.includes("narrow")) {
        rawScore = 0;
        zone = "Schwäche (AD↑ < Index↑)";
        valueStr = "Schwäche";
      } else {
        rawScore = -2;
        zone = "Parallel (AD↑ ≥ Index↑)";
        valueStr = "Parallel";
      }
    }
  } catch {}

  return {
    name: "Advance-Decline-Line",
    group: "correction",
    subgroup: "sentiment",
    value: valueStr,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 3,
    zone,
    source: "NYSE / TradingView",
    description: "NYSE Advance-Decline-Linie vs. S&P 500 Divergenz",
  };
}

// 14. CNN Fear & Greed
function scoreCNNFearGreed(): IndicatorResult {
  let fgValue = NaN;
  try {
    // Try fetching CNN Fear & Greed via their API
    const json = fetchUrl("https://production.dataviz.cnn.io/index/fearandgreed/graphdata");
    if (json) {
      const parsed = JSON.parse(json);
      if (parsed?.fear_and_greed?.score) {
        fgValue = parseFloat(parsed.fear_and_greed.score);
      }
    }
  } catch {}

  // Fallback: finance tool
  if (isNaN(fgValue)) {
    try {
      const data = callFinanceTool("finance_economic_data", {
        indicator: "CNN Fear and Greed Index",
        query: "Current CNN Fear and Greed Index value",
      });
      if (data?.content) {
        const match = data.content.match(/(\d{1,3})/);
        if (match) fgValue = parseFloat(match[1]);
      }
    } catch {}
  }

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(fgValue)) {
    if (fgValue < 25) { rawScore = -5; zone = "Extreme Fear (<25)"; }
    else if (fgValue < 45) { rawScore = -2; zone = "Fear (25-45)"; }
    else if (fgValue <= 55) { rawScore = 0; zone = "Neutral (45-55)"; }
    else if (fgValue <= 75) { rawScore = 2; zone = "Greed (55-75)"; }
    else { rawScore = 6; zone = "Extreme Greed (>75)"; }
  }

  return {
    name: "CNN Fear & Greed",
    group: "correction",
    subgroup: "sentiment",
    value: isNaN(fgValue) ? "N/A" : `${Math.round(fgValue)}`,
    rawScore,
    weight: 1.6,
    weightedScore: Math.round(rawScore * 1.6 * 10) / 10,
    maxWeighted: 9.6,
    zone,
    source: "CNN Business",
    description: "CNN Fear & Greed Index (0=Extreme Fear, 100=Extreme Greed)",
  };
}

// 15. AAII Sentiment
function scoreAAII(): IndicatorResult {
  let bullPct = NaN;
  let bearPct = NaN;
  let rawScore = 0;
  let zone = "N/A";
  let valueStr = "N/A";

  try {
    const data = callFinanceTool("finance_economic_data", {
      indicator: "AAII investor sentiment survey",
      query: "Latest AAII sentiment survey bullish bearish percentage",
    });
    if (data?.content) {
      const bullMatch = data.content.match(/bull(?:ish)?[\s:]*(\d{1,3}(?:\.\d)?)/i);
      const bearMatch = data.content.match(/bear(?:ish)?[\s:]*(\d{1,3}(?:\.\d)?)/i);
      if (bullMatch) bullPct = parseFloat(bullMatch[1]);
      if (bearMatch) bearPct = parseFloat(bearMatch[1]);
    }
  } catch {}

  if (!isNaN(bullPct) && !isNaN(bearPct) && bearPct > 0) {
    const ratio = bullPct / bearPct;
    valueStr = `Bull: ${bullPct.toFixed(0)}%, Bear: ${bearPct.toFixed(0)}%`;
    if (ratio > 2) { rawScore = 4; zone = "Extreme Euphorie (Bull/Bear >2)"; }
    else if (ratio < 0.5) { rawScore = -4; zone = "Extreme Angst (Bull/Bear <0.5)"; }
    else { rawScore = 0; zone = "Neutral"; }
  }

  return {
    name: "AAII Sentiment",
    group: "correction",
    subgroup: "sentiment",
    value: valueStr,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 4,
    zone,
    source: "AAII",
    description: "American Association of Individual Investors Sentiment Survey",
  };
}

// 16. CBOE Put/Call Ratio
function scorePutCallRatio(): IndicatorResult {
  let pcr = NaN;

  try {
    const data = callFinanceTool("finance_economic_data", {
      indicator: "CBOE equity put call ratio",
      query: "Latest CBOE equity put/call ratio",
    });
    if (data?.content) {
      const match = data.content.match(/(\d\.\d{1,3})/);
      if (match) pcr = parseFloat(match[1]);
    }
  } catch {}

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(pcr)) {
    if (pcr > 1.0) { rawScore = -4; zone = "Hohe Absicherung (>1.0) → bullish"; }
    else if (pcr < 0.6) { rawScore = 4; zone = "Sorglosigkeit (<0.6) → bearish"; }
    else { rawScore = 0; zone = "Neutral (0.6-1.0)"; }
  }

  return {
    name: "CBOE Put/Call Ratio",
    group: "correction",
    subgroup: "sentiment",
    value: isNaN(pcr) ? "N/A" : `${pcr.toFixed(2)}`,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 4,
    zone,
    source: "CBOE",
    description: "Equity Put/Call Ratio (Absicherungsindikator)",
  };
}

// 17. Investors Intelligence
function scoreInvestorsIntelligence(): IndicatorResult {
  let bullPct = NaN;
  let bearPct = NaN;
  let rawScore = 0;
  let zone = "N/A";
  let valueStr = "N/A";

  try {
    const data = callFinanceTool("finance_economic_data", {
      indicator: "Investors Intelligence bull bear ratio advisors",
      query: "Latest Investors Intelligence bull bear ratio newsletter advisors",
    });
    if (data?.content) {
      const bullMatch = data.content.match(/bull(?:ish)?[\s:]*(\d{1,3}(?:\.\d)?)/i);
      const bearMatch = data.content.match(/bear(?:ish)?[\s:]*(\d{1,3}(?:\.\d)?)/i);
      if (bullMatch) bullPct = parseFloat(bullMatch[1]);
      if (bearMatch) bearPct = parseFloat(bearMatch[1]);
    }
  } catch {}

  if (!isNaN(bullPct) && !isNaN(bearPct) && bearPct > 0) {
    const ratio = bullPct / bearPct;
    valueStr = `Bull: ${bullPct.toFixed(0)}%, Bear: ${bearPct.toFixed(0)}% (Ratio: ${ratio.toFixed(2)})`;
    rawScore = ratio > 1.5 ? 4 : -4;
    zone = ratio > 1.5 ? "Euphorie (Ratio >1.5)" : "Vorsichtig (Ratio ≤1.5)";
  }

  return {
    name: "Investors Intelligence",
    group: "correction",
    subgroup: "sentiment",
    value: valueStr,
    rawScore,
    weight: 1,
    weightedScore: rawScore * 1,
    maxWeighted: 4,
    zone,
    source: "Advisor Perspectives",
    description: "Newsletter-Berater Bull/Bear Ratio",
  };
}

// ============================================================
// NY Fed Recession Probability Anchor
// ============================================================
function getNYFedRecessionProb(): number {
  // FRED: RECPROUSM156N
  const val = getLatestFredValue("RECPROUSM156N");
  return isNaN(val) ? NaN : val;
}

// ============================================================
// Main analysis
// ============================================================

export interface SubgroupResult {
  name: string;
  label: string;
  horizon: string;
  indicators: string[];
  netScore: number;
  maxScore: number;
  probability: number;
  formula: string;
  nyFedAnchor?: number;
  finalProbability?: number;
}

export interface RecessionAnalysis {
  date: string;
  indicators: IndicatorResult[];
  subgroups: SubgroupResult[];
  nyFedValue: number | null;
  googleTrendsAvailable: boolean;
  topDrivers: string[];
  interpretation: string;
  sources: { name: string; url: string }[];
}

function clampAndRound(p: number): number {
  // Clamp to 5%-95%, round to nearest 5%
  const clamped = Math.max(5, Math.min(95, p));
  return Math.round(clamped / 5) * 5;
}

export function runRecessionAnalysis(): RecessionAnalysis {
  console.log("[RECESSION] Starting recession analysis...");

  // Fetch all indicators
  const indicators: IndicatorResult[] = [
    scoreSahm(),
    scoreYieldCurve(),
    scorePMI(),
    scoreDurableGoods(),
    scoreM2(),
    scoreCreditSpreads(),
    scoreConsumerConfidence(),
    scoreBuffett(),
    scoreCAPE(),
    scoreMarginDebt(),
    scoreGoogleTrends(),
    scoreVIX(),
    scoreADLine(),
    scoreCNNFearGreed(),
    scoreAAII(),
    scorePutCallRatio(),
    scoreInvestorsIntelligence(),
  ];

  console.log("[RECESSION] All indicators scored:");
  indicators.forEach(ind => {
    console.log(`  ${ind.name}: ${ind.value} → Score ${ind.weightedScore} (max ${ind.maxWeighted})`);
  });

  const googleAvailable = indicators.find(i => i.name.includes("Google"))?.value !== "N/A";

  // NY Fed
  const nyFedValue = getNYFedRecessionProb();
  console.log(`[RECESSION] NY Fed recession prob: ${nyFedValue}`);

  // Build subgroups per methodology
  // 1. Rezession Coincident (3M): Sahm + Zinskurve + PMI
  const coincidentInds = indicators.filter(i => i.subgroup === "coincident");
  const coincidentNet = coincidentInds.reduce((s, i) => s + i.weightedScore, 0);
  const coincidentMax = coincidentInds.reduce((s, i) => s + i.maxWeighted, 0); // 11

  // 2. Rezession Leading (6M): + Durable + M2 + Kredit
  const leadingInds = indicators.filter(i => i.subgroup === "leading");
  const rezLeadingNet = coincidentNet + leadingInds.reduce((s, i) => s + i.weightedScore, 0);
  const rezLeadingMax = coincidentMax + leadingInds.reduce((s, i) => s + i.maxWeighted, 0); // 20

  // 3. Rezession Vollständig (12M): + Konsumklima
  const fullInds = indicators.filter(i => i.subgroup === "full");
  const rezFullNet = rezLeadingNet + fullInds.reduce((s, i) => s + i.weightedScore, 0);
  const rezFullMax = rezLeadingMax + fullInds.reduce((s, i) => s + i.maxWeighted, 0); // 23

  // 4. Korrektur Sentiment (3-6M): VIX + AD + CNN + AAII + Put/Call + II
  const sentimentInds = indicators.filter(i => i.subgroup === "sentiment");
  const sentimentNet = sentimentInds.reduce((s, i) => s + i.weightedScore, 0);
  const sentimentMax = sentimentInds.reduce((s, i) => s + i.maxWeighted, 0); // 28.6

  // 5. Korrektur Vollständig (12M): + Buffett + CAPE + Margin + Google
  const valuationInds = indicators.filter(i => i.subgroup === "valuation" || i.subgroup === "sentiment_ext");
  const corrFullNet = sentimentNet + valuationInds.reduce((s, i) => s + i.weightedScore, 0);
  const corrFullMaxBase = sentimentMax + valuationInds.reduce((s, i) => s + i.maxWeighted, 0); // 73.1
  const corrFullMax = googleAvailable ? corrFullMaxBase : 61.2; // Adjust if Google N/A

  // Compute probabilities
  const pCoincident = clampAndRound(50 + (coincidentNet / coincidentMax) * 50);
  const pLeading = clampAndRound(50 + (rezLeadingNet / rezLeadingMax) * 50);

  // 12M Recession with NY Fed anchor
  const pRezFormula = 50 + (rezFullNet / rezFullMax) * 50;
  let pRezFull: number;
  let nyFedAnchorPct: number | undefined;
  if (!isNaN(nyFedValue)) {
    nyFedAnchorPct = nyFedValue * 10;
    pRezFull = clampAndRound(pRezFormula * 0.7 + nyFedAnchorPct * 0.3);
  } else {
    pRezFull = clampAndRound(pRezFormula);
  }

  const pSentiment = clampAndRound(50 + (sentimentNet / sentimentMax) * 50);
  const pCorrFull = clampAndRound(50 + (corrFullNet / corrFullMax) * 50);

  const subgroups: SubgroupResult[] = [
    {
      name: "recession_coincident",
      label: "Rezession Coincident",
      horizon: "3M",
      indicators: coincidentInds.map(i => i.name),
      netScore: coincidentNet,
      maxScore: coincidentMax,
      probability: pCoincident,
      formula: `50% + (${coincidentNet}/${coincidentMax}) × 50% = ${(50 + (coincidentNet / coincidentMax) * 50).toFixed(1)}% → ${pCoincident}%`,
    },
    {
      name: "recession_leading",
      label: "Rezession Leading",
      horizon: "6M",
      indicators: [...coincidentInds, ...leadingInds].map(i => i.name),
      netScore: rezLeadingNet,
      maxScore: rezLeadingMax,
      probability: pLeading,
      formula: `50% + (${rezLeadingNet}/${rezLeadingMax}) × 50% = ${(50 + (rezLeadingNet / rezLeadingMax) * 50).toFixed(1)}% → ${pLeading}%`,
    },
    {
      name: "recession_full",
      label: "Rezession Vollständig",
      horizon: "12M",
      indicators: [...coincidentInds, ...leadingInds, ...fullInds].map(i => i.name),
      netScore: rezFullNet,
      maxScore: rezFullMax,
      probability: pRezFull,
      formula: !isNaN(nyFedValue!)
        ? `Formel: 50% + (${rezFullNet}/${rezFullMax}) × 50% = ${pRezFormula.toFixed(1)}% | NY-Fed-Anker: ${nyFedValue! * 10}% | Final: ${pRezFormula.toFixed(1)}%×0.7 + ${nyFedAnchorPct!.toFixed(1)}%×0.3 = ${pRezFull}%`
        : `50% + (${rezFullNet}/${rezFullMax}) × 50% = ${pRezFormula.toFixed(1)}% → ${pRezFull}%`,
      nyFedAnchor: nyFedAnchorPct,
      finalProbability: pRezFull,
    },
    {
      name: "correction_sentiment",
      label: "Korrektur Sentiment",
      horizon: "3-6M",
      indicators: sentimentInds.map(i => i.name),
      netScore: sentimentNet,
      maxScore: sentimentMax,
      probability: pSentiment,
      formula: `50% + (${sentimentNet}/${sentimentMax.toFixed(1)}) × 50% = ${(50 + (sentimentNet / sentimentMax) * 50).toFixed(1)}% → ${pSentiment}%`,
    },
    {
      name: "correction_full",
      label: "Korrektur Vollständig",
      horizon: "12M",
      indicators: [...sentimentInds, ...valuationInds].map(i => i.name),
      netScore: corrFullNet,
      maxScore: corrFullMax,
      probability: pCorrFull,
      formula: `50% + (${corrFullNet.toFixed(1)}/${corrFullMax.toFixed(1)}) × 50% = ${(50 + (corrFullNet / corrFullMax) * 50).toFixed(1)}% → ${pCorrFull}%${!googleAvailable ? " (Google N/A, Max=61.2)" : ""}`,
    },
  ];

  // Top 3 drivers (highest absolute weighted scores)
  const sortedByImpact = [...indicators].sort((a, b) => Math.abs(b.weightedScore) - Math.abs(a.weightedScore));
  const topDrivers = sortedByImpact.slice(0, 3).map(i =>
    `${i.name}: ${i.weightedScore > 0 ? "+" : ""}${i.weightedScore} (${i.zone})`
  );

  // Interpretation
  const maxProb = Math.max(pRezFull, pCorrFull);
  let interpretation: string;
  if (maxProb >= 70) {
    interpretation = "Hohes Risiko: Mehrere Indikatoren signalisieren erhöhte Rezessions- oder Korrekturwahrscheinlichkeit. Defensivere Positionierung empfohlen.";
  } else if (maxProb >= 50) {
    interpretation = "Moderates Risiko: Gemischte Signale. Einzelne Indikatoren zeigen Warnsignale, aber kein breiter Konsens. Selektive Vorsicht geboten.";
  } else if (maxProb >= 30) {
    interpretation = "Niedriges Risiko: Die Mehrheit der Indikatoren signalisiert stabile wirtschaftliche Bedingungen. Standardmäßige Risikomanagement-Maßnahmen ausreichend.";
  } else {
    interpretation = "Sehr niedriges Risiko: Praktisch alle Indikatoren zeigen positive Signale. Marktumfeld begünstigt Risikobereitschaft.";
  }

  const today = new Date().toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  const sources = [
    { name: "FRED (Federal Reserve Economic Data)", url: "https://fred.stlouisfed.org" },
    { name: "GuruFocus Buffett Indicator", url: "https://www.gurufocus.com/stock-market-valuations.php" },
    { name: "CNN Fear & Greed Index", url: "https://www.cnn.com/markets/fear-and-greed" },
    { name: "AAII Sentiment Survey", url: "https://www.aaii.com/sentimentsurvey" },
    { name: "CBOE Market Statistics", url: "https://www.cboe.com/us/options/market_statistics/daily/" },
    { name: "ISM Reports", url: "https://www.ismworld.org" },
    { name: "University of Michigan Consumer Sentiment", url: "https://data.sca.isr.umich.edu" },
    { name: "Multpl.com (Shiller CAPE)", url: "https://www.multpl.com/shiller-pe" },
    { name: "Advisor Perspectives (Investors Intelligence)", url: "https://www.advisorperspectives.com" },
    { name: "Google Trends", url: "https://trends.google.com" },
  ];

  console.log("[RECESSION] Analysis complete.");
  console.log(`[RECESSION] Probabilities: Rez-3M=${pCoincident}%, Rez-6M=${pLeading}%, Rez-12M=${pRezFull}%, Korr-3-6M=${pSentiment}%, Korr-12M=${pCorrFull}%`);

  return {
    date: today,
    indicators,
    subgroups,
    nyFedValue: isNaN(nyFedValue) ? null : nyFedValue,
    googleTrendsAvailable: googleAvailable,
    topDrivers,
    interpretation,
    sources,
  };
}

// ============================================================
// Express route registration
// ============================================================
export function registerRecessionRoutes(app: Express) {
  app.post("/api/analyze-recession", async (_req, res) => {
    try {
      const analysis = runRecessionAnalysis();
      res.json(analysis);
    } catch (error: any) {
      console.error("[RECESSION] Error:", error?.message);
      res.status(500).json({ error: error?.message || "Recession analysis failed" });
    }
  });
}
