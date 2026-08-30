/**
 * server/backtest/replay.ts — Phase 1 (Snapshot + Parity),
 * WORK_SIGNAL_BACKTEST.md §2.2 ("server/backtest/replay.ts —
 * replayAt(ticker, asOf, pit) -> ScoringSnapshot") + Ticket Phase 1 Punkt 2.
 *
 * replayAt() ist reine Wiederverwendung bestehender Scoring-Funktionen:
 *   buildScoringForAnalysis() (scoring-integration.ts) -> Score/Gates/cappedBy
 * Es wird HIER NICHTS neu berechnet oder kopiert — replayAt() nimmt exakt
 * denselben Eingabe-Kontext entgegen, den analyze-route.ts an
 * buildScoringForAnalysis() uebergibt, und reicht ihn 1:1 durch.
 *
 * SCOPE-EINSCHRAENKUNG (bewusst, siehe Ticket-Akzeptanzkriterium):
 * "replay(ticker, today) === live scoring fields (Score, gates, cappedBy)"
 * -- das ist der Pflichtumfang von Phase 1. invDcf/CRV/worstCase existieren
 * HEUTE NUR clientseitig (client/src/lib/calculations.ts calculateReverseDCF/
 * calculateCRV/worstCaseM1-3, aufgerufen in SummarySection.tsx) und werden
 * dem Server nie zurueckgemeldet. Sie server-seitig NEU zu berechnen wuerde
 * bedeuten, eine ZWEITE Implementierung dieser Formeln zu bauen (Risiko:
 * Drift, genau das Muster, an dem calcRealizedGrowth8QServer bereits durch
 * einen expliziten Parity-Test gegen die Client-Formel abgesichert ist).
 * Das ist NICHT Teil dieses Tickets (Phase 0+1) — siehe Bericht an Phase 2
 * unten in ScoringSnapshot.invDcf/crv: bleiben `null` mit
 * dataComplete.invDcf=false/crv=false, wenn kein Wert übergeben wurde.
 * `replayAt()` akzeptiert invDcf/crv daher als OPTIONALE, vom Aufrufer
 * bereits extern berechnete Werte (z.B. wenn ein spaeterer Client-Call sie
 * mitliefert) — es erfindet sie nicht selbst.
 *
 * dcfApplicable (§3.3 Klassensperre) wird HIER aus Sektor/Industry UND
 * FCF_T > 0 abgeleitet — das ist keine neue Scoring-Formel, sondern eine
 * reine Boolean-Klassifikationsregel exakt nach Spec §3.3, ohne
 * Ticker-Hardcodes (Sektor-/Industry-String-Vergleich, adaptiv).
 *
 * SPRINT B3 PHASE 1b (Ticket: tickets/SPRINT_B3_PHASE1B_SHARED_CRV.md):
 * Der obige SCOPE-EINSCHRAENKUNG-Absatz galt fuer Phase 0+1. Seit Phase 1b
 * berechnet server/analyze-route.ts invDcf/crv jetzt SERVERSEITIG — ueber
 * dieselben reinen Funktionen wie der Client (shared/valuation-signal.ts:
 * buildDefaultDCFParams/calculateFCFFDCF/worstCaseM1-3/calculateCRV), nicht
 * ueber eine zweite Formel-Implementierung. replayAt() selbst bleibt
 * UNVERAENDERT ein reiner Durchreicher: es nimmt invDcf/crv (und die
 * zugehoerigen T-Rohwerte fuer ScoringSnapshot) weiterhin als vom Aufrufer
 * BEREITS BERECHNETE, optionale Werte entgegen — nur der Aufrufer
 * (analyze-route.ts) hat sich geaendert: er liefert jetzt echte Werte statt
 * `undefined`/`null`. computeDcfApplicable() delegiert an die kanonische
 * shared/valuation-signal.ts:dcfApplicable() (kein zweites Regel-Set).
 */
import {
  buildScoringForAnalysis,
  type AnalysisScoringContext,
} from "../scoring-integration";
import { dcfApplicable as sharedDcfApplicable } from "../../shared/valuation-signal";
import type { ScoringSnapshot, DataCompleteFlags } from "./types";

/**
 * §3.3 dcfApplicable = FCF_T > 0 AND sector NOT IN {Banks, Insurance,
 * Capital Markets-als-Bank-Proxy} AND profile erlaubt FCF-DCF.
 * Duenner Wrapper um die kanonische shared/valuation-signal.ts:dcfApplicable()
 * — erhaelt den bisherigen Funktionsnamen/Signatur fuer bestehende Aufrufer
 * (analyze-route.ts, script/test-backtest-replay-parity.ts).
 */
export function computeDcfApplicable(params: {
  fcfTTM: number | null | undefined;
  sector: string | undefined;
  industry: string | undefined;
}): boolean {
  return sharedDcfApplicable(params);
}

export interface ReplayAtInput {
  ticker: string;
  asOf: string;
  /** Identischer Kontext wie buildScoringForAnalysis({ ctx, ... }) in
   *  analyze-route.ts — reine Weiterreichung, keine Neuberechnung. */
  ctx: AnalysisScoringContext;
  health: string | undefined;
  moatRating: string | undefined;
  technicalIndicators: { priceAboveMA200?: boolean; ma50AboveMA200?: boolean } | null | undefined;
  catalysts: Parameters<typeof buildScoringForAnalysis>[0]["catalysts"];
  price: number;
  /** Fuer dcfApplicable (§3.3) — bereits vorhandene Analyse-Rohdaten. */
  fcfTTM: number | null | undefined;
  sector: string | undefined;
  industry: string | undefined;
  /** Optional, extern bereits berechnet (siehe Datei-Kommentar oben) — Phase
   *  0+1 baut hierfuer KEINE eigene Formel. null/undefined => dataComplete
   *  markiert das Feld als fehlend, deriveSignalV1 liefert dann null. */
  invDcf?: number | null;
  crv?: number | null;
  /** Additiv seit Phase 1b-Praezisierung (30.08.2026): gehaertete Fair-
   *  Value/Worst-Case-Werte (`computeHardenedCRV().fvHardened`/`wcUsed`),
   *  Zaehler/Nenner-Basis von `crv` oben. Reine Weiterreichung wie invDcf/
   *  crv — replayAt() berechnet hier nichts neu. */
  fv?: number | null;
  wc?: number | null;
  /** Additive Rohdaten-Inputs "at T" (Sprint B3 Phase 1b, ScoringSnapshot.
   *  fcf_T/wacc_T/g_T/P_T/WC_T/D_minus) — rein informativ fuer Phase 2+,
   *  keine Pflichtangabe. Werden vom Aufrufer (analyze-route.ts) bereits
   *  berechnet uebergeben, genau wie invDcf/crv oben — replayAt() leitet
   *  hier nichts neu ab. */
  fcf_T?: number | null;
  wacc_T?: number | null;
  g_T?: number | null;
  WC_T?: number | null;
}

/**
 * replayAt() — ruft AUSSCHLIESSLICH buildScoringForAnalysis() auf (die
 * ihrerseits runScoringPipeline()/deriveGateInputs() aufruft) und formt das
 * Ergebnis in die additive ScoringSnapshot-Form (types.ts). Fuer asOf=heute
 * mit identischem ctx/price/catalysts MUSS das Ergebnis bitgleich mit der
 * Live-Analyze-Pipeline sein, weil es dieselbe Funktion mit denselben
 * Eingaben aufruft — kein zweiter Pfad, kein zweites Modell.
 */
export function replayAt(input: ReplayAtInput): ScoringSnapshot {
  const scoring = buildScoringForAnalysis({
    ctx: input.ctx,
    health: input.health,
    moatRating: input.moatRating,
    technicalIndicators: input.technicalIndicators,
    catalysts: input.catalysts,
    price: input.price,
    asOfDate: input.asOf,
  });

  const dcfApplicable = computeDcfApplicable({
    fcfTTM: input.fcfTTM,
    sector: input.sector,
    industry: input.industry,
  });

  const invDcf = input.invDcf ?? null;
  const crv = input.crv ?? null;

  const dataComplete: DataCompleteFlags = {
    scoring: true, // buildScoringForAnalysis() ist oben ohne Exception durchgelaufen
    invDcf: invDcf != null,
    crv: crv != null,
    overall: invDcf != null && crv != null,
  };

  const cappedByGate = scoring.gates.find(g => g.id === scoring.cappedBy) ?? null;

  return {
    ticker: input.ticker,
    asOf: input.asOf,
    // signal_v1 wird bewusst NICHT hier berechnet — deriveSignalV1() ist der
    // alleinige Ort dafuer (server/backtest/signal.ts), replayAt() liefert
    // nur den Snapshot-Zustand. Aufrufer (z.B. analyze-route.ts-Hook oder
    // ein spaeterer Backtest-Runner) ruft deriveSignalV1() auf den hier
    // erzeugten Feldern separat auf.
    signal: null,
    finalScore: scoring.finalScore,
    rawScore: scoring.rawScore,
    qualityScore: scoring.qualityScore,
    trendMultiplier: scoring.trendMultiplier,
    cappedBy: scoring.cappedBy,
    cappedBySeverity: (cappedByGate?.severity as "warn" | "hard" | undefined) ?? null,
    gates: scoring.gates,
    invDcf,
    dcfApplicable,
    crv,
    fv: input.fv ?? null,
    wc: input.wc ?? null,
    dataComplete,
    capReached: {
      reached: scoring.cappedBy != null,
      gateId: scoring.cappedBy,
      cap: cappedByGate?.cap ?? null,
      severity: (cappedByGate?.severity as "warn" | "hard" | undefined) ?? null,
    },
    fiscalQualifies: scoring.fiscal.qualifies,
    fiscalEVPercent: scoring.fiscal.evPercent,
    createdAt: new Date().toISOString(),
    scoringVersion: "v1",

    // Sprint B3 Phase 1b: additive T-Rohwerte, reine Weiterreichung (siehe
    // ReplayAtInput-Kommentar oben) — P_T/D_minus werden HIER aus price/WC_T
    // abgeleitet (triviale Subtraktion, keine neue Formel).
    fcf_T: input.fcf_T ?? null,
    wacc_T: input.wacc_T ?? null,
    g_T: input.g_T ?? null,
    P_T: input.price,
    WC_T: input.WC_T ?? null,
    D_minus: input.WC_T != null ? input.price - input.WC_T : null,
  };
}
