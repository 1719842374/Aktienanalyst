/** Run: npx tsx script/test-dividend-kpi.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dividendYieldKpi } from "../client/src/lib/dividendKpi";

assert.equal(dividendYieldKpi(3.6), "3.60%");
assert.equal(dividendYieldKpi(0.44), "0.44%");
for (const v of [0, -1, NaN, Infinity, null, undefined]) assert.equal(dividendYieldKpi(v as any), null, String(v));

const ui = readFileSync("client/src/components/sections/Section1.tsx", "utf8");
assert.match(ui, /\{divKpi && <KPI label="Div\. Yield"/, "KPI only rendered with a positive yield");
const schema = readFileSync("shared/schema.ts", "utf8");
assert.match(schema, /dividendYield\?: number \| null;/);
const route = readFileSync("server/analyze-route.ts", "utf8");
assert.match(route, /^\s+dividendYield,$/m, "analyze response already carries dividendYield");
console.log("test-dividend-kpi: OK");
