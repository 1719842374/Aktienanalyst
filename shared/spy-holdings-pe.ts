/**
 * SPY-KGV aus den Holdings, nur Anzeige.
 * PE = Σ Market Cap / Σ Earnings (TTM). Negative Earnings bleiben in der Summe.
 * Die Mindestabdeckung ist der Gewichtsanteil der größten Position (die Daten),
 * nicht ein fester Prozentsatz. Deckung darunter ist eine Einzelposition und bleibt n/a.
 */

/** Vier berichtete Quartale sind ein TTM. */
export const TTM_QUARTER_COUNT = 4;

/** Query-Länge für /stable/batch-quote, damit ein Request nicht ein Symbol ist. */
export const SPY_QUOTE_BATCH_URL_LIMIT = 1500;

export const SPY_HOLDINGS_ETF = "SPY";

export const SPY_HOLDINGS_PE_SOURCE =
  "FMP GET /stable/etf/holdings + /stable/batch-quote marketCap + /stable/income-statement-ttm netIncome";

export const SPY_HOLDINGS_PE_FORMULA = "PE = Σ Market Cap / Σ Earnings (TTM)";

export interface SpyHoldingWeight {
  symbol: string;
  /** Gewicht so wie die Quelle es liefert. Null, wenn die Zeile keines nennt. */
  weight: number | null;
}

export interface SpyHoldingFundamentals extends SpyHoldingWeight {
  marketCap: number | null;
  /** TTM-Net-Income. Negativ und 0 sind Daten. Null heißt: kein Druck. */
  earningsTtm: number | null;
}

export interface SpyAggregatePe {
  pe: number | null;
  /** Anteil des positiven ETF-Gewichts mit Market Cap und TTM-Earnings. Null, wenn kein positives Gewicht da ist. */
  coverage: number | null;
  estimate: boolean;
  source: string | null;
  formula: string;
  /** n/a — Grund, wenn pe null ist. Sonst leer; die UI setzt Quelle und Formel an den Wert. */
  note: string | null;
}

export interface StatementMoney {
  netIncome: number;
  currency: string | null;
}

function finite(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatCoveragePct(coverage: number): string {
  const pct = Math.round(coverage * 1000) / 10;
  return `${pct.toFixed(1).replace(".", ",")} %`;
}

export function naHoldings(reason: string): string {
  const body = reason.replace(/^n\/a\s*—\s*/, "").trim();
  return body ? `n/a — ${body}` : "n/a";
}

/** Gewichtsanteil der größten Position. Null, wenn kein positives Gewicht vorliegt. */
export function largestHoldingWeightShare(weights: Array<number | null>): number | null {
  const positive = weights.filter((w): w is number => w != null && Number.isFinite(w) && w > 0);
  const total = positive.reduce((sum, w) => sum + w, 0);
  if (!(total > 0)) return null;
  return Math.max(...positive) / total;
}

export function quoteSymbolBatches(symbols: string[], urlLimit = SPY_QUOTE_BATCH_URL_LIMIT): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const symbol of symbols) {
    const extra = current.length === 0 ? symbol.length : symbol.length + 1;
    if (current.length > 0 && length + extra > urlLimit) {
      batches.push(current);
      current = [symbol];
      length = symbol.length;
      continue;
    }
    current.push(symbol);
    length += extra;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function mergeWeights(rows: SpyHoldingWeight[]): SpyHoldingWeight[] {
  const order: string[] = [];
  const weight = new Map<string, number | null>();
  for (const row of rows) {
    if (!weight.has(row.symbol)) order.push(row.symbol);
    const prev = weight.get(row.symbol);
    if (prev == null) weight.set(row.symbol, row.weight);
    else if (row.weight != null) weight.set(row.symbol, prev + row.weight);
  }
  return order.map(symbol => ({ symbol, weight: weight.get(symbol) ?? null }));
}

/** Holdings-Zeilen der ETF-Antwort. Symbole mit Leerzeichen oder Leerzeilen fallen weg. */
export function parseSpyHoldingWeights(raw: unknown): SpyHoldingWeight[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { holdings?: unknown }).holdings)
      ? (raw as { holdings: unknown[] }).holdings
      : [];
  const parsed: SpyHoldingWeight[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const symbol = String(record.asset ?? record.symbol ?? record.assetSymbol ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9.]{1,12}$/.test(symbol)) continue;
    const weight = finite(record.weightPercentage) ?? finite(record.weight) ?? finite(record.weightPercent);
    parsed.push({ symbol, weight: weight != null && weight > 0 ? weight : null });
  }
  return mergeWeights(parsed);
}

export function marketCapFromQuote(row: unknown): { symbol: string; marketCap: number; currency: string | null } | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const symbol = String(record.symbol ?? "").trim().toUpperCase();
  const marketCap = finite(record.marketCap) ?? finite(record.mktCap);
  if (!symbol || marketCap == null || !(marketCap > 0)) return null;
  const currencyRaw = record.currency;
  const currency = typeof currencyRaw === "string" && currencyRaw.trim() ? currencyRaw.trim().toUpperCase() : null;
  return { symbol, marketCap, currency };
}

function statementRow(row: unknown): { date: string; period: string; netIncome: number; currency: string | null } | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const netIncome = finite(record.netIncome);
  if (netIncome == null) return null;
  const date = String(record.date ?? "").slice(0, 10);
  const period = String(record.period ?? "").trim().toUpperCase();
  const currencyRaw = record.reportedCurrency ?? record.currency;
  const currency = typeof currencyRaw === "string" && currencyRaw.trim() ? currencyRaw.trim().toUpperCase() : null;
  return { date, period, netIncome, currency };
}

/**
 * Eine TTM-Zeile bleibt eine Summe. Quartalszeilen zählen nur, wenn vier vorliegen.
 * Weniger als vier Quartale ist kein TTM und wird nicht aufgefüllt.
 */
export function ttmNetIncomeFromStatement(raw: unknown): StatementMoney | null {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const rows = list.map(statementRow).filter((row): row is NonNullable<typeof row> => row != null);
  if (rows.length === 0) return null;
  const ttm = rows.find(row => row.period === "TTM");
  if (ttm) return { netIncome: ttm.netIncome, currency: ttm.currency };
  if (rows.length === 1 && rows[0].period !== "FY" && rows[0].period !== "ANNUAL" && rows[0].period !== "YEAR") {
    return { netIncome: rows[0].netIncome, currency: rows[0].currency };
  }
  const quarters = rows
    .filter(row => row.period !== "FY" && row.period !== "ANNUAL" && row.period !== "YEAR" && row.period !== "TTM")
    .sort((a, b) => b.date.localeCompare(a.date));
  const slice = quarters.slice(0, TTM_QUARTER_COUNT);
  if (slice.length < TTM_QUARTER_COUNT) return null;
  const currencies = new Set(slice.map(row => row.currency ?? "USD"));
  if (currencies.size !== 1) return null;
  return {
    netIncome: slice.reduce((sum, row) => sum + row.netIncome, 0),
    currency: slice[0].currency,
  };
}

function emptyAggregate(note: string, coverage: number | null): SpyAggregatePe {
  return {
    pe: null,
    coverage,
    estimate: false,
    source: null,
    formula: SPY_HOLDINGS_PE_FORMULA,
    note,
  };
}

/**
 * Σ Market Cap / Σ Earnings. Earnings dürfen negativ sein.
 * Veröffentlichung nur, wenn mindestens zwei Positionen Daten haben und die
 * belegte Gewichtsdecke strikt breiter ist als die größte Einzelposition.
 * Deckung unter 1 oder ohne Gewichte: Schätzung, mit Quelle und Formel.
 */
export function aggregateSpyHoldingsPe(rows: SpyHoldingFundamentals[]): SpyAggregatePe {
  const usable = rows.filter(row =>
    row.marketCap != null && row.marketCap > 0 && row.earningsTtm != null && Number.isFinite(row.earningsTtm),
  );
  const weighted = rows.filter(row => row.weight != null && row.weight > 0);
  const totalWeight = weighted.reduce((sum, row) => sum + (row.weight as number), 0);
  const coveredWeight = usable
    .filter(row => row.weight != null && row.weight > 0)
    .reduce((sum, row) => sum + (row.weight as number), 0);
  const coverage = totalWeight > 0 ? coveredWeight / totalWeight : null;
  if (usable.length === 0) {
    return emptyAggregate(naHoldings("PE: Holdings ohne Market Cap und TTM-Net-Income"), coverage);
  }
  const sumCap = usable.reduce((sum, row) => sum + (row.marketCap as number), 0);
  const sumEarn = usable.reduce((sum, row) => sum + (row.earningsTtm as number), 0);
  if (!(sumEarn !== 0)) {
    return emptyAggregate(naHoldings("PE: Summe Earnings (TTM) ist 0"), coverage);
  }
  const names = new Set(usable.map(row => row.symbol));
  if (names.size < 2) {
    return emptyAggregate(naHoldings("PE: nicht breiter als eine Einzelposition"), coverage);
  }
  const floor = largestHoldingWeightShare(rows.map(row => row.weight));
  if (coverage != null && floor != null && !(coverage > floor)) {
    const shown = formatCoveragePct(coverage);
    return emptyAggregate(naHoldings(`PE: Abdeckung ${shown} nicht breiter als die größte Einzelposition`), coverage);
  }
  const estimate = coverage == null || coverage < 1;
  return {
    pe: round2(sumCap / sumEarn),
    coverage,
    estimate,
    source: SPY_HOLDINGS_PE_SOURCE,
    formula: SPY_HOLDINGS_PE_FORMULA,
    note: null,
  };
}

/** Text hinter der PE-Zahl. Leer, wenn diese Zahl nicht aus den Holdings kommt. */
export function spyPeValueSuffix(args: {
  source: string | null | undefined;
  coverage: number | null | undefined;
  estimate: boolean | undefined;
}): string {
  if (!args.source) return "";
  const parts: string[] = [];
  if (args.estimate) parts.push("Schätzung");
  parts.push(args.coverage == null ? "Abdeckung fehlt" : `Abdeckung ${formatCoveragePct(args.coverage)}`);
  parts.push(args.source);
  parts.push(SPY_HOLDINGS_PE_FORMULA);
  return ` · ${parts.join(" · ")}`;
}

/**
 * #415 setzt an das leere FMP-KGV Sätze „PE/EPS:“, „PE:“ und „PE n/a:“.
 * Hält die Holdings-Zahl die Stelle, fliegen nur diese Sätze. Forward und g bleiben.
 */
export function dropHoldingsReplacedPeClauses(note: string | null): string | null {
  if (!note) return note;
  const clause = /PE\/EPS:|PE n\/a:|PE:|Forward:|fwd n\/a:|g n\/a:/g;
  const marks: RegExpExecArray[] = [];
  let found: RegExpExecArray | null;
  while ((found = clause.exec(note))) marks.push(found);
  if (marks.length === 0) return note;
  const kept: string[] = [];
  const head = note.slice(0, marks[0].index).trim();
  if (head) kept.push(head);
  for (let i = 0; i < marks.length; i += 1) {
    const start = marks[i].index ?? 0;
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? note.length) : note.length;
    const kind = marks[i][0];
    if (kind === "PE/EPS:" || kind === "PE:" || kind === "PE n/a:") continue;
    const text = note.slice(start, end).trim();
    if (text) kept.push(text);
  }
  const joined = kept.join(" ").trim();
  return joined || null;
}
