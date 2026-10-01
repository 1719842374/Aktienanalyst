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
import {
  MeasuredFredCards,
  PolicyEventCard,
  briefingImpacts,
  collectPolicyEvents,
  type PolicyEventInput,
} from "../client/src/components/btc/StablecoinLiquidityPanel";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

function chip(html: string, label: "inflation" | "zinsen" | "btc"): string {
  const marker = `data-testid="impact-${label}"`;
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const rest = html.slice(start + marker.length);
  const sibling = rest.search(/data-testid="impact-(?:inflation|zinsen|btc)"/);
  return sibling < 0 ? html.slice(start) : html.slice(start, start + marker.length + sibling);
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

const opening: PolicyEventInput = {
  id: "rahmen",
  title: "Rahmen fuer Ausgabe und Reserven",
  office: "legislature",
  instrumentType: "statute",
  status: "implementing",
  channels: { cryptoLiquidity: "up", inflation: "up", policyRate: "up", realYield: "unclear", m2: "up" },
  note: "Der Text oeffnet die Ausgabe.",
  evidence: [{ source: "Amtsblatt", url: "https://example.test/rahmen", date: "2026-09-01" }],
};
const openingHtml = renderToStaticMarkup(createElement(PolicyEventCard, { event: opening }));
ok(
  "Briefing-Karte zeigt Inflation, Zinsen und BTC",
  openingHtml.includes("Aktuelle") === false
    && openingHtml.includes(">Inflation<")
    && openingHtml.includes(">Zinsen<")
    && openingHtml.includes(">BTC<")
    && openingHtml.includes("Tech/Regulierung")
    && openingHtml.includes("2026-09-01")
    && openingHtml.includes("Der Text oeffnet die Ausgabe.")
    && openingHtml.includes(">M2<"),
);
ok(
  "Inflation steigend und BTC positiv bleiben gruen, Zinsen steigend wird rot",
  openingHtml.includes(">steigend<")
    && openingHtml.includes(">positiv<")
    && (openingHtml.match(/data-testid="impact-up"/g) ?? []).length === 3
    && (openingHtml.match(/text-emerald-400/g) ?? []).length === 4
    && chip(openingHtml, "zinsen").includes("rate-impact-negative")
    && chip(openingHtml, "zinsen").includes("text-red-400")
    && chip(openingHtml, "zinsen").includes('data-testid="impact-up"')
    && !chip(openingHtml, "zinsen").includes("text-emerald-400")
    && !chip(openingHtml, "inflation").includes("rate-impact-")
    && !openingHtml.includes("unclear")
    && !openingHtml.includes("aufwärts")
    && !openingHtml.includes("Krypto-Liquidität"),
);
const ban: PolicyEventInput = {
  id: "verbot",
  title: "Verbot der Ausgabe",
  office: "regulator",
  instrumentType: "statute",
  status: "enacted",
  channels: { cryptoLiquidity: "down", inflation: "down", longYield: "down" },
  note: "Der Text kappt die Ausgabe.",
  evidence: [{ source: "Amtsblatt", url: "https://example.test/verbot", date: "2026-08-02" }],
};
const banHtml = renderToStaticMarkup(createElement(PolicyEventCard, { event: ban }));
ok(
  "Inflation fallend und BTC negativ bleiben rot, Zinsen fallend wird gruen",
  banHtml.includes(">fallend<")
    && banHtml.includes(">negativ<")
    && (banHtml.match(/data-testid="impact-down"/g) ?? []).length === 3
    && (banHtml.match(/text-red-400/g) ?? []).length === 4
    && chip(banHtml, "zinsen").includes("rate-impact-positive")
    && chip(banHtml, "zinsen").includes("text-emerald-400")
    && chip(banHtml, "zinsen").includes('data-testid="impact-down"')
    && chip(banHtml, "zinsen").includes(">fallend<")
    && !chip(banHtml, "zinsen").includes("text-red-400")
    && !chip(banHtml, "inflation").includes("rate-impact-"),
);
const quiet: PolicyEventInput = {
  id: "offen",
  title: "Hinweis ohne Richtung",
  office: "treasury",
  instrumentType: "fiscal_program",
  status: "uncertain",
  channels: {},
  evidence: [{ source: "Amtsblatt", url: "https://example.test/offen", date: "2026-07-01" }],
};
const quietHtml = renderToStaticMarkup(createElement(PolicyEventCard, { event: quiet }));
ok(
  "neutral bleibt neutral und ohne Farbe",
  (quietHtml.match(/data-testid="impact-neutral"/g) ?? []).length === 3
    && (quietHtml.match(/>neutral</g) ?? []).length === 3
    && !quietHtml.includes("text-emerald-400")
    && !quietHtml.includes("text-red-400")
    && !quietHtml.includes("impact-up")
    && !quietHtml.includes("impact-down"),
);
const rateHike: PolicyEventInput = {
  id: "reg-a",
  title: "Extensions of Credit",
  office: "central_bank",
  instrumentType: "statute",
  status: "enacted",
  channels: { policyRate: "up", realYield: "up" },
  note: "Der Leitzins geht nach oben.",
  evidence: [{ source: "federalregister.gov", url: "https://example.test/reg-a", date: "2026-09-30" }],
};
const rateHikeHtml = renderToStaticMarkup(createElement(PolicyEventCard, { event: rateHike }));
const hikeRates = chip(rateHikeHtml, "zinsen");
const hikeBtc = chip(rateHikeHtml, "btc");
ok(
  "Zinsen steigend ist rot fuer BTC-Liquiditaet, Pfeil bleibt oben, BTC neutral",
  hikeRates.includes(">steigend<")
    && hikeRates.includes("rate-impact-negative")
    && hikeRates.includes("text-red-400")
    && hikeRates.includes('data-testid="impact-up"')
    && !hikeRates.includes("text-emerald-400")
    && !hikeRates.includes("impact-down")
    && hikeBtc.includes(">neutral<")
    && hikeBtc.includes('data-testid="impact-neutral"')
    && hikeBtc.includes("text-foreground/50")
    && !hikeBtc.includes("text-red-400")
    && !hikeBtc.includes("text-emerald-400")
    && !hikeBtc.includes("rate-impact-")
    && !chip(rateHikeHtml, "inflation").includes("rate-impact-"),
  hikeRates,
);
const rateCut: PolicyEventInput = {
  id: "reg-d-cut",
  title: "Reserve Requirements",
  office: "central_bank",
  instrumentType: "statute",
  status: "enacted",
  channels: { longYield: "down" },
  note: "Die Rendite geht nach unten.",
  evidence: [{ source: "federalregister.gov", url: "https://example.test/reg-d", date: "2026-09-30" }],
};
const rateCutHtml = renderToStaticMarkup(createElement(PolicyEventCard, { event: rateCut }));
const cutRates = chip(rateCutHtml, "zinsen");
const cutBtc = chip(rateCutHtml, "btc");
ok(
  "Zinsen fallend ist gruen fuer BTC-Liquiditaet, Pfeil bleibt unten, BTC neutral",
  cutRates.includes(">fallend<")
    && cutRates.includes("rate-impact-positive")
    && cutRates.includes("text-emerald-400")
    && cutRates.includes('data-testid="impact-down"')
    && !cutRates.includes("text-red-400")
    && !cutRates.includes("impact-up")
    && cutBtc.includes(">neutral<")
    && cutBtc.includes('data-testid="impact-neutral"')
    && !cutBtc.includes("text-emerald-400")
    && !cutBtc.includes("text-red-400")
    && !cutBtc.includes("rate-impact-"),
  cutRates,
);
ok(
  "widerspruechliche Zinsen bleiben neutral, Liquiditaet bestimmt BTC",
  briefingImpacts({ policyRate: "up", longYield: "down", cryptoLiquidity: "up" }).rates === "neutral"
    && briefingImpacts({ policyRate: "up", longYield: "down", cryptoLiquidity: "up" }).btc === "positiv"
    && briefingImpacts({ realYield: "down" }).rates === "fallend"
    && briefingImpacts({ inflation: "unclear", cryptoLiquidity: "sideways" }).inflation === "neutral"
    && briefingImpacts({ inflation: "unclear", cryptoLiquidity: "sideways" }).btc === "neutral",
);
const collected = collectPolicyEvents(
  [{
    id: "regel",
    title: "Rahmen fuer Ausgabe und Reserven",
    office: "legislature",
    status: "implementing",
    confidence: "cited",
    channels: { cryptoLiquidity: "up" },
    evidence: [{ source: "Amtsblatt", url: "https://example.test/rahmen", date: "2026-09-01" }],
  }],
  [{
    id: "dup",
    title: "Rahmen fuer Ausgabe und Reserven",
    office: "legislature",
    instrumentType: "statute",
    status: "implementing",
    channels: { cryptoLiquidity: "down" },
    evidence: [{ source: "Amtsblatt", url: "https://example.test/rahmen", date: "2026-09-01" }],
  }, {
    id: "extra",
    title: "Schuldenoperation",
    office: "treasury",
    instrumentType: "debt_operation",
    status: "enacted",
    channels: { tBillDemand: "up" },
    evidence: [{ source: "Amtsblatt", url: "https://example.test/bill", date: "2026-06-01" }],
  }],
);
ok(
  "belegte Regel gewinnt vor dem doppelten Instrument",
  collected.length === 2
    && collected[0].channels.cryptoLiquidity === "up"
    && collected[1].title === "Schuldenoperation",
);

const bannedCards = ["DeFi-TVL", "TVL-Δ", "Stablecoin Total MCap", "USDT (Tether)", "USDC (Circle)", "Stablecoin-Δ", "Liquiditätstracker"];
ok(
  "Sektion 14 rendert die sechs DefiLlama-Karten nicht",
  bannedCards.every(label => !panel.includes(label)) && !panel.includes("/api/analyze-btc/stablecoin-liquidity"),
  bannedCards.filter(label => panel.includes(label)).join(", "),
);
ok("Nachrichten liegen in Sektion 14", panel.includes("Aktuelle Nachrichten") && panel.includes("/api/analyze-btc/news"));
ok(
  "Key Events nutzen die Briefing-Karte mit Inflation, Zinsen und BTC",
  panel.includes("<PolicyEventGrid")
    && panel.includes("Aktuelle Key Events")
    && panel.includes('label="Inflation"')
    && panel.includes('label="Zinsen"')
    && panel.includes('label="BTC"')
    && !panel.includes("ChannelMarks")
    && !panel.includes("Krypto-Liquidität:"),
);

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nmeasured FRED cards ok");
