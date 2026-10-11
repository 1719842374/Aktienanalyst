/**
 * #225-Follow-up: /api/gold-chart-history je Fenster kuerzen, index.html no-cache / Assets immutable,
 * FRED-Parser der Async-Variante identisch zur Sync-Variante.
 * Ausfuehren: npx tsx script/test-gold-chart-history-trim.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGoldChartHistoryPoints, trimChartHistory, parseChartHistoryRange, seriesCoverage, CHART_WARMUP_POINTS } from "../server/gold-chart-history";
import { buildGoldTechnical, filterGoldRange } from "../client/src/components/gold/goldTechnical";
import { staticCacheControl, INDEX_CACHE_CONTROL, ASSET_CACHE_CONTROL } from "../server/static";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const rows: { date: string; close: number; volume: number }[] = [];
for (let d = new Date("2000-08-30T00:00:00Z"), i = 0; iso(d) <= "2026-10-09"; d.setUTCDate(d.getUTCDate() + 1)) {
  if (d.getUTCDay() % 6 === 0) continue;
  rows.push({ date: iso(d), close: 300 + i * 0.5 + 60 * Math.sin(i / 90), volume: 1000 + (i % 50) }); i++;
}
const points = buildGoldChartHistoryPoints(rows, { real10y: [], dxy: [], t10yie: [], walcl: [], m2: [] });
const body = { source: "test", coverage: seriesCoverage(points), points };
const today = new Date("2026-10-11T12:00:00Z");

assert.equal(parseChartHistoryRange("10y"), "10Y");
assert.equal(parseChartHistoryRange(undefined), "Max");
assert.equal(parseChartHistoryRange("junk"), "Max");

const max = trimChartHistory(body, "Max", today);
assert.equal(max.points.length, points.length, "Max unveraendert");
const t10 = trimChartHistory(body, "10Y", today);
assert.equal(t10.warmupPoints, CHART_WARMUP_POINTS);
const firstVisible = filterGoldRange(points, "10Y", today)[0].date;
assert.equal(t10.points[CHART_WARMUP_POINTS].date, firstVisible, "Vorlauf endet genau am Fensterbeginn");
assert.ok(t10.points.length < points.length * 0.5, `10Y deutlich kleiner (${t10.points.length} / ${points.length})`);
assert.equal((t10.coverage as any).close.from, t10.points[0].date, "coverage zur gekuerzten Reihe");
const bytesFull = JSON.stringify(max).length, bytes10 = JSON.stringify(t10).length;
assert.ok(bytes10 < bytesFull * 0.5);
console.log(`  10Y: ${t10.points.length} Punkte / ${(bytes10 / 1024).toFixed(0)} KB statt ${points.length} / ${(bytesFull / 1024).toFixed(0)} KB`);

// Indikatoren im sichtbaren 10Y-Fenster: gekuerzt == volle Reihe
const full = filterGoldRange(buildGoldTechnical(points).points, "10Y", today);
const trimmed = filterGoldRange(buildGoldTechnical(t10.points).points, "10Y", today);
assert.equal(trimmed.length, full.length);
const keys = ["ma20", "ma50", "ma100", "ma200", "ema9", "ema12", "ema26", "macd", "signal", "histogram", "rsi14"] as const;
let maxDiff = 0;
for (let i = 0; i < full.length; i++) for (const k of keys) {
  const a = full[i][k], b = trimmed[i][k];
  assert.ok(a != null && b != null, `${k} am ${full[i].date} gesetzt`);
  maxDiff = Math.max(maxDiff, Math.abs((a as number) - (b as number)));
}
assert.ok(maxDiff < 1e-6, `max. Abweichung ${maxDiff}`);
assert.deepEqual(trimmed.map(p => p.cross ?? null), full.map(p => p.cross ?? null), "Cross-Marker identisch");
console.log(`  Indikatoren im 10Y-Fenster identisch (max. Abweichung ${maxDiff.toExponential(1)})`);

// Kein Fenster < Vorlauf: kurze Reihe bleibt ganz
const short = trimChartHistory({ points: points.slice(-500) }, "10Y", today);
assert.equal(short.points.length, 500);

// Cache-Control
assert.equal(staticCacheControl("/app/dist/public/index.html"), INDEX_CACHE_CONTROL);
assert.equal(staticCacheControl("/app/dist/public/assets/index-D994ByhD.js"), ASSET_CACHE_CONTROL);
assert.equal(staticCacheControl("/app/dist/public/assets/index-Gi1GsiE0.css"), ASSET_CACHE_CONTROL);
assert.equal(staticCacheControl("/app/dist/public/favicon.png"), null);
const st = readFileSync("server/static.ts", "utf8");
assert.match(st, /res\.setHeader\("Cache-Control", INDEX_CACHE_CONTROL\);\s*res\.sendFile/, "SPA-Fallback no-cache");

// Async-FRED nutzt denselben Parser wie die Sync-Variante
const { parseFredHistoryCsv } = await import("../server/gold-routes");
assert.deepEqual(parseFredHistoryCsv("observation_date,DFII10\n2003-01-02,2.43\n2003-01-03,.\n2003-01-06,2.4\n"), [{ date: "2003-01-02", value: 2.43 }, { date: "2003-01-06", value: 2.4 }]);
const gr = readFileSync("server/gold-routes.ts", "utf8");
assert.match(gr, /return parseFredHistoryCsv\(csv\);/, "Sync-Variante nutzt den geteilten Parser");
// Client fragt je Fenster
const gpc = readFileSync("client/src/components/gold/GoldPriceChart.tsx", "utf8");
assert.match(gpc, /\/api\/gold-chart-history\?range=\$\{historyRange\}/);
console.log("test-gold-chart-history-trim: OK");
