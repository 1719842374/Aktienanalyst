/**
 * Future_7 §6 und Future_8: z-Score und Perzentil als Zusatzobjekt, Backtest an
 * Dotcom (2000/2001), GFC (2008) und 2021/22. Der Live-Score bleibt.
 *
 * Ausführen (Repo-Root):
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-adaptive-crashes.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { installFakeDom, findByTestId, type FakeNode } from "./lib/fake-dom";
import {
  RECESSION_ADAPTIVE_PARAMS,
  adaptiveColumnCount,
  adaptiveNaText,
  adaptiveReadingAt,
  buildRecessionAdaptiveReport,
  calculateAdaptiveScore,
  percentileScore,
  zScoreToScore,
  type AdaptivePoint,
  type RecessionAdaptiveResponse,
} from "../shared/recession-adaptive";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

function textOf(nd: FakeNode | null): string {
  if (!nd) return "";
  return nd.childNodes.map(c => ("nodeValue" in c && typeof (c as { nodeValue?: string }).nodeValue === "string" && c.childNodes.length === 0)
    ? String((c as { nodeValue: string }).nodeValue)
    : textOf(c)).join("");
}

function loadPoints(name: string): AdaptivePoint[] {
  const body = JSON.parse(readFileSync(new URL(`./fixtures/recession-adaptive/${name}`, import.meta.url), "utf8"));
  return body.points;
}

function must<T extends { available: true }>(reading: { available: boolean }, label: string): T {
  assert.equal(reading.available, true, label);
  return reading as T;
}

async function main() {
  assert.equal(zScoreToScore(5), RECESSION_ADAPTIVE_PARAMS.zCap * RECESSION_ADAPTIVE_PARAMS.zScale);
  assert.equal(zScoreToScore(-5), -RECESSION_ADAPTIVE_PARAMS.zCap * RECESSION_ADAPTIVE_PARAMS.zScale);
  assert.equal(zScoreToScore(2), 3);
  assert.equal(zScoreToScore(Number.NaN), null);
  ok("zScoreToScore begrenzt ±4 und skaliert mit 1,5; kein z → null");

  assert.equal(percentileScore(90.1), 4);
  assert.equal(percentileScore(90), 2);
  assert.equal(percentileScore(75.1), 2);
  assert.equal(percentileScore(75), 0);
  assert.equal(percentileScore(25), 0);
  assert.equal(percentileScore(24.9), -2);
  assert.equal(percentileScore(10), -2);
  assert.equal(percentileScore(9.9), -4);
  ok("Perzentil-Bänder strikt wie Future_8; 0 ist das mittlere Band");

  assert.equal(calculateAdaptiveScore(1, Array(RECESSION_ADAPTIVE_PARAMS.minObservations - 1).fill(1)), null);
  assert.equal(calculateAdaptiveScore(1, Array(RECESSION_ADAPTIVE_PARAMS.minObservations).fill(1)), null);
  const ramp = Array.from({ length: 60 }, (_, i) => i);
  const scaled = calculateAdaptiveScore(59, ramp);
  assert.ok(scaled != null && scaled > 0);
  ok("unter 60 Beobachtungen oder ohne Streuung → null, nie 0");

  assert.equal(adaptiveColumnCount(375), 1);
  assert.equal(adaptiveColumnCount(639), 1);
  assert.equal(adaptiveColumnCount(640), 2);
  assert.equal(adaptiveColumnCount(1440), 2);
  ok("375 px eine Spalte, 1440 px zwei Spalten");

  const short = adaptiveReadingAt(
    Array.from({ length: 12 }, (_, i) => ({ date: `2020-${String(i + 1).padStart(2, "0")}-01`, value: i + 1 })),
    "2020-12-31",
    20,
  );
  assert.equal(short.available, false);
  if (!short.available) {
    assert.match(adaptiveNaText(short.reason), /^n\/a — zu wenig Historie \(12 Beobachtungen/);
    assert.equal("percentileScore" in short, false);
  }
  ok("zu wenig Historie → n/a — Grund, kein Score-Feld");

  const buffett = loadPoints("buffett-financial-accounts.json");
  const cape = loadPoints("cape-multpl.json");
  const yearsB = RECESSION_ADAPTIVE_PARAMS.buffettWindowYears;
  const yearsC = RECESSION_ADAPTIVE_PARAMS.capeWindowYears;

  const crashes: Array<{ id: string; asOf: string; series: AdaptivePoint[]; years: number }> = [
    { id: "Buffett 2001-09", asOf: "2001-09-30", series: buffett, years: yearsB },
    { id: "Buffett 2008-09", asOf: "2008-09-30", series: buffett, years: yearsB },
    { id: "Buffett 2021-12", asOf: "2021-12-31", series: buffett, years: yearsB },
    { id: "Buffett 2022-10", asOf: "2022-10-31", series: buffett, years: yearsB },
    { id: "CAPE 2000-03", asOf: "2000-03-31", series: cape, years: yearsC },
    { id: "CAPE 2008-09", asOf: "2008-09-30", series: cape, years: yearsC },
    { id: "CAPE 2021-12", asOf: "2021-12-31", series: cape, years: yearsC },
    { id: "CAPE 2022-10", asOf: "2022-10-31", series: cape, years: yearsC },
  ];
  console.log("  Backtest (Financial Accounts 20J, CAPE 25J):");
  for (const crash of crashes) {
    const reading = must(adaptiveReadingAt(crash.series, crash.asOf, crash.years), crash.id);
    console.log(`    ${crash.id}: Wert ${reading.value.toFixed(1)} Stand ${reading.asOf} z ${reading.z.toFixed(2)} Perzentil ${reading.percentile.toFixed(1)} Score ${reading.percentileScore} n=${reading.observations}`);
  }

  const b2001 = must(adaptiveReadingAt(buffett, "2001-09-30", yearsB), "b2001");
  const b2008 = must(adaptiveReadingAt(buffett, "2008-09-30", yearsB), "b2008");
  const b2021 = must(adaptiveReadingAt(buffett, "2021-12-31", yearsB), "b2021");
  const b2022 = must(adaptiveReadingAt(buffett, "2022-10-31", yearsB), "b2022");
  assert.equal(b2001.observations, 80);
  assert.equal(b2001.percentileScore, 2);
  assert.equal(b2008.percentileScore, 0);
  assert.ok(Math.abs(b2008.z) < 0.2, String(b2008.z));
  assert.equal(b2021.percentileScore, 4);
  assert.equal(b2022.percentileScore, 2);
  assert.ok(b2022.percentile > RECESSION_ADAPTIVE_PARAMS.percentileElevated);
  ok("Buffett 2001 mittel, 2008 neutral, 2021 oberes Band, Okt 2022 noch erhöht");

  const c2000 = must(adaptiveReadingAt(cape, "2000-03-31", yearsC), "c2000");
  const c2008 = must(adaptiveReadingAt(cape, "2008-09-30", yearsC), "c2008");
  const c2021 = must(adaptiveReadingAt(cape, "2021-12-31", yearsC), "c2021");
  const c2022 = must(adaptiveReadingAt(cape, "2022-10-31", yearsC), "c2022");
  assert.equal(c2000.observations, 300);
  assert.equal(c2000.percentileScore, 4);
  assert.ok(c2000.z > 2);
  assert.equal(c2008.percentileScore, 0);
  assert.ok(c2008.z < 0 && c2008.z > -1);
  assert.equal(c2021.percentileScore, 4);
  assert.equal(c2022.percentileScore, 0);
  const cape2008y20 = must(adaptiveReadingAt(cape, "2008-09-30", 20), "cape20");
  const cape2008y30 = must(adaptiveReadingAt(cape, "2008-09-30", 30), "cape30");
  assert.equal(cape2008y20.percentileScore, -2);
  assert.equal(cape2008y30.percentileScore, 0);
  ok("CAPE 2000 und 2021 oberes Band, 2008 und Okt 2022 mittleres Band; 20J-Fenster 2008 wäre niedrig");

  const { buffettReading, capeReading, vixReading } = await import("../server/recession");
  assert.equal(buffettReading(b2008.value).rawScore, -4);
  assert.equal(buffettReading(b2008.value).weightedScore, -8);
  assert.equal(capeReading(c2000.value).rawScore, 7);
  assert.equal(capeReading(c2008.value).rawScore, 0);
  assert.equal(vixReading(35).rawScore, 4);
  assert.equal(vixReading(16).rawScore, 0);
  ok("feste Zonen unverändert: Buffett 2008 weiter −8 gewichtet, CAPE 2000 +7 Roh, VIX >30 bleibt +4");

  const report = buildRecessionAdaptiveReport({
    cape: { points: [], reason: "Multpl nicht erreichbar oder leer" },
    buffett: { points: buffett, reason: null },
  });
  assert.equal(report.affectsScore, false);
  assert.equal(report.indicators.every(item => item.inLiveScore === false), true);
  const capeSlot = report.indicators.find(item => item.id === "cape");
  assert.ok(capeSlot?.reading && capeSlot.reading.available === false);
  if (capeSlot?.reading && !capeSlot.reading.available) {
    assert.match(adaptiveNaText(capeSlot.reading.reason), /^n\/a — Multpl/);
  }
  const vix = report.indicators.find(item => item.id === "vix");
  const sahm = report.indicators.find(item => item.id === "sahm");
  assert.equal(vix?.role, "fest");
  assert.equal(vix?.reading, null);
  assert.equal(sahm?.role, "fest");
  assert.match(vix?.fixedNote ?? "", /Zonen bleiben/);
  ok("Zusatzobjekt affectsScore false; VIX und Sahm fest ohne Zahl; CAPE-Ausfall n/a");

  const routeMod = await import("../server/recession-adaptive-route");
  const express = (await import("express")).default;
  let calls = 0;
  const synthetic: AdaptivePoint[] = Array.from({ length: 80 }, (_, i) => ({
    date: `${1980 + Math.floor(i / 4)}-${String((i % 4) * 3 + 1).padStart(2, "0")}-01`,
    value: 10 + i,
  }));
  const loadOk = async () => {
    calls += 1;
    return { points: synthetic, reason: null };
  };
  const loadDown = async () => {
    calls += 1;
    return { points: [] as AdaptivePoint[], reason: "FRED nicht erreichbar (GDP)" };
  };
  routeMod.resetRecessionAdaptiveCache();
  const live = await routeMod.getRecessionAdaptive({ loadCape: loadOk, loadBuffett: loadOk, now: () => 1 });
  assert.equal(live.adaptiv.affectsScore, false);
  assert.equal(live.adaptiv.indicators.filter(item => item.role === "adaptiv" && item.reading?.available).length, 2);
  const again = await routeMod.getRecessionAdaptive({ loadCape: loadOk, loadBuffett: loadOk, now: () => 2 });
  assert.equal(calls, 4, "Test-Loader umgehen den Cache");
  assert.equal(again.adaptiv.affectsScore, false);
  ok("Handler baut das adaptiv-Objekt aus den Reihen, ohne es zu cachen wenn Loader injiziert sind");

  const app = express();
  let mode: "ok" | "down" = "ok";
  routeMod.registerRecessionAdaptiveRoute(app, {
    loadCape: () => (mode === "ok" ? loadOk() : loadDown()),
    loadBuffett: () => (mode === "ok" ? loadOk() : loadDown()),
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;
  mode = "down";
  const httpDown = await realFetch(`${base}/api/analyze-recession/adaptive`);
  const bodyDown = await httpDown.json() as RecessionAdaptiveResponse;
  assert.equal(httpDown.status, 200);
  const downCape = bodyDown.adaptiv.indicators.find(item => item.id === "cape");
  assert.ok(downCape?.reading && downCape.reading.available === false);
  if (downCape?.reading && !downCape.reading.available) {
    assert.match(downCape.reading.reason, /FRED nicht erreichbar/);
    assert.equal(JSON.stringify(downCape.reading).includes("\"percentileScore\":0"), false);
  }
  ok("GET bei Quellenausfall 200, Grund im Body, kein Perzentil-Score 0");

  const routesSrc = readFileSync("server/routes.ts", "utf8");
  assert.equal((routesSrc.match(/registerRecessionAdaptiveRoute\(app\)/g) ?? []).length, 1);
  const glued = [
    "server/recession-adaptive-route.ts",
    "shared/recession-adaptive.ts",
    "client/src/hooks/useRecessionAdaptive.ts",
    "client/src/components/recession/RecessionAdaptiveCard.tsx",
  ].map(path => readFileSync(path, "utf8")).join("\n");
  assert.equal(/analyze-route|overallScore|probabilityFromNet|buffettReading\(/.test(glued), false);
  const hookSrc = readFileSync("client/src/hooks/useRecessionAdaptive.ts", "utf8");
  assert.equal(/queryFn\s*:/.test(hookSrc), false);
  assert.match(hookSrc, /\/api\/analyze-recession\/adaptive/);
  const page = readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8");
  assert.match(page, /RecessionAdaptiveCard/);
  ok("Kette routes.ts → Hook ohne eigene queryFn → Karte; kein Score-Pfad");

  const head = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
  assert.equal(round6(head.VWAGY.overallScore), 4.735718);
  assert.equal(round6(head.SAP.overallScore), 5.174758);
  assert.equal(round6(head.MSFT.overallScore), 4.058138);
  ok("Score-Beleg unverändert: VOW3 4.735718 / SAP 5.174758 / MSFT 4.058138");

  const { doc, win } = installFakeDom({ hash: "#/recession" });
  mode = "ok";
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/analyze-recession/adaptive") return realFetch(base + url, init);
    throw new Error(`unerwarteter Abruf ${url}`);
  };
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { getQueryFn } = await import("../client/src/lib/queryClient");
  const { RecessionAdaptiveCard } = await import("../client/src/components/recession/RecessionAdaptiveCard");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const origErr = console.error;
  const quiet = () => { console.error = () => {}; };
  const loud = () => { console.error = origErr; };

  async function mount(width: number) {
    win.innerWidth = width;
    (globalThis as any).innerWidth = width;
    const c = doc.createElement("div");
    c.clientWidth = width;
    doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
    quiet();
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(RecessionAdaptiveCard)));
    });
    for (let i = 0; i < 50 && !textOf(findByTestId(c, "adaptive-card-buffett")).includes("Perzentil"); i++) {
      await act(async () => { await new Promise(res => setTimeout(res, 20)); });
    }
    loud();
    return { c, done: async () => { quiet(); await act(async () => { root.unmount(); qc.clear(); }); loud(); c.parentNode?.removeChild(c); } };
  }

  for (const width of [375, 1440]) {
    const mounted = await mount(width);
    const grid = findByTestId(mounted.c, "adaptive-grid");
    assert.ok(grid, `grid bei ${width}`);
    assert.match(grid!.attributes.class ?? "", /grid-cols-1/);
    assert.match(grid!.attributes.class ?? "", /sm:grid-cols-2/);
    assert.equal(adaptiveColumnCount(width), width === 375 ? 1 : 2);
    const card = textOf(findByTestId(mounted.c, "recession-adaptive"));
    assert.match(card, /kein Score/);
    assert.match(card, /nicht in Netto/);
    assert.match(textOf(findByTestId(mounted.c, "adaptive-fixed-vix")), /^fest — /);
    assert.match(textOf(findByTestId(mounted.c, "adaptive-fixed-sahm")), /^fest — /);
    assert.doesNotMatch(textOf(findByTestId(mounted.c, "adaptive-fixed-vix")), /\b0\b/);
    await mounted.done();
    ok(`UI bei ${width} px: Karte, fest-Zeilen ohne 0, Raster ${adaptiveColumnCount(width)} Spalten`);
  }

  mode = "down";
  const failed = await mount(375);
  const capeText = textOf(findByTestId(failed.c, "adaptive-card-cape"));
  assert.match(capeText, /n\/a — FRED nicht erreichbar/);
  assert.doesNotMatch(capeText, /Perzentil-Score 0/);
  await failed.done();
  ok("UI Quellenausfall: n/a — Grund, kein Score 0");

  (globalThis as any).fetch = async () => new Response("<html>502</html>", { status: 502, headers: { "content-type": "text/html" } });
  const gateway = await mount(1440);
  const errText = textOf(findByTestId(gateway.c, "adaptive-error"));
  assert.match(errText, /n\/a — Datenquelle nicht erreichbar \(HTTP 502\)/);
  assert.doesNotMatch(errText, /<html/);
  await gateway.done();
  ok("UI HTTP 502: nur der Status, kein HTML-Body");

  (globalThis as any).fetch = realFetch;
  server.close();
  console.log(`\n${n} Prüfungen bestanden`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
