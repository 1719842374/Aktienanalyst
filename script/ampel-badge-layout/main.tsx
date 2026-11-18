import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { TechnicalChart } from "../../client/src/components/sections/TechnicalChart";
import type { StockAnalysis } from "../../shared/schema";
import "../../client/src/index.css";

/**
 * Layout-Harness für die Ampel-Badge-Messung. Keine Score-Rechnung.
 * Real10Y ist im Chart Default an; der Fetch liefert 3,2 %, damit die rechte Achse
 * Prozent-Ticks zeichnet (formatReal10yTick).
 */
const DAY = 86400000;
const START = Date.UTC(2024, 0, 2);

function weekdayBars(count: number) {
  const bars: { date: string; open: number; high: number; low: number; close: number; volume: number }[] = [];
  for (let i = 0; bars.length < count; i++) {
    const d = new Date(START + i * DAY);
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    const close = 80 + bars.length * 0.35;
    bars.push({ date: iso, open: close - 0.4, high: close + 1, low: close - 1, close, volume: 1_500_000 });
  }
  return bars;
}

const bars = weekdayBars(90);
const real10yByDate: Record<string, number> = {};
for (let i = 0; i < bars.length; i++) real10yByDate[bars[i].date] = 1.2 + (i / (bars.length - 1)) * 2;

const originalFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/analyze-btc/real10y-history")) {
    const body = {
      real10yByDate,
      latestReal10y: { date: bars[bars.length - 1].date, value: 3.2 },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (url.startsWith("/api/") || url.includes("/api/")) {
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(input, init);
};

const data = {
  ticker: "MSFT",
  currency: "USD",
  ohlcvData: bars,
  historicalPrices: bars,
  technicalIndicators: {
    maData: bars.map(b => ({ date: b.date, close: b.close })),
    macdData: [],
    signals: [],
    currentStatus: {
      priceAboveMA200: false,
      ma50AboveMA200: false,
      macdAboveZero: false,
      macdRising: false,
      buySignal: false,
    },
  },
} as unknown as StockAnalysis;

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <TechnicalChart data={data} defaultRange="3M" />
  </QueryClientProvider>,
);
