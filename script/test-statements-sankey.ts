/**
 * Statements, Sankey, Piotroski, WACC/ROIC, Segment-Schätzung.
 *   npx tsx --tsconfig script/tsconfig.jsx.json script/test-statements-sankey.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { buildFinancialHistory } = await import("../shared/financial-history.ts");
const { incomeSankey } = await import("../shared/statement-sankey.ts");
const { waccRoicSignal } = await import("../shared/wacc-roic-signal.ts");
const { buildSegmentSupplement } = await import("../shared/segment-supplement.ts");
const { attachSubItemEstimates, ESTIMATE_LABEL, ESTIMATE_REASON } = await import("../shared/segment-estimate.ts");
const { StatementSankey } = await import("../client/src/components/sections/StatementSankey.tsx");

const history = buildFinancialHistory({
  income: [
    { date: "2024-12-31", fiscalYear: 2024, revenue: 100, grossProfit: 40, netIncome: 10 },
    { date: "2025-12-31", fiscalYear: 2025, revenue: 110, grossProfit: 44, netIncome: -1 },
  ],
  balance: [],
  cashflow: [],
});
assert.equal(history.years[0].revenueYoyPct, null);
assert.match(history.years[0].revenueYoyReason ?? "", /n\/a/);
assert.equal(history.years[0].fcf, null);
assert.equal(history.profitYears.profitable, 1);

const model = incomeSankey({ segments: [{ name: "Cloud", revenue: 60 }], revenue: 100, grossProfit: 40, operatingIncome: null, netIncome: null });
assert.ok(model.links.every(l => l.value > 0));
const html = renderToStaticMarkup(React.createElement(StatementSankey, { model }));
assert.match(html, /data-testid="statement-sankey"/);
assert.match(readFileSync("client/src/components/sections/StatementSankey.tsx", "utf8"), /import React from "react"/);
assert.match(readFileSync("client/src/components/sections/Section4.tsx", "utf8"), /DividendYieldSpanPanel/);
assert.match(readFileSync("client/src/components/sections/Section4.tsx", "utf8"), /WaccRoicBadge/);

const na = waccRoicSignal(null, 8);
assert.equal(na.spreadPp, null);
assert.match(na.label, /n\/a/);

const base = buildSegmentSupplement([{ name: "Automotive", percentage: 100, growthPct: null }], [], []);
const estimated = attachSubItemEstimates(base, [{ name: "Automotive", percentage: 100, growthPct: null }], {
  available: true,
  data: { items: [{ parent: "Automotive", name: "Software", shareOfParentPct: 12 }] },
});
assert.equal(estimated.subItems[0].label, ESTIMATE_LABEL);
const noKey = attachSubItemEstimates(base, [{ name: "Automotive", percentage: 100, growthPct: null }], { available: false, data: null });
assert.equal(noKey.estimateNote, ESTIMATE_REASON.noKey);

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");
console.log("statements sankey: OK");
