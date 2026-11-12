/**
 * Custom Criteria (WORK_DASHBOARD_FEATURES §5) auf bereits geladenen Kandidaten.
 * GET /api/screener und POST /api/researcher/screener bleiben unverändert.
 * Ein fehlendes Responsefeld ist n/a und wird nie als 0 verglichen.
 * UNDERVALUED_SCREEN_PRESET benennt den bestehenden Researcher-POST.
 * RESEARCHER_MARKET_CAP_USD_PER_MILLION ist dieselbe Mio.-USD-Skala wie
 * server/researcher.ts (`marketCapMin * 1e6`), keine neue Schwelle.
 */

export const UNDERVALUED_SCREEN_PRESET = {
  marketCapMin: 1000,
  marketCapMax: 500000,
  peMax: 30,
  revenueGrowthMin: 5,
} as const;

export const RESEARCHER_MARKET_CAP_USD_PER_MILLION = 1_000_000;

export const LOADED_UNIVERSE_NOTE =
  "Nur bereits geladene Kandidaten. Kein Volluniversum-Scan.";

export const MISSING_MARKET_CAP =
  "n/a — Marktkapitalisierung fehlt im geladenen Response, nicht als 0 gewertet";
export const MISSING_INDUSTRY = "n/a — Industrie fehlt im geladenen Response";
export const MISSING_COUNTRY = "n/a — Land fehlt im geladenen Response";
export const MISSING_ROIC =
  "n/a — ROIC fehlt im geladenen Response, nicht als 0 gewertet";
export const MISSING_FORWARD_PE =
  "n/a — Forward P/E fehlt im geladenen Response, nicht als 0 gewertet";
export const NON_NUMERIC_NOTE =
  "n/a — Kriterium ist nicht numerisch und wird nicht als 0 gefiltert";
export const CAP_RANGE_NOTE =
  "MCap min liegt über MCap max. Beide Grenzen bleiben unangewendet.";
export const CAP_NEGATIVE_NOTE =
  "Negative MCap-Grenze bleibt unangewendet.";
export const CAP_SCALE_NOTE =
  "MCap ist nach der Einheitenumrechnung nicht endlich und bleibt unangewendet.";

export interface CustomScreenCriteria {
  marketCapMin: number | null;
  marketCapMax: number | null;
  industryIncludes: string | null;
  countryIncludes: string | null;
  roicMin: number | null;
  forwardPeMax: number | null;
}

export interface CriterionDraft {
  marketCapMin: string;
  marketCapMax: string;
  industry: string;
  country: string;
  roicMin: string;
  forwardPeMax: string;
}

export interface LoadedScreenRow {
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

export function emptyDraft(): CriterionDraft {
  return {
    marketCapMin: "",
    marketCapMax: "",
    industry: "",
    country: "",
    roicMin: "",
    forwardPeMax: "",
  };
}

/** 0 ist der geladene Sentinel. Jede andere endliche Zahl, auch negativ, bleibt Messwert. */
function zeroSentinelOrMissing(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  return value;
}

function finiteOrMissing(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function textOrMissing(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Liest nur Felder, die der geladene Kandidat wirklich trägt. Sektor und trailing P/E bleiben außen vor. */
export function rowFromLoadedCandidate(stock: object): LoadedScreenRow {
  const row = stock as Record<string, unknown>;
  const forwardPe = row.forwardPE ?? row.forwardPe;
  return {
    marketCap: zeroSentinelOrMissing(row.marketCap),
    industry: textOrMissing(row.industry),
    country: textOrMissing(row.country),
    roic: finiteOrMissing(row.roic),
    forwardPe: zeroSentinelOrMissing(forwardPe),
  };
}

function parseNumber(raw: string): { value: number | null; note: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: null, note: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { value: null, note: NON_NUMERIC_NOTE };
  return { value, note: null };
}

export function criteriaFromInputs(
  draft: CriterionDraft,
  marketCapUsdPerUnit: number,
): { criteria: CustomScreenCriteria; notes: string[] } {
  const parsedMin = parseNumber(draft.marketCapMin);
  const parsedMax = parseNumber(draft.marketCapMax);
  const roicMin = parseNumber(draft.roicMin);
  const forwardPeMax = parseNumber(draft.forwardPeMax);
  const scale = Number.isFinite(marketCapUsdPerUnit) && marketCapUsdPerUnit > 0
    ? marketCapUsdPerUnit
    : 1;
  let marketCapMin = scaleMarketCap(parsedMin, scale);
  let marketCapMax = scaleMarketCap(parsedMax, scale);
  const notes: string[] = [];
  for (const note of [marketCapMin.note, marketCapMax.note, roicMin.note, forwardPeMax.note]) {
    if (note && !notes.includes(note)) notes.push(note);
  }
  if (marketCapMin.value != null && marketCapMax.value != null && marketCapMin.value > marketCapMax.value) {
    notes.push(CAP_RANGE_NOTE);
    marketCapMin = { value: null, note: CAP_RANGE_NOTE };
    marketCapMax = { value: null, note: CAP_RANGE_NOTE };
  }
  return {
    criteria: {
      marketCapMin: marketCapMin.value,
      marketCapMax: marketCapMax.value,
      industryIncludes: draft.industry.trim() || null,
      countryIncludes: draft.country.trim() || null,
      roicMin: roicMin.value,
      forwardPeMax: forwardPeMax.value,
    },
    notes,
  };
}

function scaleMarketCap(
  parsed: { value: number | null; note: string | null },
  scale: number,
): { value: number | null; note: string | null } {
  if (parsed.note || parsed.value == null) return parsed;
  if (parsed.value < 0) return { value: null, note: CAP_NEGATIVE_NOTE };
  const scaled = parsed.value * scale;
  if (!Number.isFinite(scaled)) return { value: null, note: CAP_SCALE_NOTE };
  return { value: scaled, note: null };
}

function pushSkip(skipped: ScreenSkip[], field: string, reason: string): void {
  if (!skipped.some((skip) => skip.field === field)) skipped.push({ field, reason });
}

export function decideCustomScreen(row: LoadedScreenRow, criteria: CustomScreenCriteria): ScreenDecision {
  const skipped: ScreenSkip[] = [];
  let pass = true;

  if (criteria.marketCapMin != null) {
    if (row.marketCap == null) {
      pass = false;
      pushSkip(skipped, "Marktkapitalisierung", MISSING_MARKET_CAP);
    } else if (row.marketCap < criteria.marketCapMin) pass = false;
  }
  if (criteria.marketCapMax != null) {
    if (row.marketCap == null) {
      pass = false;
      pushSkip(skipped, "Marktkapitalisierung", MISSING_MARKET_CAP);
    } else if (row.marketCap > criteria.marketCapMax) pass = false;
  }
  if (criteria.industryIncludes) {
    if (!row.industry) {
      pass = false;
      pushSkip(skipped, "Industrie", MISSING_INDUSTRY);
    } else if (!row.industry.toLowerCase().includes(criteria.industryIncludes.toLowerCase())) pass = false;
  }
  if (criteria.countryIncludes) {
    if (!row.country) {
      pass = false;
      pushSkip(skipped, "Land", MISSING_COUNTRY);
    } else if (!row.country.toLowerCase().includes(criteria.countryIncludes.toLowerCase())) pass = false;
  }
  if (criteria.roicMin != null) {
    if (row.roic == null) {
      pass = false;
      pushSkip(skipped, "ROIC", MISSING_ROIC);
    } else if (row.roic < criteria.roicMin) pass = false;
  }
  if (criteria.forwardPeMax != null) {
    if (row.forwardPe == null) {
      pass = false;
      pushSkip(skipped, "Forward P/E", MISSING_FORWARD_PE);
    } else if (row.forwardPe > criteria.forwardPeMax) pass = false;
  }

  return { pass, skipped };
}

export function unavailableInLoadedSet(rows: readonly LoadedScreenRow[]): string[] {
  if (rows.length === 0) return [];
  const notes: string[] = [];
  if (rows.every((row) => row.marketCap == null)) notes.push(MISSING_MARKET_CAP);
  if (rows.every((row) => row.industry == null)) notes.push(MISSING_INDUSTRY);
  if (rows.every((row) => row.country == null)) notes.push(MISSING_COUNTRY);
  if (rows.every((row) => row.roic == null)) notes.push(MISSING_ROIC);
  if (rows.every((row) => row.forwardPe == null)) notes.push(MISSING_FORWARD_PE);
  return notes;
}

export function projectLoadedScreen<T>(
  items: readonly T[],
  toRow: (item: T) => LoadedScreenRow,
  criteria: CustomScreenCriteria,
): { visible: T[]; unavailable: string[]; skipped: string[] } {
  const rows = items.map((item) => toRow(item));
  const visible: T[] = [];
  const skipped: string[] = [];
  items.forEach((item, index) => {
    const decision = decideCustomScreen(rows[index], criteria);
    if (decision.pass) visible.push(item);
    for (const skip of decision.skipped) {
      if (!skipped.includes(skip.reason)) skipped.push(skip.reason);
    }
  });
  return { visible, unavailable: unavailableInLoadedSet(rows), skipped };
}
