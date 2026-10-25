/**
 * S17 „Event hinzufügen“ (WORK_DASHBOARD_FEATURES_2026-10.md §4b), Stufe 1.
 * Ein Event ist nur ein zusätzlicher Katalysator in der bestehenden Liste (Philip, 25.10.2026):
 * keine neue Gewichtung, kein Extra-Cap, keine Sonderlogik. Netto/GB nach derselben Formel wie
 * server/catalyst-engine.ts (Netto = Brutto × (1 − Einpreisung/100), GB = PoS/100 × Netto);
 * Score/Ziel danach über die bestehenden Pfade (sumUpsideGb → computeOverallScore, selectCatalystBase).
 */
import type { Catalyst } from "./schema";

export const CATALYST_EVENT_VARIABLES = ["umsatz", "marge", "einmaleffekt", "multiple", "wacc", "sonstiges"] as const;
export type CatalystEventVariable = typeof CATALYST_EVENT_VARIABLES[number];
export const USER_EVENT_TAG = "user-event";
/** Philip 25.10.2026: Downside-Events zählen nur bei Eintrittswahrscheinlichkeit > 50 % (strikt). */
export const DOWNSIDE_EVENT_MIN_POS_EXCLUSIVE = 50;

/** KI-Schema: Variable, Delta, Horizont, Wahrscheinlichkeit (+ Einpreisung, Begründung). */
export interface CatalystEventImpact {
  name: string;
  variable: CatalystEventVariable;
  /** Kursimpact bei Eintreten in % (= Brutto-Upside; negativ = Downside). */
  deltaPct: number;
  horizonMonths: number;
  /** Eintrittswahrscheinlichkeit 0–100 (= PoS). */
  pos: number;
  einpreisungsgrad: number;
  rationale?: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return typeof v === "boolean" || v == null || v === "" || !Number.isFinite(n) ? null : n;
};

/** Prüft ein Impact-Objekt (KI oder Formular). Ungültig → Fehlertext; nichts wird still verbogen. */
export function validateCatalystEventImpact(raw: any): { impact: CatalystEventImpact } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Kein Impact-Objekt" };
  const name = String(raw.name ?? "").trim();
  if (!name) return { error: "Name fehlt" };
  const variable = String(raw.variable ?? "sonstiges").toLowerCase() as CatalystEventVariable;
  if (!CATALYST_EVENT_VARIABLES.includes(variable)) return { error: `Variable unbekannt: ${raw.variable}` };
  const deltaPct = num(raw.deltaPct);
  if (deltaPct == null || deltaPct === 0) return { error: "Delta % fehlt oder 0" };
  const horizonMonths = num(raw.horizonMonths);
  if (horizonMonths == null || horizonMonths <= 0) return { error: "Horizont (Monate) fehlt" };
  const pos = num(raw.pos);
  if (pos == null || pos < 0 || pos > 100) return { error: "Wahrscheinlichkeit muss 0–100 % sein" };
  const ein = raw.einpreisungsgrad == null || raw.einpreisungsgrad === "" ? 0 : num(raw.einpreisungsgrad);
  if (ein == null || ein < 0 || ein > 100) return { error: "Einpreisungsgrad muss 0–100 % sein" };
  const rationale = raw.rationale != null ? String(raw.rationale).trim().slice(0, 600) : undefined;
  return { impact: { name: name.slice(0, 120), variable, deltaPct, horizonMonths: Math.round(horizonMonths), pos, einpreisungsgrad: ein, ...(rationale ? { rationale } : {}) } };
}

/** Impact → Catalyst. Formel identisch zu catalyst-engine.ts (generateCatalysts, Netto/GB). */
export function eventToCatalyst(impact: CatalystEventImpact): Catalyst {
  const bruttoUpside = impact.deltaPct;
  const nettoUpside = +(bruttoUpside * (1 - impact.einpreisungsgrad / 100)).toFixed(2);
  const gb = +(impact.pos / 100 * nettoUpside).toFixed(2);
  const negative = bruttoUpside < 0;
  return {
    name: impact.name,
    timeline: `${impact.horizonMonths}M`,
    pos: impact.pos,
    bruttoUpside,
    einpreisungsgrad: impact.einpreisungsgrad,
    nettoUpside,
    gb,
    context: `User-Event (${impact.variable})${impact.rationale ? `: ${impact.rationale}` : ""}`,
    tags: [USER_EVENT_TAG],
    direction: negative ? "negative" : "positive",
    flag: negative ? "▼" : "▲",
  };
}

export function isUserEvent(c: { tags?: string[] } | null | undefined): boolean {
  return !!c && Array.isArray(c.tags) && c.tags.includes(USER_EVENT_TAG);
}

/** Downside-Event unterhalb der Schwelle (≤ 50 %): wird angezeigt, fließt aber nicht ein. */
export function isDownsideEventBelowThreshold(c: Pick<Catalyst, "bruttoUpside" | "pos">): boolean {
  return c.bruttoUpside < 0 && !(c.pos > DOWNSIDE_EVENT_MIN_POS_EXCLUSIVE);
}
