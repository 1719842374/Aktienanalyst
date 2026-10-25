/**
 * F10-08/12/13 (Future_10): Volumen-Trend, Bollinger(20,2), ATR(14) im Gold-Chart.
 * Reine Anzeige — prueft Rechnung, n/a-Verhalten und dass der Score-Input unveraendert bleibt.
 */
import fs from "fs";
import { buildGoldTechnical, calcAtr } from "../client/src/components/gold/goldTechnical";
import { buildFullSeries } from "../client/src/lib/taWindowSeries";
import type { GoldPricePoint } from "../shared/gold-schema";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, info?: unknown) => { if (cond) pass++; else { fail++; console.error("FAIL", name, info ?? ""); } };
const close = (a: number | null | undefined, b: number, eps = 1e-9) => a != null && Math.abs(a - b) < eps;

const day = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const base: GoldPricePoint[] = Array.from({ length: 80 }, (_, i) => ({ date: day(i), close: 2000 + i * 2 + (i % 5) * 3 }));

// F10-12: BB identisch zur Aktien-S12-Rechnung (taWindowSeries.buildFullSeries).
const t = buildGoldTechnical(base);
const stock = buildFullSeries(base.map(p => ({ date: p.date, open: p.close, high: p.close, low: p.close, close: p.close, volume: 0 })) as any).points;
ok("BB vor 20 Punkten leer", t.points[18].bbUpper === undefined);
ok("BB = S12 (upper/mid/lower, alle Punkte)", t.points.every((p, i) => p.bbUpper === stock[i].bbUpper && p.bbMid === stock[i].bbMid && p.bbLower === stock[i].bbLower));

// F10-13: ATR n/a ohne High/Low.
ok("ATR ohne High/Low = null", t.points.every(p => p.atr14 == null) && t.currentAtr == null);
// ATR Wilder: konstante Range 10 -> ATR 10.
const hl = base.map(p => ({ ...p, high: p.close + 5, low: p.close - 5 }));
const atr = calcAtr(hl);
ok("ATR erster Wert nach 14 TR (Index 14)", atr[13] == null && atr[14] != null, atr.slice(12, 16));
const trs = hl.slice(1).map((p, i) => Math.max(p.high - p.low, Math.abs(p.high - hl[i].close), Math.abs(p.low - hl[i].close)));
let w = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14;
ok("ATR Seed = Mittel TR", close(atr[14], w));
w = (w * 13 + trs[14]) / 14;
ok("ATR Wilder-Glättung", close(atr[15], w));
const gap = hl.map((p, i) => (i === 40 ? { date: p.date, close: p.close } : p));
const atrGap = calcAtr(gap);
ok("Luecke im High/Low -> null, kein Schaetzwert", atrGap[40] == null && atrGap[41] == null && atrGap[53] == null && atrGap[54] != null);
ok("currentAtr aus letztem Punkt", close(buildGoldTechnical(hl).currentAtr ?? null, atr[atr.length - 1] as number));

// F10-08: Volumen-Trend.
ok("ohne Volumen: volumeTrend null", t.volumeTrend === null);
const withVol = (f: (i: number) => number) => base.map((p, i) => ({ ...p, volume: f(i) }));
const rising = buildGoldTechnical(withVol(i => 1000 + i * 10));
ok("Kurs hoch + Volumen hoch = bestaetigt", rising.volumeTrend?.state === "bestaetigt", rising.volumeTrend);
ok("volConfirm-Marker gesetzt", rising.points.some(p => p.volConfirm));
const falling = buildGoldTechnical(withVol(i => 5000 - i * 10));
ok("Kurs hoch + Volumen runter = divergenz", falling.volumeTrend?.state === "divergenz");
const down = base.map((p, i) => ({ ...p, close: 3000 - i * 2, volume: 1000 + i * 10 }));
ok("Kurs runter + Volumen hoch = abwaertsdruck", buildGoldTechnical(down).volumeTrend?.state === "abwaertsdruck");
const zero = buildGoldTechnical(withVol(i => (i === 70 ? 0 : 1000 + i)));
ok("0-Print im Fenster -> n/a", zero.volumeTrend === null);

// Bestehende Felder unveraendert (Additiv): RSI/MACD/Signale gleich mit und ohne High/Low.
const a = buildGoldTechnical(base), b = buildGoldTechnical(hl);
ok("RSI/MACD/Signale unabhaengig von High/Low", JSON.stringify(a.points.map(p => [p.rsi14, p.macd, p.signal, p.ma50, p.cross])) === JSON.stringify(b.points.map(p => [p.rsi14, p.macd, p.signal, p.ma50, p.cross])) && JSON.stringify(a.signals) === JSON.stringify(b.signals));

// Server: Score bekommt weiter nur date/close und volumePoints.
const src = fs.readFileSync("server/gold-routes.ts", "utf8");
ok("Score-Closes weiterhin nur date/close", src.includes("closes: historicalPrices.map(point => ({ date: point.date, close: point.close })),"));
ok("Score-Volumen weiterhin volumePoints", src.includes("volumes: volumePoints,"));

console.log(`test-gold-f10-indicators: ${pass}/${pass + fail} ok`);
if (fail) process.exit(1);
