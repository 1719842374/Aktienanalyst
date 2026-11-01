/**
 * F10-22 Angebotsreaktion: Veränderung der Minenproduktion (NEM / Barrick / Agnico Eagle).
 *
 * Nur belegte Quartale aus den Quartalsberichten. Ein fehlendes Quartal bleibt n/a,
 * nichts wird geschätzt oder interpoliert. YoY nur gegen dasselbe Quartal ein Jahr
 * zuvor. Der Peer-Median gilt ab derselben Firmenzahl wie die AISC-Linie.
 * Kein GIS, kein Rating.
 */
import type { GoldAiscCompanyCode } from "./schema";
import { GOLD_AISC_COMPANY_CODES, GOLD_AISC_MIN_COMPANIES, quarterPeriodEnd } from "./gold-aisc";

export const GOLD_MINE_SUPPLY_PARAMS = {
  unit: "koz",
  /** Vier Quartale zurück = dasselbe Quartal im Vorjahr. */
  yoyLagQuarters: 4,
  minCompaniesForPeer: GOLD_AISC_MIN_COMPANIES,
  /** Ein einzelner Wert hat keinen Rang. */
  percentileMinSample: 2,
} as const;

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GoldMineProductionValue {
  company: GoldAiscCompanyCode;
  quarter: string;
  koz: number;
  sourceUrl: string;
  sourceTitle: string;
  sourceDate: string;
}

export interface GoldMineProductionFile {
  unit: string;
  basis: string;
  retrievedAt: string;
  reasonEmpty?: string;
  companies: Record<string, { name: string; ticker: string; metric: string }>;
  values: GoldMineProductionValue[];
}

export interface GoldMineSupplyRow {
  company: GoldAiscCompanyCode;
  name: string;
  quarter: string;
  koz: number;
  yoy: number | null;
  yoyReason: string | null;
  sourceUrl: string;
  sourceDate: string;
}

export interface GoldMineSupplyResponse {
  affectsScore: false;
  available: boolean;
  reason: string | null;
  unit: "koz";
  quarter: string | null;
  rows: GoldMineSupplyRow[];
  peerMedianYoy: number | null;
  peerMedianReason: string | null;
  peerSample: number;
  percentile: number | null;
  percentileReason: string | null;
  z: number | null;
  zReason: string | null;
  historyQuarters: number;
}

export function naReason(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("n/a")) return trimmed;
  return `n/a — ${trimmed}`;
}

export function quarterIndex(quarter: string): number | null {
  const match = QUARTER_RE.exec(quarter);
  if (!match) return null;
  return Number(match[1]) * 4 + (Number(match[2]) - 1);
}

export function addQuarters(quarter: string, delta: number): string | null {
  const index = quarterIndex(quarter);
  if (index == null) return null;
  const next = index + delta;
  if (next < 0) return null;
  const year = Math.floor(next / 4);
  const q = (next % 4) + 1;
  return `${year}-Q${q}`;
}

export function median(values: number[]): number | null {
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Anteil der Stichprobe, der höchstens `current` ist, in Prozent. `current` gehört zur Stichprobe. */
export function empiricalPercentile(current: number, sample: number[]): number | null {
  const values = sample.filter(value => Number.isFinite(value));
  if (!Number.isFinite(current) || values.length < GOLD_MINE_SUPPLY_PARAMS.percentileMinSample) return null;
  const atMost = values.filter(value => value <= current).length;
  return (atMost / values.length) * 100;
}

export function validateGoldMineProductionFile(file: GoldMineProductionFile): string[] {
  const errors: string[] = [];
  if (file?.unit !== GOLD_MINE_SUPPLY_PARAMS.unit) errors.push(`unit muss ${GOLD_MINE_SUPPLY_PARAMS.unit} sein`);
  if (!Array.isArray(file?.values)) {
    errors.push("values fehlt");
    return errors;
  }
  for (const code of GOLD_AISC_COMPANY_CODES) {
    if (!file.companies?.[code]?.name) errors.push(`companies.${code} fehlt`);
  }
  const seen = new Set<string>();
  for (let i = 0; i < file.values.length; i++) {
    const value = file.values[i];
    const at = `values[${i}] ${value?.company} ${value?.quarter}`;
    if (!GOLD_AISC_COMPANY_CODES.includes(value?.company)) errors.push(`${at}: unbekannte Firma`);
    if (!QUARTER_RE.test(String(value?.quarter))) {
      errors.push(`${at}: Quartal nicht im Format YYYY-Qn`);
      continue;
    }
    if (!(typeof value.koz === "number" && Number.isFinite(value.koz) && value.koz > 0)) {
      errors.push(`${at}: Menge keine positive Zahl`);
    }
    if (!/^https:\/\/\S+$/.test(String(value.sourceUrl))) errors.push(`${at}: sourceUrl fehlt`);
    if (!String(value.sourceTitle ?? "").trim()) errors.push(`${at}: sourceTitle fehlt`);
    if (!DATE_RE.test(String(value.sourceDate))) errors.push(`${at}: sourceDate fehlt`);
    else if (value.sourceDate <= quarterPeriodEnd(value.quarter)) {
      errors.push(`${at}: Quelle liegt nicht nach dem Quartalsende`);
    }
    const key = `${value.company} ${value.quarter}`;
    if (seen.has(key)) errors.push(`${at}: doppelt`);
    seen.add(key);
  }
  return errors;
}

function emptySupply(reason: string): GoldMineSupplyResponse {
  return {
    affectsScore: false,
    available: false,
    reason: naReason(reason),
    unit: "koz",
    quarter: null,
    rows: [],
    peerMedianYoy: null,
    peerMedianReason: null,
    peerSample: 0,
    percentile: null,
    percentileReason: null,
    z: null,
    zReason: null,
    historyQuarters: 0,
  };
}

function peerMedianFor(
  quarter: string,
  byKey: Map<string, GoldMineProductionValue>,
): { median: number | null; sample: number; reason: string | null } {
  const yoy: number[] = [];
  const priorQuarter = addQuarters(quarter, -GOLD_MINE_SUPPLY_PARAMS.yoyLagQuarters);
  for (const code of GOLD_AISC_COMPANY_CODES) {
    const current = byKey.get(`${code} ${quarter}`);
    const prior = priorQuarter ? byKey.get(`${code} ${priorQuarter}`) : undefined;
    if (!current || !prior || !(prior.koz > 0)) continue;
    yoy.push(current.koz / prior.koz - 1);
  }
  if (yoy.length < GOLD_MINE_SUPPLY_PARAMS.minCompaniesForPeer) {
    return {
      median: null,
      sample: yoy.length,
      reason: naReason(`weniger als ${GOLD_MINE_SUPPLY_PARAMS.minCompaniesForPeer} Produzenten mit Vorjahresquartal`),
    };
  }
  return { median: median(yoy), sample: yoy.length, reason: null };
}

export function buildGoldMineSupply(
  file: GoldMineProductionFile,
  zOf: (current: number, history: number[]) => number | null,
  zMinSample: number,
): GoldMineSupplyResponse {
  const errors = validateGoldMineProductionFile(file);
  if (errors.length > 0) return emptySupply(errors[0]);
  if (file.values.length === 0) {
    return emptySupply(file.reasonEmpty || "keine belegten Quartalsmengen (Newmont, Barrick, Agnico Eagle)");
  }

  const byKey = new Map<string, GoldMineProductionValue>();
  for (const value of file.values) byKey.set(`${value.company} ${value.quarter}`, value);
  const quarters = Array.from(new Set(file.values.map(value => value.quarter)))
    .filter(quarter => quarterIndex(quarter) != null)
    .sort((a, b) => (quarterIndex(a)! - quarterIndex(b)!));
  const latest = quarters[quarters.length - 1];

  const history: number[] = [];
  for (const quarter of quarters) {
    const peer = peerMedianFor(quarter, byKey);
    if (peer.median != null) history.push(peer.median);
  }

  const priorQuarter = addQuarters(latest, -GOLD_MINE_SUPPLY_PARAMS.yoyLagQuarters);
  const rows: GoldMineSupplyRow[] = [];
  for (const code of GOLD_AISC_COMPANY_CODES) {
    const current = byKey.get(`${code} ${latest}`);
    if (!current) continue;
    const prior = priorQuarter ? byKey.get(`${code} ${priorQuarter}`) : undefined;
    const yoy = prior && prior.koz > 0 ? current.koz / prior.koz - 1 : null;
    rows.push({
      company: code,
      name: file.companies[code]?.name ?? code,
      quarter: latest,
      koz: current.koz,
      yoy,
      yoyReason: yoy == null ? naReason("Vorjahresquartal fehlt") : null,
      sourceUrl: current.sourceUrl,
      sourceDate: current.sourceDate,
    });
  }

  const peer = peerMedianFor(latest, byKey);
  const percentile = peer.median == null ? null : empiricalPercentile(peer.median, history);
  const z = peer.median == null ? null : zOf(peer.median, history);
  return {
    affectsScore: false,
    available: rows.length > 0,
    reason: rows.length > 0 ? null : naReason("im letzten Quartal keine belegte Menge"),
    unit: "koz",
    quarter: latest,
    rows,
    peerMedianYoy: peer.median,
    peerMedianReason: peer.reason,
    peerSample: peer.sample,
    percentile,
    percentileReason: peer.median == null
      ? peer.reason
      : percentile == null
        ? naReason(`weniger als ${GOLD_MINE_SUPPLY_PARAMS.percentileMinSample} Peer-Quartale`)
        : null,
    z,
    zReason: peer.median == null
      ? peer.reason
      : z == null
        ? naReason(`Historie unter ${zMinSample} Beobachtungen`)
        : null,
    historyQuarters: history.length,
  };
}
