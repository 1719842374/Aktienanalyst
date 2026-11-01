/**
 * FW-31 — Anzeige der Researcher-Sektorrotation im Rezessions-Dashboard.
 * Gruppiert nur die schon gelieferten Bewertungs-Labels (Teuer / Attraktiv /
 * Angemessen / n.v.). Keine neue Schwelle, kein Einfluss auf die Rezessions-P.
 */

export type SectorValuationLabel = "Teuer" | "Angemessen" | "Attraktiv" | "n.v.";

export interface SectorValuationInput {
  label: string;
  etf: string;
  valuation: string;
  pe: number | null;
  pe10y: number | null;
}

export interface SectorValuationLine {
  label: string;
  etf: string;
  valuation: SectorValuationLabel | "n.v.";
  /** Anzeigetext, z. B. „KGV 22,4 / 10J 18,1“ oder der n/a-Grund. */
  detail: string;
}

export interface SectorValuationGroups {
  overvalued: SectorValuationLine[];
  undervalued: SectorValuationLine[];
  mid: SectorValuationLine[];
  unavailable: SectorValuationLine[];
}

function finitePositive(v: number | null): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function de(v: number): string {
  return v.toFixed(1).replace(".", ",");
}

/** Grund, warum eine Zeile nicht in Über-/Unterbewertet fällt. Nie eine erfundene Zahl. */
export function sectorValuationGap(row: SectorValuationInput): string | null {
  if (row.valuation === "Teuer" || row.valuation === "Attraktiv" || row.valuation === "Angemessen") return null;
  if (!finitePositive(row.pe) && !finitePositive(row.pe10y)) return "n/a — KGV und 10-Jahres-Spanne fehlen";
  if (!finitePositive(row.pe)) return "n/a — KGV fehlt";
  if (!finitePositive(row.pe10y)) return "n/a — 10-Jahres-KGV-Spanne fehlt";
  return "n/a — Bewertung nicht gesetzt";
}

function lineOf(row: SectorValuationInput, valuation: SectorValuationLine["valuation"], detail: string): SectorValuationLine {
  return { label: row.label, etf: row.etf, valuation, detail };
}

export function groupSectorValuation(rows: readonly SectorValuationInput[]): SectorValuationGroups {
  const overvalued: SectorValuationLine[] = [];
  const undervalued: SectorValuationLine[] = [];
  const mid: SectorValuationLine[] = [];
  const unavailable: SectorValuationLine[] = [];
  for (const row of rows) {
    const gap = sectorValuationGap(row);
    if (gap) {
      unavailable.push(lineOf(row, "n.v.", gap));
      continue;
    }
    const detail = `KGV ${de(row.pe as number)} / 10J ${de(row.pe10y as number)}`;
    if (row.valuation === "Teuer") overvalued.push(lineOf(row, "Teuer", detail));
    else if (row.valuation === "Attraktiv") undervalued.push(lineOf(row, "Attraktiv", detail));
    else mid.push(lineOf(row, "Angemessen", detail));
  }
  return { overvalued, undervalued, mid, unavailable };
}
