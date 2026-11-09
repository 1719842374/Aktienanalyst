/**
 * Untersegmente eines Hauptsegments.
 * FMP nur, wenn die Segmentzeile das Hauptsegment als verschachtelte Werte führt.
 * Eine flache Umsatzzahl ist kein Untersegment. KI-Werte bleiben KI.
 */

export type SegmentChildSource = "FMP" | "KI";

export interface SegmentChild {
  parent: string;
  name: string;
  revenue: number | null;
  shareOfParentPct: number | null;
  source: SegmentChildSource;
}

export interface SegmentChildrenResult {
  parent: string;
  children: SegmentChild[];
  reason: string | null;
}

export const SEGMENT_CHILDREN_ROUTE = "/api/segment-children";
export const NO_SEGMENT_CHILDREN = "n/a — weder FMP noch KI liefern Untersegmente";

function norm(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
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

export function resolveSegmentChildren(
  parent: string,
  fmp: readonly SegmentChild[],
  ki: readonly SegmentChild[],
): SegmentChildrenResult {
  if (fmp.length > 0) return { parent, children: fmp.map((row) => ({ ...row, source: "FMP" })), reason: null };
  if (ki.length > 0) return { parent, children: ki.map((row) => ({ ...row, source: "KI" })), reason: null };
  return { parent, children: [], reason: NO_SEGMENT_CHILDREN };
}
