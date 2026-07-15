// registerRoutes — bridges server/index.ts with the actual route modules.
// routes.ts contains helper functions + the /api/analyze handler logic.
// gold-routes.ts exports registerGoldRoutes for /api/analyze-gold.
import type { Express } from "express";
import type { Server } from "http";
import { registerGoldRoutes } from "./gold-routes";

export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  // Mount Gold routes (/api/analyze-gold)
  registerGoldRoutes(httpServer, app);

  // Mount the main stock-analysis route (/api/analyze) and all other routes
  // from routes.ts. The module exposes a default-export function or named
  // exports — we try both shapes, then fall back to a no-op with a warning.
  const routesMod = await import("./routes") as any;

  if (typeof routesMod.registerRoutes === "function") {
    await routesMod.registerRoutes(httpServer, app);
  } else if (typeof routesMod.default === "function") {
    await routesMod.default(httpServer, app);
  } else {
    // routes.ts only exports utility functions — scan for a registrar-shaped fn
    const registrar = Object.values(routesMod).find(
      (v): v is (s: Server, a: Express) => void | Promise<void> =>
        typeof v === "function" && v.length >= 2
    );
    if (registrar) {
      await registrar(httpServer, app);
    } else {
      console.warn(
        "[registerRoutes] No route-registrar function found in routes.ts. " +
        "Stock-analysis endpoints may be missing. " +
        "Add `export async function registerRoutes(server, app) {...}` to routes.ts."
      );
    }
  }
}
