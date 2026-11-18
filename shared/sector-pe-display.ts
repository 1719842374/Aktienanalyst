/**
 * Sektor-KGV nur als Anzeige. Fließt nicht in Bewertung, Attraktivität oder den Aktien-Score.
 * Harmonisches Mittel über Holdings-Gewichte; 10J-Schnitt nur, wenn die Datums-Spanne
 * die benannte Historie SECTOR_PE_HISTORY_YEARS deckt. Fehlendes bleibt n/a, nie 0.
 */
import { YAHOO_QS_TRAILING_PE_SOURCE } from "./yahoo-fundamental-series";

/** Definition der Kennzahl PE-10J, nicht eine Score-Schwelle. */
export const SECTOR_PE_HISTORY_YEARS = 10;

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

export interface SectorPeDisplay {
  id: string;
  etf: string;
  label: string;
  current: number | null;
  avg10y: number | null;
  /** Fertiger Zellentext, inklusive n/a-Grund. */
  text: string;
  note: string | null;
  source: "holdings-harmonic" | "etf-ratios" | "yahoo-trailing-pe" | "n/a";
  /** Menschenlesbarer Quellenname. null, wenn keine Quelle einen Wert geliefert hat. */
  sourceLabel: string | null;
  coverage: number | null;
}

export interface SectorPeResponse {
  asOf: string;
  sectors: SectorPeDisplay[];
  /** Immer false: diese Antwort verändert keinen Score. */
  scoreImpact: false;
}

export interface HoldingWeight {
  symbol: string;
  weight: number | null;
  pe: number | null;
}

function positive(v: number | null): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function formatPeNumber(n: number): string {
  const sign = n < 0 ? "-" : "";
  const rounded = Math.round(Math.abs(n) * 10) / 10;
  const [whole, frac] = rounded.toFixed(1).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${frac}`;
}

/**
 * Gewichtetes harmonisches Mittel. Eine Position ohne KGV zählt nicht als 0.
 * Veröffentlichung nur, wenn die größte Lücke nicht über dem Median der belegten
 * Gewichte liegt und das belegte Gewicht breiter ist als die größte Einzelposition.
 */
export function weightedHarmonicPe(rows: HoldingWeight[]): { value: number | null; note: string | null; coverage: number | null } {
  const weighted = rows.filter(r => positive(r.weight));
  const total = weighted.reduce((s, r) => s + (r.weight as number), 0);
  if (total <= 0) return { value: null, note: "n/a — Holdings ohne positive Gewichte", coverage: null };
  const usable = weighted.filter(r => positive(r.pe));
  if (usable.length === 0) return { value: null, note: "n/a — kein Holding mit positivem KGV", coverage: 0 };
  const omitted = weighted.filter(r => !positive(r.pe));
  const med = medianOf(usable.map(r => r.weight as number));
  const largestOmitted = omitted.reduce((m, r) => Math.max(m, r.weight as number), 0);
  const included = usable.reduce((s, r) => s + (r.weight as number), 0);
  const largestBook = weighted.reduce((m, r) => Math.max(m, r.weight as number), 0);
  const coverage = included / total;
  if (med != null && largestOmitted > med) {
    return { value: null, note: "n/a — größte Position ohne KGV wiegt mehr als der Median der belegten Holdings", coverage };
  }
  if (!(included > largestBook)) {
    return { value: null, note: "n/a — belegtes Gewicht ist nicht breiter als die größte Einzelposition", coverage };
  }
  const denom = usable.reduce((s, r) => s + (r.weight as number) / (r.pe as number), 0);
  if (!(denom > 0)) return { value: null, note: "n/a — gewichtetes KGV nicht definiert", coverage };
  const pct = Math.round(coverage * 1000) / 10;
  const note = coverage < 1 ? `Holdings-Deckung ${formatPeNumber(pct)} % des ETF-Gewichts` : null;
  return { value: included / denom, note, coverage };
}

/**
 * true, sobald weitere (leichtere) Holdings die Entscheidung nicht mehr kippen können:
 * die aktuelle Veröffentlichung würde auch dann gelten, wenn der ganze Rest kein KGV hätte.
 */
export function canStopHoldingsFetch(remainingMaxWeight: number, rows: HoldingWeight[]): boolean {
  const withTail = remainingMaxWeight > 0
    ? [...rows, { symbol: "", weight: remainingMaxWeight, pe: null }]
    : rows;
  return weightedHarmonicPe(withTail).value != null;
}

export function etfPeHistory(points: { date: string; pe: number | null }[]): { current: number | null; avg10y: number | null; note: string | null } {
  const valid = points
    .filter(p => p.date && positive(p.pe))
    .map(p => ({ date: p.date, pe: p.pe as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (valid.length === 0) return { current: null, avg10y: null, note: "n/a — kein positives ETF-KGV" };
  const current = valid[valid.length - 1].pe;
  const last = Date.parse(valid[valid.length - 1].date);
  const first = Date.parse(valid[0].date);
  if (!Number.isFinite(last) || !Number.isFinite(first)) {
    return { current, avg10y: null, note: "n/a — Datum der KGV-Historie ungültig" };
  }
  const spanYears = (last - first) / MS_PER_YEAR;
  if (spanYears < SECTOR_PE_HISTORY_YEARS) {
    const shown = Math.round(spanYears * 10) / 10;
    return { current, avg10y: null, note: `n/a — Historie deckt ${formatPeNumber(shown)} Jahre, nicht ${SECTOR_PE_HISTORY_YEARS}J` };
  }
  const cutoff = last - SECTOR_PE_HISTORY_YEARS * MS_PER_YEAR;
  const window = valid.filter(p => Date.parse(p.date) >= cutoff);
  const avg = window.reduce((s, p) => s + p.pe, 0) / window.length;
  return { current, avg10y: avg, note: null };
}

export function formatSectorPeText(current: number | null, avg10y: number | null, note: string | null): string {
  if (current == null && avg10y == null) return note ?? "n/a — kein Sektor-KGV";
  const avgText = avg10y != null ? formatPeNumber(avg10y) : (note ?? "n/a — 10J-Schnitt fehlt");
  if (current == null) return `n/a — aktuelles KGV fehlt (10J Ø ${avgText})`;
  return `${formatPeNumber(current)} (10J Ø ${avgText})`;
}

function sourceLabelFor(source: SectorPeDisplay["source"], override: string | null | undefined): string | null {
  switch (source) {
    case "holdings-harmonic":
      return "FMP etf/holdings + ratios";
    case "etf-ratios":
      return "FMP ratios";
    case "yahoo-trailing-pe":
      return override ?? YAHOO_QS_TRAILING_PE_SOURCE;
    case "n/a":
      return null;
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

export function composeSectorPeDisplay(args: {
  id: string;
  etf: string;
  label: string;
  holdings: HoldingWeight[] | null;
  etfHistory: { date: string; pe: number | null }[] | null;
  holdingsNote: string | null;
  /** Gesetzt, wenn die ETF-Historie nicht aus FMP-Ratios stammt. */
  historyOrigin?: "etf-ratios" | "yahoo-trailing-pe";
  sourceLabel?: string | null;
}): SectorPeDisplay {
  const history = etfPeHistory(args.etfHistory ?? []);
  const harmonic = args.holdings && args.holdings.length > 0 ? weightedHarmonicPe(args.holdings) : null;
  const current = harmonic?.value ?? history.current;
  const source: SectorPeDisplay["source"] = harmonic?.value != null
    ? "holdings-harmonic"
    : history.current != null
      ? (args.historyOrigin ?? "etf-ratios")
      : "n/a";
  const holdingsReason = harmonic?.value != null ? harmonic.note : (harmonic?.note ?? args.holdingsNote);
  const historyReason = history.avg10y == null ? history.note : null;
  const note = [holdingsReason, historyReason].filter((n): n is string => !!n).join(" · ") || null;
  let text = formatSectorPeText(current, history.avg10y, historyReason);
  if (source === "holdings-harmonic" && harmonic?.note) text = `${text} · ${harmonic.note}`;
  if ((source === "etf-ratios" || source === "yahoo-trailing-pe") && holdingsReason) text = `${text} · ${holdingsReason}`;
  if (current == null && history.avg10y == null && note) text = note;
  return {
    id: args.id,
    etf: args.etf,
    label: args.label,
    current,
    avg10y: history.avg10y,
    text,
    note,
    source,
    sourceLabel: sourceLabelFor(source, args.sourceLabel),
    coverage: harmonic?.coverage ?? null,
  };
}
