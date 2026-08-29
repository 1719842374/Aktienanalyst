// Persistent disk cache for stock analyses + researcher tabs.
// Uses SQLite (better-sqlite3) so data survives container restarts on pplx.app.
// pplx.app persists files at the project root (data.db) across redeployments.
// Falls back to a no-op if SQLite cannot open (e.g. read-only FS).
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "data.db");
const CACHE_TTL_DAYS = 7;
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
// Bump this string whenever DCF formulas, field names or Rechenweg-Labels change.
// Any cached entry with a different version will be silently invalidated.
const CACHE_SCHEMA_VERSION = "2026-08-29-v2"; // Bumped: L2 key = analyze cacheKey; keep short HP instead of drop
// Researcher cache TTL: 1 day (was 7) — keep macro/fiscal/capex data fresh.
const RESEARCHER_CACHE_TTL_MS = 1 * 24 * 60 * 60 * 1000;

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

    // Startup: drop only unreadable JSON. Short historicalPrices stay —
    // analyze-route refetches OHLCV on L2 hit (_needsOhlcv) and reuses KI text.
    try {
      const allRows = db.prepare('SELECT ticker, data FROM analysis_cache').all() as Array<{ ticker: string; data: string }>;
      let cleaned = 0;
      let shortHp = 0;
      for (const row of allRows) {
        try {
          const parsed = JSON.parse(row.data);
          const hp = parsed?.historicalPrices;
          if (!hp || (Array.isArray(hp) && hp.length < 50)) shortHp++;
        } catch { db.prepare('DELETE FROM analysis_cache WHERE ticker = ?').run(row.ticker); cleaned++; }
      }
      if (cleaned > 0 || shortHp > 0) {
        console.log(`[DiskCache] Startup: removed ${cleaned} corrupt rows, ${shortHp} short-HP rows kept for KI reuse`);
      }
    } catch (cleanErr: any) {
      console.warn(`[DiskCache] Startup cleanup failed: ${cleanErr?.message}`);
    }

    try {
      const seedPath = path.join(process.cwd(), 'cache-seed.json');
      const fs = require('fs');
      if (fs.existsSync(seedPath)) {
        const rawSeeds = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        const seeds: Array<{ ticker: string; data: any }> = Array.isArray(rawSeeds)
          ? rawSeeds.map((s: any) => ({
              ticker: s.ticker,
              data: s.data ?? s,
            }))
          : [];
        const upsert = db.prepare(`
          INSERT INTO analysis_cache (ticker, data, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(ticker) DO NOTHING
        `);
        const now = Date.now();
        let loaded = 0;
        for (const seed of seeds) {
          if (!seed.ticker) continue;
          try {
            const versioned = { ...seed.data, _schemaVersion: CACHE_SCHEMA_VERSION };
            const seedKey = seed.ticker.startsWith("analyze:") ? seed.ticker : seed.ticker.toUpperCase();
            upsert.run(seedKey, JSON.stringify(versioned), now, now);
            loaded++;
          } catch { /* ignore */ }
        }
        console.log(`[DiskCache] Merged ${loaded} seed entries from cache-seed.json`);
      }
    } catch (seedErr: any) {
      console.warn(`[DiskCache] Seed load failed: ${seedErr?.message}`);
    }
    return db;
  } catch (err: any) {
    initFailed = true;
    console.warn(`[DiskCache] SQLite unavailable: ${err?.message} — running without disk persistence`);
    return null;
  }
}

function lookupAnalysisRow(d: Database.Database, key: string): { data: string; updated_at: number } | null {
  const direct = d.prepare("SELECT data, updated_at FROM analysis_cache WHERE ticker = ?").get(key) as any;
  if (direct) return direct;
  if (key.startsWith("analyze:") && !key.includes(":peers:")) {
    const parts = key.split(":");
    const bare = parts[1];
    if (bare) {
      const legacy = d.prepare("SELECT data, updated_at FROM analysis_cache WHERE ticker = ?").get(bare) as any;
      if (legacy) return legacy;
    }
  }
  return null;
}

export function diskCacheGet(ticker: string): any | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = lookupAnalysisRow(d, ticker);
    if (!row) return null;
    const age = Date.now() - row.updated_at;
    if (age > CACHE_TTL_MS) {
      d.prepare("DELETE FROM analysis_cache WHERE ticker = ?").run(ticker);
      return null;
    }
    const data = JSON.parse(row.data);
    if (data._schemaVersion && data._schemaVersion !== CACHE_SCHEMA_VERSION) {
      d.prepare("DELETE FROM analysis_cache WHERE ticker = ?").run(ticker);
      console.log(`[DiskCache] Invalidated ${ticker}: schema ${data._schemaVersion} ≠ ${CACHE_SCHEMA_VERSION}`);
      return null;
    }
    const hp = data.historicalPrices;
    const hpLen = Array.isArray(hp) ? hp.length : 0;
    const needsOhlcv = !hp || hpLen < 50;
    if (needsOhlcv) {
      console.log(`[DiskCache] ${ticker}: short historicalPrices (${hpLen} < 50) — serve KI payload, flag _needsOhlcv`);
    }
    return {
      ...data,
      _cached: true,
      _cacheAge: Math.round(age / 60000),
      _cacheDate: new Date(row.updated_at).toISOString(),
      _diskCache: true,
      _needsOhlcv: needsOhlcv,
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
    const { _cached, _cacheAge, _cacheDate, _diskCache, _schemaVersion: _sv, ...clean } = data || {};
    const versioned = { ...clean, _schemaVersion: CACHE_SCHEMA_VERSION };
    d.prepare(`
      INSERT INTO analysis_cache (ticker, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(ticker, JSON.stringify(versioned), now, now);
    exportCacheSeed(d);
  } catch (err: any) {
    console.warn(`[DiskCache] Write error for ${ticker}: ${err?.message}`);
  }
}

function exportCacheSeed(d: Database.Database): void {
  try {
    const fs = require('fs');
    const seedPath = path.join(process.cwd(), 'cache-seed.json');
    const rows = d.prepare(
      'SELECT ticker, data FROM analysis_cache WHERE updated_at > ?'
    ).all(Date.now() - CACHE_TTL_MS) as Array<{ ticker: string; data: string }>;
    const seeds = rows
      .map(r => {
        try {
          const parsed = JSON.parse(r.data);
          const { _cached, _cacheAge, _cacheDate, _diskCache, _needsOhlcv, historicalPrices, ...seedData } = parsed;
          const hpTrim = Array.isArray(historicalPrices) ? historicalPrices.slice(-252) : [];
          return { ticker: r.ticker, data: { ...seedData, historicalPrices: hpTrim } };
        } catch { return null; }
      })
      .filter(Boolean);
    fs.writeFileSync(seedPath, JSON.stringify(seeds, null, 2), 'utf-8');
  } catch {
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

export function diskResearcherGet(key: string): any | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare("SELECT data, updated_at FROM researcher_cache WHERE cache_key = ?").get(key) as any;
    if (!row) return null;
    const age = Date.now() - row.updated_at;
    if (age > RESEARCHER_CACHE_TTL_MS) {
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
