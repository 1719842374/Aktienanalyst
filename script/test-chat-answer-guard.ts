/**
 * KI-Chat #430 (DoD 7f6c8e4d): Antwort nie still abgeschnitten, Quellzeile immer drin, kein wörtliches \n,
 * Fallback-Grund in Log und Response, Haiku als Code-Default, Markdown in der Earnings-Box,
 * Fiskalquartal nach dem Geschäftsjahresende (ORCL Jun–Aug 2026 = Q1 FY2027).
 * Kette: handleChat (POST /api/chat) mit gestubbtem LLM → ChatResponseBody → useDashboardChat → ChatWidget.
 * Kein Netz, kein Score.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-answer-guard.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildStockChatContext, withEarningsBriefFacts, withIncomeStatementFacts, type ChatRequestBody } from "../shared/chat-context";
import { clipEarningsSummary, earningsBriefNa } from "../shared/chat-earnings";
import { fiscalPeriodOf, incomeBriefNa, secFiscalYearEnd, withFiscalYearEnd, type IncomeStatementBrief } from "../shared/chat-income";
import {
  CHAT_CONTINUATION_MIN_MS, CHAT_LLM_DEFAULT_MODEL, CHAT_LLM_FALLBACK_MODEL, CHAT_LLM_MAX_TOKENS, CHAT_MODEL_ENV, CHAT_TRUNCATED_NOTE,
  chatFallbackReason, chatLlmModels, ensureChatSourceLine, handleChat, normalizeChatAnswer,
} from "../server/chat-route";
import { LLM_JSON_MAX_TOKENS, type LlmAttempt } from "../server/llm-openrouter";
import { ChatWidget } from "../client/src/components/chat/ChatWidget";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
process.exitCode = 1;

const FILING_URL = "https://www.sec.gov/Archives/edgar/data/789019/000119312526436133/msft-20260930.htm";
const RELEASE_URL = "https://www.sec.gov/Archives/edgar/data/789019/000119312526000001/ex99-1.htm";

function incomeBrief(): IncomeStatementBrief {
  return {
    ...incomeBriefNa("MSFT", ""), status: "ok", reason: null, source: "sec-edgar/companyfacts", form: "10-Q",
    accession: "0001193125-26-436133", filed: "2026-10-29", filingUrl: FILING_URL, companyName: "MICROSOFT CORPORATION", currency: "USD",
    period: { start: "2026-07-01", end: "2026-09-30", label: "Q1 FY2027", fiscalYear: 2027, fiscalPeriod: "Q1" },
    priorPeriod: { start: null, end: "2025-09-30", label: "Q1 FY2026", fiscalYear: 2026, fiscalPeriod: "Q1" },
    lines: [{ key: "umsatz", label: "Umsatz", group: "umsatz", parentKey: null, concept: "us-gaap:Revenues", current: 77_673e6, prior: 65_585e6, deltaAbs: 12_088e6, deltaPct: 18.4 }],
  };
}

function request(question: string, sectionId: number | null = null): ChatRequestBody {
  const data = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  const release = {
    ...earningsBriefNa("MSFT", ""), status: "ok" as const, reason: null, date: "2026-10-28", summary: "**Umsatz** +18 %",
    source: "sec-edgar/8-K Exhibit 99.1 (Accession 0001193125-26-000001)", sourceUrl: RELEASE_URL, kind: "earnings-release" as const,
  };
  const context = withIncomeStatementFacts(withEarningsBriefFacts(buildStockChatContext(data), release), incomeBrief());
  return { dashboard: "stock", sectionId, context, messages: [{ role: "user", content: question }] };
}

async function main() {
  // Modell: Haiku ist Code-Default, Env überschreibt weiter.
  assert.equal(CHAT_LLM_DEFAULT_MODEL, "anthropic/claude-haiku-4.5");
  assert.deepEqual(chatLlmModels({}), ["anthropic/claude-haiku-4.5"]);
  assert.deepEqual(chatLlmModels({ [CHAT_MODEL_ENV]: "anthropic/claude-opus-5.5" }), ["anthropic/claude-opus-5.5", CHAT_LLM_FALLBACK_MODEL]);
  assert.ok(!readFileSync("server/chat-route.ts", "utf8").includes('CHAT_LLM_DEFAULT_MODEL = "anthropic/claude-opus'));
  ok(`Code-Default ${CHAT_LLM_DEFAULT_MODEL} (keine Opus-Kette ohne Env), ${CHAT_MODEL_ENV} überschreibt weiter`);
  assert.ok(CHAT_LLM_MAX_TOKENS > 1_800 && CHAT_LLM_MAX_TOKENS <= LLM_JSON_MAX_TOKENS);
  ok(`Token-Budget CHAT_LLM_MAX_TOKENS ${CHAT_LLM_MAX_TOKENS} (vorher 1 800), unter der callLLMJson-Decke ${LLM_JSON_MAX_TOKENS}`);

  // Abgeschnitten → Fortsetzung mit demselben Modell, Ergebnis lückenlos.
  const guv = request("Breakdown the other expenses in the income statement.", 4);
  const calls: Array<{ prompt: string; models?: readonly string[]; maxTokens?: number }> = [];
  const cont = await handleChat(guv, {
    llmAvailable: () => true,
    llm: async (o) => {
      calls.push(o);
      return calls.length === 1
        ? { data: { answer: "| Umsatz | 77.673 | 65.585 | 12.088 (+18,4 %) |\n| Übrige | 3.698 (+101,", sectionRefs: [4] }, modelUsed: "anthropic/claude-haiku-4.5", finishReason: "length", salvaged: true }
        : { data: { answer: "5 %) | n/a | n/a |\n\nQuelle: [10-Q](" + FILING_URL + ")", sectionRefs: [4] }, modelUsed: "anthropic/claude-haiku-4.5", finishReason: "stop" };
    },
  });
  assert.equal(cont.body.status, "ok");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].models, ["anthropic/claude-haiku-4.5"]);
  assert.ok(calls[1].prompt.includes("DEINE BISHERIGE ANTWORT") && calls[1].prompt.includes("3.698 (+101,"));
  assert.ok(cont.body.answer!.includes("3.698 (+101,5 %)"), cont.body.answer!);
  assert.equal(cont.body.continued, true);
  assert.equal(cont.body.truncated, undefined);
  assert.ok(!cont.body.answer!.includes(CHAT_TRUNCATED_NOTE));
  assert.equal(calls[0].maxTokens, CHAT_LLM_MAX_TOKENS);
  ok("finish_reason length → Fortsetzungs-Call, Antwort lückenlos („3.698 (+101,5 %)“), kein Hinweis nötig");

  // Fortsetzung bleibt abgeschnitten → sichtbarer Hinweis, Quellzeile trotzdem da.
  const still = await handleChat(guv, {
    llmAvailable: () => true,
    llm: async () => ({ data: { answer: "| Übrige | 3.698 (+101," }, modelUsed: "m/x", finishReason: "length" }),
  });
  assert.equal(still.body.truncated, true);
  assert.ok(still.body.answer!.includes(CHAT_TRUNCATED_NOTE));
  assert.ok(still.body.answer!.includes(`(${FILING_URL})`));
  ok("bleibt abgeschnitten → truncated=true, sichtbarer Hinweis im Text, Quellzeile mit Filing-Link angehängt");

  // Zu wenig Zeit für die Fortsetzung → kein zweiter Call, Hinweis.
  let tight = 0;
  const noTime = await handleChat(guv, {
    llmAvailable: () => true, timeoutMs: CHAT_CONTINUATION_MIN_MS - 1,
    llm: async () => { tight++; return { data: { answer: "Teil" }, modelUsed: "m/x", finishReason: "length" }; },
  });
  assert.equal(tight, 1);
  assert.equal(noTime.body.truncated, true);
  ok(`unter ${CHAT_CONTINUATION_MIN_MS} ms Restzeit: keine Fortsetzung, Hinweis statt stillem Abbruch`);

  // Quellzeile immer.
  const plain = await handleChat(request("Wie ist das Momentum?"), { llmAvailable: () => true, llm: async () => ({ data: { answer: "RSL n/a." }, modelUsed: "m/x" }) });
  assert.match(plain.body.answer!, /\n\nQuelle: geladene Dashboard-Daten \(.+, Datenstand .+\)$/);
  const guvNoLink = ensureChatSourceLine("Umsatz +18,4 %.", guv);
  assert.ok(guvNoLink.endsWith(`(${FILING_URL})`) && guvNoLink.includes("Quelle: [SEC EDGAR companyfacts (XBRL), 10-Q"));
  const already = `Umsatz +18,4 %.\n\n**Quelle:** [10-Q](${FILING_URL})`;
  assert.equal(ensureChatSourceLine(already, guv), already);
  const earn = ensureChatSourceLine("Release vom 2026-10-28.", request("Was sagte der letzte Earnings Call?"));
  assert.ok(earn.includes(`(${RELEASE_URL})`));
  ok("Quellzeile: GuV → Filing-Link, Earnings → Exhibit-Link, sonst Dashboard-Daten; vorhandene Quelle bleibt unverändert");

  // Kein wörtliches \n.
  assert.equal(normalizeChatAnswer("Kernsatz\\n\\n| a | b |\\n|---|---|"), "Kernsatz\n\n| a | b |\n|---|---|");
  assert.equal(normalizeChatAnswer('{"answer": "Zeile 1\\nZeile 2", "sectionRefs": [4]}'), "Zeile 1\nZeile 2");
  const esc = await handleChat(guv, { llmAvailable: () => true, llm: async () => ({ data: { answer: `Kernsatz\\n\\nQuelle: [10-Q](${FILING_URL})` }, modelUsed: "m/x" }) });
  assert.ok(!esc.body.answer!.includes("\\n") && esc.body.answer!.includes("Kernsatz\n\nQuelle:"));
  ok("doppelt escapte Umbrüche und verschachtelte JSON-Hülle → echte Zeilenumbrüche, kein wörtliches \\n");

  // Fallback-Grund in Response und Log.
  const attempts: LlmAttempt[] = [
    { model: "anthropic/claude-opus-5.5", outcome: "empty", finishReason: "length" },
    { model: "anthropic/claude-haiku-4.5", outcome: "ok", finishReason: "stop" },
  ];
  assert.equal(chatFallbackReason(attempts, "anthropic/claude-haiku-4.5"), "anthropic/claude-opus-5.5: leere Antwort (finish_reason length)");
  assert.equal(chatFallbackReason([{ model: "a/b", outcome: "ok" }], "a/b"), null);
  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (...a: unknown[]) => { logged.push(a.join(" ")); };
  let fb;
  try {
    fb = await handleChat(guv, {
      llmAvailable: () => true,
      llm: async (o) => {
        o.attempts?.push({ model: "x-ai/grok-4", outcome: "http-error", status: 429 }, { model: CHAT_LLM_FALLBACK_MODEL, outcome: "ok", finishReason: "stop" });
        return { data: { answer: "ok" }, modelUsed: CHAT_LLM_FALLBACK_MODEL, finishReason: "stop" };
      },
    });
  } finally {
    console.warn = warn;
  }
  assert.equal(fb.body.fallbackReason, "x-ai/grok-4: HTTP 429");
  assert.ok(logged.some(l => l.includes("[CHAT] Fallback") && l.includes("HTTP 429")), logged.join("\n"));
  const direct = await handleChat(guv, { llmAvailable: () => true, llm: async (o) => { o.attempts?.push({ model: "m/x", outcome: "ok" }); return { data: { answer: "ok" }, modelUsed: "m/x" }; } });
  assert.equal(direct.body.fallbackReason, undefined);
  const hook = readFileSync("client/src/hooks/useDashboardChat.ts", "utf8");
  assert.ok(hook.includes("fallbackReason: body.fallbackReason"));
  assert.ok(readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8").includes('data-testid="chat-fallback-reason"'));
  ok("Fallback-Grund im Log ([CHAT] Fallback …) und als fallbackReason in der Response; Hook und Widget zeigen ihn");

  // Earnings-Box rendert Markdown.
  const summary = clipEarningsSummary("**Umsatz** 77,7 Mrd USD\\n- **Cloud** +26 %\\n- Ausblick n/a", 400);
  assert.equal(summary.excerpt, "**Umsatz** 77,7 Mrd USD\n- **Cloud** +26 %\n- Ausblick n/a");
  (globalThis as any).window = {
    innerWidth: 375, innerHeight: 812,
    localStorage: { getItem: () => JSON.stringify({ x: 0, y: 0, w: 375, h: 600, open: true, minimized: false, maximized: false }), setItem() {}, removeItem() {} },
    addEventListener() {}, removeEventListener() {},
  };
  const html = renderToStaticMarkup(React.createElement(ChatWidget, {
    dashboard: "guard-375", context: guv.context, sections: [{ id: 4, label: "Financial Statements" }],
    earningsBrief: { ...earningsBriefNa("MSFT", ""), status: "ok", reason: null, summary: summary.excerpt },
  }));
  assert.ok(html.includes('data-testid="chat-earnings-text"'));
  assert.ok(html.includes("<strong") && html.includes("Umsatz</strong>"), html);
  assert.ok(!html.includes("**Umsatz**") && !html.includes("\\n"));
  assert.ok(/<li[^>]*>.*Cloud/.test(html));
  ok("Earnings-Box bei 375 px: **Fett** und Listen gerendert, kein rohes Markdown, kein wörtliches \\n");

  // Fiskalquartal nach Geschäftsjahresende.
  const cases: Array<[string, string, string, "quarter" | "year"]> = [
    ["ORCL", "0531", "2026-08-31", "quarter"], ["MSFT", "0630", "2026-09-30", "quarter"], ["AAPL", "0926", "2026-06-27", "quarter"],
    ["RL", "0328", "2026-06-27", "quarter"], ["Kalender", "1231", "2026-09-30", "quarter"], ["53-Wochen", "1231", "2027-01-02", "year"],
    ["MSFT-GJ", "0630", "2026-06-30", "year"],
  ];
  const want = ["Q1 FY2027", "Q1 FY2027", "Q3 FY2026", "Q1 FY2027", "Q3 FY2026", "FY2026", "FY2026"];
  cases.forEach(([name, fye, end, kind], i) => assert.equal(fiscalPeriodOf(end, kind, fye)?.label, want[i], name));
  assert.equal(secFiscalYearEnd({ fiscalYearEnd: "0531" }), "0531");
  assert.equal(secFiscalYearEnd({ fiscalYearEnd: "1399" }), null);
  assert.equal(secFiscalYearEnd(null), null);
  const orclXbrl: IncomeStatementBrief = {
    ...incomeBrief(), symbol: "ORCL", form: "10-Q",
    period: { start: "2026-06-01", end: "2026-08-31", label: "Q1 FY2026", fiscalYear: 2026, fiscalPeriod: "Q1" },
    priorPeriod: { start: null, end: "2025-08-31", label: "Q1 FY2025", fiscalYear: 2025, fiscalPeriod: "Q1" },
  };
  const orcl = withFiscalYearEnd(orclXbrl, "0531");
  assert.equal(orcl.period?.label, "Q1 FY2027");
  assert.equal(orcl.priorPeriod?.label, "Q1 FY2026");
  assert.ok(orcl.notes.some(x => x.includes("31.05.") && x.includes("Q1 FY2026")));
  const keep = withFiscalYearEnd(orclXbrl, null);
  assert.equal(keep.period?.label, "Q1 FY2026");
  assert.ok(keep.notes.some(x => /Geschäftsjahresende fehlt/.test(x)));
  const facts = withIncomeStatementFacts(buildStockChatContext({ ticker: "ORCL" } as any), orcl).sections.find(s => s.id === 4)!.facts;
  assert.ok(String(facts.guvPeriode).startsWith("Q1 FY2027 (2026-06-01 bis 2026-08-31) gegen Q1 FY2026"));
  const route = readFileSync("server/chat-income-route.ts", "utf8");
  assert.ok(route.includes("withFiscalYearEnd(base, secFiscalYearEnd(submissions))"));
  ok("ORCL Jun–Aug 2026 = Q1 FY2027 (Vorjahr Q1 FY2026) aus fiscalYearEnd 0531; MSFT, AAPL, RL, Kalenderjahr und 53-Wochen-Jahr stimmen");

  console.log(`\nchat answer guard: ${n} Checks grün.`);
  process.exitCode = 0;
}

main().then(() => process.exit(process.exitCode ?? 1)).catch((err) => { console.error(err); process.exit(1); });
