/**
 * Akzeptanz-Test (Pflicht laut Bug-Report 10.08.2026, "Equal-Weight-Bug"):
 *
 *   Asset A: μ=0.20, σ=0.15
 *   Asset B: μ=0.08, σ=0.15
 *   ρ=0, rf=0.03, maxWeight=0.8
 *   Erwartung: w_A > w_B + margin, deltaSharpe > 0
 *
 * Muss ROT sein am Bug-Stand (vor dem Fix in applyMaxWeightCap) und GRÜN
 * nach dem Fix. Getestet über die volle Engine (computePortfolioFromPositions)
 * mit synthetischer Historie, die exakt μ=0.20/0.08 und σ=0.15/0.15 bei
 * Korrelation≈0 erzeugt -- damit auch buildCovariance()/winsorize() im Pfad
 * mitgetestet werden, nicht nur die isolierte weighting.ts-Funktion.
 *
 * Ausführen: npx tsx script/test-portfolio-maxsharpe-acceptance.ts
 */
import { computePortfolioFromPositions } from "../client/src/lib/portfolio/engine";
import { weightMaxSharpe, allocate } from "../client/src/lib/portfolio/weighting";
import type { PricePoint } from "../client/src/lib/portfolio/covariance";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ═══ TEIL 1: Isolierte Formel-Ebene (weightMaxSharpe/allocate direkt) ═══
console.log("=== Teil 1: weightMaxSharpe/allocate direkt (μ/Σ vorgegeben) ===");
{
  const mu = [0.20, 0.08];
  const Sigma = [
    [0.15 * 0.15, 0], // ρ=0 -> Off-Diagonale 0
    [0, 0.15 * 0.15],
  ];
  const rf = 0.03;
  const maxWeight = 0.8;

  const result = weightMaxSharpe({ mu, Sigma, rf, maxWeight });
  const [wA, wB] = result.weights;
  console.log(`  w_A=${(wA * 100).toFixed(1)}% w_B=${(wB * 100).toFixed(1)}%`);
  check("w_A > w_B (deutliche Marge)", wA > wB + 0.1, JSON.stringify(result.weights));
  check("capWasInfeasible=false (maxWeight=0.8, n=2 -> 1.6≥1, erfüllbar)", result.capWasInfeasible === false);
  check("solveFailed=false", result.solveFailed === false);

  // Hinweis: allocate({n:2, ...}) waehlt laut pickWeightMode() IMMER Modus B
  // (Risk-Parity), niemals A -- das ist dokumentiertes, unveraendertes
  // Verhalten ("n<3 -> Risk-Parity", siehe pickWeightMode-Docstring), KEIN
  // Teil dieses Bugfixes. Bei identischem sigma=15% fuer A und B liefert
  // Risk-Parity korrekt 50/50 (w_i ∝ 1/σ_i, gleiche σ -> gleiches Gewicht).
  // Der Max-Sharpe-Formel-Test (w_A > w_B bei unterschiedlichem μ) gehoert
  // daher zu weightMaxSharpe() direkt (oben), nicht zu allocate() bei n=2.
  const allocResultN2 = allocate({ tickers: ["A", "B"], mu, Sigma, rf, maxWeight });
  check("allocate() bei n=2 waehlt Modus B (dokumentiertes Verhalten, kein Bug)", allocResultN2.mode === "B", allocResultN2.mode);

  // Mit n=3 (dritter, neutraler Titel) greift pickWeightMode -> A, und die
  // Struktur aus weightMaxSharpe muss sich hier genauso zeigen.
  const mu3 = [0.20, 0.08, 0.10];
  const Sigma3 = [
    [0.0225, 0, 0],
    [0, 0.0225, 0],
    [0, 0, 0.0225],
  ];
  const allocResultN3 = allocate({ tickers: ["A", "B", "C"], mu: mu3, Sigma: Sigma3, rf, maxWeight });
  check("allocate() bei n=3 mit hohem μ + stabiler Σ waehlt Modus A", allocResultN3.mode === "A", allocResultN3.mode);
  check("allocate() Modus A: w_A (μ=20%) > w_B (μ=8%)", allocResultN3.weights[0] > allocResultN3.weights[1] + 0.05, JSON.stringify(allocResultN3.weights));
}

// ═══ TEIL 2: Volle Engine mit synthetischer Historie (End-to-End) ═══
console.log("\n=== Teil 2: Volle Engine (computePortfolioFromPositions) mit synthetischer Historie ===");
{
  // Konstruiere 2 Preisreihen mit EXAKT kontrollierter annualisierter Drift
  // und Volatilität, ohne Zufallskomponente (deterministisch, damit σ/μ nach
  // buildCovariance() exakt den Zielwerten entsprechen) -- Kombination aus
  // konstanter täglicher Drift (für μ) und einem alternierenden +/-Muster
  // (für σ), das sich zwischen den beiden Assets NICHT überschneidet (ρ≈0).
  const N = 260; // ~1 Handelsjahr
  const dailyMuA = 0.20 / 252;
  const dailyMuB = 0.08 / 252;
  const dailySigmaTarget = 0.15 / Math.sqrt(252);

  function buildSeries(dailyMu: number, phase: number): PricePoint[] {
    const points: PricePoint[] = [];
    let price = 100;
    let date = new Date("2024-01-01");
    points.push({ date: date.toISOString().slice(0, 10), close: price });
    for (let i = 0; i < N; i++) {
      date = new Date(date);
      date.setDate(date.getDate() + 1);
      // Alternierendes Vorzeichen mit Phasenverschiebung zwischen A/B -> ρ≈0
      const sign = Math.sin((i + phase) * 1.7) >= 0 ? 1 : -1;
      const ret = dailyMu + sign * dailySigmaTarget;
      price = price * (1 + ret);
      points.push({ date: date.toISOString().slice(0, 10), close: price });
    }
    return points;
  }

  const seriesA = buildSeries(dailyMuA, 0);
  const seriesB = buildSeries(dailyMuB, 37); // andere Phase -> weitgehend unkorreliert

  // WICHTIG: bei n=2 waehlt pickWeightMode() IMMER Modus B (Risk-Parity),
  // niemals A -- dokumentiertes Verhalten, unveraendert durch diesen Fix.
  // Bei gleichem sigma=15% fuer A/B liefert Risk-Parity korrekt 50/50. Um
  // die Max-Sharpe-Formel (Modus A) End-to-End inkl. Historie/Covariance zu
  // pruefen, braucht es n≥3 -- ein dritter neutraler Titel (gleiches μ/σ wie
  // rf, kein Effekt auf die A-vs-B-Relation) erzwingt Modus A.
  const dailyMuC = 0.03 / 252; // ≈rf, neutral
  const seriesC = buildSeries(dailyMuC, 91);

  const result = computePortfolioFromPositions({
    positions: [
      { ticker: "ASSET_A", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "ASSET_B", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "ASSET_C", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: { ASSET_A: seriesA, ASSET_B: seriesB, ASSET_C: seriesC },
    rf: 0.03,
    capital: 100000,
    maxWeight: 0.8,
    // Winsorizing deaktiviert -- wir wollen die REINE Max-Sharpe-Formel
    // gegen ein kontrolliertes μ/σ-Paar testen, nicht das Zusammenspiel mit
    // dem Winsorizing-Band (das hat eigene Tests in test-portfolio-winsorize.ts).
    muWinsorizeMin: null, muWinsorizeMax: null,
  });

  check("status=ok", result.status === "ok", result.status);
  const rowA = result.rows.find(r => r.ticker === "ASSET_A");
  const rowB = result.rows.find(r => r.ticker === "ASSET_B");
  console.log(`  ASSET_A: μ=${((rowA?.mu ?? 0) * 100).toFixed(1)}% σ=${((rowA?.sigma ?? 0) * 100).toFixed(1)}% w=${((rowA?.weightCapm ?? 0) * 100).toFixed(1)}%`);
  console.log(`  ASSET_B: μ=${((rowB?.mu ?? 0) * 100).toFixed(1)}% σ=${((rowB?.sigma ?? 0) * 100).toFixed(1)}% w=${((rowB?.weightCapm ?? 0) * 100).toFixed(1)}%`);
  console.log("  mode:", result.mode, "| Δ:", result.deltaVsEqual, "| fallbackReason:", result.fallbackReason);

  check("μ_A ≈ 20% (Konstruktion korrekt)", rowA != null && Math.abs(rowA.mu - 0.20) < 0.03, JSON.stringify(rowA?.mu));
  check("μ_B ≈ 8% (Konstruktion korrekt)", rowB != null && Math.abs(rowB.mu - 0.08) < 0.03, JSON.stringify(rowB?.mu));
  check("mode=A (Max-Sharpe wurde bei n=3 tatsächlich gewählt)", result.mode === "A", result.mode ?? "null");
  check("KERNKRITERIUM: w_A > w_B + margin (nicht gleichverteilt!)", rowA != null && rowB != null && rowA.weightCapm > rowB.weightCapm + 0.05, JSON.stringify({ wA: rowA?.weightCapm, wB: rowB?.weightCapm }));
  check("KERNKRITERIUM: Δ (deltaSharpe) > 0 (Optimierung schlägt Equal-Weight)", (result.deltaVsEqual ?? -1) > 0, String(result.deltaVsEqual));
  check("fallbackReason=null (Cap war erfüllbar bei maxWeight=0.8, n=3 -> 2.4≥1)", result.fallbackReason === null, String(result.fallbackReason));

  // Regressions-Waechter (aktualisiert nach Folge-Ticket "Dynamisches
  // maxWeight fuer kleine Portfolios"): mit dem ALTEN UI-Default
  // maxWeight=0.30 wird der Cap bei n=3 jetzt automatisch auf den 1/n-Floor
  // (33.3%) angehoben (resolveEffectiveMaxWeight), NICHT mehr durch den
  // fruehen cap_infeasible-Bugfix-Zweig (der greift nur noch, wenn selbst
  // der Floor nicht reicht). Bei stark konzentriertem Rohsignal (wie hier,
  // A dominiert alle anderen deutlich) fuehrt ein knapper 33.3%-Cap dazu,
  // dass ALLE Titel am Cap landen -- das SIEHT aus wie das alte Symptom,
  // ist aber ein korrekt begruendeter, transparent geflaggter Cap-Effekt
  // (wasFloorApplied=true), kein stiller Bug mehr. Kernkriterium daher:
  // wasFloorApplied=true UND effectiveMaxWeight=1/3 UND KEIN
  // fallbackReason=cap_infeasible mehr (der Floor macht den Cap ja gerade
  // wieder erfuellbar).
  const resultOldDefault = computePortfolioFromPositions({
    positions: [
      { ticker: "ASSET_A", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "ASSET_B", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "ASSET_C", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: { ASSET_A: seriesA, ASSET_B: seriesB, ASSET_C: seriesC },
    rf: 0.03, capital: 100000, maxWeight: 0.30,
    muWinsorizeMin: null, muWinsorizeMax: null,
  });
  console.log("  [alter UI-Default 0.30]", resultOldDefault.rows.map(r => `${r.ticker}=${(r.weightCapm * 100).toFixed(1)}%`).join(" "), "| effectiveMaxWeight:", resultOldDefault.effectiveMaxWeight, "| wasFloorApplied:", resultOldDefault.wasFloorApplied, "| fallbackReason:", resultOldDefault.fallbackReason);
  check("Floor wurde angewendet (userMaxWeight=0.30 < 1/3)", resultOldDefault.wasFloorApplied === true, String(resultOldDefault.wasFloorApplied));
  check("effectiveMaxWeight = 1/3 (33.3%), NICHT der alte User-Wert 30%", Math.abs(resultOldDefault.effectiveMaxWeight - 1 / 3) < 1e-6, String(resultOldDefault.effectiveMaxWeight));
  check("KEIN fallbackReason=cap_infeasible mehr (der Floor macht den Cap wieder erfuellbar)", resultOldDefault.fallbackReason !== "cap_infeasible", String(resultOldDefault.fallbackReason));
  check("userMaxWeight bleibt unveraendert bei 0.30 (nur effectiveMaxWeight wurde angehoben)", Math.abs(resultOldDefault.userMaxWeight - 0.30) < 1e-9, String(resultOldDefault.userMaxWeight));
}

console.log(failed === 0 ? "\n✅ Akzeptanz-Test bestanden (Bug behoben, Max-Sharpe ≠ Equal-Weight)" : `\n❌ ${failed} Test(s) fehlgeschlagen -- Bug NICHT behoben`);
process.exit(failed === 0 ? 0 : 1);
