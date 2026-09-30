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
import {
  TA_INDICATOR_WARMUP_BARS, TA_OHLCV_MAX_POINTS, TA_VISIBLE_10Y_BARS, TA_WARMUP_CALENDAR_DAYS,
  fetchDailyHistory, fromDateForTimeframe, indicatorWarmupFromDate, needsIndicatorPrefix,
} from "../server/history-fallback";

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

check("Warmup deckt MA200 (mindestens 200 Sessions)", TA_INDICATOR_WARMUP_BARS >= 200);
check("Punkt-Cap = sichtbare 10Y + Warmup + Puffer, hart begrenzt",
  TA_OHLCV_MAX_POINTS >= TA_VISIBLE_10Y_BARS + TA_INDICATOR_WARMUP_BARS && TA_OHLCV_MAX_POINTS <= 4000,
  `cap=${TA_OHLCV_MAX_POINTS}`);
check("Kalender-Warmup ist etwa ein Extra-Jahr", TA_WARMUP_CALENDAR_DAYS >= 300 && TA_WARMUP_CALENDAR_DAYS <= 400);

const fixedNow = new Date("2026-09-30T12:00:00Z");
const visibleFrom = fromDateForTimeframe("10Y", fixedNow);
const fetchFrom = indicatorWarmupFromDate(fixedNow);
const gapDays = (Date.parse(`${visibleFrom}T00:00:00Z`) - Date.parse(`${fetchFrom}T00:00:00Z`)) / 86400000;
check("Fetch startet das Warmup vor dem sichtbaren 10Y-Beginn", gapDays === TA_WARMUP_CALENDAR_DAYS, `gap=${gapDays}`);
check("80 Bars vor 10Y reichen nicht", needsIndicatorPrefix(TA_VISIBLE_10Y_BARS + 80, fetchFrom, visibleFrom));
check("voller Warmup-Prefix braucht keinen Nachzug", !needsIndicatorPrefix(TA_VISIBLE_10Y_BARS + TA_INDICATOR_WARMUP_BARS, fetchFrom, visibleFrom));
check("Serie jünger als 10Y bleibt eine Lücke", needsIndicatorPrefix(400, "2024-01-02", visibleFrom));

const bars = weekdayBars(TA_VISIBLE_10Y_BARS + TA_INDICATOR_WARMUP_BARS);
const full = buildFullSeries(bars);
const fullMa200 = smaSeries(bars.map(b => b.close), 200);

check(`volle Serie hat ${bars.length} Punkte`, full.points.length === bars.length);
check("MA200 der vollen Serie startet bei Index 199", firstFiniteIndex(full.points.map(p => ({ ...p, _volNorm: 0 })), "ma200") === 199);

for (const [label, n] of Object.entries(CUTOFFS)) {
  const windowBars = bars.slice(-n);
  const built = buildWindowSeries(full, windowBars);
  const i200 = firstFiniteIndex(built.points, "ma200");
  const i50 = firstFiniteIndex(built.points, "ma50");
  const i20 = firstFiniteIndex(built.points, "ma20");
  const iEma = firstFiniteIndex(built.points, "ema26");
  const iRsi = firstFiniteIndex(built.points, "rsi");
  const iBb = firstFiniteIndex(built.points, "bbMid");
  check(`${label}: alle ${n} Bars im Fenster`, built.points.length === n, `got ${built.points.length}`);
  check(`${label}: MA200 ab erstem sichtbaren Bar`, i200 === 0, `first=${i200}`);
  check(`${label}: MA50 ab erstem sichtbaren Bar`, i50 === 0, `first=${i50}`);
  check(`${label}: MA20 ab erstem sichtbaren Bar`, i20 === 0, `first=${i20}`);
  check(`${label}: EMA26 ab erstem sichtbaren Bar`, iEma === 0, `first=${iEma}`);
  check(`${label}: RSI ab erstem sichtbaren Bar`, iRsi === 0, `first=${iRsi}`);
  check(`${label}: BB ab erstem sichtbaren Bar`, iBb === 0, `first=${iBb}`);
  const fullIdx = bars.length - n;
  check(
    `${label}: MA200 am ersten sichtbaren Bar = SMA der Gesamt-Historie`,
    built.points[0].ma200 === fullMa200[fullIdx],
    `window=${built.points[0].ma200} full=${fullMa200[fullIdx]}`,
  );
  const windowDates = new Set(windowBars.map(b => b.date));
  const leaked = built.signals.filter(s => !windowDates.has(s.date));
  const missing = full.signals.filter(s => windowDates.has(s.date) && !built.signals.some(w => w.date === s.date && w.reason === s.reason));
  check(`${label}: Signale nur im sichtbaren Fenster`, leaked.length === 0 && missing.length === 0, `leaked=${leaked.length} missing=${missing.length}`);
}

const gapBars = weekdayBars(TA_VISIBLE_10Y_BARS + 80);
const gapFull = buildFullSeries(gapBars);
const gapMa200 = smaSeries(gapBars.map(b => b.close), 200);
const gapWindow = buildWindowSeries(gapFull, gapBars.slice(-TA_VISIBLE_10Y_BARS));
const gapFirst = Math.max(0, 199 - 80);
check(
  "10Y ohne 200 Prefix-Bars: MA200-Lücke bleibt ehrlich",
  firstFiniteIndex(gapWindow.points, "ma200") === gapFirst,
  `first=${firstFiniteIndex(gapWindow.points, "ma200")} expected=${gapFirst}`,
);
check(
  "ehrliche Lücke: erster gültiger MA200 = SMA der kurzen Serie",
  gapWindow.points[gapFirst].ma200 === gapMa200[80 + gapFirst],
);

const young = weekdayBars(150);
const youngWindow = buildWindowSeries(buildFullSeries(young), young.slice(-TA_VISIBLE_10Y_BARS));
check("Listing kürzer als 200 Sessions: MA200 fehlt komplett", firstFiniteIndex(youngWindow.points, "ma200") === -1);

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

function weekdayBarsEnding(n: number, endIso: string): OHLCVPoint[] {
  const out: OHLCVPoint[] = [];
  const d = new Date(`${endIso}T00:00:00Z`);
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) {
      const close = 80 + out.length * 0.02;
      out.push({
        date: d.toISOString().slice(0, 10),
        open: close, high: close + 0.5, low: close - 0.5, close,
        volume: 1000,
      });
    }
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out.reverse();
}

const todayIso = new Date().toISOString().slice(0, 10);
const recent = weekdayBarsEnding(TA_VISIBLE_10Y_BARS + TA_INDICATOR_WARMUP_BARS, todayIso);
const visibleOnly = recent.slice(-TA_VISIBLE_10Y_BARS);
const prefixOnly = recent.slice(0, TA_INDICATOR_WARMUP_BARS);

await fetchDailyHistory({
  symbol: "TEST",
  timeframe: "10Y",
  fetchFrom: indicatorWarmupFromDate(),
  fmpFetch: async () => visibleOnly.map((p) => ({ ...p, source: "fmp" as const })),
  altFetch: async () => prefixOnly.map((p) => ({ ...p, source: "yahoo" as const })),
}).then((loaded) => {
  const window = loaded.bars.slice(-TA_VISIBLE_10Y_BARS);
  const fullCloses = loaded.bars.map((b) => b.close);
  const ma = smaSeries(fullCloses, 200);
  check("Fallback hängt das Warmup vor die sichtbaren 10Y-Bars", loaded.bars.length === recent.length, `got ${loaded.bars.length}`);
  check("sichtbare 10Y bleiben die letzten 2520 Bars", window.length === TA_VISIBLE_10Y_BARS && window[0].date === visibleOnly[0].date);
  check("nach Warmup ist truncated für die sichtbare 10Y false", loaded.truncated === false);
  check("MA200 der ersten sichtbaren Bar ist endlich", ma[loaded.bars.length - TA_VISIBLE_10Y_BARS] != null);
});

const youngRecent = weekdayBarsEnding(150, todayIso);
await fetchDailyHistory({
  symbol: "YOUNG",
  timeframe: "10Y",
  fetchFrom: indicatorWarmupFromDate(),
  fmpFetch: async () => youngRecent.map((p) => ({ ...p, source: "fmp" as const })),
  altFetch: async () => [],
}).then((loaded) => {
  check("junges Listing: kein erfundener Prefix", loaded.bars.length === 150);
  check("junges Listing: sichtbare 10Y bleibt truncated", loaded.truncated === true);
});

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nAlle Fenster-MA-Checks bestanden");
