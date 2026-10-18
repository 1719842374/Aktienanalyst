/**
 * Future_9 Adaptive Macro Framework — Makro-Ebene als ZUSATZOBJEKT (F9-09, F9-12, F9-16, F9-17).
 *
 * Liest die bestehenden Rezessions-Indikatoren (POST /api/analyze-recession) nur aus und rechnet
 * daraus eine zweite, habitat- und stärkegewichtete Sicht. Die bestehenden Scores, Untergruppen,
 * P-Werte und das Fazit werden NICHT verändert (kein Schreibzugriff, kein Import in recession.ts).
 *
 * Gewichte (F9-09, Future_9 §4 Z.58–91):
 *   final = Basis × Habitat × (0,7 + Stärke × 0,6)   [× KI-Anpassung ≤ ±25 %, F9-12]
 *   Basis: bewertung 1,8 · kredit 1,2 · realwirtschaft 1,0 · geldpolitik 1,0 · sentiment 0,8 ·
 *          managing 1,5 · widersprueche 1,3
 *   Habitat „restrictive“: bewertung ×1,3, managing ×1,2, geldpolitik ×1,2; Konzentration > 0,4: bewertung ×1,15.
 *   Stärke-Layer: einmal je Dimension mit der Dimensionsstärke (Muster server/gold-adaptive-score.ts
 *   effectiveWeight). Das Spec-Schema multipliziert je Signal; das würde Dimensionen mit vielen Slots
 *   allein wegen der Slot-Anzahl hoch- bzw. runtergewichten — bewusst nicht übernommen (PR-Body).
 *
 * n/a statt Fake: Dimension ohne gewerteten Slot (managing = F9-10, widersprueche = F9-11 noch
 * nicht gebaut) hat kein Gewicht in der Summe; Habitat-Regel ohne Daten wird nicht angewendet.
 */

export type MacroDimensionId =
  | "bewertung" | "kredit" | "realwirtschaft" | "geldpolitik" | "sentiment" | "managing" | "widersprueche";

export const MACRO_DIMENSIONS: MacroDimensionId[] = [
  "bewertung", "kredit", "realwirtschaft", "geldpolitik", "sentiment", "managing", "widersprueche",
];

/** Future_9 §4 Z.62–70 (wörtlich). */
export const MACRO_BASE_WEIGHTS: Record<MacroDimensionId, number> = {
  bewertung: 1.8,
  kredit: 1.2,
  realwirtschaft: 1.0,
  geldpolitik: 1.0,
  sentiment: 0.8,
  managing: 1.5,
  widersprueche: 1.3,
};

export const MACRO_DIMENSION_LABELS: Record<MacroDimensionId, string> = {
  bewertung: "Bewertung",
  kredit: "Kredit",
  realwirtschaft: "Realwirtschaft",
  geldpolitik: "Geldpolitik",
  sentiment: "Sentiment",
  managing: "Managing (F9-10)",
  widersprueche: "Makro-Widersprüche (F9-11)",
};

/** Habitat-Multiplikatoren Future_9 §4 Z.73–80 und deterministische Habitat-Schwellen. */
export const MACRO_HABITAT = {
  RESTRICTIVE: { bewertung: 1.3, managing: 1.2, geldpolitik: 1.2 } as Partial<Record<MacroDimensionId, number>>,
  CONCENTRATION_THRESHOLD: 0.4,
  CONCENTRATION_BEWERTUNG: 1.15,
  /** restrictive, wenn Realzins DFII10 z(20J, Monatsende) ≥ 0,5 … */
  REAL_YIELD_Z: 0.5,
  /** … oder die Fed Funds Rate (DFF) binnen 12 Monaten um ≥ 1,0 pp gestiegen ist. */
  FED_FUNDS_HIKE_PP: 1.0,
  /** easing (nur Anzeige): DFF binnen 12 Monaten um ≥ 1,0 pp gesenkt. */
  FED_FUNDS_CUT_PP: -1.0,
  REAL_YIELD_HISTORY_MONTHS: 240,
  REAL_YIELD_MIN_MONTHS: 60,
} as const;

/** Stärke-Layer wie Gold: (0,7 + Stärke × 0,6). */
export const MACRO_STRENGTH = { FLOOR: 0.7, SPAN: 0.6 } as const;
/** F9-12: KI darf je Gewicht höchstens ±25 % vom quantitativen Wert abweichen. */
export const MACRO_AI_MAX_DEVIATION = 0.25;

/** Zuordnung der bestehenden Rezessions-Slots (Name) zu den Future_9-Dimensionen. */
export function dimensionOfIndicator(name: string): MacroDimensionId | null {
  const n = name.toLowerCase();
  if (n.includes("buffett") || n.includes("cape")) return "bewertung";
  if (n.includes("kreditspread") || n.includes("margin")) return "kredit";
  if (n.includes("sahm") || n.includes("aktivität") || n.includes("durable") || n.includes("konsumklima") || n.includes("wei")) return "realwirtschaft";
  if (n.includes("zinskurve") || n.includes("m2")) return "geldpolitik";
  if (n.includes("vix") || n.includes("fear") || n.includes("google")) return "sentiment";
  return null;
}

export interface MacroIndicatorInput {
  name: string;
  group: "recession" | "correction";
  weightedScore: number;
  maxWeighted: number;
  available?: boolean;
  /** Nur serverseitig gesetzt (F9-10/F9-11-Komponenten): feste Dimension statt Namens-Zuordnung. */
  dimension?: MacroDimensionId;
  /** Nur Makro-Ebene: zählt nicht in die Referenz der bestehenden Formel. */
  layerOnly?: boolean;
}

/** Dimension eines Eingangs: Server-Komponente fest, Rezessions-Slot über den Namen. */
export function dimensionOfInput(ind: Pick<MacroIndicatorInput, "name" | "dimension">): MacroDimensionId | null {
  return ind.dimension ?? dimensionOfIndicator(ind.name);
}

export interface MacroHabitatInput {
  /** DFII10 Monatsendwerte (aufsteigend), n/a = leer. */
  realYieldMonthly: { date: string; value: number }[];
  /** DFF Tageswerte (aufsteigend), n/a = leer. */
  fedFunds: { date: string; value: number }[];
  /** Cap-Weight-RSL minus Equal-Weight-RSL (F9-07). null = n/a (noch nicht gebaut). */
  concentration: number | null;
}

export interface MacroHabitat {
  regime: "restrictive" | "easing" | "neutral" | null;
  realYield: number | null;
  realYieldZ: number | null;
  realYieldAsOf: string | null;
  fedFunds: number | null;
  fedFundsChange12mPp: number | null;
  fedFundsAsOf: string | null;
  concentration: number | null;
  notes: string[];
}

export interface MacroDimension {
  id: MacroDimensionId;
  label: string;
  available: boolean;
  indicators: string[];
  /** Σ weightedScore / Σ maxWeighted der gewerteten Slots, −1 … +1 (positiv = Risiko). */
  score: number | null;
  strength: number | null;
  baseWeight: number;
  habitatMultiplier: number;
  strengthMultiplier: number | null;
  quantWeight: number | null;
  aiWeight: number | null;
  finalWeight: number | null;
  /** final ≠ Basis (Habitat, Stärke oder KI). */
  adjusted: boolean;
  note: string;
}

export interface MacroGroupProbability {
  /** Makro-Ebene: 50 + 50 × Σ w·d / Σ w, auf 5 gerundet, 5–95. */
  layer: number | null;
  /** Bestehende Formel aus denselben Slots (50 + net/max × 50, ohne NY-Fed-Anker). */
  reference: number | null;
  formula: string;
}

export interface MacroAiInfo {
  status: "ok" | "no-key" | "failed" | "invalid" | "disabled";
  model: string | null;
  reason: string | null;
  riskFlag: 0 | 1 | null;
  cached: boolean;
  clamped: MacroDimensionId[];
}

export interface MacroLayer {
  available: boolean;
  asOf: string;
  weightSource: "openrouter" | "deterministisch";
  habitat: MacroHabitat;
  dimensions: MacroDimension[];
  recession: MacroGroupProbability;
  correction: MacroGroupProbability;
  ai: MacroAiInfo;
  unmapped: string[];
  /** Immer „keiner“: Zusatzobjekt, bestehende P/Scores unverändert. */
  scoreImpact: "keiner";
  notes: string[];
  /** F9-07/10/11 Detail (Konzentration, Managing-Komponenten, Widerspruchs-Paare); fehlt = nicht berechnet. */
  gaps?: import("./macro-layer-gaps").MacroGaps;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Gleiche Rundung wie recession.ts clampAndRound (5–95, Schritte von 5). */
export function clampRound5(p: number): number {
  const clamped = Math.max(5, Math.min(95, p));
  return Math.round(clamped / 5) * 5;
}

function zOfLast(values: number[]): number | null {
  if (values.length < 2) return null;
  const last = values[values.length - 1];
  const hist = values.slice(0, -1);
  const mu = hist.reduce((s, v) => s + v, 0) / hist.length;
  const sd = Math.sqrt(hist.reduce((s, v) => s + (v - mu) ** 2, 0) / (hist.length - 1));
  if (!(sd > 0)) return null;
  return (last - mu) / sd;
}

/** Monatsendwerte aus Tageswerten (letzter Wert je Monat). */
export function monthEnd(points: { date: string; value: number }[]): { date: string; value: number }[] {
  const m = new Map<string, { date: string; value: number }>();
  for (const p of [...points].filter(p => p && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date))) {
    m.set(p.date.slice(0, 7), p);
  }
  return Array.from(m.values());
}

function valueMonthsBefore(points: { date: string; value: number }[], date: string, months: number): number | null {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  const target = d.toISOString().slice(0, 10);
  let found: number | null = null;
  for (const p of points) {
    if (p.date <= target) found = p.value;
    else break;
  }
  return found;
}

/** Deterministische Habitat-Erkennung (keine Datenwerte im Code, nur Schwellen). */
export function detectHabitat(input: MacroHabitatInput): MacroHabitat {
  const notes: string[] = [];
  const ry = monthEnd(input.realYieldMonthly).slice(-(MACRO_HABITAT.REAL_YIELD_HISTORY_MONTHS + 1));
  const ryLast = ry.length ? ry[ry.length - 1] : null;
  const ryZ = ry.length >= MACRO_HABITAT.REAL_YIELD_MIN_MONTHS ? zOfLast(ry.map(p => p.value)) : null;
  if (!ryLast) notes.push("Realzins DFII10 n/a");
  else if (ryZ == null) notes.push(`Realzins DFII10 ${ryLast.value.toFixed(2)} %: zu wenig Historie für z (< ${MACRO_HABITAT.REAL_YIELD_MIN_MONTHS} Monate)`);
  const ff = [...input.fedFunds].filter(p => Number.isFinite(p.value)).sort((a, b) => a.date.localeCompare(b.date));
  const ffLast = ff.length ? ff[ff.length - 1] : null;
  const ffPrev = ffLast ? valueMonthsBefore(ff, ffLast.date, 12) : null;
  const ffChg = ffLast && ffPrev != null ? ffLast.value - ffPrev : null;
  if (!ffLast) notes.push("Fed Funds DFF n/a");
  let regime: MacroHabitat["regime"] = null;
  const restrictive = (ryZ != null && ryZ >= MACRO_HABITAT.REAL_YIELD_Z) || (ffChg != null && ffChg >= MACRO_HABITAT.FED_FUNDS_HIKE_PP);
  if (restrictive) regime = "restrictive";
  else if (ffChg != null && ffChg <= MACRO_HABITAT.FED_FUNDS_CUT_PP) regime = "easing";
  else if (ryZ != null || ffChg != null) regime = "neutral";
  if (regime === null) notes.push("Habitat n/a → keine Habitat-Multiplikatoren");
  if (input.concentration == null) notes.push("Konzentration (Cap−Equal RSL, F9-07) n/a → Regel > 0,4 nicht angewendet");
  return {
    regime,
    realYield: ryLast?.value ?? null,
    realYieldZ: ryZ == null ? null : round(ryZ, 2),
    realYieldAsOf: ryLast?.date ?? null,
    fedFunds: ffLast?.value ?? null,
    fedFundsChange12mPp: ffChg == null ? null : round(ffChg, 2),
    fedFundsAsOf: ffLast?.date ?? null,
    concentration: input.concentration,
    notes,
  };
}

export function habitatMultiplier(dim: MacroDimensionId, habitat: Pick<MacroHabitat, "regime" | "concentration">): number {
  let m = 1;
  if (habitat.regime === "restrictive") m *= MACRO_HABITAT.RESTRICTIVE[dim] ?? 1;
  if (dim === "bewertung" && habitat.concentration != null && habitat.concentration > MACRO_HABITAT.CONCENTRATION_THRESHOLD) {
    m *= MACRO_HABITAT.CONCENTRATION_BEWERTUNG;
  }
  return m;
}

/** F9-09 calculateAdaptiveWeights — quantitativ, deterministisch. */
export function calculateAdaptiveWeights(indicators: MacroIndicatorInput[], habitat: MacroHabitat): { dimensions: MacroDimension[]; unmapped: string[] } {
  const unmapped: string[] = [];
  const byDim = new Map<MacroDimensionId, MacroIndicatorInput[]>();
  for (const ind of indicators) {
    const dim = dimensionOfInput(ind);
    if (!dim) { unmapped.push(ind.name); continue; }
    if (!byDim.has(dim)) byDim.set(dim, []);
    byDim.get(dim)!.push(ind);
  }
  const dimensions = MACRO_DIMENSIONS.map((id): MacroDimension => {
    const all = byDim.get(id) ?? [];
    const scored = all.filter(i => i.available !== false && Number.isFinite(i.weightedScore) && Number.isFinite(i.maxWeighted) && i.maxWeighted > 0);
    const base = MACRO_BASE_WEIGHTS[id];
    const hab = habitatMultiplier(id, habitat);
    const label = MACRO_DIMENSION_LABELS[id];
    if (scored.length === 0) {
      const why = id === "managing" ? "F9-10: weniger als 2 Komponenten (CAPEX/EPS/Realzins/Konzentration vs. Trend) verfügbar"
        : id === "widersprueche" ? "F9-11: kein auswertbares Signalpaar"
        : all.length ? "kein gewerteter Slot (alle n/a)" : "kein Slot zugeordnet";
      return { id, label, available: false, indicators: all.map(i => i.name), score: null, strength: null, baseWeight: base, habitatMultiplier: hab,
        strengthMultiplier: null, quantWeight: null, aiWeight: null, finalWeight: null, adjusted: false, note: `n/a – ${why}` };
    }
    const net = scored.reduce((s, i) => s + i.weightedScore, 0);
    const max = scored.reduce((s, i) => s + i.maxWeighted, 0);
    const score = Math.max(-1, Math.min(1, net / max));
    const strength = Math.abs(score);
    const sm = MACRO_STRENGTH.FLOOR + strength * MACRO_STRENGTH.SPAN;
    const q = base * hab * sm;
    return { id, label, available: true, indicators: scored.map(i => i.name), score, strength, baseWeight: base, habitatMultiplier: hab,
      strengthMultiplier: sm, quantWeight: q, aiWeight: null, finalWeight: q, adjusted: Math.abs(q - base) > 1e-12,
      note: `Σ ${round(net, 1)} / ${round(max, 1)} aus ${scored.length} Slot(s)` };
  });
  return { dimensions, unmapped };
}

/** F9-12: KI-Vorschlag validieren — nur bekannte, verfügbare Dimensionen, endlich, ±25 % geklemmt. */
export function applyAiWeights(
  dimensions: MacroDimension[],
  suggestion: unknown,
): { dimensions: MacroDimension[]; clamped: MacroDimensionId[]; valid: boolean } {
  const adj = (suggestion as any)?.adjustedWeights;
  if (!adj || typeof adj !== "object") return { dimensions, clamped: [], valid: false };
  const clamped: MacroDimensionId[] = [];
  let used = 0;
  const out = dimensions.map(d => {
    if (!d.available || d.quantWeight == null) return d;
    const raw = (adj as Record<string, unknown>)[d.id];
    const v = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(v)) return d;
    used++;
    const lo = d.quantWeight * (1 - MACRO_AI_MAX_DEVIATION);
    const hi = d.quantWeight * (1 + MACRO_AI_MAX_DEVIATION);
    const c = Math.max(lo, Math.min(hi, v));
    if (c !== v) clamped.push(d.id);
    return { ...d, aiWeight: c, finalWeight: c, adjusted: Math.abs(c - d.baseWeight) > 1e-12 };
  });
  return { dimensions: used > 0 ? out : dimensions, clamped, valid: used > 0 };
}

/** Gruppen-P der Makro-Ebene plus Referenz der bestehenden Formel aus denselben Slots. */
export function groupProbability(indicators: MacroIndicatorInput[], dimensions: MacroDimension[], group: "recession" | "correction"): MacroGroupProbability {
  const inGroup = indicators.filter(i => i.group === group && i.available !== false && Number.isFinite(i.maxWeighted) && i.maxWeighted > 0);
  const refSlots = inGroup.filter(i => !i.layerOnly);
  const net = refSlots.reduce((s, i) => s + i.weightedScore, 0);
  const max = refSlots.reduce((s, i) => s + i.maxWeighted, 0);
  const reference = max > 0 ? clampRound5(50 + (net / max) * 50) : null;
  let wSum = 0, acc = 0;
  const parts: string[] = [];
  for (const d of dimensions) {
    if (!d.available || d.finalWeight == null) continue;
    const slots = inGroup.filter(i => dimensionOfInput(i) === d.id);
    if (!slots.length) continue;
    const dn = slots.reduce((s, i) => s + i.weightedScore, 0);
    const dm = slots.reduce((s, i) => s + i.maxWeighted, 0);
    const ds = Math.max(-1, Math.min(1, dn / dm));
    wSum += d.finalWeight;
    acc += d.finalWeight * ds;
    parts.push(`${d.label} ${round(d.finalWeight, 2)}×${ds >= 0 ? "+" : ""}${round(ds, 2)}`);
  }
  if (!(wSum > 0)) return { layer: null, reference, formula: "keine gewertete Dimension → n/a" };
  const stress = acc / wSum;
  const raw = 50 + stress * 50;
  const layer = clampRound5(raw);
  return { layer, reference, formula: `50% + (${parts.join(" + ")}) / ${round(wSum, 2)} × 50% = ${raw.toFixed(1)}% → ${layer}%` };
}

export function emptyMacroLayer(asOf: string, note: string, habitat?: MacroHabitat): MacroLayer {
  return {
    available: false,
    asOf,
    weightSource: "deterministisch",
    habitat: habitat ?? { regime: null, realYield: null, realYieldZ: null, realYieldAsOf: null, fedFunds: null, fedFundsChange12mPp: null, fedFundsAsOf: null, concentration: null, notes: [] },
    dimensions: [],
    recession: { layer: null, reference: null, formula: "n/a" },
    correction: { layer: null, reference: null, formula: "n/a" },
    ai: { status: "disabled", model: null, reason: null, riskFlag: null, cached: false, clamped: [] },
    unmapped: [],
    scoreImpact: "keiner",
    notes: [note],
  };
}

/** Prompt nach Future_9 §9 (Z.161–186), ohne Key/PII. Fehlende Werte heißen n/a. */
export function buildMacroWeightPrompt(habitat: MacroHabitat, dimensions: MacroDimension[]): string {
  const fmt = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(d));
  const sig = dimensions.filter(d => d.available).slice(0, 10).map(d =>
    `- ${d.id}: score=${fmt(d.score)}, strength=${fmt(d.strength)}, direction=${(d.score ?? 0) > 0 ? "risk-up" : (d.score ?? 0) < 0 ? "risk-down" : "flat"}`,
  ).join("\n");
  const weights: Record<string, number> = {};
  for (const d of dimensions) if (d.available && d.quantWeight != null) weights[d.id] = round(d.quantWeight, 3);
  return `Du bist ein Makro-Analyst. Analysiere das aktuelle Habitat und schlage leichte Gewichtungsanpassungen vor.

Habitat: ${habitat.regime ?? "n/a"}
Realzins DFII10: ${fmt(habitat.realYield)} % (z20J ${fmt(habitat.realYieldZ)}), Fed Funds 12M-Änderung: ${fmt(habitat.fedFundsChange12mPp)} pp
Konzentration (Cap-Equal RSL): ${fmt(habitat.concentration)}
Gewinnmomentum (z-Score): n/a

Aktuelle Signale (Dimensionen, score −1…+1, positiv = Risiko):
${sig}

Aktuelle Gewichte:
${JSON.stringify(weights, null, 2)}

Aufgabe:
1. Liegt ein struktureller Regime-Wechsel oder erhöhtes Risiko vor?
2. Schlage angepasste Gewichte vor (max ±25% Abweichung von den aktuellen Werten), nur für die oben genannten Schlüssel.
3. Gib eine kurze Begründung (1-2 Sätze).

Antworte ausschließlich im folgenden JSON-Format:
{"adjustedWeights": {"<schlüssel>": <zahl>}, "riskFlag": 0, "reason": "Kurze Begründung"}`;
}

/** Stabiler Cache-Schlüssel (gerundete Eingaben). */
export function macroWeightCacheKey(habitat: MacroHabitat, dimensions: MacroDimension[]): string {
  const parts = [habitat.regime ?? "na", habitat.realYieldZ ?? "na", habitat.fedFundsChange12mPp ?? "na", habitat.concentration ?? "na",
    ...dimensions.map(d => `${d.id}:${d.available ? round(d.quantWeight ?? 0, 3) : "na"}:${d.score == null ? "na" : round(d.score, 2)}`)];
  return parts.join("|");
}

/** Gesamtaufbau ohne IO; ai = bereits geladener Vorschlag (oder null). */
export function buildMacroLayer(args: {
  asOf: string;
  indicators: MacroIndicatorInput[];
  habitat: MacroHabitat;
  ai: { suggestion: unknown; model: string | null; cached: boolean } | null;
  aiStatus: MacroAiInfo["status"];
}): MacroLayer {
  const valid = (Array.isArray(args.indicators) ? args.indicators : []).filter(i => i && typeof i.name === "string");
  if (valid.length === 0) return emptyMacroLayer(args.asOf, "Keine Rezessions-Indikatoren übergeben – Makro-Ebene n/a", args.habitat);
  const quant = calculateAdaptiveWeights(valid, args.habitat);
  let dimensions = quant.dimensions;
  let ai: MacroAiInfo = { status: args.aiStatus, model: null, reason: null, riskFlag: null, cached: false, clamped: [] };
  let weightSource: MacroLayer["weightSource"] = "deterministisch";
  if (args.ai) {
    const applied = applyAiWeights(dimensions, args.ai.suggestion);
    const s = args.ai.suggestion as any;
    if (applied.valid) {
      dimensions = applied.dimensions;
      weightSource = "openrouter";
      const rf = s?.riskFlag === 1 || s?.riskFlag === "1" ? 1 : s?.riskFlag === 0 || s?.riskFlag === "0" ? 0 : null;
      ai = { status: "ok", model: args.ai.model, reason: typeof s?.reason === "string" ? s.reason.slice(0, 300) : null, riskFlag: rf, cached: args.ai.cached, clamped: applied.clamped };
    } else {
      ai = { ...ai, status: "invalid", model: args.ai.model };
    }
  }
  const recession = groupProbability(valid, dimensions, "recession");
  const correction = groupProbability(valid, dimensions, "correction");
  const available = dimensions.some(d => d.available);
  const notes = [
    "Zusatzobjekt: bestehende Rezessions-/Korrektur-P und Scores bleiben unverändert (kein Einfluss).",
    weightSource === "openrouter"
      ? "Gewichte: quantitativ (Basis × Habitat × Stärke), danach KI-Anpassung über OpenRouter, je Gewicht auf ±25 % geklemmt."
      : `Gewichte deterministisch (Basis × Habitat × Stärke); KI-Pfad: ${ai.status === "no-key" ? "kein OPENROUTER_API_KEY" : ai.status === "failed" ? "Abruf fehlgeschlagen" : ai.status === "invalid" ? "Antwort ungültig" : "aus"}.`,
  ];
  return {
    available,
    asOf: args.asOf,
    weightSource,
    habitat: args.habitat,
    dimensions,
    recession,
    correction,
    ai,
    unmapped: quant.unmapped,
    scoreImpact: "keiner",
    notes,
  };
}
