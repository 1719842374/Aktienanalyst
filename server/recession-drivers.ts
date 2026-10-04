/**
 * Target + historical z for the recession driver whitelist.
 * callLLMJson runs only when set A (|z| >= 1) is not empty.
 * A missing series stays out of the matrix. This module does not score the 17 indicators.
 */

export const DRIVER_SERIES = [
  "DCOILWTICO",
  "DCOILBRENTEU",
  "PNGASUSUSDM",
  "WPU065",
  "PWHEAMTUSDM",
  "T10YIE",
  "DGS10",
  "DFII10",
  "DFF",
  "WALCL",
  "WTREGEN",
  "BAA10Y",
  "T10Y2Y",
  "DRTSCIS",
  "PCEPILFE",
  "CPILFESL",
] as const;

export const INFLATION_TARGET_PCT = 2;
export const Z_CLIP = 2;
export const Z_EPSILON = 1e-6;
export const HISTORY_YEARS = 10;
export const DRIVER_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWS_CACHE_MS = 24 * 60 * 60 * 1000;

export const DRIVER_SYSTEM_PROMPT =
  "Nur Serien in A. Warum liegt die Serie über der Norm? Eine Kette order1/2/3. shareClaim nur mit Zitat aus NEWS_PACK. Keine Person, keine Score-Zahl, keine Serie außerhalb A. Keine Pflichtwörter. Wenn keine Headline passt: weglassen — Serie bleibt „auffällig, Grund offen“.";

const INFLATION_IDS = new Set<string>(["PCEPILFE", "CPILFESL"]);
const OPEN_REASON = "auffällig, Grund offen";
const MIN_SPAN_MS = 0.9 * HISTORY_YEARS * 365.25 * 24 * 60 * 60 * 1000;

const NEWS_NAME: Record<string, string> = {
  DCOILWTICO: "WTI crude oil price",
  DCOILBRENTEU: "Brent crude oil price",
  PNGASUSUSDM: "US natural gas price",
  WPU065: "US producer prices chemicals",
  PWHEAMTUSDM: "wheat price",
  T10YIE: "breakeven inflation",
  DGS10: "10-year Treasury yield",
  DFII10: "10-year real yield",
  DFF: "federal funds rate",
  WALCL: "Federal Reserve balance sheet",
  WTREGEN: "reverse repo",
  BAA10Y: "corporate credit spread",
  T10Y2Y: "yield curve spread",
  DRTSCIS: "bank lending standards",
  PCEPILFE: "core PCE",
  CPILFESL: "core CPI",
};

export interface DriverObs {
  date: string;
  value: number;
}

export type SeriesLabel =
  | "unauffällig"
  | "Ziel verfehlt, historisch üblich"
  | "unter Ziel, aber unüblich"
  | "auffällig";

export interface MeasuredSeries {
  id: string;
  value: number;
  asOf: string;
  z: number;
  aboveTarget: boolean;
  inA: boolean;
  label: SeriesLabel;
  line: string | null;
}

export interface DriverCard {
  id: string;
  title: string;
  text: string;
  reason: string;
}

export interface DriverView {
  status: "unauffällig" | "drivers" | "empty";
  lines: string[];
  cards: DriverCard[];
}

export interface DriverAssessment extends DriverView {
  llmCalls: number;
}

export interface DriverNewsItem {
  title: string;
  pubDate?: string;
}

export interface DriverCache {
  drivers: { key: string; at: number; assessment: DriverView } | null;
  news: { key: string; at: number; items: DriverNewsItem[] } | null;
}

export type DriverLlm = (opts: {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}) => Promise<{ data: unknown } | null>;

export type FredFetch = (url: string) => Promise<{ ok: boolean; text: () => Promise<string> }>;

const memoryCache: DriverCache = { drivers: null, news: null };

export function clipZ(z: number): number {
  if (z > Z_CLIP) return Z_CLIP;
  if (z < -Z_CLIP) return -Z_CLIP;
  return z;
}

export function zScore(x: number, sample: number[]): number | null {
  if (!Number.isFinite(x) || sample.length < 2) return null;
  if (sample.some(v => !Number.isFinite(v))) return null;
  const mu = sample.reduce((s, v) => s + v, 0) / sample.length;
  const variance = sample.reduce((s, v) => s + (v - mu) ** 2, 0) / sample.length;
  const sigma = Math.sqrt(variance);
  const z = (x - mu) / (sigma + Z_EPSILON);
  if (!Number.isFinite(z)) return null;
  return clipZ(z);
}

/** Highest value still inside the bottom third. */
export function lowTercileCutoff(values: number[]): number | null {
  if (values.length < 3) return null;
  const sorted = [...values].filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length < 3) return null;
  const cutoffIndex = Math.floor(sorted.length / 3) - 1;
  return sorted[Math.max(0, cutoffIndex)];
}

export function formatDe(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  const text = rounded.toFixed(1).replace(".", ",");
  return text.endsWith(",0") ? text.slice(0, -2) : text;
}

export function inHistoryWindow(date: string, now: Date, years: number): boolean {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return false;
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  return t >= start.getTime() && t <= now.getTime();
}

export function parseFredCsv(csv: string): DriverObs[] {
  if (!csv || csv.includes("<html") || csv.includes("<!DOCTYPE")) return [];
  const lines = csv.trim().split(/\r?\n/).slice(1);
  const out: DriverObs[] = [];
  for (const line of lines) {
    const [date, valStr] = line.split(",");
    const value = parseFloat(valStr?.trim());
    if (date && Number.isFinite(value)) out.push({ date: date.trim(), value });
  }
  return out;
}

export function newsQueryFor(ids: string[]): string {
  const names = ids.map(id => NEWS_NAME[id] ?? id);
  return `${names.join(" OR ")} when:7d`;
}

export function headlinesWithinDays(items: DriverNewsItem[], now: Date, days: number): DriverNewsItem[] {
  const ms = days * 24 * 60 * 60 * 1000;
  return items.filter(item => {
    if (!item.pubDate) return false;
    const t = Date.parse(item.pubDate);
    if (!Number.isFinite(t)) return false;
    const age = now.getTime() - t;
    return age >= -60 * 60 * 1000 && age <= ms;
  });
}

export function buildDriverUserPrompt(series: MeasuredSeries[], news: DriverNewsItem[]): string {
  const snap = series.map(s => `${s.id} ${s.asOf} ${formatDe(s.value)}`).join("\n");
  const pack = news.map(n => `- ${n.title}`).join("\n");
  return [
    "A:",
    series.map(s => s.id).join(" "),
    "SNAP:",
    snap,
    "NEWS_PACK:",
    pack || "(leer)",
    'Antworte nur mit JSON: {"items":[{"id":"","order1":"","order2":"","order3":"","shareClaim":""}]}',
  ].join("\n");
}

export function driverFazitSections(view: DriverView): { title: string; emoji: string; text: string }[] {
  if (view.status === "unauffällig") {
    const text = view.lines.length > 0 ? `unauffällig. ${view.lines.join(" ")}` : "unauffällig";
    return [{ title: "unauffällig", emoji: "🌍", text }];
  }
  if (view.status !== "drivers") return [];
  return view.cards.map(card => ({ title: card.title, emoji: "🌍", text: card.text }));
}

function sortedObs(obs: DriverObs[]): DriverObs[] {
  return obs
    .filter(o => o && typeof o.date === "string" && Number.isFinite(o.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function spansHistory(obs: DriverObs[]): boolean {
  if (obs.length < 3) return false;
  const a = Date.parse(`${obs[0].date}T00:00:00Z`);
  const b = Date.parse(`${obs[obs.length - 1].date}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b - a >= MIN_SPAN_MS;
}

function monthGap(earlier: string, later: string): number {
  const a = new Date(`${earlier}T00:00:00Z`);
  const b = new Date(`${later}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

function classify(
  id: string,
  value: number,
  asOf: string,
  z: number,
  aboveTarget: boolean,
  kind: "inflation" | "dff" | "level",
): MeasuredSeries {
  const inA = Math.abs(z) >= 1;
  let label: SeriesLabel;
  let line: string | null = null;
  if (!aboveTarget && !inA) label = "unauffällig";
  else if (aboveTarget && !inA) {
    label = "Ziel verfehlt, historisch üblich";
    line = kind === "inflation"
      ? `${id} ${formatDe(value)} % (Ziel ${formatDe(INFLATION_TARGET_PCT)} %)`
      : `${id} ${formatDe(value)} (über Niedrigzins-Terzil)`;
  } else if (!aboveTarget && inA) label = "unter Ziel, aber unüblich";
  else label = "auffällig";
  return { id, value, asOf, z, aboveTarget, inA, label, line };
}

function measureInflation(id: string, obs: DriverObs[], now: Date): MeasuredSeries | null {
  const history = sortedObs(obs).filter(o => inHistoryWindow(o.date, now, HISTORY_YEARS + 1));
  const yoys: DriverObs[] = [];
  for (let i = 12; i < history.length; i++) {
    const prior = history[i - 12];
    if (prior.value === 0) continue;
    const gap = monthGap(prior.date, history[i].date);
    if (gap < 11 || gap > 13) continue;
    yoys.push({
      date: history[i].date,
      value: ((history[i].value - prior.value) / prior.value) * 100,
    });
  }
  const inH = yoys.filter(o => inHistoryWindow(o.date, now, HISTORY_YEARS));
  if (!spansHistory(inH)) return null;
  const latest = inH[inH.length - 1];
  const z = zScore(latest.value, inH.slice(0, -1).map(o => o.value));
  if (z == null) return null;
  return classify(id, latest.value, latest.date, z, latest.value > INFLATION_TARGET_PCT, "inflation");
}

function deltaOverDays(obs: DriverObs[], days: number): DriverObs[] {
  const out: DriverObs[] = [];
  let j = 0;
  for (let i = 0; i < obs.length; i++) {
    const target = Date.parse(`${obs[i].date}T00:00:00Z`) - days * 24 * 60 * 60 * 1000;
    while (j + 1 < i && Date.parse(`${obs[j + 1].date}T00:00:00Z`) <= target) j++;
    const priorT = Date.parse(`${obs[j].date}T00:00:00Z`);
    if (j < i && Number.isFinite(priorT) && priorT <= target) {
      out.push({ date: obs[i].date, value: obs[i].value - obs[j].value });
    }
  }
  return out;
}

function measureDff(obs: DriverObs[], now: Date): MeasuredSeries | null {
  const levels = sortedObs(obs).filter(o => inHistoryWindow(o.date, now, HISTORY_YEARS));
  if (!spansHistory(levels)) return null;
  const latest = levels[levels.length - 1];
  const cutoff = lowTercileCutoff(levels.slice(0, -1).map(o => o.value));
  if (cutoff == null) return null;
  const deltas = deltaOverDays(levels, 90);
  if (!spansHistory(deltas)) return null;
  const lastD = deltas[deltas.length - 1];
  const z = zScore(lastD.value, deltas.slice(0, -1).map(d => d.value));
  if (z == null) return null;
  return classify("DFF", latest.value, latest.date, z, latest.value > cutoff, "dff");
}

function measureLevel(id: string, obs: DriverObs[], now: Date): MeasuredSeries | null {
  const levels = sortedObs(obs).filter(o => inHistoryWindow(o.date, now, HISTORY_YEARS));
  if (!spansHistory(levels)) return null;
  const latest = levels[levels.length - 1];
  const z = zScore(latest.value, levels.slice(0, -1).map(o => o.value));
  if (z == null) return null;
  return classify(id, latest.value, latest.date, z, false, "level");
}

export function measureDrivers(
  observations: Record<string, DriverObs[] | null | undefined>,
  now: Date,
): MeasuredSeries[] {
  const out: MeasuredSeries[] = [];
  for (const id of DRIVER_SERIES) {
    const raw = observations[id];
    if (!raw || raw.length === 0) continue;
    const measured = id === "DFF"
      ? measureDff(raw, now)
      : INFLATION_IDS.has(id)
        ? measureInflation(id, raw, now)
        : measureLevel(id, raw, now);
    if (measured) out.push(measured);
  }
  return out;
}

function rollup(measured: MeasuredSeries[]): DriverView["status"] {
  if (measured.length === 0) return "empty";
  if (measured.some(s => s.inA)) return "drivers";
  return "unauffällig";
}

interface LlmItem {
  id?: string;
  order1?: string;
  order2?: string;
  order3?: string;
  shareClaim?: string;
}

function extractItems(data: unknown): LlmItem[] {
  if (!data || typeof data !== "object") return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is LlmItem => !!item && typeof item === "object");
}

function mentionsForeignSeries(text: string, allowed: Set<string>): boolean {
  return DRIVER_SERIES.some(id => !allowed.has(id) && text.includes(id));
}

function cardsFromModel(seriesInA: MeasuredSeries[], news: DriverNewsItem[], data: unknown): DriverCard[] {
  const allowed = new Set(seriesInA.map(s => s.id));
  const items = extractItems(data);
  const hay = news.map(n => n.title).join("\n");
  return seriesInA.map(series => {
    const item = items.find(i => i.id === series.id);
    const claim = typeof item?.shareClaim === "string" ? item.shareClaim.trim() : "";
    const cited = claim.length > 0 && hay.includes(claim);
    if (!cited || !item) {
      return { id: series.id, title: `Driver ${series.id}`, text: OPEN_REASON, reason: OPEN_REASON };
    }
    const orders = [item.order1, item.order2, item.order3]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map(part => part.trim())
      .filter(part => !mentionsForeignSeries(part, allowed));
    return {
      id: series.id,
      title: `Driver ${series.id}`,
      text: [...orders, claim].join(" "),
      reason: claim,
    };
  });
}

export async function assessDrivers(input: {
  observations: Record<string, DriverObs[] | null | undefined>;
  now?: Date;
  newsPack?: DriverNewsItem[];
  callLLMJson?: DriverLlm;
  fetchNews?: (ids: string[], now: Date) => Promise<DriverNewsItem[]>;
  cache?: DriverCache;
}): Promise<DriverAssessment> {
  const now = input.now ?? new Date();
  const measured = measureDrivers(input.observations, now);
  const lines = measured.map(s => s.line).filter((line): line is string => !!line);
  const status = rollup(measured);
  const setA = measured.filter(s => s.inA);
  if (setA.length === 0) {
    return { status, lines, cards: [], llmCalls: 0 };
  }

  const cache = input.cache;
  const key = setA
    .map(s => `${s.id}:${s.asOf}:${s.value.toFixed(6)}:${s.z.toFixed(4)}`)
    .sort()
    .join("|");
  const nowMs = now.getTime();
  if (cache?.drivers && cache.drivers.key === key && nowMs - cache.drivers.at < DRIVER_CACHE_MS) {
    return { ...cache.drivers.assessment, llmCalls: 0 };
  }

  let news: DriverNewsItem[] = input.newsPack ? headlinesWithinDays(input.newsPack, now, 7) : [];
  const newsKey = setA.map(s => s.id).sort().join("|");
  if (!input.newsPack) {
    if (cache?.news && cache.news.key === newsKey && nowMs - cache.news.at < NEWS_CACHE_MS) {
      news = cache.news.items;
    } else if (input.fetchNews) {
      try {
        const fetched = await input.fetchNews(setA.map(s => s.id), now);
        news = headlinesWithinDays(fetched, now, 7);
      } catch {
        news = [];
      }
      if (cache) cache.news = { key: newsKey, at: nowMs, items: news };
    }
  }

  const prompt = buildDriverUserPrompt(setA, news);
  let data: unknown = null;
  let llmCalls = 0;
  if (input.callLLMJson) {
    llmCalls = 1;
    try {
      const result = await input.callLLMJson({
        prompt,
        systemPrompt: DRIVER_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 800,
      });
      data = result?.data ?? null;
    } catch {
      data = null;
    }
  }
  const cards = cardsFromModel(setA, news, data);
  const view: DriverView = { status: "drivers", lines, cards };
  if (cache) cache.drivers = { key, at: nowMs, assessment: view };
  return { ...view, llmCalls };
}

function isoYearsAgo(now: Date, years: number): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export async function fetchDriverObservations(now: Date, fetchImpl: FredFetch): Promise<Record<string, DriverObs[]>> {
  const start = isoYearsAgo(now, HISTORY_YEARS + 1);
  const out: Record<string, DriverObs[]> = {};
  await Promise.all(DRIVER_SERIES.map(async id => {
    try {
      const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start}`;
      const res = await fetchImpl(url);
      if (!res.ok) return;
      const obs = parseFredCsv(await res.text());
      if (obs.length > 0) out[id] = obs;
    } catch {
      // A failed series stays absent.
    }
  }));
  return out;
}

export async function loadDriverAssessment(now = new Date()): Promise<DriverAssessment> {
  try {
    const observations = await fetchDriverObservations(now, async url => {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      return { ok: res.ok, text: () => res.text() };
    });
    const { callLLMJson } = await import("./llm-openrouter");
    const { fetchTopicNewsFromGoogleRSS } = await import("./news-peers");
    return await assessDrivers({
      observations,
      now,
      cache: memoryCache,
      callLLMJson: opts => callLLMJson(opts),
      fetchNews: async ids => {
        const query = newsQueryFor(ids);
        const items = await fetchTopicNewsFromGoogleRSS(query, query, "RECESSION-DRIVERS");
        return items.map(item => ({ title: item.title, pubDate: item.pubDate }));
      },
    });
  } catch {
    return { status: "empty", lines: [], cards: [], llmCalls: 0 };
  }
}
