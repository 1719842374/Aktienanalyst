/**
 * server/backtest/fiscal-replay.ts — Sprint B3 Phase 6 (Ticket:
 * tickets/SPRINT_B3_PHASE6_FISCAL_REPLAY.md), WORK_SIGNAL_BACKTEST.md §11
 * Phase 6 + §2.1 ("server/fiscal-bridge.ts — fertig, unwired; an Replay
 * andocken (publishedAt <= asOf)") + §3.1/§3.2 (PIT-Datenvertrag).
 *
 * ZWECK: Verdrahtet die bereits fertige, aber bislang ungenutzte
 * server/fiscal-bridge.ts (FiscalProgram/isProgramActive) in den
 * Replay-Pfad (server/backtest/replay.ts:replayAt() -> catalysts[] ->
 * scoring-gates.ts:fiscalMegatrendQualifies()). fiscal-bridge.ts SELBST
 * wird NICHT veraendert (Ticket-Regel: "nur andocken/aufrufen, nicht
 * umbauen") — diese Datei ist ausschliesslich Aufrufer-seitiger Kleber.
 *
 * WARUM ÜBERHAUPT EINE BRÜCKE NÖTIG IST:
 * fiscalMegatrendQualifies() (scoring-gates.ts) erwartet `Catalyst[]` mit
 * den Feldern type/confidence/probability/source/epsImpact — genau die
 * Form, die die Live-Pipeline aus LLM-Katalysatoren befüllt. Der
 * Fiscal-Bridge-Store (fiscal-bridge.ts) verwaltet aber ein eigenes,
 * generischeres Datenmodell (`FiscalProgram`: status/confidence/volumeUsdBn/
 * startYear/endYear/source/expiresAt) MIT TTL + Invalidierung — das ist
 * KEIN Catalyst und wird hier auch nicht zu einem gemacht, das die
 * Live-Pipeline verwendet. Diese Datei übersetzt NUR für den historischen
 * Replay-Pfad ein FiscalProgram in die minimale Catalyst-Teilmenge, die
 * fiscalMegatrendQualifies() für die Qualifikationsprüfung braucht — mit
 * der PIT-Bridge-Prüfung (isProgramActive, inkl. deren eigener harter
 * Lookahead-Sperre publishedAt<=asOf) VOR der scoring-gates.ts-eigenen
 * Lookahead-Sperre, sodass BEIDE Prüfungen greifen (defense in depth,
 * kein Widerspruch: fiscal-bridge.ts prüft zusätzlich TTL/status=expired/
 * endYear, scoring-gates.ts prüft zusätzlich type/confidence/probability/
 * url/epsImpact — ein Programm muss BEIDE Prüfungen bestehen, um im Replay
 * DCF_REALITY zu mildern).
 *
 * KERN-LOOKAHEAD-SCHUTZ (Ticket Punkt 4, Akzeptanzkriterium):
 * Ein 2026er-Programm (z.B. OBBBA/Stargate) darf bei einem 2023er-Replay
 * NIEMALS qualifizieren — auch wenn der Ticker damals schon im Universum
 * war. Das wird HIER doppelt sichergestellt:
 *   1. isProgramActive(program, asOf) aus fiscal-bridge.ts — publishedAt
 *      <= asOf ist dort bereits eine harte, unveraenderte Sperre.
 *   2. Der aus dem Programm abgeleitete Catalyst behaelt exakt dasselbe
 *      source.publishedAt — fiscalMegatrendQualifies() prueft es ERNEUT
 *      (eigene, unabhaengige Sperre in scoring-gates.ts, §17.7).
 * Ein Programm, das eine der beiden Pruefungen nicht besteht, wird HIER
 * bereits herausgefiltert und NIE als Catalyst an den Replay durchgereicht.
 *
 * KEIN LLM: Diese Datei ruft ausschliesslich deterministische Datums-/
 * Feld-Vergleiche auf bereits vorhandenen FiscalProgram-Metadaten auf.
 * Kein neuer LLM-Call für historische Zeitpunkte (Ticket-Regel + §12
 * "Kein LLM im Run-Pfad").
 *
 * g* INVARIANT: calcImpliedGStar() (server/catalyst-engine.ts) wird von
 * dieser Datei nicht importiert, nicht aufgerufen und nicht beeinflusst.
 * Diese Phase aendert ausschliesslich, OB ein Fiscal-Programm als Kontext
 * für die Gate-Milderung (softenDcfRealityGate, NUR DCF_REALITY_CHECK)
 * qualifiziert — nicht die g*-Berechnung selbst.
 *
 * KEINE TICKER-HARDCODES: fiscalProgramToPitCatalyst()/
 * qualifyingFiscalCatalystsAt() operieren generisch auf FiscalProgram[]
 * (Aufrufer entscheidet, welche Programme relevant sind — kein globaler
 * Ticker-/Programm-Scan hier, siehe Datei-Fussnote unten zu Produktionslauf).
 */
import {
  isProgramActive,
  type FiscalProgram,
} from "../fiscal-bridge";
import type { Catalyst } from "../../shared/schema";

/**
 * fiscalProgramToPitCatalyst() — übersetzt EIN FiscalProgram in die
 * minimale Catalyst-Teilmenge, die fiscalMegatrendQualifies() (§17.4)
 * prüft. Reine, deterministische Feld-Abbildung, KEINE neue Formel:
 *
 *   FiscalProgram.status/confidence     -> Catalyst.status/confidence (1:1)
 *   FiscalProgram.source                -> Catalyst.source (1:1, inkl. publishedAt)
 *   FiscalProgram.volumeUsdBn            -> Catalyst.addressableVolume (USD, *1e9)
 *   FiscalProgram.startYear/endYear      -> Catalyst.startYear/endYear (1:1)
 *
 * type/probability/epsImpact hat FiscalProgram NICHT im eigenen Datenmodell
 * (§2.2 Datenmodell oben in fiscal-bridge.ts) — diese drei Felder sind laut
 * §4.1 "Fiscal qualify"-Zeile ("type fiscal|capacity, conf high, p>=0.6,
 * URL, epsImpact, publishedAt<=asOf, EV>=5") ZWINGEND für die Qualifikation,
 * aber gehören konzeptionell zur Pipeline-seitigen EV-Bewertung (§17.6:
 * "EV wird in Pipeline mit price berechnet"), nicht zum reinen
 * TTL/Invalidierungs-Datenmodell der Bridge. Sie werden daher hier als
 * EXPLIZITE, benannte Parameter verlangt (kein stiller Default, keine
 * Erfindung) — der Aufrufer (Test/Replay-Script) liefert sie aus der
 * Programm-Klassifikation, die es fuer das Fiscal-Programm bereits hat.
 */
export interface FiscalProgramQualifyContext {
  /** §17.4 Kriterium 1: nur 'fiscal'|'capacity' kann qualifizieren. */
  type: "fiscal" | "capacity";
  /** §17.4 Kriterium 3: probability >= 0.6 Pflicht. */
  probability: number;
  /** §17.4 Kriterium 5: numerisch gesetzt Pflicht ($/Aktie). */
  epsImpact: number;
  /** §17.6 Materialitäts-EV ("fiscalEV = catalystExpectedValue(...) ...
   *  qualifies = fiscal.qualifies && fiscalEV >= 5"): runScoringPipeline()
   *  (scoring-gates.ts) nutzt hierfür Catalyst.nettoUpside (Fallback
   *  bruttoUpside), NICHT ein Feld aus FiscalProgram selbst -- die Bridge
   *  (fiscal-bridge.ts) kennt kein EV-%-Feld (reines TTL/Invalidierungs-
   *  Datenmodell, siehe §2.2 dort). Explizit vom Aufrufer verlangt statt
   *  eines stillen 0-Defaults, damit fehlende Materialität sichtbar bleibt
   *  statt eine falsche Qualifikation zu erzeugen. */
  nettoUpsidePercent: number;
}

export function fiscalProgramToPitCatalyst(
  program: FiscalProgram,
  qualifyCtx: FiscalProgramQualifyContext
): Catalyst {
  return {
    name: program.name,
    timeline: program.startYear != null && program.endYear != null
      ? `${program.startYear}-${program.endYear}`
      : "",
    pos: Math.round(qualifyCtx.probability * 100),
    bruttoUpside: qualifyCtx.nettoUpsidePercent,
    einpreisungsgrad: 0,
    nettoUpside: qualifyCtx.nettoUpsidePercent,
    gb: 0,
    generic: false,
    type: qualifyCtx.type,
    confidence: program.confidence,
    source: program.source,
    status: program.status,
    probability: qualifyCtx.probability,
    addressableVolume: program.volumeUsdBn != null ? program.volumeUsdBn * 1e9 : undefined,
    epsImpact: qualifyCtx.epsImpact,
    startYear: program.startYear ?? undefined,
    endYear: program.endYear ?? undefined,
  };
}

/**
 * qualifyingFiscalCatalystsAt() — DIE Andock-Funktion für den Replay-Pfad
 * (Ticket Punkt 3). Nimmt eine Liste von FiscalProgram (aus dem Fiscal-
 * Bridge-Store, server/fiscal-bridge.ts:loadFiscalProgram() oder direkt
 * als Fixture/Test-Input) entgegen und liefert NUR die Catalyst[]-Teilmenge
 * zurück, die
 *   (a) laut fiscal-bridge.ts:isProgramActive(program, asOf) am Replay-
 *       Zeitpunkt aktiv war (TTL nicht abgelaufen, status != expired,
 *       endYear ok, UND publishedAt <= asOf — harte Lookahead-Sperre aus
 *       fiscal-bridge.ts selbst), UND
 *   (b) einen von der Bridge unabhängigen FiscalProgramQualifyContext
 *       mitbringt (type/probability/epsImpact — s.o.).
 *
 * Programme, die (a) nicht erfüllen (z.B. publishedAt > asOf — das
 * 2026-auf-2023-Lookahead-Szenario), werden HIER bereits verworfen und
 * NIE in die zurückgegebene Liste aufgenommen — sie erreichen
 * fiscalMegatrendQualifies() also gar nicht erst. Das ist der Kern-
 * Lookahead-Schutz dieser Phase (Ticket Punkt 4).
 *
 * Aufrufer-Beispiel (Replay-Batch, analog script/test-backtest-
 * feasibility.ts, statt `catalysts: []` fest zu verdrahten):
 *
 *   const fiscalCatalysts = qualifyingFiscalCatalystsAt(programs, asOf, ctxByProgramId);
 *   const snapshot = replayAt({ ..., catalysts: fiscalCatalysts });
 *
 * Kein LLM, keine Ticker-Hardcodes — programs/ctxByProgramId kommen vom
 * Aufrufer (Fixture, Datenerhebung, oder spaeter ein echter Fiscal-Bridge-
 * Store-Scan), diese Funktion selbst kennt keine konkreten Programm- oder
 * Ticker-Namen.
 */
export function qualifyingFiscalCatalystsAt(
  programs: FiscalProgram[],
  asOf: string,
  qualifyCtxByProgramId: Map<string, FiscalProgramQualifyContext>
): Catalyst[] {
  const out: Catalyst[] = [];
  for (const program of programs) {
    if (!isProgramActive(program, asOf)) continue; // TTL/expired/endYear/publishedAt<=asOf
    const qualifyCtx = qualifyCtxByProgramId.get(program.id);
    if (!qualifyCtx) continue; // kein Qualify-Kontext geliefert -> konservativ ausgeschlossen
    out.push(fiscalProgramToPitCatalyst(program, qualifyCtx));
  }
  return out;
}
