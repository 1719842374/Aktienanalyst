/**
 * W7b Technical Override (Philip 11.10.2026 22:52) — generisch, synthetische Kursreihen, kein Ticker.
 * Run: npx tsx script/test-technical-override.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  adaptiveTechnicalStrength, valuationDamping, moatNegStrength, adaptiveCap, MIN_HISTORY_DAYS,
} from "../shared/adaptive-signals";
import { buildBiasDecision, OVERALL_NEUTRAL_BAND } from "../shared/bias-fixes";
import { buildAdaptiveGates } from "../server/scoring-integration";
import { applyGates } from "../server/scoring-gates";

const N = MIN_HISTORY_DAYS + 400;
const up = Array.from({ length: N }, (_, i) => 100 * Math.exp(0.0004 * i + 0.02 * Math.sin(i / 15)));
const crash = Array.from({ length: N }, (_, i) => (i < N - 250 ? up[i] : up[N - 251] * Math.exp(-0.002 * (i - (N - 251)))));
const bull = { priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true };
const bear = { priceAboveMA200: false, ma50AboveMA200: false, macdAboveZero: false };

// 1) Kein Death Cross + solider Moat → volle Valuation, kein Cap
const tUp = adaptiveTechnicalStrength(up, bull)!;
assert.equal(tUp.method, "history"); assert.equal(tUp.negStrength, 0);
assert.equal(valuationDamping(tUp.negStrength, moatNegStrength(4)), 0, "Valuation voll");
assert.equal(adaptiveCap(OVERALL_NEUTRAL_BAND, tUp, 4).cap, null, "kein Cap");

// 2) Death Cross + schwacher RSL (relativ zur eigenen Historie) → Dämpfung > 0, Cap im NEUTRAL-Band
const tDn = adaptiveTechnicalStrength(crash, bear)!;
assert.ok(tDn.deathCross && tDn.rslWeak && tDn.negStrength > 0.5, JSON.stringify(tDn));
const d = valuationDamping(tDn.negStrength, moatNegStrength(1));
assert.ok(d > 0 && d < 1);
const cap = adaptiveCap(OVERALL_NEUTRAL_BAND, tDn, 1).cap!;
assert.ok(cap >= OVERALL_NEUTRAL_BAND.low && cap < OVERALL_NEUTRAL_BAND.high, `cap ${cap}`);

// 3) Fallback ohne Historie: binär, dokumentiert
const tShort = adaptiveTechnicalStrength(crash.slice(-300), bear)!;
assert.equal(tShort.method, "binary");

// 4) Pipeline 0–100: TECHNICAL_NEGATIVE deckelt; Valuation (hoher qualityScore) kann den Cap nicht überschreiben
const gates = buildAdaptiveGates(crash, bear, 1);
const tg = gates.find(g => g.id === "TECHNICAL_NEGATIVE")!;
assert.ok(tg.active && tg.cap < 65 && tg.cap >= 50);
assert.equal(applyGates(100, 1.1, gates).score, Math.min(...gates.filter(g => g.active).map(g => g.cap)));
const gOk = buildAdaptiveGates(up, bull, 3);
assert.ok(gOk.every(g => !g.active), "kein Gate bei Aufwärtstrend + Wide");

// 5) Fixture MSFT (script/fixtures, live 11.10.2026): kein Death Cross → Gesamtscore unverändert, keine Dämpfung
const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const b = buildBiasDecision(msft);
assert.equal(b.valuationDamping, 0);
assert.equal(b.overallScore, b.overallScoreUndamped);
console.log("test-technical-override: OK", { capNeg: cap.toFixed(2), damping: d.toFixed(3), techNeg: tDn.negStrength.toFixed(2), msft: b.overallScore.toFixed(2) });
