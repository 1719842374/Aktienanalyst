/**
 * JOB 15: kurzer Antwort-Cache für /api/analyze-gold mit Dedupe paralleler Anfragen.
 *
 * - Erfolgreiche Antworten werden ttlMs lang unverändert (dasselbe Objekt, dieselben Bytes) ausgeliefert.
 * - Laufen mehrere Anfragen gleichzeitig an, teilen sie EINEN Ladevorgang (in-flight).
 * - Fehler werden nicht gecacht; die nächste Anfrage lädt neu.
 * - bypass (z. B. ?fresh=1) lädt neu und ersetzt den Eintrag, teilt aber einen laufenden Ladevorgang.
 */
export const GOLD_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000;
/** JOB 16: Antworten mit internen Ersatzwerten (partial:true) höchstens 2 min. */
export const GOLD_ANALYSIS_PARTIAL_TTL_MS = 2 * 60 * 1000;

export type GoldCacheStatus = "miss" | "hit" | "shared" | "bypass";

export interface GoldResponseCache<T> {
  get(loader: () => Promise<T>, opts?: { bypass?: boolean }): Promise<{ value: T; status: GoldCacheStatus; ageMs: number }>;
  clear(): void;
  readonly loads: number;
}

export function createGoldResponseCache<T>(
  ttlMs: number,
  now: () => number = Date.now,
  ttlFor: (value: T) => number = () => ttlMs,
): GoldResponseCache<T> {
  let entry: { at: number; value: T; ttl: number } | null = null;
  let inFlight: Promise<T> | null = null;
  let loads = 0;

  const start = (loader: () => Promise<T>): Promise<T> => {
    loads += 1;
    const p = (async () => {
      try {
        const value = await loader();
        entry = { at: now(), value, ttl: ttlFor(value) };
        return value;
      } finally {
        inFlight = null;
      }
    })();
    inFlight = p;
    return p;
  };

  return {
    async get(loader, opts) {
      if (inFlight) {
        const value = await inFlight;
        return { value, status: "shared", ageMs: entry ? now() - entry.at : 0 };
      }
      if (!opts?.bypass && entry && now() - entry.at < entry.ttl) {
        return { value: entry.value, status: "hit", ageMs: now() - entry.at };
      }
      const value = await start(loader);
      return { value, status: opts?.bypass ? "bypass" : "miss", ageMs: 0 };
    },
    clear() { entry = null; },
    get loads() { return loads; },
  };
}
