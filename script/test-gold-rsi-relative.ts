/** #214-Fix: Perzentil, RSI-z und Text des relativen RSI muessen dieselbe Seite zeigen. */
import assert from "node:assert/strict";
import { buildGoldTechnical, describeRelativeRsi, volumeLegendText } from "../client/src/components/gold/goldTechnical";
import { scoreGoldAdaptive } from "../server/gold-adaptive-score";

function series(tail: "down" | "up") {
  const closes: { date: string; close: number }[] = [];
  let p = 2000;
  const start = Date.UTC(2023, 0, 2);
  for (let i = 0; i < 620; i++) {
    const wiggle = Math.sin(i / 3) * 12 + Math.sin(i / 11) * 20;
    if (i > 600) p *= tail === "down" ? 0.985 : 1.015;
    closes.push({ date: new Date(start + i * 86400000).toISOString().slice(0, 10), close: +(p + wiggle).toFixed(2) });
  }
  return closes;
}

for (const tail of ["down", "up"] as const) {
  const closes = series(tail);
  const tech = buildGoldTechnical(closes.map(c => ({ date: c.date, close: c.close })) as any);
  const adaptive = scoreGoldAdaptive({
    closes, volumes: null, volumeSource: null, real10Y: [], fedFunds: [], m2: [], walcl: [], tga: null,
    rrpBillions: null, breakeven: [], dxy: [], aisc: null, regime: null, newsFlag: null,
  });
  const sig = adaptive.layers.flatMap((l: any) => l.signals ?? []).find((s: any) => s.id === "technical.rsi");
  assert.ok(sig?.available, `${tail}: RSI-Signal verfuegbar`);
  assert.ok(tech.rsiPercentile != null);
  const d = describeRelativeRsi(tech.rsiPercentile, tech.rsiHistoryDays, sig.z);
  if (tail === "down") {
    assert.ok(tech.rsiPercentile! < 20, `down: Perzentil niedrig (${tech.rsiPercentile})`);
    assert.ok(sig.z > 0, "down: Server-Richtung bullisch (z>0)");
    assert.ok(d.rsiZ! < 0, "down: RSI-z negativ");
    assert.match(d.title, /niedrig gegen die eigene Historie = bullisch/);
    assert.doesNotMatch(d.title, /hoch/);
  } else {
    assert.ok(tech.rsiPercentile! > 80, `up: Perzentil hoch (${tech.rsiPercentile})`);
    assert.ok(sig.z < 0 && d.rsiZ! > 0);
    assert.match(d.title, /hoch gegen die eigene Historie = bärisch/);
  }
  assert.ok(d.consistent, `${tail}: konsistent`);
  console.log(`ok ${tail}: ${d.label} | ${d.title}`);
}

// Der gemeldete Fall: P15 mit Server-z=0,98 -> RSI-z=-0,98, niedrig, bullisch.
const rep = describeRelativeRsi(15, 504, 0.98);
assert.equal(rep.rsiZ, -0.98);
assert.match(rep.title, /RSI-z=-0\.98: niedrig gegen die eigene Historie = bullisch/);
assert.ok(rep.consistent);
assert.equal(describeRelativeRsi(15, 504, -0.98).consistent, false);

// Legende: Praefix nur einmal.
const v = volumeLegendText("Volumen-Spike (>1,5× Ø20T)", "Volumen-Spike: z=0.40, Stärke 0.38");
assert.equal(v, "Volumen-Spike (>1,5× Ø20T): z=0.40, Stärke 0.38");
assert.equal((v.match(/Volumen-Spike/g) ?? []).length, 1);
assert.equal(volumeLegendText("Volumen-Divergenz", "Volumen-Divergenz: z=-0.10, Stärke 0.10"), "Volumen-Divergenz: z=-0.10, Stärke 0.10");
console.log("test-gold-rsi-relative: alle Checks ok");
