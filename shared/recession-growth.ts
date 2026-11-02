/**
 * WORK_RECESSION_EARNINGS_GROWTH_PLOT und WORK_RECESSION_GROWTH_GAP.
 * Reine Rechnung für #/recession. Kein Netz, kein Score.
 *
 * Growth Gap = g_fwd − g_realized. Implied Gap = g* − g_realized.
 * Realistisches Wachstum = Median der YoY-Drucke im 10-Jahres-Fenster.
 * Kegel = dieser Median ± coneSigma · Stichproben-Streuung.
 * Fehlende Größen bleiben available:false mit Grund, nie 0 und nie interpoliert.
 */
import { epsPrintFromEarningsRow } from "./recession-market-charts";
import { asOfJoin } from "./recession-ta";

export const GROWTH_INDEXES = ["SPY", "VGK", "ASHR"] as const;
export type GrowthIndex = (typeof GROWTH_INDEXES)[number];

export const GROWTH_RANGES = ["5Y", "10Y", "Max"] as const;
export type GrowthRange = (typeof GROWTH_RANGES)[number];

export type GrowthFrequency = "quarterly" | "annual";

/**
 * Benannte Parameter. Herkunft: die beiden WORK-Specs (26.10.2026) und dieselbe
 * Stichproben-Std wie die Lager/Nachfrage-Lücke. Keine Bewertungsschwelle in Prozentpunkten.
 */
export const GROWTH_GAP_PARAMS = {
  /** Spec Growth Gap §4: Trendszenario = Median der letzten 10 Jahre. */
  medianWindowYears: 10,
  /** Spec §4: Extremszenarien ±2σ. Dieselbe Spanne ist die Warnschwelle für |Gap| / σ. */
  coneSigma: 2,
  /** |z| darunter: Spec „Nahe 0“ (Erwartung und Realität im Takt). Eine σ, nicht ein fester Pp-Wert. */
  nearZeroSigma: 1,
  /** Stichproben-Std (n−1). */
  sampleDof: 1,
  minStd: 1e-12,
  /** Mindestzahl Drucke im 10J-Fenster, sonst Median, σ und Gap-z n/a. */
  minPrints: 8,
  /** Quartalsdruck nur so lange halten, danach Lücke. Liegt unter zwei Quartalen, damit ein fehlendes Quartal nicht fortgeschrieben wird. */
  quarterMaxAgeDays: 120,
  /** Jahresdruck nur so lange halten. Liegt unter zwei Jahren, damit ein fehlendes Jahr nicht als YoY gestreckt wird. */
  annualMaxAgeDays: 400,
  /** Zwei Jahresabschlüsse sind nur dann ein YoY-Paar, wenn der Abstand in diesem Band liegt. */
  annualStepMinDays: 300,
  annualStepMaxDays: 450,
  /** VIX-z braucht mindestens ein Handelsjahr im Fenster. */
  minVixPrints: 252,
  /** Spec Earnings-Plot: Cache 6 h. */
  cacheTtlMs: 6 * 60 * 60 * 1000,
  percentScale: 100,
  /** Chartfenster der Earnings-Spec: 5Y / 10Y / Max. */
  ranges: GROWTH_RANGES,
} as const;

/**
 * Holdings-Konsens. maxNames ist die Länge der Yahoo-Top-Liste und die Obergrenze der FMP-Abfragen.
 * percentAbove trennt Prozent (8,3) von Fondsanteil (0,083). Beides sind Einheiten, keine Pp-Schwellen.
 * Veröffentlicht wird nur, wenn das belegte Gewicht breiter ist als die größte einzelne Position.
 */
export const GROWTH_HOLDINGS_PARAMS = {
  maxNames: 10,
  percentAbove: 1,
  /** Fund fraction. Below this the weighted g_fwd is n/a. */
  minCoverage: 0.15,
  /** Below this the value stays, and the UI names the thin sample. */
  warnCoverage: 0.5,
} as const;

/**
 * t = Tage von heute bis zum FY-Ende der Konsenszeile (FMP `date`).
 * Das ist der Abstand Mitte TTM zu Mitte Konsens-FY.
 * g_ann = (consensus / adjTTM) ^ (oneYearDays / t) − 1. g wird nicht gedämpft.
 * Das Aggregationsgewicht ist Index-Gewicht × min(1, t/oneYearDays) × Huber. Das ist technische Stabilisierung.
 * Yahoo forwardEps hat auf der Quote-Seite kein FY-Ende und bleibt der 1J-Quotient.
 */
export const FORWARD_HORIZON = {
  oneYearDays: 365,
} as const;

/** adjTTM = Summe der letzten reportedQuarters gemeldeten epsActual. */
export const EPS_BASIS = {
  reportedQuarters: 4,
} as const;

/**
 * Robust z = madScale · (g − median) / MAD.
 * Huber-Gewicht = 1 bei |z| ≤ robustZMax, sonst robustZMax / |z|. Symmetrisch, kein harter Ausschluss.
 * madZeroFallback gilt bei MAD 0 (mindestens die Hälfte sitzt auf dem Median).
 * "meanAD" skaliert mit der mittleren absoluten Abweichung. Ist die auch 0, ist jeder Druck der Median und der Filter ruht.
 */
export const FORWARD_OUTLIER = {
  robustZMax: 2.5,
  madScale: 0.6745,
  minNames: 4,
  madZeroFallback: "meanAD",
} as const;

export const EPS_CURRENCY = {
  pencePerPound: 100,
} as const;

export const FORWARD_FORMULA_EPS = "g_ann = (EPS_consensus / adjTTM)^(365/t) − 1, t = Tage bis FY-Ende";
/** Unannualisierter Quotient. Nur Yahoo-Felder ohne FY-Ende, nicht der FMP-Konsens. */
export const FORWARD_FORMULA_LEVEL = "g_fwd = EPS_consensus / EPS_TTM − 1";
export const FORWARD_FORMULA_HOLDINGS = "g_fwd = Σ (w_i · min(1, t_i/365) · h_i · g_ann,i) / Σ (w_i · min(1, t_i/365) · h_i); g_ann ungedämpft; h = Huber(|MAD-z|, symmetrisch); technische Stabilisierung";
export const FORWARD_FORMULA_YAHOO_RATIO = "g_fwd = earningsTrend[+1y].avg / trailingEps − 1";
export const FORWARD_FORMULA_YAHOO_GROWTH = "g_fwd = earningsTrend[+1y].growth (Yahoo-YoY, nicht Konsens/TTM)";
export const FORWARD_FORMULA_YAHOO_HTML = "g_fwd = forwardEps / trailingEps − 1";
export const REALIZED_FORMULA = "g_t = EPS_t / EPS_{t−1} − 1";
export const FAZIT_FORMULA =
  "(EPS-YoY − Median_10J) / σ_10J und (g_fwd − g_realized) / σ_10J; Bänder nearZeroSigma und coneSigma";
export const FMP_LEGACY_NOTE = "v3 nicht abgefragt: /api/v3 ist für Abos nach 2025-08-31 Legacy";

export const GSTAR_NA_REASON =
  "n/a — g* = WACC − FCF/EV braucht Index-FCF, EV und eine datengetriebene WACC. Keine gesetzte WACC. Top-Holdings-Aggregation ist eine kostenpflichtige Mehrfachabfrage (braucht Philip)";

export const LLM_NA_REASON =
  "n/a — LLM-Flag braucht OpenRouter (kostenpflichtig, braucht Philip)";

export const GROWTH_BOOKS: Record<GrowthIndex, { index: GrowthIndex; label: string; etf: string; fmpSymbols: readonly string[] }> = {
  SPY: { index: "SPY", label: "USA", etf: "SPY", fmpSymbols: ["SPY", "^GSPC"] },
  VGK: { index: "VGK", label: "Europa", etf: "VGK", fmpSymbols: ["VGK", "FEZ"] },
  ASHR: { index: "ASHR", label: "Asien", etf: "ASHR", fmpSymbols: ["ASHR"] },
};

export function parseGrowthIndex(raw: unknown): GrowthIndex | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "SPY" || s === "VGK" || s === "ASHR") return s;
  return null;
}

export function maxAgeForFrequency(frequency: GrowthFrequency): number {
  switch (frequency) {
    case "quarterly":
      return GROWTH_GAP_PARAMS.quarterMaxAgeDays;
    case "annual":
      return GROWTH_GAP_PARAMS.annualMaxAgeDays;
    default: {
      const neverFreq: never = frequency;
      return neverFreq;
    }
  }
}

export interface GrowthPrint {
  date: string;
  /** YoY in Prozent, nicht als Dezimalbruch. */
  yoyPct: number;
}

export interface PricePoint {
  date: string;
  close: number;
}

export type NaReading = { available: false; reason: string };

export type ForwardReading =
  | {
      available: true;
      gFwdPct: number;
      /** null, wenn der Konsens eine gewichtete Summe ohne ein einziges EPS ist. */
      epsConsensus: number | null;
      epsTtm: number | null;
      asOf: string;
      source: string;
      formula: string;
      /** Set when the sample is thinner than warnCoverage but still published. */
      coverageWarn?: string | null;
      /** Pro Ticker: ungedämpftes g, Aggregationsgewicht und t. */
      lines?: ForwardHoldingLine[];
    }
  | NaReading;

export interface ForwardHoldingLine {
  symbol: string;
  /** Ungedämpftes g_ann in Prozent. null, wenn der Ticker nicht im Mittel ist. */
  gAnnPct: number | null;
  /** Index-Gewicht in der Einheit der Holdings-Quelle. */
  indexWeight: number;
  /** Index-Gewicht × min(1, t/365) × Huber. null, wenn der Ticker nicht im Mittel ist. */
  weight: number | null;
  tDays: number | null;
  excludeReason: string | null;
}

export type SigmaBand = "innerhalb_nearZero" | "zwischen_nearZero_und_cone" | "ausserhalb_cone";

export type GrowthFazit =
  | { available: true; text: string; realizedBand: SigmaBand; gapBand: SigmaBand | null; formula: string }
  | { available: false; text: string; realizedBand: null; gapBand: null; formula: string };

export type GStarReading =
  | { available: true; gStarPct: number; asOf: string; source: string }
  | NaReading;

export type GapDirection = "positiv" | "negativ" | "nahe_null";

export type GapReading =
  | { available: true; gapPp: number; z: number; warn: boolean; direction: GapDirection }
  | NaReading;

export type RealizedStats =
  | {
      available: true;
      asOf: string;
      realizedPct: number;
      median10y: number;
      mean10y: number;
      std10y: number;
      z: number;
      percentile: number;
      prints: number;
      windowStart: string;
      coneLow: number;
      coneHigh: number;
      distanceToMedianPp: number;
    }
  | NaReading;

export type VixShockReading =
  | { available: true; asOf: string; latest: number; z: number; percentile: number; shock: boolean; prints: number; source: string }
  | NaReading;

export interface GrowthChartPoint {
  date: string;
  close: number;
  /** null = Lücke, letzter Druck ist älter als die Haltefrist. Kein Zwischenwert. */
  yoyPct: number | null;
}

export interface RecessionGrowthBody {
  index: GrowthIndex | null;
  label: string;
  etf: string | null;
  priceSource: string | null;
  priceError: string | null;
  realizedSource: string;
  realizedError: string | null;
  realizedFrequency: GrowthFrequency | null;
  realized: GrowthPrint[];
  chart: GrowthChartPoint[];
  stats: RealizedStats;
  forward: ForwardReading;
  gStar: GStarReading;
  growthGap: GapReading;
  impliedGap: GapReading;
  vix: VixShockReading;
  llm: NaReading;
  fazit: GrowthFazit;
  /** Jeder Versuch des Forward-Konsens, inklusive HTTP-Status. Leer nur bei einem leeren Fehlerkörper. */
  consensusTrace: string;
  sources: string[];
}

const MONTH_ABBR: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/** Gleiche Datumslesart wie englishLongDate in server/recession.ts. Die Score-Datei bleibt unangetastet. */
function englishLongDate(text: string): string | null {
  const match = text.trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const month = MONTH_ABBR[match[1]];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return `${match[3]}-${month}-${String(day).padStart(2, "0")}`;
}

function htmlCell(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Multpl-Tabelle „S&P 500 Earnings Growth Rate“ (current dollars, schon in Prozent). */
export function multplGrowthPrints(html: string): GrowthPrint[] {
  if (!html) return [];
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const byDate = new Map<string, GrowthPrint>();
  for (const row of rows) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(row))) cells.push(htmlCell(cellMatch[1]));
    if (cells.length < 2) continue;
    const date = englishLongDate(cells[0]);
    const num = Number(cells[1].replace(/%/g, "").replace(/,/g, "").trim());
    if (!date || !Number.isFinite(num)) continue;
    byDate.set(date, { date, yoyPct: num });
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function shiftYears(date: string, years: number): string {
  return `${String(Number(date.slice(0, 4)) + years).padStart(4, "0")}${date.slice(4)}`;
}

function daysBetween(later: string, earlier: string): number {
  return (Date.parse(later + "T00:00:00Z") - Date.parse(earlier + "T00:00:00Z")) / 86400000;
}

/**
 * Spec: g = EPS_t / EPS_{t-1} − 1.
 * Paare außerhalb des Jahresabstands entfallen. Negative oder Null-Basis entfällt.
 * Kein Strecken über ein fehlendes Jahr, kein Auffüllen mit 0.
 */
export function yoyFromAnnualEps(levels: { date: string; eps: number }[]): GrowthPrint[] {
  const rows = levels
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number.isFinite(r.eps))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  const out: GrowthPrint[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const days = daysBetween(cur.date, prev.date);
    if (days < GROWTH_GAP_PARAMS.annualStepMinDays || days > GROWTH_GAP_PARAMS.annualStepMaxDays) continue;
    if (!(prev.eps > 0) || !(cur.eps > 0)) continue;
    out.push({ date: cur.date, yoyPct: (cur.eps / prev.eps - 1) * GROWTH_GAP_PARAMS.percentScale });
  }
  return out;
}

export function forwardFromEps(
  consensus: number | null,
  ttm: number | null,
  asOf: string,
  source: string,
  formula: string = FORWARD_FORMULA_LEVEL,
): ForwardReading {
  if (consensus == null || !Number.isFinite(consensus)) {
    return { available: false, reason: "n/a — Forward-Konsens: epsAvg fehlt" };
  }
  if (!(consensus > 0)) return { available: false, reason: "n/a — Forward-Konsens: epsAvg ist nicht positiv" };
  if (ttm == null || !Number.isFinite(ttm)) return { available: false, reason: "n/a — TTM-EPS fehlt" };
  if (!(ttm > 0)) return { available: false, reason: "n/a — TTM-EPS ist nicht positiv (keine Division durch 0)" };
  return {
    available: true,
    gFwdPct: (consensus / ttm - 1) * GROWTH_GAP_PARAMS.percentScale,
    epsConsensus: consensus,
    epsTtm: ttm,
    asOf,
    source,
    formula,
  };
}

/** Quote-HTML nach dem Entschärfen der Escape-Quotes. Kein Crumb. */
export function unescapeYahooHtml(html: string): string {
  return html.replace(/\\"/g, "\"").replace(/&quot;/g, "\"");
}

/** Top-Holdings aus der Quote-Seite. Die Reihenfolge im HTML ist symbol, holdingName, holdingPercent. */
export function holdingsFromYahooHtml(html: string): HoldingWeightRow[] {
  if (!html) return [];
  const text = unescapeYahooHtml(html);
  const out: HoldingWeightRow[] = [];
  const re = /"symbol":"([A-Z0-9.-]+)","holdingName":"[^"]*","holdingPercent":\{"raw":(\d+(?:\.\d+)?)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const weight = Number(match[2]);
    if (Number.isFinite(weight) && weight > 0) out.push({ symbol: match[1], weight });
  }
  return weightsFromHoldingsPayload(out);
}

/**
 * trailingEps and forwardEps from the quote page, plus the currency those EPS use.
 * financialCurrency is the reporting currency of both EPS fields.
 * quoteCurrency is the trading currency and can differ (GBp quote, USD EPS).
 */
export function yahooEpsContext(html: string, symbol: string): {
  trailing: number | null;
  forward: number | null;
  financialCurrency: string | null;
  quoteCurrency: string | null;
} {
  const pair = epsPairFromYahooHtml(html);
  const text = unescapeYahooHtml(html);
  const fin = text.match(/"financialCurrency":"([A-Za-z]{3})"/);
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const quote = text.match(new RegExp(`"currency":"([A-Za-z]{3})","symbol":"${escaped}"`));
  return {
    trailing: pair.trailing,
    forward: pair.forward,
    financialCurrency: fin?.[1] ?? null,
    quoteCurrency: quote?.[1] ?? null,
  };
}

/** trailingEps und forwardEps aus der eingebetteten Quote-Summary der Quote-Seite. */
export function epsPairFromYahooHtml(html: string): { trailing: number | null; forward: number | null } {
  if (!html) return { trailing: null, forward: null };
  const text = unescapeYahooHtml(html);
  const read = (key: string): number | null => {
    const match = text.match(new RegExp(`"${key}":\\{"raw":(-?\\d+(?:\\.\\d+)?)`));
    const n = match ? Number(match[1]) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return { trailing: read("trailingEps"), forward: read("forwardEps") };
}

function consensusRows(raw: unknown): { date: string; eps: number; currency: string | null }[] {
  if (!Array.isArray(raw)) return [];
  const rows: { date: string; eps: number; currency: string | null }[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "").slice(0, 10);
    const eps = [r.epsAvg, r.estimatedEpsAvg, r.estimatedEpsDiluted, r.estimatedEps]
      .map(v => (typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN))
      .find(v => Number.isFinite(v));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || eps == null) continue;
    const currencyRaw = r.currency ?? r.reportedCurrency ?? r.epsCurrency;
    const currency = typeof currencyRaw === "string" && currencyRaw.trim() ? currencyRaw.trim() : null;
    rows.push({ date, eps, currency });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return rows;
}

export function horizonDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;
}

/** Nächster Konsens-EPS ab asOf. Vergangene Schätzjahre zählen nicht als Forward. */
export function nextConsensusEps(raw: unknown, asOf: string): { date: string; eps: number } | null {
  const row = consensusRows(raw).find(r => r.date >= asOf);
  return row ? { date: row.date, eps: row.eps } : null;
}

/**
 * Nächstes FY mit t > 0. t = Tage bis FY-Ende. Ein nahes FY bleibt, der Exponent wird nicht gedeckelt.
 * t ≤ 0 ist keine Division. Ein nicht positives eps bleibt die gewählte Zeile und fällt in annualizedFwdPct heraus.
 */
export function consensusForOneYear(raw: unknown, asOf: string): {
  date: string;
  eps: number;
  currency: string | null;
  horizonDays: number;
} | null {
  const rows = consensusRows(raw)
    .filter(row => row.date >= asOf)
    .map(row => ({ ...row, horizonDays: horizonDays(asOf, row.date) }))
    .filter(row => row.horizonDays > 0);
  return rows[0] ?? null;
}

/** g_ann in Prozent. (consensus/adjTTM)^(365/t) − 1, ohne Dämpfung und ohne Tagesfloor. */
export function annualizedFwdPct(consensus: number, ttm: number, days: number): { gFwdPct: number } | { reason: string } {
  if (!(consensus > 0)) return { reason: "n/a — Konsens-EPS ist nicht positiv" };
  if (!(ttm > 0)) return { reason: "n/a — adjTTM ≤ 0" };
  if (!(days > 0)) return { reason: "n/a — Horizont t ist nicht positiv" };
  const g = (consensus / ttm) ** (FORWARD_HORIZON.oneYearDays / days) - 1;
  if (!Number.isFinite(g)) return { reason: "n/a — g_ann nicht endlich" };
  return { gFwdPct: g * GROWTH_GAP_PARAMS.percentScale };
}

/** Technische Stabilisierung. Ohne t (Yahoo-1J ohne FY-Ende) bleibt der Faktor 1. */
export function horizonWeightFactor(tDays: number | null | undefined): number {
  if (tDays == null || !Number.isFinite(tDays)) return 1;
  if (!(tDays > 0)) return 0;
  return Math.min(1, tDays / FORWARD_HORIZON.oneYearDays);
}

function isFullYearPeriod(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  const period = String((row as Record<string, unknown>).period ?? "").trim().toUpperCase();
  return period === "FY" || period === "ANNUAL" || period === "YEAR";
}

/**
 * adjTTM = Summe der letzten 4 gemeldeten epsActual bis asOf.
 * Ein FY-Abschluss zählt nicht als Quartal. Weniger als 4 Drucke → null, der Aufrufer nennt den Fallback.
 * Summe ≤ 0 → unusableReason, kein stiller Ersatz.
 */
export function adjTtmFromEarnings(raw: unknown, asOf: string): {
  adjTtm: number | null;
  quarters: { date: string; eps: number }[];
  unusableReason: string | null;
} {
  const list = Array.isArray(raw) ? raw : [];
  const byDate = new Map<string, { date: string; eps: number }>();
  for (const row of list) {
    if (isFullYearPeriod(row)) continue;
    const parsed = epsPrintFromEarningsRow(row);
    if (!parsed || parsed.date > asOf) continue;
    byDate.set(parsed.date, parsed);
  }
  const quarters = Array.from(byDate.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, EPS_BASIS.reportedQuarters)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (quarters.length < EPS_BASIS.reportedQuarters) {
    return { adjTtm: null, quarters, unusableReason: null };
  }
  const adjTtm = quarters.reduce((sum, row) => sum + row.eps, 0);
  if (!(adjTtm > 0)) return { adjTtm, quarters, unusableReason: "n/a — adjTTM ≤ 0" };
  return { adjTtm, quarters, unusableReason: null };
}

function majorCurrency(amount: number, code: string): { amount: number; code: string } {
  const trimmed = code.trim();
  if (trimmed === "GBp" || trimmed === "GBX") {
    return { amount: amount / EPS_CURRENCY.pencePerPound, code: "GBP" };
  }
  return { amount, code: trimmed.toUpperCase() };
}

/**
 * Put consensus into the TTM currency. Same code, or GBp versus GBP, needs no FX table.
 * Differing majors need usdPerUnit (units of that currency for 1 USD, USD itself is 1).
 */
export function alignConsensusToTtm(
  consensus: number,
  consensusCcy: string | null,
  ttm: number,
  ttmCcy: string | null,
  usdPerUnit: Record<string, number> | null,
): { consensus: number; ttm: number; currency: string; note: string } | { error: string } {
  if (!consensusCcy || !ttmCcy) return { error: "Währung fehlt auf einer EPS-Seite" };
  const cons = majorCurrency(consensus, consensusCcy);
  const trail = majorCurrency(ttm, ttmCcy);
  if (cons.code === trail.code) {
    const scaled = consensusCcy.trim() !== ttmCcy.trim();
    return {
      consensus: cons.amount,
      ttm: trail.amount,
      currency: cons.code,
      note: scaled ? `${consensusCcy} und ${ttmCcy} auf ${cons.code} (pencePerPound ${EPS_CURRENCY.pencePerPound})` : cons.code,
    };
  }
  const rates: Record<string, number> | null = usdPerUnit ? { USD: 1, ...usdPerUnit } : null;
  const from = rates ? rates[cons.code] : undefined;
  const to = rates ? rates[trail.code] : undefined;
  if (from == null || to == null || !(from > 0) || !(to > 0)) {
    return { error: `keine FX für ${cons.code}→${trail.code}` };
  }
  return {
    consensus: (cons.amount / from) * to,
    ttm: trail.amount,
    currency: trail.code,
    note: `${cons.code}→${trail.code} via USD (Frankfurter/ECB)`,
  };
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function empiricalPercentile(vals: number[], latest: number): number {
  let le = 0;
  for (const v of vals) if (v <= latest) le++;
  return (le / vals.length) * GROWTH_GAP_PARAMS.percentScale;
}

function sampleStd(vals: number[], mean: number): number {
  const dof = vals.length - GROWTH_GAP_PARAMS.sampleDof;
  if (!(dof > 0)) return 0;
  return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / dof);
}

export function realizedStats(prints: GrowthPrint[]): RealizedStats {
  const rows = prints
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.yoyPct))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return { available: false, reason: "n/a — kein Gewinnwachstums-Druck" };
  const last = rows[rows.length - 1];
  const windowStart = shiftYears(last.date, -GROWTH_GAP_PARAMS.medianWindowYears);
  const win = rows.filter(p => p.date > windowStart && p.date <= last.date);
  if (win.length < GROWTH_GAP_PARAMS.minPrints) {
    return {
      available: false,
      reason: `n/a — zu wenig Historie (${win.length} Drucke im ${GROWTH_GAP_PARAMS.medianWindowYears}J-Fenster, mindestens ${GROWTH_GAP_PARAMS.minPrints})`,
    };
  }
  const vals = win.map(p => p.yoyPct);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const std = sampleStd(vals, mean);
  if (!(std > GROWTH_GAP_PARAMS.minStd)) {
    return { available: false, reason: "n/a — Streuung im 10J-Fenster ist 0, z-Wert nicht definiert" };
  }
  const med = median(vals);
  return {
    available: true,
    asOf: last.date,
    realizedPct: last.yoyPct,
    median10y: med,
    mean10y: mean,
    std10y: std,
    z: (last.yoyPct - mean) / std,
    percentile: empiricalPercentile(vals, last.yoyPct),
    prints: win.length,
    windowStart,
    coneLow: med - GROWTH_GAP_PARAMS.coneSigma * std,
    coneHigh: med + GROWTH_GAP_PARAMS.coneSigma * std,
    distanceToMedianPp: last.yoyPct - med,
  };
}

export function gapReading(left: number | null, leftMissing: string, realized: RealizedStats): GapReading {
  if (!realized.available) return { available: false, reason: realized.reason };
  if (left == null || !Number.isFinite(left)) return { available: false, reason: leftMissing };
  const gapPp = left - realized.realizedPct;
  const z = gapPp / realized.std10y;
  const absZ = Math.abs(z);
  let direction: GapDirection;
  if (absZ < GROWTH_GAP_PARAMS.nearZeroSigma) direction = "nahe_null";
  else if (gapPp > 0) direction = "positiv";
  else direction = "negativ";
  return { available: true, gapPp, z, warn: absZ >= GROWTH_GAP_PARAMS.coneSigma, direction };
}

export function vixShock(points: { date: string; value: number }[], source: string): VixShockReading {
  const rows = points
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) return { available: false, reason: "n/a — VIX: keine Drucke" };
  const last = rows[rows.length - 1];
  const windowStart = shiftYears(last.date, -GROWTH_GAP_PARAMS.medianWindowYears);
  const win = rows.filter(p => p.date > windowStart);
  if (win.length < GROWTH_GAP_PARAMS.minVixPrints) {
    return {
      available: false,
      reason: `n/a — VIX: zu wenig Historie (${win.length} Drucke, mindestens ${GROWTH_GAP_PARAMS.minVixPrints})`,
    };
  }
  const vals = win.map(p => p.value);
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const std = sampleStd(vals, mean);
  if (!(std > GROWTH_GAP_PARAMS.minStd)) return { available: false, reason: "n/a — VIX: Streuung im Fenster ist 0" };
  const z = (last.value - mean) / std;
  return {
    available: true,
    asOf: last.date,
    latest: last.value,
    z,
    percentile: empiricalPercentile(vals, last.value),
    shock: Math.abs(z) >= GROWTH_GAP_PARAMS.coneSigma,
    prints: win.length,
    source,
  };
}

/** Letzter Handelstag je Monat. Ein echter Schluss, kein Monatsmittel. */
export function monthEndCloses(bars: { date: string; close: number }[]): PricePoint[] {
  const byMonth = new Map<string, PricePoint>();
  for (const bar of bars) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date) || !Number.isFinite(bar.close) || !(bar.close > 0)) continue;
    const key = bar.date.slice(0, 7);
    const prev = byMonth.get(key);
    if (!prev || prev.date < bar.date) byMonth.set(key, { date: bar.date, close: bar.close });
  }
  return Array.from(byMonth.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * YoY auf die Kursmonate legen: letzter Druck, der nicht älter als maxAgeDays ist.
 * Älter → null. Kein Mittel zwischen zwei Drucken.
 */
export function growthChartPoints(price: PricePoint[], realized: GrowthPrint[], maxAgeDays: number): GrowthChartPoint[] {
  const months = monthEndCloses(price);
  const prints = realized
    .filter(p => Number.isFinite(p.yoyPct))
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({ date: p.date, value: p.yoyPct }));
  const yoy = asOfJoin(months.map(p => p.date), prints, maxAgeDays);
  return months.map((p, i) => ({ date: p.date, close: p.close, yoyPct: yoy[i] }));
}

export function sliceGrowthChart(points: GrowthChartPoint[], range: GrowthRange, asOf: string): GrowthChartPoint[] {
  switch (range) {
    case "Max":
      return points;
    case "5Y":
      return points.filter(p => p.date >= shiftYears(asOf, -5));
    case "10Y":
      return points.filter(p => p.date >= shiftYears(asOf, -10));
    default: {
      const neverRange: never = range;
      return neverRange;
    }
  }
}

const EPS_FIELD_KEYS = ["epsAvg", "estimatedEpsAvg", "estimatedEpsDiluted", "estimatedEps"] as const;

function finiteField(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function positiveEpsField(row: Record<string, unknown>): number | null {
  for (const key of EPS_FIELD_KEYS) {
    const n = finiteField(row[key]);
    if (n != null && n > 0) return n;
  }
  return null;
}

/** Zeilenzahl und ob ein künftiges epsAvg da ist. Steht im n/a-Grund, wenn der Konsens fehlt. */
export function describeAnalystEstimates(raw: unknown, asOf: string): string {
  if (!Array.isArray(raw)) return raw == null ? "leer" : "Antwort ist kein Array";
  if (raw.length === 0) return "0 Zeilen";
  let withEps = 0;
  let future = 0;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "").slice(0, 10);
    const eps = positiveEpsField(r);
    if (eps != null) withEps++;
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= asOf && eps != null) future++;
  }
  const base = `${raw.length} Zeilen, ${withEps} mit epsAvg, ${future} künftige Konsenszeilen ab ${asOf}`;
  if (withEps > 0) return base;
  const keys = new Set<string>();
  for (const row of raw.slice(0, 3)) {
    if (!row || typeof row !== "object") continue;
    for (const key of Object.keys(row as Record<string, unknown>)) {
      if (/eps|earn/i.test(key)) keys.add(key);
    }
  }
  return `${base}${keys.size ? `, EPS-Felder: ${Array.from(keys).join(", ")}` : ", keine EPS-Felder"}`;
}

/** /stable/earnings liefert Berichtstermine. Ein Quartals-epsEstimated ist kein Jahreskonsens. */
export function describeEarningsRows(raw: unknown, asOf: string): string {
  if (!Array.isArray(raw)) return "Antwort ist kein Array";
  let future = 0;
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "").slice(0, 10);
    const est = finiteField(r.epsEstimated);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date >= asOf && est != null) future++;
  }
  if (future === 0) return `${raw.length} Zeilen, kein zukünftiges epsEstimated`;
  return `${future} zukünftige epsEstimated. Das sind Berichtstermine, kein Jahreskonsens EPS_consensus/EPS_TTM, deshalb kein g_fwd`;
}

function yahooRaw(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in v) return finiteField((v as { raw: unknown }).raw);
  return null;
}

interface YahooTrendRow {
  period: string;
  endDate: string;
  avg: number | null;
  growth: number | null;
}

function readYahooTrend(raw: unknown): YahooTrendRow[] {
  if (!raw || typeof raw !== "object") return [];
  const trend = (raw as { earningsTrend?: { trend?: unknown } }).earningsTrend?.trend;
  if (!Array.isArray(trend)) return [];
  const out: YahooTrendRow[] = [];
  for (const row of trend) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const est = r.earningsEstimate;
    const estObj = est && typeof est === "object" ? est as Record<string, unknown> : {};
    out.push({
      period: String(r.period ?? ""),
      endDate: String(r.endDate ?? "").slice(0, 10),
      avg: yahooRaw(estObj.avg),
      growth: yahooRaw(estObj.growth) ?? yahooRaw(r.growth),
    });
  }
  return out;
}

/**
 * Yahoo quoteSummary earningsTrend. Bei ETF und Index fehlt das Modul (live geprüft).
 * +1y-avg / trailingEps ist der Spec-Quotient. Fehlt trailingEps, bleibt das Yahoo-growth-Feld
 * mit eigener Formel sichtbar, nicht still als Konsens/TTM ausgegeben.
 */
export function forwardFromYahooQuoteSummary(raw: unknown, asOf: string, source: string): ForwardReading {
  if (!raw || typeof raw !== "object") return { available: false, reason: "n/a — Yahoo quoteSummary leer" };
  const rows = readYahooTrend(raw);
  if (!rows.length) {
    return { available: false, reason: "n/a — Yahoo earningsTrend fehlt (bei ETF und Index liefert Yahoo das Modul nicht)" };
  }
  const plus = rows.find(r => r.period === "+1y");
  const current = rows.find(r => r.period === "0y" && (!r.endDate || r.endDate >= asOf));
  const pick = plus ?? current ?? null;
  if (!pick) return { available: false, reason: "n/a — Yahoo earningsTrend ohne +1y und ohne laufendes Jahr" };
  const trailing = yahooRaw((raw as { defaultKeyStatistics?: { trailingEps?: unknown } }).defaultKeyStatistics?.trailingEps);
  if (pick.avg != null && pick.avg > 0 && trailing != null && trailing > 0) {
    return {
      available: true,
      gFwdPct: (pick.avg / trailing - 1) * GROWTH_GAP_PARAMS.percentScale,
      epsConsensus: pick.avg,
      epsTtm: trailing,
      asOf: pick.endDate || asOf,
      source,
      formula: FORWARD_FORMULA_YAHOO_RATIO,
    };
  }
  if (pick.growth != null) {
    return {
      available: true,
      gFwdPct: pick.growth * GROWTH_GAP_PARAMS.percentScale,
      epsConsensus: pick.avg,
      epsTtm: trailing,
      asOf: pick.endDate || asOf,
      source,
      formula: FORWARD_FORMULA_YAHOO_GROWTH,
    };
  }
  return { available: false, reason: "n/a — Yahoo earningsTrend ohne avg/trailingEps und ohne growth" };
}

export interface HoldingWeightRow {
  symbol: string;
  weight: number;
}

/** FMP-Holdings-Array oder Yahoo topHoldings. Gewicht bleibt in der Einheit der Quelle. */
export function weightsFromHoldingsPayload(raw: unknown): HoldingWeightRow[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { holdings?: unknown }).holdings)
      ? (raw as { holdings: unknown[] }).holdings
      : raw && typeof raw === "object" && Array.isArray((raw as { topHoldings?: { holdings?: unknown } }).topHoldings?.holdings)
        ? ((raw as { topHoldings: { holdings: unknown[] } }).topHoldings.holdings)
        : [];
  const out: HoldingWeightRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const symbol = String(r.symbol ?? r.asset ?? r.assetSymbol ?? "").trim().toUpperCase();
    if (!symbol || /\s/.test(symbol) || symbol.startsWith("^")) continue;
    const weight = yahooRaw(r.holdingPercent) ?? yahooRaw(r.weightPercentage) ?? yahooRaw(r.weight) ?? yahooRaw(r.weightPercent);
    if (weight == null || !(weight > 0)) continue;
    out.push({ symbol, weight });
  }
  out.sort((a, b) => b.weight - a.weight);
  const seen = new Set<string>();
  return out.filter(row => (seen.has(row.symbol) ? false : (seen.add(row.symbol), true)));
}

export interface HoldingGrowthRow {
  symbol: string;
  weight: number;
  gFwdPct: number | null;
  /** Tage bis FY-Ende. null = Quelle ohne FY-Ende, Horizontfaktor 1. */
  tDays?: number | null;
  /** Gesetzter Grund: nicht im Mittel, das Index-Gewicht bleibt im Abdeckungstext. */
  excludeReason?: string | null;
}

export type WeightedForward =
  | {
      available: true;
      gFwdPct: number;
      fundFraction: number | null;
      used: string[];
      downweighted: string[];
      lines: ForwardHoldingLine[];
      formula: string;
      note: string;
      coverageWarn: string | null;
    }
  | { available: false; reason: string };

function deFixed(v: number, digits: number): string {
  const sign = v < 0 ? "−" : "";
  return sign + Math.abs(v).toFixed(digits).replace(".", ",");
}

/** Sichtbarer Hinweis. Der Parametername warnCoverage bleibt intern. */
function lowCoverageBanner(coverage: number, excluded: string[], downweighted: string[]): string {
  const pct = deFixed(coverage, 1);
  const limit = (GROWTH_HOLDINGS_PARAMS.warnCoverage * 100).toFixed(0);
  const parts = [`Geringe Abdeckung: ${pct} % < ${limit} %`];
  if (downweighted.length) {
    const z = deFixed(FORWARD_OUTLIER.robustZMax, 1);
    parts.push(`Huber-Gewicht (MAD-z, Schwelle ${z}, symmetrisch): ${downweighted.join(", ")}`);
  }
  if (excluded.length) parts.push(`ausgeschlossen: ${excluded.join(", ")}`);
  return parts.join(", ");
}

function huberWeight(z: number): number {
  const absZ = Math.abs(z);
  if (!(absZ > FORWARD_OUTLIER.robustZMax)) return 1;
  return FORWARD_OUTLIER.robustZMax / absZ;
}

type OutlierScale = "mad" | "meanAD" | "suspended";

/** MAD, or madZeroFallback when MAD is 0. A zero meanAD suspends the filter. */
function robustZ(values: number[]): { z: number[]; scale: OutlierScale } {
  const med = median(values);
  const absDev = values.map(value => Math.abs(value - med));
  const mad = median(absDev);
  if (mad > 0) {
    return { z: values.map(value => FORWARD_OUTLIER.madScale * (value - med) / mad), scale: "mad" };
  }
  switch (FORWARD_OUTLIER.madZeroFallback) {
    case "meanAD": {
      const meanAd = absDev.reduce((sum, value) => sum + value, 0) / values.length;
      if (meanAd > 0) {
        return { z: values.map(value => FORWARD_OUTLIER.madScale * (value - med) / meanAd), scale: "meanAD" };
      }
      return { z: values.map(() => 0), scale: "suspended" };
    }
    default: {
      const neverFallback: never = FORWARD_OUTLIER.madZeroFallback;
      return neverFallback;
    }
  }
}

function scaleLabel(scale: OutlierScale): string {
  switch (scale) {
    case "mad":
      return "";
    case "meanAD":
      return ` (${FORWARD_OUTLIER.madZeroFallback})`;
    case "suspended":
      return "";
    default: {
      const neverScale: never = scale;
      return neverScale;
    }
  }
}

/**
 * Gewichtetes Mittel. g_ann bleibt ungedämpft.
 * Aggregationsgewicht = Index-Gewicht × min(1, t/365) × Huber(|MAD-z|). Das ist technische Stabilisierung, kein Deckeln von g.
 * Ab minNames. Huber ist symmetrisch und streicht niemanden.
 * Die Veröffentlichung scheitert, wenn das Index-Gewicht nicht breiter ist als die größte Position
 * oder die Deckung unter minCoverage liegt. Darunter warnCoverage bleibt der Wert, mit Hinweis.
 * Ein Ticker mit excludeReason ist nicht im Mittel. Sein Index-Gewicht steht im Abdeckungstext.
 * Der nicht gelistete Rest des Fonds ist keine einzelne Aktie und kippt die Regel nicht.
 */
export function weightedHoldingsForward(rows: HoldingGrowthRow[]): WeightedForward {
  const listed = rows.filter(r => Number.isFinite(r.weight) && r.weight > 0);
  if (!listed.length) return { available: false, reason: "n/a — Holdings ohne positives Gewicht" };
  const used = listed.filter(r => r.gFwdPct != null && Number.isFinite(r.gFwdPct));
  if (!used.length) return { available: false, reason: "n/a — kein Holding mit Forward-Wachstum" };
  const huber = used.map(() => 1);
  let scale: OutlierScale = "suspended";
  if (used.length >= FORWARD_OUTLIER.minNames) {
    const scored = robustZ(used.map(row => row.gFwdPct as number));
    scale = scored.scale;
    if (scale !== "suspended") {
      scored.z.forEach((z, index) => {
        huber[index] = huberWeight(z);
      });
    }
  }
  const horizon = used.map(row => horizonWeightFactor(row.tDays));
  const downweighted = used.filter((_, index) => huber[index] < 1).map(row => row.symbol);
  const included = used.reduce((s, r) => s + r.weight, 0);
  const mass = used.reduce((s, r, index) => s + r.weight * horizon[index] * huber[index], 0);
  const largest = used.reduce((m, r) => Math.max(m, r.weight), 0);
  if (!(included > largest)) {
    return { available: false, reason: "n/a — belegtes Gewicht ist nicht breiter als die größte Position" };
  }
  if (!(mass > 0)) return { available: false, reason: "n/a — Aggregationsgewichte summieren sich auf 0" };
  const g = used.reduce((s, r, index) => s + r.weight * horizon[index] * huber[index] * (r.gFwdPct as number), 0) / mass;
  const maxListed = listed.reduce((m, r) => Math.max(m, r.weight), 0);
  const asFraction = (weight: number) => (maxListed > GROWTH_HOLDINGS_PARAMS.percentAbove ? weight / 100 : weight);
  const fundFraction = asFraction(included);
  const coverage = fundFraction <= 1.05 ? fundFraction * GROWTH_GAP_PARAMS.percentScale : null;
  if (coverage != null && coverage / GROWTH_GAP_PARAMS.percentScale < GROWTH_HOLDINGS_PARAMS.minCoverage) {
    return {
      available: false,
      reason: `n/a — Deckung ${deFixed(coverage, 1)} % < minCoverage ${(GROWTH_HOLDINGS_PARAMS.minCoverage * 100).toFixed(0)} %`,
    };
  }
  const reasoned = listed.filter(row => row.excludeReason && !used.some(kept => kept.symbol === row.symbol));
  const reasonedFraction = asFraction(reasoned.reduce((s, row) => s + row.weight, 0));
  const reasonedPct = reasonedFraction <= 1.05 ? reasonedFraction * GROWTH_GAP_PARAMS.percentScale : null;
  const huberNote = downweighted.length
    ? `, Huber-Gewicht (MAD-z, Schwelle ${deFixed(FORWARD_OUTLIER.robustZMax, 1)}${scaleLabel(scale)}, symmetrisch): ${downweighted.join(", ")}`
    : "";
  const stabilize = ", technische Stabilisierung: Gewicht = Index-Gewicht × min(1, t/365) × Huber, g ungedämpft";
  const reasonedNote = reasoned.length
    ? `, ausgeschlossen (nicht im Mittel, Gewicht zählt in der Abdeckung${reasonedPct != null ? ` ${deFixed(reasonedPct, 1)} %` : ""}): ${reasoned.map(row => `${row.symbol} (${String(row.excludeReason).replace(/^n\/a — /, "")})`).join(", ")}`
    : "";
  const listedWeight = listed.reduce((s, row) => s + row.weight, 0);
  const note = coverage != null
    ? `Deckung ${deFixed(coverage, 1)} % des Fonds, ${used.length} Namen, Regel belegtes Gewicht > größte Position${stabilize}${huberNote}${reasonedNote}`
    : `Deckung der gelisteten Gewichte ${deFixed((included / listedWeight) * 100, 1)} %, Regel belegtes Gewicht > größte Position${stabilize}${huberNote}${reasonedNote}`;
  const huberBySymbol = new Map<string, number>();
  used.forEach((row, index) => huberBySymbol.set(row.symbol, huber[index] * horizon[index]));
  const lines: ForwardHoldingLine[] = listed.map(row => {
    const scaleW = huberBySymbol.get(row.symbol);
    const inMean = scaleW != null;
    return {
      symbol: row.symbol,
      gAnnPct: inMean ? row.gFwdPct : null,
      indexWeight: row.weight,
      weight: inMean ? row.weight * scaleW : null,
      tDays: row.tDays ?? null,
      excludeReason: inMean ? null : (row.excludeReason ?? null),
    };
  });
  const excluded = listed
    .filter(row => !used.some(kept => kept.symbol === row.symbol))
    .map(row => {
      const fraction = asFraction(row.weight);
      const pct = fraction <= 1.05 ? `${deFixed(fraction * GROWTH_GAP_PARAMS.percentScale, 1)} %` : "";
      const reason = row.excludeReason ? String(row.excludeReason).replace(/^n\/a — /, "") : "";
      if (reason && pct) return `${row.symbol} ${pct} (${reason})`;
      if (reason) return `${row.symbol} (${reason})`;
      return row.symbol;
    });
  const coverageWarn = coverage != null && coverage / GROWTH_GAP_PARAMS.percentScale < GROWTH_HOLDINGS_PARAMS.warnCoverage
    ? lowCoverageBanner(coverage, excluded, downweighted)
    : null;
  return {
    available: true,
    gFwdPct: g,
    fundFraction: coverage != null ? fundFraction : null,
    used: used.map(r => r.symbol),
    downweighted,
    lines,
    formula: FORWARD_FORMULA_HOLDINGS,
    note,
    coverageWarn,
  };
}

export function sigmaBand(absZ: number): SigmaBand {
  if (absZ >= GROWTH_GAP_PARAMS.coneSigma) return "ausserhalb_cone";
  if (absZ >= GROWTH_GAP_PARAMS.nearZeroSigma) return "zwischen_nearZero_und_cone";
  return "innerhalb_nearZero";
}

function bandPhrase(band: SigmaBand): string {
  switch (band) {
    case "innerhalb_nearZero":
      return `innerhalb nearZeroSigma (${GROWTH_GAP_PARAMS.nearZeroSigma}σ)`;
    case "zwischen_nearZero_und_cone":
      return `zwischen nearZeroSigma (${GROWTH_GAP_PARAMS.nearZeroSigma}σ) und coneSigma (${GROWTH_GAP_PARAMS.coneSigma}σ)`;
    case "ausserhalb_cone":
      return `außerhalb coneSigma (${GROWTH_GAP_PARAMS.coneSigma}σ)`;
    default: {
      const neverBand: never = band;
      return neverBand;
    }
  }
}

function signedDe(v: number, digits: number): string {
  if (v > 0) return `+${deFixed(v, digits)}`;
  return deFixed(v, digits);
}

function gapSentence(direction: GapDirection): string {
  switch (direction) {
    case "positiv":
      return "Markt erwartet mehr Wachstum als zuletzt realisiert";
    case "negativ":
      return "Markt erwartet weniger als zuletzt realisiert";
    case "nahe_null":
      return "Erwartung und Realität im Takt";
    default: {
      const neverDir: never = direction;
      return neverDir;
    }
  }
}

/** Kurze Einordnung. Schwellen sind nearZeroSigma und coneSigma aus der eigenen 10J-Streuung, keine festen Pp. */
export function growthFazit(stats: RealizedStats, gap: GapReading): GrowthFazit {
  if (!stats.available) {
    return { available: false, text: stats.reason, realizedBand: null, gapBand: null, formula: FAZIT_FORMULA };
  }
  const medianZ = (stats.realizedPct - stats.median10y) / stats.std10y;
  const realizedBand = sigmaBand(Math.abs(medianZ));
  const side = medianZ >= GROWTH_GAP_PARAMS.nearZeroSigma
    ? "über"
    : medianZ <= -GROWTH_GAP_PARAMS.nearZeroSigma
      ? "unter"
      : "nahe";
  const realized = `EPS-YoY ${signedDe(stats.realizedPct, 1)} % liegt ${side} dem ${GROWTH_GAP_PARAMS.medianWindowYears}J-Median ${signedDe(stats.median10y, 1)} % (Abstand ${signedDe(stats.distanceToMedianPp, 1)} Pp, Perzentil ${deFixed(stats.percentile, 1)} %, Median-z ${signedDe(medianZ, 2)}, Band ${bandPhrase(realizedBand)}; Kegel ±${GROWTH_GAP_PARAMS.coneSigma}σ von ${signedDe(stats.coneLow, 1)} % bis ${signedDe(stats.coneHigh, 1)} %).`;
  if (!gap.available) {
    const first = gap.reason.replace(/^n\/a — /, "").split(";")[0].trim();
    return { available: true, text: `${realized} Growth Gap n/a — ${first}.`, realizedBand, gapBand: null, formula: FAZIT_FORMULA };
  }
  const gapBand = sigmaBand(Math.abs(gap.z));
  const gapText = `Growth Gap ${signedDe(gap.gapPp, 1)} Pp (z ${signedDe(gap.z, 2)}, Band ${bandPhrase(gapBand)}): ${gapSentence(gap.direction)}.`;
  return { available: true, text: `${realized} ${gapText}`, realizedBand, gapBand, formula: FAZIT_FORMULA };
}

export interface GrowthBuildInput {
  index: GrowthIndex;
  price: PricePoint[];
  priceSource: string | null;
  priceError: string | null;
  realized: GrowthPrint[];
  realizedSource: string;
  realizedError: string | null;
  realizedFrequency: GrowthFrequency | null;
  forward: ForwardReading;
  vixPoints: { date: string; value: number }[];
  vixSource: string;
  vixError: string | null;
  consensusTrace?: string;
}

export function buildGrowthBody(input: GrowthBuildInput): RecessionGrowthBody {
  const book = GROWTH_BOOKS[input.index];
  const stats = realizedStats(input.realized);
  const gStar: GStarReading = { available: false, reason: GSTAR_NA_REASON };
  const growthGap = input.forward.available
    ? gapReading(input.forward.gFwdPct, "", stats)
    : gapReading(null, input.forward.reason, stats);
  const impliedGap = gapReading(null, GSTAR_NA_REASON, stats);
  const vix = input.vixPoints.length
    ? vixShock(input.vixPoints, input.vixSource)
    : { available: false as const, reason: input.vixError ?? "n/a — VIX: keine Drucke" };
  const chart = input.realizedFrequency
    ? growthChartPoints(input.price, input.realized, maxAgeForFrequency(input.realizedFrequency))
    : monthEndCloses(input.price).map(p => ({ date: p.date, close: p.close, yoyPct: null }));
  const sources = [input.priceSource, input.realizedSource, input.forward.available ? input.forward.source : null, vix.available ? vix.source : null]
    .filter((s): s is string => !!s);
  const fazit = growthFazit(stats, growthGap);
  return {
    index: input.index,
    label: book.label,
    etf: book.etf,
    priceSource: input.priceSource,
    priceError: input.priceError,
    realizedSource: input.realizedSource,
    realizedError: input.realizedError,
    realizedFrequency: input.realizedFrequency,
    realized: input.realized,
    chart,
    stats,
    forward: input.forward,
    gStar,
    growthGap,
    impliedGap,
    vix,
    llm: { available: false, reason: LLM_NA_REASON },
    fazit,
    consensusTrace: input.consensusTrace ?? "",
    sources,
  };
}

export function emptyGrowthBody(reason: string): RecessionGrowthBody {
  const na = { available: false as const, reason };
  return {
    index: null,
    label: "",
    etf: null,
    priceSource: null,
    priceError: reason,
    realizedSource: "",
    realizedError: reason,
    realizedFrequency: null,
    realized: [],
    chart: [],
    stats: na,
    forward: na,
    gStar: { available: false, reason: GSTAR_NA_REASON },
    growthGap: na,
    impliedGap: { available: false, reason: GSTAR_NA_REASON },
    vix: na,
    llm: { available: false, reason: LLM_NA_REASON },
    fazit: { available: false, text: reason, realizedBand: null, gapBand: null, formula: FAZIT_FORMULA },
    consensusTrace: reason,
    sources: [],
  };
}
