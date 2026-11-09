/**
 * FW-27: hochgeladene Bilanzzeilen → Red Flags. Nur Anzeige, kein Score.
 * Eine fehlende Spalte bleibt n/a. Nichts wird aufgefüllt.
 * Schwellen sind Perzentile der eigenen Historie, benannte Parameter.
 */

export const BALANCE_IDENTITY_REL_TOL = 0.01;
export const BALANCE_MIN_HISTORY = 8;
export const BALANCE_STRESS_TAIL = 0.1;
export const BALANCE_MAX_ROWS = 80;

export interface BalanceRow {
  date: string;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  cash: number | null;
  totalDebt: number | null;
}

export interface BalanceFlag {
  id: string;
  title: string;
  active: boolean | null;
  detail: string;
}

export interface BalanceScreenResult {
  rowCount: number;
  flags: BalanceFlag[];
  note: string;
}

const COLUMNS = [
  "date",
  "totalAssets",
  "totalLiabilities",
  "totalEquity",
  "currentAssets",
  "currentLiabilities",
  "cash",
  "totalDebt",
] as const;

type Column = (typeof COLUMNS)[number];

const HEADER_ALIAS: Record<string, Column> = {
  date: "date",
  datum: "date",
  totalassets: "totalAssets",
  assets: "totalAssets",
  aktiva: "totalAssets",
  totalliabilities: "totalLiabilities",
  liabilities: "totalLiabilities",
  verbindlichkeiten: "totalLiabilities",
  totalequity: "totalEquity",
  equity: "totalEquity",
  eigenkapital: "totalEquity",
  currentassets: "currentAssets",
  umlaufvermoegen: "currentAssets",
  currentliabilities: "currentLiabilities",
  kurzfristigeverbindlichkeiten: "currentLiabilities",
  cash: "cash",
  kasse: "cash",
  totaldebt: "totalDebt",
  debt: "totalDebt",
  schulden: "totalDebt",
};

function normHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9äöü]/g, "");
}

function splitLine(line: string): string[] {
  const sep = line.includes(";") && !line.includes(",") ? ";" : ",";
  return line.split(sep).map(cell => cell.trim().replace(/^"|"$/g, ""));
}

function parseNumber(raw: string): number | null {
  if (!raw || raw.toLowerCase() === "n/a" || raw === "-" || raw === "—") return null;
  const normalized = raw.replace(/\s/g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseBalanceCsv(csv: string): { rows: BalanceRow[]; error: string | null } {
  const lines = csv.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], error: "n/a — CSV braucht eine Kopfzeile und mindestens eine Datenzeile" };
  const headers = splitLine(lines[0]).map(normHeader);
  const index = new Map<Column, number>();
  headers.forEach((header, i) => {
    const column = HEADER_ALIAS[header];
    if (column && !index.has(column)) index.set(column, i);
  });
  if (!index.has("date")) return { rows: [], error: "n/a — Spalte date fehlt" };
  const rows: BalanceRow[] = [];
  for (const line of lines.slice(1)) {
    if (rows.length >= BALANCE_MAX_ROWS) break;
    const cells = splitLine(line);
    const date = cells[index.get("date") ?? -1] ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const num = (column: Column) => {
      const at = index.get(column);
      if (at == null) return null;
      return parseNumber(cells[at] ?? "");
    };
    rows.push({
      date,
      totalAssets: num("totalAssets"),
      totalLiabilities: num("totalLiabilities"),
      totalEquity: num("totalEquity"),
      currentAssets: num("currentAssets"),
      currentLiabilities: num("currentLiabilities"),
      cash: num("cash"),
      totalDebt: num("totalDebt"),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0) return { rows: [], error: "n/a — keine Zeile mit Datum YYYY-MM-DD" };
  return { rows, error: null };
}

function percentileRank(latest: number, history: number[]): number | null {
  if (history.length < BALANCE_MIN_HISTORY) return null;
  const below = history.filter(value => value < latest).length;
  const equal = history.filter(value => value === latest).length;
  return (below + 0.5 * equal) / history.length;
}

function ratio(num: number | null, den: number | null): number | null {
  if (num == null || den == null || !(den > 0)) return null;
  return num / den;
}

function flag(id: string, title: string, active: boolean | null, detail: string): BalanceFlag {
  return { id, title, active, detail };
}

export function screenBalanceRows(rows: BalanceRow[]): BalanceScreenResult {
  const latest = rows[rows.length - 1];
  const flags: BalanceFlag[] = [];

  if (!latest || latest.totalAssets == null || latest.totalLiabilities == null || latest.totalEquity == null) {
    flags.push(flag(
      "identity",
      "Bilanzidentität",
      null,
      "n/a — Aktiva, Verbindlichkeiten oder Eigenkapital fehlt",
    ));
  } else if (!(latest.totalAssets > 0)) {
    flags.push(flag("identity", "Bilanzidentität", null, "n/a — Aktiva nicht positiv"));
  } else {
    const gap = Math.abs(latest.totalAssets - (latest.totalLiabilities + latest.totalEquity));
    const rel = gap / latest.totalAssets;
    const active = rel > BALANCE_IDENTITY_REL_TOL;
    flags.push(flag(
      "identity",
      "Bilanzidentität",
      active,
      active
        ? `Abweichung ${(rel * 100).toFixed(2)} % der Aktiva, Toleranz ${(BALANCE_IDENTITY_REL_TOL * 100).toFixed(0)} % (${latest.date})`
        : `Aktiva = Verbindlichkeiten + Eigenkapital innerhalb ${(BALANCE_IDENTITY_REL_TOL * 100).toFixed(0)} % (${latest.date})`,
    ));
  }

  if (latest?.totalEquity == null) {
    flags.push(flag("negative-equity", "Negatives Eigenkapital", null, "n/a — Eigenkapital fehlt"));
  } else {
    flags.push(flag(
      "negative-equity",
      "Negatives Eigenkapital",
      latest.totalEquity < 0,
      latest.totalEquity < 0
        ? `Eigenkapital ${latest.totalEquity} am ${latest.date}`
        : `Eigenkapital nicht negativ (${latest.date})`,
    ));
  }

  const currentHistory = rows
    .map(row => ratio(row.currentAssets, row.currentLiabilities))
    .filter((value): value is number => value != null);
  const currentLatest = latest ? ratio(latest.currentAssets, latest.currentLiabilities) : null;
  const currentRank = currentLatest == null ? null : percentileRank(currentLatest, currentHistory);
  if (currentLatest == null) {
    flags.push(flag("current-ratio", "Current Ratio", null, "n/a — Umlaufvermögen oder kurzfristige Verbindlichkeiten fehlt"));
  } else if (currentRank == null) {
    flags.push(flag(
      "current-ratio",
      "Current Ratio",
      null,
      `n/a — Historie ${currentHistory.length} < ${BALANCE_MIN_HISTORY}, kein Perzentil`,
    ));
  } else {
    const active = currentRank <= BALANCE_STRESS_TAIL;
    flags.push(flag(
      "current-ratio",
      "Current Ratio",
      active,
      `aktuell ${currentLatest.toFixed(2)}, Perzentil ${Math.round(currentRank * 100)} der eigenen ${currentHistory.length} Werte, Stress ≤ P${Math.round(BALANCE_STRESS_TAIL * 100)}`,
    ));
  }

  const debtLatest = latest && latest.totalEquity != null && latest.totalEquity > 0
    ? ratio(latest.totalDebt, latest.totalEquity)
    : null;
  const debtSeries = rows
    .filter(row => row.totalEquity != null && row.totalEquity > 0)
    .map(row => ratio(row.totalDebt, row.totalEquity))
    .filter((value): value is number => value != null);
  const debtRank = debtLatest == null ? null : percentileRank(debtLatest, debtSeries);
  if (latest?.totalDebt == null || latest.totalEquity == null) {
    flags.push(flag("debt-equity", "Schulden / Eigenkapital", null, "n/a — Schulden oder Eigenkapital fehlt"));
  } else if (!(latest.totalEquity > 0)) {
    flags.push(flag("debt-equity", "Schulden / Eigenkapital", null, "n/a — Eigenkapital nicht positiv, Quote nicht gebildet"));
  } else if (debtRank == null) {
    flags.push(flag(
      "debt-equity",
      "Schulden / Eigenkapital",
      null,
      `n/a — Historie ${debtSeries.length} < ${BALANCE_MIN_HISTORY}, kein Perzentil`,
    ));
  } else {
    const active = debtRank >= 1 - BALANCE_STRESS_TAIL;
    flags.push(flag(
      "debt-equity",
      "Schulden / Eigenkapital",
      active,
      `aktuell ${debtLatest!.toFixed(2)}, Perzentil ${Math.round(debtRank * 100)} der eigenen ${debtSeries.length} Werte, Stress ≥ P${Math.round((1 - BALANCE_STRESS_TAIL) * 100)}`,
    ));
  }
  if (latest?.cash == null || latest.totalAssets == null) {
    flags.push(flag("cash-vs-assets", "Kasse gegen Aktiva", null, "n/a — Kasse oder Aktiva fehlt"));
  } else {
    const active = latest.cash > latest.totalAssets;
    flags.push(flag(
      "cash-vs-assets",
      "Kasse gegen Aktiva",
      active,
      active
        ? `Kasse ${latest.cash} liegt über Aktiva ${latest.totalAssets} (${latest.date})`
        : `Kasse nicht über Aktiva (${latest.date})`,
    ));
  }

  return {
    rowCount: rows.length,
    flags,
    note: "Nur Anzeige. Kein Score, kein Rating, keine Ergänzung fehlender Zellen.",
  };
}

export function screenBalanceCsv(csv: string): BalanceScreenResult & { error: string | null } {
  const parsed = parseBalanceCsv(csv);
  if (parsed.error || parsed.rows.length === 0) {
    return {
      rowCount: 0,
      flags: [],
      note: "Nur Anzeige. Kein Score.",
      error: parsed.error,
    };
  }
  return { ...screenBalanceRows(parsed.rows), error: null };
}
