/**
 * Fakten für den Aktien-Podcast. Nur kopieren, nichts schätzen.
 * Quartals-YoY und Umsatz über vier Quartale bleiben leer.
 * Fremdwährung wird vor der Sprechform in USD gerechnet, wenn ein Kurs vorliegt.
 */
import { createHash } from "node:crypto";
import { currencyWord } from "../server/exec-summary";
import { buildExecSummaryInputFromAnalysis } from "../server/exec-summary-attach";
import type { FullAiPack } from "../server/stock-podcast-full-ai";
import { keepCompleteSentences, priceLabelDe, rankAfterRounding, speakIsoDate, speakPercent, speakPriceUsd, speakQuarterPhrase, speakYear } from "./podcast-speak";

export const PODCAST_PLACEHOLDERS = [
  "ticker", "company", "as_of", "currency_word", "statement_currency_word",
  "price", "score", "ampel", "wacc", "g_star", "dcf_fair", "dcf_low", "dcf_high",
  "entry", "crv", "quarter_yoy", "quarter_period_end", "ttm_revenue", "ttm_period_end",
  "top_segment", "top_segment_share", "call_date", "call_quarter", "catalyst_mode",
  "news_1", "news_2", "news_3", "news_age", "fy_yoy", "gj_year",
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
};

const MODEL_FORBIDDEN = new Set<PodcastPlaceholder>([
  "price", "dcf_fair", "dcf_low", "dcf_high", "entry", "ttm_revenue",
  "as_of", "call_date", "quarter_period_end", "ttm_period_end",
  "call_quarter", "catalyst_mode", "currency_word", "statement_currency_word",
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
  hasPorter: boolean;
  hasPestel: boolean;
  riskNames: string[];
  proSeed: string | null;
  contraSeed: string | null;
  redactedContext: string;
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

function recentNews(analysis: any, asOfIso: string): Array<{ title: string; ageDays: number }> {
  const items = Array.isArray(analysis?.newsItems) ? analysis.newsItems : [];
  const asOf = new Date(`${asOfIso}T12:00:00Z`).getTime();
  const out: Array<{ title: string; ageDays: number }> = [];
  for (const item of items) {
    const title = text(item?.title);
    const pub = text(item?.pubDate);
    if (!title || !pub) continue;
    const ts = new Date(pub).getTime();
    if (!Number.isFinite(ts)) continue;
    const ageDays = Math.floor((asOf - ts) / 86_400_000);
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
  return textIn.replace(/\d+(?:[.,]\d+)?/g, "…").replace(/\s+/g, " ").trim();
}

function clip(textIn: string, max: number): string {
  const clean = redact(textIn);
  if (clean.length <= max) return clean;
  return keepCompleteSentences(clean.slice(0, max));
}

function spokenCatalystMode(analysis: any): string {
  const llm = analysis?.catalystsSource === "llm" || analysis?.llmMode === true;
  if (!llm) return "Katalysatoren: generisch (Sektor)";
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
  const news = recentNews(analysis, asOf.iso);
  const callIso = text(analysis.nextEarningsDate);
  const nextDay = callIso ? callIso.slice(0, 10) : null;
  const todayKey = isoDay(now.toISOString(), now).iso;
  const nextCallIsFuture = nextDay != null && nextDay > todayKey;
  const nextCallSpoken = nextDay ? speakIsoDate(nextDay, "dat") : null;
  const reportedQuarter = text(analysis.lastReportedQuarter);
  const brief = pack.earningsBrief;
  let earningsState: PodcastFacts["earningsState"] = "missing";
  let earningsNote: string | null = "Ein Earnings-Call-Transkript liegt nicht vor.";
  let callQuarter: string | null = speakQuarterPhrase(reportedQuarter ?? "") ;
  if (brief && brief.status === "ok" && brief.quarter && brief.year) {
    callQuarter = speakQuarterPhrase(`Q${brief.quarter} GJ${brief.year}`);
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
  const nextCallLine = nextCallIsFuture && nextCallSpoken
    ? `Der nächste Earnings Call ist für den ${nextCallSpoken} angekündigt.`
    : null;
  const source = analysis.catalystsSource === "llm" || analysis.llmMode === true ? "llm" : "generic";
  const mode = spokenCatalystMode(analysis);
  const risks = Array.isArray(analysis.risks) ? analysis.risks : [];
  const riskNames = risks.map((r: any) => text(r?.name)).filter((n: string | null): n is string => !!n).slice(0, 3);
  const catalysts = Array.isArray(analysis.catalysts) ? analysis.catalysts : [];
  const tokens = [
    text(analysis.ticker) ?? pack.ticker,
    text(analysis.companyName),
    ...catalysts.map((c: any) => text(c?.name)),
    segment?.name ?? null,
    ...(Array.isArray(analysis.keyProjects) ? analysis.keyProjects.map((p: any) => text(p)) : []),
    ...riskNames,
  ].filter((t): t is string => !!t);
  const moneyWord = reported === "USD" || fx != null ? "Dollar" : currencyWord(reported);
  const values: PodcastFactValues = {
    ticker: pack.ticker,
    company: text(analysis.companyName) ?? pack.ticker,
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
    news_1: news[0]?.title ?? null,
    news_2: news[1]?.title ?? null,
    news_3: news[2]?.title ?? null,
    news_age: news.length ? `${speakAge(news[news.length - 1]!.ageDays)}` : null,
    fy_yoy: fy == null ? null : speakPercent(fy),
    gj_year: gj,
  };
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
    hasPorter,
    hasPestel,
    riskNames,
    proSeed: values.price ? `Der Kurs steht bei ${values.price}.` : null,
    contraSeed: values.entry ? `Der rechnerische Einstieg liegt bei ${values.entry}.` : (riskNames.length ? `Die genannten Risiken sind ${riskNames.join(", ")}.` : null),
    redactedContext: buildContext(pack, values),
  };
}

function speakRoundedCrv(n: number): string {
  const spoken = speakPriceUsd(n, 3)?.replace(/ Dollar$/, "");
  return spoken ?? "";
}

function speakAge(days: number): string {
  if (days <= 0) return "weniger als einem Tag";
  if (days === 1) return "einen Tag";
  const word = speakPriceUsd(days, 3)?.replace(/ Dollar$/, "") ?? String(days);
  return `${word} Tage`;
}

function buildContext(pack: FullAiPack, values: PodcastFactValues): string {
  const analysis = pack.analysis ?? {};
  const lines: string[] = [];
  const thesis = text(analysis.growthThesis);
  if (thesis) lines.push(`These: ${clip(thesis, 500)}`);
  const forces = analysis.moatAssessment?.porterForces;
  if (Array.isArray(forces)) {
    for (const force of forces.slice(0, 5)) {
      const summary = text(force?.summary) ?? text(force?.reasoning);
      if (summary) lines.push(`Porter ${text(force?.force) ?? ""}: ${clip(summary, 220)}`);
    }
  }
  if (Array.isArray(pack.pestelLlm)) {
    for (const dim of pack.pestelLlm) {
      if (dim?.summary) lines.push(`PESTEL ${dim.dimension}: ${clip(dim.summary, 220)}`);
    }
  }
  const policy = pack.policyContext ?? analysis.policyContext;
  if (policy && typeof policy === "object") {
    for (const key of ["usa", "europa", "asien", "moatImpact"] as const) {
      const bit = text(policy[key]);
      if (bit) lines.push(`Politik ${key}: ${clip(bit, 220)}`);
    }
  }
  if (pack.managementInterpret?.data) {
    lines.push(`Management: ${clip(JSON.stringify(pack.managementInterpret.data), 400)}`);
  }
  if (pack.regulatory) lines.push(`Regulatory: ${clip(JSON.stringify(pack.regulatory), 400)}`);
  if (pack.earningsBrief?.status === "ok" && pack.earningsBrief.excerpt) {
    lines.push(`Earnings-Auszug: ${clip(pack.earningsBrief.excerpt, 700)}`);
  }
  const available = (Object.keys(values) as PodcastPlaceholder[]).filter(k => values[k] != null);
  lines.push(`Platzhalter mit Wert: ${available.map(name => `{${name}}`).join(", ") || "keine"}`);
  return lines.join("\n");
}
