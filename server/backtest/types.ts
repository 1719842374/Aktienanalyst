/**
 * server/backtest/types.ts — Phase 0 (Vertrag), WORK_SIGNAL_BACKTEST.md §2.2 + §11.
 *
 * Additive Typdatei fuer den Backtest-Layer. Definiert NUR den Daten-Vertrag
 * (Snapshot-Shape), der von Phase 1 (Snapshot-Store + Replay) befuellt wird
 * und in Phase 2+ (PIT-Universum, Walk-Forward, ...) weiterverwendet werden
 * soll. Keine Logik hier — reine Typen, siehe §16 "Implementierung lokal ->
 * Tests gruen -> PR" und §4 (Hardcoding vs. Adaptiv: keine Ticker-Namen).
 *
 * WICHTIG (Ticket-Abgrenzung): Dieses Ticket baut NUR Phase 0+1. Felder, die
 * erst in Phase 2+ gebraucht werden (z.B. Universe-Zugehoerigkeit, Cluster-
 * Zuordnung, Fold-Metadaten), werden hier bewusst NICHT vorgreifend angelegt.
 */
import type { Gate } from "../scoring-gates";

/** signal_v1-Ergebnistyp (WORK_SIGNAL_BACKTEST.md §9) — von deriveSignalV1()
 *  zurueckgegeben. `null` bedeutet "kein Signal" (z.B. !dataComplete). */
export type SignalV1 = "Buy" | "Accumulate" | "Hold" | "Reduce" | "Avoid" | null;

/**
 * dataComplete-Flags — welche fuer signal_v1 (§9) benoetigten Eingaben
 * tatsaechlich vorhanden/valide waren. Fehlende Einzelfelder duerfen laut
 * §9 Zeile 1 NICHT zu einem geratenen Signal fuehren ("if !dataComplete:
 * kein Signal"), sondern muessen explizit sichtbar sein (Transparenz statt
 * stiller Default).
 */
export interface DataCompleteFlags {
  /** Score/Gates aus runScoringPipeline() erfolgreich berechnet. */
  scoring: boolean;
  /** invDcf (Reverse-DCF g*-basierte Fair-Value-Ableitung) verfuegbar. */
  invDcf: boolean;
  /** CRV (Chance-Risiko-Verhaeltnis, worstCase-basiert) verfuegbar. */
  crv: boolean;
  /** Gesamtergebnis: alle fuer signal_v1 zwingenden Felder vorhanden. */
  overall: boolean;
}

/**
 * ScoringSnapshot — EIN persistierter Zustand der Scoring-Pipeline fuer
 * (ticker, asOf). WORK_SIGNAL_BACKTEST.md §11 Phase 0 Punkt 3 + §2.2 nennt
 * "server/backtest/types.ts" als Ziel-Datei fuer genau diesen Typ.
 *
 * Enthaelt laut Ticket "mindestens: ticker, asOf (Datum), Signal (aus
 * deriveSignalV1), Score, Gates-Zustand, invDcf, dcfApplicable,
 * dataComplete, CRV, capReached-Info" — zusaetzliche Felder sind additiv
 * erlaubt (Transparenz fuer Phase 2+), aber NICHT Bestandteil dieses
 * Tickets' Pflichtumfangs.
 */
export interface ScoringSnapshot {
  /** Ticker-Symbol, wie vom Aufrufer normalisiert (z.B. upperTicker). Keine
   *  Ticker-spezifische Logik liest dieses Feld — reiner Identifikator. */
  ticker: string;
  /** Datum (ISO yyyy-mm-dd), fuer das dieser Snapshot gilt — "heute" fuer
   *  Phase 1 (Live-Analyze), spaeter (Phase 2+) ein beliebiger PIT-Tag. */
  asOf: string;

  /** signal_v1-Ergebnis (deriveSignalV1(), §9). null = kein Signal. */
  signal: SignalV1;

  /** Score-Ergebnis aus runScoringPipeline()/buildScoringForAnalysis(). */
  finalScore: number | null;
  rawScore: number | null;
  qualityScore: number | null;
  trendMultiplier: number | null;

  /** Gates-Zustand — welches Gate (falls eines) den Score gedeckelt hat,
   *  plus die vollstaendige Gate-Liste (aktiv + inaktiv) fuer Transparenz. */
  cappedBy: string | null;
  cappedBySeverity: "warn" | "hard" | null;
  gates: Array<{ id: string; active: boolean; cap: number; severity: string; rationale: string }>;

  /** Reverse-DCF-Ableitung (g-Stern, invDcf) — Fair-Value-Preis aus dem
   *  invertierten DCF, analog client/src/lib/calculations.ts
   *  calculateReverseDCF, aber als reiner Preis (nicht nur g-Stern) fuer den
   *  signal_v1-Vergleich "invDcf < price". */
  invDcf: number | null;
  /** §3.3 Klassensperre: FCF_T > 0 UND Sektor nicht Bank/Insurance-artig UND
   *  Profil erlaubt FCF-DCF. false => invDcf ist NICHT signalrelevant
   *  (signal_v1 deckelt dann auf max. Hold). */
  dcfApplicable: boolean;

  /** CRV (Chance-Risiko-Verhaeltnis), analog calculateCRV() im Client. */
  crv: number | null;

  /** dataComplete-Flags (siehe DataCompleteFlags oben). */
  dataComplete: DataCompleteFlags;

  /** capReached-Info: dokumentiert, ob/welches Gate den Rohscore gedeckelt
   *  hat und mit welcher severity — Kurzform von `cappedBy`/`cappedBySeverity`
   *  als eigenes Objekt, wie vom Ticket ausdruecklich verlangt ("capReached-
   *  Info"). Redundant zu cappedBy/cappedBySeverity, aber explizit benannt,
   *  damit Phase 2+ nicht erst aus gates[] rekonstruieren muss. */
  capReached: {
    reached: boolean;
    gateId: string | null;
    cap: number | null;
    severity: "warn" | "hard" | null;
  };

  /** Fiscal-Megatrend-Ausnahme-Zustand (§17.4-17.7) — informativ, fliesst
   *  bereits in gates/cappedBy ein, aber fuer Backtest-Reports separat
   *  nuetzlich (z.B. um Fiscal-Replay-Effekte in Phase 6 zu isolieren). */
  fiscalQualifies: boolean;
  fiscalEVPercent: number | null;

  /** Zeitpunkt, an dem dieser Snapshot persistiert wurde (ISO-Timestamp,
   *  NICHT identisch mit `asOf` — asOf ist der Analyse-Bezugstag). */
  createdAt: string;

  /** scoringVersion — WORK_SIGNAL_BACKTEST.md §4.2/§13: "Aenderung
   *  GATE_THRESHOLDS erzeugt scoringVersion != v1". Fest "v1" fuer Phase 0+1,
   *  da GATE_THRESHOLDS in diesem Ticket nicht angetastet wird. */
  scoringVersion: string;
}

/** Re-Export des generischen Gate-Typs fuer Konsumenten dieser Datei, damit
 *  sie nicht zusaetzlich aus scoring-gates.ts importieren muessen. */
export type { Gate };
