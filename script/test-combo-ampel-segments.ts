/**
 * Kombinationskurs: Ampel-Segmente (Farbwechsel) und Median/Perzentil-Bänder.
 * Ampel = bestehende TA-Ampel (technicalSignal + buySignal), keine neuen Schwellen.
 * Ausführen: npx tsx script/test-combo-ampel-segments.ts
 */
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { quantileR7 } from "../client/src/lib/robustStats";
import {
  AMPEL_COLORS,
  AMPEL_TA_PARAMS,
  BAND_PARAMS,
  ampelChangeIndices,
  ampelColorFromStatus,
  ampelWarmupFromIso,
  attachAmpel,
  evaluateAmpelOnCloses,
  rollingComboBands,
  segmentAmpelColors,
} from "../client/src/lib/comboBands";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(HERE, "../client/src/lib/comboBands.ts"), "utf8");

console.log("\n=== Konstanten, keine Magic Numbers im Rechenpfad ===");
check("AMPEL_TA_PARAMS benennt MA-Fenster der TA-Ampel", AMPEL_TA_PARAMS.maFast === 50 && AMPEL_TA_PARAMS.maSlow === 200);
check("BAND_PARAMS benennt Fenster und Perzentile", BAND_PARAMS.window === 63 && BAND_PARAMS.lo === 0.2 && BAND_PARAMS.hi === 0.8);
const evalBody = SRC.split("export function evaluateAmpelOnCloses")[1]?.split("export function")[0] ?? "";
const bandBody = SRC.split("export function rollingComboBands")[1]?.split("export function")[0] ?? "";
check("evaluateAmpelOnCloses ohne Schwellen-Literale", !/\b(50|200|10|95|0\.2|0\.8|63)\b/.test(evalBody), evalBody.slice(0, 180));
check("rollingComboBands ohne Schwellen-Literale", !/\b(63|0\.2|0\.8|0\.20|0\.80)\b/.test(bandBody), bandBody.slice(0, 180));

console.log("\n=== Farbwechsel-Punkte ===");
const colors = ["red", "red", "yellow", "green", "green", null, "green"] as const;
const segments = segmentAmpelColors([...colors]);
check(
  "Segmente rot / gelb / grün / basis / grün",
  JSON.stringify(segments.map(s => [s.color, s.fromIndex, s.toIndex])) ===
    JSON.stringify([["red", 0, 1], ["yellow", 2, 2], ["green", 3, 4], ["base", 5, 5], ["green", 6, 6]]),
  JSON.stringify(segments),
);
check("Farbwechsel-Indizes 2, 3, 5, 6", JSON.stringify(ampelChangeIndices(segments)) === "[2,3,5,6]");

console.log("\n=== Bestehende TA-Ampel, nicht neu erfunden ===");
const allFour = { priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true, macdRising: true };
check("4/4 buySignal → grün", ampelColorFromStatus(allFour) === "green");
check("2/4 → gelb (technicalSignal neutral)", ampelColorFromStatus({ priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: false, macdRising: false }) === "yellow");
check("3/4 ohne buySignal → gelb", ampelColorFromStatus({ priceAboveMA200: true, ma50AboveMA200: true, macdAboveZero: true, macdRising: false }) === "yellow");
check("1/4 → rot (technicalSignal negativ)", ampelColorFromStatus({ priceAboveMA200: true, ma50AboveMA200: false, macdAboveZero: false, macdRising: false }) === "red");
check("fehlende Indikatoren → keine Farbe", ampelColorFromStatus(null) === null);

console.log("\n=== Auswertung auf einer Schlusskursreihe ===");
const up = Array.from({ length: 280 }, (_, i) => 100 + i * 0.5);
const down = Array.from({ length: 40 }, (_, i) => up[up.length - 1] - (i + 1) * 3);
const closes = [...up, ...down];
const evaluated = evaluateAmpelOnCloses(closes);
check("vor MA200 keine Farbe (kein falsches Rot)", evaluated.slice(0, AMPEL_TA_PARAMS.maSlow - 1).every(p => p.color === null));
const defined = evaluated.filter(p => p.color != null);
check("nach Warmup gibt es Farben", defined.length > 0, `n=${defined.length}`);
const changeIdx = ampelChangeIndices(segmentAmpelColors(evaluated.map(p => p.color)));
check("mindestens ein Farbwechsel", changeIdx.length >= 1, changeIdx.join(","));
check(
  "Farbwechsel liegt auf einem echten Statuswechsel",
  changeIdx.every(i => evaluated[i].color !== evaluated[i - 1].color),
);

console.log("\n=== Bänder: rollierender Median ± P(lo/hi) ===");
const ramp = Array.from({ length: BAND_PARAMS.window + 5 }, (_, i) => i + 1);
const bands = rollingComboBands(ramp);
check("vor vollem Fenster kein Band", bands.slice(0, BAND_PARAMS.window - 1).every(b => b.median == null && b.lo == null && b.hi == null));
const last = bands[bands.length - 1];
const window = ramp.slice(-BAND_PARAMS.window);
check("Median = quantileR7 p=0.5", last.median === quantileR7(window, 0.5), String(last.median));
check("lo = P(BAND_PARAMS.lo)", last.lo === quantileR7(window, BAND_PARAMS.lo), String(last.lo));
check("hi = P(BAND_PARAMS.hi)", last.hi === quantileR7(window, BAND_PARAMS.hi), String(last.hi));
check("lo ≤ Median ≤ hi", last.lo! <= last.median! && last.median! <= last.hi!);

console.log("\n=== Toggle aus lässt die Kurswerte unangetastet ===");
const visible = [
  { date: "2024-01-02", value: 10 },
  { date: "2024-01-03", value: 12 },
  { date: "2024-01-04", value: 11 },
];
const off = attachAmpel(visible, visible, false);
check("Toggle aus: kein Badge", off.badge === false);
check("Toggle aus: keine Segmente", off.segmentMeta.length === 0);
check("Toggle aus: keine Bänder, keine Ampel-Labels", off.rows.every(r => r.bandLo == null && r.bandHi == null && r.ampelLabel == null && r.ampelColor == null));
check("Toggle aus: Werte identisch", off.rows.every((r, i) => r.date === visible[i].date && r.value === visible[i].value));

console.log("\n=== Overlay an: Segmente stoßen nahtlos, Badge nur bei Grün ===");
const source = closes.map((value, i) => ({ date: `d${String(i).padStart(4, "0")}`, value }));
const on = attachAmpel(source, source, true);
const flips = ampelChangeIndices(segmentAmpelColors(on.rows.map(r => r.ampelColor)));
check("Overlay-Farbwechsel = evaluateAmpelOnCloses", JSON.stringify(flips) === JSON.stringify(changeIdx), flips.join(","));
const seamsOk = on.segmentMeta.every((seg, s) => {
  if (s === 0) return true;
  const boundary = seg.fromIndex;
  const prev = on.segmentMeta[s - 1];
  return on.rows[boundary].segments[prev.key] === source[boundary].value
    && on.rows[boundary].segments[seg.key] === source[boundary].value;
});
check("an jedem Farbwechsel tragen beide Segmente den Kurs", seamsOk && flips.length === on.segmentMeta.length - 1);
const lastRow = on.rows[on.rows.length - 1];
check("Badge nur wenn der letzte Punkt grün ist", on.badge === (lastRow.ampelColor === "green"));
check("Grün-Hex bleibt die bestehende Ampel-Farbe", AMPEL_COLORS.green === "#22c55e" && AMPEL_COLORS.base === "#38bdf8");

console.log("\n=== Warmup-Datum vor dem sichtbaren Fenster ===");
check("365 Kalendertage vor Cutoff", ampelWarmupFromIso("2026-11-01") === "2025-11-01");

console.log(`\n${failed === 0 ? "ALLE GRÜN" : failed + " FEHLGESCHLAGEN"}`);
process.exit(failed ? 1 : 0);
