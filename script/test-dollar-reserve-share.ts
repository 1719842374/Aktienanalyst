/**
 * F1-39 — Dollar-Anteil an den Weltreserven: Fixtures + Live-Lauf mit echten IMF-COFER-Werten.
 * Ausführen: npx tsx script/test-dollar-reserve-share.ts   (OFFLINE=1 überspringt den Live-Teil)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COFER_MIN_QUARTERS, dollarReserveShareReading, parseCoferUsdShare, type QuarterPoint } from "../shared/dollar-reserve-share";
import { fetchDollarReserveShare } from "../server/dollar-reserve-share";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const q = (start: number, vals: number[]): QuarterPoint[] =>
  vals.map((value, i) => ({ period: `${start + Math.floor(i / 4)}-Q${(i % 4) + 1}`, value }));

// Fixture: echte IMF-Antwort vom 25.10.2026 (2015-Q1 … 2026-Q2)
{
  const xml = readFileSync(new URL("./fixtures/imf-cofer-usd-2026-10-25.xml", import.meta.url), "utf8");
  const s = parseCoferUsdShare(xml);
  assert.equal(s.length, 46);
  assert.equal(s[0].period, "2015-Q1");
  assert.equal(s.at(-1)!.period, "2026-Q2");
  const r = dollarReserveShareReading(s);
  assert.ok(r.available);
  if (r.available) {
    assert.ok(Math.abs(r.latestPct - 56.704761505127) < 1e-6);
    assert.ok(r.yoyPp != null && r.change5yPp != null);
    console.log(`  Fixture: ${r.latestPeriod} ${r.latestPct.toFixed(2)} %, YoY ${r.yoyPp!.toFixed(2)} pp, 5J ${r.change5yPp!.toFixed(2)} pp`);
  }
  ok("Fixture: 46 Quartale geparst, letzter Wert 2026-Q2");
}
// Rechnung: YoY und 5J in Prozentpunkten
{
  const vals = Array.from({ length: 24 }, (_, i) => 60 - i * 0.25); // 2020-Q1 … 2025-Q4
  const r = dollarReserveShareReading(q(2020, vals));
  assert.ok(r.available);
  if (r.available) {
    assert.equal(r.latestPeriod, "2025-Q4");
    assert.ok(Math.abs(r.yoyPp! - -1) < 1e-9);
    assert.ok(Math.abs(r.change5yPp! - -5) < 1e-9);
  }
  ok("YoY −1 pp, 5J −5 pp");
}
// 5J fehlt → null + Grund, YoY bleibt
{
  const r = dollarReserveShareReading(q(2024, [58, 58, 58, 58, 57]));
  assert.ok(r.available && r.change5yPp === null && /kein Wert für 2020-Q1/.test(r.change5yReason ?? ""));
  ok("5J ohne Historie → null mit Grund (nicht 0)");
}
// zu kurz / leer / falsche Reihe / kaputt → n/a
{
  const r = dollarReserveShareReading(q(2025, [57, 57, 57, 57]));
  assert.ok(!r.available && /zu wenig Historie \(4 Quartale, mindestens 5\)/.test(r.reason));
  assert.equal(COFER_MIN_QUARTERS, 5);
  ok("zu kurze Historie → n/a mit Grund");
}
{
  const r = dollarReserveShareReading([]);
  assert.ok(!r.available && /keine gültigen/.test(r.reason) && !("latestPct" in r));
  ok("leer → n/a, nie 0");
}
{
  const gap = q(2024, [58, 58, 58, 58, 57, 57]).filter(p => p.period !== "2024-Q2");
  const r = dollarReserveShareReading(gap);
  assert.ok(!r.available && /Vorjahresquartal fehlt/.test(r.reason));
  ok("Vorjahresquartal fehlt → n/a");
}
{
  const eur = `<message:StructureSpecificData><Series COUNTRY="G001" INDICATOR="AFXRA" FXR_CURRENCY="CI_EUR" TYPE_OF_TRANSFORMATION="SHRO_PT" FREQUENCY="Q"><Obs TIME_PERIOD="2026-Q2" OBS_VALUE="20"/></Series></message:StructureSpecificData>`;
  assert.equal(parseCoferUsdShare(eur).length, 0);
  assert.equal(parseCoferUsdShare("<html>Fehler</html>").length, 0);
  assert.equal(parseCoferUsdShare(null).length, 0);
  const bad = `<message:StructureSpecificData><Series COUNTRY="G001" INDICATOR="AFXRA" FXR_CURRENCY="CI_USD" TYPE_OF_TRANSFORMATION="SHRO_PT" FREQUENCY="Q"><Obs TIME_PERIOD="2026-Q2" OBS_VALUE="NaN"/><Obs TIME_PERIOD="2026-Q1"/></Series></message:StructureSpecificData>`;
  assert.equal(parseCoferUsdShare(bad).length, 0);
  ok("fremde Währung / HTML / null / ungültige Werte → keine Beobachtungen");
}
console.log(`Fixtures: ${n} grün`);

if (process.env.OFFLINE !== "1") {
  const { result, rawCount } = await fetchDollarReserveShare();
  console.log(`Live IMF COFER: ${rawCount == null ? "nicht erreichbar" : `${rawCount} Quartale`}`);
  if (result.available) console.log(`  letzte: ${result.series.slice(-4).map(p => `${p.period}=${p.value.toFixed(2)}`).join(", ")}`);
  const { series, ...rest } = result as { series?: unknown };
  console.log(JSON.stringify(rest, null, 2));
  if (!result.available) assert.ok(result.reason.length > 0);
}
