/**
 * Mobile TA Skalierung v1 (Spec LOCKED).
 * Plot-Innenbreite bleibt ≥ 360 CSS-px; schmaler Viewport scrollt horizontal
 * statt die Serien zusammenzudrücken. Breakpoint = Tailwind `sm` (640px).
 */
export const TA_NARROW_MAX_PX = 639;
export const TA_PLOT_MIN_PX = 360;
export const TA_AXIS_FONT_PX = 10;
export const TA_VOLUME_BAND_PX = 40;
/** Zusätzlicher Abstand nach der gemessenen Label-Breite (Recharts minTickGap). */
export const TA_X_MIN_TICK_GAP = 8;
/** Durchmesser 8px — Marker-Floor der Spec (~6–8px). */
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
