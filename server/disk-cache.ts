// Persistent disk cache for stock analyses + researcher tabs.
// Uses SQLite (better-sqlite3) so data survives container restarts on pplx.app.
// pplx.app persists files at the project root (data.db) across redeployments.
// Falls back to a no-op if SQLite cannot open (e.g. read-only FS).
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "data.db");
const CACHE_TTL_DAYS = 7;
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

let db: Database.Database | null = null;
let initFailed = false;

function getDb(): Database.Database | null {
  if (db) return db;
  if (initFailed) return null;
  try {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_cache (
        ticker TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS researcher_cache (
        cache_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    console.log(`[DiskCache] SQLite opened at ${DB_PATH}`);
    return db;
  } catch (err: any) {
    initFailed = true;
    console.warn(`[DiskCache] SQLite unavailable: ${err?.message} — running without disk persistence`);
    return null;
  }
}

export function diskCacheGet(ticker: string): any | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare("SELECT data, updated_at FROM analysis_cache WHERE ticker = ?").get(ticker) as any;
    if (!row) return null;
    const age = Date.now() - row.updated_at;
    if (age > CACHE_TTL_MS) {
      d.prepare("DELETE FROM analysis_cache WHERE ticker = ?").run(ticker);
      return null;
    }
    const data = JSON.parse(row.data);
    return {
      ...data,
      _cached: true,
      _cacheAge: Math.round(age / 60000),
      _cacheDate: new Date(row.updated_at).toISOString(),
      _diskCache: true,
    };
  } catch (err: any) {
    console.warn(`[DiskCache] Read error for ${ticker}: ${err?.message}`);
    return null;
  }
}

export function diskCacheSet(ticker: string, data: any): void {
  const d = getDb();
  if (!d) return;
  try {
    const now = Date.now();
    const { _cached, _cacheAge, _cacheDate, _diskCache, ...clean } = data || {};
    d.prepare(`
      INSERT INTO analysis_cache (ticker, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(ticker, JSON.stringify(clean), now, now);
  } catch (err: any) {
    console.warn(`[DiskCache] Write error for ${ticker}: ${err?.message}`);
  }
}

export function diskCacheDelete(ticker: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare("DELETE FROM analysis_cache WHERE ticker = ?").run(ticker);
  } catch {}
}

export function diskCacheList(): Array<{ ticker: string; cachedAt: string; ageMinutes: number; sizeKB: number }> {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d.prepare(
      "SELECT ticker, updated_at, LENGTH(data) AS size FROM analysis_cache WHERE updated_at > ?"
    ).all(Date.now() - CACHE_TTL_MS) as any[];
    return rows.map(r => ({
      ticker: r.ticker,
      cachedAt: new Date(r.updated_at).toISOString(),
      ageMinutes: Math.round((Date.now() - r.updated_at) / 60000),
      sizeKB: Math.round((r.size || 0) / 1024),
    }));
  } catch {
    return [];
  }
}

// === Researcher cache (tabs: macro, sectors, screener, capex, briefing) ===
export function diskResearcherGet(key: string): any | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare("SELECT data, updated_at FROM researcher_cache WHERE cache_key = ?").get(key) as any;
    if (!row) return null;
    const age = Date.now() - row.updated_at;
    if (age > CACHE_TTL_MS) {
      d.prepare("DELETE FROM researcher_cache WHERE cache_key = ?").run(key);
      return null;
    }
    return { ...JSON.parse(row.data), _cacheAge: Math.round(age / 60000) };
  } catch {
    return null;
  }
}

export function diskResearcherSet(key: string, data: any): void {
  const d = getDb();
  if (!d) return;
  try {
    const now = Date.now();
    d.prepare(`
      INSERT INTO researcher_cache (cache_key, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(data), now, now);
  } catch {}
}

export function diskResearcherDelete(key: string): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare("DELETE FROM researcher_cache WHERE cache_key = ?").run(key);
  } catch {}
}
