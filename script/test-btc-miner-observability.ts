/**
 * BTC-Miner Observability: differenzierte Fehler, genau ein Retry,
 * Stale-Cache wenn ein früherer Erfolg vorliegt.
 *
 * Ausführen: npx tsx script/test-btc-miner-observability.ts
 * Exit-Code 0 = alle Tests bestanden, 1 = Fehler.
 */
import {
  expireMinerCacheForTests,
  fetchMinerData,
  getMinerLastError,
  hashrateHistoryFromBlockchainChart,
  minerUnavailableBody,
  resetMinerCacheForTests,
} from "../server/btc-miner";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const GENERIC = "Miner data unavailable — mempool.space unreachable";

function hashratePayload(n: number) {
  const start = 1_700_000_000;
  return {
    hashrates: Array.from({ length: n }, (_, i) => ({
      timestamp: start + i * 86400,
      avgHashrate: 5e20 + i * 1e18,
    })),
  };
}

const difficultyPayload = [[1_700_000_000, 800000, 8e13, 1.2]];

type FetchHandler = (url: string, call: { hashrate: number; difficulty: number }) => Promise<Response> | Response;

function installFetch(handler: FetchHandler): { counts: { hashrate: number; difficulty: number } } {
  const counts = { hashrate: 0, difficulty: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/mining/hashrate/")) {
      counts.hashrate++;
      return handler(url, counts);
    }
    if (url.includes("/mining/difficulty-adjustments")) {
      counts.difficulty++;
      return handler(url, counts);
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
  return { counts };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function okBoth(): FetchHandler {
  return (url) => {
    if (url.includes("hashrate")) return jsonResponse(hashratePayload(80));
    return jsonResponse(difficultyPayload);
  };
}

async function main() {
  console.log("\nfetchMinerData — Erfolg unverändert");
  {
    resetMinerCacheForTests();
    const { counts } = installFetch(okBoth());
    const data = await fetchMinerData();
    check("liefert MinerData", data != null);
    check("kein stale-Flag", data?.stale !== true);
    check("Hashrate-Punkte durchgereicht", (data?.hashrateHistory.length ?? 0) === 80);
    check("Score berechnet", typeof data?.minerScore?.value === "number");
    check("lastError geleert", getMinerLastError() === null);
    check("ein Versuch (kein Retry)", counts.hashrate === 1 && counts.difficulty === 1);

    const again = await fetchMinerData();
    check("frischer Cache-Hit ohne zweiten Fetch", again === data && counts.hashrate === 1);
  }

  console.log("\nfetchMinerData — HTTP-Fehler ohne Cache");
  {
    resetMinerCacheForTests();
    const { counts } = installFetch((url) => {
      if (url.includes("hashrate")) return new Response("bad gateway", { status: 502 });
      return jsonResponse(difficultyPayload);
    });
    const data = await fetchMinerData();
    const last = getMinerLastError();
    const body = minerUnavailableBody();
    check("null ohne Cache", data === null);
    check("Code MEMPOOL_HTTP", last?.code === "MEMPOOL_HTTP", JSON.stringify(last));
    check("Meldung nennt HTTP-Status", !!last?.message.includes("HTTP 502"), last?.message);
    check("nicht die generische unreachable-Meldung", last?.message !== GENERIC);
    check("503-Body übernimmt Meldung und Code", body.error === last?.message && body.code === "MEMPOOL_HTTP");
    check("genau ein Retry (2 Hashrate-Calls)", counts.hashrate === 2, `hashrate=${counts.hashrate}`);
  }

  console.log("\nfetchMinerData — Netzwerkfehler");
  {
    resetMinerCacheForTests();
    const { counts } = installFetch(() => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
      });
    });
    const data = await fetchMinerData();
    const last = getMinerLastError();
    check("null", data === null);
    check("Code MEMPOOL_NETWORK", last?.code === "MEMPOOL_NETWORK", JSON.stringify(last));
    check("Meldung nennt network error", !!last?.message.includes("network error"));
    check("ein Retry", counts.hashrate === 2, `hashrate=${counts.hashrate}`);
  }

  console.log("\nfetchMinerData — Timeout");
  {
    resetMinerCacheForTests();
    const { counts } = installFetch(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const data = await fetchMinerData();
    const last = getMinerLastError();
    check("null", data === null);
    check("Code MEMPOOL_TIMEOUT", last?.code === "MEMPOOL_TIMEOUT", JSON.stringify(last));
    check("Meldung nennt timed out", !!last?.message.includes("timed out"));
    check("ein Retry", counts.hashrate === 2, `hashrate=${counts.hashrate}`);
  }

  console.log("\nfetchMinerData — zu wenig Hashrate, kein Retry");
  {
    resetMinerCacheForTests();
    const { counts } = installFetch((url) => {
      if (url.includes("hashrate")) return jsonResponse(hashratePayload(12));
      return jsonResponse(difficultyPayload);
    });
    const data = await fetchMinerData();
    const last = getMinerLastError();
    check("null", data === null);
    check("Code INSUFFICIENT_HASHRATE", last?.code === "INSUFFICIENT_HASHRATE", JSON.stringify(last));
    check("Meldung nennt Punktezahl", !!last?.message.includes("12 points"), last?.message);
    check("kein Retry", counts.hashrate === 1, `hashrate=${counts.hashrate}`);
  }

  console.log("\nfetchMinerData — Parse-Fehler, kein Retry");
  {
    resetMinerCacheForTests();
    const { counts } = installFetch((url) => {
      if (url.includes("hashrate")) {
        return new Response("not-json", { status: 200, headers: { "content-type": "application/json" } });
      }
      return jsonResponse(difficultyPayload);
    });
    const data = await fetchMinerData();
    const last = getMinerLastError();
    check("null", data === null);
    check("Code PARSE", last?.code === "PARSE", JSON.stringify(last));
    check("kein Retry", counts.hashrate === 1, `hashrate=${counts.hashrate}`);
  }

  console.log("\nfetchMinerData — ein Retry, dann Erfolg");
  {
    resetMinerCacheForTests();
    let hr = 0;
    const { counts } = installFetch((url) => {
      if (url.includes("hashrate")) {
        hr++;
        if (hr === 1) return new Response("unavailable", { status: 503 });
        return jsonResponse(hashratePayload(80));
      }
      return jsonResponse(difficultyPayload);
    });
    const data = await fetchMinerData();
    check("Erfolg nach Retry", data != null && data.stale !== true);
    check("lastError geleert", getMinerLastError() === null);
    check("zwei Hashrate-Versuche", counts.hashrate === 2, `hashrate=${counts.hashrate}`);
  }

  console.log("\nfetchMinerData — Difficulty-HTTP allein ist kein Fehlschlag");
  {
    resetMinerCacheForTests();
    const { counts } = installFetch((url) => {
      if (url.includes("hashrate")) return jsonResponse(hashratePayload(80));
      return new Response("nope", { status: 500 });
    });
    const data = await fetchMinerData();
    check("MinerData trotz Difficulty-500", data != null);
    check("difficultyHistory leer", (data?.difficultyHistory.length ?? -1) === 0);
    check("kein Retry", counts.hashrate === 1);
  }

  console.log("\nfetchMinerData — Stale-Cache nach abgelaufener TTL");
  {
    resetMinerCacheForTests();
    installFetch(okBoth());
    const fresh = await fetchMinerData();
    const updated = fresh?.lastUpdated;
    const hr = fresh?.currentHashrateEH;
    expireMinerCacheForTests();
    installFetch((url) => {
      if (url.includes("hashrate")) return new Response("bad gateway", { status: 502 });
      return jsonResponse(difficultyPayload);
    });
    const stale = await fetchMinerData();
    check("200-äquivalent: Payload statt null", stale != null);
    check("stale: true", stale?.stale === true);
    check("lastUpdated unverändert", stale?.lastUpdated === updated);
    check("Hashrate des letzten Erfolgs", stale?.currentHashrateEH === hr);
    check("lastError trotzdem gesetzt", getMinerLastError()?.code === "MEMPOOL_HTTP");
  }

  console.log("\nfetchMinerData — Stale bei Preis-Refresh, Cache-Objekt bleibt frisch");
  {
    resetMinerCacheForTests();
    installFetch(okBoth());
    const fresh = await fetchMinerData();
    installFetch(() => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    const stale = await fetchMinerData([{ date: "2024-01-01", price: 50_000 }], 100_000);
    check("Preis-Refresh fällt auf Stale zurück", stale?.stale === true && stale.currentHashrateEH === fresh?.currentHashrateEH);
    const cached = await fetchMinerData();
    check("gespeicherter Erfolg bleibt ohne stale", cached?.stale !== true && cached?.lastUpdated === fresh?.lastUpdated);
  }

  console.log("\nfetchMinerData — mempool.space down, blockchain.info charts");
  {
    resetMinerCacheForTests();
    check(
      "TH/s werden EH/s",
      hashrateHistoryFromBlockchainChart({ values: [{ x: 1_700_000_000, y: 900_000_000 }] })[0]?.hashrateEH === 900,
    );
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("mempool.space")) {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
        });
      }
      if (url.includes("/charts/hash-rate")) {
        return jsonResponse({
          values: Array.from({ length: 220 }, (_, i) => ({ x: 1_700_000_000 + i * 86400, y: 900_000_000 })),
        });
      }
      if (url.includes("/charts/difficulty")) {
        return jsonResponse({
          values: Array.from({ length: 220 }, (_, i) => ({ x: 1_700_000_000 + i * 86400, y: 8e13 })),
        });
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;
    const data = await fetchMinerData([{ date: "2024-06-01", price: 60_000 }], 63_000);
    check("Plot-Daten trotz mempool-Ausfall", data != null && data.stale !== true);
    check("Quelle blockchain.info", data?.hashrateSource === "blockchain.info");
    check("Hashrate 900 EH/s", Math.abs((data?.currentHashrateEH ?? 0) - 900) < 0.01, String(data?.currentHashrateEH));
    check("Serie lang genug für Hash Ribbon", (data?.hashrateHistory.length ?? 0) >= 200);
    check("Difficulty für die Ribbon-Kompression", (data?.difficultyHistory.length ?? 0) >= 200);
    check("lastError nach Fallback leer", getMinerLastError() === null);
  }

  console.log("\nfetchMinerData — längere Preishistorie rechnet Puell neu");
  {
    resetMinerCacheForTests();
    installFetch(okBoth());
    const short = await fetchMinerData([{ date: "2024-01-01", price: 50_000 }], 50_000);
    check("kurze Historie ohne Puell, Zone trotzdem gesetzt", short?.puellMultiple == null && short?.minerZone != null);
    const longHist = Array.from({ length: 400 }, (_, i) => {
      const d = new Date(Date.UTC(2024, 0, 1) + i * 86400000);
      return { date: d.toISOString().slice(0, 10), price: 50_000 };
    });
    const long = await fetchMinerData(longHist, 50_000);
    check("volle Historie setzt Puell", long?.puellMultiple != null, String(long?.puellMultiple));
    check("kein Cache-Treffer der kurzen Serie", long !== short);
  }

  console.log("\nminerUnavailableBody — Fallback nur ohne lastError");
  {
    resetMinerCacheForTests();
    const body = minerUnavailableBody();
    check("Fallback-Code UNKNOWN", body.code === "UNKNOWN");
    check("Fallback-Text vorhanden", body.error === GENERIC);
  }

  console.log("\nfetchMinerData — MEMPOOL_API_BASE");
  {
    const prev = process.env.MEMPOOL_API_BASE;
    const restore = () => {
      if (prev === undefined) delete process.env.MEMPOOL_API_BASE;
      else process.env.MEMPOOL_API_BASE = prev;
    };
    try {
      delete process.env.MEMPOOL_API_BASE;
      resetMinerCacheForTests();
      const defaultUrls: string[] = [];
      installFetch((url) => {
        defaultUrls.push(url);
        if (url.includes("hashrate")) return jsonResponse(hashratePayload(80));
        return jsonResponse(difficultyPayload);
      });
      const unset = await fetchMinerData();
      check("unset liefert Daten", unset != null && unset.stale !== true);
      check("unset Quelle mempool.space", unset?.hashrateSource === "mempool.space");
      check(
        "unset nutzt https://mempool.space/api/v1",
        defaultUrls.includes("https://mempool.space/api/v1/mining/hashrate/all") &&
          defaultUrls.includes("https://mempool.space/api/v1/mining/difficulty-adjustments?interval=144"),
        defaultUrls.join(" | "),
      );

      process.env.MEMPOOL_API_BASE = "   ";
      resetMinerCacheForTests();
      const blankUrls: string[] = [];
      installFetch((url) => {
        blankUrls.push(url);
        if (url.includes("hashrate")) return jsonResponse(hashratePayload(80));
        return jsonResponse(difficultyPayload);
      });
      await fetchMinerData();
      check(
        "leer/Whitespace bleibt Default",
        blankUrls.includes("https://mempool.space/api/v1/mining/hashrate/all"),
        blankUrls.join(" | "),
      );

      process.env.MEMPOOL_API_BASE = "https://relay.example/mempool/api/v1/";
      resetMinerCacheForTests();
      const overrideUrls: string[] = [];
      installFetch((url) => {
        overrideUrls.push(url);
        if (url.includes("hashrate")) return jsonResponse(hashratePayload(80));
        return jsonResponse(difficultyPayload);
      });
      const overridden = await fetchMinerData();
      check("Override liefert Daten", overridden != null && overridden.stale !== true);
      check("Override-Erfolg Quelle mempool.space", overridden?.hashrateSource === "mempool.space");
      check(
        "Hashrate-Fetch geht an Override-Base",
        overrideUrls.includes("https://relay.example/mempool/api/v1/mining/hashrate/all"),
        overrideUrls.join(" | "),
      );
      check(
        "Difficulty-Fetch geht an Override-Base",
        overrideUrls.includes("https://relay.example/mempool/api/v1/mining/difficulty-adjustments?interval=144"),
        overrideUrls.join(" | "),
      );

      resetMinerCacheForTests();
      const warns: string[] = [];
      const errors: string[] = [];
      const origWarn = console.warn;
      const origError = console.error;
      console.warn = (...args: unknown[]) => {
        warns.push(args.map(String).join(" "));
        origWarn(...args);
      };
      console.error = (...args: unknown[]) => {
        errors.push(args.map(String).join(" "));
        origError(...args);
      };
      let failedFetch: Awaited<ReturnType<typeof fetchMinerData>> = null;
      let last: ReturnType<typeof getMinerLastError> = null;
      let body: ReturnType<typeof minerUnavailableBody> | null = null;
      let failCounts = { hashrate: 0, difficulty: 0 };
      try {
        const installed = installFetch(() => {
          throw Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
          });
        });
        failCounts = installed.counts;
        failedFetch = await fetchMinerData();
        last = getMinerLastError();
        body = minerUnavailableBody();
      } finally {
        console.warn = origWarn;
        console.error = origError;
      }
      check("Override-Netzwerkfehler bleibt null ohne Cache", failedFetch === null);
      check("Override-Fail-Code bleibt MEMPOOL_NETWORK", last?.code === "MEMPOOL_NETWORK", JSON.stringify(last));
      check("Override-Fail-Body bleibt MEMPOOL_NETWORK", body?.code === "MEMPOOL_NETWORK" && body.error === last?.message);
      check("Override-Fail hat genau einen Retry", failCounts.hashrate === 2, `hashrate=${failCounts.hashrate}`);
      check(
        "Retry-Log nennt die Override-Base",
        warns.some((line) => line.includes("— base https://relay.example/mempool/api/v1")),
        warns.join(" || "),
      );
      check(
        "Fehler-Log nennt die Override-Base",
        errors.some((line) => line.includes("— base https://relay.example/mempool/api/v1")),
        errors.join(" || "),
      );

      resetMinerCacheForTests();
      let relayHashrateCalls = 0;
      const fallbackUrls: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        fallbackUrls.push(url);
        if (url.includes("/mining/hashrate/") || url.includes("/mining/difficulty-adjustments")) {
          if (url.includes("/mining/hashrate/")) relayHashrateCalls++;
          throw Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
          });
        }
        if (url.includes("/charts/hash-rate")) {
          return jsonResponse({
            values: Array.from({ length: 220 }, (_, i) => ({ x: 1_700_000_000 + i * 86400, y: 900_000_000 })),
          });
        }
        if (url.includes("/charts/difficulty")) {
          return jsonResponse({
            values: Array.from({ length: 220 }, (_, i) => ({ x: 1_700_000_000 + i * 86400, y: 8e13 })),
          });
        }
        throw new Error(`unexpected url ${url}`);
      }) as typeof fetch;
      const viaFallback = await fetchMinerData();
      check(
        "Override-Fail fällt auf blockchain.info zurück",
        viaFallback != null && viaFallback.stale !== true && viaFallback.hashrateSource === "blockchain.info",
      );
      check(
        "Override-Fail-Fallback hat genau einen Mempool-Retry",
        relayHashrateCalls === 2,
        `hashrate=${relayHashrateCalls}`,
      );
      check(
        "Override-Fail hat den Relay getroffen",
        fallbackUrls.some((u) => u === "https://relay.example/mempool/api/v1/mining/hashrate/all"),
        fallbackUrls.join(" | "),
      );
      check(
        "Fallback-Charts bleiben blockchain.info",
        fallbackUrls.some((u) => u.startsWith("https://api.blockchain.info/charts/hash-rate")) &&
          fallbackUrls.some((u) => u.startsWith("https://api.blockchain.info/charts/difficulty")),
        fallbackUrls.join(" | "),
      );
      check(
        "Override-Fail-Fallback Hashrate 900 EH/s",
        Math.abs((viaFallback?.currentHashrateEH ?? 0) - 900) < 0.01,
        String(viaFallback?.currentHashrateEH),
      );
      check("lastError nach erfolgreichem Fallback leer", getMinerLastError() === null);
    } finally {
      restore();
      resetMinerCacheForTests();
    }
  }

  console.log(`\n${total - failed}/${total} bestanden`);
  if (failed > 0) {
    console.error(`${failed} fehlgeschlagen`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
