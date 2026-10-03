/**
 * Unit-Tests für compareTargetActual (Offen_WORK_PORTFOLIO_SOLL_IST.md §3, §7).
 * Ausführen: npx tsx script/test-portfolio-compare-target-actual.ts
 *
 * Sechs Fixtures: Summe≠1, Union, Cash-Mix, Cash auf beiden Seiten,
 * Schwellen 25/100 bp, Trade-Vorzeichen. Dazu CDNS §2 gegen positions.ts.
 */
import { computeMarketValue, computePositionPerformance } from "../client/src/lib/portfolio/positions";
import {
  COMPARE_POLICY,
  TARGET_SUM_BANNER_ABS,
  compareTargetActual,
} from "../client/src/lib/portfolio/compareTargetActual";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

console.log("\nPolicy-Defaults (§5)");
check("onTargetBp = 25", COMPARE_POLICY.onTargetBp === 25);
check("slightBp = 100", COMPARE_POLICY.slightBp === 100);
check("displayFloor = 0.0025", COMPARE_POLICY.displayFloor === 0.0025);
check("renormalizeDisplay = false", COMPARE_POLICY.renormalizeDisplay === false);
check("Banner-Schwelle > 2 pp", TARGET_SUM_BANNER_ABS === 0.02);

console.log("\nLeeres Soll — keine erfundenen Zielgewichte");
{
  const result = compareTargetActual({}, { AAA: 1, BBB: 0 }, 100_000);
  check("hasTarget false", result.hasTarget === false);
  check("keine Zeilen aus dem Ist", result.rows.length === 0);
  check("kein Soll=0 für AAA", !result.rows.some(r => r.ticker === "AAA"));
  check("KPIs leer", result.l1 == null && result.turnover == null && result.mae == null && result.maxAbsActive == null);
  check("kein Summen-Banner ohne Soll", result.targetSumOff === false);
}

console.log("\nFixture 1: Summe Soll ≠ 1, keine Renormierung");
{
  const nav = 10_000;
  const result = compareTargetActual(
    { A: 0.50, B: 0.20 },
    { A: 0.50, B: 0.50 },
    nav,
  );
  const a = result.rows.find(r => r.ticker === "A");
  const b = result.rows.find(r => r.ticker === "B");
  check("targetSum = 0.70", result.targetSum != null && approx(result.targetSum, 0.70));
  check("Banner weil |Summe−1| > 2 pp", result.targetSumOff === true);
  check("A-Soll bleibt 0.50", a != null && approx(a.target, 0.50));
  check("B-Soll bleibt 0.20", b != null && approx(b.target, 0.20));
  check("Summe der Zeilen-Soll = 0.70", approx(result.rows.reduce((s, r) => s + r.target, 0), 0.70));
  check("Trade A = 0", a != null && approx(a.trade, 0) && a.side === "flat");
  check("Trade B = (0.20−0.50)×NAV = −3000 Sell", b != null && approx(b.trade, -3000) && b.side === "sell");
  check("exakt 2 pp löst keinen Banner aus", compareTargetActual({ A: 0.98 }, { A: 0.98 }, nav).targetSumOff === false);
  check("knapp über 2 pp löst den Banner aus", compareTargetActual({ A: 0.979 }, { A: 0.979 }, nav).targetSumOff === true);
}

console.log("\nFixture 2: Union, kein Inner-Join");
{
  const nav = 1_000;
  const result = compareTargetActual(
    { A: 0.6, B: 0.4 },
    { A: 1, C: 0 },
    nav,
  );
  const tickers = result.rows.map(r => r.ticker).sort();
  check("Union A, B, C", tickers.join(",") === "A,B,C");
  const onlyTarget = result.rows.find(r => r.ticker === "B");
  const onlyActual = result.rows.find(r => r.ticker === "C");
  check("nur Soll → Ist = 0", onlyTarget != null && approx(onlyTarget.actual, 0) && approx(onlyTarget.target, 0.4));
  check("nur Soll → Buy", onlyTarget != null && approx(onlyTarget.trade, 400) && onlyTarget.side === "buy");
  check("nur Ist → Soll = 0", onlyActual != null && approx(onlyActual.target, 0) && approx(onlyActual.actual, 0));
  const drift = compareTargetActual({ A: 1 }, { A: 0.7, C: 0.3 }, nav);
  const c = drift.rows.find(r => r.ticker === "C");
  check("Altlast C erscheint mit Soll 0", c != null && approx(c.target, 0) && approx(c.actual, 0.3));
  check("Altlast C ist Sell", c != null && approx(c.trade, -300) && c.side === "sell");
}

console.log("\nFixture 3: Cash-Mix — verschiedene Nenner, kein Plot");
{
  const onlyTargetCash = compareTargetActual(
    { A: 0.7, CASH: 0.3 },
    { A: 1 },
    50_000,
  );
  check("CASH nur im Soll → Mismatch", onlyTargetCash.denominatorMismatch === true);
  check("keine gemischte Zeile A", onlyTargetCash.rows.length === 0);
  check("KPIs bei Mismatch leer", onlyTargetCash.mae == null && onlyTargetCash.l1 == null);

  const onlyActualCash = compareTargetActual(
    { A: 1 },
    { A: 0.8, cash: 0.2 },
    50_000,
  );
  check("CASH nur im Ist → Mismatch", onlyActualCash.denominatorMismatch === true);
  check("Ist-CASH wird nicht als Soll 0 geführt", !onlyActualCash.rows.some(r => r.ticker === "CASH"));
}

console.log("\nFixture 4: CASH auf beiden Seiten (gleicher Nenner, Typ B)");
{
  const nav = 2_000;
  const result = compareTargetActual(
    { A: 0.4, CASH: 0.6 },
    { A: 0.5, Cash: 0.5 },
    nav,
  );
  check("kein Mismatch", result.denominatorMismatch === false);
  const cash = result.rows.find(r => r.ticker === "CASH");
  check("CASH in der Union", cash != null && approx(cash.target, 0.6) && approx(cash.actual, 0.5));
  check("Active CASH = Ist − Soll", cash != null && approx(cash.active, -0.1));
  check("Trade CASH = (Soll − Ist) × NAV Buy", cash != null && approx(cash.trade, 200) && cash.side === "buy");
}

console.log("\nFixture 5: Schwellen 25 bp / 100 bp, MAE, Turnover, Off-Count");
{
  const result = compareTargetActual(
    { ON: 0.10, EDGE25: 0.10, SLIGHT: 0.10, EDGE100: 0.10, OFF: 0.10 },
    { ON: 0.1024, EDGE25: 0.1025, SLIGHT: 0.1099, EDGE100: 0.11, OFF: 0.12 },
    100,
  );
  const status = (ticker: string) => result.rows.find(r => r.ticker === ticker)?.status;
  check("|a| = 24 bp on target", status("ON") === "on_target");
  check("|a| = 25 bp nicht mehr on target", status("EDGE25") === "slight");
  check("|a| = 99 bp leicht off", status("SLIGHT") === "slight");
  check("|a| = 100 bp off target", status("EDGE100") === "off");
  check("|a| = 200 bp off target", status("OFF") === "off");
  const l1 = 0.0024 + 0.0025 + 0.0099 + 0.01 + 0.02;
  check("L1 = Σ|a|", result.l1 != null && approx(result.l1, l1));
  check("Turnover = L1/2", result.turnover != null && approx(result.turnover, l1 / 2));
  check("MAE = L1/n", result.mae != null && result.n === 5 && approx(result.mae, l1 / 5));
  check("Max |Active|", result.maxAbsActive != null && approx(result.maxAbsActive, 0.02));
  check("Off-Count zählt nur off target", result.offCount === 2);
  check("Sortierung |Active| absteigend", result.rows.map(r => r.ticker).join(",") === "OFF,EDGE100,SLIGHT,EDGE25,ON");
}

console.log("\nFixture 6: Trade = (Soll − Ist) × NAV, Vorzeichen");
{
  const nav = 990_969;
  const result = compareTargetActual(
    { A: 0.6, B: 0.4 },
    { A: 0.5, B: 0.5 },
    nav,
  );
  const a = result.rows.find(r => r.ticker === "A");
  const b = result.rows.find(r => r.ticker === "B");
  check("A Buy", a != null && approx(a.trade, 0.1 * nav) && a.side === "buy" && approx(a.active, -0.1));
  check("B Sell", b != null && approx(b.trade, -0.1 * nav) && b.side === "sell" && approx(b.active, 0.1));
  check("ungültiges NAV → Trade 0", compareTargetActual({ A: 1 }, { A: 0 }, Number.NaN).rows[0]?.trade === 0);

  const tiny = compareTargetActual(
    { TINY: 0.001, BIG: 0.5 },
    { TINY: 0.001, BIG: 0.4 },
    100,
  );
  check("unter displayFloor nicht im Chart", tiny.chartRows.every(r => r.ticker !== "TINY"));
  check("unter displayFloor bleibt in der Tabelle", tiny.rows.some(r => r.ticker === "TINY"));
  check("Chart renormiert BIG nicht", approx(tiny.chartRows.find(r => r.ticker === "BIG")?.target ?? NaN, 0.5));
}

console.log("\n§2 CDNS — MktVal / P&L / P&L% auf 1 USD / 1 bp");
{
  const qty = 133;
  const cost = 316.17;
  const price = 347.55;
  const mkt = computeMarketValue(qty, price);
  const pnl = qty * (price - cost);
  const pnlPct = computePositionPerformance(cost, price, "long");
  check("MktVal 46 224.15", mkt != null && approx(mkt, 46_224.15, 1e-6));
  check("MktVal gerundet auf 1 USD", mkt != null && Math.abs(Math.round(mkt) - 46_224) <= 1);
  check("P&L 4 173.54", approx(pnl, 4_173.54, 1e-6));
  check("P&L gerundet auf 1 USD", Math.abs(Math.round(pnl) - 4_174) <= 1);
  check("P&L% ≈ 9.925 %", pnlPct != null && approx(pnlPct, 31.38 / 316.17, 1e-6));
  check("P&L% Anzeige 9.93 % auf 1 bp", pnlPct != null && Math.abs(Math.round(pnlPct * 10_000) - 993) <= 1);

  const mktRounded = 46_224;
  const typeA = mktRounded / 990_969;
  const typeB = mktRounded / 1_021_589;
  check("Typ A ≠ Typ B", Math.abs(typeA - typeB) > 0.001);
  const same = compareTargetActual({ CDNS: typeA }, { CDNS: typeA }, 990_969);
  check("übergebener Nenner bleibt unverändert", same.rows[0] != null && approx(same.rows[0].actual, typeA) && approx(same.rows[0].target, typeA));
  check("kein stilles Umschalten auf Typ B", same.rows[0] != null && Math.abs(same.rows[0].actual - typeB) > 0.001);
  check("gleiche Gewichte → flat, Trade 0", same.rows[0] != null && same.rows[0].side === "flat" && approx(same.rows[0].trade, 0));
}

console.log(failed === 0 ? "\n✅ Alle compareTargetActual-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
