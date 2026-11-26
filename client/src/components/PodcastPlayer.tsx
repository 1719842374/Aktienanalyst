/**
 * KI-Podcast-Player neben der g*-Zeile.
 * Stimmen-Menü per Portal, weil SectionCard overflow-hidden hat.
 * Der Wurzelknoten trägt data-html2canvas-ignore, damit der Client-PDF-Export
 * den Player auslässt. server/pdf-export.ts bleibt unberührt.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check, SkipBack, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PODCAST_VOICE_GROUPS,
  PODCAST_VOICES,
  languageSegmentDisabled,
  voicesForLanguage,
  formatClock,
  formatSpeedLabel,
  formatStandLine,
  podcastLimitDetail,
  podcastSourceLabel,
  podcastUiCopy,
  usePodcast,
  voiceNameFor,
  type PodcastChapterView,
  type PodcastFailure,
  type PodcastLanguage,
  type PodcastLoadingStage,
  type PodcastPlayerState,
  type PodcastSource,
  type PodcastSpeed,
  type PodcastVoiceOption,
} from "@/hooks/usePodcast";

const STAGE_ORDER: PodcastLoadingStage[] = ["analyze", "script", "audio"];

function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M8.2 5.4v13.2L18.8 12 8.2 5.4z" fill="currentColor" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path fill="currentColor" d="M6 5h3.4v14H6V5zm8.6 0H18v14h-3.4V5z" />
    </svg>
  );
}

function SecondsGlyph({ direction }: { direction: "back" | "forward" }) {
  const forward = direction === "forward";
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden="true">
      <path
        d={forward
          ? "M16 7a9 9 0 1 1-6.4 2.6"
          : "M16 7a9 9 0 1 0 6.4 2.6"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d={forward ? "M8.2 6.2l1.2 5.2 5-1.6" : "M23.8 6.2l-1.2 5.2-5-1.6"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="16" y="19.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor">15</text>
    </svg>
  );
}

function errorCopy(error: PodcastFailure, language: PodcastLanguage): { title: string; detail?: string } {
  const copy = podcastUiCopy(language);
  switch (error.kind) {
    case "no_key":
      return { title: copy.noKey, detail: copy.noKeyDetail };
    case "llm":
      return { title: copy.llmUnavailable };
    case "message":
      return { title: error.text };
    case "limit":
      return { title: copy.limitTitle };
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

export function PodcastVoiceMenu({
  activeId,
  onSelect,
  className,
  voices = PODCAST_VOICES,
}: {
  activeId: string;
  onSelect: (voiceId: string) => void;
  className?: string;
  voices?: readonly PodcastVoiceOption[];
}) {
  return (
    <ul
      role="listbox"
      aria-label="Stimme"
      data-testid="podcast-voice-menu"
      className={cn("max-h-72 w-56 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md", className)}
    >
      {PODCAST_VOICE_GROUPS.map((group) => {
        const options = voices.filter((voice) => voice.group === group.id);
        if (options.length === 0) return null;
        return (
        <li key={group.id} className="px-1 py-1">
          <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{group.label}</div>
          <ul role="group" aria-label={group.label}>
            {options.map((voice) => {
              const selected = voice.id === activeId;
              return (
                <li key={voice.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-testid={`option-podcast-voice-${voice.slug}`}
                    className={cn(
                      "flex min-h-8 w-full items-center rounded-sm px-2 text-left text-sm",
                      selected ? "bg-foreground text-background" : "hover:bg-muted",
                    )}
                    onClick={() => onSelect(voice.id)}
                  >
                    {voice.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
        );
      })}
    </ul>
  );
}

function TransportButton({
  testId,
  label,
  onClick,
  children,
  className,
}: {
  testId: string;
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface PodcastPlayerViewProps {
  ticker: string;
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
  audioRef?: RefObject<HTMLAudioElement>;
  onSourceChange: (source: PodcastSource) => void;
  onGenerate: () => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onTogglePlay: () => void;
  onSeekTo: (sec: number) => void;
  onSkipChapter: (dir: -1 | 1) => void;
  onSpeed: () => void;
  onVoiceChange: (voiceId: string) => void;
  language?: PodcastLanguage;
  cachedLanguages?: Record<PodcastLanguage, boolean>;
  limitedLanguages?: Record<PodcastLanguage, boolean>;
  onLanguageChange?: (language: PodcastLanguage) => void;
  voices?: readonly PodcastVoiceOption[];
}

export function PodcastPlayerView({
  ticker,
  source,
  voiceId,
  state,
  stage,
  error,
  chapters,
  activeChapterId,
  currentSec,
  totalSec,
  speed,
  standAsOf,
  standPrice,
  audioRef,
  onSourceChange,
  onGenerate,
  onRegenerate,
  onRetry,
  onTogglePlay,
  onSeekTo,
  onSkipChapter,
  onSpeed,
  onVoiceChange,
  language = "de",
  cachedLanguages = { de: false, en: false },
  limitedLanguages = { de: false, en: false },
  onLanguageChange,
  voices,
}: PodcastPlayerViewProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const voiceButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const menuId = useId();
  const placeMenu = () => {
    const rect = voiceButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 224;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setMenuStyle({ top: rect.bottom + 6, left });
  };
  const playing = state === "playing";
  const showTransport = chapters.length > 0 && state !== "idle" && state !== "loading";
  const voiceName = voiceNameFor(voiceId);
  const copy = podcastUiCopy(language);

  useEffect(() => {
    if (!menuOpen) return;
    placeMenu();
    const onPointer = (event: globalThis.MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || voiceButtonRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("resize", placeMenu);
    window.addEventListener("scroll", placeMenu, true);
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", placeMenu);
      window.removeEventListener("scroll", placeMenu, true);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "j" || event.key === "J") {
      event.preventDefault();
      onSeekTo(currentSec - 15);
    } else if (event.key === "ArrowRight" || event.key === "l" || event.key === "L") {
      event.preventDefault();
      onSeekTo(currentSec + 15);
    } else if (event.key === "[" || event.key === "MediaTrackPrevious") {
      event.preventDefault();
      onSkipChapter(-1);
    } else if (event.key === "]" || event.key === "MediaTrackNext") {
      event.preventDefault();
      onSkipChapter(1);
    }
  };

  const seekFromBar = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (totalSec <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    onSeekTo(Math.min(1, Math.max(0, ratio)) * totalSec);
  };

  let cursor = 0;
  const segments = chapters.map((chapter) => {
    const start = cursor;
    cursor += chapter.durationSec;
    const end = cursor;
    const fill = end <= currentSec ? 1 : start >= currentSec ? 0 : (currentSec - start) / Math.max(0.001, end - start);
    return { chapter, fill };
  });

  return (
    <div
      data-testid="podcast-player"
      data-html2canvas-ignore=""
      className="flex-auto shrink-0 min-w-[min(100%,18.5rem)] max-w-full"
      style={{ flexBasis: "min(100%, 18.5rem)" }}
      onKeyDown={onKeyDown}
    >
      <div data-testid="podcast-cluster" className="flex min-w-0 max-w-full flex-col gap-2" aria-busy={state === "loading"}>
        <div data-testid="podcast-toolbar" className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <div
            role="radiogroup"
            aria-label="Podcast-Quelle"
            data-testid="podcast-source"
            className="flex min-w-[min(100%,12rem)] max-w-full flex-1 rounded-md border border-border bg-muted/40 p-0.5 text-[11px] font-semibold"
          >
            <button
              type="button"
              role="radio"
              aria-checked={source === "pdf"}
              data-testid="button-podcast-source-pdf"
              aria-label="Quelle PDF-basiert"
              className={cn(
                "min-h-11 flex-1 rounded-[5px] px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                source === "pdf" ? "bg-foreground text-background" : "text-muted-foreground",
              )}
              onClick={() => onSourceChange("pdf")}
            >
              PDF-basiert
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={source === "ki"}
              data-testid="button-podcast-source-ki"
              aria-label="Quelle KI-Analyse"
              className={cn(
                "min-h-11 flex-1 rounded-[5px] px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                source === "ki" ? "bg-foreground text-background" : "text-muted-foreground",
              )}
              onClick={() => onSourceChange("ki")}
            >
              KI-Analyse
            </button>
          </div>
          <div
            role="radiogroup"
            aria-label="Podcast-Sprache"
            data-testid="podcast-language"
            className="flex min-w-[min(100%,18.5rem)] max-w-full shrink-0 rounded-md border border-border bg-muted/40 p-0.5 text-[11px] font-semibold"
          >
            {(["de", "en"] as const).map((code) => {
              const hasCache = cachedLanguages[code];
              const limited = limitedLanguages[code];
              const disabled = languageSegmentDisabled({ limited, hasCache, loading: state === "loading" });
              const selected = language === code;
              return (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-disabled={disabled}
                  disabled={disabled}
                  title={limited ? podcastUiCopy(code).limitTitle : undefined}
                  data-testid={`button-podcast-lang-${code}`}
                  aria-label={code === "de" ? "Sprache Deutsch" : "Sprache Englisch"}
                  className={cn(
                    "inline-flex min-h-11 min-w-11 flex-1 items-center justify-center gap-1 rounded-[5px] px-3 uppercase focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-foreground text-background" : "text-muted-foreground",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                  onClick={() => onLanguageChange?.(code)}
                >
                  {code}
                  {hasCache ? <Check className="h-3.5 w-3.5" aria-hidden="true" data-testid={`podcast-lang-cached-${code}`} /> : null}
                </button>
              );
            })}
          </div>
        </div>

        {state === "idle" && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="button-podcast-generate"
                aria-label={language === "en" ? `${copy.generateAria} ${ticker}` : `KI-Podcast für ${ticker} erzeugen`}
                onClick={onGenerate}
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ backgroundColor: "#1ED760" }}
              >
                <PlayGlyph className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{copy.idleTitle}</div>
                <div className="text-[11px] text-muted-foreground">{language === "en"
                  ? `Only on click · fresh analysis · ${podcastSourceLabel(source)} · ${ticker}`
                  : `Nur auf Klick · frische Analyse · ${podcastSourceLabel(source)} · ${ticker}`}</div>
              </div>
            </div>
            <p data-testid="podcast-ki-hint" className="text-[11px] leading-snug text-muted-foreground">{copy.idleHint}</p>
          </div>
        )}

        {state === "loading" && (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <div
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "#1ED760" }}
                aria-hidden="true"
              >
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/25 border-t-black" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{stage === "analyze" ? copy.analyzeLabel : stage === "script" ? copy.scriptLabel : copy.audioLabel}</div>
                <div className="text-[11px] text-muted-foreground">{stage === "analyze" ? copy.analyzeDetail : stage === "script" ? copy.scriptDetail : copy.audioDetail}</div>
              </div>
            </div>
            <ol data-testid="podcast-loading-steps" className="flex flex-col gap-0.5 text-[11px]">
              {STAGE_ORDER.map((step) => {
                const stepIndex = STAGE_ORDER.indexOf(step);
                const activeIndex = STAGE_ORDER.indexOf(stage);
                const active = step === stage;
                const done = stepIndex < activeIndex;
                return (
                  <li
                    key={step}
                    data-testid={`podcast-loading-step-${step}`}
                    className={active ? "font-bold text-[#1ED760]" : done ? "text-foreground" : "text-muted-foreground"}
                  >
                    {step === "analyze" ? copy.analyzeLabel : step === "script" ? copy.scriptLabel : copy.audioLabel}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {state === "error" && error && error.kind !== "limit" && (
          <div data-testid="podcast-error" role="alert" className="rounded-md border border-destructive/40 px-3 py-2">
            <p className="text-sm font-semibold text-foreground">{errorCopy(error, language).title}</p>
            {errorCopy(error, language).detail ? (
              <p className="mt-1 text-[11px] text-muted-foreground">{errorCopy(error, language).detail}</p>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="mt-2" data-testid="button-podcast-retry" onClick={onRetry}>
              {copy.retry}
            </Button>
          </div>
        )}

        {state === "limit" && (
          <div data-testid="podcast-rate-limit" role="status" className="rounded-md border border-border px-3 py-2">
            <p className="text-sm font-semibold text-foreground">{copy.limitTitle}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{podcastLimitDetail(ticker, language)}</p>
          </div>
        )}

        {showTransport && (
          <div className="flex flex-col gap-1.5">
            <div className="rounded-[10px] border border-border/80 bg-muted/[0.45] px-2.5 py-2">
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  data-testid="button-podcast-speed"
                  aria-label={`Geschwindigkeit ${formatSpeedLabel(speed)}, ändern`}
                  onClick={onSpeed}
                  className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-md px-1 text-[12px] font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {formatSpeedLabel(speed)}
                </button>
                <button
                  type="button"
                  ref={voiceButtonRef}
                  data-testid="button-podcast-voice"
                  aria-haspopup="listbox"
                  aria-expanded={menuOpen}
                  aria-controls={menuId}
                  aria-label={`Stimme ${voiceName}`}
                  onClick={() => {
                    if (menuOpen) setMenuOpen(false);
                    else { placeMenu(); setMenuOpen(true); }
                  }}
                  className="inline-flex h-8 max-w-[5.5rem] shrink-0 items-center justify-center rounded-md px-1.5 text-[12px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {voiceName}
                </button>
                <TransportButton testId="button-podcast-back15" label="15 Sekunden zurück" onClick={() => onSeekTo(currentSec - 15)}>
                  <SecondsGlyph direction="back" />
                </TransportButton>
                <TransportButton testId="button-podcast-prev" label="Vorheriges Kapitel" onClick={() => onSkipChapter(-1)}>
                  <SkipBack className="h-4 w-4" />
                </TransportButton>
                <button
                  type="button"
                  data-testid={playing ? "button-podcast-pause" : "button-podcast-play"}
                  aria-label={playing ? copy.pause : copy.play}
                  onClick={onTogglePlay}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-white dark:text-black"
                >
                  {playing ? <PauseGlyph /> : <PlayGlyph className="h-4 w-4" />}
                </button>
                <TransportButton testId="button-podcast-next" label="Nächstes Kapitel" onClick={() => onSkipChapter(1)}>
                  <SkipForward className="h-4 w-4" />
                </TransportButton>
                <TransportButton testId="button-podcast-fwd15" label="15 Sekunden vor" onClick={() => onSeekTo(currentSec + 15)}>
                  <SecondsGlyph direction="forward" />
                </TransportButton>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{formatClock(currentSec)}</span>
                <div
                  data-testid="podcast-progress"
                  role="slider"
                  tabIndex={0}
                  aria-label="Fortschritt"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(totalSec)}
                  aria-valuenow={Math.round(currentSec)}
                  aria-valuetext={`${formatClock(currentSec)} von ${formatClock(totalSec)}`}
                  className="flex h-1.5 min-w-0 flex-1 gap-[3px]"
                  onClick={seekFromBar}
                >
                  {segments.map(({ chapter, fill }) => (
                    <div
                      key={chapter.id}
                      title={chapter.label}
                      className="relative h-full min-w-0 flex-1 overflow-hidden rounded-[2px] bg-muted-foreground/[0.28]"
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-foreground"
                        style={{ width: `${Math.min(100, Math.max(0, fill * 100))}%` }}
                      />
                      {chapter.id === activeChapterId ? <span className="sr-only">{chapter.label}</span> : null}
                    </div>
                  ))}
                </div>
                <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{formatClock(totalSec)}</span>
              </div>
            </div>
            <p data-testid="podcast-stand" className="text-[10px] text-muted-foreground">
              {formatStandLine(standAsOf || copy.missing, standPrice || copy.missing, source, voiceName, language)}
            </p>
            <details data-testid="podcast-transcript" className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">{copy.transcript}</summary>
              <div className="mt-2 space-y-2">
                {chapters.map((chapter) => (
                  <div key={chapter.id}>
                    <div className="font-semibold text-foreground">{chapter.label}</div>
                    <p className="whitespace-pre-wrap leading-relaxed text-foreground/85">{chapter.spoken}</p>
                  </div>
                ))}
              </div>
            </details>
            {(state === "playing" || state === "paused") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                data-testid="button-podcast-regenerate"
                disabled={limitedLanguages[language]}
                title={limitedLanguages[language] ? copy.limitTitle : undefined}
                onClick={onRegenerate}
              >
                {copy.regenerate}
              </Button>
            )}
          </div>
        )}
      </div>
      <audio ref={audioRef} preload="metadata" playsInline className="block h-0 w-0" />
      {menuOpen && typeof document !== "undefined"
        ? createPortal(
          <div ref={menuRef} id={menuId} className="z-[60]" style={{ position: "fixed", top: menuStyle.top, left: menuStyle.left }}>
            <PodcastVoiceMenu
              activeId={voiceId}
              voices={voices ?? voicesForLanguage(language)}
              onSelect={(id) => {
                setMenuOpen(false);
                onVoiceChange(id);
              }}
            />
          </div>,
          document.body,
        )
        : null}
    </div>
  );
}

export function PodcastPlayer({
  ticker,
  asOfLabel,
  priceLabel,
}: {
  ticker: string;
  asOfLabel: string;
  priceLabel: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const model = usePodcast({ ticker, asOfLabel, priceLabel, audioRef });
  return (
    <PodcastPlayerView
      ticker={ticker}
      audioRef={audioRef}
      source={model.source}
      voiceId={model.voiceId}
      state={model.state}
      stage={model.stage}
      error={model.error}
      chapters={model.chapters}
      activeChapterId={model.activeChapterId}
      currentSec={model.currentSec}
      totalSec={model.totalSec}
      speed={model.speed}
      standAsOf={model.standAsOf}
      standPrice={model.standPrice}
      onSourceChange={model.selectSource}
      onGenerate={model.generate}
      onRegenerate={model.regenerate}
      onRetry={model.retry}
      onTogglePlay={model.togglePlay}
      onSeekTo={model.seekTo}
      onSkipChapter={model.skipChapter}
      onSpeed={model.cycleSpeed}
      onVoiceChange={model.changeVoice}
      language={model.language}
      cachedLanguages={model.cachedLanguages}
      limitedLanguages={model.limitedLanguages}
      onLanguageChange={model.selectLanguage}
    />
  );
}
