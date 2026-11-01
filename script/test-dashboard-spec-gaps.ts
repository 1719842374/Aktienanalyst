/**
 * Soll-Lücken aus den Work-Specs 2026-10: Jahreszahlen, Earnings, Peers, Sankey,
 * Segmente, WACC/ROIC, Hype, Custom Screen, Mail-Flag, Chat-Verlauf.
 * Score-Pin VOW3/SAP/MSFT bleibt der Fixture-Wert. analyze-route.ts wird nicht importiert.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-dashboard-spec-gaps.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { buildFinancialHistory } = await import("../shared/financial-history.ts");
const { buildEarningsMarkers } = await import("../shared/earnings-markers.ts");
const { buildPeerOverlay, limitPeerTickers, PEER_OVERLAY_MAX } = await import("../shared/peer-price-overlay.ts");
const { incomeSankey, balanceSankey } = await import("../shared/statement-sankey.ts");
const { buildSegmentSupplement } = await import("../shared/segment-supplement.ts");
const { waccRoicSignal } = await import("../shared/wacc-roic-signal.ts");
const { assessHypeCycle, HYPE_WEIGHTS, HYPE_HISTORY_YEARS } = await import("../shared/hype-cycle.ts");
const { decideCustomScreen, emptyCriteria } = await import("../shared/custom-screen.ts");
const { attraktivEmailStatus, buildAttraktivMail } = await import("../shared/attraktiv-notify.ts");
const { pushChatSession, sessionTitle, CHAT_SESSION_CHAR_BUDGET } = await import("../shared/chat-sessions.ts");
const { StatementSankey } = await import("../client/src/components/sections/StatementSankey.tsx");
const { WaccRoicBadge } = await import("../client/src/components/sections/WaccRoicBadge.tsx");

const years = [
  { date: "2023-12-31", fiscalYear: 2023, revenue: 100, grossProfit: 40, operatingIncome: 20, netIncome: 10, ebitda: 25 },
  { date: "2024-12-31", fiscalYear: 2024, revenue: 110, grossProfit: 50, operatingIncome: 22, netIncome: 12, ebitda: 28 },
  { date: "2025-12-31", fiscalYear: 2025, revenue: 121, grossProfit: 55, operatingIncome: 18, netIncome: -2, ebitda: 24 },
];
const balances = years.map((y, i) => ({
  date: y.date, fiscalYear: y.fiscalYear,
  totalAssets: 200 + i * 10, totalStockholdersEquity: 80,
  totalDebt: 40, cashAndCashEquivalents: 15,
  longTermDebt: 30 - i, totalCurrentAssets: 50 + i, totalCurrentLiabilities: 20,
}));
const cash = years.map(y => ({
  date: y.date, fiscalYear: y.fiscalYear,
  operatingCashFlow: 16, capitalExpenditure: -4, freeCashFlow: 12,
}));
const income = years.map((y, i) => ({ ...y, weightedAverageShsOutDil: 10 - i * 0.1 }));
const history = buildFinancialHistory({ income, balance: balances, cashflow: cash });
assert.equal(history.years.length, 3);
assert.equal(history.years[0].revenueYoyPct, null);
assert.match(history.years[0].revenueYoyReason ?? "", /n\/a/);
assert.ok(Math.abs((history.years[1].revenueYoyPct ?? 0) - 10) < 1e-9);
assert.equal(history.years[2].netIncome, -2);
assert.notEqual(history.years[0].revenue, 0);
assert.equal(history.profitYears.profitable, 2);
assert.equal(history.profitYears.observed, 3);
assert.ok((history.piotroski.passed ?? 0) > 0);
assert.ok(history.piotroski.evaluated <= 9);

const missingFcf = buildFinancialHistory({
  income: [{ date: "2024-12-31", fiscalYear: 2024, revenue: 10, netIncome: 1 }],
  balance: [],
  cashflow: [{ date: "2024-12-31", fiscalYear: 2024, operatingCashFlow: 2 }],
});
assert.equal(missingFcf.years[0].fcf, null);
assert.match(missingFcf.years[0].fcfReason ?? "", /n\/a/);
assert.match(missingFcf.piotroski.label, /n\/a|\/\d/);

const thin = buildEarningsMarkers([
  { date: "2024-01-01", revenueActual: 10, revenueEstimate: 9, epsActual: null, epsEstimate: null },
]);
assert.equal(thin.markers[0].kind, null);
assert.match(thin.beatRateLabel, /n\/a/);
assert.equal(thin.inlineBandPct, null);

const marks = buildEarningsMarkers([
  { date: "2024-01-01", revenueActual: 100, revenueEstimate: 100, epsActual: 1, epsEstimate: 1 },
  { date: "2024-04-01", revenueActual: 105, revenueEstimate: 100, epsActual: 1.05, epsEstimate: 1 },
  { date: "2024-07-01", revenueActual: 140, revenueEstimate: 100, epsActual: 1.4, epsEstimate: 1 },
  { date: "2024-10-01", revenueActual: 60, revenueEstimate: 100, epsActual: 0.6, epsEstimate: 1 },
  { date: "2025-01-01", revenueActual: null, revenueEstimate: null, epsActual: null, epsEstimate: null },
]);
assert.equal(marks.markers[4].kind, null);
assert.match(marks.markers[4].reason ?? "", /n\/a/);
assert.ok(marks.inlineBandPct != null && marks.inlineBandPct > 0);
const kinds = marks.markers.slice(0, 4).map(m => m.kind);
assert.ok(kinds.includes("beat") && kinds.includes("miss"));
assert.match(marks.beatRateLabel, /Beat/);

const limited = limitPeerTickers(["a", "b", "c", "d", "e", "a"]);
assert.equal(limited.kept.length, PEER_OVERLAY_MAX);
assert.deepEqual(limited.dropped, ["E"]);
const overlay = buildPeerOverlay(["2024-01-01", "2024-01-02"], [
  { ticker: "LLY", points: [{ date: "2024-01-01", close: 50 }, { date: "2024-01-02", close: 75 }] },
]);
assert.equal(overlay[0].points[0].index, 100);
assert.equal(overlay[0].points[1].index, 150);
assert.equal(overlay[0].points[1].close, 75);
const emptyPeer = buildPeerOverlay(["2024-01-01"], [{ ticker: "X", points: [] }]);
assert.match(emptyPeer[0].note ?? "", /n\/a/);
assert.equal(emptyPeer[0].points[0].index, null);

const sankey = incomeSankey({
  segments: [{ name: "Cloud", revenue: 60 }, { name: "Office", revenue: 40 }],
  revenue: 100, grossProfit: 70, operatingIncome: 40, netIncome: 30,
});
assert.ok(sankey.links.some(l => l.source === "Cloud" && l.target === "Umsatz" && l.value === 60));
assert.ok(!sankey.links.some(l => l.value === 0));
const noRev = incomeSankey({ segments: [], revenue: null, grossProfit: null, operatingIncome: null, netIncome: null });
assert.equal(noRev.links.length, 0);
assert.match(noRev.notes[0], /n\/a/);
const bal = balanceSankey({ totalAssets: 100, totalEquity: null, totalDebt: 40 });
assert.match(bal.notes.join(" "), /Eigenkapital/);
assert.ok(bal.links.every(l => l.value > 0));

const html = renderToStaticMarkup(React.createElement(StatementSankey, { model: sankey }));
assert.match(html, /overflow-x-auto/);
assert.match(html, /data-testid="statement-sankey"/);
const badge = renderToStaticMarkup(React.createElement(WaccRoicBadge, { roicPct: null, waccPct: 8 }));
assert.match(badge, /n\/a — ROIC fehlt/);
assert.doesNotMatch(badge, />0</);

const supplement = buildSegmentSupplement(
  [{ name: "Automotive", percentage: 73.3, growthPct: -9.8 }, { name: "Energy", percentage: 13.5, growthPct: 26.6 }],
  [
    { fiscalYear: "2022", name: "Automotive", revenue: 100 },
    { fiscalYear: "2023", name: "Automotive", revenue: 90 },
    { fiscalYear: "2024", name: "Automotive", revenue: 80 },
    { fiscalYear: "2022", name: "Energy", revenue: 10 },
    { fiscalYear: "2023", name: "Energy", revenue: 12 },
  ],
  [{ name: "Automotive", revenue: 80 }, { name: "FSD Software Automotive", revenue: 8 }],
);
assert.equal(supplement.growth[0].nextYearGrowthPct != null, true);
assert.match(supplement.growth[0].label, /Override/);
assert.match(supplement.growth[1].label, /n\/a/);
assert.equal(supplement.subItems.length, 1);
assert.equal(supplement.subItems[0].parent, "Automotive");
assert.ok(Math.abs((supplement.subItems[0].shareOfParentPct ?? 0) - 10) < 1e-9);
const noKids = buildSegmentSupplement(
  [{ name: "Automotive", percentage: 100, growthPct: null }],
  [],
  [],
);
assert.equal(noKids.subItems.length, 0);
assert.match(noKids.undisclosedNote, /n\/a/);
assert.match(noKids.undisclosedNote, /kein neues Top-Level/i);

const create = waccRoicSignal(18, 8);
assert.equal(create.tone, "create");
assert.equal(create.spreadPp, 10);
const na = waccRoicSignal(null, 8);
assert.equal(na.tone, "na");
assert.equal(na.spreadPp, null);
assert.match(na.label, /n\/a/);

const series = (last: number) => [10, 10, 10, 10, last];
const hype = assessHypeCycle([
  { ticker: "A", peByYear: series(10), capexIntensityByYear: series(0.2), epsEstimate: [1, 1] },
  { ticker: "B", peByYear: series(20), capexIntensityByYear: series(0.4), epsEstimate: [1, 1.2] },
]);
assert.equal(hype.companies.length, 2);
for (const c of hype.companies) {
  const news = c.signals.find(s => s.id === "newsVolume");
  assert.equal(news?.gap, null);
  assert.match(news?.reason ?? "", /n\/a/);
  assert.ok(c.weightUsed < 1);
  assert.ok(Math.abs(Object.values(HYPE_WEIGHTS).reduce((s, w) => s + w, 0) - 1) < 1e-9);
}
assert.equal(HYPE_HISTORY_YEARS, 5);
const onlyCapex = assessHypeCycle([
  { ticker: "A", peByYear: [1], capexIntensityByYear: [0.1, 0.1, 0.1, 0.1, 0.2], epsEstimate: [] },
  { ticker: "B", peByYear: [1], capexIntensityByYear: [0.1, 0.1, 0.1, 0.1, 0.1], epsEstimate: [] },
]);
const a = onlyCapex.companies[0];
const capexZ = a.signals.find(s => s.id === "capexMaterial")?.z;
assert.equal(a.compositeZ, capexZ);
assert.equal(a.weightUsed, HYPE_WEIGHTS.capexMaterial);

const screen = decideCustomScreen(
  { marketCap: 2e9, industry: "Software", country: null, roic: null, forwardPe: 18 },
  { ...emptyCriteria(), roicMin: 10, forwardPeMax: 20 },
);
assert.equal(screen.pass, false);
assert.match(screen.skipped[0].reason, /n\/a — ROIC fehlt/);
const pass = decideCustomScreen(
  { marketCap: 2e9, industry: "Software", country: "DE", roic: 15, forwardPe: 12 },
  { marketCapMin: 1e9, marketCapMax: null, industryIncludes: "soft", countryIncludes: "de", roicMin: 10, forwardPeMax: 20 },
);
assert.equal(pass.pass, true);

const mailOff = attraktivEmailStatus({});
assert.equal(mailOff.send, false);
assert.equal(mailOff.flag, false);
assert.match(mailOff.reason, /n\/a/);
const mailOn = attraktivEmailStatus({ ATTRAKTIV_EMAIL_ENABLED: "true" });
assert.equal(mailOn.send, false);
const payload = buildAttraktivMail({ to: "a@b.c", ticker: "MSFT", status: "ATTRAKTIV", score: 4.058138, reason: "DCF", link: "/?ticker=MSFT" });
assert.equal(payload.mail?.score, 4.058138);
const notAttr = buildAttraktivMail({ to: "a@b.c", ticker: "MSFT", status: "NEUTRAL", score: 0, reason: null, link: null });
assert.equal(notAttr.mail, null);
assert.match(notAttr.reason, /n\/a/);

const big = "x".repeat(CHAT_SESSION_CHAR_BUDGET);
const kept = pushChatSession(
  [{ id: "old", title: "alt", savedAt: "2020-01-01", turns: [{ role: "user", content: big }] }],
  { id: "new", title: sessionTitle([{ role: "user", content: "kurz" }]), savedAt: "2026-01-01", turns: [{ role: "user", content: "kurz" }] },
);
assert.equal(kept[0].id, "new");
assert.equal(kept.some(s => s.id === "old"), false);

const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

const annual = readFileSync("client/src/components/sections/AnnualFinancials.tsx", "utf8");
const screener = readFileSync("client/src/pages/ScreenerDashboard.tsx", "utf8");
const chat = readFileSync("client/src/components/chat/ChatWidget.tsx", "utf8");
assert.match(annual, /overflow-x-auto/);
assert.match(annual, /min-w-0/);
assert.match(screener, /h-9 w-full/);
assert.match(screener, /sm:h-7/);
assert.match(screener, /grid-cols-2/);
assert.match(screener, /lg:grid-cols-6/);
assert.match(chat, /chat-ai-terms/);
assert.match(chat, /chat-history/);
assert.doesNotMatch(readFileSync("README.md", "utf8"), /perplexity\.ai\/computer/);
for (const file of [
  "shared/financial-history.ts",
  "shared/hype-cycle.ts",
  "server/financial-history-route.ts",
  "server/earnings-markers-route.ts",
  "client/src/components/sections/TechnicalChart.tsx",
]) {
  assert.doesNotMatch(readFileSync(file, "utf8"), /from ["'].*analyze-route/);
}

console.log("dashboard spec gaps: OK");
console.log("score pin VOW3/SAP/MSFT", Number(pin.VWAGY.overallScore).toFixed(6), Number(pin.SAP.overallScore).toFixed(6), Number(pin.MSFT.overallScore).toFixed(6));
