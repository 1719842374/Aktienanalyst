/**
 * Follow-up #325 (F1-66): DoD-Softpunkte aus /workspace/dod-325/REPORT.md.
 * (1) FRED VIXCLS-Retry nur nach schnellem Fehlschlag (HTTP-Fehler/leer), nicht nach Timeout;
 *     leeres US-VIX-Ergebnis wird nicht 6 h gecacht.
 * (2) S9-Kopf nennt die Quelle genau einmal.
 * (3) Gleicher n/a-Text in S9 und S10.
 * Echter Pfad: UI-Komponente → fetch/Hook → Express-Route → buildRegionMarket/buildChartMarket →
 * fetchFredVolWithYahooFallback → fetch (nur Upstream gestubbt, echte Payloads vom 25.10.2026:
 * script/fixtures/fred-VIXCLS-2026-10-25.csv, script/fixtures/yahoo-chart-VIX-2026-10-25.json).
 * Timeout = Upstream wirft sofort einen TimeoutError (wie AbortSignal.timeout nach 20 s).
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-vix-followup-325.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const FRED_CSV = readFileSync("script/fixtures/fred-VIXCLS-2026-10-25.csv", "utf8");
const YAHOO_VIX = readFileSync("script/fixtures/yahoo-chart-VIX-2026-10-25.json", "utf8");
type Scenario = "fred-timeout" | "fred-503" | "none" | "fred-ok";

async function child(scen: Scenario) {
  process.env.FMP_API_KEY = process.env.FMP_API_KEY || "test-stub";
  const { installFakeDom, FakeElement, FakeText } = await import("./lib/fake-dom") as any;
  (globalThis as any).React = React;
  const { doc } = installFakeDom();
  (FakeElement.prototype as any).getElementsByClassName = () => [];
  const markets = await import("../server/recession-markets");
  (markets as any).setFredVolRetryPauseForTests?.(0);
  const express = (await import("express")).default;
  const app = express();
  markets.registerRecessionMarketRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  const log: string[] = [];
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.startsWith("/api/")) return realFetch(base + url, init);
    log.push(url);
    if (url.includes("fredgraph.csv") && url.includes("id=VIXCLS")) {
      if (scen === "fred-ok") return new Response(FRED_CSV, { status: 200 });
      if (scen === "fred-timeout") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return new Response("upstream", { status: 503 });
    }
    if (url.includes("fredgraph.csv")) return new Response("upstream", { status: 503 });
    if (url.includes("finance.yahoo.com/v8/finance/chart/%5EVIX")) {
      return scen === "none" ? new Response("{}", { status: 429 }) : new Response(YAHOO_VIX, { status: 200 });
    }
    if (url.includes("financialmodelingprep.com/stable/historical-price-eod")) {
      const bars = Array.from({ length: 60 }, (_, i) => {
        const d = new Date(Date.UTC(2026, 7, 1) + i * 86400000).toISOString().slice(0, 10);
        return { date: d, open: 600 + i, high: 601 + i, low: 599 + i, close: 600 + i, volume: 1e6 };
      });
      return new Response(JSON.stringify(bars.reverse()), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  const fredCalls = () => log.filter(u => u.includes("id=VIXCLS")).length;
  const textOf = (nd: any): string => !nd ? "" : nd instanceof FakeText ? nd.nodeValue : nd.childNodes.map(textOf).join("");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const origLog = console.log;
  console.error = () => {}; console.warn = () => {};
  async function mount(el: any, until: (t: string) => boolean) {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, el)); });
    for (let i = 0; i < 100 && !until(textOf(c)); i++) await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    const t = textOf(c);
    await act(async () => { root.unmount(); });
    return t;
  }
  const { RegionRsiPanel } = await import("../client/src/components/recession/RegionRsiPanel");
  const f0 = fredCalls();
  const s9 = await mount(React.createElement(RegionRsiPanel), t => /Fenster 5Y/.test(t));
  const s9Fred = fredCalls() - f0;
  // second identical API request: cache hit (no FRED call) unless the result was empty
  const f1 = fredCalls();
  const again = await (await realFetch(base + "/api/analyze-recession/markets?region=US&window=5Y")).json();
  const s9RefetchFred = fredCalls() - f1;
  const { RecessionMarketChartsSection } = await import("../client/src/components/recession/RecessionMarketChartsSection");
  const f2 = fredCalls();
  const s10 = await mount(React.createElement(RecessionMarketChartsSection, { number: 10 }), t => /implizit ·/.test(t));
  const s10Fred = fredCalls() - f2;
  server.close();
  const s9Header = (s9.match(/VIX[^\n]*?Index · Y linear 0–90 · Fenster 5Y(?: · [A-Za-z^ ]+?)?(?=VIX via|FRED VIXCLS leer|Keine Vol|Bänder|\d{4}-)/) ?? [""])[0];
  origLog(JSON.stringify({
    s9Header, s9Fred, s9RefetchFred, s9Source: again.volSource, s9Vol: again.vol?.length,
    s10Header: (s10.match(/[^\n]{0,60}· implizit · Y linear/) ?? [""])[0], s10Fred,
  }));
  process.exit(0);
}

async function parent() {
  let pass = 0, fail = 0;
  const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
  const run = (s: Scenario) => {
    const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1]], { env: { ...process.env, VIX_SCEN: s }, encoding: "utf8", timeout: 120000 });
    const line = (r.stdout || "").trim().split("\n").filter(l => l.startsWith("{")).at(-1);
    if (!line) { console.log(r.stdout, r.stderr); return {} as any; }
    return JSON.parse(line);
  };
  const count = (hay: string, needle: string) => hay.split(needle).length - 1;

  console.log("1) FRED Timeout → kein Retry, direkt Yahoo");
  const a = run("fred-timeout");
  ok("S9: genau 1 FRED-Versuch nach Timeout", a.s9Fred === 1, JSON.stringify(a.s9Fred));
  ok("S10: genau 1 FRED-Versuch nach Timeout", a.s10Fred === 1, JSON.stringify(a.s10Fred));
  ok("S9: Yahoo liefert, volSource 'Yahoo ^VIX'", a.s9Source === "Yahoo ^VIX" && a.s9Vol > 0, JSON.stringify([a.s9Source, a.s9Vol]));

  console.log("2) FRED 503 (schneller Fehlschlag) → Retry bleibt");
  const b = run("fred-503");
  ok("S9: 2 FRED-Versuche bei schnellem Fehlschlag", b.s9Fred === 2, JSON.stringify(b.s9Fred));
  ok("S9-Kopf nennt 'Yahoo ^VIX' genau einmal", count(b.s9Header, "Yahoo ^VIX") === 1, b.s9Header);

  console.log("3) FRED OK");
  const d = run("fred-ok");
  ok("S9-Kopf nennt 'FRED VIXCLS' genau einmal", count(d.s9Header, "FRED VIXCLS") === 1 && !/· VIXCLS/.test(d.s9Header), d.s9Header);
  ok("Volles Ergebnis wird gecacht (2. Request ohne FRED-Call)", d.s9RefetchFred === 0, JSON.stringify(d.s9RefetchFred));

  console.log("4) FRED und Yahoo leer → n/a");
  const c = run("none");
  ok("Leeres US-VIX wird nicht gecacht (2. Request fragt FRED erneut)", c.s9RefetchFred > 0 && c.s9Vol === 0, JSON.stringify([c.s9RefetchFred, c.s9Vol]));
  const NA = "VIX n/a (keine Quelle lieferte Daten)";
  ok("S9-Kopf: n/a-Text, kein '· VIXCLS'-Anhang", c.s9Header.startsWith(`${NA}, Index`) && !/· VIXCLS/.test(c.s9Header), c.s9Header);
  ok("S10-Kopf: derselbe n/a-Text", c.s10Header.includes(`${NA} · implizit`), c.s10Header);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (process.env.VIX_SCEN) child(process.env.VIX_SCEN as Scenario).catch(e => { console.error(e); process.exit(2); });
else parent().catch(e => { console.error(e); process.exit(1); });
