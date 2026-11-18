/**
 * WP19 / FW-05 + FW-34.
 * Gemeinsamer Refresh invalidiert die drei Modul-Keys.
 * Discovery schreibt FiscalPrograms ohne geparstes Budget/Timeline und ohne Score.
 *
 * Ausführen: npx tsx script/test-wp19-cross-module-refresh.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  applyDiscoveryRound,
  discoveryProgramId,
  discoveryStatusFromLabel,
  fiscalProgramFromDiscovery,
  type FiscalProgram,
} from "../server/fiscal-bridge";
import { CROSS_MODULE_QUERY_KEYS, createForceAnalyzeGate, crossModuleQueryKeyList, refreshErrorLine } from "../shared/cross-module-refresh";

const AS_OF = "2026-06-01T00:00:00.000Z";

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  ok ${name}`);
  else {
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    process.exitCode = 1;
  }
}

console.log("\nFW-05 Query-Keys");
{
  const keys = crossModuleQueryKeyList();
  check("drei Keys", keys.length === 3);
  check("analyze", keys[0]?.[0] === "cross-module" && keys[0]?.[1] === "analyze");
  check("researcher", keys[1]?.[1] === "researcher");
  check("portfolio", keys[2]?.[1] === "portfolio");
  check("gleiche Referenzen", keys[0] === CROSS_MODULE_QUERY_KEYS.analyze);
  const client = readFileSync("client/src/lib/crossModuleRefresh.ts", "utf8");
  check("invalidateQueries", client.includes("invalidateQueries"));
  check("POST /api/analyze", client.includes('"/api/analyze"'));
  check("Researcher-Route", client.includes("/api/researcher/"));
  check("OHLCV-Route", client.includes("/api/ohlcv"));
  check("Fiscal-Programme-Route", client.includes("/api/researcher/fiscal-programs"));
  const host = readFileSync("client/src/components/CrossModuleRefresh.tsx", "utf8");
  check("Host invalidiert über die drei Keys", host.includes("CROSS_MODULE_QUERY_KEYS.analyze") && host.includes("CROSS_MODULE_QUERY_KEYS.researcher") && host.includes("CROSS_MODULE_QUERY_KEYS.portfolio"));
  const dashboard = readFileSync("client/src/pages/Dashboard.tsx", "utf8");
  const researcher = readFileSync("client/src/pages/Researcher.tsx", "utf8");
  const portfolio = readFileSync("client/src/pages/PortfolioPage.tsx", "utf8");
  check("Dashboard-Refresh invalidiert", dashboard.includes("invalidateCrossModuleQueries"));
  check("Researcher-Refresh invalidiert", researcher.includes("invalidateCrossModuleQueries"));
  check("Portfolio-Refresh invalidiert", portfolio.includes("invalidateCrossModuleQueries"));
}

console.log("\nEin force-Call pro Ticker und sichtbare Modul-Fehler");
{
  const gate = createForceAnalyzeGate();
  let calls = 0;
  const job = async () => {
    calls += 1;
    throw new Error("HTTP 500: analyze down");
  };
  const first = gate.once("MSFT", job);
  const second = gate.once("msft", job);
  const settled = await Promise.allSettled([first, second]);
  check("MSFT nur ein force-Call", calls === 1, String(calls));
  check("zweiter Aufruf hängt am selben Fehler", settled[0]?.status === "rejected" && settled[1]?.status === "rejected");
  const line = refreshErrorLine([
    { module: "analyze", message: "HTTP 500: analyze down" },
    { module: "macro", message: "HTTP 500: macro down" },
    { module: "capex", message: "HTTP 500: capex down" },
    { module: "fiscal", message: "HTTP 500: fiscal down" },
    { module: "Portfolio", message: "HTTP 500: portfolio down" },
  ]);
  check("Fehlerzeile nennt analyze", line.includes("analyze: HTTP 500"));
  check("Fehlerzeile nennt macro", line.includes("macro: HTTP 500"));
  check("Fehlerzeile nennt capex", line.includes("capex: HTTP 500"));
  check("Fehlerzeile nennt fiscal", line.includes("fiscal: HTTP 500"));
  check("Fehlerzeile nennt Portfolio", line.includes("Portfolio: HTTP 500"));
  const client = readFileSync("client/src/lib/crossModuleRefresh.ts", "utf8");
  check("Client meldet Refresh-Fehler", client.includes("reportRefreshError"));
  check("Client dedupliziert force", client.includes("forceAnalyzeOnce"));
  check("Researcher zeigt 500", readFileSync("client/src/pages/Researcher.tsx", "utf8").includes('guardModule("capex"') && readFileSync("client/src/pages/Researcher.tsx", "utf8").includes('guardModule("fiscal"'));
  check("Portfolio-Refresh wirft HTTP-Status", readFileSync("client/src/pages/PortfolioPage.tsx", "utf8").includes("fetchAnalysisForRefresh"));
}

console.log("\nFW-34 Discovery → Fiscal-Bridge, ohne Zahlen aus Freitext");
{
  const programme = {
    name: "CHIPS and Science Act",
    status: "Active",
    amountUSD: "$280bn",
    budget: "20",
    timeline: "2025-2032",
    rationale: "Halbleiterförderung",
    sectors: ["Semiconductors"],
  };
  const row = fiscalProgramFromDiscovery("US", AS_OF, programme);
  assert.ok(row);
  check("Status Active bleibt announced", row.status === "announced");
  check("Confidence low", row.confidence === "low");
  check("volumeUsdBn bleibt null trotz $280bn", row.volumeUsdBn === null);
  check("startYear bleibt null trotz 2025-2032", row.startYear === null);
  check("endYear bleibt null", row.endYear === null);
  check("id stabil", row.id === discoveryProgramId("US", "CHIPS and Science Act"));
  check("Phasing Out → expired", discoveryStatusFromLabel("Phasing Out") === "expired");
  check("In Implementation nicht deploying", discoveryStatusFromLabel("In Implementation") === "announced");
  check("Unknown-Name wird verworfen", fiscalProgramFromDiscovery("US", AS_OF, { name: "Unknown", amountUSD: "99" }) === null);

  const store = new Map<string, FiscalProgram>();
  const first = applyDiscoveryRound(store, { region: "us", asOf: AS_OF, programmes: [programme] });
  check("erste Runde saved=1", first.saved === 1 && first.invalidated === 0);
  check("Store ohne Volumen", store.get(row.id)?.volumeUsdBn === null);

  const second = applyDiscoveryRound(store, {
    region: "US",
    asOf: "2026-07-01T00:00:00.000Z",
    programmes: [{ ...programme, status: "Phasing Out", amountUSD: "$1bn", timeline: "2020-2021" }],
  });
  check("Phasing Out invalidiert", second.invalidated === 1);
  check("danach expired", store.get(row.id)?.status === "expired");
  check("Volumen auch nach Widerspruch null", store.get(row.id)?.volumeUsdBn === null);
  check("Jahre auch nach Widerspruch null", store.get(row.id)?.startYear === null && store.get(row.id)?.endYear === null);
}

console.log("\nKein Score-Pfad");
{
  const analyze = readFileSync("server/analyze-route.ts", "utf8");
  check("analyze-route ohne Discovery-Sync", !analyze.includes("syncFiscalProgramsFromDiscovery"));
  const researcher = readFileSync("server/researcher.ts", "utf8");
  check("Capex-Route ruft den Sync", researcher.includes("syncFiscalProgramsFromDiscovery"));
  const route = readFileSync("server/fiscal-discovery-route.ts", "utf8");
  check("GET ohne Score-Effekt", route.includes('scoreEffect: "none"') && route.includes("/api/researcher/fiscal-programs"));
  const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
  check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
  check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");
}

if (process.exitCode) {
  console.error("\nWP19 Tests fehlgeschlagen");
} else {
  console.log("\nWP19 Tests grün");
}
