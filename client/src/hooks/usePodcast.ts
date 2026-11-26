/**
 * KI-Podcast je Aktie (Design-Spec v4 + Offen_KI_PODCAST_ENTWURF.md C6).
 *
 * Die Typen unten sind die lokale Abbildung des Response-Vertrags, den PR A
 * in shared/ anlegt (Skript-Route und Audio-Route). Sie werden hier nicht
 * nach shared/ kopiert. Nach dem Merge von PR A auf den shared-Export
 * umstellen. PR B wird erst nach PR A gemergt.
 *
 * Lokale Spiegelung von shared/podcast-types.ts aus dem offenen Backend-PR, solange der Branch nicht auf main liegt.
 * Nicht aus shared/ importieren, solange #529 nicht auf main liegt.
 * Nach dem Merge von #529 per Merge-Commit auf die shared-Exports umstellen.
 *
 * POST /api/podcast/script, Zod strict auf #529:
 *   { ticker, source, regenerate?, fullAi?, voice?, language?: "de"|"en" (Default de) }
 *   language kommt additiv in der Antwort zurück. Audio-Query hängt language an,
 *   wie stockPodcastAudioPath. Fehlt sie, setzt der Server de.
 *   Normaler Klick: regenerate false (Cache/Pack am selben Tag, zählt nicht gegen PODCAST_DAILY_MAX).
 *   „Neu erzeugen“: regenerate true. Das Zod-Schema ist strict und kennt kein weiteres Flag.
 *   Stimme "browser" geht nicht an den Server (speechSynthesis, kein Audio-GET).
 * 200 StockPodcastScriptResponse: ok, ticker, source, asOf, asOfLabel, priceLabel,
 *   cacheKey, voice, voiceLabel, chapters[{id,title,label,template,spoken,durationSec,llmOwned,audioUrl}],
 *   cached, packCached, promptVersion, disclaimer.
 * Fehler StockPodcastErrorResponse: ok false, errorCode, error, stage.
 * GET /api/podcast/audio/:chapterId?ticker&source&voice&cacheKey&language — sonst 400.
 * Dieselbe Query wie stockPodcastAudioPath, language inklusive.
 *
 * Kein zweiter Analyze-Lauf. Die sichtbare Dashboard-UI bleibt unverändert.
 * Erzeugung nur aus dem Click-Handler, nie beim Mount.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { apiRequest } from "@/lib/queryClient";
import { OPENROUTER_NO_KEY_MESSAGE } from "@shared/openrouter-no-key";

export const PODCAST_SCRIPT_PATH = "/api/podcast/script";

/** Ein POST deckt Analyse und Transkript. 90 s sind laut Spec zu knapp. */
export const PODCAST_SCRIPT_TIMEOUT_MS = 180_000;
/** Audio je Kapitel, getrennt vom Skript-Timeout. */
export const PODCAST_AUDIO_TIMEOUT_MS = 60_000;
/**
 * Solange der eine Skript-POST offen ist, bleibt die Stufe „analyze“.
 * Dauert er länger, wechselt die Anzeige auf „script“ — die Grenze ist die
 * offene Timeout-Frage der Spec, kein zweiter HTTP-Call.
 */
export const PODCAST_ANALYZE_STAGE_MS = 45_000;

export const PODCAST_KI_HINT =
  "Play erzeugt eine frische KI-Analyse aller Sektionen (aktuellen Zahlen), danach Transkript und Audio über OpenRouter. Die Dashboard-Ansicht bleibt unverändert.";

export const PODCAST_NO_KEY_DETAIL =
  "Podcast-Transkript braucht OPENROUTER_API_KEY. Der PDF-Export bleibt unverändert.";

export const PODCAST_LLM_UNAVAILABLE = "KI-Podcast n/a — LLM nicht erreichbar.";

export const PODCAST_LOADING_COPY = {
  analyze: { label: "Analyse läuft …", detail: "Frische Zahlen + KI aller Sektionen" },
  script: { label: "Transkript entsteht …", detail: "OpenRouter interpretiert die Analyse" },
  audio: { label: "Audio wird erzeugt …", detail: "OpenRouter TTS, Fallback xAI" },
} as const;

export type PodcastSource = "pdf" | "ki";
export type PodcastLoadingStage = keyof typeof PODCAST_LOADING_COPY;
export type PodcastPlayerState = "idle" | "loading" | "playing" | "paused" | "error" | "limit";
export type PodcastSpeed = 0.75 | 1 | 1.25 | 1.5 | 2;

export const PODCAST_SPEEDS: readonly PodcastSpeed[] = [0.75, 1, 1.25, 1.5, 2];

export interface PodcastVoiceOption {
  id: string;
  slug: string;
  name: string;
  group: "openrouter" | "xai" | "browser";
}

/** Reihenfolge der Spec: OpenRouter de-DE, dann xAI-Fallback, zuletzt Browser. */
export const PODCAST_VOICES: readonly PodcastVoiceOption[] = [
  { id: "de-DE-Mia:MAI-Voice-2.1", slug: "mia", name: "Mia", group: "openrouter" },
  { id: "de-DE-Klaus:MAI-Voice-2.1", slug: "klaus", name: "Klaus", group: "openrouter" },
  { id: "de-DE-Harper:MAI-Voice-2.1", slug: "harper", name: "Harper", group: "openrouter" },
  { id: "de-DE-Grant:MAI-Voice-2.1", slug: "grant", name: "Grant", group: "openrouter" },
  { id: "eve", slug: "eve", name: "Eve", group: "xai" },
  { id: "leo", slug: "leo", name: "Leo", group: "xai" },
  { id: "ara", slug: "ara", name: "Ara", group: "xai" },
  { id: "browser", slug: "browser", name: "Browser", group: "browser" },
];

export const PODCAST_DEFAULT_VOICE = PODCAST_VOICES[0]!.id;
export const PODCAST_BROWSER_VOICE = "browser";
export const PODCAST_LANGUAGE_STORAGE_KEY = "aktienanalyst.podcast.language";
export const PODCAST_EN_DEFAULT_VOICE = "en-US-Harper:MAI-Voice-2.1";

export type PodcastLanguage = "de" | "en";

const SHARED_VOICES: readonly PodcastVoiceOption[] = PODCAST_VOICES.filter((voice) => voice.group !== "openrouter");

/** Englische OpenRouter-Stimmen derselben Mai-Voice-2.1, plus xAI und Browser. */
export const PODCAST_VOICES_EN: readonly PodcastVoiceOption[] = [
  { id: PODCAST_EN_DEFAULT_VOICE, slug: "harper-en", name: "Harper", group: "openrouter" },
  { id: "en-US-Grant:MAI-Voice-2.1", slug: "grant-en", name: "Grant", group: "openrouter" },
  ...SHARED_VOICES,
];

export function voicesForLanguage(language: PodcastLanguage): readonly PodcastVoiceOption[] {
  switch (language) {
    case "de":
      return PODCAST_VOICES;
    case "en":
      return PODCAST_VOICES_EN;
    default: {
      const unreachable: never = language;
      return unreachable;
    }
  }
}

export function defaultVoiceForLanguage(language: PodcastLanguage): string {
  switch (language) {
    case "de":
      return PODCAST_DEFAULT_VOICE;
    case "en":
      return PODCAST_EN_DEFAULT_VOICE;
    default: {
      const unreachable: never = language;
      return unreachable;
    }
  }
}

export function voiceFitsLanguage(language: PodcastLanguage, voiceId: string): boolean {
  return voicesForLanguage(language).some((voice) => voice.id === voiceId);
}

const PODCAST_XAI_VOICES = new Set(["eve", "leo", "ara"]);

/** Harper und Grant wechseln die Locale. xAI und Browser bleiben. Alles andere wird die Default-Stimme. */
export function mapVoiceAcrossLanguage(voiceId: string, target: PodcastLanguage): string {
  if (voiceId === PODCAST_BROWSER_VOICE || PODCAST_XAI_VOICES.has(voiceId)) return voiceId;
  if (/harper/i.test(voiceId)) {
    return target === "en" ? "en-US-Harper:MAI-Voice-2.1" : "de-DE-Harper:MAI-Voice-2.1";
  }
  if (/grant/i.test(voiceId)) {
    return target === "en" ? "en-US-Grant:MAI-Voice-2.1" : "de-DE-Grant:MAI-Voice-2.1";
  }
  return defaultVoiceForLanguage(target);
}

/** Stand, Cache-Key und Stufe nach einem Aktienwechsel ohne Cache. Dieselben Werte wie resetForTicker. */
export function tickerIdleResetFields(fallback: { asOf: string; price: string }): {
  standAsOf: string;
  standPrice: string;
  cacheKey: string;
  stage: "analyze";
  activeChapterId: null;
} {
  return {
    standAsOf: fallback.asOf,
    standPrice: fallback.price,
    cacheKey: "",
    stage: "analyze",
    activeChapterId: null,
  };
}

export function readPodcastLanguage(storage: { getItem(key: string): string | null } | null): PodcastLanguage {
  const raw = storage?.getItem(PODCAST_LANGUAGE_STORAGE_KEY);
  return raw === "en" ? "en" : "de";
}

export function writePodcastLanguage(storage: { setItem(key: string, value: string): void } | null, language: PodcastLanguage): void {
  storage?.setItem(PODCAST_LANGUAGE_STORAGE_KEY, language);
}

/** Wechsel ohne Cache zeigt Idle und startet keinen Lauf. Mit Cache wird sofort abgespielt. */
export function decideLanguageSwitch(hasCache: boolean): "play" | "idle" {
  return hasCache ? "play" : "idle";
}

/** Tageslimit sperrt die markierte Sprache, solange für sie kein Cache da ist. */
export function languageSegmentDisabled(opts: { limited: boolean; hasCache: boolean; loading: boolean }): boolean {
  if (opts.loading) return true;
  return opts.limited && !opts.hasCache;
}

/**
 * Der Server zählt heute je Ticker über beide Sprachen.
 * `ticker-language` ist der Spec-Text, solange Philip die Zählweise nicht festlegt.
 */
export type PodcastLimitScope = "ticker" | "ticker-language";
export const PODCAST_LIMIT_SCOPE: PodcastLimitScope = "ticker";

export function languagesMarkedByLimit(scope: PodcastLimitScope, language: PodcastLanguage): PodcastLanguage[] {
  return scope === "ticker" ? ["de", "en"] : [language];
}

export function podcastScriptCacheKey(
  ticker: string,
  source: PodcastSource,
  language: PodcastLanguage,
  voice: string,
): string {
  return `${ticker}|${source}|${language}|${voice}`;
}

export function podcastLimitKey(ticker: string, language: PodcastLanguage): string {
  return `${ticker}|${language}`;
}

export interface PodcastLanguageCache {
  chapters: PodcastChapterView[];
  cacheKey: string;
  asOf: string;
  priceLabel: string;
  limited: boolean;
}

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Server-Stimmen gehen an Skript und Audio. Der Browser-Notnagel bleibt lokal. */
export function isServerVoice(voice: string): boolean {
  return voice.trim().length > 0 && voice !== PODCAST_BROWSER_VOICE;
}

export const PODCAST_VOICE_GROUPS: { id: PodcastVoiceOption["group"]; label: string }[] = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "xai", label: "Fallback xAI" },
  { id: "browser", label: "Browser" },
];

export type PodcastErrorCode = "NO_API_KEY" | "LLM_UNAVAILABLE" | "RATE_LIMITED" | "KI_MODE_OFF" | "BAD_REQUEST";

/** Spiegel von StockPodcastScriptResponse. `src` am Kapitel ist nur die abspielbare Blob-URL. */
export interface PodcastScriptRequest {
  ticker: string;
  source: PodcastSource;
  regenerate: boolean;
  fullAi: true;
  language: PodcastLanguage;
  voice?: string;
}

/** Kapitel, wie der Player sie spricht. `src` ist die aufgelöste Audio-URL, kein Serverfeld. */
export interface PodcastChapterView {
  id: string;
  label: string;
  spoken: string;
  durationSec: number;
  audioUrl: string | null;
  llmOwned?: boolean;
  src: string | null;
}

export interface ParsedPodcastScript {
  chapters: PodcastChapterView[];
  asOf: string;
  cacheKey: string;
  source: PodcastSource | null;
  voice: string | null;
  priceLabel: string | null;
  voiceLabel: string | null;
  language: PodcastLanguage | null;
  cached: boolean;
  packCached: boolean;
}

export type PodcastFailure =
  | { kind: "limit" }
  | { kind: "no_key" }
  | { kind: "llm" }
  | { kind: "message"; text: string };

export function podcastSourceLabel(source: PodcastSource): string {
  switch (source) {
    case "pdf":
      return "PDF-basiert";
    case "ki":
      return "KI-Analyse";
    default: {
      const unreachable: never = source;
      return unreachable;
    }
  }
}

export function voiceById(id: string): PodcastVoiceOption | undefined {
  return PODCAST_VOICES.find((voice) => voice.id === id) ?? PODCAST_VOICES_EN.find((voice) => voice.id === id);
}

export function voiceNameFor(id: string): string {
  return voiceById(id)?.name ?? id;
}

export function formatSpeedLabel(rate: PodcastSpeed): string {
  return `${String(rate).replace(".", ",")}×`;
}

export function nextSpeed(rate: PodcastSpeed): PodcastSpeed {
  const index = PODCAST_SPEEDS.indexOf(rate);
  const next = PODCAST_SPEEDS[(index + 1) % PODCAST_SPEEDS.length];
  return next ?? 1;
}

export function formatClock(sec: number): string {
  const safe = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatPodcastAsOf(asOf: string, fallback = ""): string {
  const raw = asOf.trim();
  if (!raw) return fallback;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) return raw;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return `${dateOnly[3]}.${dateOnly[2]}.${dateOnly[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

export function formatPodcastPrice(price: number): string {
  return price.toLocaleString("de-DE", { maximumFractionDigits: 2 });
}

export function formatStandLine(
  asOf: string,
  price: string,
  source: PodcastSource,
  voiceName: string,
  language: PodcastLanguage = "de",
): string {
  if (language === "en") {
    return `As of ${asOf}, price ${price} · ${podcastSourceLabel(source)} · Voice ${voiceName}`;
  }
  return `Stand ${asOf}, Kurs ${price} · ${podcastSourceLabel(source)} · Stimme ${voiceName}`;
}

/** Player-Labels folgen der Audiosprache. Quellen-Namen und die übrige Seite bleiben Deutsch. */
export function podcastUiCopy(language: PodcastLanguage): {
  play: string;
  pause: string;
  regenerate: string;
  limitTitle: string;
  retry: string;
  transcript: string;
  llmUnavailable: string;
  missing: string;
  idleTitle: string;
  idleHint: string;
  generateAria: string;
  analyzeLabel: string;
  analyzeDetail: string;
  scriptLabel: string;
  scriptDetail: string;
  audioLabel: string;
  audioDetail: string;
  noKey: string;
  noKeyDetail: string;
} {
  switch (language) {
    case "en":
      return {
        play: "Play",
        pause: "Pause",
        regenerate: "Regenerate",
        limitTitle: "Daily limit reached.",
        retry: "Try again",
        transcript: "Show transcript",
        llmUnavailable: "AI podcast n/a — LLM unavailable.",
        missing: "not available",
        idleTitle: "Generate AI podcast",
        idleHint: "Play starts a fresh AI analysis of every section (current figures), then the transcript and audio via OpenRouter. The dashboard view stays unchanged.",
        generateAria: "Generate AI podcast for",
        analyzeLabel: "Analysis running …",
        analyzeDetail: "Fresh figures + AI for every section",
        scriptLabel: "Transcript is being written …",
        scriptDetail: "OpenRouter interprets the analysis",
        audioLabel: "Audio is being generated …",
        audioDetail: "OpenRouter TTS, xAI fallback",
        noKey: "AI is unavailable: no OpenRouter key is configured on this server. No answer is generated.",
        noKeyDetail: "The podcast transcript needs OPENROUTER_API_KEY. The PDF export stays unchanged.",
      };
    case "de":
      return {
        play: "Wiedergabe",
        pause: "Pause",
        regenerate: "Neu erzeugen",
        limitTitle: "Tageslimit erreicht.",
        retry: "Erneut versuchen",
        transcript: "Transkript anzeigen",
        llmUnavailable: "KI-Podcast n/a — LLM nicht erreichbar.",
        missing: "liegt nicht vor",
        idleTitle: "KI-Podcast erzeugen",
        idleHint: PODCAST_KI_HINT,
        generateAria: "KI-Podcast für",
        analyzeLabel: PODCAST_LOADING_COPY.analyze.label,
        analyzeDetail: PODCAST_LOADING_COPY.analyze.detail,
        scriptLabel: PODCAST_LOADING_COPY.script.label,
        scriptDetail: PODCAST_LOADING_COPY.script.detail,
        audioLabel: PODCAST_LOADING_COPY.audio.label,
        audioDetail: PODCAST_LOADING_COPY.audio.detail,
        noKey: OPENROUTER_NO_KEY_MESSAGE,
        noKeyDetail: PODCAST_NO_KEY_DETAIL,
      };
    default: {
      const unreachable: never = language;
      return unreachable;
    }
  }
}

export function podcastIdleSubtitle(source: PodcastSource, ticker: string): string {
  return `Nur auf Klick · frische Analyse · ${podcastSourceLabel(source)} · ${ticker}`;
}

export function podcastLimitDetail(
  ticker: string,
  language: PodcastLanguage = "de",
  scope: PodcastLimitScope = PODCAST_LIMIT_SCOPE,
): string {
  if (scope === "ticker-language") {
    if (language === "en") return `This language is not available again today for ${ticker}. The other language and cached episodes stay playable.`;
    return `Für ${ticker} ist diese Sprache heute nicht mehr verfügbar. Die andere Sprache und Cache-Treffer bleiben nutzbar.`;
  }
  if (language === "en") return `Not available again today for ${ticker}. Cached episodes stay playable.`;
  return `Für ${ticker} heute nicht mehr verfügbar. Cache-Treffer bleiben abspielbar.`;
}

export function estimateDurationSec(spoken: string): number {
  const words = spoken.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 1;
  return Math.max(1, Math.round((words / 140) * 60));
}

export function buildPodcastScriptRequest(input: {
  ticker: string;
  source: PodcastSource;
  voice: string;
  regenerate: boolean;
  language?: PodcastLanguage;
}): PodcastScriptRequest {
  const request: PodcastScriptRequest = {
    ticker: input.ticker.trim(),
    source: input.source,
    regenerate: input.regenerate,
    fullAi: true,
    language: input.language ?? "de",
  };
  if (isServerVoice(input.voice)) request.voice = input.voice;
  return request;
}

/** Gleiche Query-Reihenfolge wie stockPodcastAudioPath in shared/podcast-types.ts (#529). */
export function podcastAudioPath(opts: {
  chapterId: string;
  ticker: string;
  source: PodcastSource;
  voice: string;
  cacheKey: string;
  language?: PodcastLanguage;
}): string {
  const query = new URLSearchParams({
    ticker: opts.ticker,
    source: opts.source,
    voice: opts.voice,
    cacheKey: opts.cacheKey,
    language: opts.language ?? "de",
  });
  return `/api/podcast/audio/${encodeURIComponent(opts.chapterId)}?${query.toString()}`;
}

export function stageWhileScriptPending(elapsedMs: number): Exclude<PodcastLoadingStage, "audio"> {
  return elapsedMs < PODCAST_ANALYZE_STAGE_MS ? "analyze" : "script";
}

export function clampSeek(sec: number, total: number): number {
  const span = Number.isFinite(total) ? Math.max(0, total) : 0;
  if (!Number.isFinite(sec)) return 0;
  return Math.min(Math.max(0, sec), span);
}

export interface ChapterSpan {
  id: string;
  start: number;
  end: number;
}

export function chapterSpans(chapters: { id: string; durationSec: number }[]): ChapterSpan[] {
  let cursor = 0;
  return chapters.map((chapter) => {
    const start = cursor;
    const duration = Number.isFinite(chapter.durationSec) && chapter.durationSec > 0 ? chapter.durationSec : 1;
    cursor += duration;
    return { id: chapter.id, start, end: cursor };
  });
}

export function totalDuration(chapters: { durationSec: number }[]): number {
  return chapters.reduce((sum, chapter) => sum + (Number.isFinite(chapter.durationSec) && chapter.durationSec > 0 ? chapter.durationSec : 1), 0);
}

export function spanAt(spans: ChapterSpan[], sec: number): ChapterSpan | null {
  if (spans.length === 0) return null;
  const found = spans.find((span) => sec < span.end);
  return found ?? spans[spans.length - 1] ?? null;
}

/** Cache- und Pack-Treffer zählen nicht gegen PODCAST_DAILY_MAX. */
export function countsAgainstDailyLimit(body: { cached?: boolean; packCached?: boolean }): boolean {
  return !(body.cached === true || body.packCached === true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function chapterLabel(record: Record<string, unknown>): string {
  if (typeof record.label === "string" && record.label.trim()) return record.label.trim();
  if (typeof record.title === "string" && record.title.trim()) return record.title.trim();
  return "";
}

export function parsePodcastScript(body: unknown, requestedSource: PodcastSource): ParsedPodcastScript | null {
  if (!isRecord(body) || body.ok === false || !Array.isArray(body.chapters)) return null;
  const chapters: PodcastChapterView[] = [];
  for (const entry of body.chapters) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id.trim()) continue;
    const label = chapterLabel(entry);
    if (!label) continue;
    const spoken = typeof entry.spoken === "string" ? entry.spoken : "";
    const durationSec = typeof entry.durationSec === "number" && Number.isFinite(entry.durationSec) && entry.durationSec > 0
      ? entry.durationSec
      : estimateDurationSec(spoken);
    const audioUrl = typeof entry.audioUrl === "string" && entry.audioUrl.trim() ? entry.audioUrl.trim() : null;
    chapters.push({
      id: entry.id.trim(),
      label,
      spoken,
      durationSec,
      audioUrl,
      llmOwned: entry.llmOwned === true,
      src: null,
    });
  }
  if (chapters.length === 0) return null;
  const source = body.source === "pdf" || body.source === "ki" ? body.source : requestedSource;
  const asOfLabel = typeof body.asOfLabel === "string" && body.asOfLabel.trim() ? body.asOfLabel.trim() : "";
  const asOf = asOfLabel || (typeof body.asOf === "string" ? body.asOf : "");
  return {
    chapters,
    asOf,
    cacheKey: typeof body.cacheKey === "string" ? body.cacheKey : "",
    source,
    voice: typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : null,
    priceLabel: typeof body.priceLabel === "string" && body.priceLabel.trim() ? body.priceLabel.trim() : null,
    voiceLabel: typeof body.voiceLabel === "string" && body.voiceLabel.trim() ? body.voiceLabel.trim() : null,
    language: body.language === "en" || body.language === "de" ? body.language : null,
    cached: body.cached === true,
    packCached: body.packCached === true,
  };
}

export function classifyPodcastFailure(status: number, body: unknown): PodcastFailure | null {
  const record = isRecord(body) ? body : null;
  const code = record && typeof record.errorCode === "string" ? record.errorCode : "";
  const error = record && typeof record.error === "string" ? record.error.trim() : "";
  const failed = status >= 400 || record?.ok === false;
  if (!failed && !code) return null;
  if (status === 429 || code === "RATE_LIMITED") return { kind: "limit" };
  if (code === "NO_API_KEY" || error === OPENROUTER_NO_KEY_MESSAGE) return { kind: "no_key" };
  if (code === "LLM_UNAVAILABLE" || status === 402) return { kind: "llm" };
  if (failed) {
    if (error && error.length <= 240 && !error.startsWith("<")) return { kind: "message", text: error };
    return { kind: "llm" };
  }
  return null;
}

async function readJsonBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("text/html")) return null;
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    return res.json().catch(() => null);
  }
  const text = await res.text().catch(() => "");
  if (!text || text.trim().startsWith("<")) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isDirectAudioUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export interface UsePodcastOptions {
  ticker: string;
  asOfLabel: string;
  priceLabel: string;
  audioRef: RefObject<HTMLAudioElement>;
}

export interface UsePodcastResult {
  source: PodcastSource;
  voiceId: string;
  state: PodcastPlayerState;
  stage: PodcastLoadingStage;
  error: PodcastFailure | null;
  chapters: PodcastChapterView[];
  activeChapterId: string | null;
  currentSec: number;
  totalSec: number;
  speed: PodcastSpeed;
  standAsOf: string;
  standPrice: string;
  language: PodcastLanguage;
  cachedLanguages: Record<PodcastLanguage, boolean>;
  limitedLanguages: Record<PodcastLanguage, boolean>;
  selectSource: (source: PodcastSource) => void;
  selectLanguage: (language: PodcastLanguage) => void;
  generate: () => void;
  regenerate: () => void;
  retry: () => void;
  togglePlay: () => void;
  seekTo: (sec: number) => void;
  skipChapter: (dir: -1 | 1) => void;
  cycleSpeed: () => void;
  changeVoice: (voiceId: string) => void;
}

export function usePodcast({ ticker, asOfLabel, priceLabel, audioRef }: UsePodcastOptions): UsePodcastResult {
  const [source, setSource] = useState<PodcastSource>("ki");
  const [language, setLanguage] = useState<PodcastLanguage>(() => readPodcastLanguage(browserStorage()));
  const [voiceId, setVoiceId] = useState(() => defaultVoiceForLanguage(readPodcastLanguage(browserStorage())));
  const [state, setState] = useState<PodcastPlayerState>("idle");
  const [stage, setStage] = useState<PodcastLoadingStage>("analyze");
  const [error, setError] = useState<PodcastFailure | null>(null);
  const [chapters, setChapters] = useState<PodcastChapterView[]>([]);
  const [currentSec, setCurrentSec] = useState(0);
  const [speed, setSpeed] = useState<PodcastSpeed>(1);
  const [standAsOf, setStandAsOf] = useState(asOfLabel);
  const [standPrice, setStandPrice] = useState(priceLabel);
  const [cacheEpoch, setCacheEpoch] = useState(0);

  const sourceRef = useRef(source);
  const languageRef = useRef(language);
  const voiceRef = useRef(voiceId);
  const voiceByLanguageRef = useRef<Record<PodcastLanguage, string>>({
    de: defaultVoiceForLanguage("de"),
    en: defaultVoiceForLanguage("en"),
  });
  const scriptCacheRef = useRef(new Map<string, PodcastLanguageCache>());
  const limitRef = useRef(new Map<string, boolean>());
  const stateRef = useRef(state);
  const chaptersRef = useRef(chapters);
  const currentSecRef = useRef(0);
  const speedRef = useRef<PodcastSpeed>(1);
  const cacheKeyRef = useRef("");
  const modeRef = useRef<"audio" | "speech">("speech");
  const activeIdRef = useRef<string | null>(null);
  const reqRef = useRef(0);
  const blobRef = useRef<string[]>([]);
  const speechTimer = useRef(0);
  const asOfFallback = useRef(asOfLabel);
  const priceFallback = useRef(priceLabel);

  sourceRef.current = source;
  languageRef.current = language;
  voiceRef.current = voiceId;
  voiceByLanguageRef.current[language] = voiceId;
  stateRef.current = state;
  chaptersRef.current = chapters;
  speedRef.current = speed;
  asOfFallback.current = asOfLabel;
  priceFallback.current = priceLabel;

  const clearSpeechTimer = useCallback(() => {
    if (speechTimer.current) window.clearInterval(speechTimer.current);
    speechTimer.current = 0;
  }, []);

  const revokeBlobs = useCallback(() => {
    const kept = new Set<string>();
    scriptCacheRef.current.forEach((slot) => {
      slot.chapters.forEach((chapter) => {
        if (chapter.src?.startsWith("blob:")) kept.add(chapter.src);
      });
    });
    const next: string[] = [];
    for (const url of blobRef.current) {
      if (kept.has(url)) next.push(url);
      else URL.revokeObjectURL(url);
    }
    blobRef.current = next;
  }, []);

  const stopOutput = useCallback(() => {
    clearSpeechTimer();
    audioRef.current?.pause();
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, [audioRef, clearSpeechTimer]);

  const resetForTicker = useCallback(() => {
    reqRef.current += 1;
    stopOutput();
    revokeBlobs();
    chaptersRef.current = [];
    currentSecRef.current = 0;
    setChapters([]);
    setCurrentSec(0);
    setState("idle");
    setError(null);
    const cleared = tickerIdleResetFields({ asOf: asOfFallback.current, price: priceFallback.current });
    activeIdRef.current = cleared.activeChapterId;
    cacheKeyRef.current = cleared.cacheKey;
    setStage(cleared.stage);
    setStandAsOf(cleared.standAsOf);
    setStandPrice(cleared.standPrice);
  }, [revokeBlobs, stopOutput]);

  useEffect(() => {
    return () => {
      reqRef.current += 1;
      stopOutput();
      revokeBlobs();
    };
  }, [ticker, revokeBlobs, stopOutput]);

  const applyClock = useCallback((sec: number) => {
    const next = clampSeek(sec, totalDuration(chaptersRef.current));
    currentSecRef.current = next;
    setCurrentSec(next);
    const span = spanAt(chapterSpans(chaptersRef.current), next);
    activeIdRef.current = span?.id ?? null;
    if (typeof navigator !== "undefined" && navigator.mediaSession) {
      try {
        const duration = Math.max(totalDuration(chaptersRef.current), 0.01);
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: speedRef.current,
          position: clampSeek(next, duration),
        });
      } catch { /* noch kein Medienelement */ }
    }
  }, []);

  const speakFrom = useCallback((globalSec: number) => {
    clearSpeechTimer();
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const list = chaptersRef.current;
    const spans = chapterSpans(list);
    const span = spanAt(spans, globalSec);
    if (!span) return;
    const chapter = list.find((item) => item.id === span.id);
    if (!chapter) return;
    activeIdRef.current = chapter.id;
    const utterance = new SpeechSynthesisUtterance(chapter.spoken || chapter.label);
    const speechLang = languageRef.current === "en" ? "en-US" : "de-DE";
    utterance.lang = speechLang;
    utterance.rate = speedRef.current;
    const spokenVoice = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith(speechLang.toLowerCase()));
    if (spokenVoice) utterance.voice = spokenVoice;
    const origin = performance.now();
    applyClock(span.start);
    speechTimer.current = window.setInterval(() => {
      const elapsed = ((performance.now() - origin) / 1000) * speedRef.current;
      const next = Math.min(span.end, span.start + elapsed);
      currentSecRef.current = next;
      setCurrentSec(next);
      if (next >= span.end - 0.05) clearSpeechTimer();
    }, 200);
    utterance.onend = () => {
      if (activeIdRef.current !== chapter.id || stateRef.current !== "playing") return;
      clearSpeechTimer();
      const index = list.findIndex((item) => item.id === chapter.id);
      const following = spans[index + 1];
      if (following) speakFrom(following.start);
      else setState("paused");
    };
    try {
      window.speechSynthesis.speak(utterance);
    } catch {
      clearSpeechTimer();
      setState("paused");
    }
  }, [applyClock, clearSpeechTimer]);

  const playAudioAt = useCallback((globalSec: number, shouldPlay: boolean) => {
    const element = audioRef.current;
    const list = chaptersRef.current;
    const span = spanAt(chapterSpans(list), globalSec);
    const chapter = span ? list.find((item) => item.id === span.id) : undefined;
    if (!element || !span || !chapter?.src) {
      modeRef.current = "speech";
      if (shouldPlay) speakFrom(globalSec);
      else applyClock(globalSec);
      return;
    }
    const offset = Math.max(0, globalSec - span.start);
    const startPlayback = () => {
      const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : chapter.durationSec;
      element.currentTime = Math.min(offset, Math.max(0, duration - 0.05));
      element.playbackRate = speedRef.current;
      applyClock(span.start + element.currentTime);
      if (shouldPlay) {
        void element.play().catch(() => setState("paused"));
      }
    };
    if (element.dataset.chapterId === chapter.id && element.src && element.readyState >= 1) {
      startPlayback();
      return;
    }
    element.dataset.chapterId = chapter.id;
    let settled = false;
    const onReady = () => {
      if (settled || element.dataset.chapterId !== chapter.id) return;
      settled = true;
      element.removeEventListener("loadedmetadata", onReady);
      if (Number.isFinite(element.duration) && element.duration > 0 && Math.abs(element.duration - chapter.durationSec) > 0.4) {
        const updated = chaptersRef.current.map((item) => item.id === chapter.id ? { ...item, durationSec: element.duration } : item);
        chaptersRef.current = updated;
        setChapters(updated);
      }
      startPlayback();
    };
    element.addEventListener("loadedmetadata", onReady);
    element.src = chapter.src;
    if (element.readyState >= 1) onReady();
  }, [applyClock, audioRef, speakFrom]);

  const seekTo = useCallback((sec: number) => {
    const next = clampSeek(sec, totalDuration(chaptersRef.current));
    const playing = stateRef.current === "playing";
    if (modeRef.current === "audio") playAudioAt(next, playing);
    else if (playing) speakFrom(next);
    else applyClock(next);
  }, [applyClock, playAudioAt, speakFrom]);

  const skipChapter = useCallback((dir: -1 | 1) => {
    const spans = chapterSpans(chaptersRef.current);
    if (spans.length === 0) return;
    const current = spanAt(spans, currentSecRef.current);
    const index = Math.max(0, spans.findIndex((span) => span.id === current?.id));
    const target = spans[index + dir] ?? spans[dir < 0 ? index : spans.length - 1];
    if (!target) return;
    seekTo(dir < 0 && current && currentSecRef.current - current.start > 2 ? current.start : target.start);
  }, [seekTo]);

  const pause = useCallback(() => {
    setState("paused");
    stateRef.current = "paused";
    audioRef.current?.pause();
    clearSpeechTimer();
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, [audioRef, clearSpeechTimer]);

  const play = useCallback(() => {
    if (chaptersRef.current.length === 0) return;
    const total = totalDuration(chaptersRef.current);
    const atEnd = currentSecRef.current >= total - 0.2;
    const origin = atEnd ? 0 : currentSecRef.current;
    setState("playing");
    stateRef.current = "playing";
    if (modeRef.current === "audio") playAudioAt(origin, true);
    else speakFrom(origin);
  }, [playAudioAt, speakFrom]);

  const markLanguageLimit = useCallback((source: PodcastSource) => {
    for (const marked of languagesMarkedByLimit(PODCAST_LIMIT_SCOPE, languageRef.current)) {
      limitRef.current.set(podcastLimitKey(ticker, marked), true);
    }
    const key = podcastScriptCacheKey(ticker, source, languageRef.current, voiceRef.current);
    const remembered = scriptCacheRef.current.get(key);
    scriptCacheRef.current.set(key, {
      chapters: remembered?.chapters ?? chaptersRef.current,
      cacheKey: remembered?.cacheKey ?? cacheKeyRef.current,
      asOf: remembered?.asOf ?? "",
      priceLabel: remembered?.priceLabel ?? priceFallback.current,
      limited: true,
    });
    setCacheEpoch((value) => value + 1);
    setError({ kind: "limit" });
    setState("limit");
    stateRef.current = "limit";
  }, [ticker]);

  const loadAudio = useCallback(async (list: PodcastChapterView[], voice: string, cacheKey: string, requestId: number): Promise<"limit" | "ok"> => {
    revokeBlobs();
    if (!isServerVoice(voice)) {
      modeRef.current = "speech";
      const cleared = list.map((chapter) => ({ ...chapter, src: null }));
      chaptersRef.current = cleared;
      setChapters(cleared);
      return "ok";
    }
    const resolved: PodcastChapterView[] = [];
    for (const chapter of list) {
      if (requestId !== reqRef.current) return "ok";
      let src: string | null = null;
      const remote = chapter.audioUrl && isDirectAudioUrl(chapter.audioUrl) ? chapter.audioUrl : null;
      if (remote) {
        src = remote;
      } else {
        const path = podcastAudioPath({
          chapterId: chapter.id,
          ticker,
          source: sourceRef.current,
          voice,
          cacheKey,
          language: languageRef.current,
        });
        try {
          const res = await apiRequest("GET", path, undefined, PODCAST_AUDIO_TIMEOUT_MS);
          if (requestId !== reqRef.current) return "ok";
          if (res.status === 429) {
            markLanguageLimit(sourceRef.current);
            return "limit";
          }
          const contentType = res.headers.get("content-type") || "";
          if (res.ok && !contentType.includes("json") && !contentType.includes("html")) {
            const blob = await res.blob();
            if (blob.size > 64) {
              src = URL.createObjectURL(blob);
              blobRef.current.push(src);
            }
          }
        } catch {
          src = null;
        }
      }
      resolved.push({ ...chapter, src });
    }
    if (requestId !== reqRef.current) return "ok";
    const playable = resolved.some((chapter) => chapter.src);
    modeRef.current = playable ? "audio" : "speech";
    chaptersRef.current = resolved;
    setChapters(resolved);
    return "ok";
  }, [markLanguageLimit, revokeBlobs, ticker]);

  useEffect(() => {
    const slot = scriptCacheRef.current.get(podcastScriptCacheKey(ticker, sourceRef.current, languageRef.current, voiceRef.current));
    const limited = limitRef.current.get(podcastLimitKey(ticker, languageRef.current)) === true;
    if (slot && slot.chapters.length > 0) {
      const chapters = slot.chapters.map((chapter) => ({ ...chapter, src: null }));
      chaptersRef.current = chapters;
      setChapters(chapters);
      cacheKeyRef.current = slot.cacheKey;
      setStandAsOf(formatPodcastAsOf(slot.asOf, asOfFallback.current));
      setStandPrice(slot.priceLabel || priceFallback.current);
      setError(null);
      setState("paused");
      stateRef.current = "paused";
      void loadAudio(chapters, voiceRef.current, slot.cacheKey, reqRef.current);
      return;
    }
    resetForTicker();
    if (limited) {
      setError({ kind: "limit" });
      setState("limit");
      stateRef.current = "limit";
    } else {
      stateRef.current = "idle";
    }
  }, [ticker, loadAudio, resetForTicker]);

  const adoptScript = useCallback((parsed: ParsedPodcastScript) => {
    cacheKeyRef.current = parsed.cacheKey;
    const nextSource = parsed.source ?? sourceRef.current;
    if (parsed.source) setSource(parsed.source);
    if (parsed.voice && voiceRef.current !== PODCAST_BROWSER_VOICE) {
      voiceRef.current = parsed.voice;
      setVoiceId(parsed.voice);
    }
    setStandAsOf(formatPodcastAsOf(parsed.asOf, asOfFallback.current));
    setStandPrice(parsed.priceLabel ?? priceFallback.current);
    chaptersRef.current = parsed.chapters;
    setChapters(parsed.chapters);
    applyClock(0);
    return nextSource;
  }, [applyClock]);

  const run = useCallback(async (nextSource: PodcastSource, regenerate: boolean) => {
    const requestId = ++reqRef.current;
    setSource(nextSource);
    sourceRef.current = nextSource;
    setError(null);
    setState("loading");
    stateRef.current = "loading";
    setStage("analyze");
    stopOutput();
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (requestId !== reqRef.current) return;
      setStage((current) => current === "audio" ? current : stageWhileScriptPending(Date.now() - started));
    }, 400);
    try {
      const res = await apiRequest(
        "POST",
        PODCAST_SCRIPT_PATH,
        buildPodcastScriptRequest({
          ticker,
          source: nextSource,
          voice: voiceRef.current,
          regenerate,
          language: languageRef.current,
        }),
        PODCAST_SCRIPT_TIMEOUT_MS,
      );
      if (requestId !== reqRef.current) return;
      const body = await readJsonBody(res);
      const parsed = parsePodcastScript(body, nextSource);
      const failure = classifyPodcastFailure(res.status, body);
      if (failure?.kind === "limit" || res.status === 429) {
        if (parsed) adoptScript(parsed);
        for (const marked of languagesMarkedByLimit(PODCAST_LIMIT_SCOPE, languageRef.current)) {
          limitRef.current.set(podcastLimitKey(ticker, marked), true);
        }
        const limitVoice = voiceRef.current;
        const remembered = scriptCacheRef.current.get(podcastScriptCacheKey(ticker, nextSource, languageRef.current, limitVoice));
        scriptCacheRef.current.set(podcastScriptCacheKey(ticker, nextSource, languageRef.current, limitVoice), {
          chapters: parsed?.chapters ?? remembered?.chapters ?? chaptersRef.current,
          cacheKey: parsed?.cacheKey ?? remembered?.cacheKey ?? cacheKeyRef.current,
          asOf: parsed?.asOf ?? remembered?.asOf ?? "",
          priceLabel: parsed?.priceLabel ?? remembered?.priceLabel ?? priceFallback.current,
          limited: true,
        });
        setCacheEpoch((value) => value + 1);
        setError({ kind: "limit" });
        setState("limit");
        stateRef.current = "limit";
        return;
      }
      if (!parsed) {
        const nextFailure = failure ?? { kind: "llm" as const };
        setError(nextFailure);
        setState("error");
        stateRef.current = "error";
        return;
      }
      adoptScript(parsed);
      const storedVoice = voiceRef.current;
      const slotKey = podcastScriptCacheKey(ticker, nextSource, parsed.language ?? languageRef.current, storedVoice);
      scriptCacheRef.current.set(slotKey, {
        chapters: parsed.chapters,
        cacheKey: parsed.cacheKey,
        asOf: parsed.asOf,
        priceLabel: parsed.priceLabel ?? priceFallback.current,
        limited: false,
      });
      setCacheEpoch((value) => value + 1);
      setStage("audio");
      const playbackVoice = storedVoice === PODCAST_BROWSER_VOICE ? PODCAST_BROWSER_VOICE : (parsed.voice ?? storedVoice);
      const audio = await loadAudio(parsed.chapters, playbackVoice, parsed.cacheKey, requestId);
      if (requestId !== reqRef.current || audio === "limit") return;
      const stored = scriptCacheRef.current.get(slotKey);
      if (stored) {
        scriptCacheRef.current.set(slotKey, { ...stored, chapters: chaptersRef.current });
        setCacheEpoch((value) => value + 1);
      }
      play();
    } catch {
      if (requestId !== reqRef.current) return;
      setError({ kind: "llm" });
      setState("error");
      stateRef.current = "error";
    } finally {
      window.clearInterval(timer);
    }
  }, [adoptScript, loadAudio, play, stopOutput, ticker]);

  const reloadVoice = useCallback(async (nextVoice: string) => {
    setVoiceId(nextVoice);
    voiceRef.current = nextVoice;
    if (chaptersRef.current.length === 0) return;
    const requestId = ++reqRef.current;
    setState("loading");
    stateRef.current = "loading";
    setStage("audio");
    stopOutput();
    const audio = await loadAudio(chaptersRef.current, nextVoice, cacheKeyRef.current, requestId);
    if (requestId !== reqRef.current || audio === "limit") return;
    play();
  }, [loadAudio, play, stopOutput]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    const onTime = () => {
      if (modeRef.current !== "audio") return;
      const span = chapterSpans(chaptersRef.current).find((item) => item.id === element.dataset.chapterId);
      if (!span) return;
      applyClock(span.start + element.currentTime);
    };
    const onEnded = () => {
      const spans = chapterSpans(chaptersRef.current);
      const index = spans.findIndex((item) => item.id === element.dataset.chapterId);
      const following = spans[index + 1];
      if (following && stateRef.current === "playing") playAudioAt(following.start, true);
      else pause();
    };
    element.addEventListener("timeupdate", onTime);
    element.addEventListener("ended", onEnded);
    return () => {
      element.removeEventListener("timeupdate", onTime);
      element.removeEventListener("ended", onEnded);
    };
  }, [applyClock, audioRef, pause, playAudioAt]);

  const bindMediaSession = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.mediaSession || chaptersRef.current.length === 0) return;
    const session = navigator.mediaSession;
    const active = chaptersRef.current.find((chapter) => chapter.id === activeIdRef.current) ?? chaptersRef.current[0];
    session.metadata = new MediaMetadata({
      title: active ? `${ticker} · ${active.label}` : `KI-Podcast ${ticker}`,
      artist: voiceNameFor(voiceRef.current),
      album: podcastSourceLabel(sourceRef.current),
    });
    const safe = (name: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { session.setActionHandler(name, handler); } catch { /* Aktion im Browser nicht vorhanden */ }
    };
    safe("play", () => play());
    safe("pause", () => pause());
    safe("seekbackward", () => seekTo(currentSecRef.current - 15));
    safe("seekforward", () => seekTo(currentSecRef.current + 15));
    safe("previoustrack", () => skipChapter(-1));
    safe("nexttrack", () => skipChapter(1));
    safe("seekto", (details) => {
      if (typeof details.seekTime === "number") seekTo(details.seekTime);
    });
    try {
      const duration = Math.max(totalDuration(chaptersRef.current), 0.01);
      session.setPositionState({
        duration,
        playbackRate: speedRef.current,
        position: clampSeek(currentSecRef.current, duration),
      });
    } catch { /* Position vor dem ersten Frame */ }
  }, [pause, play, seekTo, skipChapter, ticker]);

  useEffect(() => {
    bindMediaSession();
    return () => {
      if (typeof navigator === "undefined" || !navigator.mediaSession) return;
      const session = navigator.mediaSession;
      const safe = (name: MediaSessionAction) => {
        try { session.setActionHandler(name, null); } catch { /* Aktion im Browser nicht vorhanden */ }
      };
      safe("play");
      safe("pause");
      safe("seekbackward");
      safe("seekforward");
      safe("previoustrack");
      safe("nexttrack");
      safe("seekto");
    };
  }, [bindMediaSession, chapters, source, voiceId, speed]);

  const selectSource = useCallback((next: PodcastSource) => {
    void run(next, false);
  }, [run]);

  const selectLanguage = useCallback((next: PodcastLanguage) => {
    if (stateRef.current === "loading" || next === languageRef.current) return;
    const nextVoice = mapVoiceAcrossLanguage(voiceRef.current, next);
    const key = podcastScriptCacheKey(ticker, sourceRef.current, next, nextVoice);
    const slot = scriptCacheRef.current.get(key);
    const hasCache = (slot?.chapters.length ?? 0) > 0;
    const limited = limitRef.current.get(podcastLimitKey(ticker, next)) === true;
    if (languageSegmentDisabled({ limited, hasCache, loading: false })) return;
    voiceByLanguageRef.current[next] = nextVoice;
    languageRef.current = next;
    setLanguage(next);
    voiceRef.current = nextVoice;
    setVoiceId(nextVoice);
    writePodcastLanguage(browserStorage(), next);
    stopOutput();
    if (decideLanguageSwitch(hasCache) === "play" && slot) {
      const chapters = slot.chapters;
      chaptersRef.current = chapters;
      setChapters(chapters);
      cacheKeyRef.current = slot.cacheKey;
      currentSecRef.current = 0;
      setCurrentSec(0);
      setStandAsOf(formatPodcastAsOf(slot.asOf, asOfFallback.current));
      setStandPrice(slot.priceLabel || priceFallback.current);
      setError(null);
      modeRef.current = chapters.some((chapter) => chapter.src) && isServerVoice(nextVoice) ? "audio" : "speech";
      setState("paused");
      stateRef.current = "paused";
      play();
      return;
    }
    stopOutput();
    chaptersRef.current = [];
    currentSecRef.current = 0;
    setChapters([]);
    setCurrentSec(0);
    setError(null);
    setState("idle");
    stateRef.current = "idle";
  }, [play, stopOutput, ticker]);

  const generate = useCallback(() => {
    void run(sourceRef.current, false);
  }, [run]);

  const regenerate = useCallback(() => {
    void run(sourceRef.current, true);
  }, [run]);

  const cycleSpeed = useCallback(() => {
    const next = nextSpeed(speedRef.current);
    speedRef.current = next;
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
    if (modeRef.current === "speech" && stateRef.current === "playing") speakFrom(currentSecRef.current);
  }, [audioRef, speakFrom]);

  const togglePlay = useCallback(() => {
    if (stateRef.current === "playing") pause();
    else if (chaptersRef.current.length > 0) play();
    else void run(sourceRef.current, false);
  }, [pause, play, run]);

  const spans = chapterSpans(chapters);
  const activeChapterId = spanAt(spans, currentSec)?.id ?? null;
  const voiceFor = (target: PodcastLanguage) => target === language ? voiceId : mapVoiceAcrossLanguage(voiceId, target);
  const cachedLanguages: Record<PodcastLanguage, boolean> = {
    de: (scriptCacheRef.current.get(podcastScriptCacheKey(ticker, source, "de", voiceFor("de")))?.chapters.length ?? 0) > 0,
    en: (scriptCacheRef.current.get(podcastScriptCacheKey(ticker, source, "en", voiceFor("en")))?.chapters.length ?? 0) > 0,
  };
  const limitedLanguages: Record<PodcastLanguage, boolean> = {
    de: limitRef.current.get(podcastLimitKey(ticker, "de")) === true,
    en: limitRef.current.get(podcastLimitKey(ticker, "en")) === true,
  };
  void cacheEpoch;

  return {
    source,
    language,
    cachedLanguages,
    limitedLanguages,
    voiceId,
    state,
    stage,
    error,
    chapters,
    activeChapterId,
    currentSec,
    totalSec: totalDuration(chapters),
    speed,
    standAsOf,
    standPrice,
    selectSource,
    selectLanguage,
    generate,
    regenerate,
    retry: generate,
    togglePlay,
    seekTo,
    skipChapter,
    cycleSpeed,
    changeVoice: (id: string) => { void reloadVoice(id); },
  };
}
