/**
 * Adaptive Aktien-Score (shared/adaptive-signals.ts) — Run: npx tsx script/test-adaptive-stock-score.ts
 * Fixtures: script/fixtures/adaptive-score/*.json (echte Live-Antworten 11.10.2026, gekürzt).
 */
import fs from "fs";
import path from "path";
import {
  toStrength, technicalSignal, valuationSignal, momentumSignal, moatSignal, betaSignal,
  computeAdaptiveScore, adaptiveScoreFromAnalysis, ADAPTIVE_CONFIG, type AdaptiveSignal,
} from "../shared/adaptive-signals";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; } else { fail++; console.error(`FAIL ${name} ${detail}`); }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

// toStrength
check("toStrength(0)=0", toStrength(0) === 0);
check("toStrength(1.25)=0.5", near(toStrength(1.25), 0.5));
check("toStrength(-5)=1", toStrength(-5) === 1);
check("toStrength(NaN)=0", toStrength(NaN) === 0);

// Technical weights
const allBear = { technicalIndicators: { currentStatus: { priceAboveMA200: false, ma50AboveMA200: false, macdAboveZero: false } } };
const tb = technicalSignal(allBear);
check("tech allBear ohne RSL renormiert → -1/1", tb.direction === -1 && near(tb.strength, 1));
const onlyDC = technicalSignal({ technicalIndicators: { currentStatus: { priceAboveMA200: true, ma50AboveMA200: false, macdAboveZero: true } } });
// bull 0.3+0.2=0.5, bear 0.4 → net 0.1/0.9
check("tech nur Death Cross → +0.111", onlyDC.direction === 1 && near(onlyDC.strength, 0.1 / 0.9));
check("tech ohne Daten → n/a", technicalSignal({}).available === false);

// Valuation n/a bei <3 Peers
check("valuation <3 Peers → n/a", valuationSignal({ peRatio: 10, peerComparison: { subject: { pe: 10 }, peers: [{ pe: 20 }, { pe: 30 }] } }).available === false);
const v = valuationSignal({ peerComparison: { subject: { pe: 10 }, peers: [{ pe: 20 }, { pe: 30 }, { pe: 25 }] } });
check("valuation günstig → +, z=3", v.direction === 1 && near(v.z!, 3) && v.strength === 1);

// Momentum n/a ohne 2J+12M Historie
const shortHp = Array.from({ length: 500 }, (_, i) => ({ date: `2024-${String(i).padStart(4, "0")}`, close: 100 + i }));
check("momentum <2J → n/a", momentumSignal({ historicalPrices: shortHp }).available === false);

// Moat
check("moat <3 Kräfte → n/a", moatSignal({ moatAssessment: { porterForces: [{ score: 1 }, { score: 2 }] } }).available === false);
const m5 = moatSignal({ moatAssessment: { porterForces: [{ score: 5 }, { score: 5 }, { score: 5 }] } });
check("moat Bedrohung 5 → -1, z=-√2", m5.direction === -1 && near(m5.z!, -Math.SQRT2));

// Low-Beta
const techBear: AdaptiveSignal = { id: "technical", label: "", direction: -1, strength: 0.7, available: true, z: null, basis: "" };
const techBull: AdaptiveSignal = { ...techBear, direction: 1 };
const lb1 = betaSignal({ beta5Y: 0.5 }, techBear);
check("Low-Beta + tech bärisch >0.6 → -1/0.3", lb1.direction === -1 && lb1.strength === 0.3);
check("Low-Beta + tech bullisch → 0 (kein Plus)", betaSignal({ beta5Y: 0.5 }, techBull).direction === 0);
check("Low-Beta + tech bärisch 0.5 → 0", betaSignal({ beta5Y: 0.5 }, { ...techBear, strength: 0.5 }).direction === 0);
check("Beta n/a → n/a", betaSignal({}, techBear).available === false);

// Gewichte + Dämpfung + net/max
const sig = (id: AdaptiveSignal["id"], d: 1 | -1 | 0, s: number): AdaptiveSignal => ({ id, label: id, direction: d, strength: s, available: true, z: null, basis: "" });
const r = computeAdaptiveScore([sig("technical", -1, 0.8), sig("valuation", 1, 0.6)]);
const wT = 0.8 + 0.8 * 0.7, wV = (0.8 + 0.6 * 0.7) * (1 - 0.8 * ADAPTIVE_CONFIG.VALUATION_DAMPING);
check("w = 0.8 + s·0.7 (technical)", near(r.signals[0].weight, wT));
check("Valuation gedämpft bei techStrength 0.8", r.signals[1].damped && near(r.signals[1].weight, wV));
check("score = net/max", near(r.score!, Math.round(((-wT * 0.8 + wV * 0.6) / (wT + wV)) * 1000) / 1000));
const r2 = computeAdaptiveScore([sig("technical", -1, 0.4), sig("valuation", 1, 0.6)]);
check("keine Dämpfung bei techStrength 0.4", !r2.signals[1].damped);
check("damping-Parameter wirkt", computeAdaptiveScore([sig("technical", -1, 0.8), sig("valuation", 1, 0.6)], 0.2).signals[1].weight > wV);
check("leer → score null, rating n/a", computeAdaptiveScore([]).score === null && computeAdaptiveScore([]).rating === "n/a");
check("Beta neutral verwässert max nicht", computeAdaptiveScore([sig("technical", 1, 1), sig("beta", 0, 0)]).score === 1);

// Echte Ticker: Vorher/Nachher
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures/adaptive-score");
console.log("\nTicker | Lynch | Zählung alt (pos/neg/neu = score → Rating) | adaptiv score → Rating");
const res: Record<string, { old: number; adaptive: number | null; rating: string }> = {};
for (const t of ["NVO", "MSFT", "KO", "NVDA"]) {
  const fx = JSON.parse(fs.readFileSync(path.join(dir, `${t}.json`), "utf8"));
  const a = adaptiveScoreFromAnalysis(fx);
  const o = fx._meta.oldCount;
  res[t] = { old: o.score, adaptive: a.score, rating: a.rating };
  console.log(`${t} | ${fx._meta.lynchClass} | ${o.positive}/${o.negative}/${o.neutral} = ${o.score} → ${o.rating} | ${a.score} → ${a.rating}`);
  console.log("   " + a.signals.map(s => s.available ? `${s.id} ${s.direction}/${s.strength.toFixed(2)} w${s.weight.toFixed(2)}${s.damped ? "*" : ""}` : `${s.id} n/a`).join(" · "));
  check(`${t} score in [-1,1]`, a.score != null && a.score >= -1 && a.score <= 1);
}
// NVO: alte Zählung 9/6 (+3, LEICHT ATTRAKTIV) → adaptiv defensiver (negativ)
check("NVO defensiver als 9/6-Zählung", res.NVO.adaptive! < 0 && /UNATTRAKTIV/.test(res.NVO.rating));
const nvo = adaptiveScoreFromAnalysis(JSON.parse(fs.readFileSync(path.join(dir, "NVO.json"), "utf8")));
check("NVO Low-Beta zählt negativ", nvo.signals.find(s => s.id === "beta")!.direction === -1);
check("NVO Valuation gedämpft", nvo.signals.find(s => s.id === "valuation")!.damped);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
