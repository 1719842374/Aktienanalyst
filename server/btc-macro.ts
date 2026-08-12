/**
 * BTC-Makro-Overlay-Daten fuer den technischen BTC-Chart.
 *
 * Die BTC-Analyse selbst bleibt bewusst im Client: Dort werden Preis, MAs und
 * Signale bereits vollstaendig berechnet. Dieses kleine Backend-Modul liefert
 * ausschliesslich die FRED-Reihen, damit DFII10/M2SL nicht von Browser-CORS
 * oder unterschiedlichen Client-Implementierungen abhaengen.
 */
import { execFile } from "child_process";
import { promisify } from "util";

export interface FredPoint {
  date: string;
  value: number;
}

export interface BTCMacroHistory {
  real10yByDate: Record<string, number>;
  m2YoyByDate: Record<string, number>;
  latestReal10y: FredPoint | null;
  latestM2Yoy: FredPoint | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const execFileAsync = promisify(execFile);

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function parseFredCsv(csv: string): FredPoint[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const points: FredPoint[] = [];
  for (const line of lines.slice(1)) {
    const [date, rawValue] = line.split(",");
    if (!date || !rawValue || rawValue === ".") continue;
    const value = Number(rawValue);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(value)) {
      points.push({ date, value });
    }
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Berechnet M2-Wachstum aus Monatswerten und schreibt den jeweils zuletzt
 * bekannten YoY-Wert auf jeden Kalendertag fort. Damit laesst sich die Serie
 * direkt mit dem taeglichen, auch an Wochenenden gehandelten BTC-Chart mergen.
 */
export function buildM2YoyForwardFill(
  monthlyM2: FredPoint[],
  startDate: string,
  endDate: string,
): Record<string, number> {
  const yoyByMonth = new Map<string, number>();
  const ordered = [...monthlyM2].sort((a, b) => a.date.localeCompare(b.date));

  for (let i = 12; i < ordered.length; i++) {
    const current = ordered[i];
    const yearAgo = ordered[i - 12];
    if (current.value > 0 && yearAgo.value > 0) {
      yoyByMonth.set(current.date, ((current.value / yearAgo.value) - 1) * 100);
    }
  }

  const output: Record<string, number> = {};
  const monthlyYoy = Array.from(yoyByMonth.entries());
  let pointIndex = 0;
  let latestValue: number | null = null;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);

  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    const date = toDateKey(new Date(time));
    while (pointIndex < monthlyYoy.length && monthlyYoy[pointIndex][0] <= date) {
      latestValue = monthlyYoy[pointIndex][1];
      pointIndex++;
    }
    if (latestValue !== null) output[date] = latestValue;
  }

  return output;
}

function subtractMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return toDateKey(d);
}

async function fetchFREDSeriesHistory(seriesId: string, startDate: string): Promise<FredPoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${startDate}`;
  // curl entspricht bewusst dem bewaehrten Gold-Pendant: In manchen
  // Laufzeitumgebungen bleibt Node/undici beim öffentlichen FRED-CDN haengen,
  // waehrend curl die CSV stabil und ohne API-Key abruft.
  const { stdout } = await execFileAsync(
    "curl",
    ["-fsSL", "--max-time", "20", url],
    { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
  );
  return parseFredCsv(stdout);
}

export async function fetchBTCMacroHistory(startDate: string, endDate = toDateKey(new Date())): Promise<BTCMacroHistory> {
  // Fuer den ersten sichtbaren YoY-Wert brauchen wir 12 Vormonate vor dem
  // BTC-Chart-Start; ein zusaetzlicher Monat puffert abweichende FRED-Termine.
  const m2StartDate = subtractMonths(startDate, 13);
  const [real10y, m2] = await Promise.all([
    fetchFREDSeriesHistory("DFII10", startDate),
    fetchFREDSeriesHistory("M2SL", m2StartDate),
  ]);

  const m2YoyByDate = buildM2YoyForwardFill(m2, startDate, endDate);
  const m2YoyEntries = Object.entries(m2YoyByDate);
  const latestM2Yoy = m2YoyEntries.length > 0
    ? { date: m2YoyEntries[m2YoyEntries.length - 1][0], value: m2YoyEntries[m2YoyEntries.length - 1][1] }
    : null;

  return {
    real10yByDate: Object.fromEntries(real10y.map(point => [point.date, point.value])),
    m2YoyByDate,
    latestReal10y: real10y.length > 0 ? real10y[real10y.length - 1] : null,
    latestM2Yoy,
  };
}
