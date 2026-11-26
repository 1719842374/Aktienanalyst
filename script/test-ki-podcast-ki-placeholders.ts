/**
 * Regression auf die Tester-Form von NVDA und NVO (Quelle ki).
 * Nackte Platzhalter-Namen dürfen im gesprochenen Text nicht vorkommen.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-ki-placeholders.ts
 */
import assert from "node:assert/strict";
import { PODCAST_STAGE_TIMEOUT_MS } from "../shared/podcast-types";
import { buildPodcastFacts } from "../shared/podcast-facts";
import { assemblePodcastChapters, spokenLeaksPlaceholder } from "../shared/podcast-script";
import { keepCompleteSentences } from "../shared/podcast-speak";
import type { FullAiPack } from "../server/stock-podcast-full-ai";
import { handleStockPodcastAudio, handleStockPodcastScript, resetStockPodcastRouteState } from "../server/stock-podcast-route";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

const LEAK = /\b(?:call_date|call_quarter|top_segment_share|fy_yoy|gj_year|news_age|news_1|dcf_fair|dcf_low|dcf_high)\b|\{[a-z0-9_]+\}/;

function pack(partial: { ticker: string; analysis: Record<string, unknown>; pestel?: boolean }): FullAiPack {
  return {
    ticker: partial.ticker,
    day: "2026-11-26",
    generatedAt: "2026-11-26T15:44:57.860Z",
    analysis: partial.analysis,
    pestelLlm: partial.pestel ? [{ dimension: "Ökonomisch", impact: "neutral", score: 0, summary: "Einordnung", keyFactors: [] }] : null,
    management: null,
    managementInterpret: null,
    earningsBrief: null,
    regulatory: null,
    thesisStrength: null,
    policyContext: null,
    timedOut: [],
    sections: {
      analyze: true, pestelLlm: !!partial.pestel, policyContext: false, management: false,
      managementInterpret: false, earningsBrief: false, regulatory: false, thesisStrength: false,
    },
  };
}

function assertNoLeak(label: string, spoken: string) {
  assert.equal(LEAK.test(spoken), false, `${label}: ${spoken}`);
  assert.equal(spokenLeaksPlaceholder(spoken), false, label);
}

function main() {
  const nvda = pack({
    ticker: "NVDA",
    analysis: {
      ticker: "NVDA",
      companyName: "NVIDIA",
      currentPrice: 149.3,
      currency: "USD",
      catalystsSource: "llm",
      llmMode: true,
      growthThesisGeneratedAt: "2026-11-26T15:44:57.860Z",
      dataTimestamp: "2026-11-26T15:44:57.860Z",
      financialStatements: { incomeStatement: { revenue: 130e9, revenueGrowth: 114 } },
      _podcastInternals: { revenueY1: 60e9, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
      dcfFairValue: 120.21,
      impliedGStar: 11.4,
    },
  });
  const nvdaFacts = buildPodcastFacts(nvda);
  const nvdaKi = assemblePodcastChapters("ki", nvdaFacts, {
    chapters: [
      { id: "earnings", sentences: ["Der Call nennt call_date, call_quarter und top_segment_share."] },
      { id: "s14", sentences: ["Die Lage folgt fy_yoy."] },
      { id: "news-llm", sentences: ["Diese Meldung ist relevant. Diese Meld"] },
      { id: "s17", sentences: ["Der Stand ist 2026-11-26T15:44:57.860Z."] },
    ],
  });
  for (const chapter of nvdaKi) assertNoLeak(`NVDA ${chapter.id}`, chapter.spoken);
  const nvdaEarnings = nvdaKi.find(c => c.id === "earnings")?.spoken ?? "";
  assert.match(nvdaEarnings, /liegt nicht vor/);
  assert.equal(nvdaEarnings.includes("call_date"), false);
  const nvdaNews = nvdaKi.find(c => c.id === "news-llm")?.spoken ?? "";
  assert.match(nvdaNews, /Diese Meldung ist relevant/);
  assert.equal(/Diese Meld(?!ung)/.test(nvdaNews), false);
  const nvdaS17 = nvdaKi.find(c => c.id === "s17")?.spoken ?? "";
  assert.equal(nvdaS17.includes("2026-11-26T"), false);
  assert.match(nvdaS17, /sechsundzwanzigsten November/);
  const nvdaUmsatz = nvdaKi.find(c => c.id === "umsatz")?.spoken ?? "";
  assert.match(nvdaUmsatz, /Geschäftsjahr/);
  assert.match(nvdaUmsatz, /zweitausendsechsundzwanzig/);
  assert.equal(/\d/.test(nvdaUmsatz), false);
  assert.equal(nvdaUmsatz.includes("fy_yoy"), false);
  ok("NVDA ki spricht keine nackten Platzhalter, kein ISO-Datum und das Geschäftsjahr");

  const nvo = pack({
    ticker: "NVO",
    pestel: true,
    analysis: {
      ticker: "NVO",
      companyName: "Novo Nordisk",
      currentPrice: 90,
      currency: "USD",
      catalystsSource: "llm",
      dataTimestamp: "2026-11-26T12:00:00.000Z",
      financialStatements: { incomeStatement: { revenue: 40e9, revenueGrowth: 65.5 } },
      _podcastInternals: { revenueY1: 24e9, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
      newsItems: [{ title: "Zulassung", pubDate: "2026-11-20T08:00:00.000Z" }],
    },
  });
  const nvoKi = assemblePodcastChapters("ki", buildPodcastFacts(nvo), {
    chapters: [
      { id: "s14", sentences: ["PESTEL verweist auf fy_yoy."] },
      { id: "earnings", sentences: ["Offen bleiben call_date, call_quarter, gj_year und news_age."] },
      { id: "umsatz", sentences: ["Das Wachstum heisst fy_yoy im Jahr gj_year."] },
    ],
  });
  for (const chapter of nvoKi) assertNoLeak(`NVO ${chapter.id}`, chapter.spoken);
  assert.equal(/fy_yoy|Einordnung vor/.test(nvoKi.find(c => c.id === "s14")?.spoken ?? ""), false);
  assert.match(nvoKi.find(c => c.id === "earnings")?.spoken ?? "", /liegt nicht vor/);
  assert.match(nvoKi.find(c => c.id === "umsatz")?.spoken ?? "", /Geschäftsjahr zweitausendsechsundzwanzig/);
  assert.equal(/\d/.test(nvoKi.find(c => c.id === "umsatz")?.spoken ?? "1"), false);
  ok("NVO ki ersetzt fy_yoy, gj_year, call_date und news_age");

  const pdfWithValue = assemblePodcastChapters("pdf", nvdaFacts, {
    chapters: [{ id: "dcf", sentences: ["Die Bewertung bleibt qualitativ."] }, { id: "zusammenfassung", sentences: ["Kurzüberblick."] }],
  });
  const dcf = pdfWithValue.find(c => c.id === "dcf")?.spoken ?? "";
  const summary = pdfWithValue.find(c => c.id === "zusammenfassung")?.spoken ?? "";
  assert.match(dcf, /einhundertzwanzig/);
  assert.match(summary, /Der Kurs steht bei/);
  assertNoLeak("NVDA pdf dcf", dcf);
  ok("PDF spricht vorhandene DCF- und Kurswerte auch neben einem Modellsatz");

  const empty = pack({
    ticker: "NVDA",
    analysis: { ticker: "NVDA", companyName: "NVIDIA", currency: "USD" },
  });
  const emptyPdf = assemblePodcastChapters("pdf", buildPodcastFacts(empty), null);
  assert.match(emptyPdf.find(c => c.id === "dcf")?.spoken ?? "", /liegt nicht vor/);
  assert.match(emptyPdf.find(c => c.id === "zusammenfassung")?.spoken ?? "", /liegt nicht vor/);
  assertNoLeak("leer", emptyPdf.map(c => c.spoken).join(" "));
  ok("Fehlende DCF- und Kurswerte heißen liegt nicht vor");

  assert.equal(keepCompleteSentences("Diese Meldung ist relevant. Diese Meld"), "Diese Meldung ist relevant.");
  assert.equal(keepCompleteSentences("Diese Meld"), "");
  ok("Kürzung bleibt an der Satzgrenze");

  console.log(`ki-podcast ki-placeholders: ${n} checks ok`);
}

async function routeChecks() {
  resetStockPodcastRouteState();
  const noon = new Date("2026-11-26T12:00:00.000Z");
  const out = await handleStockPodcastScript({ ticker: "NVDA", source: "ki" }, {
    now: () => noon,
    llmAvailable: () => true,
    llm: async () => ({
      data: {
        chapters: [
          { id: "earnings", sentences: ["Der Call nennt call_date und call_quarter."] },
          { id: "news-llm", sentences: ["Diese Meldung ist relevant. Diese Meld"] },
        ],
      },
      modelUsed: "test",
    }),
    fullAi: async () => ({
      ok: true as const,
      packCached: false,
      pack: pack({
        ticker: "NVDA",
        analysis: {
          ticker: "NVDA",
          companyName: "NVIDIA",
          currentPrice: 149.3,
          currency: "USD",
          catalystsSource: "llm",
          growthThesisGeneratedAt: "2026-11-26T15:44:57.860Z",
          financialStatements: { incomeStatement: { revenue: 1, revenueGrowth: 10 } },
          _podcastInternals: { revenueY1: 1, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
        },
      }),
    }),
  });
  assert.equal(out.http, 200);
  assert.equal(out.body.ok, true);
  if (out.body.ok) {
    const spoken = out.body.chapters.map(c => c.spoken).join(" ");
    assert.equal(LEAK.test(spoken), false);
    assert.equal(out.body.stages.analyze.timeoutMs, PODCAST_STAGE_TIMEOUT_MS.analyze);
    assert.equal(out.body.stages.script.timeoutMs, PODCAST_STAGE_TIMEOUT_MS.script);
    assert.equal(out.body.stages.audio.timeoutMs, PODCAST_STAGE_TIMEOUT_MS.audio);
    assert.equal(typeof out.body.stages.analyze.elapsedMs, "number");
    assert.equal(typeof out.body.stages.script.elapsedMs, "number");
    assert.equal(typeof out.body.stages.script.dropped.total, "number");
    assert.equal(typeof out.body.stages.script.dropped.byReason, "object");
    assert.ok(out.body.chapters.some(c => c.id === "umsatz" && /Geschäftsjahr/.test(c.spoken)));
  }
  ok("Response trägt Stufen-Timeouts und ein ki-Transkript ohne nackte Namen");

  const audio = await handleStockPodcastAudio({ chapterId: "earnings", source: "ki" });
  assert.equal(audio.ok, false);
  if (!audio.ok) {
    assert.equal(audio.http, 400);
    assert.equal(audio.body.errorCode, "BAD_REQUEST");
  }
  ok("Audio ohne Ticker ist BAD_REQUEST");
}

main();
routeChecks().catch(err => {
  console.error(err);
  process.exit(1);
});
