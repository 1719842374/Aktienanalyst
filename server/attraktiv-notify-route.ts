/**
 * GET /api/attraktiv-notify/status — zeigt, dass der Versand aus ist.
 * POST nimmt einen Payload an und gibt ihn ungesendet zurück.
 * Kein Env-Schreiben, kein Mail-Call, kein Supabase-Call.
 */
import type { Express, Request, Response } from "express";
import { attraktivEmailStatus, buildAttraktivMail } from "../shared/attraktiv-notify";

export function registerAttraktivNotifyRoute(app: Express): void {
  app.get("/api/attraktiv-notify/status", (_req: Request, res: Response) => {
    res.json(attraktivEmailStatus(process.env));
  });
  app.post("/api/attraktiv-notify", (req: Request, res: Response) => {
    const status = attraktivEmailStatus(process.env);
    const built = buildAttraktivMail({
      to: typeof req.body?.to === "string" ? req.body.to : null,
      ticker: typeof req.body?.ticker === "string" ? req.body.ticker : null,
      status: typeof req.body?.status === "string" ? req.body.status : null,
      score: typeof req.body?.score === "number" ? req.body.score : null,
      reason: typeof req.body?.reason === "string" ? req.body.reason : null,
      link: typeof req.body?.link === "string" ? req.body.link : null,
    });
    res.json({ ...status, ...built, sent: false });
  });
}