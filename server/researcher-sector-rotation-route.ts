/**
 * Additive C1 P1 route. Mounted from routes-register.ts so researcher.ts stays untouched.
 * GET /api/researcher/sector-rotation — 6h cache tab sector-rotation, ?refresh=1 invalidates.
 */
import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import {
  fetchSectorRotationLive,
  SECTOR_ROTATION_CACHE_TAB,
  attachSectorAttrBands,
  attractivenessFromSnapshot,
} from "./sector-rotation";

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

/** Letzter Snapshot unabhängig von der 6h-TTL — Quelle für Δ-Pfeile. */
function readLastSnapshot(tab: string, params: string): any | null {
  try {
    const file = path.join(CACHE_DIR, `${safeKey(tab)}__${safeKey(params)}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch { /* Datei optional */ }
  try { return diskResearcherGet(researcherDiskKey(tab, params)); } catch { return null; }
}

function ensureAttrBands(cached: any): any {
  const sectors = cached?.sectors;
  if (!Array.isArray(sectors) || sectors.length === 0) return cached;
  if (sectors.every((s: { attrBand?: string }) => typeof s?.attrBand === "string")) return cached;
  // Alter Cache ohne Ampel-Felder: Perzentil aus den gespeicherten Zahlen,
  // kein Vergleich mit sich selbst (das würde Δ = 0 und falsche Pfeile erzeugen).
  return attachSectorAttrBands(cached, null);
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
    // Vor dem Löschen lesen, sonst gibt es keinen Vorwert für die Δ-Pfeile.
    const previousSnapshot = readLastSnapshot(SECTOR_ROTATION_CACHE_TAB, cacheParams);
    if (force) {
      deleteCache(SECTOR_ROTATION_CACHE_TAB, cacheParams);
      console.log("[RESEARCHER/sector-rotation] cache invalidated (refresh/force)");
    }
    if (!force) {
      const cached = readCache(SECTOR_ROTATION_CACHE_TAB, cacheParams);
      if (cached) {
        console.log(`[RESEARCHER/sector-rotation] cache HIT age=${cached._cacheAge}min`);
        return res.json(ensureAttrBands(cached));
      }
    }
    console.log("[RESEARCHER/sector-rotation] building");
    try {
      const result = await fetchSectorRotationLive();
      const enriched = attachSectorAttrBands(result, attractivenessFromSnapshot(previousSnapshot));
      writeCache(SECTOR_ROTATION_CACHE_TAB, cacheParams, enriched);
      res.json(enriched);
    } catch (err: any) {
      const message = err?.message || "sector-rotation failed";
      console.error("[RESEARCHER/sector-rotation] failed:", message);
      res.status(500).json({ error: message });
    }
  });
}
