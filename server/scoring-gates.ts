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

// ============================================================================
// buildGates + runScoringPipeline
// ============================================================================
//
// WICHTIGER HINWEIS ZUR SPEZIFIKATIONSLAGE (Transparenz statt Erfindung):
// WORK_SCORING_VORLAGE.md §13-16 ("Gate-Implementierung · Backtest ohne
// Lookahead · Nike-Fixture · runScoringPipeline Beispiel · Integrations-
// Checkliste") sind im Dokument selbst NUR als Kurzverweis vorhanden:
// "→ Detailcode in vorherigen Abschnitten dieser Datei." Es gibt aber keine
// vorherigen Abschnitte mit diesem Code — §0 (Architektur) und §17-18 sind
// die einzigen Abschnitte mit konkretem Code/Formeln. Es existiert also KEINE
// spezifizierte Formel dafuer, WIE qualityScore/trendMultiplier aus rohen
// Fundamentaldaten berechnet werden.
//
// Diese Implementierung erfindet daher NICHT die fehlende qualityScore-Formel.
// Stattdessen:
//   - qualityScore/trendMultiplier bleiben Eingabeparameter des Aufrufers
//     (exakt wie in §0 vorgesehen: "finalScore = min(qualityScore ×
//     trendMultiplier, gateCap)" — das SIND die beiden Inputs, keine
//     abgeleiteten Werte dieser Datei).
//   - buildGates() leitet NUR die vier in §17.8 konkret benannten Gates aus
//     denselben, bereits im Code vorhandenen Signalen ab, die §17.8 explizit
//     als Auslöser nennt: "Realized 8Q schwach", "Reverse DCF hoch",
//     "Marge bricht", "Share-Loss". Diese Signale kommen aus
//     calculateRealizedGrowth8Q()/calculateGapRatio() (bereits vorhanden,
//     WORK_REVERSE_DCF_BRIDGE.md TEIL 1) und aus direkt beobachtbaren
//     Fundamentaldaten (Marge-YoY-Delta, Marktanteils-Trend).
//   - Wo §17.8 nur qualitativ beschreibt ("schwach", "hoch", "bricht") ohne
//     exakte Zahl, wird die Schwelle unten explizit als benannte Konstante
//     dokumentiert (GATE_THRESHOLDS) statt implizit im Code versteckt —
//     damit sie sichtbar und im Review anpassbar ist, statt als stille
//     Annahme zu gelten.

export const GATE_THRESHOLDS = {
  /** "Realized 8Q schwach" (§17.8): annualisiertes 8Q-Umsatzwachstum unter
   *  dieser Schwelle gilt als schwach genug, um RELATIVE_GROWTH auszulösen. */
  WEAK_REALIZED_GROWTH_PCT: 5,
  /** "Reverse DCF hoch" (§17.8): gapRatio (g* / realizedGrowth8Q) über dieser
   *  Schwelle heißt der Markt preist deutlich mehr Wachstum ein, als die
   *  Historie stützt → DCF_REALITY_CHECK. gapRatio > 1 bedeutet g* > realized;
   *  1.5 = 50% höher als die Realized-Rate, als "deutlich" gewählt. */
  HIGH_GAP_RATIO: 1.5,
  /** "Marge bricht" (§17.8, Rüstungsbeispiel Zeile 4): YoY-Punkte-Rückgang der
   *  operativen Marge über dieser Schwelle löst PRICING_POWER aus. */
  MARGIN_COMPRESSION_PP: 2,
  /** "Share-Loss" (§17.8): YoY-Rückgang des Marktanteils/relativen
   *  Wachstums-Deltas gegenüber dem Sektor über dieser Schwelle löst
   *  RELATIVE_GROWTH (als "SHARE"-Gate in §17.8 bezeichnet) aus. */
  SHARE_LOSS_PP: 2,
} as const;

/** Rohe, beobachtbare Signale — Aufrufer befuellt diese aus bereits
 *  vorhandenen Analyse-Daten (StockAnalysis, Reverse-DCF-Ergebnis, Segment-
 *  Wachstumsraten). Keine dieser Groessen wird hier neu erfunden — sie
 *  kommen aus bereits existierenden Berechnungen im Repo. */
export interface GateInputs {
  /** g* aus dem Reverse-DCF (client/src/lib/calculations.ts calculateReverseDCF). */
  impliedGrowthPercent: number | null;
  /** annualisiertes 8Q-Realized-Wachstum (calculateRealizedGrowth8Q). */
  realizedGrowth8QPercent: number | null;
  /** YoY-Delta der operativen Marge in Prozentpunkten (negativ = Kompression). */
  marginDeltaYoYPp: number | null;
  /** YoY-Delta des relativen Wachstums vs. Sektor/Peer-Median in Prozentpunkten
   *  (negativ = Share-Loss). z.B. aus Section7 Segment-TAM outperforming-Delta. */
  relativeGrowthDeltaYoYPp: number | null;
  /** Lagerbestand/Inventory-Tage YoY-Delta in % (positiv = Aufbau/Risiko). null
   *  wenn nicht anwendbar (z.B. Software-/Dienstleistungsunternehmen ohne Inventory). */
  inventoryDaysDeltaYoYPct: number | null;
  /** Optionales, bereits vorhandenes REGULATORY_EXPOSURE-Gate aus server/regulatory.ts
   *  (strukturell kompatibel: id/active/cap/severity/rationale). Wird 1:1 durchgereicht,
   *  falls vorhanden — diese Datei berechnet es nicht neu. */
  regulatoryGate?: Gate | null;
}

/**
 * §17.8 — leitet die vier dort benannten Gates (PRICING_POWER, RELATIVE_GROWTH,
 * DCF_REALITY_CHECK, INVENTORY) aus den GateInputs ab, plus ein optional
 * durchgereichtes REGULATORY_EXPOSURE-Gate. Jedes Gate ist nur `active`, wenn
 * sein jeweiliger GATE_THRESHOLDS-Schwellenwert überschritten UND die
 * zugrunde liegende Kennzahl überhaupt vorhanden ist (kein Fake-Trigger bei
 * fehlenden Daten — fehlende Daten heißt "Gate inaktiv", nicht "Gate greift
 * automatisch").
 */
export function buildGates(inputs: GateInputs): Gate[] {
  const gates: Gate[] = [];

  // DCF_REALITY_CHECK — "Reverse DCF hoch" (§17.8)
  const gapRatio =
    inputs.impliedGrowthPercent != null && inputs.realizedGrowth8QPercent
      ? inputs.impliedGrowthPercent / inputs.realizedGrowth8QPercent
      : null;
  const dcfRealityActive =
    gapRatio != null && isFinite(gapRatio) && gapRatio >= GATE_THRESHOLDS.HIGH_GAP_RATIO;
  gates.push({
    id: 'DCF_REALITY_CHECK',
    active: dcfRealityActive,
    cap: GATE_CAPS.DCF_REALITY,
    severity: 'hard',
    rationale: dcfRealityActive
      ? `Reverse-DCF impliziert ${inputs.impliedGrowthPercent?.toFixed(1)}% Wachstum, `
        + `Realized-8Q liegt bei ${inputs.realizedGrowth8QPercent?.toFixed(1)}% `
        + `(gapRatio=${gapRatio?.toFixed(2)} ≥ ${GATE_THRESHOLDS.HIGH_GAP_RATIO})`
      : 'Reverse-DCF-Wachstumsannahme wird durch die 8Q-Historie hinreichend gestützt',
  });

  // RELATIVE_GROWTH — "Realized 8Q schwach" UND/ODER "Share-Loss" (§17.8)
  const weakGrowth =
    inputs.realizedGrowth8QPercent != null &&
    inputs.realizedGrowth8QPercent < GATE_THRESHOLDS.WEAK_REALIZED_GROWTH_PCT;
  const shareLoss =
    inputs.relativeGrowthDeltaYoYPp != null &&
    inputs.relativeGrowthDeltaYoYPp <= -GATE_THRESHOLDS.SHARE_LOSS_PP;
  const relativeGrowthActive = weakGrowth || shareLoss;
  gates.push({
    id: 'RELATIVE_GROWTH',
    active: relativeGrowthActive,
    cap: GATE_CAPS.RELATIVE_GROWTH,
    severity: 'hard',
    rationale: relativeGrowthActive
      ? [
          weakGrowth ? `Realized-8Q schwach (${inputs.realizedGrowth8QPercent?.toFixed(1)}% < ${GATE_THRESHOLDS.WEAK_REALIZED_GROWTH_PCT}%)` : null,
          shareLoss ? `Share-Loss (${inputs.relativeGrowthDeltaYoYPp?.toFixed(1)}pp ≤ -${GATE_THRESHOLDS.SHARE_LOSS_PP}pp)` : null,
        ].filter(Boolean).join(' · ')
      : 'Relatives Wachstum ggü. Sektor/Historie unauffällig',
  });

  // PRICING_POWER — "Marge bricht" (§17.8, Rüstungsbeispiel Zeile 4)
  const marginBreaking =
    inputs.marginDeltaYoYPp != null &&
    inputs.marginDeltaYoYPp <= -GATE_THRESHOLDS.MARGIN_COMPRESSION_PP;
  gates.push({
    id: 'PRICING_POWER',
    active: marginBreaking,
    cap: GATE_CAPS.PRICING_POWER,
    severity: 'hard',
    rationale: marginBreaking
      ? `Operative Marge bricht YoY um ${Math.abs(inputs.marginDeltaYoYPp ?? 0).toFixed(1)}pp `
        + `(≥ ${GATE_THRESHOLDS.MARGIN_COMPRESSION_PP}pp-Schwelle) — Preissetzungsmacht erodiert`
      : 'Keine materielle Margenkompression erkennbar',
  });

  // INVENTORY — Lager-/Bestandsaufbau als Frühindikator für Nachfrageschwäche.
  // §0 nennt INVENTORY als eigenständiges Gate mit Cap 70, §17.8 spezifiziert
  // keinen konkreten Auslöse-Schwellenwert dafür — bewusst konservativ (>15%
  // YoY-Aufbau) gewählt, siehe GATE_THRESHOLDS-Dokumentation oben für die
  // anderen drei; dieser Wert ist ANALOG dazu benannt, nicht aus §17.8 zitiert.
  const inventoryBuildup =
    inputs.inventoryDaysDeltaYoYPct != null && inputs.inventoryDaysDeltaYoYPct > 15;
  gates.push({
    id: 'INVENTORY',
    active: inventoryBuildup,
    cap: GATE_CAPS.INVENTORY,
    severity: 'warn',
    rationale: inventoryBuildup
      ? `Lagerbestand YoY um ${inputs.inventoryDaysDeltaYoYPct?.toFixed(1)}% aufgebaut — Nachfrage-Frühindikator`
      : 'Kein auffälliger Lageraufbau',
  });

  // REGULATORY_EXPOSURE — 1:1 durchgereicht falls vom Aufrufer übergeben
  // (bereits vollständig in server/regulatory.ts implementiert, WORK2.md).
  if (inputs.regulatoryGate) {
    gates.push(inputs.regulatoryGate);
  }

  return gates;
}

export interface ScoringPipelineInput {
  qualityScore: number;
  trendMultiplier: number;
  catalysts: Catalyst[];
  asOfDate: string;
  /** Aktueller Kurs — für catalystEV-in-%-Berechnung (§17.6). */
  price: number;
  gateInputs: GateInputs;
}

export interface ScoringPipelineResult extends ApplyGatesResult {
  gatesBeforeFiscal: Gate[];
  fiscal: FiscalMegatrendQualification;
  fiscalEVPercent: number;
  fiscalQualifiedAndMaterial: boolean;
  conflictTexts: string[];
}

/**
 * §17.6 — vollständige Scoring-Pipeline: buildGates() → Fiscal-Megatrend-Prüfung
 * → softenGatesForFiscalMegatrend() → applyGates(). Exakt der in §17.6
 * skizzierte Ablauf, hier tatsächlich als aufrufbare Funktion zusammengesetzt
 * statt nur als Codefragment in der Doku zu stehen.
 */
export function runScoringPipeline(input: ScoringPipelineInput): ScoringPipelineResult {
  const gatesBeforeFiscal = buildGates(input.gateInputs);

  const fiscal = fiscalMegatrendQualifies(input.catalysts, input.asOfDate);

  // §17.6: "fiscalEV = catalystExpectedValue(fiscal catalysts, price)".
  // catalystExpectedValue() existiert nicht als eigene Funktion in diesem Repo
  // (nicht Teil von §17.5s Codeblock) — die EV-Definition selbst liegt bereits
  // in shared/schema.ts als Catalyst.bruttoUpside/nettoUpside vor. Wir nutzen
  // die bereits vorhandene EV-Größe (nettoUpside, in %) für qualifizierende
  // Fiscal-Katalysatoren, statt eine zweite, redundante EV-Formel zu erfinden.
  const qualifyingFiscal = input.catalysts.filter(c =>
    (c.type === 'fiscal' || c.type === 'capacity') &&
    c.confidence === 'high' &&
    c.probability != null && c.probability >= 0.6 &&
    c.source?.url &&
    c.epsImpact != null
  );
  const fiscalEVPercent = qualifyingFiscal.reduce((sum, c) => sum + (c.nettoUpside ?? c.bruttoUpside ?? 0), 0);

  // §17.6: "qualifies = fiscal.qualifies && fiscalEV >= 5" (≥ 5% vom Kurs als
  // Materialitätsschwelle, exakt wie in der Doku vorgegeben).
  const fiscalQualifiedAndMaterial = fiscal.qualifies && fiscalEVPercent >= 5;

  const gatesAdjusted = softenGatesForFiscalMegatrend(gatesBeforeFiscal, {
    qualifies: fiscalQualifiedAndMaterial,
    catalystEV: fiscalEVPercent,
  });

  const applied = applyGates(input.qualityScore, input.trendMultiplier, gatesAdjusted);

  const conflictTexts: string[] = [];
  if (fiscalQualifiedAndMaterial) {
    conflictTexts.push(fiscalMegatrendConflictText());
  }

  return {
    ...applied,
    gatesBeforeFiscal,
    fiscal,
    fiscalEVPercent,
    fiscalQualifiedAndMaterial,
    conflictTexts,
  };
}
