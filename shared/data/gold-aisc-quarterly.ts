/**
 * Gold-AISC (All-in Sustaining Cost, USD/oz) der drei grossen Produzenten — Minen-Breakeven.
 *
 * Future_10 AISC-Linie: EINE Reihe fuer Chart-Linie (GoldPriceChart), Supply-Layer
 * (server/gold-adaptive-score.ts → supplySignal) und Gate GOLD_AISC_STRESS
 * (server/gold-realyield-model.ts → buildGoldAiscStressGate).
 *
 * Regeln:
 * - Nur Werte aus offiziell veroeffentlichten Quartalsberichten/Pressemitteilungen (SEC-Exhibits).
 *   Nichts geschaetzt, nichts interpoliert. Fehlt ein Wert, fehlt der Eintrag.
 * - Durchschnitt je Quartal nur, wenn mindestens 2 Firmenwerte vorliegen, sonst n/a (null).
 * - Basis: by-product AISC je Unze (so berichten Barrick und Agnico Eagle; Newmont
 *   weist seit 2026 „Gold By-Product AISC“ aus und hat 2025 in dieser Basis neu dargestellt).
 * - `availableFrom` = Quartalsende + 45 Tage. Alle hier zitierten Quartalsberichte erschienen
 *   spaetestens 44 Tage nach Quartalsende → kein Lookahead im Score/Gate.
 *
 * Das ist NICHT FRED T10YIE: der Chip „Inflations-BE (T10YIE)“ zeigt die 10J-Breakeven-
 * Inflation (Prozent, rechte Achse). AISC ist ein Kostenniveau in USD/oz auf der Preisachse.
 */

export type GoldAiscCompany = "Newmont" | "Barrick" | "Agnico Eagle";

export interface GoldAiscEntry {
  company: GoldAiscCompany;
  /** z.B. "2025-Q3" */
  quarter: string;
  /** AISC in USD je Unze Gold, by-product */
  aisc: number;
  sourceUrl: string;
  sourceTitle: string;
  /** Veroeffentlichung der Quelle (Pressemitteilung bzw. SEC-Filing-Datum), YYYY-MM-DD */
  publishedAt: string;
  note?: string;
}

const NEM_Q2_26 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1164727/000116472726000034/newmontq22026earningsrelea.htm",
  sourceTitle: "Newmont Reports Robust Second Quarter 2026 Results (Summary of Results, Gold By-Product AISC)",
  publishedAt: "2026-07-23",
};
const B_Q1_25 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/756894/000119312525114445/d936939dex992.htm",
  sourceTitle: "Barrick Q1 2025 Results (Gold AISC, 3/31/25 vs 12/31/24)",
  publishedAt: "2025-05-07",
};
const B_Q3_25 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/756894/000119312525274144/d922379dex991.htm",
  sourceTitle: "Barrick Reports Third Quarter 2025 Results (Gold AISC, 9/30/25 · 6/30/25 · 9/30/24)",
  publishedAt: "2025-11-10",
};
const B_Q4_25 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/756894/000119312526039501/d10712dex991.htm",
  sourceTitle: "Barrick Reports Full Year and Fourth Quarter 2025 Results (Gold AISC)",
  publishedAt: "2026-02-05",
};
const B_Q2_26 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/756894/000119312526343857/d67611dex991.htm",
  sourceTitle: "Barrick Reports Second Quarter 2026 Results (Gold AISC, 6/30/26 · 3/31/26)",
  publishedAt: "2026-08-10",
};
const A_Q3_25 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/2809/000110465925104746/tm2525021d3_ex99-1.htm",
  sourceTitle: "Agnico Eagle Reports Third Quarter 2025 Results (AISC per ounce, Q3 2025 · Q3 2024)",
  publishedAt: "2025-10-31",
};
const A_Q4_25 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/2809/000110465926014451/aem-20251231xex99d1.htm",
  sourceTitle: "Agnico Eagle Reports Fourth Quarter and Full Year 2025 Results (AISC per ounce, Q4 2025 · Q4 2024)",
  publishedAt: "2026-02-13",
};
const A_Q1_26 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/2809/000110465926054134/tm2612722d3_ex99-1.htm",
  sourceTitle: "Agnico Eagle Reports First Quarter 2026 Results (AISC per ounce)",
  publishedAt: "2026-05-01",
};
const A_Q2_26 = {
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/2809/000110465926088794/tm2619289d4_ex99-1.htm",
  sourceTitle: "Agnico Eagle Reports Second Quarter 2026 Results (AISC per ounce)",
  publishedAt: "2026-07-30",
};
const AEM_OLD = "bisherige Zusammensetzung (Stand bis 31.12.2025), im 2026er Bericht als Vergleichswert genannt";
const AEM_NEW = "ab 2026 revidierte Zusammensetzung (Meadowbank/Nunavut); FY2025: 1.313 neu vs. 1.339 alt";

export const GOLD_AISC_ENTRIES: readonly GoldAiscEntry[] = [
  // Newmont — Gold By-Product AISC, Summary of Results im Q2-2026-Bericht (2025 in By-Product-Basis)
  { company: "Newmont", quarter: "2025-Q1", aisc: 1447, ...NEM_Q2_26 },
  { company: "Newmont", quarter: "2025-Q2", aisc: 1375, ...NEM_Q2_26 },
  { company: "Newmont", quarter: "2025-Q3", aisc: 1303, ...NEM_Q2_26 },
  { company: "Newmont", quarter: "2025-Q4", aisc: 1302, ...NEM_Q2_26 },
  { company: "Newmont", quarter: "2026-Q1", aisc: 1029, ...NEM_Q2_26 },
  { company: "Newmont", quarter: "2026-Q2", aisc: 1621, ...NEM_Q2_26 },
  // Barrick — Gold AISC ($/oz)
  { company: "Barrick", quarter: "2024-Q3", aisc: 1507, ...B_Q3_25 },
  { company: "Barrick", quarter: "2024-Q4", aisc: 1451, ...B_Q1_25 },
  { company: "Barrick", quarter: "2025-Q1", aisc: 1775, ...B_Q1_25 },
  { company: "Barrick", quarter: "2025-Q2", aisc: 1684, ...B_Q3_25 },
  { company: "Barrick", quarter: "2025-Q3", aisc: 1538, ...B_Q3_25 },
  { company: "Barrick", quarter: "2025-Q4", aisc: 1581, ...B_Q4_25 },
  { company: "Barrick", quarter: "2026-Q1", aisc: 1708, ...B_Q2_26 },
  { company: "Barrick", quarter: "2026-Q2", aisc: 1866, ...B_Q2_26 },
  // Agnico Eagle — AISC per ounce (by-product, je produzierter Unze)
  { company: "Agnico Eagle", quarter: "2024-Q3", aisc: 1286, ...A_Q3_25 },
  { company: "Agnico Eagle", quarter: "2024-Q4", aisc: 1316, ...A_Q4_25 },
  { company: "Agnico Eagle", quarter: "2025-Q1", aisc: 1183, ...A_Q1_26, note: AEM_OLD },
  { company: "Agnico Eagle", quarter: "2025-Q2", aisc: 1289, ...A_Q2_26, note: AEM_OLD },
  { company: "Agnico Eagle", quarter: "2025-Q3", aisc: 1373, ...A_Q3_25 },
  { company: "Agnico Eagle", quarter: "2025-Q4", aisc: 1517, ...A_Q4_25 },
  { company: "Agnico Eagle", quarter: "2026-Q1", aisc: 1483, ...A_Q1_26, note: AEM_NEW },
  { company: "Agnico Eagle", quarter: "2026-Q2", aisc: 1459, ...A_Q2_26, note: AEM_NEW },
];

/** Abgedeckte Quartale (aelteste zuerst). Quartale ohne >= 2 Werte erscheinen mit aisc=null (n/a). */
export const GOLD_AISC_QUARTERS: readonly string[] = [
  "2024-Q3", "2024-Q4", "2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2",
];

export const GOLD_AISC_MIN_COMPANIES = 2;
export const GOLD_AISC_REPORTING_LAG_DAYS = 45;
/** Stresszone: Preis unter AISC × 1,10 (Stress) bzw. × 1,15 (Vorwarnung); Gate nutzt 1,15. */
export const GOLD_AISC_STRESS_LOW = 1.10;
export const GOLD_AISC_STRESS_HIGH = 1.15;
export const GOLD_AISC_SOURCE_LABEL = "Quartals-AISC Newmont/Barrick/Agnico Eagle (by-product, Ø ab 2 Werten)";

export interface GoldAiscQuarter {
  quarter: string;
  periodEnd: string;
  /** ab hier im Score/Gate/Chart wirksam (Quartalsende + 45 Tage) */
  availableFrom: string;
  /** Durchschnitt USD/oz oder null (n/a: weniger als 2 Werte) */
  aisc: number | null;
  count: number;
  companies: { company: GoldAiscCompany; aisc: number; sourceUrl: string; publishedAt: string; note?: string }[];
}

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

export function quarterPeriodEnd(quarter: string): string {
  const m = QUARTER_RE.exec(quarter);
  if (!m) throw new Error(`Ungueltiges Quartal: ${quarter}`);
  const month = Number(m[2]) * 3; // 3,6,9,12
  const last = new Date(Date.UTC(Number(m[1]), month, 0));
  return last.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function buildGoldAiscQuarterly(
  entries: readonly GoldAiscEntry[] = GOLD_AISC_ENTRIES,
  quarters: readonly string[] = GOLD_AISC_QUARTERS,
): GoldAiscQuarter[] {
  return quarters.map(quarter => {
    const rows = entries.filter(e => e.quarter === quarter && Number.isFinite(e.aisc) && e.aisc > 0);
    const periodEnd = quarterPeriodEnd(quarter);
    const avg = rows.length >= GOLD_AISC_MIN_COMPANIES
      ? Math.round(rows.reduce((s, r) => s + r.aisc, 0) / rows.length)
      : null;
    return {
      quarter,
      periodEnd,
      availableFrom: addDays(periodEnd, GOLD_AISC_REPORTING_LAG_DAYS),
      aisc: avg,
      count: rows.length,
      companies: rows.map(r => ({ company: r.company, aisc: r.aisc, sourceUrl: r.sourceUrl, publishedAt: r.publishedAt, ...(r.note ? { note: r.note } : {}) })),
    };
  });
}

export const GOLD_AISC_QUARTERLY: readonly GoldAiscQuarter[] = buildGoldAiscQuarterly();

/** Stufen fuer scoreGoldAdaptive({ aisc }) — nur belegte Quartale, Datum = availableFrom. */
export function goldAiscSteps(quarterly: readonly GoldAiscQuarter[] = GOLD_AISC_QUARTERLY): { date: string; aisc: number }[] {
  return quarterly
    .filter((q): q is GoldAiscQuarter & { aisc: number } => q.aisc != null)
    .map(q => ({ date: q.availableFrom, aisc: q.aisc }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Zum Datum gueltiges Quartal (letztes mit availableFrom <= date) oder null. n/a-Quartale beenden die Stufe. */
export function goldAiscAt(date: string, quarterly: readonly GoldAiscQuarter[] = GOLD_AISC_QUARTERLY): GoldAiscQuarter | null {
  let hit: GoldAiscQuarter | null = null;
  for (const q of quarterly) if (q.availableFrom <= date) hit = q;
  return hit && hit.aisc != null ? hit : null;
}

/** Map Datum → AISC fuer buildGoldMacroSeries/runRealYieldGoldModel. */
export function goldAiscByDate(dates: readonly string[], quarterly: readonly GoldAiscQuarter[] = GOLD_AISC_QUARTERLY): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of dates) {
    const q = goldAiscAt(d, quarterly);
    if (q?.aisc != null) out.set(d, q.aisc);
  }
  return out;
}

export type GoldAiscStress = "na" | "below" | "stress" | "watch" | "ok";

/** below: Preis < AISC · stress: < AISC×1,10 · watch: < AISC×1,15 · ok: darueber · na: keine AISC */
export function goldAiscStress(price: number, aisc: number | null): GoldAiscStress {
  if (aisc == null || !(aisc > 0) || !(price > 0)) return "na";
  if (price < aisc) return "below";
  if (price < aisc * GOLD_AISC_STRESS_LOW) return "stress";
  if (price < aisc * GOLD_AISC_STRESS_HIGH) return "watch";
  return "ok";
}
