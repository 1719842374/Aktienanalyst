/**
 * Custom Screen (WORK_DASHBOARD_FEATURES §5).
 * Kriterien kommen vom Nutzer. Ein fehlendes Feld ist n/a und besteht den Filter nicht,
 * wird aber nie als 0 verglichen.
 * UNDERVALUED_SCREEN_PRESET sind die bisherigen Researcher-Defaults, nur benannt,
 * damit das Formular denselben ersten Lauf schickt.
 */

export const UNDERVALUED_SCREEN_PRESET = {
  marketCapMin: 1000,
  marketCapMax: 500000,
  peMax: 30,
  revenueGrowthMin: 5,
} as const;

export interface CustomScreenCriteria {
  marketCapMin: number | null;
  marketCapMax: number | null;
  /** Teilstring, case-insensitive. */
  industryIncludes: string | null;
  countryIncludes: string | null;
  roicMin: number | null;
  forwardPeMax: number | null;
}

export interface ScreenableRow {
  marketCap: number | null;
  industry: string | null;
  country: string | null;
  roic: number | null;
  forwardPe: number | null;
}

export interface ScreenSkip {
  field: string;
  reason: string;
}

export interface ScreenDecision {
  pass: boolean;
  skipped: ScreenSkip[];
}

function missing(field: string): ScreenSkip {
  return { field, reason: `n/a — ${field} fehlt, nicht als 0 gewertet` };
}

function finiteOrNull(v: number | null): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function decideCustomScreen(row: ScreenableRow, criteria: CustomScreenCriteria): ScreenDecision {
  const marketCapMin = finiteOrNull(criteria.marketCapMin);
  const marketCapMax = finiteOrNull(criteria.marketCapMax);
  const roicMin = finiteOrNull(criteria.roicMin);
  const forwardPeMax = finiteOrNull(criteria.forwardPeMax);
  const skipped: ScreenSkip[] = [];
  if (marketCapMin != null) {
    if (row.marketCap == null) return { pass: false, skipped: [missing("Marktkapitalisierung")] };
    if (row.marketCap < marketCapMin) return { pass: false, skipped };
  }
  if (marketCapMax != null) {
    if (row.marketCap == null) return { pass: false, skipped: [missing("Marktkapitalisierung")] };
    if (row.marketCap > marketCapMax) return { pass: false, skipped };
  }
  if (criteria.industryIncludes) {
    if (!row.industry) return { pass: false, skipped: [missing("Industrie")] };
    if (!row.industry.toLowerCase().includes(criteria.industryIncludes.toLowerCase())) return { pass: false, skipped };
  }
  if (criteria.countryIncludes) {
    if (!row.country) return { pass: false, skipped: [missing("Land")] };
    if (!row.country.toLowerCase().includes(criteria.countryIncludes.toLowerCase())) return { pass: false, skipped };
  }
  if (roicMin != null) {
    if (row.roic == null) return { pass: false, skipped: [missing("ROIC")] };
    if (row.roic < roicMin) return { pass: false, skipped };
  }
  if (forwardPeMax != null) {
    if (row.forwardPe == null) return { pass: false, skipped: [missing("Forward P/E")] };
    if (row.forwardPe > forwardPeMax) return { pass: false, skipped };
  }
  return { pass: true, skipped };
}

export function emptyCriteria(): CustomScreenCriteria {
  return {
    marketCapMin: null,
    marketCapMax: null,
    industryIncludes: null,
    countryIncludes: null,
    roicMin: null,
    forwardPeMax: null,
  };
}
