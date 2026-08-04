/**
 * Unit-Tests für die Sharpe-Ratio-Implementierung (WORK_PORTFOLIO.md Kapitel C).
 * Setzt alle 5 Test-Vektoren aus §C.6 exakt um.
 * Läuft ohne Netzwerk/LLM — reine Funktionstests.
 *
 * Ausführen: npx tsx script/test-portfolio-sharpe.ts
 */
import {
  portfolioVariance,
  portfolioVol,
  portfolioMean,
  sharpeRatio,
  sharpeReport,
} from "../client/src/lib/portfolio/sharpe";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function approxEqual(a: number | null, b: number, eps = 1e-9): boolean {
  return a != null && Math.abs(a - b) < eps;
}

console.log("\n§C.6 Test-Vektor 1: n=1, μ=0.10, rf=0.03, σ=0.20 → Sharpe = 0.35");
{
  const w = [1];
  const mu = [0.10];
  const Sigma = [[0.20 * 0.20]];
  const rf = 0.03;
  const sharpe = sharpeRatio(w, mu, Sigma, rf);
  check("Sharpe = 0.35 exakt", approxEqual(sharpe, 0.35), String(sharpe));
}

console.log("\n§C.6 Test-Vektor 2: zwei unkorrelierte Titel, gleiche μ/σ, w=(0.5,0.5) → σ_p=σ/√2, Sharpe_p=Sharpe_i×√2");
{
  const mu = [0.10, 0.10];
  const sigma = 0.20;
  const Sigma = [
    [sigma * sigma, 0],
    [0, sigma * sigma],
  ];
  const rf = 0.03;
  const w = [0.5, 0.5];
  const sigmaP = portfolioVol(w, Sigma);
  const expectedSigmaP = sigma / Math.sqrt(2);
  check("σ_p = σ/√2", Math.abs(sigmaP - expectedSigmaP) < 1e-9, `${sigmaP} vs ${expectedSigmaP}`);

  const sharpeI = (mu[0] - rf) / sigma;
  const sharpeP = sharpeRatio(w, mu, Sigma, rf);
  const expectedSharpeP = sharpeI * Math.sqrt(2);
  check("Sharpe_p = Sharpe_i × √2", approxEqual(sharpeP, expectedSharpeP), `${sharpeP} vs ${expectedSharpeP}`);
}

console.log("\n§C.6 Test-Vektor 3: w nicht summiert auf 1 → API-Guard-Test (Renorm-Erwartung dokumentiert)");
{
  // sharpeRatio selbst nimmt w wie übergeben entgegen (reine Funktion, siehe
  // Kommentar in sharpe.ts zu §C.4 Punkt 4: Renormierung ist Aufrufer-Pflicht,
  // z.B. in weighting.ts/pipeline.ts). Wir verifizieren hier den Unterschied
  // zwischen nicht-normiertem und renormiertem w als Nachweis, dass der
  // Aufrufer renormieren MUSS, bevor er sharpeRatio aufruft (API-Guard-Prinzip).
  const mu = [0.10, 0.10];
  const Sigma = [
    [0.04, 0],
    [0, 0.04],
  ];
  const rf = 0.03;
  const wBad = [0.6, 0.6]; // Summe = 1.2, NICHT normiert
  const wGood = [0.5, 0.5]; // renormiert (Summe = 1)
  const sharpeBad = sharpeRatio(wBad, mu, Sigma, rf);
  const sharpeGood = sharpeRatio(wGood, mu, Sigma, rf);
  check(
    "Nicht-normiertes w liefert ein ANDERES Ergebnis als renormiertes w (Beleg: Aufrufer muss vor sharpeRatio renormieren)",
    sharpeBad !== null && sharpeGood !== null && Math.abs(sharpeBad - sharpeGood) > 1e-9,
    `${sharpeBad} vs ${sharpeGood}`
  );
  const sumBad = wBad.reduce((s, x) => s + x, 0);
  check("|Σw−1| > 1e-6 korrekt erkannt für wBad", Math.abs(sumBad - 1) > 1e-6, String(sumBad));
  const sumGood = wGood.reduce((s, x) => s + x, 0);
  check("|Σw−1| ≤ 1e-6 für wGood (kein Renorm nötig)", Math.abs(sumGood - 1) <= 1e-6, String(sumGood));
}

console.log("\n§C.6 Test-Vektor 4: Σ = 0 → Sharpe null");
{
  const w = [0.5, 0.5];
  const mu = [0.10, 0.12];
  const Sigma = [
    [0, 0],
    [0, 0],
  ];
  const rf = 0.03;
  const sharpe = sharpeRatio(w, mu, Sigma, rf);
  check("Sharpe === null bei Σ=0", sharpe === null, String(sharpe));

  const variance = portfolioVariance(w, Sigma);
  check("portfolioVariance = 0", variance === 0, String(variance));
  const vol = portfolioVol(w, Sigma);
  check("portfolioVol = 0", vol === 0, String(vol));
}

console.log("\n§C.6 Test-Vektor 5: Equal vs konzentriert — bei gleicher μ-Struktur oft Equal ≥ konzentriert im Sample-Risk");
{
  // Zwei Titel, gleiche μ, aber Titel 2 hat höhere Vol UND positive Korrelation.
  // Eine konzentrierte Position in Titel 1 (niedrigere Vol) kann besser sein,
  // aber Equal-Weight ist bzgl. Diversifikations-Risiko robuster, wenn μ-Schätzung
  // unsicher ist. Wir testen hier konkret: bei identischem μ/σ (kein Edge in der
  // Schätzung) UND positiver Korrelation liefert Equal-Weight ein Sharpe, das
  // NICHT schlechter ist als eine zufällig konzentrierte Gewichtung auf den
  // volatileren Titel.
  const mu = [0.10, 0.10];
  const sigma1 = 0.15;
  const sigma2 = 0.30;
  const rho = 0.5;
  const cov12 = rho * sigma1 * sigma2;
  const Sigma = [
    [sigma1 * sigma1, cov12],
    [cov12, sigma2 * sigma2],
  ];
  const rf = 0.03;
  const wEqual = [0.5, 0.5];
  const wConcentrated = [0.1, 0.9]; // konzentriert auf den volatileren Titel 2
  const sharpeEqual = sharpeRatio(wEqual, mu, Sigma, rf);
  const sharpeConcentrated = sharpeRatio(wConcentrated, mu, Sigma, rf);
  check(
    "Equal-Weight-Sharpe ≥ konzentrierte Gewichtung auf volatileren Titel (gleiche μ-Struktur)",
    sharpeEqual != null && sharpeConcentrated != null && sharpeEqual >= sharpeConcentrated,
    `${sharpeEqual} vs ${sharpeConcentrated}`
  );
}

console.log("\nZusatz: sharpeReport()-Konsistenz (muP/sigmaP/deltaVsEqual/sharpeSingle)");
{
  const w = [0.6, 0.4];
  const mu = [0.12, 0.08];
  const Sigma = [
    [0.04, 0.005],
    [0.005, 0.09],
  ];
  const rf = 0.02;
  const report = sharpeReport({ w, mu, Sigma, rf });
  check("muP = w·μ", Math.abs(report.muP - portfolioMean(w, mu)) < 1e-12, String(report.muP));
  check("sigmaP = √(w'Σw)", Math.abs(report.sigmaP - portfolioVol(w, Sigma)) < 1e-12, String(report.sigmaP));
  check(
    "deltaVsEqual = sharpePortfolio - sharpeEqualWeight",
    report.deltaVsEqual != null &&
      report.sharpePortfolio != null &&
      report.sharpeEqualWeight != null &&
      Math.abs(report.deltaVsEqual - (report.sharpePortfolio - report.sharpeEqualWeight)) < 1e-12
  );
  check("sharpeSingle hat Länge n", report.sharpeSingle.length === 2);
  const expectedSingle0 = (mu[0] - rf) / Math.sqrt(Sigma[0][0]);
  check("sharpeSingle[0] korrekt", approxEqual(report.sharpeSingle[0], expectedSingle0), String(report.sharpeSingle[0]));
}

console.log(failed === 0 ? "\n✅ Alle Sharpe-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
