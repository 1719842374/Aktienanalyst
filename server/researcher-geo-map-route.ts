/**
 * Additive Route (Offen_WORK_CAPEX_SECTOR_MAP.md, Slice 1). Mounted from routes-register.ts,
 * researcher.ts bleibt unberührt. GET /api/researcher/geo-map?layer=capex — 24h Cache, ?refresh=1 invalidiert.
 * Nur Anzeige, kein Score.
 */
import type { Express } from "express";
import * as fs from "fs";
import * as path from "path";
import { diskResearcherGet, diskResearcherSet, diskResearcherDelete } from "./disk-cache";
import { buildGeoMapCapex, defaultGeoMapDeps, GEO_MAP_CACHE_TAB, type GeoMapDeps } from "./researcher-geo-map";

const CACHE_DIR = path.join(process.cwd(), ".cache", "researcher");
const TTL_MIN = 60 * 24;
const PARAMS = "global";
const fileFor = () => path.join(CACHE_DIR, `${GEO_MAP_CACHE_TAB}__${PARAMS}.json`);
const diskKey = `${GEO_MAP_CACHE_TAB}__${PARAMS}`;

function readCache(): any | null {
  try {
    const f = fileFor();
    if (fs.existsSync(f)) {
      const parsed = JSON.parse(fs.readFileSync(f, "utf-8"));
      const ageMin = (Date.now() - (parsed?._cachedAt ? new Date(parsed._cachedAt).getTime() : 0)) / 60000;
      if (ageMin < TTL_MIN) return { ...parsed, _cached: true, _cacheAge: Math.round(ageMin) };
    }
  } catch {}
  const d = diskResearcherGet(diskKey);
  if (d) {
    const ageMin = (Date.now() - (d?._cachedAt ? new Date(d._cachedAt).getTime() : 0)) / 60000;
    if (ageMin < TTL_MIN) return { ...d, _cached: true, _cacheAge: Math.round(ageMin) };
  }
  return null;
}
function writeCache(data: any): void {
  const payload = { ...data, _cachedAt: new Date().toISOString() };
  try { if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(fileFor(), JSON.stringify(payload, null, 2)); } catch {}
  try { diskResearcherSet(diskKey, payload); } catch {}
}
function deleteCache(): void {
  try { if (fs.existsSync(fileFor())) fs.unlinkSync(fileFor()); } catch {}
  try { diskResearcherDelete(diskKey); } catch {}
}

export function registerGeoMapRoute(app: Express, deps: GeoMapDeps = defaultGeoMapDeps, opts: { useCache?: boolean } = {}): void {
  const useCache = opts.useCache !== false;
  let inflight: Promise<any> | null = null;
  app.get("/api/researcher/geo-map", async (req, res) => {
    const layer = String(req.query?.layer ?? "capex");
    if (layer !== "capex") {
      return res.status(400).json({ error: `layer=${layer} noch nicht verfügbar (Slice 1: nur capex)` });
    }
    const force = req.query?.refresh === "1" || req.query?.refresh === "true";
    if (useCache && force) deleteCache();
    if (useCache && !force) {
      const cached = readCache();
      if (cached) return res.json(cached);
    }
    try {
      if (!inflight) inflight = buildGeoMapCapex(deps).finally(() => { inflight = null; });
      const result = await inflight;
      // nur cachen, wenn mindestens ein Land echte Daten hat (sonst n/a nicht 24h festschreiben)
      if (useCache && result.coverage.withData > 0) writeCache(result);
      res.json(result);
    } catch (err: any) {
      console.error("[RESEARCHER/geo-map] failed:", err?.message);
      res.status(500).json({ error: err?.message || "geo-map failed" });
    }
  });
}
