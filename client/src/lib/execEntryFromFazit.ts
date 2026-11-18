/**
 * Exec Summary: Entry-Sätze aus derselben Quelle wie S17/S20-Fazit, PDF S6 und Chat (shared/fazit-entry.ts).
 * Der Server liefert execSummary.fazit.handlung und execSummary.crvLine mit seinem eigenen
 * maxEntryCrv3 (analyze-route, gehärteter Pfad; SHEL.L 29,87). Angezeigt wird der Fazit-Wert (£31.33).
 * Keine zweite Rechnung: Werte aus fazitEntryForExport, Satzbau aus den Server-Bausteinen
 * (buildFazit/buildCrvLine, rein), damit Wortlaut und Währungswort gleich bleiben.
 * Übernommen aus #312 (23c84cc), auf main nach #321 umgestellt: prepareFazitEntry → shared computeFazitEntry.
 */
import type { StockAnalysis } from "../../../shared/schema";
import { buildCrvLine, buildFazit } from "../../../server/exec-summary";
import { fazitEntryForExport } from "../../../shared/fazit-entry";

export type ExecEntryLines = {
  handlung: string;
  crvLine: string;
  maxEntry: number;
  crvBase: number;
  crvRiskAdj: number;
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** null = Fazit-Werte nicht berechenbar → Karte zeigt unverändert die Server-Sätze. */
export function execEntryLinesFromFazit(data: StockAnalysis): ExecEntryLines | null {
  const fe = fazitEntryForExport(data);
  if (!fe || !finite(data.currentPrice)) return null;
  const currency = typeof data.currency === "string" && data.currency.trim() ? data.currency.trim() : null;
  const input = {
    ticker: String(data.ticker ?? ""),
    companyName: String(data.companyName ?? data.ticker ?? ""),
    price: data.currentPrice,
    currency,
    statementCurrency: currency ? fe.currency : null,
    maxEntryCrv3: fe.maxEntry,
    crvBase: finite(fe.crvBase) ? fe.crvBase : null,
    crvRiskAdj: finite(fe.crvRiskAdj) ? fe.crvRiskAdj : null,
  };
  return {
    handlung: buildFazit(input as any).handlung,
    crvLine: buildCrvLine(input as any),
    maxEntry: fe.maxEntry,
    crvBase: fe.crvBase,
    crvRiskAdj: fe.crvRiskAdj,
  };
}
