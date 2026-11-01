/**
 * Chat-Verlauf, Narrative, Podcast-Cache. Kein Supabase.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-spec-gaps.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { pushChatSession, CHAT_SESSION_CHAR_BUDGET } = await import("../shared/chat-sessions.ts");
const { readPodcastTranscript, writePodcastTranscript } = await import("../server/podcast-transcript-route.ts");

const kept = pushChatSession([], { id: "1", title: "a", savedAt: "2026-01-01", turns: [{ role: "user", content: "hallo" }] });
assert.equal(kept.length, 1);
assert.ok(CHAT_SESSION_CHAR_BUDGET > 0);
const mem = new Map<string, { data: unknown; storedAt: number }>();
const deps = {
  read: (key: string) => mem.get(key) ?? null,
  write: (key: string, data: unknown) => { mem.set(key, { data, storedAt: Date.now() }); },
};
assert.match(readPodcastTranscript("MSFT", deps).reason ?? "", /n\/a/);
const saved = writePodcastTranscript("MSFT", "Absatz eins.\n\nAbsatz zwei.", deps);
assert.equal(readPodcastTranscript("MSFT", deps).text, saved.text);
assert.equal(writePodcastTranscript("MSFT", "x".repeat(20_001), deps).text, null);

const prompt = readFileSync("server/chat-route.ts", "utf8");
assert.match(prompt, /Catalysts, Assumptions und Risks/);
assert.match(prompt, /keine Änderungsvorschläge/);
const widget = readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8");
assert.match(widget, /chat-ai-terms/);
assert.match(widget, /chat-history/);
assert.match(readFileSync("client/src/pages/Dashboard.tsx", "utf8"), /PodcastTranscript/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
console.log("chat spec gaps: OK");
