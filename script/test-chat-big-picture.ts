/**
 * KI-Chat Big Picture + Schema (WORK_KI_CHAT_BIG_PICTURE, WORK_KI_CHAT_SCHEMA, WORK_KI_CHAT_SCHEMA_UPDATE).
 * Kette: buildStockChatContext / withEarningsBriefFacts → POST /api/chat Prompt,
 * GET /api/chat/earnings-brief mit gemocktem FMP (kein Netz).
 * Score, Rating und Live-P werden hier nicht berechnet.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-big-picture.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import express from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CHAT_NEWS_HEADLINE_COUNT, buildStockChatContext, dominantThesisClass, pestelIsStrong,
  withEarningsBriefFacts, type ChatRequestBody,
} from "../shared/chat-context";
import { clipTranscriptExcerpt, earningsBriefNa, latestTranscriptSlot } from "../shared/chat-earnings";
import { CHAT_BIG_PICTURE_TASK, CHAT_SYSTEM_PROMPT, buildChatPrompt } from "../server/chat-route";
import { buildEarningsBrief, registerChatEarningsRoute, resetEarningsBriefCache } from "../server/chat-earnings-route";
import { ChatWidget } from "../client/src/components/chat/ChatWidget";
import { clampChatWindow, parseChatWindow } from "../client/src/lib/chatWindowGeometry";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
process.exitCode = 1;

function mainPrompt(ctx: ChatRequestBody["context"]): string {
  const body: ChatRequestBody = {
    dashboard: "stock", sectionId: null, context: ctx,
    messages: [{ role: "user", content: "Gib das Big Picture." }],
  };
  return buildChatPrompt(body);
}

async function main() {
  assert.equal(CHAT_NEWS_HEADLINE_COUNT, 5);
  assert.equal(pestelIsStrong({ overallExposure: "Mittel", factors: [{ exposureRating: "Niedrig" }] }), false);
  assert.equal(pestelIsStrong({ overallExposure: "Hoch" }), true);
  assert.equal(pestelIsStrong({ overallExposure: "Niedrig", factors: [{ exposureRating: "Hoch" }] }), true);
  assert.equal(pestelIsStrong(null), false);
  ok("PESTEL stark nur bei Schema-Stufe Hoch, sonst nein");

  const lowGrowth = dominantThesisClass({ "Fast Grower": 0.2, Stalwart: 0.15, Cyclical: 0.1 });
  assert.equal(lowGrowth?.name, "Fast Grower");
  assert.equal(lowGrowth?.share, 0.2);
  const nvo = dominantThesisClass({ "Fast Grower": 0.25, Stalwart: 0.4, Cyclical: 0.2 });
  assert.equal(nvo?.name, "Stalwart");
  assert.equal(dominantThesisClass({}) , null);
  assert.equal(dominantThesisClass({ "Fast Grower": Number.NaN }), null);
  ok("Thesis: dominante Klasse ohne Wachstumsschwelle, fehlender Anteil ist null");

  const raw = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  const before = JSON.stringify(raw);
  const ctx = buildStockChatContext(raw);
  assert.equal(JSON.stringify(raw), before);
  const s3 = ctx.sections.find(s => s.id === 3);
  assert.equal(s3?.facts.newsTop, "n/a — keine News in der geladenen Analyse");
  assert.equal(s3?.facts.analystenThesen, "n/a — keine narrativen Analysten-Thesen in den geladenen Daten, nur Buy/Hold/Sell in S1");
  assert.equal(s3?.facts.beatMiss, "n/a — Beat/Miss liegt nicht in der geladenen Analyse");
  assert.equal(typeof ctx.sections.find(s => s.id === 14)?.facts.pestelStark, "string");
  ok("MSFT-Fixture: News und Beat/Miss als n/a mit Grund, Analyse unverändert");

  const withNews = buildStockChatContext({
    ...raw,
    newsItems: [
      { title: "Azure wächst", source: "FT", sentiment: "bullish" },
      { title: "Marge unter Druck", source: "HB", sentiment: "bearish" },
      { title: "Nur Meldung", source: "Lokal", sentiment: "neutral" },
    ],
  });
  const news = String(withNews.sections.find(s => s.id === 3)?.facts.newsTop);
  assert.ok(news.includes("Azure wächst") && news.includes("positiv"));
  assert.ok(news.includes("Marge unter Druck") && news.includes("negativ"));
  assert.equal(withNews.sections.find(s => s.id === 3)?.facts.newsPositiv, "Azure wächst");
  assert.equal(withNews.sections.find(s => s.id === 3)?.facts.newsNegativ, "Marge unter Druck");
  ok(`News: bis zu ${CHAT_NEWS_HEADLINE_COUNT} Schlagzeilen, positiv und negativ getrennt`);

  const brief = {
    ...earningsBriefNa("MSFT", ""),
    status: "ok" as const,
    reason: null,
    year: 2026,
    quarter: 2,
    date: "2026-04-30",
    summary: "Das Management nannte Cloud als Treiber.",
    excerpt: "Cloud demand remained strong.",
    source: "fmp/earning-call-transcript",
  };
  const merged = withEarningsBriefFacts(ctx, brief);
  const facts = merged.sections.find(s => s.id === 3)?.facts;
  assert.equal(facts?.earningsCallZusammenfassung, brief.summary);
  assert.equal(facts?.earningsCallQuartal, "FY2026 Q2");
  assert.equal(facts?.wachstumsthese, ctx.sections.find(s => s.id === 3)?.facts.wachstumsthese);
  const pending = withEarningsBriefFacts(ctx, null);
  assert.equal(pending.sections.find(s => s.id === 3)?.facts.earningsCallHinweis, "n/a — Earnings-Call noch nicht geladen");
  assert.equal(JSON.stringify(ctx), JSON.stringify(buildStockChatContext(raw)));
  ok("Earnings-Brief landet in S3, ohne den übrigen Kontext zu überschreiben");

  const whole = mainPrompt(merged);
  assert.ok(whole.includes("AUFGABE (ganze Analyse)"));
  assert.ok(whole.includes(CHAT_BIG_PICTURE_TASK));
  assert.ok(whole.includes("Cloud als Treiber"));
  assert.ok(/Keine Wachstumsschwelle/.test(CHAT_BIG_PICTURE_TASK));
  assert.ok(/pestelStark=ja/.test(CHAT_BIG_PICTURE_TASK));
  assert.ok(/keine Scores/.test(CHAT_SYSTEM_PROMPT));
  const bound = buildChatPrompt({ dashboard: "stock", sectionId: 7, context: merged, messages: [{ role: "user", content: "Erkläre das DCF." }] });
  assert.ok(!bound.includes("AUFGABE (ganze Analyse)"));
  assert.ok(bound.includes("← GEBUNDEN"));
  ok("Ganze Analyse folgt dem Schema; eine gebundene Sektion bleibt bei der Sektionserklärung");

  const slot = latestTranscriptSlot([
    { quarter: 1, fiscalYear: 2025, date: "2025-01-15" },
    { quarter: 3, fiscalYear: 2026, date: "2026-07-01" },
    { quarter: 9, fiscalYear: 2026, date: "2026-08-01" },
    { quarter: 2, year: 2024, date: "kein-datum" },
  ]);
  assert.deepEqual(slot, { year: 2026, quarter: 3, date: "2026-07-01" });
  assert.equal(latestTranscriptSlot([]), null);
  assert.equal(latestTranscriptSlot({}), null);
  const clip = clipTranscriptExcerpt("aaaa bbbb cccc", 8);
  assert.equal(clip.truncated, true);
  assert.ok(clip.excerpt.endsWith("…"));
  assert.ok(clip.excerpt.length <= 8);
  ok("Letzter Call nach Datum, Auszug endet an der Wortgrenze des Budgets");

  resetEarningsBriefCache();
  const calls: string[] = [];
  const built = await buildEarningsBrief("msft", {
    dates: async () => { calls.push("dates"); return [{ quarter: 4, fiscalYear: 2025, date: "2025-10-30" }]; },
    transcript: async () => { calls.push("transcript"); return [{ content: "Management highlighted Azure and Copilot as growth drivers. Outlook remained unchanged." }]; },
    llmAvailable: () => true,
    llm: async () => ({ data: { summary: "Azure und Copilot wurden als Treiber genannt. Der Ausblick blieb unverändert." }, modelUsed: "m" }),
  });
  assert.equal(built.status, "ok");
  assert.equal(built.summary?.includes("Azure"), true);
  assert.equal(built.year, 2025);
  assert.equal(built.quarter, 4);
  assert.deepEqual(calls, ["dates", "transcript"]);
  const again = await buildEarningsBrief("MSFT", {
    dates: async () => { calls.push("dates2"); return []; },
    transcript: async () => { calls.push("transcript2"); return null; },
    llmAvailable: () => false,
    llm: async () => null,
  });
  assert.equal(again.summary, built.summary);
  assert.deepEqual(calls, ["dates", "transcript"]);
  ok("Brief fasst den Auszug zusammen und holt denselben Ticker nicht erneut");

  resetEarningsBriefCache();
  const noKey = await buildEarningsBrief("SAP", {
    dates: async () => { throw Object.assign(new Error("FMP_API_KEY not set"), {}); },
    transcript: async () => null,
    llmAvailable: () => false,
    llm: async () => null,
  });
  assert.equal(noKey.status, "n/a");
  assert.equal(noKey.summary, null);
  assert.equal(noKey.excerpt, null);
  assert.match(noKey.reason ?? "", /FMP_API_KEY/);
  assert.notEqual(noKey.year, 0);
  ok("Ohne FMP-Key: n/a mit Grund, kein Transkript und kein 0");

  resetEarningsBriefCache();
  const excerptOnly = await buildEarningsBrief("VOW3.DE", {
    dates: async () => [{ quarter: 1, fiscalYear: 2026, date: "2026-03-10" }],
    transcript: async () => ({ content: "Die Nachfrage in Europa blieb stabil." }),
    llmAvailable: () => false,
    llm: async () => { throw new Error("darf nicht laufen"); },
  });
  assert.equal(excerptOnly.status, "ok");
  assert.equal(excerptOnly.summary, null);
  assert.match(excerptOnly.reason ?? "", /OpenRouter/);
  assert.match(excerptOnly.excerpt ?? "", /Europa/);
  ok("Ohne OpenRouter bleibt der Auszug, die Zusammenfassung ist n/a mit Grund");

  const app = express();
  registerChatEarningsRoute(app, {
    dates: async () => [],
    transcript: async () => null,
    llmAvailable: () => false,
    llm: async () => null,
  });
  const srv = app.listen(0);
  const port = (srv.address() as AddressInfo).port;
  try {
    resetEarningsBriefCache();
    const res = await fetch(`http://127.0.0.1:${port}/api/chat/earnings-brief/SAP.DE`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, "n/a");
    assert.match(body.reason, /keinen Earnings-Call-Termin/);
    const bad = await fetch(`http://127.0.0.1:${port}/api/chat/earnings-brief/${encodeURIComponent("bad symbol")}`);
    assert.equal(bad.status, 400);
    ok("GET /api/chat/earnings-brief: n/a bei leeren Terminen, 400 bei ungültigem Symbol");
  } finally {
    srv.close();
  }

  const win = { x: 24, y: 24, w: 420, h: 560, open: true, minimized: false, maximized: false };
  for (const [vw, vh] of [[375, 812], [1440, 900]] as const) {
    const clamped = clampChatWindow(parseChatWindow(JSON.stringify(win), vw, vh), vw, vh);
    assert.ok(clamped.x >= 0 && clamped.y >= 0, `${vw}: Ursprung im Viewport`);
    assert.ok(clamped.x + clamped.w <= vw, `${vw}: Fenster ${clamped.w}px bleibt in ${vw}px`);
    assert.ok(clamped.y + clamped.h <= vh, `${vw}: Höhe bleibt im Viewport`);
    (globalThis as any).window = {
      innerWidth: vw, innerHeight: vh,
      localStorage: { getItem: () => JSON.stringify(win), setItem() {}, removeItem() {} },
      addEventListener() {}, removeEventListener() {},
    };
    const html = renderToStaticMarkup(React.createElement(ChatWidget, {
      dashboard: `brief-${vw}`,
      context: merged,
      sections: [{ id: 3, label: "Investmentthese" }],
      earningsBrief: brief,
    }));
    assert.ok(html.includes('data-testid="chat-earnings-brief"'), html.slice(0, 200));
    assert.ok(html.includes("Das Management nannte Cloud als Treiber."));
    assert.ok(html.includes("break-words"));
    assert.ok(html.includes("max-h-28"));
    ok(`Earnings-Call sichtbar bei ${vw}×${vh}, Fenster ${clamped.w}×${clamped.h}`);
  }

  const loadingHtml = renderToStaticMarkup(React.createElement(ChatWidget, {
    dashboard: "brief-loading",
    context: null,
    sections: [],
    earningsBrief: null,
  }));
  assert.ok(loadingHtml.includes("n/a — Earnings-Call noch nicht geladen"));
  const hidden = renderToStaticMarkup(React.createElement(ChatWidget, {
    dashboard: "no-brief",
    context: null,
    sections: [],
  }));
  assert.ok(!hidden.includes("chat-earnings-brief"));
  ok("Ladezustand nennt den Grund; andere Dashboards ohne Brief zeigen ihn nicht");

  console.log(`chat big picture: ${n} checks ok`);
  process.exitCode = 0;
}

main().then(() => {
  process.exit(process.exitCode ?? 1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
