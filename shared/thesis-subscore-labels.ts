/**
 * Anzeigenamen der Thesis-Teilscores A–E.
 * Die Buchstaben und die Scores bleiben in server/thesis-strength.ts.
 * Diese Map ändert keine Gewichte und keine Punktwerte.
 */
export const THESIS_SUBSCORE_LABELS = {
  A: "Vertrag",
  B: "Bilanz",
  C: "Wachstum",
  D: "Bilanzqualität",
  E: "Katalysator",
} as const;

export type ThesisSubscoreKey = keyof typeof THESIS_SUBSCORE_LABELS;

export function thesisSubscoreLabel(key: string): string | null {
  if (Object.prototype.hasOwnProperty.call(THESIS_SUBSCORE_LABELS, key)) {
    return THESIS_SUBSCORE_LABELS[key as ThesisSubscoreKey];
  }
  return null;
}
