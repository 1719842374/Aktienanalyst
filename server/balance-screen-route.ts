/**
 * POST /api/balance-screen — FW-27.
 * Der Client liest die Datei und schickt den Text. Nichts wird auf die Platte geschrieben.
 * Kein Score, analyze-route bleibt außen vor.
 */
import type { Express, Request, Response } from "express";
import { screenBalanceCsv } from "../shared/balance-screen";

const MAX_CSV_CHARS = 200_000;

export function registerBalanceScreenRoute(app: Express): void {
  app.post("/api/balance-screen", (req: Request, res: Response) => {
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    if (!csv.trim()) {
      res.status(400).json({ error: "n/a — CSV fehlt" });
      return;
    }
    if (csv.length > MAX_CSV_CHARS) {
      res.status(400).json({ error: "n/a — CSV ist zu groß" });
      return;
    }
    const result = screenBalanceCsv(csv);
    if (result.error) {
      res.status(400).json({ error: result.error, rowCount: 0, flags: [], note: result.note });
      return;
    }
    res.json({ rowCount: result.rowCount, flags: result.flags, note: result.note });
  });
}
