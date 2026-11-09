/**
 * Untersegmente eines Hauptsegments.
 * FMP nur, wenn die Segmentzeile das Hauptsegment als verschachtelte Werte führt.
 * Eine flache Umsatzzahl ist kein Untersegment. KI-Werte bleiben KI.
 */
import { prettifyProductSegmentName } from "./segment-growth-calc";

export type SegmentChildSource = "FMP" | "KI";

export interface SegmentChild {
  parent: string;
  name: string;
  revenue: number | null;
  shareOfParentPct: number | null;
  growthPct?: number | null;
  source: SegmentChildSource;
  basis?: string | null;
}

export interface SegmentChildrenResult {
  parent: string;
  children: SegmentChild[];
  reason: string | null;
}

export const SEGMENT_CHILDREN_ROUTE = "/api/segment-children";
export const NO_SEGMENT_CHILDREN = "n/a — weder FMP noch KI liefern Untersegmente";
export const KI_WITHOUT_BASIS = "n/a — KI-Schätzung ohne Beleg";
export const KI_SUM_EXCEEDS_PARENT = "n/a — KI-Summe überschreitet das Elternsegment";
export const KI_NEGATIVE = "n/a — negativer KI-Wert verworfen";
export const KI_UNAVAILABLE = "n/a — KI nicht erreichbar";
export const KI_FILTERED = "n/a — KI-Vorschläge verworfen: Elternname, Geschwister oder Geschäftssegment";
export const KI_WITHOUT_SOURCE = "n/a — Schätzung ohne Quelle";
export const SEGMENT_UNKNOWN = "n/a — Segment ist in der serverseitigen Liste nicht enthalten";
export const BASIS_TEXT_MAX = 400;

const SKIP_KEYS = new Set([
  "symbol", "date", "reportedCurrency", "cik", "fillingDate",
  "acceptedDate", "calendarYear", "period", "link", "finalLink",
  "fiscalYear", "data",
]);

function norm(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function sameChildName(kind: "product" | "geographic", left: string, right: string): boolean {
  if (kind === "product") return norm(prettifyProductSegmentName(left)) === norm(prettifyProductSegmentName(right));
  return norm(left) === norm(right);
}

function boundBasis(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= BASIS_TEXT_MAX) return clean;
  const slice = clean.slice(0, BASIS_TEXT_MAX);
  const space = slice.lastIndexOf(" ");
  const end = space >= 24 ? space : BASIS_TEXT_MAX;
  return `${clean.slice(0, end).trimEnd()}…`;
}

function fiscalYear(row: Record<string, unknown>): number {
  const year = row.fiscalYear;
  if (typeof year === "number" && Number.isInteger(year)) return year;
  if (typeof year === "string" && /^\d{4}/.test(year)) return Number(year.slice(0, 4));
  return 0;
}

function isQuarter(row: Record<string, unknown>): boolean {
  return typeof row.period === "string" && /^Q[1-4]$/i.test(row.period.trim());
}

function finite(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function withShares(parent: string, rows: SegmentChild[]): SegmentChild[] {
  const total = rows.reduce((sum, row) => sum + (row.revenue != null && row.revenue > 0 ? row.revenue : 0), 0);
  if (!(total > 0) || rows.some((row) => row.shareOfParentPct != null)) return rows;
  return rows.map((row) => ({
    ...row,
    parent,
    shareOfParentPct: row.revenue != null && row.revenue > 0 ? (row.revenue / total) * 100 : null,
  }));
}

function readNested(parent: string, value: unknown): SegmentChild[] {
  if (Array.isArray(value)) {
    const rows: SegmentChild[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as { name?: unknown; revenue?: unknown; shareOfParentPct?: unknown };
      if (typeof rec.name !== "string" || !rec.name.trim()) continue;
      rows.push({
        parent,
        name: rec.name.trim(),
        revenue: finite(rec.revenue),
        shareOfParentPct: finite(rec.shareOfParentPct),
        source: "FMP",
      });
    }
    return withShares(parent, rows);
  }
  if (!value || typeof value !== "object") return [];
  const rows: SegmentChild[] = [];
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    const revenue = finite(raw);
    if (!name.trim() || revenue == null) continue;
    rows.push({ parent, name: name.trim(), revenue, shareOfParentPct: null, source: "FMP" });
  }
  return withShares(parent, rows);
}

function segmentMap(row: Record<string, unknown>): Record<string, unknown> {
  return row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
}

export function segmentNamesFromFmpRows(raw: unknown[]): string[] {
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || isQuarter(item as Record<string, unknown>)) continue;
    for (const [key, value] of Object.entries(segmentMap(item as Record<string, unknown>))) {
      if (SKIP_KEYS.has(key) || !key.trim()) continue;
      const numeric = finite(value);
      const nested = !!value && typeof value === "object";
      if (numeric == null && !nested) continue;
      if (!names.some((name) => norm(name) === norm(key))) names.push(key.trim());
    }
  }
  return names;
}

export function canonicalSegmentName(raw: unknown[], parent: string): string | null {
  const wanted = norm(parent);
  if (!wanted) return null;
  return segmentNamesFromFmpRows(raw).find((name) => norm(name) === wanted) ?? null;
}

export function reportedParentRevenue(raw: unknown[], parent: string): number | null {
  if (!Array.isArray(raw)) return null;
  const wanted = norm(parent);
  const rows = raw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !isQuarter(item as Record<string, unknown>));
  for (const row of [...rows].sort((a, b) => fiscalYear(b) - fiscalYear(a))) {
    for (const [key, value] of Object.entries(segmentMap(row))) {
      if (norm(key) !== wanted) continue;
      const revenue = finite(value);
      if (revenue != null && revenue > 0) return revenue;
    }
  }
  return null;
}

export function childrenFromFmpRows(raw: unknown[], parent: string): SegmentChild[] {
  if (!Array.isArray(raw) || !parent.trim()) return [];
  const rows = raw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !isQuarter(item as Record<string, unknown>));
  const wanted = norm(parent);
  for (const row of [...rows].sort((a, b) => fiscalYear(b) - fiscalYear(a))) {
    const source = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
    for (const [key, value] of Object.entries(source)) {
      if (norm(key) !== wanted) continue;
      const children = readNested(parent, value);
      if (children.length > 0) return children;
    }
  }
  return [];
}

export function childrenFromKiPayload(parent: string, payload: unknown): SegmentChild[] {
  if (!payload || typeof payload !== "object" || !parent.trim()) return [];
  const list = (payload as { children?: unknown }).children;
  if (!Array.isArray(list)) return [];
  const rows: SegmentChild[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; revenue?: unknown; shareOfParentPct?: unknown };
    if (typeof rec.name !== "string" || !rec.name.trim()) continue;
    rows.push({
      parent,
      name: rec.name.trim(),
      revenue: finite(rec.revenue),
      shareOfParentPct: finite(rec.shareOfParentPct),
      source: "KI",
    });
  }
  return rows;
}

export function reviewKiChildren(
  parent: string,
  payload: unknown,
  parentRevenue: number | null,
  scope: { kind?: "product" | "geographic"; siblings?: readonly string[]; businessNames?: readonly string[] } = {},
): SegmentChildrenResult {
  if (!payload || typeof payload !== "object") return { parent, children: [], reason: NO_SEGMENT_CHILDREN };
  const record = payload as { children?: unknown; fills?: unknown };
  const rawList = Array.isArray(record.children) ? record.children : Array.isArray(record.fills) ? record.fills : null;
  if (!Array.isArray(rawList) || rawList.length === 0) return { parent, children: [], reason: NO_SEGMENT_CHILDREN };
  const list = rawList.map((item) => {
    if (!item || typeof item !== "object") return item;
    const row = item as { name?: unknown; segmentName?: unknown; basis?: unknown; rationale?: unknown; formula?: unknown; source?: unknown; tamSource?: unknown; growthPct?: unknown; segmentGrowth?: unknown };
    const basis = [row.basis, row.rationale, row.formula].filter((part) => typeof part === "string" && part.trim()).join(" · ");
    return {
      ...row,
      name: typeof row.name === "string" && row.name.trim() ? row.name : row.segmentName,
      basis,
      source: typeof row.source === "string" && row.source.trim() ? row.source : row.tamSource,
      growthPct: row.growthPct ?? row.segmentGrowth,
    };
  });
  const kind = scope.kind ?? "product";
  const kept: SegmentChild[] = [];
  const notes: string[] = [];
  let filtered = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { name?: unknown; revenue?: unknown; shareOfParentPct?: unknown; growthPct?: unknown; basis?: unknown; source?: unknown };
    const name = typeof rec.name === "string" ? rec.name.trim().slice(0, 80) : "";
    if (!name) continue;
    const basis = typeof rec.basis === "string" ? boundBasis(rec.basis) : "";
    if (!basis) {
      notes.push(`${KI_WITHOUT_BASIS}: ${name}`);
      continue;
    }
    if (sameChildName(kind, parent, name)) {
      filtered += 1;
      continue;
    }
    if ((scope.siblings ?? []).some((sibling) => sameChildName(kind, sibling, name))) {
      filtered += 1;
      continue;
    }
    if (kind === "geographic" && (scope.businessNames ?? []).some((business) => sameChildName("product", business, name))) {
      filtered += 1;
      continue;
    }
    const share = finite(rec.shareOfParentPct);
    const revenue = finite(rec.revenue);
    const growth = finite(rec.growthPct);
    if ((share != null && share < 0) || (revenue != null && revenue < 0)) {
      notes.push(`${KI_NEGATIVE}: ${name}`);
      continue;
    }
    const citation = typeof rec.source === "string" ? rec.source.trim() : "";
    let shareKept = share != null && share > 0 ? share : null;
    let growthKept = growth != null && growth !== 0 ? growth : null;
    if ((shareKept != null || growthKept != null) && !citation) {
      notes.push(`${KI_WITHOUT_SOURCE}: ${name}`);
      shareKept = null;
      growthKept = null;
    }
    const shownBasis = citation && !basis.includes(citation) ? boundBasis(`${basis} · ${citation}`) : basis;
    kept.push({
      parent,
      name,
      revenue: revenue != null && revenue > 0 ? revenue : null,
      shareOfParentPct: shareKept,
      growthPct: growthKept,
      source: "KI",
      basis: shownBasis,
    });
  }
  const shareSum = kept.reduce((sum, row) => sum + (row.shareOfParentPct ?? 0), 0);
  const revenueSum = kept.reduce((sum, row) => sum + (row.revenue ?? 0), 0);
  if (kept.some((row) => row.shareOfParentPct != null) && shareSum > 100) {
    return { parent, children: [], reason: KI_SUM_EXCEEDS_PARENT };
  }
  if (parentRevenue != null && parentRevenue > 0 && kept.some((row) => row.revenue != null) && revenueSum > parentRevenue) {
    return { parent, children: [], reason: KI_SUM_EXCEEDS_PARENT };
  }
  if (kept.length === 0) return { parent, children: [], reason: filtered > 0 ? KI_FILTERED : notes[0] ?? NO_SEGMENT_CHILDREN };
  return { parent, children: kept, reason: notes.length > 0 ? notes.join(" ") : null };
}

export function resolveSegmentChildren(
  parent: string,
  fmp: readonly SegmentChild[],
  ki: readonly SegmentChild[],
): SegmentChildrenResult {
  if (fmp.length > 0) return { parent, children: fmp.map((row) => ({ ...row, source: "FMP" })), reason: null };
  if (ki.length > 0) return { parent, children: ki.map((row) => ({ ...row, source: "KI" })), reason: null };
  return { parent, children: [], reason: NO_SEGMENT_CHILDREN };
}
