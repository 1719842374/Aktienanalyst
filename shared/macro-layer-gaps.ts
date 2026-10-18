/**
 * Future_9 Lücken der Makro-Ebene — F9-07 Konzentration, F9-10 Managing-Score, F9-11 Makro-Widersprüche.
 * Reine Rechnung (kein IO). Ergebnis fließt NUR in die Makro-Ebene (layerOnly), nie in bestehende Scores/P.
 *
 * F9-07 (Future_9 Z.37, Z.78): Konzentration = Cap-Weight-RSL − Equal-Weight-RSL.
 *   RSL nach Levy = letzter Wochenschluss / Mittel der letzten 27 Wochenschlüsse. Cap = SPY, Equal = RSP.
 *   Habitat-Regel wörtlich: Konzentration > 0,4 → bewertung ×1,15.
 * F9-10 (Z.95–103): Managing-Score (Korrektur) prüft Materialisierung: CAPEX, EPS-Wachstum, Realzins,
 *   Konzentration jeweils gegen ihren Trend (z-Score). Vorzeichen Managing: + = materialisiert.
 *   „Negativer Score erhöht Korrektur-Wahrscheinlichkeit“ → Risiko-Eingang der Ebene = −Managing.
 * F9-11 (Z.14, 54, 112): „Widersprüche prüfen Inkonsistenzen“ — ANNAHME (Spec unscharf, konservativ):
 *   nur aus bereits vorhandenen Slots, kein neuer Datenpunkt; Widerspruch = zwei feste Signalpaare zeigen
 *   in entgegengesetzte Richtungen; Stärke |a − b| / 2, gleichgerichtet = 0. Score nie negativ.
 */
import type { MacroDimensionId, MacroIndicatorInput } from "./macro-layer";

export const MACRO_GAPS = {
  RSL_WEEKS: 27,
  CONC_Z_WEEKS: 260,
  CONC_Z_MIN_WEEKS: 104,
  EPS_Z_MONTHS: 240,
  EPS_Z_MIN_MONTHS: 60,
  /** z → Komponente: z / 2, auf −1 … +1 begrenzt (|z| ≥ 2 = volle Stärke). */
  Z_SCALE: 2,
  MANAGING_MIN_COMPONENTS: 2,
} as const;

export interface PriceBar { date: string; close: number }
export interface DatedValue { date: string; value: number }

export interface MacroConcentration {
  value: number | null;
  asOf: string | null;
  rslCap: number | null;
  rslEqual: number | null;
  z: number | null;
  weeks: number;
  source: string;
  note: string;
}

export interface MacroManagingComponent {
  id: "capex" | "eps" | "realzins" | "konzentration";
  label: string;
  available: boolean;
  /** Rohwert (EPS-YoY %, Realzins %, Konzentration) — n/a = null. */
  value: number | null;
  z: number | null;
  /** Managing-Vorzeichen (+ = materialisiert), −1 … +1. */
  component: number | null;
  note: string;
}

export interface MacroContradictionPair {
  id: string;
  label: string;
  a: string;
  b: string;
  scoreA: number | null;
  scoreB: number | null;
  contradiction: number | null;
  note: string;
}

export interface MacroGaps {
  concentration: MacroConcentration;
  managing: { score: number | null; components: MacroManagingComponent[]; note: string };
  widersprueche: { score: number | null; pairs: MacroContradictionPair[]; note: string; assumption: string };
}

const r = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

function zOfLast(values: number[]): number | null {
  if (values.length < 3) return null;
  const last = values[values.length - 1];
  const hist = values.slice(0, -1);
  const mu = hist.reduce((s, v) => s + v, 0) / hist.length;
  const sd = Math.sqrt(hist.reduce((s, v) => s + (v - mu) ** 2, 0) / (hist.length - 1));
  return sd > 0 ? (last - mu) / sd : null;
}

/** Montag der ISO-Woche als Schlüssel. */
function weekKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

export interface WeeklyClose { week: string; date: string; value: number }

/** Letzter Schlusskurs je ISO-Woche (aufsteigend); date = letzter Handelstag der Woche. */
export function weeklyCloses(bars: PriceBar[]): WeeklyClose[] {
  const m = new Map<string, WeeklyClose>();
  for (const b of [...bars].filter(b => b && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && Number.isFinite(b.close) && b.close > 0).sort((a, b) => a.date.localeCompare(b.date))) {
    const week = weekKey(b.date);
    m.set(week, { week, date: b.date, value: b.close });
  }
  return Array.from(m.values()).sort((a, b) => a.week.localeCompare(b.week));
}

/** Levy-RSL am Ende von `weekly` (letzter Kurs / Mittel der letzten 27 Wochen). */
export function levyRsl(weekly: number[], weeks: number = MACRO_GAPS.RSL_WEEKS): number | null {
  if (weekly.length < weeks) return null;
  const win = weekly.slice(-weeks);
  const mean = win.reduce((s, v) => s + v, 0) / weeks;
  return mean > 0 ? weekly[weekly.length - 1] / mean : null;
}

/** F9-07: Konzentrationsreihe (gemeinsame Wochen) und aktueller Wert. */
export function computeConcentration(cap: PriceBar[], equal: PriceBar[], source = "Yahoo/Stooq SPY vs. RSP"): MacroConcentration {
  const wc = weeklyCloses(cap);
  const we = new Map(weeklyCloses(equal).map(p => [p.week, p]));
  const common = wc.filter(p => we.has(p.week));
  const capV = common.map(p => p.value);
  const eqV = common.map(p => we.get(p.week)!.value);
  const series: number[] = [];
  for (let i = MACRO_GAPS.RSL_WEEKS - 1; i < common.length; i++) {
    const a = levyRsl(capV.slice(0, i + 1));
    const b = levyRsl(eqV.slice(0, i + 1));
    if (a != null && b != null) series.push(a - b);
  }
  if (!series.length) {
    return { value: null, asOf: null, rslCap: null, rslEqual: null, z: null, weeks: common.length, source,
      note: common.length ? `n/a – nur ${common.length} gemeinsame Wochen (< ${MACRO_GAPS.RSL_WEEKS})` : "n/a – keine Kurse SPY/RSP" };
  }
  const rslCap = levyRsl(capV)!;
  const rslEqual = levyRsl(eqV)!;
  const zSample = series.slice(-(MACRO_GAPS.CONC_Z_WEEKS + 1));
  const z = zSample.length >= MACRO_GAPS.CONC_Z_MIN_WEEKS ? zOfLast(zSample) : null;
  const lastCommon = common[common.length - 1];
  const eqLast = we.get(lastCommon.week)!;
  const lastDate = lastCommon.date < eqLast.date ? lastCommon.date : eqLast.date;
  return {
    value: r(series[series.length - 1], 4),
    asOf: lastDate,
    rslCap: r(rslCap, 4),
    rslEqual: r(rslEqual, 4),
    z: z == null ? null : r(z, 2),
    weeks: common.length,
    source,
    note: z == null ? `z n/a (< ${MACRO_GAPS.CONC_Z_MIN_WEEKS} Wochen Konzentrations-Historie)` : `z über ${zSample.length - 1} Wochen`,
  };
}

/**
 * EPS-Wachstum (TTM, YoY %) gegen den eigenen Trend über bis zu 240 Monate.
 * Spec §1 erlaubt z-Score ODER Perzentil. EPS-YoY hat extreme Ausreißer (2009/2010: −90 % / +Hunderte %),
 * die die Standardabweichung aufblähen → hier Perzentilrang; `z` = 2 × (Perzentil − 0,5) × Z_SCALE,
 * damit die Komponente (z / Z_SCALE) = 2·Perzentil − 1 ist. z-Wert wird als Info mitgeliefert (zRaw).
 */
export function epsGrowthVsTrend(points: DatedValue[]): { yoy: number | null; z: number | null; zRaw: number | null; percentile: number | null; asOf: string | null; note: string } {
  const byMonth = new Map<string, DatedValue>();
  for (const p of [...points].filter(p => p && /^\d{4}-\d{2}/.test(p.date) && Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date))) {
    byMonth.set(p.date.slice(0, 7), p);
  }
  const months = Array.from(byMonth.keys()).sort();
  const yoys: { month: string; v: number }[] = [];
  for (const m of months) {
    const [y, mo] = m.split("-");
    const prev = byMonth.get(`${Number(y) - 1}-${mo}`);
    const cur = byMonth.get(m)!;
    if (!prev || !(prev.value > 0) || !(cur.value > 0)) continue;
    yoys.push({ month: m, v: (cur.value / prev.value - 1) * 100 });
  }
  if (!yoys.length) return { yoy: null, z: null, zRaw: null, percentile: null, asOf: null, note: "n/a – keine EPS-Historie" };
  const last = yoys[yoys.length - 1];
  const sample = yoys.slice(-(MACRO_GAPS.EPS_Z_MONTHS + 1)).map(x => x.v);
  const enough = sample.length >= MACRO_GAPS.EPS_Z_MIN_MONTHS;
  const hist = sample.slice(0, -1);
  const pct = enough ? (hist.filter(v => v < last.v).length + 0.5 * hist.filter(v => v === last.v).length) / hist.length : null;
  const zRaw = enough ? zOfLast(sample) : null;
  return {
    yoy: r(last.v, 2),
    z: pct == null ? null : r(2 * (pct - 0.5) * MACRO_GAPS.Z_SCALE, 2),
    zRaw: zRaw == null ? null : r(zRaw, 2),
    percentile: pct == null ? null : r(pct * 100, 1),
    asOf: byMonth.get(last.month)!.date,
    note: pct == null ? `n/a (< ${MACRO_GAPS.EPS_Z_MIN_MONTHS} Monate)` : `Perzentil ${r(pct * 100, 1)} über ${hist.length} Monate (z roh ${zRaw == null ? "n/a" : r(zRaw, 2)})`,
  };
}

function zComponent(z: number | null, sign: 1 | -1): number | null {
  return z == null || !Number.isFinite(z) ? null : r(clamp1((sign * z) / MACRO_GAPS.Z_SCALE));
}

/** F9-10 Managing-Score. Realzins-z = DFII10 z (20 J Monatsende) aus dem Habitat. */
export function computeManaging(input: {
  eps: { yoy: number | null; z: number | null; note: string } | null;
  realYield: number | null;
  realYieldZ: number | null;
  concentration: MacroConcentration | null;
}): MacroGaps["managing"] {
  const components: MacroManagingComponent[] = [
    { id: "capex", label: "CAPEX Hyperscaler vs. Trend", available: false, value: null, z: null, component: null,
      note: "n/a – F9-08 nicht gebaut (Quelle laut Detail FMP-Cashflow, Key nur auf Render)" },
    (() => {
      const c = zComponent(input.eps?.z ?? null, 1);
      return { id: "eps" as const, label: "EPS-Wachstum (TTM YoY) vs. Trend", available: c != null, value: input.eps?.yoy ?? null, z: input.eps?.z ?? null, component: c,
        note: input.eps ? `multpl S&P 500 Earnings; ${input.eps.note}; Komponente = 2·Perzentil − 1; über Trend = +` : "n/a – multpl nicht abrufbar" };
    })(),
    (() => {
      const c = zComponent(input.realYieldZ, -1);
      return { id: "realzins" as const, label: "Realzins DFII10 vs. Trend", available: c != null, value: input.realYield, z: input.realYieldZ, component: c,
        note: c == null ? "n/a – DFII10-z nicht verfügbar" : "FRED DFII10, z 20 J; über Trend = − (Gegenwind)" };
    })(),
    (() => {
      const c = zComponent(input.concentration?.z ?? null, -1);
      return { id: "konzentration" as const, label: "Konzentration (Cap−Equal RSL) vs. Trend", available: c != null, value: input.concentration?.value ?? null,
        z: input.concentration?.z ?? null, component: c,
        note: c == null ? `n/a – ${input.concentration?.note ?? "keine Konzentration"}` : "SPY/RSP Levy-RSL, z 5 J; über Trend = − (enge Marktbreite)" };
    })(),
  ];
  const avail = components.filter(c => c.component != null);
  if (avail.length < MACRO_GAPS.MANAGING_MIN_COMPONENTS) {
    return { score: null, components, note: `n/a – nur ${avail.length} von 4 Komponenten (Minimum ${MACRO_GAPS.MANAGING_MIN_COMPONENTS})` };
  }
  const score = r(avail.reduce((s, c) => s + c.component!, 0) / avail.length);
  return { score, components, note: `Mittel aus ${avail.length} von 4 Komponenten; negativ = erhöht Korrektur-Risiko` };
}

/** Feste Paare (Name-Präfixe der bestehenden Slots). */
export const CONTRADICTION_PAIRS: Array<{ id: string; label: string; a: { label: string; names: string[] }; b: { label: string; names: string[] } }> = [
  { id: "kredit-real", label: "Kreditmarkt vs. Realwirtschaft",
    a: { label: "Kreditspreads", names: ["Kreditspreads"] },
    b: { label: "Sahm / Aktivität / Durable Goods", names: ["Sahm", "Aktivität", "Durable Goods"] } },
  { id: "bewertung-kredit", label: "Aktienbewertung vs. Kreditmarkt",
    a: { label: "CAPE / Buffett", names: ["Shiller CAPE", "Buffett"] },
    b: { label: "Kreditspreads", names: ["Kreditspreads"] } },
  { id: "vix-kredit", label: "Aktien-Volatilität vs. Kreditmarkt",
    a: { label: "VIX", names: ["VIX"] },
    b: { label: "Kreditspreads", names: ["Kreditspreads"] } },
];

const ASSUMPTION_F9_11 =
  "ANNAHME F9-11: Spec nennt nur „Makro-Bilanzwidersprüche“ / „Widersprüche prüfen Inkonsistenzen“. Konservativ: nur vorhandene Slots, " +
  "3 feste Paare Markt-gegen-Markt/Realwirtschaft; Widerspruch nur bei entgegengesetztem Vorzeichen (|a−b|/2), sonst 0. Score ≥ 0 (kein negativer " +
  "Risikobeitrag); als Dimension im gewichteten Mittel zieht ein Wert 0 die Makro-Ebene aber zur Mitte (50 %).";

function sideScore(indicators: MacroIndicatorInput[], names: string[]): number | null {
  const slots = indicators.filter(i => !i.layerOnly && i.available !== false && i.maxWeighted > 0 && Number.isFinite(i.weightedScore)
    && names.some(n => i.name === n || i.name.startsWith(n)) && !i.name.startsWith("VIX-Proxy"));
  if (!slots.length) return null;
  const net = slots.reduce((s, i) => s + i.weightedScore, 0);
  const max = slots.reduce((s, i) => s + i.maxWeighted, 0);
  return clamp1(net / max);
}

/** F9-11 Makro-Widersprüche aus den bestehenden Slots. */
export function computeContradictions(indicators: MacroIndicatorInput[]): MacroGaps["widersprueche"] {
  const pairs: MacroContradictionPair[] = CONTRADICTION_PAIRS.map(p => {
    const sa = sideScore(indicators, p.a.names);
    const sb = sideScore(indicators, p.b.names);
    if (sa == null || sb == null) {
      return { id: p.id, label: p.label, a: p.a.label, b: p.b.label, scoreA: sa, scoreB: sb, contradiction: null, note: "n/a – eine Seite ohne gewerteten Slot" };
    }
    const c = sa * sb < 0 ? r(Math.abs(sa - sb) / 2) : 0;
    return { id: p.id, label: p.label, a: p.a.label, b: p.b.label, scoreA: r(sa), scoreB: r(sb), contradiction: c,
      note: c > 0 ? "entgegengesetzte Richtung" : "gleichgerichtet oder neutral → kein Widerspruch" };
  });
  const avail = pairs.filter(p => p.contradiction != null);
  if (!avail.length) return { score: null, pairs, note: "n/a – kein auswertbares Paar", assumption: ASSUMPTION_F9_11 };
  const score = r(avail.reduce((s, p) => s + p.contradiction!, 0) / avail.length);
  return { score, pairs, note: `Mittel aus ${avail.length} von ${pairs.length} Paaren (0 = konsistent, 1 = maximal widersprüchlich)`, assumption: ASSUMPTION_F9_11 };
}

/** Komponenten als Eingänge der Makro-Ebene (layerOnly, feste Dimension, max 1). */
export function gapInputs(gaps: MacroGaps): MacroIndicatorInput[] {
  const out: MacroIndicatorInput[] = [];
  if (gaps.managing.score != null) {
    out.push({ name: "Managing-Score (F9-10)", group: "correction", weightedScore: r(-gaps.managing.score), maxWeighted: 1, dimension: "managing" as MacroDimensionId, layerOnly: true });
  }
  if (gaps.widersprueche.score != null) {
    for (const group of ["recession", "correction"] as const) {
      out.push({ name: "Makro-Widersprüche (F9-11)", group, weightedScore: gaps.widersprueche.score, maxWeighted: 1, dimension: "widersprueche", layerOnly: true });
    }
  }
  return out;
}
