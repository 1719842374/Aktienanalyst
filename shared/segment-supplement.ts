/**
 * Geschäftsmodell-Ergänzung (WORK_BUSINESS_MODEL_AI_SUPPLEMENT).
 * Top-Level bleibt die gemeldete Segmentliste (Summe unverändert).
 * Nächstes-Jahr-Wachstum = Median der historischen YoY-Raten, nur bei mindestens zwei Raten.
 * Unterposten nur, wenn eine feinere Zeile einem Elternsegment zugeordnet werden kann.
 * Ohne Zuordnung: n/a, kein neues Top-Level-Segment, keine erfundene FSD-Zahl.
 */

import { median } from "./distribution";

export interface OfficialSegment {
  name: string;
  percentage: number | null;
  growthPct: number | null;
}

export interface SegmentYearPoint {
  fiscalYear: string;
  name: string;
  revenue: number | null;
}

export interface SegmentGrowthOverride {
  name: string;
  /** Median der historischen YoY-Raten, in Prozent. */
  nextYearGrowthPct: number | null;
  observations: number;
  label: string;
}

export interface SegmentSubItem {
  parent: string;
  name: string;
  /** Anteil am Elternumsatz, 0–100. */
  shareOfParentPct: number | null;
  label: string;
  override: true;
}

export interface SegmentSupplement {
  growth: SegmentGrowthOverride[];
  subItems: SegmentSubItem[];
  /** Summe der gemeldeten Anteile, nur zur Kontrolle. Kein neuer Anteil. */
  reportedSharePct: number | null;
  undisclosedNote: string;
}

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function segmentGrowthOverrides(
  official: readonly OfficialSegment[],
  history: readonly SegmentYearPoint[],
): SegmentGrowthOverride[] {
  return official.map(seg => {
    const rows = history
      .filter(h => norm(h.name) === norm(seg.name) && h.revenue != null && h.revenue > 0)
      .slice()
      .sort((a, b) => a.fiscalYear.localeCompare(b.fiscalYear));
    const yoy: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1].revenue as number;
      const curr = rows[i].revenue as number;
      if (prev !== 0) yoy.push(((curr - prev) / Math.abs(prev)) * 100);
    }
    if (yoy.length < 2) {
      return {
        name: seg.name,
        nextYearGrowthPct: null,
        observations: yoy.length,
        label: `n/a — ${yoy.length} YoY-Rate(n), Median braucht mindestens zwei`,
      };
    }
    const med = median(yoy);
    return {
      name: seg.name,
      nextYearGrowthPct: med,
      observations: yoy.length,
      label: med == null ? "n/a — Median nicht bestimmbar" : `Override: geschätzt aus Historie, Median ${yoy.length} YoY-Raten`,
    };
  });
}

/**
 * Feinere Zeilen, die kein Top-Level-Segment sind, werden nur eingehängt,
 * wenn der Name des Elternsegments im Namen der Zeile vorkommt (oder umgekehrt ein Token).
 * Sonst bleiben sie draußen.
 */
export function nestSubItems(
  official: readonly OfficialSegment[],
  finer: readonly { name: string; revenue: number | null }[],
): SegmentSubItem[] {
  const top = new Set(official.map(s => norm(s.name)));
  const items: SegmentSubItem[] = [];
  for (const row of finer) {
    const key = norm(row.name);
    if (!key || top.has(key)) continue;
    const parent = official.find(s => {
      const p = norm(s.name);
      return p.length > 0 && (key.includes(p) || p.includes(key));
    });
    if (!parent) continue;
    const parentRevenue = finer.find(f => norm(f.name) === norm(parent.name))?.revenue
      ?? null;
    // Elternumsatz aus der feineren Liste, sonst kein relativer Anteil.
    const share = row.revenue != null && parentRevenue != null && parentRevenue > 0
      ? (row.revenue / parentRevenue) * 100
      : null;
    items.push({
      parent: parent.name,
      name: row.name,
      shareOfParentPct: share,
      override: true,
      label: share == null
        ? "Override: nicht separat ausgewiesen — Anteil am Elternsegment n/a (keine Umsatzbasis)"
        : "Override: Anteil innerhalb des Elternsegments, nicht vom Gesamtumsatz",
    });
  }
  return items;
}

export function buildSegmentSupplement(
  official: readonly OfficialSegment[],
  history: readonly SegmentYearPoint[],
  finer: readonly { name: string; revenue: number | null }[] = [],
): SegmentSupplement {
  const shares = official.map(s => s.percentage).filter((p): p is number => p != null && Number.isFinite(p));
  const reportedSharePct = shares.length === official.length && official.length > 0
    ? shares.reduce((s, p) => s + p, 0)
    : null;
  const subItems = nestSubItems(official, finer);
  return {
    growth: segmentGrowthOverrides(official, history),
    subItems,
    reportedSharePct,
    undisclosedNote: subItems.length > 0
      ? "Unterposten sind eingerückt und zählen nicht in die Top-Level-Summe."
      : "n/a — nicht separat ausgewiesen, keine feinere Segmentquelle und kein Call-Text. Kein neues Top-Level-Segment.",
  };
}
