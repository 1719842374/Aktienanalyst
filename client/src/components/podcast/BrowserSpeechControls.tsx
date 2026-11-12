import { useEffect, useRef, useState } from "react";
import {
  browserSpeechEngine,
  createBrowserSpeechSession,
  type BrowserSpeechPhase,
  type BrowserSpeechSession,
  type BrowserSpeechState,
} from "@/lib/podcast-browser-speech";

function canAbort(phase: BrowserSpeechPhase): boolean {
  switch (phase) {
    case "loading":
    case "playing":
    case "paused":
      return true;
    case "idle":
    case "aborted":
    case "error":
    case "n/a":
      return false;
    default: {
      const unexpected: never = phase;
      return unexpected;
    }
  }
}

function canStart(phase: BrowserSpeechPhase, sentenceCount: number): boolean {
  if (sentenceCount === 0) return false;
  switch (phase) {
    case "idle":
    case "aborted":
    case "error":
      return true;
    case "loading":
    case "playing":
    case "paused":
    case "n/a":
      return false;
    default: {
      const unexpected: never = phase;
      return unexpected;
    }
  }
}

function canReplay(phase: BrowserSpeechPhase, sentenceCount: number): boolean {
  if (sentenceCount === 0) return false;
  switch (phase) {
    case "idle":
    case "playing":
    case "paused":
    case "aborted":
    case "error":
      return true;
    case "loading":
    case "n/a":
      return false;
    default: {
      const unexpected: never = phase;
      return unexpected;
    }
  }
}

/**
 * Vorlesen, Abbruch und erneute Wiedergabe über die Browser-Stimme.
 * Kein audio-Element und keine Server-Datei.
 */
export function BrowserSpeechControls({
  sourceId,
  text,
  pending = false,
}: {
  sourceId: string;
  text: string | null;
  pending?: boolean;
}) {
  const sessionRef = useRef<BrowserSpeechSession | null>(null);
  if (sessionRef.current == null) {
    sessionRef.current = createBrowserSpeechSession(browserSpeechEngine());
    sessionRef.current.setSource(sourceId, text, pending);
  }
  const [state, setState] = useState<BrowserSpeechState>(() => sessionRef.current!.getState());

  useEffect(() => () => {
    sessionRef.current?.release();
  }, []);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    const unsubscribe = session.subscribe(setState);
    session.setSource(sourceId, text, pending);
    return unsubscribe;
  }, [sourceId, text, pending]);

  const startEnabled = canStart(state.phase, state.sentenceCount);
  const replayEnabled = canReplay(state.phase, state.sentenceCount);
  const abortEnabled = canAbort(state.phase);
  const pauseEnabled = state.phase === "playing";
  const resumeEnabled = state.phase === "paused";

  return (
    <div data-testid="podcast-browser-speech" className="space-y-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2 min-w-0">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border">
          KI-generiert im Research-Stil
        </span>
        <span className="text-[11px] text-foreground break-words" data-testid="podcast-browser-status">
          {state.detail}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="podcast-browser-play"
          disabled={!startEnabled}
          onClick={() => sessionRef.current?.play()}
          className="h-8 px-2 rounded-md border border-border text-[11px] text-foreground hover:bg-foreground/10 disabled:opacity-40"
        >
          Vorlesen
        </button>
        <button
          type="button"
          data-testid="podcast-browser-pause"
          disabled={!pauseEnabled}
          onClick={() => sessionRef.current?.pause()}
          className="h-8 px-2 rounded-md border border-border text-[11px] text-foreground hover:bg-foreground/10 disabled:opacity-40"
        >
          Pause
        </button>
        <button
          type="button"
          data-testid="podcast-browser-resume"
          disabled={!resumeEnabled}
          onClick={() => sessionRef.current?.resume()}
          className="h-8 px-2 rounded-md border border-border text-[11px] text-foreground hover:bg-foreground/10 disabled:opacity-40"
        >
          Weiter
        </button>
        <button
          type="button"
          data-testid="podcast-browser-abort"
          disabled={!abortEnabled}
          onClick={() => sessionRef.current?.abort()}
          className="h-8 px-2 rounded-md border border-border text-[11px] text-foreground hover:bg-foreground/10 disabled:opacity-40"
        >
          Abbrechen
        </button>
        <button
          type="button"
          data-testid="podcast-browser-replay"
          disabled={!replayEnabled}
          onClick={() => sessionRef.current?.replay()}
          className="h-8 px-2 rounded-md border border-border text-[11px] text-foreground hover:bg-foreground/10 disabled:opacity-40"
        >
          Erneut
        </button>
      </div>
    </div>
  );
}
