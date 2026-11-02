/**
 * Gold-Fetch: mehr als ein Retry, exponentieller Backoff mit benannten Grenzen,
 * Grund ist HTTP-Status oder Timeout, Fallback und Chart-Fehler sind sofort veraltet.
 * Ausführen: npx tsx script/test-gold-fetch-policy.ts
 */
import {
  GOLD_FALLBACK_REFETCH_MS,
  GOLD_FALLBACK_STALE_MS,
  GOLD_FETCH_RETRY_BASE_MS,
  GOLD_FETCH_RETRY_COUNT,
  GOLD_FETCH_RETRY_MAX_MS,
  GOLD_LIVE_STALE_MS,
  fetchGoldWithRetry,
  goldAnalysisRefetchInterval,
  goldAnalysisStaleTime,
  goldChartHistoryRefetchInterval,
  goldChartHistoryStaleTime,
  goldFailureReason,
  goldRetryDelay,
} from "../client/src/lib/goldFetchPolicy";
import { GOLD_FALLBACK_DATA } from "../client/src/lib/goldFallbackData";

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok || info === undefined ? "" : ` → ${JSON.stringify(info)}`}`);
  if (!ok) failed++;
};

check("mehr als ein Retry", GOLD_FETCH_RETRY_COUNT > 1, GOLD_FETCH_RETRY_COUNT);
check("Basis und Maximum sind positiv und Maximum ≥ Basis", GOLD_FETCH_RETRY_BASE_MS > 0 && GOLD_FETCH_RETRY_MAX_MS >= GOLD_FETCH_RETRY_BASE_MS);

const delays = [0, 1, 2, 3, 4].map(goldRetryDelay);
check("Backoff verdoppelt ab der Basis", delays[0] === GOLD_FETCH_RETRY_BASE_MS && delays[1] === GOLD_FETCH_RETRY_BASE_MS * 2 && delays[2] === GOLD_FETCH_RETRY_BASE_MS * 4, delays);
check("Backoff deckelt am Maximum", delays[3] === GOLD_FETCH_RETRY_MAX_MS && delays[4] === GOLD_FETCH_RETRY_MAX_MS, delays);

check("HTTP-Status aus Gold-API", goldFailureReason(new Error("HTTP 503")) === "HTTP 503");
check("HTTP-Status aus älterem Gold-API-Text", goldFailureReason(new Error("Gold-API 502")) === "HTTP 502");
check("Timeout-Text bleibt vollständig", goldFailureReason(new Error("Timeout: Server hat nicht innerhalb von 90s geantwortet")) === "Timeout: Server hat nicht innerhalb von 90s geantwortet");
check("leerer Fehler wird benannt", goldFailureReason(undefined) === "Live-API nicht erreichbar");

check("Fallback staleTime 0", goldAnalysisStaleTime(GOLD_FALLBACK_DATA) === GOLD_FALLBACK_STALE_MS && GOLD_FALLBACK_STALE_MS === 0);
check("Live-Daten bleiben 5 min frisch", goldAnalysisStaleTime({ timestamp: "2026-11-02T00:00:00.000Z" }) === GOLD_LIVE_STALE_MS);
check("Fallback wird im Hintergrund nachgeladen", goldAnalysisRefetchInterval(GOLD_FALLBACK_DATA) === GOLD_FALLBACK_REFETCH_MS);
check("Live-Daten ohne Intervall", goldAnalysisRefetchInterval({ timestamp: "2026-11-02T00:00:00.000Z" }) === false);

check("Chart-Fehler staleTime 0", goldChartHistoryStaleTime({ loadError: "HTTP 500", incomplete: true }) === 0);
check("Chart-Fehler wird nachgeladen", goldChartHistoryRefetchInterval({ loadError: "Timeout: Server hat nicht innerhalb von 90s geantwortet" }) === GOLD_FALLBACK_REFETCH_MS);
check("unvollständige Historie weiter 10 min", goldChartHistoryStaleTime({ incomplete: true, loadError: null }) === 10 * 60 * 1000);
check("volle Historie weiter 6 h", goldChartHistoryStaleTime({ incomplete: false, loadError: null }) === 6 * 60 * 60 * 1000);
check("erfolgreiche Historie ohne Intervall", goldChartHistoryRefetchInterval({ loadError: null }) === false);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

{
  let calls = 0;
  const waited: number[] = [];
  const result = await fetchGoldWithRetry<{ spotPrice: number }>("/api/analyze-gold", {
    sleep: async (ms) => { waited.push(ms); },
    request: async () => {
      calls += 1;
      if (calls < GOLD_FETCH_RETRY_COUNT) return json(503, { error: "cold" });
      return json(200, { spotPrice: 4100 });
    },
  });
  check("Erfolg vor dem letzten Retry", result.ok === true && result.ok && result.data.spotPrice === 4100, result);
  check("Versuche = Fehlschläge + Erfolg, weniger als das Maximum", calls === GOLD_FETCH_RETRY_COUNT && calls < GOLD_FETCH_RETRY_COUNT + 1, calls);
  check("Wartezeiten folgen dem Backoff", waited.length === calls - 1 && waited.every((ms, i) => ms === goldRetryDelay(i)), waited);
}

{
  let calls = 0;
  const waited: number[] = [];
  const result = await fetchGoldWithRetry("/api/gold-chart-history?range=10Y", {
    sleep: async (ms) => { waited.push(ms); },
    request: async () => {
      calls += 1;
      return json(502, { error: "Keine Gold-Historie" });
    },
  });
  check("nach allen Versuchen HTTP 502", result.ok === false && result.reason === "HTTP 502", result);
  check("Anzahl Versuche = 1 + Retry-Count", calls === GOLD_FETCH_RETRY_COUNT + 1, calls);
  check("zwischen den Versuchen genau Retry-Count Pausen", waited.length === GOLD_FETCH_RETRY_COUNT, waited);
}

{
  let calls = 0;
  const result = await fetchGoldWithRetry("/api/analyze-gold", {
    sleep: async () => {},
    request: async () => {
      calls += 1;
      throw new Error("Timeout: Server hat nicht innerhalb von 90s geantwortet");
    },
  });
  check("Timeout übersteht alle Versuche und bleibt der Grund", result.ok === false && result.reason.startsWith("Timeout:") && calls === GOLD_FETCH_RETRY_COUNT + 1, result);
}

{
  const result = await fetchGoldWithRetry<{ points: unknown[] }>("/api/gold-chart-history?range=Max", {
    sleep: async () => {},
    request: async () => json(200, { source: "FMP GCUSD", points: [] }),
  });
  check("HTTP 200 mit leeren Punkten ist kein Ladefehler", result.ok === true && result.data.points.length === 0, result);
}

console.log(failed === 0 ? "\nAlle Gold-Fetch-Policy-Tests grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
