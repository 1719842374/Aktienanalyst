/**
 * Unofficial Google Trends interest for "Recession" / US / now 7-d.
 * This is the same explore + multiline pair pytrends uses. It is not the
 * official Google Trends API (Alpha, Zugang auf Antrag): F3-08 / F4-09 braucht Philip.
 * No API key and no paid vendor. A miss returns null. Nothing is interpolated.
 */

export const PYTRENDS_KEYWORD = "Recession";
export const PYTRENDS_GEO = "US";
export const PYTRENDS_TIME = "now 7-d";
export const PYTRENDS_HL = "en-US";
export const PYTRENDS_TZ = "0";
export const PYTRENDS_EXPLORE_URL = "https://trends.google.com/trends/api/explore";
export const PYTRENDS_MULTILINE_URL = "https://trends.google.com/trends/api/widgetdata/multiline";
export const PYTRENDS_TIMEOUT_MS = 8_000;
export const PYTRENDS_USER_AGENT = "Mozilla/5.0 (compatible; Aktienanalyst/1.0; +https://github.com/1719842374/Aktienanalyst)";
/** Shown when trends.google.com answers 429. The body is not a print and is not cached. */
export const GOOGLE_TRENDS_RATE_LIMIT_NA = "n/a — Google Trends 429";
/** Shown when cache, SerpApi and pytrends all have no print. */
export const GOOGLE_TRENDS_EMPTY_NA = "n/a — kein Google-Trends-Verlauf";

export interface PytrendsWidget {
  token: string;
  request: unknown;
}

export interface PytrendsPoint {
  date: string;
  value: number;
}

export interface PytrendsPrint {
  value: number;
  latest: number;
  peak: number;
  source: string;
  points: PytrendsPoint[];
  ageHours: 0;
}

export function pytrendsExploreUrl(): string {
  const req = {
    comparisonItem: [{ keyword: PYTRENDS_KEYWORD, geo: PYTRENDS_GEO, time: PYTRENDS_TIME }],
    category: 0,
    property: "",
  };
  return `${PYTRENDS_EXPLORE_URL}?hl=${PYTRENDS_HL}&tz=${PYTRENDS_TZ}&req=${encodeURIComponent(JSON.stringify(req))}`;
}

export function pytrendsMultilineUrl(request: unknown, token: string): string {
  return `${PYTRENDS_MULTILINE_URL}?hl=${PYTRENDS_HL}&tz=${PYTRENDS_TZ}&req=${encodeURIComponent(JSON.stringify(request))}&token=${encodeURIComponent(token)}`;
}

/** Google prefixes the JSON with an XSSI guard. */
export function stripTrendsXssi(raw: string): string {
  const trimmed = raw.trim();
  const guard = trimmed.indexOf("{");
  if (trimmed.startsWith(")]}") && guard > 0) return trimmed.slice(guard);
  return trimmed;
}

function finite(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function parsePytrendsExplore(raw: string): PytrendsWidget | null {
  if (!raw || raw.includes("<html") || raw.includes("<!DOCTYPE")) return null;
  let parsed: { widgets?: unknown };
  try {
    parsed = JSON.parse(stripTrendsXssi(raw)) as { widgets?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(parsed.widgets)) return null;
  for (const widget of parsed.widgets) {
    const row = widget as { id?: unknown; token?: unknown; request?: unknown } | null;
    if (row?.id !== "TIMESERIES") continue;
    if (typeof row.token !== "string" || row.token.length === 0 || row.request == null) return null;
    return { token: row.token, request: row.request };
  }
  return null;
}

export function parsePytrendsMultiline(raw: string): Omit<PytrendsPrint, "ageHours"> | null {
  if (!raw || raw.includes("<html") || raw.includes("<!DOCTYPE")) return null;
  let parsed: { default?: { timelineData?: unknown } };
  try {
    parsed = JSON.parse(stripTrendsXssi(raw)) as { default?: { timelineData?: unknown } };
  } catch {
    return null;
  }
  const timeline = parsed.default?.timelineData;
  if (!Array.isArray(timeline) || timeline.length === 0) return null;
  const values: number[] = [];
  const points: PytrendsPoint[] = [];
  for (const point of timeline) {
    const row = point as { time?: unknown; value?: unknown } | null;
    const cell = Array.isArray(row?.value) ? row.value[0] : null;
    const num = finite(cell);
    if (num == null) continue;
    values.push(num);
    const stamp = typeof row?.time === "number" ? row.time : Number(row?.time);
    if (Number.isFinite(stamp) && stamp > 1_000_000_000) {
      points.push({ date: new Date(stamp * 1000).toISOString().slice(0, 10), value: num });
    }
  }
  if (values.length === 0) return null;
  const avg = Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10;
  const latest = values[values.length - 1];
  const peak = Math.max(...values);
  return {
    value: avg,
    latest,
    peak,
    points,
    source: `Google Trends via pytrends (7d Ø=${avg}, Latest=${latest}, Peak=${peak})`,
  };
}

export interface TrendsHttpResponse {
  status: number;
  body: string;
}

export type PytrendsOutcome =
  | { kind: "print"; print: PytrendsPrint }
  | { kind: "rate_limited" }
  | { kind: "miss" };

function responseOf(raw: TrendsHttpResponse | string): TrendsHttpResponse {
  if (typeof raw === "string") return { status: 0, body: raw };
  if (!raw || typeof raw.status !== "number") return { status: 0, body: "" };
  return { status: raw.status, body: typeof raw.body === "string" ? raw.body : "" };
}

function isGoogleRateLimited(res: TrendsHttpResponse): boolean {
  if (res.status === 429) return true;
  return res.body.includes("429") && res.body.includes("Too Many Requests");
}

/** Explore, then one multiline call. 429 is its own outcome so the caller does not cache it. */
export function readPytrendsOutcome(get: (url: string) => TrendsHttpResponse | string): PytrendsOutcome {
  const explore = responseOf(get(pytrendsExploreUrl()));
  if (isGoogleRateLimited(explore)) return { kind: "rate_limited" };
  const widget = parsePytrendsExplore(explore.body);
  if (!widget) return { kind: "miss" };
  const line = responseOf(get(pytrendsMultilineUrl(widget.request, widget.token)));
  if (isGoogleRateLimited(line)) return { kind: "rate_limited" };
  const parsed = parsePytrendsMultiline(line.body);
  if (!parsed) return { kind: "miss" };
  return { kind: "print", print: { ...parsed, ageHours: 0 } };
}

/** Explore, then one multiline call. Any wall, empty body, 429, or bad JSON is null. */
export function readPytrendsRecession(get: (url: string) => string): PytrendsPrint | null {
  const outcome = readPytrendsOutcome(get);
  if (outcome.kind === "print") return outcome.print;
  return null;
}
