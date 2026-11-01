/**
 * FW-09 — US-Fiscal-Spending-Historie (FRED MTSO133FMS) für das BTC-Chart-Overlay.
 * Reine Anzeige; fließt in keinen Score ein. curl wie server/btc-macro.ts.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import { parseFredCsv } from "./btc-macro";
import { buildFiscalYoy, FISCAL_FRED_SERIES, type FiscalHistoryResponse } from "../shared/btc-fiscal";

const execFileAsync = promisify(execFile);

export async function fetchFiscalHistory(startDate = "2008-01-01"): Promise<FiscalHistoryResponse> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${FISCAL_FRED_SERIES}&cosd=${startDate}`;
  const { stdout } = await execFileAsync("curl", ["-fsSL", "--max-time", "20", url], {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const monthly = parseFredCsv(stdout);
  return {
    source: "FRED MTSO133FMS (US Treasury, Total Outlays, monatlich)",
    series: FISCAL_FRED_SERIES,
    points: buildFiscalYoy(monthly),
    global: null,
    globalNote: "Globales Fiscal Spending: keine freie, konsistente Zeitreihe — n/a",
  };
}
