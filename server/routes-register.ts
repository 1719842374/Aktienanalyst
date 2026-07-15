// registerRoutes — glue between express/http and the route handlers in routes.ts
import type { Express } from "express";
import type { Server } from "http";
import { trackFmpCall, getFmpBudgetStatus } from "./routes";

export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  // Dynamic import so circular-dep risk is minimised
  const routes = await import("./routes");
  if (typeof (routes as any).registerExpressRoutes === "function") {
    await (routes as any).registerExpressRoutes(httpServer, app);
  } else if (typeof (routes as any).default === "function") {
    await (routes as any).default(httpServer, app);
  } else {
    // Fallback: scan for a function that looks like a route-registrar
    const fn = Object.values(routes as any).find(
      (v) => typeof v === "function" && v.length >= 2
    ) as ((s: Server, a: Express) => Promise<void>) | undefined;
    if (fn) await fn(httpServer, app);
    else console.warn("[registerRoutes] No route-registrar found in routes.ts — routes may not be mounted");
  }
}
