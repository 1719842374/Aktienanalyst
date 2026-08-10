/**
 * Unit-Tests für client/src/lib/portfolio/winsorize.ts (Folge-Ticket
 * 10.08.2026 Punkt 3: μ-Winsorizing).
 *
 * Ausführen: npx tsx script/test-portfolio-winsorize.ts
 */
import { winsorizeMu, winsorizeMuArray, DEFAULT_MU_WINSORIZE_MIN, DEFAULT_MU_WINSORIZE_MAX } from "../client/src/lib/portfolio/winsorize";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// === winsorizeMu: einzelner Wert ===

check("μ innerhalb des Bands bleibt unverändert", winsorizeMu(0.10).mu === 0.10 && !winsorizeMu(0.10).wasClipped);
check("μ über dem Max wird auf Max geclippt", winsorizeMu(0.80).mu === DEFAULT_MU_WINSORIZE_MAX && winsorizeMu(0.80).wasClipped, JSON.stringify(winsorizeMu(0.80)));
check("μ unter dem Min wird auf Min geclippt", winsorizeMu(-0.50).mu === DEFAULT_MU_WINSORIZE_MIN && winsorizeMu(-0.50).wasClipped, JSON.stringify(winsorizeMu(-0.50)));
check("μ genau am oberen Rand wird nicht als geclippt markiert", !winsorizeMu(DEFAULT_MU_WINSORIZE_MAX).wasClipped);
check("μ genau am unteren Rand wird nicht als geclippt markiert", !winsorizeMu(DEFAULT_MU_WINSORIZE_MIN).wasClipped);
check("originalMu bleibt der Rohwert, auch wenn geclippt", winsorizeMu(0.80).originalMu === 0.80);
check("NaN/Infinity -> auf 0 geclippt, als geclippt markiert (kein Crash)", (() => {
  const r1 = winsorizeMu(NaN);
  const r2 = winsorizeMu(Infinity);
  return r1.mu === 0 && r1.wasClipped && r2.mu === 0 && r2.wasClipped;
})());

// Custom Band
check("Custom Band [-0.1, 0.1] clippt 0.5 auf 0.1", winsorizeMu(0.5, -0.1, 0.1).mu === 0.1);
check("Custom Band [-0.1, 0.1] lässt 0.05 unverändert", winsorizeMu(0.05, -0.1, 0.1).mu === 0.05 && !winsorizeMu(0.05, -0.1, 0.1).wasClipped);

// === winsorizeMuArray: Array + Source-Filter ===

const muValues = [0.10, 0.80, -0.50, 0.20];
const sources: ("override" | "historical")[] = ["historical", "historical", "historical", "override"];
const arrayResult = winsorizeMuArray(muValues, sources);

check("Array-Winsorizing clippt historische Werte korrekt", arrayResult.mu[0] === 0.10 && arrayResult.mu[1] === DEFAULT_MU_WINSORIZE_MAX && arrayResult.mu[2] === DEFAULT_MU_WINSORIZE_MIN, JSON.stringify(arrayResult));
check("Array-Winsorizing lässt Override-Werte UNVERÄNDERT, auch wenn sie ausserhalb des Bands liegen", arrayResult.mu[3] === 0.20, JSON.stringify(arrayResult));
check("clippedTickerIndices enthält nur tatsächlich geclippte Indizes (0-basiert)", JSON.stringify(arrayResult.clippedTickerIndices.sort()) === JSON.stringify([1, 2]), JSON.stringify(arrayResult.clippedTickerIndices));

// Override mit extremem Wert außerhalb des Bands wird NIE geclippt (auch bei extremen Werten)
const extremeOverrideResult = winsorizeMuArray([2.0], ["override"]);
check("Extremer Override (200% p.a.) bleibt komplett unangetastet", extremeOverrideResult.mu[0] === 2.0 && extremeOverrideResult.clippedTickerIndices.length === 0, JSON.stringify(extremeOverrideResult));

// Alle historisch, keiner außerhalb des Bands -> keine Clips
const noClipResult = winsorizeMuArray([0.05, 0.10, 0.15], ["historical", "historical", "historical"]);
check("Keine Clips wenn alle μ innerhalb des Default-Bands liegen", noClipResult.clippedTickerIndices.length === 0, JSON.stringify(noClipResult));

console.log(failed === 0 ? `\n✅ Alle Winsorizing-Tests bestanden (13 Checks)` : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
