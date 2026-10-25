/**
 * F9-04 — Server-Abruf der Lager/Nachfrage-Lücke. Kette: FRED fredgraph.csv → fetchFredCsv
 * (server/fred-csv.ts) → fredCsvObservations → computeInventoryDemandGap (shared/inventory-demand-gap.ts).
 * Noch nicht an eine Route/UI angebunden (wartet auf #269/#273/#143). Nicht erreichbar → n/a mit Grund.
 */
import { fetchFredCsv, fredCsvObservations } from "./fred-csv";
import { computeInventoryDemandGap, ISRATIO_WINDOW_YEARS, type InventoryDemandGap, type SeriesPoint } from "../shared/inventory-demand-gap";

function yearsAgo(n: number, now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
}

export interface InventoryDemandGapFetch {
  result: InventoryDemandGap;
  /** null = Abruf fehlgeschlagen (nicht erreichbar). */
  raw: { isratio: SeriesPoint[] | null; dgorder: SeriesPoint[] | null; amdmvs: SeriesPoint[] | null };
}

export async function fetchInventoryDemandGap(now: Date = new Date()): Promise<InventoryDemandGapFetch> {
  // +1 Jahr Puffer, damit das 10J-Fenster auch bei Veröffentlichungsverzug voll ist; YoY braucht 2 Jahre.
  const [isr, dgo, amd] = await Promise.all([
    fetchFredCsv("ISRATIO", yearsAgo(ISRATIO_WINDOW_YEARS + 1, now)),
    fetchFredCsv("DGORDER", yearsAgo(3, now)),
    fetchFredCsv("AMDMVS", yearsAgo(3, now)),
  ]);
  const raw = {
    isratio: isr == null ? null : fredCsvObservations(isr),
    dgorder: dgo == null ? null : fredCsvObservations(dgo),
    amdmvs: amd == null ? null : fredCsvObservations(amd),
  };
  const result = computeInventoryDemandGap(raw.isratio ?? [], raw.dgorder ?? [], raw.amdmvs ?? []);
  if (raw.isratio == null) result.isratio = { available: false, reason: "ISRATIO: FRED nicht erreichbar" };
  if (raw.dgorder == null || raw.amdmvs == null) {
    result.orderShipmentGap = { available: false, reason: `${raw.dgorder == null ? "DGORDER" : "AMDMVS"}: FRED nicht erreichbar` };
  }
  return { result, raw };
}
