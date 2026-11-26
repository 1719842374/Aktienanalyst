/**
 * TTS-Vertrag: OpenRouter-Stimmen, Cache, xAI nur mit Key. Kein echter Netz-Call.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY -u XAI_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-audio.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPENROUTER_TTS_MODEL, OPENROUTER_TTS_URL, XAI_TTS_URL } from "../shared/podcast-types";
import {
  podcastAudioCacheId,
  resetPodcastAudioCache,
  synthesizePodcastAudio,
  type PodcastAudioFetch,
} from "../server/stock-podcast-audio";
import { handleStockPodcastAudio, resetStockPodcastRouteState } from "../server/stock-podcast-route";
import { renderStockPodcastScript } from "../server/stock-podcast-script";
import type { FullAiPack } from "../server/stock-podcast-full-ai";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

const MP3 = Uint8Array.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

function responder(status: number, body: Uint8Array | string): Awaited<ReturnType<PodcastAudioFetch>> {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return { ok: status >= 200 && status < 300, status, bytes: async () => bytes };
}

async function main() {
  const voices = ["de-DE-Mia:MAI-Voice-2.1", "de-DE-Klaus:MAI-Voice-2.1", "de-DE-Harper:MAI-Voice-2.1", "de-DE-Grant:MAI-Voice-2.1"];
  const doc = readFileSync(new URL("../server/stock-podcast-audio.ts", import.meta.url), "utf8");
  for (const voice of voices) assert.ok(doc.includes(voice) || readFileSync(new URL("../shared/podcast-types.ts", import.meta.url), "utf8").includes(voice));
  assert.equal(OPENROUTER_TTS_MODEL, "microsoft/mai-voice-2.1");
  assert.equal(OPENROUTER_TTS_URL, "https://openrouter.ai/api/v1/audio/speech");
  ok("Modell und deutsche Stimmen entsprechen dem OpenRouter-Katalog");

  resetPodcastAudioCache();
  let calls = 0;
  const seen: Array<{ url: string; body: any }> = [];
  const fetchImpl: PodcastAudioFetch = async (url, init) => {
    calls += 1;
    seen.push({ url, body: JSON.parse(init.body) });
    assert.equal(JSON.stringify(init.headers).includes("test-openrouter-key"), true);
    return responder(200, MP3);
  };
  const first = await synthesizePodcastAudio({
    text: "Dies ist keine Anlageberatung.",
    voiceId: "de-DE-Mia:MAI-Voice-2.1",
    cacheId: "spa|NVDA|2026-11-26|pdf|mia|schluss|abc",
    env: { openrouterKey: "test-openrouter-key", xaiKey: "" },
    fetchImpl,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.cached, false);
    assert.equal(first.provider, "openrouter");
    assert.ok(first.audio.length > 8);
  }
  assert.equal(seen[0]?.url, OPENROUTER_TTS_URL);
  assert.equal(seen[0]?.body.model, "microsoft/mai-voice-2.1");
  assert.equal(seen[0]?.body.voice, "de-DE-Mia:MAI-Voice-2.1");
  assert.equal(seen[0]?.body.response_format, "mp3");
  const second = await synthesizePodcastAudio({
    text: "Dies ist keine Anlageberatung.",
    voiceId: "de-DE-Mia:MAI-Voice-2.1",
    cacheId: "spa|NVDA|2026-11-26|pdf|mia|schluss|abc",
    env: { openrouterKey: "test-openrouter-key", xaiKey: "" },
    fetchImpl,
  });
  assert.equal(second.ok && second.cached, true);
  assert.equal(calls, 1);
  ok("OpenRouter liefert audio/mpeg, der zweite Treffer geht nicht noch einmal ins Netz");

  const otherVoice = podcastAudioCacheId({
    ticker: "NVDA", day: "2026-11-26", source: "pdf", voice: "de-DE-Klaus:MAI-Voice-2.1", chapterId: "schluss", spoken: "Dies ist keine Anlageberatung.",
  });
  const mia = podcastAudioCacheId({
    ticker: "NVDA", day: "2026-11-26", source: "pdf", voice: "de-DE-Mia:MAI-Voice-2.1", chapterId: "schluss", spoken: "Dies ist keine Anlageberatung.",
  });
  assert.notEqual(otherVoice, mia);
  ok("Audio-Cache hängt an Ticker, Tag, Quelle, Stimme und Kapiteltext");

  resetPodcastAudioCache();
  calls = 0;
  seen.length = 0;
  const fetchFail: PodcastAudioFetch = async (url, init) => {
    calls += 1;
    seen.push({ url, body: JSON.parse(init.body) });
    if (url.includes("openrouter")) return responder(402, "no");
    return responder(200, MP3);
  };
  const noXai = await synthesizePodcastAudio({
    text: "Hallo.",
    voiceId: "de-DE-Mia:MAI-Voice-2.1",
    cacheId: "fail-1",
    env: { openrouterKey: "test-openrouter-key", xaiKey: "" },
    fetchImpl: fetchFail,
  });
  assert.equal(noXai.ok, false);
  if (!noXai.ok) assert.equal(noXai.errorCode, "LLM_UNAVAILABLE");
  assert.equal(calls, 1);
  assert.equal(seen.some(s => s.url.includes("x.ai")), false);
  ok("Ohne XAI_API_KEY gibt es keinen xAI-Call");

  calls = 0;
  seen.length = 0;
  const withXai = await synthesizePodcastAudio({
    text: "Hallo.",
    voiceId: "de-DE-Mia:MAI-Voice-2.1",
    cacheId: "fail-2",
    env: { openrouterKey: "test-openrouter-key", xaiKey: "test-xai-key" },
    fetchImpl: fetchFail,
  });
  assert.equal(withXai.ok, true);
  if (withXai.ok) assert.equal(withXai.provider, "xai");
  assert.equal(seen[1]?.url, XAI_TTS_URL);
  assert.equal(seen[1]?.body.voice_id, "eve");
  assert.equal(seen[1]?.body.language, "de");
  assert.equal(calls, 2);
  ok("xAI springt nur ein, wenn der Key gesetzt ist und OpenRouter scheitert");

  calls = 0;
  const missing = await synthesizePodcastAudio({
    text: "Hallo.",
    cacheId: "no-key",
    env: { openrouterKey: "", xaiKey: "" },
    fetchImpl: async () => { calls += 1; return responder(200, MP3); },
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.errorCode, "NO_API_KEY");
  assert.equal(calls, 0);
  ok("Ohne beide Keys kein Fetch");

  resetStockPodcastRouteState();
  const pack = {
    ticker: "NVDA",
    day: "2026-11-26",
    generatedAt: "2026-11-26T12:00:00.000Z",
    analysis: {
      ticker: "NVDA", companyName: "NVIDIA", currentPrice: 149.3, currency: "USD",
      dataTimestamp: "2026-11-26T10:00:00.000Z",
      financialStatements: { incomeStatement: { revenueGrowth: 10 } },
      _podcastInternals: { revenueY1: 1, fiscalYear: "2026", fxRateToUsd: 1, reportedCurrency: "USD" },
    },
    pestelLlm: null, management: null, managementInterpret: null, earningsBrief: null,
    regulatory: null, thesisStrength: null, policyContext: null, timedOut: [],
    sections: {
      analyze: true, pestelLlm: false, policyContext: false, management: false,
      managementInterpret: false, earningsBrief: false, regulatory: false, thesisStrength: false,
    },
  } as FullAiPack;
  const script = await renderStockPodcastScript({
    pack,
    source: "pdf",
    llm: async () => ({ data: { chapters: [] }, modelUsed: "test" }),
    now: new Date("2026-11-26T12:00:00.000Z"),
  });
  assert.equal(script.ok, true);
  if (!script.ok) return;
  const chapter = script.chapters[0]!;
  let audioCalls = 0;
  const played = await handleStockPodcastAudio({
    chapterId: chapter.id,
    ticker: "NVDA",
    source: "pdf",
    voice: "de-DE-Klaus:MAI-Voice-2.1",
    cacheKey: script.cacheKey,
  }, {
    audioEnv: { openrouterKey: "test-openrouter-key", xaiKey: "" },
    fetchAudio: async (_url, init) => {
      audioCalls += 1;
      const body = JSON.parse(init.body);
      assert.equal(body.voice, "de-DE-Klaus:MAI-Voice-2.1");
      return responder(200, MP3);
    },
  });
  assert.equal(played.ok, true);
  assert.equal(audioCalls, 1);
  const again = await handleStockPodcastAudio({
    chapterId: chapter.id,
    ticker: "NVDA",
    source: "pdf",
    voice: "de-DE-Klaus:MAI-Voice-2.1",
    cacheKey: script.cacheKey,
  }, {
    audioEnv: { openrouterKey: "test-openrouter-key", xaiKey: "" },
    fetchAudio: async () => { audioCalls += 1; return responder(200, MP3); },
  });
  assert.equal(again.ok, true);
  assert.equal(audioCalls, 1);
  const routeSrc = readFileSync(new URL("../server/stock-podcast-route.ts", import.meta.url), "utf8");
  assert.match(routeSrc, /Content-Type", "audio\/mpeg"/);
  ok("Audio-Route liefert das Kapitel als audio/mpeg und cacht Ticker, Tag, Quelle und Stimme");

  console.log(`ki-podcast audio: ${n} checks ok`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
