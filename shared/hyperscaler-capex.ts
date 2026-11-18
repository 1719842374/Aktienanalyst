/**
 * F9-08 — CAPEX der Hyperscaler, YoY.
 * Quelle: FMP cash-flow-statement, Quartal, Feld capitalExpenditure.
 * Summe nur über den letzten Quartalsstichtag, an dem jeder Name der Menge
 * einen USD-Bericht hat. Fehlende Berichte werden nicht aufgefüllt.
 * z-Score, Median und Perzentil über das benannte Fenster. Kein Score.
 */
import { distributionOverWindow, quarterOrdinal, type DistributionReading } from "./adaptive-window";

/** Cloud-Infrastruktur. Apple und Nvidia stehen nicht in der Menge (Geräte bzw. Lieferant). */
export const HYPERSCALER_CAPEX_UNIVERSE = [
  { symbol: "AMZN", label: "Amazon" },
  { symbol: "MSFT", label: "Microsoft" },
  { symbol: "GOOGL", label: "Alphabet" },
  { symbol: "META", label: "Meta" },
  { symbol: "ORCL", label: "Oracle" },
] as const;

export type HyperscalerSymbol = (typeof HYPERSCALER_CAPEX_UNIVERSE)[number]["symbol"];

/**
 * Fenster und Abruf. Keine Bewertungsschwelle.
 * windowYears = untere Kante der 15–20 Jahre aus Future_9 Z.12.
 * minQuarters = 10 Jahre Quartals-YoY, darunter bleibt die Verteilung n/a.
 * fetchQuarters = 20 Jahre Quartale, damit das Fenster plus das Vorjahr Platz hat.
 */
export const HYPERSCALER_CAPEX_PARAMS = {
  windowYears: 15,
  minQuarters: 40,
  fetchQuarters: 80,
  percentScale: 100,
} as const;

export const HYPERSCALER_CAPEX_FORMULA =
  "YoY = Summe |capitalExpenditure| im letzten Quartal mit einem USD-Bericht je Name, geteilt durch dieselbe Summe im Vorjahresquartal, minus 1. z und Perzentil über 15 Jahre. Fehlende Berichte bleiben Lücken.";

export interface CapexPrint {
  symbol: string;
  /** Periodenende YYYY-MM-DD. */
  date: string;
  /** Ausgabe, positiv, USD. */
  capexUsd: number;
}

export interface HyperscalerNameReading {
  symbol: HyperscalerSymbol;
  label: string;
  quarter: string | null;
  capexUsd: number | null;
  yoyPct: number | null;
  reason: string | null;
}

export type HyperscalerAggregate =
  | {
      available: true;
      quarter: string;
      yoyPct: number;
      capexUsd: number;
      yearAgoUsd: number;
      /** Jüngeres Quartal ohne vollständige Menge, falls vorhanden. */
      incompleteQuarter: string | null;
      incompleteReason: string | null;
    }
  | { available: false; reason: string };

export interface HyperscalerCapexView {
  universe: HyperscalerSymbol[];
  names: HyperscalerNameReading[];
  aggregate: HyperscalerAggregate;
  distribution: DistributionReading;
  formula: string;
  source: "FMP cash-flow-statement quarter capitalExpenditure";
}

export function quarterKeyFromDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const month = Number(date.slice(5, 7));
  if (month < 1 || month > 12) return null;
  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${date.slice(0, 4)}Q${quarter}`;
}

export function priorQuarterKey(quarter: string): string | null {
  const ordinal = quarterOrdinal(quarter);
  if (ordinal == null) return null;
  const prior = ordinal - 4;
  const year = Math.floor((prior - 1) / 4);
  const q = prior - year * 4;
  if (q < 1 || q > 4) return null;
  return `${year}Q${q}`;
}

interface QuarterSpend {
  quarter: string;
  capexUsd: number;
  date: string;
}

function spendsBySymbol(prints: CapexPrint[]): Map<string, Map<string, QuarterSpend>> {
  const bySymbol = new Map<string, Map<string, QuarterSpend>>();
  for (const print of prints) {
    if (!Number.isFinite(print.capexUsd) || print.capexUsd < 0) continue;
    const quarter = quarterKeyFromDate(print.date);
    if (!quarter) continue;
    let quarters = bySymbol.get(print.symbol);
    if (!quarters) {
      quarters = new Map();
      bySymbol.set(print.symbol, quarters);
    }
    const existing = quarters.get(quarter);
    if (!existing || print.date > existing.date) {
      quarters.set(quarter, { quarter, capexUsd: print.capexUsd, date: print.date });
    }
  }
  return bySymbol;
}

function nameYoy(spends: Map<string, QuarterSpend> | undefined): { quarter: string; capexUsd: number; yoyPct: number } | string {
  if (!spends || spends.size === 0) return "kein USD-Cashflow";
  const quarters = Array.from(spends.values()).sort((a, b) => a.quarter.localeCompare(b.quarter));
  const latest = quarters[quarters.length - 1];
  const priorKey = priorQuarterKey(latest.quarter);
  if (!priorKey) return `Quartal ${latest.quarter} nicht lesbar`;
  const prior = spends.get(priorKey);
  if (!prior) return `kein Vorjahresquartal ${priorKey}`;
  if (!(prior.capexUsd > 0)) return `Vorjahres-CAPEX ${priorKey} ist 0`;
  return {
    quarter: latest.quarter,
    capexUsd: latest.capexUsd,
    yoyPct: ((latest.capexUsd - prior.capexUsd) / prior.capexUsd) * HYPERSCALER_CAPEX_PARAMS.percentScale,
  };
}

function completeQuarters(bySymbol: Map<string, Map<string, QuarterSpend>>): string[] {
  const counts = new Map<string, number>();
  for (const symbol of HYPERSCALER_CAPEX_UNIVERSE) {
    const spends = bySymbol.get(symbol.symbol);
    if (!spends) continue;
    for (const quarter of Array.from(spends.keys())) counts.set(quarter, (counts.get(quarter) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count === HYPERSCALER_CAPEX_UNIVERSE.length)
    .map(([quarter]) => quarter)
    .sort((a, b) => a.localeCompare(b));
}

function sumQuarter(bySymbol: Map<string, Map<string, QuarterSpend>>, quarter: string): number | null {
  let sum = 0;
  for (const symbol of HYPERSCALER_CAPEX_UNIVERSE) {
    const spend = bySymbol.get(symbol.symbol)?.get(quarter);
    if (!spend) return null;
    sum += spend.capexUsd;
  }
  return sum;
}

/**
 * payload ist die FMP-Antwort eines Namens (newest-first).
 * Andere Währung als USD wird verworfen, nicht umgerechnet.
 * Fehlende Währung bei diesen US-Listings gilt als USD.
 */
export function printsFromFmpPayload(symbol: string, payload: unknown): { prints: CapexPrint[]; problem: string | null } {
  if (!Array.isArray(payload)) {
    return { prints: [], problem: `n/a — FMP-Antwort für ${symbol} unbrauchbar` };
  }
  if (payload.length === 0) {
    return { prints: [], problem: `n/a — FMP ohne Cashflow-Zeilen für ${symbol}` };
  }
  const prints: CapexPrint[] = [];
  let skippedCurrency = 0;
  let skippedField = 0;
  for (const row of payload) {
    if (!row || typeof row !== "object") {
      skippedField += 1;
      continue;
    }
    const record = row as Record<string, unknown>;
    const currency = typeof record.reportedCurrency === "string" ? record.reportedCurrency.trim().toUpperCase() : "";
    if (currency && currency !== "USD") {
      skippedCurrency += 1;
      continue;
    }
    const date = typeof record.date === "string" ? record.date.slice(0, 10) : "";
    const raw = record.capitalExpenditure ?? record.capitalExpenditures;
    const numeric = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (!quarterKeyFromDate(date) || !Number.isFinite(numeric)) {
      skippedField += 1;
      continue;
    }
    prints.push({ symbol, date, capexUsd: Math.abs(numeric) });
  }
  if (prints.length === 0 && skippedCurrency > 0 && skippedField === 0) {
    return { prints: [], problem: `n/a — ${symbol} nicht in USD, nicht umgerechnet` };
  }
  if (prints.length === 0) {
    return { prints: [], problem: `n/a — ${symbol} ohne capitalExpenditure` };
  }
  return { prints, problem: null };
}

export function computeHyperscalerCapex(prints: CapexPrint[], problems: Record<string, string> = {}): HyperscalerCapexView {
  const bySymbol = spendsBySymbol(prints);
  const names: HyperscalerNameReading[] = HYPERSCALER_CAPEX_UNIVERSE.map(entry => {
    const problem = problems[entry.symbol];
    const yoy = nameYoy(bySymbol.get(entry.symbol));
    if (problem && (typeof yoy === "string")) {
      return { symbol: entry.symbol, label: entry.label, quarter: null, capexUsd: null, yoyPct: null, reason: problem };
    }
    if (typeof yoy === "string") {
      return {
        symbol: entry.symbol,
        label: entry.label,
        quarter: null,
        capexUsd: null,
        yoyPct: null,
        reason: problem ?? `n/a — ${entry.symbol}: ${yoy}`,
      };
    }
    return {
      symbol: entry.symbol,
      label: entry.label,
      quarter: yoy.quarter,
      capexUsd: yoy.capexUsd,
      yoyPct: yoy.yoyPct,
      reason: null,
    };
  });

  const complete = completeQuarters(bySymbol);
  const yoyPoints: { key: string; value: number; capexUsd: number; yearAgoUsd: number }[] = [];
  for (const quarter of complete) {
    const prior = priorQuarterKey(quarter);
    if (!prior || !complete.includes(prior)) continue;
    const now = sumQuarter(bySymbol, quarter);
    const then = sumQuarter(bySymbol, prior);
    if (now == null || then == null || !(then > 0)) continue;
    yoyPoints.push({
      key: quarter,
      value: ((now - then) / then) * HYPERSCALER_CAPEX_PARAMS.percentScale,
      capexUsd: now,
      yearAgoUsd: then,
    });
  }

  const newestSeen = newestQuarter(bySymbol);
  let aggregate: HyperscalerAggregate;
  if (yoyPoints.length === 0) {
    const missing = names.filter(name => name.yoyPct == null).map(name => name.symbol);
    aggregate = {
      available: false,
      reason: missing.length > 0
        ? `n/a — kein vollständiges Quartal über ${HYPERSCALER_CAPEX_UNIVERSE.map(entry => entry.symbol).join(", ")} (${missing.join(", ")} ohne YoY)`
        : "n/a — kein Vorjahresquartal mit allen fünf Namen",
    };
  } else {
    const latest = yoyPoints[yoyPoints.length - 1];
    const incomplete = newestSeen && newestSeen > latest.key ? newestSeen : null;
    const missing = incomplete ? missingSymbols(bySymbol, incomplete) : [];
    aggregate = {
      available: true,
      quarter: latest.key,
      yoyPct: latest.value,
      capexUsd: latest.capexUsd,
      yearAgoUsd: latest.yearAgoUsd,
      incompleteQuarter: incomplete,
      incompleteReason: incomplete
        ? `n/a — ${incomplete} unvollständig (${missing.join(", ")} fehlt), nicht aufgefüllt`
        : null,
    };
  }

  return {
    universe: HYPERSCALER_CAPEX_UNIVERSE.map(entry => entry.symbol),
    names,
    aggregate,
    distribution: distributionOverWindow(yoyPoints, {
      windowYears: HYPERSCALER_CAPEX_PARAMS.windowYears,
      minPoints: HYPERSCALER_CAPEX_PARAMS.minQuarters,
      seriesLabel: "Hyperscaler-CAPEX",
    }),
    formula: HYPERSCALER_CAPEX_FORMULA,
    source: "FMP cash-flow-statement quarter capitalExpenditure",
  };
}

function newestQuarter(bySymbol: Map<string, Map<string, QuarterSpend>>): string | null {
  let newest: string | null = null;
  for (const spends of Array.from(bySymbol.values())) {
    for (const quarter of Array.from(spends.keys())) {
      if (!newest || quarter > newest) newest = quarter;
    }
  }
  return newest;
}

function missingSymbols(bySymbol: Map<string, Map<string, QuarterSpend>>, quarter: string): string[] {
  return HYPERSCALER_CAPEX_UNIVERSE
    .filter(entry => !bySymbol.get(entry.symbol)?.has(quarter))
    .map(entry => entry.symbol);
}

export function unavailableHyperscalerCapex(reason: string): HyperscalerCapexView {
  const na = { available: false as const, reason };
  return {
    universe: HYPERSCALER_CAPEX_UNIVERSE.map(entry => entry.symbol),
    names: HYPERSCALER_CAPEX_UNIVERSE.map(entry => ({
      symbol: entry.symbol,
      label: entry.label,
      quarter: null,
      capexUsd: null,
      yoyPct: null,
      reason,
    })),
    aggregate: na,
    distribution: na,
    formula: HYPERSCALER_CAPEX_FORMULA,
    source: "FMP cash-flow-statement quarter capitalExpenditure",
  };
}
