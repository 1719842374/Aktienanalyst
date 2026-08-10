/**
 * Live-Verifikation MSFT+NVDA — Auftrag 10.08.2026, Akzeptanzkriterium 1+2:
 * "2 offene Positionen -> Optimierungs-Panel füllt sich ohne manuelle
 * Kandidaten-Zeilen" und "Gewichte nicht zwingend 50/50 wenn μ/σ/Σ differieren".
 *
 * Liest die per curl gegen den lokalen Server abgerufenen /api/analyze-
 * Antworten (echte FMP-Historie) und lässt sie durch computePortfolioFromPositions
 * laufen -- exakt der Pfad, den die neue UI (PortfolioOptimizationPanel) nutzt.
 */
import { computePortfolioFromPositions } from "../client/src/lib/portfolio/engine";
import * as fs from "fs";

const msft = JSON.parse(fs.readFileSync("/tmp/msft.json", "utf-8"));
const nvda = JSON.parse(fs.readFileSync("/tmp/nvda.json", "utf-8"));

const historicalPricesByTicker = {
  MSFT: (msft.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
  NVDA: (nvda.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
};

const result = computePortfolioFromPositions({
  positions: [
    { ticker: "MSFT", qty: 10, entryPrice: msft.currentPrice, lastPrice: msft.currentPrice, side: "long" },
    { ticker: "NVDA", qty: 10, entryPrice: nvda.currentPrice, lastPrice: nvda.currentPrice, side: "long" },
  ],
  historicalPricesByTicker,
  rf: 0.03,
  capital: 100000,
  maxWeight: 0.7, // hoch genug, um die tatsaechliche Modus-A-Ungleichverteilung sichtbar zu machen
});

console.log("=== Live-Verifikation: MSFT + NVDA (echte FMP-Historie) ===\n");
console.log("Status:", result.status);
console.log("Modus:", result.mode);
console.log("fallbackReason:", result.fallbackReason);
console.log("nObs (gemeinsame Handelstage):", result.covariance?.nObs);
console.log("Ridge angewendet:", result.covariance?.ridgeApplied);
console.log("");
for (const row of result.rows) {
  console.log(`${row.ticker}: μ=${(row.mu * 100).toFixed(1)}% σ=${(row.sigma * 100).toFixed(1)}% w_CAPM=${(row.weightCapm * 100).toFixed(1)}% Kelly%=${(row.kelly!.fCapped * 100).toFixed(1)}%`);
}
console.log("");
console.log("Sharpe_p:", result.sharpePortfolio?.toFixed(3));
console.log("Sharpe_eq:", result.sharpeEqualWeight?.toFixed(3));
console.log("Δ vs Equal:", result.deltaVsEqual?.toFixed(3));
console.log("");
console.log("Konzentration:", result.concentration ? `HHI=${result.concentration.hhi.toFixed(3)} Effective-N=${result.concentration.effectiveN.toFixed(2)} avgCorr=${result.concentration.avgPairwiseCorrelation?.toFixed(2)}` : "n/a");
console.log("");
console.log("Flags:");
result.flags.forEach(f => console.log(" -", f));

const w0 = result.rows[0]?.weightCapm ?? 0;
const w1 = result.rows[1]?.weightCapm ?? 0;
const isEqualWeight = Math.abs(w0 - w1) < 0.01 && Math.abs(w0 - 0.5) < 0.01;
console.log("");
console.log(isEqualWeight
  ? "⚠ Gewichte sind (zufällig) nahe 50/50 -- prüfen ob μ/σ tatsächlich sehr ähnlich sind."
  : "✅ Gewichte weichen von 50/50 ab -- Optimierung reagiert auf echte μ/σ/Σ-Unterschiede, kein Equal-Weight-Artefakt.");
