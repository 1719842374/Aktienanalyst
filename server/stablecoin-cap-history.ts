/**
 * Tägliche Stablecoin-Marktkapitalisierung aus dem bestehenden DefiLlama-Abruf.
 * Eigene Tabelle in data.db. Kein Ablauf, damit die Z-Score-Reihe liegen bleibt.
 * Ein Schreibfehler bleibt ein No-Op und bricht die Antwort nicht ab.
 */
import Database from "better-sqlite3";
import path from "path";
import type { CapObservation } from "./stablecoin-channel-math";

const DB_PATH = path.resolve(process.cwd(), "data.db");

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
      CREATE TABLE IF NOT EXISTS stablecoin_daily_caps (
        cap_date TEXT PRIMARY KEY,
        total_market_cap_usd REAL NOT NULL
      );
    `);
    return db;
  } catch (err: any) {
    initFailed = true;
    console.warn(`[StablecoinCaps] SQLite unavailable: ${err?.message}`);
    return null;
  }
}

export function readStablecoinDailyCaps(): CapObservation[] {
  const handle = getDb();
  if (!handle) return [];
  try {
    const rows = handle.prepare(
      "SELECT cap_date, total_market_cap_usd FROM stablecoin_daily_caps ORDER BY cap_date ASC",
    ).all() as Array<{ cap_date: string; total_market_cap_usd: number }>;
    return rows
      .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.cap_date) && Number.isFinite(row.total_market_cap_usd))
      .map(row => ({ date: row.cap_date, totalMarketCapUsd: row.total_market_cap_usd }));
  } catch (err: any) {
    console.warn(`[StablecoinCaps] Read failed: ${err?.message}`);
    return [];
  }
}

export function writeStablecoinDailyCaps(points: CapObservation[]): void {
  const handle = getDb();
  if (!handle) return;
  try {
    const upsert = handle.prepare(`
      INSERT INTO stablecoin_daily_caps (cap_date, total_market_cap_usd)
      VALUES (?, ?)
      ON CONFLICT(cap_date) DO UPDATE SET total_market_cap_usd = excluded.total_market_cap_usd
    `);
    const tx = handle.transaction((rows: CapObservation[]) => {
      for (const point of rows) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date) || !Number.isFinite(point.totalMarketCapUsd)) continue;
        upsert.run(point.date, point.totalMarketCapUsd);
      }
    });
    tx(points);
  } catch (err: any) {
    console.warn(`[StablecoinCaps] Write failed: ${err?.message}`);
  }
}
