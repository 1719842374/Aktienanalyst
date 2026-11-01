/**
 * GET /api/analyze-recession/adaptive — Future_7/8 als Zusatzobjekt.
 * Kette: routes.ts → diese Route → FRED (fred-csv) und Multpl (recession-cape-route)
 * → shared/recession-adaptive.ts. Der Rezessions-Score bleibt unangetastet.
 */
import type { Express, Request, Response } from "express";
import { fetchFredCsv, fredCsvObservations } from "./fred-csv";
import { CAPE_SOURCE_URL, loadCapeSeries } from "./recession-cape-route";
import {
  RECESSION_ADAPTIVE_PARAMS,
  buildRecessionAdaptiveReport,
  financialAccountsBuffettRatio,
  type AdaptivePoint,
  type AdaptiveSeriesLoad,
  type RecessionAdaptiveResponse,
} from "../shared/recession-adaptive";

const FRED_FROM = "1947-01-01";
const BUFFETT_SERIES = ["GDP", "NCBEILQ027S", "FBCELLQ027S"] as const;

export interface AdaptiveLoaders {
  loadCape: () => Promise<AdaptiveSeriesLoad>;
  loadBuffett: () => Promise<AdaptiveSeriesLoad>;
  now: () => number;
}

let cache: { at: number; body: RecessionAdaptiveResponse } | null = null;

export function resetRecessionAdaptiveCache(): void {
  cache = null;
}

async function fetchCapeHtml(): Promise<string | null> {
  try {
    const response = await fetch(CAPE_SOURCE_URL, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export async function defaultLoadCape(): Promise<AdaptiveSeriesLoad> {
  const body = await loadCapeSeries(fetchCapeHtml);
  if (body.points.length === 0) {
    return { points: [], reason: body.note ?? "Multpl nicht erreichbar oder leer" };
  }
  return { points: body.points, reason: null };
}

function fredPoints(csv: string | null): AdaptivePoint[] {
  return fredCsvObservations(csv).map(row => ({ date: row.date, value: row.value }));
}

export async function defaultLoadBuffett(): Promise<AdaptiveSeriesLoad> {
  const csvs = await Promise.all(BUFFETT_SERIES.map(id => fetchFredCsv(id, FRED_FROM)));
  const missing = BUFFETT_SERIES.filter((_, index) => !csvs[index]);
  if (missing.length > 0) {
    return { points: [], reason: `FRED nicht erreichbar (${missing.join(", ")})` };
  }
  const [gdp, nonfinancial, financial] = csvs.map(fredPoints);
  const empty = BUFFETT_SERIES.filter((_, index) => fredPoints(csvs[index]).length === 0);
  if (empty.length > 0) {
    return { points: [], reason: `FRED ohne Werte (${empty.join(", ")})` };
  }
  const points = financialAccountsBuffettRatio(gdp, nonfinancial, financial);
  if (points.length === 0) {
    return { points: [], reason: "kein gemeinsames Quartal von GDP, NCBEILQ027S und FBCELLQ027S" };
  }
  return { points, reason: null };
}

function failureReason(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "unbekannter Fehler");
  return message.trim().slice(0, 200) || "unbekannter Fehler";
}

export async function getRecessionAdaptive(deps: Partial<AdaptiveLoaders> = {}): Promise<RecessionAdaptiveResponse> {
  const custom = deps.loadCape != null || deps.loadBuffett != null;
  const now = deps.now ?? Date.now;
  if (!custom && cache && now() - cache.at < RECESSION_ADAPTIVE_PARAMS.cacheTtlMs) return cache.body;
  const loadCape = deps.loadCape ?? defaultLoadCape;
  const loadBuffett = deps.loadBuffett ?? defaultLoadBuffett;
  const [cape, buffett] = await Promise.all([
    loadCape().catch(err => ({ points: [], reason: failureReason(err) })),
    loadBuffett().catch(err => ({ points: [], reason: failureReason(err) })),
  ]);
  const body: RecessionAdaptiveResponse = { adaptiv: buildRecessionAdaptiveReport({ cape, buffett }) };
  if (!custom && cape.points.length > 0 && buffett.points.length > 0) cache = { at: now(), body };
  return body;
}

export function registerRecessionAdaptiveRoute(app: Express, deps: Partial<AdaptiveLoaders> = {}): void {
  app.get("/api/analyze-recession/adaptive", async (_req: Request, res: Response) => {
    try {
      res.json(await getRecessionAdaptive(deps));
    } catch (err) {
      const reason = failureReason(err);
      res.json({
        adaptiv: buildRecessionAdaptiveReport({
          cape: { points: [], reason },
          buffett: { points: [], reason },
        }),
      });
    }
  });
}
