/**
 * Finale Live-Verifikation nach dem Equal-Weight-Bugfix (10.08.2026):
 * MSFT+NVDA+NVO mit dem tatsächlichen UI-Default maxWeight=30%, identisch
 * zum ursprünglich gemeldeten Live-Screenshot.
 */
import * as fs from "fs";
import { computePortfolioFromPositions } from "../client/src/lib/portfolio/engine";

const msft = JSON.parse(fs.readFileSync("/tmp/render_msft.json", "utf-8"));
const nvda = JSON.parse(fs.readFileSync("/tmp/render_nvda.json", "utf-8"));
const nvo = JSON.parse(fs.readFileSync("/tmp/render_nvo.json", "utf-8"));

const historicalPricesByTicker = {
  MSFT: (msft.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
  NVDA: (nvda.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
  NVO: (nvo.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
};

const result = computePortfolioFromPositions({
  positions: [
    { ticker: "MSFT", qty: 1, entryPrice: msft.currentPrice, lastPrice: msft.currentPrice, side: "long" },
    { ticker: "NVDA", qty: 1, entryPrice: nvda.currentPrice, lastPrice: nvda.currentPrice, side: "long" },
    { ticker: "NVO", qty: 1, entryPrice: nvo.currentPrice, lastPrice: nvo.currentPrice, side: "long" },
  ],
  historicalPricesByTicker,
  rf: 0.03,
  capital: 100000,
  maxWeight: 0.30, // exakter UI-Default, identisch zum gemeldeten Bug-Screenshot
});

console.log("=== NACH FIX: MSFT+NVDA+NVO, UI-Default maxWeight=30% (identisch zum Bug-Screenshot) ===\n");
console.log("Status:", result.status, "| Modus:", result.mode, "| fallbackReason:", result.fallbackReason);
console.log("");
result.rows.forEach(r => console.log(`  ${r.ticker}: μ=${(r.mu * 100).toFixed(1)}% σ=${(r.sigma * 100).toFixed(1)}% w_CAPM=${(r.weightCapm * 100).toFixed(1)}%`));
console.log("");
console.log("Sharpe_p:", result.sharpePortfolio?.toFixed(3), "| Sharpe_eq:", result.sharpeEqualWeight?.toFixed(3), "| Δ:", result.deltaVsEqual?.toFixed(3));
console.log("HHI:", result.concentration?.hhi.toFixed(3), "| Effective-N:", result.concentration?.effectiveN.toFixed(2));
console.log("\nFlags:");
result.flags.forEach(f => console.log(" -", f));

const weights = result.rows.map(r => r.weightCapm);
const allEqual = weights.every(w => Math.abs(w - 1 / 3) < 0.005);
console.log("\n" + (allEqual ? "❌ BUG NOCH VORHANDEN: alle Gewichte ≈ 33.3%" : "✅ BUG BEHOBEN: Gewichte unterscheiden sich klar, kein stiller Equal-Weight mehr"));
