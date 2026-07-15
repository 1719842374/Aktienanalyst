import type { Express } from "express";
import { execSync } from "child_process";
import { fetchMacroSnapshot } from "./fmp-macro";

// ============================================================
// Geopolitical Analysis Metadata
// Update quarterly when reviewing the static geopolitical narrative below.
// ============================================================
const GEO_ANALYSIS = { lastUpdated: "April 2026" };

// ============================================================
// Generic Data Helpers
// ============================================================

function fetchUrl(url: string, timeoutMs = 20000, headers: Record<string, string> = {}): string {
  try {
    // No default headers — some servers (FRED) HTTP/2-fail when extra headers
    // are sent. Callers that need a UA pass it explicitly via the headers arg.
    const headerArgs = Object.entries(headers)
      .map(([k, v]) => `-H "${k}: ${v.replace(/"/g, "\\\"")}"`)
      .join(" ");
    return execSync(`curl -sL --max-time ${Math.floor(timeoutMs / 1000)} ${headerArgs} "${url}"`, {
      encoding: "utf-8",
      timeout: timeoutMs + 5000,
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

/** Generic FRED CSV fetcher — returns latest value or NaN */
function getLatestFredValue(seriesId: string): number {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${getDateNMonthsAgo(24)}`;
  const csv = fetchUrl(url);
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return NaN;
  const lines = csv.trim().split("\n").slice(1);
  const validLines = lines.filter(l => {
    const val = l.split(",")[1]?.trim();
    return val && val !== "." && !isNaN(parseFloat(val));
  });
  if (validLines.length === 0) return NaN;
  return parseFloat(validLines[validLines.length - 1].split(",")[1].trim());
}

/** Generic FRED CSV fetcher — returns all observations */
function fetchFredSeries(seriesId: string): { date: string; value: number }[] {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${getDateNMonthsAgo(36)}`;
  const csv = fetchUrl(url);
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const lines = csv.trim().split("\n").slice(1);
  return lines
    .map(line => {
      const [date, valStr] = line.split(",");
      const value = parseFloat(valStr?.trim());
      return { date: date?.trim(), value };
    })
    .filter(o => !isNaN(o.value));
}

function getDateNMonthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().split("T")[0];
}

/** Generic macro data fetcher via FRED (see server/fmp-macro.ts) */
async function getMacroValue(keywords: string[], country = "United States"): Promise<{ value: number; date: string; category: string } | null> {
  try {
    const result = await fetchMacroSnapshot({ countries: [country], keywords });
    if (!result?.content) return null;
    // Parse the markdown table to extract latest_value
    const lines = result.content.split("\n");
    for (const line of lines) {
      if (line.startsWith("|") && !line.includes("country") && !line.includes("---")) {
        const cells = line.split("|").map((c: string) => c.trim()).filter(Boolean);
        if (cells.length >= 4) {
          const category = cells[1];
          const value = parseFloat(cells[2]);
          const date = cells[3];
          if (!isNaN(value)) return { value, date, category };
        }
      }
    }
  } catch {}
  return null;
}

/** Extract first number matching a pattern from HTML */
function extractNumberFromHtml(html: string, pattern: RegExp): number {
  const match = html.match(pattern);
  if (match) return parseFloat(match[1].replace(/,/g, ""));
  return NaN;
}

// ============================================================
// Indicator types
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

// ============================================================
// RECESSION INDICATORS (7)
// ============================================================

// 1. Sahm Rule (FRED: SAHMREALTIME)
function scoreSahm(): IndicatorResult {
  const val = getLatestFredValue("SAHMREALTIME");
  const triggered = !isNaN(val) && val >= 0.5;
  const rawScore = triggered ? 4 : -3;
  return {
    name: "Sahm-Regel",
    group: "recession", subgroup: "coincident",
    value: isNaN(val) ? "N/A" : `${val.toFixed(2)} pp`,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 4,
    zone: triggered ? "Ausgelöst (≥0.5pp)" : "Normal (<0.5pp)",
    source: "FRED SAHMREALTIME",
    description: "3-Monats-Durchschnitt der Arbeitslosenquote vs. 12-Monats-Tief",
  };
}

// 2. Inverted Yield Curve (FRED: T10Y2Y)
function scoreYieldCurve(): IndicatorResult {
  const val = getLatestFredValue("T10Y2Y");
  const inverted = !isNaN(val) && val < 0;
  const rawScore = inverted ? 4 : -3;
  return {
    name: "Inv. Zinskurve (10Y-2Y)",
    group: "recession", subgroup: "coincident",
    value: isNaN(val) ? "N/A" : `${val.toFixed(2)}%`,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 4,
    zone: inverted ? "Invertiert (<0)" : "Normal (≥0)",
    source: "FRED T10Y2Y",
    description: "Spread zwischen 10-Jahres- und 2-Jahres-US-Staatsanleihen",
  };
}

// 3. PMI (Manufacturing + Services average)
async function scorePMI(): Promise<IndicatorResult> {
  // Primary: macro snapshot for Non Manufacturing PMI + Manufacturing proxy
  let mfgPmi = NaN;
  let svcPmi = NaN;

  const svc = await getMacroValue(["Non Manufacturing PMI"]);
  if (svc) svcPmi = svc.value;

  // ISM Manufacturing not directly available — use Chicago PMI as proxy
  const mfg = await getMacroValue(["Chicago PMI"]);
  if (mfg) mfgPmi = mfg.value;

  // Fallback: FRED NAPM (ISM Manufacturing proxy) — series discontinued in 2001, always empty.
  // Kept as a no-op safety net; ISM PMI is proprietary and unavailable via FRED or this FMP plan
  // (verified 2026-07-15: /stable/economic and /stable/economic-indicators both reject "ISM*" names).
  // Result: mfgPmi/svcPmi correctly stay NaN -> valueStr renders "N/A" below, never a fake number.
  if (isNaN(mfgPmi)) {
    mfgPmi = getLatestFredValue("NAPM");
  }

  let avgPmi = NaN;
  let valueStr = "N/A";
  if (!isNaN(mfgPmi) && !isNaN(svcPmi)) {
    avgPmi = (mfgPmi + svcPmi) / 2;
    valueStr = `${avgPmi.toFixed(1)} (Mfg: ${mfgPmi.toFixed(1)}, Svc: ${svcPmi.toFixed(1)})`;
  } else if (!isNaN(svcPmi)) {
    avgPmi = svcPmi;
    valueStr = `${svcPmi.toFixed(1)} (Services)`;
  } else if (!isNaN(mfgPmi)) {
    avgPmi = mfgPmi;
    valueStr = `${mfgPmi.toFixed(1)} (Mfg)`;
  }

  const below45 = !isNaN(avgPmi) && avgPmi < 45;
  const rawScore = below45 ? 3 : -3;
  return {
    name: "PMI (Mfg+Serv Ø)",
    group: "recession", subgroup: "coincident",
    value: valueStr,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 3,
    zone: below45 ? "Kontraktion (<45)" : `Expansion (≥45)`,
    source: "ISM / Finance API",
    description: "Durchschnitt ISM Manufacturing + Services PMI",
  };
}

// 4. Durable Goods Orders (YoY)
function scoreDurableGoods(): IndicatorResult {
  const obs = fetchFredSeries("DGORDER");
  let yoy = NaN;
  if (obs.length >= 13) {
    const latest = obs[obs.length - 1].value;
    const yearAgo = obs[obs.length - 13].value;
    if (yearAgo !== 0) yoy = ((latest - yearAgo) / yearAgo) * 100;
  }
  const decline = !isNaN(yoy) && yoy < -5;
  const rawScore = decline ? 3 : -2;
  return {
    name: "Durable Goods (YoY)",
    group: "recession", subgroup: "leading",
    value: isNaN(yoy) ? "N/A" : `${yoy.toFixed(1)}%`,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 3,
    zone: decline ? "Starker Rückgang (>-5%)" : "Stabil",
    source: "FRED DGORDER",
    description: "Auftragseingang langlebige Güter, Jahr-über-Jahr",
  };
}

// 5. M2 Money Supply Growth (YoY)
function scoreM2(): IndicatorResult {
  const obs = fetchFredSeries("M2SL");
  let yoy = NaN;
  if (obs.length >= 13) {
    const latest = obs[obs.length - 1].value;
    const yearAgo = obs[obs.length - 13].value;
    if (yearAgo !== 0) yoy = ((latest - yearAgo) / yearAgo) * 100;
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
    group: "recession", subgroup: "leading",
    value: isNaN(yoy) ? "N/A" : `${yoy.toFixed(1)}%`,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 3, zone,
    source: "FRED M2SL",
    description: "US M2-Geldmengenwachstum Jahr-über-Jahr",
  };
}

// 6. Credit Spreads (BAA - 10Y Treasury)
function scoreCreditSpreads(): IndicatorResult {
  let val = getLatestFredValue("BAA10Y");
  // Fallback
  if (isNaN(val)) {
    const baa = getLatestFredValue("BAA");
    const gs10 = getLatestFredValue("GS10");
    if (!isNaN(baa) && !isNaN(gs10)) val = baa - gs10;
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
    group: "recession", subgroup: "leading",
    value: isNaN(val) ? "N/A" : `${val.toFixed(2)}%`,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 3, zone,
    source: "FRED BAA10Y",
    description: "Moody's BAA Corporate Bond Spread über 10Y Treasury",
  };
}

// 7. Consumer Confidence (Michigan CSI)
async function scoreConsumerConfidence(): Promise<IndicatorResult> {
  // Primary: macro snapshot
  let csi = NaN;
  let source = "FRED UMCSENT";
  const macro = await getMacroValue(["Consumer Confidence"]);
  if (macro) {
    csi = macro.value;
    source = "U of Michigan";
  }
  // Fallback: FRED
  if (isNaN(csi)) csi = getLatestFredValue("UMCSENT");

  const triggered = !isNaN(csi) && csi < 60;
  const rawScore = triggered ? 3 : -2;
  return {
    name: "Konsumklima (CSI)",
    group: "recession", subgroup: "full",
    value: isNaN(csi) ? "N/A" : `${csi.toFixed(1)}`,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 3,
    zone: triggered ? "Pessimistisch (<60)" : "Normal (≥60)",
    source,
    description: "University of Michigan Consumer Sentiment Index",
  };
}

// ============================================================
// CORRECTION INDICATORS (10)
// ============================================================

// 8. Buffett Indicator (TMC/GDP) — CRITICAL: must be ~200%+ range
function scoreBuffett(): IndicatorResult {
  let ratio = NaN;
  let source = "currentmarketvaluation.com";

  // PRIMARY: Scrape from currentmarketvaluation.com meta description
  try {
    const html = fetchUrl("https://www.currentmarketvaluation.com/models/buffett-indicator.php");
    if (html) {
      // Meta description contains: "calculate the Buffett Indicator as 230%"
      const metaMatch = html.match(/calculate the Buffett Indicator as (\d{2,3})%/i);
      if (metaMatch) {
        ratio = parseFloat(metaMatch[1]);
        console.log(`[RECESSION] Buffett from CMV meta: ${ratio}%`);
      }
      // Fallback: look for the value in page content
      if (isNaN(ratio)) {
        const altMatch = html.match(/Buffett Indicator.*?(\d{3})%/i);
        if (altMatch) ratio = parseFloat(altMatch[1]);
      }
    }
  } catch {}

  // SECONDARY: GuruFocus
  if (isNaN(ratio)) {
    try {
      const html = fetchUrl("https://www.gurufocus.com/stock-market-valuations.php");
      if (html) {
        const match = html.match(/(\d{3})%\s*(?:ratio|of GDP)/i);
        if (match) { ratio = parseFloat(match[1]); source = "GuruFocus"; }
      }
    } catch {}
  }

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(ratio)) {
    if (ratio > 200) { rawScore = 8; zone = `Extrem überbewertet (${ratio.toFixed(0)}% >200%)`; }
    else if (ratio >= 165) { rawScore = 5; zone = `Stark überbewertet (165-200%)`; }
    else if (ratio >= 140) { rawScore = 2; zone = `Überbewertet (140-165%)`; }
    else { rawScore = -4; zone = `Fair/unterbewertet (<140%)`; }
  }

  return {
    name: "Buffett Indikator (TMC/GDP)",
    group: "correction", subgroup: "valuation",
    value: isNaN(ratio) ? "N/A" : `${ratio.toFixed(0)}%`,
    rawScore, weight: 2, weightedScore: rawScore * 2, maxWeighted: 16, zone,
    source,
    description: "Gesamtmarktkapitalisierung / BIP Verhältnis",
  };
}

// 9. Shiller CAPE
function scoreCAPE(): IndicatorResult {
  let cape = NaN;
  let source = "multpl.com";

  // Primary: multpl.com
  try {
    const html = fetchUrl("https://www.multpl.com/shiller-pe");
    if (html) {
      const match = html.match(/Current\s+Shiller\s+PE\s+Ratio.*?(\d{1,3}\.\d{1,2})/is);
      if (match) cape = parseFloat(match[1]);
    }
  } catch {}

  // Fallback: currentmarketvaluation.com
  if (isNaN(cape)) {
    try {
      const html = fetchUrl("https://www.currentmarketvaluation.com/models/price-earnings.php");
      if (html) {
        const match = html.match(/CAPE.*?(\d{2,3}\.\d)/i);
        if (match) { cape = parseFloat(match[1]); source = "currentmarketvaluation.com"; }
      }
    } catch {}
  }

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(cape)) {
    if (cape > 35) { rawScore = 7; zone = `Extrem hoch (${cape.toFixed(1)} >35)`; }
    else if (cape >= 30) { rawScore = 3; zone = `Hoch (30-35)`; }
    else if (cape >= 15) { rawScore = 0; zone = `Normal (15-30)`; }
    else { rawScore = -5; zone = `Günstig (<15)`; }
  }

  return {
    name: "Shiller CAPE",
    group: "correction", subgroup: "valuation",
    value: isNaN(cape) ? "N/A" : `${cape.toFixed(1)}`,
    rawScore, weight: 1.8,
    weightedScore: Math.round(rawScore * 1.8 * 10) / 10,
    maxWeighted: 12.6, zone, source,
    description: "Cyclically Adjusted Price-to-Earnings Ratio (Shiller PE)",
  };
}

// 10. Margin Debt
function scoreMarginDebt(): IndicatorResult {
  let elevated = false;
  let valueStr = "N/A";
  let source = "FINRA";

  // Try currentmarketvaluation.com margin debt page
  try {
    const html = fetchUrl("https://www.currentmarketvaluation.com/models/margin-debt.php");
    if (html) {
      const meta = html.match(/meta name="description" content="([^"]+)"/i);
      if (meta) {
        const content = meta[1].toLowerCase();
        elevated = content.includes("overvalued") || content.includes("elevated") || content.includes("above");
        const valMatch = meta[1].match(/\$?([\d,.]+)\s*(billion|B|trillion|T)/i);
        if (valMatch) {
          valueStr = `$${valMatch[1]}${valMatch[2].charAt(0).toUpperCase()}`;
        }
        source = "currentmarketvaluation.com";
      }
    }
  } catch {}

  const rawScore = elevated ? 4 : -2;
  return {
    name: "Margin Debt",
    group: "correction", subgroup: "valuation",
    value: valueStr,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 4,
    zone: elevated ? "Erhöht / Überbewertet" : "Normal / Rückläufig",
    source,
    description: "NYSE Margin Debt (Wertpapierkredite)",
  };
}

// 11. Google Trends "Recession"
function scoreGoogleTrends(): IndicatorResult {
  let trendValue = NaN;
  let source = "Google Trends";

  // Primary: SerpApi Google Trends (requires SERPAPI_KEY). Without a key we
  // leave trendValue as NaN → indicator reports N/A (never a faked default).
  const serpKey = process.env.SERPAPI_KEY || process.env.SERPAPI_API_KEY || "";
  if (serpKey) {
    try {
      const url = `https://serpapi.com/search.json?engine=google_trends&q=Recession&geo=US&date=now%207-d&data_type=TIMESERIES&api_key=${encodeURIComponent(serpKey)}`;
      const raw = fetchUrl(url, 12000);
      if (raw && !raw.includes("<html")) {
        const parsed = JSON.parse(raw);
        const timeline = parsed?.interest_over_time?.timeline_data;
        if (Array.isArray(timeline) && timeline.length > 0) {
          const values: number[] = [];
          for (const point of timeline) {
            const v = point?.values?.[0]?.extracted_value ?? point?.values?.[0]?.value;
            const num = typeof v === "number" ? v : parseFloat(v);
            if (!isNaN(num)) values.push(num);
          }
          if (values.length > 0) {
            const avg = Math.round((values.reduce((s, n) => s + n, 0) / values.length) * 10) / 10;
            const latest = values[values.length - 1];
            const peak = Math.max(...values);
            trendValue = avg;
            source = `Google Trends via SerpApi (7d Ø=${avg}, Latest=${latest}, Peak=${peak})`;
            console.log(`  Google Trends (SerpApi): avg=${avg}, latest=${latest}, peak=${peak}`);
          }
        }
      }
    } catch (err: any) {
      console.log(`  Google Trends SerpApi failed: ${err?.message?.substring(0, 200)}`);
    }
  } else {
    console.log("  Google Trends: SERPAPI_KEY not set — reporting N/A");
  }

  // Scoring per methodology: Google(0-100): >75:+7 | 60-75:+4 | 30-60:0 | <30:-4
  let rawScore = 0;
  let zone = "N/A (Daten nicht verfügbar)";
  if (!isNaN(trendValue)) {
    if (trendValue > 75) { rawScore = 7; zone = `Extrem hoch (${trendValue} >75) → Panik-Suchen`; }
    else if (trendValue >= 60) { rawScore = 4; zone = `Hoch (${trendValue} 60-75) → Erhöhtes Interesse`; }
    else if (trendValue >= 30) { rawScore = 0; zone = `Normal (${trendValue} 30-60)`; }
    else { rawScore = -4; zone = `Niedrig (${trendValue} <30) → Sorglosigkeit`; }
  }

  return {
    name: "Google Trends \"Recession\"",
    group: "correction", subgroup: "sentiment_ext",
    value: isNaN(trendValue) ? "N/A" : `${trendValue.toFixed(0)} (7d Ø)`,
    rawScore, weight: 1.7,
    weightedScore: Math.round(rawScore * 1.7 * 10) / 10,
    maxWeighted: 11.9, zone,
    source: isNaN(trendValue) ? "Google Trends (N/A)" : source,
    description: "Google-Suchinteresse für 'Recession' (0-100 Index)",
  };
}

// 12. VIX
function scoreVIX(): IndicatorResult {
  // FRED VIXCLS (daily close) — no external finance tool needed.
  let vix = getLatestFredValue("VIXCLS");
  let source = "FRED VIXCLS";

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(vix)) {
    if (vix > 30) { rawScore = 4; zone = `Panik (${vix.toFixed(1)} >30)`; }
    else if (vix >= 20) { rawScore = 1; zone = `Erhöht (20-30)`; }
    else if (vix >= 15) { rawScore = 0; zone = `Normal (15-20)`; }
    else { rawScore = -3; zone = `Sorglosigkeit (<15)`; }
  }

  return {
    name: "VIX",
    group: "correction", subgroup: "sentiment",
    value: isNaN(vix) ? "N/A" : `${vix.toFixed(1)}`,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 4, zone, source,
    description: "CBOE Volatility Index (Angstbarometer)",
  };
}

// 13. Advance-Decline Line
function scoreADLine(): IndicatorResult {
  // No free real-time breadth source — default to parallel/healthy.
  const rawScore = -2; // default: parallel/healthy
  const zone = "Parallel (AD↑ ≥ Index↑)";
  const valueStr = "Parallel";

  return {
    name: "Advance-Decline-Line",
    group: "correction", subgroup: "sentiment",
    value: valueStr,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 3, zone,
    source: "NYSE (Proxy)",
    description: "NYSE Advance-Decline-Linie vs. S&P 500 Divergenz",
  };
}

// 14. CNN Fear & Greed Index
function scoreCNNFearGreed(): IndicatorResult {
  let fgValue = NaN;
  let source = "CNN Business";

  // Primary: CNN API — needs browser-like headers (Origin/Referer) to bypass bot block
  try {
    const json = fetchUrl(
      "https://production.dataviz.cnn.io/index/fearandgreed/graphdata",
      20000,
      {
        "Origin": "https://www.cnn.com",
        "Referer": "https://www.cnn.com/markets/fear-and-greed",
      }
    );
    if (json && !json.includes("<html") && !json.includes("teapot")) {
      const parsed = JSON.parse(json);
      if (parsed?.fear_and_greed?.score) {
        fgValue = parseFloat(parsed.fear_and_greed.score);
        source = "CNN Fear & Greed (Live)";
        console.log(`  CNN F&G: ${fgValue}`);
      }
    }
  } catch (err: any) {
    console.log(`  CNN F&G primary failed: ${err?.message?.substring(0, 100)}`);
  }

  // Secondary fallback: alternative-me crypto F&G has high correlation in low-VIX environments
  // (not perfect proxy but better than N/A)
  if (isNaN(fgValue)) {
    try {
      const json = fetchUrl("https://api.alternative.me/fng/?limit=1", 10000);
      if (json) {
        const parsed = JSON.parse(json);
        const v = parsed?.data?.[0]?.value;
        if (v != null) {
          fgValue = parseFloat(v);
          source = `alternative.me Crypto F&G (Proxy: ${parsed.data[0].value_classification})`;
          console.log(`  CNN F&G fallback (crypto): ${fgValue}`);
        }
      }
    } catch {}
  }

  let rawScore = 0;
  let zone = "N/A";
  if (!isNaN(fgValue)) {
    // Methodology: >75:+9.6 | 55-75:+3.2 | 45-55:0 | 25-45:-3.2 | <25:-8
    if (fgValue > 75) { rawScore = 6; zone = `Extreme Greed (${Math.round(fgValue)} >75)`; }
    else if (fgValue > 55) { rawScore = 2; zone = `Greed (55-75)`; }
    else if (fgValue >= 45) { rawScore = 0; zone = `Neutral (45-55)`; }
    else if (fgValue >= 25) { rawScore = -2; zone = `Fear (25-45)`; }
    else { rawScore = -5; zone = `Extreme Fear (${Math.round(fgValue)} <25)`; }
  }

  return {
    name: "CNN Fear & Greed",
    group: "correction", subgroup: "sentiment",
    value: isNaN(fgValue) ? "N/A" : `${Math.round(fgValue)}`,
    rawScore, weight: 1.6,
    weightedScore: Math.round(rawScore * 1.6 * 10) / 10,
    maxWeighted: 9.6, zone, source,
    description: "CNN Fear & Greed Index (0=Extreme Fear, 100=Extreme Greed)",
  };
}

// Helper: derive sentiment proxy from VIX level. Used as last-resort fallback
// for AAII / Put-Call / Investors Intelligence when their direct sources
// (which all aggressively bot-block) cannot be reached.
function sentimentProxyFromVix(): { rawScore: number; zone: string; valueStr: string; available: boolean } {
  // Pull VIX directly via FRED — the same series VIX scoring already uses.
  const vix = getLatestFredValue("VIXCLS");
  if (isNaN(vix)) {
    return { rawScore: 0, zone: "N/A", valueStr: "N/A", available: false };
  }
  // VIX > 30  => Panic    => crowd is bearish/fearful (bullish for contrarian)
  // VIX 20-30 => Elevated  => moderately fearful
  // VIX 15-20 => Normal    => neutral
  // VIX < 15  => Calm      => crowd is greedy/complacent (bearish for contrarian)
  let rawScore = 0;
  let zone = "";
  if (vix > 30) { rawScore = -3; zone = `Extreme Angst (VIX ${vix.toFixed(1)} > 30)`; }
  else if (vix > 22) { rawScore = -1; zone = `Angst (VIX ${vix.toFixed(1)} 22-30)`; }
  else if (vix >= 15) { rawScore = 0; zone = `Neutral (VIX ${vix.toFixed(1)} 15-22)`; }
  else if (vix >= 12) { rawScore = 2; zone = `Sorglosigkeit (VIX ${vix.toFixed(1)} 12-15)`; }
  else { rawScore = 4; zone = `Extreme Sorglosigkeit (VIX ${vix.toFixed(1)} < 12)`; }
  return { rawScore, zone, valueStr: `VIX-Proxy ${vix.toFixed(1)}`, available: true };
}

// 15. AAII Sentiment Survey
function scoreAAII(): IndicatorResult {
  const bullPct = NaN;
  const bearPct = NaN;
  let rawScore = 0;
  let zone = "N/A";
  let valueStr = "N/A";

  if (!isNaN(bullPct) && !isNaN(bearPct) && bearPct > 0) {
    const ratio = bullPct / bearPct;
    valueStr = `Bull: ${bullPct.toFixed(0)}%, Bear: ${bearPct.toFixed(0)}%`;
    if (ratio > 2) { rawScore = 4; zone = "Extreme Euphorie (Bull/Bear >2)"; }
    else if (ratio < 0.5) { rawScore = -4; zone = "Extreme Angst (Bull/Bear <0.5)"; }
    else { rawScore = 0; zone = `Neutral (Ratio: ${ratio.toFixed(2)})`; }
  }

  // Last-resort: VIX-based proxy if direct sources + LLM sentiment all failed.
  // AAII has high inverse correlation with VIX (high VIX -> bears overweight).
  if (valueStr === "N/A") {
    const proxy = sentimentProxyFromVix();
    if (proxy.available) {
      rawScore = proxy.rawScore;
      zone = proxy.zone;
      valueStr = proxy.valueStr;
    }
  }
  return {
    name: "AAII Sentiment",
    group: "correction", subgroup: "sentiment",
    value: valueStr,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 4, zone,
    source: valueStr.includes("VIX-Proxy") ? "VIX-basierter Proxy (AAII direkt blockiert)"
          : valueStr.includes("Proxy") ? "Finance API (Sentiment-Proxy)" : "AAII",
    description: "American Association of Individual Investors Sentiment Survey",
  };
}

// 16. CBOE Put/Call Ratio
function scorePutCallRatio(): IndicatorResult {
  const pcr = NaN;

  let rawScore = 0;
  let zone = "N/A";
  let valueStr = isNaN(pcr) ? "N/A" : `${pcr.toFixed(2)}`;
  let source = "CBOE";
  if (!isNaN(pcr)) {
    if (pcr > 1.0) { rawScore = -4; zone = `Hohe Absicherung (${pcr.toFixed(2)} >1.0) → bullish`; }
    else if (pcr < 0.6) { rawScore = 4; zone = `Sorglosigkeit (${pcr.toFixed(2)} <0.6) → bearish`; }
    else { rawScore = 0; zone = `Neutral (0.6-1.0)`; }
  }

  // Last-resort: VIX-based proxy. Put/Call ratio rises with VIX (more hedging).
  if (valueStr === "N/A") {
    const proxy = sentimentProxyFromVix();
    if (proxy.available) {
      rawScore = proxy.rawScore;
      zone = proxy.zone;
      valueStr = proxy.valueStr;
      source = "VIX-basierter Proxy (CBOE direkt blockiert)";
    }
  }
  return {
    name: "CBOE Put/Call Ratio",
    group: "correction", subgroup: "sentiment",
    value: valueStr,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 4, zone,
    source,
    description: "Equity Put/Call Ratio (Absicherungsindikator)",
  };
}

// 17. Investors Intelligence
function scoreInvestorsIntelligence(): IndicatorResult {
  const bullPct = NaN;
  const bearPct = NaN;
  let rawScore = 0;
  let zone = "N/A";
  let valueStr = "N/A";

  if (!isNaN(bullPct) && !isNaN(bearPct) && bearPct > 0) {
    const ratio = bullPct / bearPct;
    valueStr = `Bull: ${bullPct.toFixed(0)}%, Bear: ${bearPct.toFixed(0)}% (Ratio: ${ratio.toFixed(2)})`;
    rawScore = ratio > 1.5 ? 4 : -4;
    zone = ratio > 1.5 ? `Euphorie (Ratio ${ratio.toFixed(2)} >1.5)` : `Vorsichtig (Ratio ${ratio.toFixed(2)} ≤1.5)`;
  }

  // Last-resort: VIX-based proxy. Investor Intelligence newsletters track
  // crowd sentiment which inversely correlates with VIX.
  if (valueStr === "N/A") {
    const proxy = sentimentProxyFromVix();
    if (proxy.available) {
      rawScore = proxy.rawScore;
      zone = proxy.zone;
      valueStr = proxy.valueStr;
    }
  }
  return {
    name: "Investors Intelligence",
    group: "correction", subgroup: "sentiment",
    value: valueStr,
    rawScore, weight: 1, weightedScore: rawScore, maxWeighted: 4, zone,
    source: valueStr.includes("VIX-Proxy") ? "VIX-basierter Proxy (II direkt blockiert)"
          : valueStr.includes("Proxy") ? "Finance API (Sentiment-Proxy)" : "Advisor Perspectives",
    description: "Newsletter-Berater Bull/Bear Ratio",
  };
}

// ============================================================
// NY Fed Recession Probability Anchor
// ============================================================
function getNYFedRecessionProb(): number {
  return getLatestFredValue("RECPROUSM156N");
}

// ============================================================
// Analysis Engine
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
  const clamped = Math.max(5, Math.min(95, p));
  return Math.round(clamped / 5) * 5;
}

export async function runRecessionAnalysis(): Promise<RecessionAnalysis> {
  console.log("[RECESSION] Starting recession analysis...");

  const indicators: IndicatorResult[] = await Promise.all([
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
  ]);

  console.log("[RECESSION] All indicators scored:");
  indicators.forEach(ind => {
    console.log(`  ${ind.name}: ${ind.value} → Score ${ind.weightedScore} (max ${ind.maxWeighted})`);
  });

  const googleAvailable = indicators.find(i => i.name.includes("Google"))?.value !== "N/A";
  const nyFedValue = getNYFedRecessionProb();
  console.log(`[RECESSION] NY Fed recession prob: ${nyFedValue}`);

  // === Build subgroups per methodology ===

  // 1. Rezession Coincident (3M): Sahm + Zinskurve + PMI → Max 11
  const coincidentInds = indicators.filter(i => i.subgroup === "coincident");
  const coincidentNet = coincidentInds.reduce((s, i) => s + i.weightedScore, 0);
  const coincidentMax = coincidentInds.reduce((s, i) => s + i.maxWeighted, 0);

  // 2. Rezession Leading (6M): + Durable + M2 + Kredit → Max 20
  const leadingInds = indicators.filter(i => i.subgroup === "leading");
  const rezLeadingNet = coincidentNet + leadingInds.reduce((s, i) => s + i.weightedScore, 0);
  const rezLeadingMax = coincidentMax + leadingInds.reduce((s, i) => s + i.maxWeighted, 0);

  // 3. Rezession Vollständig (12M): + Konsumklima → Max 23
  const fullInds = indicators.filter(i => i.subgroup === "full");
  const rezFullNet = rezLeadingNet + fullInds.reduce((s, i) => s + i.weightedScore, 0);
  const rezFullMax = rezLeadingMax + fullInds.reduce((s, i) => s + i.maxWeighted, 0);

  // 4. Korrektur Sentiment (3-6M): VIX + AD + CNN + AAII + Put/Call + II → Max 28.6
  const sentimentInds = indicators.filter(i => i.subgroup === "sentiment");
  const sentimentNet = sentimentInds.reduce((s, i) => s + i.weightedScore, 0);
  const sentimentMax = sentimentInds.reduce((s, i) => s + i.maxWeighted, 0);

  // 5. Korrektur Vollständig (12M): + Buffett + CAPE + Margin + Google → Max 73.1 (or 61.2)
  const valuationInds = indicators.filter(i => i.subgroup === "valuation" || i.subgroup === "sentiment_ext");
  const corrFullNet = sentimentNet + valuationInds.reduce((s, i) => s + i.weightedScore, 0);
  const corrFullMaxBase = sentimentMax + valuationInds.reduce((s, i) => s + i.maxWeighted, 0);
  const corrFullMax = googleAvailable ? corrFullMaxBase : 61.2;

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
      netScore: Math.round(coincidentNet * 10) / 10,
      maxScore: Math.round(coincidentMax * 10) / 10,
      probability: pCoincident,
      formula: `50% + (${coincidentNet.toFixed(1)}/${coincidentMax.toFixed(1)}) × 50% = ${(50 + (coincidentNet / coincidentMax) * 50).toFixed(1)}% → ${pCoincident}%`,
    },
    {
      name: "recession_leading",
      label: "Rezession Leading",
      horizon: "6M",
      indicators: [...coincidentInds, ...leadingInds].map(i => i.name),
      netScore: Math.round(rezLeadingNet * 10) / 10,
      maxScore: Math.round(rezLeadingMax * 10) / 10,
      probability: pLeading,
      formula: `50% + (${rezLeadingNet.toFixed(1)}/${rezLeadingMax.toFixed(1)}) × 50% = ${(50 + (rezLeadingNet / rezLeadingMax) * 50).toFixed(1)}% → ${pLeading}%`,
    },
    {
      name: "recession_full",
      label: "Rezession Vollständig",
      horizon: "12M",
      indicators: [...coincidentInds, ...leadingInds, ...fullInds].map(i => i.name),
      netScore: Math.round(rezFullNet * 10) / 10,
      maxScore: Math.round(rezFullMax * 10) / 10,
      probability: pRezFull,
      formula: !isNaN(nyFedValue)
        ? `Formel: 50% + (${rezFullNet.toFixed(1)}/${rezFullMax.toFixed(1)}) × 50% = ${pRezFormula.toFixed(1)}% | NY-Fed-Anker: ${(nyFedValue * 10).toFixed(1)}% | Final: ${pRezFormula.toFixed(1)}%×0.7 + ${nyFedAnchorPct!.toFixed(1)}%×0.3 = ${pRezFull}%`
        : `50% + (${rezFullNet.toFixed(1)}/${rezFullMax.toFixed(1)}) × 50% = ${pRezFormula.toFixed(1)}% → ${pRezFull}%`,
      nyFedAnchor: nyFedAnchorPct,
      finalProbability: pRezFull,
    },
    {
      name: "correction_sentiment",
      label: "Korrektur Sentiment",
      horizon: "3-6M",
      indicators: sentimentInds.map(i => i.name),
      netScore: Math.round(sentimentNet * 10) / 10,
      maxScore: Math.round(sentimentMax * 10) / 10,
      probability: pSentiment,
      formula: `50% + (${sentimentNet.toFixed(1)}/${sentimentMax.toFixed(1)}) × 50% = ${(50 + (sentimentNet / sentimentMax) * 50).toFixed(1)}% → ${pSentiment}%`,
    },
    {
      name: "correction_full",
      label: "Korrektur Vollständig",
      horizon: "12M",
      indicators: [...sentimentInds, ...valuationInds].map(i => i.name),
      netScore: Math.round(corrFullNet * 10) / 10,
      maxScore: Math.round(corrFullMax * 10) / 10,
      probability: pCorrFull,
      formula: `50% + (${corrFullNet.toFixed(1)}/${corrFullMax.toFixed(1)}) × 50% = ${(50 + (corrFullNet / corrFullMax) * 50).toFixed(1)}% → ${pCorrFull}%${!googleAvailable ? " (Google N/A, Max=61.2)" : ""}`,
    },
  ];

  // Top 3 drivers
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
    { name: "Current Market Valuation", url: "https://www.currentmarketvaluation.com" },
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

  // ====== FAZIT: Comprehensive assessment ======
  const fazit = generateFazit(indicators, subgroups, pCoincident, pLeading, pRezFull, pSentiment, pCorrFull, topDrivers);

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
    fazit,
    sources,
  };
}

// ============================================================
// Fazit Generator — Comprehensive macro risk assessment
// ============================================================

interface FazitSection {
  title: string;
  emoji: string;
  text: string;
}

function generateFazit(
  indicators: IndicatorResult[],
  subgroups: any[],
  pRez3M: number, pRez6M: number, pRez12M: number,
  pKorr3_6M: number, pKorr12M: number,
  topDrivers: string[],
): { summary: string; riskLevel: string; sections: FazitSection[] } {
  // Extract key indicator values
  const get = (name: string) => indicators.find(i => i.name.includes(name));
  const buffett = get("Buffett");
  const cape = get("CAPE");
  const vix = get("VIX");
  const sahm = get("Sahm");
  const yield10y2y = get("Zinskurve");
  const creditSpreads = get("Kreditspreads");
  const consConf = get("Konsumklima");
  const cnnFG = get("CNN");
  const googleTrends = get("Google");
  const marginDebt = get("Margin");

  const maxProb = Math.max(pRez12M, pKorr12M);
  const riskLevel = maxProb >= 70 ? "Hoch" : maxProb >= 50 ? "Erhöht" : maxProb >= 30 ? "Moderat" : "Niedrig";

  // Section 1: Quantitative Assessment
  const bullCount = indicators.filter(i => i.weightedScore < 0).length;
  const bearCount = indicators.filter(i => i.weightedScore > 0).length;
  const neutralCount = indicators.filter(i => i.weightedScore === 0).length;

  let quantSummary = `Von 17 Indikatoren signalisieren ${bearCount} ein erhöhtes Risiko (bearish), ${bullCount} sind positiv (bullish) und ${neutralCount} neutral. `;
  quantSummary += `Die Rezessionswahrscheinlichkeit liegt bei ${pRez3M}% (3M), ${pRez6M}% (6M) und ${pRez12M}% (12M). `;
  quantSummary += `Die Korrekturwahrscheinlichkeit beträgt ${pKorr3_6M}% (Sentiment, 3-6M) und ${pKorr12M}% (Vollständig, 12M). `;
  if (pKorr12M >= 65) {
    quantSummary += `Die hohe Korrekturwahrscheinlichkeit von ${pKorr12M}% wird maßgeblich durch extreme Bewertungsniveaus getrieben: `;
    quantSummary += topDrivers.slice(0, 3).join("; ") + ".";
  } else if (pRez12M >= 40) {
    quantSummary += `Die erhöhte Rezessionswahrscheinlichkeit reflektiert eine Kombination aus schwächelnden Konjunkturdaten und geopolitischem Stress.`;
  }

  // Section 2: Valuation Risk
  let valuationText = "";
  const buffettVal = buffett ? parseFloat(String(buffett.value).replace("%", "")) : NaN;
  const capeVal = cape ? parseFloat(String(cape.value)) : NaN;
  if (!isNaN(buffettVal) && buffettVal > 180) {
    valuationText += `Der Buffett-Indikator steht bei ${buffett!.value} — das höchste Niveau seit der Dotcom-Blase. `;
    valuationText += `Historisch führten Bewertungen über 200% zu durchschnittlichen Drawdowns von 30-50% innerhalb von 18 Monaten. `;
  }
  if (!isNaN(capeVal) && capeVal > 30) {
    valuationText += `Das Shiller CAPE-Ratio von ${capeVal} liegt über dem Durchschnitt der letzten 140 Jahre (ca. 17) und signalisiert, dass zukünftige Aktienrenditen (10J) mit hoher Wahrscheinlichkeit unterdurchschnittlich ausfallen. `;
  }
  if (marginDebt && marginDebt.rawScore > 0) {
    valuationText += `Die NYSE Margin Debt (${marginDebt.value}) zeigt erhöhte Hebelwirkung im Markt — ein klassischer Vorlauf-Indikator für abrupte Sell-Offs.`;
  }

  // Section 3: Geopolitical/Macro Risks (Iran/Hormuz + Inflation + Rates)
  // NOTE: Static analysis from GEO_ANALYSIS.lastUpdated. Update this constant quarterly.
  let geoText = `[Stand: ${GEO_ANALYSIS.lastUpdated}] `;
  geoText += `Die Sperrung der Straße von Hormuz durch den Iran-Konflikt stellt den gravierendsten exogenen Schock dar. Rund 20% der globalen Ölversorgung und ein Fünftel des weltweiten LNG-Handels fließen durch diese Meerenge. `;
  geoText += `Die Dallas Fed schätzt einen WTI-Ölpreis von $98-132/Barrel bei andauernder Sperrung, mit einem BIP-Wachstumsrückgang von bis zu 2,9 Prozentpunkten. `;
  geoText += `Goldman Sachs rechnet mit einem Inflationsanstieg um ~1 Prozentpunkt und hat die US-Rezessionswahrscheinlichkeit auf 30% angehoben. `;
  geoText += `Die Fed steht vor einem Stagflations-Dilemma: Zinssenkungen würden die Inflation anheizen, Zinserhöhungen die Konjunktur belasten. `;
  geoText += `Natixis prognostiziert, dass die Fed-Funds-Rate bei 3,50-3,75% verharrt, mit einem Bias Richtung "keine Senkung in 2026" oder sogar mögliche Zinserhöhungen. `;
  geoText += `Für den Aktienmarkt bedeutet das: Höhere Kapitalmarktzinsen drücken Equity-Bewertungen durch steigende Diskontierungsraten — besonders bei Growth-Aktien mit langer Duration.`;

  // Section 4: Private Credit / Systemic Risk
  let creditText = "";
  creditText += `Der $3-Billionen-Private-Credit-Markt steht vor seinem ersten echten Stresstest seit 2008. Morgan Stanley warnt vor Default-Raten von bis zu 8% (vs. historisch 2-2,5%). `;
  creditText += `40% der Private-Credit-Kreditnehmer haben laut IWF negativen freien Cashflow — ein Anstieg von 25% in 2021. `;
  creditText += `Mehrere Fonds (Blue Owl Capital, Cliffwater) haben bereits Rücknahmen eingeschränkt oder gestoppt. Die Parallelen zu den Vorboten der 2008-Krise (Rating-Arbitrage, Illiquidität, unrealistische Bewertungen) werden von UBS-Chairman Kelleher und der BIS explizit gezogen. `;
  creditText += `Bankkredite an Non-Bank Financial Institutions (NBFIs) sind auf $1,92 Billionen gestiegen (+66% seit Ende 2024), was eine potenzielle Ansteckungsgefahr für das regulierte Bankensystem darstellt. `;
  creditText += `Anders als 2023 bei der Silicon Valley Bank (konzentriertes VC-Exposure, Zinsrisiko bei Anleiheportfolios) ist das heutige Risiko breiter gestreut: Private Credit, Leveraged Loans, AI-Datacenter-Finanzierungen und covenant-lite Strukturen bilden ein Cluster eng korrelierter Risiken.`;

  // Section 5: Handlungsempfehlung
  let actionText = "";
  if (pKorr12M >= 65 || pRez12M >= 40) {
    actionText += `Angesichts einer Korrekturwahrscheinlichkeit von ${pKorr12M}% und einer Rezessionswahrscheinlichkeit von ${pRez12M}% empfiehlt sich eine defensive Positionierung: `;
    actionText += `(1) Reduktion der Aktienquote zugunsten von Cash und kurzlaufenden Staatsanleihen. `;
    actionText += `(2) Underweight bei Growth/Tech zugunsten von Value und defensiven Sektoren (Healthcare, Utilities, Consumer Staples). `;
    actionText += `(3) Goldallokation als Absicherung gegen Stagflation und geopolitisches Risiko. `;
    actionText += `(4) Kritische Prüfung von Private-Credit-Exposure — Liquiditätsrisiken werden in Stressphasen typischerweise unterschätzt. `;
    actionText += `(5) VIX-Hedge (Optionen, VIX-Calls) bei VIX unter 25 als günstige Absicherung.`;
  } else if (pKorr12M >= 50) {
    actionText += `Die Indikatoren mahnen zur Vorsicht. Eine moderate Risikoreduzierung und Diversifikation über Anlageklassen ist sinnvoll. Besonders Positionen mit hoher Zins- und Ölpreissensitivität sollten überprüft werden.`;
  } else {
    actionText += `Die aktuelle Indikatorenlage zeigt keine akute Bedrohung. Standardmäßiges Risikomanagement ist ausreichend, wobei die geopolitischen Risiken engmaschig beobachtet werden sollten.`;
  }

  // Build summary
  let summary = `Gesamtbewertung: ${riskLevel}es Risiko. `;
  summary += `Rezession 12M: ${pRez12M}%, Korrektur 12M: ${pKorr12M}%. `;
  if (pKorr12M >= 65) {
    summary += `Die Kombination aus historisch extremen Bewertungen (Buffett ${buffett?.value}, CAPE ${cape?.value}), `;
    summary += `dem Iran/Hormuz-Ölpreisschock mit Stagflationspotenzial, `;
    summary += `und systemischen Risiken im $3T-Private-Credit-Markt bildet ein Dreifach-Risiko-Cluster, `;
    summary += `das defensives Portfoliomanagement erfordert.`;
  }

  const sections: FazitSection[] = [
    { title: "Quantitative Bewertung", emoji: "📊", text: quantSummary },
    { title: "Bewertungsrisiko", emoji: "⚠️", text: valuationText },
    { title: "Geopolitik & Makro: Iran/Hormuz, Inflation, Zinsen", emoji: "🌍", text: geoText },
    { title: "Private Credit & Systemisches Risiko", emoji: "🏦", text: creditText },
    { title: "Handlungsempfehlung", emoji: "🎯", text: actionText },
  ];

  return { summary, riskLevel, sections };
}

// ============================================================
// Express route registration
// ============================================================
// In-memory cache for recession analysis (1h TTL)
// Recession indicators are all macro/weekly data — no need to re-fetch every click
let recessionCache: { data: RecessionAnalysis; ts: number } | null = null;
const RECESSION_CACHE_TTL = 60 * 60 * 1000; // 1 hour

export function registerRecessionRoutes(app: Express) {
  app.post("/api/analyze-recession", async (req, res) => {
    const force = req.body?.force === true;
    // Serve from cache if available and not stale
    if (!force && recessionCache && Date.now() - recessionCache.ts < RECESSION_CACHE_TTL) {
      console.log(`[RECESSION] cache HIT (age=${Math.round((Date.now() - recessionCache.ts)/60000)}min)`);
      return res.json(recessionCache.data);
    }
    // runRecessionAnalysis is async + heavy (many FRED/scrape fetches).
    // Proxy guard: if still running after 24s, return 202 and continue in background.
    let responded = false;
    const guard = setTimeout(() => {
      if (!responded) {
        responded = true;
        console.warn("[RECESSION] Proxy guard fired — returning 202");
        res.status(202).json({
          __building: true,
          message: "Rezessions-Analyse l\u00e4uft im Hintergrund (>24s). Bitte in 8\u201310 Sekunden erneut klicken.",
          retryAfterMs: 9000,
        });
      }
    }, 24000);
    guard.unref();
    try {
      const analysis = await runRecessionAnalysis();
      recessionCache = { data: analysis, ts: Date.now() };
      clearTimeout(guard);
      if (!responded) {
        responded = true;
        res.json(analysis);
      }
    } catch (error: any) {
      clearTimeout(guard);
      console.error("[RECESSION] Error:", error?.message);
      if (!responded) {
        responded = true;
        res.status(500).json({ error: error?.message || "Recession analysis failed" });
      }
    }
  });
}
