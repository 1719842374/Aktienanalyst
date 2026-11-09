/**
 * GET /api/analyze-recession/cape — Shiller-CAPE-Monatstabelle für das Overlay in „Vier Märkte“.
 * Dieselbe URL wie scoreCAPE (server/recession.ts MULTPL_CAPE). Nur Anzeige, kein Score.
 * Der Score-Parser latestMultplCape bleibt unverändert; diese Reihe liest alle gültigen Zeilen.
 */
import type { Express, Request, Response } from "express";
import { englishLongDate } from "./recession";
import { CAPE_PARAMS } from "../shared/recession-rest-overlays";

/** Dieselbe Adresse wie `const MULTPL_CAPE` in scoreCAPE. */
export const CAPE_SOURCE_URL = "https://www.multpl.com/shiller-pe/table/by-month";
export const CAPE_SOURCE_LABEL = "Multpl Shiller PE (US)";

/** Stunden. Herkunft: Credit-Route CACHE_MS, 12 h, gleicher Takt für eine langsame Monatstabelle. */
export const CAPE_CACHE_HOURS = 12;
const CACHE_MS = CAPE_CACHE_HOURS * 60 * 60 * 1000;

export interface CapePoint {
  date: string;
  value: number;
}

export interface CapeOverlayBody {
  source: string;
  sourceUrl: string;
  points: CapePoint[];
  note: string | null;
}

/** Gleiche Zell-Lesart wie htmlCell in server/recession.ts (dort nicht exportiert). */
function htmlCell(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)))
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Alle gültigen Zeilen, Dokumentreihenfolge. Dieselben Datums- und Wertefilter wie latestMultplCape. */
export function multplCapeSeries(html: string): CapePoint[] {
  if (!html || html.includes("Just a moment")) return [];
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const out: CapePoint[] = [];
  for (const row of rows) {
    const cells = [...(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) as unknown as RegExpExecArray[])].map(match => htmlCell(match[1]));
    if (cells.length < 2) continue;
    const date = englishLongDate(cells[0]);
    const value = Number(cells[1].replace(/,/g, ""));
    if (!date || !Number.isFinite(value) || value < CAPE_PARAMS.minValue || value > CAPE_PARAMS.maxValue) continue;
    out.push({ date, value });
  }
  return out;
}

function emptyCape(note: string): CapeOverlayBody {
  return { source: CAPE_SOURCE_LABEL, sourceUrl: CAPE_SOURCE_URL, points: [], note };
}

export async function loadCapeSeries(fetchHtml: () => Promise<string | null>): Promise<CapeOverlayBody> {
  let html: string | null = null;
  try {
    html = await fetchHtml();
  } catch {
    html = null;
  }
  const points = multplCapeSeries(html ?? "").slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (points.length === 0) return emptyCape("Multpl nicht erreichbar oder leer");
  return { source: CAPE_SOURCE_LABEL, sourceUrl: CAPE_SOURCE_URL, points, note: null };
}

async function fetchCapeHtml(): Promise<string | null> {
  try {
    const resp = await fetch(CAPE_SOURCE_URL, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

let cache: { at: number; body: CapeOverlayBody } | null = null;

export function resetCapeCacheForTests(): void {
  cache = null;
}

export function registerCapeRoute(app: Express): void {
  app.get("/api/analyze-recession/cape", async (_req: Request, res: Response) => {
    if (cache && Date.now() - cache.at < CACHE_MS) return res.json(cache.body);
    const body = await loadCapeSeries(fetchCapeHtml);
    if (body.points.length > 0) cache = { at: Date.now(), body };
    res.json(body);
  });
}
