/**
 * Sec14 FRED-Messkarten: die fuenfte Karte TGA erscheint, wenn measured.tgaBn gesetzt ist.
 * Fixture ist der Live-Dump von POST /api/analyze-btc/policy-scan (DoD #118):
 * die vier Screenshot-Werte bleiben, TGA kommt aus measured.tgaBn.
 * Milliarden wie M2 (Wert in Mrd. USD → formatUsdCompact).
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-measured-fred-cards.ts
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChannelMarks, FactorTitle, MeasuredFredCards } from "../client/src/components/btc/StablecoinLiquidityPanel";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const dump = JSON.parse(readFileSync(new URL("./fixtures/policy-scan-dod118.json", import.meta.url), "utf8"));
const live = dump.measured;
ok("Live-Dump enthaelt tgaBn", live?.tgaBn === 977.084 && live?.m2Bn === 23342.8 && live?.policyRate === 3.88);

const html = renderToStaticMarkup(createElement(MeasuredFredCards, { measured: live }));

const labels = ["Leitzins", "Realzins 10Y", "10-Jahres-Rendite", "M2", "TGA"];
let cursor = -1;
for (const label of labels) {
  const at = html.indexOf(`>${label}<`);
  ok(`${label} steht im Messraster`, at > cursor, `index ${at}`);
  cursor = at;
}

ok("Leitzins bleibt 3.88%", html.includes("3.88%"));
ok("Realzins 10Y bleibt 2.91%", html.includes("2.91%"));
ok("10-Jahres-Rendite bleibt 5.26%", html.includes("5.26%"));
ok("M2 bleibt $23.34 Bio.", html.includes("$23.34 Bio."));
ok("TGA formatiert Milliarden wie M2", html.includes("$977.08 Mrd."));
ok("fuenf FRED-Unterzeilen", (html.match(/FRED, gemessen/g) ?? []).length === 5);

const withoutTga = renderToStaticMarkup(createElement(MeasuredFredCards, {
  measured: { policyRate: 3.88, realYield10y: 2.91, dgs10: 5.26, m2Bn: 23340, tgaBn: null },
}));
ok("TGA-Slot bleibt sichtbar ohne Wert", withoutTga.includes(">TGA<") && withoutTga.includes("n/v"));

const panel = readFileSync(new URL("../client/src/components/btc/StablecoinLiquidityPanel.tsx", import.meta.url), "utf8");
ok("Policy-Scan rendert MeasuredFredCards", panel.includes("<MeasuredFredCards"));
ok("ohne Fenster bleibt die Richtung unbekannt", (html.match(/1J unbekannt/g) ?? []).length === 5);

const withWindows = renderToStaticMarkup(createElement(MeasuredFredCards, {
  measured: {
    policyRate: 3.88,
    realYield10y: 2.91,
    dgs10: 5.26,
    m2Bn: 23342.8,
    tgaBn: 977.084,
    windows: {
      policyRate: { latest: 3.88, level1y: 4.5, level2y: 5, diff1y: -0.62, diff2y: -1.12, direction1y: "fallend", direction2y: "fallend" },
      realYield10y: { latest: 2.91, level1y: 2.91, level2y: null, diff1y: 0, diff2y: null, direction1y: "unverändert", direction2y: "unbekannt" },
      dgs10: { latest: 5.26, level1y: 4, level2y: 3, diff1y: 1.26, diff2y: 2.26, direction1y: "steigend", direction2y: "steigend" },
      m2Bn: { latest: 23342.8, level1y: 21000, level2y: 20000, diff1y: 2342.8, diff2y: 3342.8, direction1y: "steigend", direction2y: "steigend" },
      tgaBn: { latest: 977.084, level1y: 800, level2y: 700, diff1y: 177, diff2y: 277, direction1y: "steigend", direction2y: "steigend" },
    },
  },
}));
ok("1J- und 2J-Richtung stehen an jeder Serie", (withWindows.match(/1J /g) ?? []).length === 5 && (withWindows.match(/2J /g) ?? []).length === 5);
ok("steigend bleibt sichtbar", withWindows.includes("1J steigend"));
ok(
  "steigend gruen nach oben, fallend rot nach unten, unveraendert neutral",
  (withWindows.match(/data-testid="series-up"/g) ?? []).length === 6
    && (withWindows.match(/data-testid="series-down"/g) ?? []).length === 2
    && (withWindows.match(/data-testid="series-flat"/g) ?? []).length === 1
    && (withWindows.match(/text-emerald-400/g) ?? []).length === 6
    && (withWindows.match(/text-red-400/g) ?? []).length === 2,
);
ok(
  "unbekannt hat keinen Pfeil",
  (withWindows.match(/2J unbekannt/g) ?? []).length === 1
    && withWindows.includes("2J unbekannt</span></span>")
    && !withWindows.includes("1J unbekannt"),
);
ok("ohne Fenster kein Richtungspeil", !html.includes("series-up") && !html.includes("series-down") && !html.includes("series-flat"));

const mixed = renderToStaticMarkup(createElement(ChannelMarks, {
  channels: { m2: "up", policyRate: "down", realYield: "unclear", cryptoLiquidity: "up" },
}));
ok(
  "jeder Kanal behaelt seinen Pfeil",
  mixed.includes("M2: aufwärts")
    && mixed.includes("Leitzins: abwärts")
    && mixed.includes("Krypto-Liquidität: aufwärts")
    && (mixed.match(/data-testid="direction-up"/g) ?? []).length === 2
    && (mixed.match(/data-testid="direction-down"/g) ?? []).length === 1
    && !mixed.includes("unclear")
    && !mixed.includes("Realzins"),
);
const noLiquidity = renderToStaticMarkup(createElement(FactorTitle, {
  channels: { m2: "up", policyRate: "down" },
  children: "Gemischt",
}));
ok("ohne Krypto-Liquiditaet kein Kartenpfeil", noLiquidity.includes("Gemischt") && !noLiquidity.includes("card-crypto-liquidity"));
const upCard = renderToStaticMarkup(createElement(FactorTitle, {
  channels: { cryptoLiquidity: "up", policyRate: "down" },
  children: "Rahmen",
}));
ok(
  "Kartenpfeil folgt nur der Krypto-Liquiditaet",
  upCard.includes('data-testid="card-crypto-liquidity"')
    && upCard.includes("text-emerald-400")
    && !upCard.includes("text-red-400"),
);
const downCard = renderToStaticMarkup(createElement(FactorTitle, {
  channels: { cryptoLiquidity: "down" },
  children: "Verbot",
}));
ok("Kartenpfeil abwaerts ist rot", downCard.includes("text-red-400") && downCard.includes("card-crypto-liquidity"));

const bannedCards = ["DeFi-TVL", "TVL-Δ", "Stablecoin Total MCap", "USDT (Tether)", "USDC (Circle)", "Stablecoin-Δ", "Liquiditätstracker"];
ok(
  "Sektion 14 rendert die sechs DefiLlama-Karten nicht",
  bannedCards.every(label => !panel.includes(label)) && !panel.includes("/api/analyze-btc/stablecoin-liquidity"),
  bannedCards.filter(label => panel.includes(label)).join(", "),
);
ok("Nachrichten liegen in Sektion 14", panel.includes("Aktuelle Nachrichten") && panel.includes("/api/analyze-btc/news"));
ok(
  "Regel- und Instrumentkarten zeigen Kanalpfeile und einen Kartenpfeil nur fuer Krypto-Liquiditaet",
  panel.includes("<FactorTitle") && panel.includes("<ChannelMarks") && panel.includes("card-crypto-liquidity"),
);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nmeasured FRED cards ok");
