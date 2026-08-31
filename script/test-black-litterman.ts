import {
  computeReverseOptimization,
  computeBlackLitterman,
  classifyViewInfluence,
  invertMatrixBL,
  DEFAULT_BL_POLICY,
  type ViewInput,
} from "../client/src/lib/portfolio/blackLitterman";

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

console.log("\n=== Black-Litterman: Reverse Optimization Π = λΣw ===");

const tickers = ["AAA", "BBB", "CCC"];
const Sigma = [
  [0.04, 0.01, 0.005],
  [0.01, 0.09, 0.02],
  [0.005, 0.02, 0.0625],
];
const weightsEqual = [1 / 3, 1 / 3, 1 / 3];

const reverseOpt = computeReverseOptimization(tickers, Sigma, weightsEqual, DEFAULT_BL_POLICY.lambda);
// Manuell erwartete Π = λΣw nachrechnen (n=3, w=1/3 je Ticker).
const expectedPi = Sigma.map(row => DEFAULT_BL_POLICY.lambda * (row[0] + row[1] + row[2]) / 3);
check(
  "Π = λΣw stimmt mit manueller Nachrechnung überein",
  reverseOpt.pi.every((v, i) => Math.abs(v - expectedPi[i]) < 1e-9),
  JSON.stringify({ pi: reverseOpt.pi, expectedPi }),
);
check("weightSum ≈ 1 bei Equal-Weight", Math.abs(reverseOpt.weightSum - 1) < 1e-9);

const reverseOptLambdaUp = computeReverseOptimization(tickers, Sigma, weightsEqual, DEFAULT_BL_POLICY.lambda * 2);
check(
  "Höheres λ skaliert Π proportional (Sensitivität Spec 16.10: λ↑ → Π sinkt bei... hier: λ verdoppelt Π linear)",
  reverseOptLambdaUp.pi.every((v, i) => Math.abs(v - 2 * reverseOpt.pi[i]) < 1e-9),
);

console.log("\n=== Black-Litterman: invertMatrixBL ===");
const identity = [[1, 0], [0, 1]];
const invIdentity = invertMatrixBL(identity);
check("Inverse der Einheitsmatrix ist die Einheitsmatrix", !!invIdentity && invIdentity.every((row, i) => row.every((v, j) => Math.abs(v - identity[i][j]) < 1e-12)));

const singular = [[1, 2], [2, 4]];
check("Singuläre Matrix liefert null (kein Raten)", invertMatrixBL(singular) === null);

console.log("\n=== Black-Litterman: E[R]_BL ohne Views == Π (Akzeptanzkriterium) ===");
const blNoViews = computeBlackLitterman(tickers, Sigma, reverseOpt.pi, [], DEFAULT_BL_POLICY.tau);
check(
  "BL ohne Views == Π exakt",
  blNoViews.expectedReturns.every((v, i) => Math.abs(v - reverseOpt.pi[i]) < 1e-12),
  JSON.stringify({ blNoViews: blNoViews.expectedReturns, pi: reverseOpt.pi }),
);
check("viewInfluence bei 0 Views == 'keine'", blNoViews.viewInfluence === "keine");
check("viewsUsed == 0", blNoViews.viewsUsed === 0);

console.log("\n=== Black-Litterman: E[R]_BL mit starkem View verschiebt Richtung Q ===");
const strongView: ViewInput[] = [{ ticker: "AAA", q: 0.35, omega: 0.0001 }]; // sehr kleines Ω = starker View
const blStrongView = computeBlackLitterman(tickers, Sigma, reverseOpt.pi, strongView, DEFAULT_BL_POLICY.tau);
check(
  "E[R]_BL(AAA) liegt zwischen Π(AAA) und Q, aber näher an Q bei sehr kleinem Ω",
  blStrongView.expectedReturns[0] > reverseOpt.pi[0] && Math.abs(blStrongView.expectedReturns[0] - 0.35) < Math.abs(reverseOpt.pi[0] - 0.35),
  JSON.stringify({ er: blStrongView.expectedReturns[0], pi: reverseOpt.pi[0], q: 0.35 }),
);
check(
  "Nicht-View-Ticker (BBB, CCC) werden über die Kovarianz plausibel mitbewegt",
  blStrongView.expectedReturns[1] !== reverseOpt.pi[1] || blStrongView.expectedReturns[2] !== reverseOpt.pi[2],
);
check("viewsUsed == 1 bei einem gültigen View", blStrongView.viewsUsed === 1);
check("viewInfluence bei starkem View ist 'stark'", blStrongView.viewInfluence === "stark", JSON.stringify(blStrongView.deltaVsPi));

console.log("\n=== Black-Litterman: schwacher View (großes Ω) verschiebt kaum ===");
const weakView: ViewInput[] = [{ ticker: "AAA", q: 0.35, omega: 1000 }]; // riesiges Ω = fast kein Gewicht
const blWeakView = computeBlackLitterman(tickers, Sigma, reverseOpt.pi, weakView, DEFAULT_BL_POLICY.tau);
check(
  "Sehr großes Ω verschiebt E[R]_BL kaum von Π",
  Math.abs(blWeakView.expectedReturns[0] - reverseOpt.pi[0]) < Math.abs(blStrongView.expectedReturns[0] - reverseOpt.pi[0]),
  JSON.stringify({ weak: blWeakView.expectedReturns[0], strong: blStrongView.expectedReturns[0], pi: reverseOpt.pi[0] }),
);
check("viewInfluence bei schwachem View ist 'schwach' oder 'keine'", blWeakView.viewInfluence === "schwach" || blWeakView.viewInfluence === "keine", blWeakView.viewInfluence);

console.log("\n=== Black-Litterman: Sensitivität auf τ ===");
const blTauLow = computeBlackLitterman(tickers, Sigma, reverseOpt.pi, strongView, 0.01);
const blTauHigh = computeBlackLitterman(tickers, Sigma, reverseOpt.pi, strongView, 0.05);
check(
  "Höheres τ verschiebt E[R]_BL(AAA) stärker Richtung Q (Spec 16.10: τ↑ → Views stärker)",
  Math.abs(blTauHigh.expectedReturns[0] - 0.35) < Math.abs(blTauLow.expectedReturns[0] - 0.35),
  JSON.stringify({ tauLow: blTauLow.expectedReturns[0], tauHigh: blTauHigh.expectedReturns[0] }),
);

console.log("\n=== Black-Litterman: unbekannter Ticker im View wird übersprungen (kein Raten) ===");
const unknownTickerView: ViewInput[] = [{ ticker: "ZZZ", q: 0.5, omega: 0.001 }];
const blUnknown = computeBlackLitterman(tickers, Sigma, reverseOpt.pi, unknownTickerView, DEFAULT_BL_POLICY.tau);
check(
  "View mit unbekanntem Ticker wird übersprungen -- Ergebnis == Π",
  blUnknown.expectedReturns.every((v, i) => Math.abs(v - reverseOpt.pi[i]) < 1e-9) && blUnknown.skippedViews.length === 1,
  JSON.stringify(blUnknown.skippedViews),
);

console.log("\n=== classifyViewInfluence Schwellen ===");
check("0 Delta -> 'keine'", classifyViewInfluence(0) === "keine");
check("0.001 Delta -> 'schwach'", classifyViewInfluence(0.001) === "schwach");
check("0.01 Delta -> 'mittel'", classifyViewInfluence(0.01) === "mittel");
check("0.05 Delta -> 'stark'", classifyViewInfluence(0.05) === "stark");

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed > 0) process.exit(1);
