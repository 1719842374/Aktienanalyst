// registerRoutes — bridges server/index.ts with the actual route modules.
// server/routes.ts exports a full registerRoutes(server, app) that mounts
// EVERYTHING itself: /api/analyze, /api/analyze-recession, /api/researcher/*,
// /api/catalyst-enrich, /api/export-pdf, and gold routes (via gold-routes.ts).
// Do not also call registerGoldRoutes here — routes.ts already does it,
// and double-registering the same paths is redundant.
import type { Express } from "express";
import type { Server } from "http";

export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  const { registerRegulatoryRisksHooks, registerRegulatoryRisksRoute } = await import("./regulatory-risks-route");
  registerRegulatoryRisksHooks(app);
  const { registerRoutes: registerAllRoutes } = await import("./routes");
  await registerAllRoutes(httpServer, app);
  registerRegulatoryRisksRoute(app);
  const { registerSectorRotationRoute } = await import("./researcher-sector-rotation-route");
  registerSectorRotationRoute(app);
  const { registerLiquidityRoute } = await import("./researcher-liquidity-route");
  registerLiquidityRoute(app);
  // Sprint D6a (tickets/SPRINT_D6A_VALUECHAIN_DATEN.md): Branchen-Selector +
  // FMP-Enrichment + CAPEX live — additive Registrierung, gleiches Muster.
  const { registerValueChainRoutes } = await import("./valuechain-routes");
  registerValueChainRoutes(app);
}
