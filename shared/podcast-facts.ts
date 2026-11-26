/**
 * Fakten für den Aktien-Podcast. Nur kopieren, nichts schätzen.
 * Quartals-YoY und Umsatz über vier Quartale bleiben leer.
 * Fremdwährung wird vor der Sprechform in USD gerechnet, wenn ein Kurs vorliegt.
 */
import { createHash } from "node:crypto";
import { currencyWord } from "../server/exec-summary";
import { buildExecSummaryInputFromAnalysis } from "../server/exec-summary-attach";
import type { FullAiPack } from "../server/stock-podcast-full-ai";
import { keepCompleteSentences, priceLabelDe, rankAfterRounding, speakIsoDate, speakNewsAge, speakNormalize, speakPercent, speakPriceUsd, speakQuarterPhrase, speakYear } from "./podcast-speak";

export const PODCAST_PLACEHOLDERS = [
  "ticker", "company", "as_of", "currency_word", "statement_currency_word",
  "price", "score", "ampel", "wacc", "g_star", "dcf_fair", "dcf_low", "dcf_high",
  "entry", "crv", "quarter_yoy", "quarter_period_end", "ttm_revenue", "ttm_period_end",
  "top_segment", "top_segment_share", "call_date", "call_quarter", "catalyst_mode",
  "news_1", "news_2", "news_3", "news_age", "fy_yoy", "gj_year",
  "fcf_margin", "netto_upside_1", "netto_upside_2", "netto_upside_3",
] as const;

export type PodcastPlaceholder = (typeof PODCAST_PLACEHOLDERS)[number];
export type PodcastFactValues = Record<PodcastPlaceholder, string | null>;

/** money und percent bringen die Einheit schon mit. date und Kurswerte spricht nur der Code. */
export type PlaceholderKind = "money" | "percent" | "date" | "name" | "text";

export const PLACEHOLDER_KIND: Record<PodcastPlaceholder, PlaceholderKind> = {
  ticker: "name",
  company: "name",
  as_of: "date",
  currency_word: "name",
  statement_currency_word: "name",
  price: "money",
  score: "text",
  ampel: "name",
  wacc: "percent",
  g_star: "percent",
  dcf_fair: "money",
  dcf_low: "money",
  dcf_high: "money",
  entry: "money",
  crv: "text",
  quarter_yoy: "percent",
  quarter_period_end: "date",
  ttm_revenue: "money",
  ttm_period_end: "date",
  top_segment: "name",
  top_segment_share: "percent",
  call_date: "date",
  call_quarter: "name",
  catalyst_mode: "text",
  news_1: "name",
  news_2: "name",
  news_3: "name",
  news_age: "text",
  fy_yoy: "percent",
  gj_year: "name",
  fcf_margin: "percent",
  netto_upside_1: "percent",
  netto_upside_2: "percent",
  netto_upside_3: "percent",
};

const MODEL_FORBIDDEN = new Set<PodcastPlaceholder>([
  "price", "dcf_fair", "dcf_low", "dcf_high", "entry", "ttm_revenue",
  "as_of", "call_date", "quarter_period_end", "ttm_period_end",
  "call_quarter", "catalyst_mode", "currency_word", "statement_currency_word",
  "news_1", "news_2", "news_3", "news_age", "crv",
]);

export function placeholderForbiddenInModel(name: PodcastPlaceholder): boolean {
  return MODEL_FORBIDDEN.has(name);
}

export interface PodcastFacts {
  values: PodcastFactValues;
  tokens: string[];
  asOfIso: string;
  asOfLabel: string;
  priceLabel: string | null;
  rankOk: boolean;
  sig: 3 | 4;
  peerBanner: string | null;
  sectorFlag: string | null;
  callEstimated: boolean;
  nextCallLine: string | null;
  segmentPeriodMissing: boolean;
  earningsState: "missing" | "stale" | "ready";
  earningsNote: string | null;
  catalystGeneric: boolean;
  hasThesis: boolean;
  /** These aus dem Pack, ohne Ziffern-Schwärzung. Der Linter prüft sie danach. */
  thesisText: string | null;
  hasPorter: boolean;
  hasPestel: boolean;
  riskNames: string[];
  /** Ticker, Firma, Segment, Katalysator- und Produktnamen. Beim Einsetzen geschützt. */
  protectedNames: string[];
  /** Risiko-, News- und Katalysator-Titel. Das Modell bekommt sie nur als Kontext. */
  payloadTitles: string[];
  /** Namen der Katalysatoren mit Netto-Upside, parallel zu netto_upside_1..3. */
  upsideNames: string[];
  /** Numerischer Börsenkürzel, der nie gesprochen wird. */
  silentTicker: string | null;
  /** Fiskalquartal oder der Hinweis, dass nur das zuletzt gemeldete Quartal vorliegt. */
  reportedQuarterLine: string | null;
  proSeed: string | null;
  contraSeed: string | null;
  redactedContext: string;
  /** Rohwerte hinter der Sprechform. Gesetzt von buildPodcastFacts, für die englische Sprechform. */
  measures?: PodcastMeasures;
}

/** Zahlen, die buildPodcastFacts schon geprüft hat. Die Sprechform entsteht daraus, nichts wird geschätzt. */
export interface PodcastMeasures {
  companySource: string | null;
  asOfIso: string;
  price: number | null;
  fair: number | null;
  entry: number | null;
  crv: number | null;
  sig: 3 | 4;
  fyYoy: number | null;
  fiscalYear: number | null;
  wacc: number | null;
  gStar: number | null;
  segmentName: string | null;
  segmentShare: number | null;
  newsAgeDays: number | null;
  ampel: string | null;
  callDateIso: string | null;
  callQuarterRaw: string | null;
  upsides: Array<{ name: string; upside: number }>;
  catalystNames: string[];
  riskNames: string[];
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

function usd(n: number | null, currency: string, fx: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  if (!currency || currency === "USD") return n;
  if (fx == null || !(fx > 0)) return null;
  return n * fx;
}

function isoDay(raw: string | null, fallback: Date): { iso: string; label: string } {
  const parsed = raw ? new Date(raw) : fallback;
  const when = Number.isNaN(parsed.getTime()) ? fallback : parsed;
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(when);
  const [year, month, day] = key.split("-");
  return { iso: key, label: `${day}.${month}.${year}` };
}

function topSegment(analysis: any): { name: string; share: number | null; fiscalYear: string | null } | null {
  const rows = Array.isArray(analysis?.revenueSegments) ? analysis.revenueSegments : [];
  let best: any = null;
  for (const row of rows) {
    const revenue = finite(row?.revenue) ? row.revenue : finite(row?.percentage) ? row.percentage : null;
    if (revenue == null) continue;
    const bestRevenue = best == null ? -Infinity : (finite(best.revenue) ? best.revenue : finite(best.percentage) ? best.percentage : -Infinity);
    if (revenue > bestRevenue) best = row;
  }
  if (!best) return null;
  const name = text(best.name);
  if (!name) return null;
  return {
    name,
    share: finite(best.percentage) ? best.percentage : null,
    fiscalYear: text(best.fiscalYear),
  };
}

function madridDayNumber(raw: string): number | null {
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(when);
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function recentNews(analysis: any, dataTimestamp: string): Array<{ title: string; ageDays: number }> {
  const items = Array.isArray(analysis?.newsItems) ? analysis.newsItems : [];
  const asOfDay = madridDayNumber(dataTimestamp);
  const out: Array<{ title: string; ageDays: number }> = [];
  for (const item of items) {
    const title = text(item?.title);
    const pub = text(item?.pubDate);
    if (!title || !pub || asOfDay == null) continue;
    const pubDay = madridDayNumber(pub);
    if (pubDay == null) continue;
    const ageDays = asOfDay - pubDay;
    if (ageDays < 0 || ageDays > 14) continue;
    out.push({ title, ageDays });
  }
  out.sort((a, b) => a.ageDays - b.ageDays);
  return out.slice(0, 3);
}

function quarterOf(label: string | null): { q: number; year: number } | null {
  if (!label) return null;
  const m = /Q([1-4])\s*(?:FY|GJ)?\s*((?:19|20)\d{2})/i.exec(label);
  if (!m) return null;
  return { q: Number(m[1]), year: Number(m[2]) };
}

function redact(textIn: string): string {
  return textIn.replace(/[<>%]/g, " ").replace(/\d+(?:[.,]\d+)?/g, "…").replace(/\s+/g, " ").trim();
}

function clip(textIn: string, max: number): string {
  const clean = redact(textIn);
  if (clean.length <= max) return clean;
  return keepCompleteSentences(clean.slice(0, max));
}

function spokenCatalystMode(analysis: any): string {
  const llm = analysis?.catalystsSource === "llm" || analysis?.llmMode === true;
  if (!llm) return "Katalysatoren: generisch, Sektor";
  const raw = text(analysis?.growthThesisGeneratedAt) ?? text(analysis?.catalystsTimestamp) ?? text(analysis?.dataTimestamp);
  if (!raw) return "Katalysatoren: KI-firmenspezifisch";
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return "Katalysatoren: KI-firmenspezifisch";
  const day = isoDay(raw, when);
  const spoken = speakIsoDate(day.iso, "dat");
  return spoken ? `Katalysatoren: KI-firmenspezifisch, Stand vom ${spoken}` : "Katalysatoren: KI-firmenspezifisch";
}

function plainSectorFlag(flag: string | null): string | null {
  if (!flag) return null;
  if (/GrowthEvidence|Peer-Gap fehlt|Sektor-Referenz nicht belastbar/i.test(flag)) {
    return "Die Sektor-Referenz ist nicht belastbar.";
  }
  const cleaned = flag.replace(/^[A-Za-z][A-Za-z0-9]*:\s*/, "").trim();
  if (!cleaned || /GrowthEvidence/i.test(cleaned)) return null;
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

export function hashPodcastFacts(values: PodcastFactValues): string {
  const keys = Object.keys(values).sort();
  const canon = JSON.stringify(keys.map(k => [k, values[k as PodcastPlaceholder]]));
  return createHash("sha256").update(canon).digest("hex");
}

export function buildPodcastFacts(pack: FullAiPack, now = new Date()): PodcastFacts {
  const analysis = pack.analysis ?? {};
  const input = buildExecSummaryInputFromAnalysis(analysis);
  const internals = analysis._podcastInternals ?? {};
  const reported = text(internals.reportedCurrency) ?? text(analysis.currency) ?? "USD";
  const fx = reported === "USD" ? 1 : (finite(internals.fxRateToUsd) && internals.fxRateToUsd > 0 ? internals.fxRateToUsd : null);
  const stamp = text(analysis.dataTimestamp) ?? text(analysis._cachedAt) ?? pack.generatedAt;
  const asOf = isoDay(stamp, now);
  const priceN = usd(finite(input.price) && input.price > 0 ? input.price : null, reported, fx);
  const fairN = usd(finite(input.dcfConservative) && input.dcfConservative > 0 ? input.dcfConservative : null, reported, fx);
  const entryN = usd(finite(input.maxEntryCrv3) && input.maxEntryCrv3 > 0 ? input.maxEntryCrv3 : null, reported, fx);
  const rank = rankAfterRounding({ price: priceN, entry: entryN, fair: fairN, low: null, high: null });
  const sig = rank.sig;
  const growth = finite(input.revenueGrowthPct) ? input.revenueGrowthPct : null;
  const prior = finite(internals.revenueY1) && internals.revenueY1 > 0 ? internals.revenueY1 : null;
  const fy = prior != null && growth != null ? growth : (internals.revenueY1 === undefined && growth != null && growth !== 0 ? growth : null);
  const year = text(internals.fiscalYear);
  const gj = year && /^\d{4}$/.test(year) ? speakYear(Number(year)) : null;
  const segment = topSegment(analysis);
  const news = recentNews(analysis, stamp);
  const callIso = text(analysis.nextEarningsDate);
  const nextDay = callIso ? callIso.slice(0, 10) : null;
  const todayKey = isoDay(now.toISOString(), now).iso;
  const nextCallIsFuture = nextDay != null && nextDay > todayKey;
  const nextCallSpoken = nextDay ? speakIsoDate(nextDay, "dat") : null;
  const reportedQuarter = text(analysis.lastReportedQuarter);
  const brief = pack.earningsBrief;
  let earningsState: PodcastFacts["earningsState"] = "missing";
  let earningsNote: string | null = "Ein Earnings-Call-Transkript liegt nicht vor.";
  const fiscalFromLabel = speakQuarterPhrase(reportedQuarter ?? "");
  let callQuarter: string | null = fiscalFromLabel;
  if (brief && brief.status === "ok" && brief.quarter && brief.year) {
    callQuarter = speakQuarterPhrase(`Q${brief.quarter} GJ${brief.year}`) ?? fiscalFromLabel;
    const reportedQ = quarterOf(reportedQuarter);
    const briefIndex = brief.year * 4 + brief.quarter;
    const reportedIndex = reportedQ ? reportedQ.year * 4 + reportedQ.q : null;
    if (reportedIndex != null && briefIndex < reportedIndex) {
      earningsState = "stale";
      earningsNote = callQuarter
        ? `Das Transkript stammt aus ${callQuarter} und ist älter als das zuletzt gemeldete Quartal.`
        : "Das Transkript ist älter als das zuletzt gemeldete Quartal.";
    } else {
      earningsState = "ready";
      earningsNote = null;
    }
  }
  const reportedQuarterLine = callQuarter ? `Zuletzt gemeldet wurde das ${callQuarter}.` : null;
  const nextCallLine = nextCallIsFuture && nextCallSpoken
    ? `Der nächste Earnings Call ist für den ${nextCallSpoken} angekündigt.`
    : null;
  const source = analysis.catalystsSource === "llm" || analysis.llmMode === true ? "llm" : "generic";
  const mode = spokenCatalystMode(analysis);
  const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
  const riskNames: string[] = risks.map((r: any) => text(r?.name)).filter((n: string | null): n is string => !!n).slice(0, 3);
  const upsides = catalystUpsides(analysis);
  const fcfMargin = finite(analysis.fcfMargin) && analysis.fcfMargin !== 0 ? analysis.fcfMargin : null;
  const catalysts = Array.isArray(analysis.catalysts) ? analysis.catalysts : [];
  const rawTicker = text(analysis.ticker) ?? pack.ticker;
  const silentTicker = isNumericTicker(rawTicker) ? rawTicker : null;
  const namedCompany = companyFromAnalysis(analysis, rawTicker);
  const segmentAndProjects = [
    ...(Array.isArray(analysis.keyProjects) ? analysis.keyProjects.map((p: any) => text(p)) : []),
  ].filter((t): t is string => !!t);
  const protectedNames = [
    silentTicker ? null : rawTicker,
    namedCompany,
    ...segmentAndProjects,
  ].filter((t): t is string => !!t);
  const tokens = [
    silentTicker ? null : rawTicker,
    namedCompany,
    ...segmentAndProjects,
    ...riskNames,
  ].filter((t): t is string => !!t);
  const moneyWord = reported === "USD" || fx != null ? "Dollar" : currencyWord(reported);
  const values: PodcastFactValues = {
    ticker: silentTicker ? null : rawTicker,
    company: namedCompany,
    as_of: speakIsoDate(asOf.iso, "dat"),
    currency_word: moneyWord,
    statement_currency_word: moneyWord,
    price: priceN == null ? null : speakPriceUsd(priceN, sig),
    score: finite(input.scoreCapped) ? speakPriceUsd(input.scoreCapped, 3)?.replace(/ Dollar$/, "") ?? null : null,
    ampel: text(input.s17Verdict),
    wacc: finite(input.waccPct) ? speakPercent(input.waccPct) : null,
    g_star: finite(input.gStarPct) ? speakPercent(input.gStarPct) : null,
    dcf_fair: fairN == null ? null : speakPriceUsd(fairN, sig),
    dcf_low: null,
    dcf_high: null,
    entry: entryN == null ? null : speakPriceUsd(entryN, sig),
    crv: finite(input.crvBase) ? speakRoundedCrv(input.crvBase) : null,
    quarter_yoy: null,
    quarter_period_end: null,
    ttm_revenue: null,
    ttm_period_end: null,
    top_segment: segment?.name ?? null,
    top_segment_share: segment?.share != null ? speakPercent(segment.share) : null,
    call_date: nextCallSpoken,
    call_quarter: callQuarter,
    catalyst_mode: mode,
    news_1: null,
    news_2: null,
    news_3: null,
    news_age: news.length ? speakNewsAge(news[0]!.ageDays) : null,
    fy_yoy: fy == null ? null : speakPercent(fy),
    gj_year: gj,
    fcf_margin: fcfMargin == null ? null : speakPercent(fcfMargin),
    netto_upside_1: upsides[0] ? speakPercent(upsides[0].upside) : null,
    netto_upside_2: upsides[1] ? speakPercent(upsides[1].upside) : null,
    netto_upside_3: upsides[2] ? speakPercent(upsides[2].upside) : null,
  };
  const catalystNames: string[] = catalysts.map((c: any) => text(c?.name)).filter((t: string | null): t is string => !!t);
  const payloadTitles = [...riskNames, ...news.map(item => item.title), ...catalystNames, ...(segment?.name ? [segment.name] : [])];
  const spokenRisks = riskNames
    .map(name => speakNormalize(name))
    .filter((name): name is string => !!name);
  const peerBanner = text(analysis.peerSet?.banner);
  const flags = Array.isArray(pack.thesisStrength?.flags) ? pack.thesisStrength.flags.map((f: any) => String(f)) : [];
  const sectorFlag = plainSectorFlag(flags.find((f: string) => /Sektor-Referenz nicht belastbar|GrowthEvidence|Peer-Gap fehlt/.test(f)) ?? null);
  const porter = analysis.moatAssessment?.porterForces ?? analysis.porterForces;
  const hasPorter = Array.isArray(porter) ? porter.length > 0 : !!porter;
  const hasPestel = (Array.isArray(pack.pestelLlm) && pack.pestelLlm.length > 0) || !!analysis.pestelAnalysis;
  return {
    values,
    tokens,
    asOfIso: asOf.iso,
    asOfLabel: asOf.label,
    priceLabel: priceLabelDe(priceN),
    rankOk: rank.ok,
    sig,
    peerBanner,
    sectorFlag,
    callEstimated: analysis.nextEarningsIsEstimate === true,
    nextCallLine,
    segmentPeriodMissing: !!segment && !segment.fiscalYear,
    earningsState,
    earningsNote,
    catalystGeneric: source !== "llm",
    hasThesis: !!text(analysis.growthThesis),
    thesisText: text(analysis.growthThesis),
    hasPorter,
    hasPestel,
    riskNames,
    protectedNames,
    payloadTitles,
    upsideNames: upsides.map(row => row.name),
    silentTicker,
    reportedQuarterLine,
    proSeed: values.price ? `Der Kurs steht bei ${values.price}.` : null,
    contraSeed: values.entry ? `Der rechnerische Einstieg liegt bei ${values.entry}.` : (spokenRisks.length ? `Die genannten Risiken sind ${spokenRisks.join(", ")}.` : null),
    redactedContext: buildContext(pack, values, payloadTitles, upsides),
    measures: {
      companySource: text(analysis.podcastCompanySource) ?? (namedCompany ? "analysis.companyName" : null),
      asOfIso: asOf.iso,
      price: priceN,
      fair: fairN,
      entry: entryN,
      crv: finite(input.crvBase) ? input.crvBase : null,
      sig,
      fyYoy: fy,
      fiscalYear: year && /^\d{4}$/.test(year) ? Number(year) : null,
      wacc: finite(input.waccPct) ? input.waccPct : null,
      gStar: finite(input.gStarPct) ? input.gStarPct : null,
      segmentName: segment?.name ?? null,
      segmentShare: segment?.share ?? null,
      newsAgeDays: news.length ? news[0]!.ageDays : null,
      ampel: text(input.s17Verdict),
      callDateIso: nextCallIsFuture ? nextDay : null,
      callQuarterRaw: brief && brief.status === "ok" && brief.quarter && brief.year
        ? `Q${brief.quarter} GJ${brief.year}`
        : reportedQuarter,
      upsides,
      catalystNames,
      riskNames,
    },
  };
}

function isNumericTicker(ticker: string): boolean {
  return /^\d{3,}(?:\.[A-Za-z]{1,4})?$/.test(ticker.trim());
}

function sameSymbol(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** Profilname, nie der Börsenkürzel selbst. Analyze setzt companyName sonst auf den Ticker. */
function companyFromAnalysis(analysis: any, ticker: string): string | null {
  const candidates = [
    analysis?.companyName,
    analysis?.name,
    analysis?.shortName,
    analysis?.longName,
    analysis?.profile?.companyName,
    analysis?.profile?.name,
  ];
  for (const raw of candidates) {
    const name = text(raw);
    if (!name || name === ticker || isNumericTicker(name) || (isNumericTicker(ticker) && sameSymbol(name, ticker))) continue;
    return name;
  }
  return null;
}

function catalystUpsides(analysis: any): Array<{ name: string; upside: number }> {
  const rows = Array.isArray(analysis?.catalysts) ? analysis.catalysts : [];
  const out: Array<{ name: string; upside: number }> = [];
  for (const row of rows) {
    const name = text(row?.name);
    const upside = finite(row?.nettoUpside) ? row.nettoUpside : null;
    if (!name || upside == null || upside === 0) continue;
    out.push({ name, upside });
    if (out.length === 3) break;
  }
  return out;
}

const GERMAN_FIELD: Record<string, string> = {
  fazit: "Fazit",
  summary: "Zusammenfassung",
  reasoning: "Begründung",
  description: "Beschreibung",
  impact: "Wirkung",
  note: "Hinweis",
  text: "Text",
  comment: "Kommentar",
  title: "Titel",
  name: "Name",
};

/** Nur Fließtext. camelCase-Feldnamen aus dem Pack kommen nicht in den Prompt. */
function proseLines(value: unknown, depth = 0): string[] {
  if (typeof value === "string") {
    const clean = clip(value, 220);
    return clean ? [clean] : [];
  }
  if (value == null || typeof value === "number" || typeof value === "boolean" || depth > 3) return [];
  if (Array.isArray(value)) return value.flatMap(item => proseLines(item, depth + 1).slice(0, 8)).slice(0, 6);
  if (typeof value !== "object") return [];
  const out: string[] = [];
  for (const [key, inner] of Object.entries(value)) {
    const label = GERMAN_FIELD[key] ?? null;
    for (const line of proseLines(inner, depth + 1).slice(0, 8)) out.push(label ? `${label}: ${line}` : line);
  }
  return out;
}

function regulatoryContext(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const body = value as { exposures?: unknown; gate?: { rationale?: unknown } };
  const lines: string[] = [];
  const exposures = Array.isArray(body.exposures) ? body.exposures : [];
  for (const row of exposures) {
    if (!row || typeof row !== "object") continue;
    const item = row as { title?: unknown; description?: unknown };
    const title = text(item.title);
    const description = text(item.description);
    const bit = [title, description].filter(Boolean).join(": ");
    if (!bit || /https?:\/\//i.test(bit) || /REGULATORY_EXPOSURE|price_regulation/.test(bit) || /…-…m|\d+-\d+m/.test(bit)) continue;
    lines.push(clip(bit, 220));
  }
  const rationale = text(body.gate?.rationale);
  if (rationale && !/REGULATORY_EXPOSURE|price_regulation|https?:\/\//i.test(rationale)) lines.push(clip(rationale, 220));
  return lines;
}

function speakRoundedCrv(n: number): string {
  const spoken = speakPriceUsd(n, 3)?.replace(/ Dollar$/, "");
  return spoken ?? "";
}

function buildContext(
  pack: FullAiPack,
  values: PodcastFactValues,
  titles: string[],
  upsides: Array<{ name: string; upside: number }>,
): string {
  const analysis = pack.analysis ?? {};
  const lines: string[] = [];
  const sector = text(analysis.sector);
  const industry = text(analysis.industry);
  if (values.company) {
    lines.push([
      `Firma: ${values.company}.`,
      sector ? `Sektor: ${sector}.` : "",
      industry ? `Branche: ${industry}.` : "",
      "Rate keine andere Firma und keine andere Branche.",
    ].filter(Boolean).join(" "));
  } else {
    lines.push([
      "Eine Firma ist nicht bekannt.",
      sector ? `Sektor: ${sector}.` : "Ein Sektor ist nicht bekannt.",
      industry ? `Branche: ${industry}.` : "Eine Branche ist nicht bekannt.",
      "Rate keine Firma und keine Branche. Schreibe das Wort Unternehmen nicht.",
    ].join(" "));
  }
  const thesis = text(analysis.growthThesis);
  if (thesis) lines.push(`These: ${clip(thesis, 500)}`);
  const forces = analysis.moatAssessment?.porterForces;
  if (Array.isArray(forces)) {
    for (const force of forces.slice(0, 5)) {
      const summary = text(force?.summary) ?? text(force?.reasoning);
      const forceName = text(force?.force);
      const heading = forceName && !/_/.test(forceName) && !/[a-z][A-Z]/.test(forceName) ? `Porter ${forceName}` : "Porter";
      if (summary) lines.push(`${heading}: ${clip(summary, 220)}`);
    }
  }
  if (Array.isArray(pack.pestelLlm)) {
    for (const dim of pack.pestelLlm) {
      if (dim?.summary) lines.push(`Umfeld ${dim.dimension}: ${clip(dim.summary, 220)}`);
    }
  }
  const policy = pack.policyContext ?? analysis.policyContext;
  if (policy && typeof policy === "object") {
    const policyLabels: Record<string, string> = {
      usa: "Politik USA",
      europa: "Politik Europa",
      asien: "Politik Asien",
      moatImpact: "Wirkung auf den Burggraben",
    };
    for (const key of Object.keys(policyLabels)) {
      const bit = text(policy[key]);
      if (bit) lines.push(`${policyLabels[key]}: ${clip(bit, 220)}`);
    }
  }
  for (const line of proseLines(pack.managementInterpret?.data)) lines.push(`Management: ${line}`);
  for (const line of regulatoryContext(pack.regulatory)) lines.push(`Regulierung: ${line}`);
  if (pack.earningsBrief?.status === "ok" && pack.earningsBrief.excerpt) {
    lines.push(`Earnings-Auszug: ${clip(pack.earningsBrief.excerpt, 700)}`);
  }
  titles.forEach(title => {
    lines.push(`Nur Kontext, nicht vorlesen: ${clip(title, 180)}`);
  });
  const riskLabels: string[] = (Array.isArray(analysis.risks) ? analysis.risks : [])
    .map((risk: any) => text(risk?.name))
    .filter((name: string | null): name is string => !!name)
    .slice(0, 3);
  riskLabels.forEach((name: string, index: number) => {
    lines.push(`Risiko ${index + 1}, Name nur als Kontext, Label-Schlüssel „Risiko ${index + 1}“: ${clip(name, 120)}`);
  });
  upsides.forEach((row, index) => {
    lines.push(`Katalysator ${index + 1}, Wert nur als {netto_upside_${index + 1}}, Name nur als Kontext, Label-Schlüssel „Katalysator ${index + 1}“: ${clip(row.name, 120)}`);
  });
  const segmentName = topSegment(analysis)?.name;
  if (segmentName) {
    lines.push(`Segment 1, Anteil nur als {top_segment_share}, Name nur als Kontext, Label-Schlüssel „Segment 1“: ${clip(segmentName, 120)}`);
  }
  const available = (Object.keys(values) as PodcastPlaceholder[]).filter(k => values[k] != null && !placeholderForbiddenInModel(k));
  lines.push(`Platzhalter mit Wert: ${available.map(name => `{${name}}`).join(", ") || "keine"}`);
  return lines.join("\n");
}
