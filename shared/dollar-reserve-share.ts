/**
 * F1-39 — Dollar-Anteil an den Weltreserven (Spec: Offen_FUTURE_SOLL_IST_DETAIL.md Z.104, Quelle Future_1 Z.461).
 * Einzige Quelle: IMF COFER (SDMX 2.1, Reihe G001.AFXRA.CI_USD.SHRO_PT.Q = USD-Anteil an den
 * zugeordneten Devisenreserven, Prozent, quartalsweise). Reine Parse-/Rechenlogik, kein Netz, kein Score.
 * Leer / fehlende Reihe / zu kurze Historie → { available: false, reason } (n/a), nie 0.
 */
export interface QuarterPoint { period: string; value: number }

export type DollarReserveShareReading =
  | { available: true; latestPeriod: string; latestPct: number; yoyPp: number | null; yoyReason?: string;
      change5yPp: number | null; change5yReason?: string; quarters: number; series: QuarterPoint[];
      source: "IMF COFER" }
  | { available: false; reason: string; source: "IMF COFER" };

export const COFER_SERIES_KEY = "G001.AFXRA.CI_USD.SHRO_PT.Q";
/** Mindestens 5 Quartale (aktuell + Vorjahresquartal), sonst n/a. */
export const COFER_MIN_QUARTERS = 5;

const PERIOD_RE = /^\d{4}-Q[1-4]$/;

/** Alle Beobachtungen der USD-Anteil-Reihe (Quartal) aus einer SDMX-StructureSpecificData-Antwort. */
export function parseCoferUsdShare(xml: string | null | undefined): QuarterPoint[] {
  if (!xml || !xml.includes("<message:StructureSpecificData")) return [];
  const out: QuarterPoint[] = [];
  const seriesRe = /<Series\s([^>]*)>([\s\S]*?)<\/Series>/g;
  for (const m of Array.from(xml.matchAll(seriesRe))) {
    const attrs = m[1];
    const want = ['COUNTRY="G001"', 'INDICATOR="AFXRA"', 'FXR_CURRENCY="CI_USD"', 'TYPE_OF_TRANSFORMATION="SHRO_PT"', 'FREQUENCY="Q"'];
    if (!want.every(w => attrs.includes(w))) continue;
    for (const o of Array.from(m[2].matchAll(/<Obs\s([^>]*)\/?>/g))) {
      const period = /TIME_PERIOD="([^"]+)"/.exec(o[1])?.[1];
      const raw = /OBS_VALUE="([^"]+)"/.exec(o[1])?.[1];
      const value = raw == null ? NaN : Number(raw);
      if (period && PERIOD_RE.test(period) && Number.isFinite(value)) out.push({ period, value });
    }
  }
  const byPeriod = new Map(out.map(p => [p.period, p]));
  return Array.from(byPeriod.values()).sort((a, b) => a.period.localeCompare(b.period));
}

function shiftYears(period: string, years: number): string {
  return `${Number(period.slice(0, 4)) + years}${period.slice(4)}`;
}

function changePp(series: QuarterPoint[], latest: QuarterPoint, years: number): number | string {
  const target = shiftYears(latest.period, -years);
  const prev = series.find(p => p.period === target);
  return prev ? latest.value - prev.value : `kein Wert für ${target}`;
}

export function dollarReserveShareReading(series: QuarterPoint[]): DollarReserveShareReading {
  const s = series.filter(p => PERIOD_RE.test(p.period) && Number.isFinite(p.value))
    .slice().sort((a, b) => a.period.localeCompare(b.period));
  if (s.length === 0) return { available: false, reason: "IMF COFER: keine gültigen USD-Beobachtungen", source: "IMF COFER" };
  if (s.length < COFER_MIN_QUARTERS) {
    return { available: false, reason: `IMF COFER: zu wenig Historie (${s.length} Quartale, mindestens ${COFER_MIN_QUARTERS})`, source: "IMF COFER" };
  }
  const latest = s[s.length - 1];
  const y1 = changePp(s, latest, 1), y5 = changePp(s, latest, 5);
  if (typeof y1 === "string") return { available: false, reason: `IMF COFER: Vorjahresquartal fehlt (${y1})`, source: "IMF COFER" };
  return {
    available: true, latestPeriod: latest.period, latestPct: latest.value, yoyPp: y1,
    change5yPp: typeof y5 === "string" ? null : y5, ...(typeof y5 === "string" ? { change5yReason: y5 } : {}),
    quarters: s.length, series: s, source: "IMF COFER",
  };
}
