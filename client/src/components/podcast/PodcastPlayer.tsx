/**
 * Gemeinsamer Podcast-Player für Section 2 (Aktie) und den Researcher-Podcast.
 * Cover, Titel, Play/Pause, ±15 s, Geschwindigkeit, Kapitel-Fortschritt, Zeit, Sleep-Timer,
 * aufklappbares Transkript mit Satz-Highlight.
 * Stimme je Kapitel: Server-Audio (/api/tts, Default Piper), sobald es vorliegt; sonst Web Speech API
 * Satz für Satz. Nur Theme-Tokens, damit Hell und Dunkel ohne Festfarben funktionieren.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Mic, Moon, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import {
  PLAYER_PARAMS, audioStatusLine, chapterListLabels, estimateSentenceMs, playableChapters, spokenForm,
  type PlayerChapter, type PlayerEpisode, type PlayerSpeed, type SleepChoice, type TtsChapterAudio,
  type TtsEpisodeRequest, type TtsEpisodeStatus,
} from "@shared/podcast-player";
import { usePodcastAudio } from "@/hooks/usePodcastAudio";
import { API_BASE } from "@/lib/queryClient";

interface Timeline {
  durationMs: number;
  starts: number[];
  audio: TtsChapterAudio | null;
}

function timelineOf(chapter: PlayerChapter, audio: TtsChapterAudio | undefined): Timeline {
  if (audio && audio.sentenceStartsMs.length === chapter.sentences.length) {
    return { durationMs: audio.durationMs, starts: audio.sentenceStartsMs, audio };
  }
  let t = 0;
  const starts = chapter.sentences.map(s => {
    const at = t;
    t += estimateSentenceMs(s);
    return at;
  });
  return { durationMs: t, starts, audio: null };
}

function sentenceAt(starts: number[], ms: number): number {
  let i = 0;
  while (i + 1 < starts.length && starts[i + 1] <= ms) i++;
  return i;
}

export function formatPlayerTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function pickVoice(voices: SpeechSynthesisVoice[], stored: string | null): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const byStore = stored ? voices.find(v => v.voiceURI === stored) : undefined;
  if (byStore) return byStore;
  const hinted = voices.find(v => PLAYER_PARAMS.preferredVoiceHints.some(h => v.name.toLowerCase().includes(h)));
  return hinted ?? voices[0];
}

interface Pos { ch: number; sentence: number; ms: number }

export function PodcastPlayer({
  episode,
  scope,
  playRequest = 0,
  onAudioStatus,
}: {
  episode: PlayerEpisode;
  scope: TtsEpisodeRequest["scope"];
  /** Jede Erhöhung startet die Wiedergabe (z. B. Podcast-Knopf im Researcher). */
  playRequest?: number;
  onAudioStatus?: (status: TtsEpisodeStatus | null) => void;
}) {
  const tts = usePodcastAudio(scope, episode);
  const chapters = useMemo(() => playableChapters(episode), [episode]);
  const listLabels = useMemo(() => chapterListLabels(episode.chapters.map(c => c.title)), [episode]);
  const timelines = useMemo(() => {
    const byId = new Map((tts?.chapters ?? []).map(a => [a.chapterId, a]));
    return chapters.map(c => timelineOf(c, byId.get(c.id)));
  }, [chapters, tts]);
  const totalMs = timelines.reduce((s, t) => s + t.durationMs, 0);
  const estimated = timelines.some(t => !t.audio);

  const [pos, setPos] = useState<Pos>({ ch: 0, sentence: 0, ms: 0 });
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlayerSpeed>(PLAYER_PARAMS.speeds[0]);
  const [sleep, setSleep] = useState<SleepChoice>("off");
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const speakToken = useRef(0);
  /** Engine der laufenden Wiedergabe. Kommt Server-Audio während der Browser-Stimme an, gilt es ab dem nächsten Start. */
  const engine = useRef<"server" | "browser">("browser");
  const clock = useRef<{ wall: number; ms: number }>({ wall: 0, ms: 0 });
  const live = useRef({ timelines, chapters, speed, sleep, voices, voiceUri, pos, playing });
  live.current = { timelines, chapters, speed, sleep, voices, voiceUri, pos, playing };

  useEffect(() => { onAudioStatus?.(tts); }, [tts, onAudioStatus]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechSupported(false);
      return;
    }
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      const de = all.filter(v => v.lang.toLowerCase().startsWith(PLAYER_PARAMS.speechLang.slice(0, 2)));
      setVoices(de);
      const stored = window.localStorage.getItem(PLAYER_PARAMS.voiceStorageKey);
      setVoiceUri(pickVoice(de, stored)?.voiceURI ?? null);
    };
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const stopEngines = useCallback(() => {
    speakToken.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    audioRef.current?.pause();
  }, []);

  useEffect(() => () => stopEngines(), [stopEngines]);

  const pause = useCallback(() => {
    const { pos: p, timelines: tl } = live.current;
    stopEngines();
    setPlaying(false);
    const t = tl[p.ch];
    if (t && engine.current === "browser") setPos({ ...p, ms: t.starts[p.sentence] ?? 0 });
  }, [stopEngines]);

  const startAtRef = useRef<(ch: number, ms: number) => void>(() => undefined);

  const chapterEnded = useCallback((ch: number) => {
    const { chapters: cs, sleep: sl } = live.current;
    if (sl === "chapter") {
      stopEngines();
      setPlaying(false);
      setSleep("off");
      if (ch + 1 < cs.length) setPos({ ch: ch + 1, sentence: 0, ms: 0 });
      return;
    }
    if (ch + 1 < cs.length) startAtRef.current(ch + 1, 0);
    else {
      stopEngines();
      setPlaying(false);
      setPos({ ch: 0, sentence: 0, ms: 0 });
    }
  }, [stopEngines]);

  const speakFrom = useCallback((ch: number, idx: number) => {
    const { chapters: cs, timelines: tl, speed: sp, voices: vs, voiceUri: vu } = live.current;
    const chapter = cs[ch];
    if (!chapter || idx >= chapter.sentences.length) {
      chapterEnded(ch);
      return;
    }
    const token = ++speakToken.current;
    const u = new SpeechSynthesisUtterance(spokenForm(chapter.sentences[idx]));
    u.lang = PLAYER_PARAMS.speechLang;
    u.rate = sp;
    const voice = vs.find(v => v.voiceURI === vu);
    if (voice) u.voice = voice;
    u.onend = () => { if (token === speakToken.current) speakFrom(ch, idx + 1); };
    u.onerror = () => { if (token === speakToken.current) speakFrom(ch, idx + 1); };
    const at = tl[ch]?.starts[idx] ?? 0;
    clock.current = { wall: performance.now(), ms: at };
    setPos({ ch, sentence: idx, ms: at });
    window.speechSynthesis.speak(u);
  }, [chapterEnded]);

  const startAt = useCallback((ch: number, ms: number) => {
    const { timelines: tl, speed: sp } = live.current;
    const t = tl[ch];
    if (!t) return;
    stopEngines();
    const sentence = sentenceAt(t.starts, ms);
    setPlaying(true);
    if (t.audio && audioRef.current) {
      engine.current = "server";
      const el = audioRef.current;
      const url = `${API_BASE}${t.audio.url}`;
      if (!el.src.endsWith(url)) el.src = url;
      el.currentTime = ms / 1000;
      el.playbackRate = sp;
      setPos({ ch, sentence, ms });
      el.play().catch(() => setPlaying(false));
      return;
    }
    if (!speechSupported) {
      setPlaying(false);
      return;
    }
    engine.current = "browser";
    speakFrom(ch, sentence);
  }, [speakFrom, speechSupported, stopEngines]);
  startAtRef.current = startAt;

  useEffect(() => {
    if (playing) return;
    setPos(p => {
      const t = timelines[p.ch];
      if (!t) return { ch: 0, sentence: 0, ms: 0 };
      return { ...p, ms: t.starts[p.sentence] ?? 0 };
    });
  }, [timelines, playing]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const { pos: p, timelines: tl, speed: sp } = live.current;
      const t = tl[p.ch];
      if (!t) return;
      if (engine.current === "server" && audioRef.current) {
        const ms = audioRef.current.currentTime * 1000;
        setPos({ ch: p.ch, sentence: sentenceAt(t.starts, ms), ms });
      } else {
        const next = t.starts[p.sentence + 1] ?? t.durationMs;
        const ms = Math.min(clock.current.ms + (performance.now() - clock.current.wall) * sp, next);
        setPos({ ...p, ms });
      }
      setNow(Date.now());
    }, PLAYER_PARAMS.tickMs);
    return () => window.clearInterval(id);
  }, [playing]);

  useEffect(() => {
    if (sleepEndsAt == null) return;
    const id = window.setTimeout(() => {
      pause();
      setSleep("off");
      setSleepEndsAt(null);
    }, Math.max(0, sleepEndsAt - Date.now()));
    return () => window.clearTimeout(id);
  }, [sleepEndsAt, pause]);

  /** Default ist die Server-Stimme: Play wartet, bis das laufende Kapitel Server-Audio hat oder feststeht, dass keins kommt. */
  const [waiting, setWaiting] = useState(false);
  const serverPending = (ch: number) => !tts || (tts.status === "pending" && !timelines[ch]?.audio);

  const requestPlay = () => {
    if (!chapters.length) return;
    if (serverPending(live.current.pos.ch)) setWaiting(true);
    else startAt(live.current.pos.ch, live.current.pos.ms);
  };

  useEffect(() => {
    if (!waiting || serverPending(pos.ch)) return;
    setWaiting(false);
    startAt(pos.ch, pos.ms);
  // serverPending liest tts und timelines.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, tts, timelines]);

  const lastPlayRequest = useRef(0);
  useEffect(() => {
    if (playRequest === lastPlayRequest.current) return;
    lastPlayRequest.current = playRequest;
    rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    if (!live.current.playing) requestPlay();
  // requestPlay liest den aktuellen Stand über live und tts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playRequest]);

  useEffect(() => {
    if (!transcriptOpen || !transcriptRef.current) return;
    const box = transcriptRef.current;
    const el = box.querySelector<HTMLElement>(`[data-sentence="${pos.ch}-${pos.sentence}"]`);
    if (!el) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - el.clientHeight) box.scrollTop = Math.max(0, top - box.clientHeight / 3);
  }, [pos.ch, pos.sentence, transcriptOpen]);

  const offsetOf = (ch: number) => timelines.slice(0, ch).reduce((s, t) => s + t.durationMs, 0);
  const globalMs = offsetOf(pos.ch) + pos.ms;

  const locate = (ms: number): { ch: number; ms: number } => {
    let rest = Math.max(0, Math.min(ms, Math.max(0, totalMs - 1)));
    for (let i = 0; i < timelines.length; i++) {
      if (rest < timelines[i].durationMs || i === timelines.length - 1) return { ch: i, ms: rest };
      rest -= timelines[i].durationMs;
    }
    return { ch: 0, ms: 0 };
  };

  const seekGlobal = (ms: number) => {
    const target = locate(ms);
    if (playing) startAt(target.ch, target.ms);
    else {
      const t = timelines[target.ch];
      setPos({ ch: target.ch, sentence: t ? sentenceAt(t.starts, target.ms) : 0, ms: target.ms });
    }
  };

  const toggle = () => {
    if (playing) pause();
    else if (waiting) setWaiting(false);
    else requestPlay();
  };

  const cycleSpeed = () => {
    const list = PLAYER_PARAMS.speeds;
    const next = list[(list.indexOf(speed) + 1) % list.length];
    setSpeed(next);
    live.current.speed = next;
    const t = timelines[pos.ch];
    if (engine.current === "server" && audioRef.current) audioRef.current.playbackRate = next;
    else if (playing) startAt(pos.ch, t?.starts[pos.sentence] ?? 0);
  };

  const chooseSleep = (value: string) => {
    if (value === "off" || value === "chapter") {
      setSleep(value);
      setSleepEndsAt(null);
      return;
    }
    const minutes = Number(value) as SleepChoice;
    setSleep(minutes);
    setSleepEndsAt(Date.now() + Number(value) * 60_000);
    setNow(Date.now());
  };

  const chooseVoice = (uri: string) => {
    setVoiceUri(uri);
    live.current.voiceUri = uri;
    window.localStorage.setItem(PLAYER_PARAMS.voiceStorageKey, uri);
    if (playing && engine.current === "browser") startAt(pos.ch, timelines[pos.ch]?.starts[pos.sentence] ?? 0);
  };

  const current = chapters[pos.ch] ?? null;
  const browserNeeded = timelines.some(t => !t.audio);
  const canPlay = chapters.length > 0 && (speechSupported || !browserNeeded);
  const sleepLeftMin = sleepEndsAt != null ? Math.max(0, Math.ceil((sleepEndsAt - (now || Date.now())) / 60_000)) : null;
  const chapterNumber = (c: PlayerChapter) => episode.chapters.indexOf(c) + 1;

  return (
    <div ref={rootRef} data-testid="podcast-player" className="max-w-full min-w-0 rounded-xl border border-border bg-card text-foreground p-3 sm:p-4 space-y-3 break-words">
      <audio ref={audioRef} preload="none" onEnded={() => chapterEnded(live.current.pos.ch)} className="hidden" />

      <div className="flex items-start gap-3 min-w-0">
        <div aria-hidden className="relative shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-gradient-to-br from-primary via-primary/70 to-emerald-500 flex flex-col items-center justify-center text-primary-foreground shadow-sm">
          <Mic className="w-5 h-5 opacity-80" />
          <span className="text-[11px] sm:text-xs font-bold tracking-wide mt-1 max-w-full px-1 truncate">{episode.coverLabel}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm sm:text-base font-semibold leading-snug text-foreground" data-testid="podcast-player-title">{episode.title}</div>
          <div className="text-[11px] text-foreground/70 mt-0.5">{episode.subtitle}</div>
          {current && (
            <div className="text-[11px] text-foreground/80 mt-1" data-testid="podcast-player-chapter">
              Kapitel {chapterNumber(current)} · {current.title}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex gap-1 h-2.5 sm:h-2" role="group" aria-label="Fortschritt nach Kapiteln">
          {timelines.map((t, i) => {
            const fill = i < pos.ch ? 1 : i > pos.ch ? 0 : t.durationMs ? pos.ms / t.durationMs : 0;
            return (
              <button
                key={chapters[i].id}
                type="button"
                title={`Kapitel ${chapterNumber(chapters[i])}: ${chapters[i].title}`}
                aria-label={`Kapitel ${chapterNumber(chapters[i])}: ${chapters[i].title}`}
                data-testid={`podcast-segment-${chapters[i].id}`}
                style={{ flexGrow: Math.max(1, t.durationMs), flexBasis: 0 }}
                className="relative h-full rounded-full bg-foreground/15 overflow-hidden cursor-pointer"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  const frac = r.width ? (e.clientX - r.left) / r.width : 0;
                  seekGlobal(offsetOf(i) + frac * t.durationMs);
                }}
              >
                <span className="absolute inset-y-0 left-0 bg-primary rounded-full" style={{ width: `${Math.min(100, Math.max(0, fill * 100))}%` }} />
              </button>
            );
          })}
          {!timelines.length && <div className="flex-1 h-full rounded-full bg-foreground/15" />}
        </div>
        <div className="flex justify-between text-[11px] tabular-nums text-foreground/70" data-testid="podcast-player-time">
          <span>{formatPlayerTime(globalMs)}</span>
          <span>{estimated ? "≈ " : ""}-{formatPlayerTime(totalMs - globalMs)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={cycleSpeed}
          data-testid="podcast-speed"
          aria-label={`Geschwindigkeit ${speed}x`}
          className="min-w-[3rem] h-9 px-2 rounded-full border border-border text-xs font-semibold tabular-nums text-foreground hover:bg-foreground/10"
        >
          {speed}x
        </button>
        <div className="flex items-center gap-3 sm:gap-4">
          <button type="button" disabled={!canPlay} onClick={() => seekGlobal(globalMs - PLAYER_PARAMS.skipSeconds * 1000)} aria-label={`${PLAYER_PARAMS.skipSeconds} Sekunden zurück`} data-testid="podcast-back" className="relative w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-foreground/10 disabled:opacity-40">
            <RotateCcw className="w-6 h-6" />
            <span className="absolute text-[8px] font-bold mt-0.5">{PLAYER_PARAMS.skipSeconds}</span>
          </button>
          <button type="button" disabled={!canPlay} onClick={toggle} aria-label={playing ? "Pause" : "Abspielen"} data-testid="podcast-play" className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:scale-105 transition-transform disabled:opacity-40 disabled:hover:scale-100">
            {waiting ? <Loader2 className="w-6 h-6 animate-spin" /> : playing ? <Pause className="w-6 h-6" fill="currentColor" /> : <Play className="w-6 h-6 ml-0.5" fill="currentColor" />}
          </button>
          <button type="button" disabled={!canPlay} onClick={() => seekGlobal(globalMs + PLAYER_PARAMS.skipSeconds * 1000)} aria-label={`${PLAYER_PARAMS.skipSeconds} Sekunden vor`} data-testid="podcast-forward" className="relative w-10 h-10 rounded-full flex items-center justify-center text-foreground hover:bg-foreground/10 disabled:opacity-40">
            <RotateCw className="w-6 h-6" />
            <span className="absolute text-[8px] font-bold mt-0.5">{PLAYER_PARAMS.skipSeconds}</span>
          </button>
        </div>
        <label className={`relative h-9 px-2 rounded-full border border-border flex items-center gap-1 text-xs ${sleep !== "off" ? "text-primary border-primary/60" : "text-foreground"}`} title="Sleep-Timer">
          <Moon className="w-4 h-4" />
          <span className="tabular-nums">{sleep === "off" ? "" : sleep === "chapter" ? "Kap." : `${sleepLeftMin ?? sleep}m`}</span>
          <select
            aria-label="Sleep-Timer"
            data-testid="podcast-sleep"
            value={String(sleep)}
            onChange={(e) => chooseSleep(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          >
            <option value="off">Sleep-Timer aus</option>
            {PLAYER_PARAMS.sleepMinutes.map(m => <option key={m} value={m}>{m} Minuten</option>)}
            <option value="chapter">Ende des Kapitels</option>
          </select>
        </label>
      </div>

      <div className="text-[11px] text-foreground/80 space-y-1" data-testid="podcast-voice">
        <div>Stimme: {chapters.length === 0 ? "n/a — kein Kapitel zum Vorlesen" : tts ? audioStatusLine(tts) : "Server-Stimme wird geprüft …"}</div>
        {waiting && (
          <div className="flex flex-wrap items-center gap-x-2" data-testid="podcast-waiting">
            <span>Startet, sobald die Server-Stimme für dieses Kapitel bereit ist.</span>
            {speechSupported && (
              <button type="button" onClick={() => { setWaiting(false); startAt(pos.ch, pos.ms); }} className="underline underline-offset-2 hover:text-foreground">
                Sofort mit Browser-Stimme
              </button>
            )}
          </div>
        )}
        {!speechSupported && browserNeeded && <div>n/a — dieser Browser hat keine Web Speech API; abspielbar sind nur Kapitel mit Server-Audio.</div>}
        {speechSupported && browserNeeded && voices.length > 0 && (
          <label className="flex items-center gap-2 min-w-0">
            <span className="shrink-0">Browser-Stimme</span>
            <select value={voiceUri ?? ""} onChange={(e) => chooseVoice(e.target.value)} data-testid="podcast-voice-select" className="min-w-0 flex-1 h-7 rounded border border-border bg-background text-foreground text-[11px] px-1">
              {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
          </label>
        )}
        {speechSupported && browserNeeded && voices.length === 0 && tts?.status === "n/a" && <div>Browser-Stimme: keine deutsche Stimme gefunden, es spricht die Standardstimme.</div>}
      </div>

      <ol className="space-y-1" data-testid="podcast-chapters">
        {episode.chapters.map((c, i) => {
          const idx = chapters.indexOf(c);
          const active = idx >= 0 && idx === pos.ch;
          return (
            <li key={c.id} className={`rounded-md border px-2 py-1.5 text-[12px] ${active ? "border-primary/60 bg-primary/10" : "border-border"}`}>
              {idx >= 0 ? (
                <button type="button" onClick={() => seekGlobal(offsetOf(idx))} className="w-full text-left flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium text-foreground">{listLabels[i]}</span>
                  <span className="shrink-0 tabular-nums text-foreground/70">{timelines[idx].audio ? "" : "≈ "}{formatPlayerTime(timelines[idx].durationMs)}</span>
                </button>
              ) : (
                <div className="text-foreground">
                  <span className="font-medium">{listLabels[i]}</span>
                  <span className="block text-[11px] text-foreground/80">{c.reason ?? "n/a"}</span>
                </div>
              )}
              {c.sourceLabel && (
                <span className="block text-[10px] text-foreground/60 mt-0.5">
                  Quelle: {c.sourceUrl ? <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{c.sourceLabel}</a> : c.sourceLabel}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div>
        <button type="button" onClick={() => setTranscriptOpen(o => !o)} aria-expanded={transcriptOpen} data-testid="podcast-transcript-toggle" className="flex items-center gap-1 text-[12px] font-medium text-foreground hover:text-primary">
          {transcriptOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />} Transkript
        </button>
        {transcriptOpen && (
          <div ref={transcriptRef} data-testid="podcast-transcript" className="relative mt-2 max-h-80 overflow-y-auto rounded-md border border-border bg-background p-2 sm:p-3 space-y-3">
            {episode.chapters.map((c) => {
              const idx = chapters.indexOf(c);
              return (
                <div key={c.id} className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">{c.title}</div>
                  {idx < 0 ? (
                    <p className="text-[12px] text-foreground/80">{c.reason ?? "n/a"}</p>
                  ) : (
                    <p className="text-[13px] leading-relaxed text-foreground">
                      {c.sentences.map((s, si) => {
                        const on = idx === pos.ch && si === pos.sentence;
                        return (
                          <span
                            key={si}
                            data-sentence={`${idx}-${si}`}
                            onClick={() => seekGlobal(offsetOf(idx) + (timelines[idx].starts[si] ?? 0))}
                            className={`cursor-pointer rounded px-0.5 transition-colors ${on ? "bg-primary/20 text-foreground" : "hover:bg-foreground/10"}`}
                          >
                            {s}{" "}
                          </span>
                        );
                      })}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
