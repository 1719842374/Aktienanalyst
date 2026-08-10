/**
 * DEBUG-Reproduktion: MSFT+NVDA+NVO liefert live w%CAPM=33.3/33.3/33.3,
 * Δ=0, obwohl μ/σ stark unterschiedlich sind (Live-Screenshot 10.08.2026).
 *
 * Loggt JEDEN Zwischenschritt: mu_raw, mu_winsorized, Sigma (roh, geshrunken,
 * geridged), w_raw (Sigma^-1 * muExcess VOR jeglichen Constraints),
 * w_nach_longonly, w_nach_cap, w_final, Modus, fallback_reason.
 */
import * as fs from "fs";
import { buildCovariance } from "../client/src/lib/portfolio/covariance";
import { winsorizeMuArray } from "../client/src/lib/portfolio/winsorize";
import { pickWeightMode, shrinkCovariance, isSigmaStable, isMuWeak } from "../client/src/lib/portfolio/weighting";
import { computePortfolioFromPositions } from "../client/src/lib/portfolio/engine";

const msft = JSON.parse(fs.readFileSync("/tmp/render_msft.json", "utf-8"));
const nvda = JSON.parse(fs.readFileSync("/tmp/render_nvda.json", "utf-8"));
const nvo = JSON.parse(fs.readFileSync("/tmp/render_nvo.json", "utf-8"));

const historicalPricesByTicker = {
  MSFT: (msft.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
  NVDA: (nvda.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
  NVO: (nvo.historicalPrices ?? []).map((h: any) => ({ date: h.date, close: h.close })),
};

console.log("=== SCHRITT 1: buildCovariance (roh, VOR Winsorizing) ===");
const cov = buildCovariance(historicalPricesByTicker);
console.log("tickersAligned:", cov.tickersAligned);
console.log("nObs:", cov.nObs);
console.log("mu_raw (annualisiert, VOR Winsorizing):", cov.mu.map(m => (m * 100).toFixed(1) + "%"));
console.log("sigma:", cov.sigma.map(s => (s * 100).toFixed(1) + "%"));
console.log("Sigma (nach Ridge in buildCovariance):");
cov.Sigma.forEach(row => console.log("  ", row.map(v => v.toFixed(5)).join("  ")));
console.log("ridgeApplied:", cov.ridgeApplied);

console.log("\n=== SCHRITT 2: μ-Winsorizing ===");
const sources: ("override" | "historical")[] = cov.tickersAligned.map(() => "historical");
const winsorized = winsorizeMuArray(cov.mu, sources);
console.log("mu_after_winsor:", winsorized.mu.map(m => (m * 100).toFixed(1) + "%"));
console.log("clippedTickerIndices:", winsorized.clippedTickerIndices.map(i => cov.tickersAligned[i]));

console.log("\n=== SCHRITT 3: shrinkCovariance (ZUSÄTZLICHES Shrinkage in weighting.ts, n=3 -> delta=0.25) ===");
const n = cov.tickersAligned.length;
const SigmaShrunk = shrinkCovariance(cov.Sigma, n);
console.log("Sigma NACH shrinkCovariance (delta=0.25 bei n<=4):");
SigmaShrunk.forEach(row => console.log("  ", row.map(v => v.toFixed(5)).join("  ")));

console.log("\n=== SCHRITT 4: pickWeightMode -- welcher Modus wird gewählt? ===");
const rf = 0.03;
const sigmaStable = isSigmaStable(cov.Sigma);
const muWeak = isMuWeak(winsorized.mu, rf);
console.log("isSigmaStable(Sigma):", sigmaStable);
console.log("isMuWeak(mu_after_winsor, rf):", muWeak);
const mode = pickWeightMode({ n, mu: winsorized.mu, Sigma: cov.Sigma, rf });
console.log("pickWeightMode ->", mode);

console.log("\n=== SCHRITT 5: w_raw = Σ_shrunk⁻¹ · (μ̃) MANUELL nachvollzogen (vor jeglichen Constraints) ===");
function invertMatrix(A: number[][]): number[][] | null {
  const nn = A.length;
  const M = A.map((row, i) => [...row, ...Array(nn).fill(0).map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < nn; col++) {
    let pivotRow = col; let maxAbs = Math.abs(M[col][col]);
    for (let r = col + 1; r < nn; r++) { if (Math.abs(M[r][col]) > maxAbs) { maxAbs = Math.abs(M[r][col]); pivotRow = r; } }
    if (maxAbs < 1e-12) return null;
    if (pivotRow !== col) { const tmp = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmp; }
    const pivotVal = M[col][col];
    for (let j = 0; j < 2 * nn; j++) M[col][j] /= pivotVal;
    for (let r = 0; r < nn; r++) { if (r === col) continue; const factor = M[r][col]; if (factor === 0) continue; for (let j = 0; j < 2 * nn; j++) M[r][j] -= factor * M[col][j]; }
  }
  return M.map(row => row.slice(nn));
}
const muExcess = winsorized.mu.map(m => m - rf);
console.log("muExcess:", muExcess.map(m => (m * 100).toFixed(1) + "%"));
const inv = invertMatrix(SigmaShrunk);
console.log("Inversion erfolgreich (nicht singulär)?", inv != null);
if (inv) {
  const wRaw = inv.map(row => row.reduce((s, a, j) => s + a * muExcess[j], 0));
  console.log("w_raw (Σ_shrunk⁻¹ · μ̃, UNNORMALISIERT, vor long-only-Clip):", wRaw.map(w => w.toFixed(4)));
  const sumRaw = wRaw.reduce((s, w) => s + w, 0);
  console.log("Summe w_raw:", sumRaw.toFixed(4));
  console.log("w_raw normalisiert (nur zur Anschauung, OHNE Clip):", wRaw.map(w => (w / sumRaw * 100).toFixed(1) + "%"));
}

console.log("\n=== SCHRITT 6: Voller Engine-Aufruf (identisch zur UI) ===");
const enginePositions = [
  { ticker: "MSFT", qty: 1, entryPrice: msft.currentPrice, lastPrice: msft.currentPrice, side: "long" as const },
  { ticker: "NVDA", qty: 1, entryPrice: nvda.currentPrice, lastPrice: nvda.currentPrice, side: "long" as const },
  { ticker: "NVO", qty: 1, entryPrice: nvo.currentPrice, lastPrice: nvo.currentPrice, side: "long" as const },
];
const engineResult = computePortfolioFromPositions({
  positions: enginePositions,
  historicalPricesByTicker,
  rf: 0.03,
  capital: 100000,
});
console.log("status:", engineResult.status);
console.log("mode:", engineResult.mode);
engineResult.rows.forEach(r => console.log(`  ${r.ticker}: mu=${(r.mu * 100).toFixed(1)}% sigma=${(r.sigma * 100).toFixed(1)}% w_CAPM=${(r.weightCapm * 100).toFixed(1)}%`));
console.log("Sharpe_p:", engineResult.sharpePortfolio, "Sharpe_eq:", engineResult.sharpeEqualWeight, "Δ:", engineResult.deltaVsEqual);
console.log("Flags:", engineResult.flags);
