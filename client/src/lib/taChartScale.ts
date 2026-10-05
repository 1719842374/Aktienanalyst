/**
 * Mobile TA Skalierung v1 (Spec LOCKED).
 * Plot-Innenbreite bleibt ≥ 360 CSS-px; schmaler Viewport scrollt horizontal
 * statt die Serien zusammenzudrücken. Breakpoint = Tailwind `sm` (640px).
 */
export const TA_NARROW_MAX_PX = 639;
export const TA_PLOT_MIN_PX = 360;
export const TA_AXIS_FONT_PX = 10;
/** Volumen-Band auf Mobile. Spec-Floor ~36–44px. */
export const TA_VOLUME_BAND_PX = 40;
/** MACD-/RSI-Streifen dürfen nicht unter diesen Floor schrumpfen. */
export const TA_OSC_MIN_PX = 40;
/**
 * Zusatzlücke hinter der gemessenen X-Labelbox (Recharts minTickGap).
 * 40px hält „MM/DD“ / „MM/YY“ bei 10px auseinander, auch wenn die
 * Offscreen-Messung Breite 0 liefert — sonst bekommt fast jeder Punkt
 * einen Tick und die Achse wird ein schwarzer Balken.
 */
export const TA_X_MIN_TICK_GAP = 40;
/** Durchmesser 8px — Marker-Floor der Spec (~6–8px). Nicht als Punkt auf dem Kurs zeichnen. */
export const TA_SIGNAL_DOT_R = 4;

export function taChartMinWidth(
  leftAxisWidth: number,
  rightAxisWidth: number,
  marginRight: number,
  marginLeft = 0,
): number {
  return TA_PLOT_MIN_PX + leftAxisWidth + rightAxisWidth + marginRight + marginLeft;
}

export function axisTick(narrow: boolean, desktopPx: number, fill: string) {
  return { fontSize: narrow ? TA_AXIS_FONT_PX : desktopPx, fill };
}

export function xAxisIntervalProps(
  narrow: boolean,
  desktopInterval: number,
): { interval: number | "preserveStartEnd"; minTickGap?: number } {
  if (!narrow) return { interval: desktopInterval };
  return { interval: "preserveStartEnd", minTickGap: TA_X_MIN_TICK_GAP };
}

/** Y-Preis auf Mobile: genau 4 oder 5 Ticks, Endpunkte auf der Domain. */
export function narrowPriceTicks(min: number, max: number, count = 5): number[] {
  const n = Math.min(5, Math.max(4, count));
  let lo = min;
  let hi = max;
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (hi < lo) {
    const swap = lo;
    lo = hi;
    hi = swap;
  }
  if (hi === lo) {
    const pad = Math.abs(lo) * 0.05 || 1;
    lo -= pad;
    hi += pad;
  }
  const step = (hi - lo) / (n - 1);
  const ticks: number[] = [];
  for (let i = 0; i < n; i++) ticks.push(lo + step * i);
  ticks[n - 1] = hi;
  return ticks;
}
