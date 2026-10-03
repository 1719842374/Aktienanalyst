/**
 * Unit-Tests fuer client/src/lib/portfolio/compareTargetActual.ts
 * Spec: Offen_WORK_PORTFOLIO_SOLL_IST.md §3, §5, §7, §9 (6 Fixtures + CDNS).
 * Ausfuehren: npx tsx script/test-portfolio-compare-target-actual.ts
 *
 * Kein Netz, keine Renormierung, Union statt Inner-Join.
 */
import { computeMarketValue, computePositionPerformance } from "../client/src/lib/portfolio/positions";
import {
  compareTargetActual,
  onTargetBp,
  slightBp,
  displayFloor,
  renormalizeDisplay,
} from "../client/src/lib/portfolio/compareTargetActual";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

check("policy: onTargetBp = 25", onTargetBp === 25);
check("policy: slightBp = 100", slightBp === 100);
check("policy: displayFloor = 0.0025", displayFloor === 0.0025);
check("policy: renormalizeDisplay = false", renormalizeDisplay === false);

const empty = compareTargetActual({ target: {}, actual: { AAPL: 0.5, MSFT: 0.5 }, nav: 1000 });
check("ohne Soll: empty, keine erfundenen Gewichte", empty.empty === true && empty.rows.length === 0);
check("ohne Soll: null target ebenfalls empty", compareTargetActual({ target: null, actual: { AAPL: 1 }, nav: 1 }).empty === true);

// Fixture 1 — Summe Soll ≠ 1, keine Renormierung, Trade nutzt Rohgewichte.
const sumOff = compareTargetActual({
  target: { AAPL: 0.6, MSFT: 0.6 },
  actual: { AAPL: 0.5, MSFT: 0.5 },
  nav: 1000,
});
check("Summe≠1: nicht empty", sumOff.empty === false);
check("Summe≠1: targetSum bleibt 1.2", Math.abs(sumOff.targetSum - 1.2) < 1e-12, `sum=${sumOff.targetSum}`);
check("Summe≠1: Banner > 2 pp", sumOff.sumTargetOff === true);
check("Summe≠1: renormalized false", sumOff.renormalized === false);
const aaplSum = sumOff.rows.find(r => r.ticker === "AAPL");
check("Summe≠1: Soll AAPL bleibt 0.6", aaplSum != null && Math.abs(aaplSum.target - 0.6) < 1e-12);
check("Summe≠1: Trade AAPL = (0.6-0.5)*1000 = 100 Buy", aaplSum != null && Math.abs(aaplSum.trade - 100) < 1e-9 && aaplSum.side === "buy");

// Fixture 2 — Union, nur Soll.
const onlyTarget = compareTargetActual({
  target: { AAPL: 0.5, NVDA: 0.5 },
  actual: { AAPL: 1 },
  nav: 2000,
});
const nvda = onlyTarget.rows.find(r => r.ticker === "NVDA");
check("Union nur-Soll: NVDA ist dabei", nvda != null);
check("Union nur-Soll: Ist = 0", nvda != null && nvda.actual === 0);
check("Union nur-Soll: Active = 0 - 0.5", nvda != null && Math.abs(nvda.active - -0.5) < 1e-12);
check("Union nur-Soll: Trade Buy = 0.5 * NAV", nvda != null && Math.abs(nvda.trade - 1000) < 1e-9 && nvda.side === "buy");

// Fixture 3 — Union, nur Ist.
const onlyActual = compareTargetActual({
  target: { AAPL: 1 },
  actual: { AAPL: 0.4, OLD: 0.6 },
  nav: 500,
});
const old = onlyActual.rows.find(r => r.ticker === "OLD");
check("Union nur-Ist: OLD ist dabei", old != null);
check("Union nur-Ist: Soll = 0", old != null && old.target === 0);
check("Union nur-Ist: Active = 0.6", old != null && Math.abs(old.active - 0.6) < 1e-12);
check("Union nur-Ist: Trade Sell", old != null && old.trade < 0 && old.side === "sell" && Math.abs(old.trade - (0 - 0.6) * 500) < 1e-9);

// Fixture 4 — Cash auf beiden Seiten (gleicher Nenner, Typ B).
const bothCash = compareTargetActual({
  target: { AAPL: 0.7, CASH: 0.3 },
  actual: { AAPL: 0.8, CASH: 0.2 },
  nav: 1000,
});
check("Cash beide: nicht gemischt", bothCash.cashMixed === false);
const cashRow = bothCash.rows.find(r => r.ticker === "CASH");
check("Cash beide: CASH in der Union", cashRow != null && Math.abs(cashRow.target - 0.3) < 1e-12 && Math.abs(cashRow.actual - 0.2) < 1e-12);
check("Cash beide: Summe Soll = 1, kein Banner", Math.abs(bothCash.targetSum - 1) < 1e-12 && bothCash.sumTargetOff === false);

// Fixture 5 — Cash nur auf einer Seite: CASH raus, nicht Typ A gegen Typ B.
const mixedCash = compareTargetActual({
  target: { AAPL: 0.6, CASH: 0.4 },
  actual: { AAPL: 1 },
  nav: 1000,
});
check("Cash-Mix: Flag gesetzt", mixedCash.cashMixed === true);
check("Cash-Mix: CASH nicht in den Zeilen", mixedCash.rows.every(r => r.ticker !== "CASH"));
const aaplMix = mixedCash.rows.find(r => r.ticker === "AAPL");
check("Cash-Mix: AAPL Soll bleibt 0.6 (nicht auf 1 renormiert)", aaplMix != null && Math.abs(aaplMix.target - 0.6) < 1e-12);
check("Cash-Mix: targetSum ohne CASH = 0.6, Banner an", Math.abs(mixedCash.targetSum - 0.6) < 1e-12 && mixedCash.sumTargetOff === true);

// Fixture 6 — Schwellen 25 / 100 bp, MAE, Turnover=L1/2, Max |Active|, Off-Count, displayFloor.
// |a| Grenzen: < 25 bp on target, < 100 bp leicht, sonst off.
const bands = compareTargetActual({
  target: { ON: 0.25, EDGE: 0.25, SLIGHT: 0.25, OFF: 0.25, DUST: 0.001 },
  actual: { ON: 0.25 + 0.0024, EDGE: 0.25 + 0.0025, SLIGHT: 0.25 + 0.0099, OFF: 0.25 + 0.01, DUST: 0 },
  nav: 10_000,
});
function statusOf(ticker: string) {
  return bands.rows.find(r => r.ticker === ticker)?.status;
}
check("Status |a|=24 bp on target", statusOf("ON") === "on-target");
check("Status |a|=25 bp nicht mehr on target", statusOf("EDGE") === "slight");
check("Status |a|=99 bp leicht off", statusOf("SLIGHT") === "slight");
check("Status |a|=100 bp off target", statusOf("OFF") === "off");
check("Off-Count zählt nur off target", bands.offCount === 1);
const l1 = bands.rows.reduce((s, r) => s + Math.abs(r.active), 0);
check("L1 = Summe |Active|", Math.abs(bands.l1 - l1) < 1e-12);
check("Turnover = L1/2", Math.abs(bands.turnover - l1 / 2) < 1e-12);
check("MAE = L1/n", bands.mae != null && Math.abs(bands.mae - l1 / bands.n) < 1e-12 && bands.n === 5);
check("Max |Active| = 100 bp", bands.maxAbsActive != null && Math.abs(bands.maxAbsActive - 0.01) < 1e-12);
check("displayFloor: DUST nicht im Balken-Chart", bands.chartRows.every(r => r.ticker !== "DUST"));
check("displayFloor: DUST bleibt in der Tabelle", bands.rows.some(r => r.ticker === "DUST"));
check("Active-Chart blendet |a| unter Floor aus", bands.activeChartRows.every(r => Math.abs(r.active) >= displayFloor));

// Inner-Join wäre falsch: nur gemeinsame Namen. Union hat alle.
check("kein Inner-Join: Fixture 2 hat 2 Zeilen", onlyTarget.rows.length === 2);
check("Ticker-Key wird großgeschrieben", compareTargetActual({
  target: { aapl: 1 },
  actual: { AAPL: 1 },
  nav: 1,
}).rows.length === 1);

// §2 CDNS — MktVal / P&L / P&L% auf 1 USD bzw. 1 bp, Nenner A vs B.
const cdnsQty = 133;
const cdnsCost = 316.17;
const cdnsPrice = 347.55;
const cdnsMkt = computeMarketValue(cdnsQty, cdnsPrice);
const cdnsPnl = cdnsQty * (cdnsPrice - cdnsCost);
const cdnsPnlPct = computePositionPerformance(cdnsCost, cdnsPrice, "long");
check("CDNS MktVal innerhalb 1 USD von 46224", cdnsMkt != null && Math.abs(cdnsMkt - 46224) <= 1, `mkt=${cdnsMkt}`);
check("CDNS P&L innerhalb 1 USD von 4174", Math.abs(cdnsPnl - 4174) <= 1, `pnl=${cdnsPnl}`);
check("CDNS P&L% innerhalb 1 bp von 9.93%", cdnsPnlPct != null && Math.abs(cdnsPnlPct - 0.0993) <= 0.0001, `pct=${cdnsPnlPct}`);

const equityNav = 990969;
const totalAssets = 30620 + equityNav;
check("Total Assets = Cash + Mkt Value", totalAssets === 1021589);
const weightA = (cdnsMkt ?? 0) / equityNav;
const weightB = (cdnsMkt ?? 0) / totalAssets;
check("CDNS Nenner A (nur Equity) ist nicht 4.52%", Math.abs(weightA - 0.0452) > 0.0001);
check("CDNS Nenner B (Total Assets) innerhalb 1 bp von 4.52%", Math.abs(weightB - 0.0452) <= 0.0001, `wB=${weightB}`);

// Gleicher Nenner im Vergleich: beide Vektoren Typ B, Trade gegen Total Assets.
const cdnsCompare = compareTargetActual({
  target: { "US.CDNS": 0.04, CASH: 1 - 0.04 },
  actual: { "US.CDNS": weightB, CASH: 1 - weightB },
  nav: totalAssets,
});
const cdnsRow = cdnsCompare.rows.find(r => r.ticker === "US.CDNS");
check("CDNS Vergleich behält CASH (beide Seiten)", cdnsCompare.cashMixed === false && cdnsCompare.rows.some(r => r.ticker === "CASH"));
check("CDNS Trade = (Soll-Ist)*Total Assets", cdnsRow != null && Math.abs(cdnsRow.trade - (0.04 - weightB) * totalAssets) < 1e-6);

if (failed > 0) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nall checks passed");
