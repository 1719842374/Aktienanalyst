export type BuffettRangeId = "6M" | "1Y" | "2Y" | "3Y" | "5Y" | "10Y" | "Max";

const YEAR_MS = 365.25 * 86_400_000;

function pushStamp(
  stamps: number[],
  iso: string,
  first: number,
  last: number,
) {
  const stamp = Date.parse(`${iso}T00:00:00Z`);
  if (stamp >= first - 86_400_000 && stamp <= last + 86_400_000) stamps.push(stamp);
}

/**
 * Die letzte Jahreszahl ist das Jahr des letzten Kurses.
 * Auf der langen Achse rückt ein zu nahes Vorgängerjahr weg,
 * damit 2026 nicht an 2010 oder 2020 hängen bleibt und abgeschnitten wird.
 */
function withFinalYear(stamps: number[], last: number, endGapMs: number, startGapMs = 0): number[] {
  const origin = stamps[0] ?? last;
  const head = stamps.filter((stamp, index) => {
    if (index === 0) return true;
    if (stamp - origin < startGapMs) return false;
    return last - stamp >= endGapMs;
  });
  if (head[head.length - 1] !== last) head.push(last);
  return head;
}

export function axisTicks(rows: { date: string }[], range: BuffettRangeId, wide: boolean): number[] {
  if (rows.length === 0) return [];
  const startYear = Number(rows[0].date.slice(0, 4));
  const endYear = Number(rows[rows.length - 1].date.slice(0, 4));
  const endMonth = Number(rows[rows.length - 1].date.slice(5, 7));
  const first = Date.parse(`${rows[0].date}T00:00:00Z`);
  const last = Date.parse(`${rows[rows.length - 1].date}T00:00:00Z`);
  const stamps: number[] = [];
  const push = (iso: string) => pushStamp(stamps, iso, first, last);
  if (range === "Max") {
    const step = wide ? 5 : 10;
    stamps.push(first);
    const start = Math.ceil((startYear + 1) / step) * step;
    for (let year = start; year <= endYear; year += step) push(`${year}-01-01`);
    return withFinalYear(stamps, last, (wide ? 3 : 8) * YEAR_MS, wide ? 0 : 12 * YEAR_MS);
  }
  if (range === "10Y" || range === "5Y" || range === "3Y") {
    for (let year = startYear; year <= endYear; year += 1) push(`${year}-01-01`);
    return withFinalYear(stamps, last, 1.05 * YEAR_MS);
  }
  const step = range === "6M" ? 1 : range === "1Y" ? 2 : 6;
  let year = startYear;
  let month = Number(rows[0].date.slice(5, 7));
  while (year < endYear || (year === endYear && month <= endMonth)) {
    push(`${year}-${String(month).padStart(2, "0")}-01`);
    month += step;
    while (month > 12) {
      month -= 12;
      year += 1;
    }
  }
  return withFinalYear(stamps, last, 20 * 86_400_000);
}

export function tickLabel(value: number, range: BuffettRangeId): string {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  if (range === "6M" || range === "1Y" || range === "2Y") {
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}.${String(year).slice(2)}`;
  }
  return String(year);
}
