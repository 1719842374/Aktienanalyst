/**
 * routes.ts — Clean orchestrator (Step 4 of modular refactor).
 *
 * History:
 *  - Before: monolith with /api/analyze inline (~2000+ lines) → GitHub API
 *    silently truncated the file → truncation bug caused missing route body.
 *  - Now: each route is its own module. routes.ts is only a barrel + orchestrator.
 *    Structural truncation can never re-occur because no single file is large enough.
 *
 * Module map:
 *  /api/analyze, /api/fmp-budget   → server/analyze-route.ts
 *  /api/btc-miner                  → server/btc-miner.ts (GET + POST)
 *  /api/analyze-gold               → server/gold-routes.ts
 *
 * Additional routes (/api/analyze-recession, /api/researcher/*, /api/catalyst-enrich,
 * /api/export-pdf) can be extracted the same way as analyze-route.ts when needed.
 */

import type { Express } from "express";
import { type Server } from "http";

// ─── Re-exports ───────────────────────────────────────────────────────────────
// New FMP budget API + legacy quota shims (all no-ops now, kept so crons/scripts
// that still import isQuotaExceeded / incrementQuota don't break at load time).
export {
  trackFmpCall,
  getFmpBudgetStatus,
  isFmpBudgetLow,
  resetFmpBudget,
  markQuotaExceeded,
  markQuotaReset,
  incrementQuota,
  isQuotaExceeded,
  getQuotaStatus,
  callFinanceToolThrottled,
  getFmpFallbackData,
  curlOrFetchSync,
  fetchUrlText,
  cacheLLMModeMatches,
  parseMarkdownTable,
  parseNumber,
  parseCSVFromUrl,
  detectReportedCurrency,
  fetchFXRate,
  convertFinancials,
  generatePESTELAnalysis,
} from "./analyze-helpers";

export {
  getEffectiveSector,
  getSectorDefaults,
  generateRisks,
  estimateGovExposure,
  matchSegmentTAM,
  generateTAMAnalysis,
} from "./sector-data";

export {
  calcImpliedGStar,
  calcEinpreisungsgrad,
  classifyLynch,
  calcLynchPEG,
  generateCatalystContext,
  generateCatalysts,
  generateLLMCatalysts,
} from "./catalyst-engine";

export {
  fetchNewsFromGoogleRSS,
  matchNewsToCatalysts,
  fetchPeerComparisonFromTickers,
  fetchPeerComparison,
} from "./news-peers";

// ─── Route modules ────────────────────────────────────────────────────────────
import { registerAnalyzeRoute } from "./analyze-route";
import { registerGoldRoutes } from "./gold-routes";
import { fetchMinerData } from "./btc-miner";
import { fmpSearchTicker } from "./fmp";
import { assessRegulatoryExposure } from "./regulatory";
import { registerResearcherRoutes } from "./researcher";
import { registerRecessionRoutes } from "./recession";
import { registerRegressionScanRoutes } from "./regression-scan";

// ─── registerRoutes ───────────────────────────────────────────────────────────
export async function registerRoutes(httpServer: Server, app: Express): Promise<void> {
  // 1. /api/analyze + /api/fmp-budget
  registerAnalyzeRoute(httpServer, app);

  // 2. /api/analyze-gold
  registerGoldRoutes(httpServer, app);

  // 3a. GET /api/btc-miner — no price context, returns miner metrics only
  app.get("/api/btc-miner", async (_req, res) => {
    try {
      const minerData = await fetchMinerData();
      if (!minerData) {
        return res.status(503).json({ error: "Miner data unavailable — mempool.space unreachable" });
      }
      res.json(minerData);
    } catch (err: any) {
      console.error("[GET /api/btc-miner]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // 3b. POST /api/btc-miner — accepts btcPriceHistory + btcPrice for Puell & minerScore
  //     Body: { btcPriceHistory: [{date, price}][], btcPrice: number }
  app.post("/api/btc-miner", async (req, res) => {
    try {
      const { btcPriceHistory, btcPrice } = req.body ?? {};
      const minerData = await fetchMinerData(
        Array.isArray(btcPriceHistory) ? btcPriceHistory : undefined,
        typeof btcPrice === 'number' ? btcPrice : undefined
      );
      if (!minerData) {
        return res.status(503).json({ error: "Miner data unavailable — mempool.space unreachable" });
      }
      res.json(minerData);
    } catch (err: any) {
      console.error("[POST /api/btc-miner]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // 4. POST /api/regulatory — WORK2.md §8 Regulatory-Exposure-Analyse (LLM,
  //    generische Achsen ohne Fixnamen). Frontend liefert den Kontext aus der
  //    bereits geladenen StockAnalysis (geoSegments, revenue, margin, shares) —
  //    kein zweiter FMP-Roundtrip. 24h-Cache pro Ticker in regulatory.ts.
  //    Body: { ticker, companyName, sector, industry, description?,
  //            topCountries: [{countryOrRegion, percentage}], totalRevenue,
  //            operatingMargin, sharesOutstanding, taxRate?, force? }
  app.post("/api/regulatory", async (req, res) => {
    try {
      const b = req.body ?? {};
      if (!b.ticker || typeof b.ticker !== "string") {
        return res.status(400).json({ error: "ticker fehlt" });
      }
      if (!Array.isArray(b.topCountries) || typeof b.totalRevenue !== "number" ||
          typeof b.operatingMargin !== "number" || typeof b.sharesOutstanding !== "number") {
        return res.status(400).json({ error: "Kontext unvollständig (topCountries/totalRevenue/operatingMargin/sharesOutstanding)" });
      }
      const assessment = await assessRegulatoryExposure({
        ticker: b.ticker,
        companyName: String(b.companyName ?? b.ticker),
        sector: String(b.sector ?? ""),
        industry: String(b.industry ?? ""),
        description: typeof b.description === "string" ? b.description : undefined,
        topCountries: b.topCountries,
        totalRevenue: b.totalRevenue,
        operatingMargin: b.operatingMargin,
        sharesOutstanding: b.sharesOutstanding,
        taxRate: typeof b.taxRate === "number" ? b.taxRate : undefined,
        force: b.force === true,
      });
      if (!assessment) {
        return res.status(503).json({ error: "Regulatory-Analyse nicht verfügbar — LLM (OpenRouter) nicht erreichbar" });
      }
      res.json(assessment);
    } catch (err: any) {
      console.error("[POST /api/regulatory]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // 4b. /api/search-ticker — Ticker-/Firmennamen-Autocomplete fuer TickerSearch.tsx.
  //
  // REGRESSION-FIX (04.08.2026): Diese Route wurde von TickerSearch.tsx seit
  // jeher aufgerufen (GET /api/search-ticker?q=...), existierte aber NIE im
  // Server — fmpSearchTicker() in fmp.ts war eine fertige, aber komplett
  // unbenutzte Funktion. Express' SPA-Catch-All antwortete mit der index.html
  // (HTTP 200 + HTML). Das Frontend faengt den JSON-Parse-Fehler in einem
  // try/catch ab und setzt still `results=[]` — daher fiel der Bug nie als
  // Fehler auf, die Autocomplete zeigte einfach nie Vorschlaege an. Wer den
  // exakten Ticker bereits kannte, konnte ihn trotzdem manuell eintippen und
  // ueber Enter/Analyze-Button direkt an /api/analyze schicken — deshalb blieb
  // das unbemerkt. Betraf ALLE Ticker, nicht nur asiatische Werte.
  // Boersen-Suffixe, die mit dem aktuellen FMP-Plan NICHT abrufbar sind (live
  // verifiziert 04.08.2026 gegen /stable/quote): Hongkong .HK, Tokio .T, Seoul
  // .KS, Shanghai .SS, Shenzhen .SZ, Taiwan .TW/.KQ — alle asiatischen
  // Primaerboersen liefern eine Premium-Sperre statt Daten. Beim Testen zeigte
  // sich zusaetzlich, dass das Limit NICHT asien-spezifisch ist: deutsche
  // Sekundaernotierungen (.F Frankfurt, .HM Hamburg, .BE Berlin, .DU
  // Duesseldorf, .MU Muenchen) und mexikanische (.MX) sind ebenso gesperrt,
  // waehrend London (.L) und Wien (.VI) funktionieren — das Plan-Limit betrifft
  // offenbar generell "kleinere"/Sekundaer-Boersen unabhaengig vom Kontinent.
  // Diese Liste deckt die live getesteten Faelle ab, ist aber keine
  // erschoepfende FMP-Enumeration — falls weitere gesperrte Suffixe auffallen,
  // hier ergaenzen. Betrifft NUR die native Lokalboersen-Notierung, NICHT die
  // US-ADR/OTC-Notierungen derselben Unternehmen (z.B. BYDDY, XIACY, TCEHY,
  // TSM, TM, SONY funktionieren alle einwandfrei).
  const UNAVAILABLE_EXCHANGE_SUFFIXES = [
    ".HK", ".T", ".KS", ".SS", ".SZ", ".TW", ".KQ", // Asien
    ".F", ".HM", ".BE", ".DU", ".MU", ".MX",         // deutsche Sekundaerboersen + Mexiko
  ];
  function isLikelyUnavailable(symbol: string): boolean {
    return UNAVAILABLE_EXCHANGE_SUFFIXES.some(suf => symbol.toUpperCase().endsWith(suf));
  }

  app.get("/api/search-ticker", async (req, res) => {
    try {
      const q = String(req.query?.q ?? "").trim();
      if (q.length < 1) return res.json({ results: [] });
      const rows = await fmpSearchTicker(q, 20);
      // WORK_DATA_PROVIDERS.md-Prinzip (Transparenz statt stillem Fehlschlag):
      // native asiatische Boersen-Symbole werden nicht ausgeblendet (der Nutzer
      // soll sehen, dass es das Unternehmen gibt), aber klar markiert und ans
      // Ende sortiert, damit die funktionierende US-ADR/OTC-Variante zuerst
      // erscheint. Ohne diese Markierung waeren z.B. bei "Xiaomi" 1810.HK und
      // 81810.HK (beide gesperrt) die ersten beiden Treffer vor dem
      // funktionierenden XIACY-ADR erschienen.
      const mapped = rows.map(r => ({
        ticker: r.symbol,
        name: r.name,
        exchange: r.exchange || r.exchangeFullName || "",
        unavailable: isLikelyUnavailable(r.symbol),
      }));
      mapped.sort((a, b) => Number(a.unavailable) - Number(b.unavailable));
      res.json({ results: mapped.slice(0, 12) });
    } catch (err: any) {
      console.error("[GET /api/search-ticker]", err?.message?.substring(0, 150));
      res.json({ results: [] }); // fail-open: Autocomplete-Ausfall darf die App nicht blockieren
    }
  });

  // 5. /api/researcher/* — alle 5 Researcher-Tabs (macro, sectors, screener,
  //    capex, daily-briefing) × 3 Regionen.
  //
  // REGRESSION-FIX (04.08.2026): Diese Registrierung (und die beiden darunter)
  // ging beim routes.ts-Modularisierungs-Refactor (ce3b1bc "Split routes.ts
  // into 4 focused modules") verloren — registerResearcherRoutes() existierte
  // weiter in server/researcher.ts, wurde aber von NIEMANDEM mehr aufgerufen.
  // Der Kommentar in routes-register.ts behauptete fälschlich, routes.ts
  // mounte "EVERYTHING" inkl. /api/researcher/*. Folge: Express' SPA-Catch-All
  // beantwortete jeden Researcher-/Recession-Request mit der index.html
  // (HTTP 200 + HTML statt JSON) → Frontend zeigte "Unexpected end of JSON
  // input". Frische Researcher-Analysen waren seitdem unmöglich — sichtbare
  // Daten kamen nur noch aus alten Disk-Caches der Scheduled Tasks.
  registerResearcherRoutes(app);

  // 6. /api/analyze-recession — Rezessions-Dashboard (17 Indikatoren)
  registerRecessionRoutes(app);

  // 7. /api/regression-scan — Regressions-Scanner
  registerRegressionScanRoutes(app);

  // httpServer available for future WebSocket upgrades
}
