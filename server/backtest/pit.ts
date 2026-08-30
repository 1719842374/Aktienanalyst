/**
 * server/backtest/pit.ts — Sprint B3 Phase 2 (PIT-Universum,
 * WORK_SIGNAL_BACKTEST.md §5 + §2.2 "server/backtest/pit.ts — Filing-as-of
 * Join, Cap_T, Terminal-Return").
 *
 * Drei fachlich getrennte Bausteine, alle reine Funktionen (kein LLM, kein
 * Ticker-Hardcode):
 *   1. filingAsOfIncomeStatement() — §3.1 "Quartals-/Jahreszahlen erst nach
 *      Report-/Filing-Date ≤ T (nicht FY-End)".
 *   2. terminalReturn() — §5.3 Terminal-Return bei Delisting.
 *   3. coverageT() / biasGap() — §5.4 Coverage-Quote, §5.5 Bias-Gap.
 */
import { fmpIncomeStatementQuarterly, fmpHistoricalPrices } from "../fmp";
import { inUniverse, type UniverseMode, type ConstituentChangeRow, type DelistedCompanyRow } from "./universe";

// ============================================================
// 1. Filing-as-of Join (§3.1)
// ============================================================

/** Eine Quartalszeile aus /stable/income-statement?period=quarter, reduziert
 *  auf die fuer den PIT-Join relevanten Felder (Rest bleibt additiv `raw`). */
export interface QuarterlyFilingRow {
  date: string; // Periodenende (FY-End des Quartals) — NICHT fuer PIT-Filter nutzen
  filingDate: string | null; // tatsaechliches Einreichungsdatum — PIT-Filter hierauf
  fiscalYear: string;
  period: string; // "Q1".."Q4"
  raw: any; // vollstaendige FMP-Zeile, additiv fuer Aufrufer, die mehr Felder brauchen
}

export interface FilingAsOfResult {
  /** Die zuletzt VOR/AN `asOf` gefilte Quartalszeile, oder null wenn keine
   *  existiert (z.B. Ticker hat vor `asOf` noch nicht berichtet). */
  row: QuarterlyFilingRow | null;
  /** false, wenn kein `filingDate` auf der gewaehlten Zeile vorhanden war
   *  (FMP liefert das Feld i.d.R. immer, aber Zahlen-Prinzip: nicht rein
   *  auf `date` (Periodenende) ausweichen, wenn filingDate fehlt — dann
   *  gilt der Join als unvollstaendig). */
  dataComplete: boolean;
}

/**
 * filingAsOfIncomeStatement() — holt die letzten `lookbackQuarters`
 * Quartalszeilen (newest-first von FMP) und waehlt die juengste Zeile mit
 * `filingDate <= asOf`. Verwendet AUSDRUECKLICH `filingDate`, nicht `date`
 * (Periodenende) — §3.1 "nicht FY-End". Wenn eine Zeile kein `filingDate`
 * hat, wird sie NICHT als Fallback auf `date` akzeptiert (das waere ein
 * Blick in die Zukunft relativ zur echten Publikation) — stattdessen wird
 * sie uebersprungen und, falls dadurch keine Zeile mehr uebrig bleibt,
 * `dataComplete=false` zurueckgegeben.
 */
export async function filingAsOfIncomeStatement(
  ticker: string,
  asOf: string,
  lookbackQuarters = 24
): Promise<FilingAsOfResult> {
  let rows: any[];
  try {
    rows = await fmpIncomeStatementQuarterly(ticker, lookbackQuarters);
  } catch {
    return { row: null, dataComplete: false };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { row: null, dataComplete: false };

  // newest-first (FMP-Konvention, siehe server/fmp.ts Kommentar bei
  // fmpIncomeStatementQuarterly) — erste Zeile mit gueltigem filingDate <=
  // asOf ist automatisch die JUENGSTE solche Zeile.
  for (const r of rows) {
    const filingDate: string | undefined = r?.filingDate;
    if (!filingDate) continue; // kein Filing-Datum -> nicht PIT-verwertbar, naechste (aeltere) Zeile pruefen
    if (filingDate <= asOf) {
      return {
        row: {
          date: r.date,
          filingDate,
          fiscalYear: r.fiscalYear,
          period: r.period,
          raw: r,
        },
        dataComplete: true,
      };
    }
  }
  return { row: null, dataComplete: false };
}

// ============================================================
// 2. Terminal-Return bei Delisting (§5.3)
// ============================================================

export type TerminalReturnMethod = "cash_ma_offer" | "last_tradable_close" | "insolvency_range";

export interface TerminalReturnResult {
  method: TerminalReturnMethod;
  /** Terminal-Return r_term. Bei method="insolvency_range" ist dies der
   *  MITTELWERT des dokumentierten Bereichs [-1.0, -0.8] (-0.9) — der volle
   *  Bereich steht zusaetzlich in `range` fuer Aufrufer, die die Bandbreite
   *  statt eines Punktschaetzers brauchen. */
  r: number;
  range: [number, number] | null;
  /** Kein Drop: dieses Objekt wird IMMER zurueckgegeben (nie null), auch
   *  wenn keine Kursdaten verfuegbar sind — dann greift insolvency_range. */
  note: string;
}

/**
 * terminalReturn() — WORK_SIGNAL_BACKTEST.md §5.3:
 *   r_term = Offer/P_{T+1}-1        Cash-M&A (wenn FMP einen Angebotspreis
 *                                    liefert — aktuell KEIN eigenes FMP-Feld
 *                                    dafuer verifiziert, daher optionaler
 *                                    `cashOfferPrice`-Parameter, den ein
 *                                    Aufrufer aus einer anderen Quelle
 *                                    (z.B. Katalysator-Text/8-K) uebergeben
 *                                    kann; ohne diesen Parameter wird NICHT
 *                                    geraten)
 *          = P_last/P_{T+1}-1       letzter handelbarer Close (Standardfall)
 *          = [-1.0, -0.8]           Insolvenz/Pennystock (dokumentierter
 *                                    Bereich, wenn keine Kursdaten mehr
 *                                    existieren)
 *
 * Kein Drop, kein r=0 — diese Funktion liefert in JEDEM Fall ein Ergebnis.
 * `pEntry` = P_{T+1} (Einstiegspreis unmittelbar nach dem Analyse-Tag T,
 * Embargo T+1 gemaess §4.2).
 */
export function terminalReturn(params: {
  pEntry: number | null;
  pLast: number | null; // letzter beobachtbarer Handelskurs vor/am Delisting
  cashOfferPrice?: number | null; // nur wenn eine Cash-M&A-Quelle das liefert
}): TerminalReturnResult {
  const { pEntry, pLast, cashOfferPrice } = params;

  if (cashOfferPrice != null && pEntry != null && pEntry > 0) {
    return {
      method: "cash_ma_offer",
      r: cashOfferPrice / pEntry - 1,
      range: null,
      note: "Cash-M&A-Angebotspreis vorhanden — r_term = Offer/P_{T+1} - 1",
    };
  }

  if (pLast != null && pEntry != null && pEntry > 0) {
    return {
      method: "last_tradable_close",
      r: pLast / pEntry - 1,
      range: null,
      note: "Kein Cash-Angebotspreis bekannt — letzter handelbarer Close verwendet (P_last/P_{T+1} - 1)",
    };
  }

  // Weder Angebotspreis noch beobachtbarer letzter Kurs -> dokumentierter
  // Range fuer Insolvenz/Pennystock-Fall (§5.3), kein Raten eines Punktwerts
  // ausserhalb dieses Bereichs.
  const range: [number, number] = [-1.0, -0.8];
  return {
    method: "insolvency_range",
    r: (range[0] + range[1]) / 2,
    range,
    note: "Keine Kursdaten fuer Terminal-Event verfuegbar — dokumentierter Insolvenz/Pennystock-Bereich [-1.0, -0.8] verwendet, Mittelwert als Punktschaetzer",
  };
}

/**
 * resolveTerminalReturnFromFmp() — Convenience-Wrapper: holt P_{T+1} und den
 * letzten verfuegbaren Kurs nach `asOf` selbst aus
 * /stable/historical-price-eod/full und ruft terminalReturn() auf. Sucht in
 * einem Fenster von `searchWindowDays` nach `asOf` nach Kursdaten; findet es
 * keine, greift der Insolvenz/Pennystock-Fall.
 */
export async function resolveTerminalReturnFromFmp(
  ticker: string,
  asOf: string,
  searchWindowDays = 30,
  cashOfferPrice?: number | null
): Promise<TerminalReturnResult> {
  const from = asOf;
  const toDate = new Date(asOf + "T00:00:00Z");
  toDate.setUTCDate(toDate.getUTCDate() + searchWindowDays);
  const to = toDate.toISOString().slice(0, 10);

  let rows: any[] = [];
  try {
    rows = await fmpHistoricalPrices(ticker, from, to);
  } catch {
    rows = [];
  }
  // newest-first laut FMP-Konvention (siehe fmpHistoricalPrices-Kommentar).
  const sorted = [...rows].filter(r => r?.date && typeof r?.close === "number").sort((a, b) => b.date.localeCompare(a.date));

  // P_{T+1}: aeltester Eintrag STRIKT NACH asOf (Embargo T+1, §4.2).
  const afterAsOf = sorted.filter(r => r.date > asOf).sort((a, b) => a.date.localeCompare(b.date));
  const pEntry = afterAsOf.length > 0 ? afterAsOf[0].close : null;

  // P_last: juengster verfuegbarer Kurs im Fenster (letzter handelbarer Close).
  const pLast = sorted.length > 0 ? sorted[0].close : null;

  return terminalReturn({ pEntry, pLast, cashOfferPrice });
}

// ============================================================
// 3. Coverage-Quote (§5.4) + Bias-Gap (§5.5)
// ============================================================

export interface CoverageResult {
  month: string; // yyyy-mm, fuer welchen Monat coverage_T berechnet wurde
  asOf: string; // konkretes Snapshot-Datum innerhalb des Monats
  nUniverse: number; // #U_corr(T)
  nDataComplete: number; // #{i in U_corr(T): dataComplete}
  coverage: number | null; // nDataComplete / nUniverse, null wenn nUniverse=0 (kein Divide-by-zero-Raten)
}

/**
 * coverageT() — WORK_SIGNAL_BACKTEST.md §5.4:
 *   coverage_T = #{i in U_corr(T): dataComplete} / #U_corr(T)
 *
 * Nimmt eine bereits berechnete Liste von inUniverse()-Ergebnissen fuer
 * mode="corr" entgegen (Aufrufer entscheidet, welches Ticker-Set geprueft
 * wird — z.B. das Laboruniversum S&P 500) und zaehlt aus. Reine
 * Aggregationsfunktion, kein I/O.
 */
export function coverageT(
  month: string,
  asOf: string,
  corrResults: Array<{ inUniverse: boolean; dataComplete: boolean }>
): CoverageResult {
  const universeMembers = corrResults.filter(r => r.inUniverse);
  const nUniverse = universeMembers.length;
  const nDataComplete = universeMembers.filter(r => r.dataComplete).length;
  return {
    month,
    asOf,
    nUniverse,
    nDataComplete,
    coverage: nUniverse > 0 ? nDataComplete / nUniverse : null,
  };
}

export interface BiasGapResult {
  gap: number;
  interpretation: string;
}

/**
 * biasGap() — WORK_SIGNAL_BACKTEST.md §5.5:
 *   Gap = Δ_6M_naive - Δ_6M_corr
 *
 * Reine Hilfsfunktion (Ticket Punkt 5: "wird erst in Phase 3 tatsaechlich
 * mit echten Deltas gefuettert, hier nur die Funktion selbst bauen"). Nimmt
 * bereits berechnete Delta-Werte (z.B. Median-Forward-Return ueber ein
 * Ticker-Set) entgegen — berechnet selbst KEINE Returns.
 */
export function biasGap(deltaNaive: number, deltaCorr: number): BiasGapResult {
  const gap = deltaNaive - deltaCorr;
  const interpretation =
    gap > 0
      ? "Gap > 0: Survivor-only (naive) hat das Ergebnis zu guenstig gerechnet — corr ist die verlaesslichere Pitch-Zahl"
      : gap < 0
        ? "Gap < 0: naive unterschaetzt corr (unueblich, gegen Survivorship-Erwartung) — Datenlage pruefen"
        : "Gap = 0: kein messbarer Survivorship-Effekt in dieser Stichprobe";
  return { gap, interpretation };
}

// Re-Export, damit Aufrufer von pit.ts nicht zusaetzlich aus universe.ts
// importieren muessen, wenn sie nur den Typ brauchen (additiv, keine
// Struktur-Aenderung an universe.ts).
export type { UniverseMode, ConstituentChangeRow, DelistedCompanyRow };
export { inUniverse };
