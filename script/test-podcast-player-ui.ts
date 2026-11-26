/**
 * KI-Podcast-Player (PR B, UI). Vertrag aus Design-Spec v4 und #527 C6.
 * Kein Netz, kein OpenRouter, kein POST /api/analyze.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-podcast-player-ui.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OPENROUTER_NO_KEY_MESSAGE } from "../shared/openrouter-no-key";
import {
  PODCAST_DEFAULT_VOICE,
  PODCAST_KI_HINT,
  PODCAST_LLM_UNAVAILABLE,
  PODCAST_NO_KEY_DETAIL,
  PODCAST_SCRIPT_PATH,
  PODCAST_VOICES,
  PODCAST_EN_DEFAULT_VOICE,
  PODCAST_LANGUAGE_STORAGE_KEY,
  buildPodcastScriptRequest,
  mapVoiceAcrossLanguage,
  tickerIdleResetFields,
  podcastUiCopy,
  decideLanguageSwitch,
  defaultVoiceForLanguage,
  PODCAST_LIMIT_SCOPE,
  languagesMarkedByLimit,
  podcastScriptCacheKey,
  languageSegmentDisabled,
  readPodcastLanguage,
  voicesForLanguage,
  writePodcastLanguage,
  chapterSpans,
  clampSeek,
  classifyPodcastFailure,
  countsAgainstDailyLimit,
  estimateDurationSec,
  formatClock,
  formatPodcastAsOf,
  formatSpeedLabel,
  formatStandLine,
  nextSpeed,
  parsePodcastScript,
  podcastAudioPath,
  podcastIdleSubtitle,
  podcastLimitDetail,
  stageWhileScriptPending,
} from "../client/src/hooks/usePodcast";
import { PodcastPlayer, PodcastPlayerView, PodcastVoiceMenu } from "../client/src/components/PodcastPlayer";
import type { PodcastChapterView } from "../client/src/hooks/usePodcast";

(globalThis as { React?: typeof React }).React = React;

let failed = 0;
const check = (name: string, ok: boolean) => {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) failed += 1;
};

const noop = () => {};
const viewActions = {
  onSourceChange: noop,
  onGenerate: noop,
  onRegenerate: noop,
  onRetry: noop,
  onTogglePlay: noop,
  onSeekTo: noop,
  onSkipChapter: noop,
  onSpeed: noop,
  onVoiceChange: noop,
};

function orderOf(html: string, ids: string[]): boolean {
  let cursor = -1;
  for (const id of ids) {
    const at = html.indexOf(`data-testid="${id}"`);
    if (at < 0 || at < cursor) return false;
    cursor = at;
  }
  return true;
}

const request = buildPodcastScriptRequest({
  ticker: " NVDA ",
  source: "ki",
  voice: PODCAST_DEFAULT_VOICE,
  regenerate: false,
});
const renewed = buildPodcastScriptRequest({
  ticker: "NVDA",
  source: "pdf",
  voice: "browser",
  regenerate: true,
});
check("Quellen-Klick setzt regenerate false, language de und fullAi, ohne fresh",
  request.ticker === "NVDA" && request.source === "ki" && request.voice === "de-DE-Mia:MAI-Voice-2.1"
  && request.fullAi === true && request.regenerate === false && request.language === "de" && !("fresh" in request));
check("Englisch steht im Request und die Default-Stimme ist Harper",
  buildPodcastScriptRequest({ ticker: "NVDA", source: "ki", voice: PODCAST_EN_DEFAULT_VOICE, regenerate: false, language: "en" }).language === "en"
  && defaultVoiceForLanguage("en") === "en-US-Harper:MAI-Voice-2.1"
  && voicesForLanguage("en").some((voice) => voice.id === "en-US-Harper:MAI-Voice-2.1")
  && !voicesForLanguage("en").some((voice) => voice.id === "de-DE-Mia:MAI-Voice-2.1")
  && voicesForLanguage("de").some((voice) => voice.id === "de-DE-Mia:MAI-Voice-2.1"));
check("Neu erzeugen setzt regenerate true und schickt die Browser-Stimme nicht",
  renewed.regenerate === true && renewed.fullAi === true && !("voice" in renewed) && !("fresh" in renewed));
check("Request schickt keine Analyse mit", !("analysis" in request) && !("facts" in request));
check("Skript-Pfad ist POST /api/podcast/script", PODCAST_SCRIPT_PATH === "/api/podcast/script");
check("Audio-URL enthält ticker, source, voice und cacheKey",
  podcastAudioPath({
    chapterId: "s17",
    ticker: "NVDA",
    source: "ki",
    voice: "de-DE-Mia:MAI-Voice-2.1",
    cacheKey: "hash",
  }) === "/api/podcast/audio/s17?ticker=NVDA&source=ki&voice=de-DE-Mia%3AMAI-Voice-2.1&cacheKey=hash&language=de"
  && podcastAudioPath({
    chapterId: "s17",
    ticker: "NVDA",
    source: "ki",
    voice: "en-US-Harper:MAI-Voice-2.1",
    cacheKey: "hash",
    language: "en",
  }) === "/api/podcast/audio/s17?ticker=NVDA&source=ki&voice=en-US-Harper%3AMAI-Voice-2.1&cacheKey=hash&language=en");

const scriptBody = {
  ok: true,
  ticker: "NVDA",
  chapters: [
    { id: "s17", title: "S17", label: "Katalysatoren", template: "Kapitel {ticker}", spoken: "Die Katalysatoren liegen vor.", durationSec: 72, llmOwned: false, audioUrl: null },
    { id: "s10", title: "S10", label: "Inversion", template: "", spoken: "Die Inversion liegt nicht vor.", durationSec: 204, llmOwned: true, audioUrl: null },
  ],
  asOf: "2026-11-26T12:00:00.000Z",
  asOfLabel: "26.11.2026",
  cacheKey: "nvda-2026-11-26-ki",
  source: "ki",
  voice: "de-DE-Mia:MAI-Voice-2.1",
  voiceLabel: "Mia",
  priceLabel: "149,3",
  language: "de",
  cached: true,
  packCached: true,
  promptVersion: "stock-podcast-v4",
  disclaimer: "Dies ist keine Anlageberatung.",
};
const parsed = parsePodcastScript(scriptBody, "pdf");
check("Parser liest das Response-Shape von #529",
  parsed?.chapters.length === 2
  && parsed.chapters[0]?.label === "Katalysatoren"
  && parsed.chapters[1]?.llmOwned === true
  && parsed.asOf === "26.11.2026"
  && parsed.cacheKey === "nvda-2026-11-26-ki"
  && parsed.priceLabel === "149,3"
  && parsed.voiceLabel === "Mia"
  && parsed.source === "ki"
  && parsed.cached === true
  && parsed.packCached === true
  && parsed.language === "de");
check("ok false ist kein Skript", parsePodcastScript({ ok: false, errorCode: "LLM_UNAVAILABLE", chapters: scriptBody.chapters }, "ki") === null);
check("Cache- und Pack-Treffer zählen nicht gegen das Tageslimit",
  countsAgainstDailyLimit({ cached: true, packCached: false }) === false
  && countsAgainstDailyLimit({ cached: false, packCached: true }) === false
  && countsAgainstDailyLimit({ cached: false, packCached: false }) === true);
check("Fehlende Dauer kommt aus 140 Wörtern je Minute", estimateDurationSec(new Array(140).fill("Wort").join(" ")) === 60 && estimateDurationSec("") === 1);
check("Parser ohne Kapitel ist kein Skript", parsePodcastScript({ chapters: [], asOf: "2026-11-26" }, "ki") === null);
check("Ziffer im Kapiteltext ist Sache des Server-Validators, der Client zeigt spoken",
  parsed?.chapters[1]?.spoken === "Die Inversion liegt nicht vor.");

check("429 ist das Tageslimit", classifyPodcastFailure(429, { errorCode: "RATE_LIMITED" })?.kind === "limit");
check("RATE_LIMITED ohne 429 bleibt das Tageslimit", classifyPodcastFailure(200, { errorCode: "RATE_LIMITED", chapters: [] })?.kind === "limit");
check("Fehlender Key nutzt OPENROUTER_NO_KEY_MESSAGE",
  classifyPodcastFailure(503, { errorCode: "NO_API_KEY", error: OPENROUTER_NO_KEY_MESSAGE })?.kind === "no_key"
  && OPENROUTER_NO_KEY_MESSAGE === "KI nicht verfügbar: Auf diesem Server ist kein OpenRouter-Key konfiguriert. Es wird keine Antwort erzeugt.");
check("402 ist LLM nicht erreichbar", classifyPodcastFailure(402, { error: "payment" })?.kind === "llm");
check("errorCode LLM_UNAVAILABLE", classifyPodcastFailure(500, { errorCode: "LLM_UNAVAILABLE" })?.kind === "llm");

check("Geschwindigkeit läuft 0,75 → 1 → 1,25 → 1,5 → 2 → 0,75",
  nextSpeed(0.75) === 1 && nextSpeed(1) === 1.25 && nextSpeed(1.25) === 1.5 && nextSpeed(1.5) === 2 && nextSpeed(2) === 0.75);
check("Speed-Label mit Komma", formatSpeedLabel(1) === "1×" && formatSpeedLabel(0.75) === "0,75×" && formatSpeedLabel(1.5) === "1,5×");
check("Uhr 1:12 und 4:36", formatClock(72) === "1:12" && formatClock(276) === "4:36" && formatClock(-4) === "0:00");
check("Seek bleibt im Kapitelbereich", clampSeek(-10, 100) === 0 && clampSeek(140, 100) === 100 && clampSeek(15, 100) === 15);
check("Kapitelspannen", JSON.stringify(chapterSpans([{ id: "a", durationSec: 72 }, { id: "b", durationSec: 204 }])) === JSON.stringify([{ id: "a", start: 0, end: 72 }, { id: "b", start: 72, end: 276 }]));
check("Stand-Zeile", formatStandLine("26.11.2026", "149,3", "pdf", "Eve") === "Stand 26.11.2026, Kurs 149,3 · PDF-basiert · Stimme Eve");
check("Datum ohne Zeitzone bleibt der Kalendertag, Mitternacht Madrid springt",
  formatPodcastAsOf("2026-11-26") === "26.11.2026" && formatPodcastAsOf("2026-11-26T23:30:00.000Z") === "27.11.2026");
check("Idle-Unterzeile nennt Quelle und Ticker", podcastIdleSubtitle("ki", "NVDA") === "Nur auf Klick · frische Analyse · KI-Analyse · NVDA");
check("Limit-Unterzeile je Ticker nennt nicht die andere Sprache",
  PODCAST_LIMIT_SCOPE === "ticker"
  && podcastLimitDetail("NVDA", "de", "ticker") === "Für NVDA heute nicht mehr verfügbar. Cache-Treffer bleiben abspielbar."
  && podcastLimitDetail("NVDA", "en", "ticker") === "Not available again today for NVDA. Cached episodes stay playable."
  && !podcastLimitDetail("NVDA", "de", "ticker").includes("andere Sprache")
  && !podcastLimitDetail("NVDA", "en", "ticker").toLowerCase().includes("other language"));
check("Limit je Sprache nennt die andere Sprache und den Cache",
  podcastLimitDetail("NVDA", "de", "ticker-language") === "Für NVDA ist diese Sprache heute nicht mehr verfügbar. Die andere Sprache und Cache-Treffer bleiben nutzbar."
  && podcastLimitDetail("NVDA", "en", "ticker-language") === "This language is not available again today for NVDA. The other language and cached episodes stay playable.");
check("429 markiert bei ticker beide Sprachen, bei ticker-language nur eine",
  languagesMarkedByLimit("ticker", "de").join(",") === "de,en"
  && languagesMarkedByLimit("ticker", "en").join(",") === "de,en"
  && languagesMarkedByLimit("ticker-language", "en").join(",") === "en");
check("Slot-Key trägt die Stimme",
  podcastScriptCacheKey("NVDA", "ki", "en", "en-US-Harper:MAI-Voice-2.1")
    !== podcastScriptCacheKey("NVDA", "ki", "en", "en-US-Grant:MAI-Voice-2.1"));
check("Stufe analyze, danach script", stageWhileScriptPending(1_000) === "analyze" && stageWhileScriptPending(45_000) === "script");
check("Default-Stimme ist Mia, Reihenfolge OpenRouter dann xAI dann Browser",
  PODCAST_DEFAULT_VOICE === "de-DE-Mia:MAI-Voice-2.1"
  && PODCAST_VOICES.map((voice) => voice.slug).join(",") === "mia,klaus,harper,grant,eve,leo,ara,browser");

let fetches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetches += 1;
  return new Response("{}", { status: 500, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const idle = renderToStaticMarkup(React.createElement(PodcastPlayer, {
  ticker: "NVDA",
  asOfLabel: "26.11.2026",
  priceLabel: "149,3",
}));
check("Rendern ruft nicht /api/analyze und keinen Fetch auf", fetches === 0);
globalThis.fetch = originalFetch;
check("Idle: Quellen, Default KI-Analyse, grüner Play, Hinweis",
  idle.includes('data-testid="podcast-source"')
  && idle.includes('data-testid="button-podcast-source-pdf"')
  && idle.includes('data-testid="button-podcast-source-ki"')
  && idle.includes('aria-checked="true"')
  && idle.includes("KI-Analyse")
  && idle.includes('data-testid="button-podcast-generate"')
  && idle.includes('aria-label="KI-Podcast für NVDA erzeugen"')
  && idle.includes("KI-Podcast erzeugen")
  && idle.includes("Nur auf Klick · frische Analyse · KI-Analyse · NVDA")
  && idle.includes('data-testid="podcast-ki-hint"')
  && idle.includes(PODCAST_KI_HINT)
  && idle.includes("#1ED760")
  && idle.includes('data-html2canvas-ignore')
  && idle.includes("min-w-[min(100%,18.5rem)]"));
check("Sprachschalter DE | EN, Default DE",
  idle.includes('data-testid="podcast-language"')
  && idle.includes('data-testid="button-podcast-lang-de"')
  && idle.includes('data-testid="button-podcast-lang-en"')
  && idle.includes('aria-label="Sprache Deutsch"')
  && idle.includes("min-h-11")
  && idle.includes("flex flex-wrap items-center gap-x-4 gap-y-2.5")
  && !idle.includes("min-[376px]"));
check("Idle ohne Extra-Icons und ohne Leisten-Controls",
  !idle.includes('data-testid="button-podcast-play"')
  && !idle.includes("Download")
  && !idle.includes('data-testid="podcast-stand"'));

const loading = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
  ticker: "NVDA",
  source: "ki",
  voiceId: PODCAST_DEFAULT_VOICE,
  state: "loading",
  stage: "script",
  error: null,
  chapters: [],
  activeChapterId: null,
  currentSec: 0,
  totalSec: 0,
  speed: 1,
  standAsOf: "",
  standPrice: "",
  ...viewActions,
}));
check("Loading zeigt drei Stufen, aktiv ist das Transkript",
  loading.includes('data-testid="podcast-loading-steps"')
  && loading.includes('data-testid="podcast-loading-step-analyze"')
  && loading.includes('data-testid="podcast-loading-step-script"')
  && loading.includes('data-testid="podcast-loading-step-audio"')
  && loading.includes("Analyse läuft …")
  && loading.includes("Transkript entsteht …")
  && loading.includes("Audio wird erzeugt …")
  && loading.includes("OpenRouter interpretiert die Analyse")
  && loading.includes("font-bold text-[#1ED760]")
  && loading.indexOf("podcast-loading-step-script") < loading.indexOf("font-bold"));

const chapters: PodcastChapterView[] = [
  { id: "s17", label: "Katalysatoren", spoken: "Katalysator-Text.", durationSec: 72, audioUrl: null, src: null },
  { id: "s13", label: "Moat / Porter", spoken: "Porter-Text.", durationSec: 100, audioUrl: null, src: null },
  { id: "s14", label: "PESTEL", spoken: "PESTEL-Text.", durationSec: 104, audioUrl: null, src: null },
];
const playing = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
  ticker: "NVDA",
  source: "ki",
  voiceId: "de-DE-Klaus:MAI-Voice-2.1",
  state: "playing",
  stage: "audio",
  error: null,
  chapters,
  activeChapterId: "s17",
  currentSec: 72,
  totalSec: 276,
  speed: 1,
  standAsOf: "26.11.2026",
  standPrice: "149,3",
  ...viewActions,
}));
check("Leiste: Speed, Stimme, −15, Kapitel zurück, Pause, Kapitel vor, +15",
  orderOf(playing, [
    "button-podcast-speed",
    "button-podcast-voice",
    "button-podcast-back15",
    "button-podcast-prev",
    "button-podcast-pause",
    "button-podcast-next",
    "button-podcast-fwd15",
  ]));
check("Playing: Zeiten, Balken, Stand, Transkript, Neu erzeugen, Light/Dark-Play",
  playing.includes(">1:12<")
  && playing.includes(">4:36<")
  && playing.includes('data-testid="podcast-progress"')
  && playing.includes('role="slider"')
  && playing.includes('aria-valuetext="1:12 von 4:36"')
  && playing.includes('title="Katalysatoren"')
  && playing.includes('title="Moat / Porter"')
  && playing.includes("gap-[3px]")
  && playing.includes("bg-muted/[0.45]")
  && playing.includes("rounded-[10px]")
  && playing.includes('data-testid="podcast-stand"')
  && playing.includes("Stand 26.11.2026, Kurs 149,3 · KI-Analyse · Stimme Klaus")
  && playing.includes('data-testid="podcast-transcript"')
  && playing.includes("Transkript anzeigen")
  && playing.includes("Katalysator-Text.")
  && playing.includes('data-testid="button-podcast-regenerate"')
  && playing.includes("Neu erzeugen")
  && playing.includes("bg-black text-white")
  && playing.includes("dark:bg-white dark:text-black")
  && playing.includes('aria-label="Geschwindigkeit 1×, ändern"')
  && playing.includes('aria-haspopup="listbox"')
  && playing.includes("<audio"));
check("Paused zeigt Play statt Pause", (() => {
  const paused = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
    ticker: "MSFT",
    source: "pdf",
    voiceId: PODCAST_DEFAULT_VOICE,
    state: "paused",
    stage: "audio",
    error: null,
    chapters: chapters.slice(0, 1),
    activeChapterId: "s17",
    currentSec: 10,
    totalSec: 72,
    speed: 1.25,
    standAsOf: "26.11.2026",
    standPrice: "489,93",
    ...viewActions,
  }));
  return paused.includes('data-testid="button-podcast-play"')
    && !paused.includes('data-testid="button-podcast-pause"')
    && paused.includes("Stand 26.11.2026, Kurs 489,93 · PDF-basiert · Stimme Mia")
    && paused.includes('aria-label="Geschwindigkeit 1,25×, ändern"');
})());

const noKey = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
  ticker: "NVDA",
  source: "ki",
  voiceId: PODCAST_DEFAULT_VOICE,
  state: "error",
  stage: "analyze",
  error: { kind: "no_key" },
  chapters: [],
  activeChapterId: null,
  currentSec: 0,
  totalSec: 0,
  speed: 1,
  standAsOf: "",
  standPrice: "",
  ...viewActions,
}));
check("Fehler ohne Key zeigt den OpenRouter-Satz und Erneut versuchen",
  noKey.includes('data-testid="podcast-error"')
  && noKey.includes("border-destructive/40")
  && noKey.includes(OPENROUTER_NO_KEY_MESSAGE)
  && noKey.includes(PODCAST_NO_KEY_DETAIL)
  && noKey.includes('data-testid="button-podcast-retry"')
  && noKey.includes("Erneut versuchen")
  && !noKey.includes("ANTHROPIC_API_KEY"));

const llm = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
  ticker: "NVDA",
  source: "pdf",
  voiceId: PODCAST_DEFAULT_VOICE,
  state: "error",
  stage: "script",
  error: { kind: "llm" },
  chapters: [],
  activeChapterId: null,
  currentSec: 0,
  totalSec: 0,
  speed: 1,
  standAsOf: "",
  standPrice: "",
  ...viewActions,
}));
check("LLM-Fehler", llm.includes(PODCAST_LLM_UNAVAILABLE) && PODCAST_LLM_UNAVAILABLE === "KI-Podcast n/a — LLM nicht erreichbar.");

const limit = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
  ticker: "NVDA",
  source: "ki",
  voiceId: PODCAST_DEFAULT_VOICE,
  state: "limit",
  stage: "analyze",
  error: { kind: "limit" },
  chapters,
  activeChapterId: "s17",
  currentSec: 0,
  totalSec: 276,
  speed: 1,
  standAsOf: "26.11.2026",
  standPrice: "149,3",
  ...viewActions,
}));
check("Tageslimit bleibt abspielbar, wenn ein Skript da ist",
  limit.includes('data-testid="podcast-rate-limit"')
  && limit.includes("Tageslimit erreicht.")
  && limit.includes("Für NVDA heute nicht mehr verfügbar. Cache-Treffer bleiben abspielbar.")
  && limit.includes('data-testid="button-podcast-play"')
  && !limit.includes('data-testid="button-podcast-regenerate"'));

const menu = renderToStaticMarkup(React.createElement(PodcastVoiceMenu, { activeId: PODCAST_DEFAULT_VOICE, onSelect: noop }));
check("Stimmen-Menü: Mia zuerst, dann xAI, zuletzt Browser",
  menu.includes('data-testid="podcast-voice-menu"')
  && orderOf(menu, [
    "option-podcast-voice-mia",
    "option-podcast-voice-klaus",
    "option-podcast-voice-harper",
    "option-podcast-voice-grant",
    "option-podcast-voice-eve",
    "option-podcast-voice-leo",
    "option-podcast-voice-ara",
    "option-podcast-voice-browser",
  ])
  && menu.includes('aria-selected="true"'));

const card = readFileSync("client/src/components/ExecSummaryCard.tsx", "utf8");
const wrapAt = card.indexOf('data-testid="podcast-headline-wrap"');
const ampelAt = card.indexOf('data-testid="exec-summary-ampel"');
const modeAt = card.indexOf('data-testid="exec-summary-mode"');
const slot = card.slice(card.lastIndexOf("<div", wrapAt), modeAt);
check("Karte: Ampel, dann Wrapper, dann Hinweis", ampelAt > 0 && wrapAt > ampelAt && modeAt > wrapAt);
check("Wrapper ist Flex-Wrap ohne Breakpoint, Headline ohne truncate",
  slot.includes('className="flex flex-wrap items-center gap-x-4 gap-y-2.5"')
  && slot.includes("min-w-0 max-w-full w-fit break-words")
  && slot.includes('data-testid="exec-summary-headline"')
  && !slot.includes("truncate")
  && !slot.includes("whitespace-nowrap")
  && !/sm:|md:|lg:/.test(slot));
check("Ampel-Zeile bleibt justify-between und ist nicht der Player",
  card.includes("justify-between") && card.slice(card.indexOf("justify-between"), wrapAt).includes("exec-summary-ampel"));

const hookSrc = readFileSync("client/src/hooks/usePodcast.ts", "utf8");
const selectAt = hookSrc.indexOf("const selectSource");
check("Hook startet nicht /api/analyze und nicht den Markt-Podcast",
  !hookSrc.includes("/api/analyze") && !hookSrc.includes("/api/podcast/brief") && hookSrc.includes('"/api/podcast/script"'));
check("Klick auf eine Quelle startet den Lauf mit regenerate false", selectAt > 0 && hookSrc.slice(selectAt, selectAt + 180).includes("run(next, false)"));
check("Neu erzeugen ruft den Lauf mit regenerate true auf", hookSrc.includes("void run(sourceRef.current, true)"));
check("Hook schickt kein fresh-Feld", !hookSrc.includes("fresh:"));
check("Sprachwechsel ruft keinen Lauf auf", (() => {
  const start = hookSrc.indexOf("const selectLanguage");
  const end = hookSrc.indexOf("const generate", start);
  return start > 0 && end > start && !hookSrc.slice(start, end).includes("run(");
})());
{
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
  };
  check("Sprache fehlt → Default DE", readPodcastLanguage(storage) === "de" && PODCAST_LANGUAGE_STORAGE_KEY === "aktienanalyst.podcast.language");
  writePodcastLanguage(storage, "en");
  check("Sprache bleibt in aktienanalyst.podcast.language", readPodcastLanguage(storage) === "en" && memory.get(PODCAST_LANGUAGE_STORAGE_KEY) === "en");
  writePodcastLanguage(storage, "de");
  check("Ungültiger Speicherwert fällt auf DE", readPodcastLanguage({ getItem: () => "fr" }) === "de");
}
check("Wechsel ohne Cache bleibt Idle, mit Cache wird gespielt", decideLanguageSwitch(false) === "idle" && decideLanguageSwitch(true) === "play");
check("Harper und Grant wechseln die Locale, xAI und Browser bleiben, Mia wird die Default-Stimme",
  mapVoiceAcrossLanguage("de-DE-Grant:MAI-Voice-2.1", "en") === "en-US-Grant:MAI-Voice-2.1"
  && mapVoiceAcrossLanguage("en-US-Grant:MAI-Voice-2.1", "de") === "de-DE-Grant:MAI-Voice-2.1"
  && mapVoiceAcrossLanguage("de-DE-Harper:MAI-Voice-2.1", "en") === "en-US-Harper:MAI-Voice-2.1"
  && mapVoiceAcrossLanguage("en-US-Harper:MAI-Voice-2.1", "de") === "de-DE-Harper:MAI-Voice-2.1"
  && mapVoiceAcrossLanguage("eve", "en") === "eve"
  && mapVoiceAcrossLanguage("browser", "de") === "browser"
  && mapVoiceAcrossLanguage("de-DE-Mia:MAI-Voice-2.1", "en") === "en-US-Harper:MAI-Voice-2.1"
  && mapVoiceAcrossLanguage("de-DE-Klaus:MAI-Voice-2.1", "en") === "en-US-Harper:MAI-Voice-2.1");
{
  const after = tickerIdleResetFields({ asOf: "02.02.2026", price: "20" });
  check("Ticker-Wechsel A→B ohne Cache setzt Stand, Cache-Key und Stufe auf B",
    after.standAsOf === "02.02.2026"
    && after.standPrice === "20"
    && after.cacheKey === ""
    && after.stage === "analyze"
    && after.activeChapterId === null);
}
check("Der Hook-Reset ruft dieselben Felder auf", (() => {
  const start = hookSrc.indexOf("const resetForTicker");
  const body = hookSrc.slice(start, start + 600);
  const idle = hookSrc.indexOf("resetForTicker();");
  return start > 0 && body.includes("tickerIdleResetFields") && idle > start;
})());
check("429 bleibt das Limit, auch wenn der Text nach einem LLM-Fehler aussieht",
  classifyPodcastFailure(429, { ok: false, errorCode: "LLM_UNAVAILABLE", error: "KI-Podcast n/a — LLM nicht erreichbar.", stage: "script" })?.kind === "limit");
check("Tageslimit sperrt nur die Sprache ohne Cache",
  languageSegmentDisabled({ limited: true, hasCache: false, loading: false }) === true
  && languageSegmentDisabled({ limited: true, hasCache: true, loading: false }) === false
  && languageSegmentDisabled({ limited: false, hasCache: false, loading: false }) === false
  && languageSegmentDisabled({ limited: true, hasCache: true, loading: true }) === true);
check("Mount ruft run( nicht auf", !/useEffect\(\(\) => \{\s*void run\(/.test(hookSrc));

const dashboard = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
const pdfExport = readFileSync("server/pdf-export.ts", "utf8");
const exportPdf = readFileSync("client/src/lib/exportPdf.ts", "utf8");
check("Player hängt nur an der Executive Summary", !dashboard.includes("PodcastPlayer") && !pdfExport.includes("PodcastPlayer") && !exportPdf.includes("ignoreElements"));
const english = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
  ticker: "NVDA",
  source: "ki",
  voiceId: "en-US-Harper:MAI-Voice-2.1",
  state: "paused",
  stage: "audio",
  error: null,
  chapters: [{ id: "s17", label: "Catalysts", spoken: "The catalyst is verified.", durationSec: 40, audioUrl: null, src: null }],
  activeChapterId: "s17",
  currentSec: 4,
  totalSec: 40,
  speed: 1,
  standAsOf: "26.11.2026",
  standPrice: "149.3",
  language: "en",
  ...viewActions,
}));
const enCopy = podcastUiCopy("en");
check("EN-Player übersetzt die Leiste, der Kapiteltitel bleibt die Response",
  english.includes(enCopy.regenerate)
  && english.includes(enCopy.transcript)
  && english.includes("As of 26.11.2026, price 149.3 · KI-Analyse · Voice Harper")
  && english.includes("Catalysts")
  && english.includes("PDF-basiert")
  && !english.includes("Neu erzeugen")
  && !english.includes("Transkript anzeigen"));
const englishLimit = renderToStaticMarkup(React.createElement(PodcastPlayerView, {
  ticker: "NVDA",
  source: "ki",
  voiceId: "en-US-Harper:MAI-Voice-2.1",
  state: "limit",
  stage: "analyze",
  error: { kind: "limit" },
  chapters: [],
  activeChapterId: null,
  currentSec: 0,
  totalSec: 0,
  speed: 1,
  standAsOf: "",
  standPrice: "",
  language: "en",
  limitedLanguages: { de: false, en: true },
  ...viewActions,
}));
check("EN-Limit zeigt den Limit-Zustand ohne Retry",
  englishLimit.includes("Daily limit reached.")
  && !englishLimit.includes('data-testid="button-podcast-retry"')
  && !englishLimit.includes('data-testid="podcast-error"'));

assert.equal(failed, 0, `${failed} Prüfungen fehlgeschlagen`);
console.log(`\n${failed === 0 ? "Alle Prüfungen grün." : failed + " fehlgeschlagen."}`);
