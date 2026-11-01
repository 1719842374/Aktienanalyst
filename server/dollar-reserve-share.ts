/**
 * F1-39 — Server-Abruf Dollar-Anteil an den Weltreserven. Kette: IMF SDMX 2.1 (COFER, Reihe
 * G001.AFXRA.CI_USD.SHRO_PT.Q) → fetchCoferXml → parseCoferUsdShare → dollarReserveShareReading
 * (shared/dollar-reserve-share.ts). Kein Key, gratis. Noch nicht an Route/UI angebunden.
 * Nicht erreichbar → n/a mit Grund, nie 0.
 */
import { COFER_SERIES_KEY, dollarReserveShareReading, parseCoferUsdShare, type DollarReserveShareReading } from "../shared/dollar-reserve-share";

export function coferUrl(startYear: number): string {
  return `https://api.imf.org/external/sdmx/2.1/data/IMF.STA,COFER/${COFER_SERIES_KEY}?startPeriod=${startYear}`;
}

/** null = nicht erreichbar (HTTP-Fehler, Timeout, Netz). timeoutMs = Gesamtbudget inkl. Body. */
export async function fetchCoferXml(startYear: number, timeoutMs = 30000): Promise<string | null> {
  try {
    const resp = await fetch(coferUrl(startYear), { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export async function fetchDollarReserveShare(now: Date = new Date()): Promise<{ result: DollarReserveShareReading; rawCount: number | null }> {
  // 5J-Veränderung + Veröffentlichungsverzug (~1 Quartal) → 7 Jahre zurück.
  const xml = await fetchCoferXml(now.getUTCFullYear() - 7);
  if (xml == null) return { result: { available: false, reason: "IMF COFER: nicht erreichbar", source: "IMF COFER" }, rawCount: null };
  const series = parseCoferUsdShare(xml);
  return { result: dollarReserveShareReading(series), rawCount: series.length };
}
