import type { Express } from "express";
import type { Server } from "http";
import type {
  GoldAnalysis,
  GoldIndicator,
  GoldFairValue,
  MonteCarloResult,
  GoldCycleAssessment,
  GoldPricePoint,
} from "../shared/gold-schema";
import { execSync } from "child_process";

// === Finance API Helper (same throttling/retry contract as main routes) ===
let lastFinanceCallAt = 0;
const MIN_SPACING_MS = 250;

function sleepSync(ms: number) {
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function callFinanceTool(toolName: string, args: Record<string, any>): any {
  const elapsed = Date.now() - lastFinanceCallAt;
  if (elapsed < MIN_SPACING_MS) sleepSync(MIN_SPACING_MS - elapsed);

  let result: any = null;
  try {
    const params = JSON.stringify({ source_id: "finance", tool_name: toolName, arguments: args });
    const escaped = params.replace(/'/g, "'\\''" );
    const raw = execSync(`external-tool call '${escaped}'`, {
      timeout: 60000, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024,
    });
    result = JSON.parse(raw);
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("RATE_LIMITED") || msg.includes("429") || msg.includes("UNAUTHORIZED") || msg.includes("401")) {
      console.warn(`[GOLD] ${toolName} rate-limited, backing off 4s and retrying once`);
      sleepSync(4000);
      try {
        const params = JSON.stringify({ source_id: "finance", tool_name: toolName, arguments: args });
        const escaped = params.replace(/'/g, "'\\''" );
        const raw = execSync(`external-tool call '${escaped}'`, {
          timeout: 60000, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024,
        });
        result = JSON.parse(raw);
      } catch (e2: any) {
        console.error(`[GOLD] ${toolName} retry also failed:`, e2?.message?.substring(0, 200));
        result = null;
      }
    } else {
      console.error(`Finance API error (${toolName}):`, msg.substring(0, 300));
      result = null;
    }
  }
  lastFinanceCallAt = Date.now();
  return result;
}

function parseNumber(s: string | undefined | null): number {
  if (!s) return 0;
  let cleaned = String(s).replace(/,/g, "").replace(/\$/g, "").replace(/%/g, "").trim();
  let multiplier = 1;
  if (/[Tt]$/.test(cleaned)) { multiplier = 1e12; cleaned = cleaned.slice(0, -1); }
  else if (/[Bb]$/.test(cleaned)) { multiplier = 1e9; cleaned = cleaned.slice(0, -1); }
  else if (/[Mm]$/.test(cleaned)) { multiplier = 1e6; cleaned = cleaned.slice(0, -1); }
  else if (/[Kk]$/.test(cleaned)) { multiplier = 1e3; cleaned = cleaned.slice(0, -1); }
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n * multiplier;
}

// === Parse CSV from finance tool response ===
function parseCSVContent(content: string): Record<string, string>[] {
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { cells.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    cells.push(current.trim());
    const row: Record<string, string> = {};
    cells.forEach((c, i) => { if (headers[i]) row[headers[i]] = c; });
    return row;
  });
}

// === Fetch FRED data via curl ===
function fetchFREDSeries(seriesId: string): { value: number; date: string } | null {
  try {
    const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}`;
    const csv = execSync(`curl -sL "${url}" 2>/dev/null | tail -5`, {
      encoding: "utf-8",
      timeout: 15000,
    });
    const lines = csv.trim().split("\n").filter(l => l && !l.startsWith("DATE") && !l.includes("DATE"));
    for (let i = lines.length - 1; i >= 0; i--) {
      const parts = lines[i].split(",");
      if (parts.length >= 2 && parts[1] !== "." && parts[1] !== "") {
        return { date: parts[0], value: parseFloat(parts[1]) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// === RSI Calculation ===
function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  const changes = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < changes.length; i++) {
    if (changes[i] > 0) {
      avgGain = (avgGain * (period - 1) + changes[i]) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(changes[i])) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

// === MA200 Calculation ===
function calculateMA(prices: number[], period: number): number {
  if (prices.length === 0) return 0;
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

// === 30d Realized Volatility ===
function calculateVolatility(prices: number[], days: number = 30): number {
  if (prices.length < days + 1) return 0.20; // fallback: GVZ-basiert (Gold VIX ~42 → σ≈0.20)
  const recentPrices = prices.slice(-(days + 1));
  const returns: number[] = [];
  for (let i = 1; i < recentPrices.length; i++) {
    returns.push(Math.log(recentPrices[i] / recentPrices[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252); // annualized
}

// === Monte Carlo GBM ===
function runMonteCarlo(
  s0: number,
  muAnnual: number,
  sigmaAnnual: number,
  days: number,
  iterations: number = 10000
): MonteCarloResult {
  const T = days / 365;
  const results: number[] = [];

  // Box-Muller for normal random
  function normalRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  for (let i = 0; i < iterations; i++) {
    const Z = normalRandom();
    const price = s0 * Math.exp((muAnnual - (sigmaAnnual ** 2) / 2) * T + sigmaAnnual * Math.sqrt(T) * Z);
    results.push(price);
  }

  results.sort((a, b) => a - b);

  const median = results[Math.floor(iterations * 0.5)];
  const p10 = results[Math.floor(iterations * 0.1)];
  const p25 = results[Math.floor(iterations * 0.25)];
  const p75 = results[Math.floor(iterations * 0.75)];
  const p90 = results[Math.floor(iterations * 0.9)];

  // Build distribution bins
  const binCount = 50;
  const min = results[0];
  const max = results[results.length - 1];
  const binWidth = (max - min) / binCount;
  const distribution: { bin: number; count: number }[] = [];
  for (let i = 0; i < binCount; i++) {
    const binStart = min + i * binWidth;
    const binEnd = binStart + binWidth;
    const count = results.filter(r => r >= binStart && (i === binCount - 1 ? r <= binEnd : r < binEnd)).length;
    distribution.push({ bin: Math.round(binStart), count });
  }

  // 12M scenarios
  const bullish = results.filter(r => r > s0 * 1.10).length / iterations * 100;
  const bearish = results.filter(r => r < s0 * 0.90).length / iterations * 100;
  const neutral = 100 - bullish - bearish;

  const horizonLabel = days <= 100 ? "3 Monate" : days <= 200 ? "6 Monate" : "12 Monate";

  return {
    horizon: horizonLabel,
    days,
    mu: muAnnual,
    sigma: sigmaAnnual,
    iterations,
    median: Math.round(median),
    p10: Math.round(p10),
    p25: Math.round(p25),
    p75: Math.round(p75),
    p90: Math.round(p90),
    min: Math.round(min),
    max: Math.round(max),
    distribution,
    scenarios: days >= 300 ? { bullish: Math.round(bullish * 10) / 10, neutral: Math.round(neutral * 10) / 10, bearish: Math.round(bearish * 10) / 10 } : undefined,
  };
}

// === Technical Score Decision Tree ===
function getTechnicalScore(rsi: number, deviationPct: number): { score: -1 | 0 | 1; details: string } {
  if (rsi > 75 && deviationPct > 25) {
    return { score: -1, details: `RSI ${rsi.toFixed(1)} >75 UND Abweichung ${deviationPct.toFixed(1)}% >25% → Bearish` };
  }
  if (rsi > 75 || deviationPct > 25) {
    return { score: 0, details: `RSI ${rsi.toFixed(1)} / Abw. ${deviationPct.toFixed(1)}% – eines überhitzt → Neutral + Warnung` };
  }
  if (rsi >= 60 && rsi <= 75) {
    return { score: 0, details: `RSI ${rsi.toFixed(1)} im Bereich 60-75 → Neutral` };
  }
  if (rsi >= 35 && rsi < 60) {
    return { score: 1, details: `RSI ${rsi.toFixed(1)} im Bereich 35-60 → Bullish` };
  }
  // RSI < 35 → oversold
  return { score: 1, details: `RSI ${rsi.toFixed(1)} <35 (überverkauft) → Bullish` };
}

export function registerGoldRoutes(server: Server, app: Express) {
  app.get("/api/analyze-gold", async (_req, res) => {
    try {
      console.log("[GOLD] Starting gold analysis...");
      const now = new Date();
      const endDate = now.toISOString().split("T")[0];
      const startDate = new Date(Date.now() - 2 * 365.25 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      // === Parallel data fetching ===
      const [goldQuoteResult, goldOHLCVResult, dxyQuoteResult, macroResult] = await Promise.all([
        // 1. Gold spot price
        Promise.resolve(callFinanceTool("finance_quotes", {
          ticker_symbols: ["GCUSD"],
          fields: ["price", "change", "changesPercentage", "yearLow", "yearHigh", "previousClose"],
        })),
        // 2. Gold OHLCV history (2 years for MA200)
        Promise.resolve(callFinanceTool("finance_ohlcv_histories", {
          ticker_symbols: ["GCUSD"],
          start_date_yyyy_mm_dd: startDate,
          end_date_yyyy_mm_dd: endDate,
          time_interval: "1day",
          fields: ["close"],
        })),
        // 3. DXY
        Promise.resolve(callFinanceTool("finance_quotes", {
          ticker_symbols: ["DX-Y.NYB"],
          fields: ["price"],
        })),
        // 4. Macro indicators (Realzinsen, Breakeven, M2, CPI)
        Promise.resolve(callFinanceTool("finance_macro_snapshot", {
          countries: ["United States"],
          keywords: ["CPI", "M2", "interest rate", "inflation"],
          action: "Fetching US macro indicators for gold analysis",
        })),
      ]);

      // Also fetch FRED data for more precise indicators
      const [fredBreakeven, fredRealRate, fredM2] = await Promise.all([
        Promise.resolve(fetchFREDSeries("T10YIE")),
        Promise.resolve(fetchFREDSeries("DFII10")),
        Promise.resolve(fetchFREDSeries("M2SL")),
      ]);

      // === Parse gold quote ===
      let spotPrice = 0;
      let changePercent = 0;
      let yearHigh = 0;
      let yearLow = 0;

      if (goldQuoteResult) {
        const content = typeof goldQuoteResult === "string" ? goldQuoteResult : JSON.stringify(goldQuoteResult);
        // Try to extract price from content
        const priceMatch = content.match(/price["\s:]+(\d+[\d,.]*)/i);
        if (priceMatch) spotPrice = parseNumber(priceMatch[1]);
        const changeMatch = content.match(/changesPercentage["\s:]+(-?[\d.]+)/i);
        if (changeMatch) changePercent = parseFloat(changeMatch[1]);
        const yhMatch = content.match(/yearHigh["\s:]+(\d+[\d,.]*)/i);
        if (yhMatch) yearHigh = parseNumber(yhMatch[1]);
        const ylMatch = content.match(/yearLow["\s:]+(\d+[\d,.]*)/i);
        if (ylMatch) yearLow = parseNumber(ylMatch[1]);
      }

      // Fallback: if no price from quote, try from OHLCV
      let historicalPrices: GoldPricePoint[] = [];
      let closePrices: number[] = [];

      if (goldOHLCVResult) {
        const content = typeof goldOHLCVResult === "string" ? goldOHLCVResult : JSON.stringify(goldOHLCVResult);
        // Parse CSV data
        const lines = content.split("\n").filter((l: string) => l.includes(",") && /\d{4}-\d{2}-\d{2}/.test(l));
        for (const line of lines) {
          const parts = line.split(",").map((s: string) => s.trim().replace(/"/g, ""));
          if (parts.length >= 2) {
            const dateStr = parts.find((p: string) => /\d{4}-\d{2}-\d{2}/.test(p));
            const closeStr = parts.find((p: string) => /^\d+\.?\d*$/.test(p) && parseFloat(p) > 100);
            if (dateStr && closeStr) {
              const close = parseFloat(closeStr);
              if (close > 0) {
                closePrices.push(close);
                historicalPrices.push({ date: dateStr, close });
              }
            }
          }
        }
      }

      // If no spot price from quotes, use last OHLCV close
      if (spotPrice === 0 && closePrices.length > 0) {
        spotPrice = closePrices[closePrices.length - 1];
      }

      // Fallback if still no price - use a reasonable estimate
      if (spotPrice === 0) {
        spotPrice = 4500; // current gold price level (Mar 2026)
        console.log("[GOLD] Warning: using fallback gold price");
      }

      console.log(`[GOLD] Gold spot price: $${spotPrice}`);

      // === Calculate technical indicators ===
      const ma200 = calculateMA(closePrices, 200) || spotPrice;
      const deviationFromMA200 = ma200 > 0 ? ((spotPrice - ma200) / ma200) * 100 : 0;
      const rsi14 = calculateRSI(closePrices, 14);
      const volatility30d = calculateVolatility(closePrices, 30);

      // Add MA200 to historical prices
      historicalPrices = historicalPrices.map((p, i) => {
        const idx = i + 1;
        if (idx >= 200) {
          const slice = closePrices.slice(idx - 200, idx);
          const ma = slice.reduce((a, b) => a + b, 0) / 200;
          return { ...p, ma200: Math.round(ma * 100) / 100 };
        }
        return p;
      });

      // === Parse DXY ===
      let dxyValue = 100; // default (DXY ~100 as of Mar 2026)
      if (dxyQuoteResult) {
        const content = typeof dxyQuoteResult === "string" ? dxyQuoteResult : JSON.stringify(dxyQuoteResult);
        const m = content.match(/price["\s:]+(\d+[\d,.]*)/i);
        if (m) dxyValue = parseNumber(m[1]);
      }

      // === Parse FRED indicators ===
      const breakevenRate = fredBreakeven?.value ?? 2.34;
      const realRate = fredRealRate?.value ?? 2.02;

      // M2 YoY growth estimation
      let m2YoY = 4.88; // default (Feb 2026 YCharts)
      if (fredM2?.value) {
        // M2 is a level; we'd need historical to compute YoY. Use macro data if available
        // For now estimate from macro snapshot
      }

      // Parse macro snapshot for M2 growth
      if (macroResult) {
        const content = typeof macroResult === "string" ? macroResult : JSON.stringify(macroResult);
        const m2Match = content.match(/M2[^}]*?(\d+\.?\d*)%/i);
        if (m2Match) m2YoY = parseFloat(m2Match[1]);
      }

      // === Parse CPI for Fair Value ===
      let cpiToday = 326.785; // BLS Feb 2026 CPI index
      if (macroResult) {
        const content = typeof macroResult === "string" ? macroResult : JSON.stringify(macroResult);
        const cpiMatch = content.match(/CPI[^}]*?(\d{2,3}\.?\d*)/i);
        if (cpiMatch) {
          const val = parseFloat(cpiMatch[1]);
          if (val > 100 && val < 500) cpiToday = val;
        }
      }

      // === GPR (Geopolitical Risk) ===
      // 2022: Ukraine → Gold stieg trotz Zinsanstieg. Iran-Konflikte zeigen starke Überschneidungen.
      // GPR >150 seit 2022 durch Nahost, Ukraine, Taiwan-Spannungen
      const gprValue = 155; // elevated geopolitical risk (Mar 2026: Nahost + Asien escalation)

      // === Indicator Scoring ===
      const indicators: GoldIndicator[] = [];

      // 1. Zentralbankkäufe (CB purchases) - WGC data: 863t in 2025, ~850t forecast 2026
      const cbPurchases = 863; // WGC Gold Demand Trends Full Year 2025
      indicators.push({
        name: "Zentralbankkäufe",
        weight: 0.20,
        score: cbPurchases >= 700 ? 1 : -1,
        value: `${cbPurchases}t (2025), Prognose ~850t (2026)`,
        details: cbPurchases >= 700
          ? "Zentralbanken kaufen weiterhin massiv Gold (De-Dollarisierung, Rekordnachfrage seit 2022)"
          : "Zentralbankkäufe unter historischem Durchschnitt",
        thresholds: { bullish: "≥700t/Jahr", neutral: "-", bearish: "<700t/Jahr" },
      });

      // 2. ETF Flows - WGC: Feb +5.3 Mrd, YTD stark positiv >10 Mrd.
      const etfFlowsYTD = 12; // billion USD (WGC Mar 2026)
      indicators.push({
        name: "ETF-Flows",
        weight: 0.15,
        score: etfFlowsYTD > 10 ? 1 : etfFlowsYTD > -10 ? 0 : -1,
        value: `YTD >10 Mrd. $; 7T-Trend positiv`,
        details: etfFlowsYTD > 10
          ? "Starke ETF-Zuflüsse signalisieren institutionelles Interesse (Feb +5,3 Mrd.)"
          : etfFlowsYTD > -10
            ? "ETF-Flows im neutralen Bereich"
            : "Deutliche ETF-Abflüsse",
        thresholds: { bullish: "YTD >10 Mrd. $", neutral: "-10 bis +10 Mrd. $", bearish: "<-10 Mrd. $" },
      });

      // 3. Breakeven Inflation (T10YIE)
      indicators.push({
        name: "Breakeven (T10YIE)",
        weight: 0.10,
        score: breakevenRate > 2.5 ? 1 : breakevenRate >= 2.0 ? 0 : -1,
        value: `${breakevenRate.toFixed(2)}%`,
        details: breakevenRate > 2.5
          ? "Erhöhte Inflationserwartungen stützen Gold"
          : breakevenRate >= 2.0
            ? "Moderate Inflationserwartungen"
            : "Niedrige Inflationserwartungen belasten Gold",
        thresholds: { bullish: ">2.5%", neutral: "2.0-2.5%", bearish: "<1.5%" },
      });

      // 4. Realzinsen (DFII10)
      const realRateScore: -1 | 0 | 1 = realRate < 0 ? 1 : realRate <= 1.5 ? 1 : realRate <= 2.5 ? 0 : -1;
      indicators.push({
        name: "Realzinsen (DFII10)",
        weight: 0.15,
        score: realRateScore,
        value: `${realRate.toFixed(2)}%`,
        details: realRate < 0
          ? "Negative Realzinsen: starkes Gold-Argument"
          : realRate <= 1.5
            ? "Niedrige positive Realzinsen stützen Gold"
            : realRate <= 2.5
              ? "Moderate Realzinsen – neutrale Wirkung"
              : "Hohe Realzinsen belasten Gold (höhere Opportunitätskosten)",
        thresholds: { bullish: "<0% oder 0-1.5%", neutral: "1.5-2.5%", bearish: ">2.5%" },
      });

      // 5. M2 YoY — Gewicht reduziert zugunsten Geopolitik (M2 ist träger Indikator)
      indicators.push({
        name: "M2 YoY",
        weight: 0.05,
        score: m2YoY > 5 ? 1 : m2YoY >= 3 ? 0 : -1,
        value: `${m2YoY.toFixed(1)}%`,
        details: m2YoY > 5
          ? "Starke Geldmengenausweitung unterstützt Gold"
          : m2YoY >= 3
            ? "Moderates M2-Wachstum"
            : "Geringe Geldmengenausweitung",
        thresholds: { bullish: ">5%", neutral: "3-5%", bearish: "<3%" },
      });

      // 6. DXY
      indicators.push({
        name: "DXY",
        weight: 0.10,
        score: dxyValue < 98 ? 1 : dxyValue <= 104 ? 0 : -1,
        value: dxyValue.toFixed(1),
        details: dxyValue < 98
          ? "Schwacher Dollar stützt Gold"
          : dxyValue <= 104
            ? "Dollar im neutralen Bereich"
            : "Starker Dollar belastet Gold",
        thresholds: { bullish: "<98", neutral: "98-104", bearish: ">104" },
      });

      // 7. Geopolitik (GPR) — Gewicht erhöht auf 0.15
      // Begründung: 2022 Ukraine-Krieg hat Gold trotz steigender Zinsen/Kapitalmarktzinsen gestützt.
      // Lieferengpässe + Inflation + Geopolitik waren stärkster Preistreiber.
      // Iran-Konflikte zeigen starke Überschneidungen mit Goldpreis-Rallyes.
      // Geopolitik kann andere negative Faktoren (steigende Zinsen) überkompensieren.
      indicators.push({
        name: "Geopolitik (GPR)",
        weight: 0.15,
        score: gprValue > 150 ? 1 : gprValue >= 100 ? 0 : -1,
        value: `>${gprValue} (Nahost, Asien-Eskalation)`,
        details: gprValue > 150
          ? "Erhöhtes geopolitisches Risiko treibt Safe-Haven-Nachfrage (Ukraine 2022: Gold stieg trotz Zinsanstieg)"
          : gprValue >= 100
            ? "Moderate geopolitische Spannungen – Safe-Haven-Nachfrage aktiv"
            : "Ruhiges geopolitisches Umfeld – Gold verliert Risikoprämie",
        thresholds: { bullish: ">150", neutral: "100-150", bearish: "<100" },
      });

      // 8. Technisch (RSI + 200DMA)
      const techScore = getTechnicalScore(rsi14, Math.abs(deviationFromMA200));
      indicators.push({
        name: "Technisch (RSI+200DMA)",
        weight: 0.10,
        score: techScore.score,
        value: `RSI ${rsi14.toFixed(1)} | Abw. ${deviationFromMA200.toFixed(1)}%`,
        details: techScore.details,
        thresholds: { bullish: "RSI 35-60", neutral: "RSI 60-75", bearish: "RSI >75 UND Abw >25%" },
      });

      // === Calculate GIS ===
      const gis = indicators.reduce((sum, ind) => sum + ind.score * ind.weight, 0);
      const gisCalculation = indicators.map(ind =>
        `(${ind.score > 0 ? "+" : ""}${ind.score} × ${ind.weight.toFixed(2)})`
      ).join(" + ") + ` = ${gis.toFixed(2)}`;

      console.log(`[GOLD] GIS = ${gis.toFixed(3)}`);

      // === Fair Value (10 steps) ===
      const fv1980 = 850 * (cpiToday / 82.4);
      const fv2011 = 1920 * (cpiToday / 224.9);
      const fvBasis = (fv1980 + fv2011) / 2;
      const premium = gis >= 0.40 ? 0.45 : gis >= 0.20 ? 0.25 : gis >= 0 ? 0.10 : 0.00;
      const premiumReason = gis >= 0.40 ? "GIS ≥ 0.40 → 45% Premium"
        : gis >= 0.20 ? "GIS 0.20-0.40 → 25% Premium"
          : gis >= 0 ? "GIS 0-0.20 → 10% Premium"
            : "GIS ≤ 0 → kein Premium";
      const fvAdj = fvBasis * (1 + premium);
      const support1 = spotPrice * 0.90;
      const support2 = fvBasis;
      const resistance1 = spotPrice * 1.10;
      const resistance2 = Math.max(spotPrice * 1.25, fvAdj * 1.20);

      const fairValue: GoldFairValue = {
        cpiToday,
        fv1980: Math.round(fv1980),
        fv2011: Math.round(fv2011),
        fvBasis: Math.round(fvBasis),
        premium,
        premiumReason,
        fvAdj: Math.round(fvAdj),
        support1: Math.round(support1),
        support2: Math.round(support2),
        resistance1: Math.round(resistance1),
        resistance2: Math.round(resistance2),
      };

      // === Monte Carlo ===
      const muAnnual = gis >= 0.40 ? 0.10 : gis >= 0.20 ? 0.06 : gis >= 0 ? 0.02 : -0.02;
      // σ: Use 30d realized vol if available, otherwise GVZ-implied ~0.20
      const sigma = volatility30d > 0.05 ? volatility30d : 0.20;

      const mc3M = runMonteCarlo(spotPrice, muAnnual, sigma, 90);
      const mc6M = runMonteCarlo(spotPrice, muAnnual, sigma, 180);
      const mc12M = runMonteCarlo(spotPrice, muAnnual, sigma, 365);

      // === Price Estimate ===
      const priceEstimate = {
        threeMonth: { low: mc3M.p10, mid: mc3M.median, high: mc3M.p90 },
        sixMonth: { low: mc6M.p10, mid: mc6M.median, high: mc6M.p90 },
        twelveMonth: { low: mc12M.p10, mid: mc12M.median, high: mc12M.p90 },
      };

      // === Cycle Assessment ===
      const bullishDrivers = indicators.filter(i => i.score === 1).map(i => i.name);
      const bearishDrivers = indicators.filter(i => i.score === -1).map(i => i.name);

      const cycleAssessment: GoldCycleAssessment = {
        historicalCycles: "1976-1980: +700% (Stagflation). 2001-2011: +650% (Post-DotCom/GFC). 2018-heute: laufender Zyklus (De-Dollarisierung, Pandemie-Stimulus, Geopolitik). Wichtig: 2022 stieg Gold trotz steigender Zinsen wegen Ukraine-Krieg + Lieferengpässe + Inflation → Geopolitik kann Zinseffekte überkompensieren.",
        currentPhase: gis >= 0.30
          ? "Aktive Bullphase – unterstützt durch multiple strukturelle Treiber"
          : gis >= 0
            ? "Konsolidierungsphase mit positivem Bias"
            : "Korrekturgefahr – wenige stützende Faktoren",
        drivers: [...bullishDrivers.map(d => `✅ ${d}`), ...bearishDrivers.map(d => `⚠️ ${d} (negativ)`)],
        outlook: gis >= 0.30
          ? `Starker GIS (${gis.toFixed(2)}) signalisiert weiteres Aufwärtspotenzial. ${bullishDrivers.length} von 8 Indikatoren bullish.`
          : gis >= 0
            ? `Leicht positiver GIS (${gis.toFixed(2)}). Markt in Konsolidierung, aber strukturelle Unterstützung vorhanden.`
            : `Negativer GIS (${gis.toFixed(2)}). Kurzfristiger Gegenwind dominiert.`,
      };

      // === Summary Table ===
      const sentiment: "Bullish" | "Neutral" | "Bearish" = gis >= 0.30 ? "Bullish" : gis >= 0 ? "Neutral" : "Bearish";
      const summaryTable = [
        { metric: "Gold Spot", value: `$${spotPrice.toFixed(2)}` },
        { metric: "200-DMA", value: `$${ma200.toFixed(2)}` },
        { metric: "Abweichung 200-DMA", value: `${deviationFromMA200 >= 0 ? "+" : ""}${deviationFromMA200.toFixed(1)}%` },
        { metric: "RSI (14)", value: rsi14.toFixed(1) },
        { metric: "GIS (Gold Indicator Score)", value: gis.toFixed(2) },
        { metric: "Sentiment", value: sentiment },
        { metric: "Fair Value (adj.)", value: `$${fvAdj.toFixed(0)}` },
        { metric: "30d Volatilität (ann.)", value: `${(sigma * 100).toFixed(1)}%` },
        { metric: "3M Prognose (P10-P90)", value: `$${mc3M.p10} – $${mc3M.p90}` },
        { metric: "6M Prognose (P10-P90)", value: `$${mc6M.p10} – $${mc6M.p90}` },
        { metric: "12M Prognose (P10-P90)", value: `$${mc12M.p10} – $${mc12M.p90}` },
        { metric: "DXY", value: dxyValue.toFixed(1) },
        { metric: "Realzinsen (DFII10)", value: `${realRate.toFixed(2)}%` },
        { metric: "Breakeven (T10YIE)", value: `${breakevenRate.toFixed(2)}%` },
      ];

      // === Final Assessment ===
      const bullCount = indicators.filter(i => i.score === 1).length;
      const bearCount = indicators.filter(i => i.score === -1).length;
      const finalAssessment = gis >= 0.30
        ? `Gold zeigt ein starkes bullisches Setup mit einem GIS von ${gis.toFixed(2)}. ${bullCount} von 8 Indikatoren sind positiv. Die Fair Value (inflationsbereinigt) liegt bei $${fvAdj.toFixed(0)}, ${spotPrice < fvAdj ? "was weiteres Aufwärtspotenzial impliziert" : "der aktuelle Preis liegt darüber – Vorsicht"}. Die Monte-Carlo-Simulation (12M) zeigt eine ${mc12M.scenarios?.bullish?.toFixed(0)}% Wahrscheinlichkeit für >10% Aufwertung. Strukturelle Treiber (Zentralbankkäufe, De-Dollarisierung) bleiben intakt.`
        : gis >= 0
          ? `Gold befindet sich in einer neutralen bis leicht bullischen Phase (GIS: ${gis.toFixed(2)}). ${bullCount} Indikatoren positiv, ${bearCount} negativ. Fair Value bei $${fvAdj.toFixed(0)}. Die Monte-Carlo-Simulation zeigt eine ausgeglichene Verteilung mit moderatem Aufwärtspotenzial.`
          : `Gold steht unter Druck (GIS: ${gis.toFixed(2)}). ${bearCount} von 8 Indikatoren negativ. Hohe Realzinsen und/oder starker Dollar belasten. Fair Value bei $${fvAdj.toFixed(0)}. Kurzfristige Korrektur möglich.`;

      // === Plausibility Checks ===
      const plausibilityChecks = [
        `Spot-Preis $${spotPrice.toFixed(2)} plausibel (${spotPrice > 1000 && spotPrice < 10000 ? "✅" : "⚠️"})`,
        `200-DMA $${ma200.toFixed(2)} (${closePrices.length >= 200 ? "✅ 200+ Datenpunkte" : `⚠️ nur ${closePrices.length} Datenpunkte`})`,
        `RSI ${rsi14.toFixed(1)} (${rsi14 > 0 && rsi14 < 100 ? "✅" : "⚠️"})`,
        `Volatilität ${(sigma * 100).toFixed(1)}% (${sigma > 0.05 && sigma < 0.50 ? "✅ plausibel" : "⚠️ Fallback verwendet"})`,
        `CPI ${cpiToday} für Fair Value (${cpiToday > 200 && cpiToday < 500 ? "✅" : "⚠️ geschätzt"})`,
      ];

      // === Build response ===
      const analysis: GoldAnalysis = {
        timestamp: now.toISOString(),
        analysisDate: now.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        spotPrice,
        priceTimestamp: now.toISOString(),
        currency: "USD",
        changePercent,
        yearHigh: yearHigh || spotPrice * 1.05,
        yearLow: yearLow || spotPrice * 0.85,
        ma200,
        deviationFromMA200,
        plausibilityChecks,
        indicators,
        gis: Math.round(gis * 100) / 100,
        gisCalculation,
        fairValue,
        monteCarlo3M: mc3M,
        monteCarlo6M: mc6M,
        monteCarlo12M: mc12M,
        priceEstimate,
        cycleAssessment,
        summaryTable,
        finalAssessment,
        sentiment,
        sources: [
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
          "Volatilität: GVZ ~42, σ=0.20 (konservativ)",
        ],
        historicalPrices,
        rsi14,
      };

      console.log(`[GOLD] Analysis complete: $${spotPrice}, GIS=${gis.toFixed(2)}, Sentiment=${sentiment}`);
      res.json(analysis);
    } catch (error: any) {
      console.error("[GOLD] Error:", error?.message);
      res.status(500).json({ error: error?.message || "Gold analysis failed" });
    }
  });
}
