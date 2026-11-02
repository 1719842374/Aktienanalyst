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
 * Stichprobe: die gesamte verfügbare Historie bis zum Fensterende, nicht nur
 * das sichtbare Fenster. Gezeichnet wird exp(a + b·ln(M2)) nur im Fenster, auf
 * der Preisachse. Ein kurzes Preset (1J, 2J) behält damit die langfristige
 * Steigung, statt sie neu aus wenigen Monaten zu schätzen.
 *
 * Paare sind echte Monatswerte. buildM2AbsoluteForwardFill schreibt denselben
 * Stand auf jeden Folgetag; diese Tage zählen nicht mit. Ein neues Paar beginnt,
 * wenn der gelagte M2-Stand wechselt (der Tag, an dem der nächste Monatswert
 * nach dem Lag sichtbar wird). Liegt `monthlyPrint` vor, zählen nur die
 * markierten Monatswerte — auch wenn zwei Monate denselben Stand haben.
 *
 * Unter 8 echten Paaren oder ohne Streuung im monatlichen M2-Lag: n/a.
 * Keine R²-Schwelle. Die Preisachse bleibt am Kurs; Werte außerhalb werden
 * abgeschnitten, der Hinweis steht in m2ImpliedAxisHint.
 */

export const M2_IMPLIED_MIN_PAIRS = 8;
export const M2_IMPLIED_LINE_NAME = "M2-impliziter BTC-Preis";
export const M2_IMPLIED_FORMULA = "ln(BTC) = a + b·ln(M2 mit 10 Wochen Lag)";
export const M2_IMPLIED_SOURCE = "FRED M2SL";
export const M2_IMPLIED_DISCLAIMER = "Modellwert, keine Prognose";
/** OLS-Stichprobe: gesamte Historie bis zum Fensterende, nicht nur das sichtbare Fenster. */
export const M2_IMPLIED_WINDOW = "history-through-end" as const;
export const M2_IMPLIED_COLOR = "#22d3ee";
export const M2_IMPLIED_CLIPPED_HINT = "Die Linie wird an der Kursachse abgeschnitten.";
export const M2_IMPLIED_OUTSIDE_HINT = "Die Linie liegt außerhalb der Kursachse.";

export interface M2LagPoint {
  date?: string;
  price: number;
  m2AbsoluteLagged?: number | null;
  /**
   * true: echter Monatswert, zählt auch bei gleichem Stand wie der Vormonat.
   * false: vorwärts aufgefüllter Tag, zählt nie.
   * Fehlt das Feld an allen Punkten, zählt der erste Tag jedes neuen M2-Stands.
   */
  monthlyPrint?: boolean;
}

export type M2ImpliedAxisPlacement = "inside" | "clipped" | "outside";

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
    reason: `n/a — zu wenige echte Monatswerte (${M2_IMPLIED_MIN_PAIRS} Paare aus Kurs und monatlichem M2-Lag nötig, vorhanden: ${n}; vorwärts aufgefüllte Tage zählen nicht)`,
    ...meta(),
  };
}

/** Historie bis einschließlich throughDate. undefined = alle Punkte, null = kein Fenster. */
function historyThrough(points: readonly M2LagPoint[], throughDate?: string | null): M2LagPoint[] {
  if (throughDate === null) return [];
  if (typeof throughDate !== "string") return [...points];
  return points
    .filter(point => typeof point.date === "string" && point.date <= throughDate)
    .sort((a, b) => a.date!.localeCompare(b.date!));
}

/**
 * Echte Monatspaare. Vorwärts aufgefüllte Tage mit demselben M2-Stand fallen weg.
 * Nicht positive Kurse oder M2-Stände zählen nicht und unterbrechen die Folge nicht.
 */
function monthlyPairs(points: readonly M2LagPoint[]): M2LagPoint[] {
  const explicit = points.some(point => point.monthlyPrint != null);
  const pairs: M2LagPoint[] = [];
  let previous: number | null = null;
  for (const point of points) {
    if (!finitePositive(point.price) || !finitePositive(point.m2AbsoluteLagged)) continue;
    if (explicit) {
      if (point.monthlyPrint === true) pairs.push(point);
      continue;
    }
    if (previous !== null && point.m2AbsoluteLagged === previous) continue;
    previous = point.m2AbsoluteLagged;
    pairs.push(point);
  }
  return pairs;
}

/**
 * OLS von ln(Kurs) auf ln(M2-Lag).
 * `throughDate` schneidet die Historie am Fensterende ab. Gezeichnet wird
 * das Ergebnis nur im Fenster; diese Funktion liefert die Koeffizienten.
 */
export function fitM2ImpliedBtc(points: readonly M2LagPoint[], throughDate?: string | null): M2ImpliedModel {
  const pairs = monthlyPairs(historyThrough(points, throughDate));
  const n = pairs.length;
  if (n < M2_IMPLIED_MIN_PAIRS) return tooShort(n);

  let sumX = 0;
  let sumY = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const point of pairs) {
    const x = Math.log(point.m2AbsoluteLagged as number);
    const y = Math.log(point.price);
    xs.push(x);
    ys.push(y);
    sumX += x;
    sumY += y;
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
      reason: "n/a — monatlicher M2-Lag bis zum Fensterende ohne Streuung, Steigung nicht bestimmbar",
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

/** Ob ein Modellwert unter oder über der Preisachse liegt. */
export function m2ImpliedPointOutside(usd: number | null | undefined, domain: readonly [number, number]): boolean {
  return typeof usd === "number" && Number.isFinite(usd) && (usd < domain[0] || usd > domain[1]);
}

/**
 * inside: jeder gezeichnete Wert liegt in der Preisachse.
 * clipped: ein Teil liegt außerhalb und wird abgeschnitten.
 * outside: keiner liegt in der Achse.
 */
export function m2ImpliedAxisPlacement(
  values: readonly (number | null | undefined)[],
  domain: readonly [number, number],
): M2ImpliedAxisPlacement {
  let inside = 0;
  let outside = 0;
  for (const value of values) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (value < domain[0] || value > domain[1]) outside += 1;
    else inside += 1;
  }
  if (outside === 0) return "inside";
  if (inside === 0) return "outside";
  return "clipped";
}

export function m2ImpliedAxisHint(placement: M2ImpliedAxisPlacement): string | null {
  switch (placement) {
    case "inside":
      return null;
    case "clipped":
      return M2_IMPLIED_CLIPPED_HINT;
    case "outside":
      return M2_IMPLIED_OUTSIDE_HINT;
    default: {
      const unexpected: never = placement;
      return unexpected;
    }
  }
}

/** Tooltip-Zeilen: $-Wert, Formel, a, b, R², Quelle, Hinweis. Bei n/a nur der Grund. */
export function m2ImpliedTooltipLines(
  model: M2ImpliedModel,
  usd: number | null,
  placement: M2ImpliedAxisPlacement = "inside",
): string[] {
  if (!model.ok) return [model.reason];
  const price = usd != null && Number.isFinite(usd)
    ? `$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
    : "n/a";
  const lines = [
    `${M2_IMPLIED_LINE_NAME} ${price}`,
    model.formula,
    `a = ${model.a.toFixed(4)} · b = ${model.b.toFixed(4)} · R² = ${model.r2.toFixed(4)}`,
    `Quelle ${model.source}`,
    model.disclaimer,
  ];
  const hint = placement === "inside" ? null : m2ImpliedAxisHint(placement);
  if (hint) lines.push(hint);
  return lines;
}
