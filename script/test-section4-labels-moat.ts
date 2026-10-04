// Fixture tests for the remaining Offen_WORK_SECTION4_DATA_BUGS.md items.
// No live FMP call. Run: npx tsx script/test-section4-labels-moat.ts

import {
  lastReportedQuarterLabel,
  tallyAnalystGrades,
  applyScalePermanentCapitalMoat,
  alternativesMetricsNote,
  ALTERNATIVES_METRICS_NOTE,
  SCALE_PERMANENT_CAPITAL_SOURCE,
} from "../server/analyze-helpers";
import {
  geographicOnlyMessage,
  ONLY_GEOGRAPHIC_SEGMENT_MESSAGE,
  promoteNonGeoRowsToBusiness,
} from "../server/fmp";

let passed = 0;
let failed = 0;

function expect(actual: unknown, expected: unknown, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
  }
}

console.log("\n=== P1 last reported quarter ===");
{
  const today = "2026-10-04";
  expect(
    lastReportedQuarterLabel({
      todayIso: today,
      quarterlyRows: [
        { period: "Q2", fiscalYear: "2026", date: "2026-08-06" },
        { period: "Q1", fiscalYear: "2026", date: "2026-05-07" },
      ],
      annualPeriod: "FY",
      annualFiscalYear: "2025",
    }),
    "Q2 FY2026",
    "a later reported quarter replaces the annual FY row",
  );
  expect(
    lastReportedQuarterLabel({
      todayIso: today,
      quarterlyRows: [{ period: "Q3", fiscalYear: "2026", date: "2026-11-01" }],
      earningsRows: [{ date: "2026-08-06", epsActual: 0.4, revenueActual: 20 }],
      annualPeriod: "FY",
      annualFiscalYear: "2025",
    }),
    "2026-08-06",
    "a future quarter is ignored; a past earnings actual supplies the date",
  );
  expect(
    lastReportedQuarterLabel({
      todayIso: today,
      earningsRows: [{ date: "2026-11-01", epsActual: null, revenueActual: null }],
      annualPeriod: "FY",
      annualFiscalYear: "2025",
    }),
    "FY2025",
    "an annual statement is FY, not a fabricated Q4",
  );
  expect(
    lastReportedQuarterLabel({
      todayIso: today,
      quarterlyRows: [{ period: "Q1", fiscalYear: "2026", date: "2026-05-01" }],
      earningsRows: [{ date: "2026-08-01", epsActual: 1.2, period: "Q2", fiscalYear: "2026" }],
    }),
    "Q2 FY2026",
    "a later earnings actual outranks an older quarterly row",
  );
  expect(
    lastReportedQuarterLabel({
      todayIso: today,
      quarterlyRows: [{ period: "Q2", fiscalYear: "2026", date: "2026-08-06" }],
      earningsRows: [{ date: "2026-05-01", epsActual: 0.2, period: "Q1", fiscalYear: "2026" }],
    }),
    "Q2 FY2026",
    "a newer quarterly row outranks an older earnings actual",
  );
}

console.log("\n=== P1 analyst grades ===");
{
  const unique = tallyAnalystGrades([
    { date: "2026-01-02", gradingCompany: "Goldman", newGrade: "Buy" },
    { date: "2026-03-01", gradingCompany: "Goldman", newGrade: "Hold" },
    { date: "2026-02-01", gradingCompany: "Morgan Stanley", newGrade: "Outperform" },
  ]);
  expect(unique, { buy: 1, hold: 1, sell: 0, basis: "analysts" }, "two events from one firm collapse to the latest grade");

  const events = tallyAnalystGrades([
    { date: "2026-01-02", newGrade: "Buy" },
    { date: "2026-01-03", newGrade: "Buy" },
  ]);
  expect(events, { buy: 2, hold: 0, sell: 0, basis: "grade-events" }, "rows without a firm stay grade events");

  expect(
    tallyAnalystGrades([]),
    { buy: 0, hold: 0, sell: 0, basis: "analysts" },
    "no grades is not labeled as events",
  );
}

console.log("\n=== P2 moat scale / permanent capital ===");
{
  const none = { moatStrength: "None" as const, sources: ["Solide Bruttomarge (>40%)"], moatScore: 1 };
  const lifted = applyScalePermanentCapitalMoat(
    none,
    "Global alternative asset manager with permanent capital and fee-related earnings.",
    "Financial Services",
    "Asset Management",
  );
  expect(lifted.moatStrength, "Narrow", "permanent capital lifts None to Narrow");
  expect(lifted.sources.includes(SCALE_PERMANENT_CAPITAL_SOURCE), true, "the lift names its source");

  const retail = applyScalePermanentCapitalMoat(
    { moatStrength: "None" as const, sources: [] },
    "Online retailer of consumer goods.",
    "Consumer Cyclical",
    "Internet Retail",
  );
  expect(retail.moatStrength, "None", "a retailer without scale language stays None");

  const wide = applyScalePermanentCapitalMoat(
    { moatStrength: "Wide" as const, sources: ["Netzwerkeffekte"] },
    "Permanent capital franchise.",
    "Financial Services",
    "Asset Management",
  );
  expect(wide.moatStrength, "Wide", "an existing Wide rating is not rewritten");

  expect(
    alternativesMetricsNote("Scaled asset manager.", "Financial Services", "Asset Management"),
    ALTERNATIVES_METRICS_NOTE,
    "asset management gets the alternatives metric order",
  );
  expect(
    alternativesMetricsNote("Online retailer.", "Consumer Cyclical", "Internet Retail"),
    null,
    "retail does not get the alternatives note",
  );
  expect(
    alternativesMetricsNote("Toll roads and ports.", "Industrials", "Infrastructure Operations"),
    null,
    "infrastructure without an alternatives business does not get the FRE/FBC note",
  );
}

console.log("\n=== P1 nur-geo text ===");
{
  expect(
    geographicOnlyMessage(0, [{ name: "North America" }, { name: "International" }]),
    ONLY_GEOGRAPHIC_SEGMENT_MESSAGE,
    "regions only, no business list → nur-geo sentence",
  );
  expect(
    geographicOnlyMessage(0, [{ name: "Amazon Web Services Segment" }, { name: "North America" }]),
    null,
    "a non-geo name in the geographic feed is not 'only geographic'",
  );
  expect(
    geographicOnlyMessage(2, [{ name: "North America" }]),
    null,
    "business rows suppress the nur-geo sentence",
  );

  const promoted = promoteNonGeoRowsToBusiness(
    [],
    [
      { name: "North America", revenue: 80, percentage: 40 },
      { name: "Amazon Web Services", revenue: 120, percentage: 60 },
    ],
  );
  expect(promoted.map((row) => row.name), ["Amazon Web Services"], "AWS is copied into business when product segments are empty");
  expect(promoted[0].percentage, 60, "an existing geographic percentage is kept");

  const kept = promoteNonGeoRowsToBusiness(
    [{ name: "Online Stores", revenue: 50, percentage: 100 }],
    [{ name: "Advertising", revenue: 10, percentage: 5 }, { name: "Germany", revenue: 20, percentage: 10 }],
  );
  expect(kept.map((row) => row.name), ["Online Stores", "Advertising"], "a missing non-geo row is appended; regions stay out");
  expect(kept[0].percentage, 100, "the existing business percentage is kept");

  const sameName = promoteNonGeoRowsToBusiness(
    [{ name: "Amazon Web Services", revenue: 120, percentage: 18 }],
    [{ name: "Amazon Web Services", revenue: 120, percentage: 18 }],
  );
  expect(sameName.map((row) => row.name), ["Amazon Web Services"], "a name already in business is not copied again");

  const alternativesLines = promoteNonGeoRowsToBusiness(
    [],
    [
      { name: "United States", revenue: 27, percentage: 30 },
      { name: "Infrastructure", revenue: 20, percentage: 22 },
      { name: "Energy", revenue: 15, percentage: 16 },
      { name: "Real Estate", revenue: 12, percentage: 13 },
    ],
  );
  expect(
    alternativesLines.map((row) => row.name),
    ["Infrastructure", "Energy", "Real Estate"],
    "section-6 business lines are not left in the geographic bucket",
  );
}

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
