// registerRoutes — bridges server/index.ts with the actual route modules.
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
  const { registerValueChainRoutes } = await import("./valuechain-routes");
  registerValueChainRoutes(app);
  const { registerRecessionMarketRoutes } = await import("./recession-markets");
  registerRecessionMarketRoutes(app);
  const { registerThesisLabRoutes } = await import("./thesis-lab-routes");
  registerThesisLabRoutes(app);
}
