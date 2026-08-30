/**
 * server/backtest/returns.ts — Sprint B3 Phase 3 (T1/T2 Cluster + Walk-Forward,
 * WORK_SIGNAL_BACKTEST.md §6.1 "Label" + §2.2 ("server/backtest/returns.ts —
 * Forward-Return T+1→T+h, Delist-Terminal") + Ticket Punkt 2.
 *
 * forwardReturn() implementiert EXAKT die in §6.1 vorgeschriebene Formel:
 *
 *   r_{i,T,h} = P_{i,T+1+h} / P_{i,T+1} - 1
 *
 * Embargo: Close an T selbst darf NICHT gleichzeitig in Feature (Signal an T)
 * UND Label (Return-Berechnung) verwendet werden — deshalb ist der Einstiegs-
 * preis STRIKT der erste Handelstag NACH T (P_{T+1}), nicht P_T selbst.
 *
 * Bei Delisting im Fenster (T, T+h]: terminalReturn() aus Phase 2 (pit.ts)
 * wird verwendet statt Drop oder r=0 (§5.3, Ticket Punkt 2 letzter Satz).
 *
 * Reine Funktionen, kein I/O hier — der Aufrufer (Feasibility-Runner,
 * script/*) liefert bereits geladene Kursreihen an. Das haelt diese Datei
 * testbar ohne Netzwerk-Mocks (analog cluster.ts/walkforward.ts unten).
 */
import { terminalReturn, type TerminalReturnResult } from "./pit";

/** Eine Kurszeile, wie sie fmpHistoricalPrices() liefert (Teilmenge der
 *  Felder, die forwardReturn() tatsaechlich braucht). */
export interface PriceRow {
  date: string; // ISO yyyy-mm-dd
  close: number;
}

export interface ForwardReturnInput {
  ticker: string;
  /** Analyse-/Signal-Datum T (asOf). */
  asOf: string;
  /** Handelstage-Horizont h (§4.2: 21/63/126/252). */
  horizonDays: number;
  /** Vollstaendige verfuegbare Kurshistorie fuer den Ticker — muss Daten
   *  > asOf enthalten, um P_{T+1} und P_{T+1+h} zu bestimmen. Reihenfolge
   *  beliebig (wird intern sortiert), aber jede Zeile braucht date+close. */
  prices: PriceRow[];
  /** Delisting-Info (§5.3) — wenn gesetzt und im Fenster (T, T+h], wird
   *  terminalReturn() statt der regulaeren Preisformel verwendet. */
  delistedDate?: string | null;
  /** Fuer terminalReturn() im Delisting-Fall: letzter beobachtbarer Kurs
   *  vor/am Delisting (falls bekannt) und optionaler Cash-Angebotspreis. */
  lastTradableClose?: number | null;
  cashOfferPrice?: number | null;
}

export type ForwardReturnMethod = "regular" | "terminal";

export interface ForwardReturnResult {
  ticker: string;
  asOf: string;
  horizonDays: number;
  /** r_{i,T,h}, in Dezimal (0.05 = +5%). null nur wenn selbst P_{T+1} fehlt
   *  (kein Embargo-Preis verfuegbar) — Zahlen-Prinzip: kein Raten. */
  r: number | null;
  method: ForwardReturnMethod;
  pEntry: number | null; // P_{T+1}
  pExit: number | null; // P_{T+1+h} (regulaerer Fall) oder null (Terminal-Fall)
  entryDate: string | null;
  exitDate: string | null;
  /** Terminal-Details, nur gesetzt wenn method === "terminal". */
  terminal: TerminalReturnResult | null;
  note: string;
}

/**
 * Findet den aeltesten Handelstag STRIKT NACH `asOf` (Embargo T+1, §4.2) in
 * einer bereits nach Datum aufsteigend sortierten Preisliste.
 */
function findEntry(sortedAsc: PriceRow[], asOf: string): PriceRow | null {
  const after = sortedAsc.find(p => p.date > asOf);
  return after ?? null;
}

/**
 * Findet den Handelstag mit dem `n`-ten Index NACH dem Einstiegstag
 * (Handelstage-Zaehlung, nicht Kalendertage — §4.2 "Handelstage"). Index 0
 * waere der Einstiegstag selbst; wir wollen den Tag `horizonDays` Handelstage
 * NACH dem Einstieg (T+1+h relativ zu T, siehe §6.1-Formel: Zaehlung startet
 * bei P_{T+1}, additiv h Handelstage weiter).
 */
function findExitByTradingDays(sortedAsc: PriceRow[], entryIndex: number, horizonDays: number): PriceRow | null {
  const exitIndex = entryIndex + horizonDays;
  if (exitIndex >= sortedAsc.length) return null;
  return sortedAsc[exitIndex];
}

/**
 * forwardReturn() — WORK_SIGNAL_BACKTEST.md §6.1.
 *
 * Ablauf:
 *   1. P_{T+1} = aeltester Preis STRIKT nach asOf (Embargo).
 *   2. Wenn Delisting in (T, T+h] bekannt ist (delistedDate gesetzt UND
 *      delistedDate > asOf UND delistedDate <= T+h-Fenster gemaess den
 *      verfuegbaren Kursdaten): terminalReturn() statt regulaerer Formel.
 *   3. Sonst: P_{T+1+h} = `horizonDays` Handelstage nach P_{T+1}; wenn diese
 *      Zeile in den Daten fehlt (Kurshistorie zu kurz), aber KEIN Delisting
 *      bekannt ist, wird ebenfalls konservativ terminalReturn() mit dem
 *      letzten verfuegbaren Kurs versucht (kein Drop, kein r=0, §5.3) —
 *      das deckt sowohl "echtes Delisting" als auch "Datenhistorie endet
 *      vor Horizont-Ende" (z.B. Ticker erst juengst gelistet) gleich ab.
 */
export function forwardReturn(input: ForwardReturnInput): ForwardReturnResult {
  const sortedAsc = [...input.prices]
    .filter(p => p?.date && typeof p?.close === "number" && isFinite(p.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  const entry = findEntry(sortedAsc, input.asOf);
  if (!entry) {
    return {
      ticker: input.ticker,
      asOf: input.asOf,
      horizonDays: input.horizonDays,
      r: null,
      method: "regular",
      pEntry: null,
      pExit: null,
      entryDate: null,
      exitDate: null,
      terminal: null,
      note: "Kein Handelstag nach asOf verfuegbar (P_{T+1} fehlt) — kein Embargo-Einstiegspreis, r=null (kein Raten).",
    };
  }
  const entryIndex = sortedAsc.indexOf(entry);

  const isKnownDelisted =
    input.delistedDate != null && input.delistedDate > input.asOf;

  const exit = findExitByTradingDays(sortedAsc, entryIndex, input.horizonDays);

  if (exit && !isKnownDelisted) {
    const r = exit.close / entry.close - 1;
    return {
      ticker: input.ticker,
      asOf: input.asOf,
      horizonDays: input.horizonDays,
      r,
      method: "regular",
      pEntry: entry.close,
      pExit: exit.close,
      entryDate: entry.date,
      exitDate: exit.date,
      terminal: null,
      note: "Regulaere Forward-Return-Formel: P_{T+1+h}/P_{T+1} - 1.",
    };
  }

  // Delisting bekannt ODER Kurshistorie endet vor Horizont-Ende (h-Tage nach
  // Einstieg nicht erreichbar) — §5.3 Terminal-Return statt Drop/r=0.
  const pLastCandidate = input.lastTradableClose ?? sortedAsc[sortedAsc.length - 1]?.close ?? null;
  const term = terminalReturn({
    pEntry: entry.close,
    pLast: pLastCandidate,
    cashOfferPrice: input.cashOfferPrice ?? null,
  });

  return {
    ticker: input.ticker,
    asOf: input.asOf,
    horizonDays: input.horizonDays,
    r: term.r,
    method: "terminal",
    pEntry: entry.close,
    pExit: null,
    entryDate: entry.date,
    exitDate: null,
    terminal: term,
    note: isKnownDelisted
      ? `Delisting im Fenster (T, T+h] bekannt (delistedDate=${input.delistedDate}) — Terminal-Return statt Drop/r=0.`
      : "Kurshistorie endet vor Horizont-Ende (kein bekanntes Delisting, aber Daten reichen nicht bis T+1+h) — konservativ Terminal-Return mit letztem verfuegbaren Kurs statt Drop/r=0.",
  };
}

/** Batch-Convenience: forwardReturn() fuer mehrere (ticker, asOf)-Paare mit
 *  bereits geladenen Preisreihen — Aufrufer (Feasibility-Runner) haelt die
 *  Netzwerk-/Cache-Logik selbst, diese Funktion bleibt reine Berechnung. */
export function forwardReturnsBatch(
  inputs: ForwardReturnInput[]
): ForwardReturnResult[] {
  return inputs.map(forwardReturn);
}
