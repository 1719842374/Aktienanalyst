/**
 * Chat-Verlauf: Session-Cache lokal zusammenführen und im Backend halten.
 * Kette: clip/merge (shared) → PUT/GET/DELETE /api/chat/history.
 * Kein Supabase, kein Score.
 *
 * Ausführen: npx tsx script/test-chat-history.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import express from "express";
import { CHAT_LIMITS } from "../shared/chat-context";
import { CHAT_SESSION_HEADER, chatThreadTitle, clipChatMessages, mergeChatThreads, newChatId } from "../shared/chat-history";
import { deleteChatThread, listChatThreads, putChatThread, registerChatHistoryRoute, resetChatHistoryStore } from "../server/chat-history-route";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
process.exitCode = 1;

async function main() {
  const long = "A".repeat(CHAT_LIMITS.maxMessageChars + 40);
  const onlyLong = clipChatMessages([{ role: "user", content: "  " }, { role: "user", content: long }]);
  assert.equal(onlyLong.length, 1);
  assert.equal(onlyLong[0].content.length, CHAT_LIMITS.maxMessageChars);
  const clipped = clipChatMessages(Array.from({ length: CHAT_LIMITS.maxMessages + 3 }, (_, i) => ({ role: "user" as const, content: `m${i}` })));
  assert.equal(clipped.length, CHAT_LIMITS.maxMessages);
  assert.equal(clipped[0].content, "m3");
  assert.equal(clipped.at(-1)?.content, `m${CHAT_LIMITS.maxMessages + 2}`);
  assert.equal(chatThreadTitle([{ role: "user", content: "  " }, { role: "assistant", content: "x" }]), "n/a — kein Nutzertext");
  assert.ok(chatThreadTitle([{ role: "user", content: "Wie steht der Moat?" }]).includes("Moat"));
  ok("Nachrichten bleiben in den Chat-Grenzen, leere Texte fallen weg");

  const older = { id: "thread-one", dashboard: "stock" as const, entity: "SAP", title: "alt", updatedAt: "2026-01-01T00:00:00.000Z", messages: [{ role: "user" as const, content: "alt" }] };
  const newer = { ...older, title: "neu", updatedAt: "2026-06-01T00:00:00.000Z", messages: [{ role: "user" as const, content: "neu" }] };
  const other = { ...older, id: "thread-two", title: "zweiter", updatedAt: "2026-03-01T00:00:00.000Z" };
  const merged = mergeChatThreads([older, other], [newer]);
  assert.equal(merged.find(t => t.id === "thread-one")?.title, "neu");
  assert.equal(merged[0].id, "thread-one");
  assert.ok(merged.some(t => t.id === "thread-two"));
  ok("Zusammenführung behält den jüngeren Stand und verliert keinen zweiten Chat");

  resetChatHistoryStore();
  const session = "session-a1";
  const otherSession = "session-b2";
  const stored = putChatThread(session, { ...newer, updatedAt: "" });
  assert.notEqual(stored.updatedAt, "");
  putChatThread(otherSession, { ...other, updatedAt: "" });
  assert.equal(listChatThreads(session).length, 1);
  assert.equal(listChatThreads(session, "stock", "MSFT").length, 0);
  assert.equal(listChatThreads(session, "stock", "SAP")[0].messages[0].content, "neu");
  assert.equal(deleteChatThread(session, "missing"), false);
  assert.equal(deleteChatThread(session, newer.id), true);
  assert.equal(listChatThreads(session).length, 0);
  assert.equal(listChatThreads(otherSession).length, 1);
  ok("Backend-Cache ist pro Session und pro Asset, Löschen trifft nur den eigenen Chat");

  resetChatHistoryStore();
  const app = express();
  app.use(express.json());
  registerChatHistoryRoute(app);
  const srv = app.listen(0);
  const port = (srv.address() as AddressInfo).port;
  const id = newChatId();
  try {
    const missing = await fetch(`http://127.0.0.1:${port}/api/chat/history`);
    assert.equal(missing.status, 400);
    const body = await missing.json();
    assert.match(body.error, /keine Chat-Session/);
    const headers = { "Content-Type": "application/json", [CHAT_SESSION_HEADER]: session };
    const put = await fetch(`http://127.0.0.1:${port}/api/chat/history/${id}`, {
      method: "PUT", headers, body: JSON.stringify({ dashboard: "stock", entity: "MSFT", messages: [{ role: "user", content: "Big Picture bitte" }, { role: "assistant", content: "Qualität hoch." }] }),
    });
    const saved = await put.json();
    assert.equal(put.status, 200);
    assert.equal(saved.thread.messages.length, 2);
    assert.match(saved.thread.title, /Big Picture/);
    const listed = await fetch(`http://127.0.0.1:${port}/api/chat/history?dashboard=stock&entity=MSFT`, { headers });
    const list = await listed.json();
    assert.equal(list.threads.length, 1);
    assert.equal(list.threads[0].messages[1].content, "Qualität hoch.");
    const isolated = await fetch(`http://127.0.0.1:${port}/api/chat/history?dashboard=stock&entity=MSFT`, { headers: { [CHAT_SESSION_HEADER]: otherSession } });
    const isolatedBody = await isolated.json();
    assert.equal(isolatedBody.threads.length, 0);
    const del = await fetch(`http://127.0.0.1:${port}/api/chat/history/${id}`, { method: "DELETE", headers });
    assert.equal(del.status, 200);
    const after = await fetch(`http://127.0.0.1:${port}/api/chat/history`, { headers });
    const afterBody = await after.json();
    assert.equal(afterBody.threads.length, 0);
    const empty = await fetch(`http://127.0.0.1:${port}/api/chat/history/${id}`, {
      method: "PUT", headers, body: JSON.stringify({ dashboard: "stock", entity: "MSFT", messages: [] }),
    });
    assert.equal(empty.status, 400);
    ok("HTTP-Verlauf: Session Pflicht, Speichern, Laden, Löschen, leerer Verlauf bleibt n/a");
  } finally {
    srv.close();
  }

  console.log(`chat history: ${n} checks ok`);
  process.exitCode = 0;
}

main().then(() => {
  process.exit(process.exitCode ?? 1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
