/**
 * Negativfälle aus dem Retest ecb6e9ab: Doppel-Einheit, leerer Wert,
 * falscher Typ, künftiger Call, ISO, GrowthEvidence, Satzzeichen.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-insertion.ts
 */
import assert from "node:assert/strict";
import { buildPodcastFacts, type PodcastFacts } from "../shared/podcast-facts";
import { assemblePodcastChapters, applyPlaceholders, checkPodcastSentence, polishSpoken } from "../shared/podcast-script";
import { speakIsoDate } from "../shared/podcast-speak";
import type { FullAiPack } from "../server/stock-podcast-full-ai";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

function pack(analysis: Record<string, unknown>, extra: Partial<FullAiPack> = {}): FullAiPack {
  return {
    ticker: String(analysis.ticker ?? "MSFT"),
    day: "2026-11-26",
    generatedAt: "2026-11-26T12:00:00.000Z",
    analysis,
    pestelLlm: null,
    management: null,
    managementInterpret: null,
    earningsBrief: null,
    regulatory: null,
    thesisStrength: extra.thesisStrength ?? null,
    policyContext: null,
    timedOut: [],
    sections: {
      analyze: true, pestelLlm: false, policyContext: false, management: false,
      managementInterpret: false, earningsBrief: false, regulatory: false, thesisStrength: false,
    },
    ...extra,
  };
}

const baseAnalysis = {
  ticker: "MSFT",
  companyName: "Microsoft",
  currentPrice: 489.93,
  currency: "USD",
  catalystsSource: "llm",
  dataTimestamp: "2026-11-26T12:00:00.000Z",
  nextEarningsDate: "2027-01-27",
  lastReportedQuarter: "2026-10-28",
  financialStatements: { incomeStatement: { revenue: 280e9, revenueGrowth: 17.8 } },
  _podcastInternals: { revenueY1: 240e9, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
  dcfFairValue: 277,
  maxEntryCrv3: 346,
  revenueSegments: [{ name: "Cloud", revenue: 100, percentage: 40, fiscalYear: "2026" }],
};

function factsOf(analysis: Record<string, unknown>, extra: Partial<FullAiPack> = {}): PodcastFacts {
  return buildPodcastFacts(pack(analysis, extra), new Date("2026-11-26T12:00:00.000Z"));
}

function main() {
  assert.equal(speakIsoDate("2026-11-26", "dat"), "sechsundzwanzigsten November zweitausendsechsundzwanzig");
  assert.equal(speakIsoDate("2027-01-27", "dat")?.startsWith("siebenundzwanzigsten Januar"), true);
  assert.equal(polishSpoken("Wahnsinn!."), "Wahnsinn!");
  assert.equal(polishSpoken("Geschäftsjahr 2027.."), "Geschäftsjahr 2027.");
  assert.equal(polishSpoken("einhundert Dollar Dollar."), "einhundert Dollar.");
  ok("Kasus, doppelte Satzzeichen und doppelte Einheit werden bereinigt");

  const msft = factsOf(baseAnalysis);
  assert.equal(msft.values.call_quarter, null);
  assert.equal(msft.reportedQuarterLine, null);
  assert.equal((msft.reportedQuarterLine ?? "").includes("2026-10-28"), false);
  assert.match(msft.nextCallLine ?? "", /für den siebenundzwanzigsten Januar/);
  assert.equal(msft.nextCallLine?.includes("2027-01-27"), false);

  const doubled = assemblePodcastChapters("ki", msft, {
    chapters: [
      { id: "inversion", sentences: ["Der Kurs liegt bei {entry} Dollar."] },
      { id: "einstieg", sentences: ["{ticker} steht bei {price} Dollar."] },
      { id: "dcf", sentences: ["Der faire Wert liegt bei {dcf_fair} Dollar."] },
      { id: "earnings", sentences: ["Der letzte Call war am {call_date} zum {call_quarter}."] },
      { id: "s17", sentences: ["Blackwell-Auslieferungen sind der wichtigste Katalysator.", "im Katalysatoren: KI-firmenspezifisch -Modus."] },
      { id: "umsatz", sentences: ["Der Umsatz wuchs um {fy_yoy}.", "Der Umsatz im Geschäftsjahr beträgt {price} Dollar mit {fy_yoy}."] },
    ],
  });
  const spoken = (id: string) => doubled.find(c => c.id === id)?.spoken ?? "";
  for (const chapter of doubled) {
    assert.equal(/\bDollar\s+Dollar\b/.test(chapter.spoken), false, chapter.id);
    assert.equal(/\bProzent\s+Prozent\b/.test(chapter.spoken), false, chapter.id);
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(chapter.spoken), false, chapter.spoken);
    assert.equal(chapter.spoken.includes("GrowthEvidence"), false);
  }
  assert.equal(/liegt nicht vor/.test(spoken("earnings")), false);
  assert.match(spoken("earnings"), /Der nächste Earnings Call ist für den siebenundzwanzigsten Januar/);
  assert.equal(/war am/.test(spoken("earnings")), false);
  assert.equal(/Das zuletzt gemeldete Quartal liegt vor|Quartal zum|Oktober/.test(spoken("earnings")), false);
  assert.equal(/\d/.test(spoken("earnings")), false);
  assert.equal(spoken("umsatz").includes("beträgt Dollar"), false);
  assert.match(spoken("umsatz"), /Umsatzwachstum im Geschäftsjahr/);
  const pdf = assemblePodcastChapters("pdf", msft, {
    chapters: [
      { id: "einstieg", sentences: ["{ticker} steht bei {price} Dollar."] },
      { id: "dcf", sentences: ["Der faire Wert liegt bei {dcf_fair} Dollar."] },
    ],
  });
  const pdfDcf = pdf.find(c => c.id === "dcf")?.spoken ?? "";
  const pdfStart = pdf.find(c => c.id === "einstieg")?.spoken ?? "";
  assert.match(pdfDcf, /faire Wert/);
  assert.equal(/\bDollar\s+Dollar\b/.test(pdfDcf + pdfStart), false);
  assert.equal(/\{entry\}|\{price\}|\{dcf_fair\}/.test(spoken("inversion") + pdfDcf), false);
  const modeHits = spoken("s17").match(/Katalysatoren:/g) ?? [];
  assert.equal(modeHits.length, 1);
  assert.match(spoken("s17"), /Blackwell-Auslieferungen sind der wichtigste Katalysator/);
  assert.equal(spoken("s17").includes("-Modus"), false);
  const yoy = msft.values.fy_yoy ?? "";
  assert.ok(yoy.length >= 12);
  assert.equal(spoken("umsatz").split(yoy).length - 1, 1);
  ok("MSFT-Ist: keine Doppel-Einheit, kein leeres beträgt Dollar, kein vergangener Zukunftstermin, Modus einmal");

  const wrongType = assemblePodcastChapters("pdf", msft, {
    chapters: [
      { id: "umsatz", sentences: ["Der Gesamtumsatz beträgt {fy_yoy}."] },
      { id: "news", sentences: ["Der Umsatz stieg um {fy_yoy} auf {top_segment}."] },
    ],
  });
  const umsatz = wrongType.find(c => c.id === "umsatz")?.spoken ?? "";
  assert.match(umsatz, /Umsatzwachstum im Geschäftsjahr/);
  assert.equal(/Gesamtumsatz beträgt/.test(umsatz), false);
  const news = wrongType.find(c => c.id === "news")?.spoken ?? "";
  assert.equal(/stieg um/.test(news), false);
  assert.match(wrongType.find(c => c.id === "umsatz")?.spoken ?? "", /Das größte Segment/);
  assert.equal(/Cloud/.test(wrongType.find(c => c.id === "umsatz")?.spoken ?? ""), false);
  ok("Prozent-Platzhalter wird nicht als Umsatzbetrag gesprochen, Segmentname nicht als Zielwert");

  const emptyMoney = {
    ...msft,
    values: { ...msft.values, price: null, dcf_fair: null, entry: null },
  };
  assert.equal(applyPlaceholders("Der Umsatz beträgt {price} Dollar mit {fy_yoy}.", emptyMoney, "umsatz", "model"), null);
  assert.equal(checkPodcastSentence("Der Umsatz beträgt {price} Dollar mit {fy_yoy}.", emptyMoney, "umsatz", "model").ok, false);
  const emptyChapters = assemblePodcastChapters("ki", emptyMoney, {
    chapters: [{ id: "umsatz", sentences: ["Der Umsatz im Geschäftsjahr beträgt {price} Dollar mit {fy_yoy}."] }],
  });
  assert.equal(emptyChapters.find(c => c.id === "umsatz")?.spoken.includes("beträgt Dollar"), false);
  const emptyPdf = assemblePodcastChapters("pdf", emptyMoney, null);
  assert.equal(/liegt nicht vor/.test(emptyPdf.map(c => c.spoken).join(" ")), false);
  ok("Leerer Geld-Platzhalter wird nicht eingesetzt");

  const flagged = factsOf(baseAnalysis, {
    thesisStrength: { flags: ["GrowthEvidence: Peer-Gap fehlt (Sektor-Referenz nicht belastbar)"] },
  });
  const dcf = assemblePodcastChapters("pdf", flagged, null).find(c => c.id === "dcf")?.spoken ?? "";
  assert.match(dcf, /Die Sektor-Referenz ist nicht belastbar/);
  assert.equal(dcf.includes("GrowthEvidence"), false);
  assert.equal(dcf.includes("Peer-Gap fehlt"), false);
  ok("Interne GrowthEvidence-Zeile wird Klartext");

  const nvdaFuture = factsOf({
    ...baseAnalysis,
    ticker: "NVDA",
    companyName: "NVIDIA",
    nextEarningsDate: "2027-02-24",
    lastReportedQuarter: "2026-10-28",
  });
  const nvdaEarnings = assemblePodcastChapters("ki", nvdaFuture, {
    chapters: [{ id: "earnings", sentences: ["Der Call fand am {call_date} zum {call_quarter} statt."] }],
  }).find(c => c.id === "earnings")?.spoken ?? "";
  assert.match(nvdaEarnings, /für den vierundzwanzigsten Februar/);
  assert.equal(nvdaEarnings.includes("2027-02-24"), false);
  assert.equal(nvdaEarnings.includes("2026-10-28"), false);
  assert.equal(/\d/.test(nvdaEarnings), false);
  assert.equal(/fand am|Quartal zum|Oktober/.test(nvdaEarnings), false);
  assert.equal(/Das zuletzt gemeldete Quartal liegt vor/.test(nvdaEarnings), false);
  ok("NVDA: künftiger Call wird angekündigt, das Meldedatum wird nicht zum Quartalsende");

  console.log(`ki-podcast insertion: ${n} checks ok`);
}

main();
