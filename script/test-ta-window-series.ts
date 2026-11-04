/**
 * Gleitende Durchschnitte gehören zur vollen OHLCV-Historie.
 * Ein Preset (3M…10Y) oder ein Datumsfenster (Kurs A/B/C) darf sie nur
 * auschneiden, nicht neu auf dem sichtbaren Slice warmlaufen lassen.
 *
 * Run: npx tsx script/test-ta-window-series.ts
 */
import type { OHLCVPoint } from "../shared/schema";
import {
  buildFullSeries, buildWindowSeries, firstFiniteIndex, maCrossMarkers, sliceBars, smaSeries,
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
check("MA200 beginnt am ersten Kurs", full.points[0].ma200 === bars[0].close);
check("MA200 ab vollem Fenster ist die SMA", full.points[199].ma200 === fullMa200[199]);
{
  const cross = full.signals.find(s => s.reason.startsWith("Golden") || s.reason.startsWith("Death"));
  check("Cross erst nach vollem MA200-Fenster", cross != null && cross.date >= bars[199].date, cross?.date);
}

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
const gapFullIdx = 199;
const gapWindowIdx = gapFullIdx - 80;
check(
  "10Y ohne 200 Prefix: MA200 geht bis zum ersten sichtbaren Kurs",
  firstFiniteIndex(gapWindow.points, "ma200") === 0 && gapWindow.points[0].ma200 === gapBars.slice(0, 81).reduce((a, b) => a + b.close, 0) / 81,
);
check(
  "wo das Fenster voll ist, bleibt es die SMA",
  gapWindow.points[gapWindowIdx].ma200 === gapMa200[gapFullIdx],
);

const young = weekdayBars(150);
const youngFull = buildFullSeries(young);
const youngWindow = buildWindowSeries(youngFull, young.slice(-TA_VISIBLE_10Y_BARS));
const youngMean = young.reduce((a, b) => a + b.close, 0) / young.length;
check("kurzes Listing: MA200 ab dem ersten Kurs", youngWindow.points[0].ma200 === young[0].close);
check("kurzes Listing: letzter MA200 ist der Mittelwert aller Schlüsse", youngWindow.points[youngWindow.points.length - 1].ma200 === youngMean);

const copied = bars.slice(-126).map(b => ({ ...b }));
const fromCopies = buildWindowSeries(full, copied);
check("Kopien (Kurs-Fenster) treffen das Datum", fromCopies.points.length === 126);
check("Kopien: MA200 ab erstem Bar", firstFiniteIndex(fromCopies.points, "ma200") === 0);

const mid = sliceBars(bars, bars[400].date, bars[700].date);
const midBuilt = buildWindowSeries(full, mid);
check("Datumsfenster in der Mitte behält MA200", firstFiniteIndex(midBuilt.points, "ma200") === 0, `first=${firstFiniteIndex(midBuilt.points, "ma200")}`);
check("Datumsfenster: Wert = volle Serie", midBuilt.points[0].ma200 === full.points[400].ma200);

const head = buildWindowSeries(full, bars.slice(0, 63));
const headMean = bars.slice(0, 63).reduce((a, b) => a + b.close, 0) / 63;
check("Fenster am Serienanfang: MA200 ab dem ersten Kurs", head.points[0].ma200 === bars[0].close && head.points[62].ma200 === headMean);

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

{
  const { contiguousSameScale, nasdaqFetch, tradedSessions } = await import("../server/history-fallback");
  const fmpLate = [{ date: "2024-01-19", open: 96, high: 96, low: 96, close: 96, volume: 10, source: "fmp" as const }];
  const older = [
    { date: "2020-12-16", open: 11, high: 11, low: 11, close: 11, volume: 1, source: "nasdaq" as const },
    { date: "2020-12-17", open: 54, high: 54, low: 54, close: 54, volume: 1, source: "nasdaq" as const },
    { date: "2024-01-18", open: 97, high: 97, low: 97, close: 97, volume: 1, source: "nasdaq" as const },
  ];
  const kept = contiguousSameScale(older);
  check("Skalensprung vor der nutzbaren Serie fällt weg", kept.length === 2 && kept[0].date === "2020-12-17", kept.map(b => b.date).join(","));
  const loaded = await fetchDailyHistory({
    symbol: "KSPI",
    timeframe: "10Y",
    fetchFrom: "2015-11-01",
    fmpFetch: async () => fmpLate,
    altFetch: async () => older,
  });
  check("Nachzug beginnt auf der gleichen Kursskala, nicht am Sprung davor", loaded.bars[0]?.date === "2020-12-17" && loaded.bars.length === 3, loaded.bars.map(b => b.date).join(","));
  check("volle nutzbare Historie ist nicht unvollständig", loaded.truncated === false && loaded.source === "fmp+nasdaq");
  const ma = smaSeries(loaded.bars.map(b => b.close), 2);
  check("MA läuft auf der nachgeladenen Serie, nicht erst auf dem FMP-Anfang", ma[1] != null && loaded.bars[1].date < "2024-01-19");

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: { tradesTable: { rows: [
      { date: "12/17/2020", close: "$54.10", volume: "4,636", open: "$54.10", high: "$55", low: "$53" },
      { date: "1/19/2024", close: "$95.97", volume: "3,410,518", open: "$96", high: "$98", low: "$91" },
    ] } },
  }), { status: 200 })) as any;
  const parsed = await nasdaqFetch("KSPI", "2020-01-01", "2026-11-03");
  globalThis.fetch = realFetch;
  check("Nasdaq-Tageskurse werden als ISO-Datum gelesen", parsed.length === 2 && parsed[0].date === "2020-12-17" && parsed[0].close === 54.1 && parsed[1].volume === 3410518, JSON.stringify(parsed));
  check("Nasdaq überspringt Börsenkürzel mit Punkt", (await nasdaqFetch("SAP.DE", "2020-01-01", "2026-11-03")).length === 0);

  const carried = [
    { date: "2021-07-06", open: 99.9, high: 99.9, low: 99.9, close: 99.9, volume: 0, source: "nasdaq" as const },
    { date: "2021-07-07", open: 99.9, high: 99.9, low: 99.9, close: 99.9, volume: 0, source: "nasdaq" as const },
    { date: "2021-07-08", open: 99.9, high: 99.9, low: 99.9, close: 99.9, volume: 0, source: "nasdaq" as const },
    { date: "2021-07-09", open: 99.9, high: 101, low: 99.9, close: 99.9, volume: 1200, source: "nasdaq" as const },
    { date: "2021-07-12", open: 99.9, high: 99.9, low: 99.9, close: 99.9, volume: 0, source: "nasdaq" as const },
    { date: "2021-09-15", open: 112.5, high: 112.5, low: 112.5, close: 112.5, volume: 0, source: "nasdaq" as const },
  ];
  const sessions = tradedSessions(carried);
  check(
    "fortgeschriebene Schlusskurse ohne Umsatz sind keine Handelstage",
    sessions.length === 3 && sessions.map(b => b.date).join(",") === "2021-07-06,2021-07-09,2021-09-15",
    sessions.map(b => b.date).join(","),
  );
  const withPad = await fetchDailyHistory({
    symbol: "KSPI",
    timeframe: "10Y",
    fetchFrom: "2015-11-01",
    fmpFetch: async () => fmpLate,
    altFetch: async () => [...older, ...carried],
  });
  check(
    "nachgeladene Reihe enthält den neuen Druck, nicht die Tageswiederholungen",
    withPad.bars.some(b => b.date === "2021-09-15") && !withPad.bars.some(b => b.date === "2021-07-07"),
    withPad.bars.map(b => b.date).join(","),
  );
}

{
  const { convertVenueBars, venueBackfill, VENUE_MIN_OVERLAP_DAYS } = await import("../server/history-fallback");
  const dates = weekdayDates("2021-01-04", "2024-03-29");
  const listingStart = "2024-01-19";
  const usd = (i: number) => 60 + 40 * Math.sin(i / 40) + i * 0.02;
  const fxRate = (i: number) => 1.1 + 0.05 * Math.sin(i / 90);
  const fx = new Map(dates.map((d, i) => [d, fxRate(i)]));
  const primary = dates.map((date, i) => ({ date, i })).filter(r => r.date >= listingStart)
    .map(({ date, i }) => ({ date, open: usd(i), high: usd(i) + 1, low: usd(i) - 1, close: usd(i), volume: 1000, source: "yahoo" as const }));
  const eurBars = dates.map((date, i) => {
    const eur = usd(i) / fxRate(i);
    return { date, open: eur, high: eur * 1.01, low: eur * 0.99, close: eur, volume: 50, source: "onvista" as const };
  });
  const sparse = eurBars.filter((_, i) => i % 9 === 0);
  const wrongRatio = eurBars.map(b => ({ ...b, open: b.open * 2, high: b.high * 2, low: b.low * 2, close: b.close * 2 }));

  const daily = convertVenueBars({ venue: "Daily", currency: "EUR", bars: eurBars }, "USD", fx)!;
  check("Handelsplatz in EUR wird mit dem Tageskurs in USD umgerechnet", Math.abs(daily[100].close - usd(100)) < 1e-9);
  check("ohne FX-Reihe keine Umrechnung", convertVenueBars({ venue: "X", currency: "EUR", bars: eurBars }, "USD", null) === null);

  const pick = venueBackfill(primary, [
    { venue: "Sparse", bars: convertVenueBars({ venue: "Sparse", currency: "EUR", bars: sparse }, "USD", fx)! },
    { venue: "Daily", bars: daily },
    { venue: "Ratio", bars: convertVenueBars({ venue: "Ratio", currency: "EUR", bars: wrongRatio }, "USD", fx)! },
  ]);
  const gapDays = dates.filter(d => d < listingStart).length;
  check("täglicher Handelsplatz füllt die Lücke vor dem Listing", pick?.venue === "Daily" && pick.bars.length === gapDays, `${pick?.venue} ${pick?.bars.length}/${gapDays}`);
  check("Lückenfüllung endet vor dem ersten Tag des Listings", pick != null && pick.bars[pick.bars.length - 1].date < listingStart);
  const saturday = { ...daily[3], date: "2021-01-09" };
  const withWeekend = venueBackfill(primary, [{ venue: "OTC", bars: [...daily, saturday].sort((a, b) => a.date.localeCompare(b.date)) }]);
  check("Wochenendkurse eines OTC-Platzes sind keine Handelstage", withWeekend != null && !withWeekend.bars.some(b => b.date === "2021-01-09"));
  check("Platz mit anderem Kursverhältnis wird nicht genommen",
    venueBackfill(primary, [{ venue: "Ratio", bars: convertVenueBars({ venue: "Ratio", currency: "EUR", bars: wrongRatio }, "USD", fx)! }]) === null);
  check("ohne gemeinsame Tage keine Lückenfüllung",
    venueBackfill(primary.slice(0, VENUE_MIN_OVERLAP_DAYS - 1).map(b => ({ ...b, date: `1999-${b.date.slice(5)}` })), [{ venue: "Daily", bars: daily }]) === null);

  const loaded = await fetchDailyHistory({
    symbol: "KSPI",
    timeframe: "10Y",
    fetchFrom: "2020-11-01",
    fmpFetch: async () => primary.map(b => ({ ...b, source: "fmp" as const })),
    altFetch: async () => [...pick!.bars, ...primary],
  });
  const closes = loaded.bars.map(b => b.close);
  const ma200 = smaSeries(closes, 200);
  const ma50 = smaSeries(closes, 50);
  const startIdx = loaded.bars.findIndex(b => b.date === listingStart);
  check("Quelle zeigt den Handelsplatz", loaded.source === "fmp+onvista" && loaded.truncated === false, `${loaded.source} ${loaded.truncated}`);
  check("Lücke ist täglich gefüllt", loaded.bars.length === dates.length, `${loaded.bars.length}/${dates.length}`);
  check("MA200 am ersten Listing-Tag kommt aus der aufgefüllten Reihe", ma200[startIdx] != null && Math.abs(ma200[startIdx]! - closes.slice(startIdx - 199, startIdx + 1).reduce((a, b) => a + b, 0) / 200) < 1e-9);
  check("MA50 läuft schon in der Lücke", ma50[60] != null && loaded.bars[60].date < listingStart);
}

// Production screenshot: 5Y is the last 1260 sessions and the loaded chart
// shows 23.09.2021–30.09.2026. That span has more raw weekdays than 1260, so
// the visible slice keeps the endpoints and drops a few sessions in between.
// 220 older closes sit in front of 23.09.2021.
function weekdayDates(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const d = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (d <= end) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function barsOnDates(dates: string[], seed = 0): OHLCVPoint[] {
  return dates.map((date, i) => {
    const close = 180 + 70 * Math.sin((seed + i) / 28) + i * 0.08;
    return { date, open: close - 0.6, high: close + 1.2, low: close - 1.2, close, volume: 800_000 + (i % 9) * 1000 };
  });
}
const shotSpan = weekdayDates("2021-09-23", "2026-09-30");
const shotKeep = [0];
for (let k = 1; k < 1259; k++) shotKeep.push(Math.round(k * (shotSpan.length - 1) / 1259));
shotKeep.push(shotSpan.length - 1);
const shotVisibleDates = [...new Set(shotKeep)].sort((a, b) => a - b).map(i => shotSpan[i]);
const shotVisible = barsOnDates(shotVisibleDates);
const dayBeforeShot = new Date(`${shotVisible[0].date}T00:00:00Z`);
dayBeforeShot.setUTCDate(dayBeforeShot.getUTCDate() - 1);
const shotWarmup = weekdayBarsEnding(220, dayBeforeShot.toISOString().slice(0, 10));
const shotSeries = [...shotWarmup, ...shotVisible];
const shotCapped = shotSeries.slice(-TA_OHLCV_MAX_POINTS);
const shotFull = buildFullSeries(shotCapped);
const shotWindow = buildWindowSeries(shotFull, shotCapped.slice(-1260));
const shotFullMa200 = smaSeries(shotCapped.map(b => b.close), 200);
const shotFullMa50 = smaSeries(shotCapped.map(b => b.close), 50);
check(
  "Screenshot-5Y: Serie behält die 220 Bars vor dem ersten sichtbaren Tag",
  shotCapped.length === shotSeries.length && shotCapped[0].date === shotWarmup[0].date,
  `n=${shotCapped.length} first=${shotCapped[0]?.date}`,
);
check(
  "Screenshot-5Y: sichtbares Fenster beginnt am 23.09.2021",
  shotWindow.points[0]?.date === "2021-09-23" && shotWindow.points[shotWindow.points.length - 1]?.date === "2026-09-30",
  `from=${shotWindow.points[0]?.date} to=${shotWindow.points[shotWindow.points.length - 1]?.date}`,
);
check("Screenshot-5Y: MA200 ab Index 0", firstFiniteIndex(shotWindow.points, "ma200") === 0);
check("Screenshot-5Y: MA50 ab Index 0", firstFiniteIndex(shotWindow.points, "ma50") === 0);
check(
  "Screenshot-5Y: MA200 am linken Rand = SMA der Serie inkl. Warmup",
  shotWindow.points[0].ma200 === shotFullMa200[220] && shotWindow.points[0].ma200 != null,
  `plotted=${shotWindow.points[0].ma200} full=${shotFullMa200[220]}`,
);
check(
  "Screenshot-5Y: MA50 am linken Rand = SMA der Serie inkl. Warmup",
  shotWindow.points[0].ma50 === shotFullMa50[220] && shotWindow.points[0].ma50 != null,
);
const shotClose = shotWindow.points[0].close;
const shotMa = shotWindow.points[0].ma200!;
check(
  "Screenshot-5Y: MA200 liegt auf derselben Preisskala wie der Kurs",
  shotMa > shotClose * 0.25 && shotMa < shotClose * 4,
  `close=${shotClose} ma200=${shotMa}`,
);

const tenSeries = weekdayBarsEnding(TA_VISIBLE_10Y_BARS + TA_INDICATOR_WARMUP_BARS, "2026-09-30").slice(-TA_OHLCV_MAX_POINTS);
const tenFull = buildFullSeries(tenSeries);
const tenWindow = buildWindowSeries(tenFull, tenSeries.slice(-TA_VISIBLE_10Y_BARS));
const tenMa = smaSeries(tenSeries.map(b => b.close), 200);
check("10Y nach Cap: Warmup bleibt vor den letzten 2520 Bars", tenSeries.length - TA_VISIBLE_10Y_BARS >= 200);
check("10Y: MA200 ab Index 0", firstFiniteIndex(tenWindow.points, "ma200") === 0);
check(
  "10Y: MA200 am linken Rand = SMA der Serie inkl. Warmup",
  tenWindow.points[0].ma200 === tenMa[tenSeries.length - TA_VISIBLE_10Y_BARS],
);

const tail = weekdayBars(260);
tail[210].close = Number.NaN;
const tailSma = smaSeries(tail.map(b => b.close), 200);
const finiteTail = tail.map(b => b.close).filter(v => Number.isFinite(v));
const expectTail = finiteTail.slice(-200).reduce((a, b) => a + b, 0) / 200;
check("MA200 am letzten Kurs bleibt gesetzt, ein NaN davor löscht das Ende nicht", tailSma[tailSma.length - 1] != null && Math.abs((tailSma[tailSma.length - 1] as number) - expectTail) < 1e-6);

const crossBars = weekdayBars(220);
for (let i = 0; i < crossBars.length; i++) {
  crossBars[i].close = i < 205 ? 100 + i * 0.1 : 100 + (i - 180) * 2;
}
const crossSeries = buildFullSeries(crossBars);
const crosses = maCrossMarkers(crossSeries.points);
check("Golden Cross wird auf der Linie markiert, nicht nur als letztes Banner", crosses.some(c => c.type === "golden"));
check("MA200 der Kreuz-Serie reicht bis zum letzten Bar", crossSeries.points[crossSeries.points.length - 1].ma200 != null);

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nAlle Fenster-MA-Checks bestanden");
