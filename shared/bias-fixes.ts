/**
 * Bias-Fixes für den entscheidungsrelevanten DCF (Offen_WORK_BIAS_FIXES_INVERSE_DCF.md).
 *
 * Eigene Schicht VOR dem bestehenden DCF. invertedDcf() und computeHardenedCRV()
 * bleiben unverändert: diese Datei mappt D− nicht ein zweites Mal auf g und r.
 * Wenn mindestens zwei Trigger aktiv sind, werden WACC und Wachstum nach den
 * Spec-Bändern gehärtet und der so berechnete FCFF-DCF wird die Basis für
 * Catalyst-Adjusted Target, entscheidungsrelevantes CRV und Fazit-Upside.
 *
 * Bandmitten (Spec nennt Spannen, Kalibrierung ist P2):
 *   WACC-Uplift  2 Trigger +0.625 pp, 3 +1.05 pp, 4+ +1.60 pp
 *   Terminal-Cap hohe Regulierung 2.15 %, Moat None + hohes ED 1.90 %
 *   Moat-Multiplikator Wide/Strong 0.475, Moderate 0.775, Narrow/Limited 1.075, None 1.30
 *   PESTEL linear innerhalb der Spec-Bänder
 */
import type { Catalyst, StockAnalysis } from "./schema";
import { buildDefaultDCFParams, calculateFCFFDCF, calculateReverseDCF } from "./valuation-signal";

export const WACC_UPLIFT_PP_2 = 0.625;
export const WACC_UPLIFT_PP_3 = 1.05;
export const WACC_UPLIFT_PP_4 = 1.6;
export const WACC_FLOOR_HEALTH_GOV = 7.5;
export const WACC_FLOOR_NO_MOAT_DAMAGE = 7.8;
export const TERMINAL_CAP_REGULATORY = 2.15;
export const TERMINAL_CAP_NO_MOAT = 1.9;
export const GSTAR_GAP_PP = 3;
export const MGMT_SPLIT = 0.6;
export const THESIS_SPLIT = 0.4;
export const KI_MOAT_DELTA_CAP = 1.5;

export type CatalystSource = "generic" | "llm";
export type MoatBucket = "wide" | "moderate" | "narrow" | "none" | "unknown";

export interface BiasCatalyst {
  name?: string;
  gb?: number;
  pos?: number;
  bruttoUpside?: number;
  direction?: string;
  flag?: string;
  newsSentiment?: string;
  generic?: boolean;
  tags?: string[];
}

export interface BiasTrigger {
  id: string;
  label: string;
  active: boolean;
  detail: string;
}

export interface BiasFacts {
  totalExpectedDamagePct: number;
  moatRating: string;
  governmentExposurePct: number;
  dcfUpsidePct: number;
  analystUpsidePct: number;
  activeGateIds: string[];
  conflictTexts: string[];
  reverseGStarPct: number | null;
  modelGrowthPct: number | null;
  pricingPowerGateActive: boolean;
  sector: string;
  industry: string;
  politicalExposureHigh: boolean;
  pestelExposureScore: number;
  managementScore: number | null;
  thesisScore: number | null;
  technicalComponent: number;
  positiveGbPct: number;
  baseWaccPct: number;
  revenueGrowthP1: number;
  revenueGrowthP2: number;
  terminalG: number;
}

export interface BiasAdjustment {
  switched: boolean;
  triggerCount: number;
  triggers: BiasTrigger[];
  waccUpliftPp: number;
  waccFloorPct: number | null;
  decisionWaccPct: number;
  growthFactor: number;
  revenueGrowthP1: number;
  revenueGrowthP2: number;
  terminalG: number;
  terminalCapPct: number | null;
}

export interface RuleMoat {
  baseScore: number;
  kiDelta: number;
  score: number;
  rating: "Wide" | "Narrow" | "None";
  notes: string[];
}

export interface BiasFixPayload {
  switched: boolean;
  triggerCount: number;
  triggers: BiasTrigger[];
  unadjustedPerShare: number;
  unadjustedWacc: number;
  unadjustedLabel: string;
  decisionPerShare: number;
  decisionWacc: number;
  decisionGrowthP1: number;
  decisionTerminalG: number;
  decisionUpsidePct: number;
  valuationBaseLabel: string;
  waccUpliftPp: number;
  waccFloorPct: number | null;
  growthFactor: number;
  positiveGbSum: number;
  catalystsSource: CatalystSource;
  modeLabel: string;
  moatRating: string;
  moatScore: number;
  moatMultiplier: number;
  pestelFactor: number;
  pestelExposureScore: number;
  quantitativeBase: number;
  managementAdjustment: number;
  thesisAdjustment: number;
  technicalComponent: number;
  catalystAdjustment: number;
  overallScore: number;
  overallRating: string;
  redFlags: string[];
  narrative: string[];
  politicalGovMention: boolean;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function moatBucket(rating: string | null | undefined): MoatBucket {
  const r = String(rating ?? "").toLowerCase();
  if (!r) return "unknown";
  if (r.includes("wide") || r.includes("strong")) return "wide";
  if (r.includes("moderate")) return "moderate";
  if (r.includes("narrow") || r.includes("limited")) return "narrow";
  if (r.includes("none") || r.includes("kein") || r.includes("no moat")) return "none";
  return "unknown";
}

export function moatMultiplier(rating: string | null | undefined): number {
  switch (moatBucket(rating)) {
    case "wide": return 0.475;
    case "moderate": return 0.775;
    case "narrow": return 1.075;
    case "none": return 1.3;
    default: return 1;
  }
}

/** PESTEL 0–10 → Dämpfungsfaktor, linear in den Spec-Bändern. */
export function pestelDampeningFactor(score: number): number {
  if (!finite(score)) return 1;
  const s = clamp(score, 0, 10);
  if (s <= 3) return 1;
  if (s <= 6) return +(0.96 - (s - 4) * 0.02).toFixed(4);
  if (s <= 8) return s <= 7 ? 0.88 : 0.82;
  return s <= 9 ? 0.78 : 0.7;
}

export function waccUpliftPp(triggerCount: number): number {
  if (triggerCount >= 4) return WACC_UPLIFT_PP_4;
  if (triggerCount === 3) return WACC_UPLIFT_PP_3;
  if (triggerCount === 2) return WACC_UPLIFT_PP_2;
  return 0;
}

export function isHealthcare(sector: string, industry: string): boolean {
  return /health|pharma|biotech|drug/.test(`${sector} ${industry}`.toLowerCase());
}

export function isNegativeCatalyst(c: BiasCatalyst | null | undefined): boolean {
  if (!c) return false;
  const direction = String(c.direction ?? "").toLowerCase();
  const flag = String(c.flag ?? "");
  if (direction === "negative" || direction === "down" || direction === "bearish") return true;
  if (flag === "▼" || flag.includes("▼")) return true;
  if (c.newsSentiment === "bearish") return true;
  if (finite(c.bruttoUpside) && c.bruttoUpside < 0) return true;
  if (Array.isArray(c.tags) && c.tags.some(t => /downside|negative|bear/i.test(String(t)))) return true;
  return false;
}

export function stampCatalyst<T extends BiasCatalyst>(c: T): T {
  if (!isNegativeCatalyst(c)) {
    return { ...c, direction: c.direction ?? "positive", flag: c.flag && c.flag !== "▼" ? c.flag : (c.flag ?? "▲") };
  }
  return { ...c, direction: "negative", flag: "▼" };
}

/** Variante A: ▼ trägt 0 zur positiven GB-Summe bei. */
export function upsideGb(c: BiasCatalyst | null | undefined): number {
  if (!c || isNegativeCatalyst(c)) return 0;
  return finite(c.gb) ? c.gb : 0;
}

export function sumUpsideGb(catalysts: BiasCatalyst[] | null | undefined): number {
  if (!Array.isArray(catalysts)) return 0;
  return catalysts.reduce((s, c) => s + upsideGb(c), 0);
}

export function catalystsModeLabel(source: CatalystSource, timestamp?: string | null): string {
  if (source === "llm") {
    const stand = timestamp && String(timestamp).trim() ? ` (Stand: ${String(timestamp).trim()})` : "";
    return `Katalysatoren: KI-firmenspezifisch${stand}`;
  }
  return "Katalysatoren: generisch (Sektor)";
}

export function overallRatingFromScore(score: number): string {
  if (score >= 8) return "ATTRAKTIV";
  if (score >= 6.5) return "LEICHT ATTRAKTIV";
  if (score >= 4.5) return "NEUTRAL";
  if (score >= 3) return "UNATTRAKTIV";
  return "STARK UNATTRAKTIV";
}

function gateIsRealityCheck(id: string): boolean {
  return id === "INVENTORY" || id === "PRICING_POWER" || /SEC|CONTRADICT/i.test(id);
}

export function evaluateBiasTriggers(facts: Pick<
  BiasFacts,
  | "totalExpectedDamagePct"
  | "moatRating"
  | "governmentExposurePct"
  | "dcfUpsidePct"
  | "analystUpsidePct"
  | "activeGateIds"
  | "conflictTexts"
  | "reverseGStarPct"
  | "modelGrowthPct"
>): BiasTrigger[] {
  const bucket = moatBucket(facts.moatRating);
  const moatWeak = bucket === "none" || bucket === "narrow";
  const divergence = Math.abs(facts.dcfUpsidePct - facts.analystUpsidePct) >= 80;
  const gateHit = facts.activeGateIds.some(gateIsRealityCheck) || facts.conflictTexts.length > 0;
  const gStarLow = finite(facts.reverseGStarPct)
    && finite(facts.modelGrowthPct)
    && facts.modelGrowthPct - facts.reverseGStarPct >= GSTAR_GAP_PP;

  return [
    {
      id: "expected_damage",
      label: "Total Expected Damage",
      active: facts.totalExpectedDamagePct >= 25,
      detail: `ED ${facts.totalExpectedDamagePct.toFixed(1)}% (Schwelle 25%)`,
    },
    {
      id: "moat",
      label: "Moat Rating",
      active: moatWeak,
      detail: `Moat ${facts.moatRating || "n/v"}`,
    },
    {
      id: "government",
      label: "Government Exposure",
      active: facts.governmentExposurePct >= 25,
      detail: `Gov ${facts.governmentExposurePct.toFixed(1)}% (Schwelle 25%)`,
    },
    {
      id: "dcf_divergence",
      label: "DCF vs Analyst",
      active: divergence,
      detail: `Δ ${Math.abs(facts.dcfUpsidePct - facts.analystUpsidePct).toFixed(1)} Pp (Schwelle 80)`,
    },
    {
      id: "gates",
      label: "Existing Gates",
      active: gateHit,
      detail: gateHit
        ? `aktiv: ${[...facts.activeGateIds.filter(gateIsRealityCheck), ...(facts.conflictTexts.length ? ["SEC/Konflikt"] : [])].join(", ")}`
        : "keine Inventory-/Pricing-Power-/SEC-Gates",
    },
    {
      id: "reverse_g",
      label: "Reverse DCF g*",
      active: gStarLow,
      detail: finite(facts.reverseGStarPct) && finite(facts.modelGrowthPct)
        ? `g* ${facts.reverseGStarPct.toFixed(1)}% vs Modell ${facts.modelGrowthPct.toFixed(1)}%`
        : "g* oder Modellwachstum fehlt",
    },
  ];
}

export function growthHaircutFactor(facts: Pick<BiasFacts, "totalExpectedDamagePct" | "moatRating" | "pricingPowerGateActive">): number {
  let factor = 1;
  if (facts.totalExpectedDamagePct > 35) factor *= 0.75;
  else if (facts.totalExpectedDamagePct >= 25) factor *= 0.85;
  if (moatBucket(facts.moatRating) === "none") factor *= 0.9;
  if (facts.pricingPowerGateActive) factor *= 0.9;
  return factor;
}

export function terminalGrowthCap(facts: Pick<BiasFacts, "moatRating" | "totalExpectedDamagePct" | "governmentExposurePct" | "politicalExposureHigh">): number | null {
  const caps: number[] = [];
  const highReg = facts.governmentExposurePct >= 25 || facts.politicalExposureHigh;
  if (highReg) caps.push(TERMINAL_CAP_REGULATORY);
  if (moatBucket(facts.moatRating) === "none" && facts.totalExpectedDamagePct >= 30) caps.push(TERMINAL_CAP_NO_MOAT);
  if (caps.length === 0) return null;
  return Math.min(...caps);
}

export function waccFloorPct(facts: Pick<BiasFacts, "sector" | "industry" | "governmentExposurePct" | "moatRating" | "totalExpectedDamagePct">): number | null {
  const floors: number[] = [];
  if (isHealthcare(facts.sector, facts.industry) && facts.governmentExposurePct >= 25) floors.push(WACC_FLOOR_HEALTH_GOV);
  if (moatBucket(facts.moatRating) === "none" && facts.totalExpectedDamagePct >= 30) floors.push(WACC_FLOOR_NO_MOAT_DAMAGE);
  if (floors.length === 0) return null;
  return Math.max(...floors);
}

export function applyBiasAdjustment(facts: BiasFacts): BiasAdjustment {
  const triggers = evaluateBiasTriggers(facts);
  const triggerCount = triggers.filter(t => t.active).length;
  const switched = triggerCount >= 2;
  if (!switched) {
    return {
      switched: false,
      triggerCount,
      triggers,
      waccUpliftPp: 0,
      waccFloorPct: null,
      decisionWaccPct: facts.baseWaccPct,
      growthFactor: 1,
      revenueGrowthP1: facts.revenueGrowthP1,
      revenueGrowthP2: facts.revenueGrowthP2,
      terminalG: facts.terminalG,
      terminalCapPct: null,
    };
  }
  const uplift = waccUpliftPp(triggerCount);
  const floor = waccFloorPct(facts);
  const decisionWaccPct = Math.max(facts.baseWaccPct + uplift, floor ?? 0);
  const growthFactor = growthHaircutFactor(facts);
  const cap = terminalGrowthCap(facts);
  return {
    switched: true,
    triggerCount,
    triggers,
    waccUpliftPp: uplift,
    waccFloorPct: floor,
    decisionWaccPct,
    growthFactor,
    revenueGrowthP1: facts.revenueGrowthP1 * growthFactor,
    revenueGrowthP2: facts.revenueGrowthP2 * growthFactor,
    terminalG: cap == null ? facts.terminalG : Math.min(facts.terminalG, cap),
    terminalCapPct: cap,
  };
}

export function computeOverallScore(input: {
  quantitativeBase: number;
  pestelFactor: number;
  managementScore: number | null;
  thesisScore: number | null;
  moatMultiplier: number;
  technicalComponent: number;
  positiveGbPct: number;
}): {
  quantitativeBase: number;
  managementAdjustment: number;
  thesisAdjustment: number;
  technicalComponent: number;
  catalystAdjustment: number;
  overallScore: number;
  overallRating: string;
} {
  const managementAdjustment = finite(input.managementScore)
    ? (input.managementScore - 5) * MGMT_SPLIT * input.moatMultiplier
    : 0;
  const thesisAdjustment = finite(input.thesisScore)
    ? (input.thesisScore - 5) * THESIS_SPLIT * input.moatMultiplier
    : 0;
  const catalystAdjustment = input.positiveGbPct / 10;
  const overallScore = input.quantitativeBase * input.pestelFactor
    + managementAdjustment
    + thesisAdjustment
    + input.technicalComponent
    + catalystAdjustment;
  return {
    quantitativeBase: input.quantitativeBase,
    managementAdjustment,
    thesisAdjustment,
    technicalComponent: input.technicalComponent,
    catalystAdjustment,
    overallScore,
    overallRating: overallRatingFromScore(overallScore),
  };
}

function textHas(hay: string, re: RegExp): boolean {
  return re.test(hay);
}

export function computeRuleBasedMoat(input: {
  grossMarginPct: number | null;
  roic5YPct: number | null;
  sectorMedianRoic5YPct: number | null;
  fcfMarginStableOrRising: boolean | null;
  switchingOrNetwork: boolean | null;
  intangiblesStrong: boolean | null;
  governmentExposurePct: number;
  highRivalry: boolean;
  llmMode: boolean;
  existingRating?: string | null;
}): RuleMoat {
  const notes: string[] = [];
  let base = 0;
  if (finite(input.grossMarginPct) && input.grossMarginPct > 60) {
    base += 1;
    notes.push("Bruttomarge > 60%");
  }
  if (finite(input.roic5YPct) && finite(input.sectorMedianRoic5YPct) && input.roic5YPct > input.sectorMedianRoic5YPct + 5) {
    base += 1;
    notes.push("ROIC 5Y über Sektor-Median + 5 Pp");
  }
  if (input.fcfMarginStableOrRising === true) {
    base += 0.5;
    notes.push("FCF-Marge stabil oder steigend");
  }
  if (input.switchingOrNetwork === true) {
    base += 1;
    notes.push("Switching Costs oder Netzwerkeffekte");
  }
  if (input.intangiblesStrong === true) {
    base += 1;
    notes.push("Immaterielle Assets");
  }
  if (input.governmentExposurePct >= 25) {
    base -= 1;
    notes.push("Government Exposure ≥ 25%");
  }
  if (input.highRivalry) {
    base -= 1;
    notes.push("Hohe Rivalität (Porter)");
  }

  let kiDelta = 0;
  if (input.llmMode && input.existingRating) {
    const rank: Record<MoatBucket, number> = { none: 0, unknown: 1, narrow: 1, moderate: 2, wide: 3 };
    const ruleRating = base >= 3 ? "wide" : base >= 1 ? "narrow" : "none";
    const existing = moatBucket(input.existingRating);
    kiDelta = clamp((rank[existing] - rank[ruleRating]) * 0.5, -KI_MOAT_DELTA_CAP, KI_MOAT_DELTA_CAP);
    if (kiDelta !== 0) notes.push(`KI-Beitrag ${kiDelta > 0 ? "+" : ""}${kiDelta.toFixed(1)} (Deckel ±${KI_MOAT_DELTA_CAP})`);
  }
  const score = base + kiDelta;
  const rating: RuleMoat["rating"] = score >= 3 ? "Wide" : score >= 1 ? "Narrow" : "None";
  return { baseScore: base, kiDelta, score, rating, notes };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function politicalHigh(data: StockAnalysis): boolean {
  const factors = data.pestelAnalysis?.factors ?? [];
  return factors.some(f => /politic/i.test(String(f.category)) && f.exposureRating === "Hoch");
}

function technicalComponentOf(data: StockAnalysis): number {
  const s = data.technicalIndicators?.currentStatus;
  if (!s) return 0;
  if (s.buySignal) return 0.5;
  if (!s.priceAboveMA200 && !s.ma50AboveMA200) return -0.5;
  return 0;
}

export function ruleMoatFromAnalysis(data: StockAnalysis): RuleMoat {
  const gross = data.financialStatements?.incomeStatement?.grossMargin;
  const subjectRoic = data.peerComparison?.subject?.roic5Y;
  const peerRoics = (data.peerComparison?.peers ?? [])
    .map(p => p.roic5Y)
    .filter((n): n is number => finite(n));
  const desc = `${data.description ?? ""} ${(data.moatAssessment?.moatSources ?? []).join(" ")}`;
  const rivalry = (data.moatAssessment?.porterForces ?? []).some(f =>
    /rival|wettbewerb/i.test(f.force) && (f.score >= 4 || /hoch|high/i.test(f.rating)),
  );
  const fcfStable = data.fcfMarginYoyAvailable === false || data.fcfMarginYoyPp == null
    ? null
    : data.fcfMarginYoyPp >= -1;
  return computeRuleBasedMoat({
    grossMarginPct: finite(gross) ? gross : null,
    roic5YPct: finite(subjectRoic) ? subjectRoic : null,
    sectorMedianRoic5YPct: median(peerRoics),
    fcfMarginStableOrRising: fcfStable,
    switchingOrNetwork: textHas(desc, /switching cost|netzwerk|network effect|platform|marketplace|sticky|subscription/i) ? true : null,
    intangiblesStrong: textHas(desc, /patent|brand|proprietary|intellectual property|marke|trade ?mark/i) ? true : null,
    governmentExposurePct: finite(data.governmentExposure) ? data.governmentExposure : 0,
    highRivalry: rivalry,
    llmMode: data.llmMode === true || data.catalystsSource === "llm",
    existingRating: data.moatAssessment?.overallRating ?? data.moatRating ?? null,
  });
}

function emptyPayload(data: Partial<StockAnalysis>, reason: string): BiasFixPayload {
  const source: CatalystSource = data.catalystsSource === "llm" || data.llmMode ? "llm" : "generic";
  const ts = data.growthThesisGeneratedAt ?? data.dataTimestamp ?? null;
  return {
    switched: false,
    triggerCount: 0,
    triggers: [],
    unadjustedPerShare: 0,
    unadjustedWacc: 0,
    unadjustedLabel: "Unadjusted / Extrapolative",
    decisionPerShare: 0,
    decisionWacc: 0,
    decisionGrowthP1: 0,
    decisionTerminalG: 0,
    decisionUpsidePct: 0,
    valuationBaseLabel: "Conservative DCF",
    waccUpliftPp: 0,
    waccFloorPct: null,
    growthFactor: 1,
    positiveGbSum: sumUpsideGb(data.catalysts),
    catalystsSource: source,
    modeLabel: catalystsModeLabel(source, ts),
    moatRating: data.moatRating || "n/v",
    moatScore: 0,
    moatMultiplier: moatMultiplier(data.moatRating),
    pestelFactor: 1,
    pestelExposureScore: finite(data.pestelAnalysis?.geopoliticalScore) ? data.pestelAnalysis!.geopoliticalScore : 0,
    quantitativeBase: 5,
    managementAdjustment: 0,
    thesisAdjustment: 0,
    technicalComponent: 0,
    catalystAdjustment: 0,
    overallScore: 5,
    overallRating: "NEUTRAL",
    redFlags: [reason],
    narrative: [
      `${data.companyName || data.ticker || "Titel"}: Bias-Basis nicht berechenbar (${reason}).`,
      "Bewertung bleibt der Conservative DCF, solange die Härtung keine vollständige FCFF-Basis hat.",
      "Technik und Timing bleiben ein weicher Zusatz, kein hartes Gate.",
      catalystsModeLabel(source, ts),
    ],
    politicalGovMention: false,
  };
}

export function buildBiasDecision(data: StockAnalysis): BiasFixPayload {
  if (!data?.sectorProfile?.growthAssumptions || !Array.isArray(data.historicalPrices)) {
    return emptyPayload(data, "Sektorprofil oder Kurshistorie fehlt");
  }
  const baseParams = buildDefaultDCFParams(data);
  const unadjusted = calculateFCFFDCF(baseParams);
  const price = finite(data.currentPrice) && data.currentPrice > 0 ? data.currentPrice : 0;
  const dcfUpside = price > 0 ? (unadjusted.perShare / price - 1) * 100 : 0;
  const analyst = finite(data.analystPT?.median) ? data.analystPT.median : price;
  const analystUpside = price > 0 ? (analyst / price - 1) * 100 : 0;
  const totalEd = (data.risks ?? []).reduce((s, r) => s + (finite(r.expectedDamage) ? r.expectedDamage : 0), 0);
  const moat = ruleMoatFromAnalysis(data);
  const activeGateIds = (data.scoring?.gates ?? []).filter(g => g.active).map(g => g.id);
  const conflictTexts = data.scoring?.conflictTexts ?? [];
  const pricingPower = activeGateIds.includes("PRICING_POWER");
  const pestelScore = finite(data.pestelAnalysis?.geopoliticalScore) ? data.pestelAnalysis.geopoliticalScore : 0;
  const source: CatalystSource = data.catalystsSource === "llm" || data.llmMode ? "llm" : "generic";
  const timestamp = data.growthThesisGeneratedAt ?? data.dataTimestamp ?? null;
  const positiveGbSum = sumUpsideGb(data.catalysts);

  let reverseG: number | null = finite((data as { impliedGStar?: number }).impliedGStar)
    ? (data as { impliedGStar?: number }).impliedGStar!
    : null;
  if (reverseG == null) {
    try {
      const rev = calculateReverseDCF({
        currentPrice: data.currentPrice,
        fcfBase: data.fcfTTM,
        wacc: unadjusted.wacc,
        sharesOutstanding: data.sharesOutstanding,
        netDebt: data.totalDebt - data.cashEquivalents,
        fcfHaircut: data.fcfHaircut ?? 0,
        sectorG1: data.sectorProfile.growthAssumptions.g1 ?? 0,
        epsGrowthNext5Y: data.epsGrowth5Y ?? 0,
      });
      reverseG = finite(rev.impliedGrowth) ? rev.impliedGrowth : null;
    } catch {
      reverseG = null;
    }
  }

  const facts: BiasFacts = {
    totalExpectedDamagePct: totalEd,
    moatRating: moat.rating,
    governmentExposurePct: finite(data.governmentExposure) ? data.governmentExposure : 0,
    dcfUpsidePct: dcfUpside,
    analystUpsidePct: analystUpside,
    activeGateIds,
    conflictTexts,
    reverseGStarPct: reverseG,
    modelGrowthPct: baseParams.revenueGrowthP1,
    pricingPowerGateActive: pricingPower,
    sector: data.sector ?? "",
    industry: data.industry ?? "",
    politicalExposureHigh: politicalHigh(data),
    pestelExposureScore: pestelScore,
    managementScore: finite(data.managementScore) ? data.managementScore : null,
    thesisScore: finite(data.thesisStrengthScore) ? data.thesisStrengthScore : null,
    technicalComponent: technicalComponentOf(data),
    positiveGbPct: positiveGbSum,
    baseWaccPct: unadjusted.wacc,
    revenueGrowthP1: baseParams.revenueGrowthP1,
    revenueGrowthP2: baseParams.revenueGrowthP2,
    terminalG: baseParams.terminalG,
  };
  const adj = applyBiasAdjustment(facts);
  const decision = adj.switched
    ? calculateFCFFDCF({
        ...baseParams,
        waccOverride: adj.decisionWaccPct,
        revenueGrowthP1: adj.revenueGrowthP1,
        revenueGrowthP2: adj.revenueGrowthP2,
        terminalG: adj.terminalG,
      })
    : unadjusted;
  const decisionUpside = price > 0 ? (decision.perShare / price - 1) * 100 : 0;
  const pestelFactor = pestelDampeningFactor(pestelScore);
  const mult = moatMultiplier(moat.rating);
  const quant = clamp(5 + decisionUpside / 20, 0, 10);
  const score = computeOverallScore({
    quantitativeBase: quant,
    pestelFactor,
    managementScore: facts.managementScore,
    thesisScore: facts.thesisScore,
    moatMultiplier: mult,
    technicalComponent: facts.technicalComponent,
    positiveGbPct: positiveGbSum,
  });
  const politicalGovMention = facts.politicalExposureHigh && facts.governmentExposurePct >= 25;
  const redFlags: string[] = [];
  if (moat.rating === "None") redFlags.push("Kein Moat");
  if (totalEd >= 25) redFlags.push(`Expected Damage ${totalEd.toFixed(1)}%`);
  if (adj.switched) redFlags.push("DCF-Extrapolationsrisiko — Basis ist gehärtet");
  if (finite(facts.managementScore) && facts.managementScore < 4) redFlags.push(`Management-Score ${facts.managementScore.toFixed(1)}`);
  if (facts.governmentExposurePct >= 25) redFlags.push(`Government Exposure ${facts.governmentExposurePct.toFixed(0)}%`);
  if (adj.triggers.find(t => t.id === "dcf_divergence")?.active) redFlags.push("DCF-Upside weicht stark vom Analysten-Upside ab");

  const tech = data.technicalIndicators?.currentStatus;
  const techSentence = !tech
    ? "Technische Lage ist nicht belegt und bleibt ein weicher Zusatz."
    : tech.buySignal
      ? "Technisch liegt ein Buy-Signal (Kurs über MA200, MA50 über MA200, MACD positiv)."
      : "Technisch fehlt ein klares Buy-Signal; das Timing ist ein weicher Zusatz und kein hartes Gate.";
  const valuationSentence = adj.switched
    ? `Die entscheidungsrelevante Bewertung ist der gehärtete Inverse-DCF bei ${decision.perShare.toFixed(2)} (WACC ${decision.wacc.toFixed(2)}%, g1 ${adj.revenueGrowthP1.toFixed(1)}%). Der unadjustierte Conservative DCF (${unadjusted.perShare.toFixed(2)}) ist Unadjusted / Extrapolative und treibt das Upside nicht.`
    : `Die entscheidungsrelevante Bewertung ist der Conservative DCF bei ${unadjusted.perShare.toFixed(2)} (WACC ${unadjusted.wacc.toFixed(2)}%). Ein Wechsel auf den gehärteten Inverse-DCF ist nicht ausgelöst (${adj.triggerCount} Trigger).`;
  const business = `${data.companyName || data.ticker} (${data.ticker}): Moat ${moat.rating} (Score ${moat.score.toFixed(1)}${moat.notes.length ? `; ${moat.notes.slice(0, 3).join(", ")}` : ""}).`;
  const mode = catalystsModeLabel(source, timestamp);
  const narrative = [business, valuationSentence, techSentence, mode];
  if (redFlags.length > 0 || politicalGovMention) {
    const bits = [...redFlags];
    if (politicalGovMention) bits.push("Political ist hoch und Government Exposure liegt bei mindestens 25%");
    narrative.push(`Größte Red Flags: ${bits.join("; ")}.`);
  }

  return {
    switched: adj.switched,
    triggerCount: adj.triggerCount,
    triggers: adj.triggers,
    unadjustedPerShare: unadjusted.perShare,
    unadjustedWacc: unadjusted.wacc,
    unadjustedLabel: "Unadjusted / Extrapolative",
    decisionPerShare: decision.perShare,
    decisionWacc: decision.wacc,
    decisionGrowthP1: adj.revenueGrowthP1,
    decisionTerminalG: adj.terminalG,
    decisionUpsidePct: decisionUpside,
    valuationBaseLabel: adj.switched ? "Gehärteter Inverse-DCF" : "Conservative DCF",
    waccUpliftPp: adj.waccUpliftPp,
    waccFloorPct: adj.waccFloorPct,
    growthFactor: adj.growthFactor,
    positiveGbSum,
    catalystsSource: source,
    modeLabel: mode,
    moatRating: moat.rating,
    moatScore: moat.score,
    moatMultiplier: mult,
    pestelFactor,
    pestelExposureScore: pestelScore,
    quantitativeBase: score.quantitativeBase,
    managementAdjustment: score.managementAdjustment,
    thesisAdjustment: score.thesisAdjustment,
    technicalComponent: score.technicalComponent,
    catalystAdjustment: score.catalystAdjustment,
    overallScore: score.overallScore,
    overallRating: score.overallRating,
    redFlags,
    narrative: narrative.slice(0, 5),
    politicalGovMention,
  };
}

/** Schreibt Katalysator-Stempel, Quelle und biasFix auf dasselbe Objekt (Cache-Referenz). */
export function applyBiasFix<T extends StockAnalysis>(analysis: T): T & { biasFix: BiasFixPayload; catalystsSource: CatalystSource } {
  const catalysts = Array.isArray(analysis.catalysts)
    ? analysis.catalysts.map(c => stampCatalyst(c))
    : analysis.catalysts;
  const catalystsSource: CatalystSource =
    analysis.catalystsSource === "llm" || analysis.catalystsSource === "generic"
      ? analysis.catalystsSource
      : analysis.llmMode ? "llm" : "generic";
  const target = analysis as T & { biasFix: BiasFixPayload; catalystsSource: CatalystSource };
  target.catalysts = catalysts as T["catalysts"];
  target.catalystsSource = catalystsSource;
  target.biasFix = buildBiasDecision(target);
  return target;
}
