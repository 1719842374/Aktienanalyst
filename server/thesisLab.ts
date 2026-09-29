/**
 * thesisLab.ts
 * Deterministic Thesis-Lab engine and the six spec fixtures.
 * No LLM, no FMP. Ampel and GB follow WORK_THESIS_LAB.md §3.
 *
 * Ampel:
 *   gray  — no counterThesis OR dataQuality = low
 *   red   — pricedIn > 70 OR coverage > 80 OR techLayer = 1
 *   green — pricedIn < 40 AND coverage < 40 AND techLayer >= 2
 *   else yellow
 * Coverage is cyclePhaseFit (0–100).
 * Netto = Brutto * (1 - pricedIn/100); GB = PoS * Netto.
 */

import type {
  CurvePoint,
  TechLayer,
  ThesisLabResult,
  ThesisTicker,
} from "../client/src/lib/thesisLabTypes";

export type Ampel = "green" | "yellow" | "red" | "gray";

const AS_OF = "2026-09-16";

interface FixtureSeed {
  id: string;
  thesis: string;
  counterThesis: string;
  techLayer: TechLayer;
  revolutionScore: 0 | 1 | 2 | 3;
  pricedInPct: number;
  pos: number;
  grossUpsidePct: number;
  valueChainStage: string;
  industryKey: string;
  tickers: ThesisTicker[];
  /** Coverage proxy used by the Ampel formula (0–100). */
  cyclePhaseFit: number;
  uncertaintyVsRisk: ThesisLabResult["uncertaintyVsRisk"];
  dataQuality: ThesisLabResult["dataQuality"];
  attentionNow: number;
  sources: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function ampelFrom(input: {
  counterThesis: string;
  dataQuality: ThesisLabResult["dataQuality"];
  pricedInPct: number;
  coverage: number;
  techLayer: number;
}): Ampel {
  if (!input.counterThesis.trim() || input.dataQuality === "low") return "gray";
  if (input.pricedInPct > 70 || input.coverage > 80 || input.techLayer === 1) return "red";
  if (input.pricedInPct < 40 && input.coverage < 40 && input.techLayer >= 2) return "green";
  return "yellow";
}

function curveEnding(pricedInPct: number, attentionNow: number): CurvePoint[] {
  const labels = ["2023", "2024", "2025", "2026"];
  const startP = clamp(pricedInPct - 34, 4, 96);
  const startA = clamp(attentionNow - 26, 4, 96);
  return labels.map((t, i) => {
    const k = i / (labels.length - 1);
    const last = i === labels.length - 1;
    return {
      t,
      pricedInPct: last ? round2(pricedInPct) : Math.round(startP + (pricedInPct - startP) * k),
      attention: last ? Math.round(attentionNow) : Math.round(startA + (attentionNow - startA) * k),
    };
  });
}

function materialize(seed: FixtureSeed): ThesisLabResult {
  const netUpsidePct = round2(seed.grossUpsidePct * (1 - seed.pricedInPct / 100));
  const gbPct = round2(seed.pos * netUpsidePct);
  const infoCurve = ampelFrom({
    counterThesis: seed.counterThesis,
    dataQuality: seed.dataQuality,
    pricedInPct: seed.pricedInPct,
    coverage: seed.cyclePhaseFit,
    techLayer: seed.techLayer,
  });
  return {
    id: seed.id,
    thesis: seed.thesis,
    counterThesis: seed.counterThesis,
    techLayer: seed.techLayer,
    revolutionScore: seed.revolutionScore,
    pricedInPct: seed.pricedInPct,
    infoCurve,
    pos: seed.pos,
    grossUpsidePct: seed.grossUpsidePct,
    netUpsidePct,
    gbPct,
    valueChainStage: seed.valueChainStage,
    industryKey: seed.industryKey,
    tickers: seed.tickers,
    cyclePhaseFit: seed.cyclePhaseFit,
    uncertaintyVsRisk: seed.uncertaintyVsRisk,
    dataQuality: seed.dataQuality,
    curvePoints: curveEnding(seed.pricedInPct, seed.attentionNow),
    sources: seed.sources,
    asOf: AS_OF,
    llmUsed: false,
  };
}

const FIXTURES: ThesisLabResult[] = [
  materialize({
    id: "memory-hbm",
    thesis:
      "HBM bleibt der Engpass des KI-Trainingszyklus: Bandbreite und Stack-Höhe begrenzen, wie viele Accelerator tatsächlich ausgeliefert werden können.",
    counterThesis:
      "Micron, SK Hynix und Samsung erweitern HBM-Kapazität 2026/27; sobald die Ausbeute steigt, normalisieren sich ASP und die Speicher-Superzyklus-Marge.",
    techLayer: 3,
    revolutionScore: 2,
    pricedInPct: 87,
    pos: 0.55,
    grossUpsidePct: 40,
    valueChainStage: "memory",
    industryKey: "semiconductors",
    tickers: [
      { symbol: "MU", role: "leader" },
      { symbol: "000660.KS", role: "leader" },
    ],
    cyclePhaseFit: 72,
    uncertaintyVsRisk: "known_cycle",
    dataQuality: "high",
    attentionNow: 91,
    sources: ["Thesis-Lab Fixture memory/HBM", "WORK_THESIS_LAB.md §4", "WORK_VALUECHAIN_LAB_LOOKUP.md"],
  }),
  materialize({
    id: "agent-runtime-saas",
    thesis:
      "Die Agent-Runtime wird zur Kontrollschicht über bestehendem SaaS: Workflow, Identität und Tool-Aufrufe sitzen bei den Systemen of Record.",
    counterThesis:
      "Hyperscaler bündeln Agent-Laufzeiten in Cloud-Verträgen. Separate Seat-Preise für CRM- und ITSM-Agenten bleiben unter Druck, solange die Nutzung in den Plattformvertrag fällt.",
    techLayer: 4,
    revolutionScore: 2,
    pricedInPct: 45,
    pos: 0.5,
    grossUpsidePct: 60,
    valueChainStage: "agent_runtime",
    industryKey: "software-infrastructure",
    tickers: [
      { symbol: "CRM", role: "leader" },
      { symbol: "NOW", role: "leader" },
    ],
    cyclePhaseFit: 52,
    uncertaintyVsRisk: "mixed",
    dataQuality: "medium",
    attentionNow: 58,
    sources: ["Thesis-Lab Fixture agent_runtime/SaaS", "WORK_THESIS_LAB.md §4"],
  }),
  materialize({
    id: "process-lockin-vat",
    thesis:
      "Vakuumventile und Prozessisolation sind ein physischer Lock-in der Wafer-Fab: ohne sie steht die Kammer, und die Qualifikation dauert Jahre.",
    counterThesis:
      "Längere Werkzeugstandzeiten und lokale Zweitquellen in Asien senken die Ersatzrate. Der Mid-Cycle-Auftragseingang ist kein strukturelles Mengenwachstum.",
    techLayer: 3,
    revolutionScore: 1,
    pricedInPct: 59,
    pos: 0.46,
    grossUpsidePct: 50,
    valueChainStage: "process_lockin",
    industryKey: "semiconductors",
    tickers: [
      { symbol: "VACN.SW", role: "leader" },
      { symbol: "IFCN.SW", role: "proxy" },
      { symbol: "SMHN.DE", role: "laggard" },
    ],
    cyclePhaseFit: 48,
    uncertaintyVsRisk: "known_cycle",
    dataQuality: "medium",
    attentionNow: 46,
    sources: ["Thesis-Lab Fixture process_lockin/VAT", "WORK_VALUECHAIN_LAB_LOOKUP.md"],
  }),
  materialize({
    id: "physical-motion-strain-wave",
    thesis:
      "Strain-Wave-Getriebe sind der Engpass für präzise Roboterachsen: wenige qualifizierte Hersteller liefern die Untersetzung für Industrie- und Humanoide-Kinematiken.",
    counterThesis:
      "Kapazität in Japan und neue Zweitquellen plus alternative Getriebekonzepte begrenzen die Preissetzungsmacht, sobald die Roboterstückzahlen planbar werden.",
    techLayer: 2,
    revolutionScore: 2,
    pricedInPct: 61,
    pos: 0.44,
    grossUpsidePct: 55,
    valueChainStage: "physical_motion",
    industryKey: "auto-manufacturers",
    tickers: [
      { symbol: "6324.T", role: "leader" },
      { symbol: "6268.T", role: "leader" },
    ],
    cyclePhaseFit: 57,
    uncertaintyVsRisk: "uncertainty",
    dataQuality: "medium",
    attentionNow: 49,
    sources: ["Thesis-Lab Fixture physical_motion/Strain-Wave", "WORK_THESIS_LAB.md §4"],
  }),
  materialize({
    id: "farm-os-deere",
    thesis:
      "Deere Farm-OS wird zum Betriebssystem der Präzisionslandwirtschaft und monetarisiert die bereits installierte Maschinenbasis über Software und Autonomie.",
    counterThesis:
      "Offene ISOBUS-Schnittstellen und die Ökosysteme von AGCO und Trimble verhindern ein geschlossenes OS. Der Gewinn bleibt an den Eisen-Zyklus gekoppelt.",
    techLayer: 3,
    revolutionScore: 1,
    pricedInPct: 83,
    pos: 0.4,
    grossUpsidePct: 36,
    valueChainStage: "farm_os",
    industryKey: "food-agri",
    tickers: [
      { symbol: "DE", role: "leader" },
      { symbol: "AGCO", role: "laggard" },
    ],
    cyclePhaseFit: 66,
    uncertaintyVsRisk: "known_cycle",
    dataQuality: "high",
    attentionNow: 74,
    sources: ["Thesis-Lab Fixture farm_os/DE", "WORK_VALUECHAIN_LAB_LOOKUP.md"],
  }),
  materialize({
    id: "agent-liability-haftpflicht",
    thesis:
      "Agenten-Haftpflicht könnte eine eigene Versicherungslinie werden, sobald autonome Softwarehandlungen einen regulierten Haftungstatbestand haben.",
    counterThesis: "",
    techLayer: 2,
    revolutionScore: 1,
    pricedInPct: 22,
    pos: 0.25,
    grossUpsidePct: 40,
    valueChainStage: "agent_liability",
    industryKey: "payments-market-infra",
    tickers: [{ symbol: "CB", role: "proxy" }],
    cyclePhaseFit: 15,
    uncertaintyVsRisk: "uncertainty",
    dataQuality: "low",
    attentionNow: 18,
    sources: ["Thesis-Lab Fixture agent_liability/Haftpflicht — Datenlücke, keine belastbare Gegenthese"],
  }),
];

const EXPECTED_AMPEL: Record<string, Ampel> = {
  "memory-hbm": "red",
  "agent-runtime-saas": "yellow",
  "process-lockin-vat": "yellow",
  "physical-motion-strain-wave": "yellow",
  "farm-os-deere": "red",
  "agent-liability-haftpflicht": "gray",
};

for (const item of FIXTURES) {
  const expected = EXPECTED_AMPEL[item.id];
  if (item.infoCurve !== expected) {
    throw new Error(`Fixture ${item.id} ampel ${item.infoCurve} !== ${expected}`);
  }
  const net = round2(item.grossUpsidePct * (1 - item.pricedInPct / 100));
  const gb = round2(item.pos * net);
  if (item.netUpsidePct !== net || item.gbPct !== gb) {
    throw new Error(`Fixture ${item.id} economics drift`);
  }
}

export function listFixtures(filters?: { ampel?: Ampel; stage?: string; q?: string }): ThesisLabResult[] {
  const ampel = filters?.ampel;
  const stage = filters?.stage?.trim().toLowerCase();
  const q = filters?.q?.trim().toLowerCase();
  return FIXTURES.filter((item) => {
    if (ampel && item.infoCurve !== ampel) return false;
    if (stage && item.valueChainStage.toLowerCase() !== stage) return false;
    if (q) {
      const blob = [item.id, item.thesis, item.counterThesis, item.valueChainStage, ...item.tickers.map((t) => t.symbol)]
        .join(" ")
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  });
}

export function getById(id: string): ThesisLabResult | undefined {
  return FIXTURES.find((item) => item.id === id);
}

export function lookupByTicker(ticker: string): ThesisLabResult[] {
  const want = ticker.trim().toLowerCase();
  if (!want) return [];
  return FIXTURES.filter((item) => item.tickers.some((t) => t.symbol.toLowerCase() === want));
}

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function readNum(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Deterministic free-text evaluation. Short or explicitly uncertain text
 * returns gray (data gap). Otherwise a yellow result inside the formula
 * band (priced-in 45–65, coverage ≤ 69, layer ≥ 2). Overrides may move
 * the Ampel; the formula still decides.
 */
export function evaluateFreeText(thesis: string, overrides?: unknown): ThesisLabResult {
  const text = thesis.trim();
  const bag = overrides && typeof overrides === "object" ? (overrides as Record<string, unknown>) : {};
  const h = hashText(text);
  const vague =
    text.length < 48 ||
    /\b(unklar|unsicher|datenlücke|datenluecke|vielleicht|hypothetisch)\b/i.test(text);

  const pricedInPct = clamp(readNum(bag, "pricedInPct") ?? 45 + (h % 21), 0, 100);
  const pos = clamp(readNum(bag, "pos") ?? round2(0.4 + (h % 21) / 100), 0, 1);
  const grossUpsidePct = clamp(readNum(bag, "grossUpsidePct") ?? 30 + (h % 41), -50, 400);
  const techLayer = clamp(Math.round(readNum(bag, "techLayer") ?? (vague ? 2 : 3)), 1, 5) as TechLayer;
  const coverage = clamp(readNum(bag, "cyclePhaseFit") ?? (vague ? 20 : 50 + (h % 20)), 0, 100);
  const overrideCounter = typeof bag.counterThesis === "string" ? bag.counterThesis : undefined;
  const counterThesis = overrideCounter !== undefined
    ? overrideCounter
    : vague
      ? ""
      : `Gegenthese ohne Modelllauf: „${text.slice(0, 140)}“ ist teilweise eingepreist und hängt an Ausführung, Regulierung und Wettbewerb der bestehenden Schicht.`;
  const dataQuality: ThesisLabResult["dataQuality"] =
    bag.dataQuality === "high" || bag.dataQuality === "medium" || bag.dataQuality === "low"
      ? bag.dataQuality
      : vague
        ? "low"
        : "medium";

  const netUpsidePct = round2(grossUpsidePct * (1 - pricedInPct / 100));
  const gbPct = round2(pos * netUpsidePct);
  const infoCurve = ampelFrom({
    counterThesis,
    dataQuality,
    pricedInPct,
    coverage,
    techLayer,
  });

  return {
    id: `eval-${h.toString(16)}`,
    thesis: text,
    counterThesis,
    techLayer,
    revolutionScore: vague ? 0 : 1,
    pricedInPct: round2(pricedInPct),
    infoCurve,
    pos: round2(pos),
    grossUpsidePct: round2(grossUpsidePct),
    netUpsidePct,
    gbPct,
    valueChainStage: typeof bag.valueChainStage === "string" && bag.valueChainStage.trim() ? bag.valueChainStage.trim() : "unmapped",
    industryKey: typeof bag.industryKey === "string" && bag.industryKey.trim() ? bag.industryKey.trim() : "unmapped",
    tickers: [],
    cyclePhaseFit: round2(coverage),
    uncertaintyVsRisk: vague ? "uncertainty" : "mixed",
    dataQuality,
    curvePoints: curveEnding(pricedInPct, vague ? 20 : 40 + (h % 25)),
    sources: ["deterministische Freitext-Heuristik (kein LLM, kein FMP)"],
    asOf: AS_OF,
    llmUsed: false,
  };
}
