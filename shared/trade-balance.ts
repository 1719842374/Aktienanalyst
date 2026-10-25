/**
 * F1-38: Handelsbilanz/BIP für das Buffett-Panel (USA), nur Anzeige — kein Score, kein Fazit.
 *
 * Zähler: FRED BOPGSTB (Saldo Waren + Dienstleistungen, Mio. $, monatlich, saisonbereinigt), Summe der
 * letzten 12 Monate. Nenner: FRED GDP (nominales BIP, Mrd. $, Jahresrate), letzter Quartalswert mit
 * Datum ≤ letzter BOPGSTB-Monat. Keine Datenwerte im Code; fehlt etwas → null mit Grund (n/a).
 * Kein bereinigter Buffett (F1-40), kein φ (F1-36).
 */
export const TRADE_BALANCE_SERIES_ID = "BOPGSTB";
export const TRADE_BALANCE_SOURCE_LABEL = "FRED BOPGSTB (Handelsbilanz Waren + Dienstleistungen) ÷ FRED GDP";
export const TRADE_BALANCE_MONTHS = 12;

export interface TradeBalanceToGdp {
  /** Handelsbilanz der letzten 12 Monate in Prozent des BIP (negativ = Defizit). */
  pct: number;
  /** Letzter BOPGSTB-Monat (YYYY-MM-01). */
  asOf: string;
  /** Erster der 12 summierten Monate. */
  from: string;
  /** Summe der 12 Monate, Mrd. $. */
  ttmBn: number;
  /** Verwendetes BIP, Mrd. $ (Jahresrate), und sein Quartalsdatum. */
  gdpBn: number;
  gdpDate: string;
  /** Gleiche Rechnung 12 Monate früher, null wenn nicht berechenbar. */
  pctYearAgo: number | null;
  asOfYearAgo: string | null;
  source: string;
}

type Obs = { date: string; value: number };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function monthIndex(iso: string): number {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1;
}

function clean(points: ReadonlyArray<Obs> | null | undefined): Obs[] {
  if (!Array.isArray(points)) return [];
  return points.filter(p => p && ISO.test(p.date) && Number.isFinite(p.value)).slice().sort((a, b) => a.date.localeCompare(b.date));
}

/** Rechnung für das Fenster, das mit bop[endIdx] endet; null, wenn die 12 Monate nicht lückenlos sind oder kein BIP passt. */
function ratioAt(bop: Obs[], endIdx: number, gdp: Obs[]): Omit<TradeBalanceToGdp, "pctYearAgo" | "asOfYearAgo" | "source"> | null {
  const startIdx = endIdx - (TRADE_BALANCE_MONTHS - 1);
  if (startIdx < 0) return null;
  const win = bop.slice(startIdx, endIdx + 1);
  if (monthIndex(win[win.length - 1].date) - monthIndex(win[0].date) !== TRADE_BALANCE_MONTHS - 1) return null;
  const asOf = win[win.length - 1].date;
  const g = [...gdp].reverse().find(p => p.date <= asOf);
  if (!g || g.value <= 0) return null;
  const ttmBn = win.reduce((s, p) => s + p.value, 0) / 1000;
  return { pct: (ttmBn / g.value) * 100, asOf, from: win[0].date, ttmBn, gdpBn: g.value, gdpDate: g.date };
}

export function tradeBalanceToGdp(
  bopRaw: ReadonlyArray<Obs> | null | undefined,
  gdpRaw: ReadonlyArray<Obs> | null | undefined,
): { value: TradeBalanceToGdp | null; reason: string | null } {
  const bop = clean(bopRaw);
  const gdp = clean(gdpRaw);
  if (bop.length < TRADE_BALANCE_MONTHS) return { value: null, reason: `FRED BOPGSTB: nur ${bop.length} Monatswerte` };
  if (gdp.length === 0) return { value: null, reason: "FRED GDP: keine Werte" };
  const now = ratioAt(bop, bop.length - 1, gdp);
  if (!now) return { value: null, reason: "FRED BOPGSTB/GDP: keine lückenlosen 12 Monate mit BIP-Wert" };
  const ago = ratioAt(bop, bop.length - 1 - TRADE_BALANCE_MONTHS, gdp);
  return {
    value: { ...now, pctYearAgo: ago?.pct ?? null, asOfYearAgo: ago?.asOf ?? null, source: TRADE_BALANCE_SOURCE_LABEL },
    reason: null,
  };
}

/** Antwort von GET /api/analyze-recession/trade-balance. value null = n/a, reason nennt den Grund. */
export interface TradeBalanceResponse {
  seriesId: string;
  source: string;
  value: TradeBalanceToGdp | null;
  reason: string | null;
}
