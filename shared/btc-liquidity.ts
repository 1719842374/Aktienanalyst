/**
 * BTC-Liquiditätsblock (C1/C2 aus Future_Work.md §4.1, Philip-Freigabe 18.10.2026).
 *
 * Drei Komponenten aus freien FRED-Reihen, jede auf −1 … +1 wie die übrigen GIS-Indikatoren:
 *  1. Fed-Bilanz WALCL: 13-Wochen-Änderung in % (Regel exakt Future_Work.md:121–122).
 *  2. T-Bill-Emission: Anteil der Bills an allen marktfähigen Treasuries (Z.1,
 *     BOGZ1FL313161110Q / (…110Q + BOGZ1FL313161275Q)), Änderung über 4 Quartale in pp,
 *     eingeordnet gegen die eigene 20-Jahres-Verteilung (Perzentil).
 *  3. Kapitalmarktzins DGS10: Änderung über 63 Beobachtungen (≈ 3 Monate) in bp, fallend = positiv.
 *
 * Point-in-time: jede Beobachtung zählt erst ab Datum + Veröffentlichungsverzug (lagDays),
 * damit die historischen Stichtage keine erst später veröffentlichten Werte sehen.
 * Revisionen (ALFRED-Vintages) werden NICHT nachgebildet — es gilt der heutige FRED-Stand.
 *
 * n/a-Regel: Komponente ohne (aktuelle) Daten fällt heraus, die Gewichte der übrigen werden
 * renormalisiert. Unterschreitet die verfügbare Abdeckung minCoverage, ist der ganze Block n/a
 * und der GIS wird exakt wie vor diesem Block berechnet (applyBtcLiquidityBlock).
 * Keine Datenwerte im Code — nur Regeln/Parameter.
 */
import type {
  BtcLiquidityBlock,
  BtcLiquidityComponent,
  BtcLiquidityComponentKey,
} from "./schema";

export type { BtcLiquidityBlock, BtcLiquidityComponent, BtcLiquidityResponse, WalclPoint } from "./schema";

export interface LiquidityObs { date: string; value: number }

export const BTC_LIQUIDITY_SERIES = {
  walcl: "WALCL",
  bills: "BOGZ1FL313161110Q",
  otherMarketable: "BOGZ1FL313161275Q",
  dgs10: "DGS10",
} as const;

/** Gewichte und Schwellen. Begründung: PR-Body „Gewichte“. */
export const BTC_LIQUIDITY_CONFIG = {
  /** Anteil des Blocks am GIS; die bisherigen 7 Indikatoren werden mit (1 − blockWeight) skaliert. */
  blockWeight: 0.15,
  subWeights: { walcl: 0.45, dgs10: 0.35, bills: 0.20 } as Record<BtcLiquidityComponentKey, number>,
  /** Mindest-Abdeckung (Summe der verfügbaren subWeights). 0.35 ⇒ WALCL oder DGS10 muss da sein;
   *  die quartalsweise, ~5 Monate verzögerte Bill-Reihe allein trägt den Block nicht. */
  minCoverage: 0.35,
  walcl: { lookbackObs: 13, upPct: 1.5, downPct: -1.0, lagDays: 1, maxAgeDays: 21, spanMinDays: 84, spanMaxDays: 98 },
  dgs10: { lookbackObs: 63, strongBp: 25, mildBp: 10, lagDays: 1, maxAgeDays: 10, spanMinDays: 80, spanMaxDays: 100 },
  bills: {
    lookbackObs: 4, percentileYears: 20, minSample: 40,
    /** Perzentil-Stufen der 4Q-Änderung des Bill-Anteils */
    p: { hi: 80, midHi: 60, midLo: 40, lo: 20 },
    /** FRED datiert Z.1 auf den Quartalsanfang; Veröffentlichung ≈ 70 Tage nach Quartalsende ⇒ ≈ 165 Tage nach Datum. */
    lagDays: 165,
    /** > lagDays + ein Quartal + Puffer ⇒ eine Z.1-Veröffentlichung fehlt → n/a */
    maxAgeDays: 165 + 120,
  },
} as const;

export const BTC_LIQUIDITY_LABELS: Record<BtcLiquidityComponentKey, string> = {
  walcl: "Fed-Bilanz (WALCL)",
  bills: "T-Bill-Anteil (Z.1)",
  dgs10: "10Y-Zins-Trend (DGS10)",
};

export const BTC_LIQUIDITY_INDICATOR_NAME = "Liquidität (Fed/Bills/10Y)";
export const BTC_LIQUIDITY_SOURCE = "FRED: WALCL · BOGZ1FL313161110Q/…275Q · DGS10";

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;
}

/** Sortiert, nur ISO-Datum + endliche Werte, ein Wert je Tag. */
export function cleanObs(obs: ReadonlyArray<{ date: string; value: number }> | null | undefined): LiquidityObs[] {
  if (!Array.isArray(obs)) return [];
  const out = obs
    .filter(o => o && ISO.test(o.date) && Number.isFinite(o.value))
    .map(o => ({ date: o.date, value: o.value }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return out.filter((p, i) => i === 0 || p.date !== out[i - 1].date);
}

/** Nur Beobachtungen, die am Stichtag schon veröffentlicht waren (Datum + lagDays ≤ asOf). */
export function pointInTime(obs: LiquidityObs[], asOf: string, lagDays: number): LiquidityObs[] {
  return obs.filter(o => addDays(o.date, lagDays) <= asOf);
}

const sign = (v: number, digits: number) => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

function naComponent(key: BtcLiquidityComponentKey, seriesIds: string[], unit: BtcLiquidityComponent["metricUnit"], why: string): BtcLiquidityComponent {
  return {
    key, label: BTC_LIQUIDITY_LABELS[key], available: false, score: null, metric: null, metricUnit: unit,
    value: "n/a", subWeight: BTC_LIQUIDITY_CONFIG.subWeights[key], effectiveSubWeight: 0, asOf: null,
    seriesIds, source: "FRED", note: why,
  };
}

/** 1. WALCL: 13W-Änderung in %; > +1,5 % → +1, < −1,0 % → −1, sonst 0 (Future_Work.md:121–122). */
export function walclComponent(raw: LiquidityObs[], asOf: string): BtcLiquidityComponent {
  const c = BTC_LIQUIDITY_CONFIG.walcl;
  const ids = [BTC_LIQUIDITY_SERIES.walcl];
  const obs = pointInTime(cleanObs(raw), asOf, c.lagDays);
  if (obs.length <= c.lookbackObs) return naComponent("walcl", ids, "%", "keine WALCL-Daten");
  const last = obs[obs.length - 1];
  const prev = obs[obs.length - 1 - c.lookbackObs];
  if (daysBetween(last.date, asOf) > c.maxAgeDays) return naComponent("walcl", ids, "%", `WALCL veraltet (letzter Wert ${last.date})`);
  const span = daysBetween(prev.date, last.date);
  if (span < c.spanMinDays || span > c.spanMaxDays || prev.value <= 0) return naComponent("walcl", ids, "%", "WALCL-Reihe lückenhaft");
  const chg = (last.value / prev.value - 1) * 100;
  const score = chg > c.upPct ? 1 : chg < c.downPct ? -1 : 0;
  return {
    key: "walcl", label: BTC_LIQUIDITY_LABELS.walcl, available: true, score, metric: chg, metricUnit: "%",
    value: `${(last.value / 1e6).toFixed(2)} Bio. $ (13W ${sign(chg, 2)} %)`,
    subWeight: BTC_LIQUIDITY_CONFIG.subWeights.walcl, effectiveSubWeight: 0, asOf: last.date,
    seriesIds: ids, source: "FRED WALCL (H.4.1)",
    note: `13W-Änderung > +${c.upPct} % → +1 (QE), < ${c.downPct} % → −1 (QT), sonst 0`,
  };
}

/** 3. DGS10: Δ über 63 Beobachtungen in bp. ≤ −25 → +1, ≤ −10 → +0,5, ≥ +25 → −1, ≥ +10 → −0,5. */
export function dgs10Component(raw: LiquidityObs[], asOf: string): BtcLiquidityComponent {
  const c = BTC_LIQUIDITY_CONFIG.dgs10;
  const ids = [BTC_LIQUIDITY_SERIES.dgs10];
  const obs = pointInTime(cleanObs(raw), asOf, c.lagDays);
  if (obs.length <= c.lookbackObs) return naComponent("dgs10", ids, "bp", "keine DGS10-Daten");
  const last = obs[obs.length - 1];
  const prev = obs[obs.length - 1 - c.lookbackObs];
  if (daysBetween(last.date, asOf) > c.maxAgeDays) return naComponent("dgs10", ids, "bp", `DGS10 veraltet (letzter Wert ${last.date})`);
  const span = daysBetween(prev.date, last.date);
  if (span < c.spanMinDays || span > c.spanMaxDays) return naComponent("dgs10", ids, "bp", "DGS10-Reihe lückenhaft");
  const bp = (last.value - prev.value) * 100;
  const score = bp <= -c.strongBp ? 1 : bp <= -c.mildBp ? 0.5 : bp >= c.strongBp ? -1 : bp >= c.mildBp ? -0.5 : 0;
  return {
    key: "dgs10", label: BTC_LIQUIDITY_LABELS.dgs10, available: true, score, metric: bp, metricUnit: "bp",
    value: `${last.value.toFixed(2)} % (3M ${sign(bp, 0)} bp)`,
    subWeight: BTC_LIQUIDITY_CONFIG.subWeights.dgs10, effectiveSubWeight: 0, asOf: last.date,
    seriesIds: ids, source: "FRED DGS10",
    note: `fallend = Rückenwind: ≤ −${c.strongBp} bp → +1, ≤ −${c.mildBp} bp → +0,5, ≥ +${c.mildBp} bp → −0,5, ≥ +${c.strongBp} bp → −1`,
  };
}

/** Bill-Anteil in % je Quartal (nur Quartale, die in beiden Reihen vorliegen). */
export function billShareSeries(bills: LiquidityObs[], other: LiquidityObs[]): LiquidityObs[] {
  const o = new Map(cleanObs(other).map(p => [p.date, p.value]));
  const out: LiquidityObs[] = [];
  for (const b of cleanObs(bills)) {
    const ov = o.get(b.date);
    if (ov == null || b.value <= 0 || ov <= 0) continue;
    out.push({ date: b.date, value: (b.value / (b.value + ov)) * 100 });
  }
  return out;
}

/** 2. T-Bill-Anteil: 4Q-Änderung in pp, Perzentil gegen die 20J-Verteilung der 4Q-Änderungen. */
export function billsComponent(billsRaw: LiquidityObs[], otherRaw: LiquidityObs[], asOf: string): BtcLiquidityComponent {
  const c = BTC_LIQUIDITY_CONFIG.bills;
  const ids = [BTC_LIQUIDITY_SERIES.bills, BTC_LIQUIDITY_SERIES.otherMarketable];
  const bills = pointInTime(cleanObs(billsRaw), asOf, c.lagDays);
  const other = pointInTime(cleanObs(otherRaw), asOf, c.lagDays);
  const share = billShareSeries(bills, other);
  if (share.length <= c.lookbackObs) return naComponent("bills", ids, "pp", "keine Z.1-Bill-Daten");
  const last = share[share.length - 1];
  if (daysBetween(last.date, asOf) > c.maxAgeDays) return naComponent("bills", ids, "pp", `Z.1 veraltet (letztes Quartal ${last.date})`);
  const changes: { date: string; d: number }[] = [];
  for (let i = c.lookbackObs; i < share.length; i++) {
    const span = daysBetween(share[i - c.lookbackObs].date, share[i].date);
    if (span < 360 || span > 370) continue;
    changes.push({ date: share[i].date, d: share[i].value - share[i - c.lookbackObs].value });
  }
  const current = changes[changes.length - 1];
  if (!current || current.date !== last.date) return naComponent("bills", ids, "pp", "Z.1-Reihe lückenhaft");
  const cutoff = addDays(last.date, -Math.round(c.percentileYears * 365.25));
  const ref = changes.filter(x => x.date > cutoff).map(x => x.d);
  if (ref.length < c.minSample) return naComponent("bills", ids, "pp", `zu wenig Z.1-Historie (${ref.length} < ${c.minSample} Quartale)`);
  const below = ref.filter(v => v < current.d).length;
  const equal = ref.filter(v => v === current.d).length;
  const rank = ((below + 0.5 * equal) / ref.length) * 100;
  const score = rank >= c.p.hi ? 1 : rank >= c.p.midHi ? 0.5 : rank <= c.p.lo ? -1 : rank <= c.p.midLo ? -0.5 : 0;
  const billsLast = bills.find(b => b.date === last.date)?.value ?? null;
  return {
    key: "bills", label: BTC_LIQUIDITY_LABELS.bills, available: true, score, metric: current.d, metricUnit: "pp",
    value: `${billsLast != null ? `${(billsLast / 1e6).toFixed(2)} Bio. $, ` : ""}Anteil ${last.value.toFixed(1)} % (4Q ${sign(current.d, 2)} pp, P${Math.round(rank)})`,
    subWeight: BTC_LIQUIDITY_CONFIG.subWeights.bills, effectiveSubWeight: 0, asOf: last.date,
    seriesIds: ids, source: "FRED Z.1 (BOGZ1FL313161110Q, …275Q)",
    note: `4Q-Änderung des Bill-Anteils gegen ${c.percentileYears}J-Verteilung: ≥ P${c.p.hi} → +1, ≥ P${c.p.midHi} → +0,5, ≤ P${c.p.midLo} → −0,5, ≤ P${c.p.lo} → −1 (Stand Quartal ${last.date}, ~${c.lagDays} T. Verzug)`,
  };
}

export function computeBtcLiquidityBlock(
  series: { walcl: LiquidityObs[]; bills: LiquidityObs[]; otherMarketable: LiquidityObs[]; dgs10: LiquidityObs[] },
  asOf: string,
): BtcLiquidityBlock {
  const cfg = BTC_LIQUIDITY_CONFIG;
  const components = [
    walclComponent(series.walcl, asOf),
    billsComponent(series.bills, series.otherMarketable, asOf),
    dgs10Component(series.dgs10, asOf),
  ];
  const avail = components.filter(c => c.available && c.score != null);
  const coverage = avail.reduce((s, c) => s + c.subWeight, 0);
  const ok = avail.length > 0 && coverage + 1e-9 >= cfg.minCoverage;
  for (const c of components) c.effectiveSubWeight = ok && c.available ? c.subWeight / coverage : 0;
  const score = ok ? avail.reduce((s, c) => s + (c.score as number) * c.subWeight, 0) / coverage : null;
  const missing = components.filter(c => !c.available).map(c => c.label);
  return {
    available: ok,
    score,
    weight: cfg.blockWeight,
    coverage,
    components,
    asOf,
    note: !ok
      ? `Liquiditätsblock n/a (Abdeckung ${(coverage * 100).toFixed(0)} % < ${(cfg.minCoverage * 100).toFixed(0)} %) – GIS ohne Block`
      : missing.length > 0
        ? `n/a: ${missing.join(", ")} – Gewichte auf verfügbare Komponenten renormalisiert`
        : null,
  };
}

export interface GisIndicatorLike {
  name: string;
  value: string;
  score: number;
  weight: number;
  weighted: number;
  source: string;
  available?: boolean;
}

/**
 * Bindet den Block in den GIS ein.
 * Block verfügbar: bisherige Gewichte × (1 − blockWeight), Block mit blockWeight (Summe bleibt 1).
 * Block n/a: bisherige Indikatoren unverändert, Zeile „n/a“ mit Gewicht 0 → GIS identisch zu vorher.
 * Der Block-Score wird auf 2 Nachkommastellen gerundet (wie angezeigt, damit der Rechenweg aufgeht).
 */
export function applyBtcLiquidityBlock<T extends GisIndicatorLike>(
  base: T[],
  block: BtcLiquidityBlock | null | undefined,
): { indicators: GisIndicatorLike[]; gis: number; gisCalculation: string } {
  let rows: GisIndicatorLike[];
  if (block && block.available && block.score != null && Number.isFinite(block.score)) {
    const scale = 1 - block.weight;
    const s = Math.round(block.score * 100) / 100;
    rows = [
      ...base.map(ind => ({ ...ind, weight: ind.weight * scale, weighted: ind.score * ind.weight * scale })),
      {
        name: BTC_LIQUIDITY_INDICATOR_NAME,
        value: block.components.map(c => `${c.label.split(" (")[0]}: ${c.available ? c.score : "n/a"}`).join(" · "),
        score: s, weight: block.weight, weighted: s * block.weight,
        source: BTC_LIQUIDITY_SOURCE, available: true,
      },
    ];
  } else {
    rows = [
      ...base,
      {
        name: BTC_LIQUIDITY_INDICATOR_NAME,
        value: block?.note ?? "n/a – FRED nicht erreichbar",
        score: 0, weight: 0, weighted: 0, source: BTC_LIQUIDITY_SOURCE, available: false,
      },
    ];
  }
  const gis = rows.reduce((sum, ind) => sum + ind.weighted, 0);
  const gisCalculation = rows
    .map(ind => ind.available === false
      ? `${ind.name}: n/a × 0 = 0.0000`
      : `${ind.name}: ${ind.score} × ${+ind.weight.toFixed(6)} = ${ind.weighted.toFixed(4)}`)
    .join(" + ") + ` = ${gis.toFixed(4)}`;
  return { indicators: rows, gis, gisCalculation };
}

/** WALCL (Mio. USD) → Bio. USD je Wochendatum, für das Overlay. */
export function walclOverlayPoints(raw: LiquidityObs[]): { date: string; valueTn: number }[] {
  return cleanObs(raw).filter(p => p.value > 0).map(p => ({ date: p.date, valueTn: p.value / 1e6 }));
}

/** Forward-Fill der Wochenwerte auf Kurstage; maxGapDays verhindert Fortschreiben über Lücken. */
export function walclByDate(points: { date: string; valueTn: number }[], dates: string[], maxGapDays = 14): Record<string, number> {
  const pts = [...points].filter(p => ISO.test(p.date) && Number.isFinite(p.valueTn)).sort((a, b) => a.date.localeCompare(b.date));
  const out: Record<string, number> = {};
  let j = -1;
  for (const d of [...dates].sort()) {
    while (j + 1 < pts.length && pts[j + 1].date <= d) j++;
    if (j >= 0 && daysBetween(pts[j].date, d) <= maxGapDays) out[d] = pts[j].valueTn;
  }
  return out;
}
