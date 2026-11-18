/**
 * GET /api/macro/inventory-demand-gap — F9-04 Lager/Nachfrage-Lücke.
 * Kette: Route → fetchInventoryDemandGap (server/inventory-demand-gap.ts)
 * → computeInventoryDemandGap (shared/inventory-demand-gap.ts) → FRED CSV.
 * Nur Anzeige auf /recession. Kein Score, kein Fazit, analyze-route unberührt.
 * Cache-TTL ist Parameter (Default INVENTORY_DEMAND_GAP_PARAMS.cacheTtlMs).
 * Nicht erreichbar → n/a mit Grund, kein Cache, nie 0.
 */
import type { Express, Request, Response } from "express";
import { fetchInventoryDemandGap } from "./inventory-demand-gap";
import { INVENTORY_DEMAND_GAP_PARAMS, type InventoryDemandGap } from "../shared/inventory-demand-gap";

const SOURCES = { isratio: "FRED ISRATIO", orders: "FRED DGORDER", shipments: "FRED AMDMVS" } as const;

let cache: { at: number; body: InventoryDemandGap } | null = null;

/** Nur für Tests. */
export function resetInventoryDemandGapCache(): void {
  cache = null;
}

function hasReading(body: InventoryDemandGap): boolean {
  return body.isratio.available || body.orderShipmentGap.available;
}

export async function getInventoryDemandGap(opts: {
  now?: number;
  ttlMs?: number;
  load?: () => Promise<InventoryDemandGap>;
} = {}): Promise<InventoryDemandGap> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? INVENTORY_DEMAND_GAP_PARAMS.cacheTtlMs;
  if (cache && now - cache.at < ttlMs) return cache.body;
  const body = await (opts.load ?? (async () => (await fetchInventoryDemandGap()).result))();
  if (hasReading(body)) cache = { at: now, body };
  return body;
}

function unreachable(reason: string): InventoryDemandGap {
  const na = { available: false as const, reason };
  return { isratio: na, orderShipmentGap: na, gapWindow: na, sources: SOURCES };
}

export function registerInventoryDemandGapRoute(app: Express): void {
  app.get("/api/macro/inventory-demand-gap", async (_req: Request, res: Response) => {
    try {
      res.json(await getInventoryDemandGap());
    } catch (err) {
      if (!res.headersSent) {
        const detail = String((err as Error)?.message ?? err).slice(0, 160);
        res.json(unreachable(`FRED nicht erreichbar: ${detail}`));
      }
    }
  });
}
