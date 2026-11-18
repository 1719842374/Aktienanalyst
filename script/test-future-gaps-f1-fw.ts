/**
 * F1-42, F1-67, F1-68, F1-69, F1-70, FW-01, FW-27.
 * F1-23 / FW-41 bleiben unangeschlossen. FW-24 und Future_10 ohne Code.
 *
 * Ausführen: npx tsx script/test-future-gaps-f1-fw.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import {
  bookProbability,
  catalogProbability,
  closedSlot,
  laborSlot,
  REGION_WEIGHT,
} from "../shared/recession-regions";
import { scoredTotals } from "../server/recession";
import { buffettOverlayFromLoaded } from "../shared/recession-ta";
import { MARGIN_DEBT_NON_US_NOTE } from "../shared/recession-market-charts";
import { fillSpyValuationGaps, parseYahooFactpack } from "../shared/yahoo-factpack";
import { valuationFromParts } from "../shared/recession-market-charts";
import { screenBalanceCsv, BALANCE_MIN_HISTORY } from "../shared/balance-screen";
import { proposeCreditSpreadStress, CREDIT_STRESS_MIN_OBS, CREDIT_STRESS_Z } from "../shared/credit-spread-stress-proposal";
import { copy, sectionLabel } from "../shared/ui-locale";

let n = 0;
const ok = (name: string) => { n += 1; console.log(`  ✅ ${name}`); };

const fmpPe = valuationFromParts({
  price: 100,
  ttmEps: 5,
  prevTtmEps: 4,
  epsNtm: 6,
  allowForward: true,
  keyMetricsPe: null,
});

const yahoo = parseYahooFactpack({
  summaryDetail: { trailingPE: { raw: 40 } },
  defaultKeyStatistics: { trailingEps: { raw: 8 } },
  earningsTrend: { trend: [{ period: "+1y", earningsEstimate: { avg: { raw: 9 } } }] },
});
assert.equal(yahoo.trailingEps, 8);
assert.equal(yahoo.forwardEps, 9);
const kept = fillSpyValuationGaps(fmpPe, 100, yahoo, true);
assert.equal(kept.core.pe, fmpPe.pe);
assert.equal(kept.core.peFwd, fmpPe.peFwd);
assert.equal(kept.notes.length, 0);
ok("F1-67: vorhandenes FMP-KGV bleibt, Yahoo überschreibt es nicht");

const empty = valuationFromParts({
  price: 450,
  ttmEps: null,
  prevTtmEps: null,
  epsNtm: null,
  allowForward: true,
  keyMetricsPe: null,
});
const filled = fillSpyValuationGaps(empty, 450, yahoo, true);
assert.equal(filled.core.pe, 56.25);
assert.equal(filled.core.peFwd, 50);
assert.ok(filled.notes.some(line => line.includes("trailingEps")));
assert.ok(filled.notes.some(line => line.includes("earningsTrend")));
assert.equal(filled.core.gCons, ((9 - 8) / 8) * 100);
ok("F1-67/68: leeres FMP-KGV aus Yahoo-EPS, Forward aus earningsTrend +1y");

const noYahoo = fillSpyValuationGaps(empty, 450, parseYahooFactpack(null), true);
assert.equal(noYahoo.core.pe, null);
assert.ok(noYahoo.notes.every(line => line.startsWith("PE n/a") || line.startsWith("fwd n/a")));
assert.ok(!noYahoo.notes.some(line => /\b0\b/.test(line) && line.includes("PE:")));
ok("F1-67: Yahoo leer bleibt n/a mit Grund, kein gesetztes 0");

assert.match(MARGIN_DEBT_NON_US_NOTE.VGK, /n\/a —/);
assert.match(MARGIN_DEBT_NON_US_NOTE.ASHR, /n\/a —/);
assert.equal("QQQ" in MARGIN_DEBT_NON_US_NOTE, false);
const charts = readFileSync("server/recession-market-charts.ts", "utf8");
assert.ok(charts.includes("marginDebtNote"));
assert.ok(charts.includes('book.etf === "SPY"'));
assert.ok(charts.includes("fillSpyValuationGaps"));
const ui = readFileSync("client/src/components/recession/RecessionMarketChartsSection.tsx", "utf8");
assert.ok(ui.includes("leverage-note-${market.id}") || ui.includes("leverage-note-"));
ok("F1-69: Europa/Asien n/a, QQQ ohne erfundene FINRA-Reihe");

const overlay = buffettOverlayFromLoaded({
  points: [{ date: "2026-01-01", ratio: 180 }, { date: "2026-02-01", ratio: Number.NaN }],
  sources: [{ id: "GDP" }],
}, null);
assert.equal(overlay.points.length, 1);
assert.equal(overlay.error, null);
const missing = buffettOverlayFromLoaded(null, "Timeout");
assert.match(missing.error ?? "", /^n\/a —/);
assert.equal(missing.points.length, 0);
const taRoute = readFileSync("server/recession-ta-route.ts", "utf8");
const taUi = readFileSync("client/src/components/recession/RecessionTaSection.tsx", "utf8");
assert.ok(taRoute.includes("loadBuffettOverlay"));
assert.ok(!taUi.includes("/api/analyze-recession/buffett"));
ok("F1-42: Buffett im TA-Abruf, die Sektion holt ihn nicht mehr extra");

const live = laborSlot("ALQ", "Test", 1);
const closed = closedSlot("spreads", "Spreads JP", "recession", "JGB-Corp (keine freie OAS-Serie)");
const before = catalogProbability([live], "recession");
const after = catalogProbability([live, closed], "recession");
assert.equal(before, after);
assert.equal(closed.available, false);
assert.equal(closed.maxWeighted, 0);
const usBefore = scoredTotals([{ weightedScore: 4, maxWeighted: 8, available: true }]);
const usAfter = scoredTotals([
  { weightedScore: 4, maxWeighted: 8, available: true },
  { weightedScore: 9, maxWeighted: 12, available: false },
]);
assert.deepEqual(usBefore, usAfter);
assert.equal(bookProbability(usBefore.net, usBefore.max), bookProbability(usAfter.net, usAfter.max));
assert.deepEqual(REGION_WEIGHT, { US: 0.7, EZ: 0.2, JP: 0.1 });
ok("F1-70: geschlossener Slot ändert Katalog-P und US-Netto/Max nicht");

const periods = Array.from({ length: BALANCE_MIN_HISTORY }, (_, i) => {
  const debt = i === BALANCE_MIN_HISTORY - 1 ? 90 : 10 + i;
  return `2020-12-${String(i + 1).padStart(2, "0")},100,40,60,50,20,5,${debt}`;
});
const csv = ["date,totalAssets,totalLiabilities,totalEquity,currentAssets,currentLiabilities,cash,totalDebt", ...periods].join("\n");
const screened = screenBalanceCsv(csv);
assert.equal(screened.error, null);
const debtFlag = screened.flags.find(item => item.id === "debt-equity");
assert.equal(debtFlag?.active, true);
const identity = screened.flags.find(item => item.id === "identity");
assert.equal(identity?.active, false);
const broken = screenBalanceCsv("date,totalAssets\n2024-01-01,10\n");
assert.equal(broken.error, null);
assert.equal(broken.flags.find(item => item.id === "identity")?.active, null);
assert.match(broken.flags.find(item => item.id === "identity")?.detail ?? "", /n\/a —/);
ok("FW-27: Perzentil-Flag nur aus der eigenen Historie, fehlende Spalte n/a");

const calm = proposeCreditSpreadStress(Array.from({ length: CREDIT_STRESS_MIN_OBS }, () => 1));
assert.equal(calm.active, null);
assert.match(calm.reason ?? "", /Streuung/);
const rising = Array.from({ length: CREDIT_STRESS_MIN_OBS - 1 }, () => 0);
rising.push(CREDIT_STRESS_Z);
const stress = proposeCreditSpreadStress(rising);
assert.equal(stress.live, "nicht geschaltet");
assert.equal(stress.active, true);
const section6 = readFileSync("client/src/components/sections/Section6.tsx", "utf8");
const recession = readFileSync("server/recession.ts", "utf8");
const analyze = readFileSync("server/analyze-route.ts", "utf8");
assert.ok(!section6.includes("credit-spread-stress-proposal"));
assert.ok(!recession.includes("credit-spread-stress-proposal"));
assert.ok(!analyze.includes("credit-spread-stress-proposal"));
assert.ok(!analyze.includes("yahoo-factpack"));
ok("F1-23/FW-41: Vorschlag rechnet z, CRV und analyze-route importieren ihn nicht");

assert.notEqual(sectionLabel("de", 5), sectionLabel("en", 5));
assert.equal(copy("en", "nav.balance"), "Statements");
assert.equal(copy("de", "balance.title"), "Bilanzen-Screener");
ok("FW-01: Hülle DE/EN, Sektionsnamen der Sidebar wechseln");

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
ok("Score-Pins unverändert: VOW3 4.735718, SAP 5.174758, MSFT 4.058138");

async function routeCheck() {
  const express = (await import("express")).default;
  const { registerBalanceScreenRoute } = await import("../server/balance-screen-route");
  const app = express();
  app.use(express.json());
  registerBalanceScreenRoute(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await fetch(`${base}/api/balance-screen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  const body = await res.json() as { flags: { id: string; active: boolean | null }[] };
  assert.equal(res.status, 200);
  assert.equal(body.flags.find(item => item.id === "debt-equity")?.active, true);
  const bad = await fetch(`${base}/api/balance-screen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv: "nur-text" }),
  });
  const badBody = await bad.json() as { error: string };
  assert.equal(bad.status, 400);
  assert.match(badBody.error, /^n\/a —/);
  server.close();
  ok("FW-27: POST /api/balance-screen liefert Flags, Müll ist n/a");
}

routeCheck().then(() => {
  console.log(`\n${n} Checks grün`);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
