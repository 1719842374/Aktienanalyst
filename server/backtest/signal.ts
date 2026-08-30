/**
 * server/backtest/signal.ts — Phase 0 (Vertrag), WORK_SIGNAL_BACKTEST.md §9.
 *
 * deriveSignalV1() implementiert EXAKT die in §9 vorgeschriebene Regel:
 *
 *   if !dataComplete:           kein Signal
 *   if !dcfApplicable:          max Hold
 *   if invDcf != null && invDcf < price && kein Fiscal-Qualify:
 *                               Avoid  (oder Reduce, aber nicht Buy)
 *   if cappedBy in {PRICING_POWER, RELATIVE_GROWTH} und severity=hard:
 *                               kein Buy
 *   if CRV < 1.5:               Avoid
 *   if CRV < 2.0:               Hold
 *   if CRV < 2.5:               Accumulate
 *   else:                       Buy
 *
 * ABGRENZUNG ZUR LIVE-LOGIK (wichtig, siehe Ticket Punkt 2):
 * Die heutige Live-Summary (client/src/components/sections/SummarySection.tsx,
 * "Fazit"-Block) leitet KEIN Buy/Accumulate/Hold/Reduce/Avoid-Signal ab.
 * Sie berechnet statt dessen ein Punkte-Scoring (positive.length -
 * negative.length aus ~15 heuristischen Einzelfaktoren: P/E vs. Sektor,
 * Katalysatoren, PEG, DCF-Upside, CRV, Risk-Adjusted-CRV, RSL, Technik, Moat,
 * Monte Carlo, Reverse-DCF-Rating, Beta, FCF-Marge, PESTEL, Makro-Korrelation,
 * Analysten-PT) und mappt die Score-Differenz auf eine 5-stufige Text-Skala
 * ("STARK UNATTRAKTIV" .. "ATTRAKTIV"). Diese Skala ist NICHT die in §9
 * geforderte Signalregel (andere Stufen, andere Eingaben, kein CRV-Schwellen-
 * Raster 1.5/2.0/2.5, kein expliziter dcfApplicable/dataComplete-Gate-Schritt).
 *
 * Die serverseitige Scoring-Pipeline (scoring-gates.ts/scoring-integration.ts)
 * liefert bereits Score/Gates/cappedBy — aber KEIN invDcf-als-Preis, KEIN CRV,
 * KEIN dcfApplicable/dataComplete in der von §9 verlangten Form. Diese Felder
 * existieren bislang nur implizit/clientseitig (SummarySection.tsx berechnet
 * reverseDCF.impliedGrowth + calculateCRV() selbst, ohne sie an den Server
 * zurueckzugeben).
 *
 * ENTSCHEIDUNG (wie im Ticket vorgegeben, Regel "Live NICHT umbauen"):
 * deriveSignalV1() ist eine EIGENSTAENDIGE, NEUE Funktion nach der Spec-Regel
 * oben. Sie ruft AUSSCHLIESSLICH bereits vorhandene Scoring-Ergebnisse
 * (ScoringSnapshot-Felder, die ihrerseits aus runScoringPipeline() /
 * buildScoringForAnalysis() / calculateReverseDCF() / calculateCRV() stammen)
 * als Eingabe entgegen — sie berechnet NICHTS davon neu (kein zweites
 * Score-Modell, WORK_SIGNAL_BACKTEST.md §1 "Verbot: zweiter Backtest-Score").
 * Die Live-Fazit-Logik in SummarySection.tsx bleibt unveraendert bestehen.
 * Live-Summary und deriveSignalV1() laufen bewusst NEBENEINANDER, bis ein
 * spaeteres, separates Ticket (nicht Teil von Phase 0-1) entscheidet, ob/wie
 * die Live-UI auf signal_v1 umgestellt wird.
 */
import type { DataCompleteFlags, SignalV1 } from "./types";

/** Eingabe fuer deriveSignalV1() — alle Felder sind bereits vorhandene
 *  Scoring-Ergebnisse, keine Rohdaten. Siehe Datei-Kommentar oben. */
export interface DeriveSignalV1Input {
  dataComplete: DataCompleteFlags;
  dcfApplicable: boolean;
  /** Reverse-DCF-Fair-Value als Preis (nicht g*). null, wenn nicht berechenbar. */
  invDcf: number | null;
  price: number;
  /** true, wenn die Fiscal-Megatrend-Ausnahme qualifiziert UND materiell ist
   *  (runScoringPipeline().fiscalQualifiedAndMaterial) — §9 "kein Fiscal-
   *  Qualify" bedeutet: dieses Flag ist false. */
  fiscalQualifies: boolean;
  /** cappedBy-Gate-ID (z.B. "PRICING_POWER"), falls der Score gedeckelt wurde. */
  cappedBy: string | null;
  /** severity des cappedBy-Gates ("warn" | "hard"), falls cappedBy gesetzt ist. */
  cappedBySeverity: "warn" | "hard" | null;
  /** Chance-Risiko-Verhaeltnis (calculateCRV()-Ergebnis). null, wenn nicht
   *  berechenbar (z.B. worstCase >= price). */
  crv: number | null;
}

/** Gate-IDs, die laut §9 Zeile 4 ein Buy verhindern, wenn severity=hard.
 *  Benannte Konstante statt Inline-String-Vergleich — WORK_SIGNAL_BACKTEST.md
 *  §4 verlangt benannte Konstanten ohne Ticker-Bezug fuer Regel-Schwellen. */
export const NO_BUY_HARD_GATES: ReadonlySet<string> = new Set([
  "PRICING_POWER",
  "RELATIVE_GROWTH",
]);

/** CRV-Schwellen aus §9 — identisch zu den im Ticket genannten Skill/Template-
 *  Werten (>=2.5 attraktiv, 2.0-2.5 neutral, <2 Warnung, <1.5 Avoid). */
export const SIGNAL_V1_CRV_THRESHOLDS = {
  AVOID_BELOW: 1.5,
  HOLD_BELOW: 2.0,
  ACCUMULATE_BELOW: 2.5,
} as const;

/**
 * deriveSignalV1() — reine Funktion, keine Seiteneffekte, kein I/O.
 * Implementiert §9 Zeile fuer Zeile, in genau der dort vorgegebenen
 * Reihenfolge (fruehe Returns = strengere Regel gewinnt).
 */
export function deriveSignalV1(input: DeriveSignalV1Input): SignalV1 {
  // Zeile 1: "if !dataComplete: kein Signal"
  if (!input.dataComplete.overall) return null;

  // Zeile 2: "if !dcfApplicable: max Hold" — degradiert JEDES weitere
  // Ergebnis auf hoechstens Hold. Wir werten die restlichen Regeln trotzdem
  // aus (fuer die Avoid-Faelle, die STRENGER als Hold sind, siehe Zeile 3+4),
  // aber am Ende wird auf "houchstens Hold" gecappt.
  const dcfCapsToHold = !input.dcfApplicable;

  // Zeile 3: "if invDcf != null && invDcf < price && kein Fiscal-Qualify:
  //           Avoid (oder Reduce, aber nicht Buy)"
  // Spec erlaubt explizit Avoid ODER Reduce — wir waehlen Avoid als
  // strengere, eindeutige Variante (kein zusaetzliches Kriterium erfunden,
  // um zwischen Avoid/Reduce zu unterscheiden).
  if (
    input.invDcf != null &&
    input.invDcf < input.price &&
    !input.fiscalQualifies
  ) {
    return "Avoid";
  }

  // Zeile 4: "if cappedBy in {PRICING_POWER, RELATIVE_GROWTH} und
  //           severity=hard: kein Buy"
  const noBuyHardGate =
    input.cappedBy != null &&
    NO_BUY_HARD_GATES.has(input.cappedBy) &&
    input.cappedBySeverity === "hard";

  // Zeilen 5-8: CRV-Treppe. Fehlendes CRV faellt konservativ auf "kein
  // Signal" zurueck (§3.1: nur mit vollstaendigen Daten werten) — das ist
  // durch dataComplete.crv bereits am Anfang abgedeckt (dataComplete.overall
  // erfordert crv laut ScoringSnapshot-Vertrag), aber wir bleiben defensiv,
  // falls ein Aufrufer dataComplete falsch befuellt.
  if (input.crv == null) return null;

  let signal: SignalV1;
  if (input.crv < SIGNAL_V1_CRV_THRESHOLDS.AVOID_BELOW) {
    signal = "Avoid";
  } else if (input.crv < SIGNAL_V1_CRV_THRESHOLDS.HOLD_BELOW) {
    signal = "Hold";
  } else if (input.crv < SIGNAL_V1_CRV_THRESHOLDS.ACCUMULATE_BELOW) {
    signal = "Accumulate";
  } else {
    signal = "Buy";
  }

  // Zeile 4 anwenden: hartes Gate verhindert Buy → Deckel auf Accumulate.
  if (signal === "Buy" && noBuyHardGate) {
    signal = "Accumulate";
  }

  // Zeile 2 anwenden: !dcfApplicable deckelt auf hoechstens Hold.
  if (dcfCapsToHold && (signal === "Buy" || signal === "Accumulate")) {
    signal = "Hold";
  }

  return signal;
}
