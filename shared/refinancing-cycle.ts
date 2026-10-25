/**
 * F1-26 (Future_1 §11, Z.364): Verschuldungs- / Refinanzierungszyklus in Sektion 5.
 * Nur Anzeige. Liest Felder, die schon im Analyse-Payload stehen, plus den FRED-DGS10-Stand.
 * Kein Score, kein Rating, kein CRV-Input. Fehlende Werte bleiben n/a mit Grund.
 */

export interface RefinancingInput {
  totalDebt?: number | null;
  cashEquivalents?: number | null;
  ebitda?: number | null;
  financialStatements?: {
    incomeStatement?: { ebitda?: number | null } | null;
    balanceSheet?: { totalDebt?: number | null; cashEquivalents?: number | null; netDebt?: number | null; debtToEquity?: number | null } | null;
  } | null;
}

export interface RefinancingRow {
  key: "netDebt" | "netDebtEbitda" | "debtToEquity" | "treasury10y" | "maturities" | "interestCoverage";
  label: string;
  /** Formatierter Wert oder "n/a". */
  value: string;
  /** Quelle oder Grund für n/a. */
  note: string;
  available: boolean;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function money(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)} Bio.`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)} Mrd.`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} Mio.`;
  return `${sign}${abs.toFixed(0)}`;
}

const na = (key: RefinancingRow["key"], label: string, note: string): RefinancingRow => ({ key, label, value: "n/a", note, available: false });

export function refinancingRows(data: RefinancingInput, treasury: { value: number; date: string } | null | undefined): RefinancingRow[] {
  const bs = data.financialStatements?.balanceSheet ?? null;
  const debt = fin(bs?.totalDebt) ? bs!.totalDebt! : fin(data.totalDebt) ? data.totalDebt : null;
  const cash = fin(bs?.cashEquivalents) ? bs!.cashEquivalents! : fin(data.cashEquivalents) ? data.cashEquivalents : null;
  const netDebt = fin(bs?.netDebt) ? bs!.netDebt! : debt != null && cash != null ? debt - cash : null;
  const isEbitda = data.financialStatements?.incomeStatement?.ebitda;
  const ebitda = fin(isEbitda) && isEbitda !== 0 ? isEbitda : fin(data.ebitda) && data.ebitda !== 0 ? data.ebitda : null;
  const de = bs?.debtToEquity;

  const rows: RefinancingRow[] = [];
  rows.push(netDebt == null
    ? na("netDebt", "Nettoverschuldung", "n/a: Schulden oder Cash fehlen im Payload")
    : { key: "netDebt", label: "Nettoverschuldung", value: money(netDebt), note: `Schulden ${debt != null ? money(debt) : "n/a"} − Cash ${cash != null ? money(cash) : "n/a"}`, available: true });
  rows.push(netDebt == null || ebitda == null
    ? na("netDebtEbitda", "Net Debt / EBITDA", ebitda == null ? "n/a: EBITDA fehlt oder ist 0 im Payload" : "n/a: Nettoverschuldung fehlt")
    : { key: "netDebtEbitda", label: "Net Debt / EBITDA", value: `${(netDebt / ebitda).toFixed(2)}x`, note: `EBITDA ${money(ebitda)} (Financial Statements)`, available: true });
  rows.push(fin(de)
    ? { key: "debtToEquity", label: "Debt / Equity", value: de.toFixed(2), note: "Bilanz (Financial Statements)", available: true }
    : na("debtToEquity", "Debt / Equity", "n/a: nicht im Payload"));
  rows.push(treasury && fin(treasury.value)
    ? { key: "treasury10y", label: "Refinanzierungsumfeld (10J UST)", value: `${treasury.value.toFixed(2)}%`, note: `FRED DGS10, Stand ${treasury.date}`, available: true }
    : na("treasury10y", "Refinanzierungsumfeld (10J UST)", "n/a: FRED DGS10 nicht erreichbar"));
  rows.push(na("maturities", "Fälligkeiten / Refinanzierungswand", "n/a: Fälligkeitsprofil nicht im Payload (bräuchte FMP-Schuldenfälligkeiten)"));
  rows.push(na("interestCoverage", "Zinsdeckung", "n/a: Zinsaufwand nicht im Payload"));
  return rows;
}

/** Letzter DGS10-Punkt oder null. */
export function latestTreasury(points: Array<{ date: string; value: number }> | null | undefined): { value: number; date: string } | null {
  if (!points || points.length === 0) return null;
  const last = points[points.length - 1];
  return fin(last.value) ? { value: last.value, date: last.date } : null;
}
