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
 */
import {
  buildScoringForAnalysis,
  type AnalysisScoringContext,
} from "../scoring-integration";
import type { ScoringSnapshot, DataCompleteFlags } from "./types";

/** §3.3: "sector notin {Banks, Insurance, Capital Markets als Bank-Proxy}".
 *  Reiner String-Match auf Sektor/Industry — keine Ticker-Namen, adaptiv
 *  fuer jeden Ticker mit passendem Sektor/Industry-String. */
function isBankProxySector(sector: string | undefined, industry: string | undefined): boolean {
  const hay = `${sector ?? ""} ${industry ?? ""}`.toLowerCase();
  return (
    hay.includes("bank") ||
    hay.includes("insurance") ||
    hay.includes("capital markets")
  );
}

/**
 * §3.3 dcfApplicable = FCF_T > 0 AND sector NOT IN {Banks, Insurance,
 * Capital Markets-als-Bank-Proxy} AND profile erlaubt FCF-DCF.
 * "profile erlaubt FCF-DCF" ist in diesem Repo nicht als eigenes Flag
 * spezifiziert (kein Profil verbietet FCF-DCF explizit in thesis-strength.ts)
 * — daher wird dieser dritte Faktor konservativ als "true, solange kein
 * Bank/Insurance-Sektor" behandelt (keine Erfindung einer neuen Profilregel).
 */
export function computeDcfApplicable(params: {
  fcfTTM: number | null | undefined;
  sector: string | undefined;
  industry: string | undefined;
}): boolean {
  const fcfPositive = typeof params.fcfTTM === "number" && isFinite(params.fcfTTM) && params.fcfTTM > 0;
  const bankProxy = isBankProxySector(params.sector, params.industry);
  return fcfPositive && !bankProxy;
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
  };
}
