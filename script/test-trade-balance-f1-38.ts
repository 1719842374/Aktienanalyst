/**
 * F1-38 Handelsbilanz/BIP (FRED BOPGSTB ÷ GDP) im Buffett-Panel — nur Anzeige, kein Score.
 * Datenfluss: echtes BuffettRatioPanel (react-dom + script/lib/fake-dom) → useQuery-fetch
 * /api/analyze-recession/trade-balance → echte Express-Route (server/trade-balance-route.ts, registriert über registerBuffettRatioRoute) → fetchFredCsv
 * (server/fred-csv.ts) → shared/trade-balance.ts tradeBalanceToGdp.
 * Gemockt ist nur globales fetch für FRED/Yahoo: echte fredgraph-CSVs vom 25.10.2026
 * (script/fixtures/trade-balance-f1-38-live.json) bzw. die Buffett-Snapshots vom 18.10.2026.
 * Ausführen (Repo-Root): npx tsx --tsconfig script/tsconfig.jsx.json script/test-trade-balance-f1-38.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { installFakeDom, findByTestId, reactPropsOf, FakeElement, FakeText, type FakeNode } from "./lib/fake-dom";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const LIVE = JSON.parse(readFileSync("script/fixtures/trade-balance-f1-38-live.json", "utf8")) as Record<string, string>;
const BFIX = "script/fixtures/buffett";
const { doc } = installFakeDom();
(FakeElement.prototype as any).getElementsByClassName = () => [];

type Mode = "ok" | "503" | "html" | "gap";
const mode: Record<string, Mode> = {};
const hits: Record<string, number> = {};

function fred(url: URL): Response {
  const id = url.searchParams.get("id")!;
  const cosd = url.searchParams.get("cosd");
  const tb = cosd === "2020-01-01" && (id === "BOPGSTB" || id === "GDP");
  if (tb) {
    hits[id] = (hits[id] ?? 0) + 1;
    const m = mode[id] ?? "ok";
    if (m === "503") return new Response("err", { status: 503 });
    if (m === "html") return new Response("<!DOCTYPE html><html></html>", { status: 200 });
    if (m === "gap") { const l = LIVE[id].trim().split("\n"); l.splice(l.length - 5, 1); return new Response(l.join("\n"), { status: 200 }); }
    return new Response(LIVE[id], { status: 200 });
  }
  const p = `${BFIX}/${id}-2026-10-18.csv`;
  return existsSync(p) ? new Response(readFileSync(p, "utf8"), { status: 200 }) : new Response("nf", { status: 404 });
}

async function main() {
  // Erwartung unabhängig gerechnet: Summe der letzten 12 BOPGSTB-Monate (Mio $) / 1000 ÷ letzter GDP-Wert (Mrd $) × 100
  const rows = (csv: string) => csv.trim().split("\n").slice(1).map(l => l.split(",")).filter(([, v]) => Number.isFinite(Number(v)) && v !== "").map(([d, v]) => ({ date: d, value: Number(v) }));
  const bop = rows(LIVE.BOPGSTB), gdp = rows(LIVE.GDP);
  const last12 = bop.slice(-12);
  const gdpLast = gdp.filter(g => g.date <= last12[11].date).pop()!;
  const expPct = last12.reduce((s, p) => s + p.value, 0) / 1000 / gdpLast.value * 100;

  // ── 1. Helfer ──
  const shared = await import("../shared/trade-balance");
  const h = shared.tradeBalanceToGdp(bop, gdp);
  assert.ok(h.value && h.reason === null);
  assert.ok(Math.abs(h.value.pct - expPct) < 1e-9);
  assert.equal(h.value.asOf, last12[11].date); assert.equal(h.value.from, last12[0].date); assert.equal(h.value.gdpDate, gdpLast.date);
  assert.ok(h.value.pctYearAgo != null && h.value.asOfYearAgo === bop[bop.length - 13].date);
  const gap = bop.slice(); gap.splice(gap.length - 4, 1);
  assert.equal(shared.tradeBalanceToGdp(gap, gdp).value, null);
  assert.ok(shared.tradeBalanceToGdp(gap, gdp).reason);
  assert.equal(shared.tradeBalanceToGdp(bop.slice(-5), gdp).value, null);
  assert.equal(shared.tradeBalanceToGdp(bop, []).value, null);
  ok(`Helfer: ${h.value.pct.toFixed(2)} % (12M ${h.value.from}…${h.value.asOf} = ${h.value.ttmBn.toFixed(1)} Mrd $ ÷ BIP ${gdpLast.value} am ${gdpLast.date}); Lücke/zu kurz/kein BIP → null + Grund`);

  // ── 2. Route ──
  const express = (await import("express")).default;
  const buffett = await import("../server/buffett-route");
  buffett.setBuffettRetryPauseForTests(0);
  const tbr = await import("../server/trade-balance-route");
  const app = express();
  buffett.registerBuffettRatioRoute(app); // registriert /api/analyze-recession/trade-balance mit (wie in routes-register.ts)
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) return fred(new URL(url));
    if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")) {
      return url.includes("%5EW5000") || url.includes("^W5000") ? new Response(readFileSync(`${BFIX}/W5000-2026-10-18.json`, "utf8"), { status: 200 }) : new Response("nf", { status: 404 });
    }
    if (url.startsWith("/api/")) return realFetch(base + url, init);
    throw new Error(`unerwarteter Abruf ${url}`);
  };
  const origErr = console.error, origWarn = console.warn;
  const quiet = () => { console.error = () => {}; console.warn = () => {}; };
  const loud = () => { console.error = origErr; console.warn = origWarn; };
  const reset = (m: Record<string, Mode> = {}) => { tbr.resetTradeBalanceCache(); buffett.resetBuffettCache(); for (const k of Object.keys(mode)) delete mode[k]; Object.assign(mode, m); for (const k of Object.keys(hits)) delete hits[k]; };
  const get = async () => { const r = await realFetch(`${base}/api/analyze-recession/trade-balance`); return { status: r.status, body: await r.json() as any }; };

  reset();
  let r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.seriesId, "BOPGSTB"); assert.equal(r.body.reason, null);
  assert.ok(Math.abs(r.body.value.pct - expPct) < 1e-9);
  await get(); assert.equal(hits.BOPGSTB, 1, "Wert 12 h gecacht");
  reset({ BOPGSTB: "503" }); r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.value, null); assert.equal(r.body.reason, "FRED BOPGSTB nicht erreichbar oder leer");
  mode.BOPGSTB = "ok"; r = await get(); assert.ok(r.body.value, "Fehler wird nicht gecacht");
  reset({ GDP: "html" }); r = await get(); assert.equal(r.body.reason, "FRED GDP nicht erreichbar oder leer");
  reset({ BOPGSTB: "gap" }); r = await get(); assert.equal(r.body.value, null); assert.ok(r.body.reason);
  ok(`Route: ${r.status} JSON, Wert = Erwartung, 12h-Cache; BOPGSTB 503 / GDP HTML / Monatslücke → value null + Grund (n/a), Fehler nicht gecacht`);

  // ── 3. Buffett-Antwort unverändert (keine neuen Felder) ──
  reset();
  const bu = await (await realFetch(`${base}/api/analyze-recession/buffett?region=US`)).json() as any;
  assert.ok(!Object.keys(bu).some(k => /trade/i.test(k)), "Buffett-Antwort ohne Handelsbilanz-Felder");
  assert.equal(hits.BOPGSTB ?? 0, 0, "Buffett-Route ruft BOPGSTB nicht ab");
  ok("Buffett-Route unverändert: keine trade*-Felder, kein BOPGSTB-Abruf");

  // ── 4. UI ──
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { BuffettRatioPanel } = await import("../client/src/components/recession/BuffettRatioPanel");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const textOf = (nd: FakeNode | null): string => !nd ? "" : nd instanceof FakeText ? nd.nodeValue : nd.childNodes.map(textOf).join("");
  async function mount(until: (c: FakeNode) => boolean) {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    quiet();
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(BuffettRatioPanel))); });
    for (let i = 0; i < 200 && !until(c); i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
    loud();
    return { c, done: async () => { quiet(); await act(async () => { root.unmount(); qc.clear(); }); loud(); } };
  }
  const line = (c: FakeNode) => textOf(findByTestId(c, "text-buffett-trade-balance"));
  reset();
  let m = await mount(c => line(c).includes("Mrd."));
  let t = line(m.c);
  const pctTxt = `−${Math.abs(expPct).toFixed(1).replace(".", ",")} %`;
  assert.ok(t.startsWith(`Handelsbilanz/BIP (FRED BOPGSTB): ${pctTxt}`), t);
  assert.ok(t.includes("nur Anzeige, kein Score") && t.includes("Vorjahr") && t.includes("August 2026"), t);
  // EU → n/a, kein neuer Abruf nötig
  const eu = findByTestId(m.c, "button-buffett-EU")!;
  quiet(); await act(async () => { reactPropsOf(eu).onClick(); }); loud();
  for (let i = 0; i < 100 && !line(m.c).includes("nur für die USA"); i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
  assert.equal(line(m.c), "Handelsbilanz/BIP (FRED BOPGSTB): n/a — Reihe gilt nur für die USA");
  await m.done();
  ok(`UI US: „${t.slice(0, 90)}…“; EU: n/a nur USA`);

  reset({ BOPGSTB: "503" });
  m = await mount(c => line(c).includes("n/a"));
  t = line(m.c);
  assert.equal(t, "Handelsbilanz/BIP (FRED BOPGSTB): n/a — FRED BOPGSTB nicht erreichbar oder leer");
  assert.ok(!/\d+,\d %/.test(t), "keine erfundene Zahl");
  await m.done();
  ok("UI n/a: BOPGSTB 503 → „n/a — FRED BOPGSTB nicht erreichbar oder leer“, keine Zahl");

  // ── 5. Kein Score / analyze-route unberührt ──
  const src = readFileSync("server/trade-balance-route.ts", "utf8") + readFileSync("shared/trade-balance.ts", "utf8");
  assert.ok(!/score|analyze-route|researcher/i.test(src.replace(/kein Score|Kein Score|analyze-route unberührt/g, "")), "keine Score-Verdrahtung");
  ok("kein Score: neue Dateien ohne Score-/analyze-route-Bezug");

  server.close();
  console.log(`\n${n} Checks grün`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
