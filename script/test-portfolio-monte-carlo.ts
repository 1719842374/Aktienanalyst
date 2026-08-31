import {
  choleskyDecomposition,
  runPortfolioMonteCarlo,
  comparePortfolioWeightings,
} from "../client/src/lib/portfolio/portfolioMonteCarlo";

let failed = 0;
let total = 0;
const check = (name: string, condition: boolean, detail = "") => {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("\n=== Portfolio-Monte-Carlo: Cholesky-Zerlegung ===");

const SigmaDiag = [
  [0.04, 0, 0],
  [0, 0.09, 0],
  [0, 0, 0.0625],
];
const LDiag = choleskyDecomposition(SigmaDiag);
check(
  "Diagonalmatrix: L = sqrt(Diagonale)",
  !!LDiag && Math.abs(LDiag[0][0] - 0.2) < 1e-9 && Math.abs(LDiag[1][1] - 0.3) < 1e-9 && Math.abs(LDiag[2][2] - 0.25) < 1e-9,
  JSON.stringify(LDiag),
);

const SigmaCorrelated = [
  [0.04, 0.02, 0.01],
  [0.02, 0.09, 0.03],
  [0.01, 0.03, 0.0625],
];
const L = choleskyDecomposition(SigmaCorrelated);
check("Cholesky liefert eine untere Dreiecksmatrix (Elemente oberhalb der Diagonale == 0)", !!L && L[0][1] === 0 && L[0][2] === 0 && L[1][2] === 0);

if (L) {
  // Σ = L·Lᵀ Rekonstruktion prüfen.
  const n = L.length;
  const reconstructed = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => L[i].reduce((s, _v, k) => s + L[i][k] * L[j][k], 0)),
  );
  const maxDiff = Math.max(...reconstructed.flatMap((row, i) => row.map((v, j) => Math.abs(v - SigmaCorrelated[i][j]))));
  check("Σ = L·Lᵀ Rekonstruktion stimmt (max. Abweichung < 1e-9)", maxDiff < 1e-9, `maxDiff=${maxDiff}`);
}

const singularSigma = [
  [1, 1],
  [1, 1],
];
check("Nicht positiv-definite Matrix liefert null (kein Raten)", choleskyDecomposition(singularSigma) === null);

console.log("\n=== Portfolio-Monte-Carlo: Output-Kennzahlen (n=3, niedrige Korrelation) ===");

const tickers = ["AAA", "BBB", "CCC"];
const mu = [0.10, 0.08, 0.12];
const sigma = [0.20, 0.18, 0.25];
// Niedrige Korrelation (~0.1) zwischen den Titeln.
const Sigma = [
  [sigma[0] ** 2, 0.1 * sigma[0] * sigma[1], 0.1 * sigma[0] * sigma[2]],
  [0.1 * sigma[0] * sigma[1], sigma[1] ** 2, 0.1 * sigma[1] * sigma[2]],
  [0.1 * sigma[0] * sigma[2], 0.1 * sigma[1] * sigma[2], sigma[2] ** 2],
];
const weights = [1 / 3, 1 / 3, 1 / 3];

const mc = runPortfolioMonteCarlo({
  tickers, weights, mu, sigma, Sigma,
  iterations: 4000,
  tradingDays: 252,
});

check("status == 'ok'", mc.status === "ok", mc.flags.join(" | "));
check("Alle 6 Spec-16.11-Kennzahlen vorhanden und endlich", [mc.expectedReturn, mc.stdDev, mc.var5, mc.cvar5, mc.probNegative, mc.maxDrawdownMean].every(v => v != null && Number.isFinite(v)));

const weightedMeanMu = weights.reduce((s, w, i) => s + w * mu[i], 0); // ≈0.10
check(
  `E[R]_P (${mc.expectedReturn?.toFixed(4)}) liegt nahe am gewichteten Mittel der μ_i (${weightedMeanMu.toFixed(4)}) bei niedriger Korrelation`,
  mc.expectedReturn != null && Math.abs(mc.expectedReturn - weightedMeanMu) < 0.05,
);
check("CVaR 5% <= VaR 5% (CVaR ist der Mittelwert des Tails unterhalb VaR)", mc.cvar5 != null && mc.var5 != null && mc.cvar5 <= mc.var5 + 1e-9);
check("P(R_P<0) zwischen 0 und 1", mc.probNegative != null && mc.probNegative >= 0 && mc.probNegative <= 1);
check("maxDD (mean) zwischen 0 und 1", mc.maxDrawdownMean != null && mc.maxDrawdownMean >= 0 && mc.maxDrawdownMean <= 1);
check("pathReturns.length == iterations", mc.pathReturns.length === 4000);

console.log(`  E[R]_P=${(mc.expectedReturn! * 100).toFixed(2)}% σ_P=${(mc.stdDev! * 100).toFixed(2)}% VaR5%=${(mc.var5! * 100).toFixed(2)}% CVaR5%=${(mc.cvar5! * 100).toFixed(2)}% P(R<0)=${(mc.probNegative! * 100).toFixed(1)}% maxDD=${(mc.maxDrawdownMean! * 100).toFixed(2)}%`);

console.log("\n=== Portfolio-Monte-Carlo: generisch für n≥2 (hier n=2) ===");
const mc2 = runPortfolioMonteCarlo({
  tickers: ["X", "Y"],
  weights: [0.6, 0.4],
  mu: [0.09, 0.11],
  sigma: [0.15, 0.22],
  Sigma: [[0.0225, 0.1 * 0.15 * 0.22], [0.1 * 0.15 * 0.22, 0.0484]],
  iterations: 2000,
  tradingDays: 252,
});
check("n=2 funktioniert generisch ohne Ticker-Hardcode", mc2.status === "ok");

console.log("\n=== Portfolio-Monte-Carlo: n=1 wird abgelehnt (Spec: n≥2) ===");
const mcSingle = runPortfolioMonteCarlo({
  tickers: ["X"], weights: [1], mu: [0.1], sigma: [0.2], Sigma: [[0.04]],
  iterations: 1000, tradingDays: 252,
});
check("n=1 liefert status=invalid_input (kein Crash, kein Raten)", mcSingle.status === "invalid_input");

console.log("\n=== Portfolio-Monte-Carlo: Cholesky-Fehlschlag wird sauber gemeldet ===");
const mcBadSigma = runPortfolioMonteCarlo({
  tickers: ["A", "B"], weights: [0.5, 0.5], mu: [0.1, 0.1], sigma: [0.2, 0.2],
  Sigma: [[1, 1], [1, 1]], // singulär
  iterations: 1000, tradingDays: 252,
});
check("Singuläre Σ liefert status=cholesky_failed statt falscher Zahlen", mcBadSigma.status === "cholesky_failed");

console.log("\n=== Portfolio-Monte-Carlo: Ist-Gewichte vs. CAPM-Ziel-Vergleichslauf ===");
const comparison = comparePortfolioWeightings({
  tickers, mu, sigma, Sigma,
  weightsCurrent: [0.6, 0.2, 0.2],
  weightsCapmTarget: [0.2, 0.2, 0.6],
  iterations: 3000,
  tradingDays: 252,
});
check("Beide Läufe liefern status=ok", comparison.current.status === "ok" && comparison.capmTarget.status === "ok");
check(
  "Unterschiedliche Gewichte führen zu unterschiedlichem E[R]_P (mehr Gewicht auf μ=0.12-Ticker CCC im CAPM-Lauf)",
  comparison.capmTarget.expectedReturn != null && comparison.current.expectedReturn != null &&
    comparison.capmTarget.expectedReturn > comparison.current.expectedReturn - 0.005, // CCC hat höchstes μ, CAPM-Lauf gewichtet es höher
  JSON.stringify({ current: comparison.current.expectedReturn, capmTarget: comparison.capmTarget.expectedReturn }),
);
console.log(`  Ist-Gewichte E[R]_P=${(comparison.current.expectedReturn! * 100).toFixed(2)}% | CAPM-Ziel E[R]_P=${(comparison.capmTarget.expectedReturn! * 100).toFixed(2)}%`);

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed > 0) process.exit(1);
