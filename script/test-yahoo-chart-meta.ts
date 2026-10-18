/**
 * Yahoo-Fallback ohne quoteSummary (Render: getcrumb 429) → Name/Währung/Börse aus der v8-Chart-Meta.
 * Echte Chart-Antworten (script/fixtures/yahoo-chart-<T>.json, live vom Box geholt am 18.10.2026, meta unverändert,
 * Bars gekürzt): VOW3.DE, SAP.DE (EUR, XETRA), VOD.L (GBp), AAPL (USD).
 *
 * Teil A (server/yahoo-fetcher.ts getYahooSnapshot, fetch gemockt):
 *   - VOW3.DE/SAP.DE, getcrumb 429: currency EUR, Name, Börse aus Meta; marketCap/pe/eps null; metaSource "Yahoo chart meta";
 *     alle übrigen Felder (Kurs, Bars, fundamentalsAvailable) deepEqual zur Version auf main (LEGACY_REF).
 *   - quoteSummary ok (EUR wie USD): Rückgabe deepEqual main, kein zusätzlicher Chart-Call.
 *   - USD (AAPL) ohne quoteSummary: Kurs/Bars/MCap/KGV/EPS deepEqual main, Währung USD (= bisheriger Default in analyze-route).
 *   - VOD.L: Kurs aus Bars ist schon Pfund (history-fallback) → Währung GBP, nicht GBp.
 *   - Meta-Call scheitert / Meta fehlt: Rückgabe deepEqual main. Cache + parallele Aufrufe: ein Meta-Call.
 * Teil B (echte /api/analyze-Route, FMP 402 → Yahoo): currency EUR, companyName, exchange kommen an; MCap/KGV/EPS
 *   werden in analyze-route zu 0 (dokumentiert, Fix siehe /workspace/yahoo-meta-proposed-analyze-route.patch).
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-yahoo-chart-meta.ts
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.YAHOO_MIN_INTERVAL_MS = "0";
process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
delete process.env.OPENROUTER_API_KEY;
delete process.env.PERPLEXITY_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LEGACY_REF = "122762b3";
const LEGACY_PATH = `${ROOT}/server/__yahoo-fetcher-legacy-meta.test-tmp.ts`;

let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`); if (!ok) fail++; };

const fixture = (t: string) => JSON.parse(readFileSync(`${HERE}/fixtures/yahoo-chart-${t}.json`, "utf8"));
const FIX: Record<string, any> = Object.fromEntries(["VOW3.DE", "SAP.DE", "VOD.L", "AAPL"].map((t) => [t, fixture(t)]));
const chartBody = (t: string) => ({ chart: FIX[t].chart });
const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Mode = { qs: "crumb429" | "ok"; qsBody?: any; meta?: "ok" | "500" | "nometa" };
let calls: string[] = [];
const realFetch = globalThis.fetch;
function install(mode: Mode) {
  calls = [];
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === "string" ? input : input?.url ?? input);
    if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
    calls.push(url);
    if (url.includes("financialmodelingprep.com")) return jsonResp({ "Error Message": "Premium Query Parameter" }, 402);
    if (url.startsWith("https://fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=test; Domain=.yahoo.com" } });
    if (url.includes("/v1/test/getcrumb")) return mode.qs === "crumb429" ? new Response("Too Many Requests", { status: 429 }) : new Response("crumbXYZ1234", { status: 200 });
    const sym = decodeURIComponent((url.match(/\/(?:chart|quoteSummary)\/([^?]+)/) ?? [])[1] ?? "");
    if (url.includes("/v10/finance/quoteSummary/")) return jsonResp(mode.qsBody);
    if (url.includes("/v8/finance/chart/") && FIX[sym]) {
      const metaCall = url.includes("range=5d");
      if (metaCall && mode.meta === "500") return new Response("err", { status: 500 });
      if (metaCall && mode.meta === "nometa") { const b = chartBody(sym); return jsonResp({ chart: { result: [{ ...b.chart.result[0], meta: undefined }] } }); }
      return jsonResp(chartBody(sym));
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
const qsBody = (cur: string, name: string, exch: string, px: number) => ({ quoteSummary: { result: [{ price: { regularMarketPrice: { raw: px }, currency: cur, marketCap: { raw: 1e11 }, longName: name, exchangeName: exch }, summaryDetail: { trailingPE: { raw: 20 } }, defaultKeyStatistics: { trailingEps: { raw: px / 20 } } }], error: null } });
const metaCalls = () => calls.filter((u) => u.includes("/v8/finance/chart/") && u.includes("range=5d")).length;
const strip = (v: any) => { if (!v) return v; const { currency: _c, name: _n, exchange: _e, metaSource: _m, ...rest } = v; return rest; };

const silence = <T,>(fn: () => Promise<T>) => async () => { const w = console.warn, l = console.log; const lines: string[] = []; console.warn = (...a: any[]) => lines.push(a.join(" ")); console.log = console.warn; try { return { v: await fn(), lines }; } finally { console.warn = w; console.log = l; } };

writeFileSync(LEGACY_PATH, execSync(`git -C ${ROOT} show ${LEGACY_REF}:server/yahoo-fetcher.ts`, { encoding: "utf8" }));
try {
  const neu = await import("../server/yahoo-fetcher");
  const alt = await import("../server/__yahoo-fetcher-legacy-meta.test-tmp");
  const both = async (t: string, mode: Mode) => {
    install(mode); alt.clearYahooCache();
    const a = await silence(() => alt.getYahooSnapshot(t))();
    install(mode); neu.clearYahooCache();
    const r = await silence(() => neu.getYahooSnapshot(t))();
    return { alt: a.v, neu: r.v, lines: r.lines, metaCalls: metaCalls() };
  };

  console.log("=== A) server/yahoo-fetcher.ts ===");
  for (const [t, name] of [["VOW3.DE", "Volkswagen AG"], ["SAP.DE", "SAP SE"]] as const) {
    const m = FIX[t].chart.result[0].meta;
    const { alt: a, neu: s, lines } = await both(t, { qs: "crumb429" });
    check(`${t} main vorher: currency/name/exchange null (→ analyze-route USD/Ticker)`, a?.currency === null && a?.name === null && a?.exchange === null, JSON.stringify({ c: a?.currency, n: a?.name }));
    check(`${t}: currency EUR aus Chart-Meta`, s?.currency === "EUR" && m.currency === "EUR", String(s?.currency));
    check(`${t}: Name „${name}“ (meta.longName)`, s?.name === name && m.longName === name, String(s?.name));
    check(`${t}: Börse XETRA (meta.fullExchangeName, exchangeName ${m.exchangeName})`, s?.exchange === "XETRA", String(s?.exchange));
    check(`${t}: marketCap/pe/eps null (nicht 0, nichts geschätzt)`, s?.marketCap === null && s?.pe === null && s?.eps === null);
    check(`${t}: metaSource = "Yahoo chart meta"`, s?.metaSource === "Yahoo chart meta", String(s?.metaSource));
    check(`${t}: fundamentalsAvailable false, Kurs = letzter Fixture-Schluss`, s?.fundamentalsAvailable === false && s?.price === s?.bars.at(-1)?.close, String(s?.price));
    let same = true; try { assert.deepEqual(strip(s), strip(a)); } catch { same = false; }
    check(`${t}: übrige Felder (Kurs, Bars, MCap/KGV/EPS, fundamentalsAvailable) deepEqual main`, same);
    check(`${t}: eine Logzeile mit Quelle`, lines.some((l) => l.includes("aus Yahoo chart meta") && l.includes("Währung EUR")), lines.find((l) => l.includes("chart meta")) ?? "");
  }

  for (const [t, cur, nm, ex, px] of [["VOW3.DE", "EUR", "Volkswagen AG Vz.", "XETRA", 90], ["AAPL", "USD", "Apple Inc.", "NasdaqGS", 230]] as const) {
    const { alt: a, neu: s, metaCalls: mc } = await both(t, { qs: "ok", qsBody: qsBody(cur, nm, ex, px) });
    let same = true; try { assert.deepEqual(s, a); } catch { same = false; }
    check(`${t} mit quoteSummary: Rückgabe deepEqual main, kein Meta-Call`, same && mc === 0 && s?.metaSource === undefined, `metaCalls ${mc}`);
  }

  {
    const { alt: a, neu: s } = await both("AAPL", { qs: "crumb429" });
    let same = true; try { assert.deepEqual(strip(s), strip(a)); } catch { same = false; }
    check("AAPL (USD) ohne quoteSummary: Kurs/Bars/MCap/KGV/EPS deepEqual main", same, `price ${s?.price} = ${a?.price}`);
    check("AAPL: Währung USD (main null → analyze-route-Default \"USD\", effektiv gleich)", s?.currency === "USD" && a?.currency === null);
    check("AAPL: keine Umrechnung (Kurs = main)", s?.price === a?.price);
  }
  {
    const { alt: a, neu: s } = await both("VOD.L", { qs: "crumb429" });
    const m = FIX["VOD.L"].chart.result[0].meta;
    check(`VOD.L: Meta GBp, Kurs aus Bars schon Pfund (${s?.price} = main ${a?.price}) → Währung GBP`, m.currency === "GBp" && s?.currency === "GBP" && s?.price === a?.price && s!.price < 10, `${m.regularMarketPrice} GBp`);
  }
  for (const mode of ["500", "nometa"] as const) {
    const { alt: a, neu: s, lines } = await both("VOW3.DE", { qs: "crumb429", meta: mode });
    let same = true; try { assert.deepEqual(s, a); } catch { same = false; }
    check(`VOW3.DE Meta-Call ${mode}: Rückgabe deepEqual main, keine Logzeile`, same && !lines.some((l) => l.includes("chart meta")));
  }
  {
    install({ qs: "crumb429" }); neu.clearYahooCache();
    const [x, y] = await silence(() => Promise.all([neu.getYahooSnapshot("SAP.DE"), neu.getYahooSnapshot("sap.de")]))().then((r) => r.v);
    const mc1 = metaCalls();
    const z = await silence(() => neu.getYahooSnapshot("SAP.DE"))().then((r) => r.v);
    check("parallel + Cache: beide Aufrufer bekommen EUR, ein Meta-Call, Cache-Treffer ohne Call", x?.currency === "EUR" && y?.currency === "EUR" && z?.currency === "EUR" && mc1 === 1 && metaCalls() === 1, `metaCalls ${metaCalls()}`);
  }
  {
    const p = neu.parseYahooChartMeta({ chart: { result: [{ meta: { currency: "EUR", exchangeName: "GER", shortName: "VOLKSWAGEN AG                 V" } }] } });
    check("parseYahooChartMeta: shortName-Padding abgeschnitten, exchangeName als Ersatz", p?.name === "VOLKSWAGEN AG" && p?.exchange === "GER");
    check("parseYahooChartMeta: ohne Meta null", neu.parseYahooChartMeta({ chart: { result: [{}] } }) === null && neu.parseYahooChartMeta(null) === null);
  }

  console.log("\n=== B) /api/analyze (FMP 402 → Yahoo, getcrumb 429) ===");
  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import("../server/analyze-route");
  const app = express(); app.use(express.json());
  const server = app.listen(0);
  registerAnalyzeRoute(server, app);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  for (const [t, name] of [["VOW3.DE", "Volkswagen AG"], ["SAP.DE", "SAP SE"]] as const) {
    install({ qs: "crumb429" }); neu.clearYahooCache();
    const r = await silence(() => realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, useLLM: false, force: true }) }).then(async (x) => ({ status: x.status, body: await x.json() })))().then((q) => q.v);
    const b = r.body;
    check(`${t}: HTTP 200, dataSource yahoo`, r.status === 200 && b.dataSource === "yahoo", `${r.status} ${b.dataSource}`);
    check(`${t}: currency EUR (vorher USD)`, b.currency === "EUR", String(b.currency));
    check(`${t}: companyName „${name}“ (vorher Ticker)`, b.companyName === name, String(b.companyName));
    check(`${t}: exchange XETRA`, b.exchange === "XETRA", String(b.exchange));
    check(`${t}: keine Score/Rating (unverändert)`, b.scoring === undefined && b.biasFix === undefined);
    console.log(`   ℹ ${t}: marketCap=${b.marketCap} peRatio=${b.peRatio} epsTTM=${b.epsTTM} — 0 entsteht in analyze-route (parseNumber(… ?? 0)); nicht in diesem PR, Patch-Vorschlag separat`);
  }
  server.close();
} finally {
  globalThis.fetch = realFetch;
  if (existsSync(LEGACY_PATH)) unlinkSync(LEGACY_PATH);
}
console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
