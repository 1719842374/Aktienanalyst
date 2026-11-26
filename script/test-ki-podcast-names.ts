/**
 * Eigennamen und Ticker bleiben beim Normalisieren heil.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-names.ts
 */
import assert from "node:assert/strict";
import { buildPodcastFacts } from "../shared/podcast-facts";
import { assemblePodcastChapters, checkPodcastSentence } from "../shared/podcast-script";
import { speakNormalize } from "../shared/podcast-speak";
import type { FullAiPack } from "../server/stock-podcast-full-ai";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

function pack(analysis: Record<string, unknown>): FullAiPack {
  return {
    ticker: String(analysis.ticker ?? "NVDA"),
    day: "2026-11-26",
    generatedAt: "2026-11-26T12:00:00.000Z",
    analysis,
    pestelLlm: null,
    management: null,
    managementInterpret: null,
    earningsBrief: null,
    regulatory: null,
    thesisStrength: null,
    policyContext: null,
    timedOut: [],
    sections: {
      analyze: true, pestelLlm: false, policyContext: false, management: false,
      managementInterpret: false, earningsBrief: false, regulatory: false, thesisStrength: false,
    },
  };
}

function facts(analysis: Record<string, unknown>) {
  return buildPodcastFacts(pack(analysis), new Date("2026-11-26T12:00:00.000Z"));
}

function listed(ticker: string, company: string, extra: Record<string, unknown> = {}) {
  return facts({
    ticker,
    companyName: company,
    currentPrice: 100,
    currency: "USD",
    catalystsSource: "llm",
    dataTimestamp: "2026-11-26T12:00:00.000Z",
    financialStatements: { incomeStatement: { revenue: 10e9, revenueGrowth: 8 } },
    _podcastInternals: { revenueY1: 9e9, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
    ...extra,
  });
}

function main() {
  assert.equal(speakNormalize("unter 5M Seats")?.includes("fünf Millionen"), true);
  assert.equal(speakNormalize("MMM, 3M Company"), "MMM, 3M Company");
  assert.equal(speakNormalize("NVIDIA nutzt H100, B200, GB200, A17 und Q4."), "NVIDIA nutzt H100, B200, GB200, A17 und Quartal vier.");
  assert.equal(speakNormalize("Microsoft 365 und der S&P 500 bleiben."), "Microsoft 365 und der S&P 500 bleiben.");
  ok("5M Seats wird Worte, 3M, H100 und Microsoft 365 bleiben Tokens");

  const ebay = listed("EBAY", "eBay");
  const ebayStart = assemblePodcastChapters("pdf", ebay, {
    chapters: [{ id: "einstieg", sentences: ["Wir schauen auf ein Schwergewicht."] }],
  }).find(c => c.id === "einstieg")?.spoken ?? "";
  assert.match(ebayStart, /EBAY, eBay\./);
  assert.match(ebayStart, /Stand vom/);
  assert.match(ebayStart, /Der Kurs steht bei/);
  assert.match(ebayStart, /Wir schauen auf ein Schwergewicht/);
  assert.ok(ebayStart.indexOf("EBAY, eBay") < ebayStart.indexOf("Schwergewicht"));
  for (const company of ["iPhone", "iShares", "iRobot"]) {
    const spoken = assemblePodcastChapters("pdf", listed("TEST", company), null)
      .find(c => c.id === "einstieg")?.spoken ?? "";
    assert.match(spoken, new RegExp(company));
    assert.equal(spoken.includes("liegt nicht vor") && !spoken.includes(company), false, spoken);
  }
  const products = listed("AAPL", "Apple", {
    keyProjects: ["iPhone", "iShares", "iRobot"],
    revenueSegments: [{ name: "iPhone", revenue: 10, percentage: 40, fiscalYear: "2026" }],
  });
  assert.equal(checkPodcastSentence("iPhone, iShares und iRobot bleiben Produkte.", products, "s13", "model").ok, true);
  const productSpoken = assemblePodcastChapters("ki", products, {
    chapters: [{ id: "s13", sentences: ["iPhone, iShares und iRobot bleiben Produkte."] }],
  }).map(c => c.spoken).join(" ");
  assert.match(productSpoken, /iPhone/);
  assert.match(productSpoken, /iShares/);
  assert.match(productSpoken, /iRobot/);
  ok("eBay, iPhone, iShares und iRobot bleiben im Satz, der Code-Einstieg steht zuerst");

  const mmm = listed("MMM", "3M Company");
  const mmmStart = assemblePodcastChapters("pdf", mmm, null).find(c => c.id === "einstieg")?.spoken ?? "";
  assert.match(mmmStart, /MMM, 3M Company/);
  assert.equal(/drei Millionen/.test(mmmStart), false, mmmStart);
  ok("3M bleibt der Firmenname und wird nicht zu drei Millionen");

  for (const [ticker, company] of [["7203.T", "Toyota Motor"], ["005930.KS", "Samsung Electronics"]] as const) {
    const built = listed(ticker, company);
    assert.equal(built.values.ticker, null);
    const spoken = assemblePodcastChapters("pdf", built, null).map(c => c.spoken).join(" ");
    assert.match(spoken, new RegExp(company));
    assert.equal(spoken.includes(ticker), false, spoken);
    assert.equal(/siebentausend|fünftausend|7203|005930/.test(spoken), false, spoken);
  }
  ok("Numerische Ticker werden nicht gesprochen, nur der Firmenname");

  const nvda = listed("NVDA", "NVIDIA", { keyProjects: ["H100", "B200"] });
  const nvdaPdf = assemblePodcastChapters("pdf", nvda, {
    chapters: [
      { id: "einstieg", sentences: ["Wir schauen auf ein Schwergewicht."] },
      { id: "s13", sentences: ["NVIDIA nutzt H100, B200, Q4, Microsoft 365 und den S&P 500."] },
    ],
  });
  const nvdaStart = nvdaPdf.find(c => c.id === "einstieg")?.spoken ?? "";
  assert.match(nvdaStart, /NVDA, NVIDIA/);
  assert.match(nvdaStart, /Stand vom/);
  assert.match(nvdaStart, /Der Kurs steht bei/);
  assert.match(nvdaStart, /Wir schauen auf ein Schwergewicht/);
  assert.ok(nvdaStart.indexOf("NVDA, NVIDIA") < nvdaStart.indexOf("Schwergewicht"));
  const nvdaMoat = nvdaPdf.find(c => c.id === "s13")?.spoken ?? "";
  assert.match(nvdaMoat, /H100/);
  assert.match(nvdaMoat, /B200/);
  assert.match(nvdaMoat, /Quartal vier/);
  assert.match(nvdaMoat, /Microsoft 365/);
  assert.match(nvdaMoat, /S&P 500/);
  assert.equal(/\bQ4\b/.test(nvdaMoat), false);
  ok("NVDA-Einstieg behält den Code-Satz vor dem Modell, H100 und Q4 bleiben sprechbar");

  const risk = listed("NVDA", "NVIDIA", { risks: [{ name: "Export controls" }] });
  const withGerman = assemblePodcastChapters("ki", risk, {
    chapters: [{ id: "inversion", sentences: ["Export controls.", "Das Exportkontroll-Risiko bleibt der Gegenpol."] }],
  }).find(c => c.id === "inversion")?.spoken ?? "";
  assert.match(withGerman, /Das Exportkontroll-Risiko bleibt der Gegenpol/);
  assert.equal(/Risiko: Export controls/.test(withGerman), false, withGerman);
  const fallback = assemblePodcastChapters("ki", risk, null).find(c => c.id === "inversion")?.spoken ?? "";
  assert.match(fallback, /Risiko: Export controls/);
  ok("Deutscher Inversionssatz ersetzt den englischen Risiko-Fallback");

  console.log(`ki-podcast names: ${n} checks ok`);
}

main();
