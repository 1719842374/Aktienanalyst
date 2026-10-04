/**
 * C2 fixture tests — WALCL/RRP/TGA net liquidity + regime score.
 * Run: bun script/test-liquidity-regime.ts
 */
import {
  type FredObs,
  alignWeekly,
  classifyPolicy,
  computeLiquidityMetrics,
  delta13w,
  excessMoneyGrowth,
  emgHistoryOk,
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
ok("kurzes Fenster: EMG null", metrics.excessMoneyGrowth == null);
ok("score 0–100", metrics.regimeScore >= 0 && metrics.regimeScore <= 100);
ok("label is enum", ["expansiv", "neutral", "restriktiv"].includes(metrics.regimeLabel));
ok("source names FRED series", /WALCL/.test(metrics.source) && /RRPONTSYD/.test(metrics.source) && /WTREGEN/.test(metrics.source));

const pipeOnly = computeLiquidityMetrics({ walcl, rrp, tga });
ok("ohne M2: quality.m2 false", pipeOnly.dataQuality.m2 === false);
ok("ohne M2: excess null", pipeOnly.excessMoneyGrowth == null);
// v1-Score (Ruecksichtskompatibilitaet, separates Feld) bleibt exakt = plumbing
// ohne M2-Daten — der Haupt-regimeScore ist seit v2 IMMER eine Mischung aus
// Plumbing+Spec+Policy, auch ohne M2 faellt Spec dann auf pipe zurueck, aber
// der Policy-Anteil (20%) bleibt bestehen, also regimeScore != plumbing exakt.
ok("ohne M2: regimeScoreV1 = plumbing", pipeOnly.regimeScoreV1 === plumbingScore(d13));
ok("regimeScore(v2) enthaelt Policy-Anteil", typeof pipeOnly.policyScore === "number" && pipeOnly.policyScore >= 0 && pipeOnly.policyScore <= 100);
ok("policyRegime ist einer der 4 erlaubten Werte", ["QT", "QT_ended_RMP", "QE", "twist_treasury"].includes(pipeOnly.policyRegime));
ok("durationImpulse ist einer der 3 erlaubten Werte", ["easing", "neutral", "tightening"].includes(pipeOnly.durationImpulse));

const drain = wednesdays(20).map((p, i) => ({ ...p, value: 6_800_000 - i * 40_000 }));
const drained = computeLiquidityMetrics({ walcl: drain, rrp, tga });
ok("drain 13w → restriktiv oder <70", drained.regimeScore < 70, String(drained.regimeScore));

// ─── Policy-Classifier: Twist nur bei explizitem Cap, nicht per Kalender ──
const noCap = classifyPolicy({ asOf: "2026-09-15" });
ok("ohne Cap, nach QT-Ende: QT_ended_RMP", noCap.policyRegime === "QT_ended_RMP");
ok("ohne Cap: treasuryDurationActive=false", noCap.treasuryDurationActive === false);
ok("ohne Cap: durationImpulse=neutral", noCap.durationImpulse === "neutral");
ok("ohne Cap: policyScore=55", noCap.policyScore === 55);

const belowCap = classifyPolicy({ asOf: "2026-09-15", buybackCapLongBnValue: 3 });
ok("Cap 3 bleibt unter der Schwelle", belowCap.policyRegime === "QT_ended_RMP" && belowCap.treasuryDurationActive === false);

const withCap = classifyPolicy({ asOf: "2026-09-15", buybackCapLongBnValue: 4 });
ok("Cap 4: twist_treasury (nicht QE)", withCap.policyRegime === "twist_treasury");
ok("Cap 4: treasuryDurationActive=true", withCap.treasuryDurationActive === true);
ok("Cap 4: durationImpulse=easing", withCap.durationImpulse === "easing");
ok("Cap 4: policyScore=65 (55 Basis + 10 Twist)", withCap.policyScore === 65);

const withTgaDrain = classifyPolicy({ asOf: "2026-09-15", buybackCapLongBnValue: 4, tgaDelta4wBn: -60 });
ok("Twist + TGA-Drain <-50: policyScore=75 (55+10+10)", withTgaDrain.policyScore === 75);

const withQe = classifyPolicy({ asOf: "2026-06-15", notesBondsDelta13wBn: 50 });
ok("explizites QE-Signal (Notes/Bonds-Aufbau) -> QE, nicht twist", withQe.policyRegime === "QE");
ok("QE: policyScore=90", withQe.policyScore === 90);

const withQeAndTwist = classifyPolicy({ asOf: "2026-09-15", notesBondsDelta13wBn: 50, buybackCapLongBnValue: 4 });
ok("QE + Cap 4: Twist-Zuschlag ist additiv (90+10=100, Deckel)", withQeAndTwist.policyScore === 100);

const metricsNoCalendar = computeLiquidityMetrics({ walcl, rrp, tga });
ok("ohne Instrument kein Treasury-Twist", metricsNoCalendar.treasuryDurationActive === false);

const duringQt = classifyPolicy({ asOf: "2025-06-01" });
ok("vor QT-Ende (1.12.2025): policyRegime=QT", duringQt.policyRegime === "QT");
ok("vor QT-Ende: durationImpulse=tightening", duringQt.durationImpulse === "tightening");
ok("vor QT-Ende: policyScore=25", duringQt.policyScore === 25);

function quarterly(n: number, startVal: number, step: number, start = "2021-01-01"): FredObs[] {
  const out: FredObs[] = [];
  const d = new Date(`${start}T00:00:00.000Z`);
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), value: startVal + i * step });
    d.setUTCMonth(d.getUTCMonth() + 3);
  }
  return out;
}

const m2Long = monthly(24, 100, 1, "2024-07-01");
const cpiLong = monthly(24, 100, 0.2, "2024-07-01");
const gdpLong = quarterly(20, 100, 1);
const m2vLong = quarterly(20, 1.3, 0.001);
ok("20 Quartale und 24 Monate decken EMG", emgHistoryOk({ m2: m2Long, cpi: cpiLong, gdp: gdpLong, m2v: m2vLong }));
const wide = computeLiquidityMetrics({ walcl, rrp, tga, m2: m2Long, cpi: cpiLong, gdp: gdpLong, m2v: m2vLong });
ok("langes Fenster: EMG ist eine Zahl", wide.excessMoneyGrowth != null && Number.isFinite(wide.excessMoneyGrowth), String(wide.excessMoneyGrowth));

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
