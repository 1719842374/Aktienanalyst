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
import { CROSS_MODULE_QUERY_KEYS, crossModuleQueryKeyList } from "../shared/cross-module-refresh";

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
