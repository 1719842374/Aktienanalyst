/**
 * Prio-1: KI-Chat bricht ab, wenn die KI-Analyse eine lange Wachstumsthese liefert.
 *
 * Kette (dieselbe Form wie die UI):
 *   buildStockChatContext / enrichChatContext (Client, shared/chat-context.ts)
 *   → Request-Body wie useDashboardChat (apiRequest POST /api/chat)
 *   → registerChatRoute → handleChat → validateChatRequest (Zod, server/chat-route.ts)
 *   → Prompt an das LLM
 *
 * Soll (Philip, 1.11.): kein festes 400/1000-Limit. allowedChars = floor(Budget * Gewicht),
 * Gewichte aus CHAT_FACT_PRIORITY (wachstumsthese > rationale > notes). Über 36_000 Zeichen
 * wird proportional nach Priorität gekürzt, die Anfrage nicht abgelehnt.
 *
 * Ausführen: npx tsx script/test-chat-fact-limit.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildStockChatContext, enrichChatContext, CHAT_LIMITS, CHAT_CONTEXT_BUDGET, CHAT_FACT_PRIORITY,
  chatContextTrimOf, chatFactAllowedChars, chatFactWeight, formatChatContextTrim,
  type ChatRequestBody,
} from "../shared/chat-context";
import { ChatWidget } from "../client/src/components/chat/ChatWidget";
import { buildChatPrompt, handleChat, registerChatRoute, validateChatRequest } from "../server/chat-route";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

function repeat(ch: string, len: number): string {
  return ch.repeat(len);
}

/** Request-Form wie useDashboardChat → apiRequest("POST", "/api/chat", …). */
function requestOf(context: ChatRequestBody["context"], sectionId: number | null = null): ChatRequestBody {
  return {
    dashboard: context.dashboard,
    sectionId,
    context,
    messages: [{ role: "user", content: "Erkläre die Wachstumsthese aus der KI-Analyse." }],
  };
}

function prioritySum(): number {
  return Object.values(CHAT_FACT_PRIORITY).reduce((a, b) => a + b, 0);
}

async function main() {
  const sum = prioritySum();
  assert.equal(CHAT_CONTEXT_BUDGET, 36_000);
  assert.ok(CHAT_FACT_PRIORITY.wachstumsthese > CHAT_FACT_PRIORITY.rationale);
  assert.ok(CHAT_FACT_PRIORITY.rationale > CHAT_FACT_PRIORITY.notes);
  assert.ok(chatFactWeight("wachstumsthese") > chatFactWeight("rationale"));
  assert.ok(chatFactWeight("rationale") > chatFactWeight("notes"));
  assert.equal(CHAT_LIMITS.maxFactValueChars, Math.floor((CHAT_CONTEXT_BUDGET * CHAT_FACT_PRIORITY.wachstumsthese) / sum));
  assert.equal(CHAT_LIMITS.maxRationaleChars, Math.floor((CHAT_CONTEXT_BUDGET * CHAT_FACT_PRIORITY.rationale) / sum));
  assert.equal(CHAT_LIMITS.maxNoteChars, Math.floor((CHAT_CONTEXT_BUDGET * CHAT_FACT_PRIORITY.notes) / sum));
  assert.equal(chatFactAllowedChars("wachstumsthese"), CHAT_LIMITS.maxFactValueChars);
  assert.equal(chatFactAllowedChars("rationale"), CHAT_LIMITS.maxRationaleChars);
  assert.equal(chatFactAllowedChars("notes"), CHAT_LIMITS.maxNoteChars);
  assert.ok(CHAT_LIMITS.maxFactValueChars > CHAT_LIMITS.maxRationaleChars);
  assert.ok(CHAT_LIMITS.maxRationaleChars > CHAT_LIMITS.maxNoteChars);
  assert.notEqual(CHAT_LIMITS.maxFactValueChars, 400);
  assert.notEqual(CHAT_LIMITS.maxFactValueChars, 1000);
  ok(`Budget ${CHAT_CONTEXT_BUDGET}, These ${CHAT_LIMITS.maxFactValueChars} > Rationale ${CHAT_LIMITS.maxRationaleChars} > Notes ${CHAT_LIMITS.maxNoteChars}`);

  const raw = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  const data = { ...raw, llmMode: true, growthThesis: repeat("W", 1200) };
  const before = JSON.stringify(data);
  const built = buildStockChatContext(data);
  const ctx = enrichChatContext(built, null, { gatesSectionId: 20 });
  assert.equal(JSON.stringify(data), before);
  ok("KI-Analyse-Daten nach Kontextbau byte-identisch (kein Score-/Objekt-Einfluss)");

  const thesis = ctx.sections[2]?.facts.wachstumsthese;
  assert.equal(ctx.sections[2]?.id, 3);
  assert.equal(ctx.sections[2]?.label, "Investmentthese");
  assert.equal(thesis, repeat("W", 1200));
  assert.equal(chatContextTrimOf(ctx), undefined);
  ok("Client behält die 1200-Zeichen-Wachstumsthese, ohne Kürzung kein Flag");
  assert.ok(JSON.stringify(ctx).length <= CHAT_CONTEXT_BUDGET);
  ok(`Kontext ${JSON.stringify(ctx).length} ≤ Budget ${CHAT_CONTEXT_BUDGET}`);

  const body = requestOf(ctx, 3);
  const validated = validateChatRequest(body);
  assert.equal(validated.ok, true, validated.ok ? "" : validated.error);
  if (validated.ok) assert.equal(validated.body.context.sections[2].facts.wachstumsthese, repeat("W", 1200));
  ok("validateChatRequest akzeptiert den 1200-Zeichen-Kontext");

  const handled = await handleChat(body, { llmAvailable: () => false, llm: async () => { throw new Error("darf nicht laufen"); } });
  assert.equal(handled.http, 200);
  assert.equal(handled.body.status, "no-key");
  assert.equal(handled.body.ok, false);
  assert.equal(handled.body.answer, null);
  assert.deepEqual(handled.body.sectionRefs, []);
  assert.equal(handled.body.model, null);
  assert.equal(typeof handled.body.error, "string");
  assert.equal(handled.body.contextTrimmed, undefined);
  ok("handleChat bricht nicht ab; ohne Kürzung fehlt contextTrimmed");

  const overField = structuredClone(ctx);
  overField.gates = [{ id: "g1", active: true, cap: 70, severity: "high", rationale: repeat("R", CHAT_LIMITS.maxRationaleChars + 80) }];
  const soft = validateChatRequest(requestOf(overField, 3));
  assert.equal(soft.ok, true, soft.ok ? "" : soft.error);
  if (soft.ok) {
    assert.equal(soft.body.context.gates[0].rationale.length, CHAT_LIMITS.maxRationaleChars);
    assert.equal(soft.body.context.sections[2].facts.wachstumsthese, repeat("W", 1200));
    assert.deepEqual(soft.contextTrimmed, [{ kind: "rationale", removedChars: 80 }]);
  }
  ok("Überlänge wird auf allowedChars gekürzt und als contextTrimmed gemeldet");

  const bulky = structuredClone(ctx);
  const noteLen = 5_000;
  const rationaleLen = Math.floor((CHAT_LIMITS.maxRationaleChars * 2) / 3);
  bulky.notes = Array.from({ length: CHAT_LIMITS.maxNotes }, () => repeat("N", noteLen));
  bulky.gates = [{ id: "g1", active: true, cap: 70, severity: "high", rationale: repeat("R", rationaleLen) }];
  assert.ok(JSON.stringify(bulky).length > CHAT_CONTEXT_BUDGET, "Fixture muss über dem Budget liegen");
  const trimmed = validateChatRequest(requestOf(bulky, 3));
  assert.equal(trimmed.ok, true, trimmed.ok ? "" : trimmed.error);
  if (trimmed.ok) {
    const out = trimmed.body.context;
    assert.ok(JSON.stringify(out).length <= CHAT_CONTEXT_BUDGET, `gekürzt ${JSON.stringify(out).length}`);
    assert.equal(out.sections[2].facts.wachstumsthese, repeat("W", 1200));
    assert.equal(out.gates[0].rationale, repeat("R", rationaleLen));
    assert.ok(out.notes.every(note => note.length < noteLen));
    assert.ok(out.notes.length > 0);
    const noteCut = bulky.notes.reduce((sum, note) => sum + note.length, 0) - out.notes.reduce((sum, note) => sum + note.length, 0);
    assert.ok(noteCut > 0);
    assert.deepEqual(trimmed.contextTrimmed, [{ kind: "notes", removedChars: noteCut }]);
    assert.equal(formatChatContextTrim([{ kind: "notes", removedChars: 2140 }]), "Kontext gekürzt: Notizen −2.140 Zeichen");
    assert.equal(formatChatContextTrim(undefined), null);
    assert.equal(formatChatContextTrim([]), null);
  }
  ok("Over-Budget: Notes proportional gekürzt, Flag nennt die entfernten Zeichen");

  const clientFitted = enrichChatContext(bulky, null, { gatesSectionId: 20 });
  const clientReport = chatContextTrimOf(clientFitted);
  assert.ok(clientReport?.some(e => e.kind === "notes" && e.removedChars > 0));
  assert.equal(formatChatContextTrim(clientReport)?.startsWith("Kontext gekürzt:"), true);
  ok("Client-Pfad enrichChatContext meldet dieselbe Kürzung");

  let seen = "";
  const llm = await handleChat(requestOf(bulky, 3), {
    llmAvailable: () => true,
    llm: async (a) => { seen = a.prompt; return { data: { answer: "ok", sectionRefs: [3] }, modelUsed: "m" }; },
  });
  assert.equal(llm.http, 200);
  assert.equal(llm.body.status, "ok");
  assert.match(llm.body.answer ?? "", /^ok\n\nQuelle: geladene Dashboard-Daten /);
  assert.deepEqual(llm.body.sectionRefs, [3]);
  assert.ok(seen.includes(repeat("W", 1200)));
  assert.ok(!seen.includes(repeat("N", noteLen)));
  assert.ok(llm.body.contextTrimmed?.some(e => e.kind === "notes" && e.removedChars > 0));
  assert.ok(buildChatPrompt(trimmed.ok ? trimmed.body : body).includes(repeat("W", 1200)));
  ok("LLM-Prompt enthält die 1200-Zeichen-These und nicht die ungekürzten Notes");

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  registerChatRoute(app, { llmAvailable: () => false, llm: async () => null });
  const srv = app.listen(0);
  const port = (srv.address() as AddressInfo).port;
  try {
    const plain = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const plainJson = await plain.json();
    assert.equal(plain.status, 200);
    assert.equal("contextTrimmed" in plainJson, false);
    ok("POST /api/chat ohne Kürzung: kein contextTrimmed");
    const res = await fetch(`http://127.0.0.1:${port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestOf(bulky, 3)),
    });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.status, "no-key");
    assert.equal(j.ok, false);
    assert.equal(j.answer, null);
    assert.ok(Array.isArray(j.sectionRefs));
    assert.ok(j.contextTrimmed?.some((e: { kind: string; removedChars: number }) => e.kind === "notes" && e.removedChars > 0));
    ok("POST /api/chat: Over-Budget wird gekürzt, contextTrimmed nennt die Notes, kein HTTP 400");
  } finally {
    srv.close();
  }

  const provider = readFileSync("shared/chat-context.ts", "utf8");
  const route = readFileSync("server/chat-route.ts", "utf8");
  assert.ok(!/wachstumsthese:\s*str\(d\.growthThesis,\s*\d+\)/.test(provider));
  assert.ok(!/maxFactValueChars:\s*(400|1000|1200)\b/.test(provider));
  assert.ok(route.includes("z.string().max(CHAT_LIMITS.maxFactValueChars)"));
  assert.ok(route.includes("z.string().max(CHAT_LIMITS.maxRationaleChars)"));
  assert.ok(route.includes("z.string().max(CHAT_LIMITS.maxNoteChars)"));
  assert.ok(!/\.max\(\s*(400|1000|1200)\s*\)/.test(route));
  ok("Zod-Limits kommen aus CHAT_LIMITS, abgeleitet vom Budget; keine feste 400/1000/1200");

  const widget = readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8");
  const hook = readFileSync("client/src/hooks/useDashboardChat.ts", "utf8");
  assert.ok(widget.includes('data-testid="chat-context-trimmed"'));
  assert.ok(widget.includes("formatChatContextTrim"));
  assert.ok(widget.includes("chatContextTrimOf(context)"));
  assert.ok(widget.includes("{trimHint &&"));
  assert.ok(hook.includes("body?.contextTrimmed"));
  ok("ChatWidget zeigt den Hinweis nur bei Kürzung; der Hook liest contextTrimmed aus der Response");

  const win = { x: 24, y: 24, w: 360, h: 520, open: true, minimized: false, maximized: false };
  (globalThis as any).window = {
    innerWidth: 1440, innerHeight: 900,
    localStorage: { getItem: () => JSON.stringify(win), setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const hint = formatChatContextTrim(clientReport);
  const html = renderToStaticMarkup(React.createElement(ChatWidget, { dashboard: "trim-hint", context: clientFitted, sections: [{ id: 3, label: "Investmentthese" }] }));
  assert.ok(hint && html.includes(hint), html.slice(html.indexOf("chat-context-trimmed") - 20, html.indexOf("chat-context-trimmed") + 180));
  assert.ok(html.includes('data-testid="chat-context-trimmed"'));
  const plainHtml = renderToStaticMarkup(React.createElement(ChatWidget, { dashboard: "trim-plain", context: ctx, sections: [{ id: 3, label: "Investmentthese" }] }));
  assert.equal(plainHtml.includes("chat-context-trimmed"), false);
  ok("Hinweis steht im Widget, wenn gekürzt wurde, und fehlt ohne Kürzung");

  console.log(`\n${n} Checks grün.`);
}

main().catch(e => { console.error(e); process.exit(1); });
