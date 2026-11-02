/**
 * TTS-Provider-Schnittstelle für den Podcast-Player (Section 2 und Researcher).
 * Default ist Piper (Open Source, lokal, kostenlos). Ein bezahlter Provider lässt sich später
 * über TTS_PROVIDER und TTS_API_KEY eintragen; registriert ist heute keiner, daher bleibt jeder
 * andere Wert ein sichtbarer Grund und der Player spricht mit der Browser-Stimme.
 */
import { BROWSER_PROVIDER_ID, BROWSER_PROVIDER_LABEL } from "../../shared/podcast-player";

export interface TtsSynthesis {
  durationMs: number;
  /** Start jedes Satzes in ms innerhalb der Datei. */
  sentenceStartsMs: number[];
}

export interface TtsProvider {
  id: string;
  label: string;
  mime: string;
  fileExt: string;
  /** Teil des Cache-Schlüssels: ändert sich Stimme oder Modell, entsteht neues Audio. */
  voiceKey: string;
  availability(): Promise<{ ok: true } | { ok: false; reason: string }>;
  synthesize(sentences: string[], outPath: string): Promise<TtsSynthesis>;
}

export type TtsProviderFactory = (apiKey: string | null) => TtsProvider;

export const DEFAULT_TTS_PROVIDER = "piper";

export type TtsResolution =
  | { kind: "server"; provider: TtsProvider }
  | { kind: "browser"; id: typeof BROWSER_PROVIDER_ID; label: string; reason: string };

export function browserResolution(reason: string): TtsResolution {
  return { kind: "browser", id: BROWSER_PROVIDER_ID, label: BROWSER_PROVIDER_LABEL, reason };
}

/**
 * TTS_PROVIDER leer → Piper. "browser" → bewusst keine Server-Stimme.
 * Ein bezahlter Provider bekommt einen Eintrag in `registry` und liest TTS_API_KEY; ohne Key bleibt er aus.
 */
export function resolveTtsProvider(
  registry: Readonly<Record<string, TtsProviderFactory>>,
  env: Record<string, string | undefined> = process.env,
): TtsResolution {
  const id = (env.TTS_PROVIDER ?? "").trim().toLowerCase() || DEFAULT_TTS_PROVIDER;
  if (id === BROWSER_PROVIDER_ID) return browserResolution("TTS_PROVIDER=browser");
  const factory = registry[id];
  if (!factory) return browserResolution(`TTS-Provider „${id}“ ist nicht eingebaut`);
  return { kind: "server", provider: factory(env.TTS_API_KEY?.trim() || null) };
}
