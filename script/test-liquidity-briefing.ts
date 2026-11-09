/**
 * DoD Offen_WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.md
 * Run: npx tsx script/test-liquidity-briefing.ts
 *
 * Snapshot-Prints sind Testhaken. Der Live-Fetch hardcodet sie nicht
 * und legt keinen zweiten US-M2V-Pfad an.
 */
import {
  CACHE_KEYS,
  DEAD_FRED_SERIES,
  LIVE_FRED_SERIES,
  PHI,
  billsStockDiff,
  carryBp,
  exPostRealPercent,
  halfLifeYears,
  isForbiddenFredSeries,
  monthStockDiff,
  observationOn,
  parseAppBreakdown,
  parseBojMoneyStock,
  parseEcbCsv,
  parseFredCsv,
  japanCpiYoy,
  parseMofJgb10,
  parseMspdBillStockBn,
  parsePeppPurchases,
  preferNominal,
  pricedInPi,
  qtNetBn,
  quarterVelocity,
  somaNotesBn,
  textHasOfficialReleaseUrl,
  velocity,
  xBotInvalidationKeys,
  zOfLatest,
  bojHundredMillionYenToBillion,
  bojHundredMillionYenToTrillion,
  parseBojSeries,
} from "../server/liquidity-briefing-math";
import { assembleCatalog } from "../server/liquidity-briefing-catalog";
import {
  applyXBotPing,
  briefingSourceUrls,
  fetchLiquidityBriefing,
  memoryBriefingCache,
} from "../server/liquidity-briefing";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const near = (a: number | null, b: number, tol = 1e-9) => a != null && Math.abs(a - b) < tol;

console.log("Liquidity briefing — tote Serien");
for (const id of DEAD_FRED_SERIES) ok(`tot: ${id}`, isForbiddenFredSeries(id));
ok("DFII5 verboten", isForbiddenFredSeries("DFII5"));
ok("DFII10 erlaubt", !isForbiddenFredSeries("DFII10"));
ok("Live-FRED holt M2V für US V", LIVE_FRED_SERIES.includes("M2V" as never));
ok("Live-FRED schneidet §0 nicht", LIVE_FRED_SERIES.every(id => !isForbiddenFredSeries(id)));
const urls = briefingSourceUrls(new Date("2026-09-04T12:00:00Z"));
const urlBlob = urls.map(u => u.url).join("\n");
ok("kein Fetch der toten IDs", DEAD_FRED_SERIES.every(id => !urlBlob.includes(id)));
ok("M2V und M2SL stehen in den Briefing-URLs", urlBlob.includes("M2V") && urlBlob.includes("M2SL"));
ok("EZ-M3 kommt von der EZB", urls.some(u => u.id === "ECB_M3" && u.url.includes("data-api.ecb.europa.eu")));
ok("JP-M2 kommt von der BoJ", urls.some(u => u.id === "BOJ_M2" && u.url.includes("stat-search.boj.or.jp")));
ok("EZ-M1 kommt von der EZB", urls.some(u => u.id === "ECB_M1" && u.url.includes("M10.X.1.")));
ok("EZ-M2 kommt von der EZB", urls.some(u => u.id === "ECB_M2" && u.url.includes("M20.X.1.")));
ok("BoJ-Geldbasis ist MD01", urls.some(u => u.id === "BOJ_MB" && u.url.includes("db=MD01") && u.url.includes("MABS1AN11")));
ok("kein CN-10y auf FRED", !urlBlob.includes("IRLTLT01CNM156N"));
ok("APP-CSV ist die EZB-Tabelle", urls.some(u => u.url.includes("APP_breakdown_history.csv")));
ok("PEPP-CSV ist die EZB-Tabelle", urls.some(u => u.url.includes("PEPP_purchase_history.csv")));

console.log("Fixtures §9");
const m2v = parseFredCsv("observation_date,M2V\n2026-01-01,1.413\n2026-04-01,1.415\n");
ok("Fixture M2V Q2 2026 = 1.415", near(observationOn(m2v, "2026-04-01"), 1.415, 0.001));

const appCsv = [
  "2026,June,-172,-2317,-5457,-17964,-3,-32,-121,-417,2093,192857,219429,1706087",
  ",July,-73,-1554,-1237,-24306,0,0,0,0,2019,191303,218192,1681781",
].join("\n");
const app = parseAppBreakdown(appCsv);
const julApp = app.find(r => r.period === "2026-07");
ok("Fixture APP Jul Netto = -27.170", julApp != null && julApp.netBn.toFixed(3) === "-27.170", String(julApp?.netBn));
ok("APP Jul Bestand 2093.295", julApp != null && julApp.holdingsBn.toFixed(3) === "2093.295", String(julApp?.holdingsBn));
ok("PSPP Jul Netto -24.306", julApp != null && julApp.psppNetBn.toFixed(3) === "-24.306", String(julApp?.psppNetBn));
const junApp = app.find(r => r.period === "2026-06");
ok("APP Jun Bestand 2120.466", junApp != null && junApp.holdingsBn.toFixed(3) === "2120.466", String(junApp?.holdingsBn));

const peppCsv = [
  "2026,June,-11703,1394194",
  ",July,-24821,1369373",
].join("\n");
const pepp = parsePeppPurchases(peppCsv);
const julPepp = pepp.find(r => r.period === "2026-07");
ok("Fixture PEPP Jul Netto = -24.821", julPepp != null && julPepp.netBn.toFixed(3) === "-24.821", String(julPepp?.netBn));

const dfii = parseFredCsv("observation_date,DFII10\n2026-08-27,2.34\n2026-08-28,2.42\n");
ok("Fixture DFII10 28.08.2026 = 2.42", near(observationOn(dfii, "2026-08-28"), 2.42, 1e-9));

const jgb = parseFredCsv("observation_date,IRLTLT01JPM156N\n2026-06-01,2.670\n");
ok("Fixture IRLTLT01JPM156N Jun 2026 = 2.670", near(observationOn(jgb, "2026-06-01"), 2.670, 1e-9));

ok("Fixture Bills-MSPD Jul Diff = 298.202", near(billsStockDiff(6988.891, 6690.689), 298.202, 1e-6));

const t8 = halfLifeYears(0.08);
ok("T½(0.08) in [8.99, 9.01]", t8 != null && t8 >= 8.99 && t8 <= 9.01, String(t8));
const t242 = halfLifeYears(0.0242);
ok("T½(0.0242) ≈ 29.0", t242 != null && t242 >= 28.9 && t242 <= 29.1, String(t242));
const tJp = halfLifeYears(0.009);
ok("T½(0.009) ≈ 77", tJp != null && tJp >= 76.5 && tJp <= 78, String(tJp));
const clippedHi = halfLifeYears(0.08, 0.1, 1);
ok("V-Faktor Clip oben 2", clippedHi != null && t8 != null && Math.abs(clippedHi - t8 * 2) < 1e-9, String(clippedHi));
const clippedLo = halfLifeYears(0.08, 10, 1);
ok("V-Faktor Clip unten 0.5", clippedLo != null && t8 != null && Math.abs(clippedLo - t8 * 0.5) < 1e-9, String(clippedLo));
ok("φ = 0.3", PHI === 0.3);
ok("QT Jul = -52.0", qtNetBn(-27.17, -24.821) === -52);
ok("Carry 4.81 - 1.69 = 312 bp", near(carryBp(4.81, 1.69), 312, 0.05));
ok("JP ex post 2.670 - 2.2", near(exPostRealPercent(2.67, 2.2), 0.47, 1e-9));
ok("SOMA Notes = Total - Bills", near(somaNotesBn(2_000_000, 541_995), (2_000_000 - 541_995) / 1000, 1e-6));
const somaBills = parseFredCsv("observation_date,WSHOBL\n2026-08-26,541995\n");
ok("Fixture WSHOBL 26.08.2026 = 541995", near(observationOn(somaBills, "2026-08-26"), 541995, 1e-6));

console.log("Velocity V = NGDP / M");
ok("V = 16/17.6", near(velocity(16, 17.6), 16 / 17.6));
const ez = quarterVelocity({
  ngdp: [{ period: "2026-Q2", value: 4100 }],
  moneyMonthly: [
    { period: "2026-04", value: 17600 },
    { period: "2026-05", value: 17610 },
    { period: "2026-06", value: 17620 },
  ],
  annualizeNgdp: true,
});
ok("EZ annualisiert NGDP/M3", ez.length === 1 && near(ez[0].velocity, (4100 * 4) / ((17600 + 17610 + 17620) / 3), 1e-9), String(ez[0]?.velocity));
ok("BoJ 100 Mio. Yen → Mrd.", near(bojHundredMillionYenToBillion(12970074), 1297007.4, 1e-6));

const boj = parseBojMoneyStock([
  "SERIES_CODE,NAME,UNIT",
  "MAM1NAM2M2MO,M2/Average Amounts Outstanding/Money Stock,100 million yen,MONTHLY,Money Stock,20260909,202607,12966394",
].join("\n"));
ok("BoJ Juli 2026 geparst", boj.length === 1 && boj[0].period === "2026-07" && boj[0].value === 12966394);
const mbCsv = [
  "MABS1AN11,Monetary Base,100 million yen,MONTHLY,Monetary Base,20261002,202607,5549259",
  "MABS1AN11@,Monetary Base YoY,%,MONTHLY,Monetary Base,20261002,202607,-13.8",
].join("\n");
const mb = parseBojSeries(mbCsv, "MABS1AN11");
const mbYoy = parseBojSeries(mbCsv, "MABS1AN11@");
ok("Geldbasis Juli → Bio. Yen", mb.length === 1 && near(Math.round(bojHundredMillionYenToTrillion(mb[0].value) * 1000) / 1000, 554.926, 1e-9), String(mb[0]?.value));
ok("Geldbasis YoY ist schon Prozent", mbYoy.length === 1 && mbYoy[0].value === -13.8);

console.log("X-Bot");
const pingCache = memoryBriefingCache();
pingCache.set(CACHE_KEYS.asia, { m2: 1 }, 1);
pingCache.set(CACHE_KEYS.eu, { app: 1 }, 1);
pingCache.set("briefing_v2__2026-09-04", { rates: {} }, 1);
const noUrl = await applyXBotPing("@Bank_of_Japan_e", "Money Stock (July) ohne Link", pingCache, new Date("2026-09-04T12:00:00Z"));
ok("Tweet ohne Amts-URL ändert keinen Cache", noUrl.length === 0 && pingCache.get(CACHE_KEYS.asia) != null && pingCache.get("briefing_v2__2026-09-04") != null);
ok("example.com ist keine Amts-URL", !textHasOfficialReleaseUrl("siehe https://example.com/ms.pdf"));
ok("Personenname ohne Amts-URL ist kein Key", xBotInvalidationKeys("@ecb", "Lagarde high 3.4").length === 0);
const withUrl = await applyXBotPing(
  "@Bank_of_Japan_e",
  "Money Stock (July) https://www.boj.or.jp/en/statistics/money/ms/ms2607.pdf",
  pingCache,
  new Date("2026-09-04T12:00:00Z"),
);
ok("BoJ-URL invalidiert ASIA", withUrl.includes(CACHE_KEYS.asia) && pingCache.get(CACHE_KEYS.asia) == null, withUrl.join(","));
ok("BoJ-Ping lässt EU stehen", pingCache.get(CACHE_KEYS.eu) != null);
ok("BoJ-Ping löscht den Briefing-Key", pingCache.get("briefing_v2__2026-09-04") == null);
ok("Tweet-Text ist keine Key-Liste aus Zahlen", xBotInvalidationKeys("@ecb", "M3 +3.4%").length === 0);
const ecbKeys = xBotInvalidationKeys("@ecb", "https://www.ecb.europa.eu/press/pr/stats/md/");
ok("EZB-URL invalidiert EU und M3", ecbKeys.includes(CACHE_KEYS.eu) && ecbKeys.includes(CACHE_KEYS.euM3));
ok("RBI ohne .gov ändert nichts", xBotInvalidationKeys("@RBI", "https://www.rbi.org.in/gsec").length === 0);
ok("π ohne F ist null", pricedInPi(2, 10, null, 100) == null);
ok("π wird nicht als LI zurückgegeben", pricedInPi(2, 10, 30, 100) != null && (pricedInPi(2, 10, 30, 100) as number) <= 1);

const mof = parseMofJgb10("Date,1Y,2Y,10Y\n2026/9/1,0.8,0.9,1.55\n");
ok("MoF 10y ist der Tageswert", mof.length === 1 && mof[0].period === "2026-09-01" && mof[0].value === 1.55);
const mofEra = parseMofJgb10([
  "タイトル",
  "基準日,1年,2年,3年,4年,5年,6年,7年,8年,9年,10年,15年",
  "R8.10.1,1.1,1.2,1.3,1.4,1.5,1.6,1.7,1.8,1.9,2.05,2.40",
].join("\n"));
ok("MoF Reiwa-Datum und Spalte 10年", mofEra.length === 1 && mofEra[0].period === "2026-10-01" && mofEra[0].value === 2.05, String(mofEra[0]?.value));
const cpiFallback = japanCpiYoy(
  [{ period: "2020-06", value: 100 }, { period: "2021-06", value: 101 }],
  [{ period: "2025-01-01", value: 3.17 }],
  "2026-08-01",
);
ok("Jahres-CPI ist schon Prozent", cpiFallback != null && cpiFallback.source === "FRED FPCPITOTLZGJPN" && near(cpiFallback.latest, 3.17, 1e-9), String(cpiFallback?.latest));
ok("MoF schlägt den FRED-Monat", preferNominal(mof, [{ period: "2026-06", value: 2.67 }])?.source === "mof-daily");

const mspd = parseMspdBillStockBn(JSON.stringify({
  data: [
    { record_date: "2026-06-30", total_mil_amt: "6690689" },
    { record_date: "2026-07-31", total_mil_amt: "6988891" },
  ],
}));
ok("MSPD Jul-Diff aus der API", near(monthStockDiff(mspd), 298.202, 1e-3), String(monthStockDiff(mspd)));

const shock = Array.from({ length: 36 }, (_, i) => {
  const year = 2023 + Math.floor(i / 12);
  const month = String((i % 12) + 1).padStart(2, "0");
  return { period: `${year}-${month}`, value: i === 35 ? 20 : i * 0.05 };
});
const zShock = zOfLatest(shock);
ok("Spillover |z|≥1 ist ein Event", zShock != null && Math.abs(zShock.z) >= 1, String(zShock?.z));

console.log("Fetch mit Fixture-Körpern, ohne Netz");
const m3Body = [
  "KEY,TIME_PERIOD,OBS_VALUE",
  "k,2025-04,17000000",
  "k,2025-05,17000000",
  "k,2025-06,17000000",
  "k,2026-04,17600000",
  "k,2026-05,17600000",
  "k,2026-06,17614000",
].join("\n");
const ngdpBody = [
  "TIME_PERIOD,OBS_VALUE",
  "2025-Q2,3900000",
  "2026-Q2,4118504",
].join("\n");
const bojBody = [
  "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202504,12000000",
  "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202505,12000000",
  "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202506,12000000",
  "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202604,12900000",
  "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202605,12900000",
  "MAM1NAM2M2MO,M2,100 million yen,MONTHLY,Money Stock,20260909,202606,12970074",
  "MAM1YAM2M2MO,M2 YoY,%,MONTHLY,Money Stock,20260909,202608,2",
].join("\n");
const fredBody = "observation_date,JPNNGDP\n2025-04-01,650000\n2026-04-01,689219.1\n";
let calls = 0;
const seen: string[] = [];
const fakeFetch: typeof fetch = async (input) => {
  calls++;
  const url = String(input);
  seen.push(url);
  let body = "";
  if (url.includes("M10.X.I.")) body = "TIME_PERIOD,OBS_VALUE\n2026-07,3.139514565864854\n";
  else if (url.includes("M20.X.I.")) body = "TIME_PERIOD,OBS_VALUE\n2026-07,3.325985827488509\n";
  else if (url.includes("M30.X.I.")) body = "TIME_PERIOD,OBS_VALUE\n2026-07,3.374812706145436\n2026-08,3.489572442704003\n";
  else if (url.includes("M10.")) body = "TIME_PERIOD,OBS_VALUE\n2026-07,11291831\n";
  else if (url.includes("M20.")) body = "TIME_PERIOD,OBS_VALUE\n2026-07,16434747\n";
  else if (url.includes("/BSI/")) body = m3Body;
  else if (url.includes("/MNA/")) body = ngdpBody;
  else if (url.includes("APP_breakdown_history")) body = appCsv;
  else if (url.includes("PEPP_purchase_history")) body = peppCsv;
  else if (url.includes("db=MD01")) body = mbCsv;
  else if (url.includes("stat-search.boj.or.jp")) body = bojBody;
  else if (url.includes("id=JPNNGDP")) body = fredBody;
  else if (url.includes("id=DFII10")) body = "observation_date,DFII10\n2026-08-27,2.34\n2026-08-28,2.42\n";
  else if (url.includes("id=IRLTLT01JPM156N")) body = "observation_date,IRLTLT01JPM156N\n2026-06-01,2.670\n";
  else if (url.includes("id=JPNCPIALLMINMEI")) body = "observation_date,JPNCPIALLMINMEI\n2025-06-01,100\n2026-06-01,102.2\n";
  else if (url.includes("id=WSHOBL")) body = "observation_date,WSHOBL\n2026-08-26,541995\n";
  else if (url.includes("jgbcm.csv")) body = "";
  else body = "";
  return new Response(body, { status: 200 });
};
const mem = memoryBriefingCache();
const briefing = await fetchLiquidityBriefing({
  fetchImpl: fakeFetch,
  cache: mem,
  now: new Date("2026-09-04T16:00:00Z"),
  readUsLiquidity: () => ({ velocity: 1.415, emg: null }),
});
ok("Quellen holen M2V/M2SL und keine toten IDs", calls > 7 && seen.some(u => u.includes("M2V")) && seen.every(u => !DEAD_FRED_SERIES.some(id => u.includes(id))), `${calls}`);
ok("DFII10 wird live geholt", seen.some(u => u.includes("id=DFII10")));
ok("MoF-CSV ist angefragt", seen.some(u => u.includes("jgbcm.csv")));
ok("MSPD ist angefragt", seen.some(u => u.includes("fiscaldata.treasury.gov")));
ok("WFS ist angefragt", seen.some(u => u.includes("L050100")));
ok("US-Velocity nur durchgereicht", briefing.us.velocity === 1.415 && briefing.us.source === "liquidity-regime" && briefing.us.emg == null);
ok("EZ-Velocity gesetzt", briefing.eurozone.velocity != null && briefing.available.ez, String(briefing.eurozone.velocity));
ok("EZ YoY ist die EZB-Wachstumsrate", briefing.eurozone.yoy === 3.49, String(briefing.eurozone.yoy));
ok("JP YoY ist die BoJ-Rate", briefing.japan.yoy === 2, String(briefing.japan.yoy));
ok("EZ M1 Jul aus der Tabelle", briefing.eurozone.m1StockBn === 11291.8 && briefing.eurozone.m1Yoy === 3.14, String(briefing.eurozone.m1StockBn));
ok("EZ M2 Jul aus der Tabelle", briefing.eurozone.m2StockBn === 16434.7 && briefing.eurozone.m2Yoy === 3.33, String(briefing.eurozone.m2StockBn));
ok("JP Geldbasis aus MD01", briefing.japan.monetaryBaseTn === 554.926 && briefing.japan.monetaryBaseYoy === -13.8, String(briefing.japan.monetaryBaseTn));
ok("CN 10y bleibt leer", briefing.rates.cn10y.value == null && briefing.em.cn10y == null && !String(briefing.rates.cn10y.value).includes("1.69"));
const jpMoney = bojHundredMillionYenToBillion((12900000 + 12900000 + 12970074) / 3);
ok("JP-Velocity = NGDP / Quartalsmittel M2", briefing.japan.velocity != null && Math.abs(briefing.japan.velocity - (689219.1 / jpMoney)) < 0.002, String(briefing.japan.velocity));
ok("Fetch-APP ist Juli-Netto aus der Tabelle", briefing.app.netBn === -27.17, String(briefing.app.netBn));
ok("Fetch-PEPP ist Juli-Netto aus der Tabelle", briefing.pepp.netBn === -24.821, String(briefing.pepp.netBn));
ok("US-Realzins aus DFII10", briefing.rates.usReal.value === 2.42, String(briefing.rates.usReal.value));
ok("T½ US aus 2.42 %", briefing.halfLife.usYears != null && briefing.halfLife.usYears >= 28.9 && briefing.halfLife.usYears <= 29.1, String(briefing.halfLife.usYears));
ok("JP-Nominal ist der FRED-Monat", briefing.rates.jp10y.value === 2.67 && briefing.rates.jp10y.source.includes("IRLTLT01"), String(briefing.rates.jp10y.value));
ok("π ohne Capex-F nutzt die 2y-Kappe und wartet nicht auf F", briefing.pricedIn.available === true && briefing.pricedIn.pi != null && briefing.pricedIn.addedToLi === false);
ok("EM-Gewicht bleibt 0.10", briefing.em.weightCap === 0.1);
ok("IN 2y ist kein T½-Anker", briefing.rates.in2y.value == null && briefing.halfLife.ezYears == null);
ok("QT aus APP+PEPP", briefing.books.eu.qtNetBn === -52, String(briefing.books.eu.qtNetBn));
ok("SOMA-Bills aus WSHOBL", briefing.books.us.somaBillsMn === 541995, String(briefing.books.us.somaBillsMn));
ok("Nakajima ist nicht im Cache", briefing.nakajima.cached === false);
ok("QRA nur US-Frontend", briefing.qra.usFrontendOnly === true && briefing.qra.nextRelease === "2026-11-04");
ok("Briefing-Key schreibt nicht die Quell-Keys um", mem.get(CACHE_KEYS.eu) != null && mem.get(CACHE_KEYS.us) != null && mem.get("briefing_v2__2026-09-04") != null);
const callsAfter = calls;
await fetchLiquidityBriefing({
  fetchImpl: fakeFetch,
  cache: mem,
  now: new Date("2026-09-04T18:00:00Z"),
  readUsLiquidity: () => ({ velocity: 1.415, emg: null }),
});
ok("zweiter Lesen trifft den Briefing-Cache", calls === callsAfter);

const catalogOnly = assembleCatalog({
  fred: {
    DFII10: "observation_date,DFII10\n2021-01-01,1\n2026-08-28,2.42\n",
  },
  mof: "Date,10Y\n2026/9/2,1.70\n",
  mspd: "",
  wfs: "",
}, {
  usVelocity: null,
  usVelocityMedian: null,
  jpVelocity: 0.5,
  jpVelocityMedian: 0.5,
  ezVelocity: null,
  ezVelocityMedian: null,
  jpMoneyBn: 100,
  fRestBn: null,
  deltaMBn: null,
  app: [],
  pepp: [],
  nowIso: "2026-09-04",
});
ok("Katalog nimmt MoF vor FRED", catalogOnly.rates.jp10y.source === "MoF constant-maturity" && catalogOnly.rates.jp10y.value === 1.7);
const cnIgnored = assembleCatalog({
  fred: {
    DGS10: "observation_date,DGS10\n2026-09-02,4.81\n",
    IRLTLT01CNM156N: "observation_date,IRLTLT01CNM156N\n2026-09-02,1.69\n",
  },
  mof: "",
  mspd: "",
  wfs: "",
}, {
  usVelocity: null,
  usVelocityMedian: null,
  jpVelocity: null,
  jpVelocityMedian: null,
  ezVelocity: null,
  ezVelocityMedian: null,
  jpMoneyBn: null,
  fRestBn: null,
  deltaMBn: null,
  app: [],
  pepp: [],
  nowIso: "2026-09-04",
});
ok("CN 10y wird nicht aus FRED gefüllt", cnIgnored.rates.cn10y.value == null && cnIgnored.em.cn10y == null);
ok("Carry ohne CN-Serie bleibt leer", cnIgnored.spillover.find(row => row.id === "us-asia-carry")?.latest == null);

const ecbOnly = parseEcbCsv(m3Body);
ok("EZB-CSV TIME_PERIOD", ecbOnly.length === 6 && ecbOnly[5].period === "2026-06");

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
