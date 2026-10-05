/**
 * Adaptive Fiskal-Schicht: z, s(z), Netto-Bills, Front-End, inverser Vol-Mix.
 * Reine Funktionen. Kein Fetch, kein Kalender als Score.
 * Spec: Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md §4.
 */
import { classifyPolicyFromOps } from "./liquidity-regime-math";
import { qraIdentityHolds } from "./qra-snapshot";

export { classifyPolicyFromOps, qraIdentityHolds };

/** Methodik. Keine Markt-Schwelle. */
export const EPSILON = 1e-9;
export const Z_CLIP = 2;

/**
 * Fixture H.4.1 / FRED. WSHOBL am 2026-08-26 = 541995 Mio. $.
 * Kein Score-Input.
 */
export const WSHOBL_FIXTURE_2026_08_26_MIO = 541995;

/** Quoten vorerst Policy. m = 0.75·0.70 + 0.55·0.30. */
export const POLICY_M = 0.75 * 0.70 + 0.55 * 0.30;

/** Prior nur bis 12 Monate Live-Varianz von S_M, S_F*, S_D. */
export const PRIOR_WEIGHT = { m: 0.45, f: 0.35, d: 0.20 } as const;

export const WINDOW = {
  di90: { h: 5 * 365, hMin: 250 },
  feNb: { h: 24, hMin: 12 },
  buyback: { hMin: 8 },
  deltaNl13w: { h: 104, hMin: 26 },
} as const;

export function clip(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function sOfZ(z: number): number {
  return 50 + 50 * clip(z / Z_CLIP, -1, 1);
}

export interface ZScore {
  available: boolean;
  z: number | null;
  mu: number | null;
  sigma: number | null;
  n: number;
  /** Anzeige 50, wenn die Historie unter H_min liegt. */
  s: number;
}

/**
 * μ und σ aus x_{t-1}…x_{t-H}, nicht aus x_t.
 * n < H_min → available false, s = 50. Kein Regime raten.
 */
export function zScore(series: number[], h: number, hMin: number): ZScore {
  const clean = series.filter(v => Number.isFinite(v));
  const unavailable = (n: number): ZScore => ({ available: false, z: null, mu: null, sigma: null, n, s: 50 });
  if (clean.length < 2) return unavailable(clean.length);
  const xT = clean[clean.length - 1];
  const prior = clean.slice(0, -1).slice(-h);
  if (prior.length < hMin || prior.length < 2) return unavailable(prior.length);
  const mu = prior.reduce((sum, v) => sum + v, 0) / prior.length;
  const variance = prior.reduce((sum, v) => sum + (v - mu) ** 2, 0) / (prior.length - 1);
  const sigma = Math.sqrt(variance);
  const z = (xT - mu) / (sigma + EPSILON);
  return { available: true, z, mu, sigma, n: prior.length, s: sOfZ(z) };
}

/** N^b_Δm = O^b_m − O^b_{m-1}. Beträge in Mrd. $. */
export function netBillSupplyFromStock(currentBn: number, previousBn: number): number {
  return currentBn - previousBn;
}

/** Fallback, nie QRA. Kennzeichnung beim Aufrufer: scaled-from-monthly. */
export function scaleMonthlyTo30(netMonthBn: number, daysInMonth: number): number | null {
  if (!Number.isFinite(netMonthBn) || !Number.isFinite(daysInMonth) || daysInMonth <= 0) return null;
  return netMonthBn * (30 / daysInMonth);
}

/** N^b_30 = G^b_30 − M^b_30. */
export function netBillSupplyFromFlows(grossBn: number, maturingBn: number): number | null {
  if (!Number.isFinite(grossBn) || !Number.isFinite(maturingBn)) return null;
  return grossBn - maturingBn;
}

/** N^{b,QRA}_30 = ΔB_implied · 30/91. Fließt nicht in s(z). */
export function qraBillAnchor30(impliedBillChangeBn: number): number {
  return impliedBillChangeBn * (30 / 91);
}

export interface FrontEndInput {
  d30: number | null;
  fedBills: number | null;
  netSupply: number | null;
}

export interface FrontEndImpulse {
  available: boolean;
  fe30: number | null;
}

/** Ohne N^b (oder ohne die anderen Terme) → null, nicht 2.47 − 0. */
export function frontEndImpulse(input: FrontEndInput): FrontEndImpulse {
  const { d30, fedBills, netSupply } = input;
  if (d30 == null || fedBills == null || netSupply == null) return { available: false, fe30: null };
  if (!Number.isFinite(d30) || !Number.isFinite(fedBills) || !Number.isFinite(netSupply)) {
    return { available: false, fe30: null };
  }
  return { available: true, fe30: d30 + fedBills - netSupply };
}

/** D_30 = ΔM_30 · m. ΔM in USD, Ergebnis in Mrd. $. Policy, kein belegter Anteil. */
export function policyD30Bn(deltaM30Usd: number | null): number | null {
  if (deltaM30Usd == null || !Number.isFinite(deltaM30Usd)) return null;
  return (deltaM30Usd / 1e9) * POLICY_M;
}

export function inverseVolMix(parts: { score: number; sigma: number }[]): number | null {
  let num = 0;
  let den = 0;
  for (const part of parts) {
    if (!Number.isFinite(part.score) || !Number.isFinite(part.sigma) || part.sigma <= 0) continue;
    const weight = 1 / part.sigma;
    num += weight * part.score;
    den += weight;
  }
  if (den <= 0) return null;
  return num / den;
}

/** score_MacroFiscal = clip((S − 50) / 25, −1, 1). Der BTC-GIS-Slot liest das, sobald FE_30 available ist. */
export function macroFiscalGis(s: number): number {
  return clip((s - 50) / 25, -1, 1);
}

export interface DatedLevel {
  date: string;
  value: number;
}

/** Letzter Wert an oder vor `date`. Serie aufsteigend. */
export function locfAt(series: DatedLevel[], date: string): number | null {
  let last: number | null = null;
  for (const point of series) {
    if (point.date <= date && Number.isFinite(point.value)) last = point.value;
    else if (point.date > date) break;
  }
  return last;
}

export function addIsoDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(laterIso: string, earlierIso: string): number {
  const later = Date.parse(`${laterIso}T00:00:00.000Z`);
  const earlier = Date.parse(`${earlierIso}T00:00:00.000Z`);
  return Math.round((later - earlier) / 86_400_000);
}

export function daysInMonth(iso: string): number {
  const [year, month] = iso.split("-").map(Number);
  if (!year || !month) return 30;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** F^{Fed,b}_30 = Niveau_t − Niveau_{t−4 Wochen}. Werte wie geliefert (Mio. oder Mrd.). */
export function deltaOverWeeks(series: DatedLevel[], weeks: number): { delta: number; asOf: string; priorDate: string } | null {
  const ordered = series.filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered[ordered.length - 1];
  if (!last) return null;
  const priorDate = addIsoDays(last.date, -weeks * 7);
  const prior = locfAt(ordered, priorDate);
  if (prior == null) return null;
  return { delta: last.value - prior, asOf: last.date, priorDate };
}

/**
 * F^{Fed,b} über ~28 Tage, Ende an `asOf`. Serie in Mio. $, Ergebnis in Mrd. $.
 * Gleicher Abstand wie `deltaOverWeeks(..., 4)`.
 */
export function somaBillDeltaBn(seriesMio: DatedLevel[], asOf: string, days = 28): number | null {
  const ordered = seriesMio.filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const now = locfAt(ordered, asOf);
  const prior = locfAt(ordered, addIsoDays(asOf, -days));
  if (now == null || prior == null) return null;
  return (now - prior) / 1000;
}

/**
 * s(z_FE) über MSPD-Monate: FE_Δm = F^{Fed,b}_{~28T} − N^b_Δm.
 * D_30 bleibt im Live-FE_30. Die DefiLlama-Quelle der Spec hat kein 24-Monats-ΔM,
 * deshalb wird fehlendes D nicht als 0 eingesetzt.
 */
export function monthlyFrontEndBn(stocksBn: DatedLevel[], somaBillsMio: DatedLevel[]): number[] {
  const stocks = [...stocksBn].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const out: number[] = [];
  for (let i = 1; i < stocks.length; i++) {
    const net = netBillSupplyFromStock(stocks[i].value, stocks[i - 1].value);
    const fed = somaBillDeltaBn(somaBillsMio, stocks[i].date, 28);
    if (fed == null || !Number.isFinite(net)) continue;
    out.push(fed - net);
  }
  return out;
}

/** Index-Abstand wie C2 delta13w: 13 Wochen = 13 Schritte. */
export function rollingIndexDelta(values: number[], steps: number): number[] {
  const out: number[] = [];
  for (let i = steps; i < values.length; i++) {
    const now = values[i];
    const then = values[i - steps];
    if (Number.isFinite(now) && Number.isFinite(then)) out.push(now - then);
  }
  return out;
}

/** Δi_90 = DFF_t − DFF_{t−90 Kalendertage}. */
export function calendarDelta(series: DatedLevel[], days: number): number[] {
  const ordered = series.filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const out: number[] = [];
  for (const point of ordered) {
    const prior = locfAt(ordered, addIsoDays(point.date, -days));
    if (prior == null) continue;
    out.push(point.value - prior);
  }
  return out;
}

/** Sektor 10–30y. Buckets, die unter 10y beginnen, zählen nicht. */
export function isTenToThirtyYearBucket(label: string): boolean {
  const match = label.match(/([\d.]+)\s*Y\s*to\s*([\d.]+)\s*Y/i);
  if (!match) return false;
  const lo = Number(match[1]);
  const hi = Number(match[2]);
  return Number.isFinite(lo) && Number.isFinite(hi) && lo >= 10 && hi <= 30;
}

export interface BuybackK30 {
  date: string;
  k30Bn: number;
}

function median(values: number[]): number | null {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * 1_desk = 1{d_last ≤ 14} · 1{K_30 > median(K_30 Historie)}.
 * Ohne Ops ist das Flag 0, unabhängig von asOf.
 */
export function buybackDeskFlag(asOf: string, points: BuybackK30[]): 0 | 1 {
  if (points.length === 0) return 0;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const history = sorted.slice(0, -1).map(point => point.k30Bn);
  const med = median(history);
  if (med == null) return 0;
  const recent = daysBetween(asOf, last.date) <= 14;
  return recent && last.k30Bn > med ? 1 : 0;
}

export interface ScoreSlot {
  available: boolean;
  score: number | null;
  /** Immer 50, wenn available false. */
  display: number;
  sigma: number | null;
  n: number;
}

function slotFromZ(z: ZScore, score: number | null): ScoreSlot {
  if (!z.available || score == null || z.sigma == null) {
    return { available: false, score: null, display: 50, sigma: null, n: z.n };
  }
  return { available: true, score, display: score, sigma: z.sigma, n: z.n };
}

export interface AdaptiveFiscalResult {
  deskFlag: 0 | 1;
  s: number | null;
  displayS: number;
  available: boolean;
  mix: "prior" | "inverse-vol";
  macroFiscal: number | null;
  sM: ScoreSlot;
  sF: ScoreSlot;
  sD: ScoreSlot;
  /** Anzeige, nicht Score-Basis. */
  labels: { available: boolean; qe: boolean; rmp: boolean };
}

function unavailableSlot(): ScoreSlot {
  return { available: false, score: null, display: 50, sigma: null, n: 0 };
}

/**
 * S_M, S_F*, S_D und der Prior-Mix.
 * asOf geht nur in das Desk-Flag ein, und nur wenn Ops-Punkte da sind.
 */
export function adaptiveFiscal(input: {
  asOf: string;
  nl13w: number[];
  di90: number[];
  notes13w: number[];
  bills13w: number[];
  feMonthly: number[];
  tga4w: number[];
  buybackK30: BuybackK30[];
  liveVarianceMonths?: number | null;
}): AdaptiveFiscalResult {
  const zNl = zScore(input.nl13w, WINDOW.deltaNl13w.h, WINDOW.deltaNl13w.hMin);
  const zI = zScore(input.di90, WINDOW.di90.h, WINDOW.di90.hMin);
  const zNotes = zScore(input.notes13w, WINDOW.deltaNl13w.h, WINDOW.deltaNl13w.hMin);
  const zBills = zScore(input.bills13w, WINDOW.deltaNl13w.h, WINDOW.deltaNl13w.hMin);
  const zFe = zScore(input.feMonthly, WINDOW.feNb.h, WINDOW.feNb.hMin);
  const zTga = zScore(input.tga4w, WINDOW.deltaNl13w.h, WINDOW.deltaNl13w.hMin);
  const zK = zScore(input.buybackK30.map(point => point.k30Bn), Number.POSITIVE_INFINITY, WINDOW.buyback.hMin);

  const sM = mixComponentSlots([
    slotFromZ(zNl, zNl.available ? zNl.s : null),
    slotFromZ(zI, zI.available && zI.z != null ? sOfZ(-zI.z) : null),
    slotFromZ(zNotes, zNotes.available ? zNotes.s : null),
  ]);
  // S_F* mischt s(z_FE) und s(−z_ΔTGA). Fehlt die FE-Historie, kein Slot aus TGA allein.
  const sF = zFe.available && zTga.available
    ? mixComponentSlots([
      slotFromZ(zFe, zFe.s),
      slotFromZ(zTga, zTga.z != null ? sOfZ(-zTga.z) : null),
    ])
    : unavailableSlot();
  const sD = slotFromZ(zK, zK.available ? zK.s : null);

  const liveMonths = input.liveVarianceMonths ?? null;
  const mixMode = liveMonths != null && liveMonths >= 12 ? "inverse-vol" : "prior";
  const mixed = mixTopLevel(sM, sF, sD, mixMode);
  const labelsAvailable = zNotes.available && zNotes.z != null && zBills.available && zBills.z != null && input.notes13w.length > 0;
  const notesDelta = input.notes13w.length ? input.notes13w[input.notes13w.length - 1] : null;
  const qe = labelsAvailable && zNotes.z! > 1.5 && (notesDelta ?? 0) > 0;
  const rmp = labelsAvailable && zBills.z! > 1.5 && zNotes.z! <= 0.5;

  return {
    deskFlag: buybackDeskFlag(input.asOf, input.buybackK30),
    s: mixed.s,
    displayS: mixed.available && mixed.s != null ? mixed.s : 50,
    available: mixed.available,
    mix: mixMode,
    macroFiscal: mixed.available && mixed.s != null ? macroFiscalGis(mixed.s) : null,
    sM,
    sF,
    sD,
    labels: { available: labelsAvailable, qe, rmp: labelsAvailable ? rmp && !qe : false },
  };
}

function mixComponentSlots(slots: ScoreSlot[]): ScoreSlot {
  const ready = slots.filter(slot => slot.available && slot.score != null && slot.sigma != null && slot.sigma > 0);
  if (ready.length === 0) return unavailableSlot();
  const score = inverseVolMix(ready.map(slot => ({ score: slot.score!, sigma: slot.sigma! })));
  if (score == null) return unavailableSlot();
  const sigma = ready.reduce((sum, slot) => sum + slot.sigma!, 0) / ready.length;
  return { available: true, score, display: score, sigma, n: Math.min(...ready.map(slot => slot.n)) };
}

function mixTopLevel(sM: ScoreSlot, sF: ScoreSlot, sD: ScoreSlot, mode: "prior" | "inverse-vol"): { available: boolean; s: number | null } {
  const rows = [
    { weight: PRIOR_WEIGHT.m, slot: sM },
    { weight: PRIOR_WEIGHT.f, slot: sF },
    { weight: PRIOR_WEIGHT.d, slot: sD },
  ].filter(row => row.slot.available && row.slot.score != null);
  if (rows.length === 0) return { available: false, s: null };
  if (mode === "inverse-vol") {
    const score = inverseVolMix(rows.map(row => ({ score: row.slot.score!, sigma: row.slot.sigma ?? Number.NaN })));
    return score == null ? { available: false, s: null } : { available: true, s: score };
  }
  const weightSum = rows.reduce((sum, row) => sum + row.weight, 0);
  const score = rows.reduce((sum, row) => sum + row.weight * row.slot.score!, 0) / weightSum;
  return { available: true, s: score };
}
