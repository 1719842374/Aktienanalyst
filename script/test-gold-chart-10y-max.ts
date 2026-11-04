/**
 * Gold-Chart 10Y / Max: lange Historie, Indikatoren auf voller Reihe, ehrliche n/a-Overlays,
 * und /api/analyze-gold (Score/Gates) unberuehrt.
 * Ausfuehren: npx tsx script/test-gold-chart-10y-max.ts
 */
import { readFileSync } from "node:fs";
import { historyWindows, mergeGoldRows, pickLongerSource, buildGoldChartHistoryPoints, seriesCoverage, zoneSpotSeries, GOLD_ZONE_HISTORY_START, trimChartHistory } from "../server/gold-chart-history";
import { buildGoldTechnical, filterGoldRange, macroRangeState, goldRangeNote, needsLongHistory } from "../client/src/components/gold/goldTechnical";
import { slicePresetWindow } from "../client/src/lib/taRangeCutoff";

let failed = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) console.log(`  ✅ ${name}`); else { failed++; console.error(`  ❌ ${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`); }
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
function days(from: string, to: string, f: (i: number, date: string) => number, weekdaysOnly = true) {
  const out: { date: string; value: number }[] = [];
  const d = new Date(`${from}T00:00:00Z`); let i = 0;
  while (iso(d) <= to) { if (!weekdaysOnly || (d.getUTCDay() % 6 !== 0)) out.push({ date: iso(d), value: f(i++, iso(d)) }); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

console.log("\nFMP-Fenster (max. 5000 Zeilen je Abruf)");
{
  const w = historyWindows("2026-10-11", 60, 15);
  check("4 Fenster fuer 60 Jahre", w.length === 4, w.length);
  check("lueckenlos und ohne Ueberlappung", w.every((x, i) => i === 0 || Date.parse(w[i - 1].from) - Date.parse(x.to) === 864e5));
  check("letztes Fenster endet beim Limit 1966-10-11", w[w.length - 1].from === "1966-10-11", w[w.length - 1]);
  check("je Fenster <= 15 J (~3900 Handelstage < 5000)", w.every(x => (Date.parse(x.to) - Date.parse(x.from)) / 864e5 <= 15 * 366));
}

console.log("\nZeilen zusammenfuehren / Quelle waehlen");
{
  const m = mergeGoldRows([[{ date: "2020-01-03", close: 2 }, { date: "2020-01-02", close: 1 }], [{ date: "2020-01-02", close: 1 }, { date: "bad", close: 5 }, { date: "2020-01-06", close: -1 }]]);
  check("dedupliziert, sortiert, nur gueltige Closes", JSON.stringify(m.map(r => r.date)) === JSON.stringify(["2020-01-02", "2020-01-03"]));
  const fmp = [{ date: "2011-01-03", close: 1 }], yahoo = [{ date: "2000-08-30", close: 1 }];
  check("Yahoo nur wenn > 1 J frueher", pickLongerSource(fmp, yahoo).source.startsWith("Yahoo"));
  check("FMP bleibt Standard bei aehnlicher Tiefe", pickLongerSource([{ date: "2000-09-01", close: 1 }], yahoo).source === "FMP GCUSD");
  check("FMP leer -> Yahoo", pickLongerSource([], yahoo).source.startsWith("Yahoo"));
  const lateFmp = [{ date: "2017-05-18", close: 1 }];
  const yahoo2016 = [{ date: "2016-08-01", close: 1 }];
  check("FMP nach 2016 und Yahoo bis 2016 -> Yahoo, eine Quelle", pickLongerSource(lateFmp, yahoo2016).source === "Yahoo GC=F (Futures)" && pickLongerSource(lateFmp, yahoo2016).rows[0].date === "2016-08-01");
  check("FMP bis 2016 bleibt Spot, auch wenn Yahoo etwas frueher ist", pickLongerSource([{ date: "2016-06-01", close: 1 }], yahoo2016).source === "FMP GCUSD");
}

console.log("\nMiner-Zone: feste Historie, Yahoo nur als Fallback, eine Quelle");
{
  const lateFmp = [{ date: "2017-05-18", close: 1200 }, { date: "2017-05-19", close: 1201 }];
  const yahoo2016 = [{ date: "2016-08-01", close: 1300 }, { date: "2016-08-02", close: 1301 }, { date: "2026-11-02", close: 4000 }];
  const yahooZone = zoneSpotSeries(lateFmp, yahoo2016);
  check("FMP nach dem Floor -> Zone von Yahoo, nicht gemischt", yahooZone.source === "Yahoo GC=F (Futures)" && yahooZone.rows.every(r => r.close !== 1200) && yahooZone.rows[0].date === "2016-08-01");
  const longFmp = [{ date: "1975-01-02", close: 100 }, { date: "2015-12-31", close: 1060 }, { date: "2016-01-04", close: 1100 }, { date: "2016-11-29", close: 1180 }];
  const yahooEarly = [{ date: "2000-08-30", close: 270 }, { date: "2016-11-29", close: 999 }];
  const fmpZone = zoneSpotSeries(longFmp, yahooEarly);
  check("lange FMP-Reihe bleibt Spot", fmpZone.source === "FMP GCUSD");
  check("Zone beginnt am festen Start, nicht 1975 und nicht heute-10J", fmpZone.rows[0].date === "2016-01-04" && fmpZone.rows[0].date >= GOLD_ZONE_HISTORY_START && !fmpZone.rows.some(r => r.date < GOLD_ZONE_HISTORY_START));
  check("2016-11-29 bleibt in der Zone", fmpZone.rows.some(r => r.date === "2016-11-29" && r.close === 1180));
  const shortFmp = zoneSpotSeries([{ date: "2016-11-02", close: 1 }, { date: "2026-11-02", close: 2 }], []);
  check("ohne Yahoo bleibt eine kurze FMP-Reihe unverlaengert", shortFmp.rows[0].date === "2016-11-02" && shortFmp.source === "FMP GCUSD");
}

// Synthetische 26-Jahres-Historie ab 2000-08-30 (wie Yahoo GC=F live), FRED-Starts wie live.
const gold = days("2000-08-30", "2026-10-09", i => 300 + i * 0.5 + 60 * Math.sin(i / 90));
const rows = gold.map(g => ({ date: g.date, close: g.value, volume: g.date >= "2010-01-01" ? 1000 + (g.value % 97) : 0 }));
const fred = {
  real10y: days("2003-01-02", "2026-10-09", i => 1 + Math.sin(i / 200)),
  dxy: days("2006-01-02", "2026-10-09", i => 100 + Math.sin(i / 300)),
  t10yie: days("2003-01-02", "2026-10-09", i => 2 + Math.sin(i / 150) / 2),
  walcl: days("2002-12-18", "2026-10-09", i => 800000 + i * 900, false).filter((_, i) => i % 7 === 0),
  m2: Array.from({ length: 12 * 70 }, (_, i) => ({ date: `${1959 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`, value: 300 * Math.pow(1.005, i) })).filter(p => p.date <= "2026-09-01"),
};
const longPoints = buildGoldChartHistoryPoints(rows, fred);
const today = new Date("2026-10-11T12:00:00Z");

console.log("\nServer-Reihe (lang)");
{
  const cov = seriesCoverage(longPoints);
  check("Gold ab 2000-08-30", cov.close?.from === "2000-08-30", cov.close);
  check("Real10Y erst ab 2003", cov.real10y?.from === "2003-01-02", cov.real10y);
  check("DXY erst ab 2006", cov.dxy?.from === "2006-01-02", cov.dxy);
  check("M2 YoY ab erstem Gold-Tag (M2SL seit 1959)", cov.m2Yoy?.from === "2000-08-30", cov.m2Yoy);
  check("Volumen nur echte Prints (ab 2010)", (cov.volume?.from ?? "") >= "2010-01-01", cov.volume);
  check("keine DXY-Werte vor 2006 (keine falsche Linie)", longPoints.filter(p => p.date < "2006-01-01").every(p => p.dxy == null));
  const i = 250; const want = Math.round(rows.slice(i - 199, i + 1).reduce((a, r) => a + r.close, 0) / 200 * 100) / 100;
  check("MA200 wie in /api/analyze-gold", longPoints[i].ma200 === want, [longPoints[i].ma200, want]);
}

console.log("\nClient: Indikatoren auf voller Reihe, dann Fenster");
{
  const long = buildGoldTechnical(longPoints);
  const tenOnly = buildGoldTechnical(longPoints.filter(p => p.date >= "2016-10-11").map(p => ({ ...p, ma200: undefined })));
  const w10 = filterGoldRange(long.points, "10Y", today);
  check("10Y beginnt ~2016-10", w10[0].date >= "2016-10-10" && w10[0].date <= "2016-10-14", w10[0].date);
  const first = w10[0];
  check("am 10Y-Start sind MA20/50/100/200, EMA9/12/26, MACD, Signal, RSI gesetzt",
    [first.ma20, first.ma50, first.ma100, first.ma200, first.ema9, first.ema12, first.ema26, first.macd, first.signal, first.rsi14].every(v => v != null), first);
  check("ohne Vorlauf fehlten sie (Grund fuer volle Reihe)", tenOnly.points[0].ma50 == null);
  check("Max = alle Punkte", filterGoldRange(long.points, "Max", today).length === long.points.length);
  check("Cross-Marker ueber die volle Historie", long.points.filter(p => p.cross).length >= 2, long.points.filter(p => p.cross).length);
  check("10Y/Max brauchen lange Historie, 5Y nicht", needsLongHistory("10Y") && needsLongHistory("Max") && !needsLongHistory("5Y"));

  const pre2006 = filterGoldRange(long.points, "Max", today).filter(p => p.date < "2005-01-01");
  check("Overlay ohne Werte im Fenster -> n/a", macroRangeState(long.points, pre2006, "dxy") === "na");
  check("Overlay mit Werten -> on", macroRangeState(long.points, w10, "dxy") === "on");
  check("Quelle fehlt ganz -> absent", macroRangeState(long.points.map(p => ({ ...p, walcl: null })), w10.map(p => ({ ...p, walcl: null })), "walcl") === "absent");
  const labels = { real10y: "Real10Y", m2Yoy: "M2 YoY", dxy: "DXY", t10yie: "Breakeven", walcl: "WALCL" };
  const noteMax = goldRangeNote("Max", filterGoldRange(long.points, "Max", today), "Yahoo GC=F (Futures)", labels) ?? "";
  check("Max-Hinweis nennt Start, Jahre, Quelle", noteMax.startsWith("Max = ab 2000-08-30 (26,1 J, Yahoo GC=F (Futures))"), noteMax);
  check("Max-Hinweis nennt spaete Overlays", noteMax.includes("DXY ab 2006") && noteMax.includes("Real10Y ab 2003"), noteMax);
  check("Max-Hinweis nennt auch M2s Startjahr (beginnt mit Gold)", noteMax.includes("M2 YoY ab 2000"), noteMax);
  const w10note = goldRangeNote("10Y", filterGoldRange(long.points, "10Y", today), "FMP GCUSD", labels) ?? "";
  check("10Y nennt weiter nur spaete Reihen (kein M2-Rauschen)", !w10note.includes("M2 YoY"), w10note);
  const short = filterGoldRange(long.points, "10Y", today).filter(p => p.date >= "2020-01-01");
  check("10Y kuerzer -> ehrlich 'nur X J'", (goldRangeNote("10Y", short, "FMP GCUSD", labels) ?? "").startsWith("10Y: nur 6,8 J"), goldRangeNote("10Y", short, "FMP GCUSD", labels));
  check("kurze Fenster ohne Hinweis", goldRangeNote("5Y", w10, null, labels) === null);
  const t0 = Date.now(); buildGoldTechnical(longPoints); const ms = Date.now() - t0;
  check(`volle Reihe (${longPoints.length} Punkte) in < 300 ms berechnet`, ms < 300, ms);
}

console.log("\nScore/Gates unberuehrt");
{
  const src = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf-8");
  const histStart = src.indexOf("// Gold-Chart (Section 2) 10Y/Max");
  const analyze = src.slice(src.indexOf('app.get("/api/analyze-gold"'), histStart);
  check("analyze-gold-Handler nutzt keine 10Y/Max-Helfer", !/historyWindows|mergeGoldRows|pickLongerSource|buildGoldChartHistoryPoints|seriesCoverage/.test(analyze));
  check("analyze-gold bleibt bei 10 Jahren", analyze.includes("10 * 365.25 * 24 * 60 * 60 * 1000"));
  const zoneBlock = analyze.slice(analyze.indexOf("const aiscSeries"), analyze.indexOf("const analysis"));
  check("Zone liest die Chart-Historie und schneidet ab dem festen Start", zoneBlock.includes("chartHistoryGet()") && zoneBlock.includes("clipZoneSpot(hist.points)") && zoneBlock.includes("buildGoldMinerZone(zonePrices, aiscSeries)") && !zoneBlock.includes("buildGoldMinerZone(historicalPrices"));
  const scoreBlock = analyze.slice(analyze.indexOf("scoreGoldAdaptive({"), analyze.indexOf("const aiscSeries"));
  check("Score-Pfad bleibt historicalPrices und aisc null", scoreBlock.includes("closes: historicalPrices.map") && scoreBlock.includes("aisc: null") && !/zonePrices|clipZoneSpot|chartHistoryGet/.test(scoreBlock));
  // #225-Follow-up: die Chart-Route laedt jede FRED-Serie genau einmal, aber nicht blockierend (execFile statt execSync).
  const hist = src.slice(histStart);
  check("Chart-Route laedt FRED async, je Serie einmal", hist.includes("fredKeys.map(id => fetchFREDSeriesHistoryAsync(id, GOLD_HISTORY_FRED_FLOOR))") && !/fetchFREDSeriesHistory\(|execSync/.test(hist));
  check("analyze-gold behaelt das FRED-Memo (#223, seit JOB 11 mit Prefetch)", analyze.includes("createFredHistoryMemo(fredFetcher)"));
  const chart = readFileSync(new URL("../client/src/components/gold/GoldPriceChart.tsx", import.meta.url), "utf-8");
  check("Sektion 2 schneidet mit slicePresetWindow und den Presets aus TIME_RANGE_CUTOFF", chart.includes("slicePresetWindow(rangeTech.points, timeRange)") && chart.includes("Object.keys(TIME_RANGE_CUTOFF)") && chart.includes("button-gold-range-"));
  check("Chart wirft auf 10Y/Max keine Volumen-Tage weg", !chart.includes("!longRange && (d.volSpike"));
  check("Chart verdichtet die Anzeige nicht mehr auf 500 Punkte", !chart.includes("filteredData.length <= 500") && !chart.includes("ausgedünnt auf ~500"));
  check("Signaltabelle zeigt den ganzen Zeitraum", !chart.includes("visibleSignals.slice(-10)"));
  const techSrc = readFileSync(new URL("../client/src/components/gold/goldTechnical.ts", import.meta.url), "utf-8");
  check("Signalliste wird nicht auf die letzten 100 gekappt", !techSrc.includes("signals.slice(-100)"));
}

console.log("\nVolle Reihe: Signale und Volumen bleiben, Gleitende ab dem Vorlauf");
{
  const start = new Date("2010-01-04T00:00:00Z");
  const pts: { date: string; close: number; volume: number; ma200?: number }[] = [];
  for (let i = 0; i < 2600; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getUTCDay() % 6 === 0) continue;
    const close = 1500 + 120 * Math.sin(i / 5);
    pts.push({ date: iso(d), close, volume: i % 22 === 0 ? 9000 : 1000, ...(i >= 199 ? { ma200: close } : {}) });
  }
  const built = buildGoldTechnical(pts);
  check("mehr als 100 Signale bleiben auf der Reihe", built.signals.length > 100, built.signals.length);
  const firstSig = built.signals[0]?.date;
  const lastSig = built.signals[built.signals.length - 1]?.date;
  check("erstes Signal liegt in der ersten Hälfte, nicht erst am Ende", !!firstSig && firstSig < pts[Math.floor(pts.length / 2)].date, firstSig);
  check("letztes Signal liegt nach dem ersten", !!lastSig && !!firstSig && lastSig > firstSig);
  const early = built.points[250];
  check("nach 250 Tagen sind MA50, MA200, MACD und RSI gesetzt", early.ma50 != null && early.ma200 != null && early.macd != null && early.rsi14 != null, early);
  const firstSpike = built.points.find(p => p.volSpike);
  check("Volumen-Spike liegt auf der Reihe und nicht nur am Ende", !!firstSpike && firstSpike.date < pts[Math.floor(pts.length / 2)].date, firstSpike?.date);
  const maxWindow = filterGoldRange(built.points, "Max", new Date("2026-01-01T00:00:00Z"));
  check("Max behält jeden Punkt, auch frühe Volumen-Spikes", maxWindow.length === built.points.length && maxWindow.some(p => p.volSpike && p.date === firstSpike?.date));
}

console.log("\n10Y: Signallinien ab dem Fensterbeginn");
{
  const rows: { date: string; close: number; volume: number }[] = [];
  for (let d = new Date("2008-01-02T00:00:00Z"), i = 0; iso(d) <= "2026-11-04"; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() % 6 === 0) continue;
    rows.push({ date: iso(d), close: 1200 + i * 0.15 + 80 * Math.sin(i / 7), volume: 1000 });
    i++;
  }
  const points = buildGoldChartHistoryPoints(rows, { real10y: [], dxy: [], t10yie: [], walcl: [], m2: [] });
  const today = new Date("2026-11-04T12:00:00Z");
  const trimmed = trimChartHistory({ points }, "10Y", today);
  const tech = buildGoldTechnical(trimmed.points);
  const shown = slicePresetWindow(tech.points, "10Y");
  const start = shown[0].date;
  const sigs = tech.signals.filter(s => s.date >= start && shown.some(p => p.date === s.date));
  const yearLater = new Date(`${start}T00:00:00Z`);
  yearLater.setUTCFullYear(yearLater.getUTCFullYear() + 1);
  check("10Y zeigt mehr als die letzten hundert Signale", sigs.length > 100, sigs.length);
  check("erstes 10Y-Signal liegt im ersten Jahr, nicht erst Jahre später", !!sigs[0] && sigs[0].date <= iso(yearLater), { start, first: sigs[0]?.date });
  check("jedes 10Y-Signal hat einen gezeichneten Tag", sigs.every(s => shown.some(p => p.date === s.date)));
}

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll gold 10Y/Max checks passed.");
