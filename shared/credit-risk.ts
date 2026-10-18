/**
 * Kreditrisiko-Karte in Sektion 10 „Risikoinversion“ (Future_SOLL_IST_DETAIL_35ead515 F1-21 mit F1-20).
 *
 * Markt-Ebene: ausschließlich FRED BAA10Y über die bestehende Route /api/credit-spread/market
 * (server/credit-route.ts, #253; Typen CreditSpreadResponse in shared/schema.ts, Logik in shared/credit.ts).
 * Unternehmens-Ebene (F1-20): Verschuldung/Eigenkapital aus dem bestehenden Analyse-Payload
 * (financialStatements.balanceSheet, FMP), Zinsdeckung aus der FMP-Gewinn- und Verlustrechnung über
 * GET /api/credit-risk/company/:ticker (server/credit-risk-route.ts → server/fmp.ts fmpIncomeStatement).
 * Kein CDS, keine Emittenten-Anleihe, kein Rating (⛔, Philip 18.10.: Credit nur über BAA10Y).
 * Reine Anzeige: geht NICHT in Score, Rating, Expected Damage oder Zielkurs. Fehlt ein Wert → null (n/a).
 */

/** Antwort von GET /api/credit-risk/company/:ticker. Alle Kennzahlen null = n/a, nie ein Ersatzwert. */
export interface CompanyCreditMetricsResponse {
  ticker: string;
  source: string;
  /** Bilanzstichtag der verwendeten Jahres-GuV (FMP `date`), sonst null. */
  fiscalDate: string | null;
  fiscalYear: string | null;
  reportedCurrency: string | null;
  operatingIncome: number | null;
  interestExpense: number | null;
  /** Operating Income (EBIT) / Zinsaufwand, als Faktor (x). */
  interestCoverage: number | null;
  /** Grund für n/a oder Hinweis zur Datenlage; null, wenn alles da ist. */
  note: string | null;
}

export const COMPANY_CREDIT_SOURCE = "FMP income-statement (letztes Geschäftsjahr)";
export const COVERAGE_FORMULA = "Zinsdeckung = Operating Income (EBIT) ÷ Zinsaufwand";
export const DE_FORMULA = "Verschuldung/Eigenkapital = Total Debt ÷ Total Equity";
export const CREDIT_CARD_NO_SCORE = "Nur Anzeige – kein Einfluss auf Score, Rating, Expected Damage oder Zielkurs.";
export const CREDIT_CARD_EXPECTED_DAMAGE_NOTE =
  "Expected Damage für Credit: nicht eingerechnet – ein Credit-Risiko mit EW%/Impact% würde Total Expected Damage, Risk-Adjusted Target und Inverted DCF verändern (braucht Philip).";
export const CREDIT_CARD_ISSUER_NA = "CDS 5J, längste Anleihe-Rendite, Rating: n/a – Emittenten-Daten nur über kostenpflichtige Quellen (nicht freigegeben; Credit nur über BAA10Y).";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Leere Antwort mit Begründung (alle Kennzahlen n/a). */
export function emptyCompanyCredit(ticker: string, note: string): CompanyCreditMetricsResponse {
  return {
    ticker, source: COMPANY_CREDIT_SOURCE, fiscalDate: null, fiscalYear: null, reportedCurrency: null,
    operatingIncome: null, interestExpense: null, interestCoverage: null, note,
  };
}

/**
 * Zinsdeckung aus der neuesten FMP-Jahres-GuV (Antwort von fmpIncomeStatement, neueste Zeile zuerst).
 * Zinsaufwand fehlt oder 0 → Zinsdeckung n/a (keine Division, kein Ersatzwert). Vorzeichen des Zinsaufwands
 * ist zwischen Filern uneinheitlich → Betrag. Negatives Operating Income bleibt negativ (echte Unterdeckung).
 */
export function companyCreditFromIncome(ticker: string, rows: unknown): CompanyCreditMetricsResponse {
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || typeof row !== "object") return emptyCompanyCredit(ticker, "FMP ohne Gewinn- und Verlustrechnung");
  const r = row as Record<string, unknown>;
  const operatingIncome = num(r.operatingIncome);
  const ieRaw = num(r.interestExpense);
  const interestExpense = ieRaw == null ? null : Math.abs(ieRaw);
  let interestCoverage: number | null = null;
  let note: string | null = null;
  if (operatingIncome == null) note = "Operating Income fehlt in der FMP-GuV";
  else if (interestExpense == null) note = "Zinsaufwand fehlt in der FMP-GuV";
  else if (interestExpense === 0) note = "kein Zinsaufwand ausgewiesen";
  else interestCoverage = operatingIncome / interestExpense;
  return {
    ticker,
    source: COMPANY_CREDIT_SOURCE,
    fiscalDate: typeof r.date === "string" ? r.date : null,
    fiscalYear: r.fiscalYear != null ? String(r.fiscalYear) : null,
    reportedCurrency: typeof r.reportedCurrency === "string" ? r.reportedCurrency : null,
    operatingIncome,
    interestExpense,
    interestCoverage,
    note,
  };
}

/**
 * Verschuldung/Eigenkapital aus dem bestehenden Analyse-Payload. analyze-route setzt debtToEquity = 0, wenn das
 * Eigenkapital ≤ 0 ist – das ist kein Messwert, daher hier n/a. Fehlt die Bilanz → n/a.
 */
export function debtToEquityOf(
  bs: { totalEquity?: number; totalDebt?: number; debtToEquity?: number } | null | undefined,
): { value: number | null; note: string | null } {
  if (!bs) return { value: null, note: "keine Bilanzdaten im Analyse-Ergebnis" };
  const eq = num(bs.totalEquity);
  if (eq == null || eq <= 0) return { value: null, note: "Eigenkapital ≤ 0 oder fehlt" };
  const de = num(bs.debtToEquity);
  return de == null ? { value: null, note: "Verschuldung/Eigenkapital fehlt" } : { value: de, note: null };
}
