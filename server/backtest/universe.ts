/**
 * server/backtest/universe.ts — Sprint B3 Phase 2 (PIT-Universum,
 * WORK_SIGNAL_BACKTEST.md §5 "Universum und Survivorship-Korrektur" + §2.2
 * ("server/backtest/universe.ts — inUniverse(T), naive vs. corr").
 *
 * Implementiert EXAKT die in §5.1 definierten Mengen:
 *
 *   U_naive(T) = { i | i ∈ Index_heute ∧ cap_2026(i) ≥ 1e9 }
 *   U_corr(T)  = { i | handelbar an T
 *                    ∧ cap_T(i) ≥ 1e9
 *                    ∧ listingDate ≤ T
 *                    ∧ (delistDate = null ∨ delistDate > T)
 *                    ∧ PIT-Mindestfelder oder dataComplete-Flag }
 *
 * KEINE Ticker-Hardcodes: die Konstituenten-/Delisted-Listen kommen
 * ausschliesslich aus FMP (/stable/historical-sp500-constituent,
 * /stable/delisted-companies), nicht aus einer im Code verdrahteten Liste.
 * KEIN LLM im PIT-Fetch-Pfad — reine HTTP-Calls + SQLite-Cache + Boolean-
 * Logik.
 *
 * Cache-Strategie (Ticket Punkt 2 + Regel "Rohdaten muessen server-seitig
 * gecacht werden"): historische Konstituenten-Aenderungen und Delisted-
 * Companies aendern sich selten (max. ein paar Ereignisse pro Woche global).
 * Wir cachen die Rohantworten in einer eigenen SQLite-Tabelle (gleiches
 * Muster wie snapshot-store.ts: eigene Datei-lokale Verbindung, eigene
 * CREATE TABLE IF NOT EXISTS, No-Op-Fallback wenn SQLite nicht verfuegbar
 * ist) mit einem Timestamp und laden nur neu, wenn `CACHE_TTL_MS`
 * ueberschritten ist oder ein Force-Refresh angefordert wird.
 */
import Database from "better-sqlite3";
import path from "path";
import {
  fmpHistoricalSp500Constituents,
  fmpDelistedCompanies,
  fmpHistoricalMarketCap,
  fmpProfile,
} from "../fmp";

// §4.2 backtest_v1: CAP_FLOOR_USD als benannte Konstante, keine Magic Number
// an den Aufrufstellen. 1e9 = 1 Mrd. USD (Large/Mid-Cap-Schwelle laut Spec).
export const CAP_FLOOR_USD = 1e9;

// Rohdaten-Cache selten aktualisieren (Konstituenten/Delistings aendern sich
// nicht innertaeglich) — 24h TTL, konfigurierbar fuer Tests via ENV.
const CACHE_TTL_MS = Number(process.env.BACKTEST_UNIVERSE_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);

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
      CREATE TABLE IF NOT EXISTS backtest_universe_raw (
        cache_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `);
    return db;
  } catch (err: any) {
    initFailed = true;
    console.warn(`[Universe] SQLite unavailable: ${err?.message} — Rohdaten-Cache deaktiviert (jede Anfrage fetcht neu)`);
    return null;
  }
}

function cacheGetRaw(key: string): any[] | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT data, fetched_at FROM backtest_universe_raw WHERE cache_key = ?`).get(key) as
      | { data: string; fetched_at: number }
      | undefined;
    if (!row) return null;
    if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null; // abgelaufen
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function cacheSetRaw(key: string, data: any[]): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`
      INSERT INTO backtest_universe_raw (cache_key, data, fetched_at)
      VALUES (@key, @data, @fetchedAt)
      ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
    `).run({ key, data: JSON.stringify(data), fetchedAt: Date.now() });
  } catch (err: any) {
    console.warn(`[Universe] Cache-Write-Fehler fuer ${key}: ${err?.message}`);
  }
}

/** Rohzeile aus /stable/historical-sp500-constituent (FMP-Feldnamen 1:1). */
export interface ConstituentChangeRow {
  dateAdded: string;
  addedSecurity: string;
  removedTicker: string;
  removedSecurity: string;
  date: string; // ISO yyyy-mm-dd, Wirkungsdatum
  symbol: string; // aufgenommenes Symbol
  reason: string;
}

/** Rohzeile aus /stable/delisted-companies (FMP-Feldnamen 1:1). */
export interface DelistedCompanyRow {
  symbol: string;
  companyName: string;
  exchange: string;
  ipoDate: string | null;
  delistedDate: string | null;
}

/**
 * getConstituentChanges() — gecachte Rohdaten von
 * /stable/historical-sp500-constituent. EIN Call liefert die komplette
 * Historie (kein period/page-Parameter, verifiziert 30.08.2026, siehe
 * server/fmp.ts Kommentar). Force-Refresh via `forceRefresh=true` ignoriert
 * den Cache (z.B. fuer einen manuellen Cron-Refresh).
 */
export async function getConstituentChanges(forceRefresh = false): Promise<ConstituentChangeRow[]> {
  const key = "sp500_constituent_changes";
  if (!forceRefresh) {
    const cached = cacheGetRaw(key);
    if (cached) return cached as ConstituentChangeRow[];
  }
  const rows = await fmpHistoricalSp500Constituents();
  if (rows.length > 0) cacheSetRaw(key, rows);
  return rows as ConstituentChangeRow[];
}

/**
 * getDelistedCompanies() — gecachte Rohdaten von /stable/delisted-companies
 * (paginiert ueber fmpDelistedCompanies(), siehe server/fmp.ts). Global,
 * nicht auf S&P 500 vorgefiltert — das Filtern auf das Laboruniversum
 * passiert in isKnownConstituentSymbol()/inUniverse() unten, damit diese
 * Funktion selbst keine Ticker-Annahmen trifft.
 */
export async function getDelistedCompanies(forceRefresh = false): Promise<DelistedCompanyRow[]> {
  const key = "delisted_companies_all";
  if (!forceRefresh) {
    const cached = cacheGetRaw(key);
    if (cached) return cached as DelistedCompanyRow[];
  }
  const rows = await fmpDelistedCompanies();
  if (rows.length > 0) cacheSetRaw(key, rows);
  return rows as DelistedCompanyRow[];
}

/**
 * Leitet aus den Konstituenten-Aenderungsereignissen die Menge der Symbole
 * ab, die zu einem gegebenen Datum `asOf` Mitglied des S&P 500 waren.
 * Startpunkt: die HEUTIGE Zusammensetzung (aus den Ereignissen rekonstruiert
 * — jede Zeile mit `date > asOf` wird "rueckwaerts abgewickelt": das an
 * diesem Datum aufgenommene Symbol wird entfernt, das entfernte Symbol
 * wieder hinzugefuegt). Das ist reine Mengen-Rekonstruktion aus FMP-Rohdaten,
 * keine Ticker-Hardcodes.
 *
 * Hinweis: FMP liefert AUSSCHLIESSLICH Aenderungsereignisse, keine explizite
 * "heutige Liste". Ohne eine bekannte aktuelle Mitgliederliste als Ankerpunkt
 * kann die Historie nicht exakt rekonstruiert werden. Fuer U_naive (§5.1
 * nutzt bewusst NUR "heutiger Index" — vereinfachend) reicht die Menge aller
 * je gesehenen `symbol`-Werte aus den Aenderungsereignissen der letzten
 * `ANCHOR_LOOKBACK_DAYS` Tage als Naeherung fuer "aktuell im Index"; das ist
 * fuer U_naive explizit als naiv/simpel spezifiziert (§5.1: "einfach, nutzt
 * aktuelle Daten") und wird NICHT fuer U_corr verwendet (dort zaehlt allein
 * listingDate/delistDate/cap_T, nicht die Indexzugehoerigkeit "heute").
 */
function wasConstituentAsOf(changes: ConstituentChangeRow[], symbol: string, asOf: string): boolean {
  // Ereignisse chronologisch (aeltestes zuerst) durchlaufen und den
  // Mitgliedschaftszustand bis `asOf` simulieren.
  const sorted = [...changes].filter(c => c.date).sort((a, b) => a.date.localeCompare(b.date));
  let isMember = false;
  for (const c of sorted) {
    if (c.date > asOf) break;
    if (c.symbol === symbol) isMember = true;
    if (c.removedTicker === symbol) isMember = false;
  }
  return isMember;
}

/**
 * Menge aller Symbole, die laut Aenderungshistorie JEMALS S&P-500-Mitglied
 * waren (Aufnahme- oder Entfernungs-Symbol) — Kandidatenmenge fuer
 * inUniverse()-Pruefungen, damit nicht jeder beliebige Ticker global
 * geprueft werden muss.
 */
export function allKnownSp500Symbols(changes: ConstituentChangeRow[]): Set<string> {
  const set = new Set<string>();
  for (const c of changes) {
    if (c.symbol) set.add(c.symbol);
    if (c.removedTicker) set.add(c.removedTicker);
  }
  return set;
}

/** PIT-Delisting-Info fuer ein Symbol, oder null wenn nicht delistet bekannt. */
export interface DelistInfo {
  delistedDate: string | null;
  ipoDate: string | null;
}

function findDelistInfo(delisted: DelistedCompanyRow[], symbol: string): DelistInfo | null {
  const row = delisted.find(d => d.symbol === symbol);
  if (!row) return null;
  return { delistedDate: row.delistedDate ?? null, ipoDate: row.ipoDate ?? null };
}

/**
 * cap_T(ticker) — Marktkapitalisierung AN EINEM HISTORISCHEN DATUM (nicht
 * heute). Nutzt /stable/historical-market-capitalization, das laut FMP
 * bereits Preis_T × Shares_T vorberechnet liefert (verifiziert 30.08.2026,
 * siehe server/fmp.ts:fmpHistoricalMarketCap Kommentar) — keine eigene
 * Multiplikation Preis × Shares noetig.
 *
 * Fallback (Ticket Punkt 3, "sonst nutze die zeitlich naechstliegende
 * bekannte Zahl mit klarem Hinweis"): wenn am exakten Datum `asOf` kein
 * Eintrag existiert (Wochenende/Feiertag/Datenluecke), wird der zeitlich
 * naechste verfuegbare Eintrag INNERHALB eines kleinen Suchfensters
 * (`CAP_LOOKUP_WINDOW_DAYS`) verwendet und `approximated=true` markiert.
 * Ausserhalb des Fensters: kein Wert, `capT=null` — Zahlen-Prinzip
 * ("dataComplete=false statt raten"), kein weiteres Schaetzen.
 */
const CAP_LOOKUP_WINDOW_DAYS = 10;

export interface CapAtResult {
  capT: number | null;
  /** true, wenn nicht exakt `asOf`, sondern der naechstgelegene Handelstag
   *  innerhalb des Suchfensters verwendet wurde (dokumentierte Ungenauigkeit,
   *  siehe Ticket Punkt 3). */
  approximated: boolean;
  usedDate: string | null;
}

export async function capAt(ticker: string, asOf: string): Promise<CapAtResult> {
  const from = shiftDate(asOf, -CAP_LOOKUP_WINDOW_DAYS);
  const to = shiftDate(asOf, CAP_LOOKUP_WINDOW_DAYS);
  const rows = await fmpHistoricalMarketCap(ticker, from, to);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { capT: null, approximated: false, usedDate: null };
  }
  // Exakter Treffer zuerst.
  const exact = rows.find((r: any) => r.date === asOf);
  if (exact && typeof exact.marketCap === "number") {
    return { capT: exact.marketCap, approximated: false, usedDate: exact.date };
  }
  // Naechstgelegenes Datum (kleinste absolute Differenz in Tagen) im Fenster.
  let best: any = null;
  let bestDiff = Infinity;
  for (const r of rows) {
    if (typeof r.marketCap !== "number" || !r.date) continue;
    const diff = Math.abs(dateDiffDays(r.date, asOf));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = r;
    }
  }
  if (!best) return { capT: null, approximated: false, usedDate: null };
  return { capT: best.marketCap, approximated: true, usedDate: best.date };
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateDiffDays(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db_ = new Date(b + "T00:00:00Z").getTime();
  return Math.round((da - db_) / (24 * 60 * 60 * 1000));
}

export type UniverseMode = "naive" | "corr";

export interface InUniverseResult {
  inUniverse: boolean;
  mode: UniverseMode;
  ticker: string;
  asOf: string;
  /** true, wenn alle fuer diesen Modus benoetigten PIT-Felder vorhanden
   *  waren (kein Raten, siehe Zahlen-Prinzip). false => inUniverse ist
   *  konservativ `false` (fehlende Daten duerfen NICHT als "im Universum"
   *  interpretiert werden). */
  dataComplete: boolean;
  reasons: string[]; // Diagnose: warum true/false (fuer Tests/Debugging)
  capT: number | null;
  capApproximated: boolean;
  listingDate: string | null;
  delistedDate: string | null;
}

/**
 * inUniverse() — WORK_SIGNAL_BACKTEST.md §5.1, EXAKT wie spezifiziert.
 *
 * mode="naive":  U_naive(T) = heutiger Index-Mitglied ∧ cap_2026(ticker) ≥ 1e9
 *   "cap_2026" bedeutet hier explizit die AKTUELLE (heutige) Marktkapitali-
 *   sierung — §5.1 sagt ausdruecklich "einfach, nutzt aktuelle Daten" fuer
 *   U_naive. Wir nutzen fmpProfile().marketCap (heutiger Snapshot).
 *
 * mode="corr":   U_corr(T) = handelbar an T ∧ cap_T(ticker) ≥ 1e9
 *   ∧ listingDate ≤ T ∧ (delistDate=null ∨ delistDate > T) ∧ PIT-Felder da.
 *   "handelbar an T" wird ueber (listingDate ≤ T) UND (delistDate=null ODER
 *   delistDate > T) abgebildet — das IST die Handelbarkeits-Bedingung laut
 *   Spec (keine zusaetzliche Bedingung nötig/erfunden).
 *
 * Liefert fuer denselben (ticker, asOf) je nach `mode` UNTERSCHIEDLICHE
 * Ergebnisse, wenn der Ticker inzwischen delistet ist (Akzeptanzkriterium
 * §13 + Ticket Akzeptanzkriterien).
 */
export async function inUniverse(
  ticker: string,
  asOf: string,
  mode: UniverseMode,
  opts: {
    changes?: ConstituentChangeRow[];
    delisted?: DelistedCompanyRow[];
    /** Fuer Tests: profile-Override statt echtem FMP-Call. */
    profileOverride?: { marketCap: number | null; ipoDate: string | null } | null;
  } = {}
): Promise<InUniverseResult> {
  const upperTicker = ticker.toUpperCase();
  const reasons: string[] = [];

  if (mode === "naive") {
    const changes = opts.changes ?? (await getConstituentChanges());
    const knownSymbols = allKnownSp500Symbols(changes);
    // "heutiger Index-Mitglied": Mitgliedschaftsstand zum HEUTIGEN Datum
    // (nicht asOf!) — §5.1 U_naive nutzt ausdruecklich die aktuelle
    // Indexzugehoerigkeit, unabhaengig vom Backtest-Zeitpunkt T.
    const today = new Date().toISOString().slice(0, 10);
    const isMemberToday = knownSymbols.has(upperTicker) && wasConstituentAsOf(changes, upperTicker, today);
    if (!isMemberToday) reasons.push("nicht heutiges Index-Mitglied");

    let capToday: number | null = null;
    if (opts.profileOverride) {
      capToday = opts.profileOverride.marketCap;
    } else {
      try {
        const profile = await fmpProfile(upperTicker);
        capToday = typeof profile?.marketCap === "number" ? profile.marketCap : null;
      } catch {
        capToday = null;
      }
    }
    const dataComplete = capToday != null;
    if (!dataComplete) reasons.push("cap_2026 (heutige Marktkap.) nicht verfuegbar");
    const capOk = dataComplete && (capToday as number) >= CAP_FLOOR_USD;
    if (dataComplete && !capOk) reasons.push(`cap_2026 ${capToday} < CAP_FLOOR_USD ${CAP_FLOOR_USD}`);

    return {
      inUniverse: dataComplete && isMemberToday && capOk,
      mode,
      ticker: upperTicker,
      asOf,
      dataComplete,
      reasons,
      capT: capToday,
      capApproximated: false,
      listingDate: null,
      delistedDate: null,
    };
  }

  // mode === "corr"
  const delisted = opts.delisted ?? (await getDelistedCompanies());
  const delistInfo = findDelistInfo(delisted, upperTicker);

  let listingDate: string | null = null;
  let capT: number | null = null;
  let capApproximated = false;

  if (opts.profileOverride) {
    listingDate = opts.profileOverride.ipoDate;
    capT = opts.profileOverride.marketCap;
  } else {
    try {
      const profile = await fmpProfile(upperTicker);
      listingDate = profile?.ipoDate ?? null;
    } catch {
      listingDate = null;
    }
    // listingDate aus profile bevorzugt; wenn Ticker delistet ist, hat
    // profile() haeufig KEINE Daten mehr (inaktive Symbole) — dann auf
    // delisted-companies.ipoDate zurueckfallen (dieselbe Semantik).
    if (!listingDate && delistInfo?.ipoDate) listingDate = delistInfo.ipoDate;

    const cap = await capAt(upperTicker, asOf);
    capT = cap.capT;
    capApproximated = cap.approximated;
  }

  const delistedDate = delistInfo?.delistedDate ?? null;

  const listingOk = listingDate != null && listingDate <= asOf;
  if (listingDate == null) reasons.push("listingDate unbekannt");
  else if (!listingOk) reasons.push(`listingDate ${listingDate} > asOf ${asOf}`);

  const notYetDelisted = delistedDate == null || delistedDate > asOf;
  if (!notYetDelisted) reasons.push(`delistedDate ${delistedDate} <= asOf ${asOf}`);

  const capKnown = capT != null;
  if (!capKnown) reasons.push("cap_T nicht verfuegbar");
  const capOk = capKnown && (capT as number) >= CAP_FLOOR_USD;
  if (capKnown && !capOk) reasons.push(`cap_T ${capT} < CAP_FLOOR_USD ${CAP_FLOOR_USD}`);

  // PIT-Mindestfelder: listingDate UND cap_T muessen vorhanden sein, sonst
  // ist die Aussage "im Universum" nicht belastbar (Zahlen-Prinzip:
  // dataComplete=false statt raten, siehe Ticket Regel).
  const dataComplete = listingDate != null && capKnown;
  if (!dataComplete) reasons.push("PIT-Mindestfelder unvollstaendig -> dataComplete=false");

  const tradable = listingOk && notYetDelisted;
  const result = dataComplete && tradable && capOk;

  return {
    inUniverse: result,
    mode,
    ticker: upperTicker,
    asOf,
    dataComplete,
    reasons,
    capT,
    capApproximated,
    listingDate,
    delistedDate,
  };
}
