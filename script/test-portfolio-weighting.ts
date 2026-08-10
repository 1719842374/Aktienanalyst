/**
 * Unit-Tests für die Gewichtungsalgorithmen (WORK_PORTFOLIO.md Kapitel B).
 * Deckt die 3 Modi, pickWeightMode()-Entscheidungslogik (§B.3) und die
 * Guards (long-only, Σw=1, maxWeight-Cap, n=1-Sonderfall, §B.2) ab.
 *
 * Ausführen: npx tsx script/test-portfolio-weighting.ts
 */
import {
  weightMaxSharpe,
  weightRiskParity,
  weightScoreTilt,
  pickWeightMode,
  allocate,
  applyMaxWeightCap,
  renormalize,
  isSigmaStable,
  isMuWeak,
  DEFAULT_MAX_WEIGHT,
} from "../client/src/lib/portfolio/weighting";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function sum(arr: number[]): number {
  return arr.reduce((s, x) => s + x, 0);
}
function approxEqual(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) < eps;
}

// ─── Modus A: Max-Sharpe long-only ─────────────────────────────────────────
console.log("\nModus A: Max-Sharpe long-only");
{
  // n=4 gewählt, damit maxWeight=0.30 überhaupt erfüllbar ist (0.30*4=1.20 ≥ 1;
  // bei n=3 wäre 0.30*3=0.90 < 1 rechnerisch unmöglich — siehe eigener Test
  // weiter unten für genau diesen Infeasibility-Fall).
  const mu = [0.15, 0.10, 0.08, 0.12];
  const Sigma = [
    [0.04, 0.005, 0.002, 0.003],
    [0.005, 0.03, 0.003, 0.001],
    [0.002, 0.003, 0.02, 0.002],
    [0.003, 0.001, 0.002, 0.025],
  ];
  const rf = 0.03;
  const result = weightMaxSharpe({ mu, Sigma, rf });
  const w = result.weights;
  check("long-only: alle Gewichte ≥ 0", w.every((x) => x >= -1e-9), JSON.stringify(w));
  check("Σw = 1", approxEqual(sum(w), 1), String(sum(w)));
  check("maxWeight-Cap eingehalten (≤0.30+eps)", w.every((x) => x <= 0.30 + 1e-6), JSON.stringify(w));
  check("Cap war erfüllbar (n=4, 0.30*4≥1) -> capWasInfeasible=false", result.capWasInfeasible === false);
  check("Solve erfolgreich (nicht-singäre Σ) -> solveFailed=false", result.solveFailed === false);
}

// ─── Modus B: Risk-Parity ───────────────────────────────────────────────────
console.log("\nModus B: Risk-Parity (w_i ∝ 1/σ_i)");
{
  const Sigma = [
    [0.01, 0, 0], // σ=0.10
    [0, 0.04, 0], // σ=0.20
    [0, 0, 0.09], // σ=0.30
  ];
  const rpResult = weightRiskParity({ Sigma, maxWeight: 1 }); // maxWeight=1 um reine RP-Proportionen zu prüfen
  const w = rpResult.weights;
  check("long-only", w.every((x) => x >= -1e-9), JSON.stringify(w));
  check("Σw = 1", approxEqual(sum(w), 1), String(sum(w)));
  // Erwartete Proportionen: 1/0.1 : 1/0.2 : 1/0.3 = 10 : 5 : 3.333 → normiert
  const raw = [1 / 0.1, 1 / 0.2, 1 / 0.3];
  const expected = renormalize(raw);
  check("Gewichte proportional zu 1/σ_i", w.every((x, i) => approxEqual(x, expected[i], 1e-6)), `${JSON.stringify(w)} vs ${JSON.stringify(expected)}`);
  check("w[0] > w[1] > w[2] (niedrigste Vol bekommt höchstes Gewicht)", w[0] > w[1] && w[1] > w[2]);
}

// ─── Modus C: Score-Tilt ────────────────────────────────────────────────────
console.log("\nModus C: Score-Tilt (Basis × (1+κ·z(score)))");
{
  const scores = [90, 50, 30];
  const base = [1 / 3, 1 / 3, 1 / 3];
  const stResult = weightScoreTilt({ scores, base, kappa: 0.35, maxWeight: 1 });
  const w = stResult.weights;
  check("long-only", w.every((x) => x >= -1e-9), JSON.stringify(w));
  check("Σw = 1", approxEqual(sum(w), 1), String(sum(w)));
  check("höchster Score bekommt höchstes Gewicht", w[0] > w[1] && w[1] > w[2], JSON.stringify(w));

  // κ=0 → sollte exakt Basis reproduzieren (kein Tilt)
  const wNoTilt = weightScoreTilt({ scores, base, kappa: 0, maxWeight: 1 }).weights;
  check("κ=0 reproduziert Basisgewichte", wNoTilt.every((x, i) => approxEqual(x, base[i])), JSON.stringify(wNoTilt));
}

// ─── Guard: maxWeight-Cap mit Redistribution ───────────────────────────────
console.log("\nGuard: maxWeight-Cap + Redistribution (Σw bleibt 1)");
{
  // n=5 (0.30*5=1.5 ≥ 1 → Cap ist erfüllbar), stark konzentriert auf Position 1
  const raw = [0.6, 0.15, 0.1, 0.1, 0.05];
  const capResult = applyMaxWeightCap(raw, 0.30);
  const capped = capResult.weights;
  check("kein Gewicht > 0.30+eps", capped.every((x) => x <= 0.30 + 1e-6), JSON.stringify(capped));
  check("Σw = 1 nach Cap+Redistribution", approxEqual(sum(capped), 1), String(sum(capped)));
  check("Cap war erfüllbar (n=5) -> wasInfeasible=false", capResult.wasInfeasible === false);
}

console.log("\nBUGFIX 10.08.2026: maxWeight rechnerisch unerfüllbar bei n=3 (0.30*3=0.90<1) -> Cap wird NICHT erzwungen, KEIN stiller Equal-Weight-Fallback mehr");
{
  // Früher fiel dieser Fall STILL auf Equal-Weight (1/3,1/3,1/3) zurück --
  // das war exakt der 10.08.2026 gemeldete Live-Bug (w%CAPM=33.3/33.3/33.3
  // trotz stark unterschiedlichem μ/σ). Der Fix: Rohgewichte werden nur
  // renormiert (Struktur bleibt erhalten), Cap-Verletzung wird geflaggt.
  const raw = [0.7, 0.2, 0.1];
  const capResult = applyMaxWeightCap(raw, 0.30);
  const capped = capResult.weights;
  check("KEIN Equal-Weight-Fallback mehr -- Struktur von raw bleibt erhalten (w[0]>w[1]>w[2])", capped[0] > capped[1] && capped[1] > capped[2], JSON.stringify(capped));
  check("Gewichte sind einfach die renormierten Rohgewichte (0.7/0.2/0.1 -> identisch da bereits Σ=1)", capped.every((x, i) => approxEqual(x, raw[i])), JSON.stringify(capped));
  check("Σw = 1 bleibt erhalten", approxEqual(sum(capped), 1), String(sum(capped)));
  check("wasInfeasible=true (Cap konnte nicht durchgesetzt werden, sichtbar geflaggt)", capResult.wasInfeasible === true);
}

console.log("\nGuard: maxWeight zu klein für n Titel -> Struktur bleibt erhalten, wasInfeasible=true");
{
  // n=5, maxWeight=0.10 → 5*0.10=0.50 < 1 → unmöglich, alle unter Cap zu halten
  const raw = [0.5, 0.2, 0.1, 0.1, 0.1];
  const capResult = applyMaxWeightCap(raw, 0.10);
  const capped = capResult.weights;
  check("Struktur bleibt erhalten (kein Equal-Weight, raw war bereits normiert)", capped.every((x, i) => approxEqual(x, raw[i])), JSON.stringify(capped));
  check("wasInfeasible=true", capResult.wasInfeasible === true);
}

// ─── pickWeightMode: §B.3 Entscheidungslogik ───────────────────────────────
console.log("\npickWeightMode(): §B.3 Entscheidungslogik");
{
  // n < 2 → Kelly only
  const mode1 = pickWeightMode({ n: 1, mu: [0.1], Sigma: [[0.04]], rf: 0.03 });
  check("n=1 → kelly-only", mode1 === "kelly-only", mode1);

  const mode1b = pickWeightMode({ n: 0, mu: [], Sigma: [], rf: 0.03 });
  check("n=0 → kelly-only", mode1b === "kelly-only", mode1b);

  // n < 3 → Risk-Parity (auch bei starkem μ und stabiler Σ)
  const mode2 = pickWeightMode({
    n: 2,
    mu: [0.20, 0.18],
    Sigma: [
      [0.04, 0.005],
      [0.005, 0.03],
    ],
    rf: 0.03,
  });
  check("n=2 (< 3) → Risk-Parity (B)", mode2 === "B", mode2);

  // μ schwach (kaum Excess-Return) → Risk-Parity, auch bei n≥3
  const mode3 = pickWeightMode({
    n: 3,
    mu: [0.031, 0.029, 0.03], // rf=0.03, praktisch kein Excess
    Sigma: [
      [0.04, 0.002, 0.001],
      [0.002, 0.03, 0.001],
      [0.001, 0.001, 0.02],
    ],
    rf: 0.03,
  });
  check("μ schwach + n≥3 → Risk-Parity (B)", mode3 === "B", mode3);

  // Σ instabil (Diagonalwert ~0) → Risk-Parity
  const mode4 = pickWeightMode({
    n: 3,
    mu: [0.20, 0.18, 0.15],
    Sigma: [
      [1e-10, 0, 0],
      [0, 0.03, 0],
      [0, 0, 0.02],
    ],
    rf: 0.03,
  });
  check("Σ instabil → Risk-Parity (B)", mode4 === "B", mode4);

  // μ hoch + Σ stabil + n≥3 → Max-Sharpe (A)
  const mode5 = pickWeightMode({
    n: 3,
    mu: [0.20, 0.18, 0.15],
    Sigma: [
      [0.04, 0.005, 0.002],
      [0.005, 0.03, 0.003],
      [0.002, 0.003, 0.02],
    ],
    rf: 0.03,
  });
  check("μ hoch + Σ stabil + n≥3 → Max-Sharpe (A)", mode5 === "A", mode5);

  // Sanity: isSigmaStable / isMuWeak Hilfsfunktionen direkt geprüft
  check("isSigmaStable(stabile Σ) = true", isSigmaStable([[0.04, 0], [0, 0.03]]) === true);
  check("isSigmaStable(instabile Σ, ~0 Diagonal) = false", isSigmaStable([[1e-10, 0], [0, 0.03]]) === false);
  check("isMuWeak(kaum Excess) = true", isMuWeak([0.031, 0.029], 0.03) === true);
  check("isMuWeak(deutlicher Excess) = false", isMuWeak([0.20, 0.18], 0.03) === false);
}

// ─── allocate(): n=1-Sonderfall + Gesamt-Guard-Kette ───────────────────────
console.log("\nallocate(): n=1-Sonderfall (kein Basket-Optimierer)");
{
  const result = allocate({
    tickers: ["AAPL"],
    mu: [0.12],
    Sigma: [[0.04]],
    rf: 0.03,
  });
  check("mode = kelly-only bei n=1", result.mode === "kelly-only", result.mode);
  check("weights = [1] bei n=1", result.weights.length === 1 && approxEqual(result.weights[0], 1), JSON.stringify(result.weights));
  check("Notes erwähnen n=1/Kelly", result.notes.some((n) => n.toLowerCase().includes("n=1")), JSON.stringify(result.notes));
  check("capWasInfeasible=false bei n=1 (kein Cap-Problem)", result.capWasInfeasible === false);
}

console.log("\nallocate(): n≥3 End-to-End Guard-Kette (long-only, Σw=1, maxWeight)");
{
  const result = allocate({
    tickers: ["AAA", "BBB", "CCC", "DDD"],
    mu: [0.25, 0.05, 0.04, 0.22],
    Sigma: [
      [0.03, 0.002, 0.001, 0.003],
      [0.002, 0.02, 0.001, 0.001],
      [0.001, 0.001, 0.015, 0.001],
      [0.003, 0.001, 0.001, 0.025],
    ],
    rf: 0.03,
    maxWeight: 0.30,
  });
  check("Σw = 1", approxEqual(sum(result.weights), 1), String(sum(result.weights)));
  check("long-only", result.weights.every((x) => x >= -1e-9), JSON.stringify(result.weights));
  check("maxWeight eingehalten", result.weights.every((x) => x <= 0.30 + 1e-6), JSON.stringify(result.weights));
  check("mode ist A oder C (n≥3, gemischtes μ)", result.mode === "A" || result.mode === "C", result.mode);
  check("Cap war erfüllbar (n=4, maxWeight=0.30 -> 0.30*4=1.2≥1) -> capWasInfeasible=false", result.capWasInfeasible === false);
}

console.log("\nBUGFIX 10.08.2026: allocate() end-to-end mit unerfüllbarem Cap (n=3, maxWeight=0.30) -> KEIN Equal-Weight-Bug mehr");
{
  // Das ist der exakte Live-Reproduktionsfall (MSFT/NVDA/NVO-artig): stark
  // unterschiedliches μ/σ bei n=3 und UI-Default maxWeight=0.30. Vor dem Fix
  // lieferte dies immer 1/3,1/3,1/3 mit Δ=0 -- unabhängig von μ/σ/Σ.
  const mu = [0.25, 0.12, 0.30];
  const Sigma = [
    [0.08, 0.01, 0.02],
    [0.01, 0.03, 0.01],
    [0.02, 0.01, 0.15],
  ];
  const result = allocate({ tickers: ["A", "B", "C"], mu, Sigma, rf: 0.03, maxWeight: 0.30 });
  const w = result.weights;
  const isExactlyEqualWeight = w.every((x) => approxEqual(x, 1 / 3, 1e-4));
  check("Ergebnis ist NICHT mehr stur 1/3,1/3,1/3 trotz maxWeight=0.30 bei n=3", !isExactlyEqualWeight, JSON.stringify(w));
  check("capWasInfeasible=true wird sichtbar gemeldet", result.capWasInfeasible === true);
  check("Σw = 1 bleibt auch im Infeasible-Fall erhalten", approxEqual(sum(w), 1), String(sum(w)));
  check("Notes enthalten fallback_reason=cap_infeasible-Hinweis", result.notes.some((n) => n.includes("cap_infeasible")), JSON.stringify(result.notes));
}

console.log(failed === 0 ? "\n✅ Alle Weighting-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
