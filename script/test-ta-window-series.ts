/**
 * Gleitende Durchschnitte gehören zur vollen OHLCV-Historie.
 * Ein Preset (3M…10Y) oder ein Datumsfenster (Kurs A/B/C) darf sie nur
 * auschneiden, nicht neu auf dem sichtbaren Slice warmlaufen lassen.
 *
 * Run: npx tsx script/test-ta-window-series.ts
 */
import type { OHLCVPoint } from "../shared/schema";
import {
  buildFullSeries, buildWindowSeries, firstFiniteIndex, sliceBars, smaSeries,
} from "../client/src/lib/taWindowSeries";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function weekdayBars(n: number): OHLCVPoint[] {
  const out: OHLCVPoint[] = [];
  const d = new Date("2016-09-30T00:00:00Z");
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      const i = out.length;
      const close = 100 + 30 * Math.sin(i / 18) + i * 0.05;
      out.push({
        date: d.toISOString().slice(0, 10),
        open: close - 0.4,
        high: close + 0.8,
        low: close - 0.8,
        close,
        volume: 1_000_000 + (i % 7) * 1000,
      });
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const CUTOFFS = { "3M": 63, "6M": 126, "1Y": 252, "2Y": 504, "3Y": 756, "5Y": 1260, "10Y": 2520 } as const;
const bars = weekdayBars(2600);
const full = buildFullSeries(bars);
const fullMa200 = smaSeries(bars.map(b => b.close), 200);

check("volle Serie hat 2600 Punkte", full.points.length === 2600);
check("MA200 der vollen Serie startet bei Index 199", firstFiniteIndex(full.points.map(p => ({ ...p, _volNorm: 0 })), "ma200") === 199);

for (const [label, n] of Object.entries(CUTOFFS)) {
  const windowBars = bars.slice(-n);
  const built = buildWindowSeries(full, windowBars);
  const i200 = firstFiniteIndex(built.points, "ma200");
  const i50 = firstFiniteIndex(built.points, "ma50");
  const i20 = firstFiniteIndex(built.points, "ma20");
  const iEma = firstFiniteIndex(built.points, "ema26");
  check(`${label}: alle ${n} Bars im Fenster`, built.points.length === n, `got ${built.points.length}`);
  check(`${label}: MA50 ab erstem sichtbaren Bar`, i50 === 0, `first=${i50}`);
  check(`${label}: MA20 ab erstem sichtbaren Bar`, i20 === 0, `first=${i20}`);
  check(`${label}: EMA26 ab erstem sichtbaren Bar`, iEma === 0, `first=${iEma}`);
  const fullIdx = bars.length - n;
  const expectedFirst = Math.max(0, 199 - fullIdx);
  check(
    `${label}: MA200-Start = Warmup der Gesamt-Historie (${expectedFirst}), nicht des Fensters`,
    i200 === expectedFirst,
    `first=${i200} expected=${expectedFirst}`,
  );
  const expected = fullMa200[fullIdx + expectedFirst];
  check(
    `${label}: MA200 am ersten gültigen Bar = SMA der Gesamt-Historie`,
    built.points[expectedFirst].ma200 === expected,
    `window=${built.points[expectedFirst].ma200} full=${expected}`,
  );
}

const copied = bars.slice(-126).map(b => ({ ...b }));
const fromCopies = buildWindowSeries(full, copied);
check("Kopien (Kurs-Fenster) treffen das Datum", fromCopies.points.length === 126);
check("Kopien: MA200 ab erstem Bar", firstFiniteIndex(fromCopies.points, "ma200") === 0);

const mid = sliceBars(bars, bars[400].date, bars[700].date);
const midBuilt = buildWindowSeries(full, mid);
check("Datumsfenster in der Mitte behält MA200", firstFiniteIndex(midBuilt.points, "ma200") === 0, `first=${firstFiniteIndex(midBuilt.points, "ma200")}`);
check("Datumsfenster: Wert = volle Serie", midBuilt.points[0].ma200 === full.points[400].ma200);

const head = buildWindowSeries(full, bars.slice(0, 63));
check("Fenster am Serienanfang: MA200 fehlt ehrlich (keine 200 Tage davor)", firstFiniteIndex(head.points, "ma200") === -1);

const reversed = buildFullSeries([...bars].reverse());
const revWindow = buildWindowSeries(reversed, bars.slice(-63));
check("ungeordnete Historie: 3M-MA200 trotzdem ab Bar 0", firstFiniteIndex(revWindow.points, "ma200") === 0);

const earlyCross = full.signals.find(s => s.reason.startsWith("Golden") || s.reason.startsWith("Death"));
if (earlyCross) {
  const around = sliceBars(bars, earlyCross.date, bars[bars.length - 1].date).slice(0, 5);
  const sigWindow = buildWindowSeries(full, around.length ? sliceBars(bars, earlyCross.date, bars[Math.min(bars.length - 1, bars.findIndex(b => b.date === earlyCross.date) + 40)].date) : []);
  check("Signal aus der vollen Serie bleibt im Datumsfenster", sigWindow.signals.some(s => s.date === earlyCross.date && s.reason === earlyCross.reason));
} else {
  check("Synthese erzeugt mindestens ein Cross", false);
}

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nAlle Fenster-MA-Checks bestanden");
