/**
 * Adaptive Fiskal-Schicht — reine Funktionen, kein Netz.
 * Spec: Offen_WORK_FISCAL_FRONTEND_ADAPTIVE.md §4.
 *
 * s(z) sieht keine Kalenderfenster und keine Presse. QRA prüft nur die Identität.
 */
import { alignWeekly, classifyPolicyFromOps, type FredObs } from "./liquidity-regime-math";
import { QRA_SNAPSHOT, qraIdentityHolds } from "./qra-snapshot";

export { QRA_SNAPSHOT, qraIdentityHolds };

export const EPS = 1e-9;
export const Z_CLIP = 2;
/** GIS-Gewicht des Macro-Slots. Wird hier nicht angewendet (zweiter PR). */
export const GIS_WEIGHT = 0.15;
export const QRA_TOLERANCE_BN = 1;
/** 0.75·0.70 + 0.55·0.30. Policy, kein belegter Reserveanteil. */
export const POLICY_TBILL_M = 0.75 * 0.70 + 0.55 * 0.30;
export const PRIOR_WEIGHTS = { sM: 0.45, sF: 0.35, sD: 0.20 } as const;
/** H.4.1 / FRED SOMA Bills, 26.08.2026, Millionen USD. Fixture, kein Live-Abruf. */
export const WSHOBL_2026_08_26_MIO = 541995;

/**
 * ΔTGA_4w und ΔB^n_13w haben in der H-Tabelle keine eigene Zeile.
 * Beide sind Wochenreihen wie ΔNL_13w, deshalb dieselbe Spanne 104 / 26.
 */
export const WEEKLY_Z_WINDOW = { h: 104, min: 26 } as const;
export const FE_Z_WINDOW = { h: 24, min: 12 } as const;
export const BUYBACK_Z_MIN_OPS = 8;
export const DFF_Z_MIN = 250;
export const PRIOR_UNTIL_MONTHS = 12;

export interface ZResult {
  z: number | null;
  sigma: number | null;
  n: number;
  available: boolean;
}

export interface FiscalSlot {
  score: number | null;
  display: number;
  available: boolean;
  z: number | null;
  sigma: number | null;
}

export function clip(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function sOfZ(z: number): number {
  return 50 + 50 * clip(z / Z_CLIP, -1, 1);
}

/** μ und σ aus x_{t-k}, k=1..H, ohne x_t. n < H_min → nicht available. */
export function zScore(x: number, prior: number[], h: number | null, hMin: number): ZResult {
  const finite = prior.filter(v => Number.isFinite(v));
  const sample = h == null ? finite : finite.slice(-h);
  if (!Number.isFinite(x) || sample.length < hMin || sample.length < 2) {
    return { z: null, sigma: null, n: sample.length, available: false };
  }
  const n = sample.length;
  const mu = sample.reduce((sum, v) => sum + v, 0) / n;
  const variance = sample.reduce((sum, v) => sum + (v - mu) ** 2, 0) / (n - 1);
  const sigma = Math.sqrt(variance);
  if (!Number.isFinite(sigma)) return { z: null, sigma: null, n, available: false };
  const z = (x - mu) / (sigma + EPS);
  if (!Number.isFinite(z)) return { z: null, sigma, n, available: false };
  return { z, sigma, n, available: true };
}

export function netBillSupplyFromStock(currentBn: number, previousBn: number): number {
  return currentBn - previousBn;
}

export function scaleMonthlyTo30(nMonthBn: number, daysInMonth: number): number {
  return nMonthBn * (30 / daysInMonth);
}

export function qraBillChange30(impliedBillChangeBn: number): number {
  return impliedBillChangeBn * (30 / 91);
}

export function frontEndImpulse(input: {
  d30: number | null;
  fedBills: number | null;
  netSupply: number | null;
}): { value: number | null; available: boolean } {
  const { d30, fedBills, netSupply } = input;
  if (d30 == null || fedBills == null || netSupply == null) return { value: null, available: false };
  if (![d30, fedBills, netSupply].every(Number.isFinite)) return { value: null, available: false };
  return { value: d30 + fedBills - netSupply, available: true };
}

export function inverseVolMix(parts: { score: number; sigma: number }[]): number | null {
  const usable = parts.filter(p => Number.isFinite(p.score) && Number.isFinite(p.sigma) && p.sigma >= 0);
  if (usable.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const p of usable) {
    const w = 1 / (p.sigma + EPS);
    num += w * p.score;
    den += w;
  }
  return den > 0 ? num / den : null;
}

export function macroFiscalGis(s: number): number {
  return clip((s - 50) / 25, -1, 1);
}

export function policyTbillDemand30(deltaMcapUsd: number | null): {
  d30Bn: number | null;
  available: boolean;
  kennzeichnung: string;
} {
  const kennzeichnung = "Policy-Quoten, kein belegter Reserveanteil";
  if (deltaMcapUsd == null || !Number.isFinite(deltaMcapUsd)) {
    return { d30Bn: null, available: false, kennzeichnung };
  }
  return { d30Bn: (deltaMcapUsd * POLICY_TBILL_M) / 1e9, available: true, kennzeichnung };
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function daysBetween(earlier: string, later: string): number {
  const a = Date.parse(`${earlier}T00:00:00.000Z`);
  const b = Date.parse(`${later}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function shiftMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * 1_desk = 1{d_last ≤ 14} · 1{K_30 > median(Historie)}.
 * asOf bestimmt nur den Abstand zur letzten Op, nicht das Kalenderfenster.
 */
export function deskFromOps(input: {
  asOf: string;
  lastOpDate: string | null;
  k30: number | null;
  historyK30: number[];
}): 0 | 1 {
  if (!input.lastOpDate || input.k30 == null || !Number.isFinite(input.k30)) return 0;
  const dLast = daysBetween(input.lastOpDate, input.asOf);
  if (!Number.isFinite(dLast) || dLast < 0 || dLast > 14) return 0;
  const med = median(input.historyK30);
  if (med == null) return 0;
  return input.k30 > med ? 1 : 0;
}

export interface AuctionBillRow {
  auctionDate: string;
  maturityDate: string | null;
  offeringUsd: number | null;
  acceptedUsd: number | null;
  isBillOrCmb: boolean;
}

/**
 * G = Summe Offering, auction_date im Fenster.
 * M = Summe total_accepted der Bills mit maturity_date im Fenster.
 * est_pub_held_mat_by_type_amt ist je Auktion der Typ-Schätzer (dieselbe
 * Größenordnung auf jedem CUSIP des Tages) und wird nicht addiert.
 */
export function netBillSupplyFromAuctions(
  rows: AuctionBillRow[],
  asOf: string,
  windowDays = 30,
): { gBn: number; mBn: number; n30Bn: number } | null {
  const start = shiftDays(asOf, -windowDays);
  let g = 0;
  let gCount = 0;
  let m = 0;
  let mCount = 0;
  for (const row of rows) {
    if (!row.isBillOrCmb) continue;
    if (row.auctionDate >= start && row.auctionDate <= asOf && row.offeringUsd != null && Number.isFinite(row.offeringUsd)) {
      g += row.offeringUsd;
      gCount++;
    }
    if (row.maturityDate && row.maturityDate >= start && row.maturityDate <= asOf && row.acceptedUsd != null && Number.isFinite(row.acceptedUsd)) {
      m += row.acceptedUsd;
      mCount++;
    }
  }
  if (gCount === 0 || mCount === 0) return null;
  return { gBn: g / 1e9, mBn: m / 1e9, n30Bn: (g - m) / 1e9 };
}

export function monthlyNetSupplies(stocks: { date: string; totalBn: number }[]): { date: string; nBn: number }[] {
  const sorted = [...stocks].sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; nBn: number }[] = [];
  for (let i = 1; i < sorted.length; i++) {
    out.push({ date: sorted[i].date, nBn: netBillSupplyFromStock(sorted[i].totalBn, sorted[i - 1].totalBn) });
  }
  return out;
}

export function locfValue(series: { date: string; value: number }[], date: string): number | null {
  let last: number | null = null;
  for (const point of series) {
    if (point.date <= date && Number.isFinite(point.value)) last = point.value;
    else if (point.date > date) break;
  }
  return last;
}

/** Letzter Stand minus Stand `daysBack` Tage davor. WSHOBL_t − WSHOBL_{t-28}. */
export function levelDeltaOverDays(
  series: { date: string; value: number }[],
  asOf: string,
  daysBack: number,
): number | null {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const now = locfValue(sorted, asOf);
  const then = locfValue(sorted, shiftDays(asOf, -daysBack));
  if (now == null || then == null) return null;
  return now - then;
}

/** 13-Wochen-Änderungen, gleicher Abstand wie delta13w (13 Schritte). */
export function stepDeltaSeries(values: number[], steps: number): number[] {
  const out: number[] = [];
  for (let i = steps; i < values.length; i++) {
    if (Number.isFinite(values[i]) && Number.isFinite(values[i - steps])) out.push(values[i] - values[i - steps]);
  }
  return out;
}

export function changeVersusLagDays(
  series: { date: string; value: number }[],
  lagDays: number,
): { date: string; value: number }[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const out: { date: string; value: number }[] = [];
  for (const point of sorted) {
    const prior = locfValue(sorted, shiftDays(point.date, -lagDays));
    if (prior == null) continue;
    out.push({ date: point.date, value: point.value - prior });
  }
  return out;
}

export interface BuybackOp {
  date: string;
  acceptedUsd: number;
  longEnd: boolean;
}

export function k30Series(ops: BuybackOp[], asOf: string, months = 24): {
  current: number | null;
  prior: number[];
  lastOpDate: string | null;
  opCount: number;
} {
  const long = ops
    .filter(op => op.longEnd && op.date <= asOf && Number.isFinite(op.acceptedUsd))
    .sort((a, b) => a.date.localeCompare(b.date));
  const lastOpDate = long.length ? long[long.length - 1].date : null;
  const start = shiftMonths(asOf, -months);
  const inWindow = long.filter(op => op.date >= start);
  const sum30 = (end: string): number => {
    const from = shiftDays(end, -30);
    const usd = long
      .filter(op => op.date > from && op.date <= end)
      .reduce((sum, op) => sum + op.acceptedUsd, 0);
    return usd / 1e9;
  };
  // Ein K_30 je Monat. Jede Op als Punkt würde überlappende 30-Tage-Summen in σ drücken.
  const prior = Array.from({ length: months }, (_, index) => shiftMonths(asOf, -(months - index)))
    .filter(date => date < asOf)
    .map(sum30);
  return {
    current: long.length ? sum30(asOf) : null,
    prior,
    lastOpDate,
    opCount: inWindow.length,
  };
}

function emptySlot(): FiscalSlot {
  return { score: null, display: 50, available: false, z: null, sigma: null };
}

function slotFromZ(x: number | null, prior: number[], h: number | null, hMin: number, invert: boolean): FiscalSlot {
  if (x == null || !Number.isFinite(x)) return emptySlot();
  const z = zScore(x, prior, h, hMin);
  if (!z.available || z.z == null || z.sigma == null) {
    return { score: null, display: 50, available: false, z: z.z, sigma: z.sigma };
  }
  const score = sOfZ(invert ? -z.z : z.z);
  return { score, display: score, available: true, z: z.z, sigma: z.sigma };
}

function mixSlots(parts: FiscalSlot[]): FiscalSlot {
  const ready = parts.filter(p => p.available && p.score != null && p.sigma != null);
  if (ready.length === 0) return emptySlot();
  const score = inverseVolMix(ready.map(p => ({ score: p.score as number, sigma: p.sigma as number })));
  if (score == null || !Number.isFinite(score)) return emptySlot();
  return {
    score,
    display: score,
    available: true,
    z: ready.length === 1 ? ready[0].z : null,
    sigma: ready.length === 1 ? ready[0].sigma : null,
  };
}

export interface ScoreParts {
  feMonthly: number[];
  tga4w: number[];
  nl13w: number[];
  di90: number[];
  notes13w: number[];
  bills13w: number[];
  k30: { current: number | null; prior: number[]; opCount: number };
  liveVarianceMonths: number;
}

export interface AdaptiveScore {
  s: number | null;
  display: number;
  available: boolean;
  mix: "prior" | "inverse-vol";
  gis: number | null;
  sM: FiscalSlot;
  sFStar: FiscalSlot;
  sD: FiscalSlot;
  components: { fe: boolean; tga: boolean; nl: boolean; rate: boolean; notes: boolean; bills: boolean };
}

function latestAndPrior(values: number[]): { current: number | null; prior: number[] } {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return { current: null, prior: [] };
  return { current: finite[finite.length - 1], prior: finite.slice(0, -1) };
}

export function composeAdaptiveScore(parts: ScoreParts): AdaptiveScore {
  const fe = latestAndPrior(parts.feMonthly);
  const tga = latestAndPrior(parts.tga4w);
  const nl = latestAndPrior(parts.nl13w);
  const rate = latestAndPrior(parts.di90);
  const notes = latestAndPrior(parts.notes13w);
  const bills = latestAndPrior(parts.bills13w);

  const feSlot = slotFromZ(fe.current, fe.prior, FE_Z_WINDOW.h, FE_Z_WINDOW.min, false);
  const tgaSlot = slotFromZ(tga.current, tga.prior, WEEKLY_Z_WINDOW.h, WEEKLY_Z_WINDOW.min, true);
  const nlSlot = slotFromZ(nl.current, nl.prior, WEEKLY_Z_WINDOW.h, WEEKLY_Z_WINDOW.min, false);
  const rateSlot = slotFromZ(rate.current, rate.prior, null, DFF_Z_MIN, true);
  const notesSlot = slotFromZ(notes.current, notes.prior, WEEKLY_Z_WINDOW.h, WEEKLY_Z_WINDOW.min, false);
  const sFStar = mixSlots([feSlot, tgaSlot]);
  const sM = mixSlots([nlSlot, rateSlot, notesSlot]);
  const buybackReady = parts.k30.opCount >= BUYBACK_Z_MIN_OPS;
  const sD = buybackReady
    ? slotFromZ(parts.k30.current, parts.k30.prior, null, BUYBACK_Z_MIN_OPS, false)
    : emptySlot();

  const weighted = [
    { slot: sM, weight: PRIOR_WEIGHTS.sM },
    { slot: sFStar, weight: PRIOR_WEIGHTS.sF },
    { slot: sD, weight: PRIOR_WEIGHTS.sD },
  ];
  const active = weighted.filter(row => row.slot.available && row.slot.score != null);
  let s: number | null = null;
  let mix: "prior" | "inverse-vol" = "prior";
  if (active.length > 0) {
    const sigmasReady = parts.liveVarianceMonths >= PRIOR_UNTIL_MONTHS
      && active.every(row => row.slot.sigma != null);
    if (sigmasReady) {
      mix = "inverse-vol";
      s = inverseVolMix(active.map(row => ({ score: row.slot.score as number, sigma: row.slot.sigma as number })));
    } else {
      const weightSum = active.reduce((sum, row) => sum + row.weight, 0);
      s = active.reduce((sum, row) => sum + row.weight * (row.slot.score as number), 0) / weightSum;
    }
  }
  const available = s != null && Number.isFinite(s);
  return {
    s: available ? s : null,
    display: available ? (s as number) : 50,
    available,
    mix,
    gis: available ? macroFiscalGis(s as number) : null,
    sM,
    sFStar,
    sD,
    components: {
      fe: feSlot.available,
      tga: tgaSlot.available,
      nl: nlSlot.available,
      rate: rateSlot.available,
      notes: notesSlot.available,
      bills: bills.current != null,
    },
  };
}

export type NetBillSource = "MSPD" | "Auctions" | "scaled-from-monthly";

export interface FiscalFrontendPayload {
  fetchedAt: string;
  asOf: string;
  d30: { valueBn: number | null; available: boolean; kennzeichnung: string; badge: "policy" };
  netBillSupply: {
    n30Bn: number | null;
    nMonthBn: number | null;
    source: NetBillSource | null;
    available: boolean;
    asOf: string | null;
    qra30Bn: number;
  };
  fedBills: { deltaBn: number | null; available: boolean; kennzeichnung: string };
  frontEndImpulse: { fe30Bn: number | null; available: boolean };
  adaptiveScore: AdaptiveScore;
  qra: {
    asOf: string;
    nextRelease: string;
    quarter: string;
    kennzeichnung: string;
    impliedBillChangeBn: number;
    identityHolds: boolean;
    nQra30Bn: number;
  };
  genius: { legal: 1; rulemakingNote: string };
  desk: { flag: 0 | 1; source: "ops"; calendarHint: string | null };
  labels: { qe: boolean; rmp: boolean };
  tgaOpeningBn: number | null;
}

export interface AuctionInputRow {
  auctionDate: string;
  maturityDate: string | null;
  offeringUsd: number | null;
  acceptedUsd: number | null;
  securityType: string | null;
  cashManagementBill: string | null;
}

export interface MspdRow {
  date: string;
  totalMilAmt: number;
}

export interface DatedMio {
  date: string;
  valueMio: number;
}

export interface DatedValue {
  date: string;
  value: number;
}

export interface FiscalRawInputs {
  asOf: string;
  fetchedAt: string;
  deltaMcapUsd: number | null;
  mspd: MspdRow[];
  auctions: AuctionInputRow[];
  wshobl: DatedMio[];
  wshotsl: DatedMio[];
  dff: DatedValue[];
  walcl: FredObs[];
  rrp: FredObs[];
  tga: FredObs[];
  buybacks: BuybackOp[];
  tgaOpeningMil: number | null;
  liveVarianceMonths: number;
  genius: { legal: 1; rulemakingNote: string };
}

function mioToBnSeries(rows: DatedMio[]): { date: string; value: number }[] {
  return rows
    .filter(row => Number.isFinite(row.valueMio))
    .map(row => ({ date: row.date, value: row.valueMio / 1000 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function monthlyFe(net: { date: string; nBn: number }[], billsBn: { date: string; value: number }[]): number[] {
  const out: number[] = [];
  for (const row of net) {
    const fed = levelDeltaOverDays(billsBn, row.date, 28);
    if (fed == null || !Number.isFinite(row.nBn)) continue;
    out.push(fed - row.nBn);
  }
  return out;
}

function notesBn(total: DatedMio[], bills: DatedMio[]): { date: string; value: number }[] {
  const billByDate = new Map(bills.map(row => [row.date, row.valueMio]));
  const out: { date: string; value: number }[] = [];
  for (const row of total) {
    const bill = billByDate.get(row.date);
    if (bill == null || !Number.isFinite(row.valueMio) || !Number.isFinite(bill)) continue;
    out.push({ date: row.date, value: (row.valueMio - bill) / 1000 });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function assembleFiscalFrontend(raw: FiscalRawInputs): FiscalFrontendPayload {
  const demand = policyTbillDemand30(raw.deltaMcapUsd);
  const stocks = raw.mspd
    .filter(row => Number.isFinite(row.totalMilAmt))
    .map(row => ({ date: row.date, totalBn: row.totalMilAmt / 1000 }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const monthly = monthlyNetSupplies(stocks);
  const latestMonth = monthly.length ? monthly[monthly.length - 1] : null;
  const auctions = netBillSupplyFromAuctions(raw.auctions.map(row => ({
    auctionDate: row.auctionDate,
    maturityDate: row.maturityDate,
    offeringUsd: row.offeringUsd,
    acceptedUsd: row.acceptedUsd,
    isBillOrCmb: row.securityType === "Bill" || row.cashManagementBill === "Yes",
  })), raw.asOf);

  let n30Bn: number | null = null;
  let source: NetBillSource | null = null;
  if (auctions) {
    n30Bn = auctions.n30Bn;
    source = "Auctions";
  } else if (latestMonth) {
    n30Bn = scaleMonthlyTo30(latestMonth.nBn, daysInMonth(latestMonth.date));
    source = "scaled-from-monthly";
  }

  const billsBn = mioToBnSeries(raw.wshobl);
  const fedDelta = billsBn.length ? levelDeltaOverDays(billsBn, raw.asOf, 28) : null;
  const fe = frontEndImpulse({
    d30: demand.d30Bn,
    fedBills: fedDelta,
    netSupply: n30Bn,
  });

  const aligned = alignWeekly(raw.walcl, raw.rrp, raw.tga);
  const nl13w = stepDeltaSeries(aligned.map(point => point.netBn), 13);
  const tgaBn = aligned.map(point => point.tgaBn);
  const tga4w = stepDeltaSeries(tgaBn, 4);
  const notes = notesBn(raw.wshotsl, raw.wshobl);
  const notes13w = stepDeltaSeries(notes.map(point => point.value), 13);
  const bills13w = stepDeltaSeries(billsBn.map(point => point.value), 13);
  const dffChanges = changeVersusLagDays(raw.dff, 90);
  const dffCut = raw.asOf ? shiftMonths(raw.asOf, -60) : "";
  const di90 = dffChanges.filter(point => point.date >= dffCut).map(point => point.value);
  const k30 = k30Series(raw.buybacks, raw.asOf);
  const adaptiveScore = composeAdaptiveScore({
    feMonthly: monthlyFe(monthly, billsBn),
    tga4w,
    nl13w,
    di90,
    notes13w,
    bills13w,
    k30,
    liveVarianceMonths: raw.liveVarianceMonths,
  });
  const notesZ = slotFromZ(
    notes13w.length ? notes13w[notes13w.length - 1] : null,
    notes13w.slice(0, -1),
    WEEKLY_Z_WINDOW.h,
    WEEKLY_Z_WINDOW.min,
    false,
  );
  const billsZ = slotFromZ(
    bills13w.length ? bills13w[bills13w.length - 1] : null,
    bills13w.slice(0, -1),
    WEEKLY_Z_WINDOW.h,
    WEEKLY_Z_WINDOW.min,
    false,
  );
  const deskFlag = deskFromOps({
    asOf: raw.asOf,
    lastOpDate: k30.lastOpDate,
    k30: k30.current,
    historyK30: k30.prior,
  });
  const policy = classifyPolicyFromOps({
    asOf: raw.asOf,
    zNotes13w: notesZ.z,
    notesDelta13wBn: notes13w.length ? notes13w[notes13w.length - 1] : null,
    zBills13w: billsZ.z,
    desk: deskFlag,
  });

  return {
    fetchedAt: raw.fetchedAt,
    asOf: raw.asOf,
    d30: { ...demand, badge: "policy" },
    netBillSupply: {
      n30Bn,
      nMonthBn: latestMonth ? latestMonth.nBn : null,
      source,
      available: n30Bn != null && Number.isFinite(n30Bn),
      asOf: latestMonth?.date ?? null,
      qra30Bn: qraBillChange30(QRA_SNAPSHOT.impliedBillChangeBn),
    },
    fedBills: {
      deltaBn: fedDelta,
      available: fedDelta != null && Number.isFinite(fedDelta),
      kennzeichnung: "WSHOBL Δ ~28T",
    },
    frontEndImpulse: { fe30Bn: fe.value, available: fe.available },
    adaptiveScore,
    qra: {
      asOf: QRA_SNAPSHOT.asOf,
      nextRelease: QRA_SNAPSHOT.nextRelease,
      quarter: QRA_SNAPSHOT.quarter,
      kennzeichnung: QRA_SNAPSHOT.kennzeichnung,
      impliedBillChangeBn: QRA_SNAPSHOT.impliedBillChangeBn,
      identityHolds: qraIdentityHolds(),
      nQra30Bn: qraBillChange30(QRA_SNAPSHOT.impliedBillChangeBn),
    },
    genius: raw.genius,
    desk: { flag: policy.desk, source: "ops", calendarHint: policy.calendarHint },
    labels: { qe: policy.qe, rmp: policy.rmp },
    tgaOpeningBn: raw.tgaOpeningMil != null && Number.isFinite(raw.tgaOpeningMil) ? raw.tgaOpeningMil / 1000 : null,
  };
}
