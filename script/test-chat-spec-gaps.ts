/**
 * Narrative, AI-Terms, Podcast-Cache. Der Chat-Verlauf kommt nur aus #384
 * (useChatHistory, sessionStorage, /api/chat/history). Kein localStorage-Budget.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-spec-gaps.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const { readPodcastTranscript, writePodcastTranscript } = await import("../server/podcast-transcript-route.ts");
const { PODCAST_MARKET_SYMBOL } = await import("../shared/podcast-transcript.ts");
const { runPodcastProbe } = await import("../server/podcast-pipeline.ts");

assert.equal(existsSync("shared/chat-sessions.ts"), false);
const widget = readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8");
assert.doesNotMatch(widget, /chat-sessions|CHAT_SESSION_CHAR_BUDGET/);
assert.match(widget, /useChatHistory/);
assert.match(widget, /chat-ai-terms/);
assert.match(widget, /KI-generiert, keine Anlageberatung/);
assert.match(widget, /data-testid="chat-history"/);
const hook = readFileSync("client/src/hooks/useChatHistory.ts", "utf8");
assert.match(hook, /sessionStorage/);
assert.match(hook, /\/api\/chat\/history/);
const prompt = readFileSync("server/chat-route.ts", "utf8");
assert.match(prompt, /Catalysts, Assumptions und Risks/);
assert.match(prompt, /keine Änderungsvorschläge/);
assert.match(prompt, /CHAT_BIG_PICTURE_TASK/);
const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
assert.match(dash, /PodcastTranscript/);
assert.match(dash, /PODCAST_MARKET_SYMBOL/);
assert.match(dash, /useEarningsBrief/);
assert.match(dash, /Gib das Big Picture/);

const mem = new Map<string, { data: unknown; storedAt: number }>();
const deps = {
  read: (key: string) => mem.get(key) ?? null,
  write: (key: string, data: unknown) => { mem.set(key, { data, storedAt: Date.now() }); },
};
assert.equal(PODCAST_MARKET_SYMBOL, "MARKT");
assert.match(readPodcastTranscript(PODCAST_MARKET_SYMBOL, deps).reason ?? "", /n\/a/);
const saved = writePodcastTranscript(PODCAST_MARKET_SYMBOL, "Absatz eins.\n\nAbsatz zwei.", deps);
assert.equal(readPodcastTranscript(PODCAST_MARKET_SYMBOL, deps).text, saved.text);
assert.equal(writePodcastTranscript(PODCAST_MARKET_SYMBOL, "x".repeat(20_001), deps).text, null);

const route = readFileSync("server/podcast-route.ts", "utf8");
assert.match(route, /writePodcastTranscript\(PODCAST_MARKET_SYMBOL/);
assert.match(route, /remember:/);
const probe = await runPodcastProbe({
  collect: async () => ({ series: [], gaps: [], notes: [] }),
  llm: async () => ({ data: { title: "Markt", spokenScript: "Absatz aus der Pipeline.\n\nZweiter Absatz." }, modelUsed: "mock" }),
  audio: { id: "test", synthesize: async () => ({ status: "n/a" as const, reason: "n/a — Test ohne Audio", audioUrl: null }) },
  today: "2026-11-01",
  remember: (text) => {
    const saved = writePodcastTranscript(PODCAST_MARKET_SYMBOL, text, deps);
    return { stored: saved.text != null, reason: saved.reason };
  },
});
assert.equal(probe.progress.find(step => step.step === "cache")?.status, "ok");
assert.equal(readPodcastTranscript(PODCAST_MARKET_SYMBOL, deps).text, probe.script?.spokenScript ?? null);
assert.match(probe.script?.spokenScript ?? "", /Absatz aus der Pipeline/);
const skipped = await runPodcastProbe({
  collect: async () => ({ series: [], gaps: [], notes: [] }),
  llm: async () => null,
  audio: { id: "test", synthesize: async () => ({ status: "n/a" as const, reason: "n/a — Test ohne Audio", audioUrl: null }) },
  today: "2026-11-01",
  remember: () => { throw new Error("ohne Skript darf der Cache nicht geschrieben werden"); },
});
assert.equal(skipped.script, null);
assert.match(skipped.progress.find(step => step.step === "cache")?.detail ?? "", /kein Skript/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
console.log("chat spec gaps: OK");
