/**
 * F9-04 — Server-Abruf der Lager/Nachfrage-Lücke. Kette: FRED fredgraph.csv → fetchFredCsv
 * (server/fred-csv.ts) → fredCsvObservations → computeInventoryDemandGap (shared/inventory-demand-gap.ts).
 * Route: server/inventory-demand-gap-route.ts. Nicht erreichbar → n/a mit Grund, nie 0.
 */
import { fetchFredCsv, fredCsvObservations } from "./fred-csv";
import { computeInventoryDemandGap, INVENTORY_DEMAND_GAP_PARAMS, type InventoryDemandGap, type SeriesPoint } from "../shared/inventory-demand-gap";

export type FredCsvFetch = (seriesId: string, cosd: string) => Promise<string | null>;

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

export async function fetchInventoryDemandGap(now: Date = new Date(), fetchCsv: FredCsvFetch = fetchFredCsv): Promise<InventoryDemandGapFetch> {
  // Fenster + fetchBufferYears: Veröffentlichungsverzug und das YoY-Vorjahr. Dieselbe Länge für ISRATIO und die Lücke.
  const years = INVENTORY_DEMAND_GAP_PARAMS.windowYears + INVENTORY_DEMAND_GAP_PARAMS.fetchBufferYears;
  const [isr, dgo, amd] = await Promise.all([
    fetchCsv("ISRATIO", yearsAgo(years, now)),
    fetchCsv("DGORDER", yearsAgo(years, now)),
    fetchCsv("AMDMVS", yearsAgo(years, now)),
  ]);
  const raw = {
    isratio: isr == null ? null : fredCsvObservations(isr),
    dgorder: dgo == null ? null : fredCsvObservations(dgo),
    amdmvs: amd == null ? null : fredCsvObservations(amd),
  };
  const result = computeInventoryDemandGap(raw.isratio ?? [], raw.dgorder ?? [], raw.amdmvs ?? []);
  if (raw.isratio == null) result.isratio = { available: false, reason: "ISRATIO: FRED nicht erreichbar" };
  if (raw.dgorder == null || raw.amdmvs == null) {
    const reason = `${raw.dgorder == null ? "DGORDER" : "AMDMVS"}: FRED nicht erreichbar`;
    result.orderShipmentGap = { available: false, reason };
    result.gapWindow = { available: false, reason };
  }
  return { result, raw };
}
