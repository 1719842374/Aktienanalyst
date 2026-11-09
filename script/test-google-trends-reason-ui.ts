/**
 * The closed Google Trends box shows the reason from indicator.value,
 * not only the standard sentence.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-google-trends-reason-ui.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Summary } from "../client/src/components/recession/recessionDashboardPartsB2";
import { GOOGLE_TRENDS_RATE_LIMIT_NA } from "../server/cache/google-trends-pytrends";

let failed = 0;
function check(name: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const html = renderToStaticMarkup(React.createElement(Summary, {
  data: {
    date: "02.11.2026",
    indicators: [{
      name: "Google Trends \"Recession\"",
      group: "correction",
      subgroup: "sentiment_ext",
      value: GOOGLE_TRENDS_RATE_LIMIT_NA,
      rawScore: 0,
      weight: 0,
      weightedScore: 0,
      maxWeighted: 0,
      zone: "N/A",
      source: "Google Trends (N/A)",
      description: "Google-Suchinteresse für 'Recession' (0-100 Index)",
      available: false,
    }],
    subgroups: [],
    nyFedValue: null,
    googleTrendsAvailable: false,
    topDrivers: [],
    interpretation: "Test",
    sources: [],
  },
}));

console.log("\n=== closed box shows the reason ===");
check("the standard sentence stays", html.includes("Der Slot bleibt geschlossen"));
check("the reason is its own visible line", html.includes('data-testid="text-google-trends-reason"') && html.includes(GOOGLE_TRENDS_RATE_LIMIT_NA), html.slice(html.indexOf("text-google-trends-age"), html.indexOf("text-google-trends-age") + 500));
check("the reason uses the foreground color so it stays readable", html.includes("text-google-trends-reason") && html.includes("text-foreground"));

console.log(failed ? `\n${failed} Fehler` : "\n3/3 Checks grün.");
if (failed) process.exit(1);
