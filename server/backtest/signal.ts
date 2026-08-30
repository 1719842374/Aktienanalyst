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
 * liefert bereits Score/Gates/cappedBy. invDcf/CRV/dcfApplicable kommen seit
 * Sprint B3 Phase 1b ECHT aus server/analyze-route.ts (ueber
 * shared/valuation-signal.ts, siehe dortiger Datei-Kommentar) statt vorher
 * `null` zu sein.
 *
 * SPRINT B3 PHASE 1b (Ticket: tickets/SPRINT_B3_PHASE1B_SHARED_CRV.md):
 * Die Regel selbst (§9) ist jetzt in shared/valuation-signal.ts als
 * signalV1() die KANONISCHE, EINZIGE Implementierung — EIN Modul, KEINE
 * zweite Regel-Kopie. deriveSignalV1() hier ist nur noch ein duenner
 * Re-Export-Wrapper, der den bisherigen Namen/Signatur/Import-Pfad
 * (`from "./backtest/signal"` / `from "../server/backtest/signal"`) fuer
 * bestehende Aufrufer (server/analyze-route.ts, script/test-backtest-replay-
 * parity.ts) unveraendert erhaelt.
 *
 * ENTSCHEIDUNG (wie im Ticket vorgegeben, Regel "Live NICHT umbauen"):
 * deriveSignalV1()/signalV1() ruft AUSSCHLIESSLICH bereits vorhandene
 * Scoring-Ergebnisse (ScoringSnapshot-Felder, die ihrerseits aus
 * runScoringPipeline() / buildScoringForAnalysis() / calculateReverseDCF() /
 * calculateCRV() stammen) als Eingabe entgegen — sie berechnet NICHTS davon
 * neu (kein zweites Score-Modell, WORK_SIGNAL_BACKTEST.md §1 "Verbot:
 * zweiter Backtest-Score"). Die Live-Fazit-Logik in SummarySection.tsx
 * bleibt unveraendert bestehen. Live-Summary und deriveSignalV1() laufen
 * bewusst NEBENEINANDER, bis ein spaeteres, separates Ticket (nicht Teil von
 * Phase 0-1) entscheidet, ob/wie die Live-UI auf signal_v1 umgestellt wird.
 */
import {
  signalV1,
  NO_BUY_HARD_GATES,
  SIGNAL_V1_CRV_THRESHOLDS,
  type SignalV1Input,
} from "../../shared/valuation-signal";

export { NO_BUY_HARD_GATES, SIGNAL_V1_CRV_THRESHOLDS };

/** Eingabe fuer deriveSignalV1() — alle Felder sind bereits vorhandene
 *  Scoring-Ergebnisse, keine Rohdaten. Siehe Datei-Kommentar oben.
 *  Identisch zu shared/valuation-signal.ts SignalV1Input — hier als Alias
 *  re-exportiert, damit bestehende Importe (`DeriveSignalV1Input`) nicht
 *  angepasst werden muessen. */
export type DeriveSignalV1Input = SignalV1Input;

/**
 * deriveSignalV1() — reine Funktion, keine Seiteneffekte, kein I/O.
 * Duenner Wrapper um shared/valuation-signal.ts:signalV1() (§9-Regel,
 * kanonische Implementierung — siehe Datei-Kommentar oben).
 */
export function deriveSignalV1(input: DeriveSignalV1Input) {
  return signalV1(input);
}
