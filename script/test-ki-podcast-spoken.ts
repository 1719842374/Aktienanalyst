/**
 * Retest 3954599e: Rohtext aus Payload-Titeln, kahle Kennzahlen, News-Alter, Meldedatum.
 * Der gesprochene Endtext aller Kapitel darf keine Ziffer, kein <, >, % und kein camelCase enthalten.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-spoken.ts
 */
import assert from "node:assert/strict";
import type { EarningsCallBrief } from "../shared/chat-earnings";
import { buildPodcastFacts, type PodcastFacts } from "../shared/podcast-facts";
import { assemblePodcastChapters, buildPodcastLlmPrompt, checkPodcastSentence } from "../shared/podcast-script";
import { speakNewsAge, speakNormalize, spokenStillRaw } from "../shared/podcast-speak";
import type { FullAiPack } from "../server/stock-podcast-full-ai";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

const NVO_TITLE = "GLP-1 Phase-3 Efficacy Miss <25% Weight Loss FDA Rejection 2025 Delays 2026";
const MSFT_TITLE = "Copilot verfehlt 2025 das Ziel unter 5M Seats";
const NVDA_NEWS = "Prediction for 2027.";

const IST_SENTENCES = [
  `${NVO_TITLE}.`,
  `${MSFT_TITLE}.`,
  NVDA_NEWS,
  "Der gewichtete Netto-Upside zum Gesamtpotenzial bleibt offen.",
  "RevWachstum und FCF-Marge bleiben ohne Zahl.",
  "Die Scope Emissionen bleiben unklar.",
  "Die GLP-Technologie trägt das Bild.",
  "Der Markt wartet nur noch auf diesen Kurs als primären Treiber.",
  "Die Meldung ist weniger als einem Tag alt.",
  "Quartal zum siebzehnten November.",
];

function pack(analysis: Record<string, unknown>, extra: Partial<FullAiPack> = {}): FullAiPack {
  return {
    ticker: String(analysis.ticker ?? "MSFT"),
    day: "2026-11-26",
    generatedAt: "2026-11-26T12:00:00.000Z",
    analysis,
    pestelLlm: null,
    management: null,
    managementInterpret: null,
    earningsBrief: extra.earningsBrief ?? null,
    regulatory: null,
    thesisStrength: null,
    policyContext: null,
    timedOut: [],
    sections: {
      analyze: true, pestelLlm: false, policyContext: false, management: false,
      managementInterpret: false, earningsBrief: extra.earningsBrief != null, regulatory: false, thesisStrength: false,
    },
    ...extra,
  };
}

function factsOf(analysis: Record<string, unknown>, extra: Partial<FullAiPack> = {}): PodcastFacts {
  return buildPodcastFacts(pack(analysis, extra), new Date("2026-11-26T12:00:00.000Z"));
}

const brief = (symbol: string): EarningsCallBrief => ({
  symbol,
  status: "ok",
  reason: null,
  year: 2026,
  quarter: 3,
  date: "2026-11-17",
  summary: null,
  excerpt: "Das Management spricht über die Nachfrage.",
  excerptTruncated: false,
  source: "test",
});

function base(ticker: string, company: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker,
    companyName: company,
    currentPrice: ticker === "MSFT" ? 489.93 : ticker === "NVDA" ? 149.3 : 90,
    currency: "USD",
    catalystsSource: "llm",
    llmMode: true,
    dataTimestamp: "2026-11-26T12:00:00.000Z",
    growthThesisGeneratedAt: "2026-11-26T12:00:00.000Z",
    financialStatements: { incomeStatement: { revenue: 40e9, revenueGrowth: 17.8 } },
    _podcastInternals: { revenueY1: 30e9, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
    dcfFairValue: ticker === "MSFT" ? 305 : 120,
    maxEntryCrv3: ticker === "MSFT" ? 346 : 80,
    fcfMargin: 28.4,
    catalysts: [{ name: "Nachfrage", nettoUpside: 12.5 }],
    ...extras,
  };
}

function badModel(newsTitle: string) {
  return {
    chapters: [
      { id: "inversion", sentences: [`${NVO_TITLE}.`, `${MSFT_TITLE}.`] },
      { id: "s17", sentences: ["Der gewichtete Netto-Upside zum Gesamtpotenzial bleibt offen."] },
      { id: "s14", sentences: ["RevWachstum und FCF-Marge bleiben ohne Zahl.", "Die Scope Emissionen bleiben unklar.", "Die GLP-Technologie trägt das Bild."] },
      { id: "news-llm", sentences: [newsTitle, "Die Meldung ist weniger als einem Tag alt.", "Der Markt wartet nur noch auf diesen Kurs als primären Treiber."] },
      { id: "news", sentences: [newsTitle] },
      { id: "earnings", sentences: ["Das Umsatzwachstum im Geschäftsjahr {gj_year} beträgt {fy_yoy}.", "Quartal zum siebzehnten November."] },
      { id: "einstieg", sentences: ["{ticker}, {company}."] },
    ],
  };
}

function assertClean(label: string, spoken: string) {
  assert.equal(spokenStillRaw(spoken), false, `${label}: ${spoken}`);
  assert.equal(/[\d<>%]/.test(spoken), false, `${label}: ${spoken}`);
  assert.equal(/\b[a-zäöüß][a-zäöüß0-9]*[A-Z][A-Za-z0-9]*\b/.test(spoken), false, `${label}: ${spoken}`);
}

function main() {
  const nvoNorm = speakNormalize(NVO_TITLE);
  assert.ok(nvoNorm);
  assert.match(nvoNorm, /GLP-eins/);
  assert.match(nvoNorm, /Phase drei/);
  assert.match(nvoNorm, /unter fünfundzwanzig Prozent/);
  assert.match(nvoNorm, /zweitausendfünfundzwanzig/);
  assert.match(nvoNorm, /zweitausendsechsundzwanzig/);
  assert.equal(spokenStillRaw(nvoNorm), false);
  const msftNorm = speakNormalize(MSFT_TITLE);
  assert.ok(msftNorm);
  assert.match(msftNorm, /zweitausendfünfundzwanzig/);
  assert.match(msftNorm, /fünf Millionen/);
  assert.equal(spokenStillRaw(msftNorm), false);
  assert.equal(speakNormalize("Prediction for 2027.")?.includes("2027"), false);
  assert.equal(speakNewsAge(0), "von heute");
  assert.equal(speakNewsAge(1), "von gestern");
  assert.equal(speakNewsAge(3), "von vor drei Tagen");
  ok("speakNormalize macht Ziffern, Prozent, 5M und Bindestrich-Zahlen zu Worten");

  const nvo = factsOf(base("NVO", "Novo Nordisk", {
    risks: [{ name: NVO_TITLE }],
    newsItems: [{ title: "Oral GLP-1 faces FDA Rejection 2025", pubDate: "2026-11-26T08:00:00.000Z" }],
    lastReportedQuarter: "2026-11-17",
  }));
  for (const sentence of IST_SENTENCES) {
    const verdict = checkPodcastSentence(sentence, nvo, "news-llm", "model");
    assert.equal(verdict.ok, false, sentence);
  }
  assert.equal(checkPodcastSentence("Die FCF-Marge liegt bei {fcf_margin}.", nvo, "s14", "model").ok, true);
  assert.equal(checkPodcastSentence("Der Netto-Upside liegt bei {netto_upside_1}.", nvo, "s17", "model").ok, true);
  assert.equal(checkPodcastSentence("Die jüngste Meldung stammt {news_age}.", nvo, "news-llm", "model").ok, true);
  ok("Ist-Sätze fallen, Kennzahlen mit Platzhalter bleiben");

  const nvda = factsOf(base("NVDA", "NVIDIA", {
    newsItems: [{ title: NVDA_NEWS, pubDate: "2026-11-26T09:00:00.000Z" }],
    lastReportedQuarter: "2026-11-17",
    risks: [{ name: "Lieferkette" }],
  }));
  const msft = factsOf(base("MSFT", "Microsoft", {
    risks: [{ name: MSFT_TITLE }],
    newsItems: [{ title: "Azure seats trail the 2026 plan", pubDate: "2026-11-25T12:00:00.000Z" }],
    lastReportedQuarter: "Q3 FY2026",
    nextEarningsDate: "2027-01-27",
  }));
  const fixtures = [
    ["NVO", nvo, "Oral GLP-1 faces FDA Rejection 2025."],
    ["NVDA", nvda, NVDA_NEWS],
    ["MSFT", msft, "Azure seats trail the 2026 plan."],
  ] as const;
  for (const [label, facts, newsTitle] of fixtures) {
    for (const source of ["pdf", "ki"] as const) {
      const chapters = assemblePodcastChapters(source, facts, badModel(newsTitle));
      for (const chapter of chapters) assertClean(`${label} ${source} ${chapter.id}`, chapter.spoken);
    }
  }
  ok("Gesprochener Endtext von NVDA, NVO und MSFT hat keine Ziffer, kein <, >, % und kein camelCase");

  const nvoKi = assemblePodcastChapters("ki", nvo, badModel("Oral GLP-1 faces FDA Rejection 2025."));
  const nvoNews = nvoKi.find(c => c.id === "news-llm")?.spoken ?? "";
  assert.match(nvoNews, /Die jüngste Meldung stammt von heute/);
  assert.equal(/liegt nicht vor|Prediction|Rejection|GLP-1|2025/.test(nvoNews), false, nvoNews);
  assert.equal(/\balt\b|weniger als einem Tag/.test(nvoNews), false, nvoNews);
  const nvoInversion = nvoKi.find(c => c.id === "inversion")?.spoken ?? "";
  assert.match(nvoInversion, /Risiko: GLP-eins Phase drei/);
  assert.equal(/Phase-3|<25%|2025|2026/.test(nvoInversion), false, nvoInversion);
  const nvoS17 = nvoKi.find(c => c.id === "s17")?.spoken ?? "";
  assert.match(nvoS17, /Netto-Upside liegt bei/);
  assert.match(nvoS17, /Prozent/);
  assert.equal(/Gesamtpotenzial|RevWachstum/.test(nvoS17), false);
  const nvoS14 = nvoKi.find(c => c.id === "s14")?.spoken ?? "";
  assert.match(nvoS14, /FCF-Marge liegt bei/);
  assert.equal(/RevWachstum|Scope Emissionen|GLP-Technologie/.test(nvoS14), false);
  ok("NVO spricht normalisierte Risiken, Netto-Upside, FCF-Marge und die vorhandene Meldung");

  const nvdaNews = assemblePodcastChapters("ki", nvda, badModel(NVDA_NEWS)).find(c => c.id === "news-llm")?.spoken ?? "";
  assert.match(nvdaNews, /stammt von heute/);
  assert.equal(/Prediction|2027|primären Treiber|weniger als einem Tag/.test(nvdaNews), false, nvdaNews);
  const msftModel = badModel("Azure seats trail the 2026 plan.");
  const msftNews = assemblePodcastChapters("ki", msft, msftModel).find(c => c.id === "news-llm")?.spoken ?? "";
  assert.match(msftNews, /stammt von gestern/);
  const msftInversion = assemblePodcastChapters("ki", msft, msftModel).find(c => c.id === "inversion")?.spoken ?? "";
  assert.match(msftInversion, /Risiko:/);
  assert.match(msftInversion, /fünf Millionen/);
  assert.equal(/5M|2025/.test(msftInversion), false, msftInversion);
  ok("News-Alter ist von heute oder von gestern, englische Titel bleiben draußen");

  const filing = factsOf(base("NVO", "Novo Nordisk", { lastReportedQuarter: "2026-11-17" }));
  const filingEarnings = assemblePodcastChapters("ki", filing, badModel("Oral GLP-1 faces FDA Rejection 2025.")).find(c => c.id === "earnings")?.spoken ?? "";
  assert.equal(/Das zuletzt gemeldete Quartal liegt vor|Quartal zum|siebzehnten|November/.test(filingEarnings), false, filingEarnings);
  const yoy = filing.values.fy_yoy ?? "";
  assert.ok(yoy.length >= 12);
  assert.equal(filingEarnings.includes(yoy), false, filingEarnings);
  const filingUmsatz = assemblePodcastChapters("ki", filing, badModel("Oral GLP-1 faces FDA Rejection 2025.")).find(c => c.id === "umsatz")?.spoken ?? "";
  assert.equal(filingUmsatz.includes(yoy), true);
  const fiscal = factsOf(base("NVO", "Novo Nordisk", { lastReportedQuarter: "2026-11-17" }), { earningsBrief: brief("NVO") });
  const fiscalEarnings = assemblePodcastChapters("ki", fiscal, null).find(c => c.id === "earnings")?.spoken ?? "";
  assert.match(fiscalEarnings, /Quartal drei im Geschäftsjahr zweitausendsechsundzwanzig/);
  assert.equal(/siebzehnten|November|Quartal zum/.test(fiscalEarnings), false, fiscalEarnings);
  ok("Earnings nutzt das Fiskalquartal oder das zuletzt gemeldete Quartal und wiederholt das Umsatzwachstum nicht");

  const einstieg = assemblePodcastChapters("pdf", msft, null).find(c => c.id === "einstieg")?.spoken ?? "";
  const sentences = einstieg.split(/(?<=[.!?])\s+/).filter(Boolean);
  assert.ok(sentences.length >= 2, einstieg);
  assert.match(einstieg, /Stand vom/);
  assert.match(einstieg, /Der Kurs steht bei/);
  assert.equal(spokenStillRaw(einstieg), false);
  ok("Einstieg nennt bei vorhandenem Kurs mehr als den Stand");

  const prompt = buildPodcastLlmPrompt("ki", nvo);
  assert.match(prompt.systemPrompt, /von heute, von gestern oder von vor drei Tagen/);
  assert.match(prompt.systemPrompt, /Diesen Satz nicht wiederholen/);
  assert.match(prompt.prompt, /nicht vorlesen/);
  assert.equal(prompt.prompt.includes("2025"), false);
  assert.equal(prompt.prompt.includes("<"), false);
  assert.match(prompt.prompt, /\{fcf_margin\}/);
  assert.match(prompt.prompt, /\{netto_upside_1\}/);
  ok("Prompt gibt Titel als Kontext und die Altersphrase als Beispiel");

  console.log(`ki-podcast spoken: ${n} checks ok`);
}

main();
