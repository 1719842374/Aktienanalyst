/**
 * server/backtest/snapshot-store.ts — Phase 1 (Snapshot + Parity),
 * WORK_SIGNAL_BACKTEST.md §2.1 ("server/disk-cache.ts / data.db — Snapshot-
 * Store erweitern") + Ticket Phase 1 Punkt 1.
 *
 * Additive SQLite-Tabelle fuer ScoringSnapshot-Persistenz. Bewusst NICHT in
 * disk-cache.ts selbst eingefuegt (Ticket: "oder lege server/backtest/
 * snapshot-store.ts an, additiv") — eigene Datei, eigene Tabelle, KEINE
 * Aenderung an bestehenden disk-cache.ts-Funktionen/Tabellen
 * (analysis_cache/researcher_cache bleiben unberuehrt).
 *
 * Nutzt dieselbe SQLite-Datei (data.db) wie disk-cache.ts, aber oeffnet eine
 * eigene Verbindung mit eigenem CREATE TABLE IF NOT EXISTS — additiv,
 * kollisionsfrei mit den bestehenden Tabellen. Faellt wie disk-cache.ts auf
 * einen No-Op zurueck, wenn SQLite nicht verfuegbar ist (z.B. read-only FS),
 * damit ein fehlschlagender Snapshot-Write NIEMALS die /api/analyze-Antwort
 * blockiert (Seiteneffekt, kein kritischer Pfad).
 */
import Database from "better-sqlite3";
import path from "path";
import type { ScoringSnapshot } from "./types";

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
      CREATE TABLE IF NOT EXISTS scoring_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        as_of TEXT NOT NULL,
        scoring_version TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(ticker, as_of, scoring_version)
      );
      CREATE INDEX IF NOT EXISTS idx_scoring_snapshots_ticker_asof
        ON scoring_snapshots(ticker, as_of);
    `);
    console.log(`[SnapshotStore] SQLite table scoring_snapshots ready at ${DB_PATH}`);
    return db;
  } catch (err: any) {
    initFailed = true;
    console.warn(`[SnapshotStore] SQLite unavailable: ${err?.message} — running without snapshot persistence`);
    return null;
  }
}

/**
 * persistScoringSnapshot() — Seiteneffekt, wird nach jedem erfolgreichen
 * /api/analyze aufgerufen (siehe analyze-route.ts Hook, Ticket Phase 1
 * Punkt 1). ON CONFLICT(ticker, as_of, scoring_version) DO UPDATE, damit
 * ein wiederholter Analyze-Call am selben Tag den Snapshot aktualisiert
 * statt Duplikate anzuhaeufen (asOf ist auf Tagesgranularitaet normiert,
 * WORK_SIGNAL_BACKTEST.md §4.2 "Snapshot-Raster: Monatultimo oder letzter
 * Handelstag" gilt erst fuer Phase 2+/PIT-Historie; Phase 1 schreibt "heute").
 *
 * Wirft NIEMALS — ein fehlgeschlagener Snapshot-Write darf die Analyze-
 * Response nicht gefaehrden (additiver Seiteneffekt, kein kritischer Pfad).
 */
export function persistScoringSnapshot(snapshot: ScoringSnapshot): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`
      INSERT INTO scoring_snapshots (ticker, as_of, scoring_version, data, created_at)
      VALUES (@ticker, @asOf, @scoringVersion, @data, @createdAt)
      ON CONFLICT(ticker, as_of, scoring_version) DO UPDATE
        SET data = excluded.data, created_at = excluded.created_at
    `).run({
      ticker: snapshot.ticker,
      asOf: snapshot.asOf,
      scoringVersion: snapshot.scoringVersion,
      data: JSON.stringify(snapshot),
      createdAt: Date.now(),
    });
  } catch (err: any) {
    console.warn(`[SnapshotStore] Write error for ${snapshot.ticker}/${snapshot.asOf}: ${err?.message}`);
  }
}

/**
 * getScoringSnapshot() — liest den (zuletzt geschriebenen) Snapshot fuer
 * (ticker, asOf[, scoringVersion]). Wird von replay.ts/spaeteren Phasen
 * genutzt, um gegen bereits persistierte Snapshots zu vergleichen, ohne
 * jedes Mal live neu zu rechnen.
 */
export function getScoringSnapshot(
  ticker: string,
  asOf: string,
  scoringVersion = "v1"
): ScoringSnapshot | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`
      SELECT data FROM scoring_snapshots
      WHERE ticker = ? AND as_of = ? AND scoring_version = ?
    `).get(ticker, asOf, scoringVersion) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as ScoringSnapshot;
  } catch (err: any) {
    console.warn(`[SnapshotStore] Read error for ${ticker}/${asOf}: ${err?.message}`);
    return null;
  }
}

/**
 * listScoringSnapshots() — alle Snapshots fuer einen Ticker (neueste zuerst).
 * Fuer Phase 2+ (PIT-Universum) und interne Diagnose; kein Bestandteil der
 * Phase-1-Akzeptanzkriterien, aber additiv nuetzlich und ohne Risiko.
 */
export function listScoringSnapshots(ticker: string, limit = 100): ScoringSnapshot[] {
  const d = getDb();
  if (!d) return [];
  try {
    const rows = d.prepare(`
      SELECT data FROM scoring_snapshots
      WHERE ticker = ?
      ORDER BY as_of DESC
      LIMIT ?
    `).all(ticker, limit) as Array<{ data: string }>;
    return rows.map(r => JSON.parse(r.data) as ScoringSnapshot);
  } catch {
    return [];
  }
}
