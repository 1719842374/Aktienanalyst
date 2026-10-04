/**
 * Stablecoin-Kanal: Z-Score-Bänder, Standardabweichung 0 = n/v, keine erfundene Nachfrage.
 * Kein DefiLlama-Aufruf.
 * Run: npx tsx script/test-stablecoin-zscore.ts
 */
import { readFileSync } from "node:fs";
import {
  adaptiveTBillSlots,
  capPointsFromSnapshot,
  changes30dFromCaps,
  composeStablecoinChannel,
  geniusStrengthSlot,
  mergeDailyCaps,
  repoIssuerReserveSeries,
  stablecoinGrowthZScore,
  type StablecoinCapSnapshot,
} from "../server/stablecoin-channel-math";
import { estimateTBillDemand, type StablecoinMarketSnapshot } from "../server/stablecoin-liquidity";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

function assertClose(name: string, actual: number | null, expected: number, tol = 1e-9) {
  ok(name, actual != null && Math.abs(actual - expected) <= tol, `actual=${actual} expected=${expected}`);
}

console.log("stablecoin z-score");

const above = stablecoinGrowthZScore([0, 0, 0, 0, 4]);
assertClose("z > 1.5", above.zScore, Math.sqrt(3.2));
ok("z > 1.5 gibt 1.5 Punkte", above.available === true && above.scorePoints === 1.5, JSON.stringify(above));

const atOnePointFive = stablecoinGrowthZScore([0, 0, 0, 3]);
assertClose("z = 1.5 exakt", atOnePointFive.zScore, 1.5);
ok("z = 1.5 gibt 1.0 Punkte", atOnePointFive.available === true && atOnePointFive.scorePoints === 1, JSON.stringify(atOnePointFive));

const mid = stablecoinGrowthZScore([1, 2, 3]);
assertClose("z = 1.0", mid.zScore, 1);
ok("z > 0.8 gibt 1.0 Punkte", mid.available === true && mid.scorePoints === 1, JSON.stringify(mid));

const quiet = stablecoinGrowthZScore([0, 2, 2]);
assertClose("z unter 0.8", quiet.zScore, Math.sqrt(3) / 3);
ok("z <= 0.8 gibt 0 Punkte", quiet.available === true && quiet.scorePoints === 0, JSON.stringify(quiet));

const flat = stablecoinGrowthZScore([4, 4, 4]);
ok(
  "Standardabweichung 0 ist n/v und 0 Punkte",
  flat.available === false && flat.zScore === null && flat.rollingStd30dChangeUsd === 0 && flat.scorePoints === 0,
  JSON.stringify(flat),
);

const lone = stablecoinGrowthZScore([9]);
ok(
  "eine Änderung hat keine Standardabweichung",
  lone.available === false && lone.zScore === null && lone.rollingStd30dChangeUsd === null && lone.scorePoints === 0,
  JSON.stringify(lone),
);

const empty = stablecoinGrowthZScore([]);
ok(
  "leere Reihe ist n/v und 0 Punkte",
  empty.available === false && empty.zScore === null && empty.scorePoints === 0,
  JSON.stringify(empty),
);

const snapshot: StablecoinCapSnapshot = {
  available: true,
  fetchedAt: "2026-09-30T12:00:00.000Z",
  totalMarketCapUsd: 300e9,
  totalMarketCapPrevMonthUsd: 290e9,
};
const points = capPointsFromSnapshot(snapshot);
ok(
  "ein Abruf speichert nur die beiden gelieferten Stände",
  points.length === 2
    && points.some(p => p.date === "2026-09-30" && p.totalMarketCapUsd === 300e9)
    && points.some(p => p.date === "2026-08-31" && p.totalMarketCapUsd === 290e9),
  JSON.stringify(points),
);
const gap = points.filter(p => p.date > "2026-08-31" && p.date < "2026-09-30");
ok("zwischen den beiden Ständen wird nichts erfunden", gap.length === 0, JSON.stringify(gap));

const oneChange = changes30dFromCaps(points);
ok(
  "daraus folgt genau eine 30-Tage-Änderung",
  oneChange.length === 1 && oneChange[0]?.date === "2026-09-30" && oneChange[0]?.changeUsd === 10e9,
  JSON.stringify(oneChange),
);
const oneZ = stablecoinGrowthZScore(oneChange.map(row => row.changeUsd));
ok(
  "eine gespeicherte Änderung ergibt keinen Z-Score",
  oneZ.available === false && oneZ.zScore === null && oneZ.scorePoints === 0,
  JSON.stringify(oneZ),
);

const nextDay: StablecoinCapSnapshot = {
  available: true,
  fetchedAt: "2026-10-01T12:00:00.000Z",
  totalMarketCapUsd: 301e9,
  totalMarketCapPrevMonthUsd: 292e9,
};
let stored = mergeDailyCaps([], points, "2026-09-30");
stored = mergeDailyCaps(stored, capPointsFromSnapshot(nextDay), "2026-10-01");
ok(
  "der zweite Tag hängt nur neue gelieferte Stände an",
  stored.map(p => p.date).join(",") === "2026-08-31,2026-09-01,2026-09-30,2026-10-01",
  stored.map(p => p.date).join(","),
);
const refreshed: StablecoinCapSnapshot = {
  available: true,
  fetchedAt: "2026-09-30T18:00:00.000Z",
  totalMarketCapUsd: 305e9,
  totalMarketCapPrevMonthUsd: 111e9,
};
const afterRefresh = mergeDailyCaps(stored, capPointsFromSnapshot(refreshed), "2026-09-30");
const prior = afterRefresh.find(p => p.date === "2026-08-31");
const sameDay = afterRefresh.find(p => p.date === "2026-09-30");
ok(
  "der Vortagsmonat bleibt, der gleiche Tag wird aktualisiert",
  prior?.totalMarketCapUsd === 290e9 && sameDay?.totalMarketCapUsd === 305e9,
  JSON.stringify(afterRefresh),
);

const unavailable = capPointsFromSnapshot({
  available: false,
  fetchedAt: "2026-09-30T12:00:00.000Z",
  totalMarketCapUsd: 300e9,
  totalMarketCapPrevMonthUsd: 290e9,
});
ok("ohne erfolgreichen Abruf wird kein Stand erfunden", unavailable.length === 0);

console.log("reserve series and genius");

ok("im Repo liegt keine Emittentenreihe", repoIssuerReserveSeries() === null);
const slots = adaptiveTBillSlots(10e9);
ok(
  "ohne Emittentenreihe gibt es keine Nachfrage, keinen Multiplikator und kein Perzentil",
  slots.available === false
    && slots.estimatedTBillDemandUsd === null
    && slots.dynamicMultiplier === null
    && slots.percentile === null
    && slots.percentileScore === 0,
  JSON.stringify(slots),
);

const market: StablecoinMarketSnapshot = {
  available: true,
  fetchedAt: "2026-09-30T12:00:00.000Z",
  totalMarketCapUsd: 300e9,
  totalMarketCapPrevMonthUsd: 290e9,
  usdt: null,
  usdc: null,
  constituentCount: 2,
};
const demand = estimateTBillDemand(market);
ok(
  "estimateTBillDemand bleibt ohne Belegreihe leer",
  demand.available === false && demand.estimatedTBillDemandUsd === null && demand.dynamicMultiplier === null && demand.mcapChange30dUsd === 10e9,
  JSON.stringify(demand),
);

const genius = geniusStrengthSlot(null);
ok(
  "ohne gespeicherte GENIUS-Stärke bleibt der Slot n/v und addiert 0",
  genius.available === false && genius.strength === null && genius.scorePoints === 0,
  JSON.stringify(genius),
);

const composed = composeStablecoinChannel(snapshot, []);
ok(
  "die Antwort trägt den Z-Score und lässt die unbelegten Slots leer",
  composed.growthZ.scorePoints === 0
    && composed.growthZ.zScore === null
    && composed.tBillAdaptive.estimatedTBillDemandUsd === null
    && composed.tBillAdaptive.dynamicMultiplier === null
    && composed.tBillAdaptive.percentile === null
    && composed.geniusStrength.strength === null
    && composed.geniusStrength.scorePoints === 0,
  JSON.stringify({ growthZ: composed.growthZ, tBillAdaptive: composed.tBillAdaptive, geniusStrength: composed.geniusStrength }),
);

const math = readFileSync(new URL("../server/stablecoin-channel-math.ts", import.meta.url), "utf8");
const liquidity = readFileSync(new URL("../server/stablecoin-liquidity.ts", import.meta.url), "utf8");
ok(
  "weder 0.75 noch ein Perplexity-Prompt wird als Quelle eingesetzt",
  !math.includes("0.75") && !math.includes("Perplexity") && !liquidity.includes("perplexity") && !liquidity.includes("0.75"),
);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nstablecoin z-score ok");
