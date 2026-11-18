/**
 * YoY-Lücken für schon angezeigte Segmente und Regionen.
 * Dieselben Zahlen, die die UI schon hat. Keine zweite Umrechnung, kein Faktor 1.
 * Eine fehlende Zahl bleibt n/a. Der Median der Historie bleibt in segment-supplement.
 */

export const REVENUE_SUM_TOLERANCE_RATIO = 0.005;
export const YOY_MIX_TOLERANCE_PP = 1.5;

export interface MixRow {
  name: string;
  revenue: number | null;
  share: number | null;
  growth: number | null;
}

export interface MixCheck {
  revenueSum: number | null;
  revenueGap: number | null;
  revenueWithinTolerance: boolean | null;
  weightedYoY: number | null;
  yoyGap: number | null;
  yoyWithinTolerance: boolean | null;
  coveredSharePct: number | null;
  text: string;
}

export interface AnnualUsdRow {
  year: string;
  revenue: number;
}

export interface UsdSeries {
  currency: string;
  rows: AnnualUsdRow[];
  note: string | null;
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Vorjahr nur aus Konzernumsatz und Konzern-YoY. Kein Kurs, kein Faktor 1. */
export function priorFromGrowth(total: number | null, yoyPct: number | null): number | null {
  const revenue = finite(total);
  const yoy = finite(yoyPct);
  if (revenue == null || yoy == null || !(revenue > 0)) return null;
  const denom = 1 + yoy / 100;
  if (!(denom > 0)) return null;
  return Math.round((revenue / denom) * 1e6) / 1e6;
}

/**
 * Ohne Anteil, Segmentumsatz und Konzernumsatz gibt es keine Basis.
 * Ein einzelner belegter Anteil reicht, um die Lücke zu schätzen.
 */
export function notEstimableReason(
  rows: readonly MixRow[],
  company: { totalRevenue: number | null; companyYoY: number | null },
): string | null {
  const hasShare = rows.some((row) => finite(row.share) != null);
  const hasRevenue = rows.some((row) => finite(row.revenue) != null);
  if (hasShare || hasRevenue || finite(company.totalRevenue) != null) return null;
  return "n/a — nicht schätzbar (keine Anteile, keine Segmentumsätze, kein Konzernumsatz)";
}

/** Anteil × Konzernumsatz, fortgeschrieben nur mit einer echten YoY-Zahl. */
export function formulaText(share: number | null, total: number | null, growth: number | null): string {
  const sharePct = finite(share);
  const company = finite(total);
  if (sharePct == null || company == null) return "n/a — nicht schätzbar (Anteil oder Konzernumsatz fehlt)";
  const revenue = round2((sharePct / 100) * company);
  if (finite(growth) == null) {
    return `Anteil × Konzernumsatz = ${sharePct}% × ${company} = ${revenue}. n/a — nicht schätzbar (Segment-YoY fehlt)`;
  }
  const next = round2(revenue * (1 + (growth as number) / 100));
  return `Anteil × Konzernumsatz = ${sharePct}% × ${company} = ${revenue}; fortgeschrieben ${revenue} × (1 + ${growth}%) = ${next}`;
}

/** Σ Umsatz gegen Konzernumsatz und Σ(Anteil × YoY) gegen Konzern-YoY. Fehlende YoY zählt nicht als 0. */
export function checkSegmentMix(
  rows: readonly MixRow[],
  company: { totalRevenue: number | null; companyYoY: number | null },
): MixCheck {
  const revenues = rows.map((row) => finite(row.revenue)).filter((value): value is number => value != null);
  const revenueSum = revenues.length > 0 ? round2(revenues.reduce((sum, value) => sum + value, 0)) : null;
  const total = finite(company.totalRevenue);
  const revenueGap = revenueSum != null && total != null ? round2(revenueSum - total) : null;
  const revenueWithinTolerance = revenueGap != null && total != null && total > 0
    ? Math.abs(revenueGap) / total <= REVENUE_SUM_TOLERANCE_RATIO
    : null;

  let weighted = 0;
  let covered = 0;
  for (const row of rows) {
    const share = finite(row.share);
    const growth = finite(row.growth);
    if (share == null || growth == null) continue;
    weighted += (share / 100) * growth;
    covered += share;
  }
  const coveredSharePct = covered > 0 ? round2(covered) : null;
  const weightedYoY = covered > 0 ? round2(weighted) : null;
  const companyYoY = finite(company.companyYoY);
  const yoyGap = weightedYoY != null && companyYoY != null ? round2(weightedYoY - companyYoY) : null;
  const yoyWithinTolerance = yoyGap != null ? Math.abs(yoyGap) <= YOY_MIX_TOLERANCE_PP : null;

  const revenueText = revenueSum == null || total == null
    ? "Σ Segmentumsatz n/a — nicht schätzbar (Umsatz oder Konzernumsatz fehlt)"
    : `Σ Segmentumsatz ${revenueSum} gegen Konzernumsatz ${total}, Abweichung ${revenueGap} (${revenueWithinTolerance ? "innerhalb" : "außerhalb"} ${REVENUE_SUM_TOLERANCE_RATIO * 100}%)`;
  const yoyText = weightedYoY == null || companyYoY == null
    ? "Σ(Anteil × YoY) n/a — nicht schätzbar (YoY oder Konzern-YoY fehlt)"
    : `Σ(Anteil × YoY) ${weightedYoY}% gegen Konzern-YoY ${companyYoY}%, Abweichung ${yoyGap} Pp (${yoyWithinTolerance ? "innerhalb" : "außerhalb"} ${YOY_MIX_TOLERANCE_PP} Pp, gedeckt ${coveredSharePct}%)`;
  return {
    revenueSum,
    revenueGap,
    revenueWithinTolerance,
    weightedYoY,
    yoyGap,
    yoyWithinTolerance,
    coveredSharePct,
    text: `${revenueText}. ${yoyText}.`,
  };
}

/** Jahresreihe nur, wenn sie schon USD ist. Eine Fremdwährung wird nicht multipliziert. */
export function usdSeriesFromIncome(income: unknown): UsdSeries {
  if (!Array.isArray(income) || income.length === 0) return { currency: "", rows: [], note: null };
  const first = income.find((row) => row && typeof row === "object") as Record<string, unknown> | undefined;
  const raw = typeof first?.reportedCurrency === "string" ? first.reportedCurrency.trim().toUpperCase() : "";
  const currency = /^[A-Z]{3}$/.test(raw) ? raw : "";
  if (!currency) return { currency: "", rows: [], note: "n/a — Währung der Jahresreihe fehlt, keine Umrechnung" };
  if (currency !== "USD") return { currency, rows: [], note: `n/a — Jahresreihe in ${currency}, keine erneute Umrechnung` };
  const rows: AnnualUsdRow[] = [];
  for (const item of income) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const yearRaw = rec.fiscalYear ?? rec.calendarYear ?? (typeof rec.date === "string" ? rec.date.slice(0, 4) : "");
    const year = String(yearRaw);
    const revenue = typeof rec.revenue === "number" && Number.isFinite(rec.revenue) && rec.revenue > 0 ? rec.revenue : null;
    if (!/^(19|20)\d{2}$/.test(year) || revenue == null) continue;
    rows.push({ year, revenue });
  }
  return { currency: "USD", rows, note: null };
}

export interface GapPromptInput {
  kind: "product" | "geographic";
  factsBlock: string;
  rows: readonly MixRow[];
  contextRows: readonly MixRow[];
  contextLabel: string;
  companyName: string;
  industry: string;
  ticker: string;
  shareYear: string;
  totalRevenue: number | null;
  priorRevenue: number | null;
  companyYoY: number | null;
  annualNote: string | null;
  annualUsd: readonly AnnualUsdRow[];
  /** Hinweis, wenn Beträge nicht in USD sind und nicht umgerechnet werden. */
  amountNote?: string | null;
}

export function gapFillPrompt(input: GapPromptInput): string {
  const line = (row: MixRow) => `${row.name}: Umsatz ${row.revenue ?? "n/a"}, Anteil ${row.share ?? "n/a"}%, YoY ${row.growth ?? "n/a"}`;
  const knownLabel = input.kind === "geographic" ? "Bekannte Regionen" : "Bekannte Geschäftssegmente";
  const annual = input.annualUsd.length > 0
    ? `Jahresreihe USD: ${input.annualUsd.map((row) => `${row.year} ${row.revenue}`).join("; ")}. Nicht erneut umgerechnet.`
    : (input.annualNote ?? "Jahresreihe USD: n/a");
  const subject = input.kind === "geographic"
    ? "Nur Regionen. Schätze nur Zeilen mit YoY n/a."
    : "Nur Geschäftssegmente. Schätze nur Zeilen mit YoY n/a.";
  const parts = [
    input.factsBlock,
    `${knownLabel}: ${input.rows.map(line).join("; ")}.`,
    input.contextRows.length > 0 ? `${input.contextLabel}: ${input.contextRows.map(line).join("; ")}.` : "",
    `Bezugsjahr der Anteile: ${input.shareYear || "n/a"}.`,
    `Konzernumsatz USD (Anzeige, nicht erneut umgerechnet): ${input.totalRevenue ?? "n/a"}.`,
    `Konzernumsatz Vorjahr: ${input.priorRevenue ?? "n/a"}. Konzern-YoY: ${input.companyYoY ?? "n/a"}.`,
    input.amountNote ?? "",
    annual,
    "Formel: Segmentumsatz = Anteil/100 × Konzernumsatz. Fortgeschrieben = Segmentumsatz × (1 + Segment-YoY/100). Σ Segmentumsatz muss zum Konzernumsatz passen. Σ(Anteil × Segment-YoY) muss zum Konzern-YoY passen. Fehlende Zahl bleibt null. Keine erfundene Zahl. Kein Faktor 1.",
    `Firma: ${input.companyName}. Ticker ${input.ticker}.`,
    subject,
    "Eine Zeile mit einer YoY-Zahl bleibt unverändert und kommt nicht in children.",
    `Antwortform: {"companyEcho":"${input.companyName}","industryEcho":"${input.industry}","children":[{"name":"","owner":"${input.companyName}","shareOfParentPct":null,"growthPct":null,"basis":"Begründung der Lücke","source":null}]}.`,
    "basis nennt die Lücke und darf nicht leer sein. Eine Zahl nur mit Quelle, sonst null.",
  ];
  return parts.filter((part) => part.length > 0).join("\n");
}
