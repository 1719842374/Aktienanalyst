/**
 * F1-66 (Nachfolger #296): FRED VIXCLS bekommt einen zweiten Versuch, bevor Yahoo ^VIX einspringt,
 * und das VIX-Label in Sektion 9 (RegionRsiPanel) und Sektion 10 (RecessionMarketChartsSection)
 * nennt die echte Quelle: "FRED VIXCLS" / "Yahoo ^VIX" / n/a (Grund in volNote).
 * Echter Pfad: UI-Komponente → Hook (fetch) → Express-Route registerRecessionMarketRoutes →
 * buildRegionMarket / buildChartMarket → fetchFredVolWithYahooFallback → fetch (nur Upstream gestubbt).
 * Fixtures (echt, abgerufen 25.10.2026): script/fixtures/fred-VIXCLS-2026-10-25.csv
 * (fredgraph.csv?id=VIXCLS&cosd=2026-09-25), script/fixtures/yahoo-chart-VIX-2026-10-25.json
 * (query1.finance.yahoo.com/v8/finance/chart/%5EVIX?period1..&interval=1d).
 * Jedes Szenario läuft in einem eigenen Prozess (Server-Caches sind modulglobal).
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-vix-fred-retry-source.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import type { AddressInfo } from "node:net";

const FRED_CSV = readFileSync("script/fixtures/fred-VIXCLS-2026-10-25.csv", "utf8");
const YAHOO_VIX = readFileSync("script/fixtures/yahoo-chart-VIX-2026-10-25.json", "utf8");
const FRED_LAST = Number(FRED_CSV.trim().split("\n").at(-1)!.split(",")[1]); // 19.03 (2026-10-22)
const YAHOO_LAST = Math.round((JSON.parse(YAHOO_VIX).chart.result[0].indicators.quote[0].close as number[]).filter(v => v != null).at(-1)! * 100) / 100;

type Scenario = "fred-retry" | "yahoo" | "none" | "fred-first";

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
  let fredVix = 0;
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = String(input?.url ?? input);
    if (url.startsWith("/api/")) return realFetch(base + url, init);
    log.push(url);
    if (url.includes("fredgraph.csv") && url.includes("id=VIXCLS")) {
      fredVix++;
      const okNow = scen === "fred-first" || (scen === "fred-retry" && fredVix >= 2);
      return okNow ? new Response(FRED_CSV, { status: 200 }) : new Response("upstream", { status: 503 });
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
  const textOf = (nd: any): string => !nd ? "" : nd instanceof FakeText ? nd.nodeValue : nd.childNodes.map(textOf).join("");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const origErr = console.error, origWarn = console.warn, origLog = console.log;
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
  const s9Before = log.length; fredVix = 0;
  const s9 = await mount(React.createElement(RegionRsiPanel), t => /Index ·/.test(t) || /Fehler|n\/a/.test(t));
  const s9Fred = fredVix, s9Log = log.slice(s9Before);
  const s9Json = await (await realFetch(base + "/api/analyze-recession/markets?region=US&window=1Y")).json();
  const { RecessionMarketChartsSection } = await import("../client/src/components/recession/RecessionMarketChartsSection");
  const s10Before = log.length; fredVix = 0;
  const s10 = await mount(React.createElement(RecessionMarketChartsSection, { number: 10 }), t => /implizit ·/.test(t));
  const s10Fred = fredVix, s10Log = log.slice(s10Before);
  const s10Json = await (await realFetch(base + "/api/analyze-recession/markets?window=5Y")).json();
  server.close();
  console.error = origErr; console.warn = origWarn;
  const spy = (s10Json.markets ?? []).find((m: any) => m.id === "SPY") ?? {};
  const qqq = (s10Json.markets ?? []).find((m: any) => m.id === "QQQ") ?? {};
  const firstYahoo = (l: string[]) => l.findIndex(u => u.includes("yahoo"));
  const fredIdx = (l: string[]) => l.map((u, i) => (u.includes("id=VIXCLS") ? i : -1)).filter(i => i >= 0);
  origLog(JSON.stringify({
    s9Title: (s9.match(/VIX[^·]*Index/) ?? [""])[0], s9Text: s9.slice(0, 400), s9Fred, s9Yahoo: firstYahoo(s9Log), s9FredIdx: fredIdx(s9Log),
    s9Source: s9Json.volSource, s9Note: s9Json.volNote, s9Last: s9Json.volLatest, s9Vol: s9Json.vol?.length,
    s10Header: (s10.match(/[^\n]{0,60}implizit · Y linear/) ?? [""])[0], s10Fred, s10Yahoo: firstYahoo(s10Log), s10FredIdx: fredIdx(s10Log),
    s10Source: spy.volSource, s10Note: spy.volNote, s10Last: spy.vol?.at(-1)?.value, s10Vol: spy.vol?.length,
    qqqHasSource: "volSource" in qqq, qqqNote: qqq.volNote,
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
  const near = (a: any, b: number) => typeof a === "number" && Math.abs(a - b) < 0.01;

  console.log("1) FRED 503 beim 1. Versuch, OK beim 2. → FRED-Reihe, kein Yahoo");
  const a = run("fred-retry");
  ok("S9 API: 2 FRED-Versuche, kein Yahoo-Call", a.s9FredIdx?.length === 2 && a.s9Yahoo === -1, JSON.stringify([a.s9FredIdx, a.s9Yahoo]));
  ok("S9 API: Wert aus FRED-Fixture, volSource 'FRED VIXCLS'", near(a.s9Last, FRED_LAST) && a.s9Source === "FRED VIXCLS", `${a.s9Last} ${a.s9Source}`);
  ok("S9 UI-Label 'VIX (FRED VIXCLS), Index'", a.s9Title === "VIX (FRED VIXCLS), Index", a.s9Title);
  ok("S10 API: 2 FRED-Versuche, kein Yahoo, volSource 'FRED VIXCLS'", a.s10FredIdx?.length === 2 && a.s10Yahoo === -1 && a.s10Source === "FRED VIXCLS", JSON.stringify([a.s10FredIdx, a.s10Yahoo, a.s10Source]));
  ok("S10 UI-Kopf nennt 'FRED VIXCLS'", /FRED VIXCLS · implizit/.test(a.s10Header), a.s10Header);

  console.log("2) FRED zweimal 503 → Yahoo ^VIX (echte Payload)");
  const b = run("yahoo");
  ok("S9: Yahoo erst nach 2 FRED-Versuchen", b.s9FredIdx?.length === 2 && b.s9Yahoo > b.s9FredIdx[1], JSON.stringify([b.s9FredIdx, b.s9Yahoo]));
  ok("S9 API: Wert aus Yahoo-Fixture, volSource 'Yahoo ^VIX'", near(b.s9Last, YAHOO_LAST) && b.s9Source === "Yahoo ^VIX", `${b.s9Last} ${b.s9Source}`);
  ok("S9 UI-Label 'VIX (Yahoo ^VIX), Index'", b.s9Title === "VIX (Yahoo ^VIX), Index", b.s9Title);
  ok("S9 Notiz unverändert (#296)", b.s9Note === "VIX via Yahoo ^VIX (FRED VIXCLS leer)", b.s9Note);
  ok("S10: Yahoo erst nach 2 FRED-Versuchen, volSource 'Yahoo ^VIX'", b.s10FredIdx?.length === 2 && b.s10Yahoo > b.s10FredIdx[1] && b.s10Source === "Yahoo ^VIX", JSON.stringify([b.s10FredIdx, b.s10Yahoo, b.s10Source]));
  ok("S10 UI-Kopf nennt 'Yahoo ^VIX' statt VIXCLS", /Yahoo \^VIX · implizit/.test(b.s10Header), b.s10Header);

  console.log("3) FRED zweimal 503, Yahoo 429 → n/a mit Grund, kein Ersatzwert");
  const c = run("none");
  ok("S9 API: leer, volSource null, Notiz nennt beide", c.s9Vol === 0 && c.s9Source === null && c.s9Note === "FRED VIXCLS leer, Yahoo ^VIX leer", JSON.stringify([c.s9Vol, c.s9Source, c.s9Note]));
  ok("S9 UI-Label n/a + Grund sichtbar", /VIX n\/a/.test(c.s9Title) && c.s9Text.includes("FRED VIXCLS leer, Yahoo ^VIX leer"), c.s9Title);
  ok("S10 API: leer, volSource null", c.s10Vol === 0 && c.s10Source === null, JSON.stringify([c.s10Vol, c.s10Source]));
  ok("S10 UI-Kopf 'VIX n/a' (gleicher Text wie S9, Follow-up #325)", /VIX n\/a \(keine Quelle lieferte Daten\) · implizit/.test(c.s10Header), c.s10Header);

  console.log("4) Unverändert");
  const d = run("fred-first");
  ok("FRED beim 1. Versuch OK → genau 1 FRED-Call (S9 und S10)", d.s9FredIdx?.length === 1 && d.s10FredIdx?.length === 1 && d.s9Yahoo === -1, JSON.stringify([d.s9FredIdx, d.s10FredIdx]));
  ok("QQQ (VXNCLS, kein Yahoo-Zwilling): kein volSource, Notiz wie main", c.qqqHasSource === false && c.qqqNote === "FRED VXNCLS leer", JSON.stringify([c.qqqHasSource, c.qqqNote]));
  const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
  const touched = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" }).split("\n");
  ok("Score-Pfad unberührt (recession.ts, analyze-route.ts, researcher.ts)", !touched.some(f => /server\/(recession|analyze-route|researcher)\.ts$/.test(f)), touched.join(","));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

if (process.env.VIX_SCEN) child(process.env.VIX_SCEN as Scenario).catch(e => { console.error(e); process.exit(2); });
else parent().catch(e => { console.error(e); process.exit(1); });
