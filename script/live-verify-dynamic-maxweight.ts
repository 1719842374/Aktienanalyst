/**
 * Live-Verifikation: dynamisches maxWeight mit MSFT+NVDA+NVO (Render-Daten).
 * Vergleicht altes Verhalten (User-Cap 30%, jetzt automatisch geflooert)
 * gegen den neuen empfohlenen Default fuer n=3 (50%).
 */
import * as fs from "fs";
import { computePortfolioFromPositions } from "../client/src/lib/portfolio/engine";
import { suggestedMaxWeightDefault } from "../client/src/lib/portfolio/weighting";

const msft = JSON.parse(fs.readFileSync("/tmp/render_msft.json", "utf-8"));
const nvda = JSON.parse(fs.readFileSync("/tmp/render_nvda.json", "utf-8"));
const nvo = JSON.parse(fs.readFileSync("/tmp/render_nvo.json", "utf-8"));

const historicalPricesByTicker = {
  MSFT: (msft.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
  NVDA: (nvda.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
  NVO: (nvo.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
};

const positions = [
  { ticker: "MSFT", qty: 1, entryPrice: msft.currentPrice, lastPrice: msft.currentPrice, side: "long" as const },
  { ticker: "NVDA", qty: 1, entryPrice: nvda.currentPrice, lastPrice: nvda.currentPrice, side: "long" as const },
  { ticker: "NVO", qty: 1, entryPrice: nvo.currentPrice, lastPrice: nvo.currentPrice, side: "long" as const },
];

function run(label: string, maxWeight: number) {
  const result = computePortfolioFromPositions({ positions, historicalPricesByTicker, rf: 0.03, capital: 100000, maxWeight });
  console.log(`\n=== ${label} (userMaxWeight=${(maxWeight * 100).toFixed(0)}%) ===`);
  console.log("effectiveMaxWeight:", (result.effectiveMaxWeight * 100).toFixed(1) + "%", "| wasFloorApplied:", result.wasFloorApplied, "| fallbackReason:", result.fallbackReason);
  result.rows.forEach(r => console.log(`  ${r.ticker}: w_CAPM=${(r.weightCapm * 100).toFixed(1)}%`));
  console.log("Δ vs Equal:", result.deltaVsEqual?.toFixed(3));
}

console.log("suggestedMaxWeightDefault(3) =", (suggestedMaxWeightDefault(3) * 100).toFixed(0) + "%");

run("ALTER UI-Default (unveraendert in localStorage)", 0.30);
run("NEUER empfohlener Default fuer n=3", suggestedMaxWeightDefault(3));
run("User waehlt explizit volle Konzentration", 1.0);
