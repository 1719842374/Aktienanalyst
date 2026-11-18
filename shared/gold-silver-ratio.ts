/**
 * Gold/Silber-Ratio aus Tages-Schlusskursen. Reine Rechnung, kein Score.
 * Ein Punkt nur, wenn Gold und Silber am selben Kalendertag einen positiven Close haben.
 * Die Quellwahl folgt pickLongerSource: FMP bleibt, Yahoo nur wenn es leer ist
 * oder mehr als 365 Tage früher beginnt. Die beiden Beine eines Punktes
 * kommen immer vom selben Anbieter.
 */

export interface SpotClose {
  date: string;
  close: number;
}

export interface GoldSilverRatioPoint {
  date: string;
  gold: number;
  silver: number;
  ratio: number;
}

export interface GoldSilverRatioHistory {
  points: GoldSilverRatioPoint[];
  source: string;
  goldSource: string | null;
  silverSource: string | null;
  from: string | null;
  to: string | null;
  unavailableReason: string | null;
}

export const FMP_RATIO_GOLD_SOURCE = "FMP GCUSD";
export const FMP_RATIO_SILVER_SOURCE = "FMP SIUSD";
export const YAHOO_RATIO_GOLD_SOURCE = "Yahoo GC=F (Futures)";
export const YAHOO_RATIO_SILVER_SOURCE = "Yahoo SI=F (Futures)";
export const FMP_RATIO_SOURCE = `${FMP_RATIO_GOLD_SOURCE} / ${FMP_RATIO_SILVER_SOURCE}`;
export const YAHOO_RATIO_SOURCE = `${YAHOO_RATIO_GOLD_SOURCE} / ${YAHOO_RATIO_SILVER_SOURCE}`;
/** Dieselbe Schwelle wie pickLongerSource in server/gold-chart-history.ts. */
export const RATIO_SOURCE_GAP_DAYS = 365;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function positiveClose(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Gold-Close / Silber-Close je gemeinsamem Tag.
 * Tage ohne Gegenstück, ohne Datum oder ohne positiven Close fallen weg (kein Fortschreiben).
 * Doppelte Gold-Tage: der erste gültige Close bleibt.
 */
export function alignGoldSilverSeries(
  gold: readonly SpotClose[],
  silver: readonly SpotClose[],
): GoldSilverRatioPoint[] {
  const silverByDate = new Map<string, number>();
  for (const row of silver) {
    const date = String(row?.date ?? "").slice(0, 10);
    const close = positiveClose(row?.close);
    if (!DATE_RE.test(date) || close == null) continue;
    silverByDate.set(date, close);
  }
  const seen = new Set<string>();
  const out: GoldSilverRatioPoint[] = [];
  for (const row of gold) {
    const date = String(row?.date ?? "").slice(0, 10);
    if (!DATE_RE.test(date) || seen.has(date)) continue;
    const goldClose = positiveClose(row?.close);
    if (goldClose == null) continue;
    const silverClose = silverByDate.get(date);
    if (silverClose == null) continue;
    seen.add(date);
    out.push({ date, gold: goldClose, silver: silverClose, ratio: goldClose / silverClose });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function chooseLongerRatioSeries(
  fmp: readonly GoldSilverRatioPoint[],
  yahoo: readonly GoldSilverRatioPoint[],
): { points: GoldSilverRatioPoint[]; vendor: "fmp" | "yahoo" | "none" } {
  if (fmp.length === 0 && yahoo.length === 0) return { points: [], vendor: "none" };
  if (fmp.length === 0) return { points: [...yahoo], vendor: "yahoo" };
  if (yahoo.length === 0) return { points: [...fmp], vendor: "fmp" };
  const gapDays = (Date.parse(fmp[0].date) - Date.parse(yahoo[0].date)) / 864e5;
  return gapDays > RATIO_SOURCE_GAP_DAYS
    ? { points: [...yahoo], vendor: "yahoo" }
    : { points: [...fmp], vendor: "fmp" };
}

export function ratioSourceLabel(vendor: "fmp" | "yahoo" | "none"): {
  source: string;
  goldSource: string | null;
  silverSource: string | null;
} {
  if (vendor === "yahoo") {
    return { source: YAHOO_RATIO_SOURCE, goldSource: YAHOO_RATIO_GOLD_SOURCE, silverSource: YAHOO_RATIO_SILVER_SOURCE };
  }
  if (vendor === "fmp") {
    return { source: FMP_RATIO_SOURCE, goldSource: FMP_RATIO_GOLD_SOURCE, silverSource: FMP_RATIO_SILVER_SOURCE };
  }
  return { source: FMP_RATIO_SOURCE, goldSource: null, silverSource: null };
}

export function buildGoldSilverRatioHistory(input: {
  fmpGold: readonly SpotClose[];
  fmpSilver: readonly SpotClose[];
  yahooGold: readonly SpotClose[];
  yahooSilver: readonly SpotClose[];
}): GoldSilverRatioHistory {
  const chosen = chooseLongerRatioSeries(
    alignGoldSilverSeries(input.fmpGold, input.fmpSilver),
    alignGoldSilverSeries(input.yahooGold, input.yahooSilver),
  );
  const labels = ratioSourceLabel(chosen.vendor);
  const points = chosen.points;
  return {
    points,
    source: labels.source,
    goldSource: labels.goldSource,
    silverSource: labels.silverSource,
    from: points[0]?.date ?? null,
    to: points.length > 0 ? points[points.length - 1].date : null,
    unavailableReason: points.length === 0
      ? "keine gemeinsamen Handelstage (FMP GCUSD/SIUSD und Yahoo GC=F/SI=F)"
      : null,
  };
}

export function ratioCoverageInWindow(
  windowDates: readonly string[],
  ratioDates: readonly string[],
): { matched: number; firstMatch: string | null; startsWithWindow: boolean } {
  if (windowDates.length === 0) return { matched: 0, firstMatch: null, startsWithWindow: false };
  const have = new Set(ratioDates);
  let matched = 0;
  let firstMatch: string | null = null;
  for (const date of windowDates) {
    if (!have.has(date)) continue;
    matched += 1;
    if (firstMatch == null) firstMatch = date;
  }
  return { matched, firstMatch, startsWithWindow: firstMatch != null && firstMatch === windowDates[0] };
}

export type GoldSilverRatioAvailability = "loading" | "missing" | "window-miss" | "partial" | "ready";

/** Sichtbarer Hinweis statt einer leeren Linie. `hint` ist null nur bei voller Abdeckung. */
export function goldSilverRatioAvailability(input: {
  pending: boolean;
  loadError: string | null;
  unavailableReason: string | null;
  source: string | null;
  windowDates: readonly string[];
  ratioDates: readonly string[];
}): { availability: GoldSilverRatioAvailability; hint: string | null } {
  if (input.pending) {
    return { availability: "loading", hint: "Gold/Silber-Ratio: Kurse werden geladen …" };
  }
  if (input.loadError) {
    return { availability: "missing", hint: `Gold/Silber-Ratio: n/a — ${input.loadError}` };
  }
  if (input.ratioDates.length === 0) {
    return {
      availability: "missing",
      hint: `Gold/Silber-Ratio: n/a — ${input.unavailableReason ?? "keine gemeinsamen Handelstage"}`,
    };
  }
  const cov = ratioCoverageInWindow(input.windowDates, input.ratioDates);
  if (cov.matched === 0) {
    return { availability: "window-miss", hint: "Gold/Silber-Ratio: n/a — keine Werte in diesem Zeitfenster." };
  }
  if (!cov.startsWithWindow && cov.firstMatch) {
    const src = input.source ? ` · Quelle ${input.source}` : "";
    return { availability: "partial", hint: `Gold/Silber-Ratio ab ${cov.firstMatch}${src}` };
  }
  return { availability: "ready", hint: null };
}
