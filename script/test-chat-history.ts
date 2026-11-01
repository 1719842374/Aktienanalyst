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
import { CHAT_CONTEXT_BUDGET, CHAT_LIMITS } from "../shared/chat-context";
import { CHAT_HISTORY_IDLE_MINUTES, CHAT_HISTORY_MEMORY_BUDGET_CHARS, CHAT_HISTORY_SESSION_CHAR_BUDGET, CHAT_HISTORY_THREADS_PER_SESSION, CHAT_HISTORY_TTL_MS, CHAT_SESSION_HEADER, chatThreadTitle, clipChatMessages, mergeChatThreads, newChatId } from "../shared/chat-history";
import { CHAT_HISTORY_SESSION_CAP, deleteChatThread, listChatThreads, putChatThread, registerChatHistoryRoute, resetChatHistoryStore } from "../server/chat-history-route";
import { CHAT_RATE_LIMIT } from "../server/chat-route";

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

  assert.equal(CHAT_HISTORY_THREADS_PER_SESSION, CHAT_LIMITS.maxMessages);
  assert.equal(CHAT_HISTORY_SESSION_CHAR_BUDGET, CHAT_CONTEXT_BUDGET);
  assert.equal(CHAT_HISTORY_IDLE_MINUTES, 60);
  assert.equal(CHAT_HISTORY_TTL_MS, CHAT_HISTORY_IDLE_MINUTES * 60 * 1000);
  assert.equal(CHAT_HISTORY_MEMORY_BUDGET_CHARS, CHAT_HISTORY_IDLE_MINUTES * CHAT_HISTORY_SESSION_CHAR_BUDGET);
  assert.equal(CHAT_HISTORY_SESSION_CAP, Math.floor(CHAT_HISTORY_MEMORY_BUDGET_CHARS / CHAT_HISTORY_SESSION_CHAR_BUDGET));
  assert.ok(CHAT_HISTORY_SESSION_CAP > CHAT_RATE_LIMIT.max);
  ok("Session-Cap ist Speicherbudget / 36k, TTL ist 60 Minuten, das Rate-Limit ist keines von beiden");

  resetChatHistoryStore();
  const t0 = 1_700_000_000_000;
  const full = "x".repeat(CHAT_LIMITS.maxMessageChars);
  const heavy = Array.from({ length: CHAT_LIMITS.maxMessages }, () => ({ role: "user" as const, content: full }));
  putChatThread("sess-chars1", { id: "thread-heavy-a", dashboard: "stock", entity: "SAP", title: "a", updatedAt: "", messages: heavy }, t0);
  putChatThread("sess-chars1", { id: "thread-heavy-b", dashboard: "stock", entity: "SAP", title: "b", updatedAt: "", messages: heavy }, t0 + 1);
  const heavyLeft = listChatThreads("sess-chars1", undefined, undefined, t0 + 2);
  assert.equal(heavyLeft.length, 1);
  assert.equal(heavyLeft[0].id, "thread-heavy-b");
  assert.ok(heavyLeft[0].messages.reduce((sum, m) => sum + m.content.length, 0) <= CHAT_HISTORY_SESSION_CHAR_BUDGET);
  ok("Zeichen über dem Kontext-Budget verdrängen den älteren Thread");

  resetChatHistoryStore();
  for (let i = 0; i < CHAT_HISTORY_THREADS_PER_SESSION + 1; i++) {
    putChatThread("sess-count1", { id: `thread-c${i}`, dashboard: "stock", entity: "MSFT", title: String(i), updatedAt: "", messages: [{ role: "user", content: `kurz ${i}` }] }, t0 + i);
  }
  const counted = listChatThreads("sess-count1", undefined, undefined, t0 + CHAT_HISTORY_THREADS_PER_SESSION + 2);
  assert.equal(counted.length, CHAT_HISTORY_THREADS_PER_SESSION);
  assert.equal(counted.some(t => t.id === "thread-c0"), false);
  assert.equal(counted.some(t => t.id === `thread-c${CHAT_HISTORY_THREADS_PER_SESSION}`), true);
  putChatThread("sess-count1", { id: "thread-c1", dashboard: "stock", entity: "MSFT", title: "berührt", updatedAt: "", messages: [{ role: "user", content: "noch da" }] }, t0 + 100);
  for (let i = 0; i < CHAT_HISTORY_THREADS_PER_SESSION - 1; i++) {
    putChatThread("sess-count1", { id: `thread-n${i}`, dashboard: "stock", entity: "MSFT", title: `n${i}`, updatedAt: "", messages: [{ role: "user", content: `neu ${i}` }] }, t0 + 101 + i);
  }
  const touched = listChatThreads("sess-count1", undefined, undefined, t0 + 200);
  assert.equal(touched.some(t => t.id === "thread-c1"), true);
  assert.equal(touched.some(t => t.id === "thread-c2"), false);
  ok("Thread-Limit verdrängt den am längsten nicht benutzten Chat, ein erneutes Schreiben bleibt");

  resetChatHistoryStore();
  for (let i = 0; i < CHAT_HISTORY_SESSION_CAP + 1; i++) {
    putChatThread(`sess-cap-${i}`, { id: `thread-s${i}`, dashboard: "btc", entity: null, title: String(i), updatedAt: "", messages: [{ role: "user", content: `s${i}` }] }, t0 + i);
  }
  assert.equal(listChatThreads("sess-cap-0", undefined, undefined, t0 + CHAT_HISTORY_SESSION_CAP + 2).length, 0);
  assert.equal(listChatThreads(`sess-cap-${CHAT_HISTORY_SESSION_CAP}`, undefined, undefined, t0 + CHAT_HISTORY_SESSION_CAP + 3).length, 1);
  listChatThreads("sess-cap-1", undefined, undefined, t0 + CHAT_HISTORY_SESSION_CAP + 4);
  putChatThread("sess-cap-extra", { id: "thread-extra", dashboard: "btc", entity: null, title: "extra", updatedAt: "", messages: [{ role: "user", content: "extra" }] }, t0 + CHAT_HISTORY_SESSION_CAP + 5);
  assert.equal(listChatThreads("sess-cap-1", undefined, undefined, t0 + CHAT_HISTORY_SESSION_CAP + 6).length, 1);
  assert.equal(listChatThreads("sess-cap-2", undefined, undefined, t0 + CHAT_HISTORY_SESSION_CAP + 7).length, 0);
  ok("Session-Limit verdrängt die am längsten nicht benutzte Session");

  resetChatHistoryStore();
  for (let i = 0; i < CHAT_HISTORY_SESSION_CAP; i++) {
    putChatThread(`sess-ok-${i}`, { id: `thread-ok-${i}`, dashboard: "stock", entity: "SAP", title: String(i), updatedAt: "", messages: [{ role: "user", content: `aktiv ${i}` }] }, t0 + i);
  }
  const stillActive = t0 + CHAT_HISTORY_SESSION_CAP + 1;
  for (let i = 0; i < CHAT_HISTORY_SESSION_CAP; i++) {
    assert.equal(listChatThreads(`sess-ok-${i}`, undefined, undefined, stillActive + i).length, 1, `sess-ok-${i}`);
  }
  assert.equal(listChatThreads("sess-ok-20", undefined, undefined, stillActive + CHAT_HISTORY_SESSION_CAP).length, 1);
  ok("Unter dem Budget wird keine aktive Session verdrängt");

  resetChatHistoryStore();
  putChatThread("sess-ttl", { id: "thread-ttl", dashboard: "gold", entity: null, title: "alt", updatedAt: "", messages: [{ role: "user", content: "läuft ab" }] }, t0);
  assert.equal(listChatThreads("sess-ttl", undefined, undefined, t0 + CHAT_HISTORY_TTL_MS).length, 0);
  putChatThread("sess-ttl", { id: "thread-ttl", dashboard: "gold", entity: null, title: "alt", updatedAt: "", messages: [{ role: "user", content: "läuft ab" }] }, t0);
  const seen = t0 + CHAT_HISTORY_TTL_MS - 1;
  assert.equal(listChatThreads("sess-ttl", undefined, undefined, seen).length, 1);
  assert.equal(listChatThreads("sess-ttl", undefined, undefined, seen + CHAT_HISTORY_TTL_MS).length, 0);
  ok("Ohne Zugriff läuft der Verlauf nach der TTL ab; Lesen setzt sie neu");

  console.log(`chat history: ${n} checks ok`);
  process.exitCode = 0;
}

main().then(() => {
  process.exit(process.exitCode ?? 1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
