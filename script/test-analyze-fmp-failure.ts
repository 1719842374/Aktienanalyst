/**
 * Observability: /api/analyze must expose FMP 429 as RATE_LIMITED instead of generic "nicht erreichbar".
 * Pure helpers only — no network. Run: npx tsx script/test-analyze-fmp-failure.ts
 */
import { describeFmpFallbackFailure, fmpFallbackFailureResponse } from "../server/analyze-helpers";
import { classifyFmpError } from "../server/fmp";

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

const rejected = (reason: unknown): PromiseSettledResult<unknown> => ({ status: "rejected", reason });
const fulfilled = (value: unknown): PromiseSettledResult<unknown> => ({ status: "fulfilled", value });
const http = (status: number, path = "/quote") => Object.assign(new Error(`FMP ${status}: ${path}`), { fmpStatus: status });

console.log("\n=== classifyFmpError ===");
check("429 → RATE_LIMITED", classifyFmpError(http(429)).errorCode === "RATE_LIMITED");
check("429 from message only", classifyFmpError(new Error("FMP 429: /historical-price-eod/full")).fmpStatus === 429);
check("503 → FMP_UPSTREAM_ERROR", classifyFmpError(http(503)).errorCode === "FMP_UPSTREAM_ERROR");
check("missing key → FMP_NOT_CONFIGURED", classifyFmpError(new Error("FMP_API_KEY not set")).errorCode === "FMP_NOT_CONFIGURED");
check("network → FMP_UNREACHABLE", classifyFmpError(Object.assign(new Error("timeout"), { name: "TimeoutError" })).errorCode === "FMP_UNREACHABLE");

console.log("\n=== describeFmpFallbackFailure ===");
check("quote 429 → RATE_LIMITED", describeFmpFallbackFailure("AAPL", rejected(http(429)), []).errorCode === "RATE_LIMITED");
check("empty quote + sibling 429 → RATE_LIMITED",
  describeFmpFallbackFailure("AAPL", fulfilled([]), [fulfilled(null), rejected(http(429, "/profile"))]).errorCode === "RATE_LIMITED");
check("empty quote, no rejections → FMP_NO_DATA", describeFmpFallbackFailure("ZZZZ", fulfilled([]), [fulfilled([])]).errorCode === "FMP_NO_DATA");
check("quote network error → FMP_UNREACHABLE", describeFmpFallbackFailure("AAPL", rejected(new Error("fetch failed")), []).errorCode === "FMP_UNREACHABLE");

console.log("\n=== fmpFallbackFailureResponse ===");
const rl = fmpFallbackFailureResponse("AAPL", classifyFmpError(http(429)));
check("rate limit → HTTP 429", rl.status === 429, String(rl.status));
check("rate limit errorCode RATE_LIMITED (Dashboard stops retrying)", rl.body.errorCode === "RATE_LIMITED");
check("rate limit message is not 'nicht erreichbar'", !rl.body.error.includes("nicht erreichbar"), rl.body.error);
check("rate limit message names 429", rl.body.error.includes("429"), rl.body.error);
const nk = fmpFallbackFailureResponse("AAPL", classifyFmpError(new Error("FMP_API_KEY not set")));
check("missing key → 503 FMP_NOT_CONFIGURED", nk.status === 503 && nk.body.errorCode === "FMP_NOT_CONFIGURED");
const up = fmpFallbackFailureResponse("AAPL", classifyFmpError(http(500)));
check("5xx → 502 with fmpStatus", up.status === 502 && up.body.fmpStatus === 500);
const un = fmpFallbackFailureResponse("AAPL", classifyFmpError(new Error("fetch failed")));
check("unreachable keeps 'nicht erreichbar'", un.status === 503 && un.body.error.includes("nicht erreichbar"));

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
