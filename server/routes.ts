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
import { fmpSearchTicker, fmpIncomeStatement, fmpCashFlow, fmpBalanceSheet, fmpPeers } from "./fmp";
import { assessRegulatoryExposure } from "./regulatory";
import { computeManagementScoreForTicker } from "./management-score";
import { deriveStatementTrends, identifyNewSegment, computeOldSegmentsGrowth } from "./management-score";
import { computeThesisStrength, relativeZ, sectorReferenceFallback } from "./thesis-strength";
import { filterAndSelectPeers } from "./news-peers";
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

  // 8. POST /api/management-score — Management-Execution-Score (1-10),
  //    Auftrag 05.08.2026. Analog zum /api/regulatory-Muster: lazy (Frontend
  //    ruft ihn separat, nicht bei jedem /api/analyze auf), eigener
  //    In-Memory-Cache 24h/Ticker (kostenintensive FMP-Comp/Insider-Calls +
  //    optionaler LLM-Call sollen nicht bei jedem Klick neu laufen).
  //    Body: siehe ManagementScoreRequestInput in management-score.ts —
  //    Frontend liefert Segment-/Delivery-/Capital-/Credibility-Rohdaten aus
  //    der bereits geladenen StockAnalysis, kein zweiter /api/analyze-Call.
  const _managementScoreCache = new Map<string, { data: any; time: number }>();
  const MANAGEMENT_SCORE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  app.post("/api/management-score", async (req, res) => {
    try {
      const b = req.body ?? {};
      if (!b.ticker || typeof b.ticker !== "string") {
        return res.status(400).json({ error: "ticker fehlt" });
      }
      if (!Array.isArray(b.segments) || typeof b.totalRevenue !== "number") {
        return res.status(400).json({ error: "Kontext unvollständig (segments/totalRevenue)" });
      }
      const key = String(b.ticker).toUpperCase();
      const cached = _managementScoreCache.get(key);
      if (!b.force && cached && Date.now() - cached.time < MANAGEMENT_SCORE_CACHE_TTL_MS) {
        return res.json(cached.data);
      }
      const result = await computeManagementScoreForTicker(b);
      _managementScoreCache.set(key, { data: result, time: Date.now() });
      res.json(result);
    } catch (err: any) {
      console.error("[POST /api/management-score]", err?.message?.substring(0, 200));
      res.status(500).json({ error: err?.message || "Internal error" });
    }
  });

  // 9. POST /api/thesis-strength — lazy, 24h-cached, damit die umfangreiche
  // sektorrelative Einordnung nicht jede Standardanalyse verteuert.
  const _thesisStrengthCache = new Map<string, { data: any; time: number }>();
  const THESIS_STRENGTH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  app.post("/api/thesis-strength", async (req, res) => {
    try {
      const b = req.body ?? {};
      if (!b.ticker || typeof b.ticker !== "string") return res.status(400).json({ error: "ticker fehlt" });
      if (!Array.isArray(b.segments)) return res.status(400).json({ error: "Kontext unvollständig (segments)" });
      const ticker = String(b.ticker).toUpperCase();
      const cached = _thesisStrengthCache.get(ticker);
      if (!b.force && cached && Date.now() - cached.time < THESIS_STRENGTH_CACHE_TTL_MS) return res.json(cached.data);

      const [incomeRows, cashflowRows, balanceRows, rawPeers] = await Promise.all([
        fmpIncomeStatement(ticker, 5).catch(() => []), fmpCashFlow(ticker, 5).catch(() => []),
        fmpBalanceSheet(ticker, 5).catch(() => []), fmpPeers(ticker).catch(() => []),
      ]);
      const trends = deriveStatementTrends({ incomeRows, cashflowRows, balanceRows });
      const number = (v: any): number | null => { const n = Number(v); return isFinite(n) ? n : null; };
      const revenue = (r: any) => number(r?.revenue);
      const oldest = incomeRows[incomeRows.length - 1]; const newest = incomeRows[0];
      const revNow = revenue(newest), revOld = revenue(oldest);
      const years = Math.max(1, incomeRows.length - 1);
      const revenueCagr3to5y = revNow && revOld && revNow > 0 && revOld > 0 && incomeRows.length >= 3 ? (Math.pow(revNow / revOld, 1 / years) - 1) * 100 : null;
      const netIncomeChrono = incomeRows.slice().reverse().map((r: any) => number(r?.netIncome)).filter((x: any) => x != null) as number[];
      const earningsGrowth = netIncomeChrono.slice(1).map((x, i) => netIncomeChrono[i] !== 0 ? ((x - netIncomeChrono[i]) / Math.abs(netIncomeChrono[i])) * 100 : null).filter((x): x is number => x != null);
      const mean = earningsGrowth.length ? earningsGrowth.reduce((a, x) => a + x, 0) / earningsGrowth.length : null;
      const earningsVolatility = mean != null && earningsGrowth.length >= 2 ? Math.sqrt(earningsGrowth.reduce((a, x) => a + Math.pow(x - mean!, 2), 0) / earningsGrowth.length) : null;
      const fcfMarginTrend = trends.fcfMarginTrend === "steigend" ? 1 : trends.fcfMarginTrend === "fallend" ? -1 : trends.fcfMarginTrend === "stabil" ? 0 : null;
      const leverageValues = balanceRows.map((r: any, i: number) => { const debt=number(r?.totalDebt), cash=number(r?.cashAndCashEquivalents), ebitda=number(incomeRows[i]?.ebitda); return debt != null && cash != null && ebitda && ebitda > 0 ? (debt-cash)/ebitda : null; }).filter((x: any) => x != null) as number[];
      const leverageTrend = leverageValues.length >= 2 ? (leverageValues[0] < leverageValues[leverageValues.length-1] ? 1 : leverageValues[0] > leverageValues[leverageValues.length-1] ? -1 : 0) : null;
      const opMargins = incomeRows.map((r: any) => { const rv=revenue(r), op=number(r?.operatingIncome); return rv && op != null ? op/rv*100 : null; }).filter((x: any) => x != null) as number[];
      const marginInflectionStrength = opMargins.length >= 3 ? Math.abs((opMargins[0]-opMargins[1])-(opMargins[1]-opMargins[2])) : null;
      const realizedGrowth = b.revenueGrowth != null ? Number(b.revenueGrowth) : (revNow && revenue(incomeRows[1]) ? (revNow/revenue(incomeRows[1])!-1)*100 : null);
      const gStar = number(b.impliedGStar);
      const missingFeatures: string[] = [];
      const vectorFields: Array<[string, number | null]> = [["revenueCagr3to5y",revenueCagr3to5y],["earningsVolatility",earningsVolatility],["fcfMarginTrend",fcfMarginTrend],["leverageTrend",leverageTrend],["marginInflectionStrength",marginInflectionStrength],["growthGap",gStar != null && realizedGrowth != null ? gStar-realizedGrowth : null]];
      vectorFields.forEach(([name,value])=>{if(value==null)missingFeatures.push(name);});
      const rawPeerTickers = Array.isArray(rawPeers) ? rawPeers.map((p:any)=>String(p?.symbol ?? p ?? "")).filter(Boolean) : [];
      const peers = await filterAndSelectPeers(ticker, String(b.sector ?? ""), String(b.industry ?? ""), rawPeerTickers, 5).catch(()=>[]);
      const peerStatements = await Promise.all(peers.map(async p => {
        const [i,c,bs] = await Promise.all([fmpIncomeStatement(p,3).catch(()=>[]),fmpCashFlow(p,3).catch(()=>[]),fmpBalanceSheet(p,3).catch(()=>[])]);
        const it=deriveStatementTrends({incomeRows:i,cashflowRows:c,balanceRows:bs}); const r0=number(i[0]?.revenue),r1=number(i[1]?.revenue);
        const inv=number(bs[0]?.inventory), fcfM=it.fcfMarginPct, grow=r0&&r1?(r0/r1-1):null, op=r0&&number(i[0]?.operatingIncome)!=null?number(i[0]?.operatingIncome)!/r0:null;
        return { inventory_yoy: inv&&number(bs[1]?.inventory)?inv/number(bs[1]?.inventory)!-1:null, revenue_yoy:grow, op_margin_delta:op, fcf_margin:fcfM, capex_revenue:r0&&number(c[0]?.capitalExpenditure)!=null?Math.abs(number(c[0]?.capitalExpenditure)!)/r0:null, net_debt_ebitda:null, earnings_volatility:null };
      }));
      const metric = (key:string) => { const xs=peerStatements.map((x:any)=>x[key]).filter((x:any)=>typeof x==="number"&&isFinite(x)) as number[]; const med=xs.length?[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)]:null; const avg=xs.length?xs.reduce((a,x)=>a+x,0)/xs.length:0; const std=xs.length?Math.sqrt(xs.reduce((a,x)=>a+Math.pow(x-avg,2),0)/xs.length):null; return {median:med,std}; };
      const sectorReferences = { sector:String(b.sector??""), as_of:new Date().toISOString(), metrics:{inventory_yoy:metric("inventory_yoy"),revenue_yoy:metric("revenue_yoy"),op_margin_delta:metric("op_margin_delta"),fcf_margin:metric("fcf_margin"),capex_revenue:metric("capex_revenue"),net_debt_ebitda:metric("net_debt_ebitda"),earnings_volatility:metric("earnings_volatility"),working_capital:metric("working_capital"),cash_conversion:metric("cash_conversion")}, peer_count:peers.length };
      const sectorFallback = sectorReferenceFallback(peers.length);
      const peerReferenceReliable = !sectorFallback.neutral;
      const sectorFlag = sectorFallback.flags;
      const invNow=number(balanceRows[0]?.inventory), invPrev=number(balanceRows[1]?.inventory);
      const invYoy=invNow&&invPrev?invNow/invPrev-1:null;
      const newSeg=identifyNewSegment(b.segments); const oldGrowth=newSeg?computeOldSegmentsGrowth(b.segments,newSeg.name):null;
      const thesisGrowth=newSeg?.growthPct != null && oldGrowth != null ? (newSeg.sharePct/100)*newSeg.growthPct+(1-newSeg.sharePct/100)*oldGrowth : null;
      // Auftrag 07.08.2026 ("Fix: Thesis-Score Klassifikation / Konfidenz-Mix"):
      // Pflicht-Debug-Logging vor der Konfidenzberechnung -- macht bei jedem
      // zukuenftigen Kollaps auf einen Stil sofort sichtbar, ob es an den
      // rohen Similarities, dem Lynch-Boost oder der Softmax-Temperatur liegt.
      const thesisCompanyVector = {revenueCagr3to5y,earningsVolatility,fcfMarginTrend,leverageTrend,marginInflectionStrength,growthGap:gStar!=null&&realizedGrowth!=null?gStar-realizedGrowth:null,missingFeatures};
      // Auftrag 07.08.2026 ("Querschnitts-Konsistenz + Wachstums-Logik"):
      // GrowthEvidence-Inputs verbindlich aus den bereits vorhandenen
      // Querschnittsdaten ableiten -- KEINE neue Datenquelle, nur Wiederver-
      // wendung von S1 (EPS-CAGR, ueber b.epsGrowth5Y vom Client), S2
      // (newSeg?.growthPct -- das bereits ermittelte Hauptthese-Segment,
      // z.B. Server +31.5%) und S7 (realizedGrowth vs. Sektor-Median aus
      // sectorReferences, dieselbe Quelle wie fuer sectorGrowthMedian).
      const sectorRevenueYoyPct = sectorReferences.metrics.revenue_yoy.median != null ? sectorReferences.metrics.revenue_yoy.median*100 : null;
      const peerGapPct = realizedGrowth != null && sectorRevenueYoyPct != null ? realizedGrowth - sectorRevenueYoyPct : null;
      const maxSegmentGrowthPct = newSeg?.growthPct ?? null;
      const epsCagr5yPct = number(b.epsGrowth5Y);
      console.log(`[THESIS-STRENGTH][${String(b.ticker||"?").toUpperCase()}] Company-Vektor (roh):`, JSON.stringify(thesisCompanyVector));
      console.log(`[THESIS-STRENGTH][${String(b.ticker||"?").toUpperCase()}] lynchClass vom Client:`, b.lynchClass ?? "n/a");
      console.log(`[THESIS-STRENGTH][${String(b.ticker||"?").toUpperCase()}] GrowthEvidence-Inputs: peerGapPct=${peerGapPct}, maxSegmentGrowthPct=${maxSegmentGrowthPct}, epsCagr5yPct=${epsCagr5yPct} (realizedGrowth=${realizedGrowth}, sectorRevenueYoyPct=${sectorRevenueYoyPct})`);
      const result=computeThesisStrength({vector:thesisCompanyVector,fcf:number(b.fcfTTM),gStar,thesisGrowth,consensusGrowth:number(b.consensusGrowth),sectorGrowthMedian:sectorRevenueYoyPct,backlogAvailable:false,catalysts:b.catalysts,segmentName:newSeg?.name,lynchClass:b.lynchClass ?? null,peerGapPct,maxSegmentGrowthPct,epsCagr5yPct,balance:{inventoryZ:peerReferenceReliable?relativeZ(invYoy,sectorReferences.metrics.inventory_yoy.median,sectorReferences.metrics.inventory_yoy.std):0,growthZ:peerReferenceReliable?relativeZ(realizedGrowth != null ? realizedGrowth/100:null,sectorReferences.metrics.revenue_yoy.median,sectorReferences.metrics.revenue_yoy.std):0,marginZ:peerReferenceReliable?relativeZ(trends.fcfMarginPct != null ? trends.fcfMarginPct/100:null,sectorReferences.metrics.fcf_margin.median,sectorReferences.metrics.fcf_margin.std):0,marginPositivePeriods:opMargins.length>=3?opMargins.filter(x=>x>0).length:0},turnaround:{margins:opMargins.slice().reverse(),fcfMargins:cashflowRows.map((r:any,i:number)=>{const rv=revenue(incomeRows[i]),oc=number(r?.operatingCashFlow),cap=number(r?.capitalExpenditure);return rv&&oc!=null&&cap!=null?(oc-Math.abs(cap))/rv:null;}).filter((x:any)=>x!=null).reverse(),leverage:leverageValues.slice().reverse()}});
      // Auftrag 07.08.2026 ("Denoising Softmax + Temperature Scaling"): finale
      // Konfidenzen + Gewichte loggen, damit ein zukuenftiger Kollaps sofort
      // an der Similarity- vs. Konfidenz-Differenz erkennbar ist.
      console.log(`[THESIS-STRENGTH][${String(b.ticker||"?").toUpperCase()}] GrowthEvidence:`, JSON.stringify(result.growthEvidence));
      console.log(`[THESIS-STRENGTH][${String(b.ticker||"?").toUpperCase()}] Konfidenzen nach Growth-Logic+Lynch-Boost+Temperature-Softmax+Floor+Safety-Guard:`, JSON.stringify(result.styleConfidences));
      console.log(`[THESIS-STRENGTH][${String(b.ticker||"?").toUpperCase()}] Gemischte Gewichte:`, JSON.stringify(result.blendedWeights), "| classificationConfidence:", result.classificationConfidence);
      console.log(`[THESIS-STRENGTH][${String(b.ticker||"?").toUpperCase()}] g_required Split:`, JSON.stringify(result.growthCoverage.gRequiredBreakdown));
      const response={...result,sectorReferences,flags:[...result.flags,...sectorFlag],generatedAt:new Date().toISOString()};
      _thesisStrengthCache.set(ticker,{data:response,time:Date.now()}); res.json(response);
    } catch(err:any){ console.error("[POST /api/thesis-strength]",err?.message?.substring(0,200)); res.status(500).json({error:err?.message||"Internal error"}); }
  });
}
