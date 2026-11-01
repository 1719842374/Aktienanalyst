/**
 * Stufe 2 ohne Crumb: Yahoo fundamentals-timeseries + Chart-Kurs → MCap/EPS/KGV (server/yahoo-fetcher.ts).
 * Fixtures script/fixtures/yahoo-ts-<T>.json, alle echt: chart = /workspace/mcap-research/chart_<T>.json (live 21:55),
 * timeseries = live vom Box 22:05 (exakte URL des Codes, ohne Cookie/Crumb, Browser-UA), quoteSummaryRef = RESULT-Zeile
 * des App-Clients mit Crumb (app-yahoo-client-box.log). Ticker: VOW3.DE, SAP.DE, BMW.DE, NESN.SW, 7203.T, MC.PA, ASML.AS.
 *
 * Gate nur .DE (Philip 18.10.2026 22:27): Die automatische Stufe im Snapshot-Pfad läuft nur für VOW3.DE, SAP.DE, BMW.DE.
 * NESN.SW, 7203.T, MC.PA, ASML.AS, VOD.L, AAPL → getYahooSnapshot deepEqual main, kein Meta-/timeseries-Call, keine
 * zusätzliche DIAG-Zeile. Die Fixtures der Nicht-.DE-Ticker bleiben und belegen den (ungegateten) Direktaufruf
 * fetchYahooTimeseriesFundamentals.
 *
 * Prüft: MCap = Kurs × quarterlyOrdinarySharesNumber (Abw. zu quoteSummary ≤ 0,55 %), EPS = trailingDilutedEPS,
 * KGV = Kurs/EPS, Währung/Name aus Chart-Meta, [YAHOO-DIAG] stage=timeseries mit Status; Fehlerpfade (429, Throw,
 * leer, andere Währung, EPS ≤ 0, zu alt, keine Meta) → null/n/a ohne Crash; quoteSummary ok → kein Call, deepEqual main;
 * exportierte Stufe fetchYahooTimeseriesFundamentals (Standalone, für feat/fmp-adr-mapping); /api/analyze (FMP 402).
 * Fehlerpfad-Varianten (andere Währung, EPS ≤ 0) sind als Mutation der echten Antwort markiert.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-yahoo-timeseries-fundamentals.ts
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
const LEGACY_PATH = `${ROOT}/server/__yahoo-fetcher-legacy-ts.test-tmp.ts`;
const TICKERS = ["VOW3.DE", "SAP.DE", "BMW.DE", "NESN.SW", "7203.T", "MC.PA", "ASML.AS"] as const;
const DE_TICKERS = TICKERS.filter((t) => t.endsWith(".DE"));
const NON_DE_TICKERS = TICKERS.filter((t) => !t.endsWith(".DE"));

let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`); if (!ok) fail++; };
const FIX: Record<string, any> = Object.fromEntries(TICKERS.map((t) => [t, JSON.parse(readFileSync(`${HERE}/fixtures/yahoo-ts-${t}.json`, "utf8"))]));
const VOD = JSON.parse(readFileSync(`${HERE}/fixtures/yahoo-chart-VOD.L.json`, "utf8"));
const AAPL = JSON.parse(readFileSync(`${HERE}/fixtures/yahoo-chart-AAPL.json`, "utf8"));
const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const latest = (ts: any, type: string) => { let b: any = null; for (const r of ts.result) for (const row of r[type] ?? []) if (row && (!b || row.asOfDate > b.asOfDate)) b = row; return b; };

type TsMode = "ok" | "429" | "throw" | "empty" | "usd-eps" | "neg-eps" | ((ts: any) => any);
type Mode = { qs?: "crumb429" | "ok"; qsBody?: any; ts?: TsMode; chartNoMeta?: boolean };
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
    if (url.includes("/v1/test/getcrumb")) return (mode.qs ?? "crumb429") === "crumb429" ? new Response("Too Many Requests", { status: 429 }) : new Response("crumbXYZ1234", { status: 200 });
    if (url.includes("/v10/finance/quoteSummary/")) return jsonResp(mode.qsBody);
    const sym = decodeURIComponent((url.match(/\/(?:chart|timeseries)\/([^?]+)/) ?? [])[1] ?? "");
    const fx = FIX[sym];
    if (url.includes("/v8/finance/chart/")) {
      const chart = fx?.chart ?? (sym === "VOD.L" ? VOD.chart : sym === "AAPL" ? AAPL.chart : null);
      if (!chart) return new Response("nf", { status: 404 });
      if (mode.chartNoMeta) return jsonResp({ chart: { result: [{ ...chart.result[0], meta: undefined }] } });
      return jsonResp({ chart });
    }
    if (url.includes("/ws/fundamentals-timeseries/")) {
      assert.ok(!/crumb=/.test(url), "timeseries ohne crumb");
      assert.match(String(init?.headers?.["User-Agent"] ?? ""), /Mozilla\/5\.0/, "Browser-UA");
      const m = mode.ts ?? "ok";
      if (!fx) return new Response("Not Found", { status: 404 });
      if (m === "429") return new Response("Too Many Requests", { status: 429 });
      if (m === "throw") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      if (m === "empty") return jsonResp({ timeseries: { result: [], error: null } });
      const ts = JSON.parse(JSON.stringify(fx.timeseries));
      if (m === "usd-eps") for (const r of ts.result) for (const row of r.trailingDilutedEPS ?? []) if (row) row.currencyCode = "USD"; // Mutation
      if (m === "neg-eps") for (const r of ts.result) for (const row of r.trailingDilutedEPS ?? []) if (row) row.reportedValue.raw = -1.5; // Mutation
      return jsonResp({ timeseries: typeof m === "function" ? m(ts) : ts });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
const tsCalls = () => calls.filter((u) => u.includes("/ws/fundamentals-timeseries/")).length;
async function capture<T>(fn: () => Promise<T>) { const w = console.warn, l = console.log; const lines: string[] = []; console.warn = (...a: any[]) => lines.push(a.join(" ")); console.log = console.warn; try { return { v: await fn(), lines }; } finally { console.warn = w; console.log = l; } }
const pct = (a: number, b: number) => (100 * (a / b - 1));
// Snapshot-Kurs = letzter Chart-Schluss (float32 aus der Antwort, z. B. 68.68000030517578) — wie bisher auf main.
const near = (a: number | null | undefined, b: number) => typeof a === "number" && Math.abs(a / b - 1) < 1e-6;

writeFileSync(LEGACY_PATH, execSync(`git -C ${ROOT} show ${LEGACY_REF}:server/yahoo-fetcher.ts`, { encoding: "utf8" }));
try {
  const neu = await import("../server/yahoo-fetcher");
  const alt = await import("../server/__yahoo-fetcher-legacy-ts.test-tmp");
  const snap = async (t: string, mode: Mode) => { install(mode); neu.clearYahooCache(); return capture(() => neu.getYahooSnapshot(t)); };

  console.log("=== .DE-Ticker: getcrumb 429 → timeseries + Chart (echte Antworten) ===");
  check("Gate: DE_TICKERS = VOW3.DE, SAP.DE, BMW.DE", JSON.stringify(DE_TICKERS) === JSON.stringify(["VOW3.DE", "SAP.DE", "BMW.DE"]) && DE_TICKERS.every((t) => neu.isGermanXetraTicker(t)) && !NON_DE_TICKERS.some((t) => neu.isGermanXetraTicker(t)));
  for (const t of DE_TICKERS) {
    const f = FIX[t], ref = f.quoteSummaryRef, meta = f.chart.result[0].meta;
    const sh = latest(f.timeseries, "quarterlyOrdinarySharesNumber"), ep = latest(f.timeseries, "trailingDilutedEPS");
    const { v: s, lines } = await snap(t, {});
    const dev = s?.marketCap != null ? pct(s.marketCap, ref.marketCap) : NaN;
    check(`${t}: Kurs ${s?.price} = quoteSummary ${ref.price}, Währung ${s?.currency} = ${ref.currency} (Chart-Meta)`, near(s?.price, ref.price) && s?.currency === ref.currency && s?.currency === meta.currency);
    check(`${t}: Name aus Chart-Meta „${s?.name}“`, s?.name === meta.longName && typeof s?.name === "string");
    check(`${t}: MCap = Kurs × quarterlyOrdinarySharesNumber (${sh.asOfDate}), Abw. zu quoteSummary ${dev.toFixed(3)} % ≤ 0,55 %`, s?.marketCap === s!.price * sh.reportedValue.raw && Math.abs(dev) <= 0.55);
    check(`${t}: EPS = trailingDilutedEPS ${ep.reportedValue.raw} ${ep.currencyCode} (${ep.asOfDate}), KGV = Kurs/EPS ${s?.pe?.toFixed(2)} (quoteSummary ${ref.pe.toFixed(2)})`, s?.eps === ep.reportedValue.raw && s?.pe === s!.price / ep.reportedValue.raw);
    check(`${t}: KGV ≈ quoteSummary (|Abw.| < 0,5 %)`, Math.abs(pct(s!.pe!, ref.pe)) < 0.5, `${pct(s!.pe!, ref.pe).toFixed(3)} %`);
    check(`${t}: fundamentalsSource "Yahoo timeseries", Stichtage, fundamentalsAvailable false`, s?.fundamentalsSource === "Yahoo timeseries" && s?.timeseriesAsOf?.shares === sh.asOfDate && s?.timeseriesAsOf?.eps === ep.asOfDate && s?.fundamentalsAvailable === false);
    const d = lines.filter((l) => l.includes("stage=timeseries"));
    check(`${t}: genau eine [YAHOO-DIAG] stage=timeseries status=200`, d.length === 1 && /^\[YAHOO-DIAG\] \S+ stage=timeseries status=200 ok: MCap Kurs × Aktien/.test(d[0]), d[0]);
  }

  console.log("\n=== Nicht-.DE (Gate): getYahooSnapshot wie main (bis auf Suffix-Währung #261), kein Zusatz-Call, keine Zusatz-DIAG ===");
  // #261 DCF-FX (Stabschef 18.10.2026): ohne quoteSummary kommt die Währung aus dem Börsen-Suffix (nicht .DE, kein Netz-Call).
  const SUFFIX_CUR: Record<string, string | null> = { "NESN.SW": "CHF", "7203.T": "JPY", "MC.PA": "EUR", "ASML.AS": "EUR", "VOD.L": "GBP", AAPL: null };
  for (const t of [...NON_DE_TICKERS, "VOD.L", "AAPL"]) {
    install({}); alt.clearYahooCache();
    const a = await capture(() => alt.getYahooSnapshot(t));
    const callsAlt = [...calls];
    const { v: s, lines } = await snap(t, {});
    let same = true; try { assert.deepEqual(s, a.v ? { ...a.v, currency: SUFFIX_CUR[t] } : a.v); } catch { same = false; }
    check(`${t}: Snapshot deepEqual main bis auf currency = Suffix ${SUFFIX_CUR[t]} (MCap/KGV/EPS/name null wie main, keine Quellenfelder)`, same && s != null && s.marketCap === null && s.currency === SUFFIX_CUR[t] && s.fundamentalsSource === undefined && s.metaSource === undefined);
    check(`${t}: kein timeseries-/Meta-Call, Calls = main, DIAG-Zeilen = main (keine stage=timeseries)`, tsCalls() === 0 && calls.filter((u) => u.includes("range=5d")).length === 0 && JSON.stringify(calls) === JSON.stringify(callsAlt) && JSON.stringify(lines) === JSON.stringify(a.lines) && !lines.some((l) => l.includes("stage=timeseries")), `calls ${calls.length}/${callsAlt.length}`);
  }
  {
    install({}); alt.clearYahooCache();
    const base = await capture(() => alt.getYahooSnapshot("ASML.AS")).then((r) => r.v);
    install({});
    const r = await capture(() => neu.applyTimeseriesFundamentals(base ? { ...base, currency: "EUR", name: "ASML Holding N.V." } : base));
    check("applyTimeseriesFundamentals(ASML.AS-Snapshot mit Währung/Name) direkt: unverändert, kein Call (Gate in der Stufe)", r.v?.marketCap === null && r.v?.fundamentalsSource === undefined && calls.length === 0);
  }

  console.log("\n=== Direktaufruf fetchYahooTimeseriesFundamentals (NICHT gegatet) mit den Nicht-.DE-Fixtures ===");
  for (const t of NON_DE_TICKERS) {
    const f = FIX[t], ref = f.quoteSummaryRef;
    const sh = latest(f.timeseries, "quarterlyOrdinarySharesNumber"), ep = latest(f.timeseries, "trailingDilutedEPS");
    install({}); neu.clearYahooCache();
    const { v: r, lines } = await capture(() => neu.fetchYahooTimeseriesFundamentals(t));
    const dev = r.marketCap != null ? pct(r.marketCap, ref.marketCap) : NaN;
    check(`${t} direkt: status ok, Währung ${r.currency} = ${ref.currency}, MCap Abw. ${dev.toFixed(3)} % ≤ 0,55 %, EPS ${ep.reportedValue.raw} (${ep.asOfDate}), eine DIAG-Zeile`,
      r.status === "ok" && r.currency === ref.currency && r.marketCap === r.price! * sh.reportedValue.raw && Math.abs(dev) <= 0.55 && r.epsDiluted === ep.reportedValue.raw && lines.filter((l) => l.includes("stage=timeseries")).length === 1);
    if (t === "ASML.AS") check("ASML.AS direkt: KGV weicht ab (timeseries-EPS Stand 30.06. vs. quoteSummary nach Q3) — dokumentiert; im App-Pfad ASML nicht betroffen (Gate)", r.epsDiluted === 25.41 && ref.eps === 34.98, `PE ${r.pe?.toFixed(2)} vs ${ref.pe.toFixed(2)}`);
  }

  console.log("\n=== Fehlerpfade → n/a (null), kein Crash ===");
  const nulls = (s: any) => s && s.marketCap === null && s.pe === null && s.eps === null && s.fundamentalsSource === undefined;
  for (const [m, re] of [["429", /stage=timeseries status=429 nicht ok \[429 Rate-Limit\].*→ MCap\/KGV\/EPS n\/a/], ["throw", /stage=timeseries status=- Fehler: TimeoutError/], ["empty", /stage=timeseries status=200 ok, aber keine verwertbaren Werte/]] as const) {
    const { v: s, lines } = await snap("VOW3.DE", { ts: m });
    const d = lines.filter((l) => l.includes("stage=timeseries"));
    check(`timeseries ${m}: MCap/KGV/EPS null, Kurs/Währung/Name bleiben`, nulls(s) && near(s?.price, 68.68) && s?.currency === "EUR" && s?.name === "Volkswagen AG");
    check(`timeseries ${m}: DIAG-Zeile`, d.length === 1 && re.test(d[0]), d[0]);
  }
  {
    const { v: s } = await snap("SAP.DE", { ts: "usd-eps" });
    check("EPS in anderer Währung (Mutation USD): EPS/KGV null, MCap bleibt", s?.eps === null && s?.pe === null && s?.marketCap != null);
    const { v: s2 } = await snap("SAP.DE", { ts: "neg-eps" });
    check("EPS ≤ 0 (Mutation −1,5): EPS −1,5 bleibt, KGV null", s2?.eps === -1.5 && s2?.pe === null);
    const d = neu.deriveTimeseriesFundamentals({ timeseries: FIX["SAP.DE"].timeseries }, 199.22, "EUR", Date.parse("2030-01-01"));
    check("Werte älter als 550 Tage werden ignoriert → null", d.marketCap === null && d.eps === null && d.pe === null);
    const d2 = neu.deriveTimeseriesFundamentals({ timeseries: { result: FIX["MC.PA"].timeseries.result.filter((r: any) => !r.quarterlyOrdinarySharesNumber) } }, 397, "EUR", Date.parse("2026-10-18"));
    check("ohne Quartals-Aktienzahl → annualOrdinarySharesNumber", d2.marketCap != null && d2.sharesAsOf != null && d2.sharesAsOf.endsWith("12-31"), String(d2.sharesAsOf));
  }
  {
    const { v: s, lines } = await snap("VOW3.DE", { chartNoMeta: true });
    check("Chart ohne Meta (keine Währung): kein timeseries-Call, n/a", tsCalls() === 0 && nulls(s) && s?.currency === null && !lines.some((l) => l.includes("stage=timeseries")));
  }

  console.log("\n=== quoteSummary ok / USD → unverändert ===");
  const qsBody = (cur: string, name: string, exch: string, px: number) => ({ quoteSummary: { result: [{ price: { regularMarketPrice: { raw: px }, currency: cur, marketCap: { raw: 1e11 }, longName: name, exchangeName: exch }, summaryDetail: { trailingPE: { raw: 20 } }, defaultKeyStatistics: { trailingEps: { raw: px / 20 } } }], error: null } });
  for (const [t, cur] of [["VOW3.DE", "EUR"], ["SAP.DE", "EUR"]] as const) {
    const mode: Mode = { qs: "ok", qsBody: qsBody(cur, "X AG", "XETRA", 100) };
    install(mode); alt.clearYahooCache(); const a = await capture(() => alt.getYahooSnapshot(t));
    const { v: s } = await snap(t, mode);
    let same = true; try { assert.deepEqual(s, a.v); } catch { same = false; }
    check(`${t} quoteSummary ok: deepEqual main, kein timeseries-Call`, same && tsCalls() === 0);
  }

  console.log("\n=== Exportierte Stufe fetchYahooTimeseriesFundamentals (Standalone) ===");
  {
    install({}); neu.clearYahooCache();
    const { v: r, lines } = await capture(() => neu.fetchYahooTimeseriesFundamentals("sap.de"));
    const ref = FIX["SAP.DE"].quoteSummaryRef;
    check("SAP.DE ohne opts: status ok, Chart-Meta + timeseries", r.status === "ok" && r.httpStatus === 200 && r.source === "Yahoo timeseries" && r.symbol === "SAP.DE");
    check("SAP.DE: currency/exchangeName/name/price aus Meta", r.currency === "EUR" && r.exchangeName === "XETRA" && r.name === "SAP SE" && r.price === 199.22);
    check("SAP.DE: sharesOutstanding, marketCap, epsDiluted, pe, asOf", r.sharesOutstanding === 1154204232 && r.marketCap === 199.22 * 1154204232 && r.epsDiluted === 6.68 && r.pe === 199.22 / 6.68 && r.asOf.shares === "2026-06-30" && r.asOf.eps === "2026-06-30", `MCap Abw. ${pct(r.marketCap!, ref.marketCap).toFixed(3)} %`);
    check("SAP.DE: ein Meta-Call + ein timeseries-Call, eine DIAG-Zeile", calls.filter((u) => u.includes("range=5d")).length === 1 && tsCalls() === 1 && lines.filter((l) => l.includes("stage=timeseries")).length === 1);
    install({});
    const again = await capture(() => neu.fetchYahooTimeseriesFundamentals("SAP.DE"));
    check("Cache: zweiter Aufruf ohne Call", again.v.marketCap === r.marketCap && calls.length === 0);
    install({}); neu.clearYahooCache();
    const o = await capture(() => neu.fetchYahooTimeseriesFundamentals("MC.PA", { price: 397, currency: "EUR" }));
    check("MC.PA mit opts {price, currency}: kein Meta-Call, name/exchangeName null", o.v.status === "ok" && calls.filter((u) => u.includes("/v8/finance/chart/")).length === 0 && o.v.name === null && o.v.exchangeName === null);
    install({ ts: "429" }); neu.clearYahooCache();
    const e = await capture(() => neu.fetchYahooTimeseriesFundamentals("BMW.DE"));
    check("BMW.DE timeseries 429: status http_error, httpStatus 429, Werte null, Meta-Felder gesetzt, source Chart-Meta", e.v.status === "http_error" && e.v.httpStatus === 429 && e.v.marketCap === null && e.v.epsDiluted === null && e.v.pe === null && e.v.sharesOutstanding === null && e.v.currency === "EUR" && e.v.source === "Yahoo chart meta");
    install({ ts: "throw" }); neu.clearYahooCache();
    const e2 = await capture(() => neu.fetchYahooTimeseriesFundamentals("NESN.SW"));
    check("NESN.SW Throw: status error, kein Throw", e2.v.status === "error" && e2.v.httpStatus === null && e2.v.marketCap === null);
    install({}); neu.clearYahooCache();
    const e3 = await capture(() => neu.fetchYahooTimeseriesFundamentals("NOPE.XX"));
    check("unbekanntes Symbol (Chart 404): status no_meta, kein timeseries-Call", e3.v.status === "no_meta" && tsCalls() === 0 && e3.v.price === null);
    install({}); neu.clearYahooCache();
    const e4 = await capture(() => neu.fetchYahooTimeseriesFundamentals("VOD.L"));
    check("VOD.L (Meta GBp, echte Chart-Antwort): Kurs → Pfund, currency GBP; timeseries 404 → http_error", e4.v.currency === "GBP" && Math.abs(e4.v.price! - 1.2205) < 1e-9 && e4.v.status === "http_error", `${e4.v.price} ${e4.v.currency}`);
  }

  console.log("\n=== /api/analyze (FMP 402 → Yahoo, getcrumb 429) ===");
  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import("../server/analyze-route");
  const app = express(); app.use(express.json());
  const server = app.listen(0);
  registerAnalyzeRoute(server, app);
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as any).port;
  for (const t of ["VOW3.DE", "BMW.DE"]) {
    install({}); neu.clearYahooCache();
    const r = await capture(() => realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, useLLM: false, force: true }) }).then(async (x) => ({ status: x.status, body: await x.json() }))).then((q) => q.v);
    const b = r.body, ref = FIX[t].quoteSummaryRef;
    check(`${t}: HTTP 200, dataSource yahoo, currency ${ref.currency}`, r.status === 200 && b.dataSource === "yahoo" && b.currency === ref.currency, `${b.dataSource} ${b.currency}`);
    check(`${t}: marketCap ${b.marketCap} (Abw. zu quoteSummary ${pct(b.marketCap, ref.marketCap).toFixed(3)} %), peRatio ${b.peRatio?.toFixed?.(2)}, epsTTM ${b.epsTTM}`, Math.abs(pct(b.marketCap, ref.marketCap)) <= 0.55 && b.peRatio > 0 && b.epsTTM > 0);
    check(`${t}: Score/Rating/DCF bleiben n/a (C1-Gate unverändert)`, b.scoring === undefined && b.biasFix === undefined && b.dcfFairValue === null && b.upsidePotential === null);
  }
  for (const t of ["7203.T", "ASML.AS"]) {
    install({}); neu.clearYahooCache();
    const r = await capture(() => realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, useLLM: false, force: true }) }).then(async (x) => ({ status: x.status, body: await x.json() })));
    const b = r.v.body;
    // #261: Suffix-Währung → USD-Umrechnung; FMP-FX fehlt im Mock (402) → Yahoo-FX JPYUSD=X/EURUSD=X (range=5d). Gezählt werden nur Meta-Calls des Tickers.
    check(`${t} (Gate): HTTP ${r.v.status}, kein timeseries-/Meta-Call für ${t}, keine stage=timeseries-Zeile (wie main)`, tsCalls() === 0 && calls.filter((u) => u.includes("range=5d") && u.includes(`/chart/${encodeURIComponent(t)}?`)).length === 0 && !r.lines.some((l) => l.includes("stage=timeseries")) && !r.lines.some((l) => l.includes("chart meta")), `dataSource ${b?.dataSource} currency ${b?.currency} marketCap ${b?.marketCap}`);
  }
  server.close();
} finally {
  globalThis.fetch = realFetch;
  if (existsSync(LEGACY_PATH)) unlinkSync(LEGACY_PATH);
}
console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
