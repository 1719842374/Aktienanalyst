/**
 * C2 Liquidity regime — pure math (WALCL/RRP/TGA + optional M2 overlay).
 * Spec: WORK_RESEARCHER_LIQUIDITY_REGIME.md. Units: WALCL+TGA millions, RRPONTSYD billions.
 */
export interface FredObs {
  date: string;
  value: number;
}

export type RegimeLabel = "expansiv" | "neutral" | "restriktiv";

export interface AlignedPoint {
  date: string;
  walclBn: number;
  rrpBn: number;
  tgaBn: number;
  netBn: number;
}

export type PolicyRegime = "QT" | "QT_ended_RMP" | "QE" | "twist_treasury";
export type DurationImpulse = "easing" | "neutral" | "tightening";

export interface LiquidityMetrics {
  walclBn: number | null;
  rrpBn: number | null;
  tgaBn: number | null;
  netLiquidityBn: number | null;
  netLiquidityDelta13wBn: number | null;
  tgaDelta4wBn: number | null;
  m2YoY: number | null;
  velocity: number | null;
  excessMoneyGrowth: number | null;
  regimeScore: number;
  regimeLabel: RegimeLabel;
  /** v1-Score (0.5 Plumbing + 0.5 Spec) — beibehalten fuer Rueckwaertskompatibilitaet/Tests. */
  regimeScoreV1: number;
  policyScore: number;
  policyRegime: PolicyRegime;
  /** Treasury kauft Dauer, Cap mindestens 4 Mrd. Kein Personenname. */
  treasuryDurationActive: boolean;
  durationImpulse: DurationImpulse;
  asOf: string;
  source: string;
  dataQuality: {
    walcl: boolean;
    rrp: boolean;
    tga: boolean;
    m2: boolean;
  };
}

export function walclToBn(millions: number): number {
  return millions / 1000;
}

export function tgaToBn(millions: number): number {
  return millions / 1000;
}

export function rrpToBn(billions: number): number {
  return billions;
}

export function netLiquidityBn(walclBn: number, rrpBn: number, tgaBn: number): number {
  return walclBn - rrpBn - tgaBn;
}

function locfAt(obs: FredObs[], date: string): number | null {
  let last: number | null = null;
  for (const p of obs) {
    if (p.date <= date && Number.isFinite(p.value)) last = p.value;
    else if (p.date > date) break;
  }
  return last;
}

export function alignWeekly(
  walcl: FredObs[],
  rrp: FredObs[],
  tga: FredObs[],
): AlignedPoint[] {
  const w = [...walcl].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const r = [...rrp].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const t = [...tga].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const out: AlignedPoint[] = [];
  for (const p of w) {
    const rrpRaw = locfAt(r, p.date);
    const tgaRaw = locfAt(t, p.date);
    if (rrpRaw == null || tgaRaw == null) continue;
    const walclBn = walclToBn(p.value);
    const rrpBn = rrpToBn(rrpRaw);
    const tgaBn = tgaToBn(tgaRaw);
    out.push({ date: p.date, walclBn, rrpBn, tgaBn, netBn: netLiquidityBn(walclBn, rrpBn, tgaBn) });
  }
  return out;
}

export function delta13w(points: AlignedPoint[]): number | null {
  if (points.length < 14) return null;
  const a = points[points.length - 1].netBn;
  const b = points[points.length - 14].netBn;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b;
}

/** TGA-Delta ueber 4 Wochen (Mrd. USD). Fallend = Staat zahlt/Buyback aus Cash = Liquiditaet rein. */
export function tgaDelta4w(points: AlignedPoint[]): number | null {
  if (points.length < 5) return null;
  const a = points[points.length - 1].tgaBn;
  const b = points[points.length - 5].tgaBn;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return a - b;
}

/** Map 13-week net-liquidity change ($bn) to 0–100. */
export function plumbingScore(delta13wBn: number | null): number {
  if (delta13wBn == null || !Number.isFinite(delta13wBn)) return 50;
  const clamped = Math.max(-200, Math.min(200, delta13wBn));
  return Math.round(((clamped + 200) / 400) * 100);
}

export function excessMoneyGrowth(m2YoY: number, realGdpYoY: number, cpiYoY: number): number {
  return m2YoY - realGdpYoY - cpiYoY;
}

/** Spec Quellenkatalog §1: darunter bleibt EMG null (historischer Offset bei zu kurzem Fenster). */
export const EMG_MIN_MONTHLY = 24;
export const EMG_MIN_QUARTERLY = 20;

function finiteSortedObs(obs: FredObs[] | undefined): FredObs[] {
  return [...(obs ?? [])].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
}

function seriesIsQuarterly(obs: FredObs[]): boolean {
  if (obs.length < 2) return false;
  const last = obs[obs.length - 1];
  const prev = obs[obs.length - 2];
  const gapDays = (new Date(last.date).getTime() - new Date(prev.date).getTime()) / 86_400_000;
  return gapDays > 45;
}

export function emgHistoryOk(input: {
  m2?: FredObs[];
  cpi?: FredObs[];
  gdp?: FredObs[];
  m2v?: FredObs[];
}): boolean {
  const m2 = finiteSortedObs(input.m2);
  const cpi = finiteSortedObs(input.cpi);
  const gdp = finiteSortedObs(input.gdp);
  const m2v = finiteSortedObs(input.m2v);
  if (m2.length < EMG_MIN_MONTHLY || cpi.length < EMG_MIN_MONTHLY) return false;
  if (!seriesIsQuarterly(gdp) || gdp.length < EMG_MIN_QUARTERLY) return false;
  if (!seriesIsQuarterly(m2v) || m2v.length < EMG_MIN_QUARTERLY) return false;
  return true;
}

export function excessMoneyScore(excess: number): number {
  if (excess > 3) return Math.min(100, 90 + (excess - 3) * 2);
  if (excess >= 1) return 70 + ((excess - 1) / 2) * 19;
  if (excess >= -1) return 45 + ((excess + 1) / 2) * 24;
  return Math.max(0, 44 + (excess + 1) * 10);
}

export function friedmanKorridorScore(m2YoY: number): number {
  if (m2YoY >= 3 && m2YoY <= 5) return 80 + ((Math.min(m2YoY, 5) - 3) / 2) * 20;
  if ((m2YoY >= 5 && m2YoY <= 7) || (m2YoY >= 2 && m2YoY < 3)) {
    if (m2YoY >= 5) return 79 - ((m2YoY - 5) / 2) * 29;
    return 50 + ((m2YoY - 2) / 1) * 29;
  }
  if (m2YoY > 7) return Math.max(0, 49 - (m2YoY - 7) * 5);
  return Math.max(0, 49 - (2 - m2YoY) * 10);
}

export function velocityTrendScore(delta: number | null): number {
  if (delta == null || !Number.isFinite(delta)) return 55;
  if (delta > 0.02) return 85;
  if (delta < -0.02) return 25;
  return 55;
}

export function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 50;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function regimeFromScore(score: number): RegimeLabel {
  if (score >= 70) return "expansiv";
  if (score >= 40) return "neutral";
  return "restriktiv";
}

// ─── Policy-Kanal (v2) ──────────────────────────────────────────────────────────
// Klassisches Fed-QE (Notes/Bonds-Kauf) und ein Treasury-Kauf langer Anleihen
// sind beides Duration-Easing, aber verschiedene Aemter. Der Cap kommt vom
// Aufrufer aus einem belegten Instrument (office treasury, debt_operation,
// duration easing). Ohne diesen Cap gibt es keinen Twist.

export interface PolicyClassification {
  policyRegime: PolicyRegime;
  treasuryDurationActive: boolean;
  durationImpulse: DurationImpulse;
  policyScore: number;
}

/**
 * Classifier (Spec §6): QE nur wenn die Fed NOMINAL Notes/Bonds-Bestaende
 * aufbaut (Duration-Kauf) — NICHT wenn WALCL nur wegen T-Bill-RMP steigt.
 * QT-Ende: 1.12.2025 (Spec §3). Ohne notesBondsDelta13wBn-Signal (derzeit
 * nicht separat von FRED bezogen) wird konservativ NIE automatisch QE
 * inferiert — nur wenn der Aufrufer es explizit als stark positiv liefert.
 */
export function classifyPolicy(input: {
  notesBondsDelta13wBn?: number | null;
  buybackCapLongBnValue?: number | null;
  tgaDelta4wBn?: number | null;
  asOf: string;
}): PolicyClassification {
  const qe = (input.notesBondsDelta13wBn ?? 0) > 40;
  const twist = (input.buybackCapLongBnValue ?? 0) >= 4;
  const afterQtEnd = input.asOf >= "2025-12-01";

  const policyRegime: PolicyRegime = qe ? "QE" : twist ? "twist_treasury" : afterQtEnd ? "QT_ended_RMP" : "QT";
  const durationImpulse: DurationImpulse = qe || twist ? "easing" : afterQtEnd ? "neutral" : "tightening";

  // Basisskala (Spec §5.2 / Nachtrag §3): QT=25, QT_ended_RMP=55, QE=90.
  let policyScore =
    policyRegime === "QE" ? 90 :
    policyRegime === "QT_ended_RMP" ? 55 :
    policyRegime === "twist_treasury" ? 55 : // Twist ist kein eigener Basiswert in der Spec -> QT-Ende-Basis + Zuschlag unten
    25;

  // Additive Zuschlaege, Deckel 100.
  if (twist) policyScore += 10; // Long-Buybacks Cap >= 4 Mrd. 10-30y
  if ((input.tgaDelta4wBn ?? 0) < -50) policyScore += 10; // TGA 4W stark fallend = Drain raus, Liquiditaet rein
  policyScore = Math.max(0, Math.min(100, Math.round(policyScore)));

  return { policyRegime, treasuryDurationActive: twist, durationImpulse, policyScore };
}

/**
 * YoY-Berechnung, periodenrobust: erkennt anhand des Datumsabstands zwischen
 * den letzten beiden Beobachtungen, ob die Serie monatlich (z.B. M2SL,
 * CPIAUCSL) oder quartalsweise (z.B. GDPC1) ist, und schaut entsprechend
 * 12 oder 4 Punkte zurueck. Der alte hartkodierte Index-Offset -13 nahm
 * IMMER 12 monatliche Schritte an -- bei GDPC1 (nur 4 Punkte/Jahr) und dem
 * 30-Monats-FRED-Fenster (~10 Punkte) war das nie erreichbar, wodurch EMG/
 * Friedman/Velocity-Trend live IMMER null blieben und der Score auf reinen
 * Plumbing zurueckfiel -- verifiziert am Live-Server: excessMoneyGrowth=null
 * trotz vollstaendiger m2/gdp/cpi-Rohdaten von FRED.
 */
export function yoyFromMonthly(obs: FredObs[]): { latest: number; date: string } | null {
  const o = [...obs].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (o.length < 2) return null;
  const last = o[o.length - 1];
  const prev = o[o.length - 2];
  const gapDays = (new Date(last.date).getTime() - new Date(prev.date).getTime()) / 86_400_000;
  const isQuarterly = gapDays > 45; // Monats-Serien haben ~28-31 Tage Abstand, Quartals-Serien ~90
  const stepsBack = isQuarterly ? 4 : 12;
  if (o.length < stepsBack + 1) return null;
  const ago = o[o.length - 1 - stepsBack];
  if (!ago.value) return null;
  return { latest: ((last.value - ago.value) / ago.value) * 100, date: last.date };
}

export function latestLevel(obs: FredObs[]): { value: number; date: string } | null {
  const o = [...obs].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (o.length === 0) return null;
  const last = o[o.length - 1];
  return { value: last.value, date: last.date };
}

export function velocityDelta(obs: FredObs[]): number | null {
  const o = [...obs].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  if (o.length < 5) return null;
  return o[o.length - 1].value - o[o.length - 5].value;
}

export function computeLiquidityMetrics(input: {
  walcl: FredObs[];
  rrp: FredObs[];
  tga: FredObs[];
  m2?: FredObs[];
  m2v?: FredObs[];
  gdp?: FredObs[];
  cpi?: FredObs[];
  /** Obergrenze in Mrd. aus einem belegten Treasury-Instrument. Leer = kein Twist. */
  treasuryBuybackCapBn?: number | null;
}): LiquidityMetrics {
  const aligned = alignWeekly(input.walcl, input.rrp, input.tga);
  const last = aligned.length ? aligned[aligned.length - 1] : null;
  const d13 = delta13w(aligned);
  const pipe = plumbingScore(d13);

  const m2 = input.m2 ? yoyFromMonthly(input.m2) : null;
  const gdp = input.gdp ? yoyFromMonthly(input.gdp) : null;
  const cpi = input.cpi ? yoyFromMonthly(input.cpi) : null;
  const vel = input.m2v ? latestLevel(input.m2v) : null;
  const velDelta = input.m2v ? velocityDelta(input.m2v) : null;

  const windowOk = emgHistoryOk(input);
  let excess: number | null = null;
  let scoreV1 = pipe;
  if (m2 && gdp && cpi && windowOk) {
    excess = excessMoneyGrowth(m2.latest, gdp.latest, cpi.latest);
    const spec =
      0.40 * excessMoneyScore(excess) +
      0.30 * friedmanKorridorScore(m2.latest) +
      0.20 * velocityTrendScore(velDelta) +
      0.10 * pipe;
    scoreV1 = 0.5 * pipe + 0.5 * spec;
  }

  const asOf = last?.date || m2?.date || new Date().toISOString().slice(0, 10);
  const tgaD4 = tgaDelta4w(aligned);

  // Policy-Kanal (v2, Spec §5.2/Nachtrag §4): 0.45 Plumbing + 0.35 Spec + 0.20 Policy.
  // notesBondsDelta13wBn wird bewusst nicht separat von FRED bezogen (kein
  // eigenes SOMA-Notes/Bonds-Signal in diesem Modul) -> Classifier faellt auf
  // twist/QT_ended_RMP/QT zurueck, nie automatisch QE ohne explizites Signal.
  const specV2Component = (m2 && gdp && cpi && windowOk && excess != null)
    ? 0.40 * excessMoneyScore(excess) + 0.30 * friedmanKorridorScore(m2.latest) + 0.20 * velocityTrendScore(velDelta) + 0.10 * pipe
    : pipe;
  const policy = classifyPolicy({
    buybackCapLongBnValue: input.treasuryBuybackCapBn ?? null,
    tgaDelta4wBn: tgaD4,
    asOf,
  });
  const scoreV2 = 0.45 * pipe + 0.35 * specV2Component + 0.20 * policy.policyScore;

  const regimeScoreV1 = clampScore(scoreV1);
  const regimeScore = clampScore(scoreV2);
  return {
    walclBn: last ? round1(last.walclBn) : null,
    rrpBn: last ? round1(last.rrpBn) : null,
    tgaBn: last ? round1(last.tgaBn) : null,
    netLiquidityBn: last ? round1(last.netBn) : null,
    netLiquidityDelta13wBn: d13 == null ? null : round1(d13),
    tgaDelta4wBn: tgaD4 == null ? null : round1(tgaD4),
    m2YoY: m2 ? round2(m2.latest) : null,
    velocity: vel ? round3(vel.value) : null,
    excessMoneyGrowth: excess == null ? null : round2(excess),
    regimeScore,
    regimeLabel: regimeFromScore(regimeScore),
    regimeScoreV1,
    policyScore: policy.policyScore,
    policyRegime: policy.policyRegime,
    treasuryDurationActive: policy.treasuryDurationActive,
    durationImpulse: policy.durationImpulse,
    asOf,
    source: "FRED WALCL + RRPONTSYD + WTREGEN",
    dataQuality: {
      walcl: (input.walcl?.length ?? 0) > 0,
      rrp: (input.rrp?.length ?? 0) > 0,
      tga: (input.tga?.length ?? 0) > 0,
      m2: !!m2,
    },
  };
}

/**
 * Display-Hint der letzten Cap-Veröffentlichung. Kein Input von classifyPolicy und kein Input von S.
 * Spec: „letzte Veröffentlichung Cap=4 ab 09.09.“, Fenster bis 04.11.2026.
 */
export const BESSENT_WINDOW = {
  from: "2026-09-09",
  to: "2026-11-04",
  capBn: 4,
} as const;

export function bessentWindowHint(asOf: string): string | null {
  if (asOf > BESSENT_WINDOW.to) return null;
  return "letzte Veröffentlichung Cap=4 ab 09.09.";
}

/**
 * Twin von classifyPolicy. QE/RMP sind Labels aus z(ΔB^n) und z(ΔWSHOBL), nicht aus dem Kalender.
 * Das Desk-Flag kommt von der Operations-API. Ohne Historie: available false, kein Regime.
 */
export function classifyPolicyFromOps(input: {
  zNotes13w: number | null;
  notesDelta13wBn: number | null;
  zBills13w: number | null;
  deskFlag: 0 | 1;
}): { available: boolean; qe: boolean; rmp: boolean; deskFlag: 0 | 1; label: "QE" | "RMP" | null } {
  const ready = input.zNotes13w != null && input.notesDelta13wBn != null && input.zBills13w != null
    && Number.isFinite(input.zNotes13w) && Number.isFinite(input.notesDelta13wBn) && Number.isFinite(input.zBills13w);
  if (!ready) {
    return { available: false, qe: false, rmp: false, deskFlag: input.deskFlag, label: null };
  }
  const qe = input.zNotes13w > 1.5 && input.notesDelta13wBn > 0;
  const rmp = input.zBills13w > 1.5 && input.zNotes13w <= 0.5;
  return { available: true, qe, rmp, deskFlag: input.deskFlag, label: qe ? "QE" : rmp ? "RMP" : null };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
