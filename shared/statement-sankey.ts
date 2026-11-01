/**
 * Sankey Income / Balance aus bereits geladenen TTM-Zahlen und Segmenten
 * (WORK_DASHBOARD_FEATURES §1, zweite Ansicht). Keine neuen Top-Level-Segmente.
 * Fehlende Glieder werden ausgelassen und benannt, nie als 0 gezeichnet.
 */

export interface SankeySegment {
  name: string;
  revenue: number | null;
}

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyModel {
  title: string;
  links: SankeyLink[];
  notes: string[];
}

function pos(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

export function incomeSankey(input: {
  segments: readonly SankeySegment[];
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
}): SankeyModel {
  const notes: string[] = [];
  const links: SankeyLink[] = [];
  const revenue = pos(input.revenue);
  if (revenue == null) {
    return { title: "Income-Sankey", links: [], notes: ["n/a — Umsatz fehlt oder ist nicht positiv"] };
  }
  const segs = input.segments.filter(s => pos(s.revenue) != null && s.name.trim());
  const segSum = segs.reduce((sum, s) => sum + (s.revenue as number), 0);
  if (segs.length === 0) notes.push("n/a — keine Segmente, Sankey startet beim Umsatz");
  else if (segSum > revenue * 1.05) notes.push("n/a — Segmentumsätze übersteigen den Umsatz, Segmente nicht als Zufluss gezeichnet");
  else {
    for (const s of segs) links.push({ source: s.name, target: "Umsatz", value: s.revenue as number });
  }
  const gp = pos(input.grossProfit);
  if (gp == null || gp > revenue) notes.push("n/a — Bruttogewinn fehlt oder liegt über dem Umsatz");
  else {
    links.push({ source: "Umsatz", target: "Bruttogewinn", value: gp });
    const cogs = revenue - gp;
    if (cogs > 0) links.push({ source: "Umsatz", target: "Umsatzkosten", value: cogs });
  }
  const op = pos(input.operatingIncome);
  if (gp != null && op != null && op <= gp) {
    links.push({ source: "Bruttogewinn", target: "Operatives Ergebnis", value: op });
    const opex = gp - op;
    if (opex > 0) links.push({ source: "Bruttogewinn", target: "Betriebsaufwand", value: opex });
  } else notes.push("n/a — operatives Ergebnis fehlt oder liegt über dem Bruttogewinn");
  const ni = pos(input.netIncome);
  if (op != null && ni != null && ni <= op) {
    links.push({ source: "Operatives Ergebnis", target: "Jahresüberschuss", value: ni });
    const below = op - ni;
    if (below > 0) links.push({ source: "Operatives Ergebnis", target: "Steuern und Sonstiges", value: below });
  } else notes.push("n/a — Jahresüberschuss fehlt oder liegt über dem operativen Ergebnis");
  return { title: "Income-Sankey", links, notes };
}

export function balanceSankey(input: {
  totalAssets: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
}): SankeyModel {
  const assets = pos(input.totalAssets);
  if (assets == null) return { title: "Balance-Sankey", links: [], notes: ["n/a — Bilanzsumme fehlt oder ist nicht positiv"] };
  const notes: string[] = [];
  const links: SankeyLink[] = [];
  const equity = pos(input.totalEquity);
  const debt = input.totalDebt != null && Number.isFinite(input.totalDebt) && input.totalDebt > 0 ? input.totalDebt : null;
  if (equity == null) notes.push("n/a — Eigenkapital fehlt");
  else links.push({ source: "Aktiva", target: "Eigenkapital", value: equity });
  if (debt == null) notes.push("n/a — verzinsliche Schulden fehlen oder sind 0");
  else links.push({ source: "Aktiva", target: "Schulden", value: debt });
  const covered = (equity ?? 0) + (debt ?? 0);
  if (covered > assets * 1.02) notes.push("Hinweis — Eigenkapital + Schulden übersteigen die Aktiva, Darstellung nur der gemeldeten Teile");
  else if (assets - covered > 0 && (equity != null || debt != null)) {
    links.push({ source: "Aktiva", target: "Übrige Passiva", value: assets - covered });
  }
  return { title: "Balance-Sankey", links, notes };
}
