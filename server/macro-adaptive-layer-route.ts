/**
 * POST /api/macro/adaptive-layer — F9-18.
 * Knopf auf /recession. Kein Aufruf beim Seitenladen.
 * Cache 6 h nur, wenn Equal-Weight oder Eurostat oder die Hyperscaler-Summe einen Wert hat.
 * Nicht erreichbar → n/a mit Grund, kein Cache, nie 0. Score-Schalter bleibt aus.
 */
import type { Express, Request, Response } from "express";
import { loadMacroAdaptiveLayer } from "./macro-adaptive-layer";
import { unavailableMacroAdaptiveLayer, type MacroAdaptiveLayer } from "../shared/macro-adaptive-layer";

/** Dieselbe Größenordnung wie die Lager/Nachfrage-Lücke (monatlich/quartalsweise). */
export const MACRO_LAYER_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { at: number; body: MacroAdaptiveLayer } | null = null;

export function resetMacroAdaptiveLayerCache(): void {
  cache = null;
}

function worthCaching(body: MacroAdaptiveLayer): boolean {
  const equal = body.europe.slots[1];
  const capex = body.europe.slots[2];
  return body.hyperscalerCapex.aggregate.available || equal.spread.available || capex.yoy.available;
}

export async function getMacroAdaptiveLayer(opts: {
  now?: number;
  ttlMs?: number;
  load?: () => Promise<MacroAdaptiveLayer>;
} = {}): Promise<MacroAdaptiveLayer> {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlMs ?? MACRO_LAYER_CACHE_TTL_MS;
  if (cache && now - cache.at < ttlMs && now >= cache.at) return cache.body;
  const body = await (opts.load ?? (() => loadMacroAdaptiveLayer({ now: new Date(now) })))();
  if (worthCaching(body)) cache = { at: now, body };
  return body;
}

export function registerMacroAdaptiveLayerRoute(app: Express): void {
  app.post("/api/macro/adaptive-layer", async (_req: Request, res: Response) => {
    try {
      res.json(await getMacroAdaptiveLayer());
    } catch (err: unknown) {
      if (!res.headersSent) {
        const detail = String(err instanceof Error ? err.message : err).slice(0, 160);
        res.json(unavailableMacroAdaptiveLayer(`n/a — Schicht nicht gebaut (${detail})`, new Date().toISOString()));
      }
    }
  });
}
