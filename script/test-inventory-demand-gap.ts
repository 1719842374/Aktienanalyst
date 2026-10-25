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
console.log(`Fixtures: ${n} grün`);

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
