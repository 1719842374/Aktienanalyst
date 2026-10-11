/**
 * Section-1 Div.-Yield tile = last point of the TA overlay line (TTM, same function, same smoothing, same guard).
 * Fixtures: script/fixtures/dividend-kpi-live.json = live /api/dividends + last 400 ohlcv bars (11.10.2026).
 * Run: npx tsx script/test-dividend-kpi-ttm.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dividendKpiFromHistory, dividendOverlaySeries } from "../shared/dividends";

const fx = JSON.parse(readFileSync("script/fixtures/dividend-kpi-live.json", "utf8"));
const rows: string[] = [];
for (const t of ["KO", "NVO", "AMZN"]) {
  const f = fx[t]; const last = f.bars[f.bars.length - 1];
  const tile = dividendKpiFromHistory(f.dividends, last, f.currency);
  const line = f.dividends.events.length ? dividendOverlaySeries(f.bars, f.dividends.events).points.at(-1)! : null;
  const lineVal = line?.yieldPct ?? null;
  rows.push(`| ${t} | ${tile.kind === "ttm" ? tile.yieldPct.toFixed(2) + " %" : tile.kind} | ${lineVal == null ? "n/a" : lineVal.toFixed(2) + " %"} | ${f.dividendYieldFY} % |`);
  if (t === "AMZN") { assert.equal(tile.kind, "none"); assert.equal(lineVal, null); continue; }
  assert.equal(tile.kind, "ttm");
  if (tile.kind === "ttm") assert.equal(tile.yieldPct.toFixed(2), lineVal!.toFixed(2), `${t}: tile == line last point`);
}
const ko = dividendKpiFromHistory(fx.KO.dividends, fx.KO.bars.at(-1), "USD");
assert.ok(ko.kind === "ttm" && ko.yieldPct === 2.39);
const nvo = dividendKpiFromHistory(fx.NVO.dividends, fx.NVO.bars.at(-1), "USD");
assert.ok(nvo.kind === "ttm" && nvo.yieldPct === 4.65);
// Smoothing parity: NVO 30.03.2026 (ex-date drift) → tile uses the smoothed 5.11 %, like the line.
const sm = dividendKpiFromHistory(fx.NVO.dividends, { date: "2026-03-30", close: 35.29 }, "USD");
assert.ok(sm.kind === "ttm" && sm.yieldPct === 5.11 && sm.smoothed);
// Currency guard (same as overlay)
assert.equal(dividendKpiFromHistory({ ...fx.NVO.dividends, currency: "DKK" }, fx.NVO.bars.at(-1), "USD").kind, "mismatch");
assert.equal(dividendKpiFromHistory({ ...fx.KO.dividends, currency: "USD" }, fx.KO.bars.at(-1), "USD").kind, "ttm");
// Missing / empty → none (tile falls back to GJ)
assert.equal(dividendKpiFromHistory(undefined, fx.KO.bars.at(-1), "USD").kind, "none");
// UI wiring
const s1 = readFileSync("client/src/components/sections/Section1.tsx", "utf8");
const tc = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.match(s1, /useDividendHistory\(data\.ticker\)/); assert.match(tc, /useDividendHistory\(data\.ticker, showDividend\)/);
assert.doesNotMatch(tc, /fetch\(`\/api\/dividends/, "no duplicated fetch");
assert.match(s1, /sub: `TTM\$\{divFy \? ` · GJ \(FMP\) \$\{divFy\}` : ""\}`/);
assert.match(s1, /: divFy \? \{ value: divFy, sub: "GJ \(FMP\)" \}/);
console.log("| Ticker | Kachel (TTM) | Linie letzter Punkt | GJ (FMP) |\n|---|---|---|---|\n" + rows.join("\n"));
console.log("test-dividend-kpi-ttm: OK");
