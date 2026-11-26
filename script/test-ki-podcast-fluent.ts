/**
 * Flüssiger Absatz je Kapitel, Prüfung mit Neuschreiben, Deutsch und Englisch.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-fluent.ts
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DCF_CALIBRATION } from "../shared/dcf-calibration";
import { buildPodcastFacts } from "../shared/podcast-facts";
import { priceLabelFor, speakPriceUsd } from "../shared/podcast-speak";
import {
  applyRedo,
  applyTitleMap,
  buildSpeechSheet,
  chaptersFromDrafts,
  fallbackParagraph,
  factsForChapter,
  seedDrafts,
  fluencyStats,
  fluentPrompt,
  podcastSentences,
  verifyChapter,
} from "../shared/podcast-fluent";
import { OPENROUTER_PODCAST_VOICES_EN, PODCAST_DISCLAIMER, PODCAST_DISCLAIMER_EN, resolveStockPodcastVoice } from "../shared/podcast-types";
import { chaptersForSource, PDF_PODCAST_CHAPTERS } from "../shared/podcast-script";
import { dePool, enPool, type ProbePool } from "./fixtures/podcast-inverter-pools";
import type { FullAiPack } from "../server/stock-podcast-full-ai";
import { renderStockPodcastScript, resetPodcastScriptCache } from "../server/stock-podcast-script";
import { handleStockPodcastScript, resetStockPodcastRouteState } from "../server/stock-podcast-route";
import { podcastDailyCount } from "../server/stock-podcast-limit";
import { synthesizePodcastAudio, type PodcastAudioFetch } from "../server/stock-podcast-audio";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

const NOON = new Date("2026-11-26T12:00:00.000Z");
const FAIL = [
  "Das erste Risiko.",
  "liegt nicht vor",
  "interner Bezeichner",
  "Toyota hat starke Patente und Apple kauft Novo Nordisk.",
  "seit Jahresbeginn",
];

function pack(ticker: string, analysis: Record<string, unknown>): FullAiPack {
  return {
    ticker,
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

function nvdaPack(): FullAiPack {
  return pack("NVDA", {
    ticker: "NVDA",
    companyName: "NVIDIA",
    podcastCompanySource: "yahoo-chart",
    currency: "USD",
    currentPrice: 149.3,
    dataTimestamp: "2026-11-26T10:00:00.000Z",
    s17Verdict: "GRÜN",
    dcfConservative: 180,
    crv: -0.3,
    maxEntryCrv3: 120,
    financialStatements: { incomeStatement: { revenueGrowth: 114 } },
    revenueSegments: [{ name: "Data Center", percentage: 80, fiscalYear: "2026" }],
    catalysts: [{ name: "Rechenzentren", nettoUpside: 12 }],
    risks: [{ name: "Exportregeln" }],
    newsItems: [{ title: "Neue Rechenzentren", pubDate: "2026-11-25T08:00:00.000Z" }],
    _podcastInternals: { revenueY1: 1, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
    growthThesis: "NVIDIA bleibt der Spezialist für Rechenbeschleuniger und die Nachfrage trägt die Geschichte.",
  });
}

function toyotaPack(): FullAiPack {
  return pack("7203.T", {
    ticker: "7203.T",
    companyName: "Toyota Motor Corporation",
    podcastCompanySource: "yahoo-chart",
    currency: "JPY",
    currentPrice: 3000,
    dataTimestamp: "2026-11-26T08:00:00.000Z",
    s17Verdict: "GELB",
    dcfConservative: 4000,
    crv: 1.2,
    maxEntryCrv3: 2500,
    financialStatements: { incomeStatement: { revenueGrowth: 8 } },
    revenueSegments: [{ name: "Automobil", percentage: 80, fiscalYear: "2026" }],
    catalysts: [{ name: "Hybridantrieb", nettoUpside: 6 }],
    risks: [{ name: "Wechselkurs" }],
    newsItems: [{ title: "Toyota hebt die Jahresprognose an", pubDate: "2026-11-25T08:00:00.000Z" }],
    _podcastInternals: { revenueY1: 1, fiscalYear: "2026", fxRateToUsd: 0.0067, reportedCurrency: "JPY" },
    growthThesis: "Toyota bleibt der Hersteller mit dem breiten Hybridangebot und die Marge trägt die Geschichte.",
  });
}

function spokenOf(body: FullAiPack, language: "de" | "en"): string {
  const facts = buildPodcastFacts(body, NOON);
  const sheet = buildSpeechSheet(facts, language);
  const parts = chaptersForSource("pdf").map(def => {
    if (def.id === "schluss") return language === "en"
      ? `${PODCAST_DISCLAIMER_EN} The figures in this episode come from the verified fact sheet and are not estimates.`
      : `${PODCAST_DISCLAIMER} Die genannten Werte stammen ausschließlich aus dem belegten Faktenblatt und werden hier nicht geschätzt.`;
    return fallbackParagraph(def.id, sheet);
  }).filter(Boolean);
  return parts.join("\n");
}

function assertFluent(text: string, label: string): void {
  for (const sentence of podcastSentences(text)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    assert.ok(words.length >= 4, `${label} kurzer Satz: ${sentence}`);
    assert.notEqual(sentence.replace(/[.!?]+$/g, ""), "Data Center");
    assert.notEqual(sentence.replace(/[.!?]+$/g, ""), "Marketplaces");
    assert.notEqual(sentence.replace(/[.!?]+$/g, ""), "Das erste Risiko");
  }
  const stats = fluencyStats(text);
  assert.ok(stats.avg >= 8, `${label} Schnitt ${stats.avg}`);
  assert.equal(stats.short, 0);
  for (const bad of FAIL) assert.equal(text.includes(bad), false, bad);
  assert.equal(/bleibt an (?:die|diese) Quelle gebunden|Damit ist der belegte|stays tied to (?:that|the) source|That is the verified/.test(text), false, text);
  assert.equal(/\bYTD\b/.test(text), false);
  assert.equal(/\d/.test(text), false, text);
}

async function main() {
  assert.equal(DCF_CALIBRATION.enabled, false);
  ok("DCF_CALIBRATION.enabled bleibt false");

  const nvda = nvdaPack();
  const toyota = toyotaPack();
  const deSheet = buildSpeechSheet(buildPodcastFacts(nvda, NOON), "de");
  const enSheet = buildSpeechSheet(buildPodcastFacts(nvda, NOON), "en");
  assert.ok(deSheet.facts.every(fact => fact.source && fact.spoken && !/\d/.test(fact.spoken)));
  assert.equal(deSheet.facts.find(fact => fact.id === "price")?.source, "analysis.currentPrice");
  assert.equal(deSheet.facts.find(fact => fact.id === "company")?.source, "yahoo-chart");
  assert.ok(deSheet.codeLines.some(line => line.chapterId === "dcf" && line.spoken.startsWith("Das Chance-Risiko-Verhältnis liegt bei ")));
  assert.equal(deSheet.facts.some(fact => fact.id === "crv" || fact.id === "thesis"), false);
  assert.equal(deSheet.facts.some(fact => fact.id === "missing"), false);
  const prompt = fluentPrompt(deSheet, "pdf");
  assert.equal(/\d/.test(prompt.prompt.replace(/\bs17\b/g, "")), false, prompt.prompt);
  assert.equal(/currentPrice|revenueGrowth|fiscalYear|nettoUpside|dataTimestamp/.test(prompt.prompt), false);
  ok("Faktenblatt trägt Quelle und Sprechform, der Prompt sieht keine Rohzahl und keinen Feldnamen");

  for (const def of chaptersForSource("pdf")) {
    if (def.id === "schluss") continue;
    const paragraph = fallbackParagraph(def.id, deSheet);
    if (!factsForChapter(deSheet, def.id).length && !deSheet.codeLines.some(line => line.chapterId === def.id)) {
      assert.equal(paragraph, "");
      continue;
    }
    const verdict = verifyChapter(def.id, paragraph, deSheet);
    assert.equal(verdict.ok, true, `${def.id} ${verdict.notes.join("|")} ${paragraph}`);
    const stats = fluencyStats(paragraph);
    assert.ok(stats.sentences >= 1 && stats.avg >= 8 && stats.short === 0, def.id);
  }
  ok("Jedes deutsche Kapitel mit Fakten ist ein flüssiger Absatz");

  const enPrice = enSheet.facts.find(fact => fact.id === "price")?.spoken ?? "";
  const enDate = enSheet.facts.find(fact => fact.id === "as_of")?.spoken ?? "";
  assert.match(enPrice, /one hundred forty nine dollars/);
  assert.match(enDate, /November twenty sixth, two thousand twenty six/);
  const enUmsatz = fallbackParagraph("umsatz", enSheet);
  assert.match(enUmsatz, /one hundred fourteen percent/);
  assert.match(enUmsatz, /two thousand twenty six/);
  assert.equal(/\b(liegt|Geschäftsjahr|Prozent|Anlageberatung|heute|gestern|Faktenblatt)\b/.test(enUmsatz), false, enUmsatz);
  const enUmsatzVerdict = verifyChapter("umsatz", enUmsatz, enSheet);
  assert.equal(enUmsatzVerdict.ok, true, `${enUmsatzVerdict.notes.join("|")} ${enUmsatz}`);
  ok("Englisch spricht Zahl, Datum und Prozent und lässt keine deutschen Reste stehen");

  const deNvda = spokenOf(nvda, "de");
  const enNvda = spokenOf(nvda, "en");
  const deToyota = spokenOf(toyota, "de");
  const enToyota = spokenOf(toyota, "en");
  assertFluent(deNvda, "NVDA de");
  assertFluent(enNvda, "NVDA en");
  assertFluent(deToyota, "7203 de");
  assertFluent(enToyota, "7203 en");
  assert.match(deNvda, /Geschäftsjahr/);
  assert.match(deNvda, /Chance-Risiko-Verhältnis liegt bei/);
  assert.equal(/7203|siebentausend/.test(deToyota), false);
  assert.match(deToyota, /Toyota Motor Corporation/);
  assert.match(deToyota, /Dollar/);
  assert.match(enToyota, /dollars/);
  assert.equal(/\b(liegt|Geschäftsjahr|Prozent)\b/.test(enToyota), false);
  ok("Beispieltranskripte für NVDA und 7203.T bleiben flüssig und ohne die alten Fehlstrings");

  const inventedRaw = "Toyota hat starke Patente und Apple kauft Novo Nordisk. Der Satz bleibt trotzdem lang genug für die Prüfung hier.";
  const inventedBackup = verifyChapter("s13", inventedRaw, deSheet, []);
  assert.equal(inventedBackup.reasons.includes("name"), true, inventedBackup.notes.join("|"));
  const invented = verifyChapter("s13", inventedRaw, deSheet, ["Toyota", "Apple", "Novo Nordisk"]);
  assert.equal(invented.ok, false);
  assert.ok(invented.reasons.includes("name"));
  ok("Deutsche Eigennamen außerhalb der belegten Substantive fallen auch ohne Liste");

  resetPodcastScriptCache();
  const good = fallbackParagraph("umsatz", deSheet);
  let calls = 0;
  const regenerated = await renderStockPodcastScript({
    pack: nvda,
    source: "pdf",
    language: "de",
    now: NOON,
    llm: async () => {
      calls += 1;
      if (calls === 1) return { data: { chapters: [{ id: "umsatz", paragraph: "Wachstum 114." }] }, modelUsed: "test" };
      return { data: { chapters: [{ id: "umsatz", paragraph: good, entities: [] }] }, modelUsed: "test" };
    },
  });
  assert.equal(regenerated.ok, true);
  if (regenerated.ok) {
    const report = regenerated.reports.find(row => row.id === "umsatz");
    assert.equal(report?.attempts, 2);
    assert.equal(report?.fallback, null);
    assert.equal(/\d/.test(regenerated.chapters.find(c => c.id === "umsatz")?.spoken ?? ""), false);
    assert.equal(JSON.stringify(regenerated.reports).includes("Wachstum"), false);
    assert.deepEqual(regenerated.extractor, { ok: 1, missing: 0, invalid: 0 });
  }
  assert.equal(calls, 2);
  ok("Ein kaputtes Kapitel wird einmal neu geschrieben, ohne zweiten Extraktor-Call");

  resetStockPodcastRouteState();
  const deps = {
    now: () => NOON,
    llmAvailable: () => true,
    llm: async () => ({ data: { chapters: [] }, modelUsed: "test" }),
    fullAi: async () => ({ ok: true as const, packCached: false, pack: nvda }),
  };
  const german = await handleStockPodcastScript({ ticker: "NVDA", source: "pdf" }, deps);
  assert.equal(german.http, 200);
  if (german.body.ok) {
    assert.equal(german.body.language, "de");
    assert.equal(german.body.voice, "de-DE-Mia:MAI-Voice-2.1");
    assert.equal(german.body.disclaimer, PODCAST_DISCLAIMER);
    assert.ok(german.body.stages.script.chapters && german.body.stages.script.chapters.length > 0);
  }
  const english = await handleStockPodcastScript({ ticker: "NVDA", source: "pdf", language: "en" }, deps);
  assert.equal(english.http, 200);
  if (english.body.ok) {
    assert.equal(english.body.language, "en");
    assert.equal(english.body.voice, OPENROUTER_PODCAST_VOICES_EN[0].id);
    assert.equal(english.body.disclaimer, PODCAST_DISCLAIMER_EN);
    assert.equal(english.body.cached, false);
    assert.match(english.body.chapters.map(c => c.spoken).join(" "), /one hundred/);
  }
  assert.equal(podcastDailyCount("NVDA", NOON), 2);
  const third = await handleStockPodcastScript({ ticker: "NVDA", source: "ki", language: "en" }, deps);
  assert.equal(third.http, 429);
  ok("Englisch nutzt die eigene Stimme, der Cache trennt die Sprache und das Tageslimit bleibt gemeinsam");

  const seen: Array<{ url: string; body: any }> = [];
  const fetchImpl: PodcastAudioFetch = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    const fail = seen.length === 1;
    return { ok: !fail, status: fail ? 500 : 200, bytes: async () => Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]) };
  };
  const audio = await synthesizePodcastAudio({
    text: "The price stands at one hundred forty nine dollars and the figure stays tied to the source.",
    voiceId: "en-US-Harper:MAI-Voice-2.1",
    language: "en",
    cacheId: "fluent-en",
    env: { openrouterKey: "test-openrouter-key", xaiKey: "test-xai-key" },
    fetchImpl,
  });
  assert.equal(audio.ok, true);
  assert.equal(seen[0]?.body.voice, "en-US-Harper:MAI-Voice-2.1");
  assert.equal(seen[0]?.body.model, "microsoft/mai-voice-2.1");
  assert.equal(seen[1]?.body.language, "en");
  ok("Englisch bleibt auf mai-voice-2.1, xAI übernimmt die Sprache nur mit gesetztem Key");

  const nouns = "Die Aktie der Firma bleibt im neuen Jahr der Maßstab für den Markt. Der Umsatz stützt die Bewertung und das Wachstum trägt die Nachfrage.";
  const nounVerdict = verifyChapter("zusammenfassung", nouns, deSheet);
  assert.equal(nounVerdict.ok, true, nounVerdict.reasons.join(",") + " " + nouns);
  const january = verifyChapter("zusammenfassung", "Der Januar bleibt der Monat für die Firma und die Aktie. Der Umsatz stützt die Bewertung im neuen Jahr.", deSheet);
  assert.equal(january.ok, true, january.reasons.join(","));
  ok("Ein korrekter deutscher Absatz mit normalen Substantiven besteht");

  const deNumber = verifyChapter("zusammenfassung", "Der Umsatz wächst um zwanzig Prozent und das bleibt der Vergleich für die Firma. Die Aktie hält diesen Kurs im neuen Jahr.", deSheet);
  assert.equal(deNumber.ok, false);
  assert.ok(deNumber.reasons.includes("number"));
  const enNumber = verifyChapter("zusammenfassung", "Revenue grows by about twenty percent and the company holds that line in the market. The signal stays the verified view for the firm.", enSheet);
  assert.equal(enNumber.ok, false);
  assert.ok(enNumber.reasons.includes("number"));
  ok("Erfundene Zahlwörter fallen auf Deutsch und Englisch durch");

  const leadingRaw = "Toyota bleibt in diesem Satz der erste Name und die Firma folgt danach. Die Aktie der Firma bleibt im neuen Jahr der Maßstab für den Markt.";
  const leadingEmpty = verifyChapter("zusammenfassung", leadingRaw, deSheet, []);
  assert.equal(leadingEmpty.notes.some(note => note === "name Toyota"), true, leadingEmpty.notes.join("|"));
  const leading = verifyChapter("zusammenfassung", leadingRaw, deSheet, ["Toyota"]);
  assert.equal(leading.ok, false);
  assert.ok(leading.notes.some(note => note === "name Toyota"), leading.notes.join("|"));
  ok("Toyota am Satzanfang fällt auch ohne Entitätsliste");

  const ordered = buildSpeechSheet(buildPodcastFacts(pack("NVDA", {
    ticker: "NVDA",
    companyName: "NVIDIA",
    currency: "USD",
    currentPrice: 100,
    catalysts: [
      { name: "Software", nettoUpside: 4 },
      { name: "Blackwell", nettoUpside: 10.6 },
    ],
    _podcastInternals: { fxRateToUsd: 1, reportedCurrency: "USD" },
  }), NOON), "de");
  const pairA = ordered.facts.find(fact => fact.id === "pair_a")?.spoken ?? "";
  const pairB = ordered.facts.find(fact => fact.id === "pair_b")?.spoken ?? "";
  assert.match(pairA, /Blackwell/);
  assert.match(pairA, /zehn Komma sechs Prozent/);
  assert.equal(/vier Prozent/.test(pairA), false);
  assert.match(pairB, /Software/);
  assert.match(pairB, /vier Prozent/);
  assert.equal(ordered.facts.some(fact => fact.id === "upside_a" || fact.id === "catalyst_a"), false);
  const s17 = fallbackParagraph("s17", ordered);
  assert.ok(s17.indexOf("Blackwell") < s17.indexOf("Software"), s17);
  ok("Katalysator und Upside sind ein Paar, der größte steht zuerst");

  const titled = buildSpeechSheet(buildPodcastFacts(pack("NVDA", {
    ticker: "NVDA",
    companyName: "NVIDIA",
    currency: "USD",
    currentPrice: 100,
    revenueSegments: [{ name: "Data Center", percentage: 80, fiscalYear: "2026" }],
    catalysts: [{ name: "Rubin-Plattform", nettoUpside: 9 }],
    risks: [{ name: "Wettbewerb durch Lilly" }, { name: "APAC-" }],
    _podcastInternals: { revenueY1: 1, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
  }), NOON), "en");
  const rawEn = titled.facts.map(fact => fact.spoken).join(" ");
  assert.match(rawEn, /Data Center/);
  assert.equal(/Rubin-Plattform|Wettbewerb|APAC-/.test(rawEn), false, rawEn);
  applyTitleMap(titled, [
    { raw: "Rubin-Plattform", text: "Rubin platform" },
    { raw: "Wettbewerb durch Lilly", text: "competition from Lilly" },
    { raw: "APAC-", text: "Asia Pacific" },
  ]);
  const translated = titled.facts.map(fact => fact.spoken).join(" ");
  assert.match(translated, /Rubin platform/);
  assert.match(translated, /competition from Lilly/);
  assert.equal(/Rubin-Plattform|Wettbewerb|APAC-|Asia Pacific/.test(translated), false, translated);
  applyTitleMap(titled, [{ raw: "Rubin-Plattform", text: "about twenty platforms" }]);
  assert.equal(/about twenty/.test(titled.facts.find(fact => fact.id === "pair_a")?.spoken ?? ""), false);
  ok("Rohtitel werden übersetzt oder weggelassen, Data Center bleibt Eigenname");

  const deKeep = buildSpeechSheet(buildPodcastFacts(nvda, NOON), "de");
  assert.match(deKeep.facts.find(fact => fact.id === "top_segment")?.spoken ?? "", /Data Center/);
  const absent = verifyChapter("news", "Die These liegt nicht vor und die Aktie bleibt im neuen Jahr der Maßstab für den Markt. Der Umsatz stützt die Bewertung im neuen Jahr.", deSheet);
  assert.equal(absent.ok, false);
  assert.ok(absent.reasons.includes("absent"));
  const live = spokenOf(nvda, "de");
  assert.equal(/liegt nicht vor|von das Unternehmen|APAC-|Das erste Risiko/.test(live), false);
  ok("Die alten Fehlstrings fallen auf dem Live-Pfad");

  resetPodcastScriptCache();
  const plausible = buildSpeechSheet(buildPodcastFacts(nvda, NOON), "de");
  const modelChapters = chaptersForSource("pdf")
    .filter(def => def.id !== "schluss" && factsForChapter(plausible, def.id).length)
    .map(def => ({ id: def.id, paragraph: fallbackParagraph(def.id, plausible), entities: ["NVIDIA"] }));
  for (const row of modelChapters) {
    const verdict = verifyChapter(row.id, row.paragraph, plausible);
    assert.equal(verdict.ok, true, `${row.id} ${verdict.reasons.join(",")} ${row.paragraph}`);
  }
  const accepted = await renderStockPodcastScript({
    pack: nvda,
    source: "pdf",
    language: "de",
    now: NOON,
    llm: async () => ({ data: { chapters: modelChapters }, modelUsed: "test" }),
  });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    const fallen = accepted.reports.filter(row => row.fallback);
    assert.equal(fallen.length, 0, JSON.stringify(fallen));
    assert.ok(accepted.reports.length > 0);
  }
  ok("Plausible Modellabsätze erzeugen keinen Code-Fallback");

  assert.equal(resolveStockPodcastVoice("de-DE-Harper:MAI-Voice-2.1", "en").id, "en-US-Harper:MAI-Voice-2.1");
  assert.equal(resolveStockPodcastVoice("de-DE-Grant:MAI-Voice-2.1", "en").id, "en-US-Grant:MAI-Voice-2.1");
  assert.equal(resolveStockPodcastVoice("de-DE-Mia:MAI-Voice-2.1", "en").id, "en-US-Harper:MAI-Voice-2.1");
  assert.equal(resolveStockPodcastVoice("de-DE-Klaus:MAI-Voice-2.1", "en").id, "en-US-Harper:MAI-Voice-2.1");
  assert.equal(resolveStockPodcastVoice("de-DE-Mia:MAI-Voice-2.1", "de").id, "de-DE-Mia:MAI-Voice-2.1");
  assert.equal(resolveStockPodcastVoice("en-US-Grant:MAI-Voice-2.1", "en").id, "en-US-Grant:MAI-Voice-2.1");
  ok("Harper und Grant bleiben, Mia und Klaus werden der englische Default Harper");

  assert.equal(/\b(Rechenzentren|Exportregeln|Hybridantrieb|Automobil|Wechselkurs)\b/.test(enNvda + enToyota), false, enNvda + enToyota);
  ok("Der englische Text behält keine deutschen Rohtitel");

  const gatePack = nvdaPack();
  (gatePack.analysis as any).nextEarningsDate = "2027-02-10";
  const gateDe = buildSpeechSheet(buildPodcastFacts(gatePack, NOON), "de");
  const gateEn = buildSpeechSheet(buildPodcastFacts(gatePack, NOON), "en");
  const deTail = [
    "Die Katalysatoren stützen die Firma im neuen Jahr.",
    "Der Markt öffnet die Lage und die Nachfrage trägt die Firma.",
    "Die Aktie bleibt der Maßstab und das Wachstum stützt die Bewertung.",
    "Wir sehen die Firma und der Kurs bleibt der Maßstab für den Markt.",
    "Die Bewertung ordnet die Aktie und die Nachfrage trägt die Geschichte.",
    "Der Vergleich bleibt fair und die Firma hält die Lage im Jahr.",
  ];
  const enTail = [
    "The market opened the year for the company and the firm. Demand grew with the firm in the verified market.",
    "The price sits near the verified level in the market this year. Demand grew with the company in the market.",
    "The firm moved ahead in the market this year with demand. The market grew with the company in the year.",
    "Demand grew in the market this year with the firm. The company opened the next chapter for the market.",
    "The market moved ahead with the company in the year. The firm grew with the verified demand in the market.",
    "The company sits in the market this year with demand. Demand opened the year for the firm in the market.",
  ];
  const chapterIds = ["einstieg", "zusammenfassung", "these", "umsatz", "dcf", "s17", "inversion", "earnings", "news"];
  let deFail = 0;
  let enFail = 0;
  let deN = 0;
  let enN = 0;
  for (const id of chapterIds) {
    const deBase = fallbackParagraph(id, gateDe);
    const enBase = fallbackParagraph(id, gateEn);
    for (let i = 0; i < 6; i++) {
      deN += 1;
      enN += 1;
      const deText = `${deBase} ${deTail[i]}`;
      const enText = `${enBase} ${enTail[i]}`;
      if (!verifyChapter(id, deText, gateDe).ok) deFail += 1;
      if (!verifyChapter(id, enText, gateEn).ok) enFail += 1;
    }
  }
  assert.equal(deN, 54);
  assert.equal(enN, 54);
  assert.ok(deFail / deN < 0.1, `DE Fallback ${deFail}/${deN}`);
  assert.ok(enFail / enN < 0.1, `EN Fallback ${enFail}/${enN}`);
  ok(`Gute Absätze bleiben unter zehn Prozent Fallback, DE ${deFail}/${deN}, EN ${enFail}/${enN}`);

  const negatives = [
    verifyChapter("zusammenfassung", "Der Umsatz wächst um zwanzig Prozent und die Firma bleibt der Maßstab. Die Aktie stützt die Bewertung im neuen Jahr.", gateDe),
    verifyChapter("zusammenfassung", "Revenue doubled and the company opened the year in the market. Demand grew with the verified view.", gateEn),
    verifyChapter("einstieg", "Die Firma nennt Toyota und der Satz bleibt der Maßstab für den Markt im neuen Jahr. Die Aktie stützt die Bewertung.", gateDe, ["Toyota"]),
    verifyChapter("einstieg", `Der Kurs steht bei [[price]] Dollar und die Firma bleibt der Maßstab im Jahr. Die Aktie stützt die Bewertung.`, gateDe),
    verifyChapter("einstieg", "Der [[as_of]] bleibt der Stand und die Firma trägt die Aktie im Jahr. Der Umsatz stützt die Bewertung.", gateDe),
  ];
  assert.equal(negatives.every(item => item.ok === false), true, negatives.map(item => item.notes.join("|")).join(" || "));
  const redo = fluentPrompt(gateDe, "pdf", [{ id: "einstieg", reasons: negatives[2]!.reasons, notes: negatives[2]!.notes }]);
  assert.match(redo.prompt, /name Toyota/);
  ok("Negativsätze fallen vollständig, das Rewrite nennt das Wort");

  assert.equal(/Dollar Dollar|Prozent Prozent|dollars dollars/.test(fallbackParagraph("einstieg", gateDe) + fallbackParagraph("umsatz", gateEn)), false);
  assert.equal(/^auf den /.test(gateDe.facts.find(fact => fact.id === "as_of")?.spoken ?? ""), false);
  assert.match(fallbackParagraph("einstieg", gateDe), /auf den /);
  assert.equal(/^as of /.test(gateEn.facts.find(fact => fact.id === "as_of")?.spoken ?? ""), false);
  assert.match(fallbackParagraph("einstieg", gateEn), /The figures are as of /);
  assert.equal(/dated as of/.test(fallbackParagraph("einstieg", gateEn)), false);
  assert.equal(fluentPrompt(gateDe, "pdf").prompt.includes("[[crv]]"), false);
  assert.match(fallbackParagraph("dcf", gateDe), /Das Chance-Risiko-Verhältnis liegt bei /);
  assert.match(fallbackParagraph("dcf", gateEn), /The chance-risk ratio stands at /);
  const aged = buildSpeechSheet(buildPodcastFacts(pack("NVDA", {
    ...gatePack.analysis,
    newsItems: [{ title: "Hinweis", pubDate: "2026-11-21T08:00:00.000Z" }],
  }), NOON), "de");
  assert.equal(/^vor /.test(aged.facts.find(fact => fact.id === "news_age")?.spoken ?? ""), false);
  assert.match(fallbackParagraph("news", aged), /ist .+ Tage alt/);
  const ageSentence = verifyChapter("news", "Die jüngste Meldung ist [[news_age]] alt und liegt im betrachteten Fenster der Firma. Der Kurs stützt die Bewertung.", aged);
  assert.equal(ageSentence.ok, true, ageSentence.notes.join("|"));
  assert.match(ageSentence.spoken, /ist fünf Tage alt/);
  assert.equal(/Du wählst auf den, für den, von oder vor/.test(fluentPrompt(aged, "pdf").prompt), false);
  assert.match(fluentPrompt(aged, "pdf").prompt, /ist das Alterstoken alt/);
  assert.equal(/von vor/.test(fallbackParagraph("news", aged)), false);
  const past = buildSpeechSheet(buildPodcastFacts(pack("NVDA", {
    ...gatePack.analysis,
    nextEarningsDate: "2020-01-01",
  }), NOON), "de");
  assert.equal(past.facts.some(fact => fact.id === "call_date"), false);
  const blank = buildSpeechSheet(buildPodcastFacts(pack("NVDA", {
    ...gatePack.analysis,
    s17Verdict: "n/a",
    companyName: "n/a",
  }), NOON), "de");
  assert.equal(blank.facts.some(fact => fact.id === "ampel" || fact.spoken === "n/a" || fact.spoken === "-"), false);
  assert.equal(speakPriceUsd(1, 3), "ein Dollar");
  assert.equal(speakPriceUsd(1.5, 3), "ein Komma fünf Dollar");
  assert.match(speakPriceUsd(1.5, 3) ?? "", /Dollar/);
  assert.equal((speakPriceUsd(1.5, 3) ?? "").match(/Dollar/g)?.length, 1);
  const oneEn = buildSpeechSheet(buildPodcastFacts(pack("NVDA", { ...gatePack.analysis, currentPrice: 1 }), NOON), "en");
  assert.equal(oneEn.facts.find(fact => fact.id === "price")?.spoken, "one dollar");
  assert.match(speakPriceUsd(1_500_000, 3) ?? "", /Million/);
  assert.equal(/\d/.test(speakPriceUsd(1_500_000, 3) ?? ""), false);
  assert.equal(priceLabelFor(149.3, 3, "en"), "149");
  assert.equal(priceLabelFor(149.3, 3, "de"), "149");
  assert.equal(priceLabelFor(1_500_000, 3, "en")?.includes(","), true);
  const article = verifyChapter("umsatz", "Das Wachstum ist ein [[fy_yoy]] und die Firma bleibt der Maßstab im Jahr. Die Aktie stützt die Bewertung.", gateDe);
  assert.equal(article.ok, false);
  assert.ok(article.reasons.includes("unit"));
  assert.equal(/the named risk|the next catalyst/.test(fallbackParagraph("inversion", gateEn) + fallbackParagraph("s17", gateEn)), false);
  assert.equal(/Exportregeln|Lieferengpass/.test(fallbackParagraph("inversion", gateEn)), false);
  assert.match(fallbackParagraph("s17", gateDe), /steht der Katalysator /);
  const lengthNote = verifyChapter("einstieg", "Kurz hier.", gateDe);
  assert.ok(lengthNote.notes.includes("fragment length"), lengthNote.notes.join("|"));
  assert.equal(lengthNote.notes.includes("fragment verb"), false);
  ok("Befunde 1 bis 9 gelten auf Deutsch und Englisch");

  const deTitles = chaptersFromDrafts(gateDe, "pdf", []).chapters;
  const enTitles = chaptersFromDrafts(gateEn, "pdf", [
    { id: "einstieg", attempts: 1, reasons: [], notes: [], spoken: fallbackParagraph("einstieg", gateEn) },
  ]).chapters;
  assert.equal(deTitles.find(c => c.id === "schluss")?.title, "Schluss");
  assert.equal(deTitles.find(c => c.id === "these")?.title, "These");
  assert.equal(enTitles.find(c => c.id === "einstieg")?.title, "Opening");
  assert.equal(enTitles.find(c => c.id === "einstieg")?.label, "Opening");
  assert.equal(enTitles.find(c => c.id === "schluss")?.title, "Closing");
  assert.equal(enTitles.find(c => c.id === "schluss")?.label, "Closing");
  const enKi = chaptersFromDrafts(gateEn, "ki", [
    { id: "news-llm", attempts: 1, reasons: [], notes: [], spoken: "The latest report dates from yesterday and stays inside the window we considered. This age is the verified timing of the report." },
    { id: "umsatz", attempts: 1, reasons: [], notes: [], spoken: fallbackParagraph("umsatz", gateEn) },
    { id: "s17", attempts: 1, reasons: [], notes: [], spoken: fallbackParagraph("s17", gateEn) },
  ]).chapters;
  assert.equal(enKi.find(c => c.id === "news-llm")?.title, "News link");
  assert.equal(enKi.find(c => c.id === "umsatz")?.title, "Revenue");
  assert.equal(enKi.find(c => c.id === "s17")?.title, "Catalysts");
  assert.equal(enKi.find(c => c.id === "schluss")?.title, "Closing");
  assert.equal(PDF_PODCAST_CHAPTERS.find(c => c.id === "einstieg")?.title, "Einstieg");
  ok("Englische Läufe tragen englische Kapiteltitel, die deutschen Titel bleiben");

  const probeAnalysis = {
    ...gatePack.analysis,
    dataTimestamp: "2026-11-26T11:00:00.000Z",
    waccPct: 14.1,
    impliedGStar: 11.4,
    catalysts: [
      { name: "Rechenzentren", nettoUpside: 12 },
      { name: "Software", nettoUpside: 4 },
    ],
    risks: [{ name: "Exportregeln" }, { name: "Lieferengpass" }],
    newsItems: [{ title: "Neue Rechenzentren", pubDate: "2026-11-25T08:00:00.000Z" }],
    lastReportedQuarter: "Q3 FY2026",
    nextEarningsDate: "2027-02-24",
    growthThesis: "NVIDIA bleibt der Spezialist für Rechenbeschleuniger und die Nachfrage trägt die Geschichte der Firma.",
  };
  const probeDe = buildSpeechSheet(buildPodcastFacts(pack("NVDA", probeAnalysis), NOON), "de");
  const probeEn = buildSpeechSheet(buildPodcastFacts(pack("NVDA", probeAnalysis), NOON), "en");
  const expandLegacy = (text: string, sheet: typeof probeDe) => {
    const spoken = (id: string) => sheet.facts.find(fact => fact.id === id)?.spoken ?? "";
    const name = (id: string) => spoken(id)
      .split(/ mit einem Potenzial von | with a potential of /)[0]
      ?.replace(/^(?:der größte Katalysator|ein weiterer Katalysator|the largest catalyst|another catalyst) /, "") ?? "";
    const upside = (id: string) => spoken(id).match(/(?:von|of) (.+)$/)?.[1] ?? "";
    const crv = sheet.codeLines.find(line => line.chapterId === "dcf")?.spoken.replace(/\.$/, "") ?? "";
    const thesis = sheet.codeLines.find(line => line.chapterId === "these")?.spoken ?? "";
    return text
      .replace(/\[\[catalyst_([abc])\]\]/g, (_all, key: string) => name(`pair_${key}`))
      .replace(/\[\[upside_([abc])\]\]/g, (_all, key: string) => upside(`pair_${key}`))
      .replace(/\[\[crv\]\]/g, crv)
      .replace(/\[\[thesis\]\]/g, thesis);
  };
  const properNames = (text: string) => text.split(/[^A-Za-zÄÖÜäöüß]+/).filter(word => /^(?:NVIDIA|Rechenzentren|Software|Data|Center|Exportregeln|Lieferengpass)$/.test(word));
  const countFallback = (pool: ProbePool, sheet: typeof probeDe, entitiesFor: (raw: string) => string[] | null) => {
    let total = 0;
    let fallen = 0;
    const names: string[] = [];
    for (const [id, rows] of Object.entries(pool)) {
      for (const row of rows) {
        const raw = expandLegacy(row, sheet);
        const verdict = verifyChapter(id, raw, sheet, entitiesFor(raw));
        total += 1;
        if (!verdict.ok) {
          fallen += 1;
          names.push(verdict.notes.filter(note => note.startsWith("name ")).join(",") || verdict.notes.join(","));
        }
      }
    }
    return { total, fallen, names };
  };
  const deBackup = countFallback(dePool, probeDe, () => null);
  const enBackup = countFallback(enPool, probeEn, () => null);
  const deExtracted = countFallback(dePool, probeDe, raw => properNames(raw));
  const enExtracted = countFallback(enPool, probeEn, raw => properNames(raw));
  const deEmpty = countFallback(dePool, probeDe, () => []);
  const deMissing = deBackup;
  const deGhost = (() => {
    let total = 0;
    let fallen = 0;
    for (const [id, rows] of Object.entries(dePool)) {
      for (const row of rows) {
        const raw = expandLegacy(row, probeDe);
        const verdict = verifyChapter(id, raw, probeDe, ["Zephyr"]);
        total += 1;
        if (!verdict.ok) fallen += 1;
      }
    }
    return { total, fallen };
  })();
  assert.ok(deBackup.fallen / deBackup.total <= 0.1, `DE backup ${deBackup.fallen}/${deBackup.total} ${deBackup.names.join(" || ")}`);
  assert.ok(enBackup.fallen / enBackup.total <= 0.1, `EN backup ${enBackup.fallen}/${enBackup.total}`);
  assert.equal(deExtracted.fallen, deBackup.fallen);
  assert.equal(enExtracted.fallen, enBackup.fallen);
  assert.equal(deEmpty.fallen, deBackup.fallen);
  assert.equal(deMissing.fallen, deBackup.fallen);
  assert.equal(deGhost.fallen, deBackup.fallen);
  const dc = [
    verifyChapter("s17", "Der stärkste Treiber für die Aktie ist [[pair_a]] und das stützt die Bewertung der Firma im Jahr.", probeDe),
    verifyChapter("s17", "Den zweiten Impuls liefert [[pair_b]] und der Markt bleibt offen für die Firma.", probeDe),
    verifyChapter("umsatz", "Im Geschäftsjahr [[gj_year]] wuchs der Umsatz um [[fy_yoy]] gegenüber dem Vorjahr und bleibt der belegte Vergleich.", probeDe),
  ];
  assert.equal(dc.every(item => item.ok), true, dc.map(item => item.notes.join("|")).join(" || "));
  const doubled = verifyChapter("einstieg", "Der Stand bezieht sich auf den [[as_of]] und bleibt an die Quelle gebunden. Der Kurs steht bei [[price]] und bleibt der Marktwert der Aktie.", probeDe);
  assert.equal(doubled.ok, true, doubled.notes.join("|"));
  assert.equal(/auf den auf den/.test(doubled.spoken), false, doubled.spoken);
  const stillDouble = verifyChapter("news", "Die Meldung stammt von vor fünf Tagen und bleibt im Fenster der Firma. Der Kurs stützt die Bewertung.", probeDe);
  assert.equal(stillDouble.ok, false);
  assert.ok(stillDouble.reasons.includes("prep"));
  const foreignNegatives: Array<[string, typeof probeDe, string, string[] | null]> = [
    ["umsatz", probeDe, "Das Umsatzwachstum im Geschäftsjahr [[gj_year]] hat sich verdoppelt und bleibt der Jahreswert. Das Segment bleibt die belegte Aufteilung der Firma.", null],
    ["umsatz", probeDe, "Der Gewinn der Firma wurde halbiert und bleibt der belegte Stand. Diese Lage ordnet die Aktie ein und bleibt an die Quelle gebunden.", null],
    ["umsatz", probeDe, "Das Wachstum ist dreifach so hoch und bleibt der Jahreswert der Firma. Diese Lage ordnet die Aktie ein und bleibt belegt.", null],
    ["umsatz", probeDe, "Das Wachstum beträgt fünfzig Prozent und bleibt der Jahreswert der Firma. Diese Lage ordnet die Aktie ein und bleibt belegt.", null],
    ["einstieg", probeDe, "Der Kurs steht bei [[price]] und bleibt der höchste Stand seit dem letzten Lauf. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden.", null],
    ["einstieg", probeDe, "Der Kurs steht bei [[price]] und bleibt ein Rekord für die Firma. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden.", null],
    ["umsatz", probeDe, "Das Umsatzwachstum im Geschäftsjahr [[gj_year]] beträgt [[fy_yoy]] Prozent und ist der belegte Jahreswert. Das Segment bleibt die belegte Aufteilung der Firma.", null],
    ["umsatz", probeDe, "Das Wachstum ist ein [[fy_yoy]] und bleibt der belegte Jahreswert der Firma. Diese Lage ordnet die Aktie ein und bleibt an die Quelle gebunden.", null],
    ["einstieg", probeDe, "Der [[as_of]] ist der belegte Stand und bleibt an die Quelle gebunden. Der Kurs steht bei [[price]] und bleibt der Marktwert der Aktie.", null],
    ["einstieg", probeDe, "Der Kurs steht bei n/a und bleibt der Marktwert der Aktie. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden.", null],
    ["einstieg", probeDe, "Wir sprechen heute über Apple, und der Kurs steht bei [[price]]. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden.", ["Apple"]],
    ["s17", probeDe, "An der Spitze steht [[pair_a]] und blackwell bleibt der zweite Treiber. Diese Liste bleibt der belegte Stand der Firma.", ["blackwell"]],
    ["dcf", probeDe, "Der faire Wert liegt bei [[dcf_fair]] und stammt aus der belegten Bewertung. Das Chance-Risiko-Verhältnis liegt bei minus eins Komma zwei und bleibt der belegte Satz.", null],
    ["umsatz", probeEn, "Revenue doubled in fiscal year [[gj_year]] and remains the verified annual figure. The segment stays the verified split of the company.", null],
    ["umsatz", probeEn, "Revenue is twice the prior year and remains the verified annual figure. The segment stays the verified split of the company.", null],
    ["umsatz", probeEn, "The margin is half the prior year and remains the verified figure. The segment stays the verified split of the company.", null],
    ["umsatz", probeEn, "Growth is twofold and remains the verified annual figure for the company. The segment stays the verified split of the company.", null],
    ["einstieg", probeEn, "The price stands at [[price]] and remains the highest since the prior year. The figures are dated [[as_of]] and stay tied to that date.", null],
    ["einstieg", probeEn, "The price stands at [[price]] and remains a record for the company. The figures are dated [[as_of]] and stay tied to that date.", null],
    ["einstieg", probeEn, "The price stands at [[price]] dollars and stays the verified market value. The figures are dated [[as_of]] and stay tied to that date.", null],
    ["einstieg", probeEn, "We look at Apple today and the price stands at [[price]]. The figures are dated [[as_of]] and stay tied to that date.", ["Apple"]],
    ["s17", probeEn, "At the top stands [[pair_a]] and blackwell remains the next driver. This list stays the verified set for the company.", ["blackwell"]],
    ["einstieg", probeDe, "Wir sprechen heute über Pfizer, und der Kurs steht bei [[price]]. Der Stand bezieht sich [[as_of]] und bleibt an die Quelle gebunden.", ["Pfizer"]],
    ["news", probeEn, "The latest report is 4 days old and stays inside the window we considered. The figures stay tied to that close.", null],
    ["umsatz", probeEn, "Revenue grew by 12 percent in fiscal year [[gj_year]] and remains the verified annual figure. The segment stays the verified split of the company.", null],
  ];
  const rejected = foreignNegatives.filter(([id, sheet, raw, entities]) => !verifyChapter(id, raw, sheet, entities).ok).length;
  const backupRejected = foreignNegatives.filter(([id, sheet, raw]) => !verifyChapter(id, raw, sheet, null).ok).length;
  assert.equal(foreignNegatives.length, 25);
  assert.equal(rejected, 25, `Negativ ${rejected}/25`);
  const deNames: Array<[string, string]> = [
    ["Toyota liefert den Impuls für die Firma und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "Toyota"],
    ["Im Vergleich zu Apple bleibt die Firma der Maßstab für den Markt im neuen Jahr. Der Umsatz stützt die Bewertung.", "Apple"],
    ["Pfizer drängt in den Markt und die Firma bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "Pfizer"],
    ["Zepbound bleibt der Vergleich für die Firma und der Kurs stützt die Bewertung im neuen Jahr. Die Aktie trägt die Nachfrage.", "Zepbound"],
  ];
  for (const [sentence, name] of deNames) {
    assert.equal(verifyChapter("einstieg", sentence, probeDe, []).reasons.includes("name"), true, sentence);
    assert.equal(verifyChapter("einstieg", sentence, probeDe, [name]).ok, false, sentence);
    const redo = applyRedo(probeDe, [{ id: "einstieg", attempts: 1, reasons: ["name"], notes: ["name alt"], spoken: "" }], {
      chapters: [{ id: "einstieg", paragraph: sentence, entities: [name] }],
    }, new Map([["einstieg", [name]]]));
    assert.ok(redo[0]?.reasons.includes("name"), sentence);
  }
  const enApple = "We look at Apple today and the price stays the verified level for the firm. The figures stay tied to that close.";
  assert.equal(verifyChapter("einstieg", enApple, probeEn, []).ok, false);
  const enStart = "Apple opened the session and the price stays the verified level for the firm. The figures stay tied to that close.";
  assert.equal(verifyChapter("einstieg", enStart, probeEn, []).reasons.includes("name"), false, enStart);
  assert.equal(verifyChapter("einstieg", enStart, probeEn, ["Apple"]).ok, false);
  const kept = "Toyota bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.";
  const dropped = "Die Firma bleibt der Maßstab für den Markt im neuen Jahr. Die Aktie stützt die Bewertung.";
  const prior = new Map<string, string[] | null>([["einstieg", ["Toyota"]]]);
  const emptyRedo = new Map<string, string[] | null>([["einstieg", []]]);
  const stillNamed = applyRedo(probeDe, [{ id: "einstieg", attempts: 1, reasons: ["name"], notes: ["name Toyota"], spoken: "" }], {
    chapters: [{ id: "einstieg", paragraph: kept }],
  }, emptyRedo, prior);
  assert.ok(stillNamed[0]?.reasons.includes("name"), stillNamed[0]?.notes.join("|"));
  const cleared = applyRedo(probeDe, [{ id: "einstieg", attempts: 1, reasons: ["name"], notes: ["name Toyota"], spoken: "" }], {
    chapters: [{ id: "einstieg", paragraph: dropped, entities: [] }],
  }, emptyRedo, prior);
  assert.equal(cleared[0]?.reasons.includes("name"), false, cleared[0]?.notes.join("|"));
  const paid = verifyChapter("umsatz", "Demand stays paid and the firm holds the verified view in the market. The signal stays with the company this year.", probeEn, ["AI"]);
  assert.equal(paid.reasons.includes("name"), false, paid.notes.join("|"));
  const geld = verifyChapter("zusammenfassung", "Das Geld der Firma bleibt der Maßstab für den Markt im neuen Jahr. Die Aktie stützt die Bewertung.", probeDe, ["GE"]);
  assert.equal(geld.reasons.includes("name"), false, geld.notes.join("|"));
  const geWord = verifyChapter("zusammenfassung", "Die GE bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", probeDe, ["GE"]);
  assert.equal(geWord.ok, false);
  const roseBy = verifyChapter("umsatz", "Revenue rose by [[fy_yoy]] in fiscal year [[gj_year]] and remains the verified annual figure. The segment stays the verified split of the company.", probeEn, []);
  assert.equal(roseBy.ok, true, roseBy.notes.join("|"));
  const blackPack = buildSpeechSheet(buildPodcastFacts(pack("NVDA", {
    ...probeAnalysis,
    newsItems: [{ title: "New Blackwell demand", pubDate: "2026-11-25T08:00:00.000Z" }],
    peerComparison: { peers: [{ name: "Lilly" }] },
  }), NOON), "de");
  const blackLeak = verifyChapter("einstieg", "Die Firma nennt blackwell und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", blackPack, []);
  assert.equal(blackLeak.ok, false, blackLeak.notes.join("|"));
  const lily = verifyChapter("inversion", "Die Firma sieht Lily und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", blackPack, []);
  assert.equal(lily.ok, false, lily.notes.join("|"));
  const ordinaryTitle = verifyChapter("einstieg", "Die Zulassung bleibt der Maßstab und die Phase stützt den Wettbewerb der Firma im neuen Jahr. Diabetes und die Preisregulierung bleiben der belegte Rahmen.", blackPack, []);
  assert.equal(ordinaryTitle.ok, true, ordinaryTitle.notes.join("|"));
  const enter = verifyChapter("umsatz", "Investors enter the fiscal year and the segment stays the verified split of the company. Demand remains the verified view.", probeEn, []);
  assert.equal(enter.ok, true, enter.notes.join("|"));
  const withFirm = "Wir sprechen heute über NVIDIA und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.";
  const firmEmpty = seedDrafts(probeDe, "pdf", { chapters: [{ id: "einstieg", paragraph: withFirm, entities: [] }] }, new Map([["einstieg", []]]));
  assert.ok(firmEmpty.find(draft => draft.id === "einstieg")?.reasons.includes("entities"), firmEmpty.find(draft => draft.id === "einstieg")?.notes.join("|"));
  const tokenOnly = "Wir sprechen heute über [[company]] und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.";
  const tokenEmpty = seedDrafts(probeDe, "pdf", { chapters: [{ id: "einstieg", paragraph: tokenOnly, entities: [] }] }, new Map([["einstieg", []]]));
  assert.equal(tokenEmpty.find(draft => draft.id === "einstieg")?.reasons.length, 0, tokenEmpty.find(draft => draft.id === "einstieg")?.notes.join("|"));
  const possessive = "Nvidias Kurs bleibt der Maßstab im neuen Jahr und die Aktie stützt die Bewertung. Der Markt bleibt offen für die Firma.";
  const possessiveEmpty = seedDrafts(probeDe, "pdf", { chapters: [{ id: "einstieg", paragraph: possessive, entities: [] }] }, new Map([["einstieg", []]]));
  assert.ok(possessiveEmpty.find(draft => draft.id === "einstieg")?.reasons.includes("entities"), possessiveEmpty.find(draft => draft.id === "einstieg")?.notes.join("|"));
  const tickerListed = verifyChapter("einstieg", "Der Kürzel NVDA bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", probeDe, ["NVDA"]);
  assert.equal(tickerListed.ok, true, tickerListed.notes.join("|"));
  const toyotaGen = verifyChapter("einstieg", "Der Konkurrent Toyotas bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", probeDe, ["Toyota"]);
  assert.equal(toyotaGen.ok, false, toyotaGen.notes.join("|"));
  assert.ok(toyotaGen.reasons.includes("name"), toyotaGen.notes.join("|"));
  const pfizerGen = verifyChapter("einstieg", "Pfizers neues Mittel bleibt der Vergleich für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", probeDe, ["Pfizer"]);
  assert.equal(pfizerGen.ok, false, pfizerGen.notes.join("|"));
  assert.ok(pfizerGen.reasons.includes("name"), pfizerGen.notes.join("|"));
  const nvidiaGen = verifyChapter("einstieg", "NVIDIAs Kurs bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", probeDe, ["NVIDIA"]);
  assert.equal(nvidiaGen.ok, true, nvidiaGen.notes.join("|"));
  const noName = "Die Firma bleibt der Maßstab für den Markt im neuen Jahr. Der Umsatz stützt die Bewertung und die Aktie trägt die Nachfrage.";
  const bareEmpty = seedDrafts(probeDe, "pdf", { chapters: [{ id: "zusammenfassung", paragraph: noName, entities: [] }] }, new Map([["zusammenfassung", []]]));
  assert.equal(bareEmpty.find(draft => draft.id === "zusammenfassung")?.reasons.includes("entities"), false, bareEmpty.find(draft => draft.id === "zusammenfassung")?.notes.join("|"));
  const redoEmpty = applyRedo(probeDe, [{ id: "einstieg", attempts: 1, reasons: ["entities"], notes: ["entities fehlt"], spoken: "" }], {
    chapters: [{ id: "einstieg", paragraph: withFirm, entities: [] }],
  }, new Map([["einstieg", []]]), new Map());
  assert.ok(redoEmpty[0]?.reasons.includes("entities"), redoEmpty[0]?.notes.join("|"));
  const appleBlackwell = "Im Vergleich zu Apple bleibt blackwell der zweite Treiber und der Kurs stützt die Bewertung im neuen Jahr. Die Aktie bleibt der Maßstab für die Firma.";
  assert.equal(verifyChapter("s17", appleBlackwell, probeDe, []).reasons.includes("name"), true);
  assert.equal(verifyChapter("s17", appleBlackwell, probeDe, ["Apple", "blackwell"]).ok, false);
  const plain = "Die Firma bleibt der Maßstab für den Markt im neuen Jahr. Der Umsatz stützt die Bewertung und die Aktie trägt die Nachfrage.";
  assert.equal(verifyChapter("zusammenfassung", plain, probeDe, ["Zephyr"]).ok, true);
  assert.equal(verifyChapter("umsatz", "Die Nachfrage bleibt laufend der Maßstab für die Firma im neuen Jahr. Der Umsatz stützt die Bewertung und das Wachstum trägt die Aktie.", probeDe, []).ok, true);
  const enPlain = verifyChapter("umsatz", "Demand stays strong and capacity remains the verified view for the company this year. The signal stays with the firm in the market.", probeEn, []);
  assert.equal(enPlain.ok, true, enPlain.notes.join("|"));
  assert.equal(enPlain.reasons.includes("name"), false);
  const oral = buildSpeechSheet(buildPodcastFacts(pack("NVDA", {
    ...probeAnalysis,
    catalysts: [{ name: "Orales Wegovy", nettoUpside: 9 }, { name: "Rechenzentren", nettoUpside: 4 }],
  }), NOON), "en");
  const oralSpoken = fallbackParagraph("s17", oral);
  assert.equal(/Orales|Wegovy|Rechenzentren/.test(oralSpoken), false, oralSpoken);
  assert.equal(/belegte Jahreswert|verified annual figure/.test(fallbackParagraph("umsatz", probeDe) + fallbackParagraph("umsatz", probeEn)), false);
  assert.match(fluentPrompt(probeEn, "pdf").systemPrompt, /entities/);
  assert.match(fluentPrompt(probeEn, "pdf").systemPrompt, /titles/);
  const million = buildSpeechSheet(buildPodcastFacts(pack("NVDA", { ...probeAnalysis, currentPrice: 1_500_000 }), NOON), "en");
  assert.match(million.facts.find(fact => fact.id === "price")?.spoken ?? "", /million/);
  assert.equal(/\d/.test(million.facts.find(fact => fact.id === "price")?.spoken ?? "1"), false);
  const deHost = [
    "Im Moment bleibt der Gegenwind spürbar und der Konzernumsatz stützt den Ausbau der Firma.",
    "Der Kursrückgang trifft die Aktionäre und der wichtigere Vergleich bleibt der Markt.",
    "Spannend ist der Ausbau und die Studiendaten stützen die Firma im neuen Jahr.",
    "Insgesamt bleibt der Konzernumsatz der Maßstab und der Gegenwind lässt nach.",
    "Die Aktionäre sehen den Moment und der Kursrückgang bleibt der wichtigere Punkt.",
    "Studiendaten stützen den Ausbau und der Konzernumsatz trägt die Firma weiter.",
    "Der Gegenwind bleibt spürbar und die Firma hält den Ausbau im neuen Jahr.",
    "Wichtiger als der Kursrückgang bleibt der Konzernumsatz für die Aktionäre.",
    "Spannend bleibt der Ausbau und die Studiendaten nennen den Moment für die Firma.",
    "Insgesamt trägt der Konzernumsatz die Firma und der Gegenwind bleibt begrenzt.",
    "Die Firma nennt den Ausbau und die Aktionäre bleiben der Maßstab im Markt.",
    "Der Moment bleibt ruhig und der Kursrückgang trifft die Firma nicht hart.",
    "Studiendaten und der Konzernumsatz stützen den Ausbau im neuen Jahr.",
    "Der wichtigere Punkt bleibt der Ausbau und die Aktionäre tragen die Firma.",
    "Gegenwind bleibt und der Konzernumsatz stützt die Firma trotz des Kursrückgangs.",
    "Insgesamt sehen die Aktionäre den Ausbau und die Studiendaten bleiben klar.",
    "Spannend bleibt der Moment und der Konzernumsatz trägt den Ausbau weiter.",
    "Der Kursrückgang bleibt der Gegenwind und die Firma hält die Aktionäre informiert.",
    "Die Studiendaten stützen den wichtigere Vergleich und der Ausbau bleibt der Plan.",
    "Im neuen Jahr bleibt der Konzernumsatz der Maßstab und der Moment ist ruhig.",
    "Aktionäre halten den Ausbau und der Gegenwind lässt den Kursrückgang klein.",
  ];
  const enHost = [
    "Headwinds remain closely watched and the moderate question stays with the firm.",
    "Debt stays moderate and the strongest demand holds the verified view this year.",
    "Overall the question stays moderate and the firm holds the demand in the market.",
    "The strongest demand stays closely tied to the firm and the question remains open.",
    "Headwinds stay moderate and demand remains the verified view for the company.",
    "Debt remains the question and the firm stays closely tied to the verified demand.",
    "Overall demand stays strong and the moderate headwinds remain with the firm.",
    "The question stays moderate and the strongest demand holds the company this year.",
    "Closely watched demand stays the verified view and the firm holds the market.",
    "Moderate headwinds remain and the question stays with the strongest demand.",
    "The firm holds demand and the moderate question stays closely watched this year.",
    "Demand remains moderate and the company stays the verified view in the market.",
    "The strongest headwinds stay moderate and demand remains the open question.",
    "Overall the firm stays with demand and the moderate question remains watched.",
    "Debt stays with the firm and demand remains the verified view for the market.",
    "The question remains moderate and demand stays closely tied to the company.",
    "Headwinds remain and the firm holds the strongest demand in the verified market.",
    "Moderate demand stays the view and the company holds the question this year.",
    "The firm remains with demand and the moderate headwinds stay closely watched.",
    "Overall demand remains moderate and the question stays the verified view.",
    "Closely held demand stays moderate and the firm remains the view this year.",
  ];
  const deHostFail = deHost.filter(text => !verifyChapter("zusammenfassung", text, probeDe, []).ok);
  const enHostFail = enHost.filter(text => !verifyChapter("zusammenfassung", text, probeEn, []).ok);
  assert.ok(deHost.length >= 20 && enHost.length >= 20);
  assert.ok(1 - deHostFail.length / deHost.length >= 0.9, deHostFail.join(" || "));
  assert.ok(1 - enHostFail.length / enHost.length >= 0.9, enHostFail.join(" || "));
  const nameBattery: Array<[string, string, typeof probeDe, string[] | null]> = [
    ["Toyota liefert den Impuls und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "einstieg", probeDe, ["Toyota"]],
    ["Die Firma liefert Toyota und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "einstieg", probeDe, ["Toyota"]],
    ["Apple bleibt der Vergleich und der Kurs stützt die Firma im neuen Jahr. Die Aktie trägt die Nachfrage.", "einstieg", probeDe, ["Apple"]],
    ["Im Vergleich zu Apple bleibt die Firma der Maßstab für den Markt. Der Umsatz stützt die Bewertung.", "einstieg", probeDe, ["Apple"]],
    ["Pfizer drängt und die Firma bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "einstieg", probeDe, ["Pfizer"]],
    ["Die Firma sieht Pfizer und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "einstieg", probeDe, ["Pfizer"]],
    ["Zepbound bleibt der Vergleich und der Kurs stützt die Firma im neuen Jahr. Die Aktie trägt die Nachfrage.", "einstieg", probeDe, ["Zepbound"]],
    ["Neben Zepbound bleibt die Firma der Maßstab für den Markt im neuen Jahr. Der Umsatz stützt die Bewertung.", "einstieg", probeDe, ["Zepbound"]],
    ["blackwell bleibt der zweite Treiber und der Kurs stützt die Firma im neuen Jahr. Die Aktie bleibt der Maßstab.", "s17", probeDe, ["blackwell"]],
    ["Die Firma nennt blackwell und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "s17", probeDe, ["blackwell"]],
    ["Toyota opened the session and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Toyota"]],
    ["We look at Toyota today and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Toyota"]],
    ["Apple opened the session and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Apple"]],
    ["We look at Apple today and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, null],
    ["Pfizer opened the session and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Pfizer"]],
    ["We look at Pfizer today and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Pfizer"]],
    ["Zepbound opened the session and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Zepbound"]],
    ["We look at Zepbound today and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Zepbound"]],
    ["Listeners meet blackwell and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["blackwell"]],
    ["The firm meets blackwell and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["blackwell"]],
    ["Novo bleibt der Vergleich und der Kurs stützt die Firma im neuen Jahr. Die Aktie trägt die Nachfrage.", "einstieg", probeDe, ["Novo"]],
    ["Die Firma sieht Novo und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", "einstieg", probeDe, ["Novo"]],
    ["Nordisk opened the session and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Nordisk"]],
    ["We look at Nordisk today and the price stays the verified level for the firm. The figures stay tied to that close.", "einstieg", probeEn, ["Nordisk"]],
    ["Lilly bleibt der Vergleich und der Kurs stützt die Firma im neuen Jahr. Die Aktie trägt die Nachfrage.", "einstieg", probeDe, ["Lilly"]],
  ];
  const nameRejected = nameBattery.filter(([text, id, sheet, entities]) => !verifyChapter(id, text, sheet, entities).ok).length;
  assert.equal(nameBattery.length, 25);
  assert.ok(nameRejected >= 24, `Namen ${nameRejected}/25`);
  const missingId = foreignNegatives.filter(([id, sheet, raw]) => {
    const drafts = seedDrafts(sheet, "pdf", { chapters: [{ id, paragraph: raw }] }, new Map());
    return drafts.some(draft => draft.id === id && draft.reasons.includes("entities"));
  }).length;
  assert.equal(missingId, 25, `fehlende ID ${missingId}/25`);
  const baseFacts = {
    currency: "USD",
    currentPrice: 100,
    dataTimestamp: "2026-11-26T11:00:00.000Z",
    s17Verdict: "GELB",
    dcfConservative: 120,
    crv: 1.1,
    maxEntryCrv3: 90,
    financialStatements: { incomeStatement: { revenueGrowth: 8 } },
    waccPct: 9,
    impliedGStar: 4,
    lastReportedQuarter: "Q3 FY2026",
    nextEarningsDate: "2027-02-24",
    _podcastInternals: { revenueY1: 1, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
  };
  const prosePacks: Array<{ ticker: string; analysis: Record<string, unknown>; regulatory?: unknown; de: string[]; en: string[] }> = [
    {
      ticker: "NVO",
      regulatory: { exposures: [{ country: "USA", title: "Preisregulierung", description: "Die Wirkung bleibt im Rahmen." }] },
      analysis: {
        ...baseFacts,
        ticker: "NVO",
        companyName: "Novo Nordisk",
        podcastCompanySource: "yahoo-chart",
        revenueSegments: [{ name: "Diabetes", percentage: 80, fiscalYear: "2026" }],
        geoSegments: [{ name: "USA", percentage: 55 }, { name: "EU", percentage: 30 }],
        catalysts: [{ name: "Zulassung in der Phase", nettoUpside: 8 }, { name: "Wettbewerb im Markt", nettoUpside: 3 }],
        risks: [{ name: "Preisregulierung" }, { name: "Marktstart" }],
        newsItems: [{ title: "Neue Zulassung", pubDate: "2026-11-25T08:00:00.000Z" }],
        growthThesis: "Die Nachfrage nach der Therapie trägt die Geschichte der Firma.",
      },
      de: [
        "Die Zulassung bleibt der Maßstab und die Phase stützt die Firma im neuen Jahr. Der Wettbewerb bleibt der belegte Rahmen.",
        "Diabetes bleibt der Markt und die Preisregulierung stützt die Einordnung der Firma. Der Marktstart bleibt der nächste Punkt.",
        "Die Phase der Zulassung bleibt offen und der Wettbewerb trägt die Firma weiter. Die Preisregulierung bleibt der belegte Rahmen.",
        "Der Marktstart folgt der Zulassung und die Firma hält den Wettbewerb im Blick. Diabetes bleibt der größte Block.",
        "Die Preisregulierung trifft den Markt und die Zulassung bleibt der Maßstab der Firma. Die Phase bleibt der belegte Stand.",
        "Wettbewerb und Zulassung bleiben die Lage und die Firma trägt den Marktstart weiter. Die Phase stützt die Einordnung.",
        "Die Phasen der Zulassung bleiben offen und die Firma trägt den Wettbewerb weiter. Die Preisregulierung bleibt der Rahmen.",
        "Die Zulassungen stützen den Markt und Diabetes bleibt der größte Block der Firma. Der Marktstart bleibt genannt.",
        "Die Märkte bleiben offen und die Preisregulierung stützt die Firma im neuen Jahr. Die Zulassung bleibt der Maßstab.",
        "Die Diabetes-Patienten stützen die Nachfrage und der Wettbewerb bleibt der Rahmen der Firma. Die Phase bleibt offen.",
        "Der Marktstart bleibt der nächste Punkt und die Zulassung stützt die Firma im neuen Jahr. Diabetes bleibt der Block.",
      ],
      en: [
        "Approval stays the verified view and the phase remains open for the firm this year. Competition holds the market.",
        "Diabetes stays the segment and price regulation remains the verified question. The launch stays the next point.",
        "The phase of approval remains open and competition holds the firm this year. Price regulation stays the view.",
        "The launch follows approval and the firm holds competition in view this year. Diabetes remains the split.",
        "Price regulation meets the market and approval stays the verified view for the firm. The phase remains open.",
        "Competition and approval remain the view and the firm holds the launch this year. The phase stays verified.",
        "The firm sells in the United States and demand remains the verified view this year. Competition holds the market.",
        "Demand in Europe stays verified and the United States remains the open question for the firm. The phase stays the view.",
        "Approval in the United States stays the verified question and the firm holds the launch this year. Diabetes remains the split.",
      ],
    },
    {
      ticker: "NVDA",
      analysis: {
        ...baseFacts,
        ticker: "NVDA",
        companyName: "NVIDIA",
        podcastCompanySource: "yahoo-chart",
        currentPrice: 149.3,
        dcfConservative: 180,
        revenueSegments: [{ name: "Data Center", percentage: 80, fiscalYear: "2026" }],
        catalysts: [{ name: "Rechenzentren", nettoUpside: 12 }, { name: "Software", nettoUpside: 4 }],
        risks: [{ name: "Exportregeln" }, { name: "Lieferengpass" }],
        newsItems: [{ title: "New Blackwell demand", pubDate: "2026-11-25T08:00:00.000Z" }],
        growthThesis: "Die Nachfrage nach Rechenbeschleunigern trägt die Geschichte der Firma.",
      },
      de: [
        "Die Rechenzentren bleiben der Maßstab und die Software stützt die Firma im neuen Jahr. Die Exportregeln bleiben der Rahmen.",
        "Der Lieferengpass trifft den Markt und die Software bleibt der belegte Stand der Firma. Die Rechenzentren tragen die Nachfrage.",
        "Exportregeln und Software bleiben die Lage und die Firma hält die Rechenzentren im Blick. Der Lieferengpass bleibt begrenzt.",
        "Die Software stützt den Ausbau und die Rechenzentren bleiben der größte Block der Firma. Die Exportregeln bleiben genannt.",
        "Der Lieferengpass bleibt der Gegenwind und die Software trägt die Firma im neuen Jahr. Die Rechenzentren stützen die Nachfrage.",
      ],
      en: [
        "Software stays the verified view and export rules remain the question for the firm. Demand holds the segment.",
        "The supply constraint meets the market and software remains the verified view this year. Demand stays open for the firm.",
        "Export rules and software remain the view and the firm holds demand in the market. The segment stays verified.",
        "Investors enter the year and software stays the verified split of the firm. Demand remains the open question.",
        "The moderate question stays with software and export rules remain the verified view. Demand holds the firm.",
      ],
    },
    {
      ticker: "MMM",
      analysis: {
        ...baseFacts,
        ticker: "MMM",
        companyName: "3M",
        podcastCompanySource: "yahoo-chart",
        revenueSegments: [{ name: "Safety", percentage: 40, fiscalYear: "2026" }],
        catalysts: [{ name: "Industrial adhesives", nettoUpside: 5 }, { name: "Klebstoff", nettoUpside: 2 }],
        risks: [{ name: "Price cuts" }, { name: "Preisdruck" }],
        newsItems: [{ title: "Higher prices", pubDate: "2026-11-25T08:00:00.000Z" }],
        growthThesis: "Die Nachfrage nach dem Klebstoff trägt die Geschichte der Firma.",
      },
      de: [
        "Der Klebstoff bleibt der Maßstab und der Preisdruck stützt die Firma im neuen Jahr. Der Wettbewerb bleibt der Rahmen.",
        "Die Zulassung bleibt offen und der Preisdruck trifft den Markt der Firma. Der Klebstoff trägt die Nachfrage.",
        "Wettbewerb und Preisdruck bleiben die Lage und die Firma hält den Klebstoff im Blick. Die Zulassung bleibt genannt.",
        "Der Preisdruck bleibt begrenzt und der Klebstoff stützt die Firma im neuen Jahr. Der Wettbewerb bleibt der Maßstab.",
        "Die Firma sieht den Preisdruck und der Klebstoff bleibt der belegte Stand im Markt. Die Zulassung stützt die Lage.",
      ],
      en: [
        "Price cuts stay the verified question and the firm holds demand in the market. Higher prices remain the view.",
        "Safety stays the segment and industrial adhesives remain the verified driver this year. Demand holds the firm.",
        "Higher prices meet the market and price cuts remain the moderate question for the firm. Demand stays open for the company.",
        "Industrial adhesives stay the view and the firm holds the safety segment this year. Prices remain moderate in the market.",
        "The firm enters the year and price cuts stay the verified question in the market. Demand remains the view.",
      ],
    },
  ];
  let proseOk = 0;
  let proseN = 0;
  const proseFail: string[] = [];
  for (const row of prosePacks) {
    const body = pack(row.ticker, row.analysis);
    if (row.regulatory) body.regulatory = row.regulatory;
    const deSheet = buildSpeechSheet(buildPodcastFacts(body, NOON), "de");
    const enSheet = buildSpeechSheet(buildPodcastFacts(body, NOON), "en");
    for (const text of row.de) {
      proseN += 1;
      const verdict = verifyChapter("einstieg", text, deSheet, []);
      if (verdict.ok) proseOk += 1;
      else proseFail.push(`${row.ticker} de: ${verdict.notes.join(",")}`);
    }
    for (const text of row.en) {
      proseN += 1;
      const verdict = verifyChapter("einstieg", text, enSheet, []);
      if (verdict.ok) proseOk += 1;
      else proseFail.push(`${row.ticker} en: ${verdict.notes.join(",")}`);
    }
  }
  assert.ok(proseOk / proseN >= 0.9, `${proseOk}/${proseN} ${proseFail.join(" || ")}`);
  const nvo = prosePacks[0];
  assert.equal(nvo?.de.length, 11);
  assert.equal(nvo?.en.length, 9);
  const nvoBody = pack("NVO", nvo?.analysis ?? {});
  nvoBody.regulatory = nvo?.regulatory;
  const nvoDe = buildSpeechSheet(buildPodcastFacts(nvoBody, NOON), "de");
  const nvoEn = buildSpeechSheet(buildPodcastFacts(nvoBody, NOON), "en");
  const nvoDeOk = (nvo?.de ?? []).filter(text => verifyChapter("einstieg", text, nvoDe, []).ok).length;
  const nvoEnOk = (nvo?.en ?? []).filter(text => verifyChapter("einstieg", text, nvoEn, []).ok).length;
  assert.equal(nvoDeOk, 11, proseFail.filter(line => line.startsWith("NVO")).join(" || "));
  assert.equal(nvoEnOk, 9, proseFail.filter(line => line.startsWith("NVO")).join(" || "));
  const usSentence = "The firm sells in the United States and demand remains the verified view this year. Competition holds the market.";
  const usListed = verifyChapter("einstieg", usSentence, nvoEn, ["United States"]);
  assert.equal(usListed.ok, true, usListed.notes.join("|"));
  const usaListed = verifyChapter("einstieg", usSentence, nvoEn, ["USA"]);
  assert.equal(usaListed.ok, true, usaListed.notes.join("|"));
  const bend = buildSpeechSheet(buildPodcastFacts(pack("NVO", {
    ...baseFacts,
    ticker: "NVO",
    companyName: "Novo Nordisk",
    podcastCompanySource: "yahoo-chart",
    revenueSegments: [{ name: "Diabetes", percentage: 80, fiscalYear: "2026" }],
    catalysts: [{ name: "Wettbewerb im Markt", nettoUpside: 4 }],
    risks: [{ name: "Phase" }, { name: "Zulassung" }, { name: "Markt" }],
    newsItems: [{ title: "Lilly und Diabetes", pubDate: "2026-11-25T08:00:00.000Z" }],
    growthThesis: "Die Nachfrage trägt die Geschichte der Firma.",
  }), NOON), "de");
  const lilyBare = verifyChapter("einstieg", "Die Firma sieht Lily und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", bend, []);
  assert.equal(lilyBare.ok, false, lilyBare.notes.join("|"));
  const lillyExact = verifyChapter("einstieg", "Die Firma sieht Lilly und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", bend, []);
  assert.equal(lillyExact.ok, true, lillyExact.notes.join("|"));
  const bent = verifyChapter("einstieg", "Die Phasen bleiben offen und die Zulassungen stützen die Firma im neuen Jahr. Die Märkte tragen die Nachfrage.", bend, []);
  assert.equal(bent.ok, true, bent.notes.join("|"));
  const patients = verifyChapter("einstieg", "Die Diabetes-Patienten stützen die Firma und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie trägt die Nachfrage.", bend, []);
  assert.equal(patients.ok, true, patients.notes.join("|"));
  const bare = {
    ...baseFacts,
    ticker: "NVO",
    companyName: "Novo Nordisk",
    podcastCompanySource: "yahoo-chart",
    revenueSegments: [{ name: "Diabetes", percentage: 80, fiscalYear: "2026" }],
    catalysts: [{ name: "Zulassung in der Phase", nettoUpside: 4 }],
    risks: [{ name: "Preisregulierung" }],
    newsItems: [{ title: "Neue Zulassung", pubDate: "2026-11-25T08:00:00.000Z" }],
    growthThesis: "Die Nachfrage trägt die Geschichte der Firma.",
  };
  const bareEn = buildSpeechSheet(buildPodcastFacts(pack("NVO", bare), NOON), "en");
  const bareDe = buildSpeechSheet(buildPodcastFacts(pack("NVO", bare), NOON), "de");
  const kingdom = verifyChapter("einstieg", "The firm sells in the United Kingdom and demand remains the verified view this year. Competition holds the market.", bareEn, []);
  assert.equal(kingdom.ok, true, kingdom.notes.join("|"));
  const states = verifyChapter("einstieg", "Vereinigte Staaten bleiben der größte Markt der Firma im neuen Jahr. Der Kurs stützt die Bewertung.", bareDe, []);
  assert.equal(states.ok, true, states.notes.join("|"));
  const nordiskGen = verifyChapter("einstieg", "Novo Nordisks Kurs bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung und der Markt bleibt offen.", bareDe, ["Novo Nordisk"]);
  assert.equal(nordiskGen.ok, true, nordiskGen.notes.join("|"));
  const nordiskLiteral = verifyChapter("einstieg", "Wir sprechen heute über Novo Nordisk und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", bareDe, ["Novo Nordisk"]);
  assert.equal(nordiskLiteral.ok, true, nordiskLiteral.notes.join("|"));
  const lillyBody = pack("LLY", {
    ...baseFacts,
    ticker: "LLY",
    companyName: "Eli Lilly",
    podcastCompanySource: "yahoo-chart",
    revenueSegments: [{ name: "Diabetes", percentage: 60, fiscalYear: "2026" }],
    catalysts: [{ name: "Zulassung", nettoUpside: 5 }],
    risks: [{ name: "Preisregulierung" }],
    newsItems: [{ title: "Neue Zulassung", pubDate: "2026-11-25T08:00:00.000Z" }],
    growthThesis: "Die Nachfrage trägt die Geschichte der Firma.",
  });
  const lillyDe = buildSpeechSheet(buildPodcastFacts(lillyBody, NOON), "de");
  const lillyLiteral = verifyChapter("einstieg", "Wir sprechen heute über Eli Lilly und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.", lillyDe, ["Eli Lilly"]);
  assert.equal(lillyLiteral.ok, true, lillyLiteral.notes.join("|"));
  const lillyEn = buildSpeechSheet(buildPodcastFacts(lillyBody, NOON), "en");
  const allowedPossessives: Array<[string, typeof bareEn, string[] | null]> = [
    ["We look at Novo Nordisk's stock and demand remains the verified view this year. The firm holds the market.", bareEn, null],
    ["We look at Novo Nordisk's stock and demand remains the verified view this year. The firm holds the market.", bareEn, []],
    ["We look at Novo Nordisk's stock and demand remains the verified view this year. The firm holds the market.", bareEn, ["Novo Nordisk"]],
    ["We look at Novo's stock and demand remains the verified view this year. The firm holds the market.", bareEn, null],
    ["We look at Lilly's drug and demand remains the verified view this year. The firm holds the market.", lillyEn, []],
    ["We look at NVIDIA's stock and demand remains the verified view this year. The firm holds the market.", probeEn, null],
    ["Demand in the United States' market remains the verified view this year. The firm holds the launch.", bareEn, []],
  ];
  for (const [sentence, sheet, entities] of allowedPossessives) {
    const verdict = verifyChapter("einstieg", sentence, sheet, entities);
    assert.equal(verdict.ok, true, `${sentence} ${verdict.notes.join("|")}`);
  }
  const blockedPossessives: Array<[string, typeof probeEn, string[] | null]> = [
    ["We look at Toyota's stock and demand remains the verified view this year. The firm holds the market.", probeEn, null],
    ["We look at Toyota's stock and demand remains the verified view this year. The firm holds the market.", probeEn, ["Toyota"]],
    ["We look at Apple's stock and demand remains the verified view this year. The firm holds the market.", probeEn, []],
    ["We look at Apple's stock and demand remains the verified view this year. The firm holds the market.", probeEn, ["Apple"]],
    ["We look at China Mobile's sales and demand remains the verified view this year. The firm holds the market.", probeEn, ["China Mobile"]],
  ];
  for (const [sentence, sheet, entities] of blockedPossessives) {
    const verdict = verifyChapter("einstieg", sentence, sheet, entities);
    assert.equal(verdict.ok, false, `${sentence} ${verdict.notes.join("|")}`);
    assert.ok(verdict.reasons.includes("name"), `${sentence} ${verdict.notes.join("|")}`);
  }
  const lillyRiskEn = buildSpeechSheet(buildPodcastFacts(pack("NVO", {
    ...baseFacts,
    ticker: "NVO",
    companyName: "Novo Nordisk",
    podcastCompanySource: "yahoo-chart",
    revenueSegments: [{ name: "Diabetes", percentage: 80, fiscalYear: "2026" }],
    catalysts: [{ name: "Zulassung in der Phase", nettoUpside: 4 }],
    risks: [{ name: "Wettbewerb durch Lilly" }],
    newsItems: [{ title: "Neue Zulassung", pubDate: "2026-11-25T08:00:00.000Z" }],
    growthThesis: "Die Nachfrage trägt die Geschichte der Firma.",
  }), NOON), "en");
  for (const entities of [null, [], ["Lilly"]] as Array<string[] | null>) {
    for (const sentence of [
      "We look at Lilly's drug and demand remains the verified view this year. The firm holds the market.",
      "We look at Lilly’s drug and demand remains the verified view this year. The firm holds the market.",
    ]) {
      const verdict = verifyChapter("einstieg", sentence, lillyRiskEn, entities);
      assert.equal(verdict.ok, true, `${entities === null ? "null" : entities.join(",") || "[]"} ${verdict.notes.join("|")}`);
    }
  }
  const riskBlocked: Array<[string, string[] | null]> = [
    ["We look at Toyota's stock and demand remains the verified view this year. The firm holds the market.", null],
    ["We look at Toyota's stock and demand remains the verified view this year. The firm holds the market.", ["Toyota"]],
    ["We look at Apple's stock and demand remains the verified view this year. The firm holds the market.", []],
    ["We look at Apple's stock and demand remains the verified view this year. The firm holds the market.", ["Apple"]],
    ["We look at Lily's drug and demand remains the verified view this year. The firm holds the market.", []],
    ["We look at Nordisk Capital's plan and demand remains the verified view this year. The firm holds the market.", ["Nordisk Capital"]],
    ["We look at United Pharma's drug and demand remains the verified view this year. The firm holds the market.", null],
  ];
  for (const [sentence, entities] of riskBlocked) {
    const verdict = verifyChapter("einstieg", sentence, lillyRiskEn, entities);
    assert.equal(verdict.ok, false, `${sentence} ${verdict.notes.join("|")}`);
    assert.ok(verdict.reasons.includes("name"), `${sentence} ${verdict.notes.join("|")}`);
  }
  const partials: Array<[string, string]> = [
    ["Der Vergleich China Mobile bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", "China Mobile"],
    ["Der Vergleich Nvidia Labs bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", "Nvidia Labs"],
    ["Der Vergleich NVDA Capital bleibt der Maßstab für die Firma im neuen Jahr. Die Aktie stützt die Bewertung.", "NVDA Capital"],
  ];
  for (const [sentence, name] of partials) {
    const verdict = verifyChapter("einstieg", sentence, probeDe, [name]);
    assert.equal(verdict.ok, false, `${name} ${verdict.notes.join("|")}`);
    assert.ok(verdict.reasons.includes("name"), `${name} ${verdict.notes.join("|")}`);
  }
  const nvoNames = buildSpeechSheet(buildPodcastFacts(pack("NVO", {
    ...baseFacts,
    ticker: "NVO",
    companyName: "Novo Nordisk",
    podcastCompanySource: "yahoo-chart",
    revenueSegments: [{ name: "Diabetes", percentage: 80, fiscalYear: "2026" }],
    catalysts: [{ name: "Zulassung in der Phase", nettoUpside: 4 }],
    risks: [{ name: "Wettbewerb durch Lilly" }],
    newsItems: [{ title: "Ozempic", pubDate: "2026-11-25T08:00:00.000Z" }],
    growthThesis: "Die Nachfrage trägt die Geschichte der Firma.",
  }), NOON), "de");
  const atStart = (name: string) => `${name} bleibt in diesem Jahr der Vergleich für die Firma und der Kurs stützt die Bewertung. Die Aktie trägt die Nachfrage.`;
  const inMiddle = (name: string) => `Die Firma sieht ${name} und der Kurs bleibt der Maßstab für den Markt im neuen Jahr. Die Aktie stützt die Bewertung.`;
  for (const name of ["Toyota", "Apple", "Pfizer", "Zepbound", "Mounjaro", "Lily"]) {
    for (const sentence of [atStart(name), inMiddle(name)]) {
      for (const entities of [null, []] as Array<string[] | null>) {
        const verdict = verifyChapter("einstieg", sentence, nvoNames, entities);
        assert.equal(verdict.ok, false, `${name} ${entities === null ? "null" : "[]"} ${verdict.notes.join("|")}`);
        assert.ok(verdict.reasons.includes("name"), `${name} ${verdict.notes.join("|")}`);
      }
      const listed = verifyChapter("einstieg", sentence, nvoNames, [name]);
      assert.equal(listed.ok, false, `${name} liste ${listed.notes.join("|")}`);
      const missing = seedDrafts(nvoNames, "pdf", { chapters: [{ id: "einstieg", paragraph: sentence }] }, new Map());
      assert.ok(missing.some(draft => draft.id === "einstieg" && draft.reasons.length > 0), name);
    }
  }
  for (const name of ["Lilly", "Ozempic", "Novo Nordisk"]) {
    for (const sentence of [atStart(name), inMiddle(name)]) {
      for (const entities of [null, []] as Array<string[] | null>) {
        const verdict = verifyChapter("einstieg", sentence, nvoNames, entities);
        assert.equal(verdict.ok, true, `${name} ${entities === null ? "null" : "[]"} ${verdict.notes.join("|")}`);
      }
    }
  }
  for (const word of ["Aktienkurs", "Handel", "Tag"]) {
    const verdict = verifyChapter("einstieg", inMiddle(word), nvoNames, []);
    assert.equal(verdict.ok, true, `${word} ${verdict.notes.join("|")}`);
  }
  const actorFrames = (name: string) => [
    `Der stärkste Treiber ist der Markt, und auch ${name} beobachtet den Markt sehr genau. Die Aktie stützt die Bewertung.`,
    `${name} steigt ebenfalls in den Markt ein, und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.`,
    `Der Rivale ${name} holt im Markt auf, und der Kurs bleibt der Maßstab im neuen Jahr. Die Aktie stützt die Bewertung.`,
  ];
  for (const name of ["Allianz", "Linde", "Bayer", "Volkswagen", "Henkel", "Lufthansa", "Rheinmetall", "Beiersdorf", "Siemens", "Novartis"]) {
    for (const sentence of actorFrames(name)) {
      for (const entities of [null, [], [name]] as Array<string[] | null>) {
        const verdict = verifyChapter("einstieg", sentence, nvoNames, entities);
        assert.equal(verdict.ok, false, `${name} ${entities === null ? "null" : entities.join(",") || "[]"} ${verdict.notes.join("|")}`);
        assert.ok(verdict.reasons.includes("name"), `${name} ${verdict.notes.join("|")}`);
      }
    }
  }
  for (const sentence of actorFrames("Lilly")) {
    for (const entities of [null, [], ["Lilly"]] as Array<string[] | null>) {
      const verdict = verifyChapter("einstieg", sentence, nvoNames, entities);
      assert.equal(verdict.ok, true, `Lilly ${entities === null ? "null" : entities.join(",") || "[]"} ${verdict.notes.join("|")}`);
    }
  }
  const pharma = verifyChapter("einstieg", "The firm meets United Pharma and demand remains the verified view this year. Competition holds the market.", bareEn, []);
  assert.equal(pharma.ok, false, pharma.notes.join("|"));
  assert.ok(pharma.reasons.includes("name"), pharma.notes.join("|"));
  const passed = foreignNegatives.filter(([id, sheet, raw, entities]) => verifyChapter(id, raw, sheet, entities).ok)
    .map(([id, , raw]) => `${id}: ${raw.slice(0, 80)}`);
  const sheetNameRejected = foreignNegatives.filter(([id, sheet, raw]) => !verifyChapter(id, raw, sheet, ["NVIDIA", "Rechenzentren", "Software", "Data", "Center"]).ok).length;
  const emptyListRejected = foreignNegatives.filter(([id, sheet, raw]) => !verifyChapter(id, raw, sheet, []).ok).length;
  const emptyListPipeline = foreignNegatives.filter(([id, sheet, raw]) => {
    const drafts = seedDrafts(sheet, "pdf", { chapters: [{ id, paragraph: raw, entities: [] }] }, new Map([[id, []]]));
    return drafts.some(draft => draft.id === id && draft.reasons.includes("entities"));
  }).length;
  const emptyPath = (pool: ProbePool, sheet: typeof probeDe) => {
    let total = 0;
    let fallen = 0;
    for (const [id, rows] of Object.entries(pool)) {
      for (const row of rows) {
        const raw = expandLegacy(row, sheet);
        total += 1;
        const drafts = seedDrafts(sheet, "pdf", { chapters: [{ id, paragraph: raw, entities: [] }] }, new Map([[id, []]]));
        const draft = drafts.find(item => item.id === id);
        if (draft?.reasons.length) fallen += 1;
      }
    }
    return { total, fallen };
  };
  const deEmptyPath = emptyPath(dePool, probeDe);
  const enEmptyPath = emptyPath(enPool, probeEn);
  assert.ok(deEmptyPath.fallen / deEmptyPath.total <= 0.1, `DE []-Pfad ${deEmptyPath.fallen}/${deEmptyPath.total}`);
  assert.ok(enEmptyPath.fallen / enEmptyPath.total <= 0.1, `EN []-Pfad ${enEmptyPath.fallen}/${enEmptyPath.total}`);
  ok(`Fremde Prosa DE ${deBackup.fallen}/${deBackup.total}, EN ${enBackup.fallen}/${enBackup.total}. []-Pfad DE ${deEmptyPath.fallen}/${deEmptyPath.total}, EN ${enEmptyPath.fallen}/${enEmptyPath.total}. Titelprosa ${proseOk}/${proseN}, Nah-Basis-Fehltreffer ${proseFail.length}. Host DE ${deHost.length - deHostFail.length}/${deHost.length}, EN ${enHost.length - enHostFail.length}/${enHost.length}. Negativ voll ${rejected}/25, Blatt ${sheetNameRejected}/25, [] ${emptyListRejected}/25, []-Redo ${emptyListPipeline}/25, fehlende ID ${missingId}/25, Namensatz ${nameRejected}/25. Durch bei voll: ${passed.join(" || ") || "keine"}. NVO DE ${nvoDeOk}/11, EN ${nvoEnOk}/9.`);

  writeFileSync("/tmp/podcast-examples.txt", [
    "NVDA DE", deNvda, "",
    "NVDA EN", enNvda, "",
    "7203.T DE", deToyota, "",
    "7203.T EN", enToyota, "",
  ].join("\n"));
  console.log(`ki-podcast fluent: ${n} checks ok`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
