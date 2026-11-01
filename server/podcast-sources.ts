/**
 * Liest die Reihen, die die App schon kennt (FRED-Kataloge, Gold-AISC,
 * Sektor-ETFs, News, Researcher-Cache). Was keine Historie hat, wird eine
 * Lücke mit Grund. Der Earnings-Brief aus #384 ist auf diesem Stand nicht im Baum.
 */
import fs from "fs";
import path from "path";
import { BTC_LIQUIDITY_LABELS, BTC_LIQUIDITY_SERIES } from "../shared/btc-liquidity";
import { fredCsvObservations } from "./fred-csv";
import { FRED_HISTORY_PARAMS, FRED_HISTORY_SERIES } from "./recession-fred-history-route";
import { DRIVER_SERIES } from "./recession-drivers";
import { ETF_PROXY_MAP } from "./sector-rotation-math";
import type { PodcastGap, PodcastPoint, PodcastSeriesInput } from "./podcast-drivers";
import type { PodcastNote } from "./podcast-prompt";

export const EARNINGS_BRIEF_UNAVAILABLE =
  "n/a — Earnings-Brief aus #384 liegt nicht auf diesem Stand (Draft-PR, nicht gemergt). Kein Transkript und kein Ersatzwert.";

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
    const points = fredCsvObservations(csv);
    if (!points.length) {
      gaps.push({ channel: item.channels.join("+"), label: item.label, status: `n/a — FRED ${item.id} leer oder nicht erreichbar` });
      return;
    }
    series.push({
      id: item.id,
      label: item.label,
      source: `FRED ${item.id}`,
      channels: item.channels,
      unit: null,
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

export async function defaultPodcastDeps(): Promise<PodcastSourceDeps> {
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
    earningsBrief: async () => null,
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
