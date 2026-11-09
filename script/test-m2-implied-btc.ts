/**
 * OLS des M2-impliziten BTC-Preises.
 * Bekannte Reihe → bekannte a, b, R². Vorwärts aufgefüllte Tage zählen nicht.
 * 1J, 10J und Max laufen auf der echten FRED-M2SL- und blockchain.info-Reihe:
 * die Schätzung geht bis zum Fensterende über die ganze Historie, gezeichnet
 * wird nur das Fenster. Keine R²-Schwelle.
 *
 * Ausführen: npx tsx script/test-m2-implied-btc.ts
 */
import { readFileSync } from "node:fs";
import { sliceBtcTaWindow, type BtcTaRange } from "../client/src/lib/btcTaWindow";
import {
  M2_IMPLIED_CLIPPED_HINT,
  M2_IMPLIED_DISCLAIMER,
  M2_IMPLIED_FORMULA,
  M2_IMPLIED_MIN_PAIRS,
  M2_IMPLIED_OUTSIDE_HINT,
  M2_IMPLIED_SOURCE,
  fitM2ImpliedBtc,
  m2ImpliedAxisHint,
  m2ImpliedAxisPlacement,
  m2ImpliedPointOutside,
  m2ImpliedPrice,
  m2ImpliedTooltipLines,
  type M2LagPoint,
} from "../client/src/lib/m2ImpliedBtc";
import {
  buildM2AbsoluteForwardFill,
  parseFredCsv,
  shiftSeriesForwardDays,
} from "../server/btc-macro";

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

/** Paare mit ln(M2)=x und ln(BTC)=y. Jeder Punkt ist ein eigener M2-Stand. */
function pairs(xs: number[], ys: number[]): M2LagPoint[] {
  return xs.map((x, i) => ({ price: Math.exp(ys[i]), m2AbsoluteLagged: Math.exp(x) }));
}

function utcDate(year: number, monthIndex: number, day: number): string {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
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
  check("Fenster ist die Historie bis zum Ende", perfect.window === "history-through-end");
  const at = m2ImpliedPrice(perfect, Math.exp(4));
  check("Modellwert = exp(a + b·ln(M2))", at != null && near(at, Math.exp(2 + 3 * 4)), String(at));
  const lines = m2ImpliedTooltipLines(perfect, at);
  check("Tooltip nennt den $-Wert", lines[0].includes("$") && lines[0].includes("M2-impliziter BTC-Preis"), lines.join(" | "));
  check("Tooltip nennt die Formel", lines.includes(M2_IMPLIED_FORMULA));
  check("Tooltip nennt a, b und R²", lines.some(line => line.includes("a = 2.0000") && line.includes("b = 3.0000") && line.includes("R² = 1.0000")), lines.join(" | "));
  check("Tooltip nennt FRED M2SL", lines.some(line => line.includes(M2_IMPLIED_SOURCE)));
  check("Tooltip sagt Modellwert, keine Prognose", lines.includes(M2_IMPLIED_DISCLAIMER));
  const outsideLines = m2ImpliedTooltipLines(perfect, at, "outside");
  check(
    "Tooltip außerhalb der Achse behält a, b und R²",
    outsideLines.some(line => line.includes("a = 2.0000") && line.includes("b = 3.0000") && line.includes("R² = 1.0000"))
      && outsideLines.includes(M2_IMPLIED_OUTSIDE_HINT),
    outsideLines.join(" | "),
  );
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

console.log("\n=== M2-impliziter BTC-Preis: nur echte Monatswerte ===");

const filledDays: M2LagPoint[] = [];
for (let month = 0; month < 3; month++) {
  for (let day = 1; day <= 10; day++) {
    filledDays.push({
      date: utcDate(2020, month, day),
      price: 20_000 + month * 1000 + day,
      m2AbsoluteLagged: 20 + month,
    });
  }
}
const filledFit = fitM2ImpliedBtc(filledDays, "2020-03-10");
check("dreißig aufgefüllte Tage sind drei Monatswerte", filledFit.n === 3, String(filledFit.n));
check("drei Monatswerte sind n/a", filledFit.ok === false && filledFit.reason.includes("vorhanden: 3") && filledFit.reason.includes("vorwärts"), filledFit.ok ? "" : filledFit.reason);

const eightMonths: M2LagPoint[] = [];
for (let month = 0; month < 8; month++) {
  for (let day = 1; day <= 10; day++) {
    eightMonths.push({
      date: utcDate(2021, month, day),
      price: Math.exp(2 + 3 * Math.log(20 + month)),
      m2AbsoluteLagged: 20 + month,
    });
  }
}
const eight = fitM2ImpliedBtc(eightMonths, "2021-08-10");
check("acht Monate mit Auffülltagen haben n = 8", eight.ok === true && eight.n === 8, eight.ok ? String(eight.n) : eight.reason);
if (eight.ok) {
  check("Auffülltage ändern a und b nicht", near(eight.a, 2) && near(eight.b, 3), `a=${eight.a} b=${eight.b}`);
}

const later = fitM2ImpliedBtc([
  ...eightMonths,
  { date: "2021-09-01", price: Math.exp(2 + 3 * Math.log(50)), m2AbsoluteLagged: 50 },
], "2021-08-10");
check("nach dem Fensterende kommt kein Paar dazu", later.ok === true && eight.ok === true && later.n === eight.n && near(later.a, eight.a) && near(later.b, eight.b), later.ok && eight.ok ? `n=${later.n}` : "n/a");

const short = fitM2ImpliedBtc(pairs([1, 2, 3, 4, 5, 6, 7], [2, 4, 6, 8, 10, 12, 14]));
check("sieben Paare sind zu kurz", short.ok === false && short.n === M2_IMPLIED_MIN_PAIRS - 1, JSON.stringify(short));
check("n/a nennt den Grund", short.ok === false && short.reason.startsWith("n/a — zu wenige echte Monatswerte") && short.reason.includes("vorhanden: 7"), short.ok ? "" : short.reason);
check("Tooltip bei n/a ist nur der Grund", short.ok === false && m2ImpliedTooltipLines(short, 100).join("") === short.reason);

const empty = fitM2ImpliedBtc([]);
check("leeres Fenster ist n/a mit 0 Paaren", empty.ok === false && empty.n === 0 && empty.reason.includes("vorhanden: 0"));
check("ohne Fensterende ist n/a", fitM2ImpliedBtc(eightMonths, null).ok === false && fitM2ImpliedBtc(eightMonths, null).n === 0);

const junk: M2LagPoint[] = [
  ...pairs([1, 2, 3, 4, 5, 6, 7], [3, 4, 5, 6, 7, 8, 9]),
  { price: 0, m2AbsoluteLagged: Math.exp(8) },
  { price: 100, m2AbsoluteLagged: 0 },
  { price: -5, m2AbsoluteLagged: 20 },
  { price: 100, m2AbsoluteLagged: null },
];
const dropped = fitM2ImpliedBtc(junk);
check("nicht positive oder fehlende Werte zählen nicht mit", dropped.ok === false && dropped.n === 7, dropped.ok ? "" : dropped.reason);

const flatDays = fitM2ImpliedBtc(Array.from({ length: 10 }, (_, i) => ({ price: 20_000 + i * 100, m2AbsoluteLagged: 22.5 })));
check("zehn gleiche Auffülltage sind ein Monatswert und damit n/a", flatDays.ok === false && flatDays.n === 1 && flatDays.reason.includes("vorhanden: 1"), flatDays.ok ? "" : flatDays.reason);

const flatMonths = fitM2ImpliedBtc(Array.from({ length: 10 }, (_, i) => ({
  date: utcDate(2022, i, 1),
  price: 20_000 + i * 100,
  m2AbsoluteLagged: 22.5,
  monthlyPrint: true as const,
})));
check("M2 ohne Streuung ist n/a", flatMonths.ok === false && flatMonths.n === 10 && flatMonths.reason.includes("ohne Streuung"), flatMonths.ok ? "" : flatMonths.reason);
check("ohne Fit kein Dollarwert", m2ImpliedPrice(flatMonths, 22.5) === null);

console.log("\n=== Preisachse schneidet die Linie ab ===");

check("alles im Band", m2ImpliedAxisPlacement([12, 18], [10, 20]) === "inside");
check("Teil außerhalb", m2ImpliedAxisPlacement([5, 15, 25], [10, 20]) === "clipped");
check("alles außerhalb", m2ImpliedAxisPlacement([1, 2], [10, 20]) === "outside");
check("Hinweis abgeschnitten", m2ImpliedAxisHint("clipped") === M2_IMPLIED_CLIPPED_HINT);
check("Hinweis außerhalb", m2ImpliedAxisHint("outside") === M2_IMPLIED_OUTSIDE_HINT);
check("im Band kein Hinweis", m2ImpliedAxisHint("inside") === null);
check("Punkt unter der Achse", m2ImpliedPointOutside(9, [10, 20]) === true);
check("Punkt in der Achse", m2ImpliedPointOutside(15, [10, 20]) === false);

console.log("\n=== 1J, 10J, Max auf echten M2SL- und BTC-Kursen ===");

const M2_LAG_DAYS = 70;
const macroSrc = readFileSync(new URL("../server/btc-macro.ts", import.meta.url), "utf8");
check("Lag bleibt 70 Tage wie in btc-macro", macroSrc.includes("const M2_LAG_DAYS = 70"));

const m2 = parseFredCsv(readFileSync(new URL("./fixtures/real10y/M2SL-2026-10-18.csv", import.meta.url), "utf8"));
const blockchain = JSON.parse(readFileSync(new URL("./fixtures/btc-liquidity/blockchain-market-price-all.json", import.meta.url), "utf8")) as {
  values: { x: number; y: number }[];
};
const prices = blockchain.values
  .map(point => ({ date: new Date(point.x * 1000).toISOString().slice(0, 10), price: point.y }))
  .filter(point => point.price > 0)
  .sort((a, b) => a.date.localeCompare(b.date));
const seriesEnd = prices[prices.length - 1].date;
const filled = buildM2AbsoluteForwardFill(m2, prices[0].date, seriesEnd);
const lagged = shiftSeriesForwardDays(filled, M2_LAG_DAYS);
const series: M2LagPoint[] = prices.map(point => ({
  date: point.date,
  price: point.price,
  m2AbsoluteLagged: lagged[point.date] ?? null,
}));

const laggedMonths = m2.map(point => {
  const date = new Date(`${point.date}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + M2_LAG_DAYS);
  return { date: date.toISOString().slice(0, 10), value: point.value / 1000 };
}).sort((a, b) => a.date.localeCompare(b.date));

function observableMonths(through: string): number {
  let n = 0;
  for (let i = 0; i < laggedMonths.length; i++) {
    const start = laggedMonths[i].date;
    if (start > through) break;
    const next = laggedMonths[i + 1]?.date ?? "9999-99-99";
    const hit = series.some(point =>
      typeof point.date === "string"
      && point.date >= start
      && point.date < next
      && point.date <= through
      && point.price > 0,
    );
    if (hit) n += 1;
  }
  return n;
}

const daysWithM2 = series.filter(point => typeof point.m2AbsoluteLagged === "number" && point.m2AbsoluteLagged > 0).length;
const ranges: BtcTaRange[] = ["1Y", "10Y", "Max"];
const fitted: { range: BtcTaRange; end: string; visibleFrom: string; model: ReturnType<typeof fitM2ImpliedBtc> }[] = [];

for (const range of ranges) {
  const window = sliceBtcTaWindow(series, range, seriesEnd);
  const end = window.visible[window.visible.length - 1]?.date ?? "";
  const model = fitM2ImpliedBtc(series, end);
  fitted.push({ range, end, visibleFrom: window.visible[0]?.date ?? "", model });
  const months = observableMonths(end);
  check(`${range} ist schätzbar`, model.ok === true, model.ok ? `n=${model.n}` : model.reason);
  check(`${range} zählt echte Monate, nicht aufgefüllte Tage`, model.n === months && months < daysWithM2, `n=${model.n} Monate=${months} Tage=${daysWithM2}`);
  if (model.ok) {
    const at = m2ImpliedPrice(model, series.find(point => point.date === end)?.m2AbsoluteLagged);
    const lines = m2ImpliedTooltipLines(model, at);
    check(
      `${range} Tooltip nennt a, b und R²`,
      lines.some(line => line.includes(`a = ${model.a.toFixed(4)}`) && line.includes(`b = ${model.b.toFixed(4)}`) && line.includes(`R² = ${model.r2.toFixed(4)}`)),
      lines.join(" | "),
    );
    check(`${range} R² liegt in [0, 1], ohne Güteschwelle`, model.r2 >= 0 && model.r2 <= 1, String(model.r2));
    console.log(`     ${range}: a=${model.a.toFixed(4)} b=${model.b.toFixed(4)} R²=${model.r2.toFixed(4)} n=${model.n} Fenster ${window.visible[0]?.date} … ${end}`);
  }
}

const fit1 = fitted.find(row => row.range === "1Y");
const fit10 = fitted.find(row => row.range === "10Y");
const fitMax = fitted.find(row => row.range === "Max");
check("1J, 10J und Max enden am selben Tag", fit1 != null && fit1.end === fit10?.end && fit1.end === fitMax?.end, `${fit1?.end} ${fit10?.end} ${fitMax?.end}`);
check(
  "dieselbe Historie bis zum Ende ergibt dieselben a, b, R²",
  fit1?.model.ok === true && fit10?.model.ok === true && fitMax?.model.ok === true
    && fit1.model.a === fit10.model.a && fit1.model.a === fitMax.model.a
    && fit1.model.b === fit10.model.b && fit1.model.b === fitMax.model.b
    && fit1.model.r2 === fit10.model.r2 && fit1.model.r2 === fitMax.model.r2
    && fit1.model.n === fitMax.model.n,
  fit1?.model.ok && fitMax?.model.ok ? `1J n=${fit1.model.n} b=${fit1.model.b} Max n=${fitMax.model.n} b=${fitMax.model.b}` : "n/a",
);
if (fit1?.model.ok) {
  check("langfristiges b ist positiv", fit1.model.b > 0, String(fit1.model.b));
}

const visible1 = sliceBtcTaWindow(series, "1Y", seriesEnd).visible;
const windowOnly = fitM2ImpliedBtc(visible1, visible1[visible1.length - 1]?.date ?? null);
check(
  "1J allein hätte weniger Paare als die Historie bis zum Fensterende",
  fit1?.model.ok === true && windowOnly.n < fit1.model.n,
  `Fenster n=${windowOnly.n} Historie n=${fit1?.model.n}`,
);
check(
  "gezeichnete Punkte sind nur das 1J-Fenster",
  fit1 != null && visible1.length > 0 && visible1.length < series.length && visible1[0].date > series[0].date && visible1[visible1.length - 1].date === fit1.end,
  `${visible1.length} von ${series.length}`,
);
if (fit1?.model.ok) {
  const drawn = visible1.map(point => m2ImpliedPrice(fit1.model, point.m2AbsoluteLagged));
  check("jeder gezeichnete Punkt nutzt die Koeffizienten der langen Historie", drawn.some(value => value != null) && drawn.length === visible1.length, String(drawn.filter(value => value != null).length));
}

const earlyEnd = laggedMonths[6]?.date;
const early = earlyEnd ? fitM2ImpliedBtc(series, earlyEnd) : fitM2ImpliedBtc([]);
check("sieben echte Monate der FRED-Reihe sind n/a", early.ok === false && early.n < M2_IMPLIED_MIN_PAIRS && early.reason.includes("vorhanden:"), early.ok ? "" : `${early.n} ${early.reason}`);

console.log("\n=== Chart verdrahtet die Linie auf der Preisachse ===");

const dash = readFileSync(new URL("../client/src/pages/BTCDashboard.tsx", import.meta.url), "utf8");
check("OLS läuft über fullChart bis zum Fensterende", dash.includes("fitM2ImpliedBtc(fullChart,"));
check("OLS läuft nicht mehr nur über filteredData", !dash.includes("fitM2ImpliedBtc(filteredData)"));
const lagLine = dash.slice(dash.indexOf('dataKey="m2AbsoluteLagged"') - 180, dash.indexOf('dataKey="m2AbsoluteLagged"') + 80);
check("M2-Lag-Linie bleibt auf der Billionen-Achse", lagLine.includes('yAxisId="m2absolute"') && lagLine.includes('name="M2 Lag (10W)"'), lagLine);
const impliedAt = dash.indexOf('dataKey="m2ImpliedBtc"');
const impliedLine = impliedAt >= 0 ? dash.slice(impliedAt - 220, impliedAt + 160) : "";
check("implizite Linie liegt auf der Preisachse", impliedAt >= 0 && !impliedLine.includes("yAxisId"), impliedLine);
check("Preisachse übernimmt den impliziten Kurs nicht", !dash.includes("d.m2ImpliedBtc < minVal") && !dash.includes("d.m2ImpliedBtc > maxVal"));
const priceAxis = dash.slice(dash.indexOf("domain={yDomain}"), dash.indexOf("domain={yDomain}") + 280);
check("Preisachse behält die Domain und schneidet die Linie ab", priceAxis.includes("allowDataOverflow"), priceAxis);
check("Tooltip-Block ist angebunden", dash.includes("m2ImpliedTooltipLines") && dash.includes('data-testid="btc-m2-implied-tooltip"'));
check("n/a-Grund steht in der Technischen Analyse", dash.includes('data-testid="btc-m2-implied-note"'));
check("Hinweis für die abgeschnittene Linie ist angebunden", dash.includes("m2ImpliedAxisHint") && dash.includes('data-testid="btc-m2-implied-offaxis"'));

console.log(failed === 0 ? "\n✅ Alle M2-implizit-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
