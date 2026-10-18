/**
 * Gold-AISC-Linie (Future_10 §5, Ticket B1) — reine Funktionen für Server und Client.
 *
 * Server (server/gold-aisc.ts) baut aus server/data/gold-aisc.json die Reihe `GoldAiscSeries`
 * (Response-Feld `aiscLine` von GET /api/analyze-gold). Der Client (GoldPriceChart.tsx) legt sie
 * mit `attachAiscToChart` als gestufte Linie auf die Preisachse und schattiert die Stresszone.
 *
 * Regeln: nur belegte Werte, nichts geschätzt oder interpoliert. Ø je Quartal nur ab
 * `minCompanies` Firmenwerten, sonst n/a (null). Eine n/a-Stufe beendet die Linie, bis
 * wieder ein belegtes Quartal kommt. Die Stufe beginnt `lagDays` nach Quartalsende
 * (Berichtsverzug: Q4-Berichte erscheinen bis ~52 Tage nach Quartalsende).
 * Kein Score: GIS, getTechnicalScore und gold-adaptive-score bleiben unberührt (B2).
 */
import type {
  GoldAiscCompanyCode,
  GoldAiscQuarterStep,
  GoldAiscSeries,
  GoldAiscValue,
} from "./schema";

export const GOLD_AISC_COMPANY_CODES: readonly GoldAiscCompanyCode[] = ["NEM", "B", "AEM"];
export const GOLD_AISC_MIN_COMPANIES = 2;
export const GOLD_AISC_LAG_DAYS = 60;
export const GOLD_AISC_STRESS_LOW = 1.10;
export const GOLD_AISC_STRESS_HIGH = 1.15;

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface GoldAiscFile {
  unit: string;
  basis: string;
  retrievedAt: string;
  companies: Record<string, { name: string; ticker: string; metric: string }>;
  values: GoldAiscValue[];
}

export function quarterPeriodEnd(quarter: string): string {
  const m = QUARTER_RE.exec(quarter);
  if (!m) throw new Error(`Ungültiges Quartal: ${quarter}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) * 3, 0)).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function nextQuarter(quarter: string): string {
  const m = QUARTER_RE.exec(quarter)!;
  const y = Number(m[1]);
  const q = Number(m[2]);
  return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
}

/** Prüft die Datei. Gibt Fehlertexte zurück (leer = gültig). Ein Fehler -> der Server liefert keine Linie. */
export function validateGoldAiscFile(file: GoldAiscFile): string[] {
  const errors: string[] = [];
  if (file?.unit !== "USD/oz") errors.push(`unit muss USD/oz sein (ist ${file?.unit})`);
  if (file?.basis !== "by-product") errors.push(`basis muss by-product sein (ist ${file?.basis})`);
  if (!Array.isArray(file?.values) || file.values.length === 0) {
    errors.push("values fehlt oder leer");
    return errors;
  }
  const seen = new Set<string>();
  for (let i = 0; i < file.values.length; i++) {
    const v = file.values[i];
    const at = `values[${i}] ${v?.company} ${v?.quarter}`;
    if (!GOLD_AISC_COMPANY_CODES.includes(v?.company)) errors.push(`${at}: unbekannte Firma`);
    if (!QUARTER_RE.test(String(v?.quarter))) { errors.push(`${at}: Quartal nicht im Format YYYY-Qn`); continue; }
    if (!(typeof v.aisc === "number" && Number.isFinite(v.aisc) && v.aisc > 0)) errors.push(`${at}: AISC keine positive Zahl`);
    if (!/^https:\/\/\S+$/.test(String(v.sourceUrl))) errors.push(`${at}: sourceUrl fehlt/kein https`);
    if (!String(v.sourceTitle ?? "").trim()) errors.push(`${at}: sourceTitle fehlt`);
    if (!DATE_RE.test(String(v.sourceDate))) errors.push(`${at}: sourceDate fehlt/kein YYYY-MM-DD`);
    else if (v.sourceDate <= quarterPeriodEnd(v.quarter)) errors.push(`${at}: Quelle (${v.sourceDate}) liegt nicht nach dem Quartalsende`);
    const key = `${v.company} ${v.quarter}`;
    if (seen.has(key)) errors.push(`${at}: doppelt`);
    seen.add(key);
  }
  for (const code of GOLD_AISC_COMPANY_CODES) {
    if (!file.companies?.[code]?.name) errors.push(`companies.${code} fehlt`);
  }
  return errors;
}

/** Baut die Reihe. Abgedeckt ist das erste bis letzte Quartal mit irgendeinem Wert, ohne Lücken in der Quartalsfolge. */
export function buildGoldAiscSeries(
  file: GoldAiscFile,
  opts: { minCompanies?: number; lagDays?: number } = {},
): GoldAiscSeries {
  const minCompanies = opts.minCompanies ?? GOLD_AISC_MIN_COMPANIES;
  const lagDays = opts.lagDays ?? GOLD_AISC_LAG_DAYS;
  const values = [...file.values].sort((a, b) => a.quarter.localeCompare(b.quarter) || a.company.localeCompare(b.company));
  const quarters: GoldAiscQuarterStep[] = [];
  const gaps: string[] = [];
  if (values.length > 0) {
    const last = values[values.length - 1].quarter;
    for (let q = values[0].quarter; q <= last; q = nextQuarter(q)) {
      const rows = values.filter(v => v.quarter === q);
      for (const code of GOLD_AISC_COMPANY_CODES) if (!rows.some(r => r.company === code)) gaps.push(`${code} ${q}`);
      const periodEnd = quarterPeriodEnd(q);
      quarters.push({
        quarter: q,
        periodEnd,
        availableFrom: addDays(periodEnd, lagDays),
        aisc: rows.length >= minCompanies ? Math.round(rows.reduce((s, r) => s + r.aisc, 0) / rows.length) : null,
        count: rows.length,
        values: rows,
      });
    }
  }
  return {
    unit: "USD/oz",
    basis: "by-product",
    method: "mean",
    minCompanies,
    lagDays,
    stressLow: GOLD_AISC_STRESS_LOW,
    stressHigh: GOLD_AISC_STRESS_HIGH,
    companies: {
      NEM: file.companies.NEM,
      B: file.companies.B,
      AEM: file.companies.AEM,
    },
    quarters,
    gaps,
    retrievedAt: file.retrievedAt,
    source: "server/data/gold-aisc.json",
    inScore: false,
  };
}

/** Zum Datum gültige Stufe (letzte mit availableFrom <= date). n/a-Stufe oder vor dem ersten Quartal -> null. */
export function goldAiscStepAt(series: GoldAiscSeries | null | undefined, date: string): GoldAiscQuarterStep | null {
  if (!series) return null;
  let hit: GoldAiscQuarterStep | null = null;
  for (const q of series.quarters) {
    if (q.availableFrom <= date) hit = q;
    else break;
  }
  return hit && hit.aisc != null ? hit : null;
}

export type GoldAiscStress = "na" | "below" | "stress" | "watch" | "ok";

/** below: Preis < AISC · stress: < AISC × 1,10 · watch: < AISC × 1,15 · ok: darüber · na: keine AISC */
export function goldAiscStress(price: number, aisc: number | null | undefined, low = GOLD_AISC_STRESS_LOW, high = GOLD_AISC_STRESS_HIGH): GoldAiscStress {
  if (aisc == null || !(aisc > 0) || !(price > 0)) return "na";
  if (price < aisc) return "below";
  if (price < aisc * low) return "stress";
  if (price < aisc * high) return "watch";
  return "ok";
}

export interface GoldAiscChartFields {
  /** Ø-AISC der gültigen Stufe (Preisachse) oder null */
  aisc: number | null;
  aiscQuarter: string | null;
  /** Preis liegt in der Stresszone (< AISC × stressHigh) */
  aiscStress: boolean;
}

/** Hängt die AISC-Stufe je Chart-Punkt an. Punkte bleiben sonst unverändert. */
export function attachAiscToChart<T extends { date: string; price: number }>(
  points: readonly T[],
  series: GoldAiscSeries | null | undefined,
): Array<T & GoldAiscChartFields> {
  return points.map(p => {
    const step = goldAiscStepAt(series, p.date);
    const aisc = step?.aisc ?? null;
    const stress = goldAiscStress(p.price, aisc, series?.stressLow, series?.stressHigh);
    return { ...p, aisc, aiscQuarter: step?.quarter ?? null, aiscStress: stress === "below" || stress === "stress" || stress === "watch" };
  });
}

/** Zusammenhängende Bereiche je Stufe (für die AISC-Bänder) auf vorhandenen Chart-Daten. */
export function aiscBands(points: ReadonlyArray<{ date: string } & GoldAiscChartFields>): Array<{ x1: string; x2: string; aisc: number; quarter: string }> {
  const out: Array<{ x1: string; x2: string; aisc: number; quarter: string }> = [];
  for (const p of points) {
    if (p.aisc == null || p.aiscQuarter == null) continue;
    const last = out[out.length - 1];
    if (last && last.quarter === p.aiscQuarter) last.x2 = p.date;
    else out.push({ x1: p.date, x2: p.date, aisc: p.aisc, quarter: p.aiscQuarter });
  }
  return out;
}

/** Zusammenhängende Tage mit Preis in der Stresszone (für die senkrechte Schattierung). */
export function aiscStressRuns(points: ReadonlyArray<{ date: string } & GoldAiscChartFields>): Array<{ x1: string; x2: string }> {
  const out: Array<{ x1: string; x2: string }> = [];
  let open: { x1: string; x2: string } | null = null;
  for (const p of points) {
    if (p.aiscStress) {
      if (open) open.x2 = p.date;
      else { open = { x1: p.date, x2: p.date }; out.push(open); }
    } else open = null;
  }
  return out;
}
