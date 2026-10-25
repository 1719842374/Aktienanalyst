/**
 * Future_10 F10-20 (AISC-Marge) und F10-24 (Fiskaldefizit) als Zusatzschicht — nur Anzeige.
 *
 * Kette: server/data/gold-aisc.json (aiscLine) + FRED MTSDS133FMS -> gold-routes.ts
 * -> Response-Feld `extraSignals` (GET /api/analyze-gold) -> GoldDashboard -> GoldExtraSignalsCard.
 *
 * Kein Score: GIS, getTechnicalScore und scoreGoldAdaptive (dort bleibt `aisc: null`, B2) bleiben
 * unberührt. Fehlende Daten -> n/a, nichts wird geschätzt oder interpoliert.
 */
import type { GoldAiscSeries } from "./schema";
import { goldAiscStepAt, goldAiscStress, type GoldAiscStress } from "./gold-aisc";

export interface GoldAiscMarginSignal {
  /** (Preis − AISC) / AISC, z. B. 1.5 = Preis 150 % über AISC. null = n/a */
  margin: number | null;
  aisc: number | null;
  quarter: string | null;
  price: number | null;
  stress: GoldAiscStress;
  note: string;
}

export interface GoldFiscalDeficitSignal {
  /** Rollierende 12-Monats-Summe Defizit (positiv = Defizit), Mio. USD. null = n/a */
  deficit12m: number | null;
  /** Dieselbe Summe 12 Monate früher */
  deficit12mPrior: number | null;
  /** Wachstum des 12M-Defizits ggü. Vorjahr (0.1 = +10 %). null = n/a */
  growth: number | null;
  /** Positiver Treiber laut Future_10 §6, wenn das Defizit wächst */
  direction: "positive" | "negative" | "na";
  latestMonth: string | null;
  source: "FRED MTSDS133FMS";
  note: string;
}

export interface GoldExtraSignals {
  inScore: false;
  aiscMargin: GoldAiscMarginSignal;
  fiscalDeficit: GoldFiscalDeficitSignal;
}

/** F10-20: Marge des Spotpreises über der zum Datum gültigen Quartals-AISC-Stufe. */
export function goldAiscMarginSignal(price: number, series: GoldAiscSeries | null | undefined, date: string): GoldAiscMarginSignal {
  const step = goldAiscStepAt(series, date);
  const aisc = step?.aisc ?? null;
  const okPrice = Number.isFinite(price) && price > 0;
  if (aisc == null || !(aisc > 0) || !okPrice) {
    return {
      margin: null, aisc, quarter: step?.quarter ?? null, price: okPrice ? price : null, stress: "na",
      note: !series ? "AISC-Quelle fehlt" : aisc == null ? "kein belegtes AISC-Quartal zum Datum" : "Spotpreis fehlt",
    };
  }
  return {
    margin: (price - aisc) / aisc,
    aisc,
    quarter: step!.quarter,
    price,
    stress: goldAiscStress(price, aisc, series?.stressLow, series?.stressHigh),
    note: "Quartals-AISC (Ø NEM/B/AEM, by-product) aus server/data/gold-aisc.json",
  };
}

/**
 * F10-24: FRED MTSDS133FMS (Monthly Treasury Statement, Überschuss(+)/Defizit(−), Mio. USD).
 * 12M-Defizit = −Summe der letzten 12 Monate. Braucht 24 lückenlose Monate, sonst n/a.
 */
export function goldFiscalDeficitSignal(points: ReadonlyArray<{ date: string; value: number }> | null | undefined): GoldFiscalDeficitSignal {
  const base = { source: "FRED MTSDS133FMS" as const };
  const clean = (points ?? [])
    .filter(p => /^\d{4}-\d{2}-01$/.test(p.date) && Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const na = (note: string, latestMonth: string | null = null): GoldFiscalDeficitSignal =>
    ({ ...base, deficit12m: null, deficit12mPrior: null, growth: null, direction: "na", latestMonth, note });
  if (clean.length < 24) return na("weniger als 24 Monatswerte", clean.at(-1)?.date ?? null);
  const last24 = clean.slice(-24);
  const monthIndex = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
  for (let i = 1; i < last24.length; i++) {
    if (monthIndex(last24[i].date) - monthIndex(last24[i - 1].date) !== 1) return na("Monatslücke in den letzten 24 Monaten", last24[23].date);
  }
  const sum = (arr: typeof last24) => arr.reduce((s, p) => s + p.value, 0);
  const deficit12m = -sum(last24.slice(12));
  const deficit12mPrior = -sum(last24.slice(0, 12));
  const growth = deficit12mPrior > 0 ? (deficit12m - deficit12mPrior) / deficit12mPrior : null;
  const direction = deficit12m > deficit12mPrior ? "positive" : "negative";
  return {
    ...base, deficit12m, deficit12mPrior, growth, direction, latestMonth: last24[23].date,
    note: growth == null ? "Vorjahr ohne Defizit, Wachstum n/a" : "12M-Summe vs. 12 Monate davor",
  };
}

export function buildGoldExtraSignals(input: {
  price: number;
  date: string;
  aiscLine: GoldAiscSeries | null | undefined;
  deficitPoints: ReadonlyArray<{ date: string; value: number }> | null | undefined;
}): GoldExtraSignals {
  return {
    inScore: false,
    aiscMargin: goldAiscMarginSignal(input.price, input.aiscLine, input.date),
    fiscalDeficit: goldFiscalDeficitSignal(input.deficitPoints),
  };
}
