/**
 * F1-36 / F1-37 / F1-40: φ (Auslandsumsatz-Anteil) per callLLMJson, Cache,
 * Fallback aus letztem Cache, sonst Median der Historie, sonst n/a. Globalisierungsbereinigte Quote als
 * Kennzahl und zweite Linie im BuffettRatioPanel (#/recession). Kein Score.
 *
 * Datenfluss: BuffettRatioPanel → useQuery-fetch /api/analyze-recession/buffett-phi
 * → registerBuffettPhiRoute (über registerBuffettRatioRoute) → resolveUsForeignShare
 * → shared/buffett-phi.ts. Gemockt ist nur der LLM-Aufruf und Yahoo/FRED.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-buffett-phi-f1-36.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { installFakeDom, findByTestId, reactPropsOf, FakeElement, FakeText, type FakeNode } from "./lib/fake-dom";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const { doc } = installFakeDom();
(FakeElement.prototype as any).getElementsByClassName = () => [];

async function main() {
  const shared = await import("../shared/buffett-phi");
  const phiSrc = readFileSync("shared/buffett-phi.ts", "utf8") + readFileSync("server/buffett-phi-route.ts", "utf8");
  assert.ok(!/PHI_FALLBACK\s*=/.test(phiSrc) && !/=\s*0\.40\b/.test(phiSrc), "kein festes φ 0,40");
  assert.equal(shared.derivePhiFallback(0.52, [0.28, 0.36, 0.52]).kind, "cache");
  assert.equal(shared.derivePhiFallback(0.52, [0.28, 0.36, 0.52]).phi, 0.52);
  assert.equal(shared.derivePhiFallback(null, [0.28, 0.36, 0.52]).phi, 0.36);
  assert.equal(shared.derivePhiFallback(null, [0.28, 0.36, 0.52]).kind, "median");
  assert.equal(shared.medianOfPhi([0.25, 0.5]), 0.375);
  assert.equal(shared.derivePhiFallback(null, []).kind, "none");
  assert.equal(shared.derivePhiFallback(null, []).phi, null);
  assert.equal(shared.globalizationAdjustedPct(200, 0.4), 120);
  assert.equal(shared.globalizationAdjustedPct(244.6, 0.42), 141.9);
  assert.equal(shared.globalizationAdjustedPct(Number.NaN, 0.4), null);
  assert.equal(shared.globalizationAdjustedPct(200, Number.NaN), null);
  assert.equal(shared.globalizationAdjustedPct(200, 1), null);
  assert.equal(shared.globalizationAdjustedPct(200, -0.1), null);
  assert.deepEqual(shared.parsePhiPayload({ phi: 0.42 }), { phi: 0.42, reason: null });
  assert.deepEqual(shared.parsePhiPayload({ phi: "0.55" }).phi, 0.55);
  assert.equal(shared.parsePhiPayload({ phi: 0.24 }).phi, null);
  assert.equal(shared.parsePhiPayload({ phi: 0.56 }).phi, null);
  assert.equal(shared.parsePhiPayload({}).phi, null);
  assert.equal(shared.parsePhiPayload(null).phi, null);
  assert.equal(shared.parsePhiPayload({ phi: 0 }).phi, null);
  ok("Formel: Quote × (1 − φ), gerundet auf 0,1; außerhalb 0,25–0,55 oder ohne Zahl → null, nie 0");

  const route = await import("../server/buffett-phi-route");
  const calls: unknown[] = [];
  const llm = async (opts: { prompt: string }) => {
    calls.push(opts);
    return { data: { phi: 0.42 }, modelUsed: "test-model" };
  };
  route.setBuffettPhiLlmForTests({ available: true, call: llm });
  const t0 = Date.parse("2026-11-01T12:00:00Z");
  let body = await route.resolveUsForeignShare(t0);
  assert.equal(body.phi, 0.42);
  assert.equal(body.source, "llm");
  assert.equal(body.fallback, false);
  assert.equal(body.fromCache, false);
  assert.equal(body.model, "test-model");
  assert.equal(body.fallbackPhi, null);
  assert.ok(Math.abs((body.domesticShare ?? NaN) - 0.58) < 1e-12);
  assert.equal(calls.length, 1);
  assert.ok(String((calls[0] as { prompt: string }).prompt).includes("außerhalb der USA"));
  body = await route.resolveUsForeignShare(t0 + 1000);
  assert.equal(body.source, "cache");
  assert.equal(body.phi, 0.42);
  assert.equal(body.fromCache, true);
  assert.equal(calls.length, 1, "gültiger LLM-Wert bleibt eine Woche im Cache");
  route.setBuffettPhiLlmForTests({ available: true, call: async () => null });
  body = await route.resolveUsForeignShare(t0 + shared.PHI_CACHE_MS + 1);
  assert.equal(body.fallback, true);
  assert.equal(body.phi, 0.42);
  assert.match(body.reason ?? "", /Fallback/);
  assert.match(body.reason ?? "", /letzter gültiger/);
  const step = shared.PHI_CACHE_MS + 1;
  const series = [0.28, 0.36, 0.52];
  let stepIndex = 0;
  route.resetBuffettPhiCache();
  route.setBuffettPhiLlmForTests({
    available: true,
    call: async () => ({ data: { phi: series[stepIndex++] }, modelUsed: "test-model" }),
  });
  for (let i = 0; i < series.length; i++) {
    body = await route.resolveUsForeignShare(t0 + i * step);
    assert.equal(body.phi, series[i]);
    assert.equal(body.fallback, false);
  }
  route.setBuffettPhiLlmForTests({ available: true, call: async () => null });
  body = await route.resolveUsForeignShare(t0 + series.length * step);
  assert.equal(body.phi, 0.52);
  assert.equal(body.fallback, true);
  assert.match(body.reason ?? "", /letzter gültiger/);
  route.dropBuffettPhiLastCacheForTests();
  body = await route.resolveUsForeignShare(t0 + (series.length + 1) * step);
  assert.equal(body.phi, 0.36);
  assert.equal(body.fallback, true);
  assert.match(body.reason ?? "", /Fallback/);
  assert.match(body.reason ?? "", /Median/);
  route.resetBuffettPhiCache();
  body = await route.resolveUsForeignShare(t0);
  assert.equal(body.phi, null);
  assert.equal(body.fallback, false);
  assert.match(body.reason ?? "", /kein φ verfügbar/);
  assert.notEqual(body.phi, 0.4);
  route.setBuffettPhiLlmForTests({
    available: true,
    call: async () => ({ data: { phi: 0.9 }, modelUsed: "test-model" }),
  });
  body = await route.resolveUsForeignShare(t0);
  assert.equal(body.phi, null);
  assert.match(body.reason ?? "", /außerhalb/);
  assert.match(body.reason ?? "", /kein φ verfügbar/);
  route.setBuffettPhiLlmForTests({ available: false, call: async () => { throw new Error("nicht rufen"); } });
  body = await route.resolveUsForeignShare(t0 + 5);
  assert.equal(body.phi, null);
  assert.match(body.reason ?? "", /nicht verfügbar/);
  assert.match(body.reason ?? "", /kein φ verfügbar/);
  const eu = route.phiBodyForRegion("EU");
  assert.equal(eu.phi, null);
  assert.equal(eu.domesticShare, null);
  assert.equal(eu.fallback, false);
  assert.equal(eu.fallbackPhi, null);
  assert.match(eu.reason ?? "", /nur für die USA/);
  ok("LLM φ = 0,42; Fallback = letzter Cache, sonst Median 0,36, sonst n/a ohne feste Zahl; EU ohne Zahl");

  // ── Route + Buffett-Antwort ohne neue Felder ──
  const express = (await import("express")).default;
  const buffett = await import("../server/buffett-route");
  buffett.setBuffettRetryPauseForTests(0);
  const app = express();
  buffett.registerBuffettRatioRoute(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  const FIX = "script/fixtures/buffett";
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) {
      const id = new URL(url).searchParams.get("id")!;
      return new Response(readFileSync(`${FIX}/${id}-2026-10-18.csv`, "utf8"), { status: 200 });
    }
    if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")) {
      const symbol = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
      if (symbol === "^W5000") return new Response(readFileSync(`${FIX}/W5000-2026-10-18.json`, "utf8"), { status: 200 });
      return new Response("nf", { status: 404 });
    }
    if (url.startsWith("/api/")) return realFetch(base + url, init);
    throw new Error(`unerwarteter Abruf ${url}`);
  };
  route.resetBuffettPhiCache();
  route.setBuffettPhiLlmForTests({ available: true, call: llm });
  calls.length = 0;
  const phiRes = await realFetch(`${base}/api/analyze-recession/buffett-phi?region=US`);
  const phiJson = await phiRes.json() as any;
  assert.equal(phiRes.status, 200);
  assert.equal(phiJson.phi, 0.42);
  assert.equal(phiJson.source, "llm");
  const again = await (await realFetch(`${base}/api/analyze-recession/buffett-phi?region=US`)).json() as any;
  assert.equal(again.source, "cache");
  assert.equal(calls.length, 1);
  const euJson = await (await realFetch(`${base}/api/analyze-recession/buffett-phi?region=EU`)).json() as any;
  assert.equal(euJson.phi, null);
  assert.equal((await realFetch(`${base}/api/analyze-recession/buffett-phi?region=XX`)).status, 400);
  route.resetBuffettPhiCache();
  route.setBuffettPhiLlmForTests({ available: false, call: async () => null });
  const fbJson = await (await realFetch(`${base}/api/analyze-recession/buffett-phi?region=US`)).json() as any;
  assert.equal(fbJson.fallback, false);
  assert.equal(fbJson.phi, null);
  assert.match(fbJson.reason, /kein φ verfügbar/);
  assert.ok(!/0[,.]40/.test(JSON.stringify(fbJson)), "keine feste 0,40 in der Antwort");
  const bu = await (await realFetch(`${base}/api/analyze-recession/buffett?region=US`)).json() as any;
  assert.ok(!("phi" in bu) && !("adjustedRatio" in bu) && !("domesticShare" in bu), "Buffett-Antwort ohne φ-Felder");
  assert.equal(typeof bu.latest.ratio, "number");
  ok(`Route: LLM 0,42 dann Cache; EU phi null; XX 400; ohne Historie n/a; Buffett-Quote ${bu.latest.ratio} % unverändert ohne φ-Felder`);

  // ── UI ──
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { BuffettRatioPanel, buffettPhiLine } = await import("../client/src/components/recession/BuffettRatioPanel");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const textOf = (nd: FakeNode | null): string => !nd ? "" : nd instanceof FakeText ? nd.nodeValue : nd.childNodes.map(textOf).join("");
  const adjusted = shared.globalizationAdjustedPct(bu.latest.ratio, 0.42);
  assert.equal(buffettPhiLine("EU", { data: phiJson, loading: false, error: null }, bu.latest.ratio), "Globalisierungsbereinigt: n/a — Auslandsumsatz-Anteil φ ist nur für die USA geschätzt");
  const llmLine = buffettPhiLine("US", { data: phiJson, loading: false, error: null }, bu.latest.ratio);
  assert.ok(llmLine.startsWith(`Globalisierungsbereinigt: ${adjusted!.toFixed(1).replace(".", ",")} %`), llmLine);
  assert.ok(llmLine.includes("LLM φ = 0,42") && llmLine.includes("kein Score") && llmLine.includes("n/a — kein aus den Daten abgeleitetes Gewicht"), llmLine);
  assert.ok(!llmLine.includes("Fallback"), llmLine);
  const fbLine = buffettPhiLine("US", { data: fbJson, loading: false, error: null }, bu.latest.ratio);
  assert.equal(fbLine, "Globalisierungsbereinigt: n/a — kein φ verfügbar — LLM nicht verfügbar");
  assert.ok(!fbLine.includes("0,40") && !fbLine.includes("LLM φ"), fbLine);
  const medianLine = buffettPhiLine("US", {
    data: { ...phiJson, phi: 0.36, fallback: true, fallbackPhi: 0.36, source: "fallback", fromCache: false, reason: "Fallback — Median aus 3 gespeicherten φ-Schätzungen — LLM lieferte kein JSON", model: null },
    loading: false,
    error: null,
  }, bu.latest.ratio);
  assert.ok(medianLine.includes("Fallback") && medianLine.includes("0,36") && medianLine.includes("Median") && !medianLine.includes("LLM φ"), medianLine);
  const naLine = buffettPhiLine("US", { data: euJson, loading: false, error: null }, bu.latest.ratio);
  assert.ok(naLine.includes("n/a —") && !/\d+,\d %/.test(naLine.split("n/a —")[0] + naLine), naLine);
  ok("Kennzahl: LLM-Prozent, Median als Fallback markiert, ohne Historie n/a — kein φ verfügbar");

  route.resetBuffettPhiCache();
  route.setBuffettPhiLlmForTests({ available: true, call: llm });
  calls.length = 0;
  async function mount(until: (c: FakeNode) => boolean) {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(BuffettRatioPanel))); });
    for (let i = 0; i < 200 && !until(c); i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
    return { c, done: async () => { await act(async () => { root.unmount(); qc.clear(); }); } };
  }
  const line = (c: FakeNode) => textOf(findByTestId(c, "text-buffett-phi"));
  let m = await mount(c => line(c).includes("LLM φ"));
  assert.ok(line(m.c).includes(`${adjusted!.toFixed(1).replace(".", ",")} %`) && line(m.c).includes("nur Anzeige, kein Score"), line(m.c));
  const panelSrc = readFileSync("client/src/components/recession/BuffettRatioPanel.tsx", "utf8");
  assert.ok(panelSrc.includes('dataKey="adjustedRatio"') && panelSrc.includes('name="Globalisierungsbereinigt"'), "zweite Linie im Chart");
  assert.ok(!panelSrc.includes("whitespace-nowrap"), "Zeile umbricht auf 375 px");
  assert.ok(panelSrc.includes("boxW = props.wide ? 292 : 236"), "Callout-Breite 375/1440 unverändert");
  const euBtn = findByTestId(m.c, "button-buffett-EU")!;
  await act(async () => { reactPropsOf(euBtn).onClick(); });
  for (let i = 0; i < 100 && !line(m.c).includes("nur für die USA"); i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  assert.equal(line(m.c), "Globalisierungsbereinigt: n/a — Auslandsumsatz-Anteil φ ist nur für die USA geschätzt");
  await m.done();
  ok("UI US: bereinigte Kennzahl und dataKey adjustedRatio; EU: n/a; Callout 236/292 px bleibt");

  route.resetBuffettPhiCache();
  route.setBuffettPhiLlmForTests({ available: false, call: async () => null });
  m = await mount(c => line(c).includes("kein φ verfügbar"));
  assert.equal(line(m.c), "Globalisierungsbereinigt: n/a — kein φ verfügbar — LLM nicht verfügbar");
  assert.ok(!line(m.c).includes("0,40"), line(m.c));
  assert.ok(panelSrc.includes("{phi != null && ("), "ohne φ keine zweite Linie");
  await m.done();
  ok("UI ohne Historie: „n/a — kein φ verfügbar“, keine feste Zahl, zweite Linie nur bei φ");

  // ── nicht in der Aktienanalyse, nicht im Score ──
  const card = readFileSync("client/src/components/sections/BuffettMacroCard.tsx", "utf8");
  const dash = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
  const analyze = readFileSync("server/analyze-route.ts", "utf8");
  const recession = readFileSync("server/recession.ts", "utf8");
  assert.ok(!card.includes("buffett-phi") && !dash.includes("buffett-phi"));
  assert.ok(!analyze.includes("buffett-phi") && !analyze.includes("globalizationAdjustedPct"));
  assert.ok(!recession.includes("buffett-phi") && !recession.includes("PHI_FALLBACK") && !recession.includes("derivePhiFallback"));
  const { buffettReading, probabilityFromNet, anchoredRecessionProbability, scoredTotals } = await import("../server/recession");
  assert.equal(buffettReading(230).rawScore, 8);
  assert.equal(buffettReading(230).weightedScore, 16);
  assert.equal(buffettReading(200).rawScore, 5);
  assert.equal(buffettReading(165).rawScore, 5);
  assert.equal(buffettReading(140).rawScore, 2);
  assert.equal(buffettReading(139).rawScore, -4);
  assert.equal(probabilityFromNet(0, 10), 50);
  assert.equal(probabilityFromNet(4, 16), 65);
  assert.equal(probabilityFromNet(-8, 16), 25);
  assert.deepEqual(anchoredRecessionProbability(4, 16, 30), { formulaPct: 62.5, anchorPct: 30, probability: 55 });
  assert.deepEqual(anchoredRecessionProbability(4, 16, null), { formulaPct: 62.5, anchorPct: null, probability: 65 });
  assert.deepEqual(scoredTotals([buffettReading(230), buffettReading(Number.NaN)]), { net: 16, max: 16 });
  const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
  assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
  assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
  console.log("     Vorher/Nachher Rezession (Funktionen unverändert): P(0/10)=50, P(4/16)=65, P(−8/16)=25, Anker 30 → 55");
  console.log("     Vorher/Nachher Score-Pin: VOW3/VWAGY 4.735718, SAP 5.174758, MSFT 4.058138");
  ok("Aktienkarte und analyze-route ohne φ; Buffett-Score und Rezessions-P wie vor der Änderung");

  server.close();
  route.setBuffettPhiLlmForTests(null);
  console.log(`\n${n} Checks grün`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
