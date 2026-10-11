/** W7: shared/adaptive-signals.ts — Formeln laut Future_Work.md „Volle Adaptivität“. Run: npx tsx script/test-adaptive-signals.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { toStrength, technicalStrength, moatStrength, lowBetaSignal, deriveBaseWeights, computeAdaptiveScore, adaptiveRating, binarySignal } from "../shared/adaptive-signals";
import { calibrateDamping } from "./calibrate-damping";
import { prepareFazitMetrics, buildFazitSignal } from "../client/src/lib/fazit-signal";
import { generateAnalysisHTML } from "../server/pdf-export";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
close(toStrength(1.25), 0.5); close(toStrength(-5), 1);
const t = technicalStrength({ deathCross: true, belowMA200: true, macdNeg: false, rslWeak: false });
close(t.strength, 0.7); assert.equal(t.direction, -1);
const t2 = technicalStrength({ deathCross: true, belowMA200: false, macdNeg: false, rslWeak: true });
close(t2.strength, 0.5); assert.equal(t2.direction, 1, "raw 0.5 ist nicht > 0.5");
const m = moatStrength(4); assert.equal(m.direction, 1); close(m.strength, 0.4);
const m0 = moatStrength(-3); close(m0.strength, toStrength((0 - 2.5) / 1.5)); // auf 0 geklemmt
assert.equal(lowBetaSignal(0.75, 0), null, "nur beta < 0.7");
assert.equal(lowBetaSignal(0.5, 0.7)!.direction, -1); assert.equal(lowBetaSignal(0.5, 0.2)!.direction, 1);
close(lowBetaSignal(0.5, 0.2)!.strength, 0.3);
close(deriveBaseWeights([t])["technical"], 0.8 + 0.7 * 0.7);

// Dämpfung: Valuation-Gewicht *= (1 - tech*0.4) nur bei tech > 0.5
const v = binarySignal("v", "valuation", 1, "DCF");
const strongTech = technicalStrength({ deathCross: true, belowMA200: true, macdNeg: true, rslWeak: true });
const a = computeAdaptiveScore([v, strongTech]);
close(a.weights["v"], (0.8 + 0.5 * 0.7) * (1 - 1 * 0.4)); assert.ok(a.dampened);
close(a.score, (0.5 * a.weights["v"] - 1 * a.weights["technical"]) / (a.weights["v"] + a.weights["technical"]));
assert.ok(!computeAdaptiveScore([v, t2]).dampened);
assert.ok(a.score >= -1 && a.score <= 1);
assert.equal(adaptiveRating(0.2).color, "green"); assert.equal(adaptiveRating(0).rating, "NEUTRAL"); assert.equal(adaptiveRating(-0.2).color, "red");

// Kalibrier-Gerüst: ohne Daten n/a, kein Default
assert.equal(calibrateDamping([]).factor, null);

// App = PDF, kein pauschales Beta<0,8-Plus
delete process.env.ANTHROPIC_API_KEY;
const d = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
d.beta5Y = 0.75;
const fm = prepareFazitMetrics(d); const f = buildFazitSignal({ data: d, ...fm });
assert.ok(!f.positive.some(x => /Niedrige Volatilit/.test(x)), "kein Beta<0,8-Plus");
assert.ok(!f.signals.some(s => s.id === "lowBeta"), "0.75 ≥ 0.7 → kein Low-Beta-Signal");
if (!f.dcfDivergenceDowngraded) assert.equal(f.rating, adaptiveRating(f.adaptive.score).rating, "Rating aus adaptivem Score");
(async () => {
  const html = await generateAnalysisHTML(d);
  assert.equal(html.match(/FAZIT: ([^<]+)</)?.[1], f.rating, "PDF-Fazit = App");
  console.log("test-adaptive-signals: OK");
})().catch(e => { console.error(e); process.exit(1); });
