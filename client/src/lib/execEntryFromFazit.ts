/**
 * Exec Summary: Entry-Sätze aus derselben Quelle wie das S17-Fazit (prepareFazitEntry).
 * Der Server liefert execSummary.fazit.handlung und execSummary.crvLine mit seinem eigenen
 * maxEntryCrv3 (analyze-route, gehärteter Pfad). Angezeigt wird im Client aber der Fazit-Wert.
 * Hier wird keine zweite Rechnung gemacht: Werte aus prepareFazitEntry, Satzbau aus den
 * Server-Bausteinen (buildFazit/buildCrvLine), damit Wortlaut und Währung gleich bleiben.
 */
import type { StockAnalysis } from "../../../shared/schema";
import { buildCrvLine, buildFazit } from "../../../server/exec-summary";
import { prepareFazitEntry } from "./fazit-signal";
import { statementCurrency } from "./formatters";

export type ExecEntryLines = {
  handlung: string;
  crvLine: string;
  maxEntry: number;
  crvBase: number;
  crvRiskAdj: number;
};

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** null = Fazit-Werte nicht berechenbar → Karte zeigt unverändert die Server-Sätze. */
export function execEntryLinesFromFazit(data: StockAnalysis): ExecEntryLines | null {
  let entry;
  try { entry = prepareFazitEntry(data); } catch { return null; }
  if (!finite(entry.dcfBeiCRV3) || !finite(data.currentPrice)) return null;
  const currency = typeof data.currency === "string" && data.currency.trim() ? data.currency.trim() : null;
  const input = {
    ticker: String(data.ticker ?? ""),
    companyName: String(data.companyName ?? data.ticker ?? ""),
    price: data.currentPrice,
    currency,
    statementCurrency: currency ? statementCurrency(data) : null,
    maxEntryCrv3: entry.dcfBeiCRV3,
    crvBase: finite(entry.crvConservative) ? entry.crvConservative : null,
    crvRiskAdj: finite(entry.raCrvCons) ? entry.raCrvCons : null,
  };
  return {
    handlung: buildFazit(input).handlung,
    crvLine: buildCrvLine(input),
    maxEntry: entry.dcfBeiCRV3,
    crvBase: entry.crvConservative,
    crvRiskAdj: entry.raCrvCons,
  };
}
