/**
 * F1-39 Route + UI: Dollar-Anteil an Weltreserven (IMF COFER) auf dem Rezessions-Dashboard
 * (Future_1_Work.md Z.461, Buffett-Indikator). Nur Anzeige, kein Score.
 *
 * Kette: DollarReserveShareCard → useQuery (client/src/lib/queryClient.ts) →
 * GET /api/macro/dollar-reserve-share → server/dollar-reserve-share-route.ts →
 * fetchDollarReserveShare → IMF COFER.
 *
 * Ausführen (Repo-Root):
 *   OFFLINE=1 npx tsx --tsconfig script/tsconfig.jsx.json script/test-dollar-reserve-share-route-ui.ts
 * Ohne OFFLINE zusätzlich der Live-Lauf gegen IMF.
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { installFakeDom, findByTestId, type FakeNode } from "./lib/fake-dom";
import { COFER_MIN_QUARTERS, dollarReserveShareReading, parseCoferUsdShare, type QuarterPoint } from "../shared/dollar-reserve-share";

(globalThis as any).React = React;
let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const q = (start: number, vals: number[]): QuarterPoint[] =>
  vals.map((value, i) => ({ period: `${start + Math.floor(i / 4)}-Q${(i % 4) + 1}`, value }));

function textOf(nd: FakeNode | null): string {
  if (!nd) return "";
  return nd.childNodes.map(c => ("nodeValue" in c && typeof (c as { nodeValue?: string }).nodeValue === "string" && c.childNodes.length === 0)
    ? String((c as { nodeValue: string }).nodeValue)
    : textOf(c)).join("");
}

async function main() {
  const shared = await import("../shared/dollar-reserve-share");
  const { dollarReserveShareTrend, DOLLAR_RESERVE_SHARE_PARAMS, DOLLAR_RESERVE_TREND_ARROW, DOLLAR_RESERVE_TREND_LABEL } = shared;

  // Gleicher Schritt jede Quartalsänderung → auf dem Median, kein Alarm, Perzentil der Mitte.
  {
    const r = dollarReserveShareTrend(q(2020, Array.from({ length: 8 }, (_, i) => 60 - i * 0.25)));
    assert.ok(r.trend);
    assert.equal(r.reason, null);
    assert.ok(Math.abs(r.trend.latestChangePp - -0.25) < 1e-9);
    assert.ok(Math.abs(r.trend.medianChangePp - -0.25) < 1e-9);
    assert.ok(Math.abs(r.trend.percentile - 50) < 1e-9);
    assert.equal(r.trend.zScore, null);
    assert.equal(r.trend.direction, "flat");
    assert.equal(r.trend.changes, 7);
    ok("konstante Quartalsänderung → flat, Perzentil 50, z n/a");
  }
  // Letzte Änderung unter dem Median der Historie → Pfeil abwärts, kleines Perzentil.
  {
    const r = dollarReserveShareTrend(q(2020, [58, 58, 58, 58, 58, 58, 58, 50]));
    assert.ok(r.trend);
    assert.equal(r.trend.direction, "down");
    assert.ok(Math.abs(r.trend.latestChangePp - -8) < 1e-9);
    assert.ok(Math.abs(r.trend.medianChangePp - 0) < 1e-9);
    assert.ok(Math.abs(r.trend.percentile - (0.5 / 7) * 100) < 1e-9);
    assert.ok(r.trend.zScore != null && r.trend.zScore < 0);
    ok("Ausreißer nach unten → down, Perzentil aus der Historie");
  }
  // Letzte Änderung über dem Median → Pfeil aufwärts.
  {
    const r = dollarReserveShareTrend(q(2020, [58, 58, 58, 58, 58, 58, 58, 70]));
    assert.ok(r.trend);
    assert.equal(r.trend.direction, "up");
    assert.ok(Math.abs(r.trend.percentile - ((6 + 0.5) / 7) * 100) < 1e-9);
    ok("Ausreißer nach oben → up");
  }
  // z-Score gegen die volle Historie (Population), Jahreswechsel zählt als Folgequartal.
  {
    const r = dollarReserveShareTrend([
      { period: "2024-Q4", value: 10 },
      { period: "2025-Q1", value: 9 },
      { period: "2025-Q2", value: 9 },
      { period: "2025-Q3", value: 10 },
    ]);
    assert.ok(r.trend);
    assert.equal(r.trend.previousPeriod, "2025-Q2");
    assert.ok(Math.abs(r.trend.latestChangePp - 1) < 1e-9);
    assert.ok(Math.abs(r.trend.zScore! - 1 / Math.sqrt(2 / 3)) < 1e-9);
    assert.equal(r.trend.direction, "up");
    ok("z-Score Population, Q4→Q1 ist ein Folgequartal");
  }
  // Lücke ist keine Quartalsänderung. Zwei gleiche Schritte bleiben flat.
  {
    const r = dollarReserveShareTrend([
      { period: "2024-Q1", value: 60 },
      { period: "2024-Q2", value: 59 },
      { period: "2024-Q4", value: 50 },
      { period: "2025-Q1", value: 49 },
    ]);
    assert.ok(r.trend);
    assert.equal(r.trend.changes, 2);
    assert.equal(r.trend.direction, "flat");
    assert.ok(Math.abs(r.trend.latestChangePp - -1) < 1e-9);
    ok("fehlendes Quartal zählt nicht als Änderung");
  }
  {
    const r = dollarReserveShareTrend([
      { period: "2020-Q1", value: 60 },
      { period: "2021-Q1", value: 55 },
    ]);
    assert.equal(r.trend, null);
    assert.ok(r.reason && /aufeinanderfolgende/i.test(r.reason));
    ok("keine Folgequartale → Trend n/a mit Grund");
  }
  {
    const r = dollarReserveShareTrend([]);
    assert.equal(r.trend, null);
    assert.ok(r.reason);
    ok("leere Reihe → Trend n/a");
  }
  // Unsortierte Eingabe.
  {
    const r = dollarReserveShareTrend([
      { period: "2025-Q2", value: 50 },
      { period: "2025-Q1", value: 58 },
      { period: "2024-Q4", value: 58 },
    ]);
    assert.ok(r.trend && r.trend.direction === "down" && Math.abs(r.trend.latestChangePp - -8) < 1e-9);
    ok("Trend sortiert die Quartale selbst");
  }
  // Fixture: echte IMF-Antwort, Trend liegt in der Historie (kein fester Alarmwert).
  {
    const xml = readFileSync(new URL("./fixtures/imf-cofer-usd-2026-10-25.xml", import.meta.url), "utf8");
    const series = parseCoferUsdShare(xml);
    const reading = dollarReserveShareReading(series);
    assert.ok(reading.available);
    const r = dollarReserveShareTrend(series);
    assert.ok(r.trend);
    assert.ok(r.trend.percentile >= 0 && r.trend.percentile <= 100);
    assert.ok(r.trend.changes >= COFER_MIN_QUARTERS - 1);
    assert.equal(DOLLAR_RESERVE_TREND_ARROW[r.trend.direction].length > 0, true);
    assert.ok(DOLLAR_RESERVE_TREND_LABEL[r.trend.direction].length > 0);
    ok(`Fixture-Trend: ${r.trend.direction} Perzentil ${r.trend.percentile.toFixed(1)} (${r.trend.changes} Änderungen)`);
  }
  assert.ok(DOLLAR_RESERVE_SHARE_PARAMS.cacheTtlMs > 0);
  assert.equal(typeof DOLLAR_RESERVE_SHARE_PARAMS.displayDecimals, "number");
  const paramsSrc = readFileSync("shared/dollar-reserve-share.ts", "utf8");
  assert.ok(/Philip/.test(paramsSrc) && /Quartal/.test(paramsSrc), "PARAMS-Kommentar nennt Herkunft und Quartalsrhythmus");
  ok("PARAMS exportiert, Kommentar zur Herkunft vorhanden");

  // ── Route ──
  const routeMod = await import("../server/dollar-reserve-share-route");
  const express = (await import("express")).default;
  let calls = 0;
  let mode: "ok" | "down" | "throw" = "ok";
  const sample = dollarReserveShareReading(q(2020, [58, 58, 58, 58, 58, 58, 58, 50]));
  assert.ok(sample.available);
  const load = async () => {
    calls++;
    if (mode === "throw") throw new Error("socket hang up");
    if (mode === "down" || !sample.available) {
      return { source: "IMF COFER" as const, available: false as const, reason: "IMF COFER: nicht erreichbar", trend: null, trendReason: null };
    }
    const trend = dollarReserveShareTrend(sample.series);
    return {
      source: "IMF COFER" as const,
      available: true as const,
      latestPeriod: sample.latestPeriod,
      latestPct: sample.latestPct,
      quarters: sample.quarters,
      trend: trend.trend,
      trendReason: trend.reason,
    };
  };

  const t0 = 1_700_000_000_000;
  routeMod.resetDollarReserveShareCache();
  calls = 0;
  mode = "ok";
  const a = await routeMod.getDollarReserveShare({ now: t0, load });
  const b = await routeMod.getDollarReserveShare({ now: t0 + DOLLAR_RESERVE_SHARE_PARAMS.cacheTtlMs - 1, load });
  assert.equal(calls, 1);
  assert.equal(a.available && b.available && a.latestPct, sample.latestPct);
  const c = await routeMod.getDollarReserveShare({ now: t0 + DOLLAR_RESERVE_SHARE_PARAMS.cacheTtlMs, load });
  assert.equal(calls, 2);
  assert.ok(c.available && c.trend && c.trend.direction === "down");
  ok("Cache nutzt DOLLAR_RESERVE_SHARE_PARAMS.cacheTtlMs");

  routeMod.resetDollarReserveShareCache();
  calls = 0;
  mode = "down";
  const d1 = await routeMod.getDollarReserveShare({ now: t0, load });
  const d2 = await routeMod.getDollarReserveShare({ now: t0 + 1, load });
  assert.equal(d1.available, false);
  assert.equal(d1.reason, "IMF COFER: nicht erreichbar");
  assert.ok(!("latestPct" in d1) || d1.latestPct == null);
  assert.equal(calls, 2, "Fehler wird nicht gecacht");
  assert.equal(d2.available, false);
  ok("nicht erreichbar → available false, kein Prozentwert, kein Cache");

  const app = express();
  routeMod.registerDollarReserveShareRoute(app, { load });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(r => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const realFetch = globalThis.fetch;

  routeMod.resetDollarReserveShareCache();
  calls = 0;
  mode = "ok";
  const http1 = await realFetch(`${base}/api/macro/dollar-reserve-share`);
  const body1 = await http1.json() as any;
  assert.equal(http1.status, 200);
  assert.equal(body1.latestPeriod, "2021-Q4");
  assert.equal(body1.latestPct, 50);
  assert.equal(body1.trend.direction, "down");
  await realFetch(`${base}/api/macro/dollar-reserve-share`);
  assert.equal(calls, 1, "HTTP-Treffer liegen im Cache");
  ok("GET /api/macro/dollar-reserve-share liefert Wert, Datum, Trend");

  routeMod.resetDollarReserveShareCache();
  mode = "throw";
  calls = 0;
  const httpErr = await realFetch(`${base}/api/macro/dollar-reserve-share`);
  const bodyErr = await httpErr.json() as any;
  assert.equal(httpErr.status, 200);
  assert.equal(bodyErr.available, false);
  assert.ok(/socket hang up/.test(bodyErr.reason));
  assert.ok(bodyErr.latestPct == null);
  assert.notEqual(bodyErr.latestPct, 0);
  ok("Handler-Fehler → 200, Grund sichtbar, nie 0");

  const routesSrc = readFileSync("server/routes.ts", "utf8");
  const hits = routesSrc.match(/registerDollarReserveShareRoute\(app\)/g) ?? [];
  assert.equal(hits.length, 1, "routes.ts hängt die Route in genau einer Zeile an");
  const routeSrc = readFileSync("server/dollar-reserve-share-route.ts", "utf8");
  assert.ok(routeSrc.includes('"/api/macro/dollar-reserve-share"'));
  assert.ok(routeSrc.includes("fetchDollarReserveShare"));
  assert.ok(routeSrc.includes("DOLLAR_RESERVE_SHARE_PARAMS.cacheTtlMs"));
  ok("Datenkette Route → fetchDollarReserveShare, eine Zeile in routes.ts");

  // ── UI ──
  const { doc } = installFakeDom();
  (globalThis as any).fetch = async (input: any, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/macro/dollar-reserve-share") return realFetch(base + url, init);
    throw new Error(`unerwarteter Abruf ${url}`);
  };
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { getQueryFn } = await import("../client/src/lib/queryClient");
  const { DollarReserveShareCard } = await import("../client/src/components/recession/DollarReserveShareCard");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;
  const origErr = console.error;
  const quiet = () => { console.error = () => {}; };
  const loud = () => { console.error = origErr; };
  async function mount(until: (c: FakeNode) => boolean) {
    const c = doc.createElement("div");
    doc.body.appendChild(c);
    const root = createRoot(c as any);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
    quiet();
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(DollarReserveShareCard))); });
    for (let i = 0; i < 200 && !until(c); i++) await act(async () => { await new Promise(res => setTimeout(res, 20)); });
    loud();
    return { c, done: async () => { quiet(); await act(async () => { root.unmount(); qc.clear(); }); loud(); } };
  }

  routeMod.resetDollarReserveShareCache();
  mode = "ok";
  let m = await mount(c => textOf(findByTestId(c, "text-dollar-reserve-share-value")).includes("%"));
  const value = textOf(findByTestId(m.c, "text-dollar-reserve-share-value"));
  const period = textOf(findByTestId(m.c, "text-dollar-reserve-share-period"));
  const trend = textOf(findByTestId(m.c, "text-dollar-reserve-share-trend"));
  const digits = DOLLAR_RESERVE_SHARE_PARAMS.displayDecimals;
  assert.equal(value, `${(50).toFixed(digits).replace(".", ",")} %`);
  assert.ok(period.includes("2021-Q4"), period);
  assert.ok(trend.includes(DOLLAR_RESERVE_TREND_ARROW.down), trend);
  assert.ok(trend.includes(DOLLAR_RESERVE_TREND_LABEL.down), trend);
  assert.ok(textOf(findByTestId(m.c, "card-dollar-reserve-share")).includes("kein Score"));
  await m.done();
  ok(`UI: ${value}, ${period.trim()}, Trend ${trend.trim()}`);

  routeMod.resetDollarReserveShareCache();
  mode = "down";
  m = await mount(c => /n\/a/.test(textOf(findByTestId(c, "card-dollar-reserve-share"))));
  const na = textOf(findByTestId(m.c, "text-dollar-reserve-share-error"));
  assert.ok(na.includes("n/a") && na.includes("nicht erreichbar"), na);
  assert.ok(!/\d,\d+\s*%/.test(na), na);
  assert.equal(findByTestId(m.c, "text-dollar-reserve-share-value"), null);
  await m.done();
  ok("UI Fehler: n/a mit Grund, kein Prozentwert");

  const page = readFileSync("client/src/pages/RecessionDashboard.tsx", "utf8");
  assert.ok(page.includes("DollarReserveShareCard"), "Karte hängt am Rezessions-Dashboard (Z.461 Buffett)");
  const cardSrc = readFileSync("client/src/components/recession/DollarReserveShareCard.tsx", "utf8");
  assert.ok(cardSrc.includes('"/api/macro/dollar-reserve-share"'));
  assert.ok(/useQuery/.test(cardSrc) && !/queryFn\s*:/.test(cardSrc), "useQuery über den Default-Fetcher von queryClient");
  ok("Zielseite bindet die Karte ein, Fetch läuft über queryClient");

  // Score-Basis (VOW3 = VWAGY). Die Route darf diese Pfade nicht anfassen.
  const head = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  assert.equal(round6(head.VWAGY.overallScore), 4.735718);
  assert.equal(round6(head.SAP.overallScore), 5.174758);
  assert.equal(round6(head.MSFT.overallScore), 4.058138);
  const glued = [
    readFileSync("server/dollar-reserve-share-route.ts", "utf8"),
    readFileSync("shared/dollar-reserve-share.ts", "utf8"),
    readFileSync("client/src/components/recession/DollarReserveShareCard.tsx", "utf8"),
  ].join("\n");
  assert.ok(!/analyze-route|computeThesisStrength|overallScore|finalScore/.test(glued));
  ok("kein Score-Effekt: VOW3 4.735718 / SAP 5.174758 / MSFT 4.058138, Modul ohne Score-Pfad");

  (globalThis as any).fetch = realFetch;
  server.close();

  if (process.env.OFFLINE !== "1") {
    routeMod.resetDollarReserveShareCache();
    const { fetchDollarReserveShare } = await import("../server/dollar-reserve-share");
    const live = await routeMod.loadDollarReserveShare({ fetchShare: fetchDollarReserveShare });
    if (live.available) {
      assert.ok(live.latestPct > 0 && live.latestPct < 100, String(live.latestPct));
      assert.ok(live.latestPeriod);
      assert.ok(live.trend, "Live-Reihe hat einen Trend");
      console.log(`  Live: ${live.latestPeriod} ${live.latestPct.toFixed(2)} % ${live.trend ? DOLLAR_RESERVE_TREND_ARROW[live.trend.direction] : ""}`);
    } else {
      assert.ok(live.reason && live.reason.length > 0);
      assert.ok(live.latestPct == null);
      console.log(`  Live IMF nicht erreichbar: ${live.reason}`);
    }
    ok("Live-Lauf: Wert oder sichtbarer Grund, nie 0");
  }

  console.log(`\n${n} Checks grün`);
}

main().catch(e => { console.error(e); process.exit(1); });
