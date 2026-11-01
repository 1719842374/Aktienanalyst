/**
 * F1-71 + F1-74: Buffett EU/CN mit Benchmark-Schätzung (Anker = letzte Weltbank-Quote) und ETF-Proxy-Kennzeichnung.
 * Datenfluss: BuffettRatioPanel → useQuery-fetch /api/analyze-recession/buffett?region=EU|CN → echte Express-Route
 * (server/buffett-route.ts) → Yahoo ^STOXX / VGK / ASHR + FRED EUNNGDP / MKTGDPCNA646NWDB / DEXUSEU / DDDM01*.
 * Gemockt ist nur globales fetch (echte Snapshots: script/fixtures/buffett-f171/ vom 25.10.2026, script/fixtures/buffett/ vom 18.10.2026).
 * Ausführen (Repo-Root): npx tsx --tsconfig script/tsconfig.jsx.json script/test-buffett-f171-benchmarks.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { withoutApproved326 } from "./guard-approved-326";
import type { AddressInfo } from "node:net";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const F171 = "script/fixtures/buffett-f171";
const FIX = "script/fixtures/buffett";
/** sha256 der US-Antwort (JSON) auf main 99a06d1b mit denselben Fixtures; erzeugt mit PRINT_US_HASH=1 auf main. */
const US_SHA256_MAIN = process.env.US_SHA256_MAIN ?? "530fb4fec40cf18e1a3ae5ccd8307ff9e9523e19dede388fdac3129a065aa683";

const yahooFile: Record<string, string> = { "^STOXX": `${F171}/STOXX-2026-10-25.json`, VGK: `${F171}/VGK-2026-10-25.json`, ASHR: `${F171}/ASHR-2026-10-25.json`, "^W5000": `${FIX}/W5000-2026-10-18.json` };
const fredFile = (id: string) => {
  for (const p of [`${F171}/${id}-2026-10-25.csv`, `${FIX}/${id}-2026-10-18.csv`]) { try { return readFileSync(p, "utf8"); } catch { /* next */ } }
  return null;
};
type Rule = "ok" | "503";
const rules: Record<string, Rule> = {};
function seriesKey(url: string): string | null {
  if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")) return decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
  if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) return new URL(url).searchParams.get("id");
  return null;
}
function upstream(key: string): Response {
  if ((rules[key] ?? "ok") === "503") return new Response("err", { status: 503 });
  if (yahooFile[key]) return new Response(readFileSync(yahooFile[key], "utf8"), { status: 200 });
  if (key === "^DWCF" || key === "VTI") return new Response("not found", { status: 404 });
  const csv = fredFile(key);
  return csv ? new Response(csv, { status: 200 }) : new Response("not found", { status: 404 });
}

async function main() {
  const express = (await import("express")).default;
  const route: any = await import("../server/buffett-route");
  route.setBuffettRetryPauseForTests(0);
  const app = express();
  route.registerBuffettRatioRoute(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    const key = seriesKey(url);
    if (key) return upstream(key);
    if (url.startsWith("/api/")) return realFetch(base + url, init);
    throw new Error(`unerwarteter Abruf ${url}`);
  };
  const origErr = console.error, origWarn = console.warn;
  const quiet = () => { console.error = () => {}; console.warn = () => {}; };
  const loud = () => { console.error = origErr; console.warn = origWarn; };
  const reset = (r: Record<string, Rule> = {}) => { route.resetBuffettCache(); for (const k of Object.keys(rules)) delete rules[k]; Object.assign(rules, r); };
  const getRaw = async (region: string) => { quiet(); const r = await realFetch(`${base}/api/analyze-recession/buffett?region=${region}`); const t = await r.text(); loud(); return { status: r.status, text: t, body: JSON.parse(t) }; };

  // ── 0. US byte-identisch zu main ──
  reset();
  const us = await getRaw("US");
  const usHash = createHash("sha256").update(us.text).digest("hex");
  if (process.env.PRINT_US_HASH) { console.log(usHash); server.close(); process.exit(0); }
  assert.equal(us.status, 200);
  assert.equal(usHash, US_SHA256_MAIN, "US-Antwort byte-identisch zu main");
  assert.ok(!("benchmark" in us.body) && !("benchmarkUnavailable" in us.body));
  reset({ "^W5000": "503" });
  const usFb = await getRaw("US");
  assert.ok(usFb.body.fallback && !("benchmark" in usFb.body), "US-Ersatzpfad ohne neue Felder");
  ok(`US-Antwort byte-identisch zu main (sha256 ${usHash.slice(0, 12)}…), keine neuen Felder, auch im FRED-Ersatzpfad`);

  // ── 1. Anker-Eichung exakt (reine Funktion) ──
  const gdp = [{ date: "2015-11-15", value: 100 }, { date: "2016-02-15", value: 110 }];
  const bars = [{ date: "2015-12-30", close: 50 }, ...Array.from({ length: 25 }, (_, i) => ({ date: `2016-01-${String(i + 2).padStart(2, "0")}`, close: 50 + i }))];
  const a = route.anchorEstimate({ anchorQuote: 42.54, anchorYear: 2015, bars, gdp, label: "T" });
  assert.equal(a.anchorDate, "2015-12-30"); assert.equal(a.points[0].ratio, 42.54, "Quote am Anker = Quote_Anker exakt");
  const g = (d: string) => 100 + 10 * (Date.parse(`${d}T00:00:00Z`) - Date.parse("2015-11-15T00:00:00Z")) / (Date.parse("2016-02-15T00:00:00Z") - Date.parse("2015-11-15T00:00:00Z"));
  const p = a.points.find((x: any) => x.date === "2016-01-20")!;
  assert.ok(Math.abs(p.ratio - 42.54 * (68 / 50) / (g("2016-01-20") / g("2015-12-30"))) < 1e-9, "Formel Quote_Anker×(K/K0)/(BIP/BIP0)");
  assert.throws(() => route.anchorEstimate({ anchorQuote: 1, anchorYear: 2015, bars: bars.slice(1), gdp, label: "T" }), /kein Kurs im letzten Quartal des Ankerjahres 2015/);
  assert.throws(() => route.anchorEstimate({ anchorQuote: 1, anchorYear: 2015, bars: bars.slice(0, 10), gdp, label: "T" }), /zu wenige Kurse nach dem Anker \(9 < 20\)/);
  assert.throws(() => route.anchorEstimate({ anchorQuote: 1, anchorYear: 2015, bars, gdp: [{ date: "2016-03-01", value: 1 }], label: "T" }), /BIP-Reihe deckt das Ankerdatum/);
  ok("Anker exakt: Quote(Anker) = 42,54; spätere Punkte nach Formel; Fehler bei fehlendem Ankerkurs, zu wenigen Kursen, BIP ohne Abdeckung");

  // unabhängige Nachrechnung aus den Fixtures
  const fred = (id: string) => fredFile(id)!.trim().split("\n").slice(1).map(l => l.split(",")).filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Number(v)) && v !== "").map(([d, v]) => ({ date: d, value: Number(v) }));
  const yb = (sym: string) => { const r = JSON.parse(readFileSync(yahooFile[sym], "utf8")).chart.result[0]; return r.timestamp.map((t: number, i: number) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: r.indicators.quote[0].close[i] })).filter((b: any) => b.close > 0); };
  const interp = (pts: { date: string; value: number }[], d: string) => {
    const s = (x: string) => Date.parse(`${x}T00:00:00Z`);
    if (d <= pts[0].date) return pts[0].value; if (d >= pts[pts.length - 1].date) return pts[pts.length - 1].value;
    let i = 0; while (pts[i + 1].date <= d) i++; const L = pts[i], R = pts[i + 1];
    return L.value + (R.value - L.value) * (s(d) - s(L.date)) / (s(R.date) - s(L.date));
  };
  const mid = (pts: { date: string; value: number }[], days: number) => pts.map(x => ({ date: new Date(Date.parse(`${x.date}T00:00:00Z`) + Math.round(days / 2) * 86_400_000).toISOString().slice(0, 10), value: x.value }));
  const expectLast = (wbId: string, sym: string, gdpId: string, days: number, fx?: string) => {
    const wb = fred(wbId); const last = wb[wb.length - 1]; const year = last.date.slice(0, 4);
    let b = yb(sym); if (fx) { const f = fred(fx); b = b.map((x: any) => ({ date: x.date, close: x.close / interp(f, x.date) })); }
    const g2 = mid(fred(gdpId).filter(x => x.date >= `${Number(year) - 2}-01-01`), days);
    const anc = b.filter((x: any) => x.date <= `${year}-12-31`).pop(); const end = b[b.length - 1];
    return { anchorDate: anc.date, ratio: Math.round(last.value * (end.close / anc.close) / (interp(g2, end.date) / interp(g2, anc.date)) * 10) / 10, endDate: end.date };
  };

  // ── 2. EU: Index → ETF → Weltbank → n/a ──
  reset();
  let r = await getRaw("EU");
  let e = expectLast("DDDM01EZA156NWDB", "^STOXX", "EUNNGDP", 91);
  assert.equal(r.status, 200);
  assert.equal(r.body.benchmark.symbol, "^STOXX"); assert.equal(r.body.benchmark.kind, "index"); assert.equal(r.body.benchmark.currency, "EUR");
  assert.equal(r.body.benchmark.anchorDate, e.anchorDate); assert.equal(r.body.benchmark.anchorQuote, 42.54);
  assert.equal(r.body.latest.date, e.endDate); assert.equal(r.body.latest.ratio, e.ratio, "letzter Punkt unabhängig nachgerechnet");
  assert.ok(r.body.note.includes("Schätzung") && r.body.note.includes(`Anker-Datum ${e.anchorDate.split("-").reverse().join(".")}`), r.body.note);
  assert.ok(r.body.points.every((x: any) => !x.proxy && !x.proxyKind), "Index: kein proxy-Feld");
  assert.deepEqual(r.body.sources.map((s: any) => s.id), ["DDDM01EZA156NWDB", "^STOXX", "EUNNGDP"]);
  assert.equal(r.body.points.find((x: any) => x.date === "2015-01-01").ratio, 42.5, "Weltbank-Historie bleibt");
  const euIndex = r.body;
  console.log(`     EU (Fixture): ${r.body.latest.ratio} % am ${r.body.latest.date}, Anker ${e.anchorDate}`);

  reset({ "^STOXX": "503" });
  r = await getRaw("EU");
  e = expectLast("DDDM01EZA156NWDB", "VGK", "EUNNGDP", 91, "DEXUSEU");
  assert.equal(r.body.benchmark.symbol, "VGK"); assert.equal(r.body.benchmark.kind, "etf"); assert.equal(r.body.benchmark.currency, "EUR", "VGK in € umgerechnet");
  assert.deepEqual(r.body.benchmark.skipped, ["Yahoo ^STOXX: HTTP 503 (2 Versuche)"]);
  assert.equal(r.body.latest.ratio, e.ratio, "VGK/DEXUSEU unabhängig nachgerechnet");
  const after = r.body.points.filter((x: any) => x.date > r.body.benchmark.anchorDate);
  assert.ok(after.length > 100 && after.every((x: any) => x.proxy === "VGK" && x.proxyKind === "etf"), "ETF-Punkte: proxy=VGK, proxyKind=etf");
  assert.ok(r.body.points.filter((x: any) => x.date <= r.body.benchmark.anchorDate).every((x: any) => !x.proxy));
  assert.deepEqual(r.body.sources.map((s: any) => s.id), ["DDDM01EZA156NWDB", "VGK", "DEXUSEU", "EUNNGDP"]);
  assert.ok(/^ETF-Proxy:/.test(r.body.sources[1].role) && r.body.note.includes("ETF-Proxy") && r.body.note.includes("Übersprungen: Yahoo ^STOXX: HTTP 503"));
  const euEtf = r.body;

  reset({ "^STOXX": "503", VGK: "503" });
  r = await getRaw("EU");
  assert.equal(r.status, 200); assert.equal(r.body.latest.date, "2015-01-01"); assert.equal(r.body.benchmark, null); assert.equal(r.body.fallback, null);
  assert.equal(r.body.benchmarkUnavailable, "Yahoo ^STOXX: HTTP 503 (2 Versuche); Yahoo VGK: HTTP 503 (2 Versuche)");
  assert.ok(r.body.note.includes("Keine Benchmark-Schätzung nach 2015"));
  reset({ DEXUSEU: "503", "^STOXX": "503" });
  r = await getRaw("EU");
  assert.equal(r.body.benchmark, null); assert.ok(r.body.benchmarkUnavailable.includes("FRED DEXUSEU: HTTP 503"), "ohne FX kein VGK (keine Währungsmischung)");
  reset({ EUNNGDP: "503" });
  r = await getRaw("EU");
  assert.equal(r.body.benchmark, null); assert.equal(r.body.benchmarkUnavailable, "FRED EUNNGDP: HTTP 503 (2 Versuche)");
  reset({ DDDM01EZA156NWDB: "503" });
  r = await getRaw("EU");
  assert.equal(r.status, 502); assert.equal(r.body.reason, "FRED DDDM01EZA156NWDB: HTTP 503 (2 Versuche)");
  ok("EU: ^STOXX (€) → VGK (US-$→€ via DEXUSEU, Grund in skipped) → Weltbank allein mit Grund → n/a 502; BIP- oder FX-Ausfall ohne Fake-Werte");

  // ── 3. CN: ASHR → Weltbank → n/a ──
  reset();
  r = await getRaw("CN");
  e = expectLast("DDDM01CNA156NWDB", "ASHR", "MKTGDPCNA646NWDB", 365);
  assert.equal(r.body.benchmark.symbol, "ASHR"); assert.equal(r.body.benchmark.kind, "etf"); assert.equal(r.body.benchmark.currency, "USD");
  assert.equal(r.body.benchmark.anchorYear, 2020); assert.equal(r.body.latest.ratio, e.ratio); assert.equal(r.body.latest.proxy, "ASHR"); assert.equal(r.body.latest.proxyKind, "etf");
  assert.ok(r.body.note.includes("Schätzung") && r.body.note.includes(`Anker-Datum ${e.anchorDate.split("-").reverse().join(".")}`));
  const cnEtf = r.body;
  console.log(`     CN (Fixture): ${r.body.latest.ratio} % am ${r.body.latest.date}, Anker ${e.anchorDate}`);
  reset({ ASHR: "503" });
  r = await getRaw("CN");
  assert.equal(r.body.latest.date, "2020-01-01"); assert.equal(r.body.benchmark, null); assert.equal(r.body.benchmarkUnavailable, "Yahoo ASHR: HTTP 503 (2 Versuche)");
  reset({ DDDM01CNA156NWDB: "503" });
  r = await getRaw("CN");
  assert.equal(r.status, 502); assert.equal(r.body.reason, "FRED DDDM01CNA156NWDB: HTTP 503 (2 Versuche)");
  ok("CN: ASHR (US-$ zu BIP in US-$) mit proxy/proxyKind → Weltbank allein → n/a 502");

  // ── 4. UI: Badge nur bei ETF, unterscheidbar von „fortgeschrieben via“ ──
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { BuffettRatioPanel } = await import("../client/src/components/recession/BuffettRatioPanel");
  const scale = await import("../client/src/components/recession/buffettChartScale");
  const html = (payload: any) => {
    const qc = new QueryClient(); qc.setQueryData(["recession-buffett", "US"], payload);
    return renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(BuffettRatioPanel)));
  };
  const text = (h: string) => h.replace(/<[^>]+>/g, "");
  const hCn = html(cnEtf), hEtf = html(euEtf), hIdx = html(euIndex), hUs = html(us.body);
  for (const h of [hCn, hEtf]) assert.ok(h.includes('data-testid="badge-buffett-etf-proxy"') && text(h).includes("ETF-Proxy"));
  assert.ok(!hIdx.includes("badge-buffett-etf-proxy") && hIdx.includes('data-testid="text-buffett-benchmark"') && text(hIdx).includes("Schätzung ab 30. Dezember 2015"));
  assert.ok(!hUs.includes("badge-buffett-etf-proxy") && !hUs.includes("text-buffett-benchmark"));
  assert.ok(!text(hCn).includes("fortgeschrieben"));
  assert.equal(scale.proxySuffix({ proxy: "ASHR", proxyKind: "etf" }), " (ETF-Proxy ASHR)");
  assert.equal(scale.proxySuffix({ proxy: "VTI" }), " (fortgeschrieben via VTI)", "US-Text unverändert");
  assert.equal(scale.lastPointLabel({ date: "2026-10-23", ratio: 54.3, proxy: "ASHR", proxyKind: "etf" }), "54 % · 23.10.26 (ETF-Proxy ASHR)");
  const hNa = html({ ...euIndex, benchmark: null, benchmarkUnavailable: "Yahoo ^STOXX: HTTP 503 (2 Versuche); Yahoo VGK: HTTP 503 (2 Versuche)" });
  assert.ok(text(hNa).includes("Benchmark-Schätzung n/a — Yahoo ^STOXX: HTTP 503") && !hNa.includes("badge-buffett-etf-proxy"));
  ok("UI: Badge „ETF-Proxy“ nur bei VGK/ASHR; Index ohne Badge, mit Schätzungs-Hinweis; US ohne; Punkt-Text „ETF-Proxy X“ ≠ „fortgeschrieben via“; n/a mit Grund");

  // ── 5. Kein Effekt auf Rezessions-Score ──
  const git = (...x: string[]) => execFileSync("git", x, { encoding: "utf8" });
  const changed = [...git("diff", "--name-only", "99a06d1b").trim().split("\n"), ...git("ls-files", "--others", "--exclude-standard").trim().split("\n")].filter(Boolean);
  for (const f of ["server/analyze-route.ts", "server/recession.ts", "server/recession-regions.ts", "server/buffett-ratio.ts", "shared/schema.ts", "shared/bias-fixes.ts", "server/scoring-integration.ts", "server/routes-register.ts"]) assert.ok(!withoutApproved326("99a06d1b", changed).includes(f), f); // #326: nur zeilengenau freigegebene Zeilen ausgenommen
  assert.equal(route.WILSHIRE_DOLLARS_PER_POINT_BN, 1.05);
  const rec = readFileSync("server/recession.ts", "utf8");
  assert.ok(!/BENCHMARK_REGIONS|buildBenchmarkRegion|anchorEstimate|analyze-recession\/buffett/.test(rec), "recession.ts nutzt die neue Schätzung nicht");
  const imports = [...rec.matchAll(/from "\.\/buffett-route"/g)].length;
  assert.equal(imports, 1); assert.ok(/import \{ WILSHIRE_DOLLARS_PER_POINT_BN \} from "\.\/buffett-route";/.test(rec));
  const { buildBiasDecision } = await import("../shared/bias-fixes");
  for (const name of ["MSFT", "SPY"]) {
    const d = JSON.parse(readFileSync(`script/fixtures/analysis-${name}.json`, "utf8"));
    const b0 = buildBiasDecision(d);
    for (const extra of [{ buffett: euIndex }, { buffett: cnEtf }]) assert.deepEqual(buildBiasDecision({ ...d, ...extra } as any), b0);
  }
  ok("Rezessions-Score: recession.ts/analyze-route/Score-Dateien unverändert, nur Konstante importiert; Bias-Entscheidung MSFT/SPY mit EU/CN-Antwort deepEqual");

  server.close();
  console.log(`\n${n} Checks grün`);
  process.exit(0);
}
main().catch(e => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
