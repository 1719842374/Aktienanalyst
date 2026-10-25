/**
 * shared/kostolany.ts — FW-04 Kostolany-Rad (reine Anzeige).
 *
 * Regelbasierte Einordnung in die 6 Phasen des Kostolany-Eis aus zwei Trends:
 *   - Zinstrend: Leitzins FEDFUNDS (Monat; Fallback DFF täglich), Δ über ~6 Monate.
 *     Bei „seitwärts“ entscheidet DGS10 (10J-Treasury) Δ über ~6 Monate als Tie-Break.
 *   - Kurstrend: S&P 500 (FRED SP500; Fallback Yahoo ^GSPC) letzter Schluss vs. SMA200.
 * Fehlt Zins- oder Kursreihe → phase null (UI: n/a). Kein Einfluss auf Score/Rating/Sektor-Engine.
 *
 * ALLE SCHWELLEN SIND EIN VORSCHLAG (nicht aus einer Quelle abgeleitet), zentral in KOSTOLANY_THRESHOLDS.
 */
import type { FredObservation } from "../server/fred-csv";

export type KostolanyPhase = "A1" | "A2" | "A3" | "B1" | "B2" | "B3";
export type RateTrend = "fallend" | "seitwärts" | "steigend";
export type PriceTrend = "stark fallend" | "fallend" | "seitwärts" | "steigend" | "stark steigend";

/** Vorschlag — siehe PR-Body FW-04. */
export const KOSTOLANY_THRESHOLDS = {
  /** Lookback für Zins-Δ in Kalendertagen (~6 Monate). */
  rateLookbackDays: 182,
  /** |Δ Leitzins| ab dem „steigend/fallend“ gilt, in Prozentpunkten. */
  policyRateDeltaPp: 0.25,
  /** |Δ DGS10| (Tie-Break, nur wenn Leitzins seitwärts), in Prozentpunkten. */
  dgs10DeltaPp: 0.5,
  /** SMA-Länge in Handelstagen. */
  smaDays: 200,
  /** Abstand Kurs zu SMA200: ab ±2 % Trend, ab ±10 % „stark“. */
  priceTrendPct: 0.02,
  priceStrongPct: 0.10,
} as const;

export const KOSTOLANY_PHASES: Record<KostolanyPhase, { name: string; action: string; style: string; text: string }> = {
  A1: { name: "Korrektur (A1)", action: "Kaufen", style: "Value / Zykliker", text: "Zinsen hoch und beginnen zu fallen, Kurse tief, wenige Aktienbesitzer." },
  A2: { name: "Begleitphase (A2)", action: "Kaufen / Halten", style: "Growth", text: "Zinsen fallen, Kurse steigen, neue Käufer kommen dazu." },
  A3: { name: "Übertreibung (A3)", action: "Verkaufen", style: "Gewinne sichern, Defensive aufbauen", text: "Zinsen tief, Kurse stark gestiegen, Euphorie." },
  B1: { name: "Korrektur (B1)", action: "Verkaufen", style: "Defensiv", text: "Zinsen beginnen zu steigen, Kurse auf hohem Niveau (Hochpunkt-Nähe)." },
  B2: { name: "Begleitphase (B2)", action: "Abwarten", style: "Defensiv / Liquidität", text: "Zinsen steigen, Kurse fallen." },
  B3: { name: "Übertreibung (B3)", action: "Kaufen", style: "Value / Zykliker", text: "Zinsen hoch, Kurse stark gefallen, Panik." },
};

export const KOSTOLANY_ORDER: KostolanyPhase[] = ["A1", "A2", "A3", "B1", "B2", "B3"];

export interface KostolanyResult {
  phase: KostolanyPhase | null;
  rateTrend: RateTrend | null;
  priceTrend: PriceTrend | null;
  inputs: {
    policySeries: "FEDFUNDS" | "DFF" | null;
    policyLast: number | null;
    policyPrev: number | null;
    policyDelta: number | null;
    policyDate: string | null;
    dgs10Last: number | null;
    dgs10Delta: number | null;
    dgs10Date: string | null;
    priceSource: "FRED SP500" | "Yahoo ^GSPC" | null;
    priceLast: number | null;
    sma200: number | null;
    priceVsSma: number | null;
    priceDate: string | null;
  };
  /** Warum n/a bzw. welcher Tie-Break griff. */
  notes: string[];
  thresholdsAreProposal: true;
}

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Letzter Wert + Wert zum Stichtag (letzte Beobachtung <= last − lookback). */
export function deltaOverLookback(obs: FredObservation[], lookbackDays: number): { last: number; prev: number; delta: number; date: string } | null {
  if (obs.length < 2) return null;
  const lastObs = obs[obs.length - 1];
  const cutoff = isoMinusDays(lastObs.date, lookbackDays);
  let prev: FredObservation | null = null;
  for (const o of obs) { if (o.date <= cutoff) prev = o; else break; }
  if (!prev) return null;
  return { last: lastObs.value, prev: prev.value, delta: lastObs.value - prev.value, date: lastObs.date };
}

export function classifyRate(delta: number, thresholdPp: number): RateTrend {
  if (delta >= thresholdPp) return "steigend";
  if (delta <= -thresholdPp) return "fallend";
  return "seitwärts";
}

export function classifyPrice(dev: number): PriceTrend {
  const t = KOSTOLANY_THRESHOLDS;
  if (dev >= t.priceStrongPct) return "stark steigend";
  if (dev >= t.priceTrendPct) return "steigend";
  if (dev <= -t.priceStrongPct) return "stark fallend";
  if (dev <= -t.priceTrendPct) return "fallend";
  return "seitwärts";
}

/** Phasen-Matrix (Vorschlag). */
export function phaseFromTrends(rate: RateTrend, price: PriceTrend): KostolanyPhase {
  if (rate === "fallend") {
    if (price === "stark fallend" || price === "fallend") return "A1";
    if (price === "stark steigend") return "A3";
    return "A2";
  }
  if (rate === "seitwärts") {
    if (price === "stark steigend" || price === "steigend") return "A3";
    if (price === "seitwärts") return "B1";
    if (price === "fallend") return "B2";
    return "B3";
  }
  if (price === "stark steigend" || price === "steigend") return "B1";
  if (price === "stark fallend") return "B3";
  return "B2";
}

export interface KostolanyInput {
  fedfunds?: FredObservation[];
  dff?: FredObservation[];
  dgs10?: FredObservation[];
  price?: FredObservation[];
  priceSource?: "FRED SP500" | "Yahoo ^GSPC" | null;
}

export function computeKostolany(input: KostolanyInput): KostolanyResult {
  const t = KOSTOLANY_THRESHOLDS;
  const notes: string[] = [];
  const res: KostolanyResult = {
    phase: null, rateTrend: null, priceTrend: null,
    inputs: {
      policySeries: null, policyLast: null, policyPrev: null, policyDelta: null, policyDate: null,
      dgs10Last: null, dgs10Delta: null, dgs10Date: null,
      priceSource: null, priceLast: null, sma200: null, priceVsSma: null, priceDate: null,
    },
    notes, thresholdsAreProposal: true,
  };

  let policy = deltaOverLookback(input.fedfunds ?? [], t.rateLookbackDays);
  if (policy) res.inputs.policySeries = "FEDFUNDS";
  else {
    policy = deltaOverLookback(input.dff ?? [], t.rateLookbackDays);
    if (policy) { res.inputs.policySeries = "DFF"; notes.push("FEDFUNDS fehlt – DFF genutzt"); }
  }
  const dgs = deltaOverLookback(input.dgs10 ?? [], t.rateLookbackDays);
  if (dgs) { res.inputs.dgs10Last = dgs.last; res.inputs.dgs10Delta = dgs.delta; res.inputs.dgs10Date = dgs.date; }

  if (policy) {
    res.inputs.policyLast = policy.last; res.inputs.policyPrev = policy.prev;
    res.inputs.policyDelta = policy.delta; res.inputs.policyDate = policy.date;
    let rate = classifyRate(policy.delta, t.policyRateDeltaPp);
    if (rate === "seitwärts" && dgs) {
      const tie = classifyRate(dgs.delta, t.dgs10DeltaPp);
      if (tie !== "seitwärts") { rate = tie; notes.push(`Leitzins seitwärts – DGS10-Tie-Break: ${tie}`); }
    }
    res.rateTrend = rate;
  } else notes.push("Zinsreihe fehlt (FEDFUNDS/DFF) – n/a");

  const px = input.price ?? [];
  if (px.length >= t.smaDays && input.priceSource) {
    const tail = px.slice(-t.smaDays);
    const sma = tail.reduce((s, o) => s + o.value, 0) / tail.length;
    const last = px[px.length - 1];
    const dev = last.value / sma - 1;
    Object.assign(res.inputs, { priceSource: input.priceSource, priceLast: last.value, sma200: sma, priceVsSma: dev, priceDate: last.date });
    res.priceTrend = classifyPrice(dev);
  } else notes.push(`Kursreihe fehlt oder < ${t.smaDays} Tage (SP500/^GSPC) – n/a`);

  if (res.rateTrend && res.priceTrend) res.phase = phaseFromTrends(res.rateTrend, res.priceTrend);
  return res;
}
