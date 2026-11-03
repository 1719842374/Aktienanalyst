/**
 * Symmetrische Ampel: Perzentil + Steigung, keine RSI-30/70- und keine RSL-110-Schwelle.
 * Ausführen: npx tsx script/test-symmetric-ampel.ts
 */
import { readFileSync } from "fs";
import type { StockAnalysis } from "../shared/schema";
import {
  SYMMETRIC,
  ampelFactorsFromAnalysis,
  falseBreakoutFactorOf,
  falseBreakoutSell,
  historyPercentile,
  isFalseBreakdown,
  isFalseBreakout,
  symmetricAmpelSeries,
  symmetricSignal,
  thesisFactorFromClass,
  thesisFactorFromShares,
  moatFalseBreakoutFactor,
  moatScoreFromRating,
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

console.log("\n=== False-Breakout-Faktor aus eigener Historie ===");
const rslHistory = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6];
const volHistory = [0.6, 0.8, 1.0, 1.2, 1.4];
const bearAll = {
  price: 90, ma200: 100, ma200Slope: -1,
  rslValue: 0.75, rslPercentile: 0.06, rslHistory,
  volRatio: 0.7, volHistory,
};
const bullAll = {
  price: 110, ma200: 100, ma200Slope: 1,
  rslValue: 1.55, rslPercentile: 0.94, rslHistory,
  volRatio: 0.7, volHistory,
};
const bearFactor = falseBreakoutFactorOf(bearAll);
check("Bär, alle vier: Faktor aus der Stärke, zwischen 0.75 und 1", bearFactor < 1 && bearFactor >= 1 - SYMMETRIC.falseBreakoutDampSpan, String(bearFactor));
check("NVO-Stärke 0.06 ergibt etwa 0.78", Math.abs(bearFactor - (1 - Math.min(Math.abs(0.06 - 0.5) * 2, 1) * SYMMETRIC.falseBreakoutDampSpan)) < 1e-9, String(bearFactor));
check("Bulle, alle vier: ebenfalls gedämpft", falseBreakoutFactorOf(bullAll) < 1);
check("eine Bedingung fehlt: RSL nicht mehr unter dem eigenen p40", falseBreakoutFactorOf({ ...bearAll, rslValue: 1.3 }) === 1);
check("eine Bedingung fehlt: MA200 fällt nicht", falseBreakoutFactorOf({ ...bearAll, ma200Slope: 1 }) === 1);
check("eine Bedingung fehlt: Kurs über MA200", falseBreakoutFactorOf({ ...bearAll, price: 110 }) === 1);
check("eine Bedingung fehlt: Volumen über dem eigenen Median", falseBreakoutFactorOf({ ...bearAll, volRatio: 1.3 }) === 1);
check("Bulle ohne hohes RSL: Faktor 1", falseBreakoutFactorOf({ ...bullAll, rslValue: 1.0 }) === 1);
check("False Breakout und False Breakdown erkennen dieselben Lagen", isFalseBreakout(bearAll) && isFalseBreakdown(bullAll) && !isFalseBreakdown(bearAll));
{
  const nvoShares = { "Fast Grower": 0.45, Cyclical: 0.36, Stalwart: 0.12, Turnaround: 0.04, Value: 0.03 };
  const thesis = thesisFactorFromShares(nvoShares);
  const expected = 1 + 0.45 * SYMMETRIC.thesisFastGrowerAdd + 0.36 * SYMMETRIC.thesisCyclicalAdd;
  check("NVO-Mix ergibt etwa 1.03", Math.abs(thesis.factor - expected) < 1e-9 && Math.abs(expected - 1.0315) < 1e-9, `${thesis.factor} vs ${expected}`);
  const stacked = 0.4 * bearFactor * thesis.factor * SYMMETRIC.volLowFactor;
  check("NVO-Stapel Tech × Stärke × Thesis × Volumen liegt bei etwa 0.27", Math.abs(stacked - 0.2736) < 0.005, String(stacked));
  const narrow = moatFalseBreakoutFactor(SYMMETRIC.moatNarrowScore);
  const wide = moatFalseBreakoutFactor(SYMMETRIC.moatWideScore);
  const none = moatFalseBreakoutFactor(SYMMETRIC.moatNoneScore);
  check("Narrow 2.0 ist ×0.98", Math.abs(narrow - 0.98) < 1e-9, String(narrow));
  check("Wide 4.0 ist ×1.06", Math.abs(wide - 1.06) < 1e-9, String(wide));
  check("Kein Moat 0 ist ×0.90", Math.abs(none - 0.9) < 1e-9, String(none));
  check("Rating Narrow, Wide, None", moatScoreFromRating("Narrow") === 2 && moatScoreFromRating("Wide") === 4 && moatScoreFromRating("None") === 0);
  const nvoMoat = falseBreakoutFactorOf({ ...bearAll, moatScore: SYMMETRIC.moatNarrowScore });
  check("NVO Narrow multipliziert die 0.78 mit 0.98", Math.abs(nvoMoat - bearFactor * narrow) < 1e-9, String(nvoMoat));
  const nvoAdjusted = 0.4 * nvoMoat * thesis.factor * SYMMETRIC.volLowFactor;
  check("NVO mit Narrow bleibt bei etwa 0.26", Math.abs(nvoAdjusted - stacked * narrow) < 1e-9 && Math.abs(nvoAdjusted - 0.26) < 0.01, String(nvoAdjusted));
  check("ohne False-Breakout bleibt Wide wirkungslos", falseBreakoutFactorOf({ ...bearAll, price: 110, moatScore: SYMMETRIC.moatWideScore }) === 1);
  const msftTech = 0.6;
  check("MSFT ohne Dämpfung bleibt beim technischen Score, nicht bei 0.64", msftTech * falseBreakoutFactorOf({ ...bullAll, rslValue: 1.0, moatScore: SYMMETRIC.moatWideScore }) === msftTech);
}

function regime(mode: "bounce" | "dip" | "breakdown") {
  const bars = [];
  for (let i = 0; i < 420; i++) {
    const bull = mode !== "bounce";
    const ma200 = bull ? 80 + i * 0.15 : 160 - i * 0.08;
    const late = i > 390;
    let close = bull ? ma200 * 1.06 : ma200 * 0.9;
    let volume = 1000;
    let rsi = bull ? 62 : 38;
    let histogram = bull ? 0.3 : -0.3;
    if (mode === "bounce" && late) {
      close = ma200 * (0.9 + (i - 390) * 0.002);
      rsi = 34 + (i - 390);
      histogram = -0.2;
      volume = 900;
    }
    if (mode === "dip" && late) {
      close = ma200 * 1.05;
      rsi = 61;
      histogram = 0.3;
      volume = 950;
    }
    if (mode === "breakdown" && i > 370) {
      close = ma200 * (1.02 - (i - 370) * 0.012);
      rsi = 55 - (i - 370);
      histogram = -0.4 - (i - 370) * 0.01;
      volume = 2200;
    }
    bars.push({
      date: `d${String(i).padStart(4, "0")}`,
      close,
      volume,
      rsi,
      histogram,
      ma50: mode === "breakdown" && i > 370 ? close * 1.03 : close * (bull ? 0.98 : 1.03),
      ma200,
    });
  }
  return bars;
}
{
  const bounce = symmetricAmpelSeries(regime("bounce"));
  const dip = symmetricAmpelSeries(regime("dip"));
  const breakdown = symmetricAmpelSeries(regime("breakdown"));
  console.log(`  ℹ Bären-Bounce ${bounce.last?.color} Faktor ${bounce.last?.falseBreakoutFactor} ${bounce.last?.falseBreakoutNote}`);
  console.log(`  ℹ Bullen-Dip ${dip.last?.color} Negativ-Faktor ${dip.last?.falseBreakdownFactor} ${dip.last?.falseBreakoutNote}`);
  console.log(`  ℹ Breakdown ${breakdown.last?.color} Bär ${breakdown.last?.falseBreakoutFactor} Bulle ${breakdown.last?.falseBreakdownFactor}`);
  check("Bären-Bounce bleibt unter dem Grün", bounce.last?.color !== "GRÜN", bounce.last?.summary);
  check("Bullen-Dip bleibt unter dem Grün", dip.last?.color !== "GRÜN", dip.last?.summary);
  check("Echter Einbruch mit Volumen hat Faktor 1", breakdown.last?.falseBreakoutFactor === 1 && breakdown.last?.falseBreakdownFactor === 1, breakdown.last?.falseBreakoutNote);
  check("Echter Einbruch ist nicht GRÜN", breakdown.last?.color !== "GRÜN", breakdown.last?.summary);
}
{
  const bars = [];
  for (let i = 0; i < 420; i++) {
    const ma200 = 180 - i * 0.04;
    const late = i >= 390;
    const rebound = i >= 400;
    const ratio = late ? (rebound ? 0.84 + Math.min(i - 400, 8) * 0.004 : 0.82) : 0.98;
    const close = ma200 * ratio;
    const loud = i >= 395 && i < 419;
    bars.push({
      date: `d${String(i).padStart(4, "0")}`,
      close,
      volume: i === 419 ? 500 : (loud ? 4000 : 2000),
      rsi: rebound ? 34 + Math.min(i - 400, 12) : (late ? 31 : 48),
      histogram: rebound ? -0.3 + Math.min(i - 400, 12) * 0.02 : (late ? -0.45 : 0.1),
      ma50: close * (late ? 1.03 : 0.99),
      ma200,
    });
  }
  const nvo = symmetricAmpelSeries(bars, ampelFactorsFromAnalysis({
    styleConfidences: { "Fast Grower": 0.45, Cyclical: 0.36, Stalwart: 0.12, Turnaround: 0.04, Value: 0.03 },
    moatRating: "Narrow",
  } as StockAnalysis));
  console.log(`  ℹ NVO-Lage ${nvo.last?.color} adjusted ${nvo.last?.adjusted?.toFixed(3)} p70 ${nvo.last?.p70?.toFixed(3)} Faktor ${nvo.last?.falseBreakoutFactor?.toFixed(2)} Thesis ${nvo.last?.factors.thesisFactor}`);
  check("NVO-Lage: alle vier Bedingungen, Faktor unter 1", nvo.last?.falseBreakout === true && (nvo.last?.falseBreakoutFactor ?? 1) < 1 && (nvo.last?.falseBreakoutFactor ?? 0) >= 1 - SYMMETRIC.falseBreakoutDampSpan);
  check("NVO-Lage: Thesis-Mix etwa 1.03 und Volumen ×0.85", Math.abs((nvo.last?.factors.thesisFactor ?? 0) - 1.0315) < 1e-9 && nvo.last?.volumeFactor === SYMMETRIC.volLowFactor);
  check("NVO-Lage: Narrow ×0.98 und GELB unter p70", nvo.last?.color === "GELB" && (nvo.last?.adjusted ?? 1) < (nvo.last?.p70 ?? 0) && nvo.last?.factors.moatScore === SYMMETRIC.moatNarrowScore && (nvo.last?.falseBreakoutNote.includes("×0.98") ?? false), nvo.last?.summary);
}

console.log("\n=== Dieselbe Erholung: Wide bleibt grün, Narrow wird an dem Tag gelb ===");
{
  const ampelSrc = readFileSync(new URL("../shared/symmetric-ampel.ts", import.meta.url), "utf8");
  check("keine Hysterese und keine Mindest-Dauer", !ampelSrc.includes("stabilizeAmpel") && !ampelSrc.includes("minDays"));
  const delta = 1.6;
  const bars = [];
  for (let i = 0; i < 420; i++) {
    const ma200 = 180 - i * 0.03;
    const close = ma200 * (i >= 390 ? 0.88 : 1.02);
    bars.push({
      date: `d${String(i).padStart(4, "0")}`,
      close,
      volume: i === 419 ? 2000 : (i >= 400 && i < 419 ? 2300 : 2000),
      rsi: 50 + 15 * Math.sin(i / 3) - (i === 419 ? delta : 0),
      histogram: 0.2 * Math.sin(i / 5) - (i === 419 ? delta * 0.01 : 0),
      ma50: close,
      ma200,
    });
  }
  const wide = symmetricAmpelSeries(bars, ampelFactorsFromAnalysis({ moatRating: "Wide" } as StockAnalysis));
  const narrow = symmetricAmpelSeries(bars, ampelFactorsFromAnalysis({ moatRating: "Narrow" } as StockAnalysis));
  const none = symmetricAmpelSeries(bars, ampelFactorsFromAnalysis({ moatRating: "None" } as StockAnalysis));
  const prev = bars[418].date;
  const day = bars[419].date;
  console.log(`  ℹ Wide ${wide.colors.get(prev)} → ${wide.last?.color} Faktor ${wide.last?.falseBreakoutFactor?.toFixed(2)}`);
  console.log(`  ℹ Narrow ${narrow.colors.get(prev)} → ${narrow.last?.color} Faktor ${narrow.last?.falseBreakoutFactor?.toFixed(2)}`);
  console.log(`  ℹ Kein Moat ${none.colors.get(prev)} → ${none.last?.color} Faktor ${none.last?.falseBreakoutFactor?.toFixed(2)}`);
  check("MSFT Wide: die Erholung bleibt GRÜN", wide.last?.falseBreakout === true && wide.last?.color === "GRÜN" && wide.colors.get(prev) === "GRÜN", wide.last?.summary);
  check("NVO Narrow: derselbe Tag wechselt auf GELB", narrow.last?.falseBreakout === true && narrow.last?.color === "GELB" && narrow.colors.get(prev) === "GRÜN" && narrow.colors.get(day) === "GELB", narrow.last?.summary);
  check("kein Moat: derselbe Tag ist nicht GRÜN", none.last?.color !== "GRÜN" && none.colors.get(day) !== "GRÜN", none.last?.summary);
  check("Wide dämpft weniger als Narrow und kein Moat", (wide.last?.falseBreakoutFactor ?? 0) > (narrow.last?.falseBreakoutFactor ?? 1) && (narrow.last?.falseBreakoutFactor ?? 0) > (none.last?.falseBreakoutFactor ?? 1));
}

console.log("\n=== Verkauf nach Death Cross, ohne Beta ===");
{
  const sell = {
    price: 80, ma50: 90, ma200: 100, ma50Slope: -1, rslPercentile: 0.2, moatScore: SYMMETRIC.moatNarrowScore,
  };
  check("Death Cross + Bruch + schwaches RSL + Narrow ist Verkauf", falseBreakoutSell(sell));
  check("Wide ist kein Verkauf", falseBreakoutSell({ ...sell, moatScore: SYMMETRIC.moatWideScore }) === false);
  check("Moat-Score 3 ist kein Verkauf", falseBreakoutSell({ ...sell, moatScore: SYMMETRIC.moatNotWideBelow }) === false);
  check("kein Death Cross ist kein Verkauf", falseBreakoutSell({ ...sell, ma50: 110 }) === false);
  check("steigende MA50 ist kein Verkauf", falseBreakoutSell({ ...sell, ma50Slope: 1 }) === false);
  check("Kurs über MA50 ist kein Verkauf", falseBreakoutSell({ ...sell, price: 95 }) === false);
  check("RSL auf dem p40 ist kein Verkauf", falseBreakoutSell({ ...sell, rslPercentile: SYMMETRIC.rslLowQuantile }) === false);
  check("unbekannter Moat ist kein Verkauf", falseBreakoutSell({ ...sell, moatScore: null }) === false);
  const ampelSrc = readFileSync(new URL("../shared/symmetric-ampel.ts", import.meta.url), "utf8");
  check("Beta verschiebt die RSL-Schwelle nicht", !ampelSrc.includes("betaAdj") && SYMMETRIC.rslLowQuantile === 0.4);

  const delta = 1.6;
  const bars = [];
  for (let i = 0; i < 420; i++) {
    const ma200 = 180 - i * 0.03;
    const close = ma200 * (i >= 390 ? 0.88 : 1.02);
    bars.push({
      date: `d${String(i).padStart(4, "0")}`,
      close,
      volume: i === 419 ? 2000 : (i >= 400 && i < 419 ? 2300 : 2000),
      rsi: 50 + 15 * Math.sin(i / 3) - (i === 419 ? delta : 0),
      histogram: 0.2 * Math.sin(i / 5) - (i === 419 ? delta * 0.01 : 0),
      ma50: close * 1.05,
      ma200,
    });
  }
  const narrow = symmetricAmpelSeries(bars, ampelFactorsFromAnalysis({ moatRating: "Narrow" } as StockAnalysis));
  const wide = symmetricAmpelSeries(bars, ampelFactorsFromAnalysis({ moatRating: "Wide" } as StockAnalysis));
  const bounce = bars.map((bar, i) => i < 419 ? bar : { ...bar, close: bar.ma200 * 1.04, ma50: bar.ma200 * 0.98 });
  const recovered = symmetricAmpelSeries(bounce, ampelFactorsFromAnalysis({ moatRating: "Narrow" } as StockAnalysis));
  console.log(`  ℹ Bruch Narrow ${narrow.last?.color} Verkauf ${narrow.last?.falseBreakoutSell} RSL ${narrow.last?.facts.find(f => f.name === "Kurs/MA52")?.percentile?.toFixed(2)}`);
  console.log(`  ℹ Bruch Wide ${wide.last?.color} Verkauf ${wide.last?.falseBreakoutSell}`);
  console.log(`  ℹ Erholung Narrow ${recovered.last?.color} Verkauf ${recovered.last?.falseBreakoutSell}`);
  check("Narrow nach Death Cross und Bruch ist ROT", narrow.last?.falseBreakoutSell === true && narrow.last?.color === "ROT", narrow.last?.falseBreakoutNote);
  check("Wide nach demselben Bruch ist kein Verkauf", wide.last?.falseBreakoutSell === false, wide.last?.falseBreakoutNote);
  check("Erholung über den MAs ist kein Verkauf", recovered.last?.falseBreakoutSell === false && recovered.last?.color !== "ROT", recovered.last?.summary);
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
