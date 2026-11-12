/**
 * Stocks · US display only. Numbers stay in the source unit (bn of home currency).
 * Run: npx tsx script/test-regional-stocks-format.ts
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as esbuild from "esbuild";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRegionalStocks } from "../server/liquidity-stocks-velocity";
import {
  ASIA_BOND_SOURCE,
  ASIA_BOND_UNIT,
  EU_BOND_SOURCE,
  EU_BOND_UNIT,
  stocksFromSeries,
  US_BOND_SOURCE,
  US_BOND_UNIT,
} from "../server/liquidity-stocks-series";
import { formatRegionalStockTiles } from "../client/src/components/researcher/regional-stocks-format";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const NOW = new Date("2026-10-03T00:00:00.000Z");

const screenshot = {
  debtGdpPct: 121.2,
  bondMarketBn: 31835,
  bondMarketGdpPct: 96.4,
  bondMarketUnit: US_BOND_UNIT,
  bondMarketSource: US_BOND_SOURCE,
  bondMarketAsOf: "2026-08-05",
  realRatePct: 2.63,
  tHalfYears: 26.4,
  velocity: 1.417,
  velocityLabel: "M2V",
  fiscalTrend: 54,
  moneyTrend: 46,
  pricedIn: 1,
  velocityOverMedian: 1.01,
  piNote: "π = 2y cap × V/V̄ (Philip; program start unknown)",
};

const view = formatRegionalStockTiles(screenshot);
const byLabel = (label: string) => view.find(tile => tile.label === label);

console.log("screenshot tiles");
const bond = byLabel("Bondmarkt");
ok("Bondmarkt shows Bio. from the Mrd. source unit", bond?.value === "31,8 Bio. $ · 96,4 % BIP", bond?.value);
ok("tooltip names the raw bn, source and date",
  (bond?.title ?? "").includes("31.835")
  && (bond?.title ?? "").includes("Mrd. $")
  && (bond?.title ?? "").includes(US_BOND_SOURCE)
  && (bond?.title ?? "").includes("2026-08-05"),
  bond?.title);
ok("tooltip does not relabel the raw value as Bio.", !(bond?.title ?? "").includes("Bio."));
ok("Debt/GDP is percent in German", byLabel("Debt/GDP")?.value === "121,2 %", byLabel("Debt/GDP")?.value);
ok("Realzins keeps percent", byLabel("Realzins r")?.value === "2,63 %", byLabel("Realzins r")?.value);
ok("Velocity keeps 1,417 and names M2V",
  byLabel("Velocity")?.value === "1,417" && (byLabel("Velocity")?.hint ?? "").includes("M2V") && (byLabel("Velocity")?.hint ?? "").includes("dimensionslos"),
  `${byLabel("Velocity")?.value} / ${byLabel("Velocity")?.hint}`);
ok("Fiscal trend explains the 0–100 score",
  byLabel("Fiscal trend")?.value === "54" && (byLabel("Fiscal trend")?.hint ?? "").includes("0–100"),
  byLabel("Fiscal trend")?.hint);
ok("Geldtrend explains the 0–100 score",
  byLabel("Geldtrend")?.value === "46" && (byLabel("Geldtrend")?.hint ?? "").includes("0–100"),
  byLabel("Geldtrend")?.hint);
ok("π 1,00 says the share is fully priced in",
  byLabel("π")?.value === "1,00" && /voll|eingepreist/i.test(`${byLabel("π")?.hint} ${byLabel("π")?.title}`),
  `${byLabel("π")?.value} / ${byLabel("π")?.hint}`);
ok("π tooltip keeps the source note", (byLabel("π")?.title ?? "").includes("program start unknown"));
ok("V/V̄ explains the median",
  byLabel("V/V̄")?.value === "1,01" && /Median/.test(byLabel("V/V̄")?.hint ?? ""),
  byLabel("V/V̄")?.hint);
ok("T½ is years, not a bare J",
  byLabel("T½")?.value === "26,4 Jahre" && !/ J$/.test(byLabel("T½")?.value ?? ""),
  byLabel("T½")?.value);
ok("V is the same velocity with an explanation",
  byLabel("V")?.value === "1,417" && /Velocity|M2V/.test(`${byLabel("V")?.hint} ${byLabel("V")?.title}`),
  byLabel("V")?.hint);
ok("formatter does not rewrite the bn input", screenshot.bondMarketBn === 31835);

console.log("other home currencies");
const eu = formatRegionalStockTiles({
  ...screenshot,
  bondMarketBn: 8000,
  bondMarketGdpPct: 100,
  bondMarketUnit: EU_BOND_UNIT,
  bondMarketSource: EU_BOND_SOURCE,
  bondMarketAsOf: "2026-01-01",
});
const euBond = eu.find(tile => tile.label === "Bondmarkt");
ok("8.000 Mrd. € renders as Bio. €", euBond?.value === "8,0 Bio. € · 100,0 % BIP", euBond?.value);
ok("EU tooltip stays in Mrd. €", (euBond?.title ?? "").includes("8.000 Mrd. €") && (euBond?.title ?? "").includes(EU_BOND_SOURCE));

const jp = formatRegionalStockTiles({
  ...screenshot,
  bondMarketBn: 500,
  bondMarketGdpPct: (500 / 600) * 100,
  bondMarketUnit: ASIA_BOND_UNIT,
  bondMarketSource: ASIA_BOND_SOURCE,
  bondMarketAsOf: "2026-08-01",
});
const jpBond = jp.find(tile => tile.label === "Bondmarkt");
ok("500 stays Mrd. ¥", jpBond?.value === "500 Mrd. ¥ · 83,3 % BIP", jpBond?.value);
ok("yen tooltip names BoJ and the date",
  (jpBond?.title ?? "").includes("500 Mrd. ¥") && (jpBond?.title ?? "").includes(ASIA_BOND_SOURCE) && (jpBond?.title ?? "").includes("2026-08-01"),
  jpBond?.title);

const bare = formatRegionalStockTiles({ ...screenshot, bondMarketUnit: null, bondMarketSource: null, bondMarketAsOf: null });
const bareBond = bare.find(tile => tile.label === "Bondmarkt");
ok("missing unit is not guessed as dollar or Bio.",
  bareBond?.value === "31.835 · 96,4 % BIP" && !(bareBond?.value ?? "").includes("$") && !(bareBond?.value ?? "").includes("Bio"),
  bareBond?.value);
ok("missing unit says so", (bareBond?.title ?? "").includes("Einheit fehlt"));

const ratioView = formatRegionalStockTiles({ ...screenshot, velocity: 1.4, velocityLabel: "BIP/M2" });
ok("BIP/M2 label is shown when that is the source", (ratioView.find(t => t.label === "Velocity")?.hint ?? "").includes("BIP/M2"));

console.log("source chain keeps the number");
const plain = buildRegionalStocks({
  bondMarketBn: 31835,
  bondMarketGdpPct: 96.4,
  realRate: 0.0263,
  velocity: 1.417,
  velocityHistory: [1.4, 1.417],
  fiscalTrend: 54,
  moneyTrend: 46,
});
const tagged = buildRegionalStocks({
  bondMarketBn: 31835,
  bondMarketGdpPct: 96.4,
  bondMarketUnit: US_BOND_UNIT,
  bondMarketSource: US_BOND_SOURCE,
  bondMarketAsOf: "2026-08-05",
  realRate: 0.0263,
  velocity: 1.417,
  velocityLabel: "M2V",
  velocityHistory: [1.4, 1.417],
  fiscalTrend: 54,
  moneyTrend: 46,
});
ok("metadata does not change bn", tagged.bondMarketBn === plain.bondMarketBn && tagged.bondMarketBn === 31835);
ok("metadata does not change the percent of GDP", tagged.bondMarketGdpPct === plain.bondMarketGdpPct && tagged.bondMarketGdpPct === 96.4);
ok("metadata does not change r, V, π, T½, trends",
  tagged.realRatePct === plain.realRatePct
  && tagged.velocity === plain.velocity
  && tagged.pricedIn === plain.pricedIn
  && tagged.tHalfYears === plain.tHalfYears
  && tagged.velocityOverMedian === plain.velocityOverMedian
  && tagged.fiscalTrend === plain.fiscalTrend
  && tagged.moneyTrend === plain.moneyTrend);
ok("payload carries the source unit", tagged.bondMarketUnit === "Mrd. $" && tagged.bondMarketSource === US_BOND_SOURCE && tagged.bondMarketAsOf === "2026-08-05");
ok("payload carries the velocity label", tagged.velocityLabel === "M2V");

const usBonds = stocksFromSeries("US", {
  MSPD_MARKETABLE: [{ date: "2026-08-31", value: 20000 }],
  GDP: [{ date: "2026-07-01", value: 25000 }],
}, NOW);
ok("US series bn and GDP percent stay put", usBonds.bondMarketBn === 20000 && usBonds.bondMarketGdpPct === 80, JSON.stringify(usBonds));
ok("US unit is Mrd. $ from the millions field", usBonds.bondMarketUnit === US_BOND_UNIT && usBonds.bondMarketAsOf === "2026-08-31");
ok("US source names MSPD total_mil_amt", usBonds.bondMarketSource === US_BOND_SOURCE);

const m2v = stocksFromSeries("US", { M2V: [{ date: "2026-06-01", value: 1.1 }] }, NOW);
ok("M2V value stays 1.1 and the label is M2V", m2v.velocity === 1.1 && m2v.velocityLabel === "M2V", String(m2v.velocityLabel));
const ratio = stocksFromSeries("US", {
  GDP: [{ date: "2024-01-01", value: 20000 }, { date: "2026-01-01", value: 28000 }],
  M2SL: [{ date: "2024-01-01", value: 20000 }, { date: "2026-01-01", value: 20000 }],
}, NOW);
ok("GDP/M2 value stays 1.4", ratio.velocity === 1.4, String(ratio.velocity));
ok("GDP/M2 label is BIP/M2", ratio.velocityLabel === "BIP/M2", String(ratio.velocityLabel));

const euSeries = stocksFromSeries("EU", {
  EZ_DEBT_SEC: [{ date: "2026-01-01", value: 8000 }],
  ECB_NGDP: [{ date: "2026-01-01", value: 2000 }],
}, NOW);
ok("EU bn stays 8000", euSeries.bondMarketBn === 8000 && euSeries.bondMarketGdpPct === 100, JSON.stringify(euSeries));
ok("EU unit is Mrd. €", euSeries.bondMarketUnit === EU_BOND_UNIT && euSeries.bondMarketSource === EU_BOND_SOURCE && euSeries.bondMarketAsOf === "2026-01-01");

const jpSeries = stocksFromSeries("ASIA", {
  BOJ_JGB: [{ date: "2026-08-01", value: 500 }],
  JPNNGDP: [{ date: "2026-04-01", value: 600 }],
}, NOW);
ok("JP bn stays 500", jpSeries.bondMarketBn === 500, String(jpSeries.bondMarketBn));
ok("JP unit is Mrd. ¥", jpSeries.bondMarketUnit === ASIA_BOND_UNIT && jpSeries.bondMarketSource === ASIA_BOND_SOURCE && jpSeries.bondMarketAsOf === "2026-08-01");

console.log("tiles render the same strings");
const outfile = path.join(os.tmpdir(), "regional-stocks-tiles.mjs");
await esbuild.build({
  absWorkingDir: path.resolve("."),
  entryPoints: ["client/src/components/researcher/RegionalStocksStrip.tsx"],
  bundle: true,
  format: "esm",
  platform: "node",
  jsx: "automatic",
  outfile,
  logLevel: "silent",
  alias: { "@/lib/queryClient": "./client/src/lib/queryClient.ts" },
});
const { RegionalStocksTiles } = await import(pathToFileURL(outfile).href);
const html = renderToStaticMarkup(createElement(RegionalStocksTiles, { stocks: screenshot }));
ok("rendered bond value", html.includes("31,8 Bio. $ · 96,4 % BIP"));
ok("rendered tooltip", html.includes("31.835") && html.includes(US_BOND_SOURCE) && html.includes("2026-08-05"));
ok("rendered π and T½", html.includes("1,00") && html.includes("26,4 Jahre"));
ok("rendered debt and real rate", html.includes("121,2 %") && html.includes("2,63 %"));
ok("existing test ids stay", ["text-priced-in", "text-velocity-ratio", "text-thalf", "text-velocity"].every(id => html.includes(id)));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall ok");
