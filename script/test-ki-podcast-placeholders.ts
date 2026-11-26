/**
 * Platzhalter, Validator und Einsetzung. Kein Netz.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-placeholders.ts
 */
import assert from "node:assert/strict";
import { buildPodcastFacts, hashPodcastFacts, type PodcastFacts } from "../shared/podcast-facts";
import {
  applyPlaceholders,
  assemblePodcastChapters,
  balanceProContra,
  buildPodcastLlmPrompt,
  checkPodcastSentence,
} from "../shared/podcast-script";
import type { FullAiPack } from "../server/stock-podcast-full-ai";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

function shell(partial: Partial<PodcastFacts> & Pick<PodcastFacts, "values">): PodcastFacts {
  return {
    tokens: partial.tokens ?? ["NVDA", "NVIDIA", "H100"],
    asOfIso: "2026-11-26",
    asOfLabel: "26.11.2026",
    priceLabel: "149,3",
    rankOk: true,
    sig: 3,
    peerBanner: null,
    sectorFlag: null,
    callEstimated: false,
    nextCallLine: null,
    segmentPeriodMissing: false,
    earningsState: "missing",
    earningsNote: "Ein Earnings-Call-Transkript liegt nicht vor.",
    catalystGeneric: partial.catalystGeneric ?? true,
    hasThesis: false,
    hasPorter: true,
    hasPestel: true,
    riskNames: ["Konzentration"],
    payloadTitles: [],
    reportedQuarterLine: null,
    proSeed: "Ein Pro-Punkt liegt nicht vor.",
    contraSeed: "Die genannten Risiken sind Konzentration.",
    redactedContext: "These ohne Ziffern",
    ...partial,
    values: partial.values,
  };
}

const values = {
  ticker: "NVDA", company: "NVIDIA", as_of: "sechsundzwanzigster November zweitausendsechsundzwanzig",
  currency_word: "Dollar", statement_currency_word: "Dollar",
  price: "einhundertneunundvierzig Dollar", score: null, ampel: null,
  wacc: "vierzehn Komma eins Prozent", g_star: "elf Komma vier Prozent",
  dcf_fair: null, dcf_low: null, dcf_high: null, entry: null, crv: null,
  quarter_yoy: null, quarter_period_end: null, ttm_revenue: null, ttm_period_end: null,
  top_segment: null, top_segment_share: null, call_date: null, call_quarter: null,
  catalyst_mode: "Katalysatoren: generisch (Sektor)",
  news_1: null, news_2: null, news_3: null, news_age: null,
  fy_yoy: "einhundertvierzehn Prozent", gj_year: "2026",
  fcf_margin: null, netto_upside_1: null, netto_upside_2: null, netto_upside_3: null,
};

function main() {
  const facts = shell({ values });
  const allowed = "{ticker} nutzt H100, Q3, S17, GJ2026, 3-nm und S&P 500.";
  assert.equal(checkPodcastSentence(allowed, facts).ok, true);
  assert.equal(checkPodcastSentence("Nur H100.", facts).ok, true);
  assert.equal(checkPodcastSentence("Der erfundene Kurs ist 149.", facts).ok, false);
  assert.equal(checkPodcastSentence("Eine erfundene 14 steht im Satz.", facts).ok, false);
  assert.equal(checkPodcastSentence("vierzehn Prozent", facts).ok, false);
  assert.equal(checkPodcastSentence("elf Komma vier Prozent", facts).ok, false);
  assert.equal(checkPodcastSentence("fünfzig US-Dollar", facts).ok, false);
  assert.equal(checkPodcastSentence("um ein Drittel gestiegen", facts).ok, false);
  assert.equal(checkPodcastSentence("Wachstum seit Jahresbeginn", facts).ok, false);
  assert.equal(checkPodcastSentence("Umsatz YTD", facts).ok, false);
  assert.equal(checkPodcastSentence("Unbekannt {foo}", facts).ok, false);
  assert.equal(checkPodcastSentence("Quartal {quarter_yoy}", facts).ok, false);
  assert.equal(checkPodcastSentence("Der Termin ist call_date und call_quarter.", facts).ok, false);
  assert.equal(checkPodcastSentence("Wachstum fy_yoy im Jahr gj_year.", facts).ok, false);
  assert.equal(checkPodcastSentence("Die Liste ist firmenspezifisch.", facts, "s17").ok, false);
  ok("Validator lässt Produktnamen durch und lehnt Ziffern, Zahlwörter, YTD und leere Platzhalter ab");

  const spoken = applyPlaceholders("Das Umsatzwachstum im Geschäftsjahr {gj_year} beträgt {fy_yoy}.", facts, "umsatz");
  assert.ok(spoken);
  assert.match(spoken!, /Geschäftsjahr zweitausendsechsundzwanzig/);
  assert.match(spoken!, /Prozent/);
  assert.equal(/\d/.test(spoken!), false);
  assert.equal(spoken!.includes("YTD"), false);
  ok("Code setzt Geschäftsjahr und Prozent ein, das Modell liefert nur Platzhalter");

  const longPro = "Pro. ".repeat(40);
  const balanced = balanceProContra(longPro, "Kurz.");
  assert.ok(balanced.contra.length >= balanced.pro.length);
  ok("Contra bleibt mindestens so lang wie Pro");

  const pack = {
    ticker: "NVDA",
    day: "2026-11-26",
    generatedAt: "2026-11-26T12:00:00.000Z",
    analysis: {
      ticker: "NVDA",
      companyName: "NVIDIA",
      currentPrice: 149.3,
      currency: "USD",
      catalystsSource: "generic",
      dataTimestamp: "2026-11-26T10:00:00.000Z",
      financialStatements: { incomeStatement: { revenue: 130e9, revenueGrowth: 114 } },
      _podcastInternals: { revenueY1: 60e9, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
      risks: [{ name: "Konzentration" }],
    },
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
  const built = buildPodcastFacts(pack);
  assert.equal(built.values.quarter_yoy, null);
  assert.equal(built.values.ttm_revenue, null);
  assert.equal(built.values.dcf_low, null);
  assert.equal(built.values.dcf_high, null);
  assert.match(built.values.fy_yoy ?? "", /Prozent/);
  assert.equal(built.values.gj_year, "zweitausendsechsundzwanzig");
  assert.equal(/\d/.test(built.values.gj_year ?? ""), false);
  const prompt = buildPodcastLlmPrompt("pdf", built);
  assert.equal(prompt.prompt.includes("149"), false);
  assert.equal(prompt.prompt.includes("114"), false);
  const chapters = assemblePodcastChapters("pdf", built, {
    chapters: [{ id: "einstieg", sentences: [allowed] }],
  });
  const umsatz = chapters.find(c => c.id === "umsatz");
  assert.match(umsatz?.spoken ?? "", /Geschäftsjahr/);
  assert.equal(/YTD|seit Jahresbeginn/.test(chapters.map(c => c.spoken).join(" ")), false);
  assert.ok(chapters.some(c => c.id === "inversion"));
  assert.ok(chapters.some(c => c.spoken.includes("Dies ist keine Anlageberatung.")));
  assert.match(chapters.find(c => c.id === "s17")?.spoken ?? "", /generisch \(Sektor\)/);
  const pro = chapters.find(c => c.id === "zusammenfassung")?.spoken.length ?? 0;
  const contra = chapters.find(c => c.id === "inversion")?.spoken.length ?? 0;
  assert.ok(contra >= pro);
  assert.ok(hashPodcastFacts(built.values).length === 64);
  ok("PDF-Kapitel nennen das Geschäftsjahr, die Inversion, den Disclaimer und bleiben ohne YTD");

  const fxPack = {
    ...pack,
    analysis: {
      ...pack.analysis,
      currency: "EUR",
      currentPrice: 100,
      _podcastInternals: { revenueY1: 10, fiscalYear: "2026", fxRateToUsd: 1.1, reportedCurrency: "EUR" },
    },
  } as FullAiPack;
  const fx = buildPodcastFacts(fxPack);
  assert.match(fx.values.price ?? "", /Dollar/);
  assert.equal(fx.values.price?.includes("Euro"), false);
  ok("Fremdwährung wird vor der Sprechform in Dollar gerechnet");

  const noPrior = buildPodcastFacts({
    ...pack,
    analysis: {
      ...pack.analysis,
      financialStatements: { incomeStatement: { revenue: 10, revenueGrowth: 0 } },
      _podcastInternals: { revenueY1: null, fiscalYear: null, fxRateToUsd: 1, reportedCurrency: "USD" },
    },
  } as FullAiPack);
  assert.equal(noPrior.values.fy_yoy, null);
  const noPriorChapters = assemblePodcastChapters("pdf", noPrior, null);
  assert.match(noPriorChapters.find(c => c.id === "umsatz")?.spoken ?? "", /liegt nicht vor/);
  ok("Fehlender Vorjahresumsatz wird nicht als null Prozent gesprochen");

  console.log(`ki-podcast placeholders: ${n} checks ok`);
}

main();
