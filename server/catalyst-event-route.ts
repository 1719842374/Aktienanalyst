/**
 * POST /api/catalyst-event — S17 „Event hinzufügen“ (WORK_DASHBOARD_FEATURES_2026-10.md §4b, Stufe 1).
 * Freitext → KI berechnet den Impact nach festem Schema (Variable, Delta, Horizont, Wahrscheinlichkeit,
 * Einpreisung); strukturierte Eingabe wird nur validiert. Antwort: ein zusätzlicher Catalyst
 * (shared/catalyst-event.ts, Formel wie catalyst-engine). Kein Score/DCF hier: Der Client hängt den
 * Katalysator an data.catalysts, die bestehenden Pfade rechnen weiter. analyze-route.ts wird nicht berührt.
 * Kein LLM / LLM-Fehler → 200 JSON { catalyst: null, reason }, nie 500.
 */
import type { Express } from "express";
import { callLLMJson } from "./llm-openrouter";
import { CATALYST_EVENT_VARIABLES, eventToCatalyst, validateCatalystEventImpact } from "../shared/catalyst-event";

type LLMJson = typeof callLLMJson;
export interface CatalystEventDeps { llm?: LLMJson }

export function buildCatalystEventPrompt(b: { ticker: string; companyName?: string; currency?: string; currentPrice?: number; text: string; existing?: string[] }): string {
  return [
    `Aktie: ${b.companyName || b.ticker} (${b.ticker}), Kurs ${b.currentPrice ?? "n/a"} ${b.currency ?? ""}.`,
    b.existing?.length ? `Bereits erfasste Katalysatoren: ${b.existing.join("; ")}.` : "",
    `Neues Event (z. B. aus dem letzten Earnings Call): """${b.text}"""`,
    `Schätze den Kursimpact dieses EINEN Events nüchtern und ohne Bias. Antworte NUR als JSON:`,
    `{"name": string (kurz), "variable": one of ${JSON.stringify(CATALYST_EVENT_VARIABLES)}, "deltaPct": number (Kursimpact in % bei Eintreten, negativ = Downside), "horizonMonths": number, "pos": number (Eintrittswahrscheinlichkeit 0-100), "einpreisungsgrad": number (0-100, wie weit schon im Kurs), "rationale": string (1-2 Sätze)}`,
  ].filter(Boolean).join("\n");
}

export function registerCatalystEventRoute(app: Express, deps: CatalystEventDeps = {}): void {
  const llm = deps.llm ?? callLLMJson;
  app.post("/api/catalyst-event", async (req, res) => {
    const b = req.body || {};
    const ticker = String(b.ticker || "").trim().toUpperCase();
    if (!ticker) return res.status(400).json({ catalyst: null, reason: "ticker_missing" });
    // Strukturierte Eingabe: kein LLM, nur Validierung
    if (b.structured) {
      const v = validateCatalystEventImpact(b.structured);
      if ("error" in v) return res.status(400).json({ catalyst: null, reason: "invalid_input", error: v.error });
      return res.json({ catalyst: eventToCatalyst(v.impact), impact: v.impact, source: "structured" });
    }
    const text = String(b.text || "").trim();
    if (text.length < 5) return res.status(400).json({ catalyst: null, reason: "text_missing" });
    try {
      const out = await llm({
        systemPrompt: "Du bist ein nüchterner Aktienanalyst. Du bewertest genau ein Event nach einem festen JSON-Schema.",
        prompt: buildCatalystEventPrompt({ ticker, companyName: b.companyName, currency: b.currency, currentPrice: Number(b.currentPrice) || undefined, text: text.slice(0, 2000), existing: Array.isArray(b.existing) ? b.existing.slice(0, 12).map(String) : [] }),
        maxTokens: 500,
        temperature: 0.2,
      });
      if (!out) return res.json({ catalyst: null, reason: "llm_unavailable" });
      const v = validateCatalystEventImpact(out.data);
      if ("error" in v) return res.json({ catalyst: null, reason: "llm_invalid", error: v.error });
      console.log(`[CATALYST-EVENT] ${ticker}: ${v.impact.name} Δ${v.impact.deltaPct}% PoS ${v.impact.pos}%`);
      return res.json({ catalyst: eventToCatalyst(v.impact), impact: v.impact, source: "llm", modelUsed: out.modelUsed });
    } catch (err: any) {
      console.warn(`[CATALYST-EVENT] ${ticker}: ${err?.message?.substring(0, 120)}`);
      return res.json({ catalyst: null, reason: "llm_error" });
    }
  });
}
