/**
 * Bilanz-Kalibrierung des FCFF-DCF (Offen_WORK_DCF_BILANZ_KALIBRIERUNG, Draft 1).
 *
 * Eine Stelle für die Konstanten. `enabled` bleibt false, bis Philip die
 * Vorher/Nachher-Tabelle freigibt. Bei false darf kein Aufrufer die
 * bestehenden DCF-, Score- oder Moat-Zahlen ändern.
 *
 * Draft-1-Grenzen (Scope-Klärung 23:08):
 * - g1-Anker nur letztes Ist-YoY, sonst Sektor-g1. Konsens/Median nicht lesen.
 * - Stufe nur aus der absoluten Note financialStatements.health.
 * - g* auf dem 3-Monats-Schnitt von historicalPrices, wenn das Fenster dort liegt.
 * - Soll 2 ist keine Abnahme und kein Fit-Ziel.
 */
export const DCF_CALIBRATION = {
  enabled: false,
  /** Aktiver Pfad ist stetig. dreiStufen ist derselbe Rechenweg für die Vergleichstabelle. */
  stageModel: "stetig" as "stetig" | "dreiStufen",
  /** Testschalter: g* auf dem Tageskurs, auch wenn historicalPrices ein 3-Monats-Fenster hat. */
  forceSpotPrice: false,
  healthLevel: { Excellent: 0, Good: 1, Moderate: 2, Weak: 3, Critical: 4 },
  waccPerLevelPp: 0.40,
  g1HaircutPerLevel: 0.08,
  gStarCapFromLevel: 2,
  terminalCapPct: 2.5,
  terminalWaccGapPp: 3.0,
  tvShareWarnPct: 75,
  /** 1 = KI-Nachlauf ±1,5 bleibt voll wirksam und wird nur ausgewiesen. */
  moatFaktor: 1,
  gStarSmoothMonths: 3,
  gStarSmoothMinPoints: 40,
  gStarSmoothMinSpanDays: 60,
};

export type StageModel = typeof DCF_CALIBRATION.stageModel;
export type HealthName = keyof typeof DCF_CALIBRATION.healthLevel;
export type CalibrationRelation = "ersetzt" | "ergaenzt";

export interface CalibrationRule {
  id: string;
  relation: CalibrationRelation;
  ref: string;
  detail: string;
}

export interface GrowthAnchorInput {
  /** financialStatements.incomeStatement.revenueGrowth, Prozent. */
  istYoY: number | null;
  /** sectorProfile.growthAssumptions.g1, Prozent. */
  sectorG1: number | null;
  /**
   * Reserviert für den Folgeschritt. Draft 1 liest die Felder nicht
   * und füllt sie nicht mit einer Schätzung.
   */
  consensus?: {
    years2to3?: number | null;
    medianYears3to5?: number | null;
    guidanceMid?: number | null;
  } | null;
}

export interface GrowthAnchor {
  gAnker: number | null;
  source: "ist-yoy" | "sektor-g1" | "fehlt";
  detail: string;
}

export interface GStarPrice {
  price: number;
  source: "3m-avg" | "tageskurs";
  points: number;
  from: string | null;
  to: string | null;
  reason: string;
}

export const GSTAR_SPOT_DEVIATION =
  "Abweichung: g* rechnet auf dem Tageskurs. Ein 3-Monats-Fenster liegt in historicalPrices nicht vor; Glättung bleibt Folgeschritt.";

export interface DcfCalibrationView {
  applied: boolean;
  skipReason: string | null;
  health: string | null;
  lage: number | null;
  model: StageModel;
  waccRohPct: number;
  waccAddPp: number;
  waccPct: number;
  g1Before: number;
  g1After: number;
  terminalBefore: number;
  terminalAfter: number;
  anchorSource: GrowthAnchor["source"];
  anchorDetail: string;
  gAnker: number | null;
  istYoY: number | null;
  gStarPct: number | null;
  gStarPriceSource: GStarPrice["source"];
  gStarPrice: number;
  gStarPriceDetail: string;
  gStarCapApplied: boolean;
  gStarCapNote: string;
  rules: CalibrationRule[];
  /** TV-Anteil des entscheidungsrelevanten FCFF, vom Aufrufer gesetzt. */
  tvSharePct: number | null;
  biasUpliftAppliedPp: number;
  biasUpliftReplacedPp: number;
  growthFactor: number;
  g1AfterBias: number;
  /** g1Before − g1 nach Kalibrierung und growthHaircutFactor. */
  gDropPp: number;
  /** Health-WACC + tatsächlich angewendeter Bias-WACC-Sprung. */
  waccSumPp: number;
  moatKiDeltaRoh: number | null;
  moatFaktor: number | null;
  moatKiApplied: number | null;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function levelOfHealth(health: HealthName): number {
  switch (health) {
    case "Excellent":
    case "Good":
    case "Moderate":
    case "Weak":
    case "Critical":
      return DCF_CALIBRATION.healthLevel[health];
    default: {
      const unknown: never = health;
      return unknown;
    }
  }
}

export function healthLevelOrNull(health: string | null | undefined): number | null {
  switch (health) {
    case "Excellent":
    case "Good":
    case "Moderate":
    case "Weak":
    case "Critical":
      return levelOfHealth(health);
    default:
      return null;
  }
}

export function waccAddPpForLevel(level: number, model: StageModel): number {
  switch (model) {
    case "stetig":
      return DCF_CALIBRATION.waccPerLevelPp * level;
    case "dreiStufen":
      if (level <= 1) return 0;
      if (level === 2) return 1;
      return 2;
    default: {
      const unknown: never = model;
      return unknown;
    }
  }
}

/** Einziger Anker-Zugriff. Später kann der Körper Konsens vor Ist setzen, ohne die Aufrufer umzubauen. */
export function resolveGrowthAnchor(input: GrowthAnchorInput): GrowthAnchor {
  const consensusIgnored = input.consensus != null
    ? " Übergebene Konsensfelder werden in Draft 1 nicht gelesen."
    : "";
  if (finite(input.istYoY)) {
    return {
      gAnker: input.istYoY,
      source: "ist-yoy",
      detail: "Letztes Ist-YoY aus financialStatements.incomeStatement.revenueGrowth." + consensusIgnored,
    };
  }
  if (finite(input.sectorG1)) {
    return {
      gAnker: input.sectorG1,
      source: "sektor-g1",
      detail: "Ist-YoY fehlt. Ersatz sectorProfile.growthAssumptions.g1, nicht geschätzt." + consensusIgnored,
    };
  }
  return {
    gAnker: null,
    source: "fehlt",
    detail: "Ist-YoY und Sektor-g1 fehlen. Kein Anker geschätzt. Konsens/Median sind nicht persistiert." + consensusIgnored,
  };
}

function shiftMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1 + months, d || 1));
  return dt.toISOString().slice(0, 10);
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
}

export function resolveGStarPrice(input: {
  spot: number;
  historicalPrices?: Array<{ date?: string; close?: number }> | null;
  forceSpot?: boolean;
}): GStarPrice {
  const spot = input.spot;
  if (input.forceSpot || DCF_CALIBRATION.forceSpotPrice) {
    return {
      price: spot,
      source: "tageskurs",
      points: 0,
      from: null,
      to: null,
      reason: `${GSTAR_SPOT_DEVIATION} Schalter forceSpotPrice.`,
    };
  }
  const rows = (input.historicalPrices ?? [])
    .filter((p): p is { date: string; close: number } =>
      !!p && typeof p.date === "string" && finite(p.close) && p.close > 0 && /^\d{4}-\d{2}-\d{2}/.test(p.date))
    .map(p => ({ date: p.date.slice(0, 10), close: p.close }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length === 0 || !finite(spot) || spot <= 0) {
    return {
      price: spot,
      source: "tageskurs",
      points: rows.length,
      from: null,
      to: null,
      reason: `${GSTAR_SPOT_DEVIATION} Keine verwertbaren Schlüsse in historicalPrices.`,
    };
  }
  const last = rows[rows.length - 1].date;
  const start = shiftMonths(last, -DCF_CALIBRATION.gStarSmoothMonths);
  const win = rows.filter(p => p.date >= start && p.date <= last);
  const span = win.length >= 2 ? (utcDay(win[win.length - 1].date) - utcDay(win[0].date)) / 86_400_000 : 0;
  if (win.length < DCF_CALIBRATION.gStarSmoothMinPoints || span < DCF_CALIBRATION.gStarSmoothMinSpanDays) {
    return {
      price: spot,
      source: "tageskurs",
      points: win.length,
      from: win[0]?.date ?? null,
      to: win[win.length - 1]?.date ?? null,
      reason: `${GSTAR_SPOT_DEVIATION} Fenster ${win.length} Schlüsse, Spanne ${span.toFixed(0)} Tage.`,
    };
  }
  const avg = win.reduce((sum, p) => sum + p.close, 0) / win.length;
  return {
    price: avg,
    source: "3m-avg",
    points: win.length,
    from: win[0].date,
    to: win[win.length - 1].date,
    reason: `3-Monats-Durchschnitt aus historicalPrices ${win[0].date}–${win[win.length - 1].date} (${win.length} Schlüsse, Analyze-Payload).`,
  };
}

/** Dieselbe Umstellung wie calculateReverseDCF: g* = WACC − FCF/EV, FCF nach Haircut. */
export function impliedGStarPct(input: {
  price: number;
  fcf: number;
  waccPct: number;
  shares: number;
  netDebt: number;
  fcfHaircutPct?: number;
}): number | null {
  const ev = input.price * input.shares + input.netDebt;
  if (!ev || ev <= 0 || !Number.isFinite(ev) || !input.price || !input.shares) return null;
  const adjusted = input.fcf * (1 - (input.fcfHaircutPct ?? 0) / 100);
  const g = (input.waccPct / 100 - adjusted / ev) * 100;
  return Number.isFinite(g) ? g : null;
}

export function calibrationRules(model: StageModel): CalibrationRule[] {
  const waccDetail = model === "stetig"
    ? "WACC-Sprung +0,625/+1,05/+1,6 Pp nach Triggerzahl wird nicht addiert. Stattdessen WACC += 0,40 Pp × Stufe."
    : "Dieselbe Ersetzung mit 3 Stufen auf der absoluten Note: Excellent/Good +0, Moderate +1, Weak/Critical +2 Pp.";
  return [
    {
      id: "wacc-stufe",
      relation: "ersetzt",
      ref: "shared/bias-fixes.ts:372-407",
      detail: waccDetail,
    },
    {
      id: "g1-haircut",
      relation: "ersetzt",
      ref: "shared/bias-fixes.ts:372-407",
      detail: "g1 × (1 − 0,08 × Stufe) und min(g1Modell, resolveGrowthAnchor()) ersetzen den pauschalen Trigger-g-Schnitt für die Finanzlage.",
    },
    {
      id: "growth-haircut-factor",
      relation: "ergaenzt",
      ref: "shared/bias-fixes.ts:372-407",
      detail: "growthHaircutFactor (Schaden, Moat None, Pricing-Power) bleibt und multipliziert das kalibrierte g1 genau einmal.",
    },
    {
      id: "g-star-cap",
      relation: "ersetzt",
      ref: "shared/bias-fixes.ts:372-407",
      detail: "Ab Stufe 2 zusätzlich g1 ≤ max(Ist-YoY, g*). reverse_g bleibt sichtbar, sein WACC-Sprung wird nicht zusätzlich gelegt.",
    },
    {
      id: "terminal-cap",
      relation: "ersetzt",
      ref: "shared/bias-fixes.ts:372-407",
      detail: "terminal ≤ min(bisher, 2,5, WACC − 3 Pp).",
    },
    {
      id: "terminal-moat-reg",
      relation: "ergaenzt",
      ref: "shared/bias-fixes.ts:372-407",
      detail: "terminalGrowthCap (Regulierung 2,15 %, Moat None + Schaden 1,90 %) bleibt zusätzliches min und greift wie bisher nur bei ≥2 Triggern.",
    },
    {
      id: "wacc-floor",
      relation: "ergaenzt",
      ref: "shared/bias-fixes.ts:372-407",
      detail: "waccFloorPct (Healthcare/Gov 7,5 %, Moat None + Schaden 7,8 %) bleibt.",
    },
    {
      id: "moat-ki",
      relation: "ergaenzt",
      ref: "shared/bias-fixes.ts:499-505",
      detail: "moatFaktor=1: KI-Nachlauf ±1,5 bleibt score-wirksam und wird ausgewiesen. Eine Änderung braucht eine separate Freigabe.",
    },
  ];
}

export function calibrateDcfTerms(input: {
  health: string | null;
  level: number | null;
  model: StageModel;
  g1Model: number;
  terminalModel: number;
  waccRohPct: number;
  anchor: GrowthAnchor;
  istYoY: number | null;
  gStarPct: number | null;
  priceInfo: GStarPrice;
}): DcfCalibrationView {
  const emptySums = {
    tvSharePct: null as number | null,
    biasUpliftAppliedPp: 0,
    biasUpliftReplacedPp: 0,
    growthFactor: 1,
    g1AfterBias: input.g1Model,
    gDropPp: 0,
    waccSumPp: 0,
    moatKiDeltaRoh: null as number | null,
    moatFaktor: null as number | null,
    moatKiApplied: null as number | null,
  };
  const common = {
    health: input.health,
    model: input.model,
    waccRohPct: input.waccRohPct,
    g1Before: input.g1Model,
    terminalBefore: input.terminalModel,
    anchorSource: input.anchor.source,
    anchorDetail: input.anchor.detail,
    gAnker: input.anchor.gAnker,
    istYoY: input.istYoY,
    gStarPct: input.gStarPct,
    gStarPriceSource: input.priceInfo.source,
    gStarPrice: input.priceInfo.price,
    gStarPriceDetail: input.priceInfo.reason,
    rules: calibrationRules(input.model),
  };
  if (input.level == null) {
    return {
      ...common,
      ...emptySums,
      applied: false,
      skipReason: "financialStatements.health fehlt oder ist unbekannt. Keine Stufe geschätzt, Parameter unverändert.",
      lage: null,
      waccAddPp: 0,
      waccPct: input.waccRohPct,
      g1After: input.g1Model,
      terminalAfter: input.terminalModel,
      gStarCapApplied: false,
      gStarCapNote: "Kein Deckel, weil die Stufe fehlt.",
    };
  }
  const level = input.level;
  const waccAddPp = waccAddPpForLevel(level, input.model);
  const waccPct = input.waccRohPct + waccAddPp;
  const haircut = level === 0 ? 1 : 1 - DCF_CALIBRATION.g1HaircutPerLevel * level;
  let g1 = input.anchor.gAnker == null ? input.g1Model : Math.min(input.g1Model, input.anchor.gAnker);
  g1 *= haircut;
  let gStarCapApplied = false;
  let gStarCapNote = "g*-Deckel nicht aktiv (Stufe unter gStarCapFromLevel).";
  if (level >= DCF_CALIBRATION.gStarCapFromLevel) {
    if (input.istYoY != null && input.gStarPct != null) {
      g1 = Math.min(g1, Math.max(input.istYoY, input.gStarPct));
      gStarCapApplied = true;
      gStarCapNote = "g1 ≤ max(Ist-YoY, g*).";
    } else if (input.istYoY == null && input.gStarPct != null) {
      g1 = Math.min(g1, input.gStarPct);
      gStarCapApplied = true;
      gStarCapNote = "Ist-YoY fehlt, nicht geschätzt. Deckel nur gegen g*.";
    } else if (input.istYoY != null && input.gStarPct == null) {
      gStarCapNote = "g* fehlt, nicht geschätzt. g*-Deckel ausgelassen.";
    } else {
      gStarCapNote = "Ist-YoY und g* fehlen, nicht geschätzt. g*-Deckel ausgelassen.";
    }
  }
  const terminalAfter = Math.min(
    input.terminalModel,
    DCF_CALIBRATION.terminalCapPct,
    waccPct - DCF_CALIBRATION.terminalWaccGapPp,
  );
  return {
    ...common,
    ...emptySums,
    applied: true,
    skipReason: null,
    lage: level,
    waccAddPp,
    waccPct,
    g1After: g1,
    g1AfterBias: g1,
    terminalAfter,
    gStarCapApplied,
    gStarCapNote,
    waccSumPp: waccAddPp,
    gDropPp: input.g1Model - g1,
  };
}

export function withBiasOverlay(view: DcfCalibrationView, overlay: {
  biasUpliftAppliedPp: number;
  biasUpliftReplacedPp: number;
  growthFactor: number;
  g1AfterBias: number;
  tvSharePct: number | null;
  moatKiDeltaRoh: number | null;
  moatFaktor: number | null;
  moatKiApplied: number | null;
}): DcfCalibrationView {
  return {
    ...view,
    ...overlay,
    gDropPp: view.g1Before - overlay.g1AfterBias,
    waccSumPp: view.waccAddPp + overlay.biasUpliftAppliedPp,
  };
}

export function calibrationLineText(view: Pick<DcfCalibrationView, "lage" | "waccAddPp" | "g1Before" | "g1After" | "terminalBefore" | "terminalAfter">): string {
  const stufe = view.lage == null ? "n/a" : String(view.lage);
  return `Bilanz-Kalibrierung: Stufe ${stufe}, WACC +${view.waccAddPp.toFixed(2)} Pp, g1 ${view.g1Before.toFixed(2)} → ${view.g1After.toFixed(2)}, terminal ${view.terminalBefore.toFixed(2)} → ${view.terminalAfter.toFixed(2)}`;
}

export function calibrationSumText(view: Pick<DcfCalibrationView, "waccSumPp" | "waccAddPp" | "biasUpliftAppliedPp" | "biasUpliftReplacedPp" | "gDropPp">): string {
  return `Summe WACC-Aufschlag ${view.waccSumPp.toFixed(2)} Pp (Health ${view.waccAddPp.toFixed(2)} + Bias angewendet ${view.biasUpliftAppliedPp.toFixed(2)}; Trigger-Sprung ersetzt, nicht addiert ${view.biasUpliftReplacedPp.toFixed(2)}) + g-Abschlag ${view.gDropPp.toFixed(2)} Pp`;
}

export function tvShareWarns(tvSharePct: number): boolean {
  return tvSharePct > DCF_CALIBRATION.tvShareWarnPct;
}

export function tvExtrapolationHint(tvSharePct: number | null): string | null {
  if (tvSharePct == null || !tvShareWarns(tvSharePct)) return null;
  return `Hinweis: DCF extrapolationsgetrieben (TV-Anteil ${tvSharePct.toFixed(1)} % > ${DCF_CALIBRATION.tvShareWarnPct} %).`;
}
