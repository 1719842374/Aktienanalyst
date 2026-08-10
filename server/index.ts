// Load .env first so OPENROUTER_API_KEY (and any other secrets) are
// available to all downstream modules before they read process.env.
import "dotenv/config";

// API keys are loaded from .env file (see dotenv/config import above).
// Required keys: OPENROUTER_API_KEY, FMP_API_KEY
// Set them in .env (not committed to git) or as environment variables.

import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes-register";
import { serveStatic } from "./static";
import { createServer } from "http";

// Guard against an unhandled rejection or exception anywhere in the app
// (e.g. a background job like the 13F screener build) taking down the whole
// process. Without this, Node's default behavior is to crash on an unhandled
// rejection, which on Render means the entire server becomes unreachable
// (including unrelated endpoints like /api/health) until the platform
// restarts the instance — observed live on 2026-08-10 after the screener's
// background build ran unattended for several minutes under SEC rate-limit
// retries. Logging and continuing is safe here: individual request handlers
// already have their own try/catch and return proper error responses: this
// is a last-resort net for anything that slips through.
process.on("unhandledRejection", (reason: any) => {
  console.error(`[FATAL-GUARD] Unhandled promise rejection (process kept alive): ${reason?.stack || reason}`);
});
process.on("uncaughtException", (error: any) => {
  console.error(`[FATAL-GUARD] Uncaught exception (process kept alive): ${error?.stack || error}`);
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: '10mb', // Needed for PDF export (full analysis data)
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

// ── Keep-Alive Health Endpoint ──────────────────────────────────────────────
// Registered BEFORE registerRoutes so it is always available even during
// heavy analysis requests.
//
// Pinged every 5 min by .github/workflows/keep-alive.yml (GitHub Actions cron)
// to prevent Render free-plan cold starts (Render sleeps after 15 min idle).
// pplx.app (aktienanalyst-pro.pplx.app) does not need keep-alive pings.
//
// Returns 200 JSON within <5 ms — no DB, no FMP calls, no quota impact.
const _serverStartTime = Date.now();
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    uptime: Math.floor((Date.now() - _serverStartTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});
// ────────────────────────────────────────────────────────────────────────────

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
