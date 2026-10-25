/**
 * Buffett-Indikator robust (Future_SOLL_IST_DETAIL_35ead515 F1-34, mit F1-30 und F1-31).
 * Datenfluss: echtes BuffettRatioPanel (react-dom + script/lib/fake-dom) → useQuery-fetch
 * /api/analyze-recession/buffett → echte Express-Route (server/buffett-route.ts registerBuffettRatioRoute) →
 * fetchTextWithRetry → Yahoo ^W5000 / FRED GDP, NCBEILQ027S, FBCELLQ027S, DDDM01EZA156NWDB.
 * Gemockt ist nur globales fetch für Yahoo und FRED (echte Snapshots vom 18.10.2026 in script/fixtures/buffett/).
 * Ausführen (Repo-Root): npx tsx --tsconfig script/tsconfig.jsx.json script/test-buffett-robust.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { installFakeDom, findByTestId, FakeElement, FakeText, type FakeNode } from "./lib/fake-dom";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const BASE = "29fdf1d5e19cc458005469098701d8190d1d374d"; // PR-Basis (main bei Branch-Start)
const FIX = "script/fixtures/buffett";
const csv = (id: string) => readFileSync(`${FIX}/${id}-2026-10-18.csv`, "utf8");
const W5000 = readFileSync(`${FIX}/W5000-2026-10-18.json`, "utf8");
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" });
const { doc } = installFakeDom();
(FakeElement.prototype as any).getElementsByClassName = () => [];

type Rule = "ok" | "503" | "timeout" | "html" | "short" | "once503";
const rules: Record<string, Rule> = {};
const calls: string[] = [];
const seen: Record<string, number> = {};

function seriesKey(url: string): string | null {
  if (url.startsWith("https://query1.finance.yahoo.com/v8/finance/chart/")) return decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
  if (url.startsWith("https://fred.stlouisfed.org/graph/fredgraph.csv")) return new URL(url).searchParams.get("id");
  return null;
}
function upstream(key: string): Response {
  seen[key] = (seen[key] ?? 0) + 1;
  const rule = rules[key] ?? "ok";
  if (rule === "503" || (rule === "once503" && seen[key] === 1)) return new Response("err", { status: 503 });
  if (rule === "timeout") { const e = new Error("The operation was aborted due to timeout"); e.name = "TimeoutError"; throw e; }
  if (rule === "html") return new Response("<!DOCTYPE html><html></html>", { status: 200 });
  if (key === "^W5000") {
    if (rule === "short") {
      const j = JSON.parse(W5000); const r = j.chart.result[0];
      r.timestamp = r.timestamp.slice(-300); r.indicators.quote[0].close = r.indicators.quote[0].close.slice(-300);
      return new Response(JSON.stringify(j), { status: 200 });
    }
    return new Response(W5000, { status: 200 });
  }
  if (key === "^DWCF" || key === "VTI") return new Response("not found", { status: 404 });
  return new Response(csv(key), { status: 200 });
}

async function main() {
  const express = (await import("express")).default;
  const route = await import("../server/buffett-route");
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
    if (key) { calls.push(key); return upstream(key); }
    if (url.startsWith("/api/")) return realFetch(base + url, init);
    throw new Error(`unerwarteter Abruf ${url}`);
  };
  const origErr = console.error, origWarn = console.warn;
  const quiet = () => { console.error = () => {}; console.warn = () => {}; };
  const loud = () => { console.error = origErr; console.warn = origWarn; };
  const reset = (r: Record<string, Rule> = {}) => { route.resetBuffettCache(); for (const k of Object.keys(rules)) delete rules[k]; Object.assign(rules, r); calls.length = 0; for (const k of Object.keys(seen)) delete seen[k]; };
  const get = async (region = "US") => { quiet(); const r = await realFetch(`${base}/api/analyze-recession/buffett?region=${region}`); loud(); return { status: r.status, body: await r.json() as any }; };

  // Erwartete Werte aus den Fixtures, unabhängig von der Route gerechnet
  const fred = (id: string) => csv(id).trim().split("\n").slice(1).map(l => l.split(",")).filter(([d, v]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Number(v))).map(([d, v]) => ({ date: d, value: Number(v) }));
  const gdp = fred("GDP"), nfc = fred("NCBEILQ027S"), fin = fred("FBCELLQ027S");
  const wj = JSON.parse(W5000).chart.result[0];
  const wBars = (wj.timestamp as number[]).map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: wj.indicators.quote[0].close[i] })).filter(b => b.close != null && b.close > 0);
  const lastBar = wBars[wBars.length - 1];
  const lastGdp = gdp[gdp.length - 1];
  const expectedOkRatio = Math.round((lastBar.close * route.WILSHIRE_DOLLARS_PER_POINT_BN / lastGdp.value) * 100 * 10) / 10; // letzter Bar liegt nach dem letzten BIP-Quartal → letzter BIP-Wert
  const lastFa = nfc[nfc.length - 1];
  const finAt = fin.find(p => p.date === lastFa.date)!;
  const gdpAtFa = gdp.find(p => p.date === lastFa.date)!;
  const expectedFbRatio = Math.round(((lastFa.value + finAt.value) / 1000 / gdpAtFa.value) * 100 * 10) / 10;

  // ── 1. OK ──
  reset();
  let r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.fallback, null);
  assert.equal(r.body.latest.date, lastBar.date); assert.equal(r.body.latest.ratio, expectedOkRatio);
  assert.ok(r.body.points.length > 9000 && r.body.sources.some((s: any) => s.id === "^W5000"));
  assert.equal(seen["^W5000"], 1, "OK → ein Yahoo-Versuch");
  ok(`OK: Wilshire-Quote ${r.body.latest.ratio}% am ${r.body.latest.date} (= ${lastBar.close} × 1,05 / BIP ${lastGdp.value}), ${r.body.points.length} Punkte, fallback null`);

  // ── 2. Retry (F1-30) ──
  reset({ "^W5000": "once503", GDP: "once503" });
  r = await get();
  assert.equal(r.status, 200); assert.equal(r.body.fallback, null); assert.equal(r.body.latest.ratio, expectedOkRatio);
  assert.equal(seen["^W5000"], 2); assert.equal(seen.GDP, 2);
  reset({ "^W5000": "503" });
  r = await get();
  assert.equal(seen["^W5000"], 2, "höchstens 2 Versuche");
  assert.equal(seen["^DWCF"], 1, "Proxys bleiben bei einem Versuch");
  ok("Retry: erster Yahoo-/FRED-Abruf 503, zweiter ok → normale Antwort; Wilshire höchstens 2 Versuche, Proxys unverändert 1");

  // ── 3. FRED-Fallback (F1-31) ──
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.fallback, { source: route.FRED_MARKET_VALUE_FALLBACK_SOURCE, reason: "Yahoo ^W5000: HTTP 503 (2 Versuche)", frequency: "quarterly", asOf: lastFa.date });
  assert.equal(r.body.latest.date, lastFa.date); assert.equal(r.body.latest.ratio, expectedFbRatio);
  assert.ok(!r.body.sources.some((s: any) => s.id === "^W5000") && r.body.note.startsWith("Ersatzquelle:") && r.body.note.includes("nicht mit der Wilshire-Linie vergleichbar"));
  assert.ok(r.body.points.every((p: any) => !p.proxy), "keine Proxy-Fortschreibung im Ersatz");
  const before = calls.length;
  assert.equal((await get()).status, 200); assert.equal(calls.length, before, "Ersatz 5 min gecacht");
  reset({ "^W5000": "short" });
  r = await get();
  const shortCount = (wj.indicators.quote[0].close as Array<number | null>).slice(-300).filter(c => c != null && c > 0).length;
  assert.equal(r.body.fallback.reason, `Yahoo ^W5000: zu wenige Tagesschlüsse (${shortCount} < 500)`);
  reset({ "^W5000": "timeout" });
  r = await get();
  assert.equal(r.body.fallback.reason, "Yahoo ^W5000: Timeout nach 35 s (2 Versuche)");
  ok(`Fallback: Wilshire weg → FRED NCBEILQ027S + FBCELLQ027S, ${r.body.latest.ratio}% am ${lastFa.date} (Quartal, eigener Trend), klar markiert; Gründe HTTP 503 / zu wenige Bars / Timeout`);

  // ── 4. Konkreter 502 statt generisch (F1-34) ──
  reset({ "^W5000": "503", NCBEILQ027S: "html" });
  r = await get();
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: "Buffett-Quote nicht verfügbar: Yahoo ^W5000: HTTP 503 (2 Versuche); FRED-Ersatz leer – FRED NCBEILQ027S: leere oder ungültige Antwort (2 Versuche)", errorCode: "BUFFETT_SOURCE_UNAVAILABLE", reason: "Yahoo ^W5000: HTTP 503 (2 Versuche); FRED-Ersatz leer – FRED NCBEILQ027S: leere oder ungültige Antwort (2 Versuche)" });
  reset({ GDP: "timeout" });
  r = await get();
  assert.equal(r.status, 502); assert.equal(r.body.reason, "BIP-Reihe leer – FRED GDP: Timeout nach 25 s (2 Versuche)");
  reset({ DDDM01EZA156NWDB: "503" });
  r = await get("EU");
  assert.equal(r.status, 502); assert.equal(r.body.reason, "FRED DDDM01EZA156NWDB: HTTP 503 (2 Versuche)");
  reset();
  r = await get("EU");
  assert.equal(r.status, 200); assert.equal(r.body.latest.date, "2015-01-01"); assert.equal(r.body.fallback, null);
  reset({ GDP: "503" });
  assert.equal((await get()).status, 502);
  rules.GDP = "ok";
  assert.equal((await get()).status, 200, "Fehler wird nicht gecacht");
  assert.equal((await get("XX")).status, 400);
  ok("502 mit Grund: Wilshire+FRED-Ersatz weg, BIP-Timeout, EU-Reihe 503 (vorher leere 200); Fehler nicht gecacht; EU ok unverändert");

  // ── 5. UI: echtes BuffettRatioPanel ──
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
  reset();
  let m = await mount(c => textOf(c).includes("Der Zähler ist der Wilshire 5000"));
  assert.ok(!findByTestId(m.c, "text-buffett-fallback") && !findByTestId(m.c, "text-buffett-error") && !findByTestId(m.c, "text-buffett-error-reason"));
  await m.done();
  reset({ "^W5000": "503" });
  m = await mount(c => !!findByTestId(c, "text-buffett-fallback"));
  const fb = textOf(findByTestId(m.c, "text-buffett-fallback"));
  assert.ok(fb.includes(route.FRED_MARKET_VALUE_FALLBACK_SOURCE) && fb.includes("Yahoo ^W5000: HTTP 503 (2 Versuche)") && fb.includes("letztes Quartal 1. April 2026"), fb);
  assert.ok(!findByTestId(m.c, "text-buffett-error"));
  await m.done();
  reset({ "^W5000": "503", NCBEILQ027S: "503" });
  m = await mount(c => !!findByTestId(c, "text-buffett-error-reason"));
  assert.equal(textOf(findByTestId(m.c, "text-buffett-error-reason")), "n/a — Buffett-Quote nicht verfügbar: Yahoo ^W5000: HTTP 503 (2 Versuche); FRED-Ersatz leer – FRED NCBEILQ027S: HTTP 503 (2 Versuche)");
  assert.ok(findByTestId(m.c, "text-buffett-error") && !findByTestId(m.c, "chart-buffett") && !findByTestId(m.c, "text-buffett-fallback"), "kein Chart, kein Ersatzwert");
  await m.done();
  // Max-Achse: Wilshire unverändert [0, 250] (auch über 250 %, wie main); nur der FRED-Ersatz (~336 %) wird in 50er-Schritten erweitert
  const panelSrc = readFileSync("client/src/components/recession/BuffettRatioPanel.tsx", "utf8");
  const fnSrc = (name: string) => panelSrc.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))![0].replace(/: \[number, number\]|: TrendPoint\[\]|: RangeId|: number\[\]/g, "");
  const yDomain = new Function(`${fnSrc("yDomain")}; return yDomain;`)() as (rows: any[], range: string, fallback?: boolean) => [number, number];
  const yTicksFor = new Function(`${fnSrc("yTicksFor")}; return yTicksFor;`)() as (d: [number, number], range: string) => number[];
  const row = (ratio: number) => ({ ratio, plus1: ratio, plus2: ratio, trend: ratio, minus1: ratio, minus2: ratio });
  assert.deepEqual(yDomain([row(40), row(245.3)], "Max"), [0, 250]);
  assert.deepEqual(yTicksFor([0, 250], "Max"), [0, 50, 100, 150, 200, 250]);
  assert.deepEqual(yDomain([row(40), row(251.7)], "Max"), [0, 250]);
  assert.deepEqual(yDomain([row(40), row(245.3)], "Max", true), [0, 250]);
  assert.deepEqual(yDomain([row(40), row(335.5)], "Max", true), [0, 350]);
  assert.deepEqual(yTicksFor([0, 350], "Max"), [0, 50, 100, 150, 200, 250, 300, 350]);
  ok("UI: OK ohne Hinweis; Fallback → gelber Hinweis mit Quelle, Grund, letztem Quartal; n/a → Banner + sichtbarer Grund, kein Chart");

  // ── 6. Score/Rating unverändert ──
  // Wächter-Basis wie #285: eigener Anteil = Diff gegen merge-base(HEAD, origin/main); fehlt origin/main → lokales main, sonst fester BASE.
  // Uncommittete Änderungen (git diff HEAD) und neue Dateien zählen immer mit.
  // Nach dem Squash-Merge (HEAD auf main, merge-base == HEAD) zählt nur der Squash-Commit „(#274)“ selbst.
  const tryGit = (...a: string[]) => { try { return git(...a).trim(); } catch { return ""; } };
  const mergeBase = tryGit("merge-base", "HEAD", "origin/main") || tryGit("merge-base", "HEAD", "main") || BASE;
  const squash274 = mergeBase === tryGit("rev-parse", "HEAD") ? (tryGit("log", "--first-parent", "--format=%H %s", `${BASE}..HEAD`).split("\n")
    .map(l => l.trim()).filter(l => /\(#274\)$/.test(l)).map(l => l.split(" ")[0]).pop() ?? null) : null;
  const changed = [...git("diff", "--name-only", ...(squash274 ? [`${squash274}^`, squash274] : [mergeBase])).trim().split("\n"), ...git("diff", "--name-only", "HEAD").trim().split("\n"), ...git("ls-files", "--others", "--exclude-standard").trim().split("\n")].filter(Boolean);
  console.log(`     Wächter-Basis: ${squash274 ? `Squash-Commit ${squash274.slice(0, 8)}` : `merge-base ${mergeBase.slice(0, 8)}${mergeBase === BASE ? " (Fallback BASE)" : ""}`}`);
  // Ausnahme nur server/pdf-export.ts: #321 baut PDF-Abschnitt 6 aus dem Fazit (shared/fazit-entry) und ändert dafür pdf-export.ts.
  // Score/Rating bleiben weiter durch die Prüfungen unten belegt (buildBiasDecision deepEqual, PDF-Fazit gleich, MSFT 5.6381 NEUTRAL).
  const LOCKED = ["server/analyze-route.ts", "server/researcher.ts", "server/recession.ts", "shared/schema.ts", "shared/bias-fixes.ts", "server/scoring-integration.ts", "server/pdf-export.ts", "server/buffett-ratio.ts"];
  const EXEMPT = new Set(["server/pdf-export.ts"]); // #321
  const alarms = (files: string[]) => LOCKED.filter(f => !EXEMPT.has(f) && files.includes(f));
  assert.deepEqual(alarms(["server/analyze-route.ts", "server/researcher.ts", "shared/schema.ts", "server/pdf-export.ts"]), ["server/analyze-route.ts", "server/researcher.ts", "shared/schema.ts"], "Wächter-Selbsttest: gesperrte Dateien schlagen weiter an");
  assert.deepEqual(alarms(["server/pdf-export.ts", "shared/fazit-entry.ts"]), [], "Wächter-Selbsttest: nur pdf-export.ts ausgenommen");
  for (const f of alarms(changed)) assert.fail(f);
  assert.equal(route.WILSHIRE_DOLLARS_PER_POINT_BN, 1.05, "Konstante, die recession.ts importiert, unverändert");
  const rec = readFileSync("server/recession.ts", "utf8");
  assert.ok(/import \{ WILSHIRE_DOLLARS_PER_POINT_BN \} from "\.\/buffett-route";/.test(rec) && !/analyze-recession\/buffett|buildUnitedStates|fallback/.test(rec.match(/function scoreBuffett[\s\S]*?\n\}/)![0]), "Rezessions-Score nutzt die Route nicht");
  const { buildBiasDecision } = await import("../shared/bias-fixes");
  const { generateAnalysisHTML } = await import("../server/pdf-export");
  reset();
  const okBody = (await get()).body;
  reset({ "^W5000": "503" });
  const fbBody = (await get()).body;
  const verdict = (h: string) => /FAZIT: ([A-ZÄÖÜ ]+)</.exec(h)?.[1] ?? "n/a";
  for (const name of ["MSFT", "SPY"]) {
    const d = JSON.parse(readFileSync(`script/fixtures/analysis-${name}.json`, "utf8"));
    const b0 = buildBiasDecision(d);
    for (const extra of [{ buffett: okBody }, { buffett: fbBody }]) assert.deepEqual(buildBiasDecision({ ...d, ...extra } as any), b0);
    quiet(); const h0 = await generateAnalysisHTML(d); const h1 = await generateAnalysisHTML({ ...d, buffett: fbBody }); loud();
    assert.equal(verdict(h1), verdict(h0));
    console.log(`     ${name}: ohne Buffett-Daten ${b0.overallScore.toFixed(4)} ${b0.overallRating} · mit OK-/Fallback-Antwort identisch (deepEqual) · PDF-Fazit ${verdict(h0)} = ${verdict(h1)}`);
  }
  const msft = buildBiasDecision(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")));
  assert.equal(msft.overallScore.toFixed(4), "5.6381"); assert.equal(msft.overallRating, "NEUTRAL");
  ok("analyze-route/researcher/recession/schema/Score-Dateien unverändert; Rezessions-Score unabhängig von der Route; MSFT 5.6381 NEUTRAL und SPY mit/ohne Buffett-Daten deepEqual");

  server.close();
  console.log(`\n${n} Checks grün`);
  process.exit(0);
}
main().catch(e => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
