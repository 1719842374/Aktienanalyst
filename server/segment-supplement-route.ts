/**
 * POST /api/segment-supplement — Historie unter den gemeldeten Segmenten.
 * Körper-Hinweise werden ignoriert. Unterposten kommen nur aus Zeilen mit Elternname und Quelle.
 * Eine gewöhnliche FMP-Jahresmap bleibt leer. Kein LLM, kein neuer Key.
 *
 * Registriert am Ende von registerRoutes in server/routes-register.ts.
 * Der Produkt-Provider für Unterposten bleibt leer. Der Hype-Hunk von #466 bleibt unberührt.
 */
import type { Express, Request, Response } from "express";
import { fmpSegmentationRows, isFmpAvailable } from "./fmp";
import {
  SEGMENT_SUPPLEMENT_ROUTE,
  buildSegmentSupplement,
  evidencedHintsFromRows,
  historyFromRaw,
  type EvidencedHint,
  type OfficialSegment,
  type SegmentSupplement,
} from "../shared/segment-supplement";

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,31}$/i;
const MAX_SEGMENTS = 40;

export interface SegmentSupplementDeps {
  raw: (ticker: string) => Promise<unknown[]>;
  hints: (ticker: string, official: readonly OfficialSegment[]) => readonly EvidencedHint[] | Promise<readonly EvidencedHint[]>;
  fmpAvailable: () => boolean;
}

export function defaultSegmentSupplementDeps(): SegmentSupplementDeps {
  return {
    raw: (ticker) => fmpSegmentationRows("product", ticker, "annual"),
    hints: async () => [],
    fmpAvailable: isFmpAvailable,
  };
}

export function normalizeSupplementTicker(raw: unknown): string | null {
  const ticker = String(raw ?? "").trim().toUpperCase();
  return TICKER_RE.test(ticker) ? ticker : null;
}

export function readOfficialSegments(raw: unknown): OfficialSegment[] | null {
  if (!Array.isArray(raw)) return null;
  const official: OfficialSegment[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return null;
    const rec = row as { name?: unknown; percentage?: unknown; reportedGrowthPct?: unknown };
    if (typeof rec.name !== "string" || !rec.name.trim() || rec.name.trim().length > 120) return null;
    if (rec.percentage != null && (typeof rec.percentage !== "number" || !Number.isFinite(rec.percentage))) return null;
    if (rec.reportedGrowthPct != null && (typeof rec.reportedGrowthPct !== "number" || !Number.isFinite(rec.reportedGrowthPct))) return null;
    official.push({
      name: rec.name.trim(),
      percentage: rec.percentage ?? null,
      reportedGrowthPct: rec.reportedGrowthPct ?? null,
    });
  }
  return official;
}

export async function loadSegmentSupplement(
  ticker: string,
  official: readonly OfficialSegment[],
  deps: SegmentSupplementDeps = defaultSegmentSupplementDeps(),
): Promise<SegmentSupplement & { ticker: string; source: "fmp" }> {
  let historyNote: string | null = null;
  let history: ReturnType<typeof historyFromRaw> = [];
  let rawRows: unknown[] = [];
  if (!deps.fmpAvailable()) {
    historyNote = "n/a — FMP_API_KEY fehlt, Segmenthistorie nicht geladen.";
  } else {
    try {
      const raw = await deps.raw(ticker);
      rawRows = Array.isArray(raw) ? raw : [];
      history = historyFromRaw(rawRows);
    } catch {
      historyNote = "n/a — Segmenthistorie nicht erreichbar.";
    }
  }
  const provided = await deps.hints(ticker, official);
  const hints = [...evidencedHintsFromRows(rawRows, official), ...provided];
  return {
    ticker,
    ...buildSegmentSupplement(official, history, hints, historyNote),
    source: "fmp",
  };
}

export function registerSegmentSupplementRoute(
  app: Express,
  deps: SegmentSupplementDeps = defaultSegmentSupplementDeps(),
): void {
  app.post(SEGMENT_SUPPLEMENT_ROUTE, async (req: Request, res: Response) => {
    const ticker = normalizeSupplementTicker(req.body?.ticker);
    if (!ticker) {
      res.status(400).json({ error: "Ungültiger Ticker" });
      return;
    }
    const official = readOfficialSegments(req.body?.segments);
    if (!official) {
      res.status(400).json({ error: "Segmente fehlen oder sind ungültig" });
      return;
    }
    if (official.length > MAX_SEGMENTS) {
      res.status(400).json({ error: "Zu viele Segmente" });
      return;
    }
    res.json(await loadSegmentSupplement(ticker, official, deps));
  });
}
