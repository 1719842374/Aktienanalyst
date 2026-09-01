/**
 * script/test-valuechain-semiconductors.ts
 * -----------------------------------------
 * Live-Regressionstest: Halbleiter-Equipment-Klassifikation.
 * Aufruf: npx tsx script/test-valuechain-semiconductors.ts [BASE_URL]
 * Default BASE_URL: http://localhost:5099
 *
 * Prueft gegen GET /api/valuechain?industry=semiconductors&region=Global&force=true:
 *  - Upstream MUSS enthalten: ASML, LRCX, AMAT, KLAC
 *  - Midstream MUSS enthalten: TSM
 *  - Downstream MUSS enthalten: NVDA
 *
 * Live-Test (kein Fixture) -- braucht laufenden Server mit FMP_API_KEY.
 * Siehe tickets/VALUECHAIN_GICS_COVERAGE.md, Abschnitt
 * "LIVE-REGRESSION HALBLEITER".
 */

const BASE_URL = process.argv[2] || process.env.VALUECHAIN_TEST_BASE_URL || "http://localhost:5099";

let failures = 0;
function assertContains(label: string, tickers: string[], expected: string): void {
  if (tickers.includes(expected)) {
    console.log(`✅ ${label}: ${expected} gefunden`);
  } else {
    failures++;
    console.error(`❌ ${label}: ${expected} FEHLT (vorhanden: ${tickers.join(", ") || "keine"})`);
  }
}

async function main(): Promise<void> {
  const url = `${BASE_URL}/api/valuechain?industry=semiconductors&region=Global&force=true`;
  console.log(`GET ${url}`);
  const resp = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!resp.ok) {
    console.error(`❌ HTTP ${resp.status} von /api/valuechain`);
    process.exit(1);
  }
  const json: any = await resp.json();
  const stages = Array.isArray(json.stages) ? json.stages : [];

  const byType: Record<string, string[]> = { upstream: [], midstream: [], downstream: [] };
  for (const s of stages) {
    byType[s.stageType] = (s.companies || []).map((c: any) => String(c.ticker).toUpperCase());
  }

  console.log("\n=== Halbleiter-Equipment Live-Regression ===");
  console.log("Upstream:", byType.upstream.join(", "));
  console.log("Midstream:", byType.midstream.join(", "));
  console.log("Downstream:", byType.downstream.join(", "));
  console.log("");

  assertContains("Upstream ASML", byType.upstream, "ASML");
  assertContains("Upstream LRCX", byType.upstream, "LRCX");
  assertContains("Upstream AMAT", byType.upstream, "AMAT");
  assertContains("Upstream KLAC", byType.upstream, "KLAC");
  assertContains("Midstream TSM", byType.midstream, "TSM");
  assertContains("Downstream NVDA", byType.downstream, "NVDA");

  console.log(`\n${failures === 0 ? "✅ ALLE TESTS BESTANDEN" : `❌ ${failures} FEHLER`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("❌ Testlauf fehlgeschlagen:", err?.message || err);
  process.exit(1);
});
