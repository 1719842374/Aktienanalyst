/**
 * KI-Podcast: Sektion 10 vor dem Abwärtsanker, Sektion 17 mit China/Geopolitik,
 * Sektion 3 mit These und Umsatzregionen. Fehlende Werte bleiben ungesprochen.
 *
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-s10-s17.ts
 */
import assert from "node:assert/strict";
import { buildPodcastFacts } from "../shared/podcast-facts";
import { speakPercent, speakPriceUsd } from "../shared/podcast-speak";
import { invertedDcf } from "../shared/valuation-signal";
import {
  buildSpeechSheet,
  chaptersFromDrafts,
  fallbackParagraph,
  verifyChapter,
} from "../shared/podcast-fluent";
import { chaptersForSource } from "../shared/podcast-script";
import type { FullAiPack } from "../server/stock-podcast-full-ai";

const NOON = new Date("2026-11-26T12:00:00.000Z");
const COLLISION = "Mellanox InfiniBand Adoption Hyperscaler-Stagnation";

function pack(analysis: Record<string, unknown>): FullAiPack {
  return {
    ticker: "NVDA",
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
  } as FullAiPack;
}

const thesis = "NVIDIA bleibt der Spezialist für Rechenbeschleuniger und die Nachfrage trägt die Geschichte der Firma.";
const logic = "Die Katalysatoren tragen die Nachfrage und die These bleibt die Geschichte der Firma im Markt.";

function nvdaAnalysis(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticker: "NVDA",
    companyName: "NVIDIA",
    currency: "USD",
    currentPrice: 149.3,
    dataTimestamp: "2026-11-26T10:00:00.000Z",
    analystPT: { median: 235 },
    fcfTTM: 1_000_000_000,
    fcfHaircut: 0,
    totalDebt: 0,
    cashEquivalents: 0,
    sharesOutstanding: 2_000_000_000,
    sectorProfile: {
      waccScenarios: { kons: 10, avg: 9, opt: 8 },
      growthAssumptions: { g1: 12, g2: 8, terminal: 2.5 },
    },
    risks: [
      { name: "Exportregeln", category: "Binary", ew: 40, impact: 30, expectedDamage: 12 },
      { name: COLLISION, category: "Gradual", ew: 25, impact: 40, expectedDamage: 10 },
    ],
    catalysts: [
      { name: COLLISION, pos: 48, nettoUpside: 6, generic: false },
      {
        name: "Blackwell-Ausbau",
        pos: 55,
        nettoUpside: 8,
        generic: false,
        deepDive: { risiken: "Geopolitik und China-Exposure bleiben der Gegenwind für die Lieferkette." },
      },
    ],
    catalystsSource: "llm",
    llmMode: true,
    geoSegments: [
      { name: "USA", percentage: 69.3, source: "fmp" },
      { name: "Taiwan", percentage: 19.6, source: "fmp" },
      { name: "China", percentage: 9.1, source: "fmp" },
    ],
    growthThesis: thesis,
    catalystReasoning: { whyInteresting: logic, keyDrivers: [], timingRationale: "" },
    macroCorrelations: {
      overallMacroSensitivity: "Mittel",
      keyInsight: "China bleibt ein Absatzmarkt.",
      correlations: [{
        name: "Hang Seng / CSI 300",
        category: "Index",
        correlation: "Positiv",
        strength: "Moderat",
        mechanism: "China-Exposure über Absatzmärkte oder Lieferketten.",
      }],
    },
    _podcastInternals: { fxRateToUsd: 1, reportedCurrency: "USD" },
    ...extra,
  };
}

function sheetOf(analysis: Record<string, unknown>, language: "de" | "en") {
  const facts = buildPodcastFacts(pack(analysis), NOON);
  return { facts, sheet: buildSpeechSheet(facts, language) };
}

function spoken(id: string, analysis: Record<string, unknown>, language: "de" | "en"): string {
  const { sheet } = sheetOf(analysis, language);
  return fallbackParagraph(id, sheet);
}

function main(): void {
  assert.ok(chaptersForSource("ki").some(chapter => chapter.id === "these"));

  const expectedInv = invertedDcf({
    fcfBase: 1_000_000_000,
    gBase: Math.max(12, 1),
    wacc: 10,
    terminalG: 2.5,
    sharesOutstanding: 2_000_000_000,
    netDebt: 0,
    sigmaGbDown: -22 / 100,
    mode: "growth",
    haircut: 0,
  });
  const gap = (expectedInv.perShare / 235 - 1) * 100;
  assert.ok(Math.abs(gap) > 50, `Fixture-Divergenz ${gap}`);
  assert.ok(expectedInv.perShare > 0);

  const { facts, sheet } = sheetOf(nvdaAnalysis(), "de");
  const valuation = facts.measures?.valuation ?? null;
  assert.ok(valuation, "Faktenblatt ohne Risk-Adjusted Target");
  assert.equal(valuation.analystPt, 235);
  assert.equal(valuation.totalDamagePct, 22);
  assert.equal(valuation.target, 235 * (1 - 22 / 100));
  assert.equal(valuation.invertedPerShare, expectedInv.perShare);
  assert.equal(valuation.wideDivergence, true);
  assert.equal(valuation.upsideVsPricePct >= 0, true);

  const inversion = fallbackParagraph("inversion", sheet);
  const targetSpoken = sheet.facts.find(fact => fact.id === "ra_target")?.spoken ?? "";
  const upsideSpoken = sheet.facts.find(fact => fact.id === "ra_upside")?.spoken ?? "";
  const invSpoken = sheet.facts.find(fact => fact.id === "inv_dcf")?.spoken ?? "";
  const damageSpoken = speakPercent(22) ?? "";
  assert.ok(targetSpoken && upsideSpoken && invSpoken);
  assert.ok(inversion.indexOf(upsideSpoken) >= 0, inversion);
  assert.ok(inversion.indexOf(upsideSpoken) < inversion.indexOf(invSpoken), inversion);
  assert.ok(inversion.indexOf(targetSpoken) < inversion.indexOf(invSpoken), inversion);
  assert.match(inversion, /unterbewertet/);
  assert.match(inversion, /nicht der faire Wert/);
  assert.match(inversion, /Abwärts/);
  assert.match(inversion, /starkes Wachstum/);
  assert.ok(inversion.includes(damageSpoken), inversion);
  assert.match(inversion, /Exportregeln/);
  assert.ok(inversion.includes(COLLISION), inversion);
  const ew = speakPercent(40);
  const impact = speakPercent(30);
  const harm = speakPercent(12);
  assert.ok(ew && impact && harm && inversion.includes(ew) && inversion.includes(impact) && inversion.includes(harm), inversion);
  const verdict = verifyChapter("inversion", inversion, sheet);
  assert.equal(verdict.ok, true, verdict.notes.join("|"));

  const reversed = verifyChapter(
    "inversion",
    `Der Abwärtsanker liegt bei [[inv_dcf]] und kommt vor dem Zielkurs [[ra_target]] im neuen Jahr. Die Aktie bleibt der Maßstab für den Markt.`,
    sheet,
  );
  assert.equal(reversed.ok, false);
  assert.ok(reversed.reasons.includes("order"), reversed.notes.join("|"));

  const s17 = fallbackParagraph("s17", sheet);
  assert.match(s17, /Blackwell-Ausbau/);
  assert.equal(s17.includes(COLLISION), false, s17);
  assert.ok(s17.includes(speakPercent(55) ?? "fehlt"), s17);
  assert.ok(s17.includes(speakPercent(8) ?? "fehlt"), s17);
  assert.match(s17, /Geopolitik/);
  assert.match(s17, /China-Exposure/);
  const china = sheet.facts.find(fact => fact.id === "china_geo");
  assert.ok(china);
  assert.match(china.source, /catalysts\.deepDive|macroCorrelations/);
  assert.equal(verifyChapter("s17", s17, sheet).ok, true);

  const these = fallbackParagraph("these", sheet);
  assert.ok(these.indexOf("Spezialist") >= 0, these);
  assert.ok(these.indexOf("Spezialist") < these.indexOf("Katalysatoren tragen"), these);
  assert.ok(these.indexOf("Katalysatoren tragen") < these.indexOf("Umsatzregionen"), these);
  assert.ok(these.includes(speakPercent(69.3) ?? ""), these);
  assert.ok(these.includes(speakPercent(19.6) ?? ""), these);
  assert.ok(these.includes(speakPercent(9.1) ?? ""), these);
  assert.ok(these.includes(speakPercent(28.7) ?? ""), these);
  assert.match(these, /Quelle Umsatzregionen/);
  assert.match(these, /Asien/);
  assert.equal(verifyChapter("these", these, sheet).ok, true);

  const enInv = spoken("inversion", nvdaAnalysis(), "en");
  const enSheet = sheetOf(nvdaAnalysis(), "en").sheet;
  const enTarget = enSheet.facts.find(fact => fact.id === "ra_target")?.spoken ?? "";
  const enInvAnchor = enSheet.facts.find(fact => fact.id === "inv_dcf")?.spoken ?? "";
  assert.ok(enInv.indexOf(enTarget) >= 0 && enInv.indexOf(enTarget) < enInv.indexOf(enInvAnchor), enInv);
  assert.match(enInv, /undervalued/);
  assert.match(enInv, /not the fair value/);
  assert.match(enInv, /downside/);
  assert.equal(verifyChapter("inversion", enInv, enSheet).ok, true, verifyChapter("inversion", enInv, enSheet).notes.join("|"));
  const enS17 = spoken("s17", nvdaAnalysis(), "en");
  assert.match(enS17, /China exposure/i);
  assert.match(enS17, /geopolit/i);
  assert.equal(enS17.includes(COLLISION), false, enS17);
  const enThese = spoken("these", nvdaAnalysis(), "en");
  assert.match(enThese, /percent/);
  assert.match(enThese, /United States|USA/);
  assert.match(enThese, /Taiwan/);
  assert.match(enThese, /China/);
  assert.match(enThese, /Asia/);
  assert.equal(/\b(der|die|das|Prozent)\b/.test(enThese), false, enThese);

  const priceSpoken = speakPriceUsd(valuation.target, facts.measures?.sig ?? 3);
  assert.ok(priceSpoken && targetSpoken === priceSpoken, `${targetSpoken} vs ${priceSpoken}`);

  const incomplete = spoken("these", nvdaAnalysis({
    geoSegments: [
      { name: "USA", percentage: 69.3, source: "fmp" },
      { name: "Taiwan", source: "fmp" },
      { name: "China", percentage: 9.1, source: "fmp" },
    ],
  }), "de");
  assert.equal(/Umsatzregionen|Asien|neunundsechzig/.test(incomplete), false, incomplete);
  assert.equal(/\bn\/a\b/.test(incomplete), false, incomplete);

  const unknown = spoken("these", nvdaAnalysis({
    geoSegments: [
      { name: "USA", percentage: 60, source: "fmp" },
      { name: "Atlantis", percentage: 40, source: "fmp" },
    ],
  }), "de");
  assert.match(unknown, /USA/);
  assert.match(unknown, /Atlantis/);
  assert.equal(/Asien/.test(unknown), false, unknown);

  const bare = spoken("inversion", {
    ticker: "NVDA",
    companyName: "NVIDIA",
    currency: "USD",
    currentPrice: 100,
    _podcastInternals: { fxRateToUsd: 1, reportedCurrency: "USD" },
  }, "de");
  assert.equal(/risikoadjustiert|invertierte|China-Exposure|n\/a/i.test(bare), false, bare);
  const bareS17 = spoken("s17", {
    ticker: "NVDA",
    companyName: "NVIDIA",
    currency: "USD",
    currentPrice: 100,
    _podcastInternals: { fxRateToUsd: 1, reportedCurrency: "USD" },
  }, "de");
  assert.equal(/China-Exposure|Geopolitik|n\/a/i.test(bareS17), false, bareS17);

  const earned = verifyChapter(
    "earnings",
    "Zuletzt gemeldet wurde das Quartal und der Zielkurs [[ra_target]] wiederholt die Inversion der Firma im neuen Jahr.",
    sheet,
  );
  assert.equal(earned.ok, false, earned.notes.join("|"));

  const copied = "Die Gesamtsicht aus dem risikoadjustierten Zielkurs trägt die Bewertung der Firma im Jahr.";
  const assembled = chaptersFromDrafts(sheet, "ki", [
    { id: "inversion", attempts: 1, reasons: [], notes: [], spoken: `${inversion} ${copied}` },
    { id: "earnings", attempts: 1, reasons: [], notes: [], spoken: `${copied} Zuletzt gemeldet wurde das Quartal drei im Geschäftsjahr und der Termin bleibt der nächste Call der Firma.` },
  ]).chapters;
  const inversionChapter = assembled.find(chapter => chapter.id === "inversion")?.spoken ?? "";
  const earningsChapter = assembled.find(chapter => chapter.id === "earnings")?.spoken ?? "";
  assert.ok(inversionChapter.includes(copied), inversionChapter);
  assert.equal(earningsChapter.includes(copied), false, earningsChapter);
  assert.match(earningsChapter, /gemeldet/);

  const kiThese = chaptersFromDrafts(sheet, "ki", []).chapters.find(chapter => chapter.id === "these");
  assert.ok(kiThese);
  assert.match(kiThese.spoken, /Umsatzregionen/);
  assert.match(kiThese.spoken, /Spezialist/);

  console.log("ok ki podcast s10 s17 s3");
}

main();
