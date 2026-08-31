/**
 * valuechain-fmp-enrichment.ts
 * ----------------------------
 * Sprint D6a (Rang 5): FMP-Enrichment-Pipeline für die Value-Chain-Firmen
 * (marketCap, CAPEX, Revenue TTM) mit In-Process Rate-Limit-Schichten.
 *
 * Additive neue Datei — server/fmp-fetcher.ts und server/fmp.ts werden nur
 * importiert/gelesen, nicht verändert.
 *
 * Rate-Limit-Schichten exakt nach WORK_VALUECHAIN_SECTOR_ROTATION.md,
 * Abschnitt "Zusammenspiel (Rate Limit Schichten)":
 *
 *   Request
 *     → Cache Hit? → fertig
 *     → Concurrency Gate (max 5–8, In-Process Semaphore)
 *     → wouldExceedBudget()
 *     → withExponentialBackoff(fn, { jitter: "equal" })   [reused from
 *        client/src/lib/withBackoff.ts via relative import — NOT duplicated,
 *        NOT modified. Server bundling via esbuild resolves relative paths
 *        fine; the "@/" alias does NOT resolve in the server esbuild bundle
 *        (verified), so this file intentionally uses a relative import
 *        instead of "@/lib/withBackoff".]
 *     → FMP Call
 *     → bei 429 → Backoff + Jitter → Retry (siehe defaultRetryOn in
 *        withBackoff.ts: retried on 429/502/503/network)
 *     → Ergebnis cachen (12–24h TTL, disk-cache.ts Muster)
 */

import { fmpProfile, fmpCashFlow, fmpIncomeStatement, wouldExceedBudget } from "./fmp";
// Reused as-is (Rang 2, bereits gepusht) — additive relative import, keine
// Kopie der Logik. withBackoff.ts bleibt unveraendert.
import { withExponentialBackoff } from "../client/src/lib/withBackoff";
import { diskResearcherGet, diskResearcherSet } from "./disk-cache";

// ---------------------------------------------------------------------------
// Layer 1: Concurrency Gate (In-Process Semaphore, 5-8 parallel — Spec §2)
// ---------------------------------------------------------------------------

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// Spec-Vorgabe: 5-8 parallele Calls. 6 als Mittelwert, per ENV konfigurierbar.
const CONCURRENCY_LIMIT = Number(process.env.VALUECHAIN_FMP_CONCURRENCY ?? 6);
const gate = new Semaphore(CONCURRENCY_LIMIT);

// ---------------------------------------------------------------------------
// Layer 2 (Cache): 12-24h TTL, disk-cache.ts Muster (diskResearcherGet/Set)
// ---------------------------------------------------------------------------

const ENRICHMENT_CACHE_TTL_MS = Number(
  process.env.VALUECHAIN_FMP_CACHE_TTL_MS ?? 18 * 60 * 60 * 1000 // 18h (im 12-24h Fenster)
);

function cacheKey(ticker: string): string {
  return `valuechain_fmp__${ticker.toUpperCase()}`;
}

export interface ValueChainFmpEnrichment {
  ticker: string;
  marketCap: number | null;
  capex: number | null; // TTM, absolute Zahl (positiv)
  revenueTTM: number | null;
  description: string | null;
  sector: string | null;
  industry: string | null;
  fetchedAt: string;
  /** true, wenn aus Cache statt Live-Call */
  cacheHit: boolean;
  /** true, wenn FMP für dieses Ticker keine verwertbaren Daten lieferte */
  dataMissing: boolean;
}

function readCache(ticker: string): ValueChainFmpEnrichment | null {
  try {
    const hit = diskResearcherGet(cacheKey(ticker));
    if (!hit) return null;
    const age = Date.now() - new Date(hit.fetchedAt || 0).getTime();
    if (!Number.isFinite(age) || age > ENRICHMENT_CACHE_TTL_MS) return null;
    return { ...hit, cacheHit: true };
  } catch {
    return null;
  }
}

function writeCache(entry: ValueChainFmpEnrichment): void {
  try {
    diskResearcherSet(cacheKey(entry.ticker), entry);
  } catch {
    /* disk cache is best-effort — nie den Request deswegen scheitern lassen */
  }
}

/**
 * Ein Firmen-Enrichment durch die vollständige Rate-Limit-Schichten-Kette.
 * Fehlende FMP-Daten → null-Felder + dataMissing:true, NIEMALS geschätzt.
 */
async function enrichOne(ticker: string): Promise<ValueChainFmpEnrichment> {
  // Schicht 1: Cache-Hit-Check
  const cached = readCache(ticker);
  if (cached) return cached;

  // Schicht 2: Concurrency-Gate
  const release = await gate.acquire();
  try {
    // Schicht 3: Budget-Check (wiederverwendet aus server/fmp.ts, keine
    // eigene Zähler-Logik — Ticket-Vorgabe "falls wouldExceedBudget-artige
    // Funktion bereits existiert, wiederverwenden")
    if (wouldExceedBudget(2)) {
      console.warn(`[ValueChain-FMP] Budget knapp — überspringe Enrichment für ${ticker}`);
      return {
        ticker,
        marketCap: null,
        capex: null,
        revenueTTM: null,
        description: null,
        sector: null,
        industry: null,
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
        dataMissing: true,
      };
    }

    // Schicht 4: withExponentialBackoff (equal jitter, Default aus Spec)
    // + Schicht 5: FMP-Call. Bei 429/502/503 retried withExponentialBackoff
    // automatisch mit Backoff+Jitter statt eines Burst-Retries.
    const [profile, cashflow, income] = await Promise.all([
      withExponentialBackoff(() => fmpProfile(ticker), { jitter: "equal" }).catch(() => null),
      withExponentialBackoff(() => fmpCashFlow(ticker, 1), { jitter: "equal" }).catch(() => []),
      withExponentialBackoff(() => fmpIncomeStatement(ticker, 1), { jitter: "equal" }).catch(() => []),
    ]);

    const cf = Array.isArray(cashflow) ? cashflow[0] : null;
    const inc = Array.isArray(income) ? income[0] : null;

    const marketCap = typeof profile?.marketCap === "number" ? profile.marketCap : null;
    const capexRaw = cf?.capitalExpenditure;
    const capex = typeof capexRaw === "number" && Number.isFinite(capexRaw) ? Math.abs(capexRaw) : null;
    const revenueTTM = typeof inc?.revenue === "number" && Number.isFinite(inc.revenue) ? inc.revenue : null;

    const dataMissing = !profile || marketCap == null;

    const entry: ValueChainFmpEnrichment = {
      ticker,
      marketCap,
      capex,
      revenueTTM,
      description: typeof profile?.description === "string" ? profile.description : null,
      sector: typeof profile?.sector === "string" ? profile.sector : null,
      industry: typeof profile?.industry === "string" ? profile.industry : null,
      fetchedAt: new Date().toISOString(),
      cacheHit: false,
      dataMissing,
    };

    // Schicht 6: Ergebnis cachen (12-24h TTL) — auch dataMissing-Ergebnisse,
    // damit ein dauerhaft leeres FMP-Symbol nicht bei jedem Request erneut
    // die komplette Kette durchläuft.
    writeCache(entry);
    return entry;
  } finally {
    release();
  }
}

/**
 * Enrichement für eine Liste von Tickern. Läuft durch dieselbe
 * Rate-Limit-Kette (jeder Call einzeln durch Cache → Gate → Budget →
 * Backoff), Parallelität wird ausschließlich vom Concurrency-Gate begrenzt —
 * kein zusätzlicher Batch-Parallelismus hier, sonst würde das Gate umgangen.
 */
export async function enrichTickersWithFmp(
  tickers: string[]
): Promise<Map<string, ValueChainFmpEnrichment>> {
  const unique = Array.from(new Set(tickers.map((t) => t.toUpperCase())));
  const results = await Promise.all(unique.map((t) => enrichOne(t)));
  const map = new Map<string, ValueChainFmpEnrichment>();
  results.forEach((r) => map.set(r.ticker, r));
  return map;
}
