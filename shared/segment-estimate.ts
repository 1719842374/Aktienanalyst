/**
 * Unterposten ohne eigene Quelle (Philip, 01.11.).
 * Eine Zahl kommt nur aus der KI-Antwort und trägt immer das Label.
 * Kein Key oder keine Antwort → n/a. Keine stille Füllung aus dem Elternanteil.
 */

import type { OfficialSegment, SegmentSubItem, SegmentSupplement } from "./segment-supplement";

export const ESTIMATE_LABEL = "Schätzung / keine Primärquelle";

export const ESTIMATE_REASON = {
  noKey: "n/a — kein OpenRouter-Key",
  noAnswer: "n/a — keine KI-Antwort",
} as const;

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchParent(name: string, official: readonly OfficialSegment[]): OfficialSegment | null {
  const key = norm(name);
  if (!key) return null;
  return official.find(s => norm(s.name) === key) ?? null;
}

export function parseSubItemEstimates(
  raw: unknown,
  official: readonly OfficialSegment[],
  coveredParents: ReadonlySet<string>,
): { items: SegmentSubItem[]; reason: string | null } {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
    ? (raw as { items: unknown[] }).items
    : null;
  if (!list) return { items: [], reason: ESTIMATE_REASON.noAnswer };
  const top = new Set(official.map(s => norm(s.name)));
  const items: SegmentSubItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { parent?: unknown; name?: unknown; shareOfParentPct?: unknown; note?: unknown };
    const parent = typeof rec.parent === "string" ? matchParent(rec.parent, official) : null;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!parent || !name) continue;
    if (top.has(norm(name)) || coveredParents.has(norm(parent.name))) continue;
    const share = typeof rec.shareOfParentPct === "number" && Number.isFinite(rec.shareOfParentPct) && rec.shareOfParentPct > 0 && rec.shareOfParentPct <= 100
      ? rec.shareOfParentPct
      : null;
    const note = typeof rec.note === "string" && rec.note.trim() ? rec.note.trim() : null;
    items.push({
      parent: parent.name,
      name,
      shareOfParentPct: share,
      override: true,
      source: "estimate",
      note: share == null ? (note ?? "n/a — nicht beziffert") : note,
      label: ESTIMATE_LABEL,
    });
  }
  if (items.length === 0) return { items: [], reason: ESTIMATE_REASON.noAnswer };
  return { items, reason: null };
}

/**
 * Hängt Schätzungen an die gemeldeten Unterposten. Gemeldete Zeilen bleiben.
 * `data === undefined` heißt: der Key fehlt. `data === null` heißt: keine Antwort.
 */
export function attachSubItemEstimates(
  base: SegmentSupplement,
  official: readonly OfficialSegment[],
  llm: { available: boolean; data: unknown | null },
): SegmentSupplement & { estimateNote: string | null } {
  const covered = new Set(base.subItems.map(i => norm(i.parent)));
  const open = official.some(s => !covered.has(norm(s.name)));
  if (!open) return { ...base, estimateNote: null };
  if (!llm.available) return { ...base, estimateNote: ESTIMATE_REASON.noKey };
  if (llm.data == null) return { ...base, estimateNote: ESTIMATE_REASON.noAnswer };
  const parsed = parseSubItemEstimates(llm.data, official, covered);
  if (parsed.items.length === 0) return { ...base, estimateNote: parsed.reason ?? ESTIMATE_REASON.noAnswer };
  return { ...base, subItems: [...base.subItems, ...parsed.items], estimateNote: null };
}
