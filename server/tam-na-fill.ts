/**
 * POST /api/analyze/:ticker/tam-na-fill
 *
 * Thin LLM helper. Fail-closed when OpenRouter is unavailable or the
 * payload does not validate. Does not write the fact cache and does not
 * recompute catalog coverage, quality, tamTotal, or the DCF gate.
 */

import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import {
  catalogCoverageNote,
  validateTamNaFills,
  type TamNaFill,
  type TamNaSegmentRef,
} from "../shared/tam-na-fill";

const MAX_SEGMENTS = 24;

export interface TamNaFillRequestSegment extends TamNaSegmentRef {
  segmentShare?: number;
  /** When true, the row already has a catalog TAM and must not be sent to the model. */
  matched?: boolean;
}

export interface TamNaFillArgs {
  ticker: string;
  companyName?: string;
  sector?: string;
  industry?: string;
  description?: string;
  /** Fact catalog coverage from the existing analysis. Echoed, never recomputed. */
  coveragePct?: number | null;
  segments: TamNaFillRequestSegment[];
}

export type TamNaFillSuccess = {
  ok: true;
  fills: TamNaFill[];
  coveragePct: number | null;
  coverageNote: string;
  modelUsed: string;
};

export type TamNaFillFailure = {
  ok: false;
  status: number;
  error: string;
  code: "BAD_REQUEST" | "LLM_UNAVAILABLE" | "LLM_FAILED" | "NO_VALID_FILLS";
};

export type TamNaFillResult = TamNaFillSuccess | TamNaFillFailure;

type LlmJson = (opts: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}) => Promise<{ data: unknown; modelUsed: string } | null>;

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/i;

function clip(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

function echoCoverage(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function eligibleTamNaSegments(segments: TamNaFillRequestSegment[]): TamNaSegmentRef[] {
  const out: TamNaSegmentRef[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    if (seg.matched === true) continue;
    const name = typeof seg.segmentName === "string" ? seg.segmentName.trim() : "";
    if (!name || seen.has(name)) continue;
    if (!(typeof seg.segmentRevenue === "number" && Number.isFinite(seg.segmentRevenue) && seg.segmentRevenue >= 0)) continue;
    const growth = typeof seg.segmentGrowth === "number" && Number.isFinite(seg.segmentGrowth) ? seg.segmentGrowth : null;
    seen.add(name);
    out.push({ segmentName: name, segmentRevenue: seg.segmentRevenue, segmentGrowth: growth });
    if (out.length >= MAX_SEGMENTS) break;
  }
  return out;
}

function buildPrompt(args: TamNaFillArgs, eligible: TamNaSegmentRef[]): string {
  const lines = eligible.map((s) => {
    const src = args.segments.find((x) => x.segmentName.trim() === s.segmentName);
    const share = src && typeof src.segmentShare === "number" && Number.isFinite(src.segmentShare)
      ? `${src.segmentShare}%`
      : "n/a";
    return `- "${s.segmentName}" | Umsatz ${s.segmentRevenue} Mrd. USD | Umsatzanteil ${share}`;
  }).join("\n");
  const profile = clip(args.description, 500);
  return `Schätze den adressierbaren Markt (TAM) nur für die genannten, bisher nicht zugeordneten Umsatzsegmente.

UNTERNEHMEN: ${clip(args.companyName, 120) || args.ticker} (${args.ticker})
SEKTOR: ${clip(args.sector, 80) || "n/a"} | BRANCHE: ${clip(args.industry, 80) || "n/a"}
${profile ? `PROFIL: ${profile}` : ""}

SEGMENTE (Namen exakt übernehmen):
${lines}

Antworte ausschließlich mit JSON dieser Form:
{"fills":[{"segmentName":"<exakter Name>","tamSize":<Zahl in Mrd. USD, >0>,"tamCAGR":<Branchen-CAGR in Prozent>,"tamLabel":"<Marktname>","tamSource":"<Quelle>"}]}

REGELN:
- Nur Segmente aus der Liste. Keine zusätzlichen Namen.
- tamSize ist die Marktgröße in Milliarden USD, nicht der Segmentumsatz.
- tamCAGR ist die Branchen-CAGR, nicht das Umsatzwachstum des Unternehmens.
- Kein marketShare, kein segmentGrowth, kein YoY. Diese Werte werden lokal berechnet.
- Wenn du einen Markt nicht belastbar schätzen kannst, lass das Segment weg.`;
}

export async function requestTamNaFills(
  args: TamNaFillArgs,
  deps: { isLLMAvailable: () => boolean; callLLMJson: LlmJson } = { isLLMAvailable, callLLMJson },
): Promise<TamNaFillResult> {
  const ticker = clip(args.ticker, 16);
  if (!TICKER_RE.test(ticker)) {
    return { ok: false, status: 400, error: "ticker fehlt oder ist ungültig", code: "BAD_REQUEST" };
  }
  if (!Array.isArray(args.segments)) {
    return { ok: false, status: 400, error: "segments fehlen", code: "BAD_REQUEST" };
  }
  const eligible = eligibleTamNaSegments(args.segments);
  if (eligible.length === 0) {
    return { ok: false, status: 400, error: "Keine unmatched Segmente", code: "BAD_REQUEST" };
  }

  const coveragePct = echoCoverage(args.coveragePct);

  if (!deps.isLLMAvailable()) {
    return { ok: false, status: 503, error: "LLM nicht verfügbar", code: "LLM_UNAVAILABLE" };
  }

  const llm = await deps.callLLMJson({
    prompt: buildPrompt({ ...args, ticker }, eligible),
    maxTokens: 900,
    temperature: 0.2,
    systemPrompt: "Du schätzt nur TAM-Größen für genannte Segmente. Du erfindest keine YoY-Wachstumsraten und keine Segmentnamen. Antworte ausschließlich mit JSON.",
  });
  if (!llm || llm.data == null) {
    return { ok: false, status: 502, error: "KI-Antwort fehlgeschlagen", code: "LLM_FAILED" };
  }

  const fills = validateTamNaFills(eligible, llm.data);
  if (fills.length === 0) {
    return { ok: false, status: 422, error: "Keine gültigen TAM-Schätzungen", code: "NO_VALID_FILLS" };
  }

  return {
    ok: true,
    fills,
    coveragePct,
    coverageNote: catalogCoverageNote(coveragePct),
    modelUsed: llm.modelUsed,
  };
}
