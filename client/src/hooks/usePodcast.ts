/**
 * KI-Podcast je Aktie (Design-Spec v4 + Offen_KI_PODCAST_ENTWURF.md C6).
 *
 * Die Typen unten sind die lokale Abbildung des Response-Vertrags, den PR A
 * in shared/ anlegt (Skript-Route und Audio-Route). Sie werden hier nicht
 * nach shared/ kopiert. Nach dem Merge von PR A auf den shared-Export
 * umstellen. PR B wird erst nach PR A gemergt.
 *
 * Vertrag, gegen den der Hook gebaut ist — keine eigenen Felder:
 *   POST /api/podcast/script
 *   Body: { ticker, source: "pdf" | "ki", voice, fullAi: true, fresh: true }
 *   200:  { chapters: [{ id, title, template?, spoken, durationSec?, audioUrl? }],
 *             asOf, cacheKey, source, voice, price? | priceLabel?, cached? | cacheHit? }
 *   Der Player-Typ der Spec nennt `label` statt `title`; beides wird gelesen.
 *   429 oder errorCode RATE_LIMITED: Tageslimit.
 *   errorCode NO_API_KEY oder error === OPENROUTER_NO_KEY_MESSAGE.
 *   errorCode LLM_UNAVAILABLE oder HTTP 402: „KI-Podcast n/a — LLM nicht erreichbar.“
 *   GET /api/podcast/audio/:chapterId?voice=&cacheKey=  audio/mpeg
 *   Liegt audioUrl am Kapitel, wird diese URL verwendet.
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

export const PODCAST_VOICE_GROUPS: { id: PodcastVoiceOption["group"]; label: string }[] = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "xai", label: "Fallback xAI" },
  { id: "browser", label: "Browser" },
];

export interface PodcastScriptRequest {
  ticker: string;
  source: PodcastSource;
  voice: string;
  fullAi: true;
  fresh: true;
}

/** Kapitel, wie der Player sie spricht. `src` ist die aufgelöste Audio-URL, kein Serverfeld. */
export interface PodcastChapterView {
  id: string;
  label: string;
  spoken: string;
  durationSec: number;
  audioUrl: string | null;
  src: string | null;
}

export interface ParsedPodcastScript {
  chapters: PodcastChapterView[];
  asOf: string;
  cacheKey: string;
  source: PodcastSource | null;
  voice: string | null;
  priceLabel: string | null;
  cached: boolean;
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
  return PODCAST_VOICES.find((voice) => voice.id === id);
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

export function formatStandLine(asOf: string, price: string, source: PodcastSource, voiceName: string): string {
  return `Stand ${asOf}, Kurs ${price} · ${podcastSourceLabel(source)} · Stimme ${voiceName}`;
}

export function podcastIdleSubtitle(source: PodcastSource, ticker: string): string {
  return `Nur auf Klick · frische Analyse · ${podcastSourceLabel(source)} · ${ticker}`;
}

export function podcastLimitDetail(ticker: string): string {
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
}): PodcastScriptRequest {
  return {
    ticker: input.ticker.trim(),
    source: input.source,
    voice: input.voice,
    fullAi: true,
    fresh: true,
  };
}

export function podcastAudioPath(chapterId: string, voice: string, cacheKey: string): string {
  const query = new URLSearchParams();
  query.set("voice", voice);
  if (cacheKey) query.set("cacheKey", cacheKey);
  return `/api/podcast/audio/${encodeURIComponent(chapterId)}?${query.toString()}`;
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

/** Cache-Treffer zählen nicht gegen das Tageslimit. */
export function countsAgainstDailyLimit(body: { cached?: boolean; cacheHit?: boolean }): boolean {
  return !(body.cached === true || body.cacheHit === true);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function chapterLabel(record: Record<string, unknown>): string {
  if (typeof record.title === "string" && record.title.trim()) return record.title.trim();
  if (typeof record.label === "string" && record.label.trim()) return record.label.trim();
  return "";
}

function readPriceLabel(record: Record<string, unknown>): string | null {
  if (typeof record.priceLabel === "string" && record.priceLabel.trim()) return record.priceLabel.trim();
  if (typeof record.price === "number" && Number.isFinite(record.price)) return formatPodcastPrice(record.price);
  return null;
}

export function parsePodcastScript(body: unknown, requestedSource: PodcastSource): ParsedPodcastScript | null {
  if (!isRecord(body) || !Array.isArray(body.chapters)) return null;
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
    chapters.push({ id: entry.id.trim(), label, spoken, durationSec, audioUrl, src: null });
  }
  if (chapters.length === 0) return null;
  const source = body.source === "pdf" || body.source === "ki" ? body.source : requestedSource;
  return {
    chapters,
    asOf: typeof body.asOf === "string" ? body.asOf : "",
    cacheKey: typeof body.cacheKey === "string" ? body.cacheKey : "",
    source,
    voice: typeof body.voice === "string" && body.voice.trim() ? body.voice.trim() : null,
    priceLabel: readPriceLabel(body),
    cached: body.cached === true || body.cacheHit === true,
  };
}

export function classifyPodcastFailure(status: number, body: unknown): PodcastFailure | null {
  const record = isRecord(body) ? body : null;
  const code = record && typeof record.errorCode === "string" ? record.errorCode : "";
  const error = record && typeof record.error === "string" ? record.error.trim() : "";
  if (status === 429 || code === "RATE_LIMITED") return { kind: "limit" };
  if (code === "NO_API_KEY" || error === OPENROUTER_NO_KEY_MESSAGE) return { kind: "no_key" };
  if (code === "LLM_UNAVAILABLE" || status === 402) return { kind: "llm" };
  if (status >= 400) {
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
  selectSource: (source: PodcastSource) => void;
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
  const [voiceId, setVoiceId] = useState(PODCAST_DEFAULT_VOICE);
  const [state, setState] = useState<PodcastPlayerState>("idle");
  const [stage, setStage] = useState<PodcastLoadingStage>("analyze");
  const [error, setError] = useState<PodcastFailure | null>(null);
  const [chapters, setChapters] = useState<PodcastChapterView[]>([]);
  const [currentSec, setCurrentSec] = useState(0);
  const [speed, setSpeed] = useState<PodcastSpeed>(1);
  const [standAsOf, setStandAsOf] = useState(asOfLabel);
  const [standPrice, setStandPrice] = useState(priceLabel);

  const sourceRef = useRef(source);
  const voiceRef = useRef(voiceId);
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
  voiceRef.current = voiceId;
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
    for (const url of blobRef.current) URL.revokeObjectURL(url);
    blobRef.current = [];
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
    activeIdRef.current = null;
    cacheKeyRef.current = "";
    setChapters([]);
    setCurrentSec(0);
    setState("idle");
    setStage("analyze");
    setError(null);
    setStandAsOf(asOfFallback.current);
    setStandPrice(priceFallback.current);
  }, [revokeBlobs, stopOutput]);

  useEffect(() => {
    resetForTicker();
    return () => {
      reqRef.current += 1;
      stopOutput();
      revokeBlobs();
    };
    // Reset nur wenn die Aktie wechselt. asOf/Kurs aktualisieren den Fallback, nicht den Lauf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

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
    utterance.lang = "de-DE";
    utterance.rate = speedRef.current;
    const german = window.speechSynthesis.getVoices().find((voice) => /^de([-_]|$)/i.test(voice.lang));
    if (german) utterance.voice = german;
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

  const loadAudio = useCallback(async (list: PodcastChapterView[], voice: string, cacheKey: string, requestId: number) => {
    revokeBlobs();
    if (voice === "browser") {
      modeRef.current = "speech";
      const cleared = list.map((chapter) => ({ ...chapter, src: null }));
      chaptersRef.current = cleared;
      setChapters(cleared);
      return;
    }
    const resolved: PodcastChapterView[] = [];
    for (const chapter of list) {
      if (requestId !== reqRef.current) return;
      let src: string | null = null;
      const remote = chapter.audioUrl && isDirectAudioUrl(chapter.audioUrl) ? chapter.audioUrl : null;
      if (remote) {
        src = remote;
      } else {
        const path = chapter.audioUrl && chapter.audioUrl.startsWith("/")
          ? chapter.audioUrl
          : podcastAudioPath(chapter.id, voice, cacheKey);
        try {
          const res = await apiRequest("GET", path, undefined, PODCAST_AUDIO_TIMEOUT_MS);
          if (requestId !== reqRef.current) return;
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
    if (requestId !== reqRef.current) return;
    const playable = resolved.some((chapter) => chapter.src);
    modeRef.current = playable ? "audio" : "speech";
    chaptersRef.current = resolved;
    setChapters(resolved);
  }, [revokeBlobs]);

  const adoptScript = useCallback((parsed: ParsedPodcastScript) => {
    cacheKeyRef.current = parsed.cacheKey;
    const nextSource = parsed.source ?? sourceRef.current;
    if (parsed.source) setSource(parsed.source);
    if (parsed.voice) setVoiceId(parsed.voice);
    setStandAsOf(formatPodcastAsOf(parsed.asOf, asOfFallback.current));
    setStandPrice(parsed.priceLabel ?? priceFallback.current);
    chaptersRef.current = parsed.chapters;
    setChapters(parsed.chapters);
    applyClock(0);
    return nextSource;
  }, [applyClock]);

  const run = useCallback(async (nextSource: PodcastSource) => {
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
        buildPodcastScriptRequest({ ticker, source: nextSource, voice: voiceRef.current }),
        PODCAST_SCRIPT_TIMEOUT_MS,
      );
      if (requestId !== reqRef.current) return;
      const body = await readJsonBody(res);
      const parsed = parsePodcastScript(body, nextSource);
      const failure = classifyPodcastFailure(res.status, body);
      if (failure?.kind === "limit" || res.status === 429) {
        if (parsed) adoptScript(parsed);
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
      setStage("audio");
      await loadAudio(parsed.chapters, parsed.voice ?? voiceRef.current, parsed.cacheKey, requestId);
      if (requestId !== reqRef.current) return;
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
    await loadAudio(chaptersRef.current, nextVoice, cacheKeyRef.current, requestId);
    if (requestId !== reqRef.current) return;
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
    void run(next);
  }, [run]);

  const generate = useCallback(() => {
    void run(sourceRef.current);
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
    else void run(sourceRef.current);
  }, [pause, play, run]);

  const spans = chapterSpans(chapters);
  const activeChapterId = spanAt(spans, currentSec)?.id ?? null;

  return {
    source,
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
    generate,
    regenerate: generate,
    retry: generate,
    togglePlay,
    seekTo,
    skipChapter,
    cycleSpeed,
    changeVoice: (id: string) => { void reloadVoice(id); },
  };
}
