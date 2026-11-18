/**
 * Hysterese-Cross nur für die Anzeige.
 * Run: npx tsx script/test-technical-confirmation.ts
 *
 * Live-k ist 0 (Vola-Schwelle aus). C1/C2 laufen zusätzlich mit k=0.5.
 * Bestätigt heißt: zum Freeze mindestens CONFIRM_MIN_HITS von 4 Kriterien.
 */
import { readFileSync } from "node:fs";
import {
  BENCHMARK_UNAVAILABLE_REASON,
  CONFIRM_MIN_HITS,
  CONFIRM_WINDOW_BARS,
  CROSS_POSITIVE_LAG_BARS,
  HYSTERESIS_BARS,
  MIN_EVENT_INDEX,
  VOL_THRESHOLD_K,
  WHIPSAW_BARS,
  confirmCrossEvents,
  crossDelayTooltip,
  crossTone,
  maCrossReasonTone,
  sigmaAt,
  spreadOfBar,
  type CrossBar,
} from "../client/src/lib/taCrossConfirmation";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function weekdayOnOrAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function nextWeekday(iso: string): string {
  let d = addDays(iso, 1);
  while (new Date(`${d}T00:00:00Z`).getUTCDay() === 0 || new Date(`${d}T00:00:00Z`).getUTCDay() === 6) d = addDays(d, 1);
  return d;
}

function weekdaySpan(from: string, to: string): string[] {
  const out: string[] = [];
  let d = weekdayOnOrAfter(from);
  while (d <= to) {
    out.push(d);
    d = nextWeekday(d);
  }
  return out;
}

function bar(date: string, spread: number, patch: Partial<CrossBar> = {}): CrossBar {
  const ma200 = 100;
  const ma50 = ma200 * Math.exp(spread);
  return {
    date,
    close: ma200 * Math.exp(spread),
    ma50,
    ma200,
    histogram: 0,
    volume: 100,
    ...patch,
  };
}

function datesFrom(start: string, n: number): string[] {
  const out: string[] = [];
  let d = weekdayOnOrAfter(start);
  while (out.length < n) {
    out.push(d);
    d = nextWeekday(d);
  }
  return out;
}

/** 2-Tage-Blöcke: nie drei Handelstage auf derselben Seite. */
function twoDayWave(n: number, scale = 1): number[] {
  const out: number[] = [];
  for (let t = 0; t < n; t++) {
    const sign = Math.floor(t / 2) % 2 === 0 ? 1 : -1;
    out.push(sign * scale * (0.8 + 0.2 * Math.sin(t / 5)));
  }
  return out;
}

function barsForSpreads(spreads: readonly number[], start = "2014-01-02", patchAt?: (i: number, row: CrossBar) => CrossBar): CrossBar[] {
  const dates = datesFrom(start, spreads.length);
  return spreads.map((s, i) => {
    const row = bar(dates[i], s);
    return patchAt ? patchAt(i, row) : row;
  });
}

function c1Series(): { bars: CrossBar[]; sigma: number; amp: number } {
  const n = 420;
  const spreads = twoDayWave(n, 1);
  let amp = 0.01;
  for (let iter = 0; iter < 12; iter++) {
    for (let t = n - 30; t < n; t++) {
      const sign = Math.floor(t / 2) % 2 === 0 ? 1 : -1;
      spreads[t] = sign * amp;
    }
    const sigma = sigmaAt(spreads, n - 1);
    if (sigma == null || !(sigma > 0)) break;
    const next = 0.1 * sigma;
    if (Math.abs(next - amp) <= sigma * 0.01) {
      amp = next;
      break;
    }
    amp = next;
  }
  for (let t = n - 30; t < n; t++) {
    const sign = Math.floor(t / 2) % 2 === 0 ? 1 : -1;
    spreads[t] = sign * amp;
  }
  const sigma = sigmaAt(spreads, n - 1) ?? NaN;
  return { bars: barsForSpreads(spreads), sigma, amp };
}

function c2Series(): { bars: CrossBar[]; tau: number } {
  const n = 320;
  const spreads = twoDayWave(n, 1);
  const tau = 251;
  let level = 1;
  for (let iter = 0; iter < 12; iter++) {
    spreads[tau] = level;
    spreads[tau + 1] = level;
    spreads[tau + 2] = level;
    const sigma = sigmaAt(spreads, tau + 2);
    if (sigma == null || !(sigma > 0)) break;
    const next = Math.max(sigma * 0.8, 1e-4);
    if (Math.abs(next - level) <= sigma * 0.02 && level > sigma * 0.5) break;
    level = next;
  }
  return { bars: barsForSpreads(spreads), tau };
}

console.log("\nKonstanten");
check("Live-k ist 0", VOL_THRESHOLD_K === 0);
check("m, Fenster, Freeze und Lag sind benannt", HYSTERESIS_BARS === 3 && CONFIRM_WINDOW_BARS === 10 && CROSS_POSITIVE_LAG_BARS === 13);
check("Bestätigt ab CONFIRM_MIN_HITS", CONFIRM_MIN_HITS === 3);
check("Tooltip nennt die Verzögerung", crossDelayTooltip().includes(String(CROSS_POSITIVE_LAG_BARS)) && crossDelayTooltip().includes("Handelstage"));

console.log("\nC1 Pendel");
{
  const { bars, sigma, amp } = c1Series();
  const spreads = bars.map(spreadOfBar);
  const last30 = spreads.slice(-30).map(s => s ?? NaN);
  const maxAbs = Math.max(...last30.map(s => Math.abs(s)));
  check("C1 Sigma der letzten 30 Tage ist positiv", sigma > 0, `sigma=${sigma}`);
  check("C1 letzte 30 Tage bleiben bei ±0.1·sigma", sigma > 0 && maxAbs <= sigma * 0.1 + 1e-9 && Math.abs(amp - sigma * 0.1) <= sigma * 0.02, `amp=${amp} sigma=${sigma} max=${maxAbs}`);
  for (const k of [0, 0.5]) {
    const view = confirmCrossEvents(bars, { k });
    check(`C1 k=${k}: 0 Events`, view.events.length === 0, `n=${view.events.length}`);
  }
}

console.log("\nC2 sauberer Übergang");
{
  const { bars, tau } = c2Series();
  const sigma = sigmaAt(bars.map(spreadOfBar), tau + 2) ?? NaN;
  const s0 = spreadOfBar(bars[tau]) ?? NaN;
  check("C2 die drei Tage liegen über 0.5·sigma", s0 > 0.5 * sigma, `s=${s0} sigma=${sigma}`);
  for (const k of [0, 0.5]) {
    const view = confirmCrossEvents(bars, { k });
    const golden = view.events.filter(e => e.type === "golden");
    check(`C2 k=${k}: genau 1 GOLDEN`, view.events.length === 1 && golden.length === 1, `n=${view.events.length}`);
    check(`C2 k=${k}: tau ist Tag 1 der Folge`, golden[0]?.index === tau && golden[0]?.date === bars[tau].date, `idx=${golden[0]?.index}`);
  }
}

console.log("\nC3 Index unter 199");
{
  const spreads = twoDayWave(180, 0.2);
  for (let t = 80; t < 95; t++) spreads[t] = 0.4;
  const bars = barsForSpreads(spreads, "2018-01-02");
  const view = confirmCrossEvents(bars, { k: 0 });
  check("C3 Kreuz vor Index 199 erzeugt kein Event", view.events.length === 0, `n=${view.events.length}`);
  check("C3 Schwelle ist Index 199", MIN_EVENT_INDEX === 199);
}

console.log("\nC4 Alter in Kerzen");
{
  const n = 260;
  const spreads = twoDayWave(n, 0.2);
  const dates = datesFrom("2024-01-02", n);
  const friday = dates.findIndex((d, i) => i >= 220 && new Date(`${d}T00:00:00Z`).getUTCDay() === 5);
  check("C4 Fixture hat einen Freitag", friday >= 220);
  spreads[friday - 2] = -0.2;
  spreads[friday - 1] = -0.2;
  for (let j = 0; j < HYSTERESIS_BARS; j++) spreads[friday + j] = 0.35;
  for (let t = friday + HYSTERESIS_BARS; t < n; t++) spreads[t] = 0.04;
  const bars = spreads.map((s, i) => bar(dates[i], s));
  const asOf = friday + 5;
  const view = confirmCrossEvents(bars, { k: 0, asOfIndex: asOf });
  const event = view.events.find(e => e.index === friday);
  const calendar = (Date.parse(`${bars[asOf].date}T00:00:00Z`) - Date.parse(`${bars[friday].date}T00:00:00Z`)) / 86400000;
  check("C4 Event liegt auf dem Freitag", event?.date === bars[friday].date);
  check("C4 Alter = Kerzen seit tau, nicht Kalendertage", event?.ageBars === 5 && calendar === 7, `age=${event?.ageBars} calendar=${calendar} asOf=${bars[asOf].date}`);
}

console.log("\nC5 Freeze");
{
  const n = 280;
  const spreads = twoDayWave(n, 0.15);
  const tau = 230;
  spreads[tau - 2] = -0.2;
  spreads[tau - 1] = -0.2;
  for (let j = 0; j < HYSTERESIS_BARS; j++) spreads[tau + j] = 0.3;
  for (let t = tau + HYSTERESIS_BARS; t < n; t++) spreads[t] = 0.05;
  const freeze = tau + CONFIRM_WINDOW_BARS;
  const bars = barsForSpreads(spreads, "2016-03-01", (i, row) => {
    const upVolume = i >= freeze - 4 && i <= freeze ? 400 : 80;
    const close = i >= freeze - 4 && i <= freeze ? 130 : 70;
    const histogram = i >= freeze - 2 && i <= freeze ? 0.4 : -0.4;
    return { ...row, close, volume: upVolume, histogram };
  });
  const atFreeze = confirmCrossEvents(bars.slice(0, freeze + 1), { k: 0 });
  const laterBars = bars.map((row, i) => i <= freeze ? row : { ...row, close: 50, volume: 10, histogram: -2 });
  const later = confirmCrossEvents(laterBars, { k: 0 });
  const a = atFreeze.events.find(e => e.index === tau);
  const b = later.events.find(e => e.index === tau);
  check("C5 Event ist zum Freeze eingefroren", a?.frozen === true && a.state !== "pending", `state=${a?.state}`);
  check("C5 spätere Kurse ändern x von 4 nicht", a != null && b != null && a.hits === b.hits && a.criteria.every((c, i) => c.met === b.criteria[i]?.met), `hits ${a?.hits} → ${b?.hits}`);
  check("C5 Marker-Ton bleibt derselbe", a != null && b != null && crossTone(a) === crossTone(b) && a.state === b.state, `${a?.state}/${crossTone(a!)} → ${b?.state}/${b ? crossTone(b) : ""}`);
}

console.log("\nC6 eine Funktion");
{
  const chart = readFileSync(new URL("../client/src/components/sections/TechnicalChart.tsx", import.meta.url), "utf8");
  const bannerSrc = readFileSync(new URL("../client/src/components/sections/CrossStatusBanner.tsx", import.meta.url), "utf8");
  const banner = chart.split("Golden / Death Cross banner")[1]?.split("visibleKursCount")[0] ?? "";
  check("C6 Banner rechnet den Cross nicht noch einmal", !banner.includes("confirmCrossEvents") && !banner.includes("lastCrossType"));
  check("C6 Chart bezieht Events aus confirmCrossEvents", chart.includes("confirmCrossEvents("));
  const uses = chart.split("confirmCrossEvents(").length - 1;
  check("C6 genau ein Aufruf für Banner und Marker", uses === 1, `uses=${uses}`);
  check("C6 Banner und Marker lesen dasselbe Ergebnis", chart.includes("view={crossView}") && chart.includes("crossView.events") && bannerSrc.includes("view.latest"));
  const { bars, tau } = c2Series();
  const view = confirmCrossEvents(bars, { k: 0 });
  check("C6 latest ist das letzte Event derselben Liste", view.latest === view.events[view.events.length - 1] && view.latest?.index === tau);
}

console.log("\nC7 31.08.2026");
{
  const dates = weekdaySpan("2020-01-02", "2026-11-16");
  const tau = dates.indexOf("2026-08-31");
  const asOf = dates.indexOf("2026-11-16");
  const spreads = twoDayWave(dates.length, 0.12);
  spreads[tau - 2] = -0.2;
  spreads[tau - 1] = -0.2;
  for (let j = 0; j < HYSTERESIS_BARS; j++) spreads[tau + j] = 0.28;
  for (let t = tau + HYSTERESIS_BARS; t < dates.length; t++) spreads[t] = 0.03;
  const bars = spreads.map((s, i) => bar(dates[i], s));
  const view = confirmCrossEvents(bars, { k: 0, asOfIndex: asOf });
  const event = view.events.find(e => e.date === "2026-08-31");
  const calendar = (Date.parse("2026-11-16T00:00:00Z") - Date.parse("2026-08-31T00:00:00Z")) / 86400000;
  check("C7 tau ist der 31.08.2026", event?.index === tau);
  check("C7 Kalenderabstand bleibt 77 Tage", calendar === 77);
  check("C7 Alter ist die Kerzenzahl 55, nicht 77", event?.ageBars === 55 && event.ageBars !== calendar, `age=${event?.ageBars}`);
}

console.log("\nC8 verfallen");
{
  const n = 280;
  const spreads = twoDayWave(n, 0.1);
  const tau = 230;
  spreads[tau - 2] = -0.2;
  spreads[tau - 1] = -0.2;
  for (let j = 0; j < HYSTERESIS_BARS; j++) spreads[tau + j] = 0.25;
  for (let t = tau + HYSTERESIS_BARS; t < n; t++) spreads[t] = 0.02;
  const bars = barsForSpreads(spreads, "2015-06-01", (_i, row) => ({ ...row, close: 40, histogram: -1, volume: 50 }));
  const view = confirmCrossEvents(bars, { k: 0, asOfIndex: tau + CONFIRM_WINDOW_BARS });
  const event = view.events.find(e => e.index === tau);
  check("C8 nach 10 HT ohne Treffer und ohne Kippen: verfallen", event?.state === "expired" && event.frozen && event.hits < CONFIRM_MIN_HITS, `state=${event?.state} hits=${event?.hits}`);
  check("C8 verfallen ist neutral, nicht negativ", event != null && crossTone(event) === "neutral");
}

console.log("\nC9 bestätigt und C10 Fehlsignal");
{
  const n = 280;
  const spreads = twoDayWave(n, 0.1);
  const tau = 220;
  spreads[tau - 2] = -0.2;
  spreads[tau - 1] = -0.2;
  for (let j = 0; j < HYSTERESIS_BARS; j++) spreads[tau + j] = 0.3;
  for (let t = tau + HYSTERESIS_BARS; t < n; t++) spreads[t] = 0.04;
  const freeze = tau + CONFIRM_WINDOW_BARS;
  const bars = barsForSpreads(spreads, "2015-02-02", (i, row) => {
    const inPrice = i >= freeze - 4 && i <= freeze;
    const inMacd = i >= freeze - 2 && i <= freeze;
    return {
      ...row,
      close: inPrice ? 140 : row.close,
      histogram: inMacd ? 0.8 : 0,
      volume: inPrice ? 300 : 100,
    };
  });
  const confirmed = confirmCrossEvents(bars, { k: 0, asOfIndex: freeze });
  const event = confirmed.events.find(e => e.index === tau);
  const rs = event?.criteria.find(c => c.id === "relative_strength");
  check("C9 drei preis-/volumenbasierte Treffer bestätigen", event?.state === "confirmed" && event.hits >= CONFIRM_MIN_HITS, `hits=${event?.hits} state=${event?.state}`);
  check("C9 Relative Stärke ohne Benchmark ist n/a", rs?.met == null && (rs?.detail ?? "").includes(BENCHMARK_UNAVAILABLE_REASON.slice(0, 12)));
  check("C9 bestätigt Golden ist positiv", event != null && crossTone(event) === "positive");
  check("C9 PENDING davor ist neutral", (() => {
    const pending = confirmCrossEvents(bars, { k: 0, asOfIndex: tau + 4 }).events.find(e => e.index === tau);
    return pending?.state === "pending" && crossTone(pending) === "neutral";
  })());

  const flipSpreads = spreads.slice();
  const deathTau = tau + 6;
  for (let j = 0; j < HYSTERESIS_BARS; j++) flipSpreads[deathTau + j] = -0.3;
  const flipped = confirmCrossEvents(barsForSpreads(flipSpreads, "2015-02-02"), { k: 0, asOfIndex: deathTau + 2 });
  const gone = flipped.events.find(e => e.index === tau);
  check("C10 Gegen-Event ist Fehlsignal, nicht grün", gone?.state === "false_signal" && crossTone(gone) === "neutral", `state=${gone?.state}`);
  check("C10 Whipsaw zählt das Kippen innerhalb 60 HT", flipped.whipsaw.w >= 1 && flipped.whipsaw.n >= 2 && deathTau - tau <= WHIPSAW_BARS, `W/N=${flipped.whipsaw.w}/${flipped.whipsaw.n}`);
}

console.log("\nAnzeige-Grenzen");
{
  const chart = readFileSync(new URL("../client/src/components/sections/TechnicalChart.tsx", import.meta.url), "utf8");
  const fazit = readFileSync(new URL("../client/src/lib/fazit-signal.ts", import.meta.url), "utf8");
  const btc = readFileSync(new URL("../client/src/lib/btcAnalysis.ts", import.meta.url), "utf8");
  check("4/4-Ampel bleibt an ma50AboveMA200", chart.includes("cs.ma50AboveMA200"));
  check("Fazit-Signal unangetastet in der Formel", fazit.includes("techStatus.ma50AboveMA200"));
  check("BTC-Scoreformel bleibt", btc.includes("const gwsValue = gis * 0.30 + powerSignal * 0.50 + cycleSignal * 0.20"));
  check("Signalzeile nutzt den gemeinsamen Ton", chart.includes("maCrossReasonTone"));
  const dash = readFileSync(new URL("../client/src/pages/BTCDashboard.tsx", import.meta.url), "utf8");
  check("BTC-Anzeige nutzt dieselbe Funktion", dash.includes("confirmCrossEvents("));
  check("roher Marker bleibt", chart.includes("maCrossMarkers("));
}

if (failed) {
  console.error(`\n${failed} checks failed`);
  process.exit(1);
}
console.log("\nAlle Cross-Bestätigungs-Checks bestanden");
