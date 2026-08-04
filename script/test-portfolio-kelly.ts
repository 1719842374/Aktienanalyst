/**
 * Unit-Tests für das Kelly-Kriterium (WORK_PORTFOLIO.md Kapitel D).
 * Setzt alle 5 Test-Vektoren aus §D.7 exakt um.
 * Läuft ohne Netzwerk/LLM — reine Funktionstests.
 *
 * Ausführen: npx tsx script/test-portfolio-kelly.ts
 */
import {
  kellyContinuous,
  kellyDiscrete,
  applyKellyPolicy,
  sizeKellySingle,
} from "../client/src/lib/portfolio/kelly";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

console.log("\n§D.7 Test-Vektor 1: μ=0.12, rf=0.03, σ=0.20 → f*=(0.09)/0.04=2.25 → half=1.125 → capped=0.25");
{
  const fStar = kellyContinuous(0.12, 0.20, 0.03);
  check("f* = 2.25 exakt", approxEqual(fStar, 2.25), String(fStar));
  const policy = applyKellyPolicy(fStar);
  check("fHalf = 1.125 exakt", approxEqual(policy.fHalf, 1.125), String(policy.fHalf));
  check("fCapped = 0.25 exakt", approxEqual(policy.fCapped, 0.25), String(policy.fCapped));
}

console.log("\n§D.7 Test-Vektor 2: μ=rf → f*=0");
{
  const fStar = kellyContinuous(0.05, 0.20, 0.05);
  check("f* = 0 exakt", approxEqual(fStar, 0), String(fStar));
  const policy = applyKellyPolicy(fStar);
  check("fHalf = 0", approxEqual(policy.fHalf, 0), String(policy.fHalf));
  check("fCapped = 0", approxEqual(policy.fCapped, 0), String(policy.fCapped));
}

console.log("\n§D.7 Test-Vektor 3: p=0.55, b=1.5 → f*=(0.55*1.5-0.45)/1.5=0.25 → half=0.125");
{
  const fStar = kellyDiscrete(0.55, 1.5);
  check("f* = 0.25 exakt", approxEqual(fStar, 0.25), String(fStar));
  const policy = applyKellyPolicy(fStar);
  check("fHalf = 0.125 exakt", approxEqual(policy.fHalf, 0.125), String(policy.fHalf));
  check("fCapped = 0.125 (unter Cap 0.25)", approxEqual(policy.fCapped, 0.125), String(policy.fCapped));
}

console.log("\n§D.7 Test-Vektor 4: p=0.4, b=1 → f* negativ → 0");
{
  const fStarRaw = (0.4 * 1 - (1 - 0.4)) / 1; // = -0.2, zur Doku
  check("Rohwert wäre negativ (-0.2)", approxEqual(fStarRaw, -0.2), String(fStarRaw));
  const fStar = kellyDiscrete(0.4, 1);
  check("kellyDiscrete(0.4,1) roh = -0.2 (Clipping passiert in applyKellyPolicy)", approxEqual(fStar, -0.2), String(fStar));
  const policy = applyKellyPolicy(fStar);
  check("fStar (Policy) = 0 nach Floor", approxEqual(policy.fStar, 0), String(policy.fStar));
  check("fHalf = 0", approxEqual(policy.fHalf, 0), String(policy.fHalf));
  check("fCapped = 0", approxEqual(policy.fCapped, 0), String(policy.fCapped));
}

console.log("\n§D.7 Test-Vektor 5: Policy — nie fCapped > 0.25 (Property-Test über mehrere extreme Inputs)");
{
  const extremeCases = [
    { mu: 5.0, sigma: 0.01, rf: 0.0 },
    { mu: 10.0, sigma: 0.05, rf: 0.02 },
    { mu: 100.0, sigma: 0.1, rf: 0.0 },
    { mu: 0.5, sigma: 0.001, rf: 0.0 },
  ];
  let allUnderCap = true;
  for (const c of extremeCases) {
    const fStar = kellyContinuous(c.mu, c.sigma, c.rf);
    const policy = applyKellyPolicy(fStar);
    if (policy.fCapped > 0.25 + 1e-12) allUnderCap = false;
  }
  check("Alle extremen Fälle: fCapped ≤ 0.25", allUnderCap);

  // Auch mit explizit anderem maxF sollte fCapped nie den gewählten Cap überschreiten
  const fStar = kellyContinuous(1.0, 0.01, 0.0);
  const policyCustomCap = applyKellyPolicy(fStar, { maxF: 0.10 });
  check("Custom maxF=0.10 wird eingehalten", policyCustomCap.fCapped <= 0.10 + 1e-12, String(policyCustomCap.fCapped));
}

console.log("\nZusatz: sizeKellySingle() — Gesamtkapital-Bezug (§D.1/§D.4) und sharesHint");
{
  const result = sizeKellySingle({
    mu: 0.12,
    sigma: 0.20,
    rf: 0.03,
    capitalBase: 100000,
    price: 50,
    method: "continuous",
  });
  check("fStar = 2.25", approxEqual(result.fStar, 2.25), String(result.fStar));
  check("fHalf = 1.125", approxEqual(result.fHalf, 1.125), String(result.fHalf));
  check("fCapped = 0.25 (Half-Kelly Default + Cap)", approxEqual(result.fCapped, 0.25), String(result.fCapped));
  check("amount = fCapped × K = 25000 (bezogen auf GESAMTKAPITAL, nicht Restcash)", approxEqual(result.amount, 25000), String(result.amount));
  check("sharesHint = amount / price = 500", approxEqual(result.sharesHint, 500), String(result.sharesHint));

  const discreteResult = sizeKellySingle({
    p: 0.55,
    b: 1.5,
    capitalBase: 100000,
    price: 25,
    method: "discrete",
  });
  check("discrete fCapped = 0.125", approxEqual(discreteResult.fCapped, 0.125), String(discreteResult.fCapped));
  check("discrete amount = 12500", approxEqual(discreteResult.amount, 12500), String(discreteResult.amount));
}

console.log(failed === 0 ? "\n✅ Alle Kelly-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
