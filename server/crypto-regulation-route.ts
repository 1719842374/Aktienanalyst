/**
 * Krypto-Regulierungen. Gleiches Muster wie die Researcher-Routen:
 * eigene Datei, Registrierung in routes-register.ts, Force-Body, OpenRouter
 * nur über runPolicyScan -> callLLMJson.
 */
import type { Express } from "express";
import { isLLMAvailable } from "./llm-openrouter";
import { runPolicyScan } from "./policy-scan";

function wantsForce(value: unknown): boolean {
  return value === true || value === "true" || value === "1";
}

export function registerCryptoRegulationRoute(app: Express): void {
  app.post("/api/analyze-btc/policy-scan", async (req, res) => {
    try {
      const body = req.body ?? {};
      const q = req.query ?? {};
      const jurisdiction = typeof body.jurisdiction === "string" ? body.jurisdiction : "US";
      const force = wantsForce(body.force) || wantsForce(q.force) || wantsForce(q.refresh);
      const data = await runPolicyScan({ jurisdiction, force });
      res.json(data);
    } catch (err: any) {
      console.error("[POST /api/analyze-btc/policy-scan]", err?.message?.substring(0, 200));
      res.status(502).json({ error: "Krypto-Regulierungsanalyse nicht verfügbar", llmAvailable: isLLMAvailable() });
    }
  });
}
