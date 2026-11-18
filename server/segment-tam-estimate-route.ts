/**
 * POST /api/segment-tam-estimate
 *
 * Dieselbe Segment-TAM-Matrix wie /api/analyze/:ticker/tam-na-fill,
 * plus Peer-Median aus FMP und ein Quellenfilter.
 * Catalog-Coverage, tamTotal und der Score bleiben unberührt.
 */
import type { Express, Request, Response } from "express";
import type { PeerGrowthAnchor } from "../shared/peer-growth-anchor";
import { growthFactsFromSupplement, type SupplementGrowthField } from "../shared/segment-supplement";
import { catalogCoverageNote, retainSourcedTamNaFills, type TamNaReason } from "../shared/tam-na-fill";
import { loadPeerGrowthAnchor } from "./peer-growth-anchor";
import {
  requestTamNaFills,
  segmentTamGapIsExplainable,
  tamGapReasons,
  type TamNaFillArgs,
  type TamNaFillResult,
} from "./tam-na-fill";

const CURRENCY_RE = /^[A-Z]{3}$/;
const YEAR_RE = /^(19|20)\d{2}$/;
const HISTORY_ROWS_MAX = 24;
const HISTORY_NAME_MAX = 80;
const HISTORY_SOURCE_MAX = 160;
const REVENUE_MAX = 1e15;

type FillDeps = Parameters<typeof requestTamNaFills>[1];

export interface TamEstimateContext {
  currency: string | null;
  fiscalYear: string | null;
  totalRevenue: number | null;
  supplementGrowth: {
    name: string;
    nextYearGrowthPct: number;
    observations: number;
    source: string | null;
    field: SupplementGrowthField;
  }[];
  regions: { name: string; revenue: number | null; yoy: number | null; source: string | null }[];
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Ungültige oder fehlende Werte bleiben leer. Es wird nichts ergänzt. */
export function readTamEstimateContext(body: unknown): TamEstimateContext {
  const b = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const currencyCode = typeof b.currency === "string" ? b.currency.trim().toUpperCase() : "";
  const yearRaw = typeof b.fiscalYear === "number" && Number.isInteger(b.fiscalYear) ? String(b.fiscalYear) : b.fiscalYear;
  const year = typeof yearRaw === "string" ? yearRaw.trim() : "";
  const revenue = typeof b.totalRevenue === "number" && Number.isFinite(b.totalRevenue) && b.totalRevenue >= 0 && b.totalRevenue <= REVENUE_MAX
    ? b.totalRevenue
    : null;
  const supplementGrowth: TamEstimateContext["supplementGrowth"] = [];
  for (const fact of readSupplementFacts(b.supplementGrowth)) {
    if (supplementGrowth.length >= HISTORY_ROWS_MAX) break;
    if (fact.pct < -100 || fact.pct > 1000) continue;
    const name = cleanText(fact.name, HISTORY_NAME_MAX);
    if (!name) continue;
    const observations = Number.isInteger(fact.observations) && fact.observations >= 0 && fact.observations <= 80
      ? fact.observations
      : 0;
    const source = cleanText(fact.source, HISTORY_SOURCE_MAX);
    supplementGrowth.push({
      name,
      nextYearGrowthPct: fact.pct,
      observations,
      source: source || null,
      field: fact.field,
    });
  }
  return {
    currency: CURRENCY_RE.test(currencyCode) ? currencyCode : null,
    fiscalYear: YEAR_RE.test(year) ? year : null,
    totalRevenue: revenue,
    supplementGrowth,
    regions: readRegions(b.regions),
  };
}

function finitePct(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Explizites field gewinnt. Sonst nextYearGrowthPct, sonst reportedGrowthPct. Fehlende Zahl bleibt eine Lücke. */
function readSupplementFacts(value: unknown): { name: string; pct: number; field: SupplementGrowthField; observations: number; source: string | null }[] {
  if (!Array.isArray(value)) return [];
  const tagged: { name: string; pct: number; field: SupplementGrowthField; observations: number; source: string | null }[] = [];
  const untagged: unknown[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    const field = rec.field === "reportedGrowthPct" || rec.field === "nextYearGrowthPct" ? rec.field : null;
    const pct = finitePct(rec.nextYearGrowthPct) ?? finitePct(rec.reportedGrowthPct) ?? finitePct(rec.pct);
    if (field && name && pct != null) {
      const observations = typeof rec.observations === "number" && Number.isFinite(rec.observations) ? rec.observations : 0;
      const source = typeof rec.source === "string" && rec.source.trim() ? rec.source.trim() : null;
      tagged.push({ name, pct, field, observations, source });
      continue;
    }
    untagged.push(row);
  }
  return [...tagged, ...growthFactsFromSupplement({ growth: untagged })];
}

function readRegions(value: unknown): TamEstimateContext["regions"] {
  if (!Array.isArray(value)) return [];
  const out: TamEstimateContext["regions"] = [];
  for (const row of value) {
    if (out.length >= HISTORY_ROWS_MAX) break;
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = cleanText(rec.name, HISTORY_NAME_MAX);
    if (!name) continue;
    const revenue = typeof rec.revenue === "number" && Number.isFinite(rec.revenue) && rec.revenue > 0 ? rec.revenue : null;
    const yoy = finitePct(rec.yoy);
    const source = cleanText(rec.source, HISTORY_SOURCE_MAX) || null;
    out.push({ name, revenue, yoy, source });
  }
  return out;
}

export interface SegmentTamEstimate extends Extract<TamNaFillResult, { ok: true }> {
  naReasons: TamNaReason[];
  peerAnchor: PeerGrowthAnchor | null;
}

export async function estimateSegmentTam(
  args: TamNaFillArgs,
  deps?: Parameters<typeof requestTamNaFills>[1],
): Promise<SegmentTamEstimate | Extract<TamNaFillResult, { ok: false }>> {
  const peerAnchor = args.peerAnchor !== undefined ? args.peerAnchor : await loadPeerGrowthAnchor(args.ticker);
  const result = await requestTamNaFills({ ...args, peerAnchor }, deps);
  if (!result.ok) {
    if (result.code === "INCOMPLETE_FILL" && segmentTamGapIsExplainable(args.segments)) {
      const gaps = tamGapReasons(args.segments, []);
      if (gaps.length > 0) {
        const coveragePct = typeof args.coveragePct === "number" && Number.isFinite(args.coveragePct) ? args.coveragePct : null;
        return {
          ok: true,
          fills: [],
          naReasons: gaps,
          peerAnchor,
          coveragePct,
          coverageNote: catalogCoverageNote(coveragePct),
          modelUsed: result.modelUsed ?? "",
        };
      }
    }
    return result;
  }
  const sourced = retainSourcedTamNaFills(result.fills);
  const gaps = tamGapReasons(args.segments, sourced.fills).filter(
    (reason) => !sourced.naReasons.some((row) => row.segmentName === reason.segmentName && row.field === reason.field),
  );
  return { ...result, fills: sourced.fills, naReasons: [...sourced.naReasons, ...gaps], peerAnchor };
}

export function registerSegmentTamEstimateRoute(app: Express, deps?: FillDeps): void {
  app.post("/api/segment-tam-estimate", async (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      const ticker = typeof b.ticker === "string" ? b.ticker : "";
      const context = readTamEstimateContext(b);
      const result = await estimateSegmentTam({
        ticker,
        companyName: b.companyName,
        sector: b.sector,
        industry: b.industry,
        description: b.description,
        coveragePct: b.coveragePct,
        currency: context.currency,
        fiscalYear: context.fiscalYear,
        totalRevenue: context.totalRevenue,
        supplementGrowth: context.supplementGrowth,
        regions: context.regions,
        segments: Array.isArray(b.segments) ? b.segments : [],
      }, deps);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error, code: result.code });
      }
      return res.json({
        fills: result.fills,
        naReasons: result.naReasons,
        peerAnchor: result.peerAnchor,
        coveragePct: result.coveragePct,
        coverageNote: result.coverageNote,
        modelUsed: result.modelUsed,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Internal server error";
      console.error(`[/api/segment-tam-estimate] ${message.slice(0, 300)}`);
      return res.status(500).json({ error: message });
    }
  });
}
