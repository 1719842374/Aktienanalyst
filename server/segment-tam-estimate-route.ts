/**
 * POST /api/segment-tam-estimate
 *
 * Dieselbe Segment-TAM-Matrix wie /api/analyze/:ticker/tam-na-fill,
 * plus Peer-Median aus FMP und ein Quellenfilter.
 * Jede offene Zeile wird in diesem Lauf geschätzt: CAGR als Proxy aus dem
 * Segment-Wachstum, TAM aus Peer-Umsatz/Marktanteil oder aus einer Marktquelle.
 * Was die Plausibilitäts-Spanne oder die Quellenprüfung nicht besteht, bleibt
 * n/a mit Grund. Zahlen werden nicht zwischen Zeilen gemittelt.
 * Retries je offener Zeile: TAM_ESTIMATE_MAX_RETRIES. Obergrenze: tamEstimateCallCeiling.
 * Catalog-Coverage, tamTotal und der Score bleiben unberührt.
 */
import type { Express, Request, Response } from "express";
import { PEER_ANCHOR_LIMIT, type PeerGrowthAnchor } from "../shared/peer-growth-anchor";
import {
  catalogCoverageNote,
  countKiFilledCells,
  deriveOutperforming,
  deriveTamShare,
  factTamRevenueRatios,
  gateMarketTam,
  peerRevenueShareTam,
  peerTamRevenueRatios,
  retainSourcedTamNaFills,
  scopeNaCells,
  segmentGrowthCagrProxy,
  TAM_ESTIMATE_CACHE_VERSION,
  TAM_ESTIMATE_MAX_RETRIES,
  TAM_NA_SHARE_WARN,
  tamEstimateCallCeiling,
  type PeerSegmentEvidence,
  type TamNaFill,
  type TamNaReason,
  type TamNaSegmentRef,
} from "../shared/tam-na-fill";
import { fmpPeers, fmpSegments, isFmpAvailable } from "./fmp";
import { matchSegmentTAM } from "./sector-data";
import { loadPeerGrowthAnchor, peerLookupSymbols } from "./peer-growth-anchor";
import {
  eligibleTamNaSegments,
  requestTamNaFills,
  type TamNaFillArgs,
  type TamNaFillResult,
} from "./tam-na-fill";

export interface SegmentTamEstimate extends Extract<TamNaFillResult, { ok: true }> {
  naReasons: TamNaReason[];
  peerAnchor: PeerGrowthAnchor | null;
}

interface CachedEstimate {
  fills: TamNaFill[];
  naReasons: TamNaReason[];
  coveragePct: number | null;
  coverageNote: string;
  modelUsed: string;
}

const estimateCache = new Map<string, CachedEstimate>();

export function resetTamEstimateCacheForTests(): void {
  estimateCache.clear();
}

function coverageOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function peerSignature(peers: readonly PeerSegmentEvidence[]): string {
  return peers
    .map((peer) => `${peer.symbol}|${peer.segmentName}|${peer.revenueB}|${peer.sharePct ?? ""}`)
    .sort()
    .join("~");
}

function cacheKey(ticker: string, segments: readonly TamNaSegmentRef[], peers: readonly PeerSegmentEvidence[], anchor: PeerGrowthAnchor | null): string {
  const rows = segments.map((seg) => [seg.segmentName, seg.segmentRevenue, seg.segmentGrowth ?? "", seg.matched === false ? 0 : 1, seg.tamSize ?? "", seg.tamCAGR ?? ""].join("|"));
  return `${TAM_ESTIMATE_CACHE_VERSION}|${ticker.toUpperCase()}|${anchor?.medianRevenueYoyPct ?? ""}|${rows.join(";")}|${peerSignature(peers)}`;
}

function joinText(current: string | undefined, extra: string | undefined): string | undefined {
  const left = current?.trim() ?? "";
  const right = extra?.trim() ?? "";
  if (!left) return right || undefined;
  if (!right || left.includes(right)) return left;
  return `${left} · ${right}`;
}

function rememberReason(reasons: TamNaReason[], reason: TamNaReason): void {
  if (reasons.some((row) => row.segmentName === reason.segmentName && row.field === reason.field)) return;
  reasons.push(reason);
}

export function peerEvidenceFromFmpRows(symbol: string, rows: readonly { name?: string; revenue?: number }[]): PeerSegmentEvidence[] {
  const out: PeerSegmentEvidence[] = [];
  for (const row of rows) {
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const revenue = Number(row.revenue);
    if (!name || !(revenue > 0)) continue;
    const revenueB = revenue / 1e9;
    const match = matchSegmentTAM(name);
    const sharePct = match.matched && match.tamSize != null && match.tamSize > 0 ? (revenueB / match.tamSize) * 100 : null;
    out.push({ symbol, segmentName: name, revenueB, sharePct });
  }
  return out;
}

export async function loadPeerSegmentEvidence(ticker: string): Promise<PeerSegmentEvidence[]> {
  if (!isFmpAvailable()) return [];
  try {
    let symbols: string[] = [];
    for (const candidate of peerLookupSymbols(ticker)) {
      const raw = await fmpPeers(candidate);
      const names = (Array.isArray(raw) ? raw : [])
        .map((row: unknown) => typeof row === "string" ? row : String((row as { symbol?: string })?.symbol ?? ""))
        .map((symbol) => symbol.toUpperCase())
        .filter((symbol) => symbol.length > 0 && symbol !== candidate.toUpperCase());
      if (names.length > 0) {
        symbols = names.slice(0, PEER_ANCHOR_LIMIT);
        break;
      }
    }
    const batches = await Promise.all(symbols.map(async (symbol) => peerEvidenceFromFmpRows(symbol, await fmpSegments(symbol))));
    return batches.flat();
  } catch {
    return [];
  }
}

function applyFreeFormulas(
  eligible: readonly TamNaSegmentRef[],
  peers: readonly PeerSegmentEvidence[],
  ratios: readonly number[],
  fills: Map<string, TamNaFill>,
  reasons: TamNaReason[],
): void {
  for (const seg of eligible) {
    const open = scopeNaCells(seg, fills.get(seg.segmentName) ?? null);
    const fill = fills.get(seg.segmentName) ?? { segmentName: seg.segmentName, confidence: "low" as const, rationale: "" };
    let used = false;
    if (open.cagr && seg.segmentGrowth != null) {
      const proxy = segmentGrowthCagrProxy(seg.segmentGrowth);
      if (proxy) {
        fill.tamCAGR = proxy.tamCAGR;
        fill.formula = joinText(fill.formula, proxy.formula);
        fill.tamSource = joinText(fill.tamSource, proxy.source);
        fill.rationale = proxy.rationale;
        fill.confidence = "low";
        used = true;
      }
    }
    if (open.tam) {
      const peer = peerRevenueShareTam(seg.segmentName, peers);
      if (peer && "tamSize" in peer) {
        const gate = gateMarketTam({
          tamSize: peer.tamSize,
          revenue: seg.segmentRevenue,
          source: peer.source,
          ratios,
          formulaPath: true,
        });
        if (gate.ok) {
          fill.tamSize = peer.tamSize;
          fill.tamLabel = seg.segmentName;
          fill.tamSource = peer.source;
          fill.formula = joinText(fill.formula, peer.formula);
          fill.marketShare = deriveTamShare(seg.segmentRevenue, peer.tamSize);
          fill.shareWarning = fill.marketShare > TAM_NA_SHARE_WARN;
          fill.confidence = "med";
          used = true;
        } else {
          rememberReason(reasons, { segmentName: seg.segmentName, field: "tam", reason: gate.reason });
        }
      } else if (peer && "reason" in peer) {
        rememberReason(reasons, { segmentName: seg.segmentName, field: "tam", reason: peer.reason });
      }
    }
    if (!used && !fills.has(seg.segmentName)) continue;
    fill.outperforming = deriveOutperforming(seg.segmentGrowth, fill.tamCAGR ?? null);
    if (countKiFilledCells([seg], [fill]) > 0) fills.set(seg.segmentName, fill);
  }
}

function acceptLlmFills(
  eligible: readonly TamNaSegmentRef[],
  proposed: readonly TamNaFill[],
  ratios: readonly number[],
  fills: Map<string, TamNaFill>,
  reasons: TamNaReason[],
): void {
  for (const seg of eligible) {
    const row = proposed.find((fill) => fill.segmentName === seg.segmentName);
    if (!row) continue;
    const open = scopeNaCells(seg, fills.get(seg.segmentName) ?? null);
    const fill = fills.get(seg.segmentName) ?? { segmentName: seg.segmentName, confidence: row.confidence, rationale: row.rationale };
    if (open.growth && row.segmentGrowth != null && fill.segmentGrowth == null) {
      fill.segmentGrowth = row.segmentGrowth;
      fill.formula = joinText(fill.formula, row.formula);
      fill.rationale = row.rationale || fill.rationale;
      fill.confidence = row.confidence;
    }
    if (open.tam && row.tamSize != null && fill.tamSize == null) {
      const gate = gateMarketTam({
        tamSize: row.tamSize,
        revenue: seg.segmentRevenue,
        source: row.tamSource ?? "",
        ratios,
      });
      if (!gate.ok) {
        rememberReason(reasons, { segmentName: seg.segmentName, field: "tam", reason: gate.reason });
      } else {
        fill.tamSize = row.tamSize;
        if (fill.tamCAGR == null && row.tamCAGR != null) fill.tamCAGR = row.tamCAGR;
        if (row.tamLabel) fill.tamLabel = row.tamLabel;
        fill.tamSource = row.tamSource ?? fill.tamSource;
        fill.formula = joinText(fill.formula, row.formula);
        fill.marketShare = deriveTamShare(seg.segmentRevenue, row.tamSize);
        fill.shareWarning = fill.marketShare > TAM_NA_SHARE_WARN;
        fill.confidence = row.confidence;
      }
    }
    fill.outperforming = deriveOutperforming(
      fill.segmentGrowth ?? seg.segmentGrowth,
      fill.tamCAGR ?? null,
    );
    if (countKiFilledCells([seg], [fill]) > 0) fills.set(seg.segmentName, fill);
  }
}

function rowsStillOpen(eligible: readonly TamNaSegmentRef[], fills: Map<string, TamNaFill>, attempts: Map<string, number>): TamNaSegmentRef[] {
  return eligible.filter((seg) => {
    const open = scopeNaCells(seg, fills.get(seg.segmentName) ?? null);
    const used = attempts.get(seg.segmentName) ?? 0;
    return (open.tam || open.growth) && used < TAM_ESTIMATE_MAX_RETRIES + 1;
  });
}

export async function estimateSegmentTam(
  args: TamNaFillArgs,
  deps?: Parameters<typeof requestTamNaFills>[1],
): Promise<SegmentTamEstimate | Extract<TamNaFillResult, { ok: false }>> {
  const ticker = typeof args.ticker === "string" ? args.ticker.trim() : "";
  if (!/^[A-Z0-9][A-Z0-9.\-]{0,14}$/i.test(ticker)) {
    return { ok: false, status: 400, error: "ticker fehlt oder ist ungültig", code: "BAD_REQUEST" };
  }
  const peerAnchor = args.peerAnchor !== undefined ? args.peerAnchor : await loadPeerGrowthAnchor(ticker);
  const peerEvidence = args.peerEvidence !== undefined ? args.peerEvidence : await loadPeerSegmentEvidence(ticker);
  const withPeer: TamNaFillArgs = { ...args, ticker, peerAnchor, peerEvidence };
  const eligible = eligibleTamNaSegments(withPeer.segments);
  if (eligible.length === 0) {
    return { ok: false, status: 400, error: "Keine N/A-Zellen", code: "BAD_REQUEST" };
  }
  const ratios = [...factTamRevenueRatios(withPeer.segments), ...peerTamRevenueRatios(peerEvidence)];
  const key = cacheKey(ticker, eligible, peerEvidence, peerAnchor);
  const cached = estimateCache.get(key);
  if (cached) return { ok: true, ...cached, peerAnchor };

  const fills = new Map<string, TamNaFill>();
  const reasons: TamNaReason[] = [];
  applyFreeFormulas(eligible, peerEvidence, ratios, fills, reasons);

  const attempts = new Map<string, number>();
  const ceiling = tamEstimateCallCeiling(eligible.length);
  let calls = 0;
  let modelUsed = "Formel";
  let coveragePct = coverageOf(args.coveragePct);
  let coverageNote = catalogCoverageNote(coveragePct);
  let hard: Extract<TamNaFillResult, { ok: false }> | null = null;

  while (calls < ceiling) {
    const pending = rowsStillOpen(eligible, fills, attempts);
    if (pending.length === 0) break;
    const result = await requestTamNaFills(calls === 0 ? withPeer : { ...withPeer, repeatBecauseThin: true }, deps);
    calls += 1;
    for (const seg of pending) attempts.set(seg.segmentName, (attempts.get(seg.segmentName) ?? 0) + 1);
    if (!result.ok) {
      if (result.code === "BAD_REQUEST") return result;
      hard = result;
      if (result.code !== "INCOMPLETE_FILL") break;
      continue;
    }
    modelUsed = result.modelUsed;
    coveragePct = result.coveragePct;
    coverageNote = result.coverageNote;
    const sourced = retainSourcedTamNaFills(result.fills);
    for (const reason of sourced.naReasons) rememberReason(reasons, reason);
    acceptLlmFills(eligible, sourced.fills, ratios, fills, reasons);
  }

  for (const seg of eligible) {
    const open = scopeNaCells(seg, fills.get(seg.segmentName) ?? null);
    if (open.tam) {
      rememberReason(reasons, {
        segmentName: seg.segmentName,
        field: "tam",
        reason: `n/a — kein Peer-Segment mit demselben Namen und belegtem Marktanteil (${seg.segmentName})`,
      });
    }
    if (open.growth) {
      rememberReason(reasons, {
        segmentName: seg.segmentName,
        field: "growth",
        reason: "n/a — keine belegte Wachstumsschätzung aus Formel oder Marktquelle",
      });
    }
    if (open.cagr) {
      rememberReason(reasons, {
        segmentName: seg.segmentName,
        field: "cagr",
        reason: "n/a — kein Segment-Wachstum als CAGR-Proxy und keine Markt-CAGR",
      });
    }
  }

  const kept = eligible.flatMap((seg) => {
    const fill = fills.get(seg.segmentName);
    if (!fill || countKiFilledCells([seg], [fill]) === 0) return [];
    return [fill];
  });
  if (kept.length === 0) {
    return hard ?? { ok: false, status: 422, error: "KI-Schätzung unvollständig — nichts übernommen", code: "INCOMPLETE_FILL" };
  }
  const body: CachedEstimate = {
    fills: kept,
    naReasons: reasons,
    coveragePct,
    coverageNote,
    modelUsed,
  };
  estimateCache.set(key, body);
  return { ok: true, ...body, peerAnchor };
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
