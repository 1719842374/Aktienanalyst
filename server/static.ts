import express, { type Express } from "express";
import fs from "fs";
import path from "path";

// index.html references the hashed bundles, so it must be revalidated on every load (no-cache):
// otherwise a browser keeps an old index.html that points at bundles a new deploy no longer has.
// Vite's hashed files under /assets never change their content -> cache for a year, immutable.
export const INDEX_CACHE_CONTROL = "no-cache";
export const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function staticCacheControl(filePath: string): string | null {
  const normalized = filePath.split(path.sep).join("/");
  if (normalized.endsWith("/index.html") || normalized === "index.html") return INDEX_CACHE_CONTROL;
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/i.test(normalized)) return ASSET_CACHE_CONTROL;
  return null;
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      const cc = staticCacheControl(filePath);
      if (cc) res.setHeader("Cache-Control", cc);
    },
  }));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.setHeader("Cache-Control", INDEX_CACHE_CONTROL);
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
