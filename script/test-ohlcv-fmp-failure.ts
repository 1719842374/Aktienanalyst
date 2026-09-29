/**
 * Observability: /api/ohlcv must not report FMP failures as empty bars with source:"fmp".
 * Run: npx tsx script/test-ohlcv-fmp-failure.ts
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { registerOhlcvRoute, clearOhlcvCacheForTests } from "../server/ohlcv-route";

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

type FetchPrices = (ticker: string, from: string, to: string) => Promise<unknown>;

async function withServer(
  deps: { isAvailable?: () => boolean; fetchPrices?: FetchPrices },
  run: (base: string) => Promise<void>,
) {
  clearOhlcvCacheForTests();
  const app = express();
  registerOhlcvRoute(app, deps);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function getJson(url: string) {
  const res = await fetch(url);
  const body = await res.json();
  return { status: res.status, body };
}

console.log("\n=== /api/ohlcv FMP failure observability ===");

await withServer(
  {
    isAvailable: () => true,
    fetchPrices: async () => {
      throw new Error("FMP 429: /historical-price-eod/full");
    },
  },
  async (base) => {
    const { status, body } = await getJson(`${base}/api/ohlcv?tickers=AAPL`);
    check("FMP 429 → HTTP 429", status === 429, `status=${status} body=${JSON.stringify(body)}`);
    check("FMP 429 errorCode RATE_LIMITED", body.errorCode === "RATE_LIMITED", JSON.stringify(body.errorCode));
    check("FMP 429 surfaces fmpStatus 429", body.fmpStatus === 429, JSON.stringify(body.fmpStatus));
    check("FMP 429 does not claim source fmp", body.source !== "fmp", JSON.stringify(body.source));
    check("FMP 429 does not return empty AAPL bars", !Array.isArray(body.bars?.AAPL), JSON.stringify(body.bars));
    check("FMP 429 error names the FMP status", String(body.error || "").includes("429"), String(body.error));
  },
);

await withServer(
  { isAvailable: () => false, fetchPrices: async () => [{ date: "2024-01-02", close: 10 }] },
  async (base) => {
    const { status, body } = await getJson(`${base}/api/ohlcv?tickers=AAPL`);
    check("missing key → HTTP 503", status === 503, `status=${status}`);
    check("missing key errorCode", body.errorCode === "FMP_NOT_CONFIGURED", JSON.stringify(body.errorCode));
    check("missing key message", body.error === "FMP nicht konfiguriert", JSON.stringify(body.error));
    check("missing key does not claim source fmp", body.source !== "fmp", JSON.stringify(body.source));
    check("missing key has no AAPL bars", body.bars?.AAPL == null, JSON.stringify(body.bars));
  },
);

await withServer(
  {
    isAvailable: () => true,
    fetchPrices: async () => {
      throw new Error("FMP 503: /historical-price-eod/full");
    },
  },
  async (base) => {
    const { status, body } = await getJson(`${base}/api/ohlcv?tickers=AAPL`);
    check("FMP 5xx is not HTTP 200", status !== 200, `status=${status}`);
    check("FMP 5xx surfaces fmpStatus", body.fmpStatus === 503, JSON.stringify(body.fmpStatus));
    check("FMP 5xx does not claim source fmp", body.source !== "fmp", JSON.stringify(body.source));
    check("FMP 5xx is not RATE_LIMITED", body.errorCode !== "RATE_LIMITED", JSON.stringify(body.errorCode));
    check("FMP 5xx has no empty AAPL bars", !Array.isArray(body.bars?.AAPL), JSON.stringify(body.bars));
  },
);

await withServer(
  {
    isAvailable: () => true,
    fetchPrices: async () => {
      throw new Error("fetch failed");
    },
  },
  async (base) => {
    const { status, body } = await getJson(`${base}/api/ohlcv?tickers=MSFT`);
    check("unreachable is not HTTP 200", status !== 200, `status=${status}`);
    check("unreachable errorCode", body.errorCode === "FMP_UNREACHABLE", JSON.stringify(body.errorCode));
    check("unreachable does not claim source fmp", body.source !== "fmp", JSON.stringify(body.source));
    check("unreachable has no empty MSFT bars", !Array.isArray(body.bars?.MSFT), JSON.stringify(body.bars));
  },
);

await withServer(
  { isAvailable: () => true, fetchPrices: async () => [] },
  async (base) => {
    const { status, body } = await getJson(`${base}/api/ohlcv?tickers=ZZZZ`);
    check("FMP empty answer is not HTTP 200", status === 404, `status=${status}`);
    check("FMP empty answer errorCode FMP_NO_DATA", body.errorCode === "FMP_NO_DATA", JSON.stringify(body.errorCode));
    check("FMP empty answer does not claim source fmp", body.source !== "fmp", JSON.stringify(body.source));
    check("FMP empty answer has no empty ZZZZ bars", !Array.isArray(body.bars?.ZZZZ), JSON.stringify(body.bars));
    check("FMP empty answer has no meta n=0", body.meta?.ZZZZ == null, JSON.stringify(body.meta));
    check("FMP empty answer recorded per ticker", body.errors?.ZZZZ?.errorCode === "FMP_NO_DATA", JSON.stringify(body.errors));
  },
);

let emptyCalls = 0;
await withServer(
  {
    isAvailable: () => true,
    fetchPrices: async () => {
      emptyCalls++;
      return emptyCalls === 1 ? [] : [{ date: "2024-06-03", close: 77 }];
    },
  },
  async (base) => {
    const first = await getJson(`${base}/api/ohlcv?tickers=AAPL`);
    const second = await getJson(`${base}/api/ohlcv?tickers=AAPL`);
    check("empty FMP answer is not cached", first.status === 404 && second.status === 200, `first=${first.status} second=${second.status}`);
    check("retry after empty answer returns the real bar", second.body.bars?.AAPL?.[0]?.close === 77, JSON.stringify(second.body.bars));
  },
);

await withServer(
  {
    isAvailable: () => true,
    fetchPrices: async (ticker) => (ticker === "EMPTY" ? [] : [{ date: "2024-06-03", close: 50 }]),
  },
  async (base) => {
    const { status, body } = await getJson(`${base}/api/ohlcv?tickers=GOOD,EMPTY`);
    check("partial empty stays HTTP 200", status === 200, `status=${status}`);
    check("partial empty omits EMPTY bars", !Array.isArray(body.bars?.EMPTY), JSON.stringify(body.bars));
    check("partial empty records FMP_NO_DATA", body.errors?.EMPTY?.errorCode === "FMP_NO_DATA", JSON.stringify(body.errors));
  },
);

let calls = 0;
await withServer(
  {
    isAvailable: () => true,
    fetchPrices: async () => {
      calls++;
      if (calls === 1) throw new Error("FMP 429: /historical-price-eod/full");
      return [{ date: "2024-06-03", close: 123.45 }];
    },
  },
  async (base) => {
    const first = await getJson(`${base}/api/ohlcv?tickers=IBM`);
    const second = await getJson(`${base}/api/ohlcv?tickers=IBM`);
    check("429 is not cached as empty success", first.status === 429 && second.status === 200, `first=${first.status} second=${second.status}`);
    check("retry after 429 returns the real bar", second.body.bars?.IBM?.[0]?.close === 123.45, JSON.stringify(second.body.bars));
    check("successful retry claims source fmp", second.body.source === "fmp", JSON.stringify(second.body.source));
  },
);

await withServer(
  {
    isAvailable: () => true,
    fetchPrices: async (ticker) => {
      if (ticker === "BAD") throw new Error("FMP 429: /historical-price-eod/full");
      return [{ date: "2024-06-03", close: 50 }];
    },
  },
  async (base) => {
    const { status, body } = await getJson(`${base}/api/ohlcv?tickers=GOOD,BAD`);
    check("partial success stays HTTP 200", status === 200, `status=${status}`);
    check("partial success keeps source fmp for real bars", body.source === "fmp", JSON.stringify(body.source));
    check("partial success includes GOOD bars", body.bars?.GOOD?.[0]?.close === 50, JSON.stringify(body.bars));
    check("partial success omits BAD empty bars", !Array.isArray(body.bars?.BAD), JSON.stringify(body.bars));
    check("partial success records BAD rate limit", body.errors?.BAD?.errorCode === "RATE_LIMITED" && body.errors?.BAD?.fmpStatus === 429, JSON.stringify(body.errors));
  },
);

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
