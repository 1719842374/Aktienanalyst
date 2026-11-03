/**
 * Symmetrische Ampel: Perzentil + Steigung, keine RSI-30/70- und keine RSL-110-Schwelle.
 * Ausführen: npx tsx script/test-symmetric-ampel.ts
 */
import { readFileSync } from "fs";
import type { StockAnalysis } from "../shared/schema";
import {
  SYMMETRIC,
  ampelFactorsFromAnalysis,
  historyPercentile,
  symmetricAmpelSeries,
  symmetricSignal,
  thesisFactorFromClass,
  volumeFactor,
} from "../shared/symmetric-ampel";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== Symmetrie, keine absoluten Pegel ===");
{
  const hist = Array.from({ length: 100 }, (_, i) => i);
  const highDown = symmetricSignal(95, hist, -1);
  const lowUp = symmetricSignal(5, hist, 1);
  const highUp = symmetricSignal(95, hist, 1);
  const lowDown = symmetricSignal(5, hist, -1);
  check("extrem hoch + fallend ist negativ", highDown != null && highDown < -0.7, String(highDown));
  check("extrem niedrig + steigend ist positiv", lowUp != null && lowUp > 0.7, String(lowUp));
  check("dieselben Lagen, umgekehrte Steigung, umgekehrtes Vorzeichen", highUp != null && lowDown != null && highUp > 0 && lowDown < 0);
  check("Betrag hängt nicht vom Vorzeichen ab", highDown != null && highUp != null && Math.abs(highDown) === Math.abs(highUp));
  check("flache Steigung ist 0", symmetricSignal(50, hist, 0) === 0);
  check("leere Historie bleibt leer", symmetricSignal(50, [], 1) === null);

  const calm = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85];
  const depressed = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28];
  const calmPct = historyPercentile(calm, 35);
  const depressedPct = historyPercentile(depressed, 35);
  check("RSI 35 ist in einer hohen Historie niedrig", calmPct != null && calmPct < 0.5, String(calmPct));
  check("RSI 35 ist in einer niedrigen Historie hoch", depressedPct != null && depressedPct > 0.9, String(depressedPct));
  check("dieselbe 35, andere Historie, anderes Signal", symmetricSignal(35, calm, 1)! > 0 && symmetricSignal(35, depressed, -1)! < 0);
}

console.log("\n=== Faktoren aus der kompakten Formel ===");
check("Volumen über 1.5× verstärkt", volumeFactor(1.6).factor === SYMMETRIC.volHighFactor);
check("Volumen unter 0.8× dämpft", volumeFactor(0.5).factor === SYMMETRIC.volLowFactor);
check("Volumen dazwischen ist 1", volumeFactor(1.1).factor === 1);
check("Volumen fehlt ist 1", volumeFactor(null).factor === 1);
check("Fast Grower +0.15", thesisFactorFromClass("fast_grower").factor === 1 + SYMMETRIC.thesisFastGrowerAdd);
check("Cyclical −0.10", thesisFactorFromClass("cyclical").factor === 1 + SYMMETRIC.thesisCyclicalAdd);
check("ohne Klasse Faktor 1", thesisFactorFromClass(null).factor === 1);
check("Fenstergrenzen 20 und 60", SYMMETRIC.baseWindow === 20 && SYMMETRIC.maxWindow === 60);
check("Schwellen sind p30 und p70", SYMMETRIC.lowQuantile === 0.3 && SYMMETRIC.highQuantile === 0.7);
check("RSL-Fenster ist MA52, nicht 110", SYMMETRIC.ma52Days === 252);

console.log("\n=== Serie: Abverkauf ist nicht grün, Erholung nicht rot erzwungen ===");
function path(mode: "crash" | "recover") {
  const bars = [];
  for (let i = 0; i < 420; i++) {
    const up = 80 + i * 0.25;
    const close = mode === "crash"
      ? (i < 360 ? up : up - (i - 360) * 1.4)
      : (i < 300 ? 120 - i * 0.05 : 105 + (i - 300) * 0.8);
    const rising = mode === "recover" ? i > 300 : i < 360;
    bars.push({
      date: `d${String(i).padStart(4, "0")}`,
      close,
      volume: rising ? 2000 : 800,
      rsi: rising ? 58 : 32,
      histogram: rising ? 0.4 : -0.5,
      ma50: rising ? close * 0.97 : close * 1.04,
      ma200: rising ? close * 0.9 : close * 1.08,
    });
  }
  return bars;
}
{
  const crash = symmetricAmpelSeries(path("crash"), ampelFactorsFromAnalysis({ lynchClass: "cyclical" } as StockAnalysis));
  const recover = symmetricAmpelSeries(path("recover"), ampelFactorsFromAnalysis({ lynchClass: "fast_grower" } as StockAnalysis));
  console.log(`  ℹ Abverkauf ${crash.last?.color} ${crash.last?.meaning} adjusted ${crash.last?.adjusted?.toFixed(3)}`);
  console.log(`  ℹ Erholung ${recover.last?.color} ${recover.last?.meaning} adjusted ${recover.last?.adjusted?.toFixed(3)}`);
  check("Abverkauf hat eine Farbe", crash.last?.color != null);
  check("Abverkauf ist nicht GRÜN", crash.last?.color !== "GRÜN", crash.last?.summary);
  check("Erholung hat eine Farbe", recover.last?.color != null);
  check("Erholung ist nicht ROT", recover.last?.color !== "ROT", recover.last?.summary);
  check("Cyclical dämpft, Fast Grower hebt", (crash.last?.factors.thesisFactor ?? 1) < 1 && (recover.last?.factors.thesisFactor ?? 1) > 1);
  check("Bilanz ohne Historie bleibt Faktor 1", crash.last?.factors.bsFactor === 1 && (crash.last?.factors.bsNote.includes("Faktor 1") ?? false));
  check("Beta ohne Historie bleibt Faktor 1", crash.last?.factors.betaFactor === 1);
  const colored = [...crash.colors.values()].filter(c => c != null);
  check("die Linie wechselt oder hält eine Farbe über viele Tage", colored.length > 30, String(colored.length));
}

console.log("\n=== Chart bleibt bei den MA-Namen und ohne Kaufsignal-Text ===");
{
  const ui = readFileSync(new URL("../client/src/components/sections/TechnicalChart.tsx", import.meta.url), "utf8");
  check("symmetrische Serie ist angeschlossen", ui.includes("symmetricAmpelSeries"));
  check("Faktenzeile ist sichtbar", ui.includes('data-testid="symmetric-ampel-facts"'));
  check("kein Starkes Kaufsignal", !ui.includes("Starkes Kaufsignal"));
  check("MA200 MA100 MA50 MA20 bleiben", ["MA200 (SMA)", "MA100 (SMA)", "MA50 (SMA)", "MA20 (SMA)"].every(s => ui.includes(s)));
  check("Kopf mit 3/4 Bedingungen bleibt", ui.includes("3 / 4 Bedingungen – fast kaufbereit"));
}

console.log(failed === 0 ? "\n✅ Symmetrische Ampel grün" : `\n❌ ${failed} fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
