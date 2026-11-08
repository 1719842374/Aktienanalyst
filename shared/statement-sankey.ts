/**
 * Sankey aus bereits geladenen Jahreszahlen und gemeldeten Segmenten.
 * Flüsse mit Wert 0 werden nicht gezeichnet. Negative Beträge bleiben eine Notiz.
 * Keine neuen Top-Level-Segmente und keine Beispielzahlen.
 */

export interface SankeySegment {
  name: string;
  revenue: number | null;
  /** Vorhandenes Periodenlabel aus dem Payload. Nicht aus dem Tagesdatum ergänzt. */
  fiscalYear?: string | null;
  /** Vorhandene Berichtswährung. Nicht aus der Kurswährung ergänzt. */
  currency?: string | null;
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

type Flow =
  | { kind: "value"; value: number }
  | { kind: "missing" }
  | { kind: "zero" }
  | { kind: "negative" };

function classify(value: number | null | undefined): Flow {
  if (value == null || !Number.isFinite(value)) return { kind: "missing" };
  if (value < 0) return { kind: "negative" };
  if (value === 0) return { kind: "zero" };
  return { kind: "value", value };
}

function flowNote(label: string, flow: Flow): string | null {
  switch (flow.kind) {
    case "value":
      return null;
    case "missing":
      return `n/a — ${label} fehlt`;
    case "zero":
      return `n/a — ${label} ist 0, nicht gezeichnet`;
    case "negative":
      return `n/a — ${label} negativ, nicht als Fluss gezeichnet`;
    default: {
      const exhaustive: never = flow;
      return exhaustive;
    }
  }
}

function pushValue(links: SankeyLink[], source: string, target: string, flow: Flow): void {
  if (flow.kind === "value") links.push({ source, target, value: flow.value });
}

function yearToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/\d{4}/);
  return match ? match[0] : null;
}

function segmentCurrency(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return code.length > 0 ? code : null;
}

export function incomeSankey(input: {
  segments: readonly SankeySegment[];
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  statementYear: string | null;
  statementCurrency: string | null;
}): SankeyModel {
  const notes: string[] = [];
  const links: SankeyLink[] = [];
  const revenue = classify(input.revenue);
  const revenueNote = flowNote("Umsatz", revenue);
  if (revenue.kind !== "value") {
    return { title: "Income-Sankey", links: [], notes: [revenueNote ?? "n/a — Umsatz fehlt"] };
  }
  const positiveSegments = input.segments.filter((segment) => {
    const flow = classify(segment.revenue);
    return flow.kind === "value" && segment.name.trim().length > 0;
  });
  const dropped = input.segments.length - positiveSegments.length;
  if (dropped > 0) notes.push("n/a — Segment ohne positiven Umsatz nicht gezeichnet");
  const statementYear = yearToken(input.statementYear);
  const statementCurrency = segmentCurrency(input.statementCurrency);
  const matchedSegments: typeof positiveSegments = [];
  let missingYear = false;
  let yearMismatch = false;
  let missingCurrency = false;
  let currencyMismatch = false;
  if (!statementYear) notes.push("n/a — Abschlussjahr fehlt, Segmente nicht als Zufluss gezeichnet");
  else if (!statementCurrency) notes.push("n/a — Berichtswährung des Abschlusses fehlt, Segmente nicht als Zufluss gezeichnet");
  else {
    for (const segment of positiveSegments) {
      const segmentYear = yearToken(segment.fiscalYear);
      const currency = segmentCurrency(segment.currency);
      if (!segmentYear) missingYear = true;
      else if (segmentYear !== statementYear) yearMismatch = true;
      if (!currency) missingCurrency = true;
      else if (currency !== statementCurrency) currencyMismatch = true;
      if (segmentYear === statementYear && currency === statementCurrency) matchedSegments.push(segment);
    }
  }
  if (missingYear) notes.push("n/a — Segmentjahr fehlt im vorhandenen Payload, nicht aus dem Datum erraten");
  if (yearMismatch) notes.push("n/a — Segmentjahr passt nicht zum Abschlussjahr, Segmente nicht als Zufluss gezeichnet");
  if (missingCurrency) notes.push("n/a — Segmentwährung fehlt im vorhandenen Payload, nicht aus der Kurswährung erraten");
  if (currencyMismatch) notes.push("n/a — Segmentwährung und Abschlusswährung sind nicht gleich, keine Umrechnung");
  const segmentSum = matchedSegments.reduce((sum, segment) => sum + (segment.revenue as number), 0);
  const rejected = missingYear || yearMismatch || missingCurrency || currencyMismatch || !statementYear || !statementCurrency;
  if (matchedSegments.length === 0 && !rejected) notes.push("n/a — keine Segmente, Sankey startet beim Umsatz");
  else if (segmentSum > revenue.value * 1.05 && matchedSegments.length > 0) {
    notes.push("n/a — Segmentumsätze übersteigen den Umsatz, Segmente nicht als Zufluss gezeichnet");
  } else {
    for (const segment of matchedSegments) {
      links.push({ source: segment.name.trim(), target: "Umsatz", value: segment.revenue as number });
    }
  }
  const gross = classify(input.grossProfit);
  const grossNote = flowNote("Bruttogewinn", gross);
  if (gross.kind !== "value" || gross.value > revenue.value) {
    notes.push(gross.kind === "value" ? "n/a — Bruttogewinn liegt über dem Umsatz" : (grossNote ?? "n/a — Bruttogewinn fehlt"));
  } else {
    links.push({ source: "Umsatz", target: "Bruttogewinn", value: gross.value });
    const cogs = revenue.value - gross.value;
    if (cogs > 0) links.push({ source: "Umsatz", target: "Umsatzkosten", value: cogs });
  }
  const operating = classify(input.operatingIncome);
  const operatingNote = flowNote("operatives Ergebnis", operating);
  if (gross.kind === "value" && operating.kind === "value" && operating.value <= gross.value) {
    links.push({ source: "Bruttogewinn", target: "Operatives Ergebnis", value: operating.value });
    const opex = gross.value - operating.value;
    if (opex > 0) links.push({ source: "Bruttogewinn", target: "Betriebsaufwand", value: opex });
  } else if (operating.kind === "value" && gross.kind === "value" && operating.value > gross.value) {
    notes.push("n/a — operatives Ergebnis liegt über dem Bruttogewinn");
  } else {
    notes.push(operatingNote ?? "n/a — operatives Ergebnis fehlt");
  }
  const net = classify(input.netIncome);
  const netNote = flowNote("Jahresüberschuss", net);
  if (operating.kind === "value" && net.kind === "value" && net.value <= operating.value) {
    links.push({ source: "Operatives Ergebnis", target: "Jahresüberschuss", value: net.value });
    const below = operating.value - net.value;
    if (below > 0) links.push({ source: "Operatives Ergebnis", target: "Steuern und Sonstiges", value: below });
  } else if (net.kind === "negative") {
    notes.push("n/a — Jahresüberschuss negativ, nicht als Fluss gezeichnet");
  } else if (net.kind === "value" && operating.kind === "value" && net.value > operating.value) {
    notes.push("n/a — Jahresüberschuss liegt über dem operativen Ergebnis");
  } else if (operating.kind !== "value") {
    notes.push("n/a — Jahresüberschuss ohne operatives Ergebnis nicht gezeichnet");
  } else {
    notes.push(netNote ?? "n/a — Jahresüberschuss fehlt");
  }
  return { title: "Income-Sankey", links, notes };
}

export function balanceSankey(input: {
  totalAssets: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
}): SankeyModel {
  const assets = classify(input.totalAssets);
  const assetNote = flowNote("Bilanzsumme", assets);
  if (assets.kind !== "value") {
    return { title: "Balance-Sankey", links: [], notes: [assetNote ?? "n/a — Bilanzsumme fehlt"] };
  }
  const notes: string[] = [];
  const links: SankeyLink[] = [];
  const equity = classify(input.totalEquity);
  const debt = classify(input.totalDebt);
  const equityNote = flowNote("Eigenkapital", equity);
  const debtNote = flowNote("verzinsliche Schulden", debt);
  if (equityNote) notes.push(equityNote);
  if (debtNote) notes.push(debtNote);
  pushValue(links, "Aktiva", "Eigenkapital", equity);
  pushValue(links, "Aktiva", "Schulden", debt);
  const covered = links.reduce((sum, link) => sum + link.value, 0);
  if (covered > assets.value * 1.02) {
    notes.push("Hinweis — gezeichnete Passiva übersteigen die Aktiva, kein Ausgleichsfluss");
  } else {
    const rest = assets.value - covered;
    if (rest > 0 && links.length > 0) links.push({ source: "Aktiva", target: "Übrige Passiva", value: rest });
  }
  return { title: "Balance-Sankey", links, notes };
}
