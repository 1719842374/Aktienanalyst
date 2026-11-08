/**
 * Jahresabschlüsse für die Anzeige (WORK_DASHBOARD_FEATURES §1).
 * Reine Funktion. Fehlende Felder bleiben null — nie 0 als Ersatz.
 * Keine Umrechnung, kein Score, kein Piotroski, kein WACC/ROIC.
 */
import { currencySymbol } from "./currency-format";

export const FINANCIAL_HISTORY_ROUTE = "/api/financial-history";
export const FINANCIAL_HISTORY_YEAR_LIMIT = 10;

export interface Delta {
  value: number | null;
  reason: string | null;
  unit: "pct" | "pp";
}

export interface StatementYear {
  fiscalYear: string;
  date: string;
  revenue: number | null;
  revenueYoy: Delta;
  grossProfit: number | null;
  grossProfitYoy: Delta;
  grossMarginPct: number | null;
  grossMarginReason: string | null;
  grossMarginYoyPp: Delta;
  operatingIncome: number | null;
  operatingIncomeYoy: Delta;
  operatingMarginPct: number | null;
  operatingMarginReason: string | null;
  operatingMarginYoyPp: Delta;
  netIncome: number | null;
  netIncomeYoy: Delta;
  netMarginPct: number | null;
  netMarginReason: string | null;
  netMarginYoyPp: Delta;
  fcf: number | null;
  fcfReason: string | null;
  fcfYoy: Delta;
  fcfMarginPct: number | null;
  fcfMarginReason: string | null;
  fcfMarginYoyPp: Delta;
  /** Währung der vorhandenen Abschlusszeile. null, wenn die Zeile fehlt oder keine reportedCurrency trägt. */
  incomeCurrency: string | null;
  balanceCurrency: string | null;
  cashflowCurrency: string | null;
  totalAssets: number | null;
  totalAssetsYoy: Delta;
  totalEquity: number | null;
  totalEquityYoy: Delta;
  totalDebt: number | null;
  totalDebtYoy: Delta;
  cash: number | null;
  cashYoy: Delta;
}

export interface FinancialHistory {
  years: StatementYear[];
  currency: string | null;
  currencyNote: string | null;
  note: string | null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pick(row: Record<string, unknown> | undefined, keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) {
    if (key in row) {
      const value = num(row[key]);
      if (value != null) return value;
    }
  }
  return null;
}

function yearKey(row: Record<string, unknown>): string | null {
  const fy = row.fiscalYear ?? row.calendarYear;
  if (typeof fy === "number" && Number.isFinite(fy)) return String(Math.trunc(fy));
  if (typeof fy === "string" && /^\d{4}/.test(fy.trim())) return fy.trim().slice(0, 4);
  if (typeof row.date === "string" && /^\d{4}/.test(row.date)) return row.date.slice(0, 4);
  return null;
}

function dateOf(row: Record<string, unknown> | undefined): string {
  if (!row || typeof row.date !== "string") return "";
  return row.date.slice(0, 10);
}

function currencyOf(row: Record<string, unknown> | undefined): string | null {
  if (!row || typeof row.reportedCurrency !== "string") return null;
  const code = row.reportedCurrency.trim().toUpperCase();
  return code.length > 0 ? code : null;
}

function indexByYear(rows: unknown[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const key = yearKey(row);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || dateOf(row).localeCompare(dateOf(existing)) > 0) map.set(key, row);
  }
  return map;
}

function gap(unit: Delta["unit"], reason: string): Delta {
  return { value: null, reason, unit };
}

function rate(curr: number | null, prev: number | null, adjacent: boolean, first: boolean): Delta {
  if (first) return gap("pct", "n/a — erstes Jahr der Reihe, keine Vorperiode");
  if (!adjacent) return gap("pct", "n/a — keine angrenzende Vorperiode");
  if (curr == null) return gap("pct", "n/a — Wert fehlt");
  if (prev == null) return gap("pct", "n/a — keine Vorperiode");
  if (prev === 0) return gap("pct", "n/a — Vorperiode ist 0, keine Rate");
  return { value: ((curr - prev) / Math.abs(prev)) * 100, reason: null, unit: "pct" };
}

function points(curr: number | null, prev: number | null, adjacent: boolean, first: boolean): Delta {
  if (first) return gap("pp", "n/a — erstes Jahr der Reihe, keine Vorperiode");
  if (!adjacent) return gap("pp", "n/a — keine angrenzende Vorperiode");
  if (curr == null || prev == null) return gap("pp", "n/a — Marge fehlt");
  return { value: curr - prev, reason: null, unit: "pp" };
}

function adjacentYears(prev: string, curr: string): boolean {
  if (!/^\d{4}$/.test(prev) || !/^\d{4}$/.test(curr)) return false;
  return Number(curr) - Number(prev) === 1;
}

/** Marge nur bei positivem Umsatz. Sonst null und ein Grund, nie 0. */
export function marginPct(part: number | null, revenue: number | null): { pct: number | null; reason: string | null } {
  if (part == null) return { pct: null, reason: "n/a — Posten fehlt" };
  if (revenue == null || !Number.isFinite(revenue) || revenue <= 0) {
    return { pct: null, reason: "n/a — Umsatz fehlt oder ist nicht positiv" };
  }
  return { pct: (part / revenue) * 100, reason: null };
}

/**
 * Eine Periode. Ein berichtetes freeCashFlow bleibt stehen, auch wenn es 0 oder negativ ist.
 * Fehlt das Feld oder ist es nicht endlich: OCF − |CapEx|, auch wenn das Ergebnis 0 ist.
 * Fehlende oder nicht endliche Eingaben bleiben n/a. Keine zweite Formel und kein ersetzter Betrag.
 */
export function fcfOf(row: Record<string, unknown> | undefined): { fcf: number | null; reason: string | null } {
  if (!row) return { fcf: null, reason: "n/a — kein Cashflow-Jahr" };
  const reported = pick(row, ["freeCashFlow"]);
  if (reported != null) return { fcf: reported, reason: null };
  const ocf = pick(row, ["operatingCashFlow", "netCashProvidedByOperatingActivities"]);
  const capex = pick(row, ["capitalExpenditure", "capitalExpenditures"]);
  if (ocf == null || capex == null) {
    return { fcf: null, reason: "n/a — Free Cash Flow nicht berichtet und nicht aus OCF − CapEx ableitbar" };
  }
  return { fcf: ocf - Math.abs(capex), reason: null };
}

function currencyGap(unit: Delta["unit"], left: string | null, right: string | null): Delta {
  return gap(unit, `n/a — Berichtswährungen ${left ?? "fehlt"} und ${right ?? "fehlt"} nicht vergleichbar, keine Umrechnung`);
}

function comparableRate(
  curr: number | null,
  prev: number | null,
  adjacent: boolean,
  first: boolean,
  currCurrency: string | null,
  prevCurrency: string | null,
): Delta {
  const base = rate(curr, prev, adjacent, first);
  if (base.value == null) return base;
  if (currCurrency == null || prevCurrency == null || currCurrency !== prevCurrency) {
    return currencyGap("pct", prevCurrency, currCurrency);
  }
  return base;
}

function comparablePoints(
  curr: number | null,
  prev: number | null,
  adjacent: boolean,
  first: boolean,
  currCurrency: string | null,
  prevCurrency: string | null,
): Delta {
  const base = points(curr, prev, adjacent, first);
  if (base.value == null) return base;
  if (currCurrency == null || prevCurrency == null || currCurrency !== prevCurrency) {
    return currencyGap("pp", prevCurrency, currCurrency);
  }
  return base;
}

export function buildFinancialHistory(input: {
  income: unknown[];
  balance: unknown[];
  cashflow: unknown[];
}): FinancialHistory {
  const income = indexByYear(input.income ?? []);
  const balance = indexByYear(input.balance ?? []);
  const cashflow = indexByYear(input.cashflow ?? []);
  const keys = Array.from(new Set([
    ...Array.from(income.keys()),
    ...Array.from(balance.keys()),
    ...Array.from(cashflow.keys()),
  ])).sort((a, b) => a.localeCompare(b));
  const window = keys.slice(-FINANCIAL_HISTORY_YEAR_LIMIT);

  const currencies = new Set<string>();
  let currencyMissingOnRow = false;
  for (const key of window) {
    for (const row of [income.get(key), balance.get(key), cashflow.get(key)]) {
      if (!row) continue;
      const code = currencyOf(row);
      if (!code) currencyMissingOnRow = true;
      else currencies.add(code);
    }
  }
  let currency: string | null = null;
  let currencyNote: string | null = null;
  if (window.length === 0) {
    currencyNote = null;
  } else if (currencies.size > 1) {
    currencyNote = `n/a — mehrere Berichtswährungen (${Array.from(currencies).sort().join(", ")}), keine Umrechnung`;
  } else if (currencyMissingOnRow || currencies.size === 0) {
    currencyNote = "n/a — Berichtswährung fehlt in mindestens einem Abschluss, keine globale Zuordnung und kein $-Ersatz";
  } else {
    currency = Array.from(currencies)[0];
  }

  const years: StatementYear[] = window.map((key, index) => {
    const inc = income.get(key);
    const bs = balance.get(key);
    const cf = cashflow.get(key);
    const prevKey = index > 0 ? window[index - 1] : null;
    const prevInc = prevKey ? income.get(prevKey) : undefined;
    const prevBs = prevKey ? balance.get(prevKey) : undefined;
    const prevCf = prevKey ? cashflow.get(prevKey) : undefined;
    const adjacent = prevKey != null && adjacentYears(prevKey, key);
    const first = index === 0;
    const incomeCurrency = inc ? currencyOf(inc) : null;
    const balanceCurrency = bs ? currencyOf(bs) : null;
    const cashflowCurrency = cf ? currencyOf(cf) : null;
    const prevIncomeCurrency = prevInc ? currencyOf(prevInc) : null;
    const prevBalanceCurrency = prevBs ? currencyOf(prevBs) : null;
    const prevCashflowCurrency = prevCf ? currencyOf(prevCf) : null;
    const revenue = pick(inc, ["revenue", "totalRevenue"]);
    const prevRevenue = pick(prevInc, ["revenue", "totalRevenue"]);
    const grossProfit = pick(inc, ["grossProfit"]);
    const prevGross = pick(prevInc, ["grossProfit"]);
    const operatingIncome = pick(inc, ["operatingIncome"]);
    const prevOperating = pick(prevInc, ["operatingIncome"]);
    const netIncome = pick(inc, ["netIncome"]);
    const prevNet = pick(prevInc, ["netIncome"]);
    const fcf = fcfOf(cf);
    const prevFcf = fcfOf(prevCf);
    const gross = marginPct(grossProfit, revenue);
    const operating = marginPct(operatingIncome, revenue);
    const net = marginPct(netIncome, revenue);
    const fcfMarginBase = marginPct(fcf.fcf, revenue);
    const fcfMargin = fcfMarginBase.pct == null || (incomeCurrency != null && cashflowCurrency != null && incomeCurrency === cashflowCurrency)
      ? fcfMarginBase
      : { pct: null, reason: `n/a — Free Cash Flow (${cashflowCurrency ?? "fehlt"}) und Umsatz (${incomeCurrency ?? "fehlt"}) nicht in derselben Berichtswährung, keine Umrechnung` };
    const prevGrossMargin = marginPct(prevGross, prevRevenue).pct;
    const prevOperatingMargin = marginPct(prevOperating, prevRevenue).pct;
    const prevNetMargin = marginPct(prevNet, prevRevenue).pct;
    const prevFcfMarginBase = marginPct(prevFcf.fcf, prevRevenue);
    const prevFcfMargin = prevFcfMarginBase.pct == null || (prevIncomeCurrency != null && prevCashflowCurrency != null && prevIncomeCurrency === prevCashflowCurrency)
      ? prevFcfMarginBase.pct
      : null;
    const totalAssets = pick(bs, ["totalAssets"]);
    const totalEquity = pick(bs, ["totalStockholdersEquity", "totalEquity"]);
    const totalDebt = pick(bs, ["totalDebt"]);
    const cash = pick(bs, ["cashAndCashEquivalents", "cashAndShortTermInvestments"]);
    return {
      fiscalYear: key,
      date: dateOf(inc ?? bs ?? cf),
      revenue,
      revenueYoy: comparableRate(revenue, prevRevenue, adjacent, first, incomeCurrency, prevIncomeCurrency),
      grossProfit,
      grossProfitYoy: comparableRate(grossProfit, prevGross, adjacent, first, incomeCurrency, prevIncomeCurrency),
      grossMarginPct: gross.pct,
      grossMarginReason: gross.reason,
      grossMarginYoyPp: comparablePoints(gross.pct, prevGrossMargin, adjacent, first, incomeCurrency, prevIncomeCurrency),
      operatingIncome,
      operatingIncomeYoy: comparableRate(operatingIncome, prevOperating, adjacent, first, incomeCurrency, prevIncomeCurrency),
      operatingMarginPct: operating.pct,
      operatingMarginReason: operating.reason,
      operatingMarginYoyPp: comparablePoints(operating.pct, prevOperatingMargin, adjacent, first, incomeCurrency, prevIncomeCurrency),
      netIncome,
      netIncomeYoy: comparableRate(netIncome, prevNet, adjacent, first, incomeCurrency, prevIncomeCurrency),
      netMarginPct: net.pct,
      netMarginReason: net.reason,
      netMarginYoyPp: comparablePoints(net.pct, prevNetMargin, adjacent, first, incomeCurrency, prevIncomeCurrency),
      fcf: fcf.fcf,
      fcfReason: fcf.reason,
      fcfYoy: comparableRate(fcf.fcf, prevFcf.fcf, adjacent, first, cashflowCurrency, prevCashflowCurrency),
      fcfMarginPct: fcfMargin.pct,
      fcfMarginReason: fcfMargin.reason,
      fcfMarginYoyPp: comparablePoints(fcfMargin.pct, prevFcfMargin, adjacent, first, cashflowCurrency, prevCashflowCurrency),
      totalAssets,
      totalAssetsYoy: comparableRate(totalAssets, pick(prevBs, ["totalAssets"]), adjacent, first, balanceCurrency, prevBalanceCurrency),
      totalEquity,
      totalEquityYoy: comparableRate(totalEquity, pick(prevBs, ["totalStockholdersEquity", "totalEquity"]), adjacent, first, balanceCurrency, prevBalanceCurrency),
      totalDebt,
      totalDebtYoy: comparableRate(totalDebt, pick(prevBs, ["totalDebt"]), adjacent, first, balanceCurrency, prevBalanceCurrency),
      cash,
      cashYoy: comparableRate(cash, pick(prevBs, ["cashAndCashEquivalents", "cashAndShortTermInvestments"]), adjacent, first, balanceCurrency, prevBalanceCurrency),
      incomeCurrency,
      balanceCurrency,
      cashflowCurrency,
    };
  });

  return {
    years,
    currency,
    currencyNote,
    note: years.length === 0 ? "n/a — keine Jahresabschlüsse (Income, Balance, Cash Flow leer)" : null,
  };
}

/** Betrag in Berichtswährung. Ohne Währung kein $-Ersatz. */
export function formatStatementAmount(value: number | null, currency: string | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const body = abs >= 1e12
    ? `${(abs / 1e12).toFixed(1)}T`
    : abs >= 1e9
      ? `${(abs / 1e9).toFixed(1)}B`
      : abs >= 1e6
        ? `${(abs / 1e6).toFixed(1)}M`
        : abs.toFixed(0);
  return `${sign}${currency ? currencySymbol(currency) : ""}${body}`;
}

export function formatMarginLevel(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${value.toFixed(1)}%`;
}

export function formatDelta(delta: Delta): string {
  if (delta.value == null || !Number.isFinite(delta.value)) return delta.reason ?? "n/a";
  const sign = delta.value > 0 ? "+" : "";
  const suffix = delta.unit === "pp" ? " pp" : "%";
  return `${sign}${delta.value.toFixed(1)}${suffix}`;
}
