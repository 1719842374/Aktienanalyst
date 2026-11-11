/**
 * Lampen-Schwellen der Earnings-Ampel. Eine Stelle, Philip prüft sie.
 * Beat ab beatPct einschließlich, Miss ab missPct einschließlich, dazwischen in-line.
 * Die Chart-Klassifikation in buildEarningsMarkers bleibt das Median-Band
 * (eine Basis, Umsatz vor EPS) und liest diese Konstanten nicht.
 */
export const EARNINGS_AMPEL_THRESHOLDS = {
  epsBeatPct: 5,
  epsMissPct: -5,
  revenueBeatPct: 2,
  revenueMissPct: -2,
  inlineColor: "#eab308",
  beatColor: "#22c55e",
  missColor: "#ef4444",
} as const;

export type EarningsAmpelLamp = "beat" | "miss" | "inline" | "na";

export interface EarningsAmpelMetric {
  lamp: EarningsAmpelLamp;
  surprisePct: number | null;
  actual: number | null;
  estimate: number | null;
  reason: string | null;
}

export interface EarningsAmpelQuarter {
  date: string;
  eps: EarningsAmpelMetric;
  revenue: EarningsAmpelMetric;
}

export interface EarningsAmpelModel {
  latest: EarningsAmpelQuarter | null;
  quarters: EarningsAmpelQuarter[];
}

type MarkerFields = {
  date: string;
  revenueActual: number | null;
  revenueEstimate: number | null;
  revenueSurprisePct: number | null;
  epsActual: number | null;
  epsEstimate: number | null;
  epsSurprisePct: number | null;
};

export function classifyEarningsSurprise(
  surprisePct: number | null,
  beatPct: number,
  missPct: number,
): EarningsAmpelLamp {
  if (surprisePct == null || !Number.isFinite(surprisePct)) return "na";
  if (surprisePct >= beatPct) return "beat";
  if (surprisePct <= missPct) return "miss";
  return "inline";
}

export function earningsAmpelColor(lamp: EarningsAmpelLamp): string | null {
  switch (lamp) {
    case "beat":
      return EARNINGS_AMPEL_THRESHOLDS.beatColor;
    case "miss":
      return EARNINGS_AMPEL_THRESHOLDS.missColor;
    case "inline":
      return EARNINGS_AMPEL_THRESHOLDS.inlineColor;
    case "na":
      return null;
    default: {
      const exhaustive: never = lamp;
      return exhaustive;
    }
  }
}

export function earningsAmpelLabel(lamp: EarningsAmpelLamp): string {
  switch (lamp) {
    case "beat":
      return "Beat";
    case "miss":
      return "Miss";
    case "inline":
      return "in-line";
    case "na":
      return "n/a";
    default: {
      const exhaustive: never = lamp;
      return exhaustive;
    }
  }
}

function finiteOrNull(value: number | null): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function metricNaReason(label: "EPS" | "Umsatz", actual: number | null, estimate: number | null): string {
  if (finiteOrNull(actual) == null) return `n/a — ${label}-Ist fehlt`;
  if (finiteOrNull(estimate) == null || estimate === 0) return `n/a — ${label}-Schätzung fehlt oder ist 0`;
  return `n/a — ${label}-Surprise nicht berechenbar`;
}

function metricOf(
  label: "EPS" | "Umsatz",
  actual: number | null,
  estimate: number | null,
  surprisePct: number | null,
  beatPct: number,
  missPct: number,
): EarningsAmpelMetric {
  const surprise = finiteOrNull(surprisePct);
  const lamp = classifyEarningsSurprise(surprise, beatPct, missPct);
  return {
    lamp,
    surprisePct: surprise,
    actual: finiteOrNull(actual),
    estimate: finiteOrNull(estimate),
    reason: lamp === "na" ? metricNaReason(label, actual, estimate) : null,
  };
}

export function buildEarningsAmpel(markers: readonly MarkerFields[]): EarningsAmpelModel {
  const { epsBeatPct, epsMissPct, revenueBeatPct, revenueMissPct } = EARNINGS_AMPEL_THRESHOLDS;
  const quarters = markers.map((marker, index) => ({
    index,
    quarter: {
      date: marker.date,
      eps: metricOf("EPS", marker.epsActual, marker.epsEstimate, marker.epsSurprisePct, epsBeatPct, epsMissPct),
      revenue: metricOf("Umsatz", marker.revenueActual, marker.revenueEstimate, marker.revenueSurprisePct, revenueBeatPct, revenueMissPct),
    } satisfies EarningsAmpelQuarter,
  }));
  quarters.sort((a, b) => (a.quarter.date < b.quarter.date ? 1 : a.quarter.date > b.quarter.date ? -1 : a.index - b.index));
  const rows = quarters.map(entry => entry.quarter);
  return { latest: rows[0] ?? null, quarters: rows };
}

export function formatAmpelNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return String(value).replace(".", ",");
}

export function formatAmpelPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  const body = Math.abs(value).toFixed(2).replace(".", ",");
  if (value > 0) return `+${body} %`;
  if (value < 0) return `−${body} %`;
  return `${body} %`;
}

export function earningsAmpelThresholdLine(): string {
  const t = EARNINGS_AMPEL_THRESHOLDS;
  return `EPS Beat ab +${t.epsBeatPct} %, Miss ab −${Math.abs(t.epsMissPct)} %. Umsatz Beat ab +${t.revenueBeatPct} %, Miss ab −${Math.abs(t.revenueMissPct)} %. Inline ${t.inlineColor}.`;
}
