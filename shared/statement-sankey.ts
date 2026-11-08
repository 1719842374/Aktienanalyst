/**
 * Sankey aus bereits geladenen Jahreszahlen und gemeldeten Segmenten.
 * Flüsse mit Wert 0 werden nicht gezeichnet. Negative Beträge bleiben eine Notiz.
 * Keine neuen Top-Level-Segmente und keine Beispielzahlen.
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

export function incomeSankey(input: {
  segments: readonly SankeySegment[];
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
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
  const segmentSum = positiveSegments.reduce((sum, segment) => sum + (segment.revenue as number), 0);
  if (positiveSegments.length === 0) notes.push("n/a — keine Segmente, Sankey startet beim Umsatz");
  else if (segmentSum > revenue.value * 1.05) {
    notes.push("n/a — Segmentumsätze übersteigen den Umsatz, Segmente nicht als Zufluss gezeichnet");
  } else {
    for (const segment of positiveSegments) {
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
