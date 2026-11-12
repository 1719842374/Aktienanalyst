/**
 * Fixture: ein KI-Ticker steht in derselben Tabelle wie die manuellen Peers,
 * mit denselben Spalten. Fehlende FMP-Felder bleiben n/a. Ø, Gates und Score
 * bleiben die mitgelieferten Zahlen. Ein User-Override +LLY darf.
 * Kein Live-FMP, wenn kein Key gesetzt ist.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-ki-scored-table.ts
 */
import { readFileSync } from "node:fs";
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

function rowHtml(table: string, marker: string): string {
  const at = table.indexOf(marker);
  if (at < 0) return "";
  const start = table.lastIndexOf("<tr", at);
  const end = table.indexOf("</tr>", at);
  return start >= 0 && end > start ? table.slice(start, end + 5) : "";
}

function openTags(fragment: string, tag: "td" | "th"): number {
  return fragment.match(new RegExp(`<${tag}\\b`, "g"))?.length ?? 0;
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

  console.log("\n=== KI-Ticker in derselben Tabelle, nicht im Ø ===");
  {
    const data = analysis([company("SNY"), company("PFE")]);
    const avgBefore = JSON.stringify(data.peerComparison?.peerAvg);
    const peersBefore = (data.peerComparison?.peers ?? []).map((peer) => peer.ticker).join(",");
    const html = renderPeer(data, [kiRow("LLY")]);
    const scored = scoredTable(html);
    const header = scored.slice(scored.indexOf("<thead"), scored.indexOf("</thead>"));
    const manualRow = rowHtml(scored, ">SNY<");
    const kiRowHtml = rowHtml(scored, 'data-testid="row-peer-ki-LLY"');
    const avgRow = rowHtml(scored, ">Ø Peers<");
    check("gescorte Tabelle ist markiert", scored.includes('data-testid="peer-scored-table"'));
    check("genau eine Vergleichstabelle", (html.match(/<table\b/g) ?? []).length === 1);
    check("FMP-Peers SNY und PFE stehen in der gescorten Tabelle", scored.includes("SNY") && scored.includes("PFE"));
    check("Ø Peers bleibt in der gescorten Tabelle", scored.includes("Ø Peers"));
    check("KI-Ticker LLY steht in derselben Tabelle", scored.includes('data-testid="row-peer-ki-LLY"'));
    check("Hinweis: nicht in Ø Peers, Relativ-Score unverändert", scored.includes("nicht in Ø Peers") && scored.includes("Relativ-Score unverändert"));
    check("keine separate Seitenliste", !html.includes('data-testid="peer-ki-side-list"'));
    check("KI-Badge bleibt an der Zeile", scored.includes('data-testid="badge-peer-ki-LLY"'));
    const avgAt = scored.indexOf(">Ø Peers<");
    const kiAt = scored.indexOf("row-peer-ki-LLY");
    check("KI-Zeile steht vor der Ø-Peers-Zeile", kiAt >= 0 && avgAt > kiAt);
    check(
      "KI-Zeile hat dieselbe Spaltenzahl wie Kopf und manuelle Zeile",
      openTags(header, "th") > 0 && openTags(header, "th") === openTags(manualRow, "td") && openTags(manualRow, "td") === openTags(kiRowHtml, "td"),
      `th=${openTags(header, "th")} manual=${openTags(manualRow, "td")} ki=${openTags(kiRowHtml, "td")}`,
    );
    check("Render schreibt peerAvg nicht um", JSON.stringify(data.peerComparison?.peerAvg) === avgBefore);
    check("Render schreibt die Peer-Liste nicht um", (data.peerComparison?.peers ?? []).map((peer) => peer.ticker).join(",") === peersBefore);
    check("Ø-Zeile behält die Fixture-Zahlen", ["20.0", "1.10", "5.0", "4.0", "10.0%", "8.0%", "15.0%", "14.0%"].every((token) => avgRow.includes(token)), avgRow);
    check("KI-KGV 22.4 steht in der KI-Zeile und nicht in der Ø-Zeile", kiRowHtml.includes("22.4") && !avgRow.includes("22.4"));

    const missing = renderPeer(analysis([company("SNY")]), [{ ...kiRow("GM"), pe: null, marketCap: null, roic: null }]);
    const missingRow = rowHtml(scoredTable(missing), 'data-testid="row-peer-ki-GM"');
    check("fehlende KI-Kennzahl nennt den Grund", missingRow.includes("n/a — keine FMP-Kennzahl"));
    check("fehlende KI-Kennzahl wird nicht als 0 gezeigt", !missingRow.includes(">0<") && !missingRow.includes(">0.0<"));

    const manualMissing = renderPeer(analysis([{ ...company("SNY"), pe: null, roic: null }]), []);
    const manualMissingRow = rowHtml(scoredTable(manualMissing), ">SNY<");
    check("manuelle fehlende Nicht-ROIC-Kennzahl bleibt —", manualMissingRow.includes(">—</td>"));
    check("manuelle fehlende ROIC-Kennzahl bleibt n/a", manualMissingRow.includes(">n/a</td>"));
    check("manuelle Zeile übernimmt nicht den KI-Hinweis", !manualMissingRow.includes("keine FMP-Kennzahl"));

    const onlyKi = renderPeer(analysis([]), [kiRow("LLY")]);
    const onlyTable = scoredTable(onlyKi);
    check("ohne FMP-Peers bleibt die KI-Zeile in der Tabelle", onlyTable.includes('data-testid="row-peer-ki-LLY"'));
    check("ohne FMP-Peers keine Seitenliste", !onlyKi.includes('data-testid="peer-ki-side-list"'));
    check("ohne FMP-Peers bleibt die Ø-Zeile die Fixture", rowHtml(onlyTable, ">Ø Peers<").includes("20.0") && !rowHtml(onlyTable, ">Ø Peers<").includes("22.4"));
  }

  console.log("\n=== fehlendes Peer-Set: KI bleibt in derselben Tabelle ===");
  {
    const bareKi = [{ ...kiRow("GM"), pe: null, marketCap: null, roic: null }];
    const nullData = { ticker: "NVO", peerComparison: null } as StockAnalysis;
    const nullHtml = renderPeer(nullData, bareKi);
    const nullTables = nullHtml.match(/<table\b[\s\S]*?<\/table>/g) ?? [];
    const nullTable = nullTables.find((table) => table.includes('data-testid="peer-scored-table"')) ?? "";
    const nullHeader = nullTable.slice(nullTable.indexOf("<thead"), nullTable.indexOf("</thead>"));
    const nullKi = rowHtml(nullTable, 'data-testid="row-peer-ki-GM"');
    check("null: genau eine Tabelle", nullTables.length === 1 && nullTable.length > 0);
    check("null: KI-Zeile in peer-scored-table", nullTable.includes('data-testid="row-peer-ki-GM"'));
    check("null: keine Seitenliste", !nullHtml.includes('data-testid="peer-ki-side-list"'));
    check("null: fehlende Kennzahl nennt den Grund", nullKi.includes("n/a — keine FMP-Kennzahl"));
    check("null: keine Ø-Zeile und keine erfundene 20.0", !nullHtml.includes(">Ø Peers<") && !nullHtml.includes(">20.0<"));
    check("null: fehlende Kennzahl ist nicht 0", !nullKi.includes(">0<") && !nullKi.includes(">0.0<"));
    check("null: dieselbe Spaltenzahl", openTags(nullHeader, "th") > 0 && openTags(nullHeader, "th") === openTags(nullKi, "td"), `th=${openTags(nullHeader, "th")} td=${openTags(nullKi, "td")}`);

    const partial = {
      ticker: "NVO",
      peerComparison: {
        subject: company("NVO", 28),
        peerAvg: { pe: 20, peg: 1.1, ps: 5, pb: 4, epsGrowth1Y: 10, epsGrowth5Y: 8, roic: 15, roic5Y: 14 },
        sectorMedian: { pe: 18, peg: 1.2, ps: 4, pb: 3, epsGrowth: 8, sectorName: "Healthcare" },
      },
    } as StockAnalysis;
    const avgBefore = JSON.stringify(partial.peerComparison?.peerAvg);
    const partialHtml = renderPeer(partial, [kiRow("LLY")]);
    const partialTable = scoredTable(partialHtml);
    const partialAvg = rowHtml(partialTable, ">Ø Peers<");
    check("ohne peers-Feld: KI-Zeile in der vorhandenen Tabelle", partialTable.includes('data-testid="row-peer-ki-LLY"'));
    check("ohne peers-Feld: keine Seitenliste", !partialHtml.includes('data-testid="peer-ki-side-list"'));
    check("ohne peers-Feld: Subjekt bleibt", partialTable.includes(">NVO<"));
    check("ohne peers-Feld: kein erfundener FMP-Peer", !partialTable.includes(">SNY<"));
    check("ohne peers-Feld: mitgeliefertes Ø bleibt, KI-KGV nicht darin", partialAvg.includes("20.0") && !partialAvg.includes("22.4"));
    check("ohne peers-Feld: Render schreibt peerAvg nicht um", JSON.stringify(partial.peerComparison?.peerAvg) === avgBefore);
  }

  console.log("\n=== Datenkette und keine Score-Berechnung in der Tabelle ===");
  {
    const section7 = readFileSync(new URL("../client/src/components/sections/Section7.tsx", import.meta.url), "utf8");
    const tableSrc = readFileSync(new URL("../client/src/components/sections/PeerComparison.tsx", import.meta.url), "utf8");
    check("Section7 reicht peerKiFills als kiPeers an dieselbe Tabelle", section7.includes("kiPeers={peerKiFills ?? []}"));
    check("Section7 holt die Fills über peer-na-fill und setzt nur den Sitzungsstate", section7.includes("/peer-na-fill") && section7.includes("setPeerKiFills(next"));
    check("Peer-Tabelle importiert kein Scoring und kein Peer-Gate", !tableSrc.includes("scoring-integration") && !tableSrc.includes("assessPeerSet") && !tableSrc.includes("scoringWithPeerDelta") && !tableSrc.includes("RELATIVE_GROWTH"));
  }

  console.log("\n=== User +LLY darf in der gescorten Tabelle stehen ===");
  {
    const html = renderPeer(
      analysis([company("SNY"), company("PFE"), company("LLY")], ["LLY"]),
      [kiRow("LLY")],
    );
    const scored = scoredTable(html);
    check("Override-Ticker LLY steht in der gescorten Tabelle", scored.includes(">LLY<"));
    check("bereits gescorter Ticker wird nicht noch einmal als KI-Zeile gezeigt", !scored.includes("row-peer-ki-LLY"));
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
