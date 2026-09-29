/**
 * POST /api/analyze/:ticker/tam-na-fill
 *
 * Thin LLM helper for visible Segment-TAM n/a cells (Spec v2).
 * Wachstum n/a is estimated. Unmatched TAM/CAGR are estimated.
 * Anteil am TAM and vs. TAM are formula-only (shared/tam-na-fill.ts) —
 * this module never calls Apollo or S&P Global.
 *
 * Fail-closed: a fill is returned only when every scope cell
 * (Wachstum · TAM · CAGR · Anteil · vs. TAM) closes. Partial LLM output
 * is INCOMPLETE_FILL and is not applied. Does not write the fact cache
 * and does not recompute catalog coverage, quality, tamTotal,
 * segmentWeightedGrowth, or the DCF gate.
 */

import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import {
  catalogCoverageNote,
  countScopeRestNa,
  segmentNeedsLlm,
  validateTamNaFills,
  type TamNaFill,
  type TamNaSegmentRef,
} from "../shared/tam-na-fill";

const MAX_SEGMENTS = 24;

export interface TamNaFillRequestSegment extends TamNaSegmentRef {
  segmentShare?: number;
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
  code: "BAD_REQUEST" | "LLM_UNAVAILABLE" | "LLM_FAILED" | "INCOMPLETE_FILL";
};

export type TamNaFillResult = TamNaFillSuccess | TamNaFillFailure;

type LlmJson = (opts: {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}) => Promise<{ data: unknown; modelUsed: string } | null>;

const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/i;
const INCOMPLETE_ERROR = "KI-Schätzung unvollständig — nichts übernommen";

function clip(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

function echoCoverage(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function asRef(seg: TamNaFillRequestSegment): TamNaSegmentRef | null {
  const name = typeof seg.segmentName === "string" ? seg.segmentName.trim() : "";
  if (!name) return null;
  if (!(typeof seg.segmentRevenue === "number" && Number.isFinite(seg.segmentRevenue) && seg.segmentRevenue >= 0)) return null;
  const growth = typeof seg.segmentGrowth === "number" && Number.isFinite(seg.segmentGrowth) ? seg.segmentGrowth : null;
  const tamSize = typeof seg.tamSize === "number" && Number.isFinite(seg.tamSize) ? seg.tamSize : null;
  const tamCAGR = typeof seg.tamCAGR === "number" && Number.isFinite(seg.tamCAGR) ? seg.tamCAGR : null;
  return {
    segmentName: name,
    segmentRevenue: seg.segmentRevenue,
    segmentGrowth: growth,
    matched: seg.matched,
    tamSize,
    tamCAGR,
  };
}

/** Rows the model must answer. Fact-complete rows are omitted. */
export function eligibleTamNaSegments(segments: TamNaFillRequestSegment[]): TamNaSegmentRef[] {
  const out: TamNaSegmentRef[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const ref = asRef(seg);
    if (!ref || seen.has(ref.segmentName) || !segmentNeedsLlm(ref)) continue;
    seen.add(ref.segmentName);
    out.push(ref);
    if (out.length >= MAX_SEGMENTS) break;
  }
  return out;
}

function scopeSegments(segments: TamNaFillRequestSegment[]): TamNaSegmentRef[] {
  const out: TamNaSegmentRef[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const ref = asRef(seg);
    if (!ref || seen.has(ref.segmentName)) continue;
    seen.add(ref.segmentName);
    out.push(ref);
  }
  return out;
}

function buildPrompt(args: TamNaFillArgs, eligible: TamNaSegmentRef[]): string {
  const lines = eligible.map((s) => {
    const src = args.segments.find((x) => x.segmentName.trim() === s.segmentName);
    const share = src && typeof src.segmentShare === "number" && Number.isFinite(src.segmentShare)
      ? `${src.segmentShare}%`
      : "n/a";
    const needs: string[] = [];
    if (s.segmentGrowth === null) needs.push("segmentGrowth");
    if (s.matched === false) needs.push("tamSize", "tamCAGR", "tamLabel", "tamSource");
    return `- "${s.segmentName}" | Umsatz ${s.segmentRevenue} Mrd. USD | Umsatzanteil ${share} | FEHLT: ${needs.join(", ") || "segmentGrowth"}`;
  }).join("\n");
  const profile = clip(args.description, 500);
  return `Schätze nur die fehlenden N/A-Felder der genannten Umsatzsegmente. Fact-Zahlen nicht ersetzen.

UNTERNEHMEN: ${clip(args.companyName, 120) || args.ticker} (${args.ticker})
SEKTOR: ${clip(args.sector, 80) || "n/a"} | BRANCHE: ${clip(args.industry, 80) || "n/a"}
${profile ? `PROFIL: ${profile}` : ""}

SEGMENTE (Namen exakt übernehmen, jedes Segment vollständig für FEHLT-Felder):
${lines}

Antworte ausschließlich mit JSON dieser Form:
{"fills":[{"segmentName":"<exakter Name>","segmentGrowth":<YoY % nur wenn FEHLT>,"tamSize":<Mrd. USD nur wenn FEHLT>,"tamCAGR":<Branchen-CAGR % nur wenn FEHLT>,"tamLabel":"<Marktname nur wenn TAM fehlt>","tamSource":"<Quelle nur wenn TAM fehlt>","confidence":"low"|"med"|"high","rationale":"<max 140 Zeichen>"}]}

REGELN:
- Nur Segmente aus der Liste. Keine zusätzlichen Namen.
- segmentGrowth nur wenn FEHLT segmentGrowth. Das ist das Segment-YoY in Prozent, nicht die Branchen-CAGR.
- tamSize/tamCAGR/tamLabel/tamSource nur wenn FEHLT. tamSize ist die Marktgröße in Milliarden USD, nicht der Segmentumsatz.
- Kein marketShare, kein outperforming, kein „Über“, kein „Unter“. Anteil am TAM und vs. TAM werden lokal per Formel berechnet.
- Jedes genannte Segment muss für alle FEHLT-Felder eine Zahl haben. Eine Teilliste wird verworfen.`;
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
  const scoped = scopeSegments(args.segments);
  const eligible = eligibleTamNaSegments(args.segments);
  if (eligible.length === 0) {
    return { ok: false, status: 400, error: "Keine N/A-Zellen", code: "BAD_REQUEST" };
  }

  const coveragePct = echoCoverage(args.coveragePct);

  if (!deps.isLLMAvailable()) {
    return { ok: false, status: 503, error: "LLM nicht verfügbar", code: "LLM_UNAVAILABLE" };
  }

  const llm = await deps.callLLMJson({
    prompt: buildPrompt({ ...args, ticker }, eligible),
    maxTokens: 1200,
    temperature: 0.2,
    systemPrompt: "Du schätzt nur fehlende Segment-YoY- und TAM-Felder für genannte Segmente. Du lieferst kein marketShare und kein Über/Unter. Antworte ausschließlich mit JSON.",
  });
  if (!llm || llm.data == null) {
    return { ok: false, status: 502, error: "KI-Antwort fehlgeschlagen", code: "LLM_FAILED" };
  }

  const fills = validateTamNaFills(eligible, llm.data);
  if (countScopeRestNa(scoped, fills) !== 0) {
    return { ok: false, status: 422, error: INCOMPLETE_ERROR, code: "INCOMPLETE_FILL" };
  }

  return {
    ok: true,
    fills,
    coveragePct,
    coverageNote: catalogCoverageNote(coveragePct),
    modelUsed: llm.modelUsed,
  };
}
