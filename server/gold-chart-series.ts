/**
 * Gold-Chart-Reihen fuer Section 2 im BTC-Design (Future_10 §4 / §7).
 *
 * Haengt an jeden GoldPricePoint echte FRED-Makrowerte und das FMP-Volumen.
 * Nichts wird geschaetzt: fehlt eine Quelle, bleibt das Feld weg, und der
 * Chart blendet den Chip aus. Woechentliche/monatliche Reihen (WALCL, M2SL)
 * gelten bis zur naechsten Beobachtung (stepAfter; M2 max. 100 Tage wegen
 * ~5 Wochen Publikations-Lag, WALCL max. 14 Tage), taegliche Reihen (DXY,
 * T10YIE) werden hoechstens 7 Kalendertage fortgeschrieben (Feiertage).
 *
 * Kein Input fuer getTechnicalScore oder den GIS — reine Chart-Daten.
 */
import type { GoldPricePoint } from "../shared/gold-schema";

type FredPoint = { date: string; value: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Letzten Wert mit Datum <= date nachschlagen; maxAgeDays begrenzt das Fortschreiben. */
function asOfLookup(series: FredPoint[], maxAgeDays: number | null) {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  let idx = -1;
  return (date: string): number | undefined => {
    // Aufrufe kommen chronologisch aufsteigend; Zeiger nur vorwaerts bewegen.
    while (idx + 1 < sorted.length && sorted[idx + 1].date <= date) idx++;
    if (idx < 0) return undefined;
    const hit = sorted[idx];
    if (maxAgeDays != null) {
      const age = (new Date(date).getTime() - new Date(hit.date).getTime()) / DAY_MS;
      if (age > maxAgeDays) return undefined;
    }
    return hit.value;
  };
}

/** M2SL (Monatswerte, Mrd. USD) → YoY in % je Monat. Braucht den Wert 12 Monate vorher. */
export function m2YoySeries(m2: FredPoint[]): FredPoint[] {
  const byMonth = new Map(m2.map(p => [p.date.slice(0, 7), p.value]));
  const out: FredPoint[] = [];
  for (const p of m2) {
    const [y, m] = p.date.slice(0, 7).split("-").map(Number);
    const prevKey = `${y - 1}-${String(m).padStart(2, "0")}`;
    const prev = byMonth.get(prevKey);
    if (prev != null && prev > 0 && p.value > 0) {
      out.push({ date: p.date, value: Math.round(((p.value / prev) - 1) * 10000) / 100 });
    }
  }
  return out;
}

export interface GoldChartSeriesInput {
  dxy: FredPoint[];      // FRED DTWEXBGS (Broad Dollar Index, taeglich)
  t10yie: FredPoint[];   // FRED T10YIE (10J-Breakeven, taeglich)
  walcl: FredPoint[];    // FRED WALCL (Fed-Bilanz, Mio. USD, woechentlich)
  m2: FredPoint[];       // FRED M2SL (Mrd. USD, monatlich)
  volumes: { date: string; volume: number }[]; // FMP GCUSD OHLCV
}

export function enrichGoldChartSeries(points: GoldPricePoint[], input: GoldChartSeriesInput): GoldPricePoint[] {
  const dxyAt = asOfLookup(input.dxy, 7);
  const t10yieAt = asOfLookup(input.t10yie, 7);
  const walclAt = asOfLookup(input.walcl, 14);
  const m2YoyAt = asOfLookup(m2YoySeries(input.m2), 100);
  // Volumen nur, wenn die Quelle echte positive Prints liefert (FMP GCUSD hat teils 0).
  const realVolumes = input.volumes.filter(v => Number.isFinite(v.volume) && v.volume > 0);
  const volumeByDate = realVolumes.length > 0 ? new Map(realVolumes.map(v => [v.date, v.volume])) : null;

  return points.map(p => {
    const next: GoldPricePoint = { ...p };
    const dxy = dxyAt(p.date);
    if (dxy != null) next.dxy = dxy;
    const t10yie = t10yieAt(p.date);
    if (t10yie != null) next.t10yie = t10yie;
    const walcl = walclAt(p.date);
    // WALCL kommt in Mio. USD → Billionen fuer die Achse.
    if (walcl != null) next.walcl = Math.round((walcl / 1e6) * 1000) / 1000;
    const m2Yoy = m2YoyAt(p.date);
    if (m2Yoy != null) next.m2Yoy = m2Yoy;
    const vol = volumeByDate?.get(p.date);
    if (vol != null) next.volume = vol;
    return next;
  });
}
