/**
 * Vier-Bedingungen-Kurslinie aus 74aee3a9, auf main ed1e98cd gesetzt.
 * Die Earnings-Assertions dieses Dateinamens bleiben auf PR #386:
 * shared/earnings-markers.ts gibt es auf main nicht, der Cherry-Pick
 * enthält sie nicht. Der erste Balken ohne Vorgänger-MACD bleibt ungefärbt,
 * wie shared/ta-ampel.ts und die Commit-Message es sagen.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-chart-overlays.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { ampelBadge, conditionCount, paintAmpelClose, TA_PROTOCOL_SIZE } = await import("../shared/ta-ampel.ts");

assert.equal(ampelBadge(TA_PROTOCOL_SIZE).text, "Starkes Kaufsignal");
assert.equal(ampelBadge(TA_PROTOCOL_SIZE - 1).tone, "yellow");
const partial = conditionCount({ close: 10, ma200: 9 }, null);
assert.equal(partial.complete, false);
assert.match(partial.reason ?? "", /n\/a/);
const row = { close: 12, ma200: 10, ma50: 11, macd: 0.2 };
const ready = conditionCount(row, 0.1);
assert.equal(ready.complete, true);
assert.equal(ready.met, TA_PROTOCOL_SIZE);
const painted = paintAmpelClose([
  { close: 8, ma200: 10, ma50: 9, macd: -0.4 },
  { close: 8, ma200: 10, ma50: 9, macd: -0.2 },
  row,
]);
assert.equal(painted[0]._ampel, null);
assert.equal(painted[1]._ampel, "red");
assert.equal(painted[1]._closeRed, 8);
assert.equal(painted[2]._closeGreen, 12);
assert.equal(painted[0]._closeGreen, null);

const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.match(ui, /return cone \? attachConeSeries\(base, cone\) : base/);
assert.match(ui, /data-testid="button-scenario-cone"/);
assert.match(ui, /data-testid="chart-ampel-label"/);
assert.match(ui, /data-testid="button-ampel"/);
assert.match(ui, /paintAmpelClose\(chartData\)/);
assert.match(ui, /_closeGreen/);
assert.match(ui, /Anti-Bias Protokoll/);
assert.match(ui, /data-testid="button-dividend"/);
assert.match(ui, /data-testid="button-real10y"/);
assert.match(ui, /dataKey="_peerPx"/);
assert.doesNotMatch(ui, /data-testid="button-earnings"/);
assert.doesNotMatch(ui, /analyze-route/);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

console.log("chart overlays: OK");
