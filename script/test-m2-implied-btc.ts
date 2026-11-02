/**
 * OLS des M2-impliziten BTC-Preises: bekannte Reihe → bekannte a, b, R²,
 * und n/a, wenn das Fenster zu kurz ist.
 *
 * Ausführen: npx tsx script/test-m2-implied-btc.ts
 */
import { readFileSync } from "node:fs";
import {
  M2_IMPLIED_DISCLAIMER,
  M2_IMPLIED_FORMULA,
  M2_IMPLIED_MIN_PAIRS,
  M2_IMPLIED_SOURCE,
  fitM2ImpliedBtc,
  m2ImpliedPrice,
  m2ImpliedTooltipLines,
  type M2LagPoint,
} from "../client/src/lib/m2ImpliedBtc";

let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function near(actual: number, expected: number, tol = 1e-8): boolean {
  return Math.abs(actual - expected) < tol;
}

/** Paare mit ln(M2)=x und ln(BTC)=y. */
function pairs(xs: number[], ys: number[]): M2LagPoint[] {
  return xs.map((x, i) => ({ price: Math.exp(ys[i]), m2AbsoluteLagged: Math.exp(x) }));
}

console.log("\n=== M2-impliziter BTC-Preis: OLS, exakte Gerade ===");

const perfectX = [1, 2, 3, 4, 5, 6, 7, 8];
const perfectY = perfectX.map(x => 2 + 3 * x);
const perfect = fitM2ImpliedBtc(pairs(perfectX, perfectY));
check("perfekte Reihe ist schätzbar", perfect.ok === true);
if (perfect.ok) {
  check("a = 2", near(perfect.a, 2), String(perfect.a));
  check("b = 3", near(perfect.b, 3), String(perfect.b));
  check("R² = 1", near(perfect.r2, 1), String(perfect.r2));
  check("n = 8", perfect.n === 8, String(perfect.n));
  check("Fenster ist das sichtbare", perfect.window === "visible");
  const at = m2ImpliedPrice(perfect, Math.exp(4));
  check("Modellwert = exp(a + b·ln(M2))", at != null && near(at, Math.exp(2 + 3 * 4)), String(at));
  const lines = m2ImpliedTooltipLines(perfect, at);
  check("Tooltip nennt den $-Wert", lines[0].includes("$") && lines[0].includes("M2-impliziter BTC-Preis"), lines.join(" | "));
  check("Tooltip nennt die Formel", lines.includes(M2_IMPLIED_FORMULA));
  check("Tooltip nennt a, b und R²", lines.some(line => line.includes("a = 2.0000") && line.includes("b = 3.0000") && line.includes("R² = 1.0000")), lines.join(" | "));
  check("Tooltip nennt FRED M2SL", lines.some(line => line.includes(M2_IMPLIED_SOURCE)));
  check("Tooltip sagt Modellwert, keine Prognose", lines.includes(M2_IMPLIED_DISCLAIMER));
}

console.log("\n=== M2-impliziter BTC-Preis: OLS, bekannte Residuen ===");

// y = 2 + 3x + e, e = (+1,−1) im Wechsel, x = 1..8.
// Geschlossen: a = 17/7, b = 61/21, R² = 3721/3801.
const noisyX = [1, 2, 3, 4, 5, 6, 7, 8];
const noisyE = [1, -1, 1, -1, 1, -1, 1, -1];
const noisyY = noisyX.map((x, i) => 2 + 3 * x + noisyE[i]);
const noisy = fitM2ImpliedBtc(pairs(noisyX, noisyY));
check("gestörte Reihe ist schätzbar", noisy.ok === true);
if (noisy.ok) {
  check("a = 17/7", near(noisy.a, 17 / 7), String(noisy.a));
  check("b = 61/21", near(noisy.b, 61 / 21), String(noisy.b));
  check("R² = 3721/3801", near(noisy.r2, 3721 / 3801), String(noisy.r2));
  const sample = m2ImpliedPrice(noisy, Math.exp(4));
  const expected = Math.exp(noisy.a + noisy.b * 4);
  check("Modellwert folgt exp(a + b·ln(M2))", sample != null && expected > 0 && near(sample, expected, 1e-6), String(sample));
}

console.log("\n=== M2-impliziter BTC-Preis: n/a ===");

const short = fitM2ImpliedBtc(pairs([1, 2, 3, 4, 5, 6, 7], [2, 4, 6, 8, 10, 12, 14]));
check("sieben Paare sind zu kurz", short.ok === false && short.n === M2_IMPLIED_MIN_PAIRS - 1, JSON.stringify(short));
check("n/a nennt den Grund", short.ok === false && short.reason.startsWith("n/a — Fenster zu kurz") && short.reason.includes("vorhanden: 7"), short.ok ? "" : short.reason);
check("Tooltip bei n/a ist nur der Grund", short.ok === false && m2ImpliedTooltipLines(short, 100).join("") === short.reason);

const empty = fitM2ImpliedBtc([]);
check("leeres Fenster ist n/a mit 0 Paaren", empty.ok === false && empty.n === 0 && empty.reason.includes("vorhanden: 0"));

const junk: M2LagPoint[] = [
  ...pairs([1, 2, 3, 4, 5, 6, 7], [3, 4, 5, 6, 7, 8, 9]),
  { price: 0, m2AbsoluteLagged: Math.exp(8) },
  { price: 100, m2AbsoluteLagged: 0 },
  { price: -5, m2AbsoluteLagged: 20 },
  { price: 100, m2AbsoluteLagged: null },
];
const dropped = fitM2ImpliedBtc(junk);
check("nicht positive oder fehlende Werte zählen nicht mit", dropped.ok === false && dropped.n === 7, dropped.ok ? "" : dropped.reason);

const flat = fitM2ImpliedBtc(Array.from({ length: 10 }, (_, i) => ({ price: 20_000 + i * 100, m2AbsoluteLagged: 22.5 })));
check("M2 ohne Streuung ist n/a", flat.ok === false && flat.reason.includes("ohne Streuung"), flat.ok ? "" : flat.reason);
check("ohne Fit kein Dollarwert", m2ImpliedPrice(flat, 22.5) === null);

console.log("\n=== Chart verdrahtet die Linie auf der Preisachse ===");

const dash = readFileSync(new URL("../client/src/pages/BTCDashboard.tsx", import.meta.url), "utf8");
check("OLS läuft auf filteredData (sichtbares Fenster)", dash.includes("fitM2ImpliedBtc(filteredData)"));
const lagLine = dash.slice(dash.indexOf('dataKey="m2AbsoluteLagged"') - 180, dash.indexOf('dataKey="m2AbsoluteLagged"') + 80);
check("M2-Lag-Linie bleibt auf der Billionen-Achse", lagLine.includes('yAxisId="m2absolute"') && lagLine.includes('name="M2 Lag (10W)"'), lagLine);
const impliedAt = dash.indexOf('dataKey="m2ImpliedBtc"');
const impliedLine = impliedAt >= 0 ? dash.slice(impliedAt - 220, impliedAt + 160) : "";
check("implizite Linie liegt auf der Preisachse", impliedAt >= 0 && !impliedLine.includes("yAxisId"), impliedLine);
check("Tooltip-Block ist angebunden", dash.includes("m2ImpliedTooltipLines") && dash.includes('data-testid="btc-m2-implied-tooltip"'));
check("n/a-Grund steht in der Technischen Analyse", dash.includes('data-testid="btc-m2-implied-note"'));

console.log(failed === 0 ? "\n✅ Alle M2-implizit-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
