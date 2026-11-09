/**
 * Ergänzung unter den gemeldeten FMP-Segmenten (WORK_BUSINESS_MODEL_AI_SUPPLEMENT).
 * Die Elternanteile und ihre Summe bleiben die gemeldeten Zahlen.
 * Nächstes-Jahr-Wachstum nur als Median von mindestens zwei exakten, aufeinanderfolgenden YoY-Raten.
 * Unterposten nur aus mitgelieferten Hinweisen mit Quelle. Ohne Quelle oder ohne Beleg: n/a.
 * Kein neues Top-Level-Segment, keine Namensähnlichkeit, kein LLM.
 */
import { snapshotsFromFmpRows } from "./segment-growth-calc";

export const SEGMENT_SUPPLEMENT_ROUTE = "/api/segment-supplement";
export const NOT_ESTIMABLE = "n/a — nicht schätzbar";
export const SEGMENT_HISTORY_SOURCE = "FMP revenue-product-segmentation";

export interface OfficialSegment {
  name: string;
  percentage: number | null;
  reportedGrowthPct: number | null;
}

export interface SegmentYearPoint {
  fiscalYear: string;
  name: string;
  revenue: number | null;
}

export interface EvidencedHint {
  parent: string;
  name: string;
  shareOfParentPct: number | null;
  source: string;
  note?: string | null;
}

export interface SegmentGrowthOverride {
  name: string;
  reportedGrowthPct: number | null;
  nextYearGrowthPct: number | null;
  observations: number;
  source: string | null;
  override: boolean;
  label: string;
}

export interface SegmentSubItem {
  parent: string;
  name: string;
  shareOfParentPct: number | null;
  source: string;
  override: true;
  label: string;
  note: string | null;
}

export interface SegmentSupplement {
  parents: OfficialSegment[];
  growth: SegmentGrowthOverride[];
  subItems: SegmentSubItem[];
  reportedSharePct: number | null;
  reportedShareReason: string | null;
  undisclosedNote: string;
  childShareNotes: string[];
  historyNote: string | null;
}

export function normSegmentName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function median(values: readonly number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function yearOf(periodKey: string): number | null {
  const match = periodKey.match(/(\d{4})/);
  return match ? Number(match[1]) : null;
}

export function historyFromRaw(raw: unknown[]): SegmentYearPoint[] {
  const points: SegmentYearPoint[] = [];
  for (const snapshot of snapshotsFromFmpRows(raw)) {
    for (const row of snapshot.rows) {
      points.push({ fiscalYear: snapshot.periodKey, name: row.name, revenue: row.revenue });
    }
  }
  return points;
}

function seriesFor(name: string, history: readonly SegmentYearPoint[]): { year: number; revenue: number }[] {
  const byYear = new Map<number, { periodKey: string; revenue: number }>();
  const key = normSegmentName(name);
  for (const point of history) {
    if (normSegmentName(point.name) !== key) continue;
    if (point.revenue == null || !Number.isFinite(point.revenue) || !(point.revenue > 0)) continue;
    const year = yearOf(point.fiscalYear);
    if (year == null) continue;
    const existing = byYear.get(year);
    if (!existing || point.fiscalYear.localeCompare(existing.periodKey) > 0) {
      byYear.set(year, { periodKey: point.fiscalYear, revenue: point.revenue });
    }
  }
  return Array.from(byYear.entries())
    .map(([year, row]) => ({ year, revenue: row.revenue }))
    .sort((a, b) => a.year - b.year);
}

export function segmentGrowthOverrides(
  official: readonly OfficialSegment[],
  history: readonly SegmentYearPoint[],
  historyNote: string | null = null,
): SegmentGrowthOverride[] {
  return official.map((segment) => {
    const rows = seriesFor(segment.name, history);
    const rates: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (curr.year - prev.year !== 1) continue;
      if (!(prev.revenue > 0) || !(curr.revenue > 0)) continue;
      rates.push(((curr.revenue - prev.revenue) / prev.revenue) * 100);
    }
    if (historyNote) {
      return {
        name: segment.name,
        reportedGrowthPct: segment.reportedGrowthPct,
        nextYearGrowthPct: null,
        observations: 0,
        source: null,
        override: false,
        label: `${historyNote} ${NOT_ESTIMABLE}.`,
      };
    }
    if (rates.length < 2) {
      return {
        name: segment.name,
        reportedGrowthPct: segment.reportedGrowthPct,
        nextYearGrowthPct: null,
        observations: rates.length,
        source: null,
        override: false,
        label: `${NOT_ESTIMABLE} (${rates.length} belegte YoY-Rate(n), Median braucht mindestens zwei)`,
      };
    }
    const mid = median(rates);
    return {
      name: segment.name,
      reportedGrowthPct: segment.reportedGrowthPct,
      nextYearGrowthPct: mid,
      observations: rates.length,
      source: mid == null ? null : SEGMENT_HISTORY_SOURCE,
      override: mid != null,
      label: mid == null
        ? `${NOT_ESTIMABLE} (Median nicht bestimmbar)`
        : `Override: geschätzt aus FMP-Segmenthistorie, Median von ${rates.length} YoY-Raten. Keine Call- und keine Peer-Quelle.`,
    };
  });
}

export function reportedShare(official: readonly OfficialSegment[]): { pct: number | null; reason: string | null } {
  if (official.length === 0) return { pct: null, reason: "n/a — keine gemeldeten Segmente" };
  if (official.some((segment) => segment.percentage == null || !Number.isFinite(segment.percentage))) {
    return { pct: null, reason: "n/a — gemeldeter Anteil unvollständig, Summe nicht ersetzt" };
  }
  return {
    pct: official.reduce((sum, segment) => sum + (segment.percentage as number), 0),
    reason: null,
  };
}

export function assignProvenHints(
  official: readonly OfficialSegment[],
  hints: readonly EvidencedHint[],
): { items: SegmentSubItem[]; dropped: string[]; childShareNotes: string[] } {
  const items: SegmentSubItem[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  const top = new Set(official.map((segment) => normSegmentName(segment.name)));
  for (const hint of hints) {
    const source = hint.source.trim();
    const name = hint.name.trim();
    if (!source) {
      dropped.push(`${hint.name || "Hinweis"}: keine Quelle`);
      continue;
    }
    const parent = official.find((segment) => normSegmentName(segment.name) === normSegmentName(hint.parent));
    if (!parent) {
      dropped.push(`${name || hint.parent}: Elternsegment nicht in der gemeldeten Liste`);
      continue;
    }
    if (!name) {
      dropped.push(`${parent.name}: Unterposten ohne Namen`);
      continue;
    }
    if (top.has(normSegmentName(name))) {
      dropped.push(`${name}: kein neues Top-Level-Segment`);
      continue;
    }
    const id = `${normSegmentName(parent.name)}|${normSegmentName(name)}`;
    if (seen.has(id)) {
      dropped.push(`${name}: doppelt`);
      continue;
    }
    seen.add(id);
    const share = typeof hint.shareOfParentPct === "number"
      && Number.isFinite(hint.shareOfParentPct)
      && hint.shareOfParentPct > 0
      && hint.shareOfParentPct <= 100
      ? hint.shareOfParentPct
      : null;
    const baseNote = hint.note?.trim() ? hint.note.trim() : null;
    const note = share == null
      ? [baseNote, `${NOT_ESTIMABLE} — Anteil am Elternsegment nicht belegt`].filter(Boolean).join(" · ")
      : baseNote;
    items.push({
      parent: parent.name,
      name,
      shareOfParentPct: share,
      source,
      override: true,
      label: share == null
        ? `Hinweis: ${source} — n/a — nicht schätzbar, Anteil am Elternsegment nicht belegt`
        : `Hinweis: ${source}`,
      note,
    });
  }
  const childShareNotes: string[] = [];
  for (const parent of official) {
    const shares = items
      .filter((item) => normSegmentName(item.parent) === normSegmentName(parent.name) && item.shareOfParentPct != null)
      .map((item) => item.shareOfParentPct as number);
    const sum = shares.reduce((total, value) => total + value, 0);
    if (shares.length > 0 && sum > 100) {
      childShareNotes.push(`Hinweis — Unterposten von ${parent.name} summieren sich auf ${sum.toFixed(1)} % des Elternsegments und werden nicht umbasiert. Die Top-Level-Summe bleibt unverändert.`);
    }
  }
  return { items, dropped, childShareNotes };
}

export function buildSegmentSupplement(
  official: readonly OfficialSegment[],
  history: readonly SegmentYearPoint[],
  hints: readonly EvidencedHint[] = [],
  historyNote: string | null = null,
): SegmentSupplement {
  const parents = official.map((segment) => ({
    name: segment.name,
    percentage: segment.percentage,
    reportedGrowthPct: segment.reportedGrowthPct,
  }));
  const share = reportedShare(parents);
  const assigned = assignProvenHints(parents, hints);
  return {
    parents,
    growth: segmentGrowthOverrides(parents, history, historyNote),
    subItems: assigned.items,
    reportedSharePct: share.pct,
    reportedShareReason: share.reason,
    undisclosedNote: assigned.items.length > 0
      ? "Unterposten sind eingerückte Hinweise innerhalb des Elternsegments und zählen nicht in die Top-Level-Summe."
      : `${NOT_ESTIMABLE}, keine belegte Unterposten-Quelle. Top-Level-Segmente und ihre Summe bleiben unverändert.`,
    childShareNotes: assigned.childShareNotes,
    historyNote,
  };
}

/** Nur Zeilen mit explizitem Elternnamen und Quellenangabe. FMP-Jahresmaps ohne parent bleiben leer. */
export function evidencedHintsFromRows(raw: unknown[], official: readonly OfficialSegment[]): EvidencedHint[] {
  if (!Array.isArray(raw)) return [];
  const hints: EvidencedHint[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { parent?: unknown; name?: unknown; shareOfParentPct?: unknown; source?: unknown };
    if (typeof rec.parent !== "string" || typeof rec.name !== "string" || typeof rec.source !== "string") continue;
    if (!rec.source.trim()) continue;
    const share = typeof rec.shareOfParentPct === "number" && Number.isFinite(rec.shareOfParentPct)
      ? rec.shareOfParentPct
      : null;
    const known = official.some((segment) => normSegmentName(segment.name) === normSegmentName(rec.parent as string));
    if (!known) continue;
    hints.push({
      parent: rec.parent,
      name: rec.name,
      shareOfParentPct: share,
      source: rec.source.trim(),
    });
  }
  return hints;
}

export function applyManualGrowthOverride(
  base: SegmentSupplement,
  edit: { name: string; action: "confirm" | "replace"; nextYearGrowthPct?: number | null },
): SegmentSupplement {
  const growth = base.growth.map((row) => {
    if (row.name !== edit.name) return row;
    if (edit.action === "confirm") {
      if (row.nextYearGrowthPct == null) return row;
      return { ...row, override: true, label: "Override: manuell bestätigt" };
    }
    if (typeof edit.nextYearGrowthPct !== "number" || !Number.isFinite(edit.nextYearGrowthPct)) return row;
    return {
      ...row,
      nextYearGrowthPct: edit.nextYearGrowthPct,
      override: true,
      source: "Nutzer",
      label: "Override: manuell",
    };
  });
  return {
    ...base,
    growth,
    parents: base.parents.map((segment) => ({ ...segment })),
    reportedSharePct: base.reportedSharePct,
    reportedShareReason: base.reportedShareReason,
  };
}
