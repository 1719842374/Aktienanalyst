/**
 * POST /api/segment-tam-estimate
 *
 * Dieselbe Segment-TAM-Matrix wie /api/analyze/:ticker/tam-na-fill,
 * plus Peer-Median aus FMP und ein Quellenfilter.
 * Catalog-Coverage, tamTotal und der Score bleiben unberührt.
 */
import type { Express, Request, Response } from "express";
import type { PeerGrowthAnchor } from "../shared/peer-growth-anchor";
import { retainSourcedTamNaFills, type TamNaReason } from "../shared/tam-na-fill";
import { loadPeerGrowthAnchor } from "./peer-growth-anchor";
import {
  requestTamNaFills,
  type TamNaFillArgs,
  type TamNaFillResult,
} from "./tam-na-fill";

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
  if (!result.ok) return result;
  const sourced = retainSourcedTamNaFills(result.fills);
  return { ...result, fills: sourced.fills, naReasons: sourced.naReasons, peerAnchor };
}

export function registerSegmentTamEstimateRoute(app: Express): void {
  app.post("/api/segment-tam-estimate", async (req: Request, res: Response) => {
    try {
      const b = req.body ?? {};
      const ticker = typeof b.ticker === "string" ? b.ticker : "";
      const result = await estimateSegmentTam({
        ticker,
        companyName: b.companyName,
        sector: b.sector,
        industry: b.industry,
        description: b.description,
        coveragePct: b.coveragePct,
        segments: Array.isArray(b.segments) ? b.segments : [],
      });
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
