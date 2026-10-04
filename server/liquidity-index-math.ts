/**
 * One mixer for CATALOG.US, .EU and .ASIA. No regime calendar.
 * s(z) = 50 + 50 * clip(z/2, -1, 1). Weights are inverse vol.
 */
import { CATALOG, type CatalogBook, type Region, type Role, type SeriesSpec } from "./liquidity-index-catalog";

export const H_MIN = 12;

export interface Obs {
  date: string;
  value: number;
}

export interface SeriesBundle {
  points: Obs[];
  /** Companion series stored under the same cache key (SOMA bills). */
  parts?: Record<string, Obs[]>;
}

export interface BookSlot {
  id: string;
  role: Role;
  book: CatalogBook;
  cacheKey: string;
  available: boolean;
  x: number | null;
  score: number | null;
  asOf: string | null;
  series: string[];
}

export interface Discovered {
  cbBuying: boolean;
  cbQT: boolean;
  fiscalFlood: boolean;
  qeLike: boolean;
  qtLike: boolean;
  rmpLike: boolean;
}

export interface LiquidityBooksPayload {
  region: Region;
  asOf: string | null;
  li: number | null;
  label: "expansiv" | "neutral" | "restriktiv" | null;
  books: { M: BookSlot[]; F: BookSlot[] };
  money: BookSlot[];
  discovered: Discovered;
  source: string;
}

export function sOfZ(z: number): number {
  const clipped = Math.max(-1, Math.min(1, z / 2));
  return Math.round(50 + 50 * clipped);
}

export function jpnAssetsToTn(rawHundredMillionYen: number): number {
  return Math.round((rawHundredMillionYen / 10_000) * 100) / 100;
}

/** APP Δ + PEPP Δ, rounded to 0.1 bn. July 2026 fixture: -27.17 + -24.82 = -52.0. */
export function policyBookDelta(appBn: number, peppBn: number): number {
  return Math.round((appBn + peppBn) * 10) / 10;
}

export function labelFromLi(li: number): "expansiv" | "neutral" | "restriktiv" {
  if (li >= 70) return "expansiv";
  if (li >= 40) return "neutral";
  return "restriktiv";
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function mixInverseVol(slots: { score: number; sigma: number; weightCap?: number }[]): number | null {
  const rows = slots.filter(s => Number.isFinite(s.score) && Number.isFinite(s.sigma));
  if (!rows.length) return null;
  const raw = rows.map(s => 1 / (Math.max(0, s.sigma) + 1e-9));
  const caps = rows.map(s => s.weightCap ?? 1);
  const total = raw.reduce((a, b) => a + b, 0);
  const shares = raw.map(w => w / total);
  const pinned = rows.map(() => false);
  for (let iter = 0; iter < rows.length; iter++) {
    let pinnedSum = 0;
    let changed = false;
    for (let i = 0; i < shares.length; i++) {
      if (!pinned[i] && shares[i] > caps[i] + 1e-9) {
        shares[i] = caps[i];
        pinned[i] = true;
        changed = true;
      }
      if (pinned[i]) pinnedSum += shares[i];
    }
    if (!changed) break;
    const free = shares.map((_, i) => i).filter(i => !pinned[i]);
    const freeRaw = free.reduce((a, i) => a + raw[i], 0);
    const room = Math.max(0, 1 - pinnedSum);
    for (const i of free) shares[i] = freeRaw > 0 ? (raw[i] / freeRaw) * room : 0;
  }
  const li = shares.reduce((sum, share, i) => sum + share * rows[i].score, 0);
  return Math.round(li * 10) / 10;
}

export function discoverBooks(input: {
  policyZ: number | null;
  policyDelta: number | null;
  issuanceZ: number | null;
  billsZ?: number | null;
  notesZ?: number | null;
  assetsZ?: number | null;
  assetsDelta?: number | null;
}): Discovered {
  const policyZ = input.policyZ;
  const policyDelta = input.policyDelta;
  const billsZ = input.billsZ ?? null;
  const notesZ = input.notesZ ?? null;
  const assetsZ = input.assetsZ ?? null;
  const assetsDelta = input.assetsDelta ?? null;
  return {
    cbBuying: policyZ != null && policyDelta != null && policyZ > 1 && policyDelta > 0,
    cbQT: policyZ != null && policyDelta != null && policyZ < -1 && policyDelta < 0,
    fiscalFlood: input.issuanceZ != null && input.issuanceZ > 1,
    qeLike: assetsZ != null && assetsDelta != null && assetsZ > 1.5 && assetsDelta > 0,
    qtLike: assetsZ != null && assetsDelta != null && assetsZ < -1 && assetsDelta < 0,
    rmpLike: billsZ != null && notesZ != null && billsZ > 1.5 && notesZ <= 0.5,
  };
}

function sorted(points: Obs[]): Obs[] {
  return [...points].filter(p => Number.isFinite(p.value) && /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function atOrBefore(points: Obs[], date: string): Obs | null {
  let last: Obs | null = null;
  for (const p of points) {
    if (p.date <= date) last = p;
    else break;
  }
  return last;
}

function windowDays(role: Role): number | "yoy" {
  if (role === "money") return "yoy";
  if (role === "rate") return 90;
  if (role === "policyPortfolio" || role === "netIssuance" || role === "buybacks") return 30;
  return 91;
}

interface Impulse {
  x: number;
  asOf: string;
  history: number[];
}

function deltaImpulse(points: Obs[], days: number): Impulse | null {
  const pts = sorted(points);
  if (pts.length < 2) return null;
  const history: number[] = [];
  let asOf = pts[pts.length - 1].date;
  for (const p of pts) {
    const prev = atOrBefore(pts, addDays(p.date, -days));
    if (!prev || prev.date === p.date) continue;
    history.push(p.value - prev.value);
    asOf = p.date;
  }
  if (!history.length) return null;
  return { x: history[history.length - 1], asOf, history };
}

function yoyImpulse(points: Obs[], alreadyPercent: boolean): Impulse | null {
  const pts = sorted(points);
  if (!pts.length) return null;
  if (alreadyPercent) {
    return { x: pts[pts.length - 1].value, asOf: pts[pts.length - 1].date, history: pts.map(p => p.value) };
  }
  const history: number[] = [];
  let asOf = pts[pts.length - 1].date;
  for (const p of pts) {
    const prev = atOrBefore(pts, addDays(p.date, -365));
    if (!prev || prev.date === p.date || prev.value === 0) continue;
    history.push(((p.value - prev.value) / Math.abs(prev.value)) * 100);
    asOf = p.date;
  }
  if (!history.length) return null;
  return { x: history[history.length - 1], asOf, history };
}

function impulseFor(spec: SeriesSpec, points: Obs[]): Impulse | null {
  const window = windowDays(spec.role);
  if (window === "yoy") return yoyImpulse(points, spec.unit === "pct");
  return deltaImpulse(points, window);
}

interface Scored {
  slot: BookSlot;
  sigma: number | null;
  rawZ: number | null;
  rawX: number | null;
  weightCap?: number;
}

function emptySlot(spec: SeriesSpec): Scored {
  return {
    slot: {
      id: spec.id,
      role: spec.role,
      book: spec.book,
      cacheKey: spec.cacheKey,
      available: false,
      x: null,
      score: null,
      asOf: null,
      series: [spec.id],
    },
    sigma: null,
    rawZ: null,
    rawX: null,
    weightCap: spec.weightCap,
  };
}

function scoreSpec(spec: SeriesSpec, bundle: SeriesBundle | undefined): Scored {
  const base = emptySlot(spec);
  if (!bundle) return base;
  const impulse = impulseFor(spec, bundle.points);
  if (!impulse) return base;
  base.slot.x = Math.round(impulse.x * 10) / 10;
  base.slot.asOf = impulse.asOf;
  if (impulse.history.length < H_MIN) return base;
  const signed = impulse.history.map(v => spec.sign * v);
  const mu = mean(signed);
  const sigma = sampleStdev(signed);
  const zSigned = (spec.sign * impulse.x - mu) / (sigma + 1e-9);
  const muRaw = mean(impulse.history);
  const sigmaRaw = sampleStdev(impulse.history);
  const zRaw = (impulse.x - muRaw) / (sigmaRaw + 1e-9);
  base.slot.available = true;
  base.slot.score = sOfZ(zSigned);
  base.sigma = sigma;
  base.rawZ = zRaw;
  base.rawX = impulse.x;
  base.weightCap = spec.weightCap;
  return base;
}

function zOf(points: Obs[] | undefined, role: Role): { z: number; x: number } | null {
  if (!points?.length) return null;
  const window = windowDays(role);
  const impulse = window === "yoy" ? yoyImpulse(points, false) : deltaImpulse(points, window);
  if (!impulse || impulse.history.length < H_MIN) return null;
  const mu = mean(impulse.history);
  const sigma = sampleStdev(impulse.history);
  return { z: (impulse.x - mu) / (sigma + 1e-9), x: impulse.x };
}

export function scoreCatalog(region: Region, bundles: Record<string, SeriesBundle | undefined>): LiquidityBooksPayload {
  const specs = CATALOG[region];
  const scored = specs.map(spec => scoreSpec(spec, bundles[spec.cacheKey]));
  const li = mixInverseVol(scored.filter(s => s.slot.available && s.sigma != null && s.slot.score != null).map(s => ({
    score: s.slot.score as number,
    sigma: s.sigma as number,
    weightCap: s.weightCap,
  })));
  const policy = scored.find(s => s.slot.role === "policyPortfolio");
  const issuance = scored.find(s => s.slot.role === "netIssuance" && s.rawZ != null);
  const assets = scored.find(s => s.slot.role === "assets");
  const soma = bundles["liqidx_US__soma"];
  const bills = zOf(soma?.parts?.bills, "policyPortfolio");
  const notes = zOf(soma?.points, "policyPortfolio");
  const booksM = scored.filter(s => s.slot.book === "M").map(s => s.slot);
  const booksF = scored.filter(s => s.slot.book === "F").map(s => s.slot);
  const money = scored.filter(s => s.slot.book === "C").map(s => s.slot);
  const asOfs = [...booksM, ...booksF, ...money].map(s => s.asOf).filter((d): d is string => !!d).sort();
  return {
    region,
    asOf: asOfs[0] ?? null,
    li,
    label: li == null ? null : labelFromLi(li),
    books: { M: booksM, F: booksF },
    money,
    discovered: discoverBooks({
      policyZ: policy?.rawZ ?? null,
      policyDelta: policy?.rawX ?? null,
      issuanceZ: issuance?.rawZ ?? null,
      billsZ: bills?.z ?? null,
      notesZ: notes?.z ?? null,
      assetsZ: assets?.rawZ ?? null,
      assetsDelta: assets?.rawX ?? null,
    }),
    source: `liqidx ${region} ${specs.map(s => s.cacheKey).join(" ")}`,
  };
}
