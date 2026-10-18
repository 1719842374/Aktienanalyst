/**
 * Loader für die F9-Lücken (F9-07 Konzentration, F9-10 EPS-Komponente). Nur freie Quellen:
 * SPY/RSP Tageskurse über altFetchYahooThenStooq (öffentliche Yahoo-Chart-API, Stooq Reserve, kein Key),
 * S&P 500 TTM-Earnings aus der öffentlichen multpl-Monatstabelle. Wirft nie; Fehler → null (n/a), nicht gecacht.
 */
import { englishLongDate } from "./recession";
import { computeConcentration, type DatedValue, type MacroConcentration, type PriceBar } from "@shared/macro-layer-gaps";

export const CONC_CAP_SYMBOL = "SPY";
export const CONC_EQUAL_SYMBOL = "RSP";
export const MULTPL_EPS_URL = "https://www.multpl.com/s-p-500-earnings/table/by-month";
export const CONC_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const EPS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/** 5 J z-Fenster + 27 Wochen RSL + Puffer. */
export const CONC_HISTORY_DAYS = 7 * 365;

export interface MacroGapDeps {
  fetchBars?: (symbol: string, from: string, to: string) => Promise<PriceBar[]>;
  fetchText?: (url: string) => Promise<string | null>;
  now: () => number;
}

let concCache: { ts: number; value: MacroConcentration } | null = null;
let epsCache: { ts: number; value: DatedValue[] } | null = null;

export function resetMacroGapCaches(): void {
  concCache = null;
  epsCache = null;
}

function cellText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alle Zeilen der multpl-Monatstabelle (Datum, Wert), aufsteigend. Bot-Seite/leer → []. */
export function parseMultplMonthlyTable(html: string | null | undefined): DatedValue[] {
  if (!html || html.includes("Just a moment")) return [];
  const out: DatedValue[] = [];
  for (const row of html.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map(m => cellText(m[1]));
    if (cells.length < 2) continue;
    const date = englishLongDate(cells[0]);
    const value = Number(cells[1].replace(/,/g, ""));
    if (!date || !Number.isFinite(value)) continue;
    out.push({ date, value });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function loadConcentration(deps: MacroGapDeps): Promise<MacroConcentration | null> {
  if (!deps.fetchBars) return null;
  const now = deps.now();
  if (concCache && now - concCache.ts < CONC_CACHE_TTL_MS) return concCache.value;
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - CONC_HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  const safe = async (s: string): Promise<PriceBar[]> => {
    try { return (await deps.fetchBars!(s, from, to)) ?? []; } catch { return []; }
  };
  const [cap, eq] = await Promise.all([safe(CONC_CAP_SYMBOL), safe(CONC_EQUAL_SYMBOL)]);
  const value = computeConcentration(cap, eq);
  if (value.value != null) concCache = { ts: now, value };
  return value;
}

export async function loadEpsHistory(deps: MacroGapDeps): Promise<DatedValue[] | null> {
  if (!deps.fetchText) return null;
  const now = deps.now();
  if (epsCache && now - epsCache.ts < EPS_CACHE_TTL_MS) return epsCache.value;
  let html: string | null = null;
  try { html = await deps.fetchText(MULTPL_EPS_URL); } catch { html = null; }
  const points = parseMultplMonthlyTable(html);
  if (!points.length) return null;
  epsCache = { ts: now, value: points };
  return points;
}

export async function fetchPublicText(url: string, timeoutMs = 20000, attempts = 2): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }, signal: AbortSignal.timeout(timeoutMs) });
      if (r.ok) return await r.text();
    } catch { /* retry */ }
  }
  return null;
}
