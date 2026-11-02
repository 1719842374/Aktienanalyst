/**
 * GuV-Posten für den KI-Chat (Antwort im Stil „Kernzahl, Tabelle, Ausreißer, Quelle“).
 * Reine Typen und Auswahl. Kein Abruf, kein Score. Eingabe sind SEC-EDGAR-companyfacts (XBRL)
 * oder FMP-Income-Statements; jeder Wert trägt Konzept, Periode und Filing.
 * Fehlende Werte sind null plus Grund, nie 0 und nie geschätzt.
 */

export type IncomeTaxonomy = "us-gaap" | "ifrs-full";

/** Gruppe = Zeile der GuV mit ihren Unterposten (Summenprüfung und Ausreißer je Gruppe). */
export type IncomeLineGroup = "umsatz" | "kosten" | "betrieb" | "ergebnis" | "sonstiges";

export interface IncomeLineDef {
  key: string;
  label: string;
  group: IncomeLineGroup;
  /** Summenzeile, zu der der Posten gehört (Unterposten). */
  parentKey?: string;
  /** Erste vorhandene Konzept-ID gewinnt. */
  concepts: Partial<Record<IncomeTaxonomy, readonly string[]>>;
  /** FMP-Feld im Income-Statement, falls vorhanden. */
  fmpField?: string;
  /** −1: Konzept meldet einen Aufwand positiv, in der Aufschlüsselung zählt er negativ. */
  sign?: 1 | -1;
  /** So heißt der Posten im Filing-Text (Erklärungssätze im MD&A). */
  filingTerms: readonly RegExp[];
}

export const INCOME_LINE_DEFS: readonly IncomeLineDef[] = [
  { key: "umsatz", label: "Umsatz", group: "umsatz", fmpField: "revenue",
    concepts: { "us-gaap": ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"], "ifrs-full": ["Revenue"] },
    filingTerms: [/\b(total )?revenues? (increased|decreased|grew|was)\b/i] },
  { key: "umsatzkosten", label: "Umsatzkosten", group: "kosten", fmpField: "costOfRevenue",
    concepts: { "us-gaap": ["CostOfGoodsAndServicesSold", "CostOfRevenue"], "ifrs-full": ["CostOfSales"] },
    filingTerms: [/\bcost of (revenue|sales|goods sold)\b/i] },
  { key: "bruttoergebnis", label: "Bruttoergebnis", group: "ergebnis", fmpField: "grossProfit",
    concepts: { "us-gaap": ["GrossProfit"], "ifrs-full": ["GrossProfit"] },
    filingTerms: [/\bgross (margin|profit)\b/i] },
  { key: "betriebsaufwand", label: "Betriebsaufwand gesamt", group: "betrieb", fmpField: "operatingExpenses",
    concepts: { "us-gaap": ["OperatingExpenses"] },
    filingTerms: [/\boperating expenses (increased|decreased)\b/i] },
  { key: "forschung", label: "Forschung und Entwicklung", group: "betrieb", parentKey: "betriebsaufwand", fmpField: "researchAndDevelopmentExpenses",
    concepts: { "us-gaap": ["ResearchAndDevelopmentExpense"], "ifrs-full": ["ResearchAndDevelopmentExpense"] },
    filingTerms: [/\bresearch and development expenses? (increased|decreased)\b/i, /\bresearch and development\b/i] },
  { key: "vertrieb", label: "Vertrieb und Marketing", group: "betrieb", parentKey: "betriebsaufwand", fmpField: "sellingAndMarketingExpenses",
    concepts: { "us-gaap": ["SellingAndMarketingExpense"], "ifrs-full": ["SalesAndMarketingExpense"] },
    filingTerms: [/\bsales and marketing expenses? (increased|decreased)\b/i, /\bsales and marketing\b/i] },
  { key: "verwaltung", label: "Allgemeine Verwaltung", group: "betrieb", parentKey: "betriebsaufwand", fmpField: "generalAndAdministrativeExpenses",
    concepts: { "us-gaap": ["GeneralAndAdministrativeExpense"], "ifrs-full": ["AdministrativeExpense"] },
    filingTerms: [/\bgeneral and administrative expenses? (increased|decreased)\b/i, /\bgeneral and administrative\b/i] },
  { key: "vertriebVerwaltung", label: "Vertrieb, Verwaltung (SG&A)", group: "betrieb", parentKey: "betriebsaufwand", fmpField: "sellingGeneralAndAdministrativeExpenses",
    concepts: { "us-gaap": ["SellingGeneralAndAdministrativeExpense"] },
    filingTerms: [/\bselling, general and administrative\b/i] },
  { key: "betriebsergebnis", label: "Betriebsergebnis", group: "ergebnis", fmpField: "operatingIncome",
    concepts: { "us-gaap": ["OperatingIncomeLoss"], "ifrs-full": ["ProfitLossFromOperatingActivities"] },
    filingTerms: [/\boperating income (increased|decreased)\b/i] },
  { key: "sonstigesNetto", label: "Sonstige Erträge/Aufwendungen netto", group: "sonstiges", fmpField: "totalOtherIncomeExpensesNet",
    concepts: { "us-gaap": ["NonoperatingIncomeExpense"], "ifrs-full": ["FinanceIncomeCost"] },
    filingTerms: [/\bother income \(expense\),? net included\b/i, /\bother income\/\(expense\),? net\b/i, /\bnet finance income\b/i] },
  { key: "zinsDividendenertrag", label: "Zins- und Dividendenerträge", group: "sonstiges", parentKey: "sonstigesNetto", fmpField: "interestIncome",
    concepts: { "us-gaap": ["InvestmentIncomeNet", "InvestmentIncomeInterestAndDividend", "InvestmentIncomeInterest"], "ifrs-full": ["FinanceIncome"] },
    filingTerms: [/\binterest and dividends? income (increased|decreased)\b/i, /\binterest income\b/i, /\bfinance income\b/i] },
  { key: "zinsaufwand", label: "Zinsaufwand", group: "sonstiges", parentKey: "sonstigesNetto", fmpField: "interestExpense", sign: -1,
    concepts: { "us-gaap": ["InterestExpenseNonoperating", "InterestExpense"], "ifrs-full": ["FinanceCosts"] },
    filingTerms: [/\binterest expense (increased|decreased)\b/i, /\bfinance costs\b/i] },
  { key: "anlageergebnis", label: "Realisierte Gewinne/Verluste aus Finanzanlagen", group: "sonstiges", parentKey: "sonstigesNetto",
    concepts: { "us-gaap": ["GainLossOnInvestments", "DebtAndEquitySecuritiesGainLoss", "MarketableSecuritiesRealizedGainLossExcludingOtherThanTemporaryImpairments"] },
    filingTerms: [/\bnet recognized (gains|losses)( \((gains|losses)\))? on investments\b/i, /\b(gains|losses) on investments\b/i] },
  { key: "derivate", label: "Gewinne/Verluste aus Derivaten", group: "sonstiges", parentKey: "sonstigesNetto",
    concepts: { "us-gaap": ["GainLossOnDerivativeInstrumentsNetPretax", "DerivativeGainLossOnDerivativeNet"] },
    filingTerms: [/\bnet (gains|losses)( \((gains|losses)\))? on derivatives\b/i, /\bderivatives? (increased|decreased)\b/i] },
  { key: "waehrung", label: "Währungseffekte", group: "sonstiges", parentKey: "sonstigesNetto",
    concepts: { "us-gaap": ["ForeignCurrencyTransactionGainLossBeforeTax"] },
    filingTerms: [/\bforeign currency remeasurements?\b/i, /\bforeign exchange (gains|losses)\b/i] },
  { key: "equityMethode", label: "Ergebnis aus At-Equity-Beteiligungen", group: "sonstiges", parentKey: "sonstigesNetto",
    concepts: { "us-gaap": ["IncomeLossFromEquityMethodInvestments"], "ifrs-full": ["ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod"] },
    filingTerms: [/\bequity method investments?\b/i] },
  { key: "sonstigesUebrig", label: "Übrige, netto", group: "sonstiges", parentKey: "sonstigesNetto",
    concepts: { "us-gaap": ["OtherNonoperatingIncomeExpense"] },
    filingTerms: [/\bOther, net (primarily )?(reflects|includes|increased|decreased|was)\b/, /\bOther, net\b/] },
  { key: "vorSteuern", label: "Ergebnis vor Steuern", group: "ergebnis", fmpField: "incomeBeforeTax",
    concepts: { "us-gaap": ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"], "ifrs-full": ["ProfitLossBeforeTax"] },
    filingTerms: [/\bincome before income taxes\b/i] },
  { key: "steuern", label: "Ertragsteuern", group: "ergebnis", fmpField: "incomeTaxExpense",
    concepts: { "us-gaap": ["IncomeTaxExpenseBenefit"], "ifrs-full": ["IncomeTaxExpenseContinuingOperations"] },
    filingTerms: [/\beffective tax rate (increased|decreased|was)\b/i, /\bprovision for income taxes\b/i] },
  { key: "nettoergebnis", label: "Nettoergebnis", group: "ergebnis", fmpField: "netIncome",
    concepts: { "us-gaap": ["NetIncomeLoss"], "ifrs-full": ["ProfitLoss"] },
    filingTerms: [/\bnet income (increased|decreased)\b/i] },
];

/** Formulare mit belastbaren GuV-Zahlen. 10-Q = Quartal, die übrigen = Geschäftsjahr. */
export const INCOME_FORMS_QUARTER = ["10-Q"] as const;
export const INCOME_FORMS_ANNUAL = ["10-K", "20-F", "40-F"] as const;

/** Periodenlängen in Tagen (Kalender, nicht Handelstage). */
export const INCOME_PERIOD_DAYS = { quarter: 91, year: 365 } as const;
/** Erlaubte Abweichung der Periodenlänge und des Vorjahres-Enddatums (52/53-Wochen-Jahre, Retail-Quartale). */
export const INCOME_PERIOD_TOLERANCE_DAYS = 14;
/** Darstellung in Millionen der Berichtswährung (wie die Tabellen im Filing). */
export const INCOME_DISPLAY_SCALE = 1_000_000;
/** So viele Erklärungssätze aus dem Filing je Ausreißer. */
export const INCOME_EXPLANATION_SENTENCES = 2;

/** Wörter, an denen ein Erklärungssatz im MD&A zu erkennen ist. */
const EXPLANATION_CUE = /\b(primarily|mainly|due to|driven by|reflects?|reflecting|attributable to|as a result of|offset|included)\b/i;
const CHANGE_CUE = /\b(increased|decreased|higher|lower|grew|declined|gains?|losses?)\b/i;

export interface IncomePeriod {
  start: string | null;
  end: string;
  /** z. B. "Q1 FY2027" oder "FY2025". */
  label: string;
  fiscalYear: number | null;
  fiscalPeriod: string | null;
}

export interface IncomeStatementLine {
  key: string;
  label: string;
  group: IncomeLineGroup;
  parentKey: string | null;
  /** "us-gaap:InterestExpenseNonoperating" bzw. "fmp:interestExpense". */
  concept: string;
  /** Wert wie in der GuV-Aufschlüsselung (Aufwand bei sign −1 negativ), Berichtswährung absolut. */
  current: number | null;
  prior: number | null;
  deltaAbs: number | null;
  /** Veränderung relativ zum Betrag des Vorjahres in %. */
  deltaPct: number | null;
}

export interface IncomeGroupCheck {
  group: IncomeLineGroup;
  parentKey: string;
  reported: number;
  sumOfParts: number;
  diff: number;
  parts: number;
}

export interface IncomeOutlier {
  group: IncomeLineGroup;
  key: string;
  label: string;
  current: number | null;
  prior: number | null;
  deltaAbs: number;
  explanation: string | null;
  explanationReason: string | null;
}

export interface IncomeStatementBrief {
  symbol: string;
  status: "ok" | "n/a";
  reason: string | null;
  /** "sec-edgar/companyfacts" oder "fmp/income-statement". */
  source: string | null;
  form: string | null;
  accession: string | null;
  filed: string | null;
  filingUrl: string | null;
  companyName: string | null;
  currency: string | null;
  period: IncomePeriod | null;
  priorPeriod: IncomePeriod | null;
  lines: IncomeStatementLine[];
  checks: IncomeGroupCheck[];
  outliers: IncomeOutlier[];
  notes: string[];
}

export function incomeBriefNa(symbol: string, reason: string): IncomeStatementBrief {
  return {
    symbol, status: "n/a", reason, source: null, form: null, accession: null, filed: null, filingUrl: null,
    companyName: null, currency: null, period: null, priorPeriod: null, lines: [], checks: [], outliers: [], notes: [],
  };
}

interface FactPoint {
  start?: string;
  end: string;
  val: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

const DAY_MS = 86_400_000;
function days(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

function usablePoints(raw: unknown): FactPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is FactPoint => !!p && typeof p === "object"
    && typeof (p as FactPoint).end === "string" && typeof (p as FactPoint).val === "number" && Number.isFinite((p as FactPoint).val));
}

function conceptUnits(facts: any, taxonomy: IncomeTaxonomy, concept: string): Record<string, FactPoint[]> | null {
  const units = facts?.facts?.[taxonomy]?.[concept]?.units;
  if (!units || typeof units !== "object") return null;
  const out: Record<string, FactPoint[]> = {};
  for (const [unit, pts] of Object.entries(units)) {
    if (unit.includes("/")) continue;
    out[unit] = usablePoints(pts);
  }
  return out;
}

function taxonomyOf(facts: any): IncomeTaxonomy | null {
  if (facts?.facts?.["us-gaap"]) return "us-gaap";
  if (facts?.facts?.["ifrs-full"]) return "ifrs-full";
  return null;
}

const ALL_FORMS: readonly string[] = [...INCOME_FORMS_QUARTER, ...INCOME_FORMS_ANNUAL];

/** Jüngstes Filing (nach Einreichdatum), das GuV-Konzepte liefert, und dessen Berichtsperiode. */
function latestFiling(facts: any, taxonomy: IncomeTaxonomy): { accn: string; form: string; filed: string; currency: string; period: IncomePeriod; kind: "quarter" | "year" } | null {
  let best: { p: FactPoint; unit: string } | null = null;
  for (const def of INCOME_LINE_DEFS) {
    for (const concept of def.concepts[taxonomy] ?? []) {
      const units = conceptUnits(facts, taxonomy, concept);
      if (!units) continue;
      for (const [unit, pts] of Object.entries(units)) {
        for (const p of pts) {
          if (!p.form || !ALL_FORMS.includes(p.form) || !p.accn || !p.filed || !p.start) continue;
          if (!best || p.filed > (best.p.filed ?? "") || (p.filed === best.p.filed && p.end > best.p.end)) best = { p, unit };
        }
      }
    }
  }
  if (!best) return null;
  const accn = best.p.accn!;
  const form = best.p.form!;
  const kind: "quarter" | "year" = (INCOME_FORMS_QUARTER as readonly string[]).includes(form) ? "quarter" : "year";
  const target = kind === "quarter" ? INCOME_PERIOD_DAYS.quarter : INCOME_PERIOD_DAYS.year;
  let period: FactPoint | null = null;
  for (const def of INCOME_LINE_DEFS) {
    for (const concept of def.concepts[taxonomy] ?? []) {
      for (const pts of Object.values(conceptUnits(facts, taxonomy, concept) ?? {})) {
        for (const p of pts) {
          if (p.accn !== accn || !p.start) continue;
          if (Math.abs(days(p.start, p.end) - target) > INCOME_PERIOD_TOLERANCE_DAYS) continue;
          if (!period || p.end > period.end) period = p;
        }
      }
    }
  }
  if (!period) return null;
  return { accn, form, filed: best.p.filed!, currency: best.unit, kind, period: periodOf(period, kind) };
}

function periodOf(p: FactPoint, kind: "quarter" | "year"): IncomePeriod {
  const fp = typeof p.fp === "string" ? p.fp : null;
  const fy = typeof p.fy === "number" ? p.fy : null;
  const label = kind === "year"
    ? (fy != null ? `FY${fy}` : `GJ bis ${p.end}`)
    : (fy != null && fp && /^Q[1-4]$/.test(fp) ? `${fp} FY${fy}` : `Quartal bis ${p.end}`);
  return { start: p.start ?? null, end: p.end, label, fiscalYear: fy, fiscalPeriod: fp };
}

function sameSpan(p: FactPoint, start: string | null, end: string): boolean {
  return p.end === end && (p.start ?? null) === start;
}

function priorSpan(p: FactPoint, start: string | null, end: string): boolean {
  if (!p.start || !start) return false;
  const lenNow = days(start, end);
  const lenThen = days(p.start, p.end);
  const shift = days(p.end, end);
  return Math.abs(lenNow - lenThen) <= INCOME_PERIOD_TOLERANCE_DAYS
    && Math.abs(shift - INCOME_PERIOD_DAYS.year) <= INCOME_PERIOD_TOLERANCE_DAYS;
}

/** Bevorzugt den Wert aus dem aktuellen Filing (Vergleichsspalte), sonst das jüngste andere. */
function pickPoint(pts: FactPoint[], accn: string, match: (p: FactPoint) => boolean): FactPoint | null {
  const hits = pts.filter(match);
  if (!hits.length) return null;
  const own = hits.find(p => p.accn === accn);
  if (own) return own;
  return hits.sort((a, b) => ((a.filed ?? "") < (b.filed ?? "") ? 1 : -1))[0];
}

function lineFrom(def: IncomeLineDef, concept: string, current: number | null, prior: number | null): IncomeStatementLine {
  const sign = def.sign ?? 1;
  const c = current == null ? null : current * sign;
  const p = prior == null ? null : prior * sign;
  const deltaAbs = c != null && p != null ? c - p : null;
  const deltaPct = deltaAbs != null && p != null && p !== 0 ? (deltaAbs / Math.abs(p)) * 100 : null;
  return { key: def.key, label: def.label, group: def.group, parentKey: def.parentKey ?? null, concept, current: c, prior: p, deltaAbs, deltaPct };
}

/** Summenprüfung: ausgewiesene Summenzeile gegen die Summe ihrer Unterposten. */
export function incomeGroupChecks(lines: IncomeStatementLine[]): IncomeGroupCheck[] {
  const out: IncomeGroupCheck[] = [];
  for (const parent of lines) {
    const parts = lines.filter(l => l.parentKey === parent.key && l.current != null);
    if (!parts.length || parent.current == null) continue;
    const sum = parts.reduce((a, l) => a + (l.current as number), 0);
    const reported = parent.group === "betrieb" ? Math.abs(parent.current) : parent.current;
    out.push({ group: parent.group, parentKey: parent.key, reported, sumOfParts: sum, diff: reported - sum, parts: parts.length });
  }
  return out;
}

/** Größte absolute Veränderung je Gruppe mit Unterposten (der Ausreißer gegen das Vorjahr). */
export function incomeOutliers(lines: IncomeStatementLine[]): IncomeOutlier[] {
  const out: IncomeOutlier[] = [];
  const parents = new Set(lines.filter(l => l.parentKey).map(l => l.parentKey as string));
  for (const parentKey of Array.from(parents)) {
    const parts = lines.filter(l => l.parentKey === parentKey && l.deltaAbs != null);
    if (!parts.length) continue;
    const top = parts.reduce((a, b) => (Math.abs(b.deltaAbs as number) > Math.abs(a.deltaAbs as number) ? b : a));
    out.push({ group: top.group, key: top.key, label: top.label, current: top.current, prior: top.prior, deltaAbs: top.deltaAbs as number, explanation: null, explanationReason: null });
  }
  return out;
}

/** GuV aus SEC-companyfacts. Ohne passende Daten: n/a mit Grund. */
export function incomeBriefFromCompanyFacts(symbol: string, facts: unknown, filing?: { url: string | null } | null): IncomeStatementBrief {
  const f = facts as any;
  const taxonomy = taxonomyOf(f);
  if (!taxonomy) return incomeBriefNa(symbol, "n/a — SEC companyfacts enthält weder us-gaap noch ifrs-full");
  const latest = latestFiling(f, taxonomy);
  if (!latest) return incomeBriefNa(symbol, "n/a — kein 10-Q/10-K/20-F mit GuV-Konzepten in den SEC companyfacts");
  const { accn, period } = latest;
  const lines: IncomeStatementLine[] = [];
  for (const def of INCOME_LINE_DEFS) {
    for (const concept of def.concepts[taxonomy] ?? []) {
      const pts = conceptUnits(f, taxonomy, concept)?.[latest.currency] ?? [];
      const cur = pickPoint(pts, accn, p => sameSpan(p, period.start, period.end));
      if (!cur) continue;
      const pri = pickPoint(pts, accn, p => priorSpan(p, period.start, period.end));
      lines.push(lineFrom(def, `${taxonomy}:${concept}`, cur.val, pri?.val ?? null));
      break;
    }
  }
  if (!lines.length) return incomeBriefNa(symbol, `n/a — keine GuV-Zeile für ${period.label} im Filing ${accn}`);
  const kindLabel = latest.kind === "quarter" ? "Quartal" : "Geschäftsjahr";
  const priorEnd = new Date(Date.parse(period.end) - INCOME_PERIOD_DAYS.year * DAY_MS).toISOString().slice(0, 10);
  const priorLine = lines.find(l => l.prior != null);
  const notes: string[] = [];
  if (latest.kind === "year") notes.push(`Jüngstes XBRL-Filing ist ein ${latest.form} (${kindLabel}); Quartalszahlen liegen dafür nicht in den companyfacts`);
  if (!priorLine) notes.push("Vorjahreswerte fehlen im Filing (n/a)");
  return {
    symbol, status: "ok", reason: null, source: "sec-edgar/companyfacts", form: latest.form, accession: accn, filed: latest.filed,
    filingUrl: filing?.url ?? null, companyName: typeof f?.entityName === "string" ? f.entityName : null, currency: latest.currency,
    period,
    priorPeriod: priorLine ? { start: null, end: priorEnd, label: priorLabel(period, latest.kind), fiscalYear: period.fiscalYear != null ? period.fiscalYear - 1 : null, fiscalPeriod: period.fiscalPeriod } : null,
    lines, checks: incomeGroupChecks(lines), outliers: incomeOutliers(lines), notes,
  };
}

function priorLabel(p: IncomePeriod, kind: "quarter" | "year"): string {
  if (p.fiscalYear == null) return "Vorjahresperiode";
  return kind === "year" ? `FY${p.fiscalYear - 1}` : `${p.fiscalPeriod} FY${p.fiscalYear - 1}`;
}

/** GuV aus FMP-Quartalszeilen (zweite Quelle). Vorjahr = gleiches Quartal, Geschäftsjahr − 1. */
export function incomeBriefFromFmp(symbol: string, rows: unknown): IncomeStatementBrief {
  if (!Array.isArray(rows) || !rows.length) return incomeBriefNa(symbol, "n/a — FMP lieferte keine Quartals-GuV");
  const valid = rows.filter((r: any) => r && typeof r.date === "string");
  if (!valid.length) return incomeBriefNa(symbol, "n/a — FMP-Quartalszeilen ohne Datum");
  valid.sort((a: any, b: any) => (a.date < b.date ? 1 : -1));
  const cur: any = valid[0];
  const fy = Number(cur.fiscalYear ?? cur.calendarYear);
  const pri: any = valid.find((r: any) => r.period === cur.period && Number(r.fiscalYear ?? r.calendarYear) === fy - 1) ?? null;
  const lines: IncomeStatementLine[] = [];
  for (const def of INCOME_LINE_DEFS) {
    if (!def.fmpField) continue;
    const c = Number(cur[def.fmpField]);
    if (!Number.isFinite(c) || cur[def.fmpField] == null) continue;
    const p = pri ? Number(pri[def.fmpField]) : NaN;
    lines.push(lineFrom(def, `fmp:${def.fmpField}`, c, Number.isFinite(p) ? p : null));
  }
  if (!lines.length) return incomeBriefNa(symbol, "n/a — FMP-Quartalszeile ohne GuV-Felder");
  const label = Number.isFinite(fy) && typeof cur.period === "string" ? `${cur.period} FY${fy}` : `Quartal bis ${cur.date}`;
  return {
    symbol, status: "ok", reason: null, source: "fmp/income-statement", form: null, accession: null,
    filed: typeof cur.filingDate === "string" ? cur.filingDate : null,
    filingUrl: typeof cur.finalLink === "string" ? cur.finalLink : typeof cur.link === "string" ? cur.link : null,
    companyName: null, currency: typeof cur.reportedCurrency === "string" ? cur.reportedCurrency : null,
    period: { start: null, end: cur.date, label, fiscalYear: Number.isFinite(fy) ? fy : null, fiscalPeriod: typeof cur.period === "string" ? cur.period : null },
    priorPeriod: pri ? { start: null, end: pri.date, label: `${pri.period} FY${fy - 1}`, fiscalYear: fy - 1, fiscalPeriod: pri.period } : null,
    lines, checks: incomeGroupChecks(lines), outliers: incomeOutliers(lines),
    notes: ["FMP enthält keine Unterposten von Derivaten, Finanzanlagen und Währung; Erklärung aus dem Filing-Text n/a"],
  };
}

/** Teilt Filing-Fließtext in Sätze. Dezimalpunkte ("$4.1 billion") trennen nicht. */
export function splitFilingSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+(?=[A-Z“"(])/).map(s => s.trim()).filter(s => s.length > 20);
}

/**
 * Erklärungssätze aus dem Filing für einen Posten: der Satz muss den Posten nennen und eine
 * Ursache angeben ("primarily due to", "reflects", "included"). Tabellenzeilen fallen weg.
 */
export function findFilingExplanation(sentences: string[], terms: readonly RegExp[], max = INCOME_EXPLANATION_SENTENCES): string[] {
  const hits: Array<{ i: number; score: number }> = [];
  sentences.forEach((s, i) => {
    if (!terms.some(t => t.test(s))) return;
    if (!EXPLANATION_CUE.test(s)) return;
    const digits = (s.match(/\d/g) ?? []).length;
    if (digits > s.length / 6) return;
    const score = (CHANGE_CUE.test(s) ? 2 : 0) + (/\bprimarily|due to|reflects\b/i.test(s) ? 1 : 0);
    hits.push({ i, score });
  });
  const seen = new Set<string>();
  return hits.sort((a, b) => b.score - a.score || a.i - b.i)
    .map(h => sentences[h.i])
    .filter(s => (seen.has(s) ? false : (seen.add(s), true)))
    .slice(0, max);
}

/** Ergänzt die Ausreißer um Sätze aus dem Filing (Posten zuerst, dann die Summenzeile der Gruppe). */
export function withFilingExplanations(brief: IncomeStatementBrief, filingText: string | null, unavailableReason: string): IncomeStatementBrief {
  if (!brief.outliers.length) return brief;
  if (!filingText) return { ...brief, outliers: brief.outliers.map(o => ({ ...o, explanationReason: unavailableReason })) };
  const sentences = splitFilingSentences(filingText);
  const outliers = brief.outliers.map(o => {
    const def = INCOME_LINE_DEFS.find(d => d.key === o.key);
    const parent = INCOME_LINE_DEFS.find(d => d.key === def?.parentKey);
    const own = def ? findFilingExplanation(sentences, def.filingTerms) : [];
    const group = parent ? findFilingExplanation(sentences, parent.filingTerms, 1) : [];
    const picked = Array.from(new Set([...group, ...own])).slice(0, INCOME_EXPLANATION_SENTENCES + 1);
    return picked.length
      ? { ...o, explanation: picked.join(" "), explanationReason: null }
      : { ...o, explanationReason: `n/a — im ${brief.form ?? "Filing"} steht kein Erklärungssatz zu „${o.label}“` };
  });
  return { ...brief, outliers };
}

export function formatIncomeMio(v: number | null, currency: string | null): string {
  if (v == null) return "n/a";
  const m = v / INCOME_DISPLAY_SCALE;
  const digits = Math.abs(m) >= 100 ? 0 : 1;
  const s = Math.abs(m).toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${m < 0 ? "−" : ""}${s} Mio ${currency ?? ""}`.trim();
}

export function formatIncomePct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toLocaleString("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} %`;
}
