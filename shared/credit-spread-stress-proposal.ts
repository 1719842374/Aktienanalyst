/**
 * F1-23 / FW-41: Vorschlag, nicht angeschlossen.
 * CRV, Gates und der Live-Score importieren diese Datei nicht.
 * Der Stress ist der z-Score der letzten Änderung gegen die eigene Historie.
 * Die absolute +100-bp-Schwelle aus Future_Work bleibt aus: sie ist kein Perzentil.
 */

export const CREDIT_STRESS_Z = 1.5;
export const CREDIT_STRESS_MIN_OBS = 36;

export interface CreditStressProposal {
  live: "nicht geschaltet";
  z: number | null;
  active: boolean | null;
  reason: string | null;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mu = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - mu) ** 2, 0) / (values.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 0 ? sd : null;
}

/** changes: zeitlich aufsteigende Spread-Änderungen (dieselbe Einheit). Letzter Wert ist heute. */
export function proposeCreditSpreadStress(changes: readonly number[]): CreditStressProposal {
  const series = changes.filter(value => Number.isFinite(value));
  if (series.length < CREDIT_STRESS_MIN_OBS) {
    return {
      live: "nicht geschaltet",
      z: null,
      active: null,
      reason: `n/a — ${series.length} Änderungen < ${CREDIT_STRESS_MIN_OBS}`,
    };
  }
  const latest = series[series.length - 1];
  const sd = sampleStdev(series);
  if (sd == null) {
    return { live: "nicht geschaltet", z: null, active: null, reason: "n/a — Streuung der Änderungen ist 0" };
  }
  const z = (latest - mean(series)) / sd;
  return {
    live: "nicht geschaltet",
    z: Math.round(z * 100) / 100,
    active: z > CREDIT_STRESS_Z,
    reason: null,
  };
}
