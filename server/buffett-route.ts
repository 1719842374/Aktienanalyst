/**
 * Buffett-Indikator für das Rezessions-Dashboard.
 * USA: Wilshire 5000 zum nominalen BIP, davor die Financial-Accounts-Quote
 * auf den ersten Indexwert skaliert. Trend und Standardabweichungsbänder
 * werden einmal über die gesamte Reihe geschätzt.
 * Europa und China: die Weltbank-Quote, solange sie reicht, mit demselben Trend.
 */
import type { Express, Request, Response } from "express";
import {
  applyTrend,
  fitLogTrend,
  quarterlyFitSample,
  spliceAtListedStart,
  type RatioObs,
  type TrendPoint,
} from "./buffett-ratio";

const REGIONS = ["US", "EU", "CN"] as const;
type RegionId = (typeof REGIONS)[number];

/**
 * Wilshire-Konvention: ein Indexpunkt entsprach 1 Mrd. $ Kapitalisierung
 * und ist bis etwa 1,05 Mrd. $ je Punkt gedriftet. Das ist die Umrechnung
 * des Index in Dollar, keine Bewertungsschwelle.
 */
export const WILSHIRE_DOLLARS_PER_POINT_BN = 1.05;

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; body: unknown }>();

const US_SOURCES = [
  { id: "^W5000", role: "Wilshire 5000, täglicher Schlusskurs" },
  { id: "GDP", role: "nominales BIP, Mrd. $, Jahresrate" },
  { id: "NCBEILQ027S", role: "Marktwert nichtfinanzieller Firmen bis zum Indexstart, Mio. $" },
  { id: "FBCELLQ027S", role: "Marktwert finanzieller Firmen bis zum Indexstart, Mio. $" },
];

interface FredPoint {
  date: string;
  value: number;
}

function isRegion(value: string): value is RegionId {
  return (REGIONS as readonly string[]).includes(value);
}

async function fetchFred(seriesId: string, from: string): Promise<FredPoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}&cosd=${from}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
  if (!response.ok) return [];
  const text = await response.text();
  if (!text || text.includes("<html") || text.includes("<!DOCTYPE")) return [];
  const out: FredPoint[] = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || raw == null) continue;
    const value = Number(raw.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim()) || !Number.isFinite(value)) continue;
    out.push({ date: date.trim(), value });
  }
  return out;
}

function asMap(points: FredPoint[]): Map<string, number> {
  return new Map(points.map(point => [point.date, point.value]));
}

function valueAt(points: FredPoint[], date: string): number | null {
  if (points.length === 0) return null;
  if (date <= points[0].date) return points[0].value;
  if (date >= points[points.length - 1].date) return points[points.length - 1].value;
  let lo = 0;
  let hi = points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].date <= date) lo = mid;
    else hi = mid;
  }
  const left = points[lo];
  const right = points[hi];
  const span = Date.parse(`${right.date}T00:00:00Z`) - Date.parse(`${left.date}T00:00:00Z`);
  if (span <= 0) return left.value;
  const t = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${left.date}T00:00:00Z`)) / span;
  return left.value + (right.value - left.value) * t;
}

interface YahooBar {
  date: string;
  close: number;
}

async function fetchWilshire(): Promise<YahooBar[]> {
  const period2 = Math.floor(Date.now() / 1000) + 86_400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EW5000?period1=599817600&period2=${period2}&interval=1d`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`Wilshire ${response.status}`);
  const body = await response.json() as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: Array<number | null> }> };
      }>;
    };
  };
  const result = body.chart?.result?.[0];
  const stamps = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const out: YahooBar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const close = closes[i];
    if (close == null || !Number.isFinite(close) || close <= 0) continue;
    out.push({ date: new Date(stamps[i] * 1000).toISOString().slice(0, 10), close });
  }
  if (out.length < 500) throw new Error("Wilshire-Reihe zu kurz");
  return out;
}

function withTrend(points: RatioObs[]): TrendPoint[] {
  const model = fitLogTrend(quarterlyFitSample(points));
  if (!model) throw new Error("Trend nicht schätzbar");
  return applyTrend(model, points);
}

async function buildUnitedStates(): Promise<{ points: TrendPoint[]; note: string }> {
  const [gdp, nfc, financial, bars] = await Promise.all([
    fetchFred("GDP", "1947-01-01"),
    fetchFred("NCBEILQ027S", "1947-01-01"),
    fetchFred("FBCELLQ027S", "1947-01-01"),
    fetchWilshire(),
  ]);
  if (gdp.length < 8) throw new Error("BIP-Reihe leer");
  const nfcMap = asMap(nfc);
  const financialMap = asMap(financial);
  const earlyDates = [...nfcMap.keys()]
    .filter(date => date >= "1950-01-01" && financialMap.has(date))
    .sort();
  const early: RatioObs[] = [];
  for (const date of earlyDates) {
    const gdpBn = valueAt(gdp, date);
    if (gdpBn == null || gdpBn <= 0) continue;
    const marketCapBn = ((nfcMap.get(date) ?? 0) + (financialMap.get(date) ?? 0)) / 1000;
    early.push({ date, ratio: (marketCapBn / gdpBn) * 100 });
  }
  const listed: RatioObs[] = [];
  for (const bar of bars) {
    const gdpBn = valueAt(gdp, bar.date);
    if (gdpBn == null || gdpBn <= 0) continue;
    listed.push({
      date: bar.date,
      ratio: (bar.close * WILSHIRE_DOLLARS_PER_POINT_BN / gdpBn) * 100,
    });
  }
  if (listed.length < 500) throw new Error("Wilshire-Quote leer");
  const spliced = spliceAtListedStart(early, listed);
  return {
    points: withTrend(spliced),
    note: "Der Zähler ist der Wilshire 5000. Ein Indexpunkt wird mit 1,05 Mrd. $ Kapitalisierung angesetzt und durch das nominale BIP geteilt. Bis 1950 zurück wird die Quote der Financial Accounts auf den ersten Indexwert skaliert. Die Trendlinie und die Bänder von einer und zwei Standardabweichungen gelten für die gesamte Reihe. Die Zeitfenster zeigen davon nur einen Ausschnitt.",
  };
}

async function buildAnnualRatio(seriesId: string): Promise<TrendPoint[]> {
  const points = await fetchFred(seriesId, "1975-01-01");
  const ratios = points.map(point => ({ date: point.date, ratio: point.value }));
  if (ratios.length < 8) return [];
  return withTrend(ratios);
}

const ANNUAL_REGIONS: Record<Exclude<RegionId, "US">, { id: string; note: string }> = {
  EU: {
    id: "DDDM01EZA156NWDB",
    note: "Euroraum, börsennotierte Inlandsfirmen in Prozent des BIP (Weltbank über FRED). Die Reihe endet mit dem letzten veröffentlichten Jahr. Trend und Bänder werden auf dieser Reihe geschätzt.",
  },
  CN: {
    id: "DDDM01CNA156NWDB",
    note: "China, börsennotierte Inlandsfirmen in Prozent des BIP (Weltbank über FRED). Die Reihe endet mit dem letzten veröffentlichten Jahr. Trend und Bänder werden auf dieser Reihe geschätzt.",
  },
};

export function registerBuffettRatioRoute(app: Express): void {
  app.get("/api/analyze-recession/buffett", async (req: Request, res: Response) => {
    const region = String(req.query.region || "US").toUpperCase();
    if (!isRegion(region)) {
      return res.status(400).json({ error: "Region muss US, EU oder CN sein" });
    }
    const hit = cache.get(region);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    try {
      const annual = region === "US" ? null : ANNUAL_REGIONS[region];
      const built = region === "US"
        ? await buildUnitedStates()
        : {
            points: await buildAnnualRatio(annual!.id),
            note: annual!.note,
          };
      const latest = built.points.length > 0 ? built.points[built.points.length - 1] : null;
      const body = {
        region,
        asOf: latest?.date ?? null,
        latest,
        note: built.note,
        sources: region === "US" ? US_SOURCES : [{ id: annual!.id, role: "Börsenkapitalisierung in Prozent des BIP" }],
        points: built.points,
      };
      if (built.points.length > 0) cache.set(region, { at: Date.now(), body });
      res.json(body);
    } catch (err: any) {
      console.error("[GET /api/analyze-recession/buffett]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "Buffett-Quote nicht verfügbar" });
    }
  });
}
