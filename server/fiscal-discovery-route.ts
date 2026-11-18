/**
 * FW-34 — Lesen der Programme, die der Capex-Discovery-Workflow in die
 * Fiscal-Bridge geschrieben hat. Nur Anzeige, kein Score.
 */
import type { Express, Request, Response } from "express";
import { listDiscoveredFiscalPrograms } from "./fiscal-bridge";

export function registerFiscalDiscoveryRoute(app: Express): void {
  app.get("/api/researcher/fiscal-programs", (_req: Request, res: Response) => {
    const programs = listDiscoveredFiscalPrograms();
    res.json({
      count: programs.length,
      scoreEffect: "none",
      source: "fiscal-bridge",
      programs,
    });
  });
}
