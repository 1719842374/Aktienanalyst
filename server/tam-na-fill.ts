/**
 * POST /api/analyze/:ticker/tam-na-fill
 *
 * Thin LLM helper for visible Segment-TAM n/a cells (Spec v2 + Philip format lock).
 * The prompt is the Section7 matrix: German column headers, every row label
 * (including the Rest row when it is on screen), and Fact vs n/a per cell.
 * Wachstum n/a is estimated. Unmatched TAM/CAGR are estimated.
 * Anteil am TAM and vs. TAM are formula-only (shared/tam-na-fill.ts).
 *
 * Partial-apply: a fill is returned when it closes at least one in-scope cell
 * (Wachstum · TAM · CAGR, plus the local Anteil-am-TAM / vs.-TAM formulas).
 * Other cells stay n/a. 422 INCOMPLETE_FILL only when the model returns
 * nothing usable. Rows with revenue null or 0 are omitted from the prompt.
 * Does not write the fact cache and does not recompute catalog coverage,
 * quality, tamTotal, segmentWeightedGrowth, or the DCF gate.
 */

import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import {
  TAM_NA_COLUMN_HEADER,
  applicableTamNaFills,
  catalogCoverageNote,
  describeTamNaMatrixRow,
  hasPositiveSegmentRevenue,
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
const REST_ROW_LABEL = "Other / nicht segmentiert";

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
  if (!hasPositiveSegmentRevenue(seg.segmentRevenue)) return null;
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

function scopeSegments(segments: TamNaFillRequestSegment[]): TamNaSegmentRef[] {
  const out: TamNaSegmentRef[] = [];
  const seen = new Set<string>();
  for (const seg of segments) {
    const ref = asRef(seg);
    if (!ref || seen.has(ref.segmentName)) continue;
    seen.add(ref.segmentName);
    out.push(ref);
    if (out.length >= MAX_SEGMENTS) break;
  }
  return out;
}

/** Rows the model must answer. Fact-complete rows stay in the prompt, but are not required fills. */
export function eligibleTamNaSegments(segments: TamNaFillRequestSegment[]): TamNaSegmentRef[] {
  const out: TamNaSegmentRef[] = [];
  for (const ref of scopeSegments(segments)) {
    if (!segmentNeedsLlm(ref)) continue;
    out.push(ref);
    if (out.length >= MAX_SEGMENTS) break;
  }
  return out;
}

export function buildTamNaFillPrompt(args: TamNaFillArgs, rows: TamNaSegmentRef[]): string {
  const lines = rows.map((s) => {
    const src = args.segments.find((x) => typeof x.segmentName === "string" && x.segmentName.trim() === s.segmentName);
    const share = src && typeof src.segmentShare === "number" && Number.isFinite(src.segmentShare) ? src.segmentShare : null;
    const cells = describeTamNaMatrixRow(s, share);
    return `| ${cells.segment} | ${cells.rev} | ${cells.anteil} | ${cells.wachstum} | ${cells.tam} | ${cells.cagr} | ${cells.anteilAmTam} | ${cells.vsTam} |`;
  }).join("\n");
  const rest = rows.some((s) => s.segmentName === REST_ROW_LABEL)
    ? `Rest-Zeile (sichtbar): ${REST_ROW_LABEL}\n`
    : "";
  const profile = clip(args.description, 500);
  return `Schätze nur die n/a-Zellen der Tabelle Segment-TAM-Analyse. Fact-Zahlen nicht überschreiben.

UNTERNEHMEN: ${clip(args.companyName, 120) || args.ticker} (${args.ticker})
SEKTOR: ${clip(args.sector, 80) || "n/a"} | BRANCHE: ${clip(args.industry, 80) || "n/a"}
${profile ? `PROFIL: ${profile}\n` : ""}
TABELLE Segment-TAM-Analyse
Spalten: ${TAM_NA_COLUMN_HEADER}
${rest}
| ${TAM_NA_COLUMN_HEADER} |
${lines}

Antworte ausschließlich mit JSON. segmentName ist exakt der Wert aus der Spalte Segment:
{"fills":[{"segmentName":"<Segment>","segmentGrowth":<YoY % nur wenn Wachstum n/a>,"tamSize":<Mrd. USD nur wenn TAM n/a>,"tamCAGR":<Branchen-CAGR % nur wenn CAGR n/a>,"tamLabel":"<Marktname nur wenn TAM n/a>","tamSource":"<Quelle nur wenn TAM n/a>","confidence":"low"|"med"|"high","rationale":"<max 140 Zeichen>"}]}

REGELN:
- Jede Zeile mit n/a in Wachstum, TAM oder CAGR soll in fills stehen, soweit eine belegbare Zahl vorliegt. Zeilen ohne Beleg weglassen; die übrigen fills bleiben gültig.
- segmentGrowth mappt auf Wachstum. Nur wenn die Zelle n/a ist. Das ist das Segment-YoY in Prozent, nicht die Branchen-CAGR. Eine Fact-Zahl nicht ersetzen.
- tamSize mappt auf TAM, tamCAGR auf CAGR. Nur wenn die Zelle n/a ist. tamSize ist die Marktgröße in Milliarden USD, nicht Rev.
- Anteil am TAM und vs. TAM sind lokale Formeln. Nicht schätzen und nicht ins JSON schreiben. Kein Über, kein Unter.
- Rev. und Anteil (Mix) nicht schätzen und nicht überschreiben.
- Nur Segment-Namen aus der Tabelle. Keine zusätzlichen Zeilen.`;
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
  const eligible = scoped.filter(segmentNeedsLlm);
  if (eligible.length === 0) {
    return { ok: false, status: 400, error: "Keine N/A-Zellen", code: "BAD_REQUEST" };
  }

  const coveragePct = echoCoverage(args.coveragePct);

  if (!deps.isLLMAvailable()) {
    return { ok: false, status: 503, error: "LLM nicht verfügbar", code: "LLM_UNAVAILABLE" };
  }

  const llm = await deps.callLLMJson({
    prompt: buildTamNaFillPrompt({ ...args, ticker }, scoped),
    maxTokens: 2000,
    temperature: 0.2,
    systemPrompt: "Du füllst n/a-Zellen der Tabelle Segment-TAM-Analyse. Spalten: Segment, Rev., Anteil, Wachstum, TAM, CAGR, Anteil am TAM, vs. TAM. Du überschreibst keine Fact-Zahl. Anteil am TAM und vs. TAM lieferst du nicht. Antworte ausschließlich mit JSON.",
  });
  if (!llm || llm.data == null) {
    return { ok: false, status: 502, error: "KI-Antwort fehlgeschlagen", code: "LLM_FAILED" };
  }

  const fills = applicableTamNaFills(eligible, validateTamNaFills(eligible, llm.data));
  if (fills.length === 0) {
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
