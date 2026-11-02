/**
 * M2-impliziter BTC-Preis für das Overlay „M2 Lag (10W)“ in der Technischen
 * Analyse (#/btc, Section10TechnicalChart).
 *
 * Die bestehende M2-Linie bleibt die FRED-Reihe M2SL in Billionen USD auf der
 * rechten Achse (server/btc-macro.ts: buildM2AbsoluteForwardFill + 70 Tage
 * Lag → m2AbsoluteLaggedByDate → btcAnalysis → TechChartPoint.m2AbsoluteLagged).
 * Diese Datei schätzt daraus keinen neuen M2-Stand, sondern den Kurs, der zum
 * gelagten M2-Stand passt:
 *
 *   ln(BTC) = a + b · ln(M2 mit 10 Wochen Lag)
 *
 * Fenster: das sichtbare TA-Fenster (sliceBtcTaWindow → filteredData), vor dem
 * 500-Punkte-Downsample. Die volle Historie wird nicht geschätzt, damit ein
 * kurzes Preset n/a bleibt, statt still auf Max auszuweichen. Jede sichtbare
 * Kursbeobachtung mit positivem Preis und positivem M2-Lag ist ein Paar.
 * Forward-Fill wiederholt denselben M2-Stand an Folgetagen; diese Tage bleiben
 * eigene Beobachtungen.
 *
 * Gezeichnet wird exp(a + b·ln(M2)) auf der Preisachse. Das ist ein Modellwert
 * im Fenster, keine Prognose. Unter 8 Paaren oder ohne Streuung im M2-Lag: n/a.
 */

export const M2_IMPLIED_MIN_PAIRS = 8;
export const M2_IMPLIED_LINE_NAME = "M2-impliziter BTC-Preis";
export const M2_IMPLIED_FORMULA = "ln(BTC) = a + b·ln(M2 mit 10 Wochen Lag)";
export const M2_IMPLIED_SOURCE = "FRED M2SL";
export const M2_IMPLIED_DISCLAIMER = "Modellwert, keine Prognose";
/** OLS-Stichprobe: sichtbares Fenster, nicht die volle Historie. */
export const M2_IMPLIED_WINDOW = "visible" as const;
export const M2_IMPLIED_COLOR = "#22d3ee";

export interface M2LagPoint {
  price: number;
  m2AbsoluteLagged?: number | null;
}

interface M2ImpliedMeta {
  formula: typeof M2_IMPLIED_FORMULA;
  source: typeof M2_IMPLIED_SOURCE;
  disclaimer: typeof M2_IMPLIED_DISCLAIMER;
  window: typeof M2_IMPLIED_WINDOW;
}

export interface M2ImpliedFit extends M2ImpliedMeta {
  ok: true;
  a: number;
  b: number;
  r2: number;
  n: number;
}

export interface M2ImpliedNa extends M2ImpliedMeta {
  ok: false;
  reason: string;
  n: number;
}

export type M2ImpliedModel = M2ImpliedFit | M2ImpliedNa;

function finitePositive(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function meta(): M2ImpliedMeta {
  return {
    formula: M2_IMPLIED_FORMULA,
    source: M2_IMPLIED_SOURCE,
    disclaimer: M2_IMPLIED_DISCLAIMER,
    window: M2_IMPLIED_WINDOW,
  };
}

function tooShort(n: number): M2ImpliedNa {
  return {
    ok: false,
    n,
    reason: `n/a — Fenster zu kurz (${M2_IMPLIED_MIN_PAIRS} Paare aus Kurs und M2-Lag nötig, vorhanden: ${n})`,
    ...meta(),
  };
}

/**
 * OLS von ln(Kurs) auf ln(M2-Lag) über die übergebenen Punkte.
 * Aufrufer gibt das sichtbare Fenster (nicht die volle Historie, nicht nur
 * die gedownsamplete Zeichenreihe).
 */
export function fitM2ImpliedBtc(points: readonly M2LagPoint[]): M2ImpliedModel {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of points) {
    if (!finitePositive(point.price) || !finitePositive(point.m2AbsoluteLagged)) continue;
    xs.push(Math.log(point.m2AbsoluteLagged));
    ys.push(Math.log(point.price));
  }
  const n = xs.length;
  if (n < M2_IMPLIED_MIN_PAIRS) return tooShort(n);

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) {
    return {
      ok: false,
      n,
      reason: "n/a — M2-Lag im sichtbaren Fenster ohne Streuung, Steigung nicht bestimmbar",
      ...meta(),
    };
  }
  const b = sxy / sxx;
  const a = meanY - b * meanX;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const residual = ys[i] - (a + b * xs[i]);
    sse += residual * residual;
  }
  const r2 = syy === 0 ? (sse === 0 ? 1 : 0) : 1 - sse / syy;
  return { ok: true, a, b, r2, n, ...meta() };
}

/** exp(a + b·ln(M2)). Nur bei gültigem Fit und positivem M2-Lag. */
export function m2ImpliedPrice(model: M2ImpliedModel, m2Lag: number | null | undefined): number | null {
  if (!model.ok || !finitePositive(m2Lag)) return null;
  const value = Math.exp(model.a + model.b * Math.log(m2Lag));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Tooltip-Zeilen: $-Wert, Formel, a, b, R², Quelle, Hinweis. Bei n/a nur der Grund. */
export function m2ImpliedTooltipLines(model: M2ImpliedModel, usd: number | null): string[] {
  if (!model.ok) return [model.reason];
  const price = usd != null && Number.isFinite(usd)
    ? `$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "n/a";
  return [
    `${M2_IMPLIED_LINE_NAME} ${price}`,
    model.formula,
    `a = ${model.a.toFixed(4)} · b = ${model.b.toFixed(4)} · R² = ${model.r2.toFixed(4)}`,
    `Quelle ${model.source}`,
    model.disclaimer,
  ];
}
