/**
 * Offen_WORK_BUFFETT_ASIA_10Y §1 — Buffett-Karte im Aktien-Dashboard (unter Sektion 12).
 * Echte BuffettMacroCard (react-dom + fake-dom) → fetch /api/analyze-recession/buffett (gemockt) → Wert, σ, Zone / n/a.
 * Score-Beweis: buildBiasDecision MSFT/SPY mit/ohne Buffett-Daten deepEqual.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-buffett-stock-card.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, findByTestId, FakeElement, FakeText, type FakeNode } from "./lib/fake-dom";
import { buffettZone, formatSigma } from "../shared/buffett-zone";

(globalThis as any).React = React;
let n = 0;
const ok = (s: string) => { n++; console.log(`  ✅ ${s}`); };
const { doc } = installFakeDom();
(FakeElement.prototype as any).getElementsByClassName = () => [];

const OK_BODY = {
  region: "US", asOf: "2026-10-23", fallback: null, note: "", sources: [], points: [],
  latest: { date: "2026-10-23", ratio: 244.6, trend: 134.3, plus1: 178.5, plus2: 222.7, minus1: 90.1, minus2: 45.9, premiumPct: 82.2, zScore: 2.5 },
};
const NA_BODY = { error: "Buffett-Quote nicht verfügbar: Yahoo ^W5000: HTTP 503 (2 Versuche)", errorCode: "BUFFETT_SOURCE_UNAVAILABLE", reason: "Yahoo ^W5000: HTTP 503 (2 Versuche)" };
let mode: "ok" | "na" = "ok";
(globalThis as any).fetch = async (u: string) => {
  assert.equal(String(u), "/api/analyze-recession/buffett?region=US", "Endpoint aus #274 wiederverwendet");
  return mode === "ok" ? new Response(JSON.stringify(OK_BODY), { status: 200 }) : new Response(JSON.stringify(NA_BODY), { status: 502 });
};

async function main() {
  // 1. Zonen laut Spec
  assert.equal(buffettZone(2.6)?.label, "stark überbewertet");
  assert.equal(buffettZone(2)?.label, "stark überbewertet");
  assert.equal(buffettZone(1.99)?.label, "überbewertet");
  assert.equal(buffettZone(1)?.label, "überbewertet");
  assert.equal(buffettZone(0)?.label, "fair");
  assert.equal(buffettZone(-0.99)?.label, "fair");
  assert.equal(buffettZone(-1)?.label, "unterbewertet");
  assert.equal(buffettZone(null), null);
  assert.equal(buffettZone(NaN), null);
  assert.equal(formatSigma(2.5), "+2,5 σ");
  assert.equal(formatSigma(-1.24), "−1,2 σ");
  ok("Zonen: ≥2σ stark überbewertet · ≥1σ überbewertet · (−1σ,1σ) fair · ≤−1σ unterbewertet; n/a bei fehlendem Wert");

  // 2. UI
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { BuffettMacroCard } = await import("../client/src/components/sections/BuffettMacroCard");
  const { Router } = await import("wouter");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const textOf = (nd: FakeNode | null): string => !nd ? "" : nd instanceof FakeText ? nd.nodeValue : nd.childNodes.map(textOf).join("");
  async function mount(until: (c: FakeNode) => boolean) {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Router, null, React.createElement(BuffettMacroCard)))); });
    for (let i = 0; i < 200 && !until(c); i++) await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    return { c, done: async () => { await act(async () => { root.unmount(); qc.clear(); }); } };
  }
  mode = "ok";
  let m = await mount(c => !!findByTestId(c, "buffett-macro-ok"));
  const t = textOf(findByTestId(m.c, "buffett-macro-ok"));
  assert.ok(t.includes("245 %") && t.includes("Trend 134 %") && t.includes("+2,5 σ") && t.includes("+82 % zum Trend"), t);
  assert.equal(textOf(findByTestId(m.c, "buffett-macro-zone")), "stark überbewertet");
  assert.ok(textOf(m.c).includes("kein Score-Einfluss"));
  await m.done();
  mode = "na";
  m = await mount(c => textOf(findByTestId(c, "buffett-macro-na")).includes("HTTP 503"));
  assert.equal(textOf(findByTestId(m.c, "buffett-macro-na")), "n/a — Yahoo ^W5000: HTTP 503 (2 Versuche)");
  assert.ok(!findByTestId(m.c, "buffett-macro-zone"), "keine Zone ohne Wert");
  await m.done();
  ok("Karte: OK → 245 %, Trend, +2,5 σ, +82 %, „stark überbewertet“; 502 → n/a mit Grund, keine Zone");

  // 3. Score unverändert
  const { buildBiasDecision } = await import("../shared/bias-fixes");
  for (const name of ["MSFT", "SPY"]) {
    const d = JSON.parse(readFileSync(`script/fixtures/analysis-${name}.json`, "utf8"));
    const b0 = buildBiasDecision(d);
    for (const extra of [{ buffett: OK_BODY }, { buffett: NA_BODY }, { buffettZone: buffettZone(2.5) }]) assert.deepEqual(buildBiasDecision({ ...d, ...extra } as any), b0);
    console.log(`     ${name}: ohne ${b0.overallScore.toFixed(4)} ${b0.overallRating} · mit Buffett OK / n/a / Zone identisch (deepEqual)`);
  }
  const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
  assert.ok(dash.includes("<TechnicalChart data={data} /><BuffettMacroCard /></SectionErrorBoundary>"), "Karte in Sektion 12, ohne Prop an data");
  const card = readFileSync("client/src/components/sections/BuffettMacroCard.tsx", "utf8");
  assert.ok(!/setData|onThesisScore|overallScore/.test(card), "Karte schreibt nichts zurück");
  ok("Score: MSFT/SPY mit/ohne Buffett deepEqual; Karte liest nur, schreibt nicht in data");
  console.log(`\n${n} Checks grün`);
  process.exit(0);
}
main().catch(e => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
