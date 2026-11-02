/**
 * Earnings-Call für den KI-Chat (WORK_KI_CHAT_BIG_PICTURE).
 * Reine Typen und Auswahl. Kein Abruf, kein Score. Fehlende Werte sind null
 * plus ein Grund in `reason`, nie 0 und nie ein erfundener Call.
 */

export interface TranscriptSlot {
  year: number;
  quarter: number;
  date: string;
}

export interface EarningsCallBrief {
  symbol: string;
  status: "ok" | "n/a";
  /** Grund, wenn etwas fehlt. Bei status "ok" nur gesetzt, wenn die Zusammenfassung fehlt. */
  reason: string | null;
  year: number | null;
  quarter: number | null;
  date: string | null;
  summary: string | null;
  excerpt: string | null;
  /** true, wenn der Auszug am Budget abgeschnitten wurde. */
  excerptTruncated: boolean;
  source: string | null;
  /** Link auf das Dokument (SEC-Exhibit); beim FMP-Transkript null. */
  sourceUrl?: string | null;
  /** "transcript" = FMP-Call-Transkript, "earnings-release" = SEC 8-K/6-K Exhibit 99.1. */
  kind?: EarningsBriefKind | null;
  /** Wörtliche Management-Zitate aus der Quelle. */
  quotes?: string[];
}

export type EarningsBriefKind = "transcript" | "earnings-release";

/** So viele Zitate gehen in den Chat-Kontext. */
export const EARNINGS_QUOTE_COUNT = 3;
/** Zitate kürzer als das sind Floskeln ("we are pleased"). */
export const EARNINGS_QUOTE_MIN_CHARS = 60;

const QUOTE_SAID = /[“"]([^”"]{20,900})[”"]\s*,?\s*(?:said|says|stated|commented|added)\s+([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3})/g;
const QUOTE_ROLE = /\b([A-Z][a-zà-ž'’-]+(?:\s+[A-Z][a-zà-ž'’-]+){1,2}),\s*(CEO|CFO|COO|Chief [A-Z][a-z]+ Officer|President)\s*:\s*(.{40,700}?[.!?])(?=\s+[A-Z][a-zà-ž'’-]+(?:\s+[A-Z][a-zà-ž'’-]+){1,2},\s*(?:CEO|CFO|COO|Chief|President)\b|\s+\d+\s*\/|\s*$)/g;

/**
 * Management-Zitate aus einem Earnings Release: “…,” said Name bzw. „Name, CEO: …“.
 * Nur wörtlicher Text aus der Quelle, kein Umformulieren.
 */
export function extractReleaseQuotes(text: string, max = EARNINGS_QUOTE_COUNT): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (who: string, quote: string) => {
    const q = quote.replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
    if (q.length < EARNINGS_QUOTE_MIN_CHARS || seen.has(q)) return;
    seen.add(q);
    out.push(`${who.trim()}: „${q}“`);
  };
  for (const m of Array.from(text.matchAll(QUOTE_SAID))) push(m[2], m[1]);
  for (const m of Array.from(text.matchAll(QUOTE_ROLE))) push(`${m[1]} (${m[2]})`, m[3]);
  return out.slice(0, max);
}

/** Höchstlänge eines Transkript-Zitats (ganze Sätze bis zu dieser Länge). */
export const EARNINGS_TRANSCRIPT_QUOTE_MAX_CHARS = 400;

const TRANSCRIPT_TURN = /^([A-Z][\w.'’-]+(?:\s+[A-Z][\w.'’-]+){0,3}):\s+(.+)$/;
const TRANSCRIPT_SKIP_SPEAKER = /^(operator|moderator|unknown|unidentified)/i;
const TRANSCRIPT_COURTESY = /^(thank you|thanks|good (morning|afternoon|evening)|hello|hi|great|okay|sure|yes)\b/i;

/**
 * Management-Zitate aus einem FMP-Transkript ("Name: Text" je Wortmeldung): je Sprecher die
 * ersten inhaltlichen Sätze, Moderator und Begrüßungen ausgenommen. Wörtlich, nicht umformuliert.
 */
export function extractTranscriptQuotes(content: string, max = EARNINGS_QUOTE_COUNT): string[] {
  const out: string[] = [];
  const speakers = new Set<string>();
  for (const line of content.split(/\n+/)) {
    const m = TRANSCRIPT_TURN.exec(line.trim());
    if (!m || TRANSCRIPT_SKIP_SPEAKER.test(m[1]) || speakers.has(m[1])) continue;
    const sentences = (m[2].match(/[^.!?]+[.!?]+/g) ?? []).map(s => s.trim()).filter(s => !TRANSCRIPT_COURTESY.test(s));
    let quote = "";
    for (const s of sentences) {
      if ((quote ? quote.length + 1 : 0) + s.length > EARNINGS_TRANSCRIPT_QUOTE_MAX_CHARS) break;
      quote = quote ? `${quote} ${s}` : s;
    }
    if (quote.length < EARNINGS_QUOTE_MIN_CHARS) continue;
    speakers.add(m[1]);
    out.push(`${m[1]}: „${quote}“`);
    if (out.length >= max) break;
  }
  return out;
}

export function earningsBriefNa(symbol: string, reason: string): EarningsCallBrief {
  return {
    symbol, status: "n/a", reason,
    year: null, quarter: null, date: null,
    summary: null, excerpt: null, excerptTruncated: false, source: null,
  };
}

/** Letzter Termin nach Datum, nicht nach Array-Reihenfolge. Ungültige Zeilen fallen weg. */
export function latestTranscriptSlot(rows: unknown): TranscriptSlot | null {
  if (!Array.isArray(rows)) return null;
  const slots: TranscriptSlot[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const year = Number(rec.fiscalYear ?? rec.year);
    const quarter = Number(rec.quarter);
    const date = typeof rec.date === "string" ? rec.date : "";
    if (!Number.isInteger(year)) continue;
    if (!Number.isInteger(quarter) || quarter < 1 || quarter > 4) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(date)) continue;
    slots.push({ year, quarter, date: date.slice(0, 10) });
  }
  if (!slots.length) return null;
  slots.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return slots[0];
}

/** Kürzt auf `maxChars` an einer Wortgrenze. `maxChars` kommt vom Chat-Budget, nicht aus einer festen Länge. */
export function clipTranscriptExcerpt(content: string, maxChars: number): { excerpt: string; truncated: boolean } {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return { excerpt: "", truncated: false };
  if (text.length <= maxChars) return { excerpt: text, truncated: false };
  if (maxChars <= 1) return { excerpt: "…", truncated: true };
  const slice = text.slice(0, maxChars - 1);
  const cut = slice.lastIndexOf(" ");
  const body = (cut > 0 ? slice.slice(0, cut) : slice).trimEnd();
  return { excerpt: `${body}…`, truncated: true };
}

export function transcriptContent(raw: unknown): string | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== "object") return null;
  const content = (row as Record<string, unknown>).content;
  if (typeof content !== "string") return null;
  const text = content.trim();
  return text.length ? text : null;
}
