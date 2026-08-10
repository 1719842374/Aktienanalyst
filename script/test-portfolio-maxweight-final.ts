/**
 * Pflicht-Tests laut Ticket "maxWeight-Defaults final – CAPM darf nicht auf
 * 1/n kollabieren" (10.08.2026, zweiter Nachtrag zum Equal-Weight-Bugfix).
 *
 * Deckt die 5 explizit geforderten Testfälle ab, End-to-End über die volle
 * Engine (computePortfolioFromPositions) mit deterministischer synthetischer
 * Historie -- kein Zufall, exakte Kontrolle von μ/σ/ρ.
 *
 * Ausführen: npx tsx script/test-portfolio-maxweight-final.ts
 */
import { computePortfolioFromPositions } from "../client/src/lib/portfolio/engine";
import type { PricePoint } from "../client/src/lib/portfolio/covariance";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function buildSeries(dailyMu: number, dailySigma: number, phase: number, n = 260): PricePoint[] {
  const points: PricePoint[] = [];
  let price = 100;
  let date = new Date("2024-01-01");
  points.push({ date: date.toISOString().slice(0, 10), close: price });
  for (let i = 0; i < n; i++) {
    date = new Date(date);
    date.setDate(date.getDate() + 1);
    const sign = Math.sin((i + phase) * 1.7) >= 0 ? 1 : -1;
    price = price * (1 + dailyMu + sign * dailySigma);
    points.push({ date: date.toISOString().slice(0, 10), close: price });
  }
  return points;
}

// 3 synthetische Titel mit klar unterschiedlichem μ, gleichem σ, ~unkorreliert
// (unterschiedliche Phasen), damit Modus A eine differenzierte Loesung liefert.
const dailySigma = 0.15 / Math.sqrt(252);
const seriesHigh = buildSeries(0.25 / 252, dailySigma, 0);   // μ≈25%
const seriesMid = buildSeries(0.12 / 252, dailySigma, 37);   // μ≈12%
const seriesLow = buildSeries(0.05 / 252, dailySigma, 91);   // μ≈5%
const seriesA2 = buildSeries(0.20 / 252, dailySigma, 0);     // μ≈20% (fuer n=2-Test)
const seriesB2 = buildSeries(0.08 / 252, dailySigma, 37);    // μ≈8%

const historicalPricesByTicker3 = { HIGH: seriesHigh, MID: seriesMid, LOW: seriesLow };

// ═══ TEST 1: n=3, maxWeight=0.60 → weights ungleich, max(w)≤0.60+ε, Σw=1, ΔSharpe>0 ═══
console.log("=== Test 1: n=3, maxWeight=0.60 -> differenzierte Gewichte, Cap eingehalten ===");
{
  const result = computePortfolioFromPositions({
    positions: [
      { ticker: "HIGH", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "MID", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "LOW", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: historicalPricesByTicker3,
    rf: 0.03, capital: 100000, maxWeight: 0.60,
    muWinsorizeMin: null, muWinsorizeMax: null,
  });
  const weights = result.rows.map(r => r.weightCapm);
  console.log("  ", result.rows.map(r => `${r.ticker}=${(r.weightCapm * 100).toFixed(1)}%`).join(" "), "| mode:", result.mode, "| Δ:", result.deltaVsEqual?.toFixed(3), "| capForcesEqualWeight:", result.capForcesEqualWeight);
  check("status=ok", result.status === "ok");
  check("mode=A (Max-Sharpe gewaehlt)", result.mode === "A", result.mode ?? "null");
  check("Gewichte NICHT alle gleich (Equal-Weight-Toleranz 1%)", !weights.every(w => Math.abs(w - 1 / 3) < 0.01), JSON.stringify(weights));
  check("max(w) <= 0.60+eps (Cap eingehalten)", Math.max(...weights) <= 0.60 + 1e-6, JSON.stringify(weights));
  check("Σw = 1", Math.abs(weights.reduce((s, w) => s + w, 0) - 1) < 1e-6, String(weights.reduce((s, w) => s + w, 0)));
  check("ΔSharpe > 0 (Optimierung schlaegt Equal-Weight)", (result.deltaVsEqual ?? -1) > 0, String(result.deltaVsEqual));
  check("capForcesEqualWeight=false (60% laesst Spielraum)", result.capForcesEqualWeight === false, String(result.capForcesEqualWeight));
}

// ═══ TEST 2: n=3, maxWeight=0.30 → effective=1/3, weights≈equal, Flag sichtbar ═══
console.log("\n=== Test 2: n=3, maxWeight=0.30 -> Floor auf 1/3, capForcesEqualWeight-Flag sichtbar ===");
{
  const result = computePortfolioFromPositions({
    positions: [
      { ticker: "HIGH", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "MID", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "LOW", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: historicalPricesByTicker3,
    rf: 0.03, capital: 100000, maxWeight: 0.30,
    muWinsorizeMin: null, muWinsorizeMax: null,
  });
  console.log("  ", result.rows.map(r => `${r.ticker}=${(r.weightCapm * 100).toFixed(1)}%`).join(" "), "| effectiveMaxWeight:", (result.effectiveMaxWeight * 100).toFixed(1) + "%", "| wasFloorApplied:", result.wasFloorApplied, "| capForcesEqualWeight:", result.capForcesEqualWeight);
  check("effectiveMaxWeight = 1/3", Math.abs(result.effectiveMaxWeight - 1 / 3) < 1e-6, String(result.effectiveMaxWeight));
  check("wasFloorApplied=true (0.30 < 1/3)", result.wasFloorApplied === true);
  check("capForcesEqualWeight=true (Flag sichtbar gemeldet)", result.capForcesEqualWeight === true);
  check("Gewichte liegen nahe 1/3 (Cap dominiert die Loesung)", result.rows.every(r => Math.abs(r.weightCapm - 1 / 3) < 0.02), JSON.stringify(result.rows.map(r => r.weightCapm)));
  check("Flags enthalten Hinweis auf capForcesEqualWeight/Empfehlung", result.flags.some(f => f.includes("erzwingt Equal-Weight") || f.includes("Empfehlung")), JSON.stringify(result.flags));
}

// ═══ TEST 3: n=2, maxWeight=0.60 → max(w)≤0.60, nicht zwingend 50/50 ═══
console.log("\n=== Test 3: n=2, maxWeight=0.60 -> Cap eingehalten, nicht zwingend 50/50 ===");
{
  // WICHTIG (dokumentiertes, unveraendertes Verhalten, siehe pickWeightMode
  // Docstring in weighting.ts): bei n=2 waehlt pickWeightMode() IMMER Modus
  // B (Risk-Parity), niemals A. Bei GLEICHEM sigma fuer beide Titel liefert
  // Risk-Parity korrekt 50/50 -- UNABHAENGIG vom mu-Unterschied, weil Risk-
  // Parity nur auf sigma reagiert (w_i ∝ 1/sigma_i). Das ist kein Bug
  // dieses Tickets, sondern eine Eigenschaft von Modus B. Um "nicht
  // zwingend 50/50 wenn mu differiert" bei n=2 tatsaechlich zu zeigen,
  // muss sigma ebenfalls unterschiedlich sein (sonst ist 50/50 die
  // korrekte Risk-Parity-Antwort, kein Cap-Artefakt).
  const seriesA2HigherVol = buildSeries(0.20 / 252, dailySigma * 1.8, 0); // hoeheres sigma als B2
  const result = computePortfolioFromPositions({
    positions: [
      { ticker: "A2", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "B2", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: { A2: seriesA2HigherVol, B2: seriesB2 },
    rf: 0.03, capital: 100000, maxWeight: 0.60,
    muWinsorizeMin: null, muWinsorizeMax: null,
  });
  const weights = result.rows.map(r => r.weightCapm);
  console.log("  ", result.rows.map(r => `${r.ticker}=${(r.weightCapm * 100).toFixed(1)}%`).join(" "), "| mode:", result.mode, "(Risk-Parity, reagiert auf sigma-Unterschied)");
  check("status=ok", result.status === "ok");
  check("max(w) <= 0.60+eps", Math.max(...weights) <= 0.60 + 1e-6, JSON.stringify(weights));
  check("Gewichte differieren wenn sigma differiert (Risk-Parity: niedrigeres sigma -> hoeheres Gewicht)", Math.abs(weights[0] - weights[1]) > 0.01, JSON.stringify(weights));

  // Zusaetzlich: derselbe n=2-Cap-Test, aber mit gleichem sigma -- hier IST
  // 50/50 die korrekte, erwartete Antwort (kein Fehlschlag, sondern Beweis
  // dass Risk-Parity bei n=2 wie dokumentiert funktioniert).
  const resultEqualSigma = computePortfolioFromPositions({
    positions: [
      { ticker: "A2", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "B2", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: { A2: seriesA2, B2: seriesB2 },
    rf: 0.03, capital: 100000, maxWeight: 0.60,
    muWinsorizeMin: null, muWinsorizeMax: null,
  });
  const weightsEqualSigma = resultEqualSigma.rows.map(r => r.weightCapm);
  check("n=2, gleiches sigma -> 50/50 ist die KORREKTE Risk-Parity-Antwort (kein Cap-Artefakt)", Math.abs(weightsEqualSigma[0] - 0.5) < 0.01 && resultEqualSigma.mode === "B", JSON.stringify({ weights: weightsEqualSigma, mode: resultEqualSigma.mode }));
}

// ═══ TEST 4: n=5, maxWeight=0.30 → Cap greift klassisch, kein Titel > 30%+ε ═══
console.log("\n=== Test 4: n=5, maxWeight=0.30 -> klassischer Diversifikations-Cap greift ===");
{
  const seriesC = buildSeries(0.30 / 252, dailySigma, 150); // sehr hohes μ, wuerde ohne Cap dominieren
  const seriesD = buildSeries(0.10 / 252, dailySigma, 200);
  const seriesE = buildSeries(0.07 / 252, dailySigma, 250);
  const result = computePortfolioFromPositions({
    positions: [
      { ticker: "HIGH", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "MID", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "LOW", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "C5", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "D5", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: { ...historicalPricesByTicker3, C5: seriesC, D5: seriesD },
    rf: 0.03, capital: 100000, maxWeight: 0.30,
    muWinsorizeMin: null, muWinsorizeMax: null,
  });
  const weights = result.rows.map(r => r.weightCapm);
  console.log("  ", result.rows.map(r => `${r.ticker}=${(r.weightCapm * 100).toFixed(1)}%`).join(" "), "| capForcesEqualWeight:", result.capForcesEqualWeight);
  check("status=ok", result.status === "ok");
  check("kein Titel > 30%+eps (Cap greift klassisch bei n=5)", weights.every(w => w <= 0.30 + 1e-6), JSON.stringify(weights));
  check("capForcesEqualWeight=false (30% ist bei n=5 weit ueber dem Floor 20%)", result.capForcesEqualWeight === false, String(result.capForcesEqualWeight));
  check("wasFloorApplied=false (kein Floor-Eingriff noetig bei n=5)", result.wasFloorApplied === false, String(result.wasFloorApplied));
}

// ═══ TEST 5: Regression -- synthetisch μ_A=0.20, μ_B=0.08, σ gleich, ρ=0 -> w_A > w_B ═══
console.log("\n=== Test 5: Regression -- μ_A=0.20/μ_B=0.08, σ gleich, ρ=0 -> w_A > w_B ===");
{
  // n=2 waehlt laut pickWeightMode() immer Modus B (Risk-Parity) -- bei
  // gleichem σ liefert das 50/50, unabhaengig von μ. Fuer den geforderten
  // "w_A > w_B bei mu_A > mu_B"-Regressionstest braucht es daher n=3 (ein
  // dritter, neutraler Titel erzwingt Modus A) -- identisch zur Methodik
  // aus dem ersten Akzeptanztest (test-portfolio-maxsharpe-acceptance.ts).
  const seriesNeutral = buildSeries(0.03 / 252, dailySigma, 199); // ≈rf, neutral
  const result = computePortfolioFromPositions({
    positions: [
      { ticker: "MU_A", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "MU_B", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
      { ticker: "NEUTRAL", qty: 1, entryPrice: 100, lastPrice: 100, side: "long" },
    ],
    historicalPricesByTicker: { MU_A: seriesA2, MU_B: seriesB2, NEUTRAL: seriesNeutral },
    rf: 0.03, capital: 100000, maxWeight: 0.60, // empfohlener Default fuer n=3
    muWinsorizeMin: null, muWinsorizeMax: null,
  });
  const rowA = result.rows.find(r => r.ticker === "MU_A");
  const rowB = result.rows.find(r => r.ticker === "MU_B");
  console.log("  ", result.rows.map(r => `${r.ticker}=${(r.weightCapm * 100).toFixed(1)}%`).join(" "), "| mode:", result.mode);
  check("mode=A", result.mode === "A", result.mode ?? "null");
  check("w_A > w_B (mu_A=20% > mu_B=8%, gleiches sigma, rho=0)", rowA != null && rowB != null && rowA.weightCapm > rowB.weightCapm, JSON.stringify({ wA: rowA?.weightCapm, wB: rowB?.weightCapm }));
}

console.log(failed === 0 ? "\n✅ Alle 5 Pflicht-Testfaelle bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
