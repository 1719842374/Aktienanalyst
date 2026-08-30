/**
 * server/backtest/pit-valuation.ts — Sprint B3 Phase 3b (PIT-Valuation-Replay),
 * tickets/SPRINT_B3_PHASE3B_SLIM_PIT_VALUATION.md.
 *
 * ZWECK: T2 (Signal-Kohorte) liefert in script/test-backtest-feasibility.ts
 * aktuell IMMER `insufficient_data`, weil invDcf/crv dort bewusst `null`
 * durchgereicht werden (siehe Kopfkommentar dieser Datei dort) — der volle
 * gehaertete DCF/CRV-Pfad (buildDefaultDCFParams -> calculateFCFFDCF ->
 * worstCaseM1 -> computeHardenedCRV) wurde nie im Batch-Replay-Pfad
 * verdrahtet. Diese Datei schliesst GENAU DIESE Luecke — SCHLANK:
 *
 *   1. Pro Ticker EINMAL Rohdaten laden + in SQLite cachen (OHLCV,
 *      Quartals-Statements MIT filingDate, Profile, historische MarketCap).
 *   2. Pro asOf-Datum NUR aus den gecachten Rohdaten ableiten — KEIN
 *      zusaetzlicher FMP-Call pro Monat, KEIN /api/analyze-Call, KEIN LLM.
 *   3. Die eigentliche Bewertungsrechnung (FCFF-DCF/WorstCase/CRV) laeuft
 *      UNVERAENDERT ueber shared/valuation-signal.ts — KEIN zweites
 *      Score-/Bewertungsmodell (Ticket-Verbot, siehe replay.ts-Kommentar:
 *      "Verbot: zweiter Backtest-Score. Drift Live vs. Replay = Bug.").
 *
 * Mirror der LIVE-Berechnungssequenz in server/analyze-route.ts (Zeilen
 * ~1961-1997, siehe Kommentar dort):
 *   buildDefaultDCFParams(analysis) -> calculateFCFFDCF(baseParams) ->
 *   worstCaseM1(price, beta5Y, sectorMaxDrawdown) -> computeHardenedCRV({...})
 *   -> crv = hardened.crvHardened, invDcf = hardened.fvHardened
 *
 * Der Unterschied zur Live-Pipeline ist AUSSCHLIESSLICH die Datenquelle:
 * live liest `analysis` aus einem frischen /api/analyze-Ergebnis (aktuelle
 * FMP-Calls + LLM-Katalysatoren), hier wird ein minimales, aber
 * strukturgleiches StockAnalysis-Objekt REIN aus gecachten PIT-Rohdaten
 * gebaut (kein LLM, keine Katalysatoren, kein moatRating — siehe
 * PitValuationResult.dataComplete fuer die daraus resultierenden Luecken).
 * `moatRating` bleibt daher `null` (computeHardenedCRV.moatRating ist
 * optional) statt einer neu erfundenen Heuristik.
 *
 * VERBOTE (Ticket, strikt eingehalten):
 *   - KEIN zweites Score-Modell — calculateFCFFDCF/worstCaseM1/
 *     computeHardenedCRV werden 1:1 aus shared/valuation-signal.ts importiert,
 *     NICHT neu implementiert.
 *   - KEIN Analyze-Call im Batch — nur fmpProfile/fmpIncomeStatementQuarterly/
 *     fmpCashFlowQuarterly/fmpHistoricalPrices/fmpHistoricalMarketCap, je
 *     GENAU EINMAL pro Ticker (gecacht), nie pro asOf-Monat erneut.
 *   - KEIN LLM im Run-Pfad — Fiscal-Gate laeuft ueber
 *     buildScoringForAnalysis()/fiscalMegatrendQualifies() mit catalysts=[]
 *     (server/scoring-gates.ts), dort qualifies=false ausser
 *     publishedAt <= T — hier gibt es ohnehin keine Katalysatoren, also
 *     bleibt qualifies=false, ohne dass dafuer neuer Code noetig ist.
 *   - KEIN Client-Callback — reine Server-/Script-Datei.
 *
 * Sektor-WACC/Growth/Drawdown-Defaults kommen aus getSectorDefaults()
 * (server/sector-data.ts) — DIESELBE Funktion, die auch die Live-Pipeline
 * fuer analysis.sectorProfile befuellt (server/analyze-route.ts) — keine
 * zweite Sektor-Tabelle.
 */
import Database from "better-sqlite3";
import path from "path";
import {
  fmpProfile,
  fmpIncomeStatementQuarterly,
  fmpCashFlowQuarterly,
  fmpBalanceSheetQuarterly,
  fmpHistoricalPrices,
  fmpHistoricalMarketCap,
} from "../fmp";
import { altFetchYahooThenStooq } from "../history-fallback";
import { getSectorDefaults, estimateGovExposure } from "../sector-data";
import {
  buildDefaultDCFParams,
  calculateFCFFDCF,
  worstCaseM1,
  computeHardenedCRV,
} from "../../shared/valuation-signal";
import type { StockAnalysis, SectorProfile, HistoricalPrice } from "../../shared/schema";

// ============================================================
// 1. SQLite-Rohdaten-Cache (Muster 1:1 aus server/backtest/universe.ts
//    uebernommen: eigene Tabelle, eigene Verbindung, No-Op-Fallback wenn
//    SQLite nicht verfuegbar ist — additiv, keine Aenderung an
//    disk-cache.ts/universe.ts selbst).
// ============================================================

const CACHE_TTL_MS = Number(process.env.BACKTEST_PIT_VALUATION_CACHE_TTL_MS ?? 24 * 60 * 60 * 1000);
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
      CREATE TABLE IF NOT EXISTS backtest_pit_valuation_raw (
        cache_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
    `);
    return db;
  } catch (err: any) {
    initFailed = true;
    console.warn(`[PitValuation] SQLite unavailable: ${err?.message} — Rohdaten-Cache deaktiviert (jede Anfrage fetcht neu)`);
    return null;
  }
}

function cacheGetRaw<T = any>(key: string): T | null {
  const d = getDb();
  if (!d) return null;
  try {
    const row = d.prepare(`SELECT data, fetched_at FROM backtest_pit_valuation_raw WHERE cache_key = ?`).get(key) as
      | { data: string; fetched_at: number }
      | undefined;
    if (!row) return null;
    if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null; // abgelaufen
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

function cacheSetRaw(key: string, data: any): void {
  const d = getDb();
  if (!d) return;
  try {
    d.prepare(`
      INSERT INTO backtest_pit_valuation_raw (cache_key, data, fetched_at)
      VALUES (@key, @data, @fetchedAt)
      ON CONFLICT(cache_key) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
    `).run({ key, data: JSON.stringify(data), fetchedAt: Date.now() });
  } catch (err: any) {
    console.warn(`[PitValuation] Cache-Write-Fehler fuer ${key}: ${err?.message}`);
  }
}

// ============================================================
// 2. Pro-Ticker EINMALIGER Rohdaten-Fetch (gecacht)
// ============================================================

export interface PriceRow {
  date: string;
  close: number;
}

export interface QuarterlyRow {
  filingDate: string | null;
  date: string; // Periodenende, NICHT fuer PIT-Filter nutzen
  revenue: number | null;
  operatingIncome: number | null;
  ebitda: number | null;
}

export interface QuarterlyCashflowRow {
  filingDate: string | null;
  date: string;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null;
  freeCashFlow: number | null;
}

/**
 * Quartals-Bilanz-Zeile (Nachbesserung Sprint B3 Phase 3b, siehe Ticket-Luecke
 * "totalDebt/cashEquivalents hardcoded null"): PIT-Feld filingDate + die
 * beiden Felder, die buildDefaultDCFParams() (shared/valuation-signal.ts:184)
 * fuer netDebt = totalDebt - cashEquivalents braucht. Bilanz ist ein
 * Stichtagswert (kein TTM-Summieren wie bei Income/Cashflow) — es wird pro
 * asOf einfach die juengste Zeile MIT filingDate <= asOf genommen.
 */
export interface QuarterlyBalanceRow {
  filingDate: string | null;
  date: string;
  totalDebt: number | null;
  cashAndCashEquivalents: number | null;
}

export interface TickerRawData {
  ticker: string;
  profile: {
    sector: string;
    industry: string;
    description: string;
    beta: number;
    sharesOutstanding: number;
    totalDebt: number | null;
    cashAndCashEquivalents: number | null;
  } | null;
  quarterlyIncome: QuarterlyRow[]; // newest-first
  quarterlyCashflow: QuarterlyCashflowRow[]; // newest-first
  quarterlyBalance: QuarterlyBalanceRow[]; // newest-first
  prices: PriceRow[]; // beliebige Reihenfolge, wird von Aufrufern sortiert
  marketCap: Array<{ date: string; marketCap: number }>; // newest-first laut FMP
  fetchedOk: boolean;
  error?: string;
}

const FETCH_FROM = "2019-01-01";
const FETCH_TO = "2026-12-31";

/**
 * loadTickerRawData() — GENAU EIN Fetch-Durchlauf pro Ticker (via Cache
 * wiederverwendbar ueber mehrere asOf-Daten hinweg). Holt:
 *   - Profile (Sektor/Industry/Description/Beta/Shares/Debt/Cash)
 *   - Quartals-Income-Statement MIT filingDate (fmpIncomeStatementQuarterly)
 *   - Quartals-Cashflow-Statement MIT filingDate (fmpCashFlowQuarterly, neu
 *     additiv in server/fmp.ts)
 *   - Taegliche OHLCV 2019-2026 (FMP, mit Yahoo->Stooq-Fallback aus
 *     server/history-fallback.ts falls FMP-Historie zu kurz ist)
 *   - Historische Market Cap (fmpHistoricalMarketCap) fuer P_T-Unabhaengigkeit
 *     von reinem Close (informativ, aktuelle Berechnung nutzt P_T aus OHLCV
 *     wie die Live-Pipeline es fuer currentPrice auch tut)
 */
export async function loadTickerRawData(ticker: string, forceRefresh = false): Promise<TickerRawData> {
  const cacheKey = `pitval_raw__${ticker.toUpperCase()}`;
  if (!forceRefresh) {
    const cached = cacheGetRaw<TickerRawData>(cacheKey);
    if (cached) return cached;
  }

  const result: TickerRawData = {
    ticker,
    profile: null,
    quarterlyIncome: [],
    quarterlyCashflow: [],
    quarterlyBalance: [],
    prices: [],
    marketCap: [],
    fetchedOk: false,
  };

  try {
    const [profileRaw, quarterlyIncomeRaw, quarterlyCashflowRaw, quarterlyBalanceRaw, pricesRaw, marketCapRaw] = await Promise.all([
      fmpProfile(ticker),
      fmpIncomeStatementQuarterly(ticker, 32),
      fmpCashFlowQuarterly(ticker, 32),
      fmpBalanceSheetQuarterly(ticker, 32),
      fmpHistoricalPrices(ticker, FETCH_FROM, FETCH_TO),
      fmpHistoricalMarketCap(ticker, FETCH_FROM, FETCH_TO),
    ]);

    if (!profileRaw) {
      result.error = "kein FMP-Profil (evtl. delistet/nicht abgedeckt)";
      cacheSetRaw(cacheKey, result);
      return result;
    }

    result.profile = {
      sector: profileRaw.sector ?? "",
      industry: profileRaw.industry ?? "",
      description: profileRaw.description ?? "",
      beta: typeof profileRaw.beta === "number" ? profileRaw.beta : 1.0,
      // BUGFIX (Parity-Check AAPL, siehe server/analyze-route.ts:640): /stable/
      // profile liefert das Feld als `marketCap`, NICHT `mktCap` -- `mktCap`
      // existiert dort nicht mehr, war reines Legacy-API-Feld. Ohne Fallback
      // wurde sharesOutstanding hier immer 0 -> Notnagel 1_000_000 Shares in
      // derivePitValuation() -> massiv falscher marketCap/invDcf/crv.
      sharesOutstanding:
        typeof (profileRaw.mktCap ?? profileRaw.marketCap) === "number" && typeof profileRaw.price === "number" && profileRaw.price > 0
          ? (profileRaw.mktCap ?? profileRaw.marketCap) / profileRaw.price
          : 0,
      // Nachbesserung: FMP-Profile selbst liefert keine Bilanzsumme -- die
      // echten Werte kommen jetzt PIT-gefiltert aus quarterlyBalance (unten)
      // via derivePitValuation(). Hier bleibt nur der Notnagel fuer den Fall,
      // dass quarterlyBalance komplett leer ist (siehe dort).
      totalDebt: null,
      cashAndCashEquivalents: null,
    };

    result.quarterlyIncome = Array.isArray(quarterlyIncomeRaw)
      ? quarterlyIncomeRaw.map((r: any) => ({
          filingDate: r?.filingDate ?? null,
          date: r?.date ?? "",
          revenue: typeof r?.revenue === "number" ? r.revenue : null,
          operatingIncome: typeof r?.operatingIncome === "number" ? r.operatingIncome : null,
          ebitda: typeof r?.ebitda === "number" ? r.ebitda : (typeof r?.ebitdaratio === "number" && typeof r?.revenue === "number" ? r.ebitdaratio * r.revenue : null),
        }))
      : [];

    result.quarterlyCashflow = Array.isArray(quarterlyCashflowRaw)
      ? quarterlyCashflowRaw.map((r: any) => ({
          filingDate: r?.filingDate ?? null,
          date: r?.date ?? "",
          operatingCashFlow: typeof r?.operatingCashFlow === "number" ? r.operatingCashFlow : (typeof r?.netCashProvidedByOperatingActivities === "number" ? r.netCashProvidedByOperatingActivities : null),
          capitalExpenditure: typeof r?.capitalExpenditure === "number" ? r.capitalExpenditure : (typeof r?.capitalExpenditures === "number" ? r.capitalExpenditures : null),
          freeCashFlow: typeof r?.freeCashFlow === "number" ? r.freeCashFlow : null,
        }))
      : [];

    // Nachbesserung Sprint B3 Phase 3b: PIT-Bilanz fuer totalDebt/cashEquivalents
    // (analog analyze-route.ts:594f -- gleiche Feldnamen totalDebt/
    // cashAndCashEquivalents mit cashAndShortTermInvestments-Fallback).
    result.quarterlyBalance = Array.isArray(quarterlyBalanceRaw)
      ? quarterlyBalanceRaw.map((r: any) => ({
          filingDate: r?.filingDate ?? null,
          date: r?.date ?? "",
          totalDebt: typeof r?.totalDebt === "number" ? r.totalDebt : null,
          cashAndCashEquivalents: typeof r?.cashAndCashEquivalents === "number" ? r.cashAndCashEquivalents : (typeof r?.cashAndShortTermInvestments === "number" ? r.cashAndShortTermInvestments : null),
        }))
      : [];

    let prices: PriceRow[] = Array.isArray(pricesRaw)
      ? pricesRaw.filter((p: any) => p?.date && typeof p?.close === "number").map((p: any) => ({ date: p.date, close: p.close }))
      : [];

    // Fallback (§ Ticket: history-fallback.ts wiederverwenden) — wenn FMP zu
    // wenig liefert (< 100 Handelstage, analog dem MSFT-10Y-Incident-Fix in
    // server/analyze-route.ts), Yahoo->Stooq additiv ergaenzen statt ersetzen.
    if (prices.length < 100) {
      try {
        const alt = await altFetchYahooThenStooq(ticker, FETCH_FROM, FETCH_TO);
        if (Array.isArray(alt) && alt.length > prices.length) {
          const existingDates = new Set(prices.map(p => p.date));
          const merged = [...prices];
          for (const bar of alt) {
            if (bar?.date && typeof bar?.close === "number" && !existingDates.has(bar.date)) {
              merged.push({ date: bar.date, close: bar.close });
            }
          }
          prices = merged;
        }
      } catch {
        // Fallback fehlgeschlagen -> bei der FMP-Historie bleiben, kein Abbruch.
      }
    }
    result.prices = prices;

    result.marketCap = Array.isArray(marketCapRaw)
      ? marketCapRaw.filter((r: any) => r?.date && typeof r?.marketCap === "number").map((r: any) => ({ date: r.date, marketCap: r.marketCap }))
      : [];

    result.fetchedOk = result.prices.length > 0;
    if (!result.fetchedOk) result.error = "keine historischen Kurse verfuegbar (auch nach Yahoo/Stooq-Fallback)";
  } catch (e: any) {
    result.error = e?.message ?? String(e);
  }

  cacheSetRaw(cacheKey, result);
  return result;
}

// ============================================================
// 3. Pro-asOf-Ableitung — NUR aus gecachten Rohdaten, KEIN FMP-Call hier.
// ============================================================

/** filingDate <= asOf Filter — identisches Prinzip wie
 *  server/backtest/pit.ts:filingAsOfIncomeStatement(), hier auf bereits im
 *  Speicher vorliegende (gecachte) Zeilen angewendet statt live zu fetchen. */
function filterByFilingDate<T extends { filingDate: string | null }>(rows: T[], asOf: string): T[] {
  return rows.filter(r => r.filingDate != null && r.filingDate <= asOf);
}

function lastCloseAtOrBefore(prices: PriceRow[], asOf: string): number | null {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const upto = sorted.filter(p => p.date <= asOf);
  return upto.length > 0 ? upto[upto.length - 1].close : null;
}

function sumTrailing4Q<T>(rowsFilingAsc: T[], pick: (r: T) => number | null): number | null {
  // rowsFilingAsc: chronologisch NACH filingDate absteigend sortiert erwartet
  // (newest-first) — wir nehmen die ersten 4 mit gueltigem Wert.
  const vals: number[] = [];
  for (const r of rowsFilingAsc) {
    const v = pick(r);
    if (typeof v === "number" && isFinite(v)) vals.push(v);
    if (vals.length >= 4) break;
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0);
}

export interface PitValuationResult {
  ticker: string;
  asOf: string;
  dataComplete: boolean;
  reasons: string[];
  price: number | null;
  sector: string;
  industry: string;
  fcfTTM: number | null;
  revenueTTM: number | null;
  operatingIncomeTTM: number | null;
  ebitdaTTM: number | null;
  invDcf: number | null; // hardened.fvHardened
  crv: number | null; // hardened.crvHardened
  fv: number | null; // hardened.fvHardened (identisch zu invDcf, siehe replayAt-ReplayAtInput)
  wc: number | null; // hardened.wcUsed
  fcf_T: number | null;
  wacc_T: number | null;
  g_T: number | null;
  WC_T: number | null;
  govExposurePct: number | null;
}

/**
 * derivePitValuation() — Kernstueck dieser Datei. Nimmt bereits gecachte
 * TickerRawData entgegen (kein I/O hier) und leitet fuer EIN `asOf`-Datum
 * den vollen gehaerteten DCF/CRV-Pfad ab, exakt mirror der Sequenz in
 * server/analyze-route.ts (Zeilen ~1961-1997):
 *
 *   buildDefaultDCFParams(analysis) -> calculateFCFFDCF(baseParams) ->
 *   worstCaseM1(price, beta5Y, sectorMaxDrawdown) -> computeHardenedCRV({...})
 *
 * Baut dafuer ein MINIMALES StockAnalysis-Objekt REIN aus PIT-Rohwerten:
 *   - currentPrice = letzter Close <= asOf (aus gecachten OHLCV)
 *   - revenue/operatingIncome/ebitda = Summe der letzten 4 Quartale mit
 *     filingDate <= asOf (aus gecachten Quartals-Income-Statements)
 *   - financialStatements.cashFlow.capex/fcf = analog aus gecachten
 *     Quartals-Cashflow-Statements (freeCashFlow direkt, sonst
 *     operatingCashFlow - |capex|, identisches Prinzip wie
 *     server/analyze-helpers.ts)
 *   - sectorProfile.waccScenarios/growthAssumptions/sectorMaxDrawdown =
 *     getSectorDefaults(sector, industry) — DIESELBE Funktion wie live
 *   - moatRating = null (kein LLM/News-Textanalyse im Batch-Pfad moeglich,
 *     computeHardenedCRV.moatRating ist optional -> kein Fake-Default)
 *   - analystPT.median = currentPrice (kein Analysten-Konsens im Batch-Pfad
 *     verfuegbar -> konservativ neutral, computeDcfVsMarketDivergence bleibt
 *     dadurch inaktiv statt zu raten)
 */
export function derivePitValuation(raw: TickerRawData, asOf: string): PitValuationResult {
  const reasons: string[] = [];
  const base: PitValuationResult = {
    ticker: raw.ticker,
    asOf,
    dataComplete: false,
    reasons,
    price: null,
    sector: raw.profile?.sector ?? "",
    industry: raw.profile?.industry ?? "",
    fcfTTM: null,
    revenueTTM: null,
    operatingIncomeTTM: null,
    ebitdaTTM: null,
    invDcf: null,
    crv: null,
    fv: null,
    wc: null,
    fcf_T: null,
    wacc_T: null,
    g_T: null,
    WC_T: null,
    govExposurePct: null,
  };

  if (!raw.fetchedOk || !raw.profile) {
    reasons.push(raw.error ?? "keine Rohdaten verfuegbar");
    return base;
  }

  const price = lastCloseAtOrBefore(raw.prices, asOf);
  if (price == null || price <= 0) {
    reasons.push("kein Kurs am/vor asOf verfuegbar");
    return base;
  }
  base.price = price;

  // PIT-Filter: nur Quartalszeilen mit filingDate <= asOf, dann die letzten
  // 4 (TTM) summieren — identisches Prinzip wie server/backtest/pit.ts.
  const incomeAtT = filterByFilingDate(raw.quarterlyIncome, asOf);
  const cashflowAtT = filterByFilingDate(raw.quarterlyCashflow, asOf);
  // Bilanz ist ein Stichtagswert -- juengste Zeile MIT filingDate <= asOf
  // (kein TTM-Summieren wie bei Income/Cashflow). filterByFilingDate liefert
  // bereits nach filingDate <= asOf gefiltert, newest-first beibehalten.
  const balanceAtT = filterByFilingDate(raw.quarterlyBalance, asOf);
  const latestBalance = balanceAtT.length > 0 ? balanceAtT[0] : null;
  const pitTotalDebt = latestBalance?.totalDebt ?? raw.profile.totalDebt ?? null;
  const pitCashEquivalents = latestBalance?.cashAndCashEquivalents ?? raw.profile.cashAndCashEquivalents ?? null;

  if (incomeAtT.length === 0) {
    reasons.push("keine Quartalszahlen mit filingDate <= asOf (Ticker hat vor asOf evtl. noch nicht berichtet)");
    return base;
  }

  const revenueTTM = sumTrailing4Q(incomeAtT, r => r.revenue);
  const operatingIncomeTTM = sumTrailing4Q(incomeAtT, r => r.operatingIncome);
  const ebitdaTTM = sumTrailing4Q(incomeAtT, r => r.ebitda) ?? operatingIncomeTTM;

  if (revenueTTM == null || revenueTTM <= 0) {
    reasons.push("revenueTTM <= 0 oder nicht ableitbar aus gecachten Quartalszahlen");
    return base;
  }
  base.revenueTTM = revenueTTM;
  base.operatingIncomeTTM = operatingIncomeTTM;
  base.ebitdaTTM = ebitdaTTM;

  // FCF-TTM: freeCashFlow direkt wenn vorhanden, sonst OCF - |Capex| —
  // identisches Prinzip wie server/analyze-helpers.ts (fcfTTM-Ableitung).
  let fcfTTM: number | null = null;
  let capexTTM: number | null = null;
  if (cashflowAtT.length > 0) {
    const directFcf = sumTrailing4Q(cashflowAtT, r => r.freeCashFlow);
    if (directFcf != null) {
      fcfTTM = directFcf;
    } else {
      const ocfTTM = sumTrailing4Q(cashflowAtT, r => r.operatingCashFlow);
      const capexRaw = sumTrailing4Q(cashflowAtT, r => (r.capitalExpenditure != null ? Math.abs(r.capitalExpenditure) : null));
      if (ocfTTM != null) fcfTTM = ocfTTM - (capexRaw ?? 0);
    }
    capexTTM = sumTrailing4Q(cashflowAtT, r => (r.capitalExpenditure != null ? Math.abs(r.capitalExpenditure) : null));
  }
  base.fcfTTM = fcfTTM;
  base.fcf_T = fcfTTM;

  // Sektor-Defaults — DIESELBE Funktion wie die Live-Pipeline
  // (server/analyze-route.ts -> server/sector-data.ts:getSectorDefaults()).
  const sectorDefaults = getSectorDefaults(base.sector, base.industry);
  const govExposure = estimateGovExposure(base.sector, base.industry, raw.profile.description);
  base.govExposurePct = govExposure.exposure;

  const sectorProfile: SectorProfile = {
    sector: base.sector,
    cycleClass: sectorDefaults.cycleClass,
    politicalCycle: sectorDefaults.politicalCycle,
    waccScenarios: sectorDefaults.waccScenarios,
    growthAssumptions: sectorDefaults.growthAssumptions,
    macroSensitivity: {
      interestUp: { wacc: "", dcf: "" },
      interestDown: { wacc: "", dcf: "" },
      fiscalUp: "",
      fiscalDown: "",
      geoUp: "",
      geoDown: "",
    },
    regulatoryNotes: "",
  };

  const historicalPrices: HistoricalPrice[] = raw.prices
    .filter(p => p.date <= asOf)
    .map(p => ({ date: p.date, close: p.close }));

  if (historicalPrices.length < 30) {
    reasons.push("weniger als 30 Handelstage Kurshistorie vor asOf (RSL/Beta-Anker unzuverlaessig)");
    return base;
  }

  const sharesOutstanding = raw.profile.sharesOutstanding > 0 ? raw.profile.sharesOutstanding : (price > 0 ? 1_000_000 : 0); // konservativer Notnagel nur falls Profile keine Shares liefert
  const marketCap = price * sharesOutstanding;

  // Minimal-aber-valides StockAnalysis-Objekt NUR aus PIT-Rohwerten — der
  // Rest (Katalysatoren/Risks/growthThesis/etc.) bleibt leer/neutral, weil
  // buildDefaultDCFParams() diese Felder nicht liest (siehe shared/
  // valuation-signal.ts:buildDefaultDCFParams — liest nur die unten
  // befuellten Felder).
  const analysis: StockAnalysis = {
    ticker: raw.ticker,
    companyName: raw.ticker,
    exchange: "",
    sector: base.sector,
    industry: base.industry,
    description: raw.profile.description,
    currentPrice: price,
    priceTimestamp: asOf,
    currency: "USD",
    marketCap,
    sharesOutstanding,
    analystPT: { median: price, high: price, low: price, count: 0 },
    ratings: { buy: 0, hold: 0, sell: 0 },
    epsTTM: 0,
    epsAdjFY: 0,
    epsConsensusNextFY: 0,
    epsGrowth5Y: 0,
    peRatio: 0,
    forwardPE: 0,
    pegRatio: 0,
    evEbitda: 0,
    beta5Y: raw.profile.beta || 1.0,
    fcfTTM: fcfTTM ?? 0,
    fcfMargin: fcfTTM != null && revenueTTM > 0 ? (fcfTTM / revenueTTM) * 100 : 0,
    fcfAvailable: fcfTTM != null,
    revenue: revenueTTM,
    ebitda: ebitdaTTM ?? 0,
    operatingIncome: operatingIncomeTTM ?? 0,
    netIncome: 0,
    totalDebt: pitTotalDebt ?? 0,
    cashEquivalents: pitCashEquivalents ?? 0,
    enterpriseValue: marketCap,
    historicalPrices,
    sectorAvgPE: sectorDefaults.sectorAvgPE,
    sectorAvgForwardPE: sectorDefaults.sectorAvgForwardPE,
    sectorAvgEVEBITDA: sectorDefaults.sectorAvgEVEBITDA,
    sectorAvgPEG: sectorDefaults.sectorAvgPEG,
    financialStatements: {
      incomeStatement: {
        revenue: revenueTTM, revenueGrowth: 0,
        grossProfit: 0, grossMargin: 0,
        operatingIncome: operatingIncomeTTM ?? 0, operatingMargin: revenueTTM > 0 ? ((operatingIncomeTTM ?? 0) / revenueTTM) * 100 : 0,
        netIncome: 0, netMargin: 0,
        ebitda: ebitdaTTM ?? 0, ebitdaMargin: 0,
        eps: 0, epsGrowth: 0,
      },
      balanceSheet: {
        totalAssets: 0, totalLiabilities: 0, totalEquity: 0,
        cashEquivalents: raw.profile.cashAndCashEquivalents ?? 0, totalDebt: raw.profile.totalDebt ?? 0, netDebt: (raw.profile.totalDebt ?? 0) - (raw.profile.cashAndCashEquivalents ?? 0),
        debtToEquity: 0, currentRatio: 0,
      },
      cashFlow: {
        operatingCashFlow: 0, capex: capexTTM ?? 0, fcf: fcfTTM ?? 0,
        fcfMargin: fcfTTM != null && revenueTTM > 0 ? (fcfTTM / revenueTTM) * 100 : 0, fcfPerShare: 0,
      },
      health: "Moderate",
      healthReasons: [],
    },
    moatRating: "None",
    governmentExposure: govExposure.exposure,
    growthThesis: "",
    structuralTrends: [],
    cycleClassification: sectorDefaults.cycleClass,
    politicalCycle: sectorDefaults.politicalCycle,
    sectorMaxDrawdown: sectorDefaults.sectorMaxDrawdown,
    sectorProfile,
    catalysts: [],
    risks: [],
    govExposureDetail: govExposure.detail,
    fcfHaircut: 0,
    maxDrawdownHistory: "",
    maxDrawdownYear: "",
  };

  // Exakter Mirror der Live-Sequenz (server/analyze-route.ts ~1961-1997) —
  // UNVERAENDERTE Funktionen aus shared/valuation-signal.ts, kein zweites Modell.
  const baseParams = buildDefaultDCFParams(analysis);
  const conservativeDCF = calculateFCFFDCF(baseParams);
  const m1 = worstCaseM1(analysis.currentPrice, analysis.beta5Y, analysis.sectorMaxDrawdown || 35);
  const hardened = computeHardenedCRV({
    price: analysis.currentPrice,
    conservativeDCF: {
      perShare: conservativeDCF.perShare,
      wacc: conservativeDCF.wacc,
      enterpriseValue: conservativeDCF.enterpriseValue,
      pvTerminal: conservativeDCF.pvTerminal,
    },
    sector: analysis.sector,
    industry: analysis.sectorProfile?.sector ?? analysis.sector,
    ebitMarginPct: baseParams.ebitMargin,
    marginDeltaYoYPp: null, // im Batch-Pfad nicht ohne zusaetzlichen Call ableitbar -> ehrlich null statt raten (kein Gate-Fake)
    fcfMarginYoYPp: analysis.fcfMarginYoyPp ?? null,
    govExposurePct: analysis.governmentExposure ?? null,
    moatRating: null, // kein LLM/News im Batch-Pfad -> ehrlich null statt Fake-Default
    betaAdjDrawdownPct: (1 - m1 / analysis.currentPrice) * 100,
    sectorDrawdownPct: analysis.sectorMaxDrawdown || 35,
    analystPTMedian: analysis.analystPT?.median ?? analysis.currentPrice,
  });

  base.invDcf = hardened.fvHardened;
  base.crv = hardened.crvHardened;
  base.fv = hardened.fvHardened;
  base.wc = hardened.wcUsed;
  base.wacc_T = hardened.waccUsed;
  base.g_T = baseParams.revenueGrowthP1;
  base.WC_T = hardened.wcUsed;
  base.dataComplete = true;

  return base;
}

/**
 * runPitValuation() — Convenience-Wrapper: laedt (gecachte) Rohdaten fuer
 * einen Ticker und leitet direkt den PIT-Valuation-Snapshot fuer EIN asOf
 * ab. Fuer mehrere asOf-Daten desselben Tickers sollte der Aufrufer
 * loadTickerRawData() EINMAL selbst aufrufen und derivePitValuation()
 * mehrfach mit demselben raw-Objekt aufrufen (kein wiederholter FMP-Call).
 */
export async function runPitValuation(ticker: string, asOf: string): Promise<PitValuationResult> {
  const raw = await loadTickerRawData(ticker);
  return derivePitValuation(raw, asOf);
}
