/**
 * Kosmetik S7 Rezession „Prozentschätzungen“: Die Zeile hat das feste Label „Formel: “.
 * Der Server liefert für recession_full (server/recession.ts, Mischformel mit NY-Fed-Anker)
 * den Text bereits MIT Präfix „Formel: …“, die übrigen Gruppen (groupFormula) ohne.
 * Ergebnis vorher: „Formel: Formel: 50% + …“. Nur Anzeige: Präfix einmal entfernen, Rest unverändert.
 */
export function formulaWithoutLabel(formula: string | null | undefined): string {
  if (typeof formula !== "string") return "n/a";
  const t = formula.replace(/^\s*Formel:\s*/i, "");
  return t.trim() ? t : "n/a";
}
