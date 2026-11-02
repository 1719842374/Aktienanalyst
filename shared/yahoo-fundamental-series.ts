/**
 * Jahreszahlen aus Yahoo quoteSummary und fundamentals-timeseries.
 * Earnings Yield = EBIT / EV, ROIC = NOPAT / Invested Capital.
 * Fehlende oder nur als Platzhalter genullte Felder bleiben n/a, nie 0.
 */
import { earningsYieldPct, type EpsQuarter, type FundamentalPoint, type TtmPrint } from "./earnings-yield-roic";

export const YAHOO_QS_EY_SOURCE = "Yahoo quoteSummary incomeStatementHistory + defaultKeyStatistics.enterpriseValue";
export const YAHOO_QS_ROIC_SOURCE = "Yahoo quoteSummary incomeStatementHistory + balanceSheetHistory";
export const YAHOO_TS_EY_SOURCE = "Yahoo fundamentals-timeseries annualEBIT + annualEnterpriseValue";
export const YAHOO_TS_ROIC_SOURCE = "Yahoo fundamentals-timeseries annualEBIT, annualTaxProvision, annualPretaxIncome, annualInvestedCapital";
export const YAHOO_TS_EPS_SOURCE = "Yahoo fundamentals-timeseries quarterlyDilutedEPS";
export const YAHOO_EPS_ASOF_NOTE = "Zeitstempel ist das Yahoo-asOfDate (Periodenende), kein separates Filing-Datum";
export const YAHOO_QS_TRAILING_PE_SOURCE = "Yahoo quoteSummary summaryDetail.trailingPE";
export const YAHOO_V7_TRAILING_PE_SOURCE = "Yahoo v7 quote trailingPE";
export const YAHOO_TS_TRAILING_PE_SOURCE = "Yahoo fundamentals-timeseries trailingPeRatio";
export const YAHOO_HTML_TRAILING_PE_SOURCE = "Yahoo Finance Quote summaryDetail.trailingPE";

/** Unix-Sekunden liegen unter diesem Schnitt, Millisekunden darüber. */
const UNIX_MS_CUTOFF = 10_000_000_000;

/** Tage eines Schaltjahrs, damit ein Geschäftsjahresende nicht aus dem Fenster fällt. */
export const DAYS_PER_FISCAL_YEAR = 366;

export const YAHOO_EPS_TYPES = ["quarterlyDilutedEPS", "quarterlyBasicEPS", "trailingDilutedEPS"] as const;
export const YAHOO_ANNUAL_EPS_TYPE = "annualDilutedEPS";

export const YAHOO_ANNUAL_TYPES = [
  "annualEBIT",
  "annualOperatingIncome",
  "annualPretaxIncome",
  "annualTaxProvision",
  "annualInvestedCapital",
  "annualEnterpriseValue",
  "annualTotalDebt",
  "annualCashAndCashEquivalents",
  "annualStockholdersEquity",
] as const;

export interface MoneyPoint {
  value: number;
  currency: string | null;
}

export interface AnnualFundamental {
  date: string;
  ebit: MoneyPoint | null;
  operatingIncome: MoneyPoint | null;
  pretax: MoneyPoint | null;
  tax: MoneyPoint | null;
  investedCapital: MoneyPoint | null;
  enterpriseValue: MoneyPoint | null;
  equity: MoneyPoint | null;
  debt: MoneyPoint | null;
  cash: MoneyPoint | null;
}

export interface ReportedSeries {
  points: FundamentalPoint[];
  source: string;
  note: string | null;
}

const TS_FIELD: Record<string, keyof Omit<AnnualFundamental, "date">> = {
  annualEBIT: "ebit",
  annualOperatingIncome: "operatingIncome",
  annualPretaxIncome: "pretax",
  annualTaxProvision: "tax",
  annualInvestedCapital: "investedCapital",
  annualEnterpriseValue: "enterpriseValue",
  annualTotalDebt: "debt",
  annualCashAndCashEquivalents: "cash",
  annualStockholdersEquity: "equity",
};

function emptyAnnual(date: string): AnnualFundamental {
  return {
    date,
    ebit: null,
    operatingIncome: null,
    pretax: null,
    tax: null,
    investedCapital: null,
    enterpriseValue: null,
    equity: null,
    debt: null,
    cash: null,
  };
}

function yahooNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in v) {
    const raw = (v as { raw?: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

function yahooDate(v: unknown): string | null {
  const n = yahooNumber(v);
  if (n == null) return null;
  const ms = n > UNIX_MS_CUTOFF ? n : n * 1000;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** Eine gemeldete 0 zählt nur, wenn eine andere GuV-Zahl dieselbe Zeile stützt. Sonst ist es der leere Yahoo-Platzhalter. */
function reportedFigure(value: number | null, companions: Array<number | null>): number | null {
  if (value == null) return null;
  if (value !== 0) return value;
  return companions.some(c => c != null && c !== 0) ? value : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? v as Record<string, unknown> : null;
}

function listOf(raw: unknown, key: string): Record<string, unknown>[] {
  const box = asRecord(raw);
  const rows = box?.[key];
  if (!Array.isArray(rows)) return [];
  return rows.map(asRecord).filter((r): r is Record<string, unknown> => r != null);
}

function currenciesMatch(parts: Array<MoneyPoint | null>): boolean {
  const codes = parts
    .filter((p): p is MoneyPoint => p != null && p.currency != null && p.currency.trim() !== "")
    .map(p => p.currency!.toUpperCase());
  return new Set(codes).size <= 1;
}

function moneyOf(value: number | null, currency: string | null): MoneyPoint | null {
  if (value == null || !Number.isFinite(value)) return null;
  return { value, currency };
}

export function annualsFromQuoteSummary(result: unknown): AnnualFundamental[] {
  const root = asRecord(result);
  if (!root) return [];
  const income = listOf(root.incomeStatementHistory, "incomeStatementHistory");
  const sheets = listOf(root.balanceSheetHistory, "balanceSheetStatements");
  const byDate = new Map<string, AnnualFundamental>();
  const ensure = (date: string) => {
    const hit = byDate.get(date);
    if (hit) return hit;
    const row = emptyAnnual(date);
    byDate.set(date, row);
    return row;
  };
  for (const row of income) {
    const date = yahooDate(row.endDate);
    if (!date) continue;
    const ebit = yahooNumber(row.ebit);
    const operating = yahooNumber(row.operatingIncome);
    const revenue = yahooNumber(row.totalRevenue);
    const pretax = yahooNumber(row.incomeBeforeTax);
    const tax = yahooNumber(row.incomeTaxExpense);
    const target = ensure(date);
    target.ebit = moneyOf(reportedFigure(ebit, [operating, revenue, pretax]), null);
    target.operatingIncome = moneyOf(reportedFigure(operating, [ebit, revenue, pretax]), null);
    target.pretax = moneyOf(reportedFigure(pretax, [ebit, operating, revenue]), null);
    target.tax = moneyOf(tax, null);
  }
  for (const row of sheets) {
    const date = yahooDate(row.endDate);
    if (!date) continue;
    const target = ensure(date);
    target.equity = moneyOf(yahooNumber(row.totalStockholderEquity), null);
    target.debt = moneyOf(yahooNumber(row.shortLongTermDebt) ?? yahooNumber(row.longTermDebt), null);
    target.cash = moneyOf(yahooNumber(row.cash), null);
  }
  const currentEv = yahooNumber(asRecord(root.defaultKeyStatistics)?.enterpriseValue);
  const dated = Array.from(byDate.values()).filter(row => row.ebit != null || row.operatingIncome != null).sort((a, b) => a.date.localeCompare(b.date));
  if (currentEv != null && currentEv > 0 && dated.length > 0) {
    const latest = dated[dated.length - 1];
    if (latest.enterpriseValue == null) latest.enterpriseValue = { value: currentEv, currency: null };
  }
  return dated;
}

function readTimeseriesCell(row: unknown): { date: string; value: number; currency: string | null } | null {
  const rec = asRecord(row);
  if (!rec) return null;
  const dateRaw = typeof rec.asOfDate === "string" ? rec.asOfDate : typeof rec.date === "string" ? rec.date : "";
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const reported = asRecord(rec.reportedValue);
  const value = yahooNumber(reported?.raw) ?? yahooNumber(rec.value);
  if (value == null) return null;
  const currency = typeof rec.currencyCode === "string" ? rec.currencyCode : typeof rec.currency === "string" ? rec.currency : null;
  return { date, value, currency };
}

export function annualsFromTimeseries(json: unknown): AnnualFundamental[] {
  const root = asRecord(json);
  const series = asRecord(root?.timeseries);
  const blocks = Array.isArray(series?.result) ? series.result : [];
  const byDate = new Map<string, AnnualFundamental>();
  for (const block of blocks) {
    const rec = asRecord(block);
    if (!rec) continue;
    for (const [key, rows] of Object.entries(rec)) {
      const field = TS_FIELD[key];
      if (!field || !Array.isArray(rows)) continue;
      for (const cell of rows) {
        const parsed = readTimeseriesCell(cell);
        if (!parsed) continue;
        const row = byDate.get(parsed.date) ?? emptyAnnual(parsed.date);
        row[field] = { value: parsed.value, currency: parsed.currency };
        byDate.set(parsed.date, row);
      }
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function dedupeQuarters(rows: EpsQuarter[]): EpsQuarter[] {
  const byPeriod = new Map<string, EpsQuarter>();
  for (const row of rows) {
    const prev = byPeriod.get(row.periodEnd);
    if (!prev || row.asOf >= prev.asOf) byPeriod.set(row.periodEnd, row);
  }
  return Array.from(byPeriod.values()).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
}

/** Quartals-EPS. Yahoo liefert kein Filing-Datum; asOf bleibt das asOfDate der Reihe. */
export function epsQuartersFromTimeseries(json: unknown): { quarters: EpsQuarter[]; note: string | null } {
  const root = asRecord(json);
  const series = asRecord(root?.timeseries);
  const blocks = Array.isArray(series?.result) ? series.result : [];
  const byType = new Map<string, EpsQuarter[]>();
  for (const block of blocks) {
    const rec = asRecord(block);
    if (!rec) continue;
    for (const type of YAHOO_EPS_TYPES) {
      const rows = rec[type];
      if (!Array.isArray(rows)) continue;
      const list = byType.get(type) ?? [];
      for (const cell of rows) {
        const parsed = readTimeseriesCell(cell);
        if (!parsed || !Number.isFinite(parsed.value)) continue;
        list.push({ periodEnd: parsed.date, asOf: parsed.date, eps: parsed.value, currency: parsed.currency });
      }
      byType.set(type, list);
    }
  }
  const diluted = dedupeQuarters(byType.get("quarterlyDilutedEPS") ?? []);
  const basic = dedupeQuarters(byType.get("quarterlyBasicEPS") ?? []);
  const quarters = diluted.length > 0 ? diluted : basic;
  if (quarters.length === 0) return { quarters: [], note: "n/a — Yahoo ohne quarterlyDilutedEPS" };
  return { quarters, note: YAHOO_EPS_ASOF_NOTE };
}

/** Fertiges TTM. Wird nicht als Quartal summiert. */
export function ttmPrintsFromTimeseries(json: unknown): TtmPrint[] {
  const root = asRecord(json);
  const series = asRecord(root?.timeseries);
  const blocks = Array.isArray(series?.result) ? series.result : [];
  const byDate = new Map<string, TtmPrint>();
  for (const block of blocks) {
    const rec = asRecord(block);
    const rows = rec?.trailingDilutedEPS;
    if (!Array.isArray(rows)) continue;
    for (const cell of rows) {
      const parsed = readTimeseriesCell(cell);
      if (!parsed || !Number.isFinite(parsed.value)) continue;
      const prev = byDate.get(parsed.date);
      if (!prev) byDate.set(parsed.date, { asOf: parsed.date, eps: parsed.value, currency: parsed.currency });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.asOf.localeCompare(b.asOf));
}

/** Jahres-EPS. Ersatz nach trailingDilutedEPS, nicht als Quartal summiert. */
export function annualEpsFromTimeseries(json: unknown): TtmPrint[] {
  const root = asRecord(json);
  const series = asRecord(root?.timeseries);
  const blocks = Array.isArray(series?.result) ? series.result : [];
  const byDate = new Map<string, TtmPrint>();
  for (const block of blocks) {
    const rec = asRecord(block);
    const rows = rec?.[YAHOO_ANNUAL_EPS_TYPE];
    if (!Array.isArray(rows)) continue;
    for (const cell of rows) {
      const parsed = readTimeseriesCell(cell);
      if (!parsed || !Number.isFinite(parsed.value)) continue;
      if (!byDate.has(parsed.date)) byDate.set(parsed.date, { asOf: parsed.date, eps: parsed.value, currency: parsed.currency });
    }
  }
  return Array.from(byDate.values()).sort((a, b) => a.asOf.localeCompare(b.asOf));
}

function operatingResult(row: AnnualFundamental): MoneyPoint | null {
  return row.ebit ?? row.operatingIncome;
}

export function earningsYieldPointsFromAnnuals(rows: AnnualFundamental[]): { points: FundamentalPoint[]; note: string | null } {
  if (rows.length === 0) return { points: [], note: "n/a — keine Jahreszahlen" };
  const points: FundamentalPoint[] = [];
  for (const row of rows) {
    const ebit = operatingResult(row);
    const ev = row.enterpriseValue;
    if (ebit != null && ev != null && !currenciesMatch([ebit, ev])) {
      points.push({ date: row.date, value: null, note: "n/a — Währung von EBIT und Enterprise Value weicht ab" });
      continue;
    }
    const y = earningsYieldPct(ebit?.value ?? null, ev?.value ?? null);
    points.push({ date: row.date, value: y.value, note: y.note });
  }
  const any = points.some(p => p.value != null);
  return { points, note: any ? null : (points.find(p => p.note)?.note ?? "n/a — Earnings Yield nicht berechenbar") };
}

function investedCapital(row: AnnualFundamental): MoneyPoint | null {
  if (row.investedCapital != null && row.investedCapital.value > 0) return row.investedCapital;
  if (row.equity == null || row.debt == null || row.cash == null) return null;
  if (!currenciesMatch([row.equity, row.debt, row.cash])) return null;
  const value = row.equity.value + row.debt.value - row.cash.value;
  if (!(value > 0)) return null;
  return { value, currency: row.equity.currency ?? row.debt.currency ?? row.cash.currency };
}

export function roicPointsFromAnnuals(rows: AnnualFundamental[]): { points: FundamentalPoint[]; note: string | null } {
  if (rows.length === 0) return { points: [], note: "n/a — keine Jahreszahlen" };
  const points: FundamentalPoint[] = [];
  for (const row of rows) {
    const ebit = operatingResult(row);
    const capital = investedCapital(row);
    if (ebit == null) {
      points.push({ date: row.date, value: null, note: "n/a — EBIT fehlt" });
      continue;
    }
    if (row.pretax == null || row.pretax.value === 0 || row.tax == null) {
      points.push({ date: row.date, value: null, note: "n/a — Steuersatz nicht aus dem Abschluss bestimmbar" });
      continue;
    }
    if (!currenciesMatch([ebit, row.pretax, row.tax, capital])) {
      points.push({ date: row.date, value: null, note: "n/a — Währung der ROIC-Bestandteile weicht ab" });
      continue;
    }
    if (capital == null) {
      points.push({ date: row.date, value: null, note: "n/a — Invested Capital fehlt oder nicht positiv" });
      continue;
    }
    const rate = row.tax.value / row.pretax.value;
    if (!Number.isFinite(rate)) {
      points.push({ date: row.date, value: null, note: "n/a — Steuersatz nicht aus dem Abschluss bestimmbar" });
      continue;
    }
    const nopat = ebit.value * (1 - rate);
    if (!Number.isFinite(nopat)) {
      points.push({ date: row.date, value: null, note: "n/a — NOPAT nicht berechenbar" });
      continue;
    }
    points.push({ date: row.date, value: (nopat / capital.value) * 100, note: null });
  }
  const any = points.some(p => p.value != null);
  return { points, note: any ? null : (points.find(p => p.note)?.note ?? "n/a — ROIC nicht berechenbar") };
}

function usableCount(points: FundamentalPoint[]): number {
  return points.filter(p => p.value != null && Number.isFinite(p.value)).length;
}

/** Nimmt die Quelle, die mehr berichtete Punkte hat. Bei Gleichstand bleibt die erste (quoteSummary vor Timeseries). */
export function preferReportedSeries<T extends ReportedSeries>(primary: T, fallback: T): T {
  const primaryCount = usableCount(primary.points);
  const fallbackCount = usableCount(fallback.points);
  if (primaryCount > 0 && primaryCount >= fallbackCount) return primary;
  if (fallbackCount > 0) return fallback;
  const note = [primary.note, fallback.note].filter((n): n is string => !!n).join(" · ") || null;
  return { ...fallback, points: [], note };
}

export function trailingPeFromQuoteSummary(result: unknown): number | null {
  const root = asRecord(result);
  if (!root) return null;
  const summary = yahooNumber(asRecord(root.summaryDetail)?.trailingPE);
  if (summary != null && summary > 0) return summary;
  const stats = yahooNumber(asRecord(root.defaultKeyStatistics)?.trailingPE);
  if (stats != null && stats > 0) return stats;
  return null;
}

/** Jüngstes positives trailingPeRatio. Leer bei ETFs (nur meta) und bei Punkten älter als 550 Tage. */
const TRAILING_PE_MAX_AGE_MS = 550 * 24 * 60 * 60 * 1000;

export function trailingPeFromTimeseries(json: unknown, nowMs: number = Date.now()): number | null {
  const root = asRecord(json);
  const series = asRecord(root?.timeseries);
  const blocks = Array.isArray(series?.result) ? series.result : [];
  let best: { date: string; value: number } | null = null;
  for (const block of blocks) {
    const rec = asRecord(block);
    const rows = rec?.trailingPeRatio;
    if (!Array.isArray(rows)) continue;
    for (const cell of rows) {
      const parsed = readTimeseriesCell(cell);
      if (!parsed || !(parsed.value > 0)) continue;
      const t = Date.parse(`${parsed.date}T00:00:00Z`);
      if (!Number.isFinite(t) || nowMs - t > TRAILING_PE_MAX_AGE_MS || t - nowMs > 24 * 60 * 60 * 1000) continue;
      if (!best || parsed.date > best.date) best = { date: parsed.date, value: parsed.value };
    }
  }
  return best?.value ?? null;
}

/** v7 `quoteResponse.result[0].trailingPE` ist eine Zahl, kein {raw}-Block. */
export function trailingPeFromV7Quote(json: unknown): number | null {
  const root = asRecord(json);
  const box = asRecord(root?.quoteResponse);
  const rows = Array.isArray(box?.result) ? box.result : [];
  const pe = yahooNumber(asRecord(rows[0])?.trailingPE);
  return pe != null && pe > 0 ? pe : null;
}

export function trailingPeFromYahooHtml(html: string): number | null {
  const patterns = [
    /"trailingPE"\s*:\s*\{\s*"raw"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
    /\\"trailingPE\\"\s*:\s*\{\s*\\"raw\\"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}
