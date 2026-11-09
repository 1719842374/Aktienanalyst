/**
 * Fill n/a cells on the liquidity briefing strip.
 * Run: npx tsx script/test-liquidity-briefing-na.ts
 *
 * Philip: FRED / FMP / adaptive formula. π does not wait on a dollar F rest.
 * Dead FRED (IRLTLT01CNM156N HTML, MYAGM2CNM189N 2019) is never printed as live.
 */
import { excessMoneyGrowth } from "../server/liquidity-regime-math";
import {
  appCumulativeNetBn,
  briefingPricedIn,
  cnNominalFisher,
  fisherCarrySeries,
  officialOrRatioVelocity,
  parseAppBreakdown,
  parseBisCbpol,
  parsePeppPurchases,
  parseWorldBankLevels,
  worldBankYoy,
} from "../server/liquidity-briefing-math";
import { unpricedPvBn } from "../server/liquidity-stocks-velocity";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}
const near = (a: number | null | undefined, b: number, tol = 1e-9) =>
  a != null && Number.isFinite(a) && Math.abs(a - b) < tol;

console.log("US M2V — official series wins, else NGDP/M");
const m2v = [
  { period: "2025-04-01", value: 1.402 },
  { period: "2026-04-01", value: 1.418 },
];
const gdp = [
  { period: "2025-04-01", value: 30630 },
  { period: "2026-04-01", value: 32563 },
];
const m2 = [
  { period: "2025-04-01", value: 22756 },
  { period: "2026-04-01", value: 23218 },
];
const official = officialOrRatioVelocity(m2v, gdp, m2);
ok("official M2V is 1.418", near(official.velocity, 1.418, 1e-9), String(official.velocity));
ok("official source is FRED M2V", official.source === "FRED M2V");
ok("median of the two prints is 1.410", near(official.median, 1.41, 1e-9), String(official.median));

const ratio = officialOrRatioVelocity([], gdp, m2);
ok("empty M2V falls back to GDP/M2", ratio.source === "NGDP/M2" && near(ratio.velocity, 32563 / 23218, 1e-6), String(ratio.velocity));
ok("no series stays empty", officialOrRatioVelocity([], [], []).velocity == null && officialOrRatioVelocity([], [], []).source == null);

console.log("US EMG — same identity as C2");
const emg = excessMoneyGrowth(5.5, 2.2, 2.6);
ok("EMG = ΔM − ΔRGDP − π", near(emg, 0.7, 1e-12));

console.log("π — age × V/V̄, no F rest");
const aged = briefingPricedIn(2, 1.4, 1.4);
ok("2y at the median is fully priced in", near(aged.pi, 1, 1e-12) && aged.available);
ok("π is not added to LI", aged.addedToLi === false);
ok("unknown age uses the 2y cap, not a dollar rest", near(briefingPricedIn(null, 1.4, 1.4).pi, 1, 1e-12));
ok("slow velocity halves π after 2y", near(briefingPricedIn(null, 0.7, 1.4).pi, 0.5, 1e-12));
ok("missing V keeps π empty with a reason", briefingPricedIn(null, null, null).pi == null && briefingPricedIn(null, null, null).available === false && (briefingPricedIn(null, null, null).note || "").includes("velocity"));

console.log("CN 10y — Fisher, never a dead FRED print");
ok("i_CN = r_US + π_CN", near(cnNominalFisher(2.42, -0.65), 1.77, 1e-9));
ok("missing CPI leaves CN 10y empty", cnNominalFisher(2.42, null) == null);
ok("missing real leaves CN 10y empty", cnNominalFisher(null, 0.5) == null);

console.log("CN-M2 — World Bank annual levels, YoY in code");
const wb = parseWorldBankLevels(JSON.stringify([
  { page: 1 },
  [
    { date: "2024", value: 306912922284009 },
    { date: "2023", value: 287342842925609 },
    { date: "2022", value: 261580238098694 },
  ],
]));
ok("World Bank parser keeps years as periods", wb[0]?.period === "2022" && wb[2]?.period === "2024");
const wbYoy = worldBankYoy(wb);
ok("2024 YoY is (306.9-287.3)/287.3", wbYoy != null && near(wbYoy.latest, ((306912922284009 - 287342842925609) / 287342842925609) * 100, 1e-6), String(wbYoy?.latest));
ok("HTML is not a World Bank body", parseWorldBankLevels("<html>").length === 0);

console.log("APP cumulative and PEPP holdings from the official CSV columns");
const appCsv = [
  "2026,June,-172,-2317,-5457,-17964,-3,-32,-121,-417,2093,192857,219429,1706087",
  ",July,-73,-1554,-1237,-24306,0,0,0,0,2019,191303,218192,1681781",
].join("\n");
const appRows = parseAppBreakdown(appCsv);
ok("APP cumulative is the sum of monthly nets", near(appCumulativeNetBn(appRows), -25.91 + -27.17, 1e-6), String(appCumulativeNetBn(appRows)));
const peppRows = parsePeppPurchases("2026,June,-11703,1394194\n,July,-24821,1369373\n");
ok("PEPP holdings are the cumulative column", peppRows[1]?.cumulativeNetPurchasesBn === 1369.373);

console.log("Carry history is DGS10 minus Fisher CN, so z has a series");
const carry = fisherCarrySeries(
  [{ period: "2024-01-02", value: 4.0 }, { period: "2025-01-02", value: 4.2 }, { period: "2026-01-02", value: 4.8 }],
  [{ period: "2024-01-02", value: 1.5 }, { period: "2025-01-02", value: 1.6 }, { period: "2026-01-02", value: 1.8 }],
  [{ period: "2023-01-01", value: 100 }, { period: "2024-01-01", value: 100.5 }, { period: "2025-01-01", value: 100.2 }, { period: "2026-01-01", value: 99.8 }],
);
ok("carry series is in basis points", carry.length >= 2 && carry[carry.length - 1].value > 100, String(carry[carry.length - 1]?.value));

console.log("BIS policy CSV");
const bis = parseBisCbpol("FREQ,REF_AREA,TIME_PERIOD,OBS_VALUE\nM,CN,2026-08,3.0\nM,CN,2026-07,3.0\n");
ok("BIS parser keeps the monthly policy print", bis[1]?.period === "2026-08" && near(bis[1]?.value ?? null, 3, 1e-9));

console.log("unpriced PV");
ok("fully priced with no F rest is 0, not a fake leftover", unpricedPvBn(1, null) === 0);
ok("half priced leaves half of F", near(unpricedPvBn(0.5, 40), 20, 1e-9));
ok("missing π keeps unpriced empty", unpricedPvBn(null, 40) == null);

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
