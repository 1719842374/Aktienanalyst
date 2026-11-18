/**
 * Fields the Country Macro Pulse KeyEventCard reads.
 * Missing source text stays n/a with a reason. A present source string is kept,
 * including a real "neutral" from the macro event. Nothing here invents a direction.
 */

export interface BriefingKeyEventCard {
  title: string;
  category: string;
  severity: string;
  timeframe: string;
  description: string;
  inflationImpact: string;
  rateImpact: string;
  equityImpact: string;
  rationale: string;
  affectedSectors: string[];
}

export interface BriefingKeyEventInput {
  title?: unknown;
  category?: unknown;
  severity?: unknown;
  timeframe?: unknown;
  description?: unknown;
  rationale?: unknown;
  action?: unknown;
  dcfImplication?: unknown;
  inflationImpact?: unknown;
  rateImpact?: unknown;
  equityImpact?: unknown;
  affectedSectors?: unknown;
  dcfImplications?: { affectedSectors?: unknown } | null;
}

function presentText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text === "none" || text === "n/v") return null;
  return text;
}

function sectorNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    const text = presentText(item);
    if (text) names.push(text);
  }
  return names;
}

function orNa(value: unknown, reason: string): string {
  return presentText(value) ?? `n/a — ${reason}`;
}

/** Shown when sector tags are taken from dcfImplications, not from the macro event. */
export const DCF_SECTOR_HINT = "Sektoren aus DCF-Implikationen";

/**
 * One source row for a top change. The index is the position in that region's
 * macro keyEvents. Two hits, or no index, is not a match. Titles are not compared.
 */
export function uniqueSourceByIndex<T extends { sourceIndex?: unknown }>(
  events: readonly T[],
  sourceIndex: unknown,
): T | null {
  if (typeof sourceIndex !== "number" || !Number.isInteger(sourceIndex) || sourceIndex < 0) return null;
  let hit: T | null = null;
  for (const ev of events) {
    if (ev.sourceIndex !== sourceIndex) continue;
    if (hit) return null;
    hit = ev;
  }
  return hit;
}

/** Card fields for one top change. Without a unique source index the source fields are n/a. */
export function briefingCardForChange(
  change: BriefingKeyEventInput & { sourceIndex?: unknown },
  events: readonly (BriefingKeyEventInput & { sourceIndex?: unknown })[],
): BriefingKeyEventCard {
  const src = uniqueSourceByIndex(events, change.sourceIndex);
  if (!src) {
    return toBriefingKeyEvent({ title: change.title, category: change.category });
  }
  const own = sectorNames(src.affectedSectors);
  return toBriefingKeyEvent({
    title: change.title,
    category: change.category,
    severity: src.severity,
    timeframe: src.timeframe,
    description: src.description,
    rationale: src.rationale,
    action: src.action,
    dcfImplication: src.dcfImplication,
    inflationImpact: src.inflationImpact,
    rateImpact: src.rateImpact,
    equityImpact: src.equityImpact,
    affectedSectors: own.length ? src.affectedSectors : undefined,
    dcfImplications: own.length ? undefined : change.dcfImplications,
  });
}

export function toBriefingKeyEvent(change: BriefingKeyEventInput): BriefingKeyEventCard {
  const fromEvent = sectorNames(change.affectedSectors);
  const fromDcf = sectorNames(change.dcfImplications?.affectedSectors).filter(name => name !== DCF_SECTOR_HINT);
  const sectors = fromEvent.length
    ? fromEvent.slice(0, 6)
    : fromDcf.length
      ? [...fromDcf.slice(0, 5), DCF_SECTOR_HINT]
      : ["n/a — keine Sektoren im Makro-Event"];
  return {
    title: orNa(change.title, "Event ohne Titel"),
    category: orNa(change.category, "Makro-Event ohne Kategorie"),
    severity: orNa(change.severity, "Makro-Event ohne Schwere"),
    timeframe: orNa(change.timeframe, "Makro-Event ohne Zeitraum"),
    description: orNa(change.description, "Makro-Event ohne Beschreibung"),
    inflationImpact: orNa(change.inflationImpact, "Makro-Event ohne Inflationsimpuls"),
    rateImpact: orNa(change.rateImpact, "Makro-Event ohne Zinsimpuls"),
    equityImpact: orNa(change.equityImpact, "Makro-Event ohne Aktienimpuls"),
    rationale: presentText(change.rationale)
      ?? presentText(change.action)
      ?? presentText(change.dcfImplication)
      ?? "n/a — Makro-Event ohne Begründung",
    affectedSectors: sectors,
  };
}
