/**
 * Browser-Stimme für vorhandenen Podcast-Text.
 * Keine Audiodatei, kein Server-TTS, keine neue Stimme: die Web Speech API
 * des Browsers liest den Text, der schon aus der Pipeline oder dem Cache kommt.
 */

export type BrowserSpeechPhase = "idle" | "loading" | "playing" | "paused" | "aborted" | "error" | "n/a";

export interface BrowserSpeechState {
  phase: BrowserSpeechPhase;
  detail: string;
  activeId: string | null;
  sentenceIndex: number;
  sentenceCount: number;
}

export interface BrowserSpeechHandlers {
  onstart: () => void;
  onend: () => void;
  onerror: (message: string) => void;
}

export interface BrowserSpeechEngine {
  supported: boolean;
  speak(text: string, handlers: BrowserSpeechHandlers): void;
  cancel(): void;
  pause?(): void;
  resume?(): void;
}

/** Eine Stimme im Browser. Nur die Instanz, die sie besitzt, darf sie stoppen. */
let speaker: { id: number; preempt: () => void } | null = null;
let nextSessionId = 0;

export interface PodcastSpeechSource {
  sourceId: string;
  text: string | null;
  /** Bleibt null. audioUrl aus der API wird nicht abgespielt und nicht erfunden. */
  audioSrc: null;
  fileDetail: string;
}

const EMPTY: BrowserSpeechState = {
  phase: "n/a",
  detail: "n/a — kein Text zum Vorlesen",
  activeId: null,
  sentenceIndex: 0,
  sentenceCount: 0,
};

const ABBREV = /(?:^|\s)(?:Mrd|Mio|Tsd|Nr|Dr|Prof|ca|bzw|vgl|z\.\s?B|u\.\s?a|d\.\s?h|inkl|exkl|Inc|Corp|Co|Ltd|St|Jan|Feb|Mär|Apr|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez|U\.S)\.$/;
const ORDINAL_ONLY = /^\d{1,2}\.$/;
const ORDINAL_DAY_END = /(?:^|\s)\d{1,2}\.$/;
const MONTH_START = /^(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\b/;

function splitBlock(block: string): string[] {
  const clean = block.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?…])\s+(?=["„»(A-ZÄÖÜ0-9])/).map(part => part.trim()).filter(Boolean);
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    const ordinal = prev != null && (ORDINAL_ONLY.test(prev) || (ORDINAL_DAY_END.test(prev) && MONTH_START.test(part)));
    if (prev && (ABBREV.test(prev) || ordinal)) merged[merged.length - 1] = `${prev} ${part}`;
    else merged.push(part);
  }
  return merged;
}

/** Satzgrenzen für Abbruch und Wiederholung. Der Wortlaut bleibt unverändert. */
export function splitSpeechSentences(text: string): string[] {
  const sentences: string[] = [];
  for (const block of text.split(/\n\s*\n/)) sentences.push(...splitBlock(block));
  return sentences;
}

export function playbackIdForSymbols(symbols: string[]): string {
  return symbols.length ? symbols.join(",") : "researcher";
}

export function podcastRunStillCurrent(started: number, current: number): boolean {
  return started === current;
}

/**
 * Text aus der bestehenden Brief-Antwort. Eine mitgelieferte audioUrl wird verworfen.
 */
export function speechSourceFromBrief(
  sourceId: string,
  body: {
    script?: { spokenScript?: unknown } | null;
    audio?: { reason?: unknown; audioUrl?: unknown; status?: unknown } | null;
  } | null,
): PodcastSpeechSource {
  const spoken = typeof body?.script?.spokenScript === "string" ? body.script.spokenScript.trim() : "";
  const reason = typeof body?.audio?.reason === "string" && body.audio.reason.trim()
    ? body.audio.reason.trim()
    : "n/a — keine Audiodatei";
  return {
    sourceId,
    text: spoken || null,
    audioSrc: null,
    fileDetail: spoken ? reason : "n/a — kein Text zum Vorlesen",
  };
}

export function browserSpeechEngine(): BrowserSpeechEngine {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  return {
    supported,
    speak(text, handlers) {
      if (!supported) {
        handlers.onerror("dieser Browser hat keine Web Speech API");
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "de-DE";
      utterance.onstart = () => handlers.onstart();
      utterance.onend = () => handlers.onend();
      utterance.onerror = (event) => {
        handlers.onerror(event.error || "Wiedergabe fehlgeschlagen");
      };
      window.speechSynthesis.speak(utterance);
    },
    cancel() {
      if (supported) window.speechSynthesis.cancel();
    },
    pause() {
      if (supported) window.speechSynthesis.pause();
    },
    resume() {
      if (supported) window.speechSynthesis.resume();
    },
  };
}

export interface BrowserSpeechSession {
  getState(): BrowserSpeechState;
  subscribe(listener: (state: BrowserSpeechState) => void): () => void;
  setSource(id: string, text: string | null, pending?: boolean): void;
  play(): void;
  pause(): void;
  resume(): void;
  abort(): void;
  replay(): void;
  release(): void;
}

export function createBrowserSpeechSession(engine: BrowserSpeechEngine): BrowserSpeechSession {
  const sessionId = ++nextSessionId;
  let generation = 0;
  let state = EMPTY;
  let sentences: string[] = [];
  let currentId: string | null = null;
  let currentText: string | null = null;
  let currentPending = false;
  const listeners = new Set<(next: BrowserSpeechState) => void>();

  function emit(): void {
    listeners.forEach(listener => listener(state));
  }

  function isSpeaker(): boolean {
    return speaker?.id === sessionId;
  }

  function dropSpeaker(): void {
    if (speaker?.id === sessionId) speaker = null;
  }

  function stopped(): void {
    state = { ...state, phase: "aborted", detail: "Wiedergabe abgebrochen", sentenceIndex: 0 };
    emit();
  }

  function preempt(): void {
    dropSpeaker();
    generation += 1;
    if (state.phase === "playing" || state.phase === "loading" || state.phase === "paused") stopped();
  }

  function claim(): void {
    if (speaker && speaker.id !== sessionId) speaker.preempt();
    speaker = { id: sessionId, preempt };
  }

  function stopIfSpeaker(): void {
    if (!isSpeaker()) return;
    dropSpeaker();
    engine.cancel();
  }

  function speakAt(index: number, gen: number): void {
    if (gen !== generation) return;
    const line = sentences[index];
    if (!line) {
      dropSpeaker();
      state = { ...state, phase: "idle", detail: "Wiedergabe beendet", sentenceIndex: 0 };
      emit();
      return;
    }
    engine.speak(line, {
      onstart: () => {
        if (gen !== generation) return;
        state = { ...state, phase: "playing", detail: "Browser-Stimme läuft", sentenceIndex: index };
        emit();
      },
      onend: () => {
        if (gen !== generation) return;
        speakAt(index + 1, gen);
      },
      onerror: (message) => {
        if (gen !== generation) return;
        generation += 1;
        dropSpeaker();
        if (message === "interrupted" || message === "canceled") {
          stopped();
          return;
        }
        engine.cancel();
        state = { ...state, phase: "error", detail: `n/a — ${message}`, sentenceIndex: index };
        emit();
      },
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setSource(id, text, pending = false) {
      const speakable = typeof text === "string" && text.trim() ? text.trim() : null;
      if (currentId === id && currentText === speakable && currentPending === pending) return;
      currentId = id;
      currentText = speakable;
      currentPending = pending;
      generation += 1;
      stopIfSpeaker();
      if (pending) {
        sentences = [];
        state = { phase: "loading", detail: "Text wird gelesen …", activeId: id, sentenceIndex: 0, sentenceCount: 0 };
      } else if (!speakable) {
        sentences = [];
        state = { phase: "n/a", detail: "n/a — kein Text zum Vorlesen", activeId: id, sentenceIndex: 0, sentenceCount: 0 };
      } else {
        sentences = splitSpeechSentences(speakable);
        state = {
          phase: sentences.length ? "idle" : "n/a",
          detail: sentences.length ? "Browser-Stimme bereit" : "n/a — kein Text zum Vorlesen",
          activeId: id,
          sentenceIndex: 0,
          sentenceCount: sentences.length,
        };
      }
      emit();
    },
    play() {
      if (sentences.length === 0) {
        if (state.phase !== "loading") {
          state = { ...state, phase: "n/a", detail: "n/a — kein Text zum Vorlesen", sentenceIndex: 0, sentenceCount: 0 };
          emit();
        }
        return;
      }
      if (!engine.supported) {
        state = { ...state, phase: "error", detail: "n/a — dieser Browser hat keine Web Speech API" };
        emit();
        return;
      }
      const gen = ++generation;
      claim();
      engine.cancel();
      state = { ...state, phase: "loading", detail: "Browser-Stimme startet …", sentenceIndex: 0 };
      emit();
      speakAt(0, gen);
    },
    pause() {
      if (!isSpeaker() || state.phase !== "playing") return;
      engine.pause?.();
      state = { ...state, phase: "paused", detail: "Browser-Stimme pausiert" };
      emit();
    },
    resume() {
      if (!isSpeaker() || state.phase !== "paused") return;
      engine.resume?.();
      state = { ...state, phase: "playing", detail: "Browser-Stimme läuft" };
      emit();
    },
    abort() {
      generation += 1;
      stopIfSpeaker();
      if (sentences.length === 0 && state.phase !== "loading") {
        emit();
        return;
      }
      stopped();
    },
    replay() {
      this.play();
    },
    release() {
      generation += 1;
      stopIfSpeaker();
      if (state.phase === "playing" || state.phase === "loading" || state.phase === "paused") stopped();
    },
  };
}
