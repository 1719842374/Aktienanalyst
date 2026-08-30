/**
 * Additive C1 P1 route. Mounted from routes-register.ts so researcher.ts stays untouched.
 * GET /api/researcher/sector-rotation — 6h cache tab sector-rotation, ?refresh=1 invalidates.
 */
import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import { fetchSectorRotationLive, SECTOR_ROTATION_CACHE_TAB } from "./sector-rotation";

const CACHE_DIR = path.join(process.cwd(), ".cache", "researcher");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
const RESEARCHER_TTL_MIN = 60 * 6;

function safeKey(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 80);
}
function researcherDiskKey(tab: string, params: string): string {
  return `${safeKey(tab)}__${safeKey(params)}`;
}

function deleteCache(tab: string, params: string): void {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {}
  try { diskResearcherDelete(researcherDiskKey(tab, params)); } catch {}
}

function readCache(tab: string, params: string): any | null {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      const cachedAt = parsed?._cachedAt ? new Date(parsed._cachedAt).getTime() : 0;
      const ageMin = (Date.now() - cachedAt) / 60000;
      if (ageMin < RESEARCHER_TTL_MIN) {
        parsed._cached = true;
        parsed._cacheAge = Math.round(ageMin);
        return parsed;
      }
    }
  } catch {}
  const fromDisk = diskResearcherGet(researcherDiskKey(tab, params));
  if (fromDisk) {
    fromDisk._cached = true;
    return fromDisk;
  }
  return null;
}

function writeCache(tab: string, params: string, data: any): void {
  const payload = { ...data, _cachedAt: new Date().toISOString() };
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  } catch {}
  try { diskResearcherSet(researcherDiskKey(tab, params), payload); } catch {}
}

export function registerSectorRotationRoute(app: Express): void {
  app.get("/api/researcher/sector-rotation", async (req, res) => {
    const q = req.query || {};
    const force = q.refresh === "1" || q.force === "1" || q.force === "true" || q.refresh === "true";
    const cacheParams = "global";
    if (force) {
      deleteCache(SECTOR_ROTATION_CACHE_TAB, cacheParams);
      console.log("[RESEARCHER/sector-rotation] cache invalidated (refresh/force)");
    }
    if (!force) {
      const cached = readCache(SECTOR_ROTATION_CACHE_TAB, cacheParams);
      if (cached) {
        console.log(`[RESEARCHER/sector-rotation] cache HIT age=${cached._cacheAge}min`);
        return res.json(cached);
      }
    }
    console.log("[RESEARCHER/sector-rotation] building");
    try {
      const result = await fetchSectorRotationLive();
      writeCache(SECTOR_ROTATION_CACHE_TAB, cacheParams, result);
      res.json(result);
    } catch (err: any) {
      const message = err?.message || "sector-rotation failed";
      console.error("[RESEARCHER/sector-rotation] failed:", message);
      res.status(500).json({ error: message });
    }
  });
}
