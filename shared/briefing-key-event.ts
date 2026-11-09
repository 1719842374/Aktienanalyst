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

export function toBriefingKeyEvent(change: BriefingKeyEventInput): BriefingKeyEventCard {
  const fromEvent = sectorNames(change.affectedSectors);
  const fromDcf = sectorNames(change.dcfImplications?.affectedSectors);
  const sectors = (fromEvent.length ? fromEvent : fromDcf).slice(0, 6);
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
    affectedSectors: sectors.length ? sectors : ["n/a — keine Sektoren im Makro-Event"],
  };
}
