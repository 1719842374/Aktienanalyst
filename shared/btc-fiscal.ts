/**
 * FW-09 — BTC-Fiscal-Overlay (reine Anzeige, KEIN Score-Einfluss).
 *
 * Quelle: FRED MTSO133FMS (Monthly Treasury Statement, Total Outlays,
 * Mio. USD, monatlich). Daraus: rollierende 12M-Summe und deren YoY-%.
 * Point-in-time: Monatswert gilt erst ab Monatsanfang + 1 Monat + 14 Tage
 * (MTS-Veröffentlichung ~8. Arbeitstag des Folgemonats) — kein Look-ahead.
 * Zonen: YoY ≥ 0 und ≥ Wert vor 3 Monaten = Wachstum/Beschleunigung,
 * YoY ≥ 0 und fallend = Verlangsamung, YoY < 0 = Kontraktion.
 * Globales Fiscal Spending: keine freie, konsistente Quelle → n/a.
 */
export const FISCAL_FRED_SERIES = "MTSO133FMS";
export const FISCAL_PUBLICATION_LAG_DAYS = 14;
/** Forward-Fill höchstens so lange; danach null (n/a statt Altwert). */
export const FISCAL_MAX_STALENESS_DAYS = 80;

export type FiscalZone = "wachstum" | "verlangsamung" | "kontraktion";

export interface FiscalYoyPoint {
  /** Monatsanfang YYYY-MM-01 */
  month: string;
  /** Erster Tag, an dem der Wert öffentlich bekannt war */
  visibleFrom: string;
  /** Rollierende 12M-Ausgaben in Mrd. USD */
  sum12mBn: number;
  /** YoY der 12M-Summe in % */
  yoyPct: number;
  /** null = Trend nicht bestimmbar (zu wenig Historie) */
  zone: FiscalZone | null;
}

export interface FiscalHistoryResponse {
  source: string;
  series: string;
  points: FiscalYoyPoint[];
  global: null;
  globalNote: string;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function fiscalVisibleFrom(month: string): string {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return addDaysIso(d.toISOString().slice(0, 10), FISCAL_PUBLICATION_LAG_DAYS);
}

export function classifyFiscalZone(yoy: number, yoy3mAgo: number | null): FiscalZone | null {
  if (!Number.isFinite(yoy)) return null;
  if (yoy < 0) return "kontraktion";
  if (yoy3mAgo == null || !Number.isFinite(yoy3mAgo)) return null;
  return yoy >= yoy3mAgo ? "wachstum" : "verlangsamung";
}

/** monthly: [{date: YYYY-MM-DD, value: Mio. USD}] (beliebig sortiert). */
export function buildFiscalYoy(monthly: { date: string; value: number }[]): FiscalYoyPoint[] {
  const rows = monthly
    .filter((r) => r && typeof r.date === "string" && Number.isFinite(r.value))
    .map((r) => ({ month: `${r.date.slice(0, 7)}-01`, value: r.value }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const monthIdx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
  const sums: { month: string; sum: number }[] = [];
  for (let i = 11; i < rows.length; i++) {
    // nur lückenlose 12-Monats-Fenster
    if (monthIdx(rows[i].month) - monthIdx(rows[i - 11].month) !== 11) continue;
    let s = 0;
    for (let k = i - 11; k <= i; k++) s += rows[k].value;
    sums.push({ month: rows[i].month, sum: s });
  }
  const sumByMonth = new Map(sums.map((s) => [monthIdx(s.month), s.sum]));
  const out: FiscalYoyPoint[] = [];
  const yoyByMonth = new Map<number, number>();
  for (const s of sums) {
    const mi = monthIdx(s.month);
    const prev = sumByMonth.get(mi - 12);
    if (prev == null || prev <= 0) continue;
    const yoy = (s.sum / prev - 1) * 100;
    yoyByMonth.set(mi, yoy);
    out.push({
      month: s.month,
      visibleFrom: fiscalVisibleFrom(s.month),
      sum12mBn: Math.round(s.sum / 10) / 100,
      yoyPct: Math.round(yoy * 100) / 100,
      zone: classifyFiscalZone(yoy, yoyByMonth.get(mi - 3) ?? null),
    });
  }
  return out;
}

/** Ordnet jedem Chart-Datum den zuletzt sichtbaren Wert zu (point-in-time). */
export function fiscalForwardFill(
  points: FiscalYoyPoint[],
  dates: string[],
): Record<string, { yoyPct: number; zone: FiscalZone | null } | null> {
  const sorted = [...points].sort((a, b) => a.visibleFrom.localeCompare(b.visibleFrom));
  const out: Record<string, { yoyPct: number; zone: FiscalZone | null } | null> = {};
  const sortedDates = [...dates].sort();
  let j = -1;
  for (const d of sortedDates) {
    while (j + 1 < sorted.length && sorted[j + 1].visibleFrom <= d) j++;
    if (j < 0) { out[d] = null; continue; }
    const p = sorted[j];
    const ageDays = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${p.visibleFrom}T00:00:00Z`)) / 86400000;
    out[d] = ageDays > FISCAL_MAX_STALENESS_DAYS ? null : { yoyPct: p.yoyPct, zone: p.zone };
  }
  return out;
}

/** Zusammenhängende Zonen-Läufe über die (sortierten) Chart-Daten. */
export function fiscalZoneRuns(
  rows: { date: string; fiscalZone?: FiscalZone | null }[],
): { x1: string; x2: string; zone: FiscalZone }[] {
  const runs: { x1: string; x2: string; zone: FiscalZone }[] = [];
  let open = false;
  for (const r of rows) {
    const z = r.fiscalZone ?? null;
    const last = runs[runs.length - 1];
    if (!z) { open = false; continue; }
    if (open && last && last.zone === z) { last.x2 = r.date; continue; }
    runs.push({ x1: r.date, x2: r.date, zone: z });
    open = true;
  }
  return runs;
}

export const FISCAL_ZONE_STYLE: Record<FiscalZone, { fill: string; label: string }> = {
  wachstum: { fill: "#22c55e", label: "Wachstum (beschleunigend)" },
  verlangsamung: { fill: "#f59e0b", label: "Verlangsamung" },
  kontraktion: { fill: "#ef4444", label: "Kontraktion" },
};
