/**
 * JSON 404 for unknown /api/* paths. Registered after every API route and before the static/SPA
 * fallback (server/index.ts). Without it a missing route answers 200 + index.html, which is how
 * /api/export-pdf, /api/refresh-risks, /api/watchlist and /api/search-ticker went unnoticed for months.
 */
import type { Express, Request, Response } from "express";

export function apiNotFoundBody(req: Pick<Request, "method" | "originalUrl">) {
  return { error: "not_found", message: `Unknown API route: ${req.method} ${req.originalUrl.split("?")[0]}` };
}

export function registerApiNotFound(app: Express): void {
  app.use("/api", (req: Request, res: Response) => {
    res.status(404).json(apiNotFoundBody(req));
  });
}
