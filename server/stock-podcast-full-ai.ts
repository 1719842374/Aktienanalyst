/**
 * Voll-KI-Pack nur für den Aktien-Podcast.
 * Der Lauf ruft den bestehenden Analyze-Pfad isoliert auf (frische FMP-Zahlen,
 * useLLM) und danach die Generatoren, die /api/analyze heute nicht einschaltet.
 * Der 20-Minuten-Cache der sichtbaren Analyse wird nicht gelesen und nicht geschrieben.
 * Der Pack liegt 1× je Ticker und Kalendertag Europe/Madrid. regenerate erzwingt neu.
 */
import type { EarningsCallBrief } from "../shared/chat-earnings";
import { PODCAST_STAGE_TIMEOUT_MS } from "../shared/podcast-types";
import type { StockPodcastErrorCode } from "../shared/podcast-types";
import { runAnalyzeIsolated } from "./analyze-route";
import { buildEarningsBrief, type EarningsBriefDeps } from "./chat-earnings-route";
import { fmpEarningCallTranscript, fmpEarningCallTranscriptDates, fmpProfile } from "./fmp";
import {
  buildManagementInterpretPrompt,
  buildManagementInterpretSystemPrompt,
} from "./management-score-interpret";
import { computeManagementScoreForTicker, type ManagementScoreRequestInput } from "./management-score";
import {
  callLLMJson,
  generatePESTELAnalysis as generateLLMPESTEL,
  isLLMAvailable,
  type PESTELDimensionResult,
  type PESTELInput,
} from "./llm-openrouter";
import { assessRegulatoryExposure } from "./regulatory";
import { computeThesisStrength, type CompanyVector, type ThesisStrengthInput } from "./thesis-strength";
import { madridDayKey, withStageTimeout } from "./stock-podcast-limit";

export interface PodcastPackSections {
  analyze: boolean;
  pestelLlm: boolean;
  policyContext: boolean;
  management: boolean;
  managementInterpret: boolean;
  earningsBrief: boolean;
  regulatory: boolean;
  thesisStrength: boolean;
}

export interface FullAiPack {
  ticker: string;
  day: string;
  generatedAt: string;
  analysis: any;
  pestelLlm: PESTELDimensionResult[] | null;
  management: any | null;
  managementInterpret: any | null;
  earningsBrief: EarningsCallBrief | null;
  regulatory: any | null;
  thesisStrength: any | null;
  policyContext: any | null;
  timedOut: Array<"analyze" | "supplement">;
  sections: PodcastPackSections;
}

export interface FullAiDeps {
  now: () => Date;
  llmAvailable: () => boolean;
  analyze: (ticker: string) => Promise<{ status: number; body: any }>;
  pestel: (input: PESTELInput) => Promise<PESTELDimensionResult[] | null>;
  management: (input: ManagementScoreRequestInput) => Promise<any>;
  interpret: (body: { ticker: string; companyName: string; breakdown: any; thesisStrengthScore?: unknown }) => Promise<any>;
  earnings: (symbol: string) => Promise<EarningsCallBrief>;
  regulatory: (input: Parameters<typeof assessRegulatoryExposure>[0]) => Promise<any>;
  thesis: (input: ThesisStrengthInput) => any;
  profile?: (symbol: string) => Promise<any>;
}

export type PodcastCompanySource = "analysis" | "fmp-profile" | "missing";

function cleanCompanyName(value: unknown, ticker: string): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name) return null;
  if (name.toUpperCase() === ticker.toUpperCase()) return null;
  if (/^\d{3,}(?:\.[A-Za-z]{1,4})?$/.test(name)) return null;
  return name;
}

/** Firma für den Podcast. Analyze bleibt unverändert. Fehlt der Name, liest der vorhandene FMP-Profile-Client nach. */
export async function resolvePodcastCompanyName(
  analysis: any,
  ticker: string,
  profile: (symbol: string) => Promise<any> = fmpProfile,
): Promise<{ name: string | null; source: PodcastCompanySource }> {
  const upper = ticker.toUpperCase();
  const fromAnalysis = cleanCompanyName(analysis?.companyName, upper)
    ?? cleanCompanyName(analysis?.name, upper)
    ?? cleanCompanyName(analysis?.profile?.companyName, upper)
    ?? cleanCompanyName(analysis?.profile?.name, upper);
  if (fromAnalysis) return { name: fromAnalysis, source: "analysis" };
  try {
    const row = await profile(upper);
    const fromProfile = cleanCompanyName(row?.companyName, upper) ?? cleanCompanyName(row?.name, upper);
    if (fromProfile) return { name: fromProfile, source: "fmp-profile" };
  } catch {
    return { name: null, source: "missing" };
  }
  return { name: null, source: "missing" };
}

export interface FullAiFailure {
  ok: false;
  errorCode: StockPodcastErrorCode;
  error: string;
  stage: "analyze";
}

export interface FullAiSuccess {
  ok: true;
  pack: FullAiPack;
  packCached: boolean;
}

const packCache = new Map<string, FullAiPack>();
const PACK_CACHE_MAX = 40;

export function resetPodcastPackCache(): void {
  packCache.clear();
}

export function peekPodcastPack(ticker: string, now: Date): FullAiPack | null {
  const key = ticker.toUpperCase();
  const hit = packCache.get(key);
  if (!hit) return null;
  if (hit.day !== madridDayKey(now)) return null;
  return hit;
}

function rememberPack(pack: FullAiPack): void {
  packCache.set(pack.ticker, pack);
  if (packCache.size <= PACK_CACHE_MAX) return;
  const oldest = Array.from(packCache.values()).sort((a, b) => a.generatedAt.localeCompare(b.generatedAt))[0];
  if (oldest && oldest.ticker !== pack.ticker) packCache.delete(oldest.ticker);
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function pestelInput(ticker: string, analysis: any): PESTELInput {
  const catalysts = Array.isArray(analysis?.catalysts) ? analysis.catalysts : [];
  const news = Array.isArray(analysis?.newsItems) ? analysis.newsItems : [];
  const income = analysis?.financialStatements?.incomeStatement ?? {};
  return {
    ticker,
    companyName: str(analysis?.companyName, ticker),
    sector: str(analysis?.sector),
    industry: str(analysis?.industry),
    description: str(analysis?.description),
    revenue: num(income.revenue) ?? 0,
    revenueGrowth: num(income.revenueGrowth) ?? 0,
    fcfMargin: num(analysis?.fcfMargin) ?? 0,
    governmentExposure: num(analysis?.governmentExposure) ?? 0,
    beta: num(analysis?.beta5Y) ?? num(analysis?.beta) ?? 1,
    topCatalysts: catalysts.slice(0, 3).map((c: any) => ({
      name: str(c?.name),
      context: str(c?.context),
    })),
    recentNewsHeadlines: news.slice(0, 5).map((n: any) => str(n?.title)).filter(Boolean),
    keyProjects: Array.isArray(analysis?.keyProjects) ? analysis.keyProjects.map((p: any) => str(p)).filter(Boolean).slice(0, 5) : [],
  };
}

function managementInput(ticker: string, analysis: any): ManagementScoreRequestInput {
  const segments = Array.isArray(analysis?.revenueSegments) ? analysis.revenueSegments : [];
  const income = analysis?.financialStatements?.incomeStatement ?? {};
  const news = Array.isArray(analysis?.newsItems) ? analysis.newsItems : [];
  return {
    ticker,
    companyName: str(analysis?.companyName, ticker),
    sector: str(analysis?.sector),
    industry: str(analysis?.industry),
    description: str(analysis?.description),
    segments: segments.slice(0, 12).map((s: any) => ({
      name: str(s?.name, "Segment"),
      revenue: num(s?.revenue) ?? 0,
      percentage: num(s?.percentage) ?? 0,
      growth: num(s?.growth),
      fiscalYear: typeof s?.fiscalYear === "string" ? s.fiscalYear : undefined,
    })),
    totalRevenue: num(income.revenue) ?? 0,
    newsHeadlines: news.slice(0, 8).map((n: any) => str(n?.title)).filter(Boolean),
  };
}

function regulatoryInput(ticker: string, analysis: any): Parameters<typeof assessRegulatoryExposure>[0] {
  const income = analysis?.financialStatements?.incomeStatement ?? {};
  const geos = Array.isArray(analysis?.geoSegments) ? analysis.geoSegments : [];
  return {
    ticker,
    companyName: str(analysis?.companyName, ticker),
    sector: str(analysis?.sector),
    industry: str(analysis?.industry),
    description: str(analysis?.description),
    topCountries: geos.slice(0, 8).map((g: any) => ({
      countryOrRegion: str(g?.countryOrRegion ?? g?.name ?? g?.region, "unbekannt"),
      percentage: num(g?.percentage ?? g?.revenuePercentage) ?? 0,
    })),
    totalRevenue: num(income.revenue) ?? 0,
    operatingMargin: num(income.operatingMargin) ?? 0,
    sharesOutstanding: num(analysis?.sharesOutstanding) ?? 0,
    force: false,
  };
}

function thesisInput(analysis: any): ThesisStrengthInput {
  const income = analysis?.financialStatements?.incomeStatement ?? {};
  const growth = num(income.revenueGrowth);
  const gStar = num(analysis?.impliedGStar);
  const vector: CompanyVector = {
    revenueCagr3to5y: null,
    earningsVolatility: null,
    fcfMarginTrend: null,
    leverageTrend: null,
    marginInflectionStrength: null,
    growthGap: gStar != null && growth != null ? gStar - growth : null,
    missingFeatures: ["Podcast-Pack ohne Peer-Zeitreihe"],
  };
  return {
    vector,
    fcf: num(analysis?.fcfTTM),
    gStar,
    thesisGrowth: null,
    catalysts: Array.isArray(analysis?.catalysts) ? analysis.catalysts : [],
    thesisText: typeof analysis?.growthThesis === "string" ? analysis.growthThesis : null,
    revenueYoyPct: growth,
    sector: str(analysis?.sector) || null,
    industry: str(analysis?.industry) || null,
    balance: { inventoryZ: 0, growthZ: 0, marginZ: 0, marginPositivePeriods: 0 },
    turnaround: {},
  };
}

async function defaultEarnings(symbol: string): Promise<EarningsCallBrief> {
  const deps: EarningsBriefDeps = {
    dates: fmpEarningCallTranscriptDates,
    transcript: fmpEarningCallTranscript,
    llmAvailable: isLLMAvailable,
    llm: callLLMJson,
  };
  return buildEarningsBrief(symbol, deps);
}

function defaultDeps(): FullAiDeps {
  return {
    now: () => new Date(),
    llmAvailable: isLLMAvailable,
    analyze: runAnalyzeIsolated,
    pestel: generateLLMPESTEL,
    management: computeManagementScoreForTicker,
    interpret: async body => callLLMJson({
      systemPrompt: buildManagementInterpretSystemPrompt(),
      prompt: buildManagementInterpretPrompt(body),
      maxTokens: 1600,
      temperature: 0.3,
    }),
    earnings: defaultEarnings,
    regulatory: assessRegulatoryExposure,
    thesis: computeThesisStrength,
    profile: fmpProfile,
  };
}

function sectionsOf(pack: Omit<FullAiPack, "sections">): PodcastPackSections {
  return {
    analyze: pack.analysis != null && typeof pack.analysis === "object",
    pestelLlm: Array.isArray(pack.pestelLlm) && pack.pestelLlm.length > 0,
    policyContext: pack.policyContext != null,
    management: pack.management != null,
    managementInterpret: pack.managementInterpret != null,
    earningsBrief: pack.earningsBrief != null,
    regulatory: pack.regulatory != null,
    thesisStrength: pack.thesisStrength != null,
  };
}

function failure(errorCode: StockPodcastErrorCode, error: string): FullAiFailure {
  return { ok: false, errorCode, error, stage: "analyze" };
}

export async function runFullAiAnalysis(
  ticker: string,
  opts?: { regenerate?: boolean; now?: Date; deps?: Partial<FullAiDeps> },
): Promise<FullAiSuccess | FullAiFailure> {
  const deps: FullAiDeps = { ...defaultDeps(), ...opts?.deps };
  const now = opts?.now ?? deps.now();
  const upper = ticker.toUpperCase();
  if (!deps.llmAvailable()) {
    return failure(
      "NO_API_KEY",
      "KI nicht verfügbar: Auf diesem Server ist kein OpenRouter-Key konfiguriert. Es wird keine Antwort erzeugt.",
    );
  }
  if (!opts?.regenerate) {
    const cached = peekPodcastPack(upper, now);
    if (cached) return { ok: true, pack: cached, packCached: true };
  } else {
    packCache.delete(upper);
  }

  const analyzed = await withStageTimeout(deps.analyze(upper), PODCAST_STAGE_TIMEOUT_MS.analyze);
  if (analyzed === "timeout") {
    return failure("LLM_UNAVAILABLE", "KI-Podcast n/a — LLM nicht erreichbar.");
  }
  const status = analyzed.status;
  const body = analyzed.body;
  if (status === 429 || body?.errorCode === "RATE_LIMITED") {
    return failure("RATE_LIMITED", "Tageslimit erreicht.");
  }
  if (status !== 200 || !body || typeof body !== "object" || body.error) {
    return failure("LLM_UNAVAILABLE", "KI-Podcast n/a — LLM nicht erreichbar.");
  }

  const supplementWork = (async () => {
    const [pestel, management, earnings, regulatory] = await Promise.all([
      deps.pestel(pestelInput(upper, body)).catch(() => null),
      deps.management(managementInput(upper, body)).catch(() => null),
      deps.earnings(upper).catch(() => null),
      deps.regulatory(regulatoryInput(upper, body)).catch(() => null),
    ]);
    let thesis: any = null;
    try { thesis = deps.thesis(thesisInput(body)); } catch { thesis = null; }
    let interpret: any = null;
    if (management?.breakdown) {
      try {
        interpret = await deps.interpret({
          ticker: upper,
          companyName: str(body.companyName, upper),
          breakdown: management.breakdown,
          thesisStrengthScore: thesis?.score ?? undefined,
        });
      } catch { interpret = null; }
    }
    return { pestel, management, earnings, regulatory, thesis, interpret };
  })();

  const supplemented = await withStageTimeout(supplementWork, PODCAST_STAGE_TIMEOUT_MS.supplement);
  const timedOut: FullAiPack["timedOut"] = [];
  const extra = supplemented === "timeout"
    ? (timedOut.push("supplement"), { pestel: null, management: null, earnings: null, regulatory: null, thesis: null, interpret: null })
    : supplemented;

  const company = await resolvePodcastCompanyName(body, upper, deps.profile ?? fmpProfile);
  const analysis = {
    ...body,
    companyName: company.name ?? "",
    podcastCompanySource: company.source,
  };
  const draft = {
    ticker: upper,
    day: madridDayKey(now),
    generatedAt: now.toISOString(),
    analysis,
    pestelLlm: extra.pestel,
    management: extra.management,
    managementInterpret: extra.interpret,
    earningsBrief: extra.earnings,
    regulatory: extra.regulatory,
    thesisStrength: extra.thesis,
    policyContext: body.policyContext ?? null,
    timedOut,
  };
  const pack: FullAiPack = { ...draft, sections: sectionsOf(draft) };
  rememberPack(pack);
  return { ok: true, pack, packCached: false };
}
