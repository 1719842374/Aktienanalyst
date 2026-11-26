/**
 * Cache und Tageslimit des Aktien-Podcasts, plus die Isolierung vom Analyze-UI-Cache.
 * Kein Netz, kein OpenRouter, kein FMP.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-cache-limit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DCF_CALIBRATION } from "../shared/dcf-calibration";
import { PODCAST_DAILY_MAX } from "../shared/podcast-types";
import { analyzeRequestSchema } from "../shared/schema";
import { requestSkipsAnalyzeUiCache, PODCAST_ANALYZE_ISOLATE } from "../server/analyze-route";
import { resetPodcastPackCache, runFullAiAnalysis } from "../server/stock-podcast-full-ai";
import {
  madridDayKey,
  podcastDailyCount,
  podcastDailyRefund,
  podcastDailyTake,
  resetPodcastDailyLimit,
} from "../server/stock-podcast-limit";
import { handleStockPodcastScript, resetStockPodcastRouteState } from "../server/stock-podcast-route";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

const noonMadridWinter = new Date("2026-11-26T12:00:00.000Z");
const nextMadridDay = new Date("2026-11-27T12:00:00.000Z");

function analysisBody() {
  return {
    ticker: "NVDA",
    companyName: "NVIDIA",
    sector: "Technology",
    industry: "Semiconductors",
    description: "GPUs",
    currency: "USD",
    currentPrice: 149.3,
    financialStatements: { incomeStatement: { revenue: 130_000_000_000, revenueGrowth: 114, operatingMargin: 60 } },
    catalysts: [{ name: "Rechenzentren", context: "Nachfrage", pos: 70, gb: 4 }],
    policyContext: { usa: "Exportregeln", europa: "liegt vor", asien: "liegt vor", moatImpact: "Burggraben" },
    _podcastInternals: { revenueY1: 60_000_000_000, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
  };
}

async function main() {
  assert.equal(DCF_CALIBRATION.enabled, false);
  ok("DCF_CALIBRATION.enabled bleibt false");

  const parsed = analyzeRequestSchema.parse({ ticker: "nvda" });
  assert.equal(parsed.useLLM, false);
  assert.equal(parsed.force, false);
  assert.equal("podcastIsolate" in parsed, false);
  ok("/api/analyze-Default bleibt useLLM false, ohne Podcast-Feld");

  const marked = { [PODCAST_ANALYZE_ISOLATE]: true };
  assert.equal(requestSkipsAnalyzeUiCache(marked), true);
  assert.equal(requestSkipsAnalyzeUiCache({ body: { podcastIsolate: true } }), false);
  ok("Nur das interne Symbol überspringt den Analyze-UI-Cache");

  const analyzeSrc = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  assert.match(analyzeSrc, /const \{ ticker, useLLM = false, force: forceRefresh = false, peerOverrides \} = parsed\.data;/);
  assert.match(analyzeSrc, /if \(forceRefresh && !isolateFromUiCache\)/);
  assert.match(analyzeSrc, /if \(!requestSkipsAnalyzeUiCache\(req\)\) \{\s*analysisCache\.set/);
  assert.match(analyzeSrc, /if \(!requestSkipsAnalyzeUiCache\(req\)\) diskCacheSet\(cacheKey, analysis\)/);
  assert.match(analyzeSrc, /if \(!requestSkipsAnalyzeUiCache\(req\)\) persistScoringSnapshot/);
  assert.match(analyzeSrc, /_podcastInternals/);
  const market = readFileSync(new URL("../server/podcast-route.ts", import.meta.url), "utf8");
  assert.equal(market.includes("/api/podcast/script"), false);
  assert.match(market, /\/api\/podcast\/brief/);
  const register = readFileSync(new URL("../server/routes-register.ts", import.meta.url), "utf8");
  const briefAt = register.indexOf("registerPodcastRoute(app)");
  const stockAt = register.indexOf("registerStockPodcastRoute(app)");
  assert.ok(briefAt > 0 && stockAt > briefAt);
  ok("Markt-Route bleibt, Aktien-Route steht direkt dahinter, UI-Cache wird im Isolationspfad nicht geschrieben");

  resetPodcastDailyLimit();
  assert.equal(madridDayKey(noonMadridWinter), "2026-11-26");
  assert.equal(madridDayKey(new Date("2026-11-26T23:30:00.000Z")), "2026-11-27");
  assert.equal(podcastDailyTake("nvda", noonMadridWinter), true);
  assert.equal(podcastDailyTake("NVDA", noonMadridWinter), true);
  assert.equal(podcastDailyCount("NVDA", noonMadridWinter), PODCAST_DAILY_MAX);
  assert.equal(podcastDailyTake("NVDA", noonMadridWinter), false);
  assert.equal(podcastDailyTake("MSFT", noonMadridWinter), true);
  podcastDailyRefund("NVDA", noonMadridWinter);
  assert.equal(podcastDailyTake("NVDA", noonMadridWinter), true);
  assert.equal(podcastDailyTake("NVDA", nextMadridDay), true);
  ok("Tageslimit je Ticker bis Mitternacht Europe/Madrid, anderer Ticker und nächster Tag zählen neu");

  resetStockPodcastRouteState();
  let analyzeCalls = 0;
  const deps = {
    now: () => noonMadridWinter,
    llmAvailable: () => true,
    fullAi: (ticker: string, opts?: { regenerate?: boolean; now?: Date }) => runFullAiAnalysis(ticker, {
      ...opts,
      now: noonMadridWinter,
      deps: {
        llmAvailable: () => true,
        now: () => noonMadridWinter,
        analyze: async () => {
          analyzeCalls += 1;
          return { status: 200, body: analysisBody() };
        },
        pestel: async () => [{ dimension: "Politisch", impact: "neutral", score: 0, summary: "Text", keyFactors: [] }],
        management: async () => ({ breakdown: { score1to10: 6 } }),
        interpret: async () => ({ data: { fazit: "Einordnung" }, modelUsed: "test" }),
        earnings: async () => ({
          symbol: "NVDA", status: "n/a" as const, reason: "n/a — Test", year: null, quarter: null,
          date: null, summary: null, excerpt: null, excerptTruncated: false, source: null,
        }),
        regulatory: async () => ({ ticker: "NVDA", exposures: [] }),
        thesis: () => ({ score: 0.5, flags: ["Merkmal fehlt: Test"] }),
      },
    }),
  };

  const first = await handleStockPodcastScript({ ticker: "nvda", source: "pdf" }, deps);
  assert.equal(first.http, 200);
  assert.equal(first.body.ok, true);
  if (first.body.ok) {
    assert.equal(first.body.packCached, false);
    assert.equal(first.body.asOf, "2026-11-26");
    assert.equal(first.body.cacheKey, "spack:NVDA:2026-11-26");
    assert.equal(first.body.sections.pestelLlm, true);
    assert.equal(first.body.sections.policyContext, true);
    assert.equal(first.body.sections.management, true);
    assert.equal(first.body.sections.managementInterpret, true);
    assert.equal(first.body.sections.earningsBrief, true);
    assert.equal(first.body.sections.regulatory, true);
    assert.equal(first.body.sections.thesisStrength, true);
  }
  assert.equal(analyzeCalls, 1);

  const second = await handleStockPodcastScript({ ticker: "NVDA", source: "ki" }, deps);
  assert.equal(second.http, 200);
  if (second.body.ok) assert.equal(second.body.packCached, true);
  assert.equal(analyzeCalls, 1);
  assert.equal(podcastDailyCount("NVDA", noonMadridWinter), 1);
  ok("Pack 1× je Tag und Ticker, zweiter Abruf ist Cache und zählt nicht");

  const again = await handleStockPodcastScript({ ticker: "NVDA", source: "pdf", regenerate: true }, deps);
  assert.equal(again.http, 200);
  if (again.body.ok) assert.equal(again.body.packCached, false);
  assert.equal(analyzeCalls, 2);
  assert.equal(podcastDailyCount("NVDA", noonMadridWinter), 2);
  ok("regenerate erzwingt einen neuen Pack und zählt als Erzeugung");

  const limited = await handleStockPodcastScript({ ticker: "NVDA", source: "ki", regenerate: true }, deps);
  assert.equal(limited.http, 429);
  assert.equal(limited.body.ok, false);
  if (!limited.body.ok) assert.equal(limited.body.errorCode, "RATE_LIMITED");
  assert.equal(analyzeCalls, 2);
  ok("Dritte Neu-Erzeugung am selben Tag ist 429, ohne weiteren Analyze-Lauf");

  resetPodcastPackCache();
  resetPodcastDailyLimit();
  const noKey = await handleStockPodcastScript({ ticker: "NVDA", source: "pdf" }, { ...deps, llmAvailable: () => false });
  assert.equal(noKey.http, 503);
  if (!noKey.body.ok) assert.equal(noKey.body.errorCode, "NO_API_KEY");
  assert.equal(analyzeCalls, 2);
  ok("Ohne OpenRouter-Key kein Analyze-Lauf");

  const off = await handleStockPodcastScript({ ticker: "NVDA", source: "pdf", fullAi: false }, deps);
  assert.equal(off.http, 409);
  if (!off.body.ok) assert.equal(off.body.errorCode, "KI_MODE_OFF");
  ok("fullAi false liefert KI_MODE_OFF und startet nichts");

  const failed = await handleStockPodcastScript({ ticker: "AAPL", source: "pdf" }, {
    ...deps,
    fullAi: () => runFullAiAnalysis("AAPL", {
      now: noonMadridWinter,
      deps: {
        llmAvailable: () => true,
        analyze: async () => {
          analyzeCalls += 1;
          return { status: 503, body: { error: "down" } };
        },
      },
    }),
  });
  assert.equal(failed.http, 503);
  if (!failed.body.ok) assert.equal(failed.body.errorCode, "LLM_UNAVAILABLE");
  assert.equal(podcastDailyCount("AAPL", noonMadridWinter), 0);
  ok("Fehlgeschlagener Lauf verbraucht das Tageslimit nicht");

  console.log(`ki-podcast cache/limit: ${n} checks ok`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
