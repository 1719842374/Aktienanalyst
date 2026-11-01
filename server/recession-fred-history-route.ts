/**
 * GET /api/analyze-recession/fred-history?series=T10Y2Y — FRED über server/fred-csv.ts.
 * Dieselbe fredgraph-Lesart wie der Credit-Overlay. Nur Anzeige in „Vier Märkte“, kein Score.
 * Die Allowlist ist absichtlich kurz: keine freie Serien-Proxy.
 */
import type { Express, Request, Response } from "express";
import { fetchFredCsv, fredCsvObservations } from "./fred-csv";
import { m2YoyPoints } from "../shared/recession-rest-overlays";

/**
 * Jahre der Historie. Herkunft: Recession-TA holt 30 Jahre (server/recession-ta-route.ts isoYearsAgo(30))
 * und deckt damit die Fenster 1/3/5/10/MAX.
 */
export const FRED_HISTORY_PARAMS = {
  yearsBack: 30,
} as const;

/** Stunden. Herkunft: Credit-Route CACHE_MS, 12 h. */
export const FRED_HISTORY_CACHE_HOURS = 12;
const CACHE_MS = FRED_HISTORY_CACHE_HOURS * 60 * 60 * 1000;

export const FRED_HISTORY_SERIES = {
  T10Y2Y: { source: "FRED T10Y2Y (US)", transform: "level" },
  /** YoY wie scoreM2 / yoyPercent, nicht das Niveau in Mrd. $. */
  M2SL: { source: "FRED M2SL YoY (US)", transform: "yoy" },
} as const;

export type FredHistorySeriesId = keyof typeof FRED_HISTORY_SERIES;

export interface FredHistoryBody {
  seriesId: string;
  source: string;
  points: { date: string; value: number }[];
  note: string | null;
}

export function fredHistoryCosd(now = new Date()): string {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - FRED_HISTORY_PARAMS.yearsBack);
  return d.toISOString().slice(0, 10);
}

function isAllowed(seriesId: string): seriesId is FredHistorySeriesId {
  return Object.prototype.hasOwnProperty.call(FRED_HISTORY_SERIES, seriesId);
}

export async function loadFredHistory(
  seriesId: string,
  fetchCsv: (id: string, cosd: string) => Promise<string | null> = (id, cosd) => fetchFredCsv(id, cosd),
): Promise<FredHistoryBody> {
  if (!isAllowed(seriesId)) {
    return { seriesId, source: "", points: [], note: `Serie ${seriesId} ist für dieses Overlay nicht freigegeben` };
  }
  const spec = FRED_HISTORY_SERIES[seriesId];
  let csv: string | null = null;
  try {
    csv = await fetchCsv(seriesId, fredHistoryCosd());
  } catch {
    csv = null;
  }
  const levels = fredCsvObservations(csv);
  const points = spec.transform === "yoy" ? m2YoyPoints(levels) : levels;
  if (points.length === 0) return { seriesId, source: spec.source, points: [], note: "FRED nicht erreichbar oder leer" };
  return { seriesId, source: spec.source, points, note: null };
}

const cache = new Map<string, { at: number; body: FredHistoryBody }>();

export function resetFredHistoryCacheForTests(): void {
  cache.clear();
}

export function registerFredHistoryRoute(app: Express): void {
  app.get("/api/analyze-recession/fred-history", async (req: Request, res: Response) => {
    const seriesId = String(req.query.series ?? "");
    const hit = cache.get(seriesId);
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    const body = await loadFredHistory(seriesId);
    if (body.points.length > 0) cache.set(seriesId, { at: Date.now(), body });
    res.json(body);
  });
}
