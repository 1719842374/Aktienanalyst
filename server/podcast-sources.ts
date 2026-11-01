/**
 * Liest die Reihen, die die App schon kennt (FRED-Kataloge, Gold-AISC,
 * Sektor-ETFs, News, Researcher-Cache). Was keine Historie hat, wird eine
 * Lücke mit Grund. Der Earnings-Brief läuft über buildEarningsBrief, denselben
 * Handler wie GET /api/chat/earnings-brief/:symbol.
 */
import fs from "fs";
import path from "path";
import { BTC_LIQUIDITY_LABELS, BTC_LIQUIDITY_SERIES } from "../shared/btc-liquidity";
import type { EarningsCallBrief } from "../shared/chat-earnings";
import { buildEarningsBrief } from "./chat-earnings-route";
import { fredCsvObservations } from "./fred-csv";
import { fmpEarningCallTranscript, fmpEarningCallTranscriptDates } from "./fmp";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { FRED_HISTORY_PARAMS, FRED_HISTORY_SERIES } from "./recession-fred-history-route";
import { DRIVER_SERIES } from "./recession-drivers";
import { ETF_PROXY_MAP } from "./sector-rotation-math";
import type { PodcastGap, PodcastPoint, PodcastSeriesInput } from "./podcast-drivers";
import type { PodcastNote } from "./podcast-prompt";

export const EARNINGS_BRIEF_UNAVAILABLE =
  "n/a — Earnings-Brief nicht geliefert";

/** Derselbe Pfad wie die Chat-Route. Der Podcast ruft den Handler, nicht einen zweiten Anbieter. */
export const PODCAST_EARNINGS_ENDPOINT = "GET /api/chat/earnings-brief/:symbol";

/** So viele Symbole fragt ein Lauf den Earnings-Handler. Darüber bleibt der Rest ungefragt. */
export const PODCAST_EARNINGS_SYMBOL_CAP = 4;

const PODCAST_SYMBOL = /^[A-Za-z0-9.\-]{1,24}$/;

/**
 * Indexstände, deren Treiber die YoY-Rate in Prozent ist.
 * CPIAUCSL ist „Inflation Rate“, CPILFESL und PCEPILFE sind dieselben Index-zu-Rate-Serien
 * (fmp-macro mode yoy, recession INFLATION_IDS).
 */
export const PODCAST_YOY_INDEX_SERIES = new Set(["CPIAUCSL", "CPILFESL", "PCEPILFE"]);

/** Dieselbe Keyword-Liste wie buildMacroPulse in server/researcher.ts. Nur die Abfrage, nicht das Ranking. */
export const PODCAST_MACRO_KEYWORDS = [
  "interest rate",
  "M2",
  "GDP",
  "inflation",
  "Core Inflation",
  "Government Spending",
  "Government Debt",
] as const;

export const PODCAST_RESEARCHER_FILE_CAP = 30;

export interface MacroIndicatorRow {
  category: string;
  latestValue: string;
  previousValue: string;
  date: string;
  unit: string;
  source: string;
}

export interface GoldQuarterRow {
  periodEnd: string;
  aisc: number | null;
}

export interface PodcastHeadline {
  title: string;
  source: string;
  url?: string;
}

export interface ResearcherCacheFile {
  name: string;
  json: unknown;
}

export interface EarningsBriefText {
  text: string;
  source: string | null;
  status?: string;
}

export interface PodcastSourceDeps {
  fredCsv: (id: string) => Promise<string | null>;
  macroIndicators: () => Promise<MacroIndicatorRow[]>;
  goldQuarters: () => Promise<GoldQuarterRow[]>;
  sectorBars: (etf: string) => Promise<PodcastPoint[]>;
  news: () => Promise<PodcastHeadline[]>;
  researcherFiles: () => Promise<ResearcherCacheFile[]>;
  earningsBrief: () => Promise<EarningsBriefText | null>;
}

export interface PodcastCollected {
  series: PodcastSeriesInput[];
  gaps: PodcastGap[];
  notes: PodcastNote[];
}

interface CatalogItem {
  id: string;
  channels: string[];
  label: string;
}

export function podcastFredCatalog(): CatalogItem[] {
  const map = new Map<string, { channels: Set<string>; label: string }>();
  const add = (id: string, channel: string, label: string) => {
    const current = map.get(id) ?? { channels: new Set<string>(), label };
    current.channels.add(channel);
    if (current.label === id && label && label !== id) current.label = label;
    map.set(id, current);
  };
  for (const id of DRIVER_SERIES) add(id, "recession", id);
  for (const [id, spec] of Object.entries(FRED_HISTORY_SERIES)) add(id, "fred", spec.source);
  for (const [key, id] of Object.entries(BTC_LIQUIDITY_SERIES)) {
    const label = BTC_LIQUIDITY_LABELS[key as keyof typeof BTC_LIQUIDITY_LABELS] ?? id;
    add(id, "btc", label);
  }
  add("DFII10", "btc", "DFII10");
  add("M2SL", "btc", "M2SL");
  return Array.from(map.entries()).map(([id, item]) => ({ id, channels: Array.from(item.channels), label: item.label }));
}

function fredIdFromSource(source: string): string | null {
  const match = /FRED\s+([A-Z0-9]+)/.exec(source);
  return match?.[1] ?? null;
}

function addChannel(series: PodcastSeriesInput, channel: string) {
  if (!series.channels.includes(channel)) series.channels.push(channel);
}

function monthIndex(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return Number(match[1]) * 12 + (month - 1);
}

/**
 * YoY in Prozent aus der eigenen Serie. Paarung 11–13 Monate, wie die
 * Rezessions-Treiber einen Index in eine Rate übersetzen. Der Indexstand
 * selbst bleibt nicht der Treiberwert.
 */
export function yoyRatePoints(points: PodcastPoint[]): PodcastPoint[] {
  const sorted = points
    .filter(point => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.value))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: PodcastPoint[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    const now = monthIndex(current.date);
    if (now == null) continue;
    let prior: PodcastPoint | null = null;
    let best = 99;
    for (let j = i - 1; j >= 0; j--) {
      const then = monthIndex(sorted[j]!.date);
      if (then == null) continue;
      const gap = now - then;
      if (gap > 13) break;
      if (gap < 11) continue;
      const dist = Math.abs(gap - 12);
      if (dist < best) {
        best = dist;
        prior = sorted[j]!;
      }
      if (dist === 0) break;
    }
    if (!prior || prior.value === 0) continue;
    const rate = ((current.value - prior.value) / prior.value) * 100;
    if (Number.isFinite(rate)) out.push({ date: current.date, value: rate });
  }
  return out;
}

export function collectPodcastSymbols(body: unknown): string[] {
  const listed = body && typeof body === "object" && Array.isArray((body as { symbols?: unknown }).symbols)
    ? (body as { symbols: unknown[] }).symbols
    : [];
  return mergePodcastSymbols(listed.map(item => (typeof item === "string" ? item : "")));
}

export function symbolsFromResearcherCache(files: ResearcherCacheFile[]): string[] {
  const found: string[] = [];
  const walk = (node: unknown, key: string | null) => {
    if (found.length >= 40) return;
    if (typeof node === "string" && (key === "ticker" || key === "symbol")) {
      found.push(node);
      return;
    }
    if (Array.isArray(node) && (key === "topPlayers" || key === "affectedTickers" || key === "tickers")) {
      for (const item of node) if (typeof item === "string") found.push(item);
      return;
    }
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      if (Array.isArray(node)) {
        for (const item of node) walk(item, key);
      }
      return;
    }
    for (const [childKey, child] of Object.entries(node as Record<string, unknown>)) {
      if (childKey.startsWith("_")) continue;
      walk(child, childKey);
    }
  };
  for (const file of files) walk(file.json, null);
  return mergePodcastSymbols(found);
}

export function mergePodcastSymbols(raw: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const symbol = item.trim().toUpperCase();
    if (!PODCAST_SYMBOL.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
    if (out.length >= PODCAST_EARNINGS_SYMBOL_CAP) break;
  }
  return out;
}

export function earningsBriefText(brief: EarningsCallBrief): EarningsBriefText {
  const text = (brief.summary || brief.excerpt || "").trim();
  const quarter = brief.year != null && brief.quarter != null ? `FY${brief.year} Q${brief.quarter}` : null;
  const head = [brief.symbol, brief.date, quarter].filter(Boolean).join(" ");
  return {
    text: text ? `${head}: ${text}` : "",
    source: brief.source ?? PODCAST_EARNINGS_ENDPOINT,
    status: text ? undefined : (brief.reason ?? `n/a — ${PODCAST_EARNINGS_ENDPOINT} ohne Text`),
  };
}

export async function earningsBriefFromEndpoint(
  symbols: string[],
  load: (symbol: string) => Promise<EarningsCallBrief>,
): Promise<EarningsBriefText> {
  const picked = mergePodcastSymbols(symbols);
  if (!picked.length) {
    return {
      text: "",
      source: PODCAST_EARNINGS_ENDPOINT,
      status: `n/a — kein Symbol für ${PODCAST_EARNINGS_ENDPOINT}`,
    };
  }
  const parts: string[] = [];
  const reasons: string[] = [];
  let source: string | null = PODCAST_EARNINGS_ENDPOINT;
  for (const symbol of picked) {
    const brief = await load(symbol);
    const row = earningsBriefText(brief);
    if (row.text) {
      parts.push(row.text);
      if (brief.source) source = brief.source;
    } else if (row.status) reasons.push(row.status);
  }
  if (!parts.length) {
    return { text: "", source, status: reasons.join(" | ") || `n/a — ${PODCAST_EARNINGS_ENDPOINT} ohne Text` };
  }
  return { text: parts.join("\n"), source, status: reasons.length ? reasons.join(" | ") : undefined };
}

export function seriesFromResearcherFiles(files: ResearcherCacheFile[]): { series: PodcastSeriesInput[]; gaps: PodcastGap[] } {
  const series: PodcastSeriesInput[] = [];
  const gaps: PodcastGap[] = [];
  if (!files.length) {
    gaps.push({ channel: "researcher", label: "Researcher", status: "n/a — Researcher-Cache leer" });
    return { series, gaps };
  }
  for (const file of files) {
    const found = numericSeriesIn(file.json, file.name);
    if (!found.length) {
      gaps.push({ channel: "researcher", label: file.name, status: `n/a — ${file.name} ohne Zahlenreihe` });
      continue;
    }
    series.push(...found);
  }
  return { series, gaps };
}

function numericSeriesIn(node: unknown, fileName: string): PodcastSeriesInput[] {
  const out: PodcastSeriesInput[] = [];
  const seen = new Set<unknown>();
  const walk = (value: unknown, label: string, depth: number) => {
    if (!value || typeof value !== "object" || seen.has(value) || depth > 6 || out.length >= 8) return;
    seen.add(value);
    if (Array.isArray(value)) {
      const points: PodcastPoint[] = [];
      for (const row of value) {
        if (!row || typeof row !== "object") continue;
        const rec = row as Record<string, unknown>;
        const date = typeof rec.date === "string" ? rec.date : typeof rec.periodEnd === "string" ? rec.periodEnd : "";
        const raw = rec.value ?? rec.close ?? rec.aisc ?? rec.li;
        const num = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
        if (/^\d{4}-\d{2}-\d{2}/.test(date) && Number.isFinite(num)) points.push({ date: date.slice(0, 10), value: num });
      }
      if (points.length >= 2) {
        out.push({
          id: `researcher:${fileName}:${label}`,
          label: label || fileName,
          source: `Researcher-Cache ${fileName}`,
          channels: ["researcher"],
          unit: null,
          points,
          citation: fileName,
        });
      }
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key.endsWith("Score") || key.endsWith("Rating")) continue;
      walk(child, key, depth + 1);
    }
  };
  walk(node, fileName, 0);
  return out;
}

export async function collectPodcastInputs(deps: PodcastSourceDeps): Promise<PodcastCollected> {
  const series: PodcastSeriesInput[] = [];
  const gaps: PodcastGap[] = [];
  const notes: PodcastNote[] = [];
  const catalog = podcastFredCatalog();
  const byId = new Map(catalog.map(item => [item.id, { ...item, channels: [...item.channels] }]));

  let macro: MacroIndicatorRow[] = [];
  try {
    macro = await deps.macroIndicators();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
    gaps.push({ channel: "makro", label: "Makro-Snapshot", status: `n/a — Makro-Snapshot: ${message}` });
  }
  for (const row of macro) {
    const id = fredIdFromSource(row.source);
    if (!id) {
      gaps.push({ channel: "makro", label: row.category, status: `n/a — ${row.category} ohne FRED-Serie` });
      continue;
    }
    const item = byId.get(id) ?? { id, channels: [], label: row.category };
    if (!item.channels.includes("makro")) item.channels.push("makro");
    if (item.label === id) item.label = row.category;
    byId.set(id, item);
  }
  gaps.push({
    channel: "makro",
    label: "EU/Asien",
    status: "n/a — Makro-Snapshot dieser App ist nur für die USA mit FRED belegt",
  });

  await Promise.all(Array.from(byId.values()).map(async item => {
    let csv: string | null = null;
    try {
      csv = await deps.fredCsv(item.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
      gaps.push({ channel: item.channels.join("+"), label: item.label, status: `n/a — FRED ${item.id}: ${message}` });
      return;
    }
    let points = fredCsvObservations(csv);
    if (!points.length) {
      gaps.push({ channel: item.channels.join("+"), label: item.label, status: `n/a — FRED ${item.id} leer oder nicht erreichbar` });
      return;
    }
    let unit: string | null = null;
    if (PODCAST_YOY_INDEX_SERIES.has(item.id)) {
      const rates = yoyRatePoints(points);
      if (rates.length < 2) {
        gaps.push({
          channel: item.channels.join("+"),
          label: item.label,
          status: `n/a — ${item.label} ohne YoY-Vergleich über 12 Monate, Indexstand wird nicht als Rate gezeigt`,
        });
        return;
      }
      points = rates;
      unit = "%";
    }
    series.push({
      id: item.id,
      label: item.label,
      source: `FRED ${item.id}`,
      channels: item.channels,
      unit,
      points,
      citation: `https://fred.stlouisfed.org/series/${item.id}`,
    });
  }));

  try {
    const quarters = await deps.goldQuarters();
    const points = quarters
      .filter(row => Number.isFinite(row.aisc) && /^\d{4}-\d{2}-\d{2}/.test(row.periodEnd))
      .map(row => ({ date: row.periodEnd.slice(0, 10), value: row.aisc as number }));
    if (!points.length) {
      gaps.push({ channel: "gold", label: "Gold AISC", status: "n/a — Gold-AISC ohne belegte Quartale" });
    } else {
      series.push({
        id: "gold-aisc",
        label: "Gold AISC",
        source: "server/data/gold-aisc.json",
        channels: ["gold"],
        unit: "USD/oz",
        points,
        citation: "server/data/gold-aisc.json",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
    gaps.push({ channel: "gold", label: "Gold AISC", status: `n/a — Gold-AISC: ${message}` });
  }

  await Promise.all(ETF_PROXY_MAP.map(async proxy => {
    try {
      const points = await deps.sectorBars(proxy.etf);
      const clean = (points ?? []).filter(point => Number.isFinite(point.value) && /^\d{4}-\d{2}-\d{2}/.test(point.date));
      if (!clean.length) {
        gaps.push({ channel: "sector-rotation", label: `${proxy.label} (${proxy.etf})`, status: `n/a — ${proxy.etf} ohne Kursreihe` });
        return;
      }
      series.push({
        id: proxy.etf,
        label: proxy.label,
        source: `Sektor-ETF ${proxy.etf}`,
        channels: ["sector-rotation"],
        unit: "USD",
        points: clean,
        citation: proxy.etf,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
      gaps.push({ channel: "sector-rotation", label: `${proxy.label} (${proxy.etf})`, status: `n/a — ${proxy.etf}: ${message}` });
    }
  }));

  try {
    const headlines = await deps.news();
    if (!headlines.length) {
      gaps.push({ channel: "news", label: "News", status: "n/a — keine Schlagzeile geliefert" });
    } else {
      for (const item of headlines) {
        notes.push({ channel: "news", text: `${item.title} (${item.source})`, source: item.url ?? item.source });
      }
      gaps.push({
        channel: "news",
        label: "News",
        status: "n/a — Schlagzeilen ohne numerische Historie für z-Score, Perzentil oder Änderungsrate",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
    gaps.push({ channel: "news", label: "News", status: `n/a — News: ${message}` });
  }

  try {
    const files = await deps.researcherFiles();
    const extracted = seriesFromResearcherFiles(files);
    for (const row of extracted.series) {
      const existing = series.find(item => item.citation === row.citation && item.label === row.label);
      if (existing) addChannel(existing, "researcher");
      else series.push(row);
    }
    gaps.push(...extracted.gaps);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
    gaps.push({ channel: "researcher", label: "Researcher", status: `n/a — Researcher-Cache: ${message}` });
  }

  try {
    const brief = await deps.earningsBrief();
    if (!brief?.text) {
      gaps.push({
        channel: "earnings-brief",
        label: "Earnings-Brief",
        status: brief?.status || EARNINGS_BRIEF_UNAVAILABLE,
      });
    } else {
      notes.push({ channel: "earnings-brief", text: brief.text, source: brief.source });
      if (brief.status) {
        gaps.push({ channel: "earnings-brief", label: "Earnings-Brief", status: brief.status });
      }
      gaps.push({
        channel: "earnings-brief",
        label: "Earnings-Brief",
        status: "n/a — Text ohne eigene Zahlenhistorie, steht im Kontext",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Abruf fehlgeschlagen";
    gaps.push({ channel: "earnings-brief", label: "Earnings-Brief", status: `n/a — Earnings-Brief: ${message}` });
  }

  gaps.push({
    channel: "btc",
    label: "BTC-Kurs",
    status: "n/a — der BTC-Kurs wird im Client gerechnet; dieser Lauf nutzt die Server-Reihen der Liquidität und des BTC-Makros, wenn FRED sie liefert",
  });

  return { series, gaps, notes };
}

function yearsAgoIso(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() - years);
  return date.toISOString().slice(0, 10);
}

export async function defaultPodcastDeps(requestedSymbols: string[] = []): Promise<PodcastSourceDeps> {
  const { fetchFredCsv } = await import("./fred-csv");
  const cosd = yearsAgoIso(FRED_HISTORY_PARAMS.yearsBack);
  return {
    fredCsv: (id) => fetchFredCsv(id, cosd),
    macroIndicators: async () => {
      const { fetchMacroSnapshot } = await import("./fmp-macro");
      const snap = await fetchMacroSnapshot({ countries: ["United States"], keywords: [...PODCAST_MACRO_KEYWORDS] });
      return snap.indicators;
    },
    goldQuarters: async () => {
      const { loadGoldAiscSeries } = await import("./gold-aisc");
      const loaded = loadGoldAiscSeries();
      return (loaded?.quarters ?? []).map(row => ({ periodEnd: row.periodEnd, aisc: row.aisc }));
    },
    sectorBars: async (etf) => {
      const { altFetchYahooThenStooq, fromDateForTimeframe } = await import("./history-fallback");
      const to = new Date().toISOString().slice(0, 10);
      const bars = await altFetchYahooThenStooq(etf, fromDateForTimeframe("1Y"), to);
      return bars.filter(bar => Number.isFinite(bar.close)).map(bar => ({ date: bar.date, value: bar.close }));
    },
    news: async () => {
      const headlines: PodcastHeadline[] = [];
      try {
        const gold = await import("./gold-news");
        for (const item of await gold.fetchGoldNewsItems()) {
          headlines.push({ title: item.title, source: item.source, url: item.url });
        }
      } catch { /* Lücke setzt der Sammler, wenn am Ende nichts da ist */ }
      try {
        const peers = await import("./news-peers");
        for (const item of await peers.fetchAllowedBtcNews()) {
          headlines.push({ title: item.title, source: item.source, url: item.url });
        }
      } catch { /* gleiche Regel */ }
      return headlines;
    },
    researcherFiles: async () => readResearcherCacheFiles(),
    earningsBrief: async () => {
      const symbols = mergePodcastSymbols([
        ...requestedSymbols,
        ...symbolsFromResearcherCache(readResearcherCacheFiles()),
      ]);
      return earningsBriefFromEndpoint(symbols, (symbol) => buildEarningsBrief(symbol, {
        dates: (s) => fmpEarningCallTranscriptDates(s),
        transcript: (s, year, quarter) => fmpEarningCallTranscript(s, year, quarter),
        llmAvailable: isLLMAvailable,
        llm: callLLMJson,
      }));
    },
  };
}

export function readResearcherCacheFiles(dir = path.join(process.cwd(), ".cache", "researcher")): ResearcherCacheFile[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => name.endsWith(".json"))
    .slice(0, PODCAST_RESEARCHER_FILE_CAP)
    .flatMap(name => {
      try {
        return [{ name, json: JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as unknown }];
      } catch {
        return [{ name, json: null }];
      }
    });
}
