/**
 * Session-only KI fill for unmatched Segment-TAM rows.
 *
 * Pure validation + local derivation. This module does not touch
 * TAM_CATALOG, matchSegmentTAM, assessTamQuality, coveragePct, tamTotal,
 * or the DCF gate. marketShare and vs-TAM are computed from reported
 * revenue and YoY growth — never taken from the model.
 */

export const TAM_NA_SHARE_WARN = 25; // display badge only; mirrors TAM_SHARE_WARN, not a quality input

const TAM_SIZE_MAX_BN = 100_000;
const CAGR_MIN = -30;
const CAGR_MAX = 80;

export interface TamNaSegmentRef {
  segmentName: string;
  /** Segment revenue in $B (already the fact figure shown in the table). */
  segmentRevenue: number;
  /** Reported YoY %. null = no prior-year figure. Never defaulted to 0. */
  segmentGrowth: number | null;
}

export interface TamNaFill {
  segmentName: string;
  tamSize: number;
  tamCAGR: number;
  tamLabel: string;
  tamSource: string;
  /** Derived: segmentRevenue / tamSize, percent. */
  marketShare: number;
  /** Derived from reported segmentGrowth vs tamCAGR. null when growth is unknown. */
  outperforming: boolean | null;
  shareWarning: boolean;
}

export function deriveTamShare(segmentRevenueB: number, tamSizeB: number): number {
  return Math.round((segmentRevenueB / tamSizeB) * 10000) / 100;
}

/** null when the company did not report a segment YoY — do not invent one. */
export function deriveOutperforming(segmentGrowth: number | null, tamCAGR: number): boolean | null {
  if (segmentGrowth === null || !Number.isFinite(segmentGrowth) || !Number.isFinite(tamCAGR)) return null;
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

function extractRawFills(llmData: unknown): unknown[] {
  if (Array.isArray(llmData)) return llmData;
  if (llmData && typeof llmData === "object") {
    const o = llmData as Record<string, unknown>;
    if (Array.isArray(o.fills)) return o.fills;
    if (Array.isArray(o.segments)) return o.segments;
  }
  return [];
}

/**
 * Keep a fill only when tamSize > 0 and the segment name is one of the
 * requested names. marketShare / outperforming / segmentGrowth on the model
 * payload are ignored.
 */
export function validateTamNaFills(requested: TamNaSegmentRef[], llmData: unknown): TamNaFill[] {
  const byName = new Map<string, TamNaSegmentRef>();
  const byLower = new Map<string, string>();
  for (const seg of requested) {
    const name = typeof seg.segmentName === "string" ? seg.segmentName.trim() : "";
    if (!name || byName.has(name)) continue;
    const revenue = finite(seg.segmentRevenue);
    if (revenue === null || revenue < 0) continue;
    byName.set(name, { segmentName: name, segmentRevenue: revenue, segmentGrowth: growthOrNull(seg.segmentGrowth) });
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
    const tamSize = finite(rec.tamSize);
    const tamCAGR = finite(rec.tamCAGR);
    const tamLabel = cleanText(rec.tamLabel, 120);
    const tamSource = cleanText(rec.tamSource, 160);
    if (tamSize === null || !(tamSize > 0) || tamSize > TAM_SIZE_MAX_BN) continue;
    if (tamCAGR === null || tamCAGR < CAGR_MIN || tamCAGR > CAGR_MAX) continue;
    if (!tamLabel || !tamSource) continue;
    const marketShare = deriveTamShare(seg.segmentRevenue, tamSize);
    seen.add(seg.segmentName);
    out.push({
      segmentName: seg.segmentName,
      tamSize,
      tamCAGR,
      tamLabel,
      tamSource,
      marketShare,
      outperforming: deriveOutperforming(seg.segmentGrowth, tamCAGR),
      shareWarning: marketShare > TAM_NA_SHARE_WARN,
    });
  }
  return out;
}
