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
import { sumUpsideGb } from "./bias-fixes";
import type { EarningsCallBrief } from "./chat-earnings";
import { formatIncomeMio, formatIncomePct, INCOME_LINE_DEFS, type IncomeStatementBrief } from "./chat-income";

export type ChatDashboard = "stock" | "btc" | "gold" | "recession";
export const CHAT_DASHBOARDS: readonly ChatDashboard[] = ["stock", "btc", "gold", "recession"];

export type ChatFactValue = string | number | boolean | null;

export interface ChatSection {
  /** Angezeigte Sektionsnummer (wie auf der Seite; Ziel für Sprünge/Verweise). */
  id: number;
  label: string;
  facts: Record<string, ChatFactValue>;
  /** Stabile, semantische ID (z.B. Rezession "buffett"); ändert sich nicht, wenn sich Nummern verschieben. */
  key?: string;
}

/** Eintrag der Sektionsauswahl im Chat-Widget. */
export interface ChatSectionItem {
  id: number;
  label: string;
  /** Stabile Bindung; ohne Angabe gilt die Nummer als Schlüssel. */
  key?: string;
  /** Ersetzt die Nummer in Auswahl/Verweisen (z.B. Gold-News, interne ID 100, ohne Nummer auf der Seite). */
  display?: string;
}

export function chatSectionKey(s: ChatSectionItem): string {
  return s.key ?? String(s.id);
}
/** Präfix in der Auswahl: "7." bzw. das Anzeige-Symbol (Gold-News "📰"). */
export function chatSectionTag(s: ChatSectionItem): string {
  return s.display ?? `${s.id}.`;
}
/** Name im Erklär-Prompt: "7 (Label)" bzw. nur das Label, wenn die Sektion keine Nummer zeigt. */
export function chatSectionName(s: ChatSectionItem): string {
  return s.display != null ? s.label : `${s.id} (${s.label})`;
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

/** Faktart, die das Budget gekürzt oder entfernt hat. */
export type ChatTrimKind = "notes" | "facts" | "rationale" | "wachstumsthese" | "earningsCall" | "guv";
/** Reihenfolge im Kürzungsbericht. */
export const CHAT_TRIM_KINDS: readonly ChatTrimKind[] = ["notes", "facts", "rationale", "wachstumsthese", "earningsCall", "guv"];

export interface ChatContextTrimEntry {
  kind: ChatTrimKind;
  /** Zeichen, die bei dieser Faktart gekürzt oder gelöscht wurden. */
  removedChars: number;
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
  /** Fehlt, wenn nichts gekürzt wurde. Sonst je Faktart die entfernten Zeichen. */
  contextTrimmed?: ChatContextTrimEntry[];
}

/** Zielgröße des Chat-Kontexts (JSON). Die Server-Decke bleibt `CHAT_LIMITS.maxContextChars`. */
export const CHAT_CONTEXT_BUDGET = 36_000;

/** Client-Zeitlimit für POST /api/chat (useDashboardChat). Der Server bricht das LLM vorher ab. */
export const CHAT_REQUEST_TIMEOUT_MS = 45_000;

/**
 * WORK_KI_CHAT_BIG_PICTURE: so viele Schlagzeilen stehen im Prompt („News: Top 5“).
 * Fenster, kein Score-Schwellenwert.
 */
export const CHAT_NEWS_HEADLINE_COUNT = 5;

/** Schema-Stufe „Hoch“ ist die starke / rote Exposure. Kein numerischer Cutoff. */
export const PESTEL_STRONG_RATING = "Hoch" as const;

export function pestelIsStrong(p: { overallExposure?: string | null; factors?: Array<{ exposureRating?: string | null }> | null } | null | undefined): boolean {
  if (!p) return false;
  if (p.overallExposure === PESTEL_STRONG_RATING) return true;
  return (p.factors ?? []).some(f => f?.exposureRating === PESTEL_STRONG_RATING);
}

/** Dominante Thesis-Klasse = größter Anteil. Keine Wachstumsschwelle. */
export function dominantThesisClass(shares: Record<string, number> | null | undefined): { name: string; share: number } | null {
  if (!shares) return null;
  let best: { name: string; share: number } | null = null;
  for (const [name, share] of Object.entries(shares)) {
    if (typeof share !== "number" || !Number.isFinite(share)) continue;
    if (!best || share > best.share) best = { name, share };
  }
  return best;
}

/**
 * Relative Priorität beim Behalten von Text:
 * GuV-Posten > Earnings Call > Wachstumsthese > Rationale > Notes.
 * Das sind Ränge, keine Zeichenzahl. Gewicht = Rang / Summe.
 * allowedChars = floor(CHAT_CONTEXT_BUDGET * Gewicht). GuV und Earnings Call sind Gruppen
 * (alle Fakten mit dem Präfix aus CHAT_FACT_GROUP_PREFIX); die Gruppe teilt sich ihr Budget.
 */
export const CHAT_FACT_PRIORITY = {
  guv: 5,
  earningsCall: 4,
  wachstumsthese: 3,
  rationale: 2,
  notes: 1,
} as const;

export type ChatFactKind = keyof typeof CHAT_FACT_PRIORITY;
export type ChatFactGroup = "guv" | "earningsCall";

/** Fakt-Schlüssel mit diesem Präfix gehören zur Gruppe (z. B. guv_zinsaufwand, earningsCallZitate). */
export const CHAT_FACT_GROUP_PREFIX: Record<ChatFactGroup, string> = { guv: "guv", earningsCall: "earningsCall" };

/** Gruppe eines Fakt-Schlüssels, sonst null. */
export function chatFactGroupOf(key: string): ChatFactGroup | null {
  if (key.startsWith(CHAT_FACT_GROUP_PREFIX.earningsCall)) return "earningsCall";
  if (key.startsWith(CHAT_FACT_GROUP_PREFIX.guv)) return "guv";
  return null;
}

function chatFactPrioritySum(): number {
  return Object.values(CHAT_FACT_PRIORITY).reduce((a, b) => a + b, 0);
}

export function chatFactWeight(kind: ChatFactKind): number {
  return CHAT_FACT_PRIORITY[kind] / chatFactPrioritySum();
}

/** allowedChars = floor(totalBudget * weight[factType]), ganzzahlig ohne Rundungsrest. */
export function chatFactAllowedChars(kind: ChatFactKind): number {
  return Math.floor((CHAT_CONTEXT_BUDGET * CHAT_FACT_PRIORITY[kind]) / chatFactPrioritySum());
}

/** Grenzen. Textlängen von Fakten, Rationale und Notes hängen am Budget, nicht an einem festen 400/1000. */
export const CHAT_LIMITS = {
  maxMessages: 12,
  maxMessageChars: 2000,
  maxSections: 30,
  maxFactsPerSection: 40,
  maxFactKeyChars: 60,
  maxFactValueChars: chatFactAllowedChars("wachstumsthese"),
  maxRationaleChars: chatFactAllowedChars("rationale"),
  maxNoteChars: chatFactAllowedChars("notes"),
  maxGates: 20,
  maxNotes: 10,
  maxContextChars: 40_000,
} as const;

/**
 * Aufteilung des Earnings-Call-Budgets (Ränge, Anteil = Rang / Summe): Auszug aus Transkript bzw.
 * Release > Zusammenfassung = Zitate > Metadaten (Datum, Quartal, Quelle, Link, Hinweis).
 */
export const CHAT_EARNINGS_PART_PRIORITY = { auszug: 4, zusammenfassung: 2, zitate: 2, meta: 1 } as const;
export type ChatEarningsPart = keyof typeof CHAT_EARNINGS_PART_PRIORITY;

export function chatEarningsPartChars(part: ChatEarningsPart): number {
  const sum = Object.values(CHAT_EARNINGS_PART_PRIORITY).reduce((a, b) => a + b, 0);
  return Math.floor((chatFactAllowedChars("earningsCall") * CHAT_EARNINGS_PART_PRIORITY[part]) / sum);
}

/** Einzelner Gruppen-Fakt: höchstens das Gruppenbudget und nie über der allgemeinen Faktdecke. */
export function chatFactGroupValueCap(group: ChatFactGroup): number {
  return Math.min(chatFactAllowedChars(group), CHAT_LIMITS.maxFactValueChars);
}

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

function newsTitles(items: unknown, tone?: "bullish" | "bearish"): string[] {
  if (!Array.isArray(items)) return [];
  const titles: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { title?: unknown; sentiment?: unknown; source?: unknown };
    if (typeof rec.title !== "string" || !rec.title.trim()) continue;
    if (tone && rec.sentiment !== tone) continue;
    const source = typeof rec.source === "string" && rec.source.trim() ? `, ${rec.source.trim()}` : "";
    const label = tone === "bullish" ? "positiv" : tone === "bearish" ? "negativ" : (rec.sentiment === "bullish" ? "positiv" : rec.sentiment === "bearish" ? "negativ" : rec.sentiment === "neutral" ? "neutral" : "Stimmung n/a");
    titles.push(tone ? rec.title.trim() : `${rec.title.trim()} (${label}${source})`);
  }
  return titles;
}

function newsFact(items: unknown, tone?: "bullish" | "bearish"): string | null {
  const titles = newsTitles(items, tone).slice(0, CHAT_NEWS_HEADLINE_COUNT);
  return titles.length ? str(titles.join(" | ")) : null;
}

function catalystKiText(catalysts: unknown[]): string | null {
  const parts: string[] = [];
  for (const c of catalysts) {
    if (!c || typeof c !== "object") continue;
    const rec = c as { name?: unknown; deepDive?: Record<string, unknown> | null };
    const dive = rec.deepDive;
    if (!dive || typeof dive !== "object") continue;
    const bits = ["unternehmenskontext", "posHerleitung", "bewertungsauswirkung", "marktumfeld", "risiken"]
      .map(k => dive[k])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
    if (!bits.length) continue;
    const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : "Katalysator";
    parts.push(`${name}: ${bits.join(" ")}`);
  }
  return parts.length ? str(parts.join(" | ")) : null;
}

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
  const kiCatalysts = catalystKiText(catalysts);
  const risks = Array.isArray(d.risks) ? d.risks : [];
  const lastPrice = Array.isArray(d.historicalPrices) && d.historicalPrices.length ? d.historicalPrices[d.historicalPrices.length - 1] : null;

  const sections: ChatSection[] = [
    s(1, {
      firma: str(d.companyName), ticker: str(d.ticker), sektor: str(d.sector), branche: str(d.industry),
      kurs: num(d.currentPrice), waehrung: str(d.currency), marktkapitalisierung: num(d.marketCap, 0),
      analystenKursziel_median: num(d.analystPT?.median), analystenKursziel_hoch: num(d.analystPT?.high),
      analystenKursziel_tief: num(d.analystPT?.low), analystenAnzahl: num(d.analystPT?.count, 0),
      ratings_buy_hold_sell: d.ratings ? `${d.ratings.buy}/${d.ratings.hold}/${d.ratings.sell}` : null,
      // S1 zeigt keinen 0–100-Score (der steht in S20 „/ 100“); Ampel/Signal-Score liefert die
      // Executive-Summary-Karte selbst (usePublishChatSection "1"). Hier nur als S20-Verweis.
      scoringFinalScore_S20: num(sc?.finalScore, 1),
    }),
    s(2, {
      kursZeitpunkt: str(d.priceTimestamp), datenStand: str(d.dataTimestamp), cacheStand: str(d._cachedAt),
      datenquelle: str(typeof d.dataSource === "string" ? d.dataSource : d.dataSource ? JSON.stringify(d.dataSource) : null),
      historieQuelle: str(d.historyDataSource), letzterKurstag: lastPrice ? str(lastPrice.date) : null,
      naechsteZahlen: str(d.nextEarningsDate), letztesQuartal: str(d.lastReportedQuarter),
      thesisStrengthScore: num(d.thesisStrengthScore, 1),
    }),
    s(3, {
      wachstumsthese: str(d.growthThesis), strukturelleTrends: list(d.structuralTrends),
      lynchKlasse: str(d.lynchClass), moatRating: str(d.moatRating),
      warumInteressant: str(d.catalystReasoning?.whyInteresting),
      newsTop: newsFact(d.newsItems) ?? "n/a — keine News in der geladenen Analyse",
      newsPositiv: newsFact(d.newsItems, "bullish") ?? (newsTitles(d.newsItems).length ? "n/a — keine positive Schlagzeile in den geladenen News" : "n/a — keine News in der geladenen Analyse"),
      newsNegativ: newsFact(d.newsItems, "bearish") ?? (newsTitles(d.newsItems).length ? "n/a — keine negative Schlagzeile in den geladenen News" : "n/a — keine News in der geladenen Analyse"),
      analystenThesen: "n/a — keine narrativen Analysten-Thesen in den geladenen Daten, nur Buy/Hold/Sell in S1",
      beatMiss: "n/a — Beat/Miss liegt nicht in der geladenen Analyse",
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
      // Gleiche Summe wie die Seite (S17 „Σ GB“, Fazit „positive GB“): ▼-Katalysatoren zählen 0.
      katalysatorGBSumme: num(sumUpsideGb(catalysts)),
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
      pestelStark: d.pestelAnalysis ? (pestelIsStrong(d.pestelAnalysis) ? "ja" : "nein") : "n/a — keine PESTEL-Analyse geladen",
    }),
    s(15, {
      makroSensitivitaet: str(d.macroCorrelations?.overallMacroSensitivity), kernaussage: str(d.macroCorrelations?.keyInsight),
      korrelationen: list((d.macroCorrelations?.correlations ?? []).map((c: any) => `${c.name}: ${c.correlation}/${c.strength}`), 8),
    }),
    s(16, { impliedGStarPct: num(d.impliedGStar) }),
    s(17, {
      quelle: str(d.catalystsSource), kiModus: typeof d.llmMode === "boolean" ? d.llmMode : null,
      katalysatoren: list(catalysts.map((c: any) => `${c.name} (PoS ${num(c.pos, 0) ?? "n/a"}%, netto ${num(c.nettoUpside, 1) ?? "n/a"}%, GB ${num(c.gb, 2) ?? "n/a"})`), 8),
      ...(kiCatalysts ? { kiAntwort: kiCatalysts } : {}),
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
    id: String(g.id), active: !!g.active, cap: num(g.cap, 1), severity: String(g.severity ?? ""), rationale: str(g.rationale, CHAT_LIMITS.maxRationaleChars) ?? "",
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

/** Kürzt die Text-Fakten einer Gruppe anteilig, bis sie zusammen höchstens `allowed` Zeichen haben. */
function fitFactGroup(facts: Record<string, ChatFactValue>, allowed: number): Record<string, ChatFactValue> {
  const keys = Object.keys(facts).filter(k => typeof facts[k] === "string");
  const values = keys.map(k => facts[k] as string);
  const overflow = values.reduce((a, v) => a + v.length, 0) - allowed;
  const next = shrinkProportionally(values, overflow);
  if (!next) return facts;
  const out = { ...facts };
  keys.forEach((k, i) => { out[k] = next[i]; });
  return out;
}

const EARNINGS_KIND_LABEL: Record<NonNullable<EarningsCallBrief["kind"]>, string> = {
  transcript: "Call-Transkript (FMP)",
  "earnings-release": "Earnings Release (SEC Exhibit 99.1), kein Call-Transkript",
};

/**
 * Earnings Call in S3 (Investmentthese). `null` = Abruf läuft noch. Mutiert `ctx` nicht. Null-Felder
 * werden weggelassen; der Grund steht in `earningsCallHinweis`. Budget: Gruppe "earningsCall",
 * Teile nach CHAT_EARNINGS_PART_PRIORITY.
 */
export function withEarningsBriefFacts(ctx: ChatContext, brief: EarningsCallBrief | null): ChatContext {
  const quarter = brief && brief.year != null && brief.quarter != null ? `FY${brief.year} Q${brief.quarter}` : null;
  const cap = chatFactGroupValueCap("earningsCall");
  const part = (p: ChatEarningsPart, v: string) => clipTo(v, Math.min(cap, chatEarningsPartChars(p)));
  const facts: Record<string, ChatFactValue> = {};
  if (brief?.date) facts.earningsCallDatum = brief.date;
  if (quarter) facts.earningsCallQuartal = quarter;
  if (brief?.kind) facts.earningsCallArt = EARNINGS_KIND_LABEL[brief.kind];
  if (brief?.summary) facts.earningsCallZusammenfassung = part("zusammenfassung", brief.summary);
  if (brief?.quotes?.length) facts.earningsCallZitate = part("zitate", brief.quotes.join(" | "));
  if (brief?.excerpt) facts.earningsCallAuszug = part("auszug", brief.excerpt);
  if (brief?.source) facts.earningsCallQuelle = part("meta", brief.source);
  if (brief?.sourceUrl) facts.earningsCallQuelleUrl = brief.sourceUrl;
  const hinweis = brief?.summary
    ? (brief.reason ?? (brief.excerptTruncated ? "Auszug am Chat-Budget gekürzt" : null))
    : (brief?.reason ?? "n/a — Earnings-Call noch nicht geladen");
  if (hinweis) facts.earningsCallHinweis = part("meta", hinweis);
  const fitted = fitFactGroup(facts, chatFactAllowedChars("earningsCall"));
  return {
    ...ctx,
    sections: ctx.sections.map(s => (s.id === 3 ? { ...s, facts: { ...s.facts, ...fitted } } : s)),
  };
}

/** S4 (Financial Statements) trägt die GuV-Posten. */
export const CHAT_INCOME_SECTION_ID = 4;

function incomeValue(v: number | null): string {
  return formatIncomeMio(v, null).replace(/ Mio$/, "");
}

/**
 * GuV-Posten samt Unterposten in S4: je Posten aktuelle Periode, Vorjahresperiode, Δ, Konzept und
 * Summenzeile; dazu Quelle, Filing-Link, Periode, Summenprüfung und Ausreißer mit Filing-Erklärung.
 * `null` = Abruf läuft noch. Mutiert `ctx` nicht. Budget: Gruppe "guv". Passen nicht alle Posten in
 * die Sektion (CHAT_LIMITS.maxFactsPerSection), fallen die hinteren Posten weg und der Hinweis sagt es.
 */
export function withIncomeStatementFacts(ctx: ChatContext, brief: IncomeStatementBrief | null): ChatContext {
  const target = ctx.sections.find(s => s.id === CHAT_INCOME_SECTION_ID);
  if (!target) return ctx;
  const cap = chatFactGroupValueCap("guv");
  const head: Record<string, ChatFactValue> = {};
  const tail: Record<string, ChatFactValue> = {};
  const hints: string[] = [];
  if (!brief) {
    head.guvHinweis = "n/a — GuV-Posten (SEC/FMP) noch nicht geladen";
  } else if (brief.status !== "ok" || !brief.period) {
    head.guvHinweis = clipTo(brief.reason ?? "n/a — GuV-Posten nicht verfügbar", cap);
  } else {
    const cur = brief.period.label;
    const pri = brief.priorPeriod?.label ?? "Vorjahr";
    const src = brief.source === "sec-edgar/companyfacts" ? "SEC EDGAR companyfacts (XBRL)" : brief.source === "fmp/income-statement" ? "FMP Income Statement" : (brief.source ?? "n/a");
    head.guvQuelle = clipTo([src, brief.form, brief.accession ? `Accession ${brief.accession}` : null, brief.filed ? `eingereicht ${brief.filed}` : null, brief.companyName].filter(Boolean).join(", "), cap);
    head.guvFilingUrl = brief.filingUrl ?? "n/a — kein Link auf das Filing-Dokument";
    head.guvPeriode = `${cur}${brief.period.start ? ` (${brief.period.start} bis ${brief.period.end})` : ` (bis ${brief.period.end})`} gegen ${pri}; Werte in Mio ${brief.currency ?? "n/a"}, Aufwand negativ`;
    const labelOf = (key: string | null) => (key ? INCOME_LINE_DEFS.find(d => d.key === key)?.label ?? key : null);
    for (const l of brief.lines) {
      const parent = labelOf(l.parentKey);
      head[`guv_${l.key}`] = clipTo(`${l.label}: ${cur} ${incomeValue(l.current)} | ${pri} ${incomeValue(l.prior)} | Δ ${incomeValue(l.deltaAbs)} (${formatIncomePct(l.deltaPct)}) | ${l.concept}${parent ? ` | Teil von „${parent}“` : ""}`, cap);
    }
    if (brief.checks.length) {
      tail.guvSummenpruefung = clipTo(brief.checks.map(c => `${labelOf(c.parentKey)}: ausgewiesen ${incomeValue(c.reported)}, Summe ${c.parts} Unterposten ${incomeValue(c.sumOfParts)}, Differenz ${incomeValue(c.diff)}`).join(" | "), cap);
    }
    for (const o of brief.outliers) {
      const parentKey = o.parentKey;
      tail[`guvAusreisser_${parentKey}`] = clipTo(`${o.label}: ${cur} ${incomeValue(o.current)} gegen ${pri} ${incomeValue(o.prior)}, Δ ${incomeValue(o.deltaAbs)} Mio ${brief.currency ?? ""} (größte Veränderung in „${labelOf(parentKey)}“) | Erklärung laut Filing: ${o.explanation ?? o.explanationReason ?? "n/a"}`.trim(), cap);
    }
    hints.push(...brief.notes);
  }
  const hintSlot = 1;
  const room = CHAT_LIMITS.maxFactsPerSection - 1 - Object.keys(target.facts).length - Object.keys(tail).length - hintSlot;
  const headKeys = Object.keys(head);
  if (headKeys.length > room) {
    const dropped = headKeys.slice(Math.max(0, room));
    for (const k of dropped) delete head[k];
    hints.push(`${dropped.length} GuV-Posten passen nicht in die Sektion (n/a im Kontext)`);
  }
  if (hints.length) tail.guvHinweis = clipTo(hints.join(" | "), cap);
  const fitted = fitFactGroup({ ...head, ...tail }, chatFactAllowedChars("guv"));
  return {
    ...ctx,
    sections: ctx.sections.map(s => (s.id === CHAT_INCOME_SECTION_ID ? { ...s, facts: { ...s.facts, ...fitted } } : s)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 2 (§4c): Provider für BTC, Gold und Rezession. Eingabe = bereits geladene Daten der
// jeweiligen Seite (BTC: analyzeBTC/Fallback, Gold: GET /api/analyze-gold/Fallback,
// Rezession: POST /api/analyze-recession/Fallback). Keine neuen Abfragen. Daten, die eine
// Sektion selbst nachlädt (z.B. BTC-Miner, Rezession-Buffett), sind nicht im Kontext → Hinweis.
// Bewusst lose typisiert (`any`), weil die BTC-/Rezessions-Typen im Client liegen.
// ─────────────────────────────────────────────────────────────────────────────

const SELF_LOADED = "Sektion lädt eigene Daten nach; nicht im Chat-Kontext (n/a)";

function sec(id: number, label: string, facts: Record<string, ChatFactValue>): ChatSection {
  return { id, label, facts };
}

function gatesFrom(list: any): ChatGate[] {
  return (Array.isArray(list) ? list : []).slice(0, CHAT_LIMITS.maxGates).map((g: any) => ({
    id: String(g?.id ?? "n/a").slice(0, 60), active: !!g?.active, cap: num(g?.cap, 1),
    severity: String(g?.severity ?? "").slice(0, 30), rationale: str(g?.rationale, CHAT_LIMITS.maxRationaleChars) ?? "",
  }));
}

/** Labels identisch mit SECTIONS in client/src/pages/BTCDashboard.tsx. */
export const BTC_SECTION_LABELS: Record<number, string> = {
  1: "Status & Preis", 2: "Halving-Zyklus", 3: "Krypto-Liquidität", 4: "Indikatoren", 5: "Power-Law", 6: "GWS",
  7: "Monte Carlo", 8: "Kategorien A-E", 9: "Zyklus-Einsch.", 10: "Finale Schätzung", 11: "Technische Analyse",
  12: "Fear & Greed", 13: "Miner-Zone", 14: "Gesamt-Fazit",
};

export function buildBtcChatContext(data: any): ChatContext {
  const d = data ?? {};
  const L = BTC_SECTION_LABELS;
  const bc = d.bullConditions;
  const mc3 = d.monteCarlo?.threeMonth, mc6 = d.monteCarlo?.sixMonth;
  const liq = d.liquidity;
  const sections: ChatSection[] = [
    sec(1, L[1], { zeitpunkt: str(d.timestamp), kursUSD: num(d.btcPrice, 0), aenderung24hPct: num(d.btcChange24h), marktkapUSD: num(d.btcMarketCap, 0), fearGreed: num(d.fearGreedIndex, 0), dxy: num(d.dxy), fedFundsPct: num(d.fedFundsRate) }),
    sec(2, L[2], { letztesHalving: str(d.lastHalvingDate), monateSeitHalving: num(d.monthsSinceHalving, 0), naechstesHalving: str(d.nextHalvingEstimate), zyklusphase: str(d.cyclePhase) }),
    sec(3, L[3], { hinweis: SELF_LOADED }),
    sec(4, L[4], {
      indikatoren: list((d.indicators ?? []).map((i: any) => `${i.name}: ${i.value} (Score ${i.available === false ? "n/a" : i.score}, Gewicht ${num(i.weight * 100, 1) ?? "n/a"}%)`), 10),
      gis: num(d.gis, 4),
      liquiditaetsblockScore: liq ? (liq.available && liq.score != null ? num(liq.score) : null) : null,
    }),
    sec(5, L[5], { fairValue: num(d.powerLaw?.fairValue, 0), support: num(d.powerLaw?.support, 0), resistance: num(d.powerLaw?.resistance, 0), abweichungPct: num(d.powerLaw?.deviationPercent, 1), fairValue6M: num(d.powerLaw?.fairValue6M, 0), powerSignal: num(d.powerLaw?.powerSignal, 1) }),
    sec(6, L[6], { gws: num(d.gws?.value, 4), gis: num(d.gws?.gis, 4), powerSignal: num(d.gws?.powerSignal, 1), zyklusSignal: num(d.gws?.cycleSignal, 1), muTaeglich: num(d.gws?.mu, 4), interpretation: str(d.gws?.interpretation) }),
    sec(7, L[7], { sigmaTaeglich: num(d.monteCarlo?.sigma, 4), mu: num(d.monteCarlo?.mu, 4), p10_3M: num(mc3?.p10, 0), p50_3M: num(mc3?.p50, 0), p90_3M: num(mc3?.p90, 0), p10_6M: num(mc6?.p10, 0), p50_6M: num(mc6?.p50, 0), p90_6M: num(mc6?.p90, 0), pVerlust_3MPct: num(mc3?.probBelow, 1) }),
    sec(8, L[8], { kategorien: list((d.categories ?? []).map((c: any) => `${c.label} ${c.range}: ${num(c.probability, 1) ?? "n/a"}%`), 5) }),
    sec(9, L[9], { position: str(d.cycleAssessment?.position), einstieg: str(d.cycleAssessment?.entryPoint), halvingKatalysator: str(d.cycleAssessment?.halvingCatalyst) }),
    sec(10, L[10], { ausblick: str(d.finalEstimate?.outlook), range3M: str(d.finalEstimate?.threeMonthRange), range6M: str(d.finalEstimate?.sixMonthRange), zusammenfassung: str(d.finalEstimate?.summary, 800) }),
    sec(11, L[11], {
      kursUeberMA200: bc ? !!bc.priceAboveMA200 : null, ma50UeberMA200: bc ? !!bc.ma50AboveMA200 : null,
      macdUeberNull: bc ? !!bc.macdAboveZero : null, macdSteigend: bc ? !!bc.macdRising : null, bull: typeof d.isBull === "boolean" ? d.isBull : null,
      ma50: num(d.currentMA50, 0), ma200: num(d.currentMA200, 0), macd: num(d.currentMACD, 2),
      letzteSignale: list((d.technicalSignals ?? []).slice(-3).map((s: any) => `${s.date} ${s.type}: ${s.reason}`), 3),
    }),
    sec(12, L[12], { wert: num(d.fearGreedIndex, 0), label: str(d.fearGreedLabel), schnitt30: num(d.fearGreedStats?.avg30, 0), schnitt90: num(d.fearGreedStats?.avg90, 0), jahresHoch: num(d.fearGreedStats?.yearHigh, 0), jahresTief: num(d.fearGreedStats?.yearLow, 0) }),
    sec(13, L[13], { hinweis: SELF_LOADED }),
    sec(14, L[14], { hinweis: "Fazit wird im Client aus den Sektionen 1–12 abgeleitet", ausblick: str(d.finalEstimate?.outlook) }),
  ];
  return {
    dashboard: "btc", entity: "BTC", title: "Bitcoin (BTC)", asOf: str(d.timestamp, 40), sections, gates: [],
    notes: ["BTC-Dashboard hat keine Scoring-Gates; GIS/GWS sind die Scores", "Krypto-Liquidität (3) und Miner-Zone (13) laden eigene Daten und fehlen im Kontext", "Gesamt-Fazit (14) ist nur teilweise im Kontext (im Client abgeleitet)"],
  };
}

/** Labels/IDs identisch mit SECTIONS in client/src/pages/GoldDashboard.tsx (News = 100). */
export const GOLD_SECTION_LABELS: Record<number, string> = {
  1: "Preis & Status", 100: "Gold-News", 2: "Preis-Chart", 9: "Miner-Breakeven", 3: "Indikatoren", 4: "Fair Value", 5: "Monte Carlo",
  6: "Preisschätzung", 7: "Zyklus", 8: "Zusammenfassung",
};

/** Dieselben Zahlen wie Sektion 9. Fehlendes Feld = Offline-Fallback, null = n/a. */
function goldMinerFacts(zone: any): Record<string, ChatFactValue> {
  if (zone === undefined) return { hinweis: "AISC n/a — Offline-Daten, keine Minendaten in dieser Antwort" };
  if (zone == null) return { hinweis: "n/a" };
  const latest = zone.latest;
  const days = num(zone.thresholds?.obs, 0);
  if (!latest || zone.naReason) return { hinweis: zone.naReason ? `n/a — ${zone.naReason}` : "n/a", tage: days };
  return {
    zone: str(latest.zone),
    multiple: num(latest.multiple, 2),
    aiscUsd: num(latest.aisc, 0),
    margeUsd: num(latest.marginUsd, 0),
    margePct: num(typeof latest.marginPct === "number" ? latest.marginPct * 100 : null, 1),
    score: num(latest.score, 0),
    quartal: str(latest.quarter),
    tage: days,
    inScore: false,
  };
}

export function buildGoldChatContext(data: any): ChatContext {
  const d = data ?? {};
  const L = GOLD_SECTION_LABELS;
  const fv = d.fairValue, ry = d.realYieldModel, pe = d.priceEstimate, ad = d.adaptiveScore;
  const mc = (m: any) => (m ? `Median ${num(m.median, 0) ?? "n/a"}, P10 ${num(m.p10, 0) ?? "n/a"}, P90 ${num(m.p90, 0) ?? "n/a"}` : null);
  const sections: ChatSection[] = [
    sec(1, L[1], { kursUSD: num(d.spotPrice), aenderungPct: num(d.changePercent), jahresHoch: num(d.yearHigh), jahresTief: num(d.yearLow), ma200: num(d.ma200), abweichungMA200Pct: num(d.deviationFromMA200, 1), stand: str(d.priceTimestamp), teilausfall: d.partial === true ? (list(d.partialReasons) ?? "ja") : null }),
    sec(100, L[100], { newsFlag: d.goldNews ? num(d.goldNews.flag, 2) : null, newsZusammenfassung: str(d.goldNews?.summary, 600), hinweis: d.goldNews ? null : "News-Abruf lief nicht (n/a)" }),
    sec(2, L[2], { rsi14: num(d.rsi14, 1), historiePunkte: Array.isArray(d.historicalPrices) ? d.historicalPrices.length : null, technikSignale: list((d.technicalSignals ?? []).map((s: any) => `${s.id}: ${s.available === false ? "n/a" : `Richtung ${s.direction ?? "n/a"}`}${s.detail ? ` (${s.detail})` : ""}`), 6) }),
    sec(9, L[9], goldMinerFacts(d.aiscZone)),
    sec(3, L[3], { indikatoren: list((d.indicators ?? []).map((i: any) => `${i.name}: ${i.value} (Score ${i.score}, Gewicht ${num(i.weight * 100, 1) ?? "n/a"}%)`), 10), gis: num(d.gis, 4), adaptiverScore: num(ad?.score, 3), scoreDelta: num(d.scoreDelta ?? ad?.scoreDelta, 3) }),
    sec(4, L[4], { fvBasis: num(fv?.fvBasis, 0), fvAdj: num(fv?.fvAdj, 0), praemie: num(fv?.premium, 2), support1: num(fv?.support1, 0), resistance1: num(fv?.resistance1, 0), realzinsModellFV: num(ry?.fairValue?.fairValue, 0), realzinsRegime: str(ry?.regime?.regime) }),
    sec(5, L[5], { mc3M: mc(d.monteCarlo3M), mc6M: mc(d.monteCarlo6M), mc12M: mc(d.monteCarlo12M) }),
    sec(6, L[6], { mid3M: num(pe?.threeMonth?.mid, 0), mid6M: num(pe?.sixMonth?.mid, 0), mid12M: num(pe?.twelveMonth?.mid, 0), low12M: num(pe?.twelveMonth?.low, 0), high12M: num(pe?.twelveMonth?.high, 0) }),
    sec(7, L[7], { phase: str(d.cycleAssessment?.currentPhase), treiber: list(d.cycleAssessment?.drivers), ausblick: str(d.cycleAssessment?.outlook) }),
    sec(8, L[8], { sentiment: str(d.sentiment), fazit: str(d.finalAssessment, 800), tabelle: list((d.summaryTable ?? []).map((r: any) => `${r.metric}: ${r.value}`), 10) }),
  ];
  const gates = gatesFrom(d.gates ?? ad?.gates ?? ry?.gates);
  const notes: string[] = [];
  if (!gates.length) notes.push("Gold-Gates fehlen in diesen Daten: n/a");
  if (d.partial === true) notes.push("Antwort enthält interne Ersatzwerte (Teilausfall)");
  return { dashboard: "gold", entity: "GOLD", title: "Gold (XAU)", asOf: str(d.timestamp ?? d.analysisDate, 40), sections, gates, notes };
}

/**
 * Rezession: EINE geordnete Liste mit stabilen, semantischen Schlüsseln. Die angezeigte Nummer wird
 * daraus abgeleitet (Seite UND Chat), nie fest verdrahtet. Neue Sektion = ein Eintrag an der
 * richtigen Stelle (z.B. #284: `{ key: "ta", label: "Technische Analyse" }` nach "markt");
 * alle folgenden Nummern verschieben sich automatisch, Schlüssel/Bindungen/Publisher bleiben gleich.
 * `when`: Sektion erscheint nur, wenn das Flag gesetzt ist.
 */
export type RecessionSectionFlag = "regions" | "fazit";
export const RECESSION_SECTION_DEFS: ReadonlyArray<{ key: string; label: string; when?: RecessionSectionFlag }> = [
  { key: "bewertung", label: "Aktuelle Bewertung" }, { key: "nyfed", label: "NY Fed / FRED Referenz" },
  { key: "regeln", label: "Scoring-Regeln" }, { key: "zonen", label: "Scoring-Zonen" },
  { key: "indikatoren", label: "Indikatoren-Tabelle" }, { key: "untergruppen", label: "Score-Übersicht (5 Untergruppen)" },
  { key: "prozent", label: "Prozentschätzungen" },
  { key: "regionen", label: "Regionale Kataloge", when: "regions" },
  { key: "rsi", label: "RSI" }, { key: "markt", label: "Marktcharts" }, { key: "ta", label: "Technische Analyse" }, { key: "buffett", label: "Buffett-Indikator" },
  { key: "summary", label: "Zusammenfassung & Top-3 Treiber" },
  { key: "fazit", label: "Fazit & Makro-Risiko", when: "fazit" },
  { key: "quellen", label: "Quellenliste" },
  { key: "lager", label: "Lager/Nachfrage-Lücke" },
  { key: "makroSchicht", label: "Makro-Schicht" },
  { key: "gewinn", label: "Gewinnwachstum & Growth Gap" },
];

/** Nummerierung wie in client/src/pages/RecessionDashboard.tsx (abhängig von Regionen/Fazit). */
export function recessionSectionLayout(hasRegions: boolean, hasFazit: boolean): Array<{ id: number; label: string; key: string }> {
  const flags: Record<RecessionSectionFlag, boolean> = { regions: hasRegions, fazit: hasFazit };
  return RECESSION_SECTION_DEFS.filter(d => !d.when || flags[d.when]).map((d, i) => ({ id: i + 1, label: d.label, key: d.key }));
}

/** Schlüssel → angezeigte Nummer; fehlende (ausgeblendete) Sektionen fehlen in der Map. */
export function recessionSectionNumbers(hasRegions: boolean, hasFazit: boolean): Record<string, number> {
  return Object.fromEntries(recessionSectionLayout(hasRegions, hasFazit).map(s => [s.key, s.id]));
}

/** Regionale Kataloge (S8) genau wie in RegionalCatalogSection angezeigt; fehlende Werte = null. */
function regionFacts(cat: any): Record<string, ChatFactValue> {
  if (!cat || !Array.isArray(cat.regions)) return { hinweis: "Regionale Kataloge nicht geladen (n/a)" };
  const pct = (v: any) => (typeof v === "number" && Number.isFinite(v) ? `${v}%` : "n/a");
  const out: Record<string, ChatFactValue> = {};
  for (const r of cat.regions.slice(0, 6)) {
    const id = String(r?.id ?? "n/a").slice(0, 8);
    out[`region_${id}`] = str(`${r?.label ?? id}: Katalog Rez. ${pct(r?.recessionProbability)}, Katalog Korr. ${pct(r?.correctionProbability)}, Gewicht ×${num(r?.weight, 2)?.toFixed(2) ?? "n/a"}`);
    out[`slots_${id}`] = list((r?.slots ?? []).map((sl: any) => `${sl.name}: ${sl.value} | ${sl.zone} | Score ${sl.available ? `${sl.weightedScore > 0 ? "+" : ""}${sl.weightedScore}` : "—"}/${sl.available ? sl.maxWeighted : 0}`), 12);
  }
  out.gewichteteRezession12MPct = num(cat.blendedRecession12m, 1);
  out.gewichteteKorrektur12MPct = num(cat.blendedCorrection12m, 1);
  const w = cat.weights;
  out.gewichte = w ? str(`US ${num(w.US, 2)?.toFixed(2) ?? "n/a"} / EZ ${num(w.EZ, 2)?.toFixed(2) ?? "n/a"} / JP ${num(w.JP, 2)?.toFixed(2) ?? "n/a"}`) : null;
  out.handlungAufUSBuechern = cat.actionUsesUsBooks === true ? "Handlung bleibt auf den US-Büchern P_korr12 und P_rez12." : null;
  return out;
}

export function buildRecessionChatContext(data: any, opts: { hasRegions: boolean; regions?: any }): ChatContext {
  const d = data ?? {};
  const subs: any[] = Array.isArray(d.subgroups) ? d.subgroups : [];
  const inds: any[] = Array.isArray(d.indicators) ? d.indicators : [];
  const facts: Record<string, Record<string, ChatFactValue>> = {
    bewertung: Object.fromEntries(subs.slice(0, 8).map(s => [`P_${String(s.name).slice(0, 40)}`, num(s.finalProbability ?? s.probability, 1)])),
    nyfed: { nyFedWertPct: num(d.nyFedValue, 1), googleTrends: typeof d.googleTrendsAvailable === "boolean" ? d.googleTrendsAvailable : null },
    regeln: { hinweis: "Statische Regeltexte des Dashboards" },
    zonen: { hinweis: "Statische Zonen des Dashboards" },
    indikatoren: Object.fromEntries(inds.slice(0, CHAT_LIMITS.maxFactsPerSection).map(i => [String(i.name).slice(0, CHAT_LIMITS.maxFactKeyChars), str(i.available === false ? `n/a (${i.subgroup})` : `${i.value} | Score ${i.rawScore} | ${i.zone} | ${i.group}/${i.subgroup}${i.proxy ? " | Proxy" : ""}`)])),
    untergruppen: Object.fromEntries(subs.slice(0, 8).map(s => [String(s.name).slice(0, 40), str(`${s.label} (${s.horizon}): net ${num(s.netScore, 2) ?? "n/a"}/${num(s.maxScore, 2) ?? "n/a"}, P ${num(s.probability, 1) ?? "n/a"}%`)])),
    // S7 wie angezeigt: P, Netto/Max, Formel. NY-Fed-Anker/final existieren nur in der Mischformel von
    // "recession_full" (server/recession.ts); für die übrigen Gruppen gibt es sie nicht → nicht als n/a melden.
    prozent: Object.fromEntries(subs.slice(0, 8).map(s => [String(s.name).slice(0, 40), str(`P ${num(s.probability, 1) ?? "n/a"}% (${s.horizon ?? "n/a"}), Netto ${num(s.netScore, 1) ?? "n/a"}/${num(s.maxScore, 1) ?? "n/a"}${typeof s.nyFedAnchor === "number" ? `, NY-Fed-Anker ${num(s.nyFedAnchor, 1)}%, final ${num(s.finalProbability, 1) ?? "n/a"}%` : ""}${s.formula ? ` | ${s.formula}` : ""}`)])),
    regionen: regionFacts(opts.regions),
    rsi: { hinweis: SELF_LOADED }, markt: { hinweis: SELF_LOADED }, ta: { hinweis: SELF_LOADED }, buffett: { hinweis: SELF_LOADED },
    lager: { hinweis: SELF_LOADED },
    makroSchicht: { hinweis: SELF_LOADED },
    gewinn: { hinweis: SELF_LOADED },
    summary: { topTreiber: list(d.topDrivers), interpretation: str(d.interpretation, 800) },
    fazit: { risiko: str(d.fazit?.riskLevel), zusammenfassung: str(d.fazit?.summary, 800), abschnitte: list((d.fazit?.sections ?? []).map((s: any) => s.title)) },
    quellen: { anzahl: Array.isArray(d.sources) ? d.sources.length : null, quellen: list((d.sources ?? []).map((s: any) => s.name), 8) },
  };
  const sections = recessionSectionLayout(opts.hasRegions, !!d.fazit).map(s => ({ ...sec(s.id, s.label, facts[s.key] ?? {}), key: s.key }));
  return {
    dashboard: "recession", entity: "US-Rezession", title: "Rezessions-Dashboard", asOf: str(d.asOf ?? d.date, 40), sections, gates: [],
    notes: ["Rezessions-Dashboard hat keine Gates; Scores sind die 5 Untergruppen", "RSI, Marktcharts, Technische Analyse, Buffett-Indikator, Lager/Nachfrage-Lücke, Makro-Schicht und Gewinnwachstum laden eigene Daten und fehlen im Kontext, bis sie geladen sind"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 3: Kontext vollständig. `enrichChatContext` ergänzt einen Provider-Kontext um die Werte, die
// Sektionen im Client anzeigen (veröffentlicht über client/src/lib/chatSectionData.ts), und um
// eine kompakte Zeile "auffaelligkeiten" je Sektion. Die Provider selbst bleiben unverändert.
//
// Auffälligkeiten entstehen NUR aus vorhandenen Daten/Flags/Gates:
//   - Flags, die die Sektion selbst anzeigt (vom Publisher als `_auffaelligkeiten` geliefert),
//   - aktive Gates (in der Gate-Sektion des Dashboards),
//   - fehlende Werte (n/a-Felder) und nicht geladene Selbstlade-Sektionen.
//
// Kontext-Budget (geprüft in script/test-chat-context-full.ts und script/test-chat-fact-limit.ts):
//   Server-Decke CHAT_LIMITS.maxContextChars = 40 000 Zeichen (JSON). Ziel CHAT_CONTEXT_BUDGET = 36 000.
//   allowedChars = floor(Budget * Priorität / Summe). Priorität: guv > earningsCall > wachstumsthese
//   > rationale > notes. Kein festes 400- oder 1000-Zeichen-Limit. Liegt der Payload darüber, kürzt
//   fitChatContextBudget proportional: zuerst Notes, dann übrige Fakten (längste zuerst, ab 80 Zeichen
//   halbiert, Auffälligkeiten ausgenommen), dann Rationale, dann die Wachstumsthese, dann die
//   Earnings-Call-Gruppe und die GuV-Gruppe zuletzt.
// ─────────────────────────────────────────────────────────────────────────────

export const CHAT_WEAKNESS_KEY = "auffaelligkeiten";
/** Schlüssel, unter dem Publisher angezeigte Warn-Flags liefern (wird in `auffaelligkeiten` überführt). */
export const CHAT_LIVE_FLAGS_KEY = "_auffaelligkeiten";

export interface EnrichChatOptions {
  /** Live-Schlüssel → Sektions-ID (z.B. Rezession "rsi" → 9). Ohne Eintrag: Schlüssel als Zahl. */
  keyToId?: Record<string, number>;
  /** Sektion, in der aktive Gates als Auffälligkeit erscheinen (Aktie 20, Gold 8). */
  gatesSectionId?: number;
}

const CLIENT_HINT_RE = /im Client (berechnet|aus der Kurshistorie|aus den Sektionen)|lädt eigene Daten nach/;

export function enrichChatContext(
  ctx: ChatContext,
  live: Readonly<Record<string, Record<string, ChatFactValue>>> | null | undefined,
  opts: EnrichChatOptions = {},
): ChatContext {
  const byId = new Map<number, Record<string, ChatFactValue>>();
  for (const [key, facts] of Object.entries(live ?? {})) {
    const id = opts.keyToId?.[key] ?? Number(key);
    if (Number.isFinite(id) && facts) byId.set(id, facts);
  }
  const activeGates = ctx.gates.filter(g => g.active);
  const missingSelfLoaded: string[] = [];

  const sections = ctx.sections.map(s0 => {
    const liveFacts = byId.get(s0.id);
    const facts: Record<string, ChatFactValue> = { ...s0.facts };
    const flags: string[] = [];
    if (liveFacts) {
      if (typeof facts.hinweis === "string" && CLIENT_HINT_RE.test(facts.hinweis)) delete facts.hinweis;
      for (const [k, v] of Object.entries(liveFacts)) {
        if (k === CHAT_LIVE_FLAGS_KEY) { if (typeof v === "string" && v) flags.push(v); continue; }
        facts[k.slice(0, CHAT_LIMITS.maxFactKeyChars)] = typeof v === "string" ? str(v) : v;
      }
    } else if (facts.hinweis === SELF_LOADED) {
      flags.push("Daten dieser Sektion sind (noch) nicht geladen: n/a");
      missingSelfLoaded.push(s0.label);
    }
    if (opts.gatesSectionId === s0.id && activeGates.length) {
      flags.push(`aktive Gates: ${activeGates.map(g => `${g.id}${g.cap != null ? ` (Cap ${g.cap})` : ""}`).join(", ")}`);
    }
    const nas = Object.entries(facts).filter(([k, v]) => v === null && k !== CHAT_WEAKNESS_KEY).map(([k]) => k);
    if (nas.length) flags.push(`fehlende Werte (n/a): ${nas.slice(0, 8).join(", ")}${nas.length > 8 ? ` +${nas.length - 8}` : ""}`);
    const entries = Object.entries(facts).slice(0, CHAT_LIMITS.maxFactsPerSection - 1);
    entries.push([CHAT_WEAKNESS_KEY, flags.length ? str(flags.join(" | ")) : "keine aus den vorhandenen Daten ableitbar"]);
    return { ...s0, facts: Object.fromEntries(entries) };
  });

  const notes = (live && byId.size ? ctx.notes.filter(n => !/fehlen im Kontext|nur teilweise im Kontext/.test(n)) : [...ctx.notes]);
  if (byId.size) notes.push(`Angezeigte Client-Werte übernommen für Sektionen: ${Array.from(byId.keys()).sort((a, b) => a - b).join(", ")}`);
  if (missingSelfLoaded.length) notes.push(`Noch nicht geladen (n/a): ${missingSelfLoaded.join(", ")}`);
  return fitChatContextBudget({ ...ctx, sections, notes: notes.slice(0, CHAT_LIMITS.maxNotes) });
}

const CHAT_TRIM_LABEL: Record<ChatTrimKind, string> = {
  notes: "Notizen",
  facts: "Fakten",
  rationale: "Rationale",
  wachstumsthese: "Wachstumsthese",
  earningsCall: "Earnings Call",
  guv: "GuV-Posten",
};

function chatTrimChars(ctx: ChatContext): Record<ChatTrimKind, number> {
  const out: Record<ChatTrimKind, number> = { notes: 0, facts: 0, rationale: 0, wachstumsthese: 0, earningsCall: 0, guv: 0 };
  for (const n of ctx.notes ?? []) if (typeof n === "string") out.notes += n.length;
  for (const g of ctx.gates ?? []) if (typeof g?.rationale === "string") out.rationale += g.rationale.length;
  for (const s of ctx.sections ?? []) for (const [k, v] of Object.entries(s.facts ?? {})) {
    if (typeof v !== "string") continue;
    if (k === "wachstumsthese") out.wachstumsthese += v.length;
    else out[chatFactGroupOf(k) ?? "facts"] += v.length;
  }
  return out;
}

/** Differenz der Textlängen. `undefined`, wenn nichts gekürzt oder gelöscht wurde. */
export function chatContextTrimReport(before: ChatContext, after: ChatContext): ChatContextTrimEntry[] | undefined {
  const a = chatTrimChars(before);
  const b = chatTrimChars(after);
  const entries = CHAT_TRIM_KINDS.flatMap(kind => {
    const removedChars = a[kind] - b[kind];
    return removedChars > 0 ? [{ kind, removedChars }] : [];
  });
  return entries.length ? entries : undefined;
}

const trimByContext = new WeakMap<ChatContext, ChatContextTrimEntry[]>();

/** Kürzung, die `fitChatContextBudget` an diesem Kontext-Objekt hinterlegt hat. */
export function chatContextTrimOf(ctx: ChatContext | null | undefined): ChatContextTrimEntry[] | undefined {
  if (!ctx) return undefined;
  const found = trimByContext.get(ctx);
  return found?.length ? found : undefined;
}

export function mergeChatContextTrim(
  a: ChatContextTrimEntry[] | undefined,
  b: ChatContextTrimEntry[] | undefined,
): ChatContextTrimEntry[] | undefined {
  const sums = new Map<ChatTrimKind, number>();
  for (const e of [...(a ?? []), ...(b ?? [])]) sums.set(e.kind, (sums.get(e.kind) ?? 0) + e.removedChars);
  const entries = CHAT_TRIM_KINDS.flatMap(kind => {
    const removedChars = sums.get(kind) ?? 0;
    return removedChars > 0 ? [{ kind, removedChars }] : [];
  });
  return entries.length ? entries : undefined;
}

function groupedInt(n: number): string {
  return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Hinweiszeile, z. B. „Kontext gekürzt: Notizen −2.140 Zeichen“. `null`, wenn nichts gekürzt wurde. */
export function formatChatContextTrim(entries: ChatContextTrimEntry[] | undefined): string | null {
  if (!entries?.length) return null;
  const parts = entries.map(e => `${CHAT_TRIM_LABEL[e.kind]} −${groupedInt(e.removedChars)} Zeichen`);
  return `Kontext gekürzt: ${parts.join(", ")}`;
}

function clipTo(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}

function overTypeCap(ctx: ChatContext): boolean {
  const factMax = CHAT_LIMITS.maxFactValueChars;
  const ratMax = CHAT_LIMITS.maxRationaleChars;
  const noteMax = CHAT_LIMITS.maxNoteChars;
  if (ctx.notes.some(n => typeof n === "string" && n.length > noteMax)) return true;
  if (ctx.gates.some(g => typeof g.rationale === "string" && g.rationale.length > ratMax)) return true;
  return ctx.sections.some(s => Object.values(s.facts).some(v => typeof v === "string" && v.length > factMax));
}

function cappedCopy(ctx: ChatContext): ChatContext {
  const factMax = CHAT_LIMITS.maxFactValueChars;
  const ratMax = CHAT_LIMITS.maxRationaleChars;
  const noteMax = CHAT_LIMITS.maxNoteChars;
  return {
    ...ctx,
    sections: ctx.sections.map(s => ({
      ...s,
      facts: Object.fromEntries(Object.entries(s.facts).map(([k, v]) => [k, typeof v === "string" ? clipTo(v, factMax) : v])),
    })),
    gates: ctx.gates.map(g => ({ ...g, rationale: typeof g.rationale === "string" ? clipTo(g.rationale, ratMax) : g.rationale })),
    notes: ctx.notes.map(n => (typeof n === "string" ? clipTo(n, noteMax) : n)),
  };
}

/** Kürzt jede Zeichenkette im Bucket um denselben Anteil, bis `overflow` Zeichen weg sind. */
function shrinkProportionally(values: string[], overflow: number): string[] | null {
  if (overflow <= 0) return null;
  const flexible = values.map((s, i) => ({ i, len: s.length })).filter(x => x.len > 1);
  if (!flexible.length) return null;
  const total = flexible.reduce((a, x) => a + x.len, 0);
  const remove = Math.min(total - flexible.length, overflow);
  if (remove <= 0) return null;
  const keepRatio = (total - remove) / total;
  const next = values.slice();
  let changed = false;
  for (const x of flexible) {
    const target = Math.max(1, Math.floor(x.len * keepRatio));
    if (target < x.len) {
      next[x.i] = clipTo(values[x.i], target);
      changed = true;
    }
  }
  return changed ? next : null;
}

/** Niedrigere Priorität zuerst: Earnings Call vor den GuV-Posten. */
const CHAT_FACT_GROUPS_BY_TRIM_ORDER: readonly ChatFactGroup[] = (Object.keys(CHAT_FACT_GROUP_PREFIX) as ChatFactGroup[])
  .sort((a, b) => CHAT_FACT_PRIORITY[a] - CHAT_FACT_PRIORITY[b]);

function shrinkFactGroup(ctx: ChatContext, group: ChatFactGroup, overflow: number): boolean {
  const loc: Array<{ s: ChatSection; k: string }> = [];
  const values: string[] = [];
  for (const s of ctx.sections) for (const [k, v] of Object.entries(s.facts)) {
    if (chatFactGroupOf(k) === group && typeof v === "string" && v.length > 1) { loc.push({ s, k }); values.push(v); }
  }
  const next = shrinkProportionally(values, overflow);
  if (!next) return false;
  loc.forEach((l, i) => { l.s.facts[l.k] = next[i]; });
  return true;
}

/** Hält den Kontext unter `budget` Zeichen (JSON). Kürzt weich, lehnt nicht ab. Reine Funktion. */
export function fitChatContextBudget(ctx: ChatContext, budget: number = CHAT_CONTEXT_BUDGET): ChatContext {
  const size = (c: ChatContext) => JSON.stringify(c).length;
  if (size(ctx) <= budget && !overTypeCap(ctx)) return ctx;
  const out = cappedCopy(ctx);
  for (let guard = 0; guard < 6000 && size(out) > budget; guard++) {
    const overflow = size(out) - budget;
    if (out.notes.every(n => typeof n === "string")) {
      const notesNext = shrinkProportionally(out.notes, overflow);
      if (notesNext) { out.notes = notesNext; continue; }
    }
    let best: { s: ChatSection; k: string; len: number } | null = null;
    for (const s of out.sections) for (const [k, v] of Object.entries(s.facts)) {
      if (k === CHAT_WEAKNESS_KEY || k === "wachstumsthese" || chatFactGroupOf(k) || typeof v !== "string" || v.length <= 80) continue;
      if (!best || v.length > best.len) best = { s, k, len: v.length };
    }
    if (best) { const v = best.s.facts[best.k] as string; best.s.facts[best.k] = `${v.slice(0, Math.max(80, Math.floor(v.length / 2)) - 1)}…`; continue; }
    if (out.gates.every(g => typeof g.rationale === "string")) {
      const ratNext = shrinkProportionally(out.gates.map(g => g.rationale), overflow);
      if (ratNext) { out.gates.forEach((g, i) => { g.rationale = ratNext[i]; }); continue; }
    }
    const thesisLoc: Array<{ s: ChatSection; k: string }> = [];
    const theses: string[] = [];
    for (const s of out.sections) for (const [k, v] of Object.entries(s.facts)) {
      if (k === "wachstumsthese" && typeof v === "string" && v.length > 1) { thesisLoc.push({ s, k }); theses.push(v); }
    }
    const thesisNext = shrinkProportionally(theses, overflow);
    if (thesisNext) { thesisLoc.forEach((loc, i) => { loc.s.facts[loc.k] = thesisNext[i]; }); continue; }
    if (CHAT_FACT_GROUPS_BY_TRIM_ORDER.some(group => shrinkFactGroup(out, group, overflow))) continue;
    if (!out.sections.length) break;
    const big = out.sections.reduce((a, b) => (Object.keys(b.facts).length > Object.keys(a.facts).length ? b : a));
    const plain = Object.keys(big.facts).filter(k => k !== CHAT_WEAKNESS_KEY && k !== "wachstumsthese" && !chatFactGroupOf(k));
    const keys = plain.length ? plain : Object.keys(big.facts).filter(k => k !== CHAT_WEAKNESS_KEY);
    if (!keys.length) break;
    delete big.facts[keys[keys.length - 1]];
  }
  const report = chatContextTrimReport(ctx, out);
  if (report) trimByContext.set(out, report);
  return out;
}
