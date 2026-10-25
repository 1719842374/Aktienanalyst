/**
 * Real10Y-Overlay (FRED DFII10) in der Technischen Analyse (Sektion 12): 1:1 der BTC-Chip „Makro → Real10Y“.
 * Prüft: (1) BTC/Gold unverändert (Helper == alter BTC-Code der PR-Basis 35ead515, wörtlich ausgeführt;
 *     fetchBTCMacroHistory alt vs. neu deepEqual; Gold/btcAnalysis von #267 nicht berührt),
 * (2) Datenpfad UI → useMarketReal10Y → GET /api/analyze-btc/real10y-history → server/btc-macro.ts
 *     fetchReal10YHistory → FRED DFII10 (curl), mit echtem Express-Route-Handler und echtem Server-Fetcher; nur das
 *     curl-Binary ist durch ein Skript ersetzt, das den echten FRED-Snapshot ausgibt bzw. scheitert,
 * (3) n/a-Pfad (502, HTML, Fenster nicht abgedeckt) ohne Ersatzwert; M2SL-Ausfall → Real10Y bleibt da, BTC wie bisher 502,
 * (4) Score unverändert.
 * Merge-fest: Datei-/Diff-Prüfungen vergleichen mit dem zuletzt hereingemergten main-Stand (zweiter Elternteil des
 * jüngsten Merge-Commits), sonst mit der PR-Basis; keine Zeilenzählung, Formeln funktional.
 * Die PR-Basis 35ead515 wird nur gelesen (alter BTC-Code), sie ist Vorfahre jedes Merge-Stands.
 * Fixtures (alle echt, abgerufen 18.10.2026): script/fixtures/real10y/DFII10-2026-10-18.csv
 * (fredgraph.csv?id=DFII10&cosd=2015-01-01), M2SL-2026-10-18.csv (id=M2SL&cosd=2014-01-01),
 * MSFT-ohlcv-2y-2026-10-18.json (Yahoo v8 chart MSFT range=2y interval=1d); analysis-MSFT.json (bestehend).
 * Ausführen (Repo-Root): npx tsx --tsconfig script/tsconfig.jsx.json script/test-real10y-overlay.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { installFakeDom, findByTestId, reactPropsOf, fiberOf, FakeElement, FakeText, type FakeNode } from "./lib/fake-dom";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const BASE = "35ead515c4c4380e8a194b9e3f4d6195fa0ec399"; // PR-Basis von #267 (Vorfahre, nur gelesen)
const FIX = resolve("script/fixtures/real10y");
const DFII10_CSV = readFileSync(join(FIX, "DFII10-2026-10-18.csv"), "utf8");
const MSFT_OHLCV = JSON.parse(readFileSync(join(FIX, "MSFT-ohlcv-2y-2026-10-18.json"), "utf8")).ohlcvData as Array<{ date: string; close: number }>;
const git = (...a: string[]) => execFileSync("git", a, { encoding: "utf8" });
// Eigener Anteil von #267, merge-fest: Vergleichsbasis ist der zuletzt in den Branch gemergte main-Stand (zweiter
// Elternteil des jüngsten Merge-Commits auf der first-parent-Kette), sonst die PR-Basis. So zählen Änderungen anderer
// PRs, die über main hereinkommen (#264, #266 …), nie als eigene. Dateiliste: nur Dateien, die sich gegenüber JEDER
// dieser Basen unterscheiden. Läuft der Test auf einem squash-gemergten main-Commit („… (#NNN)“ ohne Merge-Kette),
// gibt es keinen eigenen Anteil mehr → Datei-/Diff-Prüfungen werden übersprungen, die funktionalen Prüfungen bleiben.
const mergedMains = git("log", "--first-parent", "--merges", "--format=%P", `${BASE}..HEAD`).trim().split("\n").filter(Boolean)
  .map(l => l.split(" ")[1]).filter(Boolean);
const DIFF_BASE = mergedMains[0] ?? BASE;
// Nach dem Squash-Merge (#277-Erkennung: Subject endet auf „(#267)“) ist der eigene Anteil von #267 genau der
// Squash-Commit selbst: Datei-/Diff-Prüfungen laufen gegen SQUASH^..SQUASH, nie gegen den Branch-Diff. So bleibt der Test
// auf main UND auf jedem späteren Feature-Branch grün, prüft aber weiterhin, was #267 tatsächlich geändert hat.
const SQUASH_267 = git("log", "--first-parent", "--format=%H %s", `${BASE}..HEAD`).split("\n")
  .map(l => l.trim()).filter(l => /\(#267\)$/.test(l)).map(l => l.split(" ")[0]).pop() ?? null;
const onSquashedMain = SQUASH_267 != null;
const filesVs = (b: string) => new Set([
  ...git("diff", "--name-only", b).trim().split("\n"),
  ...git("ls-files", "--others", "--exclude-standard").trim().split("\n"),
].filter(Boolean));
const ownFiles = SQUASH_267 ? git("diff", "--name-only", `${SQUASH_267}^`, SQUASH_267).trim().split("\n").filter(Boolean).sort()
  : [...[DIFF_BASE, BASE, ...mergedMains].map(filesVs).reduce((acc, set) => new Set([...acc].filter(f => set.has(f))))].sort();
const ownDiffLines = (path: string) => git("diff", "--unified=0", ...(SQUASH_267 ? [`${SQUASH_267}^`, SQUASH_267] : [DIFF_BASE]), "--", path)
  .split("\n").filter(l => /^[+-][^+-]/.test(l));

const { doc } = installFakeDom();
// Recharts (CartesianAxis.componentDidMount) fragt getElementsByClassName ab; fake-dom kennt es nicht → leer (nur hier im Test).
(FakeElement.prototype as any).getElementsByClassName = () => [];

async function main() {
  const { REAL10Y_OVERLAY, real10yDomain, formatReal10yTick, formatReal10yValue, macroHistoryPath } = await import("../client/src/lib/real10yOverlay");
  const { parseFredCsv } = await import("../server/btc-macro");

  // ── 1. BTC/Gold unverändert ──
  const oldBtc = git("show", `${BASE}:client/src/pages/BTCDashboard.tsx`);
  const m = /const real10yDomain = useMemo\(\(\) => \{\n([\s\S]*?)\n  \}, \[chartData\]\);/.exec(oldBtc);
  assert.ok(m, "alter real10yDomain-Block auf main gefunden");
  // Alter BTC-Code von main wörtlich ausgeführt (nur TS-Typannotationen entfernt).
  const oldDomain = new Function("chartData", m![1].replace("(v): v is number", "(v)").replace(/ as \[number, number\]/g, "")) as (d: any[]) => [number, number];
  const real = parseFredCsv(DFII10_CSV);
  const cases: Array<Array<number | null>> = [[], [null, null], [1.5], [2.1, 2.1], [-1.08, -0.5, 0.3, null, 1.2], real.map(p => p.value),
    real.filter(p => p.date >= "2020-03-01" && p.date <= "2021-12-31").map(p => p.value), real.slice(-252).map(p => p.value), [0.04, 0.05, 0.06]];
  for (const c of cases) assert.deepEqual(real10yDomain(c), oldDomain(c.map(v => ({ real10y: v }))), JSON.stringify(c.slice(0, 5)));
  ok(`real10yDomain == alter BTC-Code (PR-Basis ${BASE.slice(0, 8)} BTCDashboard.tsx:1047-1054, wörtlich ausgeführt) für ${cases.length} Fälle inkl. echter DFII10-Historie, negativer Zinsen, leer`);

  for (const lit of ['name="Real10Y (DFII10)"', 'stroke="#38bdf8"', "strokeWidth={1.25}", 'title="Realzins (DFII10) als rechte Achse ein-/ausblenden"', '"border-sky-400 text-sky-400"', "tickFormatter={(v: number) => `${v.toFixed(1)}%`}", '{ key: "real10y", label: "Real10Y", color: "#38bdf8" }']) {
    assert.ok(oldBtc.includes(lit), `main-BTC enthält ${lit}`);
  }
  assert.equal(REAL10Y_OVERLAY.lineName, "Real10Y (DFII10)");
  assert.equal(REAL10Y_OVERLAY.color, "#38bdf8");
  assert.equal(REAL10Y_OVERLAY.strokeWidth, 1.25);
  assert.equal(REAL10Y_OVERLAY.chipTitle, "Realzins (DFII10) als rechte Achse ein-/ausblenden");
  assert.equal(REAL10Y_OVERLAY.chipOnClass, "border-sky-400 text-sky-400");
  assert.equal(REAL10Y_OVERLAY.label, "Real10Y");
  assert.equal(REAL10Y_OVERLAY.axisWidth, 44);
  for (const v of [-1.08, 0, 0.05, 2.84, 12.345]) { assert.equal(formatReal10yTick(v), `${v.toFixed(1)}%`); assert.equal(formatReal10yValue(v), `${Number(v).toFixed(2)}%`); }
  ok("Konstanten == bisherige BTC-Literale (Name, Farbe, Strichstärke, Chip-Titel/-Klasse/-Text, Achsbreite 44, Tick-/Tooltip-Format)");

  const btc = readFileSync("client/src/pages/BTCDashboard.tsx", "utf8");
  assert.ok(!btc.includes("#38bdf8") && !btc.includes('"Real10Y (DFII10)"'), "BTC nutzt keine eigenen Real10Y-Literale mehr");
  assert.ok(btc.includes("real10yDomainOf(chartData.map(d => d.real10y))"));
  assert.ok(btc.includes('tick={macroAxisHidden("real10y") ? false : { fontSize: narrow ? 10 : 9, fill: REAL10Y_OVERLAY.color }}'));
  // Achsbreite: Real10Y bleibt bei der Standardbreite 44 (= REAL10Y_OVERLAY.axisWidth); andere PRs (#266: walcl)
  // dürfen weitere breite Achsen ergänzen, ohne dass der Test bricht.
  const widthLine = /const macroAxisFullWidth = \(id: MacroAxisId\) => \((.*) \? 54 : 44\);/.exec(btc);
  assert.ok(widthLine, "macroAxisFullWidth vorhanden");
  assert.ok(widthLine![1].includes('id === "m2absolute"') && !widthLine![1].includes("real10y"), widthLine![0]);
  assert.ok(btc.includes("const [showReal10y, setShowReal10y] = useState(true);"), "BTC-Default weiter AN");
  // Jede von #267 geänderte BTC-Zeile ist eine reine Literal→Konstante-Ersetzung bzw. der Import
  // (Diff gegen den hereingemergten main-Stand → Änderungen anderer PRs an BTCDashboard stören nicht).
  const diff = ownDiffLines("client/src/pages/BTCDashboard.tsx");
  const added = diff.filter(l => l.startsWith("+")), removed = diff.filter(l => l.startsWith("-"));
  assert.ok(added.every(l => /REAL10Y_OVERLAY|real10yDomainOf|formatReal10yTick/.test(l)), added.join("\n"));
  assert.ok(removed.every(l => /#38bdf8|Real10Y|border-sky-400|toFixed\(1\)}%|real10yDomain|const vals = chartData|vals\.length === 0|Math\.(min|max)\(\.\.\.vals\)|const padding|return \[\+\(min|\}, \[chartData\]\);|strokeWidth=\{1\.25\}|Realzins \(DFII10\)|\$\{v\.toFixed/.test(l)), removed.join("\n"));
  ok(`BTCDashboard: nur Literal→Konstante + Domain-Aufruf (${added.length}+/${removed.length}- Zeilen), Default AN, Achsbreite/Mobile-Logik unverändert`);

  for (const f of ownFiles) assert.ok(!f.startsWith("client/src/components/gold") && !["client/src/pages/GoldDashboard.tsx", "server/gold-routes.ts", "client/src/lib/btcAnalysis.ts"].includes(f), `#267 ändert ${f}`);
  const gold = readFileSync("client/src/components/gold/GoldPriceChart.tsx", "utf8");
  assert.ok(gold.includes(`{ key: "real10y", label: "${REAL10Y_OVERLAY.label}", name: "${REAL10Y_OVERLAY.lineName}", color: "${REAL10Y_OVERLAY.color}", defaultOn: true, unit: "%", width: ${REAL10Y_OVERLAY.axisWidth},`));
  ok("Gold (GoldPriceChart/-Dashboard/gold-routes) und btcAnalysis von #267 nicht berührt; Gold-Real10Y-Werte == gemeinsame Konstanten");

  const btcA = readFileSync("client/src/lib/btcAnalysis.ts", "utf8");
  assert.ok(btcA.includes("fetchJSON(`/api/analyze-btc/macro-history?startDate=${encodeURIComponent(startDate)}`, 30000)"));
  assert.equal(macroHistoryPath("2024-10-17"), "/api/analyze-btc/macro-history?startDate=2024-10-17");
  assert.ok(btcA.includes("real10y: real10yByDate[d.date] ?? null,"));
  ok("macroHistoryPath == BTC-URL btcAnalysis.ts:889; Aktien-TA nutzt real10y-history (gleicher Fetcher, nur DFII10) und dieselbe Datums-Zuordnung wie btcAnalysis.ts:976");

  // ── 2. Datenpfad: echter Route-Handler + echter Server-Fetcher, curl = FRED-Snapshot ──
  const bin = mkdtempSync(join(tmpdir(), "real10y-curl-"));
  const curlLog = join(bin, "calls.log");
  writeFileSync(join(bin, "curl"), `#!/bin/sh
url=""; for a in "$@"; do url="$a"; done
echo "$url" >> "${curlLog}"
[ "$REAL10Y_FAKE_FRED" = "fail" ] && { echo "curl: (22) The requested URL returned error: 503" >&2; exit 22; }
case "$url" in *id=M2SL*) [ "$REAL10Y_FAKE_FRED" = "m2fail" ] && { echo "curl: (22) The requested URL returned error: 503" >&2; exit 22; } ;; esac
case "$url" in
  *id=DFII10*) cat "${join(FIX, "DFII10-2026-10-18.csv")}" ;;
  *id=M2SL*) cat "${join(FIX, "M2SL-2026-10-18.csv")}" ;;
  *) exit 6 ;;
esac
`);
  chmodSync(join(bin, "curl"), 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  const express = (await import("express")).default;
  const { registerBTCRoutes } = await import("../server/btc-routes");
  const app = express();
  registerBTCRoutes(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  const requests: string[] = [];
  let htmlMode = false;
  (globalThis as any).fetch = async (input: any) => {
    const url = String(input);
    requests.push(url);
    if (htmlMode) return new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } });
    return realFetch(base + url);
  };

  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { TechnicalChart, real10yOverlaySeries, withReal10YOverlay, oldestOhlcvDate } = await import("../client/src/components/sections/TechnicalChart");
  const { real10yHistoryPath } = await import("../client/src/lib/real10yOverlay");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const settle = async (ms = 60) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
  const fixture = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  // analysis-MSFT.json hat nur technicalIndicators.currentStatus; Section 12 rechnet MA/MACD/RSI selbst aus ohlcvData.
  const data = { ...fixture, ohlcvData: MSFT_OHLCV, technicalIndicators: { ...fixture.technicalIndicators, maData: [], macdData: [], signals: [] } };
  const textOf = (nd: FakeNode | null): string => !nd ? "" : nd instanceof FakeText ? nd.nodeValue : nd.childNodes.map(textOf).join("");
  const origErr = console.error, origWarn = console.warn;
  const quiet = () => { console.error = () => {}; console.warn = () => {}; };
  const loud = () => { console.error = origErr; console.warn = origWarn; };
  function findFiber(f: any, pred: (f: any) => boolean): any { for (let x = f; x; x = x.sibling) { if (pred(x)) return x; const r = findFiber(x.child, pred); if (r) return r; } return null; }

  // Default AN (Philip 18.10.): ohne Klick lädt der Hook sofort.
  async function mountDefault(waitFor: RegExp) {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const before = requests.length;
    quiet();
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TechnicalChart, { data }))); });
    loud();
    const chip = findByTestId(c, "button-real10y");
    assert.ok(chip, "Chip Real10Y gerendert");
    assert.equal(chip!.attributes["aria-pressed"], "true", "Default AN");
    for (let i = 0; i < 100; i++) { await settle(); if (waitFor.test(textOf(c))) break; }
    return { c, root, qc, chip: findByTestId(c, "button-real10y"), newRequests: requests.slice(before) };
  }

  const start = oldestOhlcvDate(MSFT_OHLCV)!;
  assert.equal(start, MSFT_OHLCV[0].date);
  const live = await mountDefault(/Quelle FRED DFII10|n\/a/);
  assert.equal(live.chip!.attributes["aria-pressed"], "true");
  assert.deepEqual(live.newRequests, [real10yHistoryPath(start)], "Hook ruft genau die DFII10-Route mit startDate = ältester Kurstag");
  const calls = readFileSync(curlLog, "utf8").trim().split("\n");
  assert.ok(calls.some(u => u === `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFII10&cosd=${start}`), calls.join(" | "));
  assert.ok(!calls.some(u => u.includes("id=M2SL")), "Aktien-TA lädt kein M2SL");
  const status = findByTestId(live.c, "real10y-overlay-status");
  assert.ok(status, textOf(live.c).slice(-300));
  const statusText = textOf(status);
  const lastBarInFred = [...MSFT_OHLCV].reverse().find(b => real.some(p => p.date === b.date))!;
  const lastVal = real.find(p => p.date === lastBarInFred.date)!.value;
  assert.ok(statusText.includes(`Real10Y (DFII10) (rechte Achse, %)`) && statusText.includes(formatReal10yValue(lastVal)) && statusText.includes("kein Score-Einfluss"), statusText);
  // Chart-Verdrahtung im gerenderten Baum: Achse + Linie mit BTC-Props
  const rootFiber = fiberOf(findByTestId(live.c, "chart-price-ma"));
  const axis = findFiber(rootFiber, f => f.memoizedProps?.yAxisId === "real10y" && f.memoizedProps?.orientation === "right");
  const line = findFiber(rootFiber, f => f.memoizedProps?.dataKey === "_real10y");
  assert.ok(axis && line, "YAxis real10y + Line _real10y im Baum");
  assert.equal(axis.memoizedProps.width, 44); assert.equal(axis.memoizedProps.axisLine.stroke, "#38bdf8"); assert.equal(axis.memoizedProps.tickFormatter(2.84), "2.8%");
  assert.deepEqual(line.memoizedProps.stroke, "#38bdf8"); assert.equal(line.memoizedProps.strokeWidth, 1.25); assert.equal(line.memoizedProps.name, "Real10Y (DFII10)");
  assert.equal(line.memoizedProps.type, "monotone"); assert.equal(line.memoizedProps.connectNulls, true); assert.equal(line.memoizedProps.dot, false);
  const chartRows = findFiber(rootFiber, f => Array.isArray(f.memoizedProps?.data) && f.memoizedProps.data.some((p: any) => "_real10y" in p))?.memoizedProps.data as any[];
  assert.ok(chartRows && chartRows.length > 200, "Chartdaten mit _real10y");
  for (const r of chartRows) { const fred = real.find(p => p.date === r.date); assert.equal(r._real10y, fred ? fred.value : null, r.date); }
  const withVal = chartRows.filter(r => r._real10y != null).length;
  assert.deepEqual(axis.memoizedProps.domain, real10yDomain(chartRows.map(r => r._real10y)));
  console.log(`     MSFT 1Y-Fenster: ${chartRows.length} Kurstage, ${withVal} mit DFII10, ${chartRows.length - withVal} ohne (null, kein Ersatzwert); Achse ${JSON.stringify(axis.memoizedProps.domain)}; zuletzt ${formatReal10yValue(lastVal)} am ${lastBarInFred.date}`);
  // Aus-/Einschalten und Reset je Ticker: Klick → AUS (keine Linie), Tickerwechsel → wieder AN.
  quiet(); await act(async () => { reactPropsOf(findByTestId(live.c, "button-real10y"))!.onClick(); }); loud();
  assert.equal(findByTestId(live.c, "button-real10y")!.attributes["aria-pressed"], "false", "Klick schaltet aus");
  assert.ok(!findByTestId(live.c, "real10y-overlay-status") && !findFiber(fiberOf(findByTestId(live.c, "chart-price-ma")), f => f.memoizedProps?.yAxisId === "real10y"), "aus → keine Achse/Status");
  quiet();
  await act(async () => { live.root.render(React.createElement(QueryClientProvider, { client: live.qc }, React.createElement(TechnicalChart, { data: { ...data, ticker: "MSFT-RESET" } }))); });
  loud();
  for (let i = 0; i < 100 && !findByTestId(live.c, "real10y-overlay-status"); i++) await settle();
  assert.equal(findByTestId(live.c, "button-real10y")!.attributes["aria-pressed"], "true", "Tickerwechsel → wieder AN");
  assert.ok(findByTestId(live.c, "real10y-overlay-status"), "nach Tickerwechsel wieder gezeichnet");
  quiet(); await act(async () => { live.root.unmount(); }); loud();
  ok("Default AN, Klick aus, Tickerwechsel wieder AN; Datenpfad UI-Chip → useMarketReal10Y → GET /api/analyze-btc/real10y-history → fetchReal10YHistory → curl FRED DFII10 (Snapshot): Achse/Linie mit BTC-Props, Werte je Kurstag exakt aus FRED, sonst null");

  // ── 2b. M2SL-Ausfall entkoppelt (C); BTC-Ausgabe identisch zur PR-Basis ──
  const oldMacroFile = join(bin, "btc-macro-base.ts");
  writeFileSync(oldMacroFile, git("show", `${BASE}:server/btc-macro.ts`));
  const oldMacro = await import(oldMacroFile);
  const newMacro = await import("../server/btc-macro");
  const END = "2026-10-18";
  for (const sd of [start, "2015-01-02", "2024-10-18"]) assert.deepEqual(await newMacro.fetchBTCMacroHistory(sd, END), await oldMacro.fetchBTCMacroHistory(sd, END), `fetchBTCMacroHistory ${sd}`);
  const handler = (src: string) => /app\.get\("\/api\/analyze-btc\/macro-history"[\s\S]*?\n  \}\);\n/.exec(src)?.[0];
  assert.ok(handler(readFileSync("server/btc-routes.ts", "utf8")));
  assert.equal(handler(readFileSync("server/btc-routes.ts", "utf8")), handler(git("show", `${BASE}:server/btc-routes.ts`)), "BTC-Route macro-history wörtlich wie PR-Basis");
  for (const f of ["server/btc-macro.ts", "server/btc-routes.ts"]) assert.ok(ownDiffLines(f).every(l => l.startsWith("+")), `${f}: #267 nur Ergänzungen`);
  const m2Start = "2024-11-01"; // eigener Cache-Schlüssel
  const btcOk = await (await realFetch(base + macroHistoryPath(m2Start))).json();
  const r10Ok = await (await realFetch(base + real10yHistoryPath(m2Start))).json();
  assert.deepEqual(r10Ok, { real10yByDate: btcOk.real10yByDate, latestReal10y: btcOk.latestReal10y }, "real10y-history == Real10Y-Teil von macro-history");
  process.env.REAL10Y_FAKE_FRED = "m2fail";
  quiet();
  const m2Start2 = "2024-11-04";
  const btcM2 = await realFetch(base + macroHistoryPath(m2Start2));
  const r10M2 = await realFetch(base + real10yHistoryPath(m2Start2));
  loud();
  assert.equal(btcM2.status, 502, "BTC bei M2SL-Ausfall wie bisher 502"); assert.deepEqual(await btcM2.json(), { error: "FRED-Makrodaten nicht verfügbar" });
  await assert.rejects(oldMacro.fetchBTCMacroHistory(m2Start2, END), "auch der alte BTC-Code scheitert bei M2SL-Ausfall");
  assert.equal(r10M2.status, 200);
  const r10M2Body = await r10M2.json();
  // curl-Ersatz liefert den ganzen DFII10-Snapshot → erwartet exakt dessen Werte, keine Ersatzwerte.
  assert.deepEqual(r10M2Body, { real10yByDate: Object.fromEntries(real.map(p => [p.date, p.value])), latestReal10y: real[real.length - 1] }, "Real10Y trotz M2SL-Ausfall vollständig");
  {
    // UI: M2SL weg → Real10Y wird trotzdem gezeichnet (kein n/a)
    const data3 = { ...data, ticker: "MSFT3", ohlcvData: MSFT_OHLCV.filter(b => b.date >= "2024-11-05") };
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    quiet();
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TechnicalChart, { data: data3 }))); });
    loud();
    for (let i = 0; i < 100 && !findByTestId(c, "real10y-overlay-status") && !findByTestId(c, "real10y-overlay-empty"); i++) await settle();
    assert.ok(findByTestId(c, "real10y-overlay-status") && !findByTestId(c, "real10y-overlay-empty"), textOf(c).slice(-200));
    quiet(); await act(async () => { root.unmount(); }); loud();
  }
  delete process.env.REAL10Y_FAKE_FRED;
  ok("M2SL-Ausfall: Aktien-TA zeigt Real10Y weiter (real10y-history 200, UI-Status statt n/a); BTC macro-history wie bisher 502; fetchBTCMacroHistory alt == neu (3 Startdaten), Route macro-history wörtlich wie Basis, server/ nur Ergänzungen");

  // ── 3. n/a-Pfade ──
  process.env.REAL10Y_FAKE_FRED = "fail";
  quiet(); // erwartete Route-Fehlerlogs (console.error in btc-routes.ts) ausblenden
  const data2Start = "2024-10-18"; // anderer Cache-Schlüssel der Route (5-min-Cache je startDate)
  const data2 = { ...data, ticker: "MSFT2", ohlcvData: MSFT_OHLCV.filter(b => b.date >= data2Start) };
  const resp502 = await realFetch(base + real10yHistoryPath(data2Start));
  assert.equal(resp502.status, 502); assert.deepEqual(await resp502.json(), { error: "FRED DFII10 nicht verfügbar" });
  const btc502 = await realFetch(base + macroHistoryPath(data2Start));
  assert.equal(btc502.status, 502); assert.deepEqual(await btc502.json(), { error: "FRED-Makrodaten nicht verfügbar" });
  // UI mit scheiterndem FRED (neuer startDate → kein Cache-Treffer; Route-Cache je startDate)
  {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    quiet();
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TechnicalChart, { data: data2 }))); });
    loud();
    for (let i = 0; i < 100 && !findByTestId(c, "real10y-overlay-empty"); i++) await settle();
    assert.equal(textOf(findByTestId(c, "real10y-overlay-empty")), "Real10Y: n/a — FRED DFII10 nicht erreichbar.");
    assert.ok(!findByTestId(c, "real10y-overlay-status"));
    const rows = findFiber(fiberOf(findByTestId(c, "chart-price-ma")), f => Array.isArray(f.memoizedProps?.data) && f.memoizedProps.data.length > 0 && "close" in f.memoizedProps.data[0])?.memoizedProps.data as any[];
    assert.ok(rows && rows.every(r => !("_real10y" in r)), "keine Real10Y-Werte im Chart");
    assert.ok(findByTestId(c, "chart-price-ma") && !findFiber(fiberOf(findByTestId(c, "chart-price-ma")), f => f.memoizedProps?.yAxisId === "real10y" && f.memoizedProps?.orientation === "right"), "keine Real10Y-Achse");
    quiet(); await act(async () => { root.unmount(); }); loud();
  }
  delete process.env.REAL10Y_FAKE_FRED;
  loud();
  ok("FRED weg → Route 502 {error} → Hook-Fehler → „Real10Y: n/a — FRED DFII10 nicht erreichbar.“, keine Achse/Linie, keine Werte");

  htmlMode = true;
  {
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    quiet();
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TechnicalChart, { data }))); });
    loud();
    for (let i = 0; i < 100 && !findByTestId(c, "real10y-overlay-empty"); i++) await settle();
    assert.equal(textOf(findByTestId(c, "real10y-overlay-empty")), "Real10Y: n/a — FRED DFII10 nicht erreichbar.");
    quiet(); await act(async () => { root.unmount(); }); loud();
  }
  htmlMode = false;
  ok("Route fehlt (SPA-HTML → getQueryFn null) → n/a");

  const pts = [{ date: "2026-10-14" }, { date: "2026-10-15" }, { date: "2026-10-16" }];
  assert.equal(real10yOverlaySeries(pts, null), null);
  assert.equal(real10yOverlaySeries(pts, { real10yByDate: {} }), null);
  assert.deepEqual(real10yOverlaySeries(pts, { real10yByDate: { "2026-10-14": 2.84, "2026-10-15": 2.78 } }), [{ date: "2026-10-14", real10y: 2.84 }, { date: "2026-10-15", real10y: 2.78 }, { date: "2026-10-16", real10y: null }]);
  assert.deepEqual(real10yOverlaySeries(pts, { real10yByDate: { "2010-01-04": 1.4 } })!.map(p => p.real10y), [null, null, null]);
  const bars = [{ date: "2026-10-15", close: 1 }, { date: "2026-10-16", close: 2 }] as any[];
  assert.equal(withReal10YOverlay(bars, null), bars);
  assert.deepEqual(withReal10YOverlay(bars, [{ date: "2026-10-15", real10y: 2.78 }]).map(p => [p.close, p._real10y]), [[1, 2.78], [2, null]]);
  assert.equal(oldestOhlcvDate([]), null); assert.equal(oldestOhlcvDate(undefined), null);
  assert.equal(oldestOhlcvDate([{ date: "2025-01-02" }, { date: "2024-12-31" }, { date: "bad" }]), "2024-12-31");
  const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
  assert.ok(ui.includes('data-testid="real10y-overlay-empty">Real10Y: n/a — FRED-Historie deckt dieses Fenster nicht ab.'));
  ok("Join exakt je Datum wie BTC (fehlender FRED-Tag → null, Tooltip n/a); keine Antwort/leer → kein Overlay; Fenster ohne Treffer → „deckt dieses Fenster nicht ab“; keine Historie → kein Abruf");

  // #263-Chip und andere Overlays unverändert vorhanden
  for (const s of ['const [showT10y, setShowT10y] = useState(false);', 'data-testid="button-t10y" aria-pressed={showT10y}', 'const t10yQuery = useMarketTreasury10Y(showT10y);', 'const creditQuery = useMarketCreditSpread(showCredit);',
    'const [showReal10y, setShowReal10y] = useState(true);', 'useEffect(() => { setShowReal10y(true); }, [data.ticker]);', 'const real10yQuery = useMarketReal10Y(real10yStart, showReal10y);']) assert.ok(ui.includes(s), s);
  assert.equal((ui.match(/real10y=\{real10yOverlay\}/g) ?? []).length, 2, "nur Fenster A (Einzel + Band A), wie 10J-Treasury");
  assert.equal((ui.match(/t10y=\{t10yOverlay\}/g) ?? []).length, 2);
  ok("10J-Treasury (#263), Credit, Dividende unverändert verdrahtet; Real10Y daneben, Default AN (Philip 18.10.), Reset je Ticker auf AN, nur Fenster A");

  // ── 4. Score unverändert ──
  const { buildBiasDecision } = await import("../shared/bias-fixes");
  const { generateAnalysisHTML } = await import("../server/pdf-export");
  const changed = ownFiles;
  const scoreFiles = ["shared/bias-fixes.ts", "server/scoring-integration.ts", "server/pdf-export.ts", "server/analyze-route.ts", "client/src/components/sections/SummarySection.tsx", "shared/schema.ts"];
  // Server nur die zwei Ergänzungen aus (C) (btc-macro fetchReal10YHistory, btc-routes real10y-history), nichts in shared/.
  const serverAllowed = ["server/btc-macro.ts", "server/btc-routes.ts"];
  assert.ok(changed.every(f => !scoreFiles.includes(f) && !f.startsWith("shared/") && (!f.startsWith("server/") || serverAllowed.includes(f))), changed.join(","));
  for (const f of scoreFiles) assert.ok(!/real10y|DFII10|macro-history/i.test(readFileSync(f, "utf8")), f);
  const macro = await (await realFetch(base + real10yHistoryPath(start))).json();
  const before = buildBiasDecision(fixture);
  const after = buildBiasDecision({ ...fixture, ohlcvData: MSFT_OHLCV, real10y: macro } as any);
  const beforeOhlcv = buildBiasDecision({ ...fixture, ohlcvData: MSFT_OHLCV } as any);
  assert.deepEqual(after, beforeOhlcv);
  const verdict = (h: string) => /FAZIT: ([A-ZÄÖÜ ]+)</.exec(h)?.[1] ?? "n/a";
  const h0 = await generateAnalysisHTML(fixture); const h1 = await generateAnalysisHTML({ ...fixture, real10y: macro });
  assert.equal(verdict(h1), verdict(h0)); assert.ok(!h1.includes("DFII10"));
  console.log(`     MSFT (Fixture): Score ${before.overallScore.toFixed(4)} ${before.overallRating}; mit Real10Y-Daten ${after.overallScore.toFixed(4)} ${after.overallRating} (== ohne: ${beforeOhlcv.overallScore.toFixed(4)}); PDF-Fazit ${verdict(h0)} = ${verdict(h1)}`);
  console.log(`     eigener Anteil ggü. ${DIFF_BASE.slice(0, 8)}${SQUASH_267 ? ` (Squash-Commit ${SQUASH_267.slice(0, 8)})` : ""}: ${changed.join(", ")}`);
  ok("Keine shared/- oder Score-Datei geändert, server/ nur btc-macro/btc-routes-Ergänzung; Score/Rating deepEqual, PDF-Fazit identisch");

  server.close();
  console.log(`\n${n} Checks grün`);
  process.exit(0);
}
main().catch(e => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
