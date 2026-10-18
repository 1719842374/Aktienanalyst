/**
 * S9 (Relative Bewertung, Section7.tsx) bei Yahoo-only (Tester Prod SAP.DE / VOW3.DE):
 * Yahoo liefert keinen Umsatz → tamAnalysis ist der Sektor-Default (companyGrowth 0, companyRevenue 0, marketShare 0,
 * TAM-Default). Bisher: Revenue Growth +0.0 % (Balken, −X Pkt.), TAM $5,000B, Unternehmens-Wachstum +0.0 %,
 * Marktanteil <0.01 %, „$0.0B / $5,000B“, „Wächst X Pkt. langsamer als die Branche“. Jetzt: n/a.
 *
 * 1. Echte /api/analyze-Route, FMP 402 → Yahoo, getcrumb 429 (quoteSummary leer, wie Render); Chart + timeseries =
 *    gespeicherte echte Antworten (script/fixtures/yahoo-ts-<T>.json). Payload unverändert (Client-only-Fix).
 * 2. Section7 rendern (SSR): alle o. g. Stellen n/a, keine 0-/Default-Werte.
 * 3. FMP (analysis-MSFT.json, optional PROD_DIR AAPL/MSFT): Markup byte-gleich zur Section7 vor dem Fix
 *    (LEGACY_REF, Standard e2593bed = Head fix/dcf-fx-non-usd) und ohne Yahoo-n/a.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-s9-yahoo-only-na.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

process.env.YAHOO_MIN_INTERVAL_MS = "0";
process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";
delete process.env.OPENROUTER_API_KEY;
delete process.env.PERPLEXITY_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
(globalThis as any).React = React;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LEGACY_REF = process.env.LEGACY_REF ?? "e2593bedf013ab53c656bbbc4112c6c89b1bd4c9";
const LEGACY_PATH = `${ROOT}/client/src/components/sections/__Section7-legacy.test-tmp.tsx`;
const PROD_DIR = process.env.PROD_DIR ?? "/workspace/dod-jobD/before";
const TICKERS = ["SAP.DE", "VOW3.DE"] as const;

let fail = 0, n = 0;
const check = (name: string, ok: boolean, detail = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`); if (!ok) fail++; };
const FIX: Record<string, any> = Object.fromEntries(TICKERS.map((t) => [t, JSON.parse(readFileSync(`${HERE}/fixtures/yahoo-ts-${t}.json`, "utf8"))]));
const jsonResp = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input?.url ?? input);
  if (url.startsWith("http://127.0.0.1")) return realFetch(input, init);
  if (url.includes("financialmodelingprep.com")) return jsonResp({ "Error Message": "Premium Query Parameter" }, 402);
  if (url.startsWith("https://fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=test; Domain=.yahoo.com" } });
  if (url.includes("/v1/test/getcrumb")) return new Response("Too Many Requests", { status: 429 });
  if (url.includes("/v10/finance/quoteSummary/")) return new Response("Unauthorized", { status: 401 });
  const sym = decodeURIComponent((url.match(/\/(?:chart|timeseries)\/([^?]+)/) ?? [])[1] ?? "");
  if (url.includes("/v8/finance/chart/")) {
    if (sym === "EURUSD=X") return jsonResp({ chart: { result: [{ meta: { currency: "USD", symbol: "EURUSD=X", regularMarketPrice: 1.16 }, timestamp: [], indicators: { quote: [{}] } }] } });
    return FIX[sym] ? jsonResp({ chart: FIX[sym].chart }) : new Response("nf", { status: 404 });
  }
  if (url.includes("/ws/fundamentals-timeseries/")) return FIX[sym] ? jsonResp({ timeseries: FIX[sym].timeseries }) : new Response("nf", { status: 404 });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const wrap = (el: any) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: new QueryClient() }, el)));
const { Section7 } = await import("../client/src/components/sections/Section7");
const { isYahooOnly } = await import("../shared/data-source");
const render = (S: any, data: any) => wrap(React.createElement(S, { data }));

// --- 1. Route-Payload ---
console.log("=== /api/analyze (FMP 402 → Yahoo, quoteSummary leer) ===");
const express = (await import("express")).default;
const { registerAnalyzeRoute } = await import("../server/analyze-route");
const app = express(); app.use(express.json());
const server = app.listen(0);
registerAnalyzeRoute(server, app);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as any).port;
const body: Record<string, any> = {};
const quiet = async <T,>(fn: () => Promise<T>) => { const w = console.warn, l = console.log; console.warn = () => {}; console.log = () => {}; try { return await fn(); } finally { console.warn = w; console.log = l; } };
for (const t of TICKERS) {
  const r = await quiet(() => realFetch(`http://127.0.0.1:${port}/api/analyze`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: t, useLLM: false, force: true }) }).then(async (x) => ({ status: x.status, body: await x.json() })));
  body[t] = r.body;
  const tam = r.body?.tamAnalysis ?? {};
  check(`${t}: HTTP 200, dataSource yahoo, isYahooOnly`, r.status === 200 && r.body?.dataSource === "yahoo" && isYahooOnly(r.body), `${r.status} ${r.body?.dataSource}`);
  // Payload unverändert (kein Server-Change): die S9-Felder sind weiterhin der Sektor-Default.
  check(`${t}: Payload tamAnalysis = Sektor-Default (Server unverändert)`, tam.companyGrowth === 0 && tam.companyRevenue === 0 && tam.marketShare === 0 && tam.tamTotal > 0,
    `companyGrowth ${tam.companyGrowth} companyRevenue ${tam.companyRevenue} marketShare ${tam.marketShare} tamTotal ${tam.tamTotal} tamCAGR ${tam.tamCAGR} outperforming ${tam.outperforming}`);
  check(`${t}: forwardPE null (#261)`, r.body?.forwardPE === null, String(r.body?.forwardPE));
}
server.close();

// --- 2. Render Yahoo-only ---
console.log("\n=== Section7 Yahoo-only: n/a statt 0/Sektor-Default ===");
const growthRow = (h: string) => (h.match(/<tr[^>]*>(?:(?!<\/tr>).)*Revenue Growth(?:(?!<\/tr>).)*<\/tr>/) ?? [""])[0];
const tile = (h: string, label: string) => (h.match(new RegExp(`${label}</div><div class="[^"]*">([^<]*)</div>`)) ?? [])[1];
for (const t of TICKERS) {
  const h = render(Section7, body[t]);
  const row = growthRow(h);
  const cells = [...row.matchAll(/<td[^>]*>((?:(?!<\/td>).)*)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/<!-- -->/g, ""));
  check(`${t}: Revenue-Growth-Zeile Stock n/a, Premium — (kein −X Pkt.)`, cells[1] === "n/a" && cells[3] === "—" && !/Pkt\./.test(row), JSON.stringify(cells));
  const bar = (h.match(/Revenue Growth vs\. Branche<\/h3>(.*?)<\/div><\/div><\/div><\/div>/) ?? [])[1] ?? "";
  check(`${t}: Balken Revenue Growth: Ticker n/a, leerer Balken`, new RegExp(`${t.replace(".", "\\.")}</span><div[^>]*><div[^>]*style="width:0%"></div></div><span[^>]*>n/a</span>`).test(bar), bar.slice(0, 160));
  check(`${t}: TAM-Kachel n/a`, tile(h, "TAM") === "n/a", String(tile(h, "TAM")));
  check(`${t}: Unternehmens-Wachstum n/a`, tile(h, "Unternehmens-Wachstum") === "n/a", String(tile(h, "Unternehmens-Wachstum")));
  const share = (h.match(/Marktanteil \(TAM\)(?:(?!<\/div>).)*<\/div><div class="[^"]*">([^<]*)<\/div><div class="[^"]*">((?:(?!<\/div>).)*)<\/div>/) ?? []);
  check(`${t}: Marktanteil n/a und Notiz n/a (statt $0.0B / $X B)`, share[1] === "n/a" && share[2] === "n/a", `${share[1]} | ${share[2]}`);
  check(`${t}: Wachstum-vs-Branche-Zeile n/a`, h.includes('data-testid="s9-growth-vs-sector-na"') && !/Pkt\. (langsamer|schneller) als die Branche/.test(h));
  const leaks = ["+0.0%", "$0.0B", "&lt;0.01%", "<0.01%", "$5,000B"].filter((s) => h.includes(s));
  check(`${t}: keine 0-/Default-Werte mehr im Markup`, leaks.length === 0, leaks.join(", "));
  check(`${t}: Discount zum Sektor n/a (#261 unverändert)`, h.includes('data-testid="discount-na"') && !h.includes("Deep Value"));
}

// --- 3. FMP unverändert ---
console.log("\n=== FMP: Markup byte-gleich zur Section7 vor dem Fix ===");
const fmpData: Array<[string, any]> = [["analysis-MSFT.json (Repo-Fixture)", JSON.parse(readFileSync(`${HERE}/fixtures/analysis-MSFT.json`, "utf8"))]];
for (const t of ["AAPL", "MSFT"]) if (existsSync(`${PROD_DIR}/${t}.json`)) fmpData.push([`${t} (Prod-JSON ${PROD_DIR})`, JSON.parse(readFileSync(`${PROD_DIR}/${t}.json`, "utf8"))]);
let legacy: any = null;
try {
  writeFileSync(LEGACY_PATH, execSync(`git -C ${ROOT} show ${LEGACY_REF}:client/src/components/sections/Section7.tsx`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  legacy = (await import("../client/src/components/sections/__Section7-legacy.test-tmp")).Section7;
} catch { console.log(`⚠ LEGACY_REF ${LEGACY_REF} nicht verfügbar: Byte-Vergleich übersprungen`); }
try {
  for (const [name, d] of fmpData) {
    const h = render(Section7, d);
    check(`${name}: isYahooOnly false, keine Yahoo-n/a-Zeile`, !isYahooOnly(d) && !h.includes("s9-growth-vs-sector-na"));
    if (legacy) { const old = render(legacy, d); check(`${name}: Markup byte-gleich zu ${LEGACY_REF.slice(0, 8)}`, h === old, `${h.length} / ${old.length} Bytes`); }
  }
} finally { if (existsSync(LEGACY_PATH)) unlinkSync(LEGACY_PATH); }

console.log(`\n${n - fail}/${n} Checks grün.`);
process.exit(fail ? 1 : 0);
