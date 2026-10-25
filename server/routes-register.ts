// registerRoutes — bridges server/index.ts with the actual route modules.
import type { Express } from "express";
import type { Server } from "http";

export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  const { registerRegulatoryRisksHooks, registerRegulatoryRisksRoute } = await import("./regulatory-risks-route");
  registerRegulatoryRisksHooks(app);
  const { registerRoutes: registerAllRoutes } = await import("./routes");
  await registerAllRoutes(httpServer, app);
  const { registerCryptoRegulationRoute } = await import("./crypto-regulation-route");
  registerCryptoRegulationRoute(app);
  registerRegulatoryRisksRoute(app);
  const { registerSectorRotationRoute } = await import("./researcher-sector-rotation-route");
  registerSectorRotationRoute(app);
  // GET /api/researcher/geo-map?layer=capex (Offen_WORK_CAPEX_SECTOR_MAP Slice 1, nur Anzeige, kein Score)
  const { registerGeoMapRoute } = await import("./researcher-geo-map-route");
  registerGeoMapRoute(app);
  const { registerLiquidityRoute } = await import("./researcher-liquidity-route");
  registerLiquidityRoute(app);
  const { registerLiquidityBriefingRoute } = await import("./liquidity-briefing-route");
  registerLiquidityBriefingRoute(app);
  const { registerValueChainRoutes } = await import("./valuechain-routes");
  registerValueChainRoutes(app);
  const { registerRecessionMarketRoutes } = await import("./recession-markets");
  registerRecessionMarketRoutes(app);
  const { registerBuffettRatioRoute } = await import("./buffett-route");
  registerBuffettRatioRoute(app);
  const { registerThesisLabRoutes } = await import("./thesis-lab-routes");
  registerThesisLabRoutes(app);
  const { registerDividendRoute } = await import("./dividend-route");
  registerDividendRoute(app);
  // GET /api/credit-spread/market (JOB A1, Markt-Spread Baa FRED BAA10Y, nur Anzeige in der TA, kein Score)
  const { registerCreditRoute } = await import("./credit-route");
  registerCreditRoute(app);
  // GET /api/treasury-10y/market (A3, 10J-Treasury FRED DGS10, nur Anzeige in der TA, kein Score)
  const { registerTreasury10YRoute } = await import("./treasury10y-route");
  registerTreasury10YRoute(app);
  // POST /api/export-pdf (lost from routes.ts in 57189dd, see pdf-export-route.ts)
  const { registerPdfExportRoute } = await import("./pdf-export-route");
  registerPdfExportRoute(app);
  // POST /api/refresh-risks (Section 8; lost from routes.ts in 57189dd, see refresh-risks-route.ts)
  const { registerRefreshRisksRoute } = await import("./refresh-risks-route");
  registerRefreshRisksRoute(app);
  // GET /api/watchlist + GET /api/cache from the disk cache (lost in 57189dd, see watchlist-route.ts)
  const { registerWatchlistRoutes } = await import("./watchlist-route");
  registerWatchlistRoutes(app);
  // GET /api/gold-silver-ratio (JOB 17, nur Anzeige auf /gold, kein Score)
  const { registerGoldSilverRatioRoute } = await import("./gold-silver-ratio");
  registerGoldSilverRatioRoute(app);
  // GET /api/gdx-gld-ratio (FW-16, GDX/GLD als Preis-Proxy, nur Anzeige auf /gold, kein Score)
  const { registerGdxGldRatioRoute } = await import("./gold-gdx-gld-ratio");
  registerGdxGldRatioRoute(app);
  // POST /api/chat (KI-Chatbot, WORK_DASHBOARD_FEATURES §4/§4c; nur Kontext lesen, kein Score)
  const { registerChatRoute } = await import("./chat-route");
  registerChatRoute(app);
}
