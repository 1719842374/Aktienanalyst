/**
 * C2 fixture tests — WALCL/RRP/TGA net liquidity + regime score.
 * Run: bun script/test-liquidity-regime.ts
 */
import {
  type FredObs,
  alignWeekly,
  computeLiquidityMetrics,
  delta13w,
  excessMoneyGrowth,
  excessMoneyScore,
  friedmanKorridorScore,
  netLiquidityBn,
  plumbingScore,
  regimeFromScore,
  rrpToBn,
  tgaToBn,
  walclToBn,
} from "../server/liquidity-regime-math";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

function wednesdays(n: number, start = "2026-01-07"): FredObs[] {
  const out: FredObs[] = [];
  const d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), value: 6_500_000 + i * 10_000 });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function dailyRrp(nDays: number, start = "2026-01-01"): FredObs[] {
  const out: FredObs[] = [];
  const d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < nDays; i++) {
    out.push({ date: d.toISOString().slice(0, 10), value: 400 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function weeklyTga(n: number, start = "2026-01-07"): FredObs[] {
  const out: FredObs[] = [];
  const d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), value: 700_000 });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function monthly(n: number, startVal: number, step: number, start = "2024-07-01"): FredObs[] {
  const out: FredObs[] = [];
  const d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 7) + "-01", value: startVal + i * step });
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

console.log("C2 liquidity-regime fixtures");

ok("WALCL millions → bn", walclToBn(6_600_000) === 6600);
ok("TGA millions → bn", tgaToBn(700_000) === 700);
ok("RRP already bn", rrpToBn(400) === 400);
ok("net = WALCL − RRP − TGA", netLiquidityBn(6600, 400, 700) === 5500);

const walcl = wednesdays(20);
const rrp = dailyRrp(160);
const tga = weeklyTga(20);
const aligned = alignWeekly(walcl, rrp, tga);
ok("align ≥ 14 weekly points", aligned.length >= 14, `n=${aligned.length}`);
ok("first net 6500-400-700", Math.abs(aligned[0].netBn - 5400) < 0.2, String(aligned[0].netBn));
const d13 = delta13w(aligned);
ok("13w delta = 13 × 10bn", d13 != null && Math.abs(d13 - 130) < 0.2, String(d13));
ok("plumbing +130 → ~83", plumbingScore(130) === 83, String(plumbingScore(130)));
ok("plumbing null → 50", plumbingScore(null) === 50);
ok("ampel 83 expansiv", regimeFromScore(83) === "expansiv");
ok("ampel 55 neutral", regimeFromScore(55) === "neutral");
ok("ampel 20 restriktiv", regimeFromScore(20) === "restriktiv");

ok("excess 5.5-2-3=0.5", Math.abs(excessMoneyGrowth(5.5, 2, 3) - 0.5) < 1e-9);
ok("excessScore 0.5 in 45–69", (() => {
  const s = excessMoneyScore(0.5);
  return s >= 45 && s <= 69;
})(), String(excessMoneyScore(0.5)));
ok("friedman 4% in 80–100", (() => {
  const s = friedmanKorridorScore(4);
  return s >= 80 && s <= 100;
})(), String(friedmanKorridorScore(4)));

const m2 = monthly(16, 22_000, 80);
const cpi = monthly(16, 300, 0.7);
const gdp = monthly(16, 23_000, 100);
const m2v: FredObs[] = [
  { date: "2025-04-01", value: 1.39 },
  { date: "2025-07-01", value: 1.40 },
  { date: "2025-10-01", value: 1.405 },
  { date: "2026-01-01", value: 1.41 },
  { date: "2026-04-01", value: 1.412 },
];

const metrics = computeLiquidityMetrics({ walcl, rrp, tga, m2, m2v, gdp, cpi });
ok("asOf is last WALCL date", metrics.asOf === aligned[aligned.length - 1].date);
ok("netLiquidity set", metrics.netLiquidityBn != null && metrics.netLiquidityBn > 5000);
ok("delta13w set", metrics.netLiquidityDelta13wBn != null);
ok("WALCL/RRP/TGA quality", metrics.dataQuality.walcl && metrics.dataQuality.rrp && metrics.dataQuality.tga);
ok("m2 overlay quality", metrics.dataQuality.m2);
ok("score 0–100", metrics.regimeScore >= 0 && metrics.regimeScore <= 100);
ok("label is enum", ["expansiv", "neutral", "restriktiv"].includes(metrics.regimeLabel));
ok("source names FRED series", /WALCL/.test(metrics.source) && /RRPONTSYD/.test(metrics.source) && /WTREGEN/.test(metrics.source));

const pipeOnly = computeLiquidityMetrics({ walcl, rrp, tga });
ok("ohne M2: quality.m2 false", pipeOnly.dataQuality.m2 === false);
ok("ohne M2: excess null", pipeOnly.excessMoneyGrowth == null);
ok("ohne M2: score = plumbing", pipeOnly.regimeScore === plumbingScore(d13));

const drain = wednesdays(20).map((p, i) => ({ ...p, value: 6_800_000 - i * 40_000 }));
const drained = computeLiquidityMetrics({ walcl: drain, rrp, tga });
ok("drain 13w → restriktiv oder <70", drained.regimeScore < 70, String(drained.regimeScore));

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
