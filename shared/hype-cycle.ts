/**
 * Proxy-Hype-Cycle (WORK_HYPECYCLE_EMAIL_SUPABASE §1), Mechanismus aus PR 390.
 * Gewichte sind die dort schon verwendeten Spec-Vorschläge. Fehlende Signale
 * werden aus der Summe herausgenommen und die übrigen Gewichte neu normiert —
 * fehlend ist nicht 0. Phasen über Quartile der Peer-Position (Q1/Q3).
 * Die Sigma-Beispielschwelle der offenen Spec ist nicht aktiv.
 * Aktiv sind nur drei FMP-Signale: KGV gegen den eigenen 5-Jahres-Median,
 * Capex-Intensität und EPS-Revision. Suchvolumen/Trends wird nicht abgefragt.
 * Kein Gartner-Datensatz.
 */

import { peerPercentile, quartileBand, zScore, type QuartileBand } from "./distribution";

/** Spec-Gewichte. Summe 1, wenn alle sechs Signale da sind. Unverändert aus PR 390. */
export const HYPE_WEIGHTS = {
  newsVolume: 0.25,
  capexMaterial: 0.20,
  valuationVsHistory: 0.20,
  analystRevisions: 0.15,
  guidanceStrength: 0.10,
  narrative: 0.10,
} as const;

/** Spec-Fenster „vs. 5J-Median“. Kürzere Reihen werden nicht still verkürzt. */
export const HYPE_HISTORY_YEARS = 5;

export const HYPE_UNAVAILABLE: Record<"newsVolume" | "guidanceStrength" | "narrative", string> = {
  newsVolume: "n/a — Suchvolumen/Trends wird nicht abgefragt",
  guidanceStrength: "n/a — kein strukturiertes Guidance-Feld",
  narrative: "n/a — kein LLM-Call (kein zusätzlicher Kostenpfad)",
};

export const HYPE_SIGNAL_SOURCE = {
  newsVolume: "nicht abgefragt",
  capexMaterial: "FMP income-statement revenue + cash-flow-statement capitalExpenditure",
  valuationVsHistory: "FMP ratios priceToEarningsRatio",
  analystRevisions: "FMP analyst-estimates estimatedEpsAvg",
  guidanceStrength: "nicht abgefragt",
  narrative: "nicht abgefragt",
} as const;

export const HYPE_SIGNAL_LABEL = {
  newsVolume: "News-/Suchvolumen",
  capexMaterial: "Capex-Intensität",
  valuationVsHistory: "KGV gegen eigenen 5-Jahres-Median",
  analystRevisions: "EPS-Revision",
  guidanceStrength: "Forward Guidance",
  narrative: "LLM-Narrativ",
} as const;

export interface HypeCompanyInput {
  ticker: string;
  /** Jahres-KGV, alt → neu. */
  peByYear: readonly (number | null)[];
  /** |CapEx| / Umsatz je Jahr, alt → neu. */
  capexIntensityByYear: readonly (number | null)[];
  /** EPS-Konsens, älter → neuer. */
  epsEstimate: readonly (number | null)[];
  /** Parallel zu den Reihen, nur Anzeige. */
  peAsOf?: readonly (string | null)[];
  capexAsOf?: readonly (string | null)[];
  epsAsOf?: readonly (string | null)[];
  /** Hinweise zur Reihe, kein Score. */
  dataNotes?: readonly string[];
}

export interface HypeSignal {
  id: keyof typeof HYPE_WEIGHTS;
  /** Abstand des letzten Werts zum eigenen Median, relativ. */
  gap: number | null;
  reason: string | null;
  z: number | null;
  peerPct: number | null;
  band: QuartileBand | null;
  coverage: { available: number; required: number | null };
  asOf: string | null;
  asOfReason: string | null;
  source: string;
}

export interface HypeCompanyResult {
  ticker: string;
  signals: HypeSignal[];
  /** Gewichtete z-Summe der vorhandenen Signale. Kein Aktien-Score. */
  compositeZ: number | null;
  weightUsed: number;
  phase: string | null;
  phaseReason: string;
  dataNotes: string[];
}

export interface HypeAssessment {
  companies: HypeCompanyResult[];
  weights: typeof HYPE_WEIGHTS;
  notes: string[];
  gartnerDataset: false;
  proxy: "fmp-history";
}

export interface HypeCyclePayload extends HypeAssessment {
  skipped: string[];
}

function finiteSeries(values: readonly (number | null)[]): number[] {
  return values.filter((v): v is number => v != null && Number.isFinite(v));
}

/** Letzter Wert gegen den Median der eigenen Reihe. Braucht HYPE_HISTORY_YEARS Punkte. */
export function gapVsOwnMedian(series: readonly (number | null)[]): { gap: number | null; reason: string | null } {
  const xs = finiteSeries(series);
  if (xs.length < HYPE_HISTORY_YEARS) {
    return { gap: null, reason: `n/a — ${xs.length} von ${HYPE_HISTORY_YEARS} Jahren` };
  }
  const sorted = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const latest = xs[xs.length - 1];
  if (med === 0) return { gap: null, reason: "n/a — eigener Median ist 0" };
  return { gap: (latest - med) / Math.abs(med), reason: null };
}

function revisionGap(estimates: readonly (number | null)[]): { gap: number | null; reason: string | null } {
  const xs = finiteSeries(estimates);
  if (xs.length < 2) return { gap: null, reason: "n/a — weniger als zwei EPS-Schätzungen" };
  const prev = xs[xs.length - 2];
  const next = xs[xs.length - 1];
  if (prev === 0) return { gap: null, reason: "n/a — vorherige EPS-Schätzung ist 0" };
  return { gap: (next - prev) / Math.abs(prev), reason: null };
}

/** Stichtag des letzten endlichen Werts. Fehlendes Datum bleibt n/a. */
export function latestFiniteAsOf(
  values: readonly (number | null)[],
  dates: readonly (string | null)[] | undefined,
): { asOf: string | null; asOfReason: string | null } {
  const dated = dates ?? [];
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    const raw = dated[i];
    if (typeof raw === "string" && raw.trim()) return { asOf: raw.trim(), asOfReason: null };
    return { asOf: null, asOfReason: "n/a — letzter Wert ohne Datum" };
  }
  return { asOf: null, asOfReason: "n/a — kein Wert für einen Stichtag" };
}

/**
 * Auswahlwechsel verwirft die vorherige Antwort. Gleicher Schlüssel behält sie.
 * Reine Anzeige, keine neue Bewertung.
 */
export function alignHypeSelection<T extends { selection: string; body: unknown; error: string | null }>(
  state: T,
  selection: string,
): T {
  if (state.selection === selection) return state;
  return { ...state, selection, body: null, error: null };
}

export function isHypePayload(value: unknown): value is HypeCyclePayload {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<HypeCyclePayload>;
  return row.gartnerDataset === false
    && row.proxy === "fmp-history"
    && Array.isArray(row.companies)
    && Array.isArray(row.notes)
    && Array.isArray(row.skipped);
}

/** Phasen nur aus den drei FMP-Signalen, über die Quartile der Peer-Menge. Unverändert aus PR 390. */
const PHASE_RULES: { phase: string; test: (s: Record<string, QuartileBand | null>) => boolean }[] = [
  { phase: "Peak of Inflated Expectations", test: s => s.valuationVsHistory === "high" && s.analystRevisions === "high" },
  { phase: "Trough of Disillusionment", test: s => s.valuationVsHistory === "low" && s.analystRevisions === "low" },
  { phase: "Slope of Enlightenment", test: s => s.capexMaterial === "high" && s.analystRevisions === "mid" },
  { phase: "Innovation Trigger", test: s => s.valuationVsHistory === "low" && s.analystRevisions === "high" },
  { phase: "Plateau of Productivity", test: s => s.valuationVsHistory === "mid" && s.capexMaterial === "mid" },
];

export function assessHypeCycle(companies: readonly HypeCompanyInput[]): HypeAssessment {
  const notes = [
    "FMP-Proxy: KGV gegen den eigenen 5-Jahres-Median, Capex-Intensität, EPS-Revision.",
    "Kein Gartner-Datensatz. Die Proxy-Phase ist die bestehende Quartil-Regel und keine Gartner-Phase.",
    "Die Sigma-Beispielschwelle aus der offenen Spec ist nicht aktiv.",
    HYPE_UNAVAILABLE.newsVolume,
    HYPE_UNAVAILABLE.guidanceStrength,
    HYPE_UNAVAILABLE.narrative,
    "CAPEX-Signal ist |CapEx|/Umsatz gegen den eigenen 5-Jahres-Median, nicht die Erwähnung im Call.",
  ];
  const prepared = companies.map(c => ({
    ticker: c.ticker,
    valuation: gapVsOwnMedian(c.peByYear),
    capex: gapVsOwnMedian(c.capexIntensityByYear),
    revision: revisionGap(c.epsEstimate),
    peAsOf: latestFiniteAsOf(c.peByYear, c.peAsOf),
    capexAsOf: latestFiniteAsOf(c.capexIntensityByYear, c.capexAsOf),
    epsAsOf: latestFiniteAsOf(c.epsEstimate, c.epsAsOf),
    peCount: finiteSeries(c.peByYear).length,
    capexCount: finiteSeries(c.capexIntensityByYear).length,
    epsCount: finiteSeries(c.epsEstimate).length,
    dataNotes: [...(c.dataNotes ?? [])],
  }));
  const zOf = (key: "valuation" | "capex" | "revision", gap: number | null) =>
    zScore(gap, prepared.map(g => g[key].gap).filter((v): v is number => v != null));
  const pctOf = (key: "valuation" | "capex" | "revision", gap: number | null) =>
    peerPercentile(gap, prepared.map(g => g[key].gap).filter((v): v is number => v != null));

  const results: HypeCompanyResult[] = prepared.map(g => {
    const signals: HypeSignal[] = [
      signal("newsVolume", null, HYPE_UNAVAILABLE.newsVolume, null, null, { available: 0, required: null }, { asOf: null, asOfReason: null }),
      signal("capexMaterial", g.capex.gap, g.capex.reason, zOf("capex", g.capex.gap), pctOf("capex", g.capex.gap), { available: g.capexCount, required: HYPE_HISTORY_YEARS }, g.capexAsOf),
      signal("valuationVsHistory", g.valuation.gap, g.valuation.reason, zOf("valuation", g.valuation.gap), pctOf("valuation", g.valuation.gap), { available: g.peCount, required: HYPE_HISTORY_YEARS }, g.peAsOf),
      signal("analystRevisions", g.revision.gap, g.revision.reason, zOf("revision", g.revision.gap), pctOf("revision", g.revision.gap), { available: g.epsCount, required: 2 }, g.epsAsOf),
      signal("guidanceStrength", null, HYPE_UNAVAILABLE.guidanceStrength, null, null, { available: 0, required: null }, { asOf: null, asOfReason: null }),
      signal("narrative", null, HYPE_UNAVAILABLE.narrative, null, null, { available: 0, required: null }, { asOf: null, asOfReason: null }),
    ];
    let weightUsed = 0;
    let acc = 0;
    for (const s of signals) {
      if (s.z == null) continue;
      const w = HYPE_WEIGHTS[s.id];
      weightUsed += w;
      acc += w * s.z;
    }
    const compositeZ = weightUsed > 0 ? acc / weightUsed : null;
    const bands: Record<string, QuartileBand | null> = {};
    for (const s of signals) bands[s.id] = s.band;
    const hit = PHASE_RULES.find(r => r.test(bands));
    const phaseReason = hit
      ? `${hit.phase} aus der Quartil-Lage der vorhandenen Signale`
      : "n/a — KGV, Capex-Intensität und EPS-Revision treffen keine Phasenregel";
    return {
      ticker: g.ticker,
      signals,
      compositeZ,
      weightUsed,
      phase: hit ? hit.phase : null,
      phaseReason,
      dataNotes: g.dataNotes,
    };
  });
  return { companies: results, weights: HYPE_WEIGHTS, notes, gartnerDataset: false, proxy: "fmp-history" };
}

function signal(
  id: keyof typeof HYPE_WEIGHTS,
  gap: number | null,
  reason: string | null,
  z: number | null,
  peerPct: number | null,
  coverage: { available: number; required: number | null },
  asOf: { asOf: string | null; asOfReason: string | null },
): HypeSignal {
  const band = gap == null ? null : quartileBand(peerPct);
  const zReason = gap != null && z == null ? "n/a — keine Streuung oder zu wenige Peers für ein z" : reason;
  return {
    id,
    gap,
    reason: zReason,
    z: gap == null ? null : z,
    peerPct: gap == null ? null : peerPct,
    band,
    coverage,
    asOf: asOf.asOf,
    asOfReason: asOf.asOfReason,
    source: HYPE_SIGNAL_SOURCE[id],
  };
}
