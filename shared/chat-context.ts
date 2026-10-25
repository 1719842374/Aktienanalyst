/**
 * KI-Chatbot (WORK_DASHBOARD_FEATURES_2026-10.md §4 + §4c): dashboard-agnostischer Kontext.
 *
 * Jedes Dashboard liefert über einen eigenen Provider ein `ChatContext` (Asset + geladene Daten,
 * gegliedert nach Sektionen). PR 1 hängt nur den Aktien-Provider (`buildStockChatContext`) ein;
 * BTC/Gold/Rezession folgen mit eigenen Providern in derselben Form.
 *
 * Nur Lesen: der Kontext ist eine kompakte Kopie bereits geladener Werte. Er verändert keine
 * Analyse, keinen Score und kein Gate. Fehlende Werte sind `null` ("n/a"), nie geschätzt.
 */
import type { StockAnalysis } from "./schema";

export type ChatDashboard = "stock" | "btc" | "gold" | "recession";
export const CHAT_DASHBOARDS: readonly ChatDashboard[] = ["stock", "btc", "gold", "recession"];

export type ChatFactValue = string | number | boolean | null;

export interface ChatSection {
  id: number;
  label: string;
  facts: Record<string, ChatFactValue>;
}

export interface ChatGate {
  id: string;
  active: boolean;
  cap: number | null;
  severity: string;
  rationale: string;
}

export interface ChatContext {
  dashboard: ChatDashboard;
  /** z.B. Ticker "SAP" oder "BTC". */
  entity: string;
  title: string;
  asOf: string | null;
  sections: ChatSection[];
  gates: ChatGate[];
  /** Hinweise, was bewusst nicht im Kontext ist (z.B. nur im Client berechnete Werte). */
  notes: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  dashboard: ChatDashboard;
  /** Gebundene Sektion (Sektionsbindung); null = ganze Analyse. */
  sectionId: number | null;
  context: ChatContext;
  messages: ChatMessage[];
}

export interface ChatResponseBody {
  ok: boolean;
  answer: string | null;
  /** Sektionen, auf die sich die Antwort laut KI bezieht (nur IDs aus dem Kontext). */
  sectionRefs: number[];
  model: string | null;
  /** "ok" | "no-key" | "timeout" | "llm-error" | "invalid" */
  status: "ok" | "no-key" | "timeout" | "llm-error" | "invalid";
  error: string | null;
}

/** Grenzen, serverseitig erzwungen (Client kürzt vorab gleich). */
export const CHAT_LIMITS = {
  maxMessages: 12,
  maxMessageChars: 2000,
  maxSections: 30,
  maxFactsPerSection: 40,
  maxFactKeyChars: 60,
  maxFactValueChars: 400,
  maxGates: 20,
  maxNotes: 10,
  maxContextChars: 40_000,
} as const;

function num(v: unknown, digits = 2): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function str(v: unknown, max: number = CHAT_LIMITS.maxFactValueChars): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function list(items: Array<string | null | undefined> | undefined, maxItems = 6): string | null {
  const xs = (items ?? []).filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, maxItems);
  return xs.length ? str(xs.join("; ")) : null;
}

/** Reihenfolge und Labels identisch mit SECTIONS in client/src/pages/Dashboard.tsx. */
export const STOCK_SECTION_LABELS: Record<number, string> = {
  1: "Executive Summary", 2: "Datenaktualität", 3: "Investmentthese", 4: "Financial Statements",
  5: "Zyklusanalyse", 6: "Bewertung", 7: "DCF-Modell", 8: "CRV", 9: "Rel. Bewertung",
  10: "Risikoinversion", 11: "RSL-Momentum", 12: "Tech. Analyse", 13: "Moat / Porter", 14: "PESTEL",
  15: "Makro-Korr.", 16: "Reverse DCF", 17: "Katalysatoren", 18: "Monte Carlo",
  19: "Management-Score", 20: "Zusammenfassung",
};

/**
 * Aktien-Provider: baut aus der geladenen Analyse (Antwort von POST /api/analyze) den Chat-Kontext
 * für alle 20 Sektionen + Scoring-Gates. Reine Funktion, mutiert `data` nicht.
 */
export function buildStockChatContext(data: StockAnalysis): ChatContext {
  const d = data as StockAnalysis & Record<string, any>;
  const s = (id: number, facts: Record<string, ChatFactValue>): ChatSection => ({ id, label: STOCK_SECTION_LABELS[id], facts });
  const ti = d.technicalIndicators?.currentStatus;
  const sc = d.scoring;
  const catalysts = Array.isArray(d.catalysts) ? d.catalysts : [];
  const risks = Array.isArray(d.risks) ? d.risks : [];
  const lastPrice = Array.isArray(d.historicalPrices) && d.historicalPrices.length ? d.historicalPrices[d.historicalPrices.length - 1] : null;

  const sections: ChatSection[] = [
    s(1, {
      firma: str(d.companyName), ticker: str(d.ticker), sektor: str(d.sector), branche: str(d.industry),
      kurs: num(d.currentPrice), waehrung: str(d.currency), marktkapitalisierung: num(d.marketCap, 0),
      analystenKursziel_median: num(d.analystPT?.median), analystenKursziel_hoch: num(d.analystPT?.high),
      analystenKursziel_tief: num(d.analystPT?.low), analystenAnzahl: num(d.analystPT?.count, 0),
      ratings_buy_hold_sell: d.ratings ? `${d.ratings.buy}/${d.ratings.hold}/${d.ratings.sell}` : null,
      finalScore: num(sc?.finalScore, 1),
    }),
    s(2, {
      kursZeitpunkt: str(d.priceTimestamp), datenStand: str(d.dataTimestamp), cacheStand: str(d._cachedAt),
      datenquelle: str(typeof d.dataSource === "string" ? d.dataSource : d.dataSource ? JSON.stringify(d.dataSource) : null),
      historieQuelle: str(d.historyDataSource), letzterKurstag: lastPrice ? str(lastPrice.date) : null,
      naechsteZahlen: str(d.nextEarningsDate), letztesQuartal: str(d.lastReportedQuarter),
      thesisStrengthScore: num(d.thesisStrengthScore, 1),
    }),
    s(3, {
      wachstumsthese: str(d.growthThesis, 1200), strukturelleTrends: list(d.structuralTrends),
      lynchKlasse: str(d.lynchClass), moatRating: str(d.moatRating),
      warumInteressant: str(d.catalystReasoning?.whyInteresting),
    }),
    s(4, {
      umsatz: num(d.revenue, 0), ebitda: num(d.ebitda, 0), operatingIncome: num(d.operatingIncome, 0),
      nettoergebnis: num(d.netIncome, 0), fcfTTM: num(d.fcfTTM, 0), fcfMarginPct: num(d.fcfMargin),
      schulden: num(d.totalDebt, 0), cash: num(d.cashEquivalents, 0), enterpriseValue: num(d.enterpriseValue, 0),
      segmente: list((d.revenueSegments ?? []).map((g: any) => `${g.name} ${num(g.percentage, 1) ?? "n/a"}%`)),
    }),
    s(5, {
      zyklus: str(d.cycleClassification), politischerZyklus: str(d.politicalCycle),
      sektorMaxDrawdownPct: num(d.sectorMaxDrawdown), maxDrawdownHistorie: str(d.maxDrawdownHistory),
      maxDrawdownJahr: str(d.maxDrawdownYear),
    }),
    s(6, {
      kgv: num(d.peRatio), forwardKgv: num(d.forwardPE), peg: num(d.peg ?? d.pegRatio), evEbitda: num(d.evEbitda),
      fcfYieldPct: num(d.fcfYield), dividendenrenditePct: num(d.dividendYield),
      sektorKgv: num(d.sectorAvgPE), sektorForwardKgv: num(d.sectorAvgForwardPE), sektorEvEbitda: num(d.sectorAvgEVEBITDA),
      epsTTM: num(d.epsTTM), epsKonsensNaechstesGJ: num(d.epsConsensusNextFY), epsWachstum5JPct: num(d.epsGrowth5Y),
    }),
    s(7, {
      beta: num(d.beta), fcfHaircutPct: num(d.fcfHaircut), impliedGStarPct: num(d.impliedGStar),
      fiskalOverlay_fvBase: num(d.fiscalOverlay?.fvBase), fiskalOverlay_fvFiscal: num(d.fiscalOverlay?.fvFiscal),
    }),
    s(8, {
      erwarteterSchadenSummePct: num(risks.reduce((a: number, r: any) => a + (Number.isFinite(r?.expectedDamage) ? r.expectedDamage : 0), 0)),
      katalysatorGBSumme: num(catalysts.reduce((a: number, c: any) => a + (Number.isFinite(c?.gb) ? c.gb : 0), 0)),
    }),
    s(9, {
      peers: list((d.peerComparison?.peers ?? []).map((p: any) => str(p?.ticker ?? p?.name, 20)), 8),
      peerKgvSchnitt: num(d.peerComparison?.peerAvg?.pe), peerPegSchnitt: num(d.peerComparison?.peerAvg?.peg),
      peerRoicSchnittPct: num(d.peerComparison?.peerAvg?.roic),
      peerOverrides: d.activePeerOverrides ? `+${d.activePeerOverrides.add.join(",") || "-"} / −${d.activePeerOverrides.remove.join(",") || "-"}` : null,
    }),
    s(10, {
      risiken: list(risks.map((r: any) => `${r.name} (${r.category}, EW ${num(r.ew, 0) ?? "n/a"}%, Impact ${num(r.impact, 0) ?? "n/a"}%)`), 8),
      staatsExposurePct: num(d.governmentExposure), staatsExposureDetail: str(d.govExposureDetail),
    }),
    s(11, {
      hinweis: "RSL wird im Client aus der Kurshistorie berechnet",
      historiePunkte: Array.isArray(d.historicalPrices) ? d.historicalPrices.length : null,
      letzterSchluss: lastPrice ? num(lastPrice.close) : null,
    }),
    s(12, {
      kursUeberMA200: ti ? ti.priceAboveMA200 : null, ma50UeberMA200: ti ? ti.ma50AboveMA200 : null,
      macdUeberNull: ti ? ti.macdAboveZero : null, macdSteigend: ti ? ti.macdRising : null,
      kaufsignal: ti ? ti.buySignal : null, ma200: num(ti?.ma200Value), ma50: num(ti?.ma50Value),
    }),
    s(13, {
      moatGesamt: str(d.moatAssessment?.overallRating), moatQuellen: list(d.moatAssessment?.moatSources),
      porter: list((d.moatAssessment?.porterForces ?? []).map((f: any) => `${f.name}: ${f.rating} (${f.score})`)),
      geschaeftsmodell: str(d.moatAssessment?.businessModelStrength), nachhaltigkeit: str(d.moatAssessment?.sustainabilityRating),
    }),
    s(14, {
      gesamtExposure: str(d.pestelAnalysis?.overallExposure), geopolitikScore: num(d.pestelAnalysis?.geopoliticalScore, 0),
      makroZusammenfassung: str(d.pestelAnalysis?.macroSummary), zinsAusblick: str(d.pestelAnalysis?.interestRateOutlook),
      kategorien: list((d.pestelAnalysis?.factors ?? []).map((f: any) => `${f.categoryDE ?? f.category}: ${f.exposureRating}`)),
    }),
    s(15, {
      makroSensitivitaet: str(d.macroCorrelations?.overallMacroSensitivity), kernaussage: str(d.macroCorrelations?.keyInsight),
      korrelationen: list((d.macroCorrelations?.correlations ?? []).map((c: any) => `${c.name}: ${c.correlation}/${c.strength}`), 8),
    }),
    s(16, { impliedGStarPct: num(d.impliedGStar) }),
    s(17, {
      quelle: str(d.catalystsSource), kiModus: typeof d.llmMode === "boolean" ? d.llmMode : null,
      katalysatoren: list(catalysts.map((c: any) => `${c.name} (PoS ${num(c.pos, 0) ?? "n/a"}%, netto ${num(c.nettoUpside, 1) ?? "n/a"}%, GB ${num(c.gb, 2) ?? "n/a"})`), 8),
    }),
    s(18, {
      hinweis: "Monte Carlo (GBM, 10.000 Pfade) wird im Client berechnet",
      startkurs: num(d.currentPrice), zielMedianAnalysten: num(d.analystPT?.median),
    }),
    s(19, { managementScore: num(d.managementScore, 1) }),
    s(20, {
      finalScore: num(sc?.finalScore, 1), rawScore: num(sc?.rawScore, 1), qualityScore: num(sc?.qualityScore, 1),
      trendMultiplikator: num(sc?.trendMultiplier, 3), gedeckeltDurch: sc ? (sc.cappedBy ?? null) : null,
      konflikte: list(sc?.conflictTexts),
    }),
  ];

  const gates: ChatGate[] = (sc?.gates ?? []).slice(0, CHAT_LIMITS.maxGates).map(g => ({
    id: String(g.id), active: !!g.active, cap: num(g.cap, 1), severity: String(g.severity ?? ""), rationale: str(g.rationale) ?? "",
  }));

  const notes: string[] = [];
  if (!sc) notes.push("Scoring/Gates fehlen in diesem (alten) Cache-Eintrag: n/a");
  notes.push("DCF-Fair-Value, CRV, RSL und Monte-Carlo-Kennzahlen werden im Client berechnet und sind nur teilweise im Kontext");

  return {
    dashboard: "stock",
    entity: str(d.ticker, 20) ?? "n/a",
    title: `${str(d.companyName, 80) ?? d.ticker ?? "Aktie"} (${d.ticker ?? "n/a"})`,
    asOf: str(d.dataTimestamp ?? d._cachedAt ?? d.priceTimestamp, 40),
    sections,
    gates,
    notes,
  };
}
