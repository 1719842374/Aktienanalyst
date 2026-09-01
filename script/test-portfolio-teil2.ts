/**
 * WORK_RESEARCHER_PORTFOLIO_TEIL2 Kapitel Q — Spec-Zahlen.
 * UI (Frontier, Pie Ist|Ziel, Δ-Banner, Policy-Reset) liegt bereits auf main.
 * npx tsx script/test-portfolio-teil2.ts
 */
import { computeHHI } from "../client/src/lib/portfolio/concentration";
import { shrinkCovariance, suggestedMaxWeightDefault } from "../client/src/lib/portfolio/weighting";
import { computeMarketWeights } from "../client/src/lib/portfolio/engine";
import { makePosition } from "../client/src/lib/portfolio/positions";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}`);
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

console.log("\nQ: HHI 30/30/30/10 = 0.28, Effective-N ≈ 3.57");
{
  const { hhi, effectiveN } = computeHHI([0.3, 0.3, 0.3, 0.1]);
  check("HHI = 0.28", approx(hhi, 0.28), String(hhi));
  check("Effective-N ≈ 3.57", Math.abs(effectiveN - 1 / 0.28) < 1e-9 && Math.abs(effectiveN - 3.57) < 0.005, String(effectiveN));
}

console.log("\nQ: shrinkCovariance n=4 → δ=0.25");
{
  const Sigma = [
    [0.04, 0.01, 0.002, 0.003],
    [0.01, 0.03, 0.001, 0.002],
    [0.002, 0.001, 0.02, 0.004],
    [0.003, 0.002, 0.004, 0.025],
  ];
  const delta = 0.25;
  const got = shrinkCovariance(Sigma, 4);
  let match = true;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const diag = i === j ? Sigma[i][j] : 0;
      const exp = (1 - delta) * Sigma[i][j] + delta * diag;
      if (!approx(got[i][j], exp, 1e-12)) match = false;
    }
  }
  check("Σ_shrunk = 0.75·Σ + 0.25·diag(Σ)", match);
  check("n=4 suggestedMaxWeightDefault = 40%", suggestedMaxWeightDefault(4) === 0.4);
}

console.log("\nQ: weightMarket Summe = 1 wenn alle Kurse da");
{
  const w = computeMarketWeights(
    [
      makePosition({ ticker: "MSFT", qty: 1 }),
      makePosition({ ticker: "NVDA", qty: 1 }),
      makePosition({ ticker: "NVO", qty: 1 }),
      makePosition({ ticker: "LLY", qty: 1 }),
    ],
    { MSFT: 500, NVDA: 200, NVO: 100, LLY: 200 },
  );
  const vals = Object.values(w);
  const sum = vals.reduce((s, x) => s + x, 0);
  check("vier Kurse → vier Gewichte", vals.length === 4);
  check("Summe = 1", approx(sum, 1, 1e-12), String(sum));
}

console.log(failed === 0 ? "\nAlle TEIL2-Q-Tests bestanden" : `\n${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
