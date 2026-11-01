/**
 * F9-04 — Lager/Nachfrage-Lücke: Fixtures + Live-Lauf mit echten FRED-Werten.
 * Ausführen: npx tsx script/test-inventory-demand-gap.ts   (OFFLINE=1 überspringt den Live-Teil)
 */
import assert from "node:assert/strict";
import { computeInventoryDemandGap, isratioReading, orderShipmentGapReading, type SeriesPoint } from "../shared/inventory-demand-gap";
import { fetchInventoryDemandGap } from "../server/inventory-demand-gap";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const monthly = (start: string, vals: number[]): SeriesPoint[] => {
  const [y0, m0] = start.split("-").map(Number);
  return vals.map((value, i) => {
    const t = (m0 - 1) + i, y = y0 + Math.floor(t / 12), m = (t % 12) + 1;
    return { date: `${y}-${String(m).padStart(2, "0")}-01`, value };
  });
};

// ISRATIO: 120 Monate alternierend 1.3/1.4, letzter 1.6 → positiver z, Median 1.35
{
  const vals = Array.from({ length: 119 }, (_, i) => (i % 2 ? 1.4 : 1.3)).concat([1.6]);
  const r = isratioReading(monthly("2015-01", vals));
  assert.equal(r.available, true);
  if (r.available) {
    assert.equal(r.months, 120); assert.ok(Math.abs(r.median10y - 1.35) < 1e-9);
    assert.ok(r.z > 3); assert.ok(Math.abs(r.deviationFromMedian - 0.25) < 1e-9);
  }
  ok("ISRATIO z-Wert/Median über 10J-Fenster");
}
// Fenster begrenzt: ältere Werte außerhalb 10J zählen nicht
{
  const r = isratioReading(monthly("2000-01", Array.from({ length: 300 }, (_, i) => 1 + (i % 3) * 0.1)));
  assert.ok(r.available && r.months === 120);
  ok("ISRATIO nur letzte 10 Jahre");
}
// zu wenig Historie → n/a mit Grund, kein 0
{
  const r = isratioReading(monthly("2024-01", Array.from({ length: 24 }, (_, i) => 1.3 + i * 0.001)));
  assert.equal(r.available, false);
  if (!r.available) assert.match(r.reason, /zu wenig Historie \(24 Monate/);
  assert.ok(!("z" in r));
  ok("ISRATIO zu wenig Historie → n/a mit Begründung");
}
assert.equal(isratioReading([]).available, false); ok("ISRATIO leer → n/a");
assert.equal(isratioReading(monthly("2015-01", Array(120).fill(1.3))).available, false); ok("ISRATIO Std 0 → n/a");

// YoY-Lücke: DGORDER +10 %, AMDMVS +4 % → +6 pp
{
  const d = monthly("2024-01", Array.from({ length: 13 }, (_, i) => (i === 12 ? 110 : 100)));
  const a = monthly("2024-01", Array.from({ length: 13 }, (_, i) => (i === 12 ? 104 : 100)));
  const r = orderShipmentGapReading(d, a);
  assert.ok(r.available);
  if (r.available) { assert.equal(r.latestDate, "2025-01-01"); assert.ok(Math.abs(r.gapPp - 6) < 1e-9); }
  ok("YoY-Lücke DGORDER − AMDMVS = +6 pp");
}
// Letzter gemeinsamer Monat: AMDMVS hinkt einen Monat nach
{
  const d = monthly("2024-01", Array.from({ length: 14 }, (_, i) => 100 + i));
  const a = monthly("2024-01", Array.from({ length: 13 }, () => 50));
  const r = orderShipmentGapReading(d, a);
  assert.ok(r.available && r.latestDate === "2025-01-01" && Math.abs(r.amdmvsYoyPct) < 1e-12);
  ok("YoY auf letztem gemeinsamen Monat");
}
// Zu wenig Historie → n/a
{
  const r = orderShipmentGapReading(monthly("2024-06", [1, 2, 3]), monthly("2024-06", [1, 2, 3]));
  assert.ok(!r.available && /Vorjahreswert/.test(r.reason));
  ok("YoY ohne Vorjahr → n/a mit Begründung");
}
{
  const r = orderShipmentGapReading([], monthly("2024-01", [1]));
  assert.ok(!r.available && /DGORDER/.test(r.reason));
  const r2 = computeInventoryDemandGap([], [], []);
  assert.ok(!r2.isratio.available && !r2.orderShipmentGap.available);
  ok("leere Reihen → n/a, nie 0");
}
// Review #343: Zweig „AMDMVS leer" (shared/inventory-demand-gap.ts) — DGORDER gültig, AMDMVS leer → n/a, Grund „AMDMVS: …"
{
  const r = orderShipmentGapReading(monthly("2024-01", Array.from({ length: 13 }, (_, i) => 100 + i)), []);
  assert.equal(r.available, false);
  if (!r.available) assert.match(r.reason, /^AMDMVS/);
  assert.ok(!("gapPp" in r));
  ok("AMDMVS leer → n/a mit Grund (AMDMVS), nie 0");
}
// Perzentil des letzten ISRATIO-Werts im 10J-Fenster, ohne feste Schwelle.
{
  const vals = Array.from({ length: 119 }, (_, i) => i).concat([10]);
  const r = isratioReading(monthly("2015-01", vals));
  assert.equal(r.available, true);
  if (r.available) {
    assert.equal(r.percentile, 10);
    assert.equal(typeof r.z, "number");
    assert.ok(Number.isFinite(r.percentile) && r.percentile !== 0);
  }
  ok("ISRATIO-Perzentil im 10J-Fenster (Rang, keine Schwelle)");
}
console.log(`Fixtures: ${n} grün`);

// server/inventory-demand-gap.ts:36 — Rohserie null (Abruf fehlgeschlagen), nicht leere Beobachtungen.
{
  const csv = "DATE,VALUE\n2024-01-01,100\n2025-01-01,110\n";
  const run = async (present: string[]) => {
    let called = false;
    const fetchCsv = async (id: string) => {
      called = true;
      return present.includes(id) ? csv : null;
    };
    const { result } = await fetchInventoryDemandGap(new Date("2026-06-01T00:00:00Z"), fetchCsv);
    assert.equal(called, true, "Abruf muss injiziert sein, sonst testet der Zweig nicht");
    return result;
  };
  const both = await run(["ISRATIO"]);
  assert.equal(both.orderShipmentGap.available, false);
  if (!both.orderShipmentGap.available) assert.equal(both.orderShipmentGap.reason, "DGORDER: FRED nicht erreichbar");
  assert.ok(!("gapPp" in both.orderShipmentGap));
  assert.equal(both.isratio.available, false);
  ok("DGORDER und AMDMVS null → orderShipmentGap n/a, FRED nicht erreichbar, nie 0");

  const noOrders = await run(["ISRATIO", "AMDMVS"]);
  assert.equal(noOrders.orderShipmentGap.available, false);
  if (!noOrders.orderShipmentGap.available) assert.equal(noOrders.orderShipmentGap.reason, "DGORDER: FRED nicht erreichbar");
  ok("nur DGORDER null → Grund DGORDER, FRED nicht erreichbar");

  const noShip = await run(["ISRATIO", "DGORDER"]);
  assert.equal(noShip.orderShipmentGap.available, false);
  if (!noShip.orderShipmentGap.available) assert.equal(noShip.orderShipmentGap.reason, "AMDMVS: FRED nicht erreichbar");
  ok("nur AMDMVS null → Grund AMDMVS, FRED nicht erreichbar");

  const none = await run([]);
  assert.equal(none.isratio.available, false);
  if (!none.isratio.available) assert.equal(none.isratio.reason, "ISRATIO: FRED nicht erreichbar");
  if (!none.orderShipmentGap.available) assert.match(none.orderShipmentGap.reason, /FRED nicht erreichbar/);
  assert.ok(!("latest" in none.isratio) && !("gapPp" in none.orderShipmentGap));
  ok("alle drei null → FRED nicht erreichbar, keine Zahlen");
}

// Response-Cache: TTL ist Parameter; nicht erreichbar wird nicht gecacht.
{
  const route = await import("../server/inventory-demand-gap-route");
  route.resetInventoryDemandGapCache();
  const sources = { isratio: "FRED ISRATIO", orders: "FRED DGORDER", shipments: "FRED AMDMVS" } as const;
  const hit = {
    isratio: { available: true as const, latestDate: "2026-01-01", latest: 1.4, median10y: 1.3, mean10y: 1.31, std10y: 0.05, z: 1.8, deviationFromMedian: 0.1, percentile: 92, months: 120, windowStart: "2016-01-01" },
    orderShipmentGap: { available: true as const, latestDate: "2026-01-01", dgorderLatest: 110, dgorderYearAgo: 100, amdmvsLatest: 104, amdmvsYearAgo: 100, dgorderYoyPct: 10, amdmvsYoyPct: 4, gapPp: 6 },
    gapWindow: { available: false as const, reason: "Lücke: zu wenig Historie" },
    sources,
  };
  let calls = 0;
  const load = async () => { calls++; return hit; };
  const a = await route.getInventoryDemandGap({ now: 1_000, ttlMs: 5_000, load });
  const b = await route.getInventoryDemandGap({ now: 2_000, ttlMs: 5_000, load });
  assert.equal(a, b);
  assert.equal(calls, 1);
  await route.getInventoryDemandGap({ now: 7_000, ttlMs: 5_000, load });
  assert.equal(calls, 2);
  ok("Cache hält innerhalb der TTL und lädt danach neu");

  route.resetInventoryDemandGapCache();
  calls = 0;
  const down = {
    isratio: { available: false as const, reason: "ISRATIO: FRED nicht erreichbar" },
    orderShipmentGap: { available: false as const, reason: "DGORDER: FRED nicht erreichbar" },
    gapWindow: { available: false as const, reason: "DGORDER: FRED nicht erreichbar" },
    sources,
  };
  const loadDown = async () => { calls++; return down; };
  await route.getInventoryDemandGap({ now: 1, ttlMs: 99_000, load: loadDown });
  await route.getInventoryDemandGap({ now: 2, ttlMs: 99_000, load: loadDown });
  assert.equal(calls, 2);
  ok("FRED nicht erreichbar wird nicht gecacht");
}

// HTTP-Kette: GET /api/macro/inventory-demand-gap → fetchInventoryDemandGap → Zweig :36, wenn FRED wirft.
{
  const express = (await import("express")).default;
  const { registerInventoryDemandGapRoute, resetInventoryDemandGapCache } = await import("../server/inventory-demand-gap-route");
  resetInventoryDemandGapCache();
  const orig = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("fred.stlouisfed.org")) throw new Error("offline");
    return orig(url, init);
  }) as typeof fetch;
  const app = express();
  registerInventoryDemandGapRoute(app);
  const server = await new Promise<import("node:http").Server>(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const port = (server.address() as { port: number }).port;
    const res = await orig(`http://127.0.0.1:${port}/api/macro/inventory-demand-gap`);
    const body = await res.json() as { isratio: { available: boolean; reason?: string }; orderShipmentGap: { available: boolean; reason?: string } };
    assert.equal(res.status, 200);
    assert.equal(body.isratio.available, false);
    assert.equal(body.orderShipmentGap.available, false);
    assert.match(body.isratio.reason ?? "", /FRED nicht erreichbar/);
    assert.match(body.orderShipmentGap.reason ?? "", /FRED nicht erreichbar/);
    assert.equal(JSON.stringify(body).includes("\"gapPp\""), false);
    assert.equal(JSON.stringify(body).includes("\"latest\""), false);
    ok("GET /api/macro/inventory-demand-gap bei FRED-Ausfall: n/a, nie 0");
  } finally {
    globalThis.fetch = orig;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

// Kein Score-Pfad: die Lücke darf die Aktien-Scores nicht importieren.
{
  const { readFileSync } = await import("node:fs");
  for (const f of ["server/analyze-route.ts", "server/scoring-gates.ts", "server/scoring-integration.ts", "shared/bias-fixes.ts", "server/recession.ts"]) {
    assert.ok(!readFileSync(f, "utf8").includes("inventory-demand-gap"), f);
  }
  ok("Score-Dateien importieren die Lager/Nachfrage-Lücke nicht");
}

if (process.env.OFFLINE !== "1") {
  const { result, raw } = await fetchInventoryDemandGap();
  const tail = (k: string, s: SeriesPoint[] | null) =>
    console.log(`  ${k}: ${s == null ? "nicht erreichbar" : `${s.length} Werte, letzte: ${s.slice(-3).map(o => `${o.date}=${o.value}`).join(", ")}`}`);
  console.log("Live FRED:");
  tail("ISRATIO", raw.isratio); tail("DGORDER", raw.dgorder); tail("AMDMVS", raw.amdmvs);
  console.log(JSON.stringify(result, null, 2));
  for (const r of [result.isratio, result.orderShipmentGap]) {
    if (r.available) continue;
    assert.ok(r.reason.length > 0);
  }
}
