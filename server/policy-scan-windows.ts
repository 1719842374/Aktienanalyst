/**
 * FRED-Fenster fuer Sektion 14. Richtung rechnet der Server, nicht das Modell.
 * Fehlt ein Punkt in der Naehe von einem oder zwei Jahren, ist die Richtung
 * unbekannt und wird nicht geschaetzt.
 */

export const FRED_LOOKBACK_DAYS = 800;
export const WINDOW_GAP_DAYS = 45;

export type WindowDirection = "steigend" | "fallend" | "unverändert" | "unbekannt";

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface SeriesDirectionReading {
  latest: number | null;
  level1y: number | null;
  level2y: number | null;
  diff1y: number | null;
  diff2y: number | null;
  direction1y: WindowDirection;
  direction2y: WindowDirection;
}

export interface PolicyWindows {
  policyRate: SeriesDirectionReading;
  realYield10y: SeriesDirectionReading;
  dgs10: SeriesDirectionReading;
  m2Bn: SeriesDirectionReading;
  tgaBn: SeriesDirectionReading;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function shiftUtcDate(isoDate: string, days: number): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return isoDate;
  return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

function daysBetweenUtc(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.POSITIVE_INFINITY;
  return Math.round((tb - ta) / 86400000);
}

/** Naechster Punkt zum Stichtag minus daysBack. Ausserhalb der Luecke: null. */
export function levelNear(
  points: SeriesPoint[],
  asOf: string,
  daysBack: number,
  maxGapDays = WINDOW_GAP_DAYS,
): number | null {
  if (!ISO.test(asOf)) return null;
  const target = shiftUtcDate(asOf, -daysBack);
  let best: { value: number; gap: number } | null = null;
  for (const p of points) {
    if (!ISO.test(p.date) || !Number.isFinite(p.value)) continue;
    const gap = Math.abs(daysBetweenUtc(p.date, target));
    if (gap <= maxGapDays && (best == null || gap < best.gap)) best = { value: p.value, gap };
  }
  return best ? best.value : null;
}

export function directionBetween(
  latest: number | null,
  prior: number | null,
): { diff: number | null; direction: WindowDirection } {
  if (latest == null || prior == null || !Number.isFinite(latest) || !Number.isFinite(prior)) {
    return { diff: null, direction: "unbekannt" };
  }
  const diff = latest - prior;
  const eps = Math.max(1e-9, Math.abs(latest) * 1e-9);
  if (Math.abs(diff) <= eps) return { diff: 0, direction: "unverändert" };
  return { diff, direction: diff > 0 ? "steigend" : "fallend" };
}

export function readingFromSeries(
  points: SeriesPoint[],
  asOf: string,
  transform: (value: number) => number = (v) => v,
  maxGapDays = WINDOW_GAP_DAYS,
): SeriesDirectionReading {
  const sorted = points
    .filter(p => ISO.test(p.date) && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  const latest = last ? transform(last.value) : null;
  const raw1 = levelNear(sorted, asOf, 365, maxGapDays);
  const raw2 = levelNear(sorted, asOf, 730, maxGapDays);
  const level1y = raw1 == null ? null : transform(raw1);
  const level2y = raw2 == null ? null : transform(raw2);
  const d1 = directionBetween(latest, level1y);
  const d2 = directionBetween(latest, level2y);
  return {
    latest,
    level1y,
    level2y,
    diff1y: d1.diff,
    diff2y: d2.diff,
    direction1y: d1.direction,
    direction2y: d2.direction,
  };
}

export function emptyReading(): SeriesDirectionReading {
  return {
    latest: null,
    level1y: null,
    level2y: null,
    diff1y: null,
    diff2y: null,
    direction1y: "unbekannt",
    direction2y: "unbekannt",
  };
}

function pushVariants(bag: number[], value: number | null): void {
  if (value == null || !Number.isFinite(value)) return;
  bag.push(value, Math.abs(value));
  for (const digits of [0, 1, 2]) {
    const factor = 10 ** digits;
    const rounded = Math.round(value * factor) / factor;
    bag.push(rounded, Math.abs(rounded));
  }
}

/** Niveaus, Vorjahresniveaus, Differenzen, dazu M2 in Billionen. */
export function allowedMeasuredNumbers(windows: PolicyWindows): number[] {
  const bag: number[] = [];
  const readings = [windows.policyRate, windows.realYield10y, windows.dgs10, windows.m2Bn, windows.tgaBn];
  for (const reading of readings) {
    pushVariants(bag, reading.latest);
    pushVariants(bag, reading.level1y);
    pushVariants(bag, reading.level2y);
    pushVariants(bag, reading.diff1y);
    pushVariants(bag, reading.diff2y);
  }
  pushVariants(bag, windows.m2Bn.latest == null ? null : windows.m2Bn.latest / 1000);
  pushVariants(bag, windows.m2Bn.level1y == null ? null : windows.m2Bn.level1y / 1000);
  pushVariants(bag, windows.m2Bn.level2y == null ? null : windows.m2Bn.level2y / 1000);
  return bag;
}

function parseLooseNumber(token: string): number | null {
  const t = token.replace(/^[.,]+|[.,]+$/g, "").replace(/\u2212/g, "-");
  if (!t || t === "-" || t === "." || t === ",") return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    const [whole, frac] = t.split(",");
    const n = Number(whole.replace(/\./g, "") + (frac != null ? "." + frac : ""));
    return Number.isFinite(n) ? n : null;
  }
  if (/^-?\d+,\d+$/.test(t)) {
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numberMatchesMeasured(n: number, allowed: number): boolean {
  const tol = Math.max(0.005, Math.abs(allowed) * 0.0005);
  if (Math.abs(n - allowed) <= tol) return true;
  for (const digits of [0, 1, 2]) {
    const factor = 10 ** digits;
    if (Math.abs(n - Math.round(allowed * factor) / factor) <= 0.001) return true;
  }
  return false;
}

function stripLabelNumbers(text: string): string {
  return text
    .replace(/\u2212/g, "-")
    .replace(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\b10\s*[-–]?\s*(?:jahres(?:rendite)?|jahre|year|y)\b/gi, " ")
    .replace(/\b10y\b/gi, " ")
    .replace(/\b[12]\s*[-–]?\s*jahre?n?\b/gi, " ")
    .replace(/\b[12]\s*j\b/gi, " ");
}

/** Jede uebrige Zahl muss zu einem gemessenen Niveau oder einer Differenz passen. */
export function proseNumbersAreMeasured(text: string, allowed: number[]): boolean {
  const stripped = stripLabelNumbers(text);
  const tokens = stripped.match(/(?<![A-Za-z])-?\d[\d.,]*/g) ?? [];
  for (const token of tokens) {
    const n = parseLooseNumber(token);
    if (n == null) continue;
    if (!allowed.some(a => numberMatchesMeasured(n, a))) return false;
  }
  return true;
}

function trimNum(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded);
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unbekannt";
  return `${trimNum(value)} Prozent`;
}

function fmtM2(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unbekannt";
  return `${trimNum(value / 1000)} Billionen USD`;
}

function fmtTga(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "unbekannt";
  return `${trimNum(value)} Milliarden USD`;
}

export function measuredViews(windows: PolicyWindows): {
  lead: string;
  rates: string;
  liquidity: string;
  fiscal: string;
  drivers: string[];
  btc: string;
} {
  const p = windows.policyRate;
  const r = windows.realYield10y;
  const y = windows.dgs10;
  const m = windows.m2Bn;
  const t = windows.tgaBn;
  const sentence1 = `Leitzins ${fmtPct(p.latest)} (ein Jahr ${p.direction1y}, zwei Jahre ${p.direction2y}), Realzins zehn Jahre ${fmtPct(r.latest)} (ein Jahr ${r.direction1y}, zwei Jahre ${r.direction2y}), Zehnjahresrendite ${fmtPct(y.latest)} (ein Jahr ${y.direction1y}, zwei Jahre ${y.direction2y}).`;
  const sentence2 = `M2 ${fmtM2(m.latest)} (ein Jahr ${m.direction1y}, zwei Jahre ${m.direction2y}), TGA ${fmtTga(t.latest)} (ein Jahr ${t.direction1y}, zwei Jahre ${t.direction2y}).`;
  const named: [string, SeriesDirectionReading][] = [
    ["Leitzins", p],
    ["Realzins", r],
    ["Zehnjahresrendite", y],
    ["M2", m],
    ["TGA", t],
  ];
  const drivers = named
    .filter(([, reading]) => reading.direction1y !== "unbekannt" || reading.direction2y !== "unbekannt")
    .slice(0, 3)
    .map(([name, reading]) => `${name}: ein Jahr ${reading.direction1y}, zwei Jahre ${reading.direction2y}`);
  return {
    lead: `${sentence1} ${sentence2}`,
    rates: `Leitzins ${fmtPct(p.latest)}, ein Jahr ${p.direction1y}, zwei Jahre ${p.direction2y}. Realzins ${fmtPct(r.latest)}, ein Jahr ${r.direction1y}, zwei Jahre ${r.direction2y}. Zehnjahresrendite ${fmtPct(y.latest)}, ein Jahr ${y.direction1y}, zwei Jahre ${y.direction2y}.`,
    liquidity: `M2 steht bei ${fmtM2(m.latest)}, über ein Jahr ${m.direction1y} und über zwei Jahre ${m.direction2y}.`,
    fiscal: `TGA steht bei ${fmtTga(t.latest)}, über ein Jahr ${t.direction1y} und über zwei Jahre ${t.direction2y}.`,
    drivers: drivers.length > 0
      ? drivers
      : ["Für Leitzins, Realzins, Rendite, M2 und TGA fehlt der Vergleichspunkt, die Richtung bleibt unbekannt."],
    btc: "Für BTC zählt, ob belegte Regeln die Krypto-Liquidität entlasten oder belasten, zusammen mit der gemessenen Richtung von Leitzins, Realzins, Rendite, M2 und TGA.",
  };
}
