/**
 * GET /api/segment-supplement/:ticker — Wachstum aus der Segmenthistorie, Unterposten nur bei Zuordnung.
 * Keine neuen Top-Level-Segmente. Nur Anzeige.
 */
import type { Express, Request, Response } from "express";
import { fmpProductSegmentationRaw } from "./fmp";
import { callLLMJson, isLLMAvailable } from "./llm-openrouter";
import { attachSubItemEstimates } from "../shared/segment-estimate";
import { buildSegmentSupplement, type OfficialSegment, type SegmentYearPoint } from "../shared/segment-supplement";

const ESTIMATE_SYSTEM = [
  "Du ergänzt nur nicht ausgewiesene Unterposten unter einem gemeldeten Segment.",
  "Antworte nur mit JSON: {\"items\":[{\"parent\":string,\"name\":string,\"shareOfParentPct\":number|null,\"note\":string}]}.",
  "shareOfParentPct ist der Anteil am Elternsegment in Prozent, nicht am Gesamtumsatz.",
  "Wenn du den Anteil nicht beziffern kannst, setze shareOfParentPct auf null und schreibe den Grund in note. Fülle die Lücke nicht mit einer gerundeten Zahl.",
  "Erfinde keine neue Top-Level-Sparte. Höchstens ein Unterposten je Elternsegment.",
].join(" ");

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function historyFromRaw(raw: unknown[]): { history: SegmentYearPoint[]; latest: { name: string; revenue: number | null }[] } {
  const history: SegmentYearPoint[] = [];
  const rows = raw.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
  for (const row of rows) {
    const year = String(row.fiscalYear ?? (typeof row.date === "string" ? row.date.slice(0, 4) : ""));
    const data = row.data && typeof row.data === "object" ? row.data as Record<string, unknown> : row;
    for (const [name, value] of Object.entries(data)) {
      if (["symbol", "date", "fiscalYear", "period", "reportedCurrency", "data"].includes(name)) continue;
      const revenue = num(value);
      if (!year || revenue == null) continue;
      history.push({ fiscalYear: year, name, revenue });
    }
  }
  const years = Array.from(new Set(history.map(h => h.fiscalYear))).sort();
  const latestYear = years[years.length - 1];
  const latest = history.filter(h => h.fiscalYear === latestYear).map(h => ({ name: h.name, revenue: h.revenue }));
  return { history, latest };
}

type LlmResult = { data: unknown; modelUsed: string } | null;

export async function loadSegmentSupplement(
  ticker: string,
  official: OfficialSegment[],
  deps: {
    raw: (t: string) => Promise<unknown[]>;
    llmAvailable: () => boolean;
    llm: (prompt: string) => Promise<LlmResult>;
  } = {
    raw: fmpProductSegmentationRaw,
    llmAvailable: isLLMAvailable,
    llm: (prompt) => callLLMJson({ prompt, systemPrompt: ESTIMATE_SYSTEM, maxTokens: 700, temperature: 0.2 }),
  },
) {
  let base;
  try {
    const raw = await deps.raw(ticker);
    const { history, latest } = historyFromRaw(raw);
    base = buildSegmentSupplement(official, history, latest);
  } catch (err: any) {
    const empty = buildSegmentSupplement(official, [], []);
    base = {
      ...empty,
      undisclosedNote: `n/a — Segmenthistorie nicht erreichbar${err?.fmpStatus ? ` (HTTP ${err.fmpStatus})` : ""}. ${empty.undisclosedNote}`,
    };
  }
  const normName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const covered = new Set(base.subItems.map(i => normName(i.parent)));
  const open = official.some(s => !covered.has(normName(s.name)));
  if (!open) return { ticker, ...attachSubItemEstimates(base, official, { available: true, data: { items: [] } }), source: "fmp" as const };
  if (!deps.llmAvailable()) {
    return { ticker, ...attachSubItemEstimates(base, official, { available: false, data: null }), source: "fmp" as const };
  }
  let data: unknown | null = null;
  try {
    const lines = official.map(s => `${s.name}: Anteil ${s.percentage ?? "n/a"} %, YoY ${s.growthPct ?? "n/a"}`).join("\n");
    const res = await deps.llm(`Ticker ${ticker}. Gemeldete Segmente, Summe der Anteile bleibt unverändert:\n${lines}\nNur Unterposten ohne eigene ausgewiesene Zeile.`);
    data = res?.data ?? null;
  } catch {
    data = null;
  }
  return { ticker, ...attachSubItemEstimates(base, official, { available: true, data }), source: "fmp" as const };
}

export function registerSegmentSupplementRoute(app: Express): void {
  app.post("/api/segment-supplement", async (req: Request, res: Response) => {
    const ticker = String(req.body?.ticker ?? "").trim().toUpperCase();
    if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: "Ungültiger Ticker" });
    const list = Array.isArray(req.body?.segments) ? req.body.segments : [];
    const official: OfficialSegment[] = list
      .filter((s: unknown): s is { name: string } => !!s && typeof (s as { name?: unknown }).name === "string")
      .map((s: { name: string; percentage?: unknown; growthPct?: unknown }) => ({
        name: s.name,
        percentage: typeof s.percentage === "number" ? s.percentage : null,
        growthPct: typeof s.growthPct === "number" ? s.growthPct : null,
      }));
    res.json(await loadSegmentSupplement(ticker, official));
  });
}
