/**
 * Prompt im Zuschnitt des Researcher-Briefings:
 * Rolle, Datum, nur die gelieferten Zahlen, Lücken als n/a, JSON-Schema am Ende.
 * Die Gliederung kommt aus podcast-structure.ts, nicht aus einer festen Themenliste.
 */
import type { PodcastGap, RankedDriver } from "./podcast-drivers";
import { PODCAST_DISCLAIMER, podcastStructurePrinciples } from "./podcast-structure";

export interface PodcastNote {
  channel: string;
  text: string;
  source: string | null;
}

export interface PodcastScript {
  title: string;
  hook: string;
  thesis: string;
  takeaways: Array<{ driverId: string; text: string }>;
  problem: string;
  implication: string;
  close: string;
  spokenScript: string;
  citations: Array<{ source: string; used: string }>;
}

export interface PodcastScriptParse {
  status: "ok" | "n/a";
  reason: string;
  script: PodcastScript | null;
}

/** Kanal des ersten Treibers wählt die Expertenrolle. Unbekannter Kanal bleibt „Stratege“. */
export const PODCAST_ROLE_BY_CHANNEL: Record<string, string> = {
  makro: "Macro Strategist",
  fred: "Macro Strategist",
  recession: "Macro Strategist",
  gold: "Macro Strategist",
  btc: "Macro Strategist",
  "sector-rotation": "Sector Strategist",
  news: "News Editor",
  researcher: "Researcher",
  "earnings-brief": "Fundamental Analyst",
};

function roleFor(drivers: RankedDriver[]): string {
  const channel = drivers[0]?.channels.find(item => PODCAST_ROLE_BY_CHANNEL[item]);
  return channel ? PODCAST_ROLE_BY_CHANNEL[channel]! : "Stratege";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildPodcastPrompt(input: {
  today: string;
  drivers: RankedDriver[];
  gaps: PodcastGap[];
  notes: PodcastNote[];
}): string {
  const drivers = input.drivers.map(driver => {
    const unit = driver.unit ? ` ${driver.unit}` : "";
    return `${driver.rank}. ${driver.id} | ${driver.label} | ${driver.value}${unit} | Stand ${driver.asOf} | ${driver.source} | ${driver.reason}`;
  });
  const gaps = input.gaps.map(gap => `- ${gap.channel} | ${gap.label} | ${gap.status}`);
  const notes = input.notes.map(note => `- ${note.channel} | ${note.text}${note.source ? ` | ${note.source}` : ""}`);
  return [
    "Du bist täglicher Marktstratege und schreibst ein Research-Podcast-Skript. Zahlen stehen unten. Du lieferst nur Synthese.",
    "Erfinde keine Zahl, keine Quelle und kein Ereignis. Fehlt etwas, schreibe n/a und den Grund aus der Lückenliste.",
    "Übernimm keine Themen aus anderen Sendungen. Nur die gelieferten Treiber.",
    `Heute: ${input.today}.`,
    `Rollen: Host und ${roleFor(input.drivers)}. Der Host fragt, der Experte antwortet in vollständigen Sätzen.`,
    "Struktur:",
    ...podcastStructurePrinciples(),
    "Key Drivers:",
    drivers.join("\n") || "keine",
    "Lücken:",
    gaps.join("\n") || "keine",
    "Kontext:",
    notes.join("\n") || "keiner",
    'JSON: {"title":"","hook":"","thesis":"","takeaways":[{"driverId":"","text":""}],"problem":"","implication":"","close":"","spokenScript":"","citations":[{"source":"","used":""}]}',
    `close und spokenScript enthalten den Satz: ${PODCAST_DISCLAIMER}`,
    "Jede Zahl im Skript nennt die Quelle aus der Treiberliste.",
  ].join("\n");
}

export function podcastScriptFromLlm(data: unknown): PodcastScriptParse {
  if (!data || typeof data !== "object") {
    return { status: "n/a", reason: "n/a — OpenRouter lieferte kein JSON", script: null };
  }
  const row = data as Record<string, unknown>;
  const title = text(row.title);
  const spoken = text(row.spokenScript);
  if (!title && !spoken) {
    return { status: "n/a", reason: "n/a — OpenRouter-JSON ohne Titel und ohne Skript", script: null };
  }
  const takeaways = Array.isArray(row.takeaways)
    ? row.takeaways.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const rec = item as Record<string, unknown>;
        const line = text(rec.text);
        if (!line) return [];
        return [{ driverId: text(rec.driverId), text: line }];
      })
    : [];
  const citations = Array.isArray(row.citations)
    ? row.citations.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const rec = item as Record<string, unknown>;
        const source = text(rec.source);
        if (!source) return [];
        return [{ source, used: text(rec.used) }];
      })
    : [];
  let close = text(row.close);
  let spokenScript = spoken;
  if (close && !close.includes("keine Anlageberatung")) close = `${close} ${PODCAST_DISCLAIMER}`;
  if (!close) close = PODCAST_DISCLAIMER;
  if (spokenScript && !spokenScript.includes("keine Anlageberatung")) spokenScript = `${spokenScript} ${PODCAST_DISCLAIMER}`;
  if (!spokenScript) spokenScript = [text(row.hook), text(row.thesis), ...takeaways.map(item => item.text), text(row.problem), text(row.implication), close].filter(Boolean).join(" ");
  return {
    status: "ok",
    reason: "ok",
    script: {
      title: title || "n/a — Titel fehlt im JSON",
      hook: text(row.hook),
      thesis: text(row.thesis),
      takeaways,
      problem: text(row.problem),
      implication: text(row.implication),
      close,
      spokenScript,
      citations,
    },
  };
}
