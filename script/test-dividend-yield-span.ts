/**
 * F1-17 / F1-18 (Future_1_Work.md Z.312–313, Z.384; Offen_FUTURE_SOLL_IST_DETAIL.md Z.82–83).
 * Sektion 6: TTM-Dividendenrendite gegen eigene Historie (/api/dividends) und Peer-/Sektor-Median.
 * Sektion 20: Hinweis nur wenn das Perzentil der eigenen Historie außerhalb des benannten Parameters liegt.
 * Nur Anzeige, kein Score. Fehlende Werte: „n/a — Grund“, nie 0.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-dividend-yield-span.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DIVIDEND_YIELD_DISPLAY_PARAMS,
  dividendAdaptiveThreshold,
  dividendCurrencyCheck,
  dividendNotableHint,
  dividendYieldSpan,
  dividendYieldSpanFromValues,
  peerDividendMedian,
  sectorDividendMedian,
  type DividendHistoryResponse,
} from "../shared/dividends";

let fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✅" : "❌"} ${name}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

const params = DIVIDEND_YIELD_DISPLAY_PARAMS;

// --- reine Spanne, Schwelle ist der benannte Perzentil-Parameter ---
{
  const high = dividendYieldSpanFromValues([1, 2, 3, 4, 10]);
  assert.equal(high.available, true);
  if (high.available) {
    assert.equal(high.currentPct, 10);
    assert.equal(high.min, 1);
    assert.equal(high.max, 10);
    assert.equal(high.median, 3);
    assert.equal(high.n, 5);
    assert.ok(Math.abs(high.percentile - 90) < 1e-9, String(high.percentile));
    assert.equal(high.notable, true);
    assert.equal(high.notableSide, "high");
  }
  const notAtStricter = dividendYieldSpanFromValues([1, 2, 3, 4, 10], { ...params, notableTailPercentile: 0.99 });
  assert.equal(notAtStricter.available && notAtStricter.notable, false, "P90 ist nicht mehr auffällig, wenn der Parameter 0.99 ist");
  const mid = dividendYieldSpanFromValues([1, 2, 3, 7, 6, 5, 4]);
  assert.equal(mid.available && mid.notable, false);
  assert.equal(mid.available && mid.notableSide, null);
  // 4 % (F1-14-Band) liegt in der Mitte der eigenen Historie — nicht auffällig.
  const four = dividendYieldSpanFromValues([3, 5, 4]);
  assert.equal(four.available && four.currentPct, 4);
  assert.equal(four.available && four.notable, false, "kein festes 4-%-Kriterium");
  const low = dividendYieldSpanFromValues([10, 4, 3, 2, 1]);
  assert.equal(low.available && low.notableSide, "low");
  const tooFew = dividendYieldSpanFromValues([2.5]);
  assert.equal(tooFew.available, false);
  if (!tooFew.available) {
    assert.match(tooFew.reason, /zu wenig/);
    assert.ok(!/^\s*0(\.0+)?\s*%?$/.test(tooFew.reason));
  }
  const hint = dividendNotableHint(high);
  assert.ok(hint && hint.includes("auffällig") && hint.includes("P90") && hint.includes("kein Score"), hint ?? "");
  assert.ok(hint && !/\b4\s*%/.test(hint), hint ?? "");
  assert.equal(dividendNotableHint(mid), null);
  assert.equal(dividendNotableHint(tooFew), null);
  check("Spanne: Perzentil, Median, Min, Max; auffällig nur über den Perzentil-Parameter", true);
}

// --- adaptive Schwelle: eigene Perzentil-Rendite und Peer-Median, benannte Gewichte, nie 0 ---
{
  assert.equal(params.historyWeight, 1);
  assert.equal(params.peerWeight, 1);
  const span = dividendYieldSpanFromValues([1, 2, 3, 4, 10]);
  assert.equal(span.available, true);
  if (span.available) {
    const peer = peerDividendMedian([2, 4], true);
    const threshold = dividendAdaptiveThreshold(span, peer);
    assert.equal(threshold.available, true);
    if (threshold.available && peer.available) {
      const expectHigh = (params.historyWeight * span.tailHighPct + params.peerWeight * peer.medianPct) / (params.historyWeight + params.peerWeight);
      const expectLow = (params.historyWeight * span.tailLowPct + params.peerWeight * peer.medianPct) / (params.historyWeight + params.peerWeight);
      assert.ok(Math.abs(threshold.highPct - expectHigh) < 1e-9);
      assert.ok(Math.abs(threshold.lowPct - expectLow) < 1e-9);
      assert.equal(threshold.historyWeight, params.historyWeight);
      assert.equal(threshold.peerWeight, params.peerWeight);
      assert.equal(threshold.notableSide, span.currentPct >= threshold.highPct ? "high" : span.currentPct <= threshold.lowPct ? "low" : null);
    }
    const heavierPeer = dividendAdaptiveThreshold(span, peer, { ...params, historyWeight: 0, peerWeight: 1 });
    assert.equal(heavierPeer.available && heavierPeer.highPct, peer.available && peer.medianPct, "Gewicht 0 ist der Parameter, nicht ein fehlender Median");
    const missing = dividendAdaptiveThreshold(span, peerDividendMedian(null, false));
    assert.equal(missing.available, false);
    if (!missing.available) {
      assert.match(missing.reason, /kein Peer-Set/);
      assert.ok(!/^0(\.0+)?$/.test(missing.reason));
    }
    const hintPeer = dividendNotableHint(span, peer);
    assert.ok(hintPeer && hintPeer.includes("adaptiven Schwelle") && hintPeer.includes("kein Score"), hintPeer ?? "");
    assert.ok(hintPeer && !/≥\s*4\s*%/.test(hintPeer), hintPeer ?? "");
    const hintMissing = dividendNotableHint(span, { available: false, reason: "Peer-Set ohne Dividendenrendite (Feld fehlt, nicht als 0 gesetzt)" });
    assert.ok(hintMissing && hintMissing.includes("n/a —"), hintMissing ?? "");
    assert.ok(hintMissing && !/Peer-Median 0\.00/.test(hintMissing), hintMissing ?? "");
    // 4 % in der Mitte der Historie bleibt unter der Schwelle, auch wenn der Peer-Median 4 ist.
    const four = dividendYieldSpanFromValues([3, 5, 4]);
    const aroundFour = dividendAdaptiveThreshold(four, peerDividendMedian([4, 4], true));
    assert.equal(aroundFour.available && aroundFour.notable, false, "kein festes 4-%-Kriterium in der Schwelle");
  }
  check("Adaptive Schwelle aus Perzentil-Rendite und Peer-Median; fehlender Peer ist n/a, nie 0", true);
}

// --- /api/dividends + Kurse, Währung, leere Historie ---
{
  const history: DividendHistoryResponse = {
    ticker: "KO",
    source: "fmp",
    currency: "USD",
    note: null,
    events: [
      { date: "2024-03-14", amount: 0.5 },
      { date: "2024-06-14", amount: 0.5 },
      { date: "2024-09-13", amount: 0.5 },
      { date: "2024-11-29", amount: 0.5 },
      { date: "2025-03-14", amount: 0.5 },
      { date: "2025-06-13", amount: 0.5 },
      { date: "2025-09-12", amount: 0.5 },
      { date: "2025-12-01", amount: 0.5 },
    ],
  };
  const bars = [
    { date: "2025-12-02", close: 60 },
    { date: "2026-03-16", close: 70 },
  ];
  const span = dividendYieldSpan(history, bars, "USD");
  assert.equal(span.available, true);
  if (span.available) {
    assert.equal(span.n, 2);
    assert.ok(span.currentPct > 0);
    assert.equal(span.min, Math.min(span.currentPct, span.min));
    assert.ok(span.max >= span.currentPct);
  }
  const mismatch = dividendYieldSpan(history, bars, "EUR");
  assert.equal(mismatch.available, false);
  if (!mismatch.available) assert.match(mismatch.reason, /USD/);
  assert.equal(dividendCurrencyCheck("GBp", "GBP"), "mismatch", "Pence sind nicht Pfund");
  assert.equal(dividendCurrencyCheck("GBP", "GBP"), "ok");
  const pence = dividendYieldSpan({ ...history, currency: "GBp" }, bars, "GBP");
  assert.equal(pence.available, false);
  if (!pence.available) {
    assert.match(pence.reason, /GBp/);
    assert.match(pence.reason, /GBP/);
    assert.ok(!pence.reason.includes("0.00"));
  }
  const reversed = dividendYieldSpan(history, [...bars].reverse(), "USD");
  assert.equal(reversed.available && reversed.currentPct, span.available && span.currentPct, "aktuell ist der letzte Kurs, nicht das Array-Ende");
  const empty = dividendYieldSpan({ ...history, source: "none", events: [], note: "FMP ohne Dividenden, Yahoo ohne Dividenden" }, bars, "USD");
  assert.equal(empty.available, false);
  if (!empty.available) {
    assert.match(empty.reason, /n\/a|keine Dividenden|ohne Dividenden/i);
    assert.ok(!empty.reason.includes("0.00"));
  }
  const noBars = dividendYieldSpan(history, [], "USD");
  assert.equal(noBars.available, false);
  check("Historie aus Events: Währungsbruch und leere Liste sind n/a, kein 0", true);
}

// --- Peers / Sektor ---
{
  const peers = peerDividendMedian([1, null, 3, undefined, 5], true);
  assert.deepEqual(peers, { available: true, medianPct: 3, n: 3 });
  const withZero = peerDividendMedian([0, 2, 4], true);
  assert.equal(withZero.available && withZero.medianPct, 2);
  const missingField = peerDividendMedian([null, undefined], true);
  assert.equal(missingField.available, false);
  if (!missingField.available) {
    assert.match(missingField.reason, /n\/a|ohne Dividendenrendite|Feld fehlt/);
    assert.ok(!/^0(\.0+)?$/.test(missingField.reason));
  }
  const noPeers = peerDividendMedian(null, false);
  assert.equal(noPeers.available, false);
  if (!noPeers.available) assert.match(noPeers.reason, /kein Peer-Set/);
  const noSector = sectorDividendMedian(null, "Beverages");
  assert.equal(noSector.available, false);
  if (!noSector.available) assert.match(noSector.reason, /Sektorprofil ohne Dividendenrendite/);
  const sector = sectorDividendMedian(2.5, "Beverages");
  assert.equal(sector.available && sector.medianPct, 2.5);
  check("Peers: Median nur aus vorhandenen Yields; fehlt das Feld → n/a, nie 0. Sektor ohne Quelle → n/a", true);
}

// --- Server: Yield aus der bereits geladenen Ratios-Zeile, peerAvg unverändert ---
{
  process.env.FMP_API_KEY = "test";
  process.env.FMP_MIN_INTERVAL_MS = "0";
  process.env.FMP_MAX_RETRIES = "0";
  const quote = { symbol: "PEP", name: "Pepsi", price: 100, marketCap: 2e11, eps: 5 };
  (globalThis as any).fetch = async (input: any) => {
    const url = new URL(String(input));
    const path = url.pathname.replace("/stable", "");
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
    if (path === "/quote") return json([quote]);
    if (path === "/ratios") return json([
      { priceToEarningsRatio: 20, priceToSalesRatio: 3, priceToBookRatio: 8, netIncomePerShare: 5, revenuePerShare: 20, dividendYield: 0.03, dividendYieldPercentage: 3, dividendPerShare: 3 },
      { netIncomePerShare: 4.5, revenuePerShare: 18 },
    ]);
    if (path === "/key-metrics") return json([{ date: "2025-12-31", returnOnInvestedCapital: 0.2 }]);
    return json([]);
  };
  const { fetchPeerComparisonFromTickers, peerDividendYieldPct } = await import("../server/news-peers");
  assert.equal(peerDividendYieldPct({ dividendYield: 0.03, dividendPerShare: 3 }, 100), 3);
  assert.equal(peerDividendYieldPct({ dividendYield: 0, dividendPerShare: 0 }, 100), 0, "explizite 0 = keine Dividende");
  assert.equal(peerDividendYieldPct({}, 100), null, "Feld fehlt → null, nicht 0");
  assert.equal(peerDividendYieldPct(undefined, 100), null);
  assert.equal(peerDividendYieldPct({ dividendPerShare: 3 }, undefined), null, "DPS ohne Kurs → null, nicht 0");
  const cmp = await fetchPeerComparisonFromTickers("KO", ["PEP"], 22, 2, 1e10, 2e11, 5, 6, { pb: 10, epsGrowth1Y: 4 });
  assert.ok(cmp);
  assert.equal(cmp!.peers[0].dividendYield, 3);
  assert.equal("dividendYield" in cmp!.peerAvg, false, "peerAvg bleibt ohne Dividend-Feld (Score-Pfad)");
  check("news-peers reicht dividendYield aus der Ratios-Zeile durch, peerAvg ohne das Feld", true);
}

// --- UI Sektion 6 und Hinweis Sektion 20 ---
{
  (globalThis as any).React = React;
  const { DividendYieldSpanPanel, DividendNotableHint } = await import("../client/src/components/sections/DividendYieldContext");
  const history: DividendHistoryResponse = {
    ticker: "KO",
    source: "fmp",
    currency: "USD",
    note: null,
    events: [
      { date: "2020-03-13", amount: 0.41 }, { date: "2020-06-12", amount: 0.41 },
      { date: "2020-09-14", amount: 0.41 }, { date: "2020-11-30", amount: 0.41 },
      { date: "2021-03-12", amount: 0.42 }, { date: "2021-06-14", amount: 0.42 },
      { date: "2021-09-14", amount: 0.42 }, { date: "2021-11-30", amount: 0.42 },
      { date: "2022-03-14", amount: 0.44 }, { date: "2022-06-13", amount: 0.44 },
      { date: "2022-09-14", amount: 0.44 }, { date: "2022-11-30", amount: 0.44 },
      { date: "2023-03-14", amount: 0.46 }, { date: "2023-06-14", amount: 0.46 },
      { date: "2023-09-14", amount: 0.46 }, { date: "2023-11-30", amount: 0.46 },
      { date: "2024-03-14", amount: 0.485 }, { date: "2024-06-14", amount: 0.485 },
      { date: "2024-09-13", amount: 0.485 }, { date: "2024-11-29", amount: 0.485 },
      { date: "2025-03-14", amount: 0.51 }, { date: "2025-06-13", amount: 0.51 },
      { date: "2025-09-12", amount: 0.51 }, { date: "2025-12-01", amount: 0.51 },
    ],
  };
  const bars = [
    { date: "2025-06-16", close: 40 },
    { date: "2025-12-02", close: 80 },
    { date: "2026-03-16", close: 120 },
  ];
  const data: any = {
    ticker: "KO",
    currency: "USD",
    beta5Y: 0.6,
    marketCap: 2e11,
    totalDebt: 4e10,
    peRatio: 24,
    epsGrowth5Y: 6,
    pegRatio: 4,
    sector: "Consumer Defensive",
    sectorProfile: { waccScenarios: { kons: 8, avg: 7, opt: 6 } },
    ohlcvData: bars,
    peerComparison: {
      peers: [
        { ticker: "PEP", dividendYield: 2.8 },
        { ticker: "KDP", dividendYield: 3.2 },
        { ticker: "MNST", dividendYield: null },
      ],
      sectorMedian: { pe: 22, peg: 2, ps: 3, pb: 5, epsGrowth: 6, sectorName: "Beverages" },
    },
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["dividends", "v2", "KO"], history);
  const html = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(DividendYieldSpanPanel, { data })));
  assert.match(html, /data-testid="dividend-span-current"/);
  assert.match(html, /data-testid="dividend-span-percentile"/);
  assert.match(html, /data-testid="dividend-span-median"/);
  assert.match(html, /data-testid="dividend-span-min"/);
  assert.match(html, /data-testid="dividend-span-max"/);
  assert.match(html, /Peers: Median 3\.00 % \(n=2\)/);
  assert.match(html, /Sektor: n\/a — Sektorprofil ohne Dividendenrendite/);
  const hintHtml = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(DividendNotableHint, { data })));
  const spanNow = dividendYieldSpan(history, bars, "USD");
  const peerNow = peerDividendMedian([2.8, 3.2, null], true);
  const hintNow = dividendNotableHint(spanNow, peerNow);
  if (hintNow) assert.match(hintHtml, /data-testid="dividend-notable-hint"/);
  else assert.equal(hintHtml, "", "kein Hinweis, wenn nicht auffällig");
  assert.match(html, /data-testid="dividend-span-threshold"/);
  assert.match(html, /Schwelle:/);

  const emptyQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pending = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: emptyQc }, React.createElement(DividendYieldSpanPanel, { data: { ...data, peerComparison: undefined } })));
  assert.match(pending, /n\/a —/);
  assert.ok(!pending.includes("0.00 %"), pending);

  const s4 = readFileSync("client/src/components/sections/Section4.tsx", "utf8");
  const summary = readFileSync("client/src/components/sections/SummarySection.tsx", "utf8");
  const exec = readFileSync("client/src/components/ExecSummaryCard.tsx", "utf8");
  const panel = readFileSync("client/src/components/sections/DividendYieldContext.tsx", "utf8");
  assert.match(s4, /DividendYieldSpanPanel/);
  assert.match(summary, /DividendNotableHint/);
  assert.match(exec, /DividendNotableHint/);
  assert.doesNotMatch(panel, /DIV_ATTRACTIVE_YIELD_PCT|overallScore|buildBiasDecision|buildFazitSignal|computeThesisStrength/);
  assert.doesNotMatch(s4, /DIV_ATTRACTIVE_YIELD_PCT/);
  const analyze = readFileSync("server/analyze-route.ts", "utf8");
  assert.ok(!analyze.includes("dividendYieldSpan"));
  assert.ok(!analyze.includes("DIVIDEND_YIELD_DISPLAY_PARAMS"));
  assert.ok(!analyze.includes("peerDividendYieldPct"));
  check("UI: Sektion 6 zeigt Spanne und Peer/Sektor; Hinweis-Komponente hängt an Summary und Exec; analyze-route unberührt", true);
}

// --- Score-Pin (Fixture, unverändert) und Bias mit extra Peer-Feld ---
{
  const head = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  assert.equal(round6(head.VWAGY.overallScore), 4.735718);
  assert.equal(round6(head.SAP.overallScore), 5.174758);
  assert.equal(round6(head.MSFT.overallScore), 4.058138);
  console.log(`Score-Pin Fixture: VOW3/VWAGY ${round6(head.VWAGY.overallScore)} ${head.VWAGY.overallRating} | SAP ${round6(head.SAP.overallScore)} ${head.SAP.overallRating} | MSFT ${round6(head.MSFT.overallScore)} ${head.MSFT.overallRating}`);
  const { buildBiasDecision } = await import("../shared/bias-fixes");
  for (const file of ["script/fixtures/analysis-MSFT.json", "script/fixtures/analysis-VOW3.DE-negfcf.json"]) {
    const d = JSON.parse(readFileSync(file, "utf8"));
    const before = buildBiasDecision(d);
    const withYield = d.peerComparison?.peers
      ? { ...d, peerComparison: { ...d.peerComparison, peers: d.peerComparison.peers.map((p: any, i: number) => ({ ...p, dividendYield: i % 2 ? null : 2.4 })) } }
      : { ...d, dividendYield: 3.1 };
    const after = buildBiasDecision(withYield);
    assert.deepEqual(after, before, file);
    console.log(`  ${file}: Score ${before.overallScore} Rating ${before.overallRating} mit/ohne Peer-dividendYield identisch`);
  }
  const glued = [
    "shared/dividends.ts",
    "client/src/components/sections/DividendYieldContext.tsx",
    "client/src/lib/useDividendHistory.ts",
  ].map(f => readFileSync(f, "utf8")).join("\n");
  assert.ok(!/computeThesisStrength|overallScore|finalScore|buildBiasDecision|buildFazitSignal/.test(glued));
  check("Score unverändert: VOW3 4.735718 / SAP 5.174758 / MSFT 4.058138; Anzeige-Modul ohne Score-Pfad", true);
}

// --- 375 px und 1440 px: echte Fixture-Historie (dividend-kpi-live.json), kein erfundener Prozentwert ---
{
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright-core") as typeof import("playwright-core");
  const chrome = ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"].find((p) => {
    try { readFileSync(p); return true; } catch { return false; }
  });
  if (!chrome) {
    check("Chrome für 375/1440", false, "Browser fehlt");
  } else {
    const fx = JSON.parse(readFileSync("script/fixtures/dividend-kpi-live.json", "utf8"));
    const lse = JSON.parse(readFileSync("script/fixtures/lse-dividends-live.json", "utf8"));
    const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
    const shel = JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8"));
    const { DividendYieldSpanPanel, DividendNotableHint } = await import("../client/src/components/sections/DividendYieldContext");
    const cases: Array<{ ticker: string; currency: string | null; bars: { date: string; close: number }[]; dividends: DividendHistoryResponse; peers?: Array<{ dividendYield?: number | null }> }> = [
      {
        ticker: "MSFT",
        currency: msft.currency ?? "USD",
        bars: msft.historicalPrices,
        dividends: { ticker: "MSFT", source: "none", events: [], note: "FMP ohne Dividenden, Yahoo ohne Dividenden", currency: "USD" },
      },
      {
        ticker: "NVO",
        currency: fx.NVO.currency,
        bars: fx.NVO.bars,
        dividends: fx.NVO.dividends,
      },
      {
        ticker: "SHEL.L",
        currency: shel.currency,
        bars: shel.historicalPrices,
        dividends: lse["SHEL.L"].dividends,
        peers: (shel.peerComparison?.peers ?? []).map((p: { dividendYield?: number | null }) => ({ dividendYield: p.dividendYield ?? null })),
      },
    ];
    const blocks: string[] = [];
    for (const f of cases) {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      qc.setQueryData(["dividends", "v2", f.ticker], f.dividends);
      const data = {
        ticker: f.ticker,
        currency: f.currency,
        ohlcvData: f.bars,
        historicalPrices: f.bars,
        peerComparison: f.peers ? { peers: f.peers, sectorMedian: {} } : undefined,
      };
      const spanHtml = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(DividendYieldSpanPanel, { data })));
      const hintHtml = renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, React.createElement(DividendNotableHint, { data })));
      const span = dividendYieldSpan(f.dividends, f.bars, f.currency);
      console.log(`  ${f.ticker}: ${span.available ? `aktuell ${span.currentPct.toFixed(2)} % P${span.percentile.toFixed(0)} Median ${span.median.toFixed(2)} Min ${span.min.toFixed(2)} Max ${span.max.toFixed(2)} n=${span.n} auffällig=${span.notableSide ?? "nein"}` : `n/a — ${span.reason}`}`);
      blocks.push(`<section data-ticker="${f.ticker}" style="margin-bottom:16px"><h2 style="font-size:13px;margin:0 0 6px">${f.ticker}</h2>${spanHtml}${hintHtml}</section>`);
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #0b1020; color: #e8eefc; font-family: ui-sans-serif, system-ui, sans-serif; }
      .grid { display: grid; }
      .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      @media (min-width: 640px) { .sm\\:grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      .gap-2 { gap: 0.5rem; }
      .break-words { overflow-wrap: anywhere; }
      .min-w-0 { min-width: 0; }
      .max-w-full { max-width: 100%; }
      .space-y-2 > * + * { margin-top: 0.5rem; }
      .rounded, .rounded-md { border-radius: 6px; }
      .border, .border-border\\/50, .border-amber-500\\/30 { border: 1px solid #243050; }
      .p-2, .px-2 { padding: 8px; }
      .py-1\\.5 { padding-top: 6px; padding-bottom: 6px; }
      .text-xs, .text-\\[11px\\] { font-size: 12px; }
      .text-sm { font-size: 14px; }
      .text-\\[10px\\] { font-size: 10px; }
      .font-semibold { font-weight: 600; }
      .uppercase { text-transform: uppercase; letter-spacing: 0.04em; }
      .font-mono, .tabular-nums { font-family: ui-monospace, monospace; }
      .bg-muted\\/30 { background: rgba(255,255,255,0.04); }
      .bg-amber-500\\/10 { background: rgba(251,191,36,0.12); }
      .text-muted-foreground { color: #93a0bd; }
      .text-foreground\\/80 { color: #d5def2; }
      .text-amber-200, .text-amber-700 { color: #fbbf24; }
    </style></head><body><div id="root" style="padding:12px">${blocks.join("")}</div></body></html>`;
    const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    mkdirSync("/opt/cursor/artifacts", { recursive: true });
    for (const width of [375, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(html, { waitUntil: "load" });
      const overflow = await page.evaluate(() => {
        const root = document.getElementById("root")!;
        const spans = [...document.querySelectorAll("[data-testid='dividend-span']")].map((el) => ({
          sw: (el as HTMLElement).scrollWidth,
          cw: (el as HTMLElement).clientWidth,
        }));
        return { rootSw: root.scrollWidth, rootCw: root.clientWidth, spans, text: root.innerText };
      });
      const ok = overflow.spans.length === 3 && overflow.spans.every((s) => s.sw <= s.cw + 1) && overflow.rootSw <= width + 1;
      check(`Layout ${width}px: kein horizontaler Überlauf`, ok, JSON.stringify({ rootSw: overflow.rootSw, spans: overflow.spans }));
      assert.ok(overflow.text.includes("n/a —"), overflow.text.slice(0, 500));
      assert.ok(overflow.text.includes("NVO") && overflow.text.includes("SHEL.L") && overflow.text.includes("MSFT"), overflow.text.slice(0, 300));
      await page.screenshot({ path: `/opt/cursor/artifacts/dividend_span_${width}.png`, fullPage: true });
      await page.close();
    }
    await browser.close();
    check("Screenshots 375 und 1440 aus der Fixture-Historie", true);
  }
}

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
