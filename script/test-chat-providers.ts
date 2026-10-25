/**
 * KI-Chatbot PR 2 (§4c): Kontext-Provider BTC/Gold/Rezession + Route mit den neuen Dashboard-Typen.
 * Offline, LLM gestubbt. Daten = die gebündelten Fallback-Daten der Seiten. Ausführen: npx tsx script/test-chat-providers.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildBtcChatContext, buildGoldChatContext, buildRecessionChatContext, recessionSectionLayout,
  BTC_SECTION_LABELS, GOLD_SECTION_LABELS, CHAT_LIMITS, type ChatContext, type ChatRequestBody,
} from "../shared/chat-context";
import { handleChat, validateChatRequest, buildChatPrompt } from "../server/chat-route";
import { BTC_FALLBACK_DATA } from "../client/src/lib/btcFallbackData";
import { GOLD_FALLBACK_DATA } from "../client/src/lib/goldFallbackData";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

function common(name: string, ctx: ChatContext) {
  for (const s of ctx.sections) for (const v of Object.values(s.facts)) assert.ok(v === null || ["string", "number", "boolean"].includes(typeof v), `${name} S${s.id}`);
  assert.ok(JSON.stringify(ctx).length < CHAT_LIMITS.maxContextChars);
  assert.ok(ctx.sections.length <= CHAT_LIMITS.maxSections);
}

async function main() {
  const cases: Array<[string, any, (d: any) => ChatContext]> = [
    ["btc", BTC_FALLBACK_DATA, d => buildBtcChatContext(d)],
    ["gold", GOLD_FALLBACK_DATA, d => buildGoldChatContext(d)],
    ["recession", RECESSION_FALLBACK_DATA, d => buildRecessionChatContext(d, { hasRegions: false })],
  ];
  for (const [dash, data, build] of cases) {
    const before = JSON.stringify(data);
    const ctx = build(data);
    assert.equal(JSON.stringify(data), before);
    assert.equal(ctx.dashboard, dash); common(dash, ctx);
    ok(`${dash}: Daten nach Kontextbau byte-identisch, Fakten primitiv, Größe ${JSON.stringify(ctx).length}`);
    const empty = build({});
    assert.equal(empty.sections.length, build({}).sections.length);
    for (const s of empty.sections) for (const [k, v] of Object.entries(s.facts)) if (k !== "hinweis") assert.ok(v === null || k === "anzahl" || typeof v === "boolean" || typeof v === "string", `${dash} ${k}`);
    common(dash, empty); ok(`${dash}: leere Daten → n/a statt erfundener Werte`);
    // Route: neuer Dashboard-Typ akzeptiert, falscher Typ abgelehnt
    const sid = ctx.sections[1].id;
    const body: ChatRequestBody = { dashboard: dash as any, sectionId: sid, context: ctx, messages: [{ role: "user", content: "Erkläre diese Sektion" }] };
    assert.equal(validateChatRequest(body).ok, true, dash);
    assert.equal(validateChatRequest({ ...body, dashboard: "stock" }).ok, false);
    assert.equal(validateChatRequest({ ...body, dashboard: "forex", context: { ...ctx, dashboard: "forex" } }).ok, false);
    assert.equal(validateChatRequest({ ...body, sectionId: 999 }).ok, false);
    assert.ok(buildChatPrompt(body).includes(`[S${sid} ${ctx.sections[1].label} ← GEBUNDEN]`));
    const r = await handleChat(body, { llmAvailable: () => true, llm: async () => ({ data: { answer: "A", sectionRefs: [sid, 998] }, modelUsed: "m" }) });
    assert.equal(r.body.status, "ok"); assert.deepEqual(r.body.sectionRefs, [sid]);
    const nk = await handleChat(body, { llmAvailable: () => false, llm: async () => { throw new Error("darf nicht laufen"); } });
    assert.equal(nk.body.status, "no-key");
    assert.equal(JSON.stringify(data), before);
    ok(`${dash}: Route akzeptiert Typ, lehnt stock/forex/unbekannte Sektion ab, Bindung S${sid}, no-key, Daten unverändert`);
  }
  // Sektions-IDs = Seiten-IDs
  assert.deepEqual(buildBtcChatContext({}).sections.map(s => s.id), Object.keys(BTC_SECTION_LABELS).map(Number));
  assert.deepEqual(buildGoldChatContext({}).sections.map(s => s.id), [1, 100, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(Object.keys(GOLD_SECTION_LABELS).map(Number).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 100]);
  ok("BTC 1–14 und Gold 1,100,2–8 wie in den Seiten");
  assert.deepEqual(recessionSectionLayout(false, false).map(s => s.id), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.deepEqual(recessionSectionLayout(true, true).map(s => s.id), Array.from({ length: 14 }, (_, i) => i + 1));
  const lay = recessionSectionLayout(true, false); assert.equal(lay.find(s => s.key === "quellen")!.id, 13); assert.equal(lay.find(s => s.key === "buffett")!.id, 11);
  ok("Rezession: Nummerierung folgt der Seite (Regionen/Fazit dynamisch)");
  // Seitenquellen: Widget eingehängt, Provider genutzt
  for (const [f, fn, dash] of [["BTCDashboard", "buildBtcChatContext", "btc"], ["GoldDashboard", "buildGoldChatContext", "gold"], ["RecessionDashboard", "buildRecessionChatContext", "recession"]]) {
    const src = readFileSync(`client/src/pages/${f}.tsx`, "utf8");
    assert.ok(src.includes(`dashboard="${dash}"`) && src.includes(fn) && src.includes("<ChatWidget"), f);
    assert.ok(!/apiRequest\([^)]*\/api\/chat/.test(src), `${f}: kein eigener Chat-Call`);
  }
  ok("alle drei Seiten nutzen denselben ChatWidget mit eigenem Provider");
  const rr = readFileSync("server/analyze-route.ts", "utf8"); assert.ok(!rr.includes("chat-context")); ok("analyze-route.ts ohne Chat-Bezug");
  console.log(`\n${n} Checks grün`);
}
main().catch(e => { console.error(e); process.exit(1); });
