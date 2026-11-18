/**
 * F1-67 / F1-68: SPY-Factpack füllt leere FMP-Felder aus Yahoo quoteSummary.
 * Nur Anzeige. Ein vorhandener FMP-Wert bleibt. Fehlende Yahoo-Felder bleiben n/a mit Grund.
 */
import {
  roundTo,
  valuationFromParts,
  type ValuationCore,
} from "./recession-market-charts";

export const YAHOO_FACTPACK_MODULES = ["summaryDetail", "defaultKeyStatistics", "earningsTrend"] as const;

export const YAHOO_FACTPACK_SOURCE = "Yahoo quoteSummary";

export interface YahooFactpackFields {
  trailingEps: number | null;
  trailingPe: number | null;
  forwardEps: number | null;
  trailingReason: string;
  forwardReason: string;
}

function rawNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "raw" in value) {
    const raw = (value as { raw: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

function positive(value: number | null): number | null {
  return value != null && value > 0 ? value : null;
}

/** earningsTrend: +1y, sonst 0y. Kein anderes Periodenlabel, nichts geschätzt. */
export function parseYahooFactpack(result: unknown): YahooFactpackFields {
  const empty = (reason: string): YahooFactpackFields => ({
    trailingEps: null,
    trailingPe: null,
    forwardEps: null,
    trailingReason: reason,
    forwardReason: reason,
  });
  if (!result || typeof result !== "object") return empty("Yahoo quoteSummary ohne Ergebnis");
  const row = result as {
    summaryDetail?: { trailingPE?: unknown };
    defaultKeyStatistics?: { trailingEps?: unknown };
    earningsTrend?: { trend?: unknown };
  };
  const trailingRaw = rawNum(row.defaultKeyStatistics?.trailingEps);
  const trailingEps = positive(trailingRaw);
  const trailingPe = positive(rawNum(row.summaryDetail?.trailingPE));
  const trend = Array.isArray(row.earningsTrend?.trend) ? row.earningsTrend.trend : [];
  const pick = (period: string) => trend.find(item => item && typeof item === "object" && (item as { period?: string }).period === period);
  const plus = pick("+1y") as { earningsEstimate?: { avg?: unknown } } | undefined;
  const current = pick("0y") as { earningsEstimate?: { avg?: unknown } } | undefined;
  const forwardRaw = rawNum(plus?.earningsEstimate?.avg) ?? rawNum(current?.earningsEstimate?.avg);
  const forwardEps = positive(forwardRaw);
  return {
    trailingEps,
    trailingPe,
    forwardEps,
    trailingReason: trailingEps != null
      ? ""
      : trailingRaw != null && trailingRaw <= 0
        ? "Yahoo trailingEps ≤ 0, nicht verwendet"
        : "Yahoo quoteSummary ohne trailingEps",
    forwardReason: forwardEps != null
      ? ""
      : forwardRaw != null && forwardRaw <= 0
        ? "Yahoo forward EPS ≤ 0, nicht verwendet"
        : "Yahoo earningsTrend ohne +1y/0y eps avg",
  };
}

/**
 * Füllt nur Felder, die FMP leer gelassen hat.
 * Wachstum aus Forward und TTM nur, wenn das TTM ebenfalls von Yahoo kommt.
 * Ein FMP-KGV bleibt; dann kein gemischtes g.
 */
export function fillSpyValuationGaps(
  core: ValuationCore,
  price: number | null,
  yahoo: YahooFactpackFields,
  allowForward: boolean,
): { core: ValuationCore; notes: string[] } {
  const notes: string[] = [];
  let next = core;
  const fmpHadPe = core.pe != null;

  if (!fmpHadPe) {
    if (yahoo.trailingEps != null && price != null && price > 0) {
      const filled = valuationFromParts({
        price,
        ttmEps: yahoo.trailingEps,
        prevTtmEps: null,
        epsNtm: null,
        allowForward: false,
        keyMetricsPe: null,
      });
      next = {
        ...next,
        pe: filled.pe,
        peg: next.peg ?? filled.peg,
        pegKind: next.pegKind ?? filled.pegKind,
        pegExpensive: next.peg != null ? next.pegExpensive : filled.pegExpensive,
      };
      notes.push(`PE/EPS: ${YAHOO_FACTPACK_SOURCE} trailingEps (FMP leer)`);
    } else if (yahoo.trailingPe != null) {
      next = { ...next, pe: roundTo(yahoo.trailingPe, 2) };
      notes.push(`PE: ${YAHOO_FACTPACK_SOURCE} trailingPE (FMP ohne EPS)`);
    } else {
      notes.push(`PE n/a: FMP leer; ${yahoo.trailingReason}`);
    }
  }

  if (allowForward && next.peFwd == null) {
    if (yahoo.forwardEps != null && price != null && price > 0) {
      const filled = valuationFromParts({
        price,
        ttmEps: fmpHadPe ? null : yahoo.trailingEps,
        prevTtmEps: null,
        epsNtm: yahoo.forwardEps,
        allowForward: true,
        keyMetricsPe: null,
      });
      next = {
        ...next,
        peFwd: filled.peFwd,
        gCons: next.gCons ?? (fmpHadPe ? null : filled.gCons),
        pegFwd: next.pegFwd ?? (fmpHadPe ? null : filled.pegFwd),
        pegFwdKind: next.pegFwdKind ?? (fmpHadPe ? null : filled.pegFwdKind),
        pegFwdExpensive: next.pegFwd != null ? next.pegFwdExpensive : (fmpHadPe ? next.pegFwdExpensive : filled.pegFwdExpensive),
      };
      notes.push(`Forward: ${YAHOO_FACTPACK_SOURCE} earningsTrend (FMP analyst-estimates leer)`);
      if (fmpHadPe) notes.push("g n/a: TTM bleibt FMP, Forward-EPS ist Yahoo — kein gemischtes Wachstum");
      else if (filled.gCons == null) notes.push("g n/a: Yahoo ohne TTM-EPS neben dem Forward-EPS");
    } else {
      notes.push(`fwd n/a: FMP leer; ${yahoo.forwardReason}`);
    }
  }

  if (notes.length === 0) return { core, notes };
  return {
    core: { ...next, note: [core.note, ...notes].filter(Boolean).join(" ") },
    notes,
  };
}
