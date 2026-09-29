/**
 * Session-only KI fill for Segment-TAM N/A cells (Spec v2).
 *
 * Pure validation + local derivation. This module does not touch
 * TAM_CATALOG, matchSegmentTAM, assessTamQuality, coveragePct, tamTotal,
 * segmentWeightedGrowth, or the DCF gate.
 *
 * marketShare (Anteil am TAM) and vs-TAM (outperforming) are formula-only.
 * They are never taken from the model and never fetched from Apollo or
 * S&P Global.
 */

export const TAM_NA_SHARE_WARN = 25; // display badge only; mirrors TAM_SHARE_WARN, not a quality input

const TAM_SIZE_MAX_BN = 100_000;
const CAGR_MIN = -30;
const CAGR_MAX = 80;
/** Spec v2: segmentGrowth outside this window is dropped, not clamped into range. */
export const SEGMENT_GROWTH_MIN = -80;
export const SEGMENT_GROWTH_MAX = 200;

export interface TamNaSegmentRef {
  segmentName: string;
  /** Segment revenue in $B (already the fact figure shown in the table). */
  segmentRevenue: number;
  /** Reported YoY %. null = no prior-year figure. Never defaulted to 0. */
  segmentGrowth: number | null;
  /**
   * false = catalog miss. TAM / CAGR / Anteil / vs. TAM render as n/a.
   * Omitted or true = fact TAM path; catalog numbers are not replaceable.
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
}

export interface ScopeNaCells {
  growth: boolean;
  tam: boolean;
  cagr: boolean;
  share: boolean;
  vs: boolean;
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

/** Meta line after a full-scope success. KI growth is not mixed into the fact weighted figure. */
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

/**
 * Visible n/a in Wachstum · TAM · CAGR · Anteil am TAM · vs. TAM.
 * Fact numbers win. Anteil and vs. TAM close only through the §3 formulas
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
  const factTam = !unmatched && finite(seg.tamSize) !== null && (seg.tamSize as number) > 0
    ? (seg.tamSize as number)
    : null;
  const factCagr = factTam !== null && finite(seg.tamCAGR) !== null ? (seg.tamCAGR as number) : null;
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

/** Rest-n/a across every segment row. Success requires this to be 0. */
export function countScopeRestNa(segments: TamNaSegmentRef[], fills: TamNaFill[] | null | undefined): number {
  const byName = fillByName(fills);
  let n = 0;
  for (const seg of segments) {
    n += countScopeCells(scopeNaCells(seg, byName.get(seg.segmentName) ?? null));
  }
  return n;
}

/** Cells that were n/a and are closed by this fill (KI value or §3 formula). */
export function countKiFilledCells(segments: TamNaSegmentRef[], fills: TamNaFill[]): number {
  const byName = fillByName(fills);
  let n = 0;
  for (const seg of segments) {
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

export function segmentNeedsLlm(seg: TamNaSegmentRef): boolean {
  const cells = scopeNaCells(seg, null);
  return cells.growth || cells.tam || cells.cagr;
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
    const revenue = finite(seg.segmentRevenue);
    if (revenue === null || revenue < 0) continue;
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
    const lockedTam = !unmatched && finite(seg.tamSize) !== null && (seg.tamSize as number) > 0;
    const lockedCagr = lockedTam && finite(seg.tamCAGR) !== null ? (seg.tamCAGR as number) : null;

    const estimatedGrowth = factGrowth === null ? parseEstimatedGrowth(rec.segmentGrowth) : null;

    let tamSize: number | undefined;
    let tamCAGR: number | undefined;
    let tamLabel: string | undefined;
    let tamSource: string | undefined;
    if (!lockedTam) {
      const size = finite(rec.tamSize);
      const cagr = finite(rec.tamCAGR);
      const label = cleanText(rec.tamLabel, 120);
      const source = cleanText(rec.tamSource, 160);
      if (
        size !== null && size > 0 && size <= TAM_SIZE_MAX_BN
        && cagr !== null && cagr >= CAGR_MIN && cagr <= CAGR_MAX
        && label && source
      ) {
        tamSize = size;
        tamCAGR = cagr;
        tamLabel = label;
        tamSource = source;
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
    if (estimatedGrowth !== null) fill.segmentGrowth = estimatedGrowth;
    if (tamSize !== undefined && tamCAGR !== undefined && tamLabel && tamSource) {
      const marketShare = deriveTamShare(seg.segmentRevenue, tamSize);
      fill.tamSize = tamSize;
      fill.tamCAGR = tamCAGR;
      fill.tamLabel = tamLabel;
      fill.tamSource = tamSource;
      fill.marketShare = marketShare;
      fill.shareWarning = marketShare > TAM_NA_SHARE_WARN;
    }
    seen.add(seg.segmentName);
    out.push(fill);
  }
  return out;
}
