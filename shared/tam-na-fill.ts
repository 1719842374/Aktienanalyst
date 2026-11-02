/**
 * Session-only KI fill for Segment-TAM N/A cells (Spec v2).
 *
 * Pure validation + local derivation. This module does not touch
 * TAM_CATALOG, matchSegmentTAM, assessTamQuality, coveragePct, tamTotal,
 * segmentWeightedGrowth, or the DCF gate.
 *
 * marketShare (Anteil am TAM) and vs-TAM (outperforming) are formula-only.
 * They are never taken from the model.
 *
 * Rows with revenue null or 0 are outside the table and the fill scope.
 * A fill is applied when it closes at least one in-scope cell. Other cells stay n/a.
 */

import { percentile, SEGMENT_NAME_STOPWORDS } from "./segment-growth-calc";

export const TAM_NA_SHARE_WARN = 25; // display badge only; mirrors TAM_SHARE_WARN, not a quality input

/** Section7 table header, German labels, in column order. */
export const TAM_NA_COLUMN_HEADER = "Segment | Rev. | Anteil | Wachstum | TAM | CAGR | Anteil am TAM | vs. TAM";

const TAM_SIZE_MAX_BN = 100_000;
const CAGR_MIN = -30;
const CAGR_MAX = 80;
/** Spec v2: segmentGrowth outside this window is dropped, not clamped into range. */
export const SEGMENT_GROWTH_MIN = -80;
export const SEGMENT_GROWTH_MAX = 200;

const FACT_MARK = "(Fact, nicht überschreiben)";

export interface TamNaSegmentRef {
  segmentName: string;
  /** Segment revenue in $B (already the fact figure shown in the table). */
  segmentRevenue: number;
  /** Reported YoY %. null = no prior-year figure. Never defaulted to 0. */
  segmentGrowth: number | null;
  /**
   * false = catalog miss. TAM / CAGR / Anteil am TAM render as n/a until a KI fill.
   * Omitted or true = fact TAM path when tamSize is a positive catalog figure.
   */
  matched?: boolean;
  /** Fact catalog TAM in $B. Honoured only when the row is not unmatched. */
  tamSize?: number | null;
  /** Fact catalog CAGR. Honoured only when the row is not unmatched. */
  tamCAGR?: number | null;
}

export interface TamNaFill {
  segmentName: string;
  /** Set only when the fact YoY was null and the model supplied an in-range estimate. */
  segmentGrowth?: number;
  /** Set only for unmatched rows. Absent when the catalog TAM stays in place. */
  tamSize?: number;
  tamCAGR?: number;
  tamLabel?: string;
  tamSource?: string;
  /** Derived: segmentRevenue / tamSize, percent. Never copied from the model. */
  marketShare?: number;
  /** Derived from effective growth vs effective CAGR. null when either input is missing. */
  outperforming?: boolean | null;
  shareWarning?: boolean;
  confidence: "low" | "med" | "high";
  rationale: string;
  /** Relative Formel oder Begründung. Leer lassen heißt: nicht belegt. */
  formula?: string;
}

export interface ScopeNaCells {
  growth: boolean;
  tam: boolean;
  cagr: boolean;
  share: boolean;
  vs: boolean;
}

export interface TamNaMatrixCells {
  segment: string;
  rev: string;
  anteil: string;
  wachstum: string;
  tam: string;
  cagr: string;
  anteilAmTam: string;
  vsTam: string;
}

/** Known revenue above zero. null, NaN and 0 stay out of the table and the fill scope. */
export function hasPositiveSegmentRevenue(revenue: unknown): revenue is number {
  return typeof revenue === "number" && Number.isFinite(revenue) && revenue > 0;
}

export function deriveTamShare(segmentRevenueB: number, tamSizeB: number): number {
  return Math.round((segmentRevenueB / tamSizeB) * 10000) / 100;
}

/** null when growth or CAGR is missing — do not invent either input. */
export function deriveOutperforming(segmentGrowth: number | null, tamCAGR: number | null): boolean | null {
  if (segmentGrowth === null || tamCAGR === null || !Number.isFinite(segmentGrowth) || !Number.isFinite(tamCAGR)) return null;
  return segmentGrowth > tamCAGR;
}

/**
 * Display string for the fact catalog coverage. Rounds like the Section7
 * banner (`formatNumber(coveragePct, 0)`), and never raises the underlying pct.
 */
export function catalogCoverageNote(coveragePct: number | null | undefined): string {
  if (typeof coveragePct !== "number" || !Number.isFinite(coveragePct)) {
    return "Catalog-Coverage unverändert";
  }
  return `Catalog-Coverage unverändert ${Math.round(coveragePct)}%`;
}

/** Meta line after applied KI cells. KI growth is not mixed into the fact weighted figure. */
export function kiFillMetaLine(cellCount: number, coveragePct: number | null | undefined): string {
  return `KI-Schätzung: ${cellCount} Zellen · ${catalogCoverageNote(coveragePct)} · Wachstum-KI zählt nicht in Segment-gew. Wachstum`;
}

function finite(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.slice(0, max);
}

function growthOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function formatPlain(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function factCell(text: string): string {
  return `${text} ${FACT_MARK}`;
}

function parseConfidence(v: unknown): "low" | "med" | "high" {
  return v === "low" || v === "med" || v === "high" ? v : "low";
}

/** Drop, do not clamp: values outside −80…+200 are not a Wachstum fill. */
function parseEstimatedGrowth(v: unknown): number | null {
  const n = finite(v);
  if (n === null || n < SEGMENT_GROWTH_MIN || n > SEGMENT_GROWTH_MAX) return null;
  return n;
}

function extractRawFills(llmData: unknown): unknown[] {
  if (Array.isArray(llmData)) return llmData;
  if (llmData && typeof llmData === "object") {
    const o = llmData as Record<string, unknown>;
    if (Array.isArray(o.fills)) return o.fills;
    if (Array.isArray(o.segments)) return o.segments;
  }
  return [];
}

function fillByName(fills: TamNaFill[] | null | undefined): Map<string, TamNaFill> {
  const byName = new Map<string, TamNaFill>();
  for (const fill of fills ?? []) {
    if (!fill || typeof fill.segmentName !== "string" || byName.has(fill.segmentName)) continue;
    byName.set(fill.segmentName, fill);
  }
  return byName;
}

/** Positive catalog TAM. Unmatched rows never keep a fact TAM. */
export function factTamSize(seg: TamNaSegmentRef): number | null {
  if (seg.matched === false) return null;
  const size = finite(seg.tamSize);
  if (size === null || !(size > 0)) return null;
  return size;
}

export function factTamCagr(seg: TamNaSegmentRef): number | null {
  if (factTamSize(seg) === null) return null;
  return finite(seg.tamCAGR);
}

/**
 * Visible n/a in Wachstum · TAM · CAGR · Anteil am TAM · vs. TAM.
 * Fact numbers win. Anteil am TAM and vs. TAM close only through the §3 formulas
 * once their inputs exist — the fill is not allowed to supply those strings.
 */
export function scopeNaCells(
  seg: TamNaSegmentRef,
  fill?: Pick<TamNaFill, "segmentGrowth" | "tamSize" | "tamCAGR"> | null,
): ScopeNaCells {
  const factGrowth = growthOrNull(seg.segmentGrowth);
  const kiGrowth = factGrowth == null && fill ? parseEstimatedGrowth(fill.segmentGrowth) : null;
  const growth = factGrowth ?? kiGrowth;
  const unmatched = seg.matched === false;
  const factTam = factTamSize(seg);
  const factCagr = factTamCagr(seg);
  const kiTam = unmatched && fill && finite(fill.tamSize) !== null && (fill.tamSize as number) > 0
    ? (fill.tamSize as number)
    : null;
  const kiCagr = unmatched && fill && finite(fill.tamCAGR) !== null ? (fill.tamCAGR as number) : null;
  const revenueOk = finite(seg.segmentRevenue) !== null && (seg.segmentRevenue as number) >= 0;
  return {
    growth: growth === null,
    tam: unmatched && kiTam === null,
    cagr: unmatched && kiCagr === null,
    share: unmatched && (kiTam === null || !revenueOk),
    vs: growth === null || (unmatched ? kiCagr === null : factCagr === null),
  };
}

export function countScopeCells(cells: ScopeNaCells): number {
  return Number(cells.growth) + Number(cells.tam) + Number(cells.cagr) + Number(cells.share) + Number(cells.vs);
}

/** Open scope cells on rows with revenue > 0. Revenue null or 0 is not counted. */
export function countScopeRestNa(segments: TamNaSegmentRef[], fills: TamNaFill[] | null | undefined): number {
  const byName = fillByName(fills);
  let n = 0;
  for (const seg of segments) {
    if (!hasPositiveSegmentRevenue(seg.segmentRevenue)) continue;
    n += countScopeCells(scopeNaCells(seg, byName.get(seg.segmentName) ?? null));
  }
  return n;
}

/** Cells that were n/a and are closed by this fill (KI value or §3 formula). */
export function countKiFilledCells(segments: TamNaSegmentRef[], fills: TamNaFill[]): number {
  const byName = fillByName(fills);
  let n = 0;
  for (const seg of segments) {
    if (!hasPositiveSegmentRevenue(seg.segmentRevenue)) continue;
    const before = scopeNaCells(seg, null);
    const after = scopeNaCells(seg, byName.get(seg.segmentName) ?? null);
    if (before.growth && !after.growth) n++;
    if (before.tam && !after.tam) n++;
    if (before.cagr && !after.cagr) n++;
    if (before.share && !after.share) n++;
    if (before.vs && !after.vs) n++;
  }
  return n;
}

/** Fills that close at least one cell on a row with revenue > 0. Empty when nothing usable remains. */
export function applicableTamNaFills(segments: TamNaSegmentRef[], fills: TamNaFill[] | null | undefined): TamNaFill[] {
  const byName = fillByName(fills);
  const out: TamNaFill[] = [];
  for (const seg of segments) {
    if (!hasPositiveSegmentRevenue(seg.segmentRevenue)) continue;
    const fill = byName.get(seg.segmentName);
    if (!fill) continue;
    if (countKiFilledCells([seg], [fill]) === 0) continue;
    out.push(fill);
  }
  return out;
}

export function segmentNeedsLlm(seg: TamNaSegmentRef): boolean {
  if (!hasPositiveSegmentRevenue(seg.segmentRevenue)) return false;
  const cells = scopeNaCells(seg, null);
  return cells.growth || cells.tam || cells.cagr;
}

/** One Section7 row: exact segment label plus Fact or n/a per column. */
export function describeTamNaMatrixRow(seg: TamNaSegmentRef, segmentShare?: number | null): TamNaMatrixCells {
  const factGrowth = growthOrNull(seg.segmentGrowth);
  const factTam = factTamSize(seg);
  const factCagr = factTamCagr(seg);
  const anteil = typeof segmentShare === "number" && Number.isFinite(segmentShare)
    ? factCell(`${formatPlain(segmentShare)}%`)
    : "n/a";
  let vsTam = "n/a";
  if (factGrowth !== null && factCagr !== null) {
    vsTam = factCell(factGrowth > factCagr ? "Über" : "Unter");
  }
  return {
    segment: seg.segmentName,
    rev: factCell(formatPlain(seg.segmentRevenue)),
    anteil,
    wachstum: factGrowth === null ? "n/a" : factCell(`${formatPlain(factGrowth)}%`),
    tam: factTam === null ? "n/a" : factCell(formatPlain(factTam)),
    cagr: factCagr === null ? "n/a" : factCell(`${formatPlain(factCagr)}%`),
    anteilAmTam: factTam === null ? "n/a" : factCell(`${formatPlain(deriveTamShare(seg.segmentRevenue, factTam))}%`),
    vsTam,
  };
}

/**
 * Keep a fill only when it supplies at least one missing fact
 * (segmentGrowth and/or tamSize) for a requested name.
 * marketShare / outperforming / Über|Unter on the model payload are ignored.
 * Fact YoY and a locked catalog TAM are never overwritten.
 */
export function validateTamNaFills(requested: TamNaSegmentRef[], llmData: unknown): TamNaFill[] {
  const byName = new Map<string, TamNaSegmentRef>();
  const byLower = new Map<string, string>();
  for (const seg of requested) {
    const name = typeof seg.segmentName === "string" ? seg.segmentName.trim() : "";
    if (!name || byName.has(name)) continue;
    if (!hasPositiveSegmentRevenue(seg.segmentRevenue)) continue;
    const revenue = seg.segmentRevenue;
    byName.set(name, {
      segmentName: name,
      segmentRevenue: revenue,
      segmentGrowth: growthOrNull(seg.segmentGrowth),
      matched: seg.matched,
      tamSize: finite(seg.tamSize),
      tamCAGR: finite(seg.tamCAGR),
    });
    const key = name.toLowerCase();
    byLower.set(key, byLower.has(key) ? "" : name);
  }

  const resolve = (rawName: string): TamNaSegmentRef | undefined => {
    const exact = byName.get(rawName);
    if (exact) return exact;
    const canon = byLower.get(rawName.toLowerCase());
    if (!canon) return undefined;
    return byName.get(canon);
  };

  const out: TamNaFill[] = [];
  const seen = new Set<string>();
  for (const raw of extractRawFills(llmData)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const rawName = typeof rec.segmentName === "string" ? rec.segmentName.trim() : "";
    const seg = rawName ? resolve(rawName) : undefined;
    if (!seg || seen.has(seg.segmentName)) continue;

    const factGrowth = growthOrNull(seg.segmentGrowth);
    const unmatched = seg.matched === false;
    const lockedTam = factTamSize(seg);
    const lockedCagr = factTamCagr(seg);
    const estimatedGrowth = factGrowth === null ? parseEstimatedGrowth(rec.segmentGrowth) : null;

    let tamSize: number | undefined;
    let tamCAGR: number | undefined;
    let tamLabel: string | undefined;
    let tamSource: string | undefined;
    if (unmatched || lockedTam === null) {
      const size = finite(rec.tamSize);
      const cagr = finite(rec.tamCAGR);
      const label = cleanText(rec.tamLabel, 120);
      const source = cleanText(rec.tamSource, 160);
      if (size !== null && size > 0 && size <= TAM_SIZE_MAX_BN && cagr !== null && cagr >= CAGR_MIN && cagr <= CAGR_MAX) {
        tamSize = size;
        tamCAGR = cagr;
        if (label) tamLabel = label;
        if (source) tamSource = source;
      }
    }

    if (estimatedGrowth === null && tamSize === undefined) continue;

    const effectiveGrowth = factGrowth ?? estimatedGrowth;
    const effectiveCagr = lockedCagr !== null ? lockedCagr : (tamCAGR ?? null);
    const fill: TamNaFill = {
      segmentName: seg.segmentName,
      confidence: parseConfidence(rec.confidence),
      rationale: cleanText(rec.rationale, 140) ?? "",
      outperforming: deriveOutperforming(effectiveGrowth, effectiveCagr),
    };
    const formula = cleanText(rec.formula, 180);
    if (formula) fill.formula = formula;
    if (estimatedGrowth !== null) fill.segmentGrowth = estimatedGrowth;
    if (tamSize !== undefined && tamCAGR !== undefined) {
      const marketShare = deriveTamShare(seg.segmentRevenue, tamSize);
      fill.tamSize = tamSize;
      fill.tamCAGR = tamCAGR;
      if (tamLabel) fill.tamLabel = tamLabel;
      if (tamSource) fill.tamSource = tamSource;
      fill.marketShare = marketShare;
      fill.shareWarning = marketShare > TAM_NA_SHARE_WARN;
    }
    seen.add(seg.segmentName);
    out.push(fill);
  }
  return out;
}

export interface TamNaReason {
  segmentName: string;
  field: "growth" | "tam" | "cagr";
  reason: string;
}

function hasEstimateText(fill: TamNaFill): boolean {
  return Boolean((fill.rationale && fill.rationale.trim()) || (fill.formula && fill.formula.trim()));
}

/**
 * Schätzungen ohne Formel/Begründung oder ohne TAM-Quelle bleiben draußen.
 * Der Aufrufer zeigt den Grund an der n/a-Zelle.
 */
export function retainSourcedTamNaFills(fills: TamNaFill[]): { fills: TamNaFill[]; naReasons: TamNaReason[] } {
  const naReasons: TamNaReason[] = [];
  const kept: TamNaFill[] = [];
  for (const fill of fills) {
    if (!fill || typeof fill.segmentName !== "string") continue;
    const next: TamNaFill = { ...fill };
    if (fill.segmentGrowth != null && !hasEstimateText(fill)) {
      delete next.segmentGrowth;
      naReasons.push({
        segmentName: fill.segmentName,
        field: "growth",
        reason: "n/a — Schätzung ohne Formel oder Begründung",
      });
    }
    if (fill.tamSize != null && !(fill.tamSource && fill.tamSource.trim())) {
      delete next.tamSize;
      delete next.tamCAGR;
      delete next.tamLabel;
      delete next.marketShare;
      delete next.shareWarning;
      naReasons.push({ segmentName: fill.segmentName, field: "tam", reason: "n/a — TAM ohne Quelle" });
      naReasons.push({ segmentName: fill.segmentName, field: "cagr", reason: "n/a — CAGR ohne Quelle" });
    }
    if (next.segmentGrowth == null && next.tamSize == null) continue;
    kept.push(next);
  }
  return { fills: kept, naReasons };
}

/**
 * Weitere LLM-Abrufe je offener Zeile, nachdem der erste Lauf die Zeile nicht belegt hat.
 * Die Gesamtzahl der Abrufe steht in tamEstimateCallCeiling.
 */
export const TAM_ESTIMATE_MAX_RETRIES = 1;

/** Cache-Schlüssel wechselt mit der Schätzlogik, nicht mit einem stillen Zahlenfaktor. */
export const TAM_ESTIMATE_CACHE_VERSION = 2;

/**
 * Segment-Wachstum unter dieser Schwelle ist die Unternehmensentwicklung
 * und kein Markt-CAGR. Der Default ist 0.
 */
export const MARKET_CAGR_PROXY_MIN_GROWTH = 0;

/** Spanne = kleinstes bis größtes beobachtetes TAM/Umsatz-Verhältnis. Kein fester Faktor. */
export const TAM_RATIO_SPREAD = { method: "range" } as const;

export const MARKET_SIZE_PUBLISHERS = [
  "gartner", "idc", "statista", "forrester", "mckinsey",
  "geschäftsbericht", "geschaeftsbericht", "annual report", "10-k", "20-f",
  "pressemitteilung", "press release",
] as const;

export const GROWTH_SOURCE_MARKERS = [
  "cagr", "yoy", "peer-median", "peer median", "umsatz-yoy", "peer-cagr",
] as const;

/** Obergrenze = offene Zeilen × (erster Abruf + Retries je Zeile). */
export function tamEstimateCallCeiling(openRows: number): number {
  const rows = typeof openRows === "number" && Number.isFinite(openRows) && openRows > 0 ? Math.floor(openRows) : 0;
  return rows * (TAM_ESTIMATE_MAX_RETRIES + 1);
}

export const TAM_NA_UNFILLED_REASON = {
  growth: "n/a — keine belegte Wachstumsschätzung",
  tam: "n/a — keine belegte TAM-Schätzung",
  cagr: "n/a — keine belegte CAGR-Schätzung",
} as const;

/** Offene Zellen, die das Modell selbst setzen darf. Anteil am TAM und vs. TAM bleiben Formeln. */
export function llmTargetCellCount(seg: TamNaSegmentRef): number {
  const cells = scopeNaCells(seg, null);
  return Number(cells.growth) + Number(cells.tam) + Number(cells.cagr);
}

export function llmClosedCellCount(seg: TamNaSegmentRef, fill: TamNaFill | null | undefined): number {
  const before = scopeNaCells(seg, null);
  const after = scopeNaCells(seg, fill ?? null);
  let closed = 0;
  if (before.growth && !after.growth) closed += 1;
  if (before.tam && !after.tam) closed += 1;
  if (before.cagr && !after.cagr) closed += 1;
  return closed;
}

/**
 * Mindestanteil geschlossener Zielzellen, ab dem kein Retry mehr nötig ist.
 * Eine vollständig beantwortete Zeile — die mit den wenigsten offenen Zielzellen —
 * reicht. Der Anteil ist der Quotient aus dieser Zeile und der offenen Matrix.
 */
export function adaptiveMinFilledCellRatio(openCellsByRow: readonly number[]): number {
  const rows = openCellsByRow.filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
  const total = rows.reduce((sum, n) => sum + n, 0);
  if (total <= 0) return 1;
  return Math.min(...rows) / total;
}

export function filledTargetCellRatio(segments: TamNaSegmentRef[], fills: TamNaFill[] | null | undefined): number {
  const byName = fillByName(fills);
  let open = 0;
  let closed = 0;
  for (const seg of segments) {
    const target = llmTargetCellCount(seg);
    if (target === 0) continue;
    open += target;
    closed += llmClosedCellCount(seg, byName.get(seg.segmentName) ?? null);
  }
  if (open === 0) return 1;
  return closed / open;
}

/**
 * Zellen aus zwei Abrufen. Eine gesetzte Zahl wird nicht durch eine andere ersetzt
 * und nicht gemittelt. Eine Zeile, die nur im zweiten Abruf belegt ist, kommt dazu.
 */
export function unionTamNaFills(segments: TamNaSegmentRef[], first: TamNaFill[], second: TamNaFill[]): TamNaFill[] {
  const left = fillByName(first);
  const right = fillByName(second);
  const out: TamNaFill[] = [];
  for (const seg of segments) {
    const a = left.get(seg.segmentName);
    const b = right.get(seg.segmentName);
    if (!a && !b) continue;
    if (a && !b) {
      out.push(a);
      continue;
    }
    if (!a && b) {
      out.push(b);
      continue;
    }
    const preferSecond = llmClosedCellCount(seg, b) > llmClosedCellCount(seg, a);
    out.push(preferSecond ? b! : a!);
  }
  return out;
}

export function mergeTamNaReasons(existing: TamNaReason[], extra: TamNaReason[]): TamNaReason[] {
  const seen = new Set<string>();
  const out: TamNaReason[] = [];
  for (const reason of [...existing, ...extra]) {
    if (!reason || typeof reason.segmentName !== "string") continue;
    const key = `${reason.segmentName}\u0000${reason.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reason);
  }
  return out;
}

/** Zielzellen, die nach dem Apply offen bleiben. Ein schon gesetzter Grund gewinnt beim Merge. */
export function unfilledTamNaReasons(segments: TamNaSegmentRef[], fills: TamNaFill[] | null | undefined): TamNaReason[] {
  const byName = fillByName(fills);
  const reasons: TamNaReason[] = [];
  const fields = ["growth", "tam", "cagr"] as const;
  for (const seg of segments) {
    const before = scopeNaCells(seg, null);
    const after = scopeNaCells(seg, byName.get(seg.segmentName) ?? null);
    for (const field of fields) {
      if (!before[field] || !after[field]) continue;
      reasons.push({ segmentName: seg.segmentName, field, reason: TAM_NA_UNFILLED_REASON[field] });
    }
  }
  return reasons;
}

export interface PeerSegmentEvidence {
  symbol: string;
  segmentName: string;
  /** Umsatz in Mrd. USD. */
  revenueB: number;
  /**
   * Marktanteil in Prozent aus einer belegten Quelle.
   * Kein Mix-Anteil der Firma und nicht Umsatz geteilt durch den Katalog-TAM.
   */
  sharePct: number | null;
  /** Beleg des Marktanteils. Ohne Text zählt der Anteil nicht. */
  shareSource?: string | null;
  /** Datum des Belegs. Ohne Datum zählt der Anteil nicht. */
  shareAsOf?: string | null;
}

export interface TamRatioBounds {
  lo: number;
  hi: number;
  mid: number;
  n: number;
}

function sorted(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function positiveRatios(ratios: readonly number[]): number[] {
  return ratios.filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0);
}

/** Fact-TAM / Segmentumsatz. Unmatched Zeilen und TAM ohne Zahl zählen nicht. */
export function factTamRevenueRatios(segments: readonly TamNaSegmentRef[]): number[] {
  const out: number[] = [];
  for (const seg of segments) {
    const tam = factTamSize(seg);
    if (tam == null || !(seg.segmentRevenue > 0)) continue;
    out.push(tam / seg.segmentRevenue);
  }
  return out;
}

function documentedShare(peer: PeerSegmentEvidence): peer is PeerSegmentEvidence & { sharePct: number; shareSource: string; shareAsOf: string } {
  return typeof peer.sharePct === "number"
    && Number.isFinite(peer.sharePct)
    && peer.sharePct > 0
    && typeof peer.shareSource === "string"
    && peer.shareSource.trim().length > 0
    && typeof peer.shareAsOf === "string"
    && peer.shareAsOf.trim().length > 0;
}

/** Peer-Verhältnis aus belegtem Marktanteil: TAM/Umsatz = 100 / Anteil. Ohne Quelle und Datum zählt er nicht. */
export function peerTamRevenueRatios(peers: readonly PeerSegmentEvidence[]): number[] {
  const out: number[] = [];
  for (const peer of peers) {
    if (!documentedShare(peer) || !(peer.revenueB > 0)) continue;
    out.push(100 / peer.sharePct);
  }
  return out;
}

/**
 * Untere und obere Schranke für TAM/Umsatz.
 * Die Grenzen sind das Minimum und das Maximum der Stichprobe.
 * Unter zwei Werten gibt es keine Verteilung.
 */
export function adaptiveTamRatioBounds(ratios: readonly number[]): TamRatioBounds | null {
  const usable = positiveRatios(ratios);
  if (usable.length < 2) return null;
  const logs = sorted(usable.map((n) => Math.log(n)));
  const mid = percentile(logs, 50);
  if (!Number.isFinite(mid)) return null;
  return {
    lo: Math.min(...usable),
    hi: Math.max(...usable),
    mid: Math.exp(mid),
    n: usable.length,
  };
}

export function isMarketSizeSource(source: string): boolean {
  const text = source.toLowerCase();
  const publisher = MARKET_SIZE_PUBLISHERS.some((marker) => text.includes(marker));
  const growth = GROWTH_SOURCE_MARKERS.some((marker) => text.includes(marker));
  return publisher && !growth;
}

/** Jahr oder ISO-Datum in der Quellenzeile. */
export function sourceHasDate(source: string): boolean {
  return /\b(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?\b/.test(source);
}

/** Markt-CAGR nur mit Verlag und Datum. Eine Wachstumsrate als Quelle zählt nicht. */
export function isDocumentedMarketCagrSource(source: string): boolean {
  const text = source.trim();
  return text.length > 0 && isMarketSizeSource(text) && sourceHasDate(text);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function gateMarketTam(input: {
  tamSize: number;
  revenue: number;
  source: string;
  ratios: readonly number[];
  /**
   * Formel aus Peer-Umsatz und belegtem Anteil. Die Quelle ist der Beleg.
   * Unter zwei beobachteten Verhältnissen bleibt auch dieser Pfad n/a (nicht gegated).
   */
  formulaPath?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (!(input.tamSize > 0) || !(input.revenue > 0)) {
    return { ok: false, reason: "n/a — TAM oder Umsatz fehlt" };
  }
  if (!input.formulaPath && !isMarketSizeSource(input.source)) {
    const shown = input.source.trim().slice(0, 80) || "leer";
    return { ok: false, reason: `n/a — tamSource nennt keine Marktgröße (${shown})` };
  }
  const ratio = input.tamSize / input.revenue;
  const bounds = adaptiveTamRatioBounds(input.ratios);
  if (!bounds) {
    const n = positiveRatios(input.ratios).length;
    return { ok: false, reason: `n/a — nicht gegated (n=${n} beobachtete Verhältnisse, mindestens 2)` };
  }
  if (ratio < bounds.lo || ratio > bounds.hi) {
    return {
      ok: false,
      reason: `n/a — TAM/Umsatz ${round1(ratio)}× außerhalb ${round1(bounds.lo)}–${round1(bounds.hi)} (n=${bounds.n}, ${TAM_RATIO_SPREAD.method})`,
    };
  }
  return { ok: true };
}

function nameTokens(name: string): string[] {
  const raw = name.toLowerCase().split(/[^a-z0-9äöüß]+/).filter((token) => token.length > 0);
  const content = raw.filter((token) => !SEGMENT_NAME_STOPWORDS.has(token));
  return (content.length > 0 ? content : raw).sort();
}

function sameSegmentName(a: string, b: string): boolean {
  const left = nameTokens(a).join("|");
  const right = nameTokens(b).join("|");
  return left.length > 0 && left === right;
}

export interface PeerTamFormula {
  tamSize: number;
  formula: string;
  source: string;
}

/**
 * Genau ein Peer mit demselben Segmentnamen, Umsatz und belegtem Marktanteil.
 * Quelle und Datum müssen am Anteil stehen. Mehrere Treffer werden nicht gemittelt.
 */
export function peerRevenueShareTam(subjectName: string, peers: readonly PeerSegmentEvidence[]): PeerTamFormula | { reason: string } | null {
  const named = peers.filter((peer) => sameSegmentName(subjectName, peer.segmentName) && peer.revenueB > 0);
  if (named.length === 0) return null;
  const documented = named.filter(documentedShare);
  if (documented.length > 1) {
    return { reason: `n/a — ${documented.length} Peers mit Segment „${subjectName}“, kein eindeutiger Umsatz (nicht gemittelt)` };
  }
  if (documented.length === 1) {
    const peer = documented[0];
    const share = peer.sharePct;
    const tamSize = round1(peer.revenueB / (share / 100));
    const source = `${peer.shareSource.trim()} (${peer.shareAsOf.trim()})`;
    return {
      tamSize,
      formula: `TAM ${tamSize} = Peer-Umsatz ${round1(peer.revenueB)} / Marktanteil ${round1(share)}% (${peer.symbol} ${peer.segmentName}, ${source})`,
      source,
    };
  }
  const bare = named.filter((peer) => peer.sharePct != null && peer.sharePct > 0);
  if (bare.length > 0) {
    return { reason: `n/a — Marktanteil ohne Quelle und Datum (${bare.map((peer) => peer.symbol).join(", ")})` };
  }
  return { reason: `n/a — kein belegter Marktanteil für „${subjectName}“` };
}

/** Kurzname im Proxy-Badge. SAP.DE wird SAP, ein leerer Ticker bleibt „Unternehmen“. */
export function segmentGrowthProxyLabel(ticker: string): string {
  const stem = ticker.split(".")[0]?.trim().toUpperCase() ?? "";
  return stem || "Unternehmen";
}

/**
 * Proxy nur ab MARKET_CAGR_PROXY_MIN_GROWTH (Default 0).
 * Darunter ist die Rate die Unternehmensentwicklung, nicht der Markt-CAGR.
 * Ein angenommener Proxy trägt die Marke „Proxy: Segmentwachstum …“.
 */
export function segmentGrowthCagrProxy(
  growth: number,
  input?: { minGrowth?: number; companyLabel?: string },
): { tamCAGR: number; formula: string; source: string; rationale: string } | { reason: string } | null {
  if (typeof growth !== "number" || !Number.isFinite(growth)) return null;
  const minGrowth = typeof input?.minGrowth === "number" && Number.isFinite(input.minGrowth)
    ? input.minGrowth
    : MARKET_CAGR_PROXY_MIN_GROWTH;
  if (growth < minGrowth) {
    return {
      reason: `n/a — Segment-Wachstum ${round1(growth)}% liegt unter ${minGrowth}% und ist die Unternehmensentwicklung, nicht der Markt-CAGR`,
    };
  }
  const tamCAGR = round1(growth);
  const label = input?.companyLabel?.trim() || "Unternehmen";
  const mark = `Proxy: Segmentwachstum ${label}`;
  return {
    tamCAGR,
    formula: `${mark} ${tamCAGR}%`,
    source: mark,
    rationale: `${mark}, kein Branchenbericht`,
  };
}
