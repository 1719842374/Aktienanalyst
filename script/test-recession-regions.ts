/**
 * Offen_WORK_RECESSION_SOURCES.md — Eurozone and Japan catalogs.
 * Real series only. A missing print stays out of the net and the max.
 * Run: npx tsx script/test-recession-regions.ts
 */
import { existsSync, readFileSync } from "node:fs";
import {
  capeReading,
  creditReading,
  durableReading,
  m2Reading,
  scoreSeriesStress,
  vixReading,
} from "../server/recession";
import {
  emptyRegionalPrints,
  isharesPriceEarnings,
  newerSeries,
  parseDbNomicsSeries,
  scoreRegionalCatalogs,
  usSlotsFromIndicators,
  type RegionalPrints,
  type RegionScorers,
} from "../server/recession-regions";
import {
  alignSpread,
  blendWeighted,
  bookProbability,
  laborSlot,
  parseEurostatSeries,
  sahmGapPp,
  yoyByMonth,
  type DatedPoint,
} from "../shared/recession-regions";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const TODAY = "2026-10-04";

function months(start: string, count: number, valueAt: (index: number) => number): DatedPoint[] {
  const [year, month] = start.split("-").map(Number);
  const points: DatedPoint[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(year, month - 1 + i, 1));
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    points.push({ date: `${y}-${m}-01`, value: valueAt(i) });
  }
  return points;
}

function rates(count: number, valueAt: (index: number) => number): number[] {
  return Array.from({ length: count }, (_, index) => valueAt(index));
}

function scorers(): RegionScorers {
  return {
    money: yoy => m2Reading(yoy),
    credit: spread => creditReading(spread),
    vol: level => vixReading(level),
    valuation: ratio => capeReading(ratio),
    activity: yoy => {
      const reading = durableReading(yoy);
      return { rawScore: reading.rawScore, zone: reading.zone };
    },
    curve: (levels, stressWhenLow) => {
      const scored = scoreSeriesStress(stressWhenLow ? levels.map(value => -value) : levels);
      return { available: scored.available, raw: scored.raw };
    },
  };
}

function prints(partial: Partial<RegionalPrints> = {}): RegionalPrints {
  return { ...emptyRegionalPrints(), ...partial };
}

console.log("\n=== Sahm analog is the 0.5pp gap, not the US s(z) card ===");
{
  const flat = rates(15, () => 6.4);
  check("flat gap is 0", sahmGapPp(flat) === 0, String(sahmGapPp(flat)));
  const calm = laborSlot("ALQ Eurozone", "Eurostat une_rt_m EA21", sahmGapPp(flat));
  check("flat gap scores −3", calm.rawScore === -3 && calm.available && calm.maxWeighted === 4);
  const jump = rates(15, index => (index === 14 ? 5.5 : 4));
  check("0.5pp gap trips the threshold", Math.abs(sahmGapPp(jump) - 0.5) < 1e-9, String(sahmGapPp(jump)));
  const hot = laborSlot("ALQ Japan", "FRED LRUNTTTTJPM156S", sahmGapPp(jump));
  check("triggered gap scores +4", hot.rawScore === 4 && hot.zone === "≥0.5pp" && hot.weight === 1);
  check("fewer than 15 months stays closed", !Number.isFinite(sahmGapPp(rates(14, () => 5))));
  const closed = laborSlot("ALQ Eurozone", "Eurostat une_rt_m EA20", sahmGapPp(rates(14, () => 5)));
  check("short labor history adds neither net nor max", !closed.available && closed.maxWeighted === 0 && closed.value === "N/A");
}

console.log("\n=== Eurostat JSON and YoY ===");
{
  const empty = parseEurostatSeries({
    size: [0],
    value: {},
    dimension: { geo: { category: { index: {} } }, time: { category: { index: {} } } },
  });
  check("empty geo yields no points", empty.length === 0);
  const parsed = parseEurostatSeries({
    value: { "0": 6.1, "1": 6.4 },
    dimension: { time: { category: { index: { "2026-08": 1, "2026-07": 0 } } } },
  });
  check("time index becomes month-start points", parsed.length === 2 && parsed[0].date === "2026-07-01" && parsed[1].value === 6.4);
  const yoy = yoyByMonth([
    { date: "2025-07-01", value: 100 },
    { date: "2025-08-01", value: 110 },
    { date: "2026-07-01", value: 90 },
  ]);
  check("YoY matches the same YYYY-MM a year earlier", yoy === -10, String(yoy));
  const spread = alignSpread(
    [{ date: "2026-01-01", value: 3 }, { date: "2026-02-01", value: 3.2 }],
    [{ date: "2026-02-01", value: 2 }, { date: "2026-01-01", value: 1.5 }],
  );
  check("curve spread is long minus short", spread.length === 2 && Math.abs(spread[1].value - 1.2) < 1e-9, String(spread[1]?.value));
}

console.log("\n=== Catalog scores reuse the US readers ===");
{
  const ip = [
    { date: "2025-08-01", value: 100 },
    { date: "2026-08-01", value: 94 },
  ];
  const calmIp = [
    { date: "2025-08-01", value: 100 },
    { date: "2026-08-01", value: 101.4 },
  ];
  const staleIp = [
    { date: "2023-03-01", value: 100 },
    { date: "2024-03-01", value: 92.3 },
  ];
  const curve = months("2024-01", 30, index => 1 + index * 0.01);
  const shortCurve = [
    { date: "2024-01-01", value: 2.5 },
    { date: "2025-01-01", value: 2.2 },
    { date: "2026-01-01", value: 2.0 },
  ];
  const unemployment = months("2025-01", 20, () => 6.4);
  const catalog = scoreRegionalCatalogs({
    prints: prints({
      ezUnemployment: { geo: "EA21", points: unemployment },
      ezLong: curve.map(point => ({ ...point, value: point.value + 1.5 })),
      ezShort: curve,
      ezIp: { geo: "EA21", points: ip },
      ezM3Yoy: 3.49,
      ezHy: 3.17,
      ezPe: 28,
      ezPeSource: "FMP ^STOXX PE TTM",
      ezVol: 22,
      jpUnemployment: unemployment,
      jpLong: shortCurve,
      jpIp: staleIp,
      jpM2Yoy: 2,
    }),
    usSlots: [],
    usRecession12m: 40,
    usCorrection12m: 35,
    today: TODAY,
    scorers: scorers(),
  });
  const ez = catalog.regions.find(region => region.id === "EZ")!;
  const jp = catalog.regions.find(region => region.id === "JP")!;
  const slot = (region: typeof ez, name: string) => region.slots.find(item => item.name === name)!;

  const labor = slot(ez, "ALQ Eurozone");
  check("EA21 labor names the geo that returned points", labor.source === "Eurostat une_rt_m EA21" && labor.available);
  const activity = slot(ez, "Aktivität EZ");
  const durable = durableReading(-6);
  check(
    "EZ IP YoY uses the durable-goods branch",
    activity.available && activity.rawScore === durable.rawScore && activity.zone === durable.zone && activity.maxWeighted === 3 && activity.weight === 1,
    `${activity.rawScore} ${activity.zone}`,
  );
  check("EZ activity source is sts_inpr_m I21", activity.source === "Eurostat sts_inpr_m EA21 I21");
  const calm = scoreRegionalCatalogs({
    prints: prints({ ezIp: { geo: "EA21", points: calmIp } }),
    usSlots: [],
    usRecession12m: 40,
    usCorrection12m: 35,
    today: TODAY,
    scorers: scorers(),
  });
  const calmActivity = calm.regions.find(region => region.id === "EZ")!.slots.find(item => item.name === "Aktivität EZ")!;
  const durableCalm = durableReading(1.4);
  check(
    "positive IP YoY is the −2 branch",
    calmActivity.rawScore === durableCalm.rawScore && calmActivity.zone === "Stabil" && calmActivity.value.startsWith("YoY +1.4%"),
    calmActivity.value,
  );

  const money = slot(ez, "Geld EZ M3");
  const m2 = m2Reading(3.49);
  check(
    "ECB M3 uses m2Reading and keeps the ECB source",
    money.rawScore === m2.rawScore && money.zone === m2.zone && money.weight === m2.weight && money.maxWeighted === m2.maxWeighted && money.source === "ECB BSI.M.U2.Y.V.M30" && money.value === "3.5%",
    `${money.rawScore} ${money.zone} ${money.value}`,
  );
  const credit = slot(ez, "Spreads EZ HY");
  const baa = creditReading(3.17);
  check(
    "EUR HY uses creditReading",
    credit.rawScore === baa.rawScore && credit.zone === baa.zone && credit.source === "FRED BAMLHE00EHYIOAS" && credit.value === "3.17%",
  );
  const vol = slot(ez, "VSTOXX");
  const vix = vixReading(22);
  check(
    "VSTOXX uses vixReading",
    vol.rawScore === vix.rawScore && vol.zone === vix.zone && vol.maxWeighted === vix.maxWeighted && vol.source === "STOXX V2TX",
  );
  const pe = slot(ez, "STOXX 600 PE");
  const cape = capeReading(28);
  check(
    "STOXX PE uses capeReading only when a PE exists",
    pe.available && pe.rawScore === cape.rawScore && pe.weight === cape.weight && pe.maxWeighted === cape.maxWeighted && pe.source === "FMP ^STOXX PE TTM",
  );

  const jpActivity = slot(jp, "Aktivität JP");
  check(
    "stale Japan IP is shown and not scored",
    !jpActivity.available && jpActivity.value === "92.3 (2024-03)" && jpActivity.maxWeighted === 0 && jpActivity.source === "FRED JPNPROINDMISMEI",
    jpActivity.value,
  );
  check("fresh activity keeps the month on the value", calmActivity.value.includes("(2026-08)"), calmActivity.value);
  const jpCurve = slot(jp, "Kurve JP 10J");
  check(
    "short Japan curve keeps the level and fails closed",
    !jpCurve.available && jpCurve.value.includes("2.00%") && jpCurve.zone === "keine 20J-Historie" && jpCurve.maxWeighted === 0,
    `${jpCurve.value} ${jpCurve.zone}`,
  );
  const jpSpreads = slot(jp, "Spreads JP");
  check(
    "JGB-Corp stays N/A without a free OAS series",
    !jpSpreads.available && jpSpreads.value === "N/A" && jpSpreads.source === "JGB-Corp (keine freie OAS-Serie)" && jpSpreads.maxWeighted === 0,
  );
  const jpVol = slot(jp, "JNVI");
  check("JNVI stays closed without a free series", !jpVol.available && jpVol.value === "N/A" && jpVol.source === "JNVI (keine freie Serie)");
  const jpPe = slot(jp, "TOPIX/CAPE JP");
  check("missing TOPIX PE is not invented", !jpPe.available && jpPe.source === "TOPIX/CAPE JP (FMP leer; JPX-PER nur xlsx)");
  const jpMoney = slot(jp, "Geld JP M2");
  check("BoJ M2 uses m2Reading", jpMoney.source === "BoJ M2" && jpMoney.rawScore === m2Reading(2).rawScore && jpMoney.available);

  check("weights stay 0.70 / 0.20 / 0.10", catalog.weights.US === 0.7 && catalog.weights.EZ === 0.2 && catalog.weights.JP === 0.1);
  check("the action flag stays on the US books", catalog.actionUsesUsBooks === true);
  check("book probability matches the 5-point clamp", bookProbability(3, 3) === 95 && bookProbability(0, 0) === null);
}

console.log("\n=== Blend drops a null region; US slots do not invent a max ===");
{
  const blended = blendWeighted([
    { weight: 0.7, probability: 50 },
    { weight: 0.2, probability: null },
    { weight: 0.1, probability: 80 },
  ]);
  check("null Japan weight is renormalized", blended === 55, String(blended));

  const us = usSlotsFromIndicators([
    { name: "Sahm-Regel", group: "recession", value: "+0.10", rawScore: -3, weight: 1, weightedScore: -3, maxWeighted: 4, zone: "<0.5pp", source: "FRED SAHMREALTIME", available: true },
    { name: "Inv. Zinskurve (10Y-2Y)", group: "recession", value: "0.40%", rawScore: 1, weight: 1, weightedScore: 1, maxWeighted: 4, zone: "Normal", source: "FRED T10Y2Y", available: true },
    { name: "Aktivität (IP / Auslastung)", group: "recession", value: "INDPRO YoY +1.4%", rawScore: -2, weight: 1, weightedScore: -2, maxWeighted: 3, zone: "Stabil", source: "FRED INDPRO", available: true },
    { name: "Kreditspreads (BAA-Trs)", group: "recession", value: "N/A", rawScore: -3, weight: 1, weightedScore: -3, maxWeighted: 5, zone: "N/A", source: "FRED BAA10Y", available: false },
    { name: "Buffett-Indikator", group: "correction", value: "180%", rawScore: 2, weight: 1, weightedScore: 2, maxWeighted: 4, zone: "Hoch", source: "FRED DDDM01USA156NWDB", available: true },
    { name: "Shiller CAPE", group: "correction", value: "32.0", rawScore: 3, weight: 1.8, weightedScore: 5.4, maxWeighted: 12.6, zone: "Hoch (30-35)", source: "Shiller", available: true },
    { name: "VIX", group: "correction", value: "16.0", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 4, zone: "Normal", source: "FRED VIXCLS", available: true },
    { name: "VIX-Proxy", group: "correction", value: "16.0", rawScore: 1, weight: 1, weightedScore: 1, maxWeighted: 4, zone: "Proxy", source: "Proxy", available: true },
  ]);
  const activity = us.find(slot => slot.name.includes("Aktivität"))!;
  const credit = us.find(slot => slot.id === "spreads")!;
  const vol = us.find(slot => slot.id === "vol")!;
  check("US activity copies the scored +3/−2 row", activity.available && activity.rawScore === -2 && activity.maxWeighted === 3 && activity.weight === 1);
  check("available:false credit does not enter the max", !credit.available && credit.maxWeighted === 0 && credit.weightedScore === 0);
  check("VIX is taken before the VIX proxy", vol.source === "FRED VIXCLS" && vol.rawScore === 0);
  check("Buffett and CAPE both stay, keyed by name", us.filter(slot => slot.id === "valuation").map(slot => slot.name).join("|") === "Buffett-Indikator|Shiller CAPE");
  const staleUs = usSlotsFromIndicators([
    { name: "Buffett Indikator (TMC/GDP)", group: "correction", value: "195% (2020-01)", rawScore: 5, weight: 2, weightedScore: 10, maxWeighted: 16, zone: "Stark überbewertet (165-200%)", source: "FRED DDDM01USA156NWDB", available: false },
  ]);
  const staleSlot = staleUs.find(slot => slot.name.includes("Buffett"))!;
  check(
    "stale Buffett stays in the catalog and adds neither net nor max",
    staleSlot != null && !staleSlot.available && staleSlot.weight === 0 && staleSlot.weightedScore === 0 && staleSlot.maxWeighted === 0 && staleSlot.value === "195% (2020-01)",
    `${staleSlot?.weight} ${staleSlot?.weightedScore} ${staleSlot?.maxWeighted}`,
  );

  const catalog = scoreRegionalCatalogs({
    prints: prints(),
    usSlots: us,
    usRecession12m: 40,
    usCorrection12m: 35,
    today: TODAY,
    scorers: scorers(),
  });
  const usa = catalog.regions.find(region => region.id === "US")!;
  const scoredMax = usa.slots.filter(slot => slot.book === "recession" && slot.available).reduce((sum, slot) => sum + slot.maxWeighted, 0);
  check("US catalog max ignores the closed credit slot", scoredMax === 11, String(scoredMax));
  check("empty EZ and JP drop out of the blend", catalog.blendedRecession12m === 40 && catalog.blendedCorrection12m === 35, `${catalog.blendedRecession12m}/${catalog.blendedCorrection12m}`);
  const emptyLabor = catalog.regions.find(region => region.id === "EZ")!.slots.find(slot => slot.id === "labor")!;
  check("missing EZ unemployment names EA20 and stays closed", emptyLabor.source === "Eurostat une_rt_m EA20" && !emptyLabor.available);
}

console.log("\n=== Public adapters: iShares KGV, OECD IP, newer series ===");
{
  const html = `{"priceEarnings&quot;:{&quot;asOfDate&quot;:20261002,&quot;formattedValue&quot;:&quot;18,36&quot;,&quot;label&quot;:&quot;KGV&quot;}`;
  const pe = isharesPriceEarnings(html);
  check("iShares KGV keeps the comma as a decimal and the as-of day", pe?.value === 18.36 && pe.date === "2026-10-02", JSON.stringify(pe));
  check("a page without the priceEarnings block is not a PE", isharesPriceEarnings("<html>no ratio</html>") === null);
  const points = parseDbNomicsSeries({
    series: { docs: [{ period: ["2025-04", "2026-04"], value: [91.46056, 93.37358] }] },
  });
  check(
    "DBnomics months become month-start points",
    points.length === 2 && points[0].date === "2025-04-01" && points[1].value === 93.37358,
    JSON.stringify(points),
  );
  check("a payload without docs is empty", parseDbNomicsSeries({ series: {} }).length === 0);
  const picked = newerSeries(points, [{ date: "2024-03-01", value: 92.3 }]);
  check("the newer OECD print wins over the 2024 FRED tail", picked.usedPrimary && picked.points.at(-1)?.date === "2026-04-01");
  const fredWins = newerSeries([{ date: "2023-11-01", value: 90 }], [{ date: "2024-03-01", value: 92.3 }]);
  check("an older primary loses to the FRED tail", !fredWins.usedPrimary && fredWins.points[0].date === "2024-03-01");

  const fresh = scoreRegionalCatalogs({
    prints: prints({
      jpIp: points,
      jpIpSource: "OECD STES DF_INDSERV JPN.M.PRVM.IX.BTE.Y",
    }),
    usSlots: [],
    usRecession12m: 40,
    usCorrection12m: 35,
    today: TODAY,
    scorers: scorers(),
  });
  const jpActivity = fresh.regions.find(region => region.id === "JP")!.slots.find(item => item.name === "Aktivität JP")!;
  const yoy = ((93.37358 - 91.46056) / 91.46056) * 100;
  check(
    "a 2026-04 Japan IP print is scored and keeps the month",
    jpActivity.available && jpActivity.value.startsWith(`YoY +${yoy.toFixed(1)}%`) && jpActivity.value.includes("(2026-04)") && jpActivity.source.includes("OECD") && jpActivity.zone === "Stabil" && jpActivity.maxWeighted === 3,
    `${jpActivity.value} ${jpActivity.zone} ${jpActivity.source}`,
  );
}

console.log("\n=== Files stay on the named boundaries ===");
{
  const serverRegions = readFileSync(new URL("../server/recession-regions.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../client/src/pages/RecessionDashboard.tsx", import.meta.url), "utf8");
  check("regional module does not import the US recession file", !/from\s+["']\.\/recession["']/.test(serverRegions));
  check("regional module does not import the oil bridge", !serverRegions.includes("recession-bridge"));
  check("regional module does not import Sahm", !serverRegions.includes("recession-sahm"));
  check("activity scorer is the existing YoY function", server.includes("activity: yoy => realActivityYoyScore(yoy)"));
  check("money scorer is m2Reading", server.includes("money: yoy => m2Reading(yoy)"));
  check("dashboard reads catalogs through the hook", dashboard.includes("useRecessionCatalog"));
  check(
    "sources spec stays Fertig_ and is not turned back to Offen_",
    existsSync(new URL("../Fertig_WORK_RECESSION_SOURCES.md", import.meta.url))
      && !existsSync(new URL("../Offen_WORK_RECESSION_SOURCES.md", import.meta.url)),
  );
  check(
    "Sahm spec stays fertig_ and is not turned back to Offen_",
    existsSync(new URL("../fertig_WORK_RECESSION_FRED_SAHM.md", import.meta.url))
      && !existsSync(new URL("../Offen_WORK_RECESSION_FRED_SAHM.md", import.meta.url)),
  );
}

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
