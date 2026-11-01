/**
 * Ampel der vier Protokoll-Bedingungen (Kurs > MA200, MA50 > MA200, MACD > 0, MACD steigend).
 * Grün = alle vier, Gelb = eine fehlt, Rot = weniger. Fehlt eine Messgröße, bleibt der Tag ungefärbt.
 */

export const TA_PROTOCOL_SIZE = 4;

export type AmpelTone = "green" | "yellow" | "red";

export interface AmpelReading {
  close: number;
  ma200?: number;
  ma50?: number;
  macd?: number;
}

export function conditionCount(point: AmpelReading, prevMacd: number | null): { met: number; complete: boolean; reason: string | null } {
  const finite = (v: number | undefined): v is number => v != null && Number.isFinite(v);
  const checks: Array<boolean | null> = [
    finite(point.ma200) ? point.close > point.ma200 : null,
    finite(point.ma50) && finite(point.ma200) ? point.ma50 > point.ma200 : null,
    finite(point.macd) ? point.macd > 0 : null,
    finite(point.macd) && prevMacd != null && Number.isFinite(prevMacd) ? point.macd > prevMacd : null,
  ];
  const met = checks.filter(c => c === true).length;
  if (checks.some(c => c == null)) {
    return { met, complete: false, reason: "n/a — MA200, MA50 oder MACD fehlt an diesem Tag" };
  }
  return { met, complete: true, reason: null };
}

export function toneOf(met: number, complete: boolean): AmpelTone | null {
  if (!complete) return null;
  if (met === TA_PROTOCOL_SIZE) return "green";
  if (met === TA_PROTOCOL_SIZE - 1) return "yellow";
  return "red";
}

export function ampelBadge(met: number): { tone: AmpelTone; text: string } {
  if (met === TA_PROTOCOL_SIZE) return { tone: "green", text: "Starkes Kaufsignal" };
  if (met === TA_PROTOCOL_SIZE - 1) return { tone: "yellow", text: "Fast kaufbereit" };
  if (met === 0) return { tone: "red", text: "Kein Kaufsignal" };
  return { tone: "red", text: `${met}/${TA_PROTOCOL_SIZE} Bedingungen` };
}

export const AMPEL_STROKE: Record<AmpelTone, string> = {
  green: "#22c55e",
  yellow: "#eab308",
  red: "#ef4444",
};

export function paintAmpelClose<T extends AmpelReading>(points: readonly T[]): Array<T & {
  _closeGreen: number | null;
  _closeYellow: number | null;
  _closeRed: number | null;
  _ampel: AmpelTone | null;
}> {
  const tones = points.map((point, i) => {
    const prev = i > 0 && points[i - 1].macd != null && Number.isFinite(points[i - 1].macd as number) ? points[i - 1].macd as number : null;
    const count = conditionCount(point, prev);
    return toneOf(count.met, count.complete);
  });
  return points.map((point, i) => {
    const on = (tone: AmpelTone) => tones[i] === tone || (i > 0 && tones[i - 1] === tone);
    return {
      ...point,
      _ampel: tones[i],
      _closeGreen: on("green") ? point.close : null,
      _closeYellow: on("yellow") ? point.close : null,
      _closeRed: on("red") ? point.close : null,
    };
  });
}
