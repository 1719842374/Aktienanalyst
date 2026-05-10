// ============================================================
// Daily Regression Scan — checks 5 known-edge-case tickers for
// calculation regressions in DCF / Catalyst / WACC logic.
//
// Three anomaly rules:
//   R1: Catalyst-Adj. Target < 50% des Kurses (DOWNSIDE > 50%)
//   R2: Conservative DCF < 20% des Kurses (sehr niedrig, ohne erkenntlichen Fallback)
//   R3: WACC > 18% (unrealistisch hoch)
// ============================================================

import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";

// Re-use frontend pure functions \u2014 calculations.ts has no browser deps
import {
  calculateFCFFDCF,
  calculateCatalystUpside,
  selectCatalystBase,
} from "../client/src/lib/calculations";

// IFX = Infineon (FMP nutzt .DE Suffix), VWAGY = VW ADR, andere als US-Tickers
const TICKERS_TO_SCAN = ["IFX.DE", "TSLA", "VWAGY", "MSFT", "AMZN"];
const SCAN_CACHE_DIR = ".cache/regression";

interface Anomaly {
  ticker: string;
  rule: "R1_CATALYST_TARGET_LOW" | "R2_DCF_TOO_LOW" | "R3_WACC_TOO_HIGH";
  section: string;
  actualValue: string;
  expectedRange: string;
  detail: string;
}

interface ScanResult {
  asOf: string;
  tickersScanned: string[];
  anomalies: Anomaly[];
  perTickerSummary: Array<{
    ticker: string;
    currentPrice: number;
    conservativeDCF: number;
    catalystAdjTarget: number;
    catalystBaseSource: string;
    wacc: number;
    issues: number;
  }>;
  errors: Array<{ ticker: string; message: string }>;
}

function getBerlinDateKey(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(new Date());
}

async function fetchAnalysis(ticker: string, baseUrl: string): Promise<any> {
  const res = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, useLLM: false, force: false }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);
  return await res.json();
}

function runChecks(ticker: string, data: any): { anomalies: Anomaly[]; summary: any } {
  const anomalies: Anomaly[] = [];

  // === DCF berechnen mit EXAKT denselben Inputs wie Frontend Section 13 ===
  const sp = data.sectorProfile || {};
  const netDebt = (data.totalDebt || 0) - (data.cashEquivalents || 0);
  const haircut = data.fcfHaircut || 0;

  const ebitMarginDefault = data.ebitda > 0 && data.revenue > 0
    ? (data.operatingIncome > 0
        ? +((data.operatingIncome / data.revenue) * 100).toFixed(1)
        : +((data.ebitda / data.revenue) * 100 * 0.6).toFixed(1))
    : 15;
  const capexDefault = data.revenue > 0 && data.fcfTTM > 0
    ? +Math.max(2, Math.min(15, ((data.ebitda - data.fcfTTM) / data.revenue) * 100)).toFixed(1)
    : 5;
  const revenueGrowthDefault = sp.growthAssumptions?.g1 || 10;

  const rfS13 = 4.2;
  const erpS13 = 5.5;
  const taxS13 = 21;
  const rdS13 = 5.0;
  const debtRatioS13 = data.totalDebt > 0
    ? +((data.totalDebt / (data.marketCap + data.totalDebt)) * 100).toFixed(0)
    : 10;
  const evFracS13 = (100 - debtRatioS13) / 100;
  const dvFracS13 = debtRatioS13 / 100;
  const targetWACCS13 = sp.waccScenarios?.avg || 9;
  const debtCostPartS13 = dvFracS13 * rdS13 * (1 - taxS13 / 100);
  const impliedBetaS13 = Math.max(0.5, Math.min(1.8,
    (targetWACCS13 - debtCostPartS13 - evFracS13 * rfS13) / (evFracS13 * erpS13)
  ));
  const dcfBetaS13 = +Math.min(impliedBetaS13, (data.beta5Y || 1) + 0.1).toFixed(2);

  const baseParams = {
    revenueBase: data.revenue,
    revenueGrowthP1: revenueGrowthDefault,
    revenueGrowthP2: Math.max(3, +(revenueGrowthDefault * 0.6).toFixed(1)),
    ebitMargin: ebitMarginDefault,
    ebitMarginTerminal: +Math.max(8, ebitMarginDefault * 0.9).toFixed(1),
    capexPct: capexDefault,
    deltaWCPct: 5,
    taxRate: taxS13,
    daRatio: +Math.max(2, capexDefault * 0.8).toFixed(1),
    riskFreeRate: rfS13,
    beta: dcfBetaS13,
    erp: erpS13,
    debtRatio: debtRatioS13,
    costOfDebt: rdS13,
    terminalG: sp.growthAssumptions?.terminal || 2.5,
    sharesOutstanding: data.sharesOutstanding,
    netDebt,
    minorityInterests: 0,
    fcfHaircut: haircut,
    actualEPS: data.epsTTM,
    forwardEPS: data.epsConsensusNextFY,
  };

  let dcfResult: any = null;
  try {
    dcfResult = calculateFCFFDCF(baseParams as any);
  } catch (e: any) {
    anomalies.push({
      ticker,
      rule: "R2_DCF_TOO_LOW",
      section: "Section 5/13 (DCF)",
      actualValue: "ERROR",
      expectedRange: "valid number",
      detail: `DCF-Berechnung warf Exception: ${e?.message}`,
    });
    return {
      anomalies,
      summary: { ticker, currentPrice: data.currentPrice, conservativeDCF: 0, catalystAdjTarget: 0, catalystBaseSource: "error", wacc: 0, issues: 1 },
    };
  }

  const conservativeDCF = dcfResult.perShare;
  const wacc = dcfResult.wacc;
  const currentPrice = data.currentPrice || 0;

  // Catalyst total upside
  const catalysts = data.catalysts || [];
  const totalGB = catalysts.reduce((s: number, c: any) => s + (c.gb || 0), 0);
  const baseInfo = selectCatalystBase(conservativeDCF, totalGB, currentPrice, data.analystPT?.median || 0);
  const catalystAdjTarget = baseInfo.base * (1 + totalGB / 100);

  // === R1: Catalyst-Adj. Target > 50% unter Kurs ===
  if (currentPrice > 0 && catalystAdjTarget < currentPrice * 0.50) {
    const downsidePct = ((catalystAdjTarget / currentPrice) - 1) * 100;
    anomalies.push({
      ticker,
      rule: "R1_CATALYST_TARGET_LOW",
      section: "Section 13 (Kursanstieg-Katalysatoren)",
      actualValue: `$${catalystAdjTarget.toFixed(2)} (${downsidePct.toFixed(1)}% vs Kurs)`,
      expectedRange: `>= $${(currentPrice * 0.50).toFixed(2)} (-50% Kurs Floor)`,
      detail: `Basis: ${baseInfo.source} ($${baseInfo.base.toFixed(2)}) \u00d7 (1 + ${totalGB.toFixed(1)}%). ${baseInfo.reason}`,
    });
  }

  // === R2: Conservative DCF unter 20% des Kurses ohne erkennbaren Fallback ===
  // Plausibilit\u00e4t: Wenn DCF unrealistisch niedrig ist, sollte das aus den
  // Steps-Logs ersichtlich sein (z.B. PE-Cap aktiv, FS-Debt distortion).
  // Wenn nicht erkennbar, ist es ein potentieller Calc-Bug.
  if (currentPrice > 0 && conservativeDCF < currentPrice * 0.20) {
    const stepsText = (dcfResult.steps || []).join("\n").toLowerCase();
    const hasLoggedFallback = /pe[- ]cap|fs[- ]debt|distorted|capped|distortion|haircut|warn/i.test(stepsText);
    if (!hasLoggedFallback) {
      anomalies.push({
        ticker,
        rule: "R2_DCF_TOO_LOW",
        section: "Section 5/13 (DCF Conservative)",
        actualValue: `$${conservativeDCF.toFixed(2)} (${((conservativeDCF / currentPrice) * 100).toFixed(1)}% des Kurses)`,
        expectedRange: `>= $${(currentPrice * 0.20).toFixed(2)} (20% Kurs) ODER PE-Cap/Distortion-Note in steps`,
        detail: `Keine Fallback-Begr\u00fcndung in DCF-Trace gefunden. Letzte FCFF: ${dcfResult.yearlyProjections?.slice(-1)?.[0]?.fcff?.toFixed(0) || "n/a"}, TV: ${dcfResult.terminalValue?.toFixed(0) || "n/a"}`,
      });
    }
  }

  // === R3: WACC > 18% (unrealistisch hoch) ===
  if (wacc > 18) {
    anomalies.push({
      ticker,
      rule: "R3_WACC_TOO_HIGH",
      section: "Section 4 (Bewertungskennzahlen)",
      actualValue: `${wacc.toFixed(2)}%`,
      expectedRange: `<= 18% (Damodaran Industrials/Tech baseline)`,
      detail: `Beta=${baseParams.beta}, Re-CAPM=${dcfResult.costOfEquity?.toFixed(2)}%, Debt-Ratio=${baseParams.debtRatio}`,
    });
  }

  return {
    anomalies,
    summary: {
      ticker,
      currentPrice,
      conservativeDCF: Number(conservativeDCF.toFixed(2)),
      catalystAdjTarget: Number(catalystAdjTarget.toFixed(2)),
      catalystBaseSource: baseInfo.source,
      wacc: Number(wacc.toFixed(2)),
      issues: anomalies.length,
    },
  };
}

async function buildScan(baseUrl: string): Promise<ScanResult> {
  const result: ScanResult = {
    asOf: new Date().toISOString(),
    tickersScanned: TICKERS_TO_SCAN,
    anomalies: [],
    perTickerSummary: [],
    errors: [],
  };

  for (const ticker of TICKERS_TO_SCAN) {
    try {
      console.log(`[REGRESSION] scanning ${ticker}...`);
      const data = await fetchAnalysis(ticker, baseUrl);
      const { anomalies, summary } = runChecks(ticker, data);
      result.anomalies.push(...anomalies);
      result.perTickerSummary.push(summary);
    } catch (e: any) {
      console.error(`[REGRESSION] ${ticker} failed:`, e?.message);
      result.errors.push({ ticker, message: e?.message || "unknown" });
    }
  }

  // Persist for diagnostics / Cron-Email
  try {
    if (!fs.existsSync(SCAN_CACHE_DIR)) fs.mkdirSync(SCAN_CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SCAN_CACHE_DIR, `scan-${getBerlinDateKey()}.json`),
      JSON.stringify(result, null, 2)
    );
  } catch (e: any) {
    console.error("[REGRESSION] cache write failed:", e?.message);
  }

  return result;
}

export function registerRegressionScanRoutes(app: Express) {
  app.post("/api/regression-scan", async (req, res) => {
    try {
      // Use same-host base URL so we don't hardcode the asset URL
      // (works locally and in deployed sandbox alike)
      const port = process.env.PORT || "5000";
      const baseUrl = req.body?.baseUrl || `http://localhost:${port}`;
      console.log(`[REGRESSION] starting scan via ${baseUrl}...`);
      const result = await buildScan(baseUrl);
      console.log(`[REGRESSION] complete: ${result.anomalies.length} anomalies, ${result.errors.length} errors`);
      res.json(result);
    } catch (err: any) {
      console.error("[REGRESSION] error:", err?.message);
      res.status(500).json({ error: err?.message || "regression scan failed" });
    }
  });
}
