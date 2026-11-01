/**
 * Zusatzanzeigen zum Gold-Dashboard, außerhalb von /api/analyze-gold.
 * GIS, Rating und die adaptive Schicht bleiben dort unverändert.
 */
import type { Express } from "express";
import { loadGoldMineSupply } from "./gold-mine-supply";
import { loadGoldMaBacktest } from "./gold-ma-backtest";
import { getCentralBankPurchases } from "./gold-central-bank";
import { GOLD_NEWS_CACHE_HOURS } from "./gold-news";
import { centralBankResponse } from "../shared/gold-central-bank";
import { philipPendingResponse } from "../shared/gold-philip-pending";
import { MA_FAST, MA_SLOW } from "./gold-adaptive-score";

export function registerGoldFrameworkRoutes(app: Express): void {
  app.get("/api/analyze-gold/mine-supply", (_req, res) => {
    try {
      res.json(loadGoldMineSupply());
    } catch (err: any) {
      res.json(loadGoldMineSupply({
        unit: "koz",
        basis: "attributable gold production",
        retrievedAt: "",
        reasonEmpty: err?.message?.substring(0, 160) || "Produktionsdatei nicht lesbar",
        companies: {
          NEM: { name: "Newmont", ticker: "NEM", metric: "" },
          B: { name: "Barrick", ticker: "B", metric: "" },
          AEM: { name: "Agnico Eagle", ticker: "AEM", metric: "" },
        },
        values: [],
      }));
    }
  });

  app.get("/api/analyze-gold/ma-cross-backtest", async (_req, res) => {
    try {
      res.json(await loadGoldMaBacktest());
    } catch (err: any) {
      res.json({
        affectsScore: false,
        available: false,
        reason: `n/a — ${err?.message?.substring(0, 160) || "Backtest nicht berechenbar"}`,
        source: null,
        pointCount: null,
        from: null,
        to: null,
        fastPeriod: MA_FAST,
        slowPeriod: MA_SLOW,
        golden: null,
        death: null,
      });
    }
  });

  app.get("/api/analyze-gold/central-bank-purchases", async (_req, res) => {
    try {
      res.json(await getCentralBankPurchases());
    } catch (err: any) {
      res.json(centralBankResponse({
        cacheTtlHours: GOLD_NEWS_CACHE_HOURS,
        headlineCount: 0,
        stance: null,
        summary: null,
        updatedAt: null,
        reason: `n/a — ${err?.message?.substring(0, 160) || "Zentralbank-Hinweis nicht berechenbar"}`,
      }));
    }
  });

  app.get("/api/analyze-gold/philip-pending", (_req, res) => {
    res.json(philipPendingResponse());
  });
}
