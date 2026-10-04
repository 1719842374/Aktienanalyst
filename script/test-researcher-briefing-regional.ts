/**
 * DoD Offen_WORK_RESEARCHER_BRIEFING_REGIONAL.md
 * Run: npx tsx script/test-researcher-briefing-regional.ts
 *
 * Zahlen kommen aus dem Index-Cache oder sind null.
 * Eine Region ohne Quelle bleibt leer und kopiert den US-Text nicht.
 */
import {
  BRIEFING_PROMPT_CORE,
  applyTopChangeQuota,
  briefingSchema,
  briefingV2CacheFresh,
  briefingV2Failures,
  buildRegionalBriefingPrompt,
  composeRegionalBriefing,
  headlineOk,
  parseIndexCache,
  type SourceEvent,
} from "../server/researcher-briefing-regional";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const usTariff = "USTR tariff escalation";
const euMoney = "EZB hält den DF-Satz";

function ev(partial: Partial<SourceEvent> & Pick<SourceEvent, "region" | "title">): SourceEvent {
  return {
    severity: "medium",
    category: "Geopolitik",
    inflationImpact: "neutral",
    rateImpact: "neutral",
    equityImpact: "neutral",
    ...partial,
  };
}

console.log("Fixture — regions.length und US-only topChanges");
const missingRegions = briefingV2Failures({
  asOf: "2026-10-04",
  headline: "Cross US EU ASIA",
  cross: ["US→EZ: n/v", "US→Asia: n/v", "EZ→Asia: n/v"],
  regions: [] as never,
  topChanges: [],
  tacticalStance: "Neutral",
  stanceRationale: "n/v",
  _schema: "v2",
});
ok("ohne regions.length===3 ist fail", missingRegions.includes("regions.length"));

const usOnly = briefingV2Failures({
  asOf: "2026-10-04",
  headline: "Cross US EU",
  cross: ["a", "b", "c"],
  regions: [
    { region: "US", stance: "Neutral", money: "n/v", fiscal: "n/v", trade: "x", li: null, realRatePct: null, velocity: null, pricedIn: null },
    { region: "EU", stance: "Neutral", money: "n/v", fiscal: "n/v", trade: "y", li: null, realRatePct: null, velocity: null, pricedIn: null },
    { region: "ASIA", stance: "Neutral", money: "n/v", fiscal: "n/v", trade: "z", li: null, realRatePct: null, velocity: null, pricedIn: null },
  ],
  topChanges: [
    { region: "US", category: "Handel", title: "a", changeType: "NEW" },
    { region: "US", category: "Handel", title: "b", changeType: "NEW" },
    { region: "US", category: "Handel", title: "c", changeType: "NEW" },
  ],
  tacticalStance: "Neutral",
  stanceRationale: "n/v",
  _schema: "v2",
});
ok("US-only topChanges fail", usOnly.includes("us-only"));
ok("Headline ohne zweites Kürzel fail", headlineOk("Nur die Fed") === false);
ok("Headline mit cross passt", headlineOk("Cross: Lage unverändert") === true);
ok("Headline mit US und EU passt", headlineOk("US und EU auseinander") === true);
ok("singleRegionFocus lässt Ein-Region-Headline zu", headlineOk("Nur die Fed", true) === true);

console.log("Quota — nicht drei Kopien der US-Lage");
const manyUs = Array.from({ length: 4 }, (_, i) => ev({
  region: "US",
  title: `US tariff ${i}`,
  category: "Handel",
  severity: "high",
}));
const kept = applyTopChangeQuota([
  ...manyUs.map(e => ({ ...e, changeType: "NEW" as const, category: "Handel" as const })),
  { ...ev({ region: "EU", title: "EZB M3", category: "Geldpolitik", severity: "medium" }), changeType: "UNCHANGED" as const, category: "Geldpolitik" as const },
  { ...ev({ region: "ASIA", title: "BoJ hält", category: "Geldpolitik", severity: "low" }), changeType: "UNCHANGED" as const, category: "Geldpolitik" as const },
]);
ok("global cap 6", kept.length <= 6);
ok("höchstens 3 US", kept.filter(c => c.region === "US" && c.title !== "none").length <= 3);
ok("EU ist dabei", kept.some(c => c.region === "EU" && c.title === "EZB M3"));
ok("ASIA ist dabei", kept.some(c => c.region === "ASIA" && c.title === "BoJ hält"));
ok("nicht nur US", !kept.every(c => c.region === "US"));

const usAlone = applyTopChangeQuota([
  { ...ev({ region: "US", title: "US tariff", category: "Handel", severity: "high" }), changeType: "NEW", category: "Handel" },
]);
ok("EU ohne Event ist explizit none", usAlone.some(c => c.region === "EU" && c.title === "none"));
ok("ASIA ohne Event ist explizit none", usAlone.some(c => c.region === "ASIA" && c.title === "none"));

console.log("Quellen — leere Region kopiert US nicht");
const composed = composeRegionalBriefing({
  asOf: "2026-10-04T08:00:00.000Z",
  regions: [
    {
      region: "US",
      hasMacro: true,
      macroAction: "Watch",
      events: [ev({ region: "US", title: usTariff, category: "Handel", severity: "high" })],
      prior: [],
      index: { available: true, li: 62, label: "neutral", realRatePct: 1.8, velocity: 1.41, pricedIn: 0.2, emg: 0.5, liSigma: 4, realRateSigma: 0.3 },
      priorIndex: { li: 60, realRatePct: 1.8 },
    },
    {
      region: "EU",
      hasMacro: true,
      macroAction: "Avoid",
      events: [ev({ region: "EU", title: "EZB M3", category: "Geldpolitik", severity: "medium" })],
      prior: [],
      index: { available: true, li: 48, label: "neutral", velocity: 1.1, realRatePct: 0.4, pricedIn: null, emg: null },
      priorIndex: null,
    },
    {
      region: "ASIA",
      hasMacro: false,
      events: [],
      prior: [],
      index: null,
      priorIndex: null,
    },
  ],
  llm: {
    headline: "Nur die Fed",
    cross: [usTariff, usTariff, usTariff],
    tacticalStance: "Opportunistisch",
    stanceRationale: "Alles folgt den USA",
    regions: [
      { region: "US", stance: "Opportunistisch", money: "Fed", fiscal: "QRA", trade: usTariff },
      { region: "EU", stance: "Opportunistisch", money: "Fed", fiscal: "QRA", trade: usTariff },
      { region: "ASIA", stance: "Opportunistisch", money: "Fed", fiscal: "QRA", trade: usTariff },
    ],
  },
});

ok("regions.length === 3", composed.regions.length === 3);
ok("Reihenfolge US EU ASIA", composed.regions.map(r => r.region).join(",") === "US,EU,ASIA");
ok("jede Region hat trade", composed.regions.every(r => r.trade.trim().length > 0));
ok("ASIA trade ist nicht der US-Text", composed.regions[2].trade !== usTariff);
ok("ASIA trade bleibt leer als n/v", composed.regions[2].trade === "n/v");
ok("ASIA money kopiert US nicht", composed.regions[2].money !== "Fed");
ok("EU trade ist nicht der US-Text", composed.regions[1].trade !== usTariff);
ok("EU Geld-Event bleibt eigene Quelle", composed.regions[1].money.includes("EZB") || composed.regions[1].money.includes("M3") || composed.regions[1].money.includes("LI"));
ok("US Zahlen aus Cache", composed.regions[0].li === 62 && composed.regions[0].velocity === 1.41 && composed.regions[0].realRatePct === 1.8);
ok("EU pricedIn ohne Serie ist null", composed.regions[1].pricedIn === null);
ok("ASIA Zahlen null", composed.regions[2].li === null && composed.regions[2].velocity === null && composed.regions[2].realRatePct === null && composed.regions[2].pricedIn === null);
ok("cross hat 3 Zeilen", composed.cross.length === 3);
ok("cross nennt die Paare", composed.cross[0].startsWith("US→EZ") && composed.cross[1].startsWith("US→Asia") && composed.cross[2].startsWith("EZ→Asia"));
ok("schlechte Headline wird ersetzt", headlineOk(composed.headline, composed.singleRegionFocus) === true);
ok("singleRegionFocus default aus", composed.singleRegionFocus !== true);
ok("Compose-Output besteht DoD", briefingV2Failures(composed).length === 0, briefingV2Failures(composed).join(","));
ok("topChanges nicht 3× US", !composed.topChanges.every(c => c.region === "US"));
ok("ASIA-Slot in topChanges", composed.topChanges.some(c => c.region === "ASIA"));

console.log("Index-Cache");
const off = parseIndexCache({ available: false, li: 99, velocity: 9, realRatePct: 9, pricedIn: 9 });
ok("available false löscht Zahlen", off.available === false && off.li === null && off.velocity === null && off.realRatePct === null && off.pricedIn === null);
const fromStocks = parseIndexCache({
  li: 55,
  label: "restriktiv",
  stocks: { realRatePct: 2.1, velocity: 1.33, pricedIn: 0.4, excessMoneyGrowth: 1.2 },
});
ok("liqidx-Payload ohne Flag liest li/r/V/π", fromStocks.available === true && fromStocks.li === 55 && fromStocks.realRatePct === 2.1 && fromStocks.velocity === 1.33 && fromStocks.pricedIn === 0.4 && fromStocks.emg === 1.2);
ok("fehlender Cache ist nicht verfügbar", parseIndexCache(null).available === false && parseIndexCache(null).li === null);

const hallucinated = composeRegionalBriefing({
  asOf: "2026-10-04T08:00:00.000Z",
  regions: [
    {
      region: "US",
      hasMacro: true,
      events: [],
      prior: [],
      index: { available: true, li: 10, velocity: 1.2, realRatePct: null, pricedIn: null, emg: null },
      priorIndex: null,
    },
    {
      region: "EU",
      hasMacro: true,
      events: [],
      prior: [],
      index: null,
      priorIndex: null,
    },
    {
      region: "ASIA",
      hasMacro: false,
      events: [],
      prior: [],
      index: null,
      priorIndex: null,
    },
  ],
  llm: {
    headline: "Cross US EU ASIA",
    regions: [
      { region: "US", money: "V liegt bei 9.9", fiscal: "n/v", trade: "keine Tarifänderung seit gestern" },
      { region: "EU", money: "V liegt bei 9.9", fiscal: "Haushalt", trade: "keine Tarifänderung seit gestern" },
      { region: "ASIA", money: "V liegt bei 9.9", fiscal: "Haushalt", trade: "keine Tarifänderung seit gestern" },
    ],
  },
});
ok("LLM-V wird nicht übernommen", hallucinated.regions[0].velocity === 1.2 && hallucinated.regions[1].velocity === null);
ok("EU ohne Index zitiert keine erfundene V", !hallucinated.regions[1].money.includes("9.9"));
ok("EU trade aus eigener Macro-Quelle", hallucinated.regions[1].trade === "keine Tarifänderung seit gestern");
ok("ASIA ohne Macro bleibt trade n/v", hallucinated.regions[2].trade === "n/v");

console.log("Zahlen-Event ≥ 0.5σ");
const jumped = composeRegionalBriefing({
  asOf: "2026-10-04T08:00:00.000Z",
  regions: [
    {
      region: "US",
      hasMacro: true,
      events: [],
      prior: [],
      index: { available: true, li: 70, liSigma: 4, realRatePct: 2, realRateSigma: 0.2 },
      priorIndex: { li: 60, realRatePct: 2 },
    },
    {
      region: "EU",
      hasMacro: true,
      events: [],
      prior: [],
      index: { available: true, li: 40, realRatePct: 1, realRateSigma: 0.2 },
      priorIndex: { li: 40, realRatePct: 0.5 },
    },
    {
      region: "ASIA",
      hasMacro: false,
      events: [],
      prior: [],
      index: null,
      priorIndex: null,
    },
  ],
  llm: null,
});
ok("LI-Sprung ist Zahlen-Event", jumped.topChanges.some(c => c.region === "US" && c.title.includes("LI")));
ok("r-Sprung ist Zahlen-Event", jumped.topChanges.some(c => c.region === "EU" && c.title.includes("r")));
ok("ohne Sigma kein erfundenes Event", !jumped.topChanges.some(c => c.region === "ASIA" && c.title !== "none"));

console.log("Prompt und Schema");
const prompt = buildRegionalBriefingPrompt({
  today: "2026-10-04",
  indexLines: ["US: LI=62 label=neutral r=1.8 V=1.41 EMG=0.5 π=0.2 moneyTrend=n/v fiscalTrend=n/v", "EU: Index n/v", "ASIA: Index n/v"],
  eventBlock: "",
  catalogHint: "Katalog, nicht der Filter",
});
ok("Prompt-Kern", prompt.includes(BRIEFING_PROMPT_CORE));
ok("Index n/v im Prompt", prompt.includes("EU: Index n/v") && prompt.includes("ASIA: Index n/v"));
ok("LLM darf r/V nicht erfinden", /keine r\/V|keine `r`\/`V`|darf keine r\/V|keine r\/V erfinden/i.test(prompt));
ok("v1 ohne regions", briefingSchema({ briefing: { headline: "alt" } }) === "v1");
ok("v2 mit regions", briefingSchema({ regions: composed.regions }) === "v2");

console.log("Cache-Frist");
const morning = new Date("2026-10-04T06:00:00.000Z"); // 08:00 Berlin
const afternoon = new Date("2026-10-04T14:00:00.000Z"); // 16:00 Berlin
const evening = new Date("2026-10-04T18:30:00.000Z"); // 20:30 Berlin
ok("vor 18:00 Berlin frisch", briefingV2CacheFresh(morning.toISOString(), afternoon));
ok("nach 18:00 und älter als 6h stale", briefingV2CacheFresh(morning.toISOString(), evening) === false);
ok("nach 18:00 innerhalb 6h frisch", briefingV2CacheFresh(new Date("2026-10-04T17:00:00.000Z").toISOString(), evening));

if (failed > 0) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
