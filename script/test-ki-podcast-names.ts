/**
 * Eigennamen und Ticker bleiben beim Normalisieren heil.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-names.ts
 */
import assert from "node:assert/strict";
import { buildPodcastFacts } from "../shared/podcast-facts";
import { assemblePodcastChapters, buildPodcastLlmPrompt, checkPodcastSentence, mergeProofread, tidySurface } from "../shared/podcast-script";
import { speakNormalize } from "../shared/podcast-speak";
import { resolvePodcastCompanyName, type FullAiPack } from "../server/stock-podcast-full-ai";
import { clearYahooCache, noteYahooChartCompanyName } from "../server/yahoo-fetcher";

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

async function main() {
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
  assert.match(blockedSpoken, /Der erste Katalysator: Der Netto-Upside liegt bei/);
  assert.equal(/Blackwell|30B|Phase-3/.test(blockedSpoken), false, blockedSpoken);
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
  assert.equal(/Das erste Risiko|Export controls/.test(fallback), false, fallback);
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
  assert.equal(toyota.values.company, null);
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
  assert.equal(/das Unternehmen|von das/.test(toyotaSpoken), false, toyotaSpoken);
  assert.match(toyotaSpoken, /Der erste Katalysator: Der Netto-Upside liegt bei/);
  assert.equal(/Hybrid demand/.test(toyotaSpoken), false, toyotaSpoken);
  const toyotaNews = assemblePodcastChapters("ki", toyota, toyotaModel).find(c => c.id === "news-llm")?.spoken ?? "";
  assert.equal((toyotaNews.match(/Die jüngste Meldung stammt von vor sieben Tagen/g) ?? []).length, 1, toyotaNews);
  assert.equal(/Eine Investmentthese liegt vor|zuletzt gemeldete Quartal liegt vor/.test(toyotaSpoken), false);
  const toyotaPrompt = buildPodcastLlmPrompt("ki", toyota);
  assert.match(toyotaPrompt.prompt, /Eine Firma ist nicht bekannt/);
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

  clearYahooCache();
  const unknown = { companyName: "7203.T", ticker: "7203.T", dataSource: "yahoo" };
  noteYahooChartCompanyName("7203.T", { longName: "Toyota Motor Corporation", currency: "JPY" });
  const resolved = resolvePodcastCompanyName(unknown, "7203.T");
  assert.equal(resolved.name, "Toyota Motor Corporation");
  assert.equal(resolved.source, "yahoo-chart");
  assert.equal(unknown.companyName, "7203.T");
  const knownName = resolvePodcastCompanyName({ companyName: "NVIDIA Corporation" }, "NVDA");
  assert.equal(knownName.source, "analysis");
  assert.equal(knownName.name, "NVIDIA Corporation");
  clearYahooCache();
  const missing = resolvePodcastCompanyName({ companyName: "7203.T", dataSource: "yahoo" }, "7203.T");
  assert.equal(missing.name, null);
  assert.equal(missing.source, "missing");
  noteYahooChartCompanyName("TM", { longName: "Toyota Motor Corporation", currency: "USD" });
  const adr = resolvePodcastCompanyName({ companyName: "7203.T", adrSource: { fmpSymbol: "TM" } }, "7203.T");
  assert.equal(adr.name, "Toyota Motor Corporation");
  assert.equal(adr.source, "yahoo-chart");
  clearYahooCache();
  ok("Podcast-Pfad liest den Namen aus der Chart-Meta und ruft fmpProfile nicht erneut");

  const sameDay = facts({
    ticker: "NVDA",
    companyName: "NVIDIA",
    dataTimestamp: "2026-11-26T10:00:00.000Z",
    newsItems: [{ title: "Same day note", pubDate: "2026-11-26T13:00:00.000Z" }],
    currentPrice: 100,
    currency: "USD",
  });
  assert.equal(sameDay.values.news_age, "heute");
  ok("Meldungsalter rechnet gegen dataTimestamp, derselbe Madrid-Tag bleibt heute");

  const bare = listed("NVDA", "NVDA", {
    sector: "Technology",
    industry: "Semiconductors",
    growthThesis: "",
    newsItems: [{ title: "Chip update", pubDate: "2026-11-26T08:00:00.000Z" }],
    catalysts: [
      { name: "Phase-3 readout & Marktstart", nettoUpside: 4 },
      { name: "Expansion +27%", nettoUpside: 5 },
      { name: "GLP-1", nettoUpside: 6 },
    ],
    risks: [
      { name: "US Core Business Margin Recovery Stalls Permanently" },
      { name: "(Lexus 2027)" },
      { name: "(Mirai Gen3)" },
      { name: "bZ4X" },
      { name: "Omniverse Enterprise Monetization" },
      { name: "Hydrogen Fuel-Cell Expansion" },
    ],
  });
  assert.equal(bare.values.company, null);
  assert.equal(bare.values.ampel, null);
  const liveModel = {
    labels: {
      "Katalysator 1": "Phase drei und Marktstart",
      "Katalysator 2": "Expansion +27%",
      "Katalysator 3": "GLP-eins",
      "Risiko 1": "US Core Business Margin Recovery Stalls Permanently",
      "Risiko 2": "(Lexus 2027)",
      "Risiko 3": "Der Mirai-Nachfolger",
    },
    chapters: [
      { id: "einstieg", sentences: ["NVDA, das Unternehmen.", "das Unternehmen. Stand vom heute.", "Die Ampel liegt nicht vor.", "Die jüngste Meldung stammt von von heute."] },
      { id: "s14", sentences: ["durch drei Hauptkatalyse getrieben."] },
      { id: "s17", sentences: ["durch drei Hauptkatalyse getrieben."] },
      { id: "these", sentences: ["Die Angabe liegt nicht vor."] },
      { id: "s13", sentences: ["Im Jahr 2025 liefert NVIDIA weiter.", "von das Unternehmen bleibt der Kern.", "das Unternehmen konkurriert mit dem Feld.", "das Unternehmen genießt einen Vorsprung."] },
      { id: "inversion", sentences: ["US Core Business Margin Recovery Stalls Permanently."] },
      { id: "news-llm", sentences: ["Die jüngste Meldung stammt von heute.", "Die jüngste Meldung stammt von von heute."] },
    ],
  };
  const live = assemblePodcastChapters("pdf", bare, liveModel);
  const liveSpoken = live.map(c => c.spoken).join(" ");
  assert.equal(live.find(c => c.id === "these"), undefined, liveSpoken);
  assert.equal(/Die Ampel liegt nicht vor|Die Angabe liegt nicht vor|NVDA, das Unternehmen|von das|von von|das Unternehmen konkurriert|das Unternehmen genießt|Stahlzölle|grünen Stahl|Stahlindustrie|Hauptkatalyse|Phase-3|&|Expansion \+|Lexus|Mirai Gen|bZ4X|Omniverse|Hydrogen|US Core Business/.test(liveSpoken), false, liveSpoken);
  assert.equal(/Phase drei und Marktstart|GLP-eins|Expansion/.test(liveSpoken), false, liveSpoken);
  assert.match(liveSpoken, /Der erste Katalysator/);
  assert.match(liveSpoken, /Der zweite Katalysator/);
  assert.match(liveSpoken, /Der dritte Katalysator/);
  assert.equal(/Das erste Risiko/.test(liveSpoken), false, liveSpoken);
  assert.equal(/Der Mirai-Nachfolger/.test(liveSpoken), false, liveSpoken);
  assert.match(liveSpoken, /zweitausendfünfundzwanzig/);
  assert.ok(live.dropped.total > 0);
  assert.ok((live.dropped.byReason.Rohtext ?? 0) > 0);
  assert.equal(JSON.stringify(live.dropped).includes("Phase-3"), false);
  const liveNews = live.find(c => c.id === "news")?.spoken ?? "";
  assert.equal((liveNews.match(/Die jüngste Meldung stammt von/g) ?? []).length, 1, liveNews);
  assert.equal(/jüngste Meldung/.test(live.find(c => c.id === "einstieg")?.spoken ?? ""), false);
  const barePrompt = buildPodcastLlmPrompt("ki", bare);
  assert.match(barePrompt.prompt, /Rate keine Firma und keine Branche/);
  assert.equal(/Stahlzölle|fördert grünen Stahl|Südkoreas Stahlindustrie/.test(barePrompt.prompt), false);
  ok("Live-Strings aus dem Retest fallen, deutsche Labels und das Jahr bleiben");

  const apple = listed("AAPL", "Apple Inc.", { keyProjects: ["iPhone", "Mac", "Service"] });
  const appleSpoken = assemblePodcastChapters("ki", apple, {
    chapters: [{ id: "s13", sentences: ["Apple Inc.s Ökosystem bleibt der Kern.", "Die iPhones, Macs und Services bleiben."] }],
  }).map(c => c.spoken).join(" ");
  assert.match(appleSpoken, /Das Ökosystem von Apple Inc\./);
  assert.equal(/(?<![A-Za-zÄÖÜäöü])s Ökosystem|Inc\.s/.test(appleSpoken), false, appleSpoken);
  assert.match(appleSpoken, /iPhones/);
  assert.match(appleSpoken, /Macs/);
  assert.match(appleSpoken, /Services/);
  const longName = listed("7203.T", "Toyota Motor Corporation");
  const longSpoken = assemblePodcastChapters("ki", longName, {
    chapters: [
      { id: "einstieg", sentences: ["Toyota Motor Corporation bleibt der Hybridhersteller."] },
      { id: "s13", sentences: ["Toyota Motor Corporation bleibt der Hybridhersteller im Kerngeschäft."] },
    ],
  }).map(c => c.spoken).join(" ");
  assert.match(longSpoken, /im Kerngeschäft/);
  ok("Genitiv wird zu von Apple Inc., Plurale bleiben, der lange Name streicht den Folgesatz nicht");

  for (const sentence of [
    "Hohe Margen sichern starke Cashflows.",
    "Starke Nachfrage treibt Umsatz.",
    "Services wachsen weiter.",
  ]) {
    assert.equal(checkPodcastSentence(sentence, listed("AAPL", "Apple"), "s14", "model").ok, true, sentence);
  }
  const appleProducts = listed("AAPL", "Apple", { keyProjects: ["iPhone", "Mac"] });
  assert.equal(checkPodcastSentence("iPhone und Macs bleiben.", appleProducts, "s13", "model").ok, true);
  ok("Deutsche Sätze ohne Markerwort bleiben, Englisch hängt an Stoppwörtern");

  for (const [ticker, company] of [
    ["SPY", "SPDR S&P 500 ETF Trust"],
    ["BRK-B", "Berkshire Hathaway Inc. (Class B)"],
  ] as const) {
    const start = assemblePodcastChapters("pdf", listed(ticker, company), null).find(c => c.id === "einstieg")?.spoken ?? "";
    assert.match(start, new RegExp(company.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), start);
  }
  const quiet = assemblePodcastChapters("pdf", listed("MMM", "3M Company"), null);
  assert.match(quiet.find(c => c.id === "news")?.spoken ?? "", /Im betrachteten Zeitfenster liegen keine Meldungen vor/);
  ok("News-Satz und Namen mit & oder Klammer bleiben im Einstieg");

  const ebayRisk = listed("EBAY", "eBay", { risks: [{ name: "US Core Business Margin Recovery Stalls Permanently" }] });
  const ebayInv = assemblePodcastChapters("ki", ebayRisk, {
    labels: { "Risiko 1": "US Core Business Margin Recovery Stalls Permanently" },
    chapters: [{ id: "inversion", sentences: ["Wettbewerb durch Temu."] }],
  }).find(c => c.id === "inversion")?.spoken ?? "";
  assert.match(ebayInv, /Wettbewerb durch Temu/);
  assert.equal(/Das erste Risiko|US Core Business/.test(ebayInv), false, ebayInv);
  ok("Verworfenes Risiko-Label lässt keinen kahlen Satz stehen");

  const shifted = listed("NVDA", "NVIDIA", {
    catalysts: [
      { name: "Null upside placeholder", nettoUpside: 0 },
      { name: "Blackwell ramp", nettoUpside: 12 },
      { name: "Software suite", nettoUpside: 4 },
    ],
  });
  const shiftedPrompt = buildPodcastLlmPrompt("ki", shifted);
  assert.match(shiftedPrompt.prompt, /Katalysator 1/);
  assert.match(shiftedPrompt.prompt, /Blackwell ramp/);
  assert.equal(/Katalysator 1[\s\S]{0,80}Null upside/.test(shiftedPrompt.prompt), false);
  const shiftedSpoken = assemblePodcastChapters("ki", shifted, {
    labels: { "Katalysator 1": "Blackwell-Hochlauf", "Katalysator 2": "Software-Umsatz", "Null": "Falscher Schlüssel" },
  }).map(c => c.spoken).join(" ");
  assert.match(shiftedSpoken, /Blackwell-Hochlauf: Der Netto-Upside liegt bei/);
  assert.equal(/\bNull\b|Null upside/.test(shiftedSpoken), false, shiftedSpoken);
  ok("Label-Schlüssel folgen den Upside-Katalysatoren, ein 0-Upside in der Mitte verschiebt sie nicht");

  const nvoLabels = listed("NVO", "Novo Nordisk", {
    catalysts: [
      { name: "Phase-3 readout", nettoUpside: 3 },
      { name: "GLP-1", nettoUpside: 2 },
    ],
  });
  const nvoLabelSpoken = assemblePodcastChapters("ki", nvoLabels, {
    labels: {
      "Katalysator 1": "Zulassung von CagriSema in Phase-3",
      "Katalysator 2": "GLP-1 Tablette Wegovy",
    },
  }).map(c => c.spoken).join(" ");
  assert.match(nvoLabelSpoken, /Zulassung von CagriSema in Phase drei/);
  assert.match(nvoLabelSpoken, /GLP-eins Tablette Wegovy/);
  assert.equal(/Phase-3|GLP-1/.test(nvoLabelSpoken), false, nvoLabelSpoken);
  ok("CagriSema in Phase-3 und GLP-1 Tablette Wegovy bleiben als Label");

  const quietNews = assemblePodcastChapters("ki", listed("7203.T", "Toyota Motor Corporation"), null);
  assert.equal(quietNews.find(c => c.id === "news-llm"), undefined);
  assert.equal(/eigene News-Anknüpfung liegt nicht vor/.test(quietNews.map(c => c.spoken).join(" ")), false);
  const quietInv = assemblePodcastChapters("pdf", listed("7203.T", "Toyota Motor Corporation"), null);
  assert.equal(/rechnerische Einstieg liegt nicht vor|Periode des Segments liegt nicht vor/.test(quietInv.map(c => c.spoken).join(" ")), false);
  ok("Sätze der Form liegt nicht vor entfallen, der feste News-Satz bleibt die Ausnahme");

  const mixed = listed("EBAY", "eBay", {
    catalysts: [
      { name: "APAC expansion", nettoUpside: 4 },
      { name: "Marketplaces", nettoUpside: 6 },
    ],
    revenueSegments: [{ name: "Marketplaces", revenue: 10, percentage: 80, fiscalYear: "2026" }],
  });
  const mixedSpoken = assemblePodcastChapters("ki", mixed, {
    labels: { "Katalysator 1": "APAC-", "Katalysator 2": "Marktplatzgeschäft", "Segment 1": "Marketplaces" },
  }).map(c => c.spoken).join(" ");
  assert.equal(/APAC-|Marktplatzgeschäft|Marketplaces/.test(mixedSpoken), false, mixedSpoken);
  assert.match(mixedSpoken, /Der erste Katalysator/);
  assert.match(mixedSpoken, /Der zweite Katalysator/);
  assert.match(mixedSpoken, /Das größte Segment/);
  const blackwell = listed("NVDA", "NVIDIA", {
    catalysts: [
      { name: "Software", nettoUpside: 4 },
      { name: "Blackwell ramp", nettoUpside: 10.6 },
    ],
  });
  const blackwellChapters = assemblePodcastChapters("ki", blackwell, {
    labels: { "Katalysator 1": "Softwareumsatz", "Katalysator 2": "Blackwell-Hochlauf" },
  });
  const blackwellSpoken = blackwellChapters.map(c => c.spoken).join(" ");
  assert.match(blackwellSpoken, /Blackwell-Hochlauf: Der Netto-Upside liegt bei/);
  assert.equal(blackwellChapters.dropped.byReason["Label englisch"] ?? 0, 0);
  const rawSegments = ["GLP-1 Diabetes (Ozempic/Rybelsus)", "Safety & Industrial Segment", "Data Center"];
  for (const name of rawSegments) {
    const spoken = assemblePodcastChapters("pdf", listed("TEST", "Firma", {
      revenueSegments: [{ name, revenue: 10, percentage: 40, fiscalYear: "2026" }],
    }), { labels: { "Segment 1": name } }).map(c => c.spoken).join(" ");
    assert.equal(spoken.includes(name), false, spoken);
    assert.match(spoken, /Das größte Segment/);
  }
  ok("Abgeschnittene Labels schalten das ganze Kapitel auf Ordinale, Blackwell-Hochlauf bleibt");

  assert.equal(tidySurface("eBay's Marktplatz und eBay’s Gebühren."), "eBays Marktplatz und eBays Gebühren.");
  assert.equal(tidySurface("Schlüsselkatalysa\u00ADtoren"), "Schlüsselkatalysatoren");
  const source = { chapters: [{ id: "s13", sentences: ["US-Zölle auf japanische Stahl und {fy_yoy}."] }] };
  const proofKept = mergeProofread(source, { sentences: [{ id: "s13:0", text: "US-Zölle auf japanischen Stahl und {fy_yoy} bleiben." }] });
  const droppedEdit = mergeProofread(source, { sentences: [{ id: "s13:0", text: "US-Zölle auf japanischen Stahl." }] });
  assert.match(JSON.stringify(proofKept), /japanischen Stahl und \{fy_yoy\}/);
  assert.match(JSON.stringify(droppedEdit), /japanische Stahl und \{fy_yoy\}/);
  ok("Lektorat behält die Platzhalter, Apostroph-s und weiche Trennstriche fallen deterministisch");

  const summaryPack = assemblePodcastChapters("pdf", listed("NVO", "Novo Nordisk", {
    growthThesis: "Abnehmmittel tragen das Wachstum.",
    s17Verdict: "Grün",
    revenueSegments: [{ name: "Diabetes", revenue: 8, percentage: 70, fiscalYear: "2026" }],
  }), { labels: { "Segment 1": "Diabetesmittel" } });
  const summary = summaryPack.find(c => c.id === "zusammenfassung")?.spoken ?? "";
  const umsatz = summaryPack.find(c => c.id === "umsatz")?.spoken ?? "";
  assert.equal(summary.startsWith("Der Kurs steht bei"), false, summary);
  assert.match(summary, /Ampel steht auf/);
  assert.match(summary, /Abnehmmittel tragen das Wachstum/);
  assert.equal(/Diabetesmittel/.test(summary), false, summary);
  assert.match(umsatz, /Diabetesmittel hat einen Anteil/);
  const context = buildPodcastLlmPrompt("ki", listed("NVDA", "NVIDIA", { growthThesis: "Die Nachfrage bleibt hoch." })).prompt;
  assert.equal(/fcfMargin|growthThesis|nettoUpside|moatImpact/.test(context), false, context);
  ok("Zusammenfassung nennt These und Ampel, das Segment nur im Umsatz, der Kontext nennt keine Feldnamen");

  const germanTitles = listed("NVDA", "NVIDIA", {
    catalysts: [
      { name: "Rubin-Plattform", nettoUpside: 5.2 },
      { name: "Blackwell-Hochlauf", nettoUpside: 10.6 },
      { name: "Souveräne KI", nettoUpside: 3.1 },
    ],
    risks: [{ name: "Preisregulierung" }, { name: "Lilly-Wettbewerb" }],
  });
  const germanSpoken = assemblePodcastChapters("ki", germanTitles, {
    labels: {
      "Katalysator 1": "Rubin-Plattform",
      "Katalysator 2": "Blackwell-Hochlauf",
      "Katalysator 3": "Souveräne KI",
      "Risiko 1": "Preisregulierung",
      "Risiko 2": "Lilly-Wettbewerb",
    },
  }).map(c => c.spoken).join(" ");
  assert.match(germanSpoken, /Rubin-Plattform: Der Netto-Upside liegt bei/);
  assert.match(germanSpoken, /Blackwell-Hochlauf: Der Netto-Upside liegt bei/);
  assert.match(germanSpoken, /Souveräne KI: Der Netto-Upside liegt bei/);
  assert.match(germanSpoken, /Die genannten Risiken sind Preisregulierung und Lilly-Wettbewerb/);
  assert.equal(/(?:^|\. )Preisregulierung\.|(?:^|\. )Lilly-Wettbewerb\./.test(germanSpoken), false, germanSpoken);
  for (const english of ["Data Center", "Marketplaces"]) {
    const spoken = assemblePodcastChapters("pdf", listed("TEST", "Firma", {
      revenueSegments: [{ name: english, revenue: 4, percentage: 40, fiscalYear: "2026" }],
    }), { labels: { "Segment 1": english } }).map(c => c.spoken).join(" ");
    assert.equal(spoken.includes(english), false, spoken);
    assert.match(spoken, /Das größte Segment/);
  }
  const englishThesis = assemblePodcastChapters("pdf", listed("NVO", "Novo Nordisk", {
    growthThesis: "The company is well positioned for growth in 2027 with 20% margin.",
  }), null).find(c => c.id === "zusammenfassung")?.spoken ?? "";
  assert.equal(/well positioned|2027|20%/.test(englishThesis), false, englishThesis);
  const invented = mergeProofread(
    { chapters: [{ id: "s13", sentences: ["Novo Nordisk bleibt der Spezialist für Abnehmmittel."] }] },
    { sentences: [{ id: "s13:0", text: "Toyota hat starke Patente und Apple kauft Novo Nordisk." }] },
  );
  assert.match(JSON.stringify(invented), /Novo Nordisk bleibt der Spezialist für Abnehmmittel/);
  assert.equal(JSON.stringify(invented).includes("Toyota"), false);
  const porter = buildPodcastLlmPrompt("ki", facts({
    ticker: "NVDA", companyName: "NVIDIA",
    moatAssessment: { porterForces: [{ force: "Rivalität", summary: "Der Wettbewerb bleibt hoch." }] },
  })).prompt;
  assert.match(porter, /Porter Rivalität:/);
  const regulated = buildPodcastFacts({
    ...pack({ ticker: "NVO", companyName: "Novo Nordisk" }),
    regulatory: {
      ticker: "NVO",
      exposures: [{
        title: "Preisregulierung",
        description: "Erstattungsregeln drücken die Marge.",
        regulationAxis: "price_regulation",
        timeHorizon: "0-12m",
        source: { url: "https://example.test/rule", publishedAt: "2026-01-01", snippet: "x" },
      }],
      gate: { id: "REGULATORY_EXPOSURE", rationale: "Materielles Risiko bei der Erstattung." },
    },
  } as FullAiPack);
  const regPrompt = buildPodcastLlmPrompt("ki", regulated).prompt;
  assert.match(regPrompt, /Erstattungsregeln drücken die Marge/);
  assert.match(regPrompt, /Materielles Risiko bei der Erstattung/);
  assert.equal(/price_regulation|REGULATORY_EXPOSURE|example\.test|0-12m|…-…m/.test(regPrompt), false, regPrompt);
  ok("Deutsche Quelltitel bleiben, die These und das Lektorat prüfen den Inhalt, Regulierung bleibt deutscher Text");

  console.log(`ki-podcast names: ${n} checks ok`);
}

main();
