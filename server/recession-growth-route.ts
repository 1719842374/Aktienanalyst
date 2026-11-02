/**
 * GET /api/recession/earnings-growth/:index
 * GET /api/recession/growth-gap/:index
 * Dieselbe Rechnung, zwei Pfade aus den Specs. Nur Anzeige auf /recession, kein Score.
 * Cache-TTL: GROWTH_GAP_PARAMS.cacheTtlMs (6 h). Leerer Fehlschlag wird nicht gecacht.
 */
import type { Express, Request, Response } from "express";
import { GROWTH_GAP_PARAMS, emptyGrowthBody, parseGrowthIndex, type GrowthIndex, type RecessionGrowthBody } from "../shared/recession-growth";
import { loadRecessionGrowth } from "./recession-growth";

const cache = new Map<GrowthIndex, { at: number; body: RecessionGrowthBody }>();

export function resetRecessionGrowthCache(): void {
  cache.clear();
}

function worthCaching(body: RecessionGrowthBody): boolean {
  if (body.realized.length > 0 && body.chart.length > 0) return true;
  return body.chart.length > 0 && !!body.realizedError && /nicht konfiguriert/.test(body.realizedError);
}

export async function getRecessionGrowth(index: GrowthIndex, opts: {
  now?: number;
  ttlMs?: number;
  load?: () => Promise<RecessionGrowthBody>;
} = {}): Promise<RecessionGrowthBody> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? GROWTH_GAP_PARAMS.cacheTtlMs;
  const hit = cache.get(index);
  if (hit && now - hit.at < ttlMs) return hit.body;
  const body = await (opts.load ?? (() => loadRecessionGrowth(index)))();
  if (worthCaching(body)) cache.set(index, { at: now, body });
  return body;
}

async function respond(raw: unknown, res: Response): Promise<void> {
  const index = parseGrowthIndex(raw);
  if (!index) {
    res.json(emptyGrowthBody("n/a — unbekannter Index (erlaubt: SPY, VGK, ASHR)"));
    return;
  }
  try {
    res.json(await getRecessionGrowth(index));
  } catch (err) {
    if (!res.headersSent) {
      const detail = String((err as Error)?.message ?? err).slice(0, 160);
      res.json(emptyGrowthBody(`n/a — Growth-Route nicht erreichbar: ${detail}`));
    }
  }
}

export function registerRecessionGrowthRoutes(app: Express): void {
  app.get("/api/recession/earnings-growth/:index", (req: Request, res: Response) => {
    void respond(req.params.index, res);
  });
  app.get("/api/recession/growth-gap/:index", (req: Request, res: Response) => {
    void respond(req.params.index, res);
  });
}
