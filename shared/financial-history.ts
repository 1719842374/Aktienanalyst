/**
 * Mehrjahres-Abschluss (WORK_DASHBOARD_FEATURES §1) und die zwei GuruFocus-Ergänzungen,
 * die aus derselben Historie fallen (WORK_GURUFOCUS §4): Piotroski und Jahre mit Gewinn.
 * Reine Funktion. Fehlende Felder bleiben null mit Grund — nie 0 als Ersatz.
 * Kein Einfluss auf Score, Rating oder Kurs.
 */

export interface StatementYear {
  /** ISO-Datum des Abschlusses, sonst leer. */
  date: string;
  fiscalYear: string;
  revenue: number | null;
  revenueYoyPct: number | null;
  revenueYoyReason: string | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  operatingIncome: number | null;
  operatingMarginPct: number | null;
  netIncome: number | null;
  netMarginPct: number | null;
  ebitda: number | null;
  fcf: number | null;
  fcfReason: string | null;
  fcfMarginPct: number | null;
  totalAssets: number | null;
  totalEquity: number | null;
  totalDebt: number | null;
  cash: number | null;
  operatingCashFlow: number | null;
  longTermDebt: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  shares: number | null;
}

export interface PiotroskiCriterion {
  id: string;
  label: string;
  pass: boolean | null;
  reason: string | null;
}

export interface PiotroskiResult {
  /** Bestandene Kriterien. null, wenn keines bewertet werden konnte. */
  passed: number | null;
  evaluated: number;
  criteria: PiotroskiCriterion[];
  label: string;
}

export interface ProfitYearsResult {
  profitable: number | null;
  observed: number;
  missing: number;
  label: string;
}

export interface FinancialHistory {
  years: StatementYear[];
  piotroski: PiotroskiResult;
  profitYears: ProfitYearsResult;
  note: string | null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pick(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    if (k in row) {
      const n = num(row[k]);
      if (n != null) return n;
    }
  }
  return null;
}

function yearKey(row: Record<string, unknown>): string | null {
  const date = typeof row.date === "string" ? row.date.slice(0, 10) : "";
  const fy = row.fiscalYear ?? row.calendarYear ?? row.year;
  if (typeof fy === "number" && Number.isFinite(fy)) return String(fy);
  if (typeof fy === "string" && fy.trim()) return fy.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date.slice(0, 4);
  return null;
}

function dateOf(row: Record<string, unknown>): string {
  return typeof row.date === "string" ? row.date.slice(0, 10) : "";
}

function yoy(curr: number | null, prev: number | null): { pct: number | null; reason: string | null } {
  if (curr == null) return { pct: null, reason: "n/a — Wert fehlt" };
  if (prev == null) return { pct: null, reason: "n/a — keine Vorperiode" };
  if (prev === 0) return { pct: null, reason: "n/a — Vorperiode ist 0, keine Rate" };
  return { pct: ((curr - prev) / Math.abs(prev)) * 100, reason: null };
}

function margin(part: number | null, revenue: number | null): number | null {
  if (part == null || revenue == null || revenue === 0) return null;
  return (part / Math.abs(revenue)) * 100;
}

function indexByYear(rows: unknown[]): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const key = yearKey(row);
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return map;
}

function fcfOf(cf: Record<string, unknown> | undefined): { fcf: number | null; reason: string | null } {
  if (!cf) return { fcf: null, reason: "n/a — kein Cashflow-Jahr" };
  const reported = pick(cf, ["freeCashFlow"]);
  if (reported != null) return { fcf: reported, reason: null };
  const ocf = pick(cf, ["operatingCashFlow", "netCashProvidedByOperatingActivities"]);
  const capex = pick(cf, ["capitalExpenditure", "investmentsInPropertyPlantAndEquipment"]);
  if (ocf == null || capex == null) return { fcf: null, reason: "n/a — Free Cash Flow nicht berichtet und nicht aus OCF − CapEx ableitbar" };
  return { fcf: ocf - Math.abs(capex), reason: null };
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
  ]));
  keys.sort((a, b) => a.localeCompare(b));

  const years: StatementYear[] = keys.map((key, i) => {
    const inc = income.get(key);
    const bs = balance.get(key);
    const cf = cashflow.get(key);
    const prev = i > 0 ? income.get(keys[i - 1]) : undefined;
    const revenue = inc ? pick(inc, ["revenue", "totalRevenue"]) : null;
    const prevRevenue = prev ? pick(prev, ["revenue", "totalRevenue"]) : null;
    const y = yoy(revenue, i === 0 ? null : prevRevenue);
    const grossProfit = inc ? pick(inc, ["grossProfit"]) : null;
    const operatingIncome = inc ? pick(inc, ["operatingIncome"]) : null;
    const netIncome = inc ? pick(inc, ["netIncome"]) : null;
    const fcf = fcfOf(cf);
    const date = dateOf(inc ?? bs ?? cf ?? {});
    return {
      date,
      fiscalYear: key,
      revenue,
      revenueYoyPct: i === 0 ? null : y.pct,
      revenueYoyReason: i === 0 ? "n/a — erstes Jahr der Reihe, keine Vorperiode" : y.reason,
      grossProfit,
      grossMarginPct: margin(grossProfit, revenue),
      operatingIncome,
      operatingMarginPct: margin(operatingIncome, revenue),
      netIncome,
      netMarginPct: margin(netIncome, revenue),
      ebitda: inc ? pick(inc, ["ebitda"]) : null,
      fcf: fcf.fcf,
      fcfReason: fcf.reason,
      fcfMarginPct: margin(fcf.fcf, revenue),
      totalAssets: bs ? pick(bs, ["totalAssets"]) : null,
      totalEquity: bs ? pick(bs, ["totalStockholdersEquity", "totalEquity"]) : null,
      totalDebt: bs ? pick(bs, ["totalDebt"]) : null,
      cash: bs ? pick(bs, ["cashAndCashEquivalents", "cashAndShortTermInvestments"]) : null,
      operatingCashFlow: cf ? pick(cf, ["operatingCashFlow", "netCashProvidedByOperatingActivities"]) : null,
      longTermDebt: bs ? pick(bs, ["longTermDebt"]) : null,
      currentAssets: bs ? pick(bs, ["totalCurrentAssets"]) : null,
      currentLiabilities: bs ? pick(bs, ["totalCurrentLiabilities"]) : null,
      shares: inc ? pick(inc, ["weightedAverageShsOutDil", "weightedAverageShsOut"]) : null,
    };
  });

  const note = years.length === 0
    ? "n/a — keine Jahresabschlüsse (Income, Balance, Cash Flow leer)"
    : null;
  return {
    years,
    piotroski: piotroski(years),
    profitYears: profitYears(years),
    note,
  };
}

function ratio(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function criterion(id: string, label: string, pass: boolean | null, reason: string | null): PiotroskiCriterion {
  return { id, label, pass, reason: pass == null ? reason : null };
}

export function piotroski(years: readonly StatementYear[]): PiotroskiResult {
  const usable = years.filter(y => y.netIncome != null || y.totalAssets != null || y.operatingCashFlow != null);
  const curr = usable.length >= 2 ? usable[usable.length - 1] : null;
  const prev = usable.length >= 2 ? usable[usable.length - 2] : null;
  const missingPair = "n/a — weniger als zwei Jahre mit Abschlussdaten";

  const roa = curr && prev ? ratio(curr.netIncome, curr.totalAssets) : null;
  const roaPrev = curr && prev ? ratio(prev.netIncome, prev.totalAssets) : null;
  const turn = curr && prev ? ratio(curr.revenue, curr.totalAssets) : null;
  const turnPrev = curr && prev ? ratio(prev.revenue, prev.totalAssets) : null;
  const lev = curr && prev ? ratio(curr.longTermDebt, curr.totalAssets) : null;
  const levPrev = curr && prev ? ratio(prev.longTermDebt, prev.totalAssets) : null;
  const current = curr && prev ? ratio(curr.currentAssets, curr.currentLiabilities) : null;
  const currentPrev = curr && prev ? ratio(prev.currentAssets, prev.currentLiabilities) : null;
  const gm = curr?.grossMarginPct ?? null;
  const gmPrev = prev?.grossMarginPct ?? null;

  const criteria: PiotroskiCriterion[] = [
    criterion("roa", "ROA > 0", roa == null ? null : roa > 0, roa == null ? (curr ? "n/a — ROA nicht ableitbar (Nettoergebnis oder Assets fehlen)" : missingPair) : null),
    criterion("cfo", "Operativer Cashflow > 0", curr?.operatingCashFlow == null ? null : curr.operatingCashFlow > 0, curr?.operatingCashFlow == null ? (curr ? "n/a — operativer Cashflow fehlt" : missingPair) : null),
    criterion("roa-up", "ROA steigt", roa == null || roaPrev == null ? null : roa > roaPrev, roa == null || roaPrev == null ? "n/a — ROA nicht für beide Jahre ableitbar" : null),
    criterion("accrual", "Cashflow > Nettoergebnis", curr?.operatingCashFlow == null || curr.netIncome == null ? null : curr.operatingCashFlow > curr.netIncome, curr?.operatingCashFlow == null || curr?.netIncome == null ? "n/a — Cashflow oder Nettoergebnis fehlt" : null),
    criterion("leverage", "Verschuldung (Langfristig/Assets) sinkt", lev == null || levPrev == null ? null : lev < levPrev, lev == null || levPrev == null ? "n/a — langfristige Schulden oder Assets fehlen" : null),
    criterion("liquidity", "Current Ratio steigt", current == null || currentPrev == null ? null : current > currentPrev, current == null || currentPrev == null ? "n/a — Umlaufvermögen oder kurzfristige Schulden fehlen" : null),
    criterion("dilution", "Keine Verwässerung", curr?.shares == null || prev?.shares == null ? null : curr.shares <= prev.shares, curr?.shares == null || prev?.shares == null ? "n/a — Aktienzahl fehlt" : null),
    criterion("margin", "Bruttomarge steigt", gm == null || gmPrev == null ? null : gm > gmPrev, gm == null || gmPrev == null ? "n/a — Bruttomarge fehlt" : null),
    criterion("turnover", "Kapitalumschlag steigt", turn == null || turnPrev == null ? null : turn > turnPrev, turn == null || turnPrev == null ? "n/a — Umsatz oder Assets fehlen" : null),
  ];

  const evaluated = criteria.filter(c => c.pass != null);
  const passed = evaluated.filter(c => c.pass).length;
  const skipped = criteria.filter(c => c.pass == null).map(c => c.label);
  if (evaluated.length === 0) {
    return { passed: null, evaluated: 0, criteria, label: `n/a — ${curr ? "keines der neun Kriterien ist ableitbar" : missingPair}` };
  }
  const tail = skipped.length ? ` (${skipped.length} n/a: ${skipped.join("; ")})` : "";
  return { passed, evaluated: evaluated.length, criteria, label: `${passed}/${evaluated.length}${tail}` };
}

export function profitYears(years: readonly StatementYear[]): ProfitYearsResult {
  const observed = years.filter(y => y.netIncome != null);
  const missing = years.length - observed.length;
  if (observed.length === 0) {
    return { profitable: null, observed: 0, missing, label: "n/a — kein berichtetes Nettoergebnis" };
  }
  const profitable = observed.filter(y => (y.netIncome as number) > 0).length;
  const miss = missing > 0 ? `, ${missing} Jahre ohne Nettoergebnis` : "";
  return {
    profitable,
    observed: observed.length,
    missing,
    label: `${profitable}/${observed.length} Jahre mit berichteten Ergebnis profitabel${miss}`,
  };
}
