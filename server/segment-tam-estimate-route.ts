/**
 * POST /api/segment-tam-estimate
 *
 * Dieselbe Segment-TAM-Matrix wie /api/analyze/:ticker/tam-na-fill,
 * plus Peer-Median aus FMP und ein Quellenfilter.
 * Eine gültige Zelle bleibt. Offene Zellen bleiben n/a mit Grund.
 * Höchstens ein Retry, wenn der Anteil unter dem adaptiven Mindestanteil liegt.
 * Catalog-Coverage, tamTotal und der Score bleiben unberührt.
 */
import type { Express, Request, Response } from "express";
import type { PeerGrowthAnchor } from "../shared/peer-growth-anchor";
import {
  adaptiveMinFilledCellRatio,
  filledTargetCellRatio,
  llmTargetCellCount,
  mergeTamNaReasons,
  retainSourcedTamNaFills,
  TAM_ESTIMATE_MAX_RETRIES,
  unfilledTamNaReasons,
  unionTamNaFills,
  type TamNaFill,
  type TamNaReason,
  type TamNaSegmentRef,
} from "../shared/tam-na-fill";
import { loadPeerGrowthAnchor } from "./peer-growth-anchor";
import {
  eligibleTamNaSegments,
  INCOMPLETE_ERROR,
  requestTamNaFills,
  type TamNaFillArgs,
  type TamNaFillResult,
} from "./tam-na-fill";

export interface SegmentTamEstimate extends Extract<TamNaFillResult, { ok: true }> {
  naReasons: TamNaReason[];
  peerAnchor: PeerGrowthAnchor | null;
}

interface KeptEstimate {
  fills: TamNaFill[];
  naReasons: TamNaReason[];
  coveragePct: number | null;
  coverageNote: string;
  modelUsed: string;
}

function keptFromSuccess(result: Extract<TamNaFillResult, { ok: true }>): KeptEstimate {
  const sourced = retainSourcedTamNaFills(result.fills);
  return {
    fills: sourced.fills,
    naReasons: sourced.naReasons,
    coveragePct: result.coveragePct,
    coverageNote: result.coverageNote,
    modelUsed: result.modelUsed,
  };
}

function mergeKept(eligible: TamNaSegmentRef[], current: KeptEstimate, next: KeptEstimate): KeptEstimate {
  const nextRicher = filledTargetCellRatio(eligible, next.fills) > filledTargetCellRatio(eligible, current.fills);
  return {
    fills: unionTamNaFills(eligible, current.fills, next.fills),
    naReasons: mergeTamNaReasons(current.naReasons, next.naReasons),
    coveragePct: next.coveragePct ?? current.coveragePct,
    coverageNote: next.coverageNote || current.coverageNote,
    modelUsed: nextRicher ? next.modelUsed : current.modelUsed,
  };
}

export async function estimateSegmentTam(
  args: TamNaFillArgs,
  deps?: Parameters<typeof requestTamNaFills>[1],
): Promise<SegmentTamEstimate | Extract<TamNaFillResult, { ok: false }>> {
  const peerAnchor = args.peerAnchor !== undefined ? args.peerAnchor : await loadPeerGrowthAnchor(args.ticker);
  const withPeer: TamNaFillArgs = { ...args, peerAnchor };
  const eligible = eligibleTamNaSegments(withPeer.segments);
  const minRatio = adaptiveMinFilledCellRatio(eligible.map(llmTargetCellCount));
  let kept: KeptEstimate | null = null;
  let incomplete: Extract<TamNaFillResult, { ok: false }> | null = null;

  for (let attempt = 0; attempt <= TAM_ESTIMATE_MAX_RETRIES; attempt++) {
    const result = await requestTamNaFills(
      attempt === 0 ? withPeer : { ...withPeer, repeatBecauseThin: true },
      deps,
    );
    if (!result.ok) {
      if (result.code !== "INCOMPLETE_FILL") return result;
      incomplete = result;
    } else {
      const next = keptFromSuccess(result);
      kept = kept ? mergeKept(eligible, kept, next) : next;
    }
    const ratio = kept ? filledTargetCellRatio(eligible, kept.fills) : 0;
    if (kept != null && kept.fills.length > 0 && ratio >= minRatio) break;
  }

  if (!kept) {
    return incomplete ?? { ok: false, status: 422, error: INCOMPLETE_ERROR, code: "INCOMPLETE_FILL" };
  }
  return {
    ok: true,
    fills: kept.fills,
    naReasons: mergeTamNaReasons(kept.naReasons, unfilledTamNaReasons(eligible, kept.fills)),
    peerAnchor,
    coveragePct: kept.coveragePct,
    coverageNote: kept.coverageNote,
    modelUsed: kept.modelUsed,
  };
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
