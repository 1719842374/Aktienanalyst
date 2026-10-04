// Fixture tests for Offen_WORK_SECTION4_DATA_BUGS.md §4–§5.
// No live FMP call. Run: npx tsx script/test-section4-fcf-dedup.ts

import { computeFcfTTM, highCapexFcfHint } from "../server/analyze-helpers";
import { FMP_ANALYSIS_CASHFLOW_LIMIT } from "../server/fmp-fetcher";
import {
  filterGeographicDuplicates,
  dropAliasRevenueDuplicates,
  GEO_SEGMENT_DEDUP_NOTE,
  geographicDedupNote,
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

function expectTrue(cond: boolean, label: string) {
  expect(cond, true, label);
}

console.log("\n=== P0 FCF sign + multi-period (no live FMP) ===");
{
  expect(FMP_ANALYSIS_CASHFLOW_LIMIT > 1, true, "analysis cash-flow fetch asks for more than one period");

  const negative = computeFcfTTM([{ freeCashFlow: -8_200_000_000 }]);
  expect(negative, -8_200_000_000, "GAAP freeCashFlow < 0 is kept; it is not replaced by 0");

  const olderNegative = computeFcfTTM([
    { freeCashFlow: 0, operatingCashFlow: 0, capitalExpenditure: 0 },
    { freeCashFlow: -13_000_000_000 },
  ]);
  expect(olderNegative, -13_000_000_000, "empty latest period falls through to an older negative GAAP FCF");

  const derivedNegative = computeFcfTTM([
    { operatingCashFlow: 2_000_000_000, capitalExpenditure: -15_000_000_000 },
  ]);
  expect(derivedNegative, -13_000_000_000, "OCF - |capex| stays negative when capex exceeds operating cash flow");

  expect(computeFcfTTM([{ freeCashFlow: 0, operatingCashFlow: 0, capitalExpenditure: 0 }]), null, "a single empty period is null, not a fake 0");
}

console.log("\n=== P0 high-capex hint ===");
{
  const hint = "GAAP-FCF durch Investitions-CapEx verzerrt; FRE/DE/AFFO beachten";
  expect(highCapexFcfHint("Financial Services", "Asset Management"), hint, "Asset Management gets the capex hint");
  expect(highCapexFcfHint("Real Estate", "REIT - Diversified"), hint, "Real Estate / REIT gets the capex hint");
  expect(highCapexFcfHint("Industrials", "Infrastructure Operations"), hint, "Infrastructure gets the capex hint");
  expect(highCapexFcfHint("Financial Services", "Alternative Asset Management"), hint, "Alternatives gets the capex hint");
  expect(highCapexFcfHint("Consumer Cyclical", "Internet Retail"), null, "a retail name does not get the capex hint");
  expect(highCapexFcfHint("", ""), null, "empty sector and industry do not get the hint");
}

console.log("\n=== P1 geographic dedup: name+revenue and NON_GEO_PATTERN ===");
{
  const business = [
    { name: "Amazon Web Services", revenue: 128.72e9 },
    { name: "Online Stores", revenue: 247e9 },
    { name: "Third-Party Seller Services", revenue: 156e9 },
  ];
  const geo = [
    { name: "North America", revenue: 352e9 },
    { name: "International", revenue: 142e9 },
    { name: "Amazon Web Services Segment", revenue: 128.72e9 },
  ];
  const amzn = filterGeographicDuplicates(business, geo);
  expect(amzn.geographic.map(g => g.name), ["North America", "International"], "AMZN: AWS is not listed again under geographic");
  expect(amzn.removedCount, 1, "AMZN: one geographic row removed");
  expect(geographicDedupNote(amzn.removedCount), GEO_SEGMENT_DEDUP_NOTE, "removed rows produce the spelled Section 2 note");
  expectTrue(!amzn.geographic.some(g => /web services|aws/i.test(g.name)), "AMZN geographic result has no AWS row");

  const sameName = filterGeographicDuplicates(
    [{ name: "North America", revenue: 100 }],
    [
      { name: "North America", revenue: 100 },
      { name: "Germany", revenue: 40 },
    ],
  );
  expect(sameName.geographic.map(g => g.name), ["Germany"], "same normalized name and revenue drops the geographic copy");

  const revenueGap = filterGeographicDuplicates(
    [{ name: "North America", revenue: 100 }],
    [{ name: "North America", revenue: 102 }],
  );
  expect(revenueGap.geographic.map(g => g.name), ["North America"], "same name with revenue outside 1% stays in geographic");
  expect(geographicDedupNote(revenueGap.removedCount), null, "nothing removed → no Section 2 note");

  const regionsOnly = filterGeographicDuplicates(
    [],
    [
      { name: "North America", revenue: 80 },
      { name: "International", revenue: 20 },
    ],
  );
  expect(regionsOnly.geographic.map(g => g.name), ["North America", "International"], "geo-only regions are not deleted");
  expect(regionsOnly.removedCount, 0, "geo-only regions remove nothing");

  const advertising = filterGeographicDuplicates(
    [{ name: "Online Stores", revenue: 50 }],
    [{ name: "Advertising", revenue: 12 }],
  );
  expect(advertising.geographic, [], "NON_GEO_PATTERN drops Advertising even when the business list uses another name");

  const azureSame = dropAliasRevenueDuplicates(
    [{ name: "Azure", revenue: 100 }],
    [{ name: "Microsoft Azure", revenue: 100 }, { name: "United States", revenue: 40 }],
  );
  expect(azureSame.geographic.map(g => g.name), ["United States"], "alias + same revenue drops Microsoft Azure");

  const azureGap = dropAliasRevenueDuplicates(
    [{ name: "Azure", revenue: 100 }],
    [{ name: "Microsoft Azure", revenue: 110 }],
  );
  expect(azureGap.geographic.map(g => g.name), ["Microsoft Azure"], "alias with revenue outside 1% stays");
}

if (failed > 0) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
