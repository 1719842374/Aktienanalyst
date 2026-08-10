/**
 * Unit-Tests für suggestedMaxWeightDefault()/resolveEffectiveMaxWeight()
 * (Folge-Ticket 10.08.2026, "Dynamisches maxWeight für kleine Portfolios").
 *
 * Ausführen: npx tsx script/test-portfolio-dynamic-maxweight.ts
 */
import { suggestedMaxWeightDefault, resolveEffectiveMaxWeight, DEFAULT_MAX_WEIGHT } from "../client/src/lib/portfolio/weighting";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// === suggestedMaxWeightDefault(n): finale Tabelle (10.08.2026, zweiter
// Nachtrag) -- 60%/60%/40%/30% statt der ersten Fassung 100%/50%/35%/30%.
// Grund: ein Cap direkt auf oder knapp ueber 1/n (z.B. 50% bei n=2 oder 35%
// bei n=4) laesst der Optimierung kaum/keinen Spielraum -- Equal-Weight
// bleibt dann faktisch der einzige/dominante zulaessige Punkt. Die Defaults
// muessen DEUTLICH ueber 1/n liegen, damit Modus A eine sichtbar
// differenzierte Struktur liefern kann. ===

check("n=1 -> 100% (kein Basket, volle Konzentration irrelevant da Kelly-only)", suggestedMaxWeightDefault(1) === 1.0);
check("n=0 -> 100% (Edge Case, kein Crash)", suggestedMaxWeightDefault(0) === 1.0);
check("n=2 -> 60% (Floor 1/2=50%, Cap lässt z.B. 60/40 statt nur 50/50 zu)", suggestedMaxWeightDefault(2) === 0.60);
check("n=3 -> 60% (Floor 1/3≈33%, Cap lässt z.B. 55/30/15 statt 33/33/33 zu)", suggestedMaxWeightDefault(3) === 0.60);
check("n=4 -> 40% (Floor 1/4=25%, deutlich mehr Spielraum als die frühere 35%-Fassung)", suggestedMaxWeightDefault(4) === 0.40);
check("n=5 -> 30% (bisheriger Diversifikations-Default)", suggestedMaxWeightDefault(5) === DEFAULT_MAX_WEIGHT);
check("n=10 -> 30% (bleibt beim Diversifikations-Default für große n)", suggestedMaxWeightDefault(10) === DEFAULT_MAX_WEIGHT);

// Kernkriterium des zweiten Nachtrags: der Default muss bei kleinem n
// DEUTLICH (nicht nur knapp) ueber 1/n liegen, sonst wiederholt sich das
// "Cap erzwingt Equal Weight"-Symptom trotz sinnvoll klingendem Default.
for (const [n, expectedMinMargin] of [[2, 0.08], [3, 0.20], [4, 0.10]] as const) {
  const suggested = suggestedMaxWeightDefault(n);
  const minFeasible = 1 / n;
  const margin = suggested - minFeasible;
  check(`n=${n}: Default-Marge ueber 1/n beträgt mind. ${(expectedMinMargin * 100).toFixed(0)}pp (tatsächlich ${(margin * 100).toFixed(1)}pp)`, margin >= expectedMinMargin - 1e-9, `suggested=${suggested}, minFeasible=${minFeasible}, margin=${margin}`);
}

// === resolveEffectiveMaxWeight(userMaxWeight, n): harter 1/n-Floor ===

// User-Wert ÜBER dem Floor -> unverändert übernommen
{
  const r = resolveEffectiveMaxWeight(0.30, 2); // 1/2=0.50, User 0.30 < 0.50 -> Floor greift
  check("n=2, userMaxWeight=0.30 (< 1/n=0.50) -> effective=0.50, wasFloorApplied=true", Math.abs(r.effectiveMaxWeight - 0.50) < 1e-9 && r.wasFloorApplied === true, JSON.stringify(r));
  check("userMaxWeight bleibt im Result unverändert dokumentiert", r.userMaxWeight === 0.30);
  check("minFeasible = 1/n = 0.50", Math.abs(r.minFeasible - 0.50) < 1e-9);
}

{
  const r = resolveEffectiveMaxWeight(0.60, 2); // User 0.60 >= 1/2=0.50 -> User-Wert bleibt
  check("n=2, userMaxWeight=0.60 (>= 1/n=0.50) -> effective=0.60 (User-Wert respektiert), wasFloorApplied=false", Math.abs(r.effectiveMaxWeight - 0.60) < 1e-9 && r.wasFloorApplied === false, JSON.stringify(r));
}

{
  // Exakter Grenzfall: userMaxWeight genau = 1/n -> kein Floor nötig
  const r = resolveEffectiveMaxWeight(1 / 3, 3);
  check("Exakter Grenzfall userMaxWeight=1/n -> wasFloorApplied=false (kein unnötiges Anheben)", r.wasFloorApplied === false, JSON.stringify(r));
}

{
  // n=3, User setzt bewusst 20% (< 1/3=33.3%) -> User-Entscheidung: Floor greift IMMER (siehe Ticket-Antwort)
  const r = resolveEffectiveMaxWeight(0.20, 3);
  check("n=3, userMaxWeight=0.20 (< 1/3) -> effective=1/3=33.3%, NICHT der User-Wert (harter Floor, keine Ausnahme)", Math.abs(r.effectiveMaxWeight - 1 / 3) < 1e-9 && r.wasFloorApplied === true, JSON.stringify(r));
}

{
  // Großes n, User-Wert deutlich über dem Floor -> unverändert
  const r = resolveEffectiveMaxWeight(0.30, 10); // 1/10=0.10, User 0.30 >> 0.10
  check("n=10, userMaxWeight=0.30 (>> 1/n=0.10) -> effective=0.30, wasFloorApplied=false", Math.abs(r.effectiveMaxWeight - 0.30) < 1e-9 && r.wasFloorApplied === false, JSON.stringify(r));
}

{
  // n=1 Edge Case -> minFeasible=1.0, jeder Cap <1.0 wird angehoben
  const r = resolveEffectiveMaxWeight(0.30, 1);
  check("n=1 -> minFeasible=1.0 (100%), jeder kleinere Cap wird auf 100% angehoben", Math.abs(r.effectiveMaxWeight - 1.0) < 1e-9 && r.wasFloorApplied === true, JSON.stringify(r));
}

// === Kombination: suggestedMaxWeightDefault gibt einen Wert, der NIE vom Floor angehoben werden muss ===
// (Sanity-Check: der Ticket-Vorschlag ist intern konsistent -- der empfohlene
// Default für n Titel liegt selbst nie unter 1/n, sonst würde sofort wieder
// der Floor greifen und den Vorschlag ad absurdum führen.)
for (const n of [1, 2, 3, 4, 5, 8, 15]) {
  const suggested = suggestedMaxWeightDefault(n);
  const minFeasible = 1 / n;
  check(`suggestedMaxWeightDefault(${n})=${suggested} >= 1/n=${minFeasible.toFixed(3)} (Vorschlag ist immer selbst erfüllbar)`, suggested >= minFeasible - 1e-9, `suggested=${suggested}, minFeasible=${minFeasible}`);
}

// === capForcesEqualWeight: erkennt "Cap nah an 1/n" unabhängig vom Floor ===

{
  // n=3, effectiveMaxWeight=1/3 exakt (Floor gegriffen) -> zwingt Equal-Weight
  const r = resolveEffectiveMaxWeight(0.30, 3);
  check("n=3, userMaxWeight=0.30 (Floor auf 1/3) -> capForcesEqualWeight=true", r.capForcesEqualWeight === true, JSON.stringify(r));
}

{
  // n=3, User setzt 34% -- knapp UEBER dem Floor (33.3%), aber immer noch
  // faktisch Equal-Weight-erzwingend (innerhalb der 2pp-Toleranz)
  const r = resolveEffectiveMaxWeight(0.34, 3);
  check("n=3, userMaxWeight=0.34 (knapp > 1/3, aber innerhalb Toleranz) -> capForcesEqualWeight=true, wasFloorApplied=false", r.capForcesEqualWeight === true && r.wasFloorApplied === false, JSON.stringify(r));
}

{
  // n=3, empfohlener Default 60% -- weit genug von 1/3 entfernt
  const r = resolveEffectiveMaxWeight(0.60, 3);
  check("n=3, userMaxWeight=0.60 (empfohlener Default) -> capForcesEqualWeight=false", r.capForcesEqualWeight === false, JSON.stringify(r));
}

{
  // n=2, empfohlener Default 60% -- Floor ist 50%, 60% liegt 10pp drueber
  const r = resolveEffectiveMaxWeight(0.60, 2);
  check("n=2, userMaxWeight=0.60 (empfohlener Default) -> capForcesEqualWeight=false", r.capForcesEqualWeight === false, JSON.stringify(r));
}

{
  // n=5, Default 30% -- Floor ist 20%, weit genug entfernt
  const r = resolveEffectiveMaxWeight(0.30, 5);
  check("n=5, userMaxWeight=0.30 (Default) -> capForcesEqualWeight=false", r.capForcesEqualWeight === false, JSON.stringify(r));
}

console.log(failed === 0 ? "\n✅ Alle Tests für dynamisches maxWeight bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
