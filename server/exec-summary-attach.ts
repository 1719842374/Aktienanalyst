/**
 * Thin attach helper — maps StockAnalysis-like object → buildExecSummary.
 * Keeps analyze-route surgical (import + one call before res.json).
 * Spec: WORK_EXEC_SUMMARY.md
 */
import { buildExecSummary, type ExecSummary, type ExecSummaryInput } from "./exec-summary";

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** CRV 3:1 max entry: P = (FV + 2·WC) / 3 (Section6). */
function maxEntryCrv3(fv: number, wc: number): number {
  return (fv + 2 * wc) / 3;
}

export function buildExecSummaryInputFromAnalysis(a: any): ExecSummaryInput {
  const price = Number(a?.currentPrice ?? a?.price ?? 0) || 0;
  const status = a?.technicalIndicators?.currentStatus ?? {};
  const scoring = a?.scoring ?? {};
  const pestelFactors = Array.isArray(a?.pestelAnalysis?.factors)
    ? a.pestelAnalysis.factors.map((f: any) => ({
        key: String(f?.category ?? f?.key ?? "?"),
        exposure: String(f?.severity ?? f?.exposure ?? "n/v"),
        kurstreiber: Number(f?.kurstreiber ?? 0) || 0,
        kursrisiko: Number(f?.kursrisiko ?? 0) || 0,
      }))
    : [];

  const fv =
    finite(a?.conservativeDcfPerShare) ? a.conservativeDcfPerShare
    : finite(a?.dcfConservative) ? a.dcfConservative
    : finite(scoring?.dcfConservative) ? scoring.dcfConservative
    : null;
  const wc =
    finite(a?.worstCasePrice) ? a.worstCasePrice
    : finite(a?.worstCase) ? a.worstCase
    : null;
  // Prefer explicit fields; else derive from FV/WC when both present
  let entry = finite(a?.maxEntryCrv3) ? a.maxEntryCrv3 : null;
  if (entry == null && finite(fv) && finite(wc)) entry = maxEntryCrv3(fv, wc);

  const crvBase = finite(a?.crvBase) ? a.crvBase : finite(a?.crv) ? a.crv : null;
  const crvRA = finite(a?.crvRiskAdj) ? a.crvRiskAdj : null;

  const highForces: string[] = [];
  const forces = a?.moatAssessment?.porterForces ?? a?.porterForces;
  if (forces && typeof forces === "object") {
    for (const [k, v] of Object.entries(forces)) {
      if (typeof v === "string" && /hoch|high/i.test(v)) highForces.push(k);
      if (typeof v === "number" && v >= 4) highForces.push(k);
    }
  }

  return {
    ticker: String(a?.ticker ?? ""),
    companyName: String(a?.companyName ?? a?.ticker ?? ""),
    price,
    marketCap: finite(a?.marketCap) ? a.marketCap : undefined,
    revenueGrowthPct: finite(a?.financialStatements?.incomeStatement?.revenueGrowth)
      ? a.financialStatements.incomeStatement.revenueGrowth
      : finite(a?.revenueGrowthPct) ? a.revenueGrowthPct : null,
    waccPct: finite(a?.waccPct) ? a.waccPct : finite(scoring?.waccPct) ? scoring.waccPct : null,
    gStarPct: finite(a?.impliedGStar) ? a.impliedGStar : finite(a?.gStarPct) ? a.gStarPct : null,
    g1Pct: finite(a?.g1Pct) ? a.g1Pct : finite(scoring?.g1Pct) ? scoring.g1Pct : null,
    pe: finite(a?.peRatio) ? a.peRatio : null,
    forwardPe: finite(a?.forwardPE) ? a.forwardPE : null,
    peg: finite(a?.pegRatio) ? a.pegRatio : finite(a?.peg) ? a.peg : null,
    dcfConservative: fv,
    analystPtMedian: finite(a?.analystPT?.median) ? a.analystPT.median : null,
    riskAdjTarget: finite(a?.riskAdjTarget) ? a.riskAdjTarget : null,
    invertedDcf: finite(a?.invertedDcf) ? a.invertedDcf : null,
    crvBase,
    crvRiskAdj: crvRA,
    maxEntryCrv3: entry,
    scoreCapped: finite(scoring?.scoreCapped) ? scoring.scoreCapped : finite(a?.scoreCapped) ? a.scoreCapped : null,
    scoreGate: scoring?.gate ?? a?.scoreGate ?? null,
    s17Verdict: a?.s17Verdict ?? scoring?.verdict ?? scoring?.s17Verdict ?? null,
    nextEarningsDate: a?.nextEarningsDate ?? null,
    lastReportedQuarter: a?.lastReportedQuarter ?? null,
    ma50AboveMA200: typeof status.ma50AboveMA200 === "boolean" ? status.ma50AboveMA200 : null,
    priceAboveMA200: typeof status.priceAboveMA200 === "boolean" ? status.priceAboveMA200 : null,
    catalysts: Array.isArray(a?.catalysts) ? a.catalysts : [],
    risks: Array.isArray(a?.risks) ? a.risks : [],
    moat: a?.moatRating ?? a?.moatAssessment?.rating ?? null,
    porterHighForces: highForces,
    pestel: pestelFactors,
  };
}

/** Mutates analysis with execSummary field; returns same object for res.json. */
export function attachExecSummary<T extends Record<string, any>>(analysis: T): T & { execSummary: ExecSummary } {
  const execSummary = buildExecSummary(buildExecSummaryInputFromAnalysis(analysis));
  (analysis as any).execSummary = execSummary;
  return analysis as T & { execSummary: ExecSummary };
}
