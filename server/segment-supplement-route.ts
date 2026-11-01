/**
 * GET /api/segment-supplement/:ticker — Wachstum aus der Segmenthistorie, Unterposten nur bei Zuordnung.
 * Keine neuen Top-Level-Segmente. Nur Anzeige.
 */
import type { Express, Request, Response } from "express";
import { fmpProductSegmentationRaw } from "./fmp";
import { buildSegmentSupplement, type OfficialSegment, type SegmentYearPoint } from "../shared/segment-supplement";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function historyFromRaw(raw: unknown[]): { history: SegmentYearPoint[]; latest: { name: string; revenue: number | null }[] } {
  const history: SegmentYearPoint[] = [];
  const rows = raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  for (const row of rows) {
    const year = String(row.fiscalYear ?? (typeof row.date === "string" ? row.date.slice(0, 4) : ""));
    const data = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
    for (const [name, value] of Object.entries(data)) {
      if (["symbol", "date", "fiscalYear", "period", "reportedCurrency", "data"].includes(name)) continue;
      const revenue = num(value);
      if (!year || revenue == null) continue;
      history.push({ fiscalYear: year, name, revenue });
    }
  }
  const years = Array.from(new Set(history.map(h => h.fiscalYear))).sort();
  const latestYear = years[years.length - 1];
  const latest = history.filter(h => h.fiscalYear === latestYear).map(h => ({ name: h.name, revenue: h.revenue }));
  return { history, latest };
}

export async function loadSegmentSupplement(
  ticker: string,
  official: OfficialSegment[],
  deps: { raw: (t: string) => Promise<unknown[]> } = { raw: fmpProductSegmentationRaw },
) {
  try {
    const raw = await deps.raw(ticker);
    const { history, latest } = historyFromRaw(raw);
    return { ticker, ...buildSegmentSupplement(official, history, latest), source: "fmp" as const };
  } catch (err: any) {
    const empty = buildSegmentSupplement(official, [], []);
    return {
      ticker,
      ...empty,
      source: "fmp" as const,
      undisclosedNote: `n/a — Segmenthistorie nicht erreichbar${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}. ${empty.undisclosedNote}`,
    };
  }
}

export function registerSegmentSupplementRoute(app: Express): void {
  app.post("/api/segment-supplement", async (req: Request, res: Response) => {
    const ticker = String(req.body?.ticker ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "Ungültiger Ticker" });
    const list = Array.isArray(req.body?.segments) ? req.body.segments : [];
    const official: OfficialSegment[] = list
      .filter((s: unknown): s is { name: string } => !!s && typeof (s as { name?: unknown }).name === "string")
      .map((s: { name: string; percentage?: unknown; growthPct?: unknown }) => ({
        name: s.name,
        percentage: typeof s.percentage === "number" ? s.percentage : null,
        growthPct: typeof s.growthPct === "number" ? s.growthPct : null,
      }));
    res.json(await loadSegmentSupplement(ticker, official));
  });
}
