/**
 * One cache for the SerpApi Google Trends "Recession" print.
 * Fresh hits (under 12h) skip SerpApi. A 429, empty timeline, or timeout
 * keeps the last good print for 48h. The zone weights are not stored here.
 *
 * The print also sits in a local JSON file so a process restart can read it
 * back. F5-08 Redis is not wired (braucht Philip). The value-chain limiter
 * keeps its own store. A Trends Redis would be a new store.
 */
import fs from "node:fs";
import path from "node:path";

export const GOOGLE_TRENDS_CACHE_KEY = "google-trends-recession";
/** File name under the local cache directory. Not Redis. */
export const GOOGLE_TRENDS_DISK_NAME = "google-trends-recession.json";
/** Top of the 6–12h band. At this age the next run asks SerpApi again. */
export const GOOGLE_TRENDS_FRESH_MS = 12 * 60 * 60 * 1000;
/** Future_4: a print older than this is not a market value. */
export const GOOGLE_TRENDS_LAST_GOOD_MS = 48 * 60 * 60 * 1000;
/** Task + Future_4: the UI marks the print veraltet only after this age. */
export const GOOGLE_TRENDS_STALE_AFTER_HOURS = 24;

export interface GoogleTrendsCacheEntry {
  /** Null when this entry is only an n/a reason, not a scored print. */
  value: number | null;
  timestamp: number;
  source: string;
  /** Tagespunkte der SerpApi-Timeline, nur für die Anzeige. Der Score nutzt weiter `value`. */
  points?: { date: string; value: number }[];
  /** Closed-slot reason, kept so the next read does not collapse to a bare N/A. */
  naReason?: string;
}

export interface GoogleTrendsFreshness {
  ageHours: number;
  isStale: boolean;
}

export interface ParsedSerpApiTrends {
  value: number;
  latest: number;
  peak: number;
  source: string;
}

export interface AcceptedGoogleTrends {
  /** Null when nothing inside 48h can be scored. */
  value: number | null;
  source: string;
  ageHours: number | null;
  isStale: boolean;
  /** Set only when SerpApi just returned a finite print. Failures must not refresh the timestamp. */
  store: GoogleTrendsCacheEntry | null;
}

let memory: GoogleTrendsCacheEntry | null = null;
let diskDir: string | null = path.join(process.cwd(), ".cache");

/** Tests point this at a temp directory. `null` keeps the print in memory only. */
export function setGoogleTrendsDiskDirForTests(dir: string | null): void {
  diskDir = dir;
}

/** Drops the process copy and leaves the file, so a later read acts like a restart. */
export function forgetGoogleTrendsMemoryForTests(): void {
  memory = null;
}

function diskFile(): string | null {
  if (!diskDir) return null;
  return path.join(diskDir, GOOGLE_TRENDS_DISK_NAME);
}

function copyEntry(entry: GoogleTrendsCacheEntry): GoogleTrendsCacheEntry {
  return {
    value: entry.value,
    timestamp: entry.timestamp,
    source: entry.source,
    ...(entry.points?.length ? { points: entry.points.map(p => ({ date: p.date, value: p.value })) } : {}),
    ...(entry.naReason ? { naReason: entry.naReason } : {}),
  };
}

function entryFromUnknown(raw: unknown): GoogleTrendsCacheEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as { value?: unknown; timestamp?: unknown; source?: unknown; points?: unknown; naReason?: unknown };
  const naReason = typeof row.naReason === "string" && row.naReason.startsWith("n/a —") ? row.naReason : undefined;
  const value = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : null;
  if (value == null && !naReason) return null;
  if (typeof row.timestamp !== "number" || !Number.isFinite(row.timestamp)) return null;
  if (typeof row.source !== "string" || row.source.length === 0) return null;
  const points: { date: string; value: number }[] = [];
  if (Array.isArray(row.points)) {
    for (const point of row.points) {
      const item = point as { date?: unknown; value?: unknown } | null;
      if (typeof item?.date === "string" && typeof item.value === "number" && Number.isFinite(item.value)) {
        points.push({ date: item.date, value: item.value });
      }
    }
  }
  return {
    value,
    timestamp: row.timestamp,
    source: row.source,
    ...(points.length ? { points } : {}),
    ...(naReason ? { naReason } : {}),
  };
}

function readDisk(): GoogleTrendsCacheEntry | null {
  const file = diskFile();
  if (!file) return null;
  try {
    return entryFromUnknown(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return null;
  }
}

function writeDisk(entry: GoogleTrendsCacheEntry): void {
  const file = diskFile();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, file);
  } catch {
    // The local file is optional. The process copy still holds the print.
  }
}

export function resetGoogleTrendsCache(): void {
  memory = null;
  const file = diskFile();
  if (!file) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // Already absent.
  }
}

export function readGoogleTrendsCache(): GoogleTrendsCacheEntry | null {
  if (!memory) {
    const disk = readDisk();
    if (disk) memory = disk;
  }
  if (!memory) return null;
  return copyEntry(memory);
}

export function writeGoogleTrendsCache(entry: GoogleTrendsCacheEntry): void {
  memory = copyEntry(entry);
  writeDisk(memory);
}

export function googleTrendsFreshness(ageMs: number): GoogleTrendsFreshness {
  const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10;
  return { ageHours, isStale: ageHours > GOOGLE_TRENDS_STALE_AFTER_HOURS };
}

function ageMsOf(entry: GoogleTrendsCacheEntry, now: number): number | null {
  if (!Number.isFinite(entry.timestamp) || !Number.isFinite(now)) return null;
  const hasPrint = typeof entry.value === "number" && Number.isFinite(entry.value);
  const hasReason = typeof entry.naReason === "string" && entry.naReason.startsWith("n/a —");
  if (!hasPrint && !hasReason) return null;
  const age = now - entry.timestamp;
  if (age < 0) return null;
  return age;
}

/** A hit inside the fresh TTL. The caller must not call SerpApi. A reason hit is not a print. */
export function freshGoogleTrends(entry: GoogleTrendsCacheEntry | null, now: number): (GoogleTrendsFreshness & { value: number | null; source: string; naReason?: string }) | null {
  if (!entry) return null;
  const age = ageMsOf(entry, now);
  if (age == null || age >= GOOGLE_TRENDS_FRESH_MS) return null;
  const freshness = googleTrendsFreshness(age);
  if (entry.naReason && entry.naReason.startsWith("n/a —")) {
    return { value: null, source: entry.source, naReason: entry.naReason, ...freshness };
  }
  if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) return null;
  return { value: entry.value, source: entry.source, ...freshness };
}

/**
 * After a SerpApi attempt. `fetched` null means 429, empty timeline, timeout, or a body without a print.
 * The previous entry is returned unchanged when it is still inside 48h.
 */
export function acceptGoogleTrendsFetch(
  fetched: { value: number; source: string; points?: { date: string; value: number }[] } | null,
  cached: GoogleTrendsCacheEntry | null,
  now: number,
): AcceptedGoogleTrends {
  if (fetched && Number.isFinite(fetched.value)) {
    return {
      value: fetched.value,
      source: fetched.source,
      ageHours: 0,
      isStale: false,
      store: {
        value: fetched.value,
        source: fetched.source,
        timestamp: now,
        ...(fetched.points?.length ? { points: fetched.points } : {}),
      },
    };
  }
  if (cached) {
    const age = ageMsOf(cached, now);
    if (age != null && age <= GOOGLE_TRENDS_LAST_GOOD_MS) {
      const freshness = googleTrendsFreshness(age);
      return {
        value: cached.value,
        source: cached.source,
        ageHours: freshness.ageHours,
        isStale: freshness.isStale,
        store: null,
      };
    }
  }
  return { value: null, source: "Google Trends (N/A)", ageHours: null, isStale: false, store: null };
}

function finitePoint(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = parseFloat(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

/** SerpApi body → 7d average. An error object, HTML, or an empty timeline is a miss. */
export function parseSerpApiGoogleTrends(raw: string): ParsedSerpApiTrends | null {
  if (!raw || raw.includes("<html") || raw.includes("<!DOCTYPE")) return null;
  let parsed: {
    error?: unknown;
    search_metadata?: { status?: unknown };
    interest_over_time?: { timeline_data?: unknown };
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return null;
  }
  if (parsed?.error) return null;
  const status = parsed?.search_metadata?.status;
  if (typeof status === "string" && status.toLowerCase() === "error") return null;
  const timeline = parsed?.interest_over_time?.timeline_data;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  const values: number[] = [];
  for (const point of timeline) {
    const row = point as { values?: Array<{ extracted_value?: unknown; value?: unknown }> } | null;
    const cell = row?.values?.[0];
    const num = finitePoint(cell?.extracted_value ?? cell?.value);
    if (num != null) values.push(num);
  }
  if (values.length === 0) return null;
  const avg = Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10;
  const latest = values[values.length - 1];
  const peak = Math.max(...values);
  return {
    value: avg,
    latest,
    peak,
    source: `Google Trends via SerpApi (7d Ø=${avg}, Latest=${latest}, Peak=${peak})`,
  };
}

function trendPointDate(point: { timestamp?: unknown; date?: unknown } | null): string | null {
  const ts = typeof point?.timestamp === "number" ? point.timestamp : Number(point?.timestamp);
  if (Number.isFinite(ts) && ts > 1_000_000_000) return new Date(ts * 1000).toISOString().slice(0, 10);
  const text = typeof point?.date === "string" ? point.date.trim() : "";
  const match = text.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const months: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  const month = months[match[1]];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return `${match[3]}-${month}-${String(day).padStart(2, "0")}`;
}

/** Dieselbe Timeline wie der 7d-Ø, mit Datum. Ein Body ohne Druck ist null. Der Score-Wert ändert sich nicht. */
export function parseSerpApiTrendPoints(raw: string): { date: string; value: number }[] | null {
  if (!parseSerpApiGoogleTrends(raw)) return null;
  let parsed: { interest_over_time?: { timeline_data?: unknown } };
  try { parsed = JSON.parse(raw) as typeof parsed; } catch { return null; }
  const timeline = parsed.interest_over_time?.timeline_data;
  if (!Array.isArray(timeline)) return null;
  const out: { date: string; value: number }[] = [];
  for (const point of timeline) {
    const row = point as { timestamp?: unknown; date?: unknown; values?: Array<{ extracted_value?: unknown; value?: unknown }> } | null;
    const cell = row?.values?.[0];
    const num = finitePoint(cell?.extracted_value ?? cell?.value);
    const date = trendPointDate(row);
    if (num == null || !date) continue;
    out.push({ date, value: num });
  }
  return out.length ? out : null;
}
