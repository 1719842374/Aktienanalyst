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
