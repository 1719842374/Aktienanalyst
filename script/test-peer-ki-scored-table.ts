/**
 * Fixture: ein KI-Ticker darf nicht in die gescorte Peer-Tabelle.
 * Die kuratierte Map bleibt unverändert. Ein User-Override +LLY darf.
 * Kein Live-FMP, wenn kein Key gesetzt ist.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-ki-scored-table.ts
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PeerCompany, StockAnalysis } from "../shared/schema";
import type { PeerNaFill } from "../shared/peer-na-fill";
import { applyPeerOverrides } from "../server/peer-cache-key";
import { CURATED_PEER_FALLBACK } from "../server/news-peers";
import PeerComparison from "../client/src/components/sections/PeerComparison";

const originalFetch = globalThis.fetch;
let networkCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  networkCalls += 1;
  throw new Error(`Fixture darf kein Netz rufen: ${String(input)}`);
}) as typeof fetch;

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const EXPECTED_CURATED: Record<string, string[]> = {
  BYDDY: ["TSLA", "NIO", "LI", "XPEV", "GELYF"],
  NIO: ["BYDDY", "LI", "XPEV", "TSLA", "GELYF"],
  LI: ["BYDDY", "NIO", "XPEV", "TSLA", "GELYF"],
  XPEV: ["BYDDY", "NIO", "LI", "TSLA", "GELYF"],
  GELYF: ["BYDDY", "TSLA", "NIO", "LI", "XPEV"],
};

function company(ticker: string, pe = 20): PeerCompany {
  return {
    ticker,
    name: ticker,
    pe,
    peg: 1.1,
    ps: 5,
    pb: 4,
    epsGrowth1Y: 10,
    epsGrowth5Y: 8,
    marketCap: 100e9,
    revenueGrowth: 9,
    roic: 15,
    roic5Y: 14,
    roicFiscalYear: "2025",
  };
}

function kiRow(ticker: string): PeerNaFill {
  return {
    ticker,
    name: ticker,
    suggestedBy: "ki",
    marketCap: 200e9,
    pe: 22.4,
    peg: 1.2,
    ps: 8,
    pb: 6,
    epsGrowth1Y: 12,
    epsGrowth5Y: 10,
    revenueGrowth: 9,
    roic: 18,
    roic5Y: 16,
    roicFiscalYear: "2025",
  };
}

function analysis(peers: PeerCompany[], add: string[] = []): StockAnalysis {
  return {
    ticker: "NVO",
    activePeerOverrides: { add, remove: [] },
    peerComparison: {
      subject: company("NVO", 28),
      peers,
      peerAvg: { pe: 20, peg: 1.1, ps: 5, pb: 4, epsGrowth1Y: 10, epsGrowth5Y: 8, roic: 15, roic5Y: 14 },
      sectorMedian: { pe: 18, peg: 1.2, ps: 4, pb: 3, epsGrowth: 8, sectorName: "Healthcare" },
    },
  } as StockAnalysis;
}

function renderPeer(data: StockAnalysis, kiPeers: PeerNaFill[]): string {
  const el = createElement(PeerComparison, {
    data,
    kiPeers,
    onOverridesChange: () => {},
  }) as ReactElement;
  return renderToStaticMarkup(el);
}

/** Die gescorte Tabelle ist die Vergleichstabelle mit der Ø-Peers-Zeile. */
function scoredTable(html: string): string {
  const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  return tables.find((table) => table.includes("Ø Peers")) ?? "";
}

try {
  console.log("\n=== Kuratierte Map unverändert ===");
  {
    check(
      "CURATED_PEER_FALLBACK ist exakt die fünf Auto/EV-Zeilen",
      JSON.stringify(CURATED_PEER_FALLBACK) === JSON.stringify(EXPECTED_CURATED),
      JSON.stringify(CURATED_PEER_FALLBACK),
    );
    check("keine NVO-Zeile", !Object.prototype.hasOwnProperty.call(CURATED_PEER_FALLBACK, "NVO"));
    check(
      "kein LLY in der Map",
      !Object.values(CURATED_PEER_FALLBACK).some((row) => row.includes("LLY")),
    );
  }

  console.log("\n=== User-Override +/− bleibt der Weg in die gescorte Liste ===");
  {
    const next = applyPeerOverrides(["SNY", "PFE", "MRK"], "NVO", ["LLY"], ["PFE"]);
    check("+LLY steht in der effektiven Peer-Liste", next.includes("LLY"), JSON.stringify(next));
    check("−PFE bleibt draußen", !next.includes("PFE"), JSON.stringify(next));
    check("übrige FMP-Peers bleiben", next.includes("SNY") && next.includes("MRK"), JSON.stringify(next));
    check("Subjekt wird nicht als Peer eingetragen", !next.includes("NVO"));
  }

  console.log("\n=== KI-Ticker nicht in der gescorten Tabelle ===");
  {
    const html = renderPeer(analysis([company("SNY"), company("PFE")]), [kiRow("LLY")]);
    const scored = scoredTable(html);
    check("gescorte Tabelle ist markiert", scored.includes('data-testid="peer-scored-table"'));
    check("FMP-Peers SNY und PFE stehen in der gescorten Tabelle", scored.includes("SNY") && scored.includes("PFE"));
    check("Ø Peers bleibt in der gescorten Tabelle", scored.includes("Ø Peers"));
    check(
      "KI-Ticker LLY steht nicht in der gescorten Tabelle",
      !scored.includes("LLY") && !scored.includes("row-peer-ki-LLY"),
      scored.includes("LLY") ? "LLY im gescorten Tabellen-HTML" : "gescorte Tabelle fehlt",
    );
    check("KI-Zeile steht in der Seitenliste", html.includes('data-testid="peer-ki-side-list"') && html.includes('data-testid="row-peer-ki-LLY"'));
    check("Seitenliste liegt außerhalb der gescorten Tabelle", !scored.includes("peer-ki-side-list"));
    check("KI-Badge bleibt an der Seitenliste", html.includes('data-testid="badge-peer-ki-LLY"'));

    const onlyKi = renderPeer(analysis([]), [kiRow("LLY")]);
    check("ohne FMP-Peers gibt es keine gescorte Tabelle", scoredTable(onlyKi) === "");
    check(
      "fehlender Rivale bleibt nur in der Seitenliste",
      onlyKi.includes('data-testid="peer-ki-side-list"') && onlyKi.includes('data-testid="row-peer-ki-LLY"'),
    );
  }

  console.log("\n=== User +LLY darf in der gescorten Tabelle stehen ===");
  {
    const html = renderPeer(
      analysis([company("SNY"), company("PFE"), company("LLY")], ["LLY"]),
      [kiRow("LLY")],
    );
    const scored = scoredTable(html);
    check("Override-Ticker LLY steht in der gescorten Tabelle", scored.includes(">LLY<"));
    check("dieselbe Zeile ist keine KI-Zeile der gescorten Tabelle", !scored.includes("row-peer-ki-LLY"));
    check("bereits gescorter Ticker bleibt aus der Seitenliste", !html.includes('data-testid="row-peer-ki-LLY"'));
    check("Add-Steuerung bleibt", html.includes("+ Peer hinzufügen"));
  }

  console.log("\n=== Kein Live-FMP ===");
  {
    const key = (process.env.FMP_API_KEY ?? "").trim();
    check("Fixture hat kein Netz gerufen", networkCalls === 0, `calls=${networkCalls}`);
    if (!key) check("ohne FMP_API_KEY kein Live-Call", networkCalls === 0);
  }
} finally {
  globalThis.fetch = originalFetch;
}

console.log(failed === 0 ? "\n✅ peer-ki-scored-table Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
