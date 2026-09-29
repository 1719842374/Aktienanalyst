/**
 * Design Batch A (FIX_PROMPTS 5 + 6): API error copy + recession risk-level inflection.
 * Run: npx tsx script/test-design-batch-a.ts
 */
import { ApiError, describeApiError } from "../client/src/lib/apiError";
import { riskLevelPhrase } from "../shared/risk-level-label";
import { RECESSION_FALLBACK_DATA as recessionFallbackData } from "../client/src/lib/recessionFallbackData";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== Prompt 5: describeApiError ===");
const rawCases = [
  new Error("FMP company-screener 429"),
  new Error("FMP 429: /historical-price-eod/full?symbol=SPY"),
  new ApiError("FMP Rate-Limit (HTTP 429) — FMP 429: /historical-price-eod/full", 429, "RATE_LIMITED"),
];
for (const err of rawCases) {
  const c = describeApiError(err);
  check(`429 → rate_limited: ${err.message.slice(0, 40)}`, c.kind === "rate_limited", c.kind);
  check("headline has no raw URL/status", !/429|\/|FMP/.test(c.headline), c.headline);
  check("detail keeps raw message", c.detail === err.message);
}
check("headline German", describeApiError(rawCases[0]).headline === "Datenquelle ausgelastet — bitte später erneut versuchen.");
check("502 → upstream", describeApiError(new ApiError("FMP-Fehler HTTP 500 für AAPL.", 502, "FMP_UPSTREAM_ERROR")).kind === "upstream");
check("legacy 500 message → upstream", describeApiError(new Error("FMP 503: /stable/x")).kind === "upstream");
check("fetch TypeError → network", describeApiError(new TypeError("Failed to fetch")).kind === "network");
check("not configured", describeApiError(new ApiError("FMP nicht konfiguriert", 503, "FMP_NOT_CONFIGURED")).kind === "not_configured");
check("unknown fallback", describeApiError(new ApiError("Ungültige Branche", 400)).kind === "unknown");
check("no headline leaks a status code",
  [new ApiError("x", 502), new TypeError("Failed to fetch"), new ApiError("y", 400)].every(e => !/\d{3}/.test(describeApiError(e).headline)));

console.log("\n=== Prompt 6: riskLevelPhrase ===");
check("Hoch → Hohes Risiko", riskLevelPhrase("Hoch") === "Hohes Risiko");
check("Erhöht → Erhöhtes Risiko", riskLevelPhrase("Erhöht") === "Erhöhtes Risiko");
check("Moderat → Moderates Risiko", riskLevelPhrase("Moderat") === "Moderates Risiko");
check("Niedrig → Niedriges Risiko", riskLevelPhrase("Niedrig") === "Niedriges Risiko");
check("never produces 'Hoches'", !["Hoch", "Erhöht", "Moderat", "Niedrig", "X"].some(l => riskLevelPhrase(l).includes("Hoches")));
const fallbackJson = JSON.stringify(recessionFallbackData);
check("fallback data has no 'Hoches'", !fallbackJson.includes("Hoches"));
check("fallback summary says 'Hohes Risiko'", String((recessionFallbackData as any).fazit?.summary).includes("Hohes Risiko"));

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
