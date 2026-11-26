/**
 * Flüssiger Absatz je Kapitel, Prüfung mit Neuschreiben, Deutsch und Englisch.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-fluent.ts
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DCF_CALIBRATION } from "../shared/dcf-calibration";
import { buildPodcastFacts } from "../shared/podcast-facts";
import {
  buildSpeechSheet,
  fallbackParagraph,
  factsForChapter,
  fluencyStats,
  fluentPrompt,
  podcastSentences,
  verifyChapter,
} from "../shared/podcast-fluent";
import { OPENROUTER_PODCAST_VOICES_EN, PODCAST_DISCLAIMER, PODCAST_DISCLAIMER_EN } from "../shared/podcast-types";
import { chaptersForSource } from "../shared/podcast-script";
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
  assert.ok(deSheet.facts.some(fact => fact.id === "crv" && fact.spoken.startsWith("Das Chance-Risiko-Verhältnis liegt bei ")));
  assert.equal(deSheet.facts.some(fact => fact.id === "missing"), false);
  const prompt = fluentPrompt(deSheet, "pdf");
  assert.equal(/\d/.test(prompt.prompt.replace(/\bs17\b/g, "")), false, prompt.prompt);
  assert.equal(/currentPrice|revenueGrowth|fiscalYear|nettoUpside|dataTimestamp/.test(prompt.prompt), false);
  ok("Faktenblatt trägt Quelle und Sprechform, der Prompt sieht keine Rohzahl und keinen Feldnamen");

  for (const def of chaptersForSource("pdf")) {
    if (def.id === "schluss") continue;
    const paragraph = fallbackParagraph(def.id, deSheet);
    if (!factsForChapter(deSheet, def.id).length) {
      assert.equal(paragraph, "");
      continue;
    }
    const verdict = verifyChapter(def.id, paragraph, deSheet);
    assert.equal(verdict.ok, true, `${def.id} ${verdict.reasons.join(",")} ${paragraph}`);
    const stats = fluencyStats(paragraph);
    assert.ok(stats.sentences >= 2 && stats.avg >= 8 && stats.short === 0, def.id);
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
  assert.equal(verifyChapter("umsatz", enUmsatz, enSheet).ok, true, enUmsatz);
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

  const invented = verifyChapter("s13", "Toyota hat starke Patente und Apple kauft Novo Nordisk. Der Satz bleibt trotzdem lang genug für die Prüfung hier.", deSheet);
  assert.equal(invented.ok, false);
  assert.ok(invented.reasons.includes("name"));
  ok("Ein neuer Eigenname wird verworfen und nicht stillschweigend gesprochen");

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
      return { data: { chapters: [{ id: "umsatz", paragraph: good }] }, modelUsed: "test" };
    },
  });
  assert.equal(regenerated.ok, true);
  if (regenerated.ok) {
    const report = regenerated.reports.find(row => row.id === "umsatz");
    assert.equal(report?.attempts, 2);
    assert.equal(report?.fallback, null);
    assert.equal(/\d/.test(regenerated.chapters.find(c => c.id === "umsatz")?.spoken ?? ""), false);
    assert.equal(JSON.stringify(regenerated.reports).includes("Wachstum"), false);
  }
  assert.equal(calls, 2);
  ok("Ein kaputtes Kapitel wird einmal neu geschrieben und der Bericht nennt nur Versuch und Grund");

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
