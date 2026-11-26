/**
 * Eigennamen und Ticker bleiben beim Normalisieren heil.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-names.ts
 */
import assert from "node:assert/strict";
import { buildPodcastFacts } from "../shared/podcast-facts";
import { assemblePodcastChapters, buildPodcastLlmPrompt, checkPodcastSentence } from "../shared/podcast-script";
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
  assert.equal(speakNormalize("NVIDIA nutzt H100, B200, GB200, A17 und Q4."), "NVIDIA nutzt H100, B200, GB200, A17 und Quartal vier.");
  assert.equal(speakNormalize("Microsoft 365 und der S&P 500 bleiben."), "Microsoft 365 und der S&P 500 bleiben.");
  const rejected = [
    "Der Umsatz liegt bei 30Mrd.",
    "Das Ziel ist USD500.",
    "Das Kursziel liegt bei EUR250.",
    "Bis FY27.",
    "Die Marge steigt um 5x.",
    "NVIDIA2025 wächst stark.",
    "Blackwell Q3 2025 ramp +40% to 30B.",
  ];
  for (const sentence of rejected) assert.equal(speakNormalize(sentence), null, sentence);
  ok("Produkt-Tokens bleiben, 30Mrd, USD500, FY27, 5x und 30B fallen");

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

  const blocked = listed("NVDA", "NVIDIA", {
    catalysts: [{ name: "Blackwell Q3 2025 ramp +40% to 30B", nettoUpside: 12.5 }],
  });
  for (const sentence of rejected) {
    assert.equal(checkPodcastSentence(sentence, blocked, "s17", "model").ok, false, sentence);
  }
  const blockedSpoken = assemblePodcastChapters("ki", blocked, {
    chapters: [{ id: "s17", sentences: rejected }],
  }).map(c => c.spoken).join(" ");
  assert.equal(/30Mrd|USD500|EUR250|\bFY27\b|5x|NVIDIA2025/.test(blockedSpoken), false, blockedSpoken);
  assert.match(blockedSpoken, /Katalysator Blackwell Q3 2025 ramp \+40% to 30B: Der Netto-Upside liegt bei/);
  ok("Die sieben Modellsätze mit Zahl, Einheit oder Währung kommen nicht ins Audio");

  const kept = "NVIDIA nutzt H100, B200, GB200, A17, Microsoft 365 und den S&P 500 im Quartal Q4.";
  assert.equal(checkPodcastSentence(kept, blocked, "s13", "model").ok, true);
  const keptSpoken = assemblePodcastChapters("ki", blocked, {
    chapters: [{ id: "s13", sentences: [kept] }],
  }).find(c => c.id === "s13")?.spoken ?? "";
  for (const token of ["H100", "B200", "GB200", "A17", "Microsoft 365", "S&P 500", "Quartal vier"]) {
    assert.match(keptSpoken, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  ok("H100, B200, GB200, A17, Microsoft 365 und S&P 500 bleiben, Q4 wird Quartal vier");

  const risk = listed("NVDA", "NVIDIA", { risks: [{ name: "Export controls" }] });
  const withGerman = assemblePodcastChapters("ki", risk, {
    chapters: [{ id: "inversion", sentences: ["Export controls.", "Das Exportkontroll-Risiko bleibt der Gegenpol."] }],
  }).find(c => c.id === "inversion")?.spoken ?? "";
  assert.match(withGerman, /Das Exportkontroll-Risiko bleibt der Gegenpol/);
  assert.equal(/Risiko: Export controls/.test(withGerman), false, withGerman);
  const fallback = assemblePodcastChapters("ki", risk, null).find(c => c.id === "inversion")?.spoken ?? "";
  assert.match(fallback, /Risiko: Export controls/);
  ok("Deutscher Inversionssatz ersetzt den englischen Risiko-Fallback");

  const toyota = listed("7203.T", "7203.T", {
    sector: "Consumer Cyclical",
    industry: "Auto Manufacturers",
    crv: -0.2,
    newsItems: [{ title: "Output update", pubDate: "2026-11-19T00:00:00.000Z" }],
    catalysts: [{ name: "Hybrid demand", nettoUpside: 4 }],
    growthThesis: "Hybride bleiben der Kern.",
    lastReportedQuarter: "2026-11-17",
    nextEarningsDate: "2027-02-10",
  });
  assert.equal(toyota.values.ticker, null);
  assert.equal(toyota.values.company, "das Unternehmen");
  assert.equal(toyota.silentTicker, "7203.T");
  const toyotaModel = {
    chapters: [
      { id: "einstieg", sentences: ["7203.Ts liefert weiter."] },
      { id: "s13", sentences: ["7203.Ts liefert weiter.", "Die jüngste Meldung stammt von vor sieben Tagen."] },
      { id: "s17", sentences: ["7203.T im Jahr 2025 und 2026."] },
      { id: "news-llm", sentences: ["Die jüngste Meldung stammt von vor sieben Tagen."] },
      { id: "these", sentences: ["Eine Investmentthese liegt vor."] },
      { id: "inversion", sentences: ["IRA-Subventionen für Stahlproduktion und Grünstahl bleiben der Kontext."] },
    ],
  };
  const toyotaSpoken = [
    ...assemblePodcastChapters("pdf", toyota, toyotaModel),
    ...assemblePodcastChapters("ki", toyota, toyotaModel),
  ].map(c => c.spoken).join(" ");
  assert.equal(/7203|siebentausend/.test(toyotaSpoken), false, toyotaSpoken);
  assert.match(toyotaSpoken, /das Unternehmen/);
  assert.match(toyotaSpoken, /Katalysator Hybrid demand: Der Netto-Upside liegt bei/);
  const toyotaNews = assemblePodcastChapters("ki", toyota, toyotaModel).find(c => c.id === "news-llm")?.spoken ?? "";
  assert.equal((toyotaNews.match(/Die jüngste Meldung stammt von vor sieben Tagen/g) ?? []).length, 1, toyotaNews);
  assert.equal(/Eine Investmentthese liegt vor|zuletzt gemeldete Quartal liegt vor/.test(toyotaSpoken), false);
  const toyotaPrompt = buildPodcastLlmPrompt("ki", toyota);
  assert.match(toyotaPrompt.prompt, /Firma: das Unternehmen/);
  assert.match(toyotaPrompt.prompt, /Sektor: Consumer Cyclical/);
  assert.match(toyotaPrompt.prompt, /Branche: Auto Manufacturers/);
  assert.equal(toyotaPrompt.prompt.includes("7203"), false);
  const named = listed("7203.T", "Toyota Motor Corporation", { sector: "Consumer Cyclical", industry: "Auto Manufacturers" });
  assert.match(assemblePodcastChapters("pdf", named, null).map(c => c.spoken).join(" "), /Toyota Motor Corporation/);
  ok("7203.T ohne Profilname heißt das Unternehmen und der Kürzel wird nicht gesprochen");

  const mmmCrv = listed("MMM", "3M Company", { crv: -0.312, dcfFairValue: 90, maxEntryCrv3: 110 });
  assert.equal(checkPodcastSentence("Das Forward-KGV von {crv}x bleibt offen.", mmmCrv, "dcf", "model").ok, false);
  assert.equal(checkPodcastSentence("Der Kapitalwert-Rendite-Multiplikator liegt bei {crv}.", mmmCrv, "dcf", "model").ok, false);
  const mmmDcf = assemblePodcastChapters("pdf", mmmCrv, {
    chapters: [{ id: "dcf", sentences: ["Das Forward-KGV von {crv}x bleibt offen."] }],
  }).find(c => c.id === "dcf")?.spoken ?? "";
  assert.match(mmmDcf, /Das Chance-Risiko-Verhältnis liegt bei/);
  assert.equal(/zweix|Forward-KGV|Kapitalwert-Rendite|\bx\b/.test(mmmDcf), false, mmmDcf);
  ok("CRV steht nur im Code-Satz und ohne x");

  const ebayInc = listed("EBAY", "eBay Inc.");
  const ebaySpoken = assemblePodcastChapters("pdf", ebayInc, {
    chapters: [{ id: "einstieg", sentences: ["eBay Inc.s Marktplatz bleibt offen."] }],
  }).map(c => c.spoken).join(" ");
  assert.match(ebaySpoken, /eBay Inc\./);
  assert.equal(/Inc\.\./.test(ebaySpoken), false, ebaySpoken);
  assert.equal(/eBay Inc\.s/.test(ebaySpoken), false, ebaySpoken);
  const nvoName = listed("NVO", "Novo Nordisk A/S");
  const nvoSpoken = assemblePodcastChapters("ki", nvoName, {
    chapters: [{ id: "s13", sentences: ["Novo Nordisk A/Ss Pipeline bleibt der Kern."] }],
  }).map(c => c.spoken).join(" ");
  assert.match(nvoSpoken, /Novo Nordisk A\/S /);
  assert.equal(/A\/Ss/.test(nvoSpoken), false, nvoSpoken);
  ok("Namen behalten keinen Genitiv-s und keinen doppelten Punkt");

  for (const packFacts of [toyota, mmmCrv, ebayInc, nvoName, named]) {
    const chapters = assemblePodcastChapters("pdf", packFacts, null);
    const spoken = chapters.map(c => c.spoken).join(" ");
    for (const chapter of chapters) {
      const sentences = chapter.spoken.split(/(?<=[.!?])\s+/).filter(Boolean);
      assert.equal(new Set(sentences).size, sentences.length, `${chapter.id}: ${chapter.spoken}`);
    }
    if (packFacts.silentTicker) assert.equal(spoken.includes(packFacts.silentTicker), false);
    assert.equal(/(?<!nicht )liegt vor\./.test(spoken), false, spoken);
  }
  ok("Echte Pack-Form: kein numerischer Ticker, kein leeres liegt vor, kein doppelter Satz");

  console.log(`ki-podcast names: ${n} checks ok`);
}

main();
