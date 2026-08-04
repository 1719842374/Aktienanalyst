/**
 * TEIL A — Generische Scoring-Gate-Infrastruktur + Lookahead-Bias-Regel
 * (WORK_SCORING_VORLAGE.md §0 + §17-18)
 *
 * Architektur (§0):
 *   finalScore = min(qualityScore × trendMultiplier, gateCap)
 *   catalystEV wird separat ausgewiesen (nicht Teil dieser Datei — Pipeline-Aufgabe).
 *
 * Gate-Caps (§0, als Konstanten — NICHT hart in Funktionen verdrahten):
 *   PRICING_POWER      = 55
 *   RELATIVE_GROWTH    = 60
 *   DCF_REALITY        = 65
 *   INVENTORY          = 70
 *
 * §13-16 sind in WORK_SCORING_VORLAGE.md nur als "Kurz/Detailcode in vorherigen
 * Abschnitten" referenziert (nicht ausformuliert in der aktuellen Doku-Version) —
 * werden hier bewusst NICHT erfunden/nachgebaut. qualityScore/trendMultiplier
 * werden unten nur als generische Platzhalter-Typen/TODO-Funktion behandelt,
 * damit applyGates() unabhängig von der (noch nicht spezifizierten) Herleitung
 * dieser beiden Werte funktioniert. Fokus dieser Datei: §17-18.
 *
 * Stil-Vorlage: server/regulatory.ts (REGULATORY_EXPOSURE-Gate, Confidence-Filter,
 * Test-Matrix). Dort existiert bereits ein Gate-artiges Objekt (`RegulatoryGate`),
 * aber mit literalem `id: 'REGULATORY_EXPOSURE'` — kein generisches, wiederverwendbares
 * Gate-Interface über verschiedene Gate-Typen hinweg. Das generische `Gate`-Interface
 * wird daher hier NEU definiert (additiv) und regulatory.ts NICHT verändert. Wer
 * REGULATORY_EXPOSURE zusammen mit den hier definierten Gates in applyGates()
 * einsetzen will, mappt `RegulatoryGate` → `Gate` (gleiche Felder: id/active/cap/
 * severity/rationale, strukturell kompatibel).
 */
import type { Catalyst } from "../shared/schema";

// ─── §0 Gate-Cap-Konstanten ────────────────────────────────────────────────────

export const GATE_CAPS = {
  PRICING_POWER: 55,
  RELATIVE_GROWTH: 60,
  DCF_REALITY: 65,
  INVENTORY: 70,
} as const;

export type GateId =
  | 'PRICING_POWER'
  | 'RELATIVE_GROWTH'
  | 'DCF_REALITY_CHECK'
  | 'INVENTORY'
  | 'REGULATORY_EXPOSURE'
  | 'GOLD_REAL_YIELD_REGIME'
  | 'GOLD_AISC_STRESS'
  | string; // generischer String erlaubt weitere Gate-Typen ohne Schema-Bruch

// ─── §0 Generisches Gate-Interface ─────────────────────────────────────────────

export interface Gate {
  id: GateId;
  active: boolean;
  cap: number;
  severity: 'warn' | 'hard';
  rationale: string;
}

export interface ApplyGatesResult {
  /** finalScore nach Deckelung durch den strengsten aktiven Gate-Cap */
  score: number;
  /** Roh-Score vor Deckelung (qualityScore × trendMultiplier), zur Transparenz */
  rawScore: number;
  /** Welches Gate (falls überhaupt eines) den Score tatsächlich gedeckelt hat */
  cappedBy: Gate | null;
  /** Alle aktiven Gates, sortiert nach cap aufsteigend (strengster zuerst) */
  activeGates: Gate[];
}

/**
 * §0 Kern-Architektur: finalScore = min(qualityScore × trendMultiplier, gateCap).
 *
 * Nimmt unter allen AKTIVEN Gates den niedrigsten Cap (= striktester Gate) und
 * deckelt damit den Roh-Score. Dokumentiert, welches Gate (falls eines) tatsächlich
 * gegriffen hat (cappedBy = null, wenn kein aktiver Gate-Cap unter dem Roh-Score liegt).
 *
 * qualityScore/trendMultiplier: siehe TODO oben — bewusst generische Zahlenparameter,
 * deren Herleitung außerhalb dieser Datei liegt (§13-16 nicht spezifiziert).
 */
export function applyGates(
  qualityScore: number,
  trendMultiplier: number,
  gates: Gate[]
): ApplyGatesResult {
  const rawScore = qualityScore * trendMultiplier;
  const activeGates = gates
    .filter(g => g.active)
    .sort((a, b) => a.cap - b.cap);

  if (activeGates.length === 0) {
    return { score: rawScore, rawScore, cappedBy: null, activeGates };
  }

  const strictest = activeGates[0];
  const score = Math.min(rawScore, strictest.cap);
  const cappedBy = score < rawScore ? strictest : null;

  return { score, rawScore, cappedBy, activeGates };
}

// ─── §17.4 Fiscal-Megatrend-Ausnahme — Qualifikations-Ergebnis ────────────────

export interface FiscalMegatrendQualification {
  qualifies: boolean;
  /** catalystEV wird HIER bewusst nicht in %-Punkten berechnet — Pipeline übergibt
   *  price/EPS-Kontext separat (siehe §17.6: "EV wird in Pipeline mit price berechnet").
   *  0 bedeutet "hier nicht berechnet", NICHT "kein EV". */
  catalystEV: number;
  reasons: string[];
}

/**
 * §17.4 + §17.7 — deterministische Qualifikations-Prüfung, KEIN LLM-Urteil.
 *
 * Ein Katalysator zählt nur als "high confidence fiscal" wenn ALLE gelten:
 *   1. type IN {'fiscal', 'capacity'}
 *   2. confidence === 'high'
 *   3. probability >= 0.6
 *   4. source.url vorhanden (nicht leer)
 *   5. epsImpact != null (numerisch gesetzt)
 *   6. HARTE LOOKAHEAD-SPERRE (§17.7): source.publishedAt <= asOfDate.
 *      Ohne diese Prüfung (oder bei fehlendem/unparsbarem publishedAt) gilt der
 *      Katalysator NICHT als "high confidence" für die Ausnahme — unabhängig von
 *      allen anderen Feldern. Das ist bewusst UNBEDINGT (kein "wenn vorhanden").
 *
 * AI-Capex-Fälle (type nicht in {fiscal, capacity}, oder kein Staatsbezug modelliert
 * über type/Quelle) fallen automatisch durch Kriterium 1 durch → qualifies=false
 * (§17.3 "AI-Capex der Hyperscaler → privater Zyklus, Anti-Bias Pflicht").
 *
 * catalystEV ist hier immer 0 (siehe §17.6 — die eigentliche EV-Berechnung mit
 * price/EPS-Kontext erfolgt außerhalb, in der Scoring-Pipeline).
 */
export function fiscalMegatrendQualifies(
  catalysts: Catalyst[],
  asOfDate: string
): FiscalMegatrendQualification {
  const asOfTime = new Date(asOfDate).getTime();
  const asOfValid = isFinite(asOfTime);

  const fiscal = catalysts.filter(c => {
    if (c.type !== 'fiscal' && c.type !== 'capacity') return false;
    if (c.confidence !== 'high') return false;
    if (c.probability == null || c.probability < 0.6) return false;
    if (!c.source?.url || c.source.url.trim() === "") return false;
    if (c.epsImpact == null) return false;

    // Harte Lookahead-Sperre (§17.7): publishedAt <= asOfDate ist Pflicht.
    // Fehlendes/unparsbares publishedAt oder fehlendes asOfDate → NICHT qualifiziert.
    if (!asOfValid) return false;
    const publishedTime = c.source?.publishedAt ? new Date(c.source.publishedAt).getTime() : NaN;
    if (!isFinite(publishedTime)) return false;
    if (publishedTime > asOfTime) return false;

    return true;
  });

  const reasons: string[] = [];
  if (!fiscal.length) {
    reasons.push('no_high_confidence_fiscal');
    return { qualifies: false, catalystEV: 0, reasons };
  }
  reasons.push(`fiscal_count=${fiscal.length}`);
  return { qualifies: true, catalystEV: 0, reasons };
}

// ─── §17.5 softenDcfRealityGate — NUR DCF_REALITY_CHECK ist milderbar ─────────

/**
 * §17.5 — Wirkung der Fiscal-Megatrend-Ausnahme auf Gates (eng begrenzt).
 *
 * UNVERÄNDERLICHE TABELLE (§17.5, exakt):
 *   PRICING_POWER        → Fiscal-Ausnahme NIEMALS anwendbar
 *   RELATIVE_GROWTH       → Fiscal-Ausnahme NIEMALS anwendbar
 *   INVENTORY              → Fiscal-Ausnahme NIEMALS anwendbar
 *   REGULATORY_EXPOSURE   → Fiscal-Ausnahme NIEMALS anwendbar
 *   DCF_REALITY_CHECK      → Ja, Cap 65 → 75 (Math.min(80, cap+10)), bleibt 'warn',
 *                             wird NICHT gelöscht/deaktiviert.
 *
 * Nur wenn gate.id === 'DCF_REALITY_CHECK' UND gate.active UND fiscal.qualifies,
 * wird der Cap angehoben (weniger streng). In allen anderen Fällen wird das Gate
 * UNVERÄNDERT (Referenz-/Wertgleich) zurückgegeben.
 */
export function softenDcfRealityGate(
  gate: Gate,
  fiscal: { qualifies: boolean; catalystEV: number }
): Gate {
  if (gate.id !== 'DCF_REALITY_CHECK' || !gate.active || !fiscal.qualifies) {
    return gate;
  }
  return {
    ...gate,
    cap: Math.min(80, gate.cap + 10),
    severity: 'warn',
    rationale: gate.rationale +
      ' · Fiscal-Megatrend belegt: DCF_REALITY gemildert (nicht aufgehoben)',
  };
}

/**
 * Batch-Variante für §17.6-Einbau in runScoringPipeline: wendet softenDcfRealityGate
 * auf eine Liste von Gates an (nur DCF_REALITY_CHECK betroffen, Rest unverändert).
 */
export function softenGatesForFiscalMegatrend(
  gates: Gate[],
  fiscal: { qualifies: boolean; catalystEV: number }
): Gate[] {
  return gates.map(g => softenDcfRealityGate(g, fiscal));
}

/**
 * §17.6 — Conflict-Text-Baustein für Verdict/Conflicts-Ausgabe, wenn die
 * Fiscal-Megatrend-Ausnahme aktiv gegriffen hat. Reine Text-Hilfsfunktion,
 * keine Gate-Logik.
 */
export function fiscalMegatrendConflictText(): string {
  return 'Fiscal-Megatrend aktiv: DCF_REALITY gemildert — Rückenwind aus Staatsbudget, ' +
    'nicht aus historischem Run-Rate. Bilanz-/Order-Risiko bleibt.';
}
