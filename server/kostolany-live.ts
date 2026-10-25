/**
 * server/kostolany-live.ts — FW-04 Live-Daten fürs Kostolany-Rad (reine Anzeige).
 * Kurs: FRED SP500 über fred-csv.ts; nur wenn das fehlt Yahoo-Chart ^GSPC (Yahoo hatte 429).
 * Zinsen: FEDFUNDS (Fallback DFF) + DGS10, alle über fred-csv.ts. Fehlt etwas → n/a im Ergebnis.
 */
import { fetchFredCsv, fredCsvObservations, type FredObservation } from "./fred-csv";
import { computeKostolany, type KostolanyResult } from "../shared/kostolany";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function fredObs(id: string, cosd: string): Promise<FredObservation[]> {
  try { return fredCsvObservations(await fetchFredCsv(id, cosd, 15000)); } catch { return []; }
}

export async function fetchKostolanyLive(): Promise<KostolanyResult> {
  const cosdPrice = isoDaysAgo(420); // ≥ 200 Handelstage
  const cosdRate = isoDaysAgo(400);
  const [sp500, fedfunds, dff, dgs10] = await Promise.all([
    fredObs("SP500", cosdPrice),
    fredObs("FEDFUNDS", cosdRate),
    fredObs("DFF", cosdRate),
    fredObs("DGS10", cosdRate),
  ]);
  let price: FredObservation[] = sp500;
  let priceSource: "FRED SP500" | "Yahoo ^GSPC" | null = sp500.length > 0 ? "FRED SP500" : null;
  if (sp500.length < 200) {
    try {
      const { yahooFetch } = await import("./history-fallback");
      const bars = await yahooFetch("^GSPC", cosdPrice, new Date().toISOString().slice(0, 10));
      if (bars.length >= 200) { price = bars.map(b => ({ date: b.date, value: b.close })); priceSource = "Yahoo ^GSPC"; }
    } catch (err) {
      console.warn(`[KOSTOLANY] ^GSPC fallback failed: ${(err as Error)?.message ?? err}`);
    }
  }
  return computeKostolany({ fedfunds, dff, dgs10, price, priceSource });
}

/** Additiv: hängt das Zusatzfeld an, ohne vorhandene Felder anzufassen. */
export function withKostolany<T extends object>(result: T, kostolany: KostolanyResult | null): T & { kostolany: KostolanyResult | null } {
  return { ...result, kostolany };
}
