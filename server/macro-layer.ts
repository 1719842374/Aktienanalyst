/**
 * POST /api/recession/macro-layer — Future_9 Makro-Ebene als Zusatzobjekt (F9-09/12/13/16).
 *
 * Datenfluss: RecessionDashboard → useMacroLayer (apiRequest) → diese Route → shared/macro-layer.ts.
 * Eingabe: die bereits gelieferten Rezessions-Indikatoren (Body). Habitat: FRED DFII10 + DFF per
 * fetchFredCsv (fredgraph.csv, Retry). KI-Gewichte: callLLMJson (OpenRouter) nur mit Key, Cache 6 h,
 * sonst deterministisch. Wirft nie; Fehler → n/a. Ändert keine bestehenden Scores (recession.ts unberührt).
 */
import type { Express } from "express";
import { fetchFredCsv, fredCsvObservations, type FredObservation } from "./fred-csv";
import {
  buildMacroLayer,
  buildMacroWeightPrompt,
  calculateAdaptiveWeights,
  detectHabitat,
  emptyMacroLayer,
  macroWeightCacheKey,
  type MacroAiInfo,
  type MacroHabitat,
  type MacroIndicatorInput,
  type MacroLayer,
} from "@shared/macro-layer";

export const MACRO_REAL_YIELD_SERIES = "DFII10";
export const MACRO_FED_FUNDS_SERIES = "DFF";
/** F9-13: KI-Gewichte 6 h cachen (Spec: 6–12 h). */
export const MACRO_AI_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const MACRO_HABITAT_CACHE_TTL_MS = 60 * 60 * 1000;

type LlmFn = (opts: { prompt: string; maxTokens?: number; temperature?: number; systemPrompt?: string }) =>
  Promise<{ data: any; modelUsed: string } | null>;

export interface MacroLayerDeps {
  fetchCsv: (seriesId: string, cosd?: string) => Promise<string | null>;
  llmAvailable: () => boolean;
  llm: LlmFn;
  now: () => number;
}

const aiCache = new Map<string, { ts: number; data: unknown; model: string }>();
let habitatCache: { ts: number; habitat: MacroHabitat } | null = null;

export function resetMacroLayerCaches(): void {
  aiCache.clear();
  habitatCache = null;
}

function isoYearsBack(nowMs: number, years: number): string {
  const d = new Date(nowMs);
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

export async function loadMacroHabitat(deps: MacroLayerDeps): Promise<MacroHabitat> {
  const now = deps.now();
  if (habitatCache && now - habitatCache.ts < MACRO_HABITAT_CACHE_TTL_MS) return habitatCache.habitat;
  const safe = async (id: string, cosd: string): Promise<FredObservation[]> => {
    try { return fredCsvObservations(await deps.fetchCsv(id, cosd)); } catch { return []; }
  };
  const [ry, ff] = await Promise.all([
    safe(MACRO_REAL_YIELD_SERIES, isoYearsBack(now, 21)),
    safe(MACRO_FED_FUNDS_SERIES, isoYearsBack(now, 2)),
  ]);
  const habitat = detectHabitat({ realYieldMonthly: ry, fedFunds: ff, concentration: null });
  // Nur cachen, wenn mindestens eine Reihe kam; ein FRED-Ausfall soll beim nächsten Klick neu versuchen.
  if (ry.length || ff.length) habitatCache = { ts: now, habitat };
  return habitat;
}

export function sanitizeIndicators(body: unknown): MacroIndicatorInput[] {
  const list = (body as any)?.indicators;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).flatMap((i: any): MacroIndicatorInput[] => {
    if (!i || typeof i.name !== "string") return [];
    if (i.group !== "recession" && i.group !== "correction") return [];
    const ws = Number(i.weightedScore), mw = Number(i.maxWeighted);
    if (!Number.isFinite(ws) || !Number.isFinite(mw)) return [];
    return [{ name: i.name.slice(0, 80), group: i.group, weightedScore: ws, maxWeighted: mw, available: i.available === false ? false : undefined }];
  });
}

export async function computeMacroLayer(indicators: MacroIndicatorInput[], deps: MacroLayerDeps): Promise<MacroLayer> {
  const asOf = new Date(deps.now()).toISOString().slice(0, 10);
  try {
    if (!indicators.length) return emptyMacroLayer(asOf, "Keine Rezessions-Indikatoren übergeben – Makro-Ebene n/a");
    const habitat = await loadMacroHabitat(deps);
    const quant = calculateAdaptiveWeights(indicators, habitat);
    let ai: { suggestion: unknown; model: string | null; cached: boolean } | null = null;
    let aiStatus: MacroAiInfo["status"] = "no-key";
    if (deps.llmAvailable() && quant.dimensions.some(d => d.available)) {
      const key = macroWeightCacheKey(habitat, quant.dimensions);
      const hit = aiCache.get(key);
      if (hit && deps.now() - hit.ts < MACRO_AI_CACHE_TTL_MS) {
        ai = { suggestion: hit.data, model: hit.model, cached: true };
        aiStatus = "ok";
      } else {
        let res: { data: any; modelUsed: string } | null = null;
        try {
          res = await deps.llm({
            prompt: buildMacroWeightPrompt(habitat, quant.dimensions),
            maxTokens: 500,
            temperature: 0.2,
            systemPrompt: "Antworte nur mit gültigem JSON.",
          });
        } catch {
          res = null;
        }
        if (res && res.data && typeof res.data === "object") {
          ai = { suggestion: res.data, model: res.modelUsed ?? null, cached: false };
          aiStatus = "ok";
          aiCache.set(key, { ts: deps.now(), data: res.data, model: res.modelUsed ?? "" });
        } else {
          aiStatus = "failed";
        }
      }
    }
    return buildMacroLayer({ asOf, indicators, habitat, ai, aiStatus });
  } catch (err: any) {
    console.warn(`[MACRO-LAYER] failed: ${String(err?.message ?? err).slice(0, 200)}`);
    return emptyMacroLayer(asOf, "Makro-Ebene konnte nicht berechnet werden – n/a");
  }
}

export async function defaultMacroLayerDeps(): Promise<MacroLayerDeps> {
  const llm = await import("./llm-openrouter");
  return {
    fetchCsv: (id, cosd) => fetchFredCsv(id, cosd),
    llmAvailable: () => llm.isLLMAvailable(),
    llm: opts => llm.callLLMJson(opts),
    now: () => Date.now(),
  };
}

export function registerMacroLayerRoute(app: Express, depsOverride?: MacroLayerDeps): void {
  app.post("/api/recession/macro-layer", async (req, res) => {
    const deps = depsOverride ?? await defaultMacroLayerDeps();
    const layer = await computeMacroLayer(sanitizeIndicators(req.body), deps);
    res.json(layer);
  });
}
