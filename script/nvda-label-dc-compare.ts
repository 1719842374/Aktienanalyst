/**
 * DC-Nachzug 1–3. Vergleicht den Arbeitsbaum mit den Modulen von ed1e98cd.
 * Die Snapshot-Dateien legt script/test-nvda-label-s01-s02-t104-s07.ts vorher an
 * und entfernt sie danach. Dieses Skript wird nur von dort gestartet.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyBiasFix } from "../shared/bias-fixes";
import { buildFazitSignal, prepareFazitMetrics } from "../client/src/lib/fazit-signal";
import { buildFazitSignal as buildFazitSignalMain, prepareFazitMetrics as prepareFazitMetricsMain } from "../client/src/lib/fazit-signal-ed1e98cd-snapshot";
import { attachExecSummary, fazitRatingForLage } from "../server/exec-summary-attach";
import { attachExecSummary as attachExecSummaryMain } from "../server/exec-summary-attach-ed1e98cd-snapshot";

const BASE = "ed1e98cdf17bca6251650d2eb2c1825e850c6530";
const files = [
  ["MSFT", "script/fixtures/analysis-MSFT.json"],
  ["SHEL.L", "script/fixtures/analysis-SHEL.L.json"],
  ["SPY", "script/fixtures/analysis-SPY.json"],
  ["VOW3.DE", "script/fixtures/analysis-VOW3.DE-negfcf.json"],
] as const;

function load(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8"));
}

function guard(sig: {
  score: number;
  rating: string;
  ratingColor: string;
  ratingBg: string;
  positive: string[];
  negative: string[];
  neutral: string[];
  dcfDivergenceDowngraded: boolean;
  techMoatDowngraded: boolean;
  fazitSatz: string;
}) {
  return {
    score: sig.score,
    rating: sig.rating,
    ratingColor: sig.ratingColor,
    ratingBg: sig.ratingBg,
    positive: sig.positive.length,
    negative: sig.negative.length,
    neutral: sig.neutral.length,
    dcfDivergenceDowngraded: sig.dcfDivergenceDowngraded,
    techMoatDowngraded: sig.techMoatDowngraded,
    fazitSatz: sig.fazitSatz,
  };
}

function onlyTechnicalText(mainLines: string[], headLines: string[], bucket: string): void {
  assert.equal(mainLines.length, headLines.length, bucket);
  for (let i = 0; i < mainLines.length; i++) {
    if (mainLines[i] === headLines[i]) continue;
    assert.match(mainLines[i], /^Technisch:/, `${bucket}[${i}] main`);
    assert.match(headLines[i], /^Technisch:/, `${bucket}[${i}] head`);
  }
}

function withoutLageAndCross(summary: { fazit?: { lage?: string }; crossLine?: string }) {
  const copy = structuredClone(summary);
  if (copy.fazit) copy.fazit.lage = "";
  copy.crossLine = "";
  return copy;
}

function run(name: string, data: Record<string, unknown>): void {
  const rawMain = structuredClone(data);
  const rawHead = structuredClone(data);
  delete rawMain.execSummary;
  delete rawHead.execSummary;
  const mainAttached = attachExecSummaryMain(rawMain);
  const headAttached = attachExecSummary(rawHead);
  assert.deepEqual(mainAttached.scoring ?? null, headAttached.scoring ?? null, `${name} scoring`);
  assert.deepEqual(mainAttached.biasFix ?? null, headAttached.biasFix ?? null, `${name} biasFix`);
  assert.equal(
    mainAttached.technicalIndicators?.currentStatus?.buySignal,
    headAttached.technicalIndicators?.currentStatus?.buySignal,
    `${name} buySignal`,
  );
  assert.deepEqual(
    withoutLageAndCross(mainAttached.execSummary),
    withoutLageAndCross(headAttached.execSummary),
    `${name} execSummary außer lage und crossLine`,
  );

  const mainData = structuredClone(data);
  const headData = structuredClone(data);
  const mainSig = buildFazitSignalMain({ data: mainData, ...prepareFazitMetricsMain(mainData) });
  const headSig = buildFazitSignal({ data: headData, ...prepareFazitMetrics(headData) });
  assert.deepEqual(guard(mainSig), guard(headSig), `${name} Signal gegen ${BASE}`);
  onlyTechnicalText(mainSig.positive, headSig.positive, `${name} positive`);
  onlyTechnicalText(mainSig.negative, headSig.negative, `${name} negative`);
  onlyTechnicalText(mainSig.neutral, headSig.neutral, `${name} neutral`);
  assert.equal(fazitRatingForLage(structuredClone(data)), headSig.rating, `${name} fazitRatingForLage`);
  console.log("  ✓", name, headSig.rating, headSig.score);
}

for (const [name, path] of files) {
  const raw = load(path);
  run(`${name} roh`, raw);
  run(`${name} nach applyBiasFix`, applyBiasFix(structuredClone(raw)));
}
console.log("dc-compare ok");
