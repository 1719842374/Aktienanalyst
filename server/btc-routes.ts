import type { Express } from "express";
import { fetchBTCMacroHistory } from "./btc-macro";
import { buildStablecoinLiquidityResponse } from "./stablecoin-liquidity";
import { buildFiscalFrontendResponse } from "./fiscal-frontend";
import { isLLMAvailable } from "./llm-openrouter";
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";
import { fetchAllowedBtcNews } from "./news-peers";
import { applyKeywordSentimentToNews } from "./news-sentiment";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const cache = new Map<string, { expiresAt: number; data: Awaited<ReturnType<typeof fetchBTCMacroHistory>> }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

// Stablecoin-Liquidity-Kanal (Sprint D4): Market-Cap-Zahlen aktualisieren sich
// laut Spec taeglich, daher In-Memory-Fallback-TTL kurz (5 Min, wie macro-
// history) plus taegliches Disk-Cache-Backstop (diskResearcherGet/Set, analog
// zu capex__US Researcher-Cache-Muster) falls DefiLlama kurzfristig ausfaellt.
const STABLECOIN_MEM_TTL_MS = 5 * 60 * 1000;
const STABLECOIN_DISK_CACHE_KEY = "stablecoin_liquidity__measured_v3";
let stablecoinMemCache: { expiresAt: number; data: Awaited<ReturnType<typeof buildStablecoinLiquidityResponse>> } | null = null;

/**
 * Additive BTC-Route: Die bestehende Browser-Analyse bleibt unveraendert und
 * erweitert ihre technische Zeitreihe mit diesen serverseitig geladenen
 * FRED-Makro-Overlays.
 */
export function registerBTCRoutes(app: Express): void {
  app.get("/api/analyze-btc/macro-history", async (req, res) => {
    const requestedStart = typeof req.query.startDate === "string" ? req.query.startDate : "2011-01-01";
    const startDate = DATE_PATTERN.test(requestedStart) ? requestedStart : "2011-01-01";
    const cacheKey = startDate;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return res.json(cached.data);

    try {
      const data = await fetchBTCMacroHistory(startDate);
      cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      res.json(data);
    } catch (err: any) {
      console.error("[GET /api/analyze-btc/macro-history]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "FRED-Makrodaten nicht verfügbar" });
    }
  });

  // DefiLlama-Marktkapitalisierung. Keine Reserveanteile und kein Score.
  // Der Politik-Scan liegt in crypto-regulation-route.ts.
  app.get("/api/analyze-btc/stablecoin-liquidity", async (_req, res) => {
    const now = Date.now();
    if (stablecoinMemCache && stablecoinMemCache.expiresAt > now) {
      return res.json(stablecoinMemCache.data);
    }

    try {
      const data = await buildStablecoinLiquidityResponse();
      if (data.stablecoins.available) {
        // Nur bei erfolgreichem Live-Fetch cachen (Speicher + Disk-Backstop) —
        // ein Fehlerzustand soll nie als "aktuell" zwischengespeichert werden.
        const payload = { ...data, llmAvailable: isLLMAvailable() };
        stablecoinMemCache = { data: payload, expiresAt: now + STABLECOIN_MEM_TTL_MS };
        diskResearcherSet(STABLECOIN_DISK_CACHE_KEY, payload);
        return res.json(payload);
      }

      // DefiLlama nicht erreichbar: Versuche taeglichen Disk-Cache-Backstop,
      // aber NUR mit explizitem Flag, dass es sich um zwischengespeicherte
      // (nicht taggenau aktuelle) Daten handelt — niemals eine Schaetzung.
      const disked = diskResearcherGet(STABLECOIN_DISK_CACHE_KEY);
      if (disked) {
        return res.json({ ...disked, _servedFromDiskCacheAfterLiveFailure: true, _liveFetchError: data.stablecoins.error });
      }

      // Kein Live-Fetch, kein Cache-Backstop: transparent null+Flag statt Fehler-Seite.
      return res.json({ ...data, llmAvailable: isLLMAvailable() });
    } catch (err: any) {
      console.error("[GET /api/analyze-btc/stablecoin-liquidity]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "Stablecoin-Liquiditätsdaten nicht verfügbar" });
    }
  });

  // Netto-Bills, Front-End, QRA-Anker, adaptives s(z). GIS bleibt unangetastet.
  app.get("/api/analyze-btc/fiscal-frontend", async (_req, res) => {
    try {
      const data = await buildFiscalFrontendResponse();
      res.json(data);
    } catch (err: any) {
      console.error("[GET /api/analyze-btc/fiscal-frontend]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "Fiscal-Frontend nicht verfügbar" });
    }
  });

  // Bitcoin-Nachrichten nur von der Quellenliste. Kein Auffuellen mit anderen Hosts.
  const NEWS_TTL_MS = 5 * 60 * 1000;
  let newsCache: { expiresAt: number; items: unknown[] } | null = null;
  app.get("/api/analyze-btc/news", async (_req, res) => {
    const now = Date.now();
    if (newsCache && newsCache.expiresAt > now) {
      return res.json({ items: newsCache.items, source: "Quellenliste", llmAvailable: isLLMAvailable() });
    }
    try {
      const items = await fetchAllowedBtcNews();
      applyKeywordSentimentToNews(items);
      if (items.length > 0) newsCache = { items, expiresAt: now + NEWS_TTL_MS };
      res.json({ items, source: "Quellenliste", llmAvailable: isLLMAvailable() });
    } catch (err: any) {
      console.error("[GET /api/analyze-btc/news]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "Krypto-Nachrichten nicht verfügbar", items: [] });
    }
  });
}
