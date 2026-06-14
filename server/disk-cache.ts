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
const CACHE_SCHEMA_VERSION = "2026-06-14-v1"; // Bumped: invalidate FMP-only entries without historicalPrices
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

    // Bulk-cleanup: remove all entries without historicalPrices on startup
    // This clears FMP-only entries that were persisted via publish_website snapshot
    try {
      const allRows = db.prepare('SELECT ticker, data FROM analysis_cache').all() as Array<{ ticker: string; data: string }>;
      let cleaned = 0;
      for (const row of allRows) {
        try {
          const parsed = JSON.parse(row.data);
          const hp = parsed?.historicalPrices;
          if (!hp || (Array.isArray(hp) && hp.length < 50)) {
            db.prepare('DELETE FROM analysis_cache WHERE ticker = ?').run(row.ticker);
            cleaned++;
          }
        } catch { db.prepare('DELETE FROM analysis_cache WHERE ticker = ?').run(row.ticker); cleaned++; }
      }
      if (cleaned > 0) console.log(`[DiskCache] Startup cleanup: removed ${cleaned} incomplete entries (no historicalPrices)`);
    } catch (cleanErr: any) {
      console.warn(`[DiskCache] Startup cleanup failed: ${cleanErr?.message}`);
    }

    // Load seed cache — merge into DB on every start (not just when empty)
    // This ensures re-deployed sandboxes always have the latest seed data
    try {
      const seedPath = path.join(process.cwd(), 'cache-seed.json');
      const fs = require('fs');
      if (fs.existsSync(seedPath)) {
        const rawSeeds = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
        // Support both formats: Array<{ticker,data}> and Array<{ticker,...fields}>
        const seeds: Array<{ ticker: string; data: any }> = Array.isArray(rawSeeds)
          ? rawSeeds.map((s: any) => ({
              ticker: s.ticker,
              // If seed has nested 'data', use it. Otherwise the whole object IS the data.
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
            // Use INSERT OR IGNORE — don't overwrite newer user-analysed entries
            upsert.run(seed.ticker.toUpperCase(), JSON.stringify(versioned), now, now);
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
    // Schema-version check — invalidate silently if formula/label changes
    if (data._schemaVersion && data._schemaVersion !== CACHE_SCHEMA_VERSION) {
      d.prepare("DELETE FROM analysis_cache WHERE ticker = ?").run(ticker);
      console.log(`[DiskCache] Invalidated ${ticker}: schema ${data._schemaVersion} ≠ ${CACHE_SCHEMA_VERSION}`);
      return null;
    }
    // Invalidate FMP-only entries without historicalPrices (incomplete data — cannot render)
    const hp = data.historicalPrices;
    if (!hp || (Array.isArray(hp) && hp.length < 50)) {
      d.prepare("DELETE FROM analysis_cache WHERE ticker = ?").run(ticker);
      if (hp !== undefined) console.log(`[DiskCache] Invalidated ${ticker}: insufficient historicalPrices (${Array.isArray(hp) ? hp.length : 0} < 50)`);
      return null;
    }
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
    const { _cached, _cacheAge, _cacheDate, _diskCache, _schemaVersion: _sv, ...clean } = data || {};
    const versioned = { ...clean, _schemaVersion: CACHE_SCHEMA_VERSION };
    d.prepare(`
      INSERT INTO analysis_cache (ticker, data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(ticker) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `).run(ticker, JSON.stringify(versioned), now, now);

    // Auto-Export: cache-seed.json nach jeder neuen Analyse aktualisieren
    // Damit sind alle analysierten Ticker beim nächsten Re-Deploy sofort verfügbar
    exportCacheSeed(d);
  } catch (err: any) {
    console.warn(`[DiskCache] Write error for ${ticker}: ${err?.message}`);
  }
}

// Exportiert alle aktuellen Cache-Einträge nach cache-seed.json
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
          // Entferne Laufzeit-Felder die nicht in den Seed gehören
          const { _cached, _cacheAge, _cacheDate, _diskCache, historicalPrices, ...seedData } = parsed;
          return { ticker: r.ticker, data: seedData };
        } catch { return null; }
      })
      .filter(Boolean);
    fs.writeFileSync(seedPath, JSON.stringify(seeds, null, 2), 'utf-8');
  } catch {
    // Non-critical — kein Crash wenn Export fehlschlägt
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
