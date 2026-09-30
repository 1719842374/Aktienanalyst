/**
 * Politikkanal ohne Personen- und ohne Gesetzesnamen im Code.
 * Ein Instrument wirkt nur mit Amt, Status und Beleg. Die Halbwertzeit
 * haengt am einzelnen Datensatz, nicht an einer Kalenderkonstante.
 */

export const POLICY_OFFICES = ["treasury", "central_bank", "legislature", "regulator"] as const;
export const POLICY_TYPES = ["statute", "fiscal_program", "debt_operation"] as const;
export const POLICY_STATUSES = [
  "proposed", "advanced", "enacted", "implementing", "rejected", "expired", "uncertain",
] as const;
export const CHANNEL_DIRECTIONS = ["up", "down", "unclear"] as const;
export const DURATION_DIRECTIONS = ["easing", "tightening", "neutral"] as const;
export const MAGNITUDE_KINDS = ["cap_bn", "share", "score", "yield_bp"] as const;

export type PolicyOffice = (typeof POLICY_OFFICES)[number];
export type PolicyType = (typeof POLICY_TYPES)[number];
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export interface PolicyEvidence {
  source: string;
  url: string;
  date: string;
}

export interface PolicyMagnitude {
  kind: (typeof MAGNITUDE_KINDS)[number];
  value: number;
  unit: string;
  /** Nur bei kind "share": welches Reservevehikel, z.B. USDT oder USDC. */
  issuer?: string;
}

export interface PolicyInstrument {
  id: string;
  jurisdiction: string;
  office: PolicyOffice;
  instrumentType: PolicyType;
  status: PolicyStatus;
  /** Anzeigetext. Die Formel liest ihn nicht. */
  title?: string;
  /** Anzeigetext. Die Formel liest ihn nicht. */
  officeHolder?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  /** Naechster Entscheidungstermin. Setzt die Halbwertzeit, wenn vorhanden. */
  decisionDate?: string;
  halfLifeDays?: number;
  channels: {
    tBillDemand?: "up" | "down" | "unclear";
    longYield?: "up" | "down" | "unclear";
    m2?: "up" | "down" | "unclear";
    cryptoLiquidity?: "up" | "down" | "unclear";
    duration?: "easing" | "tightening" | "neutral";
  };
  magnitude?: PolicyMagnitude;
  /** Vom Modell genannte erwartete Renditebewegung in Basispunkten, vorzeichenbehaftet. */
  expectedMoveBp?: number;
  evidence: PolicyEvidence[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ACTIVE = new Set<PolicyStatus>(["enacted", "implementing"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : null;
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function parseEvidence(raw: unknown): PolicyEvidence | null {
  const row = asRecord(raw);
  if (!row) return null;
  const source = typeof row.source === "string" ? row.source.trim() : "";
  const url = typeof row.url === "string" ? row.url.trim() : "";
  const date = typeof row.date === "string" ? row.date.trim() : "";
  if (!source || !DATE.test(date) || !/^https?:\/\//i.test(url)) return null;
  return { source, url, date };
}

function parseMagnitude(raw: unknown): PolicyMagnitude | undefined {
  const row = asRecord(raw);
  if (!row) return undefined;
  const kind = oneOf(row.kind, MAGNITUDE_KINDS);
  const value = finite(row.value);
  const unit = typeof row.unit === "string" ? row.unit.trim() : "";
  if (!kind || value == null || !unit) return undefined;
  const issuer = typeof row.issuer === "string" ? row.issuer.trim().toUpperCase() : undefined;
  return { kind, value, unit, ...(issuer ? { issuer } : {}) };
}

/** Wirft Datensaetze ohne Amt, Status oder Beleg weg. */
export function parsePolicyInstruments(raw: unknown): { instruments: PolicyInstrument[]; dropped: number } {
  const root = asRecord(raw);
  const list = Array.isArray(raw) ? raw : Array.isArray(root?.instruments) ? root!.instruments as unknown[] : [];
  const instruments: PolicyInstrument[] = [];
  let dropped = 0;
  for (const item of list) {
    const row = asRecord(item);
    if (!row) { dropped++; continue; }
    const office = oneOf(row.office, POLICY_OFFICES);
    const instrumentType = oneOf(row.instrumentType, POLICY_TYPES);
    const status = oneOf(row.status, POLICY_STATUSES);
    const evidence = (Array.isArray(row.evidence) ? row.evidence : [])
      .map(parseEvidence)
      .filter((e): e is PolicyEvidence => e != null);
    if (!office || !instrumentType || !status || evidence.length === 0) {
      dropped++;
      continue;
    }
    const channelsRaw = asRecord(row.channels) ?? {};
    const channels: PolicyInstrument["channels"] = {};
    const tBill = oneOf(channelsRaw.tBillDemand, CHANNEL_DIRECTIONS);
    const longYield = oneOf(channelsRaw.longYield, CHANNEL_DIRECTIONS);
    const m2 = oneOf(channelsRaw.m2, CHANNEL_DIRECTIONS);
    const cryptoLiquidity = oneOf(channelsRaw.cryptoLiquidity, CHANNEL_DIRECTIONS);
    const duration = oneOf(channelsRaw.duration, DURATION_DIRECTIONS);
    if (tBill) channels.tBillDemand = tBill;
    if (longYield) channels.longYield = longYield;
    if (m2) channels.m2 = m2;
    if (cryptoLiquidity) channels.cryptoLiquidity = cryptoLiquidity;
    if (duration) channels.duration = duration;
    const id = typeof row.id === "string" && row.id.trim() ? row.id.trim() : `${office}:${instrumentType}:${evidence[0].date}`;
    const jurisdiction = typeof row.jurisdiction === "string" && row.jurisdiction.trim() ? row.jurisdiction.trim() : "US";
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 180) : "";
    const officeHolder = typeof row.officeHolder === "string" ? row.officeHolder.trim() : undefined;
    const effectiveFrom = typeof row.effectiveFrom === "string" && DATE.test(row.effectiveFrom) ? row.effectiveFrom : undefined;
    const effectiveTo = typeof row.effectiveTo === "string" && DATE.test(row.effectiveTo) ? row.effectiveTo : undefined;
    const decisionDate = typeof row.decisionDate === "string" && DATE.test(row.decisionDate) ? row.decisionDate : undefined;
    const halfLifeDaysRaw = finite(row.halfLifeDays);
    const halfLifeDays = halfLifeDaysRaw != null && halfLifeDaysRaw > 0 ? halfLifeDaysRaw : undefined;
    const expectedMoveBp = finite(row.expectedMoveBp);
    const magnitude = parseMagnitude(row.magnitude);
    instruments.push({
      id, jurisdiction, office, instrumentType, status, channels, evidence,
      ...(title ? { title } : {}),
      ...(officeHolder ? { officeHolder } : {}),
      ...(effectiveFrom ? { effectiveFrom } : {}),
      ...(effectiveTo ? { effectiveTo } : {}),
      ...(decisionDate ? { decisionDate } : {}),
      ...(halfLifeDays != null ? { halfLifeDays } : {}),
      ...(expectedMoveBp != null ? { expectedMoveBp } : {}),
      ...(magnitude ? { magnitude } : {}),
    });
  }
  return { instruments, dropped };
}

export interface RegulationNote {
  id: string;
  title: string;
  jurisdiction: string;
  office: PolicyOffice;
  status: PolicyStatus;
  /** cited nur mit https-Beleg. Sonst estimated, und der Score bleibt unberuehrt. */
  confidence: "cited" | "estimated";
  channels: PolicyInstrument["channels"];
  note?: string;
  evidence: PolicyEvidence[];
}

function noteId(raw: string, title: string): string {
  const given = raw.trim();
  if (given) return given.slice(0, 80);
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return slug || "regel";
}

/**
 * Anzeige fuer den KI-Button. Ohne URL bleibt der Eintrag estimated.
 * Diese Liste fliesst nicht in statuteContribution.
 */
export function parseRegulationNotes(raw: unknown): { regulations: RegulationNote[]; dropped: number } {
  const root = asRecord(raw);
  const list = Array.isArray(root?.regulations) ? root!.regulations as unknown[] : [];
  const regulations: RegulationNote[] = [];
  let dropped = 0;
  for (const item of list) {
    if (regulations.length >= 6) { dropped++; continue; }
    const row = asRecord(item);
    if (!row) { dropped++; continue; }
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 180) : "";
    const office = oneOf(row.office, POLICY_OFFICES);
    if (title.length < 2 || !office) { dropped++; continue; }
    const status = oneOf(row.status, POLICY_STATUSES) ?? "uncertain";
    const evidence = (Array.isArray(row.evidence) ? row.evidence : [])
      .map(parseEvidence)
      .filter((e): e is PolicyEvidence => e != null);
    const confidence: RegulationNote["confidence"] = evidence.length > 0 ? "cited" : "estimated";
    const channelsRaw = asRecord(row.channels) ?? {};
    const channels: PolicyInstrument["channels"] = {};
    const tBill = oneOf(channelsRaw.tBillDemand, CHANNEL_DIRECTIONS);
    const longYield = oneOf(channelsRaw.longYield, CHANNEL_DIRECTIONS);
    const m2 = oneOf(channelsRaw.m2, CHANNEL_DIRECTIONS);
    const cryptoLiquidity = oneOf(channelsRaw.cryptoLiquidity, CHANNEL_DIRECTIONS);
    const duration = oneOf(channelsRaw.duration, DURATION_DIRECTIONS);
    if (tBill) channels.tBillDemand = tBill;
    if (longYield) channels.longYield = longYield;
    if (m2) channels.m2 = m2;
    if (cryptoLiquidity) channels.cryptoLiquidity = cryptoLiquidity;
    if (duration) channels.duration = duration;
    const note = typeof row.note === "string" ? row.note.trim().slice(0, 400) : "";
    const jurisdiction = typeof row.jurisdiction === "string" && row.jurisdiction.trim()
      ? row.jurisdiction.trim()
      : "US";
    const idRaw = typeof row.id === "string" ? row.id : "";
    regulations.push({
      id: noteId(idRaw, title),
      title,
      jurisdiction,
      office,
      status,
      confidence,
      channels,
      evidence,
      ...(note ? { note } : {}),
    });
  }
  return { regulations, dropped };
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

export function inForce(inst: PolicyInstrument, asOf: string): boolean {
  if (!ACTIVE.has(inst.status)) return false;
  if (inst.effectiveFrom && asOf < inst.effectiveFrom) return false;
  if (inst.effectiveTo && asOf > inst.effectiveTo) return false;
  return true;
}

/**
 * Restimpuls = (1 - pricedIn) * 0.5 ^ (Tage / Halbwertzeit).
 * rejected und expired sind sofort 0. Ohne Belegdatum bleibt alles leer.
 */
export function priceInInstrument(inst: PolicyInstrument, asOf: string, observedMoveBp: number | null): {
  pricedInPct: number | null;
  halfLifeDays: number | null;
  residual: number | null;
  clockStart: string | null;
} {
  if (inst.status === "rejected" || inst.status === "expired") {
    return { pricedInPct: null, halfLifeDays: null, residual: 0, clockStart: null };
  }
  const evidenceDate = inst.evidence.map(e => e.date).sort()[0];
  if (!evidenceDate) return { pricedInPct: null, halfLifeDays: null, residual: null, clockStart: null };
  const clockStart = ACTIVE.has(inst.status) && inst.effectiveFrom ? inst.effectiveFrom : evidenceDate;
  let halfLifeDays: number | null = null;
  if (inst.decisionDate) {
    const span = daysBetween(clockStart, inst.decisionDate);
    if (span > 0) halfLifeDays = span;
  }
  if (halfLifeDays == null && inst.halfLifeDays != null && inst.halfLifeDays > 0) {
    halfLifeDays = inst.halfLifeDays;
  }
  let pricedInPct: number | null = null;
  if (observedMoveBp != null && inst.expectedMoveBp != null && inst.expectedMoveBp !== 0 && Number.isFinite(observedMoveBp)) {
    const ratio = observedMoveBp / inst.expectedMoveBp;
    pricedInPct = Math.max(0, Math.min(100, Math.round(ratio * 1000) / 10));
  }
  if (halfLifeDays == null || pricedInPct == null) {
    return { pricedInPct, halfLifeDays, residual: null, clockStart };
  }
  const elapsed = Math.max(0, daysBetween(clockStart, asOf));
  const residual = (1 - pricedInPct / 100) * Math.pow(0.5, elapsed / halfLifeDays);
  return { pricedInPct, halfLifeDays, residual: Math.round(residual * 1000) / 1000, clockStart };
}

/** Treasury-Kauf langer Anleihen: Amt treasury, Typ debt_operation, Duration easing, Cap in Mrd. */
export function activeTreasuryBuybackCapBn(instruments: PolicyInstrument[], asOf: string): number | null {
  let cap: number | null = null;
  for (const inst of instruments) {
    if (inst.office !== "treasury" || inst.instrumentType !== "debt_operation") continue;
    if (inst.channels.duration !== "easing") continue;
    if (!inForce(inst, asOf)) continue;
    if (inst.magnitude?.kind !== "cap_bn") continue;
    cap = Math.max(cap ?? 0, inst.magnitude.value);
  }
  return cap;
}

export interface ReserveShares {
  tether: number | null;
  usdc: number | null;
  evidenced: boolean;
}

/** Anteile nur aus einem Beleg. Ohne Beleg bleibt der T-Bill-Bedarf leer. */
export function evidencedReserveShares(instruments: PolicyInstrument[], asOf: string): ReserveShares {
  let tether: number | null = null;
  let usdc: number | null = null;
  for (const inst of instruments) {
    if (!inForce(inst, asOf)) continue;
    if (inst.magnitude?.kind !== "share") continue;
    const issuer = inst.magnitude.issuer;
    if (issuer === "USDT") tether = inst.magnitude.value;
    if (issuer === "USDC") usdc = inst.magnitude.value;
  }
  return { tether, usdc, evidenced: tether != null || usdc != null };
}

/** Gesetzlicher Score nur solange enacted oder implementing. Ablehnung ist 0. */
export function statuteContribution(
  instruments: PolicyInstrument[],
  asOf: string,
  observedMoveBp: number | null | ((inst: PolicyInstrument) => number | null),
): {
  score: number | null;
  residual: number | null;
  contribution: number;
} {
  let score: number | null = null;
  let residual: number | null = null;
  let contribution = 0;
  let inForceCount = 0;
  for (const inst of instruments) {
    if (inst.instrumentType !== "statute") continue;
    if (inst.status === "rejected" || inst.status === "expired") continue;
    if (!inForce(inst, asOf)) continue;
    if (inst.magnitude?.kind !== "score") continue;
    const move = typeof observedMoveBp === "function" ? observedMoveBp(inst) : observedMoveBp;
    const priced = priceInInstrument(inst, asOf, move);
    score = inst.magnitude.value;
    residual = priced.residual;
    inForceCount++;
    if (priced.residual != null) contribution += inst.magnitude.value * priced.residual;
  }
  return {
    score: inForceCount === 1 ? score : null,
    residual: inForceCount === 1 ? residual : null,
    contribution: Math.round(contribution * 1000) / 1000,
  };
}
