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
  // GET /api/researcher/geo-map?layer=capex|sector|miner|gold|valuechain (SWR und Miner-Netz aus #397)
  const { registerGeoMapRoute } = await import("./researcher-geo-map-route");
  registerGeoMapRoute(app);
  const { registerLiquidityRoute } = await import("./researcher-liquidity-route");
  registerLiquidityRoute(app);
  const { registerLiquidityBriefingRoute } = await import("./liquidity-briefing-route");
  registerLiquidityBriefingRoute(app);
  // GET /api/researcher/fiscal-programs (FW-34, Discovery → Fiscal-Bridge, nur Anzeige, kein Score)
  const { registerFiscalDiscoveryRoute } = await import("./fiscal-discovery-route");
  registerFiscalDiscoveryRoute(app);
  const { registerValueChainRoutes } = await import("./valuechain-routes");
  registerValueChainRoutes(app);
  // POST /api/valuechain/hype — FMP-Proxy aus PR 390, nur Anzeige, kein Score, kein Trends.
  const { registerHypeCycleRoute } = await import("./hype-cycle-route");
  registerHypeCycleRoute(app);
  const { registerRecessionMarketRoutes } = await import("./recession-markets");
  registerRecessionMarketRoutes(app);
  const { registerRecessionTaRoute } = await import("./recession-ta-route");
  registerRecessionTaRoute(app);
  const { registerBuffettRatioRoute } = await import("./buffett-route");
  registerBuffettRatioRoute(app);
  // GET /api/analyze-recession/cape (F1-45, Multpl Shiller PE, nur Anzeige, kein Score)
  const { registerCapeRoute } = await import("./recession-cape-route");
  registerCapeRoute(app);
  // GET /api/analyze-recession/fred-history (F1-45, FRED über fred-csv, nur Anzeige, kein Score)
  const { registerFredHistoryRoute } = await import("./recession-fred-history-route");
  registerFredHistoryRoute(app);
  // GET /api/analyze-recession/google-trends (F1-45, nur Cache-Lesen, kein SerpApi, kein Score)
  const { registerGoogleTrendsOverlayRoute } = await import("./recession-trends-route");
  registerGoogleTrendsOverlayRoute(app);
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
  // GET /api/gold-silver-ratio und /api/gold-silver-ratio/history (nur Anzeige auf /gold, kein Score)
  const { registerGoldSilverRatioRoute } = await import("./gold-silver-ratio");
  registerGoldSilverRatioRoute(app);
  // POST /api/chat (KI-Chatbot, WORK_DASHBOARD_FEATURES §4/§4c; nur Kontext lesen, kein Score)
  const { registerChatRoute } = await import("./chat-route");
  registerChatRoute(app);
  // POST /api/podcast/brief — Key Driver und Skript, kein Score.
  const { registerPodcastRoute } = await import("./podcast-route");
  registerPodcastRoute(app);
  const { registerPodcastTranscriptRoute } = await import("./podcast-transcript-route");
  registerPodcastTranscriptRoute(app);
  const { registerAttraktivNotifyRoute } = await import("./attraktiv-notify-route");
  registerAttraktivNotifyRoute(app);
  // GET /api/earnings-markers/:ticker (WORK_DASHBOARD_FEATURES §2, nur Anzeige, kein Score)
  const { registerEarningsMarkersRoute } = await import("./earnings-markers-route");
  registerEarningsMarkersRoute(app);
  // POST /api/balance-screen (FW-27, CSV im Body, nur Anzeige, kein Score)
  const { registerBalanceScreenRoute } = await import("./balance-screen-route");
  registerBalanceScreenRoute(app);
  // GET /api/financial-history/:ticker und POST /api/segment-supplement.
  // Nur Anzeige. Der Unterposten-Provider bleibt leer. Kein Score, kein LLM.
  // Der Hype-Hunk von #466 steht weiter oben, direkt nach registerValueChainRoutes, und wird hier nicht angefasst.
  const { registerFinancialHistoryRoute } = await import("./financial-history-route");
  registerFinancialHistoryRoute(app);
  const { registerSegmentSupplementRoute } = await import("./segment-supplement-route");
  registerSegmentSupplementRoute(app);
}
