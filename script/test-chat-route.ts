/**
 * KI-Chatbot PR 1 (WORK_DASHBOARD_FEATURES_2026-10.md §4/§4c): Kontext-Provider + POST /api/chat.
 * Offline: LLM wird gestubbt. Ausführen: npx tsx script/test-chat-route.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import { buildStockChatContext, CHAT_LIMITS, CHAT_REQUEST_TIMEOUT_MS, STOCK_SECTION_LABELS, type ChatRequestBody } from "../shared/chat-context";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";
import {
  buildChatPrompt, CHAT_SYSTEM_PROMPT, handleChat, registerChatRoute, validateChatRequest, chatRateLimited, CHAT_RATE_LIMIT,
  CHAT_ANSWER_TIMEOUT_MS, CHAT_LLM_DEFAULT_MODEL, CHAT_LLM_FALLBACK_MODEL, CHAT_LLM_MAX_TOKENS, CHAT_LLM_TEMPERATURE, CHAT_MODEL_ENV, chatLlmModels,
} from "../server/chat-route";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

async function main() {
  const raw = readFileSync("script/fixtures/analysis-MSFT.json", "utf8");
  const data = JSON.parse(raw);
  const before = JSON.stringify(data);
  const ctx = buildStockChatContext(data);
  assert.equal(JSON.stringify(data), before); ok("Analyse-Daten nach Kontextbau byte-identisch (keine Mutation, kein Score-Einfluss)");
  assert.equal(ctx.dashboard, "stock"); assert.equal(ctx.entity, data.ticker);
  assert.deepEqual(ctx.sections.map(s => s.id), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(ctx.sections.map(s => s.label), Object.values(STOCK_SECTION_LABELS)); ok("Kontext enthält alle 20 Sektionen mit Dashboard-Labels");
  if (data.scoring?.gates?.length) { assert.equal(ctx.gates.length, Math.min(data.scoring.gates.length, CHAT_LIMITS.maxGates)); ok(`Gates übernommen (${ctx.gates.length})`); }
  else { assert.ok(ctx.notes.some(x => x.includes("n/a"))); ok("ohne Scoring: Gates n/a-Hinweis"); }
  for (const s of ctx.sections) for (const v of Object.values(s.facts)) assert.ok(v === null || ["string", "number", "boolean"].includes(typeof v));
  ok("Fakten nur primitive Werte oder null (n/a)");
  assert.ok(JSON.stringify(ctx).length < CHAT_LIMITS.maxContextChars); ok(`Kontextgröße ${JSON.stringify(ctx).length} < ${CHAT_LIMITS.maxContextChars}`);
  const empty = buildStockChatContext({ ticker: "X" } as any);
  assert.equal(empty.sections.length, 20); assert.equal(empty.sections[5].facts.kgv, null); assert.equal(empty.gates.length, 0);
  ok("leere Analyse: n/a statt erfundener Werte");

  const body: ChatRequestBody = { dashboard: "stock", sectionId: 7, context: ctx, messages: [{ role: "user", content: "Erkläre das DCF-Modell" }] };
  assert.equal(validateChatRequest(body).ok, true); ok("gültige Anfrage akzeptiert");
  const bad: Array<[string, unknown]> = [
    ["fremdes Dashboard", { ...body, dashboard: "forex" }],
    ["Kontext ≠ Dashboard", { ...body, dashboard: "btc" }],
    ["Sektion nicht im Kontext", { ...body, sectionId: 99 }],
    ["zu lange Nachricht", { ...body, messages: [{ role: "user", content: "x".repeat(CHAT_LIMITS.maxMessageChars + 1) }] }],
    ["zu viele Nachrichten", { ...body, messages: Array.from({ length: CHAT_LIMITS.maxMessages + 1 }, () => ({ role: "user", content: "a" })) }],
    ["letzte Nachricht vom Assistenten", { ...body, messages: [{ role: "assistant", content: "a" }] }],
    ["Zusatzfeld", { ...body, apiKey: "x" }],
    ["kein Body", null],
  ];
  for (const [name, b] of bad) assert.equal(validateChatRequest(b).ok, false, name);
  ok(`${bad.length} ungültige Anfragen abgelehnt`);

  const prompt = buildChatPrompt(body);
  assert.ok(prompt.includes("[S7 DCF-Modell ← GEBUNDEN]")); assert.ok(prompt.indexOf("[S7 ") < prompt.indexOf("[S1 "));
  ok("Sektionsbindung: gebundene Sektion markiert und zuerst");
  assert.ok(/erfinde nichts/.test(CHAT_SYSTEM_PROMPT) && /keine Scores/.test(CHAT_SYSTEM_PROMPT)); ok("Systemprompt: n/a statt Erfinden, keine Score-Änderung");

  let called = 0;
  const noKey = await handleChat(body, { llmAvailable: () => false, llm: async () => { called++; return null; } });
  assert.equal(noKey.body.status, "no-key"); assert.equal(noKey.body.answer, null); assert.equal(noKey.body.error, OPENROUTER_NO_KEY_MESSAGE); assert.equal(called, 0); ok("kein Key → no-key, keine Antwort, kein LLM-Call");
  const good = await handleChat(body, { llmAvailable: () => true, llm: async () => ({ data: { answer: "Antwort", sectionRefs: [7, 99, 7, "x"] }, modelUsed: "m" }) });
  assert.equal(good.body.status, "ok"); assert.equal(good.body.answer, "Antwort"); assert.deepEqual(good.body.sectionRefs, [7]); ok("ok-Antwort, sectionRefs auf bekannte Sektionen gefiltert");
  const nul = await handleChat(body, { llmAvailable: () => true, llm: async () => null });
  assert.equal(nul.body.status, "llm-error"); assert.equal(nul.body.answer, null); ok("LLM null → llm-error, keine Fake-Antwort");
  const emptyAns = await handleChat(body, { llmAvailable: () => true, llm: async () => ({ data: { answer: "  " }, modelUsed: "m" }) });
  assert.equal(emptyAns.body.status, "llm-error"); ok("leere Antwort → llm-error");
  const thr = await handleChat(body, { llmAvailable: () => true, llm: async () => { throw new Error("boom"); } });
  assert.equal(thr.body.status, "llm-error"); ok("LLM-Throw → llm-error");
  const t0 = Date.now();
  const slow = await handleChat(body, { llmAvailable: () => true, timeoutMs: 50, llm: () => new Promise((_, rej) => setTimeout(() => rej(new Error("late")), 200)) });
  assert.equal(slow.body.status, "timeout"); assert.ok(Date.now() - t0 < 180); ok("eigenes Timeout greift, späte Ablehnung unbehandelt-frei");
  const inv = await handleChat({ ...body, sectionId: 99 }, { llmAvailable: () => true, llm: async () => { called++; return null; } });
  assert.equal(inv.http, 400); assert.equal(called, 0); ok("ungültig → 400 ohne LLM-Call");

  let rl = 0; for (let i = 0; i < CHAT_RATE_LIMIT.max + 1; i++) if (chatRateLimited("t", 1000)) rl++;
  assert.equal(rl, 1); assert.equal(chatRateLimited("t", 1000 + CHAT_RATE_LIMIT.windowMs + 1), false); ok("Rate-Limit pro Client");

  assert.equal(CHAT_MODEL_ENV, "OPENROUTER_CHAT_MODEL");
  assert.deepEqual(chatLlmModels({}), [CHAT_LLM_DEFAULT_MODEL, CHAT_LLM_FALLBACK_MODEL]);
  assert.deepEqual(chatLlmModels({ [CHAT_MODEL_ENV]: "   " }), [CHAT_LLM_DEFAULT_MODEL, CHAT_LLM_FALLBACK_MODEL]);
  assert.deepEqual(chatLlmModels({ OPENROUTER_MODEL: "deepseek/deepseek-v3.2" }), [CHAT_LLM_DEFAULT_MODEL, CHAT_LLM_FALLBACK_MODEL]);
  ok(`leere ${CHAT_MODEL_ENV}: Code-Default ${CHAT_LLM_DEFAULT_MODEL}, OPENROUTER_MODEL (Analyse) wirkt nicht auf den Chat`);
  assert.deepEqual(chatLlmModels({ [CHAT_MODEL_ENV]: " openai/gpt-5.1 " }), ["openai/gpt-5.1", CHAT_LLM_FALLBACK_MODEL]);
  assert.deepEqual(chatLlmModels({ [CHAT_MODEL_ENV]: CHAT_LLM_FALLBACK_MODEL }), [CHAT_LLM_FALLBACK_MODEL]);
  ok(`${CHAT_MODEL_ENV} hat Vorrang, ${CHAT_LLM_FALLBACK_MODEL} bleibt Fallback`);
  assert.deepEqual(chatLlmModels({ [CHAT_MODEL_ENV]: "claude opus 5.5" }), [CHAT_LLM_DEFAULT_MODEL, CHAT_LLM_FALLBACK_MODEL]);
  ok("ungültige Modell-ID in der Env: Code-Default statt OpenRouter-400");

  const prevEnv = process.env[CHAT_MODEL_ENV];
  let seen: { models?: readonly string[]; temperature?: number; maxTokens?: number } | null = null;
  try {
    process.env[CHAT_MODEL_ENV] = "x-ai/grok-4";
    await handleChat(body, { llmAvailable: () => true, llm: async (o) => { seen = o; return { data: { answer: "a" }, modelUsed: "x-ai/grok-4" }; } });
  } finally {
    if (prevEnv === undefined) delete process.env[CHAT_MODEL_ENV]; else process.env[CHAT_MODEL_ENV] = prevEnv;
  }
  assert.deepEqual(seen!.models, ["x-ai/grok-4", CHAT_LLM_FALLBACK_MODEL]);
  assert.equal(seen!.temperature, CHAT_LLM_TEMPERATURE);
  assert.equal(seen!.maxTokens, CHAT_LLM_MAX_TOKENS);
  ok("handleChat liest die Env je Anfrage und übergibt Kette, temperature und maxTokens aus den benannten Parametern");
  assert.ok(CHAT_ANSWER_TIMEOUT_MS < CHAT_REQUEST_TIMEOUT_MS);
  ok(`Server-Timeout ${CHAT_ANSWER_TIMEOUT_MS} ms < Client-Timeout ${CHAT_REQUEST_TIMEOUT_MS} ms`);

  const app = express(); app.use(express.json({ limit: "10mb" }));
  registerChatRoute(app, { llmAvailable: () => false, llm: async () => null });
  const srv = app.listen(0); const port = (srv.address() as AddressInfo).port;
  const r = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json(); assert.equal(r.status, 200); assert.equal(j.status, "no-key");
  const r2 = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(r2.status, 400); srv.close(); ok("HTTP-Route POST /api/chat: no-key 200, ungültig 400");

  const reg = readFileSync("server/routes-register.ts", "utf8");
  assert.ok(reg.includes('import("./chat-route")')); ok("Route in routes-register eingehängt");
  const route = readFileSync("server/chat-route.ts", "utf8");
  assert.ok(!/console\.\w+\([^)]*(content|prompt|API_KEY)/.test(route)); ok("keine Inhalte/Keys im Log");
  console.log(`\n${n} Checks grün.`);
}
main().catch(e => { console.error(e); process.exit(1); });
