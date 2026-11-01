/**
 * WACC vs. ROIC, nur Anzeige (WORK_GURUFOCUS §4).
 * Wertschaffung ist das Vorzeichen der Differenz, keine zusätzliche Schwelle.
 * Fehlende Seite → n/a, nie 0. Ändert weder WACC-Rechnung noch Score.
 */

export interface WaccRoicSignal {
  roicPct: number | null;
  waccPct: number | null;
  spreadPp: number | null;
  tone: "create" | "destroy" | "flat" | "na";
  label: string;
}

export function waccRoicSignal(roicPct: number | null, waccPct: number | null): WaccRoicSignal {
  if (roicPct == null || !Number.isFinite(roicPct) || waccPct == null || !Number.isFinite(waccPct)) {
    const missing = [
      roicPct == null || !Number.isFinite(roicPct) ? "ROIC" : null,
      waccPct == null || !Number.isFinite(waccPct) ? "WACC" : null,
    ].filter(Boolean).join(" und ");
    return {
      roicPct: Number.isFinite(roicPct as number) ? roicPct : null,
      waccPct: Number.isFinite(waccPct as number) ? waccPct : null,
      spreadPp: null,
      tone: "na",
      label: `n/a — ${missing} fehlt`,
    };
  }
  const spreadPp = roicPct - waccPct;
  const tone = spreadPp > 0 ? "create" : spreadPp < 0 ? "destroy" : "flat";
  const label = tone === "create"
    ? "Wertschaffung: ROIC über WACC"
    : tone === "destroy"
      ? "Wertvernichtung: ROIC unter WACC"
      : "ROIC gleich WACC";
  return { roicPct, waccPct, spreadPp, tone, label };
}
