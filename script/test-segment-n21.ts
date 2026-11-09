/**
 * #465 N21: Segment-Hostliste ohne Reuters und ohne generisches *.gov,
 * Ladezustand der Berichtswährung in Sektion 3, ein n/a-Hinweis im Jahresabschluss.
 * Kein Live-FMP und kein Live-LLM.
 *
 * Aufruf: npx tsx --tsconfig script/tsconfig.jsx.json script/test-segment-n21.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { reviewKiChildren, reviewSegmentOutline } from "../shared/segment-children";
import { SegmentEstimateBlock } from "../client/src/components/sections/Section2";
import { AnnualFinancialsView } from "../client/src/components/sections/AnnualFinancials";
import { buildFinancialHistory } from "../shared/financial-history";
(globalThis as any).React = React; // Komponenten nutzen das automatische JSX-Runtime im Vite-Build

const gaps: string[] = [];
function gap(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}: ${detail}`);
  if (!ok) gaps.push(`${name}: ${detail}`);
}

// ── 1) + 3) Hostliste: nur die explizite Liste zählt ─────────────────────────
function childShare(url: string, company = "Microsoft Corporation", owner = "Microsoft"): { kept: number; share: number | null; reason: string } {
  const reviewed = reviewKiChildren("Cloud", {
    children: [{ name: "Azure", owner, shareOfParentPct: 40, growthPct: 5, basis: "Annual Report", source: `Annual Report 2024 ${url}` }],
  }, null, { companyName: company });
  return { kept: reviewed.children.length, share: reviewed.children[0]?.shareOfParentPct ?? null, reason: reviewed.reason ?? "" };
}
function outlineShare(url: string, company = "Microsoft Corporation"): number | null {
  const reviewed = reviewSegmentOutline({
    children: [{ name: "Cloud", shareOfParentPct: 40, growthPct: 5, basis: "Kern", source: `Annual Report 2024 ${url}` }],
  }, company);
  return reviewed.items[0]?.shareOfParentPct ?? null;
}

const reutersHosts = ["https://reuters.com/markets/x", "https://www.reuters.com/markets/x"];
const reutersRows = reutersHosts.map((url) => ({ url, child: childShare(url), outline: outlineShare(url) }));
gap(
  "reuters-not-filing-host",
  reutersRows.every((row) => row.child.share == null && row.outline == null),
  reutersRows.map((row) => `${row.url} child=${row.child.kept}/${String(row.child.share)} outline=${String(row.outline)}`).join(" | "),
);

const genericGov = ["https://evilsec.gov/10-k", "https://notsec.gov/10-k", "https://www.irs.gov/annual-report", "https://data.census.gov/annual-report"];
const govRows = genericGov.map((url) => ({ url, child: childShare(url), outline: outlineShare(url) }));
gap(
  "no-generic-gov",
  govRows.every((row) => row.child.share == null && row.outline == null),
  govRows.map((row) => `${row.url} child=${row.child.kept}/${String(row.child.share)} outline=${String(row.outline)}`).join(" | "),
);

const listed = [
  "https://sec.gov/Archives/edgar/data/789019/10-k.htm",
  "https://www.sec.gov/Archives/edgar/data/789019/10-k.htm",
  "https://edgar.sec.gov/Archives/10-k.htm",
];
const listedRows = listed.map((url) => ({ url, child: childShare(url), outline: outlineShare(url) }));
const spoof = childShare("https://sec.gov.evil.com/10-k");
const hkex = childShare("https://www1.hkexnews.hk/listedco/listconews/sehk/2024/byd.pdf", "BYD Company Limited", "BYD");
gap(
  "listed-hosts-kept",
  listedRows.every((row) => row.child.share === 40 && row.outline === 40) && spoof.share == null && hkex.share === 40,
  `${listedRows.map((row) => `${row.url} child=${String(row.child.share)} outline=${String(row.outline)}`).join(" | ")} spoof=${String(spoof.share)} hkex=${String(hkex.share)}`,
);

// ── 2) Ladezustand statt n/a, danach n/a mit Grund ──────────────────────────
function block(client: QueryClient, data: Record<string, unknown>): string {
  return renderToStaticMarkup(React.createElement(
    QueryClientProvider,
    { client },
    React.createElement(SegmentEstimateBlock, { data: data as never }),
  ));
}
const segmented = {
  ticker: "MSFT",
  revenueSegments: [{ name: "Server", percentage: 60, revenue: 60 }, { name: "Gaming", percentage: 40, revenue: 40 }],
  geoSegments: [],
};
const pendingClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
void pendingClient.prefetchQuery({ queryKey: ["/api/segment-growth", "MSFT"], queryFn: () => new Promise(() => {}) });
const loadingHtml = block(pendingClient, segmented);
gap(
  "currency-loading",
  /data-testid="segment-reported-currency"[^>]*data-state="loading"/.test(loadingHtml) && !loadingHtml.includes("Währung n/a"),
  (loadingHtml.match(/<p[^>]*segment-reported-currency[^<]*<\/p>/)?.[0] ?? "keine Währungszeile"),
);

const readyClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
readyClient.setQueryData(["/api/segment-growth", "MSFT"], { ticker: "MSFT", business: [], geographic: [], source: "fixture", currency: "EUR" });
const readyHtml = block(readyClient, segmented);
const noCurrencyClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
noCurrencyClient.setQueryData(["/api/segment-growth", "MSFT"], { ticker: "MSFT", business: [], geographic: [], source: "fixture", currency: null });
const noCurrencyHtml = block(noCurrencyClient, segmented);
const offHtml = block(new QueryClient({ defaultOptions: { queries: { retry: false } } }), { ticker: "XIACY", revenueSegments: [], geoSegments: [] });
gap(
  "currency-after-load",
  readyHtml.includes("Währung EUR")
    && !readyHtml.includes("Währung n/a")
    && /Währung n\/a — Berichtswährung fehlt/.test(noCurrencyHtml)
    && /Währung n\/a — keine Segmente/.test(offHtml)
    && !noCurrencyHtml.includes('data-state="loading"')
    && !offHtml.includes('data-state="loading"'),
  [readyHtml, noCurrencyHtml, offHtml].map((html) => html.match(/<p[^>]*segment-reported-currency[^<]*<\/p>/)?.[0] ?? "keine Zeile").join(" | "),
);

// ── 4) Ein n/a-Hinweis je Mangel im Jahresabschluss ─────────────────────────
function annual(history: ReturnType<typeof buildFinancialHistory>): string {
  return renderToStaticMarkup(React.createElement(AnnualFinancialsView, {
    history: { ...history, ticker: "MSFT", source: "fixture" },
    segments: [],
  }));
}
const blankCurrency = buildFinancialHistory({
  income: [{ fiscalYear: "2024", date: "2024-06-30", revenue: 100, grossProfit: 60, operatingIncome: 30, netIncome: 20 }],
  balance: [],
  cashflow: [],
});
const blankHtml = annual(blankCurrency);
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const emptyHtml = annual(buildFinancialHistory({ income: [], balance: [], cashflow: [] }));
const eurHtml = annual(buildFinancialHistory({
  income: [{ fiscalYear: "2024", date: "2024-06-30", reportedCurrency: "EUR", revenue: 100 }],
  balance: [],
  cashflow: [],
}));
gap(
  "single-currency-note",
  blankCurrency.currency == null
    && blankCurrency.currencyNote != null
    && count(blankHtml, /data-testid="annual-currency-note"/g) === 1
    && count(blankHtml, /data-testid="segment-currency-na"/g) === 0
    && count(blankHtml, /Währung n\/a/g) === 1
    && count(blankHtml, /keine globale Zuordnung/g) === 1
    && count(emptyHtml, /data-testid="segment-currency-na"/g) === 1
    && count(emptyHtml, /data-testid="annual-currency-note"/g) === 0
    && count(emptyHtml, /Währung n\/a/g) === 1
    && count(eurHtml, /data-testid="segment-currency-na"|data-testid="annual-currency-note"/g) === 0,
  `blank note=${count(blankHtml, /annual-currency-note/g)} na=${count(blankHtml, /segment-currency-na/g)} text=${count(blankHtml, /Währung n\/a/g)} empty na=${count(emptyHtml, /segment-currency-na/g)} text=${count(emptyHtml, /Währung n\/a/g)} eur=${count(eurHtml, /segment-currency-na|annual-currency-note/g)}`,
);

if (gaps.length > 0) {
  console.log(`RED gaps: ${gaps.length}`);
  process.exit(1);
}
console.log("segment n21: OK");
