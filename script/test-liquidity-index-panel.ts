/**
 * Researcher liquidity index panel. Region query, titles, fiscal mask, wiring.
 * Run: npx tsx script/test-liquidity-index-panel.ts
 */
import { readFileSync } from "node:fs";
import {
  channelsFromBooks,
  fiscalOfferLine,
  formatLi,
  liquidityIndexPath,
  liquidityIndexTitle,
  listedSeries,
  type IndexSlot,
} from "../client/src/components/researcher/liquidity-index-panel";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

console.log("liquidity index panel");

ok("EU query uses the existing route", liquidityIndexPath("EU") === "/api/researcher/liquidity?region=EU");
ok("ASIA query", liquidityIndexPath("ASIA") === "/api/researcher/liquidity?region=ASIA");
ok("US refresh stays on the same route", liquidityIndexPath("US", true) === "/api/researcher/liquidity?region=US&refresh=1");

ok("title USA", liquidityIndexTitle("US") === "Liquidity Index · USA");
ok("title EZ", liquidityIndexTitle("EU") === "Liquidity Index · EZ");
ok("title JP", liquidityIndexTitle("ASIA") === "Liquidity Index · JP");

ok("missing LI is n/v", formatLi(null) === "n/v");
ok("LI prints one decimal", formatLi(62.4) === "62.4");

const down: IndexSlot = { role: "netIssuance", available: false, series: ["EU_BONDS"], score: null, x: null };
const up: IndexSlot = { role: "netIssuance", available: true, series: ["MSPD_BILLS"], score: 40, x: 12.5 };
const fiscalDown = fiscalOfferLine([down]);
ok("unavailable fiscal offer", fiscalDown === "Fiskal-Angebot n/v", fiscalDown);
ok("unavailable fiscal offer does not print a US bill delta", !fiscalDown.includes("298"));
ok("available fiscal offer is the series, not the n/v line", fiscalOfferLine([up]) === "MSPD_BILLS");

const usSeries = listedSeries({
  books: {
    M: [{ role: "assets", available: true, series: ["WALCL"], score: 50, x: 1 }],
    F: [{ role: "govCash", available: true, series: ["WTREGEN"], score: 50, x: 1 }],
  },
  money: [],
});
const euSeries = listedSeries({
  books: {
    M: [{ role: "rate", available: true, series: ["ECBDFR"], score: 50, x: -0.1 }],
    F: [{ role: "netIssuance", available: false, series: ["EU_BONDS"], score: null, x: null }],
  },
  money: [{ role: "money", available: true, series: ["MABMM301"], score: 55, x: 3.4 }],
});
ok("US series list contains WALCL", usSeries.includes("WALCL") && usSeries.includes("WTREGEN"));
ok("EU series list contains ECBDFR and M3", euSeries.includes("ECBDFR") && euSeries.includes("MABMM301"));
ok("US and EU series lists differ", usSeries.join("|") !== euSeries.join("|"));

const channels = channelsFromBooks({
  books: {
    M: [
      { role: "assets", available: true, series: ["WALCL"], score: 54, x: 18.5 },
      { role: "policyPortfolio", available: true, series: ["WSHOBL/WSHOTSL"], score: 51, x: -0.2 },
      { role: "rate", available: true, series: ["ECBDFR"], score: 43, x: 0.3 },
    ],
    F: [
      { role: "govCash", available: true, series: ["WTREGEN"], score: 41, x: 68.4 },
      { role: "netIssuance", available: false, series: ["EU_BONDS"], score: null, x: null },
    ],
  },
  money: [{ role: "money", available: true, series: ["MABMM301"], score: 40, x: 3.5 }],
});
ok("four channels A–D", channels.map(c => c.id).join("") === "ABCD");
ok("A is plumbing assets, policy book, and gov cash", channels[0].slots.flatMap(s => s.series).join("|") === "WALCL|WSHOBL/WSHOTSL|WTREGEN");
ok("B is the rate slot", channels[1].available && channels[1].slots[0]?.series[0] === "ECBDFR");
ok("C is money", channels[2].available && channels[2].slots[0]?.series[0] === "MABMM301");
ok("D down stays unavailable", channels[3].available === false);

const panel = readFileSync(new URL("../client/src/components/researcher/LiquidityIndexPanel.tsx", import.meta.url), "utf8");
const macro = readFileSync(new URL("../client/src/components/researcher/MacroPanel.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../client/src/pages/Researcher.tsx", import.meta.url), "utf8");

ok("panel calls the shared path helper", panel.includes("liquidityIndexPath("));
ok("panel GETs that path", panel.includes('apiRequest("GET", liquidityIndexPath('));
ok("panel has no Bessent", !panel.includes("Bessent"));
ok("panel has no GENIUS", !panel.includes("GENIUS"));
ok("panel has no hardcoded 298", !panel.includes("298"));
ok("panel test id", panel.includes('data-testid="panel-liquidity-index"'));
ok("panel renders channels A–D", panel.includes("channelsFromBooks(") && panel.includes("channel-${channel.id}"));
ok("MacroPanel renders LiquidityIndexPanel with region", macro.includes("<LiquidityIndexPanel region={region} />"));
ok(
  "macro tab mounts the index with region before analysis data exists",
  /activeTab === "macro"[\s\S]{0,700}<MacroPanel[^>]*region=\{region\}/.test(page)
    && !/\{currentData && activeTab === "macro" && <MacroPanel/.test(page),
);

console.log(failed === 0 ? "ALL PASSED" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
