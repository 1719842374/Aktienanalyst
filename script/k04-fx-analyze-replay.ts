/**
 * K-04 Beweis: /api/analyze mit aufgezeichneten HTTP-Antworten.
 *
 *   RECORD=1 OUT=/tmp/k04-fixtures.json npx tsx script/k04-fx-analyze-replay.ts
 *   ROOT=<worktree> FIXTURES=/tmp/k04-fixtures.json OUT=/tmp/k04-main.json npx tsx script/k04-fx-analyze-replay.ts
 *   FX_MODE=down|stale  gleiche Replay-Flags, FX-Quote schlägt fehl.
 *
 * Der API-Key wird aus den Fixture-URLs entfernt.
 */
import { writeFileSync, readFileSync } from "fs";
import path from "path";

const ROOT = process.env.ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = process.env.OUT ?? "";
const FIXTURES = process.env.FIXTURES ?? "";
const RECORD = process.env.RECORD === "1";
const FX_MODE = process.env.FX_MODE ?? ""; // "" | "down" | "stale"
const TICKERS = (process.env.TICKERS ?? "NVO,ASML,7203.T,VOW3.DE").split(",").map((s) => s.trim()).filter(Boolean);

type Hit = { url: string; status: number; headers: [string, string][]; body: string };

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function normUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete("apikey");
    u.searchParams.delete("apiKey");
    return u.toString();
  } catch {
    return raw.replace(/apikey=[^&]+/gi, "apikey=");
  }
}

function isFxQuote(url: string): boolean {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("financialmodelingprep.com")) return false;
    if (!u.pathname.endsWith("/quote")) return false;
    return /^[A-Z]{3}USD$/.test(u.searchParams.get("symbol") ?? "");
  } catch {
    return false;
  }
}

const STUB = process.env.STUB === "1";
const FX_STUB: Record<string, number> = { DKK: 0.145, EUR: 1.08, JPY: 0.0067 };

interface StubSpec {
  listing: string;
  filer: string;
  price: number;
  shares: number;
  revenue: number;
  eps: number;
  fcf: number;
  name: string;
  exchange: string;
  country: string;
  sector: string;
  industry: string;
}

/** Synthetische FMP-Antworten. Kein Live-Key (der vorhandene Key antwortet 401). Klar als Stub benannt. */
const STUB_SPECS: Record<string, StubSpec> = {
  NVO: { listing: "USD", filer: "DKK", price: 120, shares: 1e9, revenue: 300e9, eps: 20, fcf: 40e9, name: "Novo Nordisk Stub", exchange: "NYSE", country: "DK", sector: "Healthcare", industry: "Biotechnology" },
  ASML: { listing: "USD", filer: "EUR", price: 800, shares: 400e6, revenue: 30e9, eps: 20, fcf: 8e9, name: "ASML Stub", exchange: "NASDAQ", country: "NL", sector: "Technology", industry: "Semiconductors" },
  "7203.T": { listing: "JPY", filer: "JPY", price: 2800, shares: 15e9, revenue: 45e12, eps: 300, fcf: 3e12, name: "Toyota Stub", exchange: "Tokyo", country: "JP", sector: "Consumer Cyclical", industry: "Auto Manufacturers" },
  "VOW3.DE": { listing: "EUR", filer: "EUR", price: 100, shares: 500e6, revenue: 300e9, eps: 25, fcf: 15e9, name: "Volkswagen Stub", exchange: "XETRA", country: "DE", sector: "Consumer Cyclical", industry: "Auto Manufacturers" },
};

const stubBars = new Map<string, unknown[]>();
function barsFor(spec: StubSpec): unknown[] {
  const cached = stubBars.get(spec.name);
  if (cached) return cached;
  const rows: unknown[] = [];
  const day = new Date(Date.UTC(2026, 10, 6));
  for (let i = 0; i < 2900; i++) {
    while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() - 1);
    const close = +(spec.price * (1 + 0.01 * Math.sin(i / 20))).toFixed(4);
    rows.push({ date: day.toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 1_000_000 });
    day.setUTCDate(day.getUTCDate() - 1);
  }
  stubBars.set(spec.name, rows);
  return rows;
}

function stubJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function stubFetch(url: string): Response {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return stubJson({ error: "bad url" }, 404); }
  if (parsed.hostname.includes("financialmodelingprep.com")) {
    const pathname = parsed.pathname.replace(/^\/stable/, "");
    const symbol = parsed.searchParams.get("symbol") ?? "";
    if (/^[A-Z]{3}USD$/.test(symbol)) {
      const rate = FX_STUB[symbol.slice(0, 3)];
      return rate ? stubJson([{ symbol, price: rate }]) : stubJson([]);
    }
    const spec = STUB_SPECS[symbol];
    if (!spec) return stubJson([]);
    const mcap = spec.price * spec.shares;
    const quarter = parsed.searchParams.get("period") === "quarter";
    const income = (i: number) => {
      const factor = Math.pow(0.95, i);
      return {
        date: `${2025 - i}-12-31`, fiscalYear: String(2025 - i), period: quarter ? "Q4" : "FY",
        reportedCurrency: spec.filer, revenue: spec.revenue * factor, grossProfit: spec.revenue * 0.7 * factor,
        operatingIncome: spec.revenue * 0.3 * factor, netIncome: spec.revenue * 0.2 * factor,
        ebitda: spec.revenue * 0.35 * factor, eps: spec.eps * factor, epsDiluted: spec.eps * factor,
        weightedAverageShsOutDil: spec.shares,
      };
    };
    if (pathname === "/quote") return stubJson([{ symbol, price: spec.price, marketCap: mcap, pe: spec.price / (spec.eps * (spec.filer === "USD" ? 1 : FX_STUB[spec.filer] ?? 1)), eps: spec.eps * (spec.filer === spec.listing ? 1 : FX_STUB[spec.filer] ?? 1), yearHigh: spec.price * 1.2, yearLow: spec.price * 0.8, currency: spec.listing }]);
    if (pathname === "/profile") return stubJson([{ symbol, companyName: spec.name, currency: spec.listing, exchange: spec.exchange, sector: spec.sector, industry: spec.industry, description: `${spec.name} synthetic stub for K-04.`, beta: 1, marketCap: mcap, price: spec.price, sharesOutstanding: spec.shares, country: spec.country }]);
    if (pathname === "/income-statement") return stubJson(Array.from({ length: quarter ? 16 : 6 }, (_, i) => quarter ? { ...income(i % 3), date: `2024-0${(i % 4) + 1}-01`, period: "Q1", revenue: spec.revenue / 4 } : income(i)));
    if (pathname === "/cash-flow-statement") return stubJson([0, 1, 2].map((i) => ({ date: `${2025 - i}-12-31`, reportedCurrency: spec.filer, operatingCashFlow: spec.fcf * 1.4 * Math.pow(0.95, i), capitalExpenditure: -spec.fcf * 0.4 * Math.pow(0.95, i), freeCashFlow: spec.fcf * Math.pow(0.95, i) })));
    if (pathname === "/balance-sheet-statement") return stubJson([0, 1].map((i) => ({ date: `${2025 - i}-12-31`, reportedCurrency: spec.filer, totalDebt: spec.revenue * 0.4, cashAndCashEquivalents: spec.revenue * 0.1, totalStockholdersEquity: spec.revenue * 0.8, totalEquity: spec.revenue * 0.8, totalAssets: spec.revenue * 1.5, totalCurrentAssets: spec.revenue * 0.4, totalCurrentLiabilities: spec.revenue * 0.2 })));
    if (pathname === "/price-target-consensus") return stubJson([{ symbol, targetMedian: spec.price * 1.1, targetHigh: spec.price * 1.3, targetLow: spec.price * 0.9, numberOfAnalysts: 10 }]);
    if (pathname === "/analyst-estimates") return stubJson([{ date: "2026-12-31", epsAvg: spec.eps * 1.05, revenueAvg: spec.revenue * 1.05 }, { date: "2027-12-31", epsAvg: spec.eps * 1.1, revenueAvg: spec.revenue * 1.1 }]);
    if (pathname === "/historical-price-eod/full") return stubJson(barsFor(spec));
    if (pathname === "/ratios") return stubJson([{ priceToEarningsRatio: spec.price / (spec.eps * (spec.listing === spec.filer ? 1 : FX_STUB[spec.filer] ?? 1)), priceToBookRatio: 4, returnOnEquity: 0.2, enterpriseValueMultiple: 12, dividendYield: 0.02 }]);
    return stubJson([]);
  }
  return new Response("stub has no upstream", { status: 404 });
}

const VOLATILE = /timestamp|generatedAt|^asOf$|expiresAt|_cachedAt|_cacheDate|_cacheAge|priceTimestamp|dataTimestamp/i;

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE.test(key)) continue;
      out[key] = stripVolatile(item);
    }
    return out;
  }
  return value;
}

async function listen(app: import("express").Express): Promise<{ port: number; server: import("http").Server; close: () => void }> {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port;
  return { port, server, close: () => server.close() };
}

async function runTickers(port: number, realFetch: typeof fetch): Promise<Record<string, { status: number; body: unknown }>> {
  const out: Record<string, { status: number; body: unknown }> = {};
  for (const ticker of TICKERS) {
    const response = await realFetch(`http://127.0.0.1:${port}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, useLLM: false, force: true }),
    });
    out[ticker] = { status: response.status, body: await response.json() };
    const body = out[ticker].body as { currency?: string; currentPrice?: number; error?: string };
    console.log(`[k04] ${ticker}: HTTP ${out[ticker].status} ccy=${body?.currency ?? "-"} px=${body?.currentPrice ?? "-"} ${body?.error ?? ""}`);
  }
  return out;
}

async function runStub(realFetch: typeof fetch): Promise<void> {
  let fxDown = FX_MODE === "down";
  const realNow = Date.now;
  let now = realNow();
  if (FX_MODE === "stale" || FX_MODE === "down") Date.now = () => now;
  const route = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return realFetch(input, init);
    if (fxDown && isFxQuote(url)) throw new Error("fx quote down");
    return stubFetch(url);
  };
  globalThis.fetch = route as typeof fetch;
  if (FX_MODE === "stale") {
    const { getFxRateToUsd } = await import(`${ROOT}/server/fmp.ts`);
    for (const currency of ["DKK", "EUR", "JPY"]) await getFxRateToUsd(currency);
    now += 60 * 60 * 1000 + 5_000;
    fxDown = true;
  }
  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import(`${ROOT}/server/analyze-route.ts`);
  const app = express();
  app.use(express.json());
  const http = await listen(app);
  registerAnalyzeRoute(http.server, app);
  const analyses = await runTickers(http.port, realFetch);
  http.close();
  Date.now = realNow;
  const stripped = Object.fromEntries(Object.entries(analyses).map(([ticker, row]) => [ticker, { status: row.status, body: stripVolatile(row.body) }]));
  if (OUT) writeFileSync(OUT, JSON.stringify(stripped));
  console.log(`[k04] stub ${FX_MODE || "live-fx"} wrote ${OUT || "(stdout)"}`);
}

async function main(): Promise<void> {
  process.env.FMP_MIN_INTERVAL_MS = "0";
  process.env.YAHOO_MIN_INTERVAL_MS = "0";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  const realFetch = globalThis.fetch.bind(globalThis);
  if (STUB) {
    await runStub(realFetch);
    return;
  }

  if (RECORD) {
    const hits: Hit[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return realFetch(input, init);
      const response = await realFetch(input, init);
      const body = await response.text();
      const headers = [...response.headers.entries()].filter(([name]) => name.toLowerCase() !== "set-cookie" && name.toLowerCase() !== "content-encoding" && name.toLowerCase() !== "content-length");
      hits.push({ url: normUrl(url), status: response.status, headers, body });
      return new Response(body, { status: response.status, headers });
    }) as typeof fetch;
    const express = (await import("express")).default;
    const { registerAnalyzeRoute } = await import(`${ROOT}/server/analyze-route.ts`);
    const app = express();
    app.use(express.json());
    const http = await listen(app);
    registerAnalyzeRoute(http.server, app);
    const analyses = await runTickers(http.port, realFetch);
    http.close();
    if (OUT) writeFileSync(OUT, JSON.stringify({ hits, analyses }));
    console.log(`[k04] recorded ${hits.length} responses`);
    return;
  }

  if (!FIXTURES) throw new Error("FIXTURES oder RECORD=1 fehlt");
  const saved = JSON.parse(readFileSync(FIXTURES, "utf8")) as { hits: Hit[] };
  const queues = new Map<string, Hit[]>();
  for (const hit of saved.hits) {
    const list = queues.get(hit.url) ?? [];
    list.push(hit);
    queues.set(hit.url, list);
  }
  const fxBackup = new Map<string, Hit[]>();
  if (FX_MODE === "down" || FX_MODE === "stale") {
    for (const [url, list] of queues) {
      if (isFxQuote(url)) fxBackup.set(url, list.map((hit) => ({ ...hit })));
    }
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return realFetch(input, init);
    const key = normUrl(url);
    if ((FX_MODE === "down" || FX_MODE === "stale") && isFxQuote(key)) {
      throw new Error("fx quote down");
    }
    const queue = queues.get(key);
    const hit = queue?.shift();
    if (!hit) return new Response(`missing fixture ${key}`, { status: 599 });
    return new Response(hit.body, { status: hit.status, headers: hit.headers });
  }) as typeof fetch;

  if (FX_MODE === "stale") {
    const nowStart = Date.now();
    let now = nowStart;
    const realNow = Date.now;
    Date.now = () => now;
    const { getFxRateToUsd } = await import(`${ROOT}/server/fmp.ts`);
    const fxUrls = [...fxBackup.keys()];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return realFetch(input, init);
      const key = normUrl(url);
      if (isFxQuote(key)) {
        const seeded = fxBackup.get(key)?.[0];
        if (seeded && seeded.status >= 200 && seeded.status < 300) {
          return new Response(seeded.body, { status: seeded.status, headers: seeded.headers });
        }
      }
      const queue = queues.get(key);
      const hit = queue?.shift();
      if (!hit) return new Response(`missing fixture ${key}`, { status: 599 });
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    }) as typeof fetch;
    for (const url of fxUrls) {
      const symbol = new URL(url).searchParams.get("symbol") ?? "";
      const currency = symbol.replace(/USD$/, "");
      if (currency) await getFxRateToUsd(currency);
    }
    now = nowStart + 60 * 60 * 1000 + 5000;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return realFetch(input, init);
      const key = normUrl(url);
      if (isFxQuote(key)) throw new Error("fx quote down");
      const queue = queues.get(key);
      const hit = queue?.shift();
      if (!hit) return new Response(`missing fixture ${key}`, { status: 599 });
      return new Response(hit.body, { status: hit.status, headers: hit.headers });
    }) as typeof fetch;
    void realNow;
  }

  const express = (await import("express")).default;
  const { registerAnalyzeRoute } = await import(`${ROOT}/server/analyze-route.ts`);
  const app = express();
  app.use(express.json());
  const http = await listen(app);
  registerAnalyzeRoute(http.server, app);
  const analyses = await runTickers(http.port, realFetch);
  http.close();
  const stripped = Object.fromEntries(Object.entries(analyses).map(([ticker, row]) => [ticker, { status: row.status, body: stripVolatile(row.body) }]));
  if (OUT) writeFileSync(OUT, JSON.stringify(stripped));
  else console.log(JSON.stringify(stripped).slice(0, 400));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
