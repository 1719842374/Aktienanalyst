/**
 * K-04 / X-3: getFxRateToUsd darf bei einem FX-Ausfall nicht still auf Kurs 1 fallen.
 *
 * Soll:
 *   - ohne Cache und ohne Kurs → rate null (nicht 1)
 *   - mit abgelaufenem Cache → Cache-Kurs plus fxStale und fxAgeMs
 *   - Berichtswährung ≠ USD und verwendeter Kurs === 1 → Warnung (Log + fxRateOneWarning)
 *
 * Auf main ed1e98cd schlägt der Test fehl (Exit ≠ 0): ohne Cache kommt 1 zurück,
 * der Cache-Treffer hat kein Altersflag, Kurs 1 warnt nicht.
 *
 * Run: npx tsx script/test-fx-rate-fallback.ts
 */
process.env.FMP_API_KEY = "test-key";
process.env.FMP_MIN_INTERVAL_MS = "0";

import { getFxRateToUsd } from "../server/fmp";

const TTL_MS = 60 * 60 * 1000;

interface FxDetail {
  rate: number | null;
  fxStale: boolean;
  fxAgeMs: number | null;
  fxRateOneWarning: boolean;
}

function asDetail(value: unknown): FxDetail {
  if (typeof value === "number") {
    return { rate: value, fxStale: false, fxAgeMs: null, fxRateOneWarning: false };
  }
  if (value && typeof value === "object" && "rate" in value) {
    const row = value as Partial<FxDetail>;
    return {
      rate: typeof row.rate === "number" || row.rate === null ? row.rate : null,
      fxStale: row.fxStale === true,
      fxAgeMs: typeof row.fxAgeMs === "number" ? row.fxAgeMs : null,
      fxRateOneWarning: row.fxRateOneWarning === true,
    };
  }
  return { rate: null, fxStale: false, fxAgeMs: null, fxRateOneWarning: false };
}

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`);
  else {
    failed++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const realFetch = globalThis.fetch;
const realNow = Date.now;
let now = 1_700_000_000_000;
let quote: { price: number } | "down" = "down";

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) return realFetch(input, init);
  if (quote === "down") throw new Error("fx quote down");
  return jsonResponse([{ symbol: "FX", price: quote.price }]);
}) as typeof fetch;
Date.now = () => now;

async function main(): Promise<void> {
  const usd = asDetail(await getFxRateToUsd("USD"));
  check("USD bleibt Kurs 1 ohne Warnung", usd.rate === 1 && usd.fxRateOneWarning === false, JSON.stringify(usd));

  quote = "down";
  const nok = asDetail(await getFxRateToUsd("NOK"));
  check("ohne Cache → null statt 1", nok.rate === null, `rate=${String(nok.rate)}`);

  quote = { price: 0.145 };
  now = 1_700_000_000_000;
  const fresh = asDetail(await getFxRateToUsd("DKK"));
  check("frischer DKK-Kurs wird gecacht", fresh.rate === 0.145 && fresh.fxStale === false, JSON.stringify(fresh));

  quote = "down";
  now += TTL_MS + 5_000;
  const rawStale = await getFxRateToUsd("DKK");
  const stale = asDetail(rawStale);
  const staleFlagOnValue = !!rawStale && typeof rawStale === "object" && (rawStale as FxDetail).fxStale === true;
  check(
    "abgelaufener Cache → Cache-Kurs",
    stale.rate === 0.145,
    `rate=${String(stale.rate)}`,
  );
  check(
    "abgelaufener Cache → fxStale und fxAgeMs",
    staleFlagOnValue && stale.fxAgeMs != null && stale.fxAgeMs >= TTL_MS,
    `fxStale=${String(stale.fxStale)} fxAgeMs=${String(stale.fxAgeMs)} rawType=${typeof rawStale}`,
  );

  quote = { price: 1 };
  const warns: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map((a) => String(a)).join(" "));
    origWarn(...args);
  };
  const rawOne = await getFxRateToUsd("CHF");
  console.warn = origWarn;
  const one = asDetail(rawOne);
  const oneFlag = !!rawOne && typeof rawOne === "object" && (rawOne as FxDetail).fxRateOneWarning === true;
  const logged = warns.some((line) => /CHF/.test(line) && /1/.test(line));
  check(
    "Nicht-USD und Kurs 1 → Flag und Log",
    one.rate === 1 && oneFlag && logged,
    `flag=${String(oneFlag)} logged=${String(logged)} warns=${JSON.stringify(warns)}`,
  );

  Date.now = realNow;
  globalThis.fetch = realFetch;
  if (failed > 0) {
    console.error(`\n${failed} Check(s) fehlgeschlagen`);
    process.exit(1);
  }
  console.log("\nAlle FX-Fallback-Checks grün.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
