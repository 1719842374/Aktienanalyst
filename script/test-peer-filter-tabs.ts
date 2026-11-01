/**
 * PR B Peer-Selection: Filter-Tabs (Market Cap ±50 %, KGV ±30 %, Industrie) als reine Ansicht.
 * - Helfer in client/src/lib/peerViewFilter.ts
 * - peer-adaptive liefert die Profil-Map aus den bereits geladenen Profilen (kein Extra-Call)
 * - fetchPeerComparisonFromTickers: ohne Map bitgleich, mit Map industry/sector, peerAvg unverändert
 * - SSR: Tabs + Branche/n/a sichtbar, kein Ansichts-Ø im Tab „Alle“
 * Kein Live-FMP: fetch wird gestubbt, FMP_API_KEY ist ein Dummy.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-filter-tabs.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PeerCompany } from "../shared/schema";
import {
  filterPeersForView, peerIndustryLabel, viewAverage, withinRelativeBand, normaliseIndustryLabel,
} from "../client/src/lib/peerViewFilter";
import { resolveAdaptivePeerTickers, type AdaptivePeerProfile } from "../server/peer-adaptive";
import { fetchPeerComparisonFromTickers, normaliseIndustry, setPeerIndustryDepsForTests, type PeerIndustryProfile } from "../server/news-peers";
import PeerComparison from "../client/src/components/sections/PeerComparison";

(globalThis as any).React = React;

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const peer = (ticker: string, marketCap: number | null, pe: number | null, industry?: string | null): PeerCompany => ({
  ticker, name: ticker, pe, peg: 1.2, ps: 3, pb: 4, epsGrowth1Y: 8, epsGrowth5Y: 6, marketCap, revenueGrowth: 5,
  roic: 20, roicFiscalYear: "2025", roic5Y: 18, roic5YYearsUsed: 5,
  ...(industry !== undefined ? { industry } : {}),
});

async function main() {
  console.log("Helfer");
  check("±50 %: 150 bei 100 drin, 151 nicht", withinRelativeBand(150, 100, 0.5) && !withinRelativeBand(151, 100, 0.5));
  check("±50 %: 50 drin, 49 nicht", withinRelativeBand(50, 100, 0.5) && !withinRelativeBand(49, 100, 0.5));
  check("±30 %: 13 bei 10 drin, 13.1 nicht, 7 drin", withinRelativeBand(13, 10, 0.3) && !withinRelativeBand(13.1, 10, 0.3) && withinRelativeBand(7, 10, 0.3));
  check("null / ≤0 nie im Band", !withinRelativeBand(null, 10, 0.3) && !withinRelativeBand(10, null, 0.3) && !withinRelativeBand(-5, 10, 0.3) && !withinRelativeBand(10, 0, 0.3));
  check("Industrie-Normalisierung = Server normaliseIndustry", ["Drug Manufacturers - General", "Auto—Manufacturers", "  Banks  Diversified "].every(s => normaliseIndustryLabel(s) === normaliseIndustry(s)));

  const subject = peer("NVO", 400e9, 20);
  const peers = [
    peer("LLY", 700e9, 26, "Drug Manufacturers - General"),   // cap +75 % raus, KGV +30 % drin
    peer("AZN", 250e9, 14, "Drug Manufacturers - General"),   // cap −37.5 % drin, KGV −30 % drin
    peer("GSK", 80e9, 9, "drug manufacturers – general"),     // cap raus, KGV raus, Industrie drin (normalisiert)
    peer("ABT", 200e9, 30, "Medical Devices"),                // cap −50 % drin, KGV raus
    peer("ADD", 300e9, null, null),                           // manuell hinzugefügt, kein Profil → n/a
  ];
  const tickers = (xs: PeerCompany[]) => xs.map(p => p.ticker).join(",");
  check("Tab Alle = volles Set", tickers(filterPeersForView(peers, subject, "Drug Manufacturers - General", "all")) === "LLY,AZN,GSK,ABT,ADD");
  check("Tab Market Cap ±50 %", tickers(filterPeersForView(peers, subject, null, "marketCap")) === "AZN,ABT,ADD", tickers(filterPeersForView(peers, subject, null, "marketCap")));
  check("Tab KGV ±30 % (KGV null raus)", tickers(filterPeersForView(peers, subject, null, "pe")) === "LLY,AZN", tickers(filterPeersForView(peers, subject, null, "pe")));
  check("Tab Industrie (n/a raus)", tickers(filterPeersForView(peers, subject, "Drug Manufacturers - General", "industry")) === "LLY,AZN,GSK");
  check("Tab Industrie ohne Subjekt-Branche → leer", filterPeersForView(peers, subject, "", "industry").length === 0);
  check("Tab KGV ohne Subjekt-KGV → leer", filterPeersForView(peers, { ...subject, pe: null }, null, "pe").length === 0);
  check("Branche: null → n/a, Feld fehlt → nichts", peerIndustryLabel(peers[4]) === "n/a" && peerIndustryLabel(peer("X", 1, 1)) === null && peerIndustryLabel(peers[0]) === "Drug Manufacturers - General");
  const va = viewAverage(filterPeersForView(peers, subject, null, "pe"));
  check("Ansichts-Ø KGV = (26+14)/2", va.pe === 20, JSON.stringify(va));

  console.log("\npeer-adaptive: Profil-Map ohne Extra-Call");
  const profiles: Record<string, AdaptivePeerProfile> = {
    LLY: { symbol: "LLY", sector: "Healthcare", industry: "Drug Manufacturers - General", marketCap: 700e9, description: "insulin obesity diabetes" },
    AZN: { symbol: "AZN", sector: "Healthcare", industry: "Drug Manufacturers - General", marketCap: 250e9, description: "oncology diabetes" },
    ABT: { symbol: "ABT", sector: "Healthcare", industry: "Medical Devices", marketCap: 200e9, description: "devices diabetes" },
  };
  let profileCalls = 0;
  const resolveArgs = {
    subject: "NVO", subjectSector: "Healthcare", subjectIndustry: "Drug Manufacturers - General", subjectMarketCap: 400e9,
    subjectDescription: "insulin obesity diabetes", subjectSegmentNames: [], seeds: ["LLY", "AZN", "ABT"],
    fmpPeers: async () => [] as string[],
    loadProfile: async (s: string) => { profileCalls++; return profiles[s] ?? null; },
    cacheGet: () => null, cacheSet: () => {}, curatedFallback: null, now: Date.parse("2026-10-18T12:00:00Z"),
  };
  const resolved = await resolveAdaptivePeerTickers(resolveArgs);
  check("Profil-Map enthält Branche je geladenem Kandidaten", resolved.profiles?.get("LLY")?.industry === "Drug Manufacturers - General" && resolved.profiles?.get("ABT")?.industry === "Medical Devices");
  check("ein loadProfile-Call je Kandidat (keine zusätzlichen)", profileCalls === 3, String(profileCalls));
  check("tickers unverändert (F-Logik nicht berührt)", JSON.stringify(resolved.tickers) === JSON.stringify(["AZN", "LLY", "ABT"]), JSON.stringify(resolved.tickers));

  console.log("\nfetchPeerComparisonFromTickers mit/ohne Map (FMP gestubbt)");
  process.env.FMP_API_KEY = "test-dummy-not-a-key";
  // H1: Profil-Nachladen für Peers ohne Map-Eintrag ohne Disk-Cache (kein data.db im Test); FMP-/profile ist gestubbt (leer).
  setPeerIndustryDepsForTests({ cacheGet: () => null, cacheSet: () => {} });
  const fixtures: Record<string, { quote: any; ratios: any[] }> = {
    LLY: { quote: { symbol: "LLY", name: "Eli Lilly", marketCap: 700e9, price: 800, eps: 30 }, ratios: [{ priceToEarningsRatio: 26, priceToSalesRatio: 15, priceToBookRatio: 50, netIncomePerShare: 12, revenuePerShare: 50 }, { netIncomePerShare: 10, revenuePerShare: 40 }] },
    AZN: { quote: { symbol: "AZN", name: "AstraZeneca", marketCap: 250e9, price: 150, eps: 5 }, ratios: [{ priceToEarningsRatio: 14, priceToSalesRatio: 5, priceToBookRatio: 6, netIncomePerShare: 4, revenuePerShare: 30 }, { netIncomePerShare: 3.5, revenuePerShare: 28 }] },
    ADD: { quote: { symbol: "ADD", name: "Added Co", marketCap: 300e9, price: 50, eps: 2 }, ratios: [{ priceToEarningsRatio: 25, priceToSalesRatio: 3, priceToBookRatio: 2, netIncomePerShare: 2, revenuePerShare: 20 }] },
  };
  let fmpCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    // Peer-Variante A (#peer-variants-ab): analyst-estimates je Peer im Profil-Pfad separat zählen.
    if (url.pathname.endsWith("/analyst-estimates")) { estimateCalls++; return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); }
    fmpCalls++;
    const sym = url.searchParams.get("symbol") ?? "";
    const f = fixtures[sym];
    let body: any = [];
    if (url.pathname.endsWith("/quote")) body = f ? [f.quote] : [];
    else if (url.pathname.endsWith("/ratios")) body = f ? f.ratios : [];
    else if (url.pathname.endsWith("/key-metrics")) body = [];
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  let estimateCalls = 0;
  const args = ["NVO", ["LLY", "AZN", "ADD"], 20, 1.5, 40e9, 400e9, 10, 8, { pb: 10, epsGrowth1Y: 12 }] as const;
  const without = await fetchPeerComparisonFromTickers(...args);
  const callsWithout = fmpCalls; fmpCalls = 0;
  const map: ReadonlyMap<string, PeerIndustryProfile> = new Map([["LLY", { sector: "Healthcare", industry: "Drug Manufacturers - General" }], ["AZN", { sector: "Healthcare", industry: "Drug Manufacturers - General" }]]);
  const withMap = await fetchPeerComparisonFromTickers(...args, map);
  const callsWith = fmpCalls;
  // Kette wie in analyze-route.ts: resolved.profiles → fetchPeerComparisonFromTickers(…, peerProfiles)
  const chained = await fetchPeerComparisonFromTickers(...args, resolved.profiles);
  globalThis.fetch = realFetch;
  check("ohne Map: keine industry/sector-Keys (Altpfad bitgleich)", !!without && without.peers.every(p => !("industry" in p) && !("sector" in p)));
  check("mit Map: Branche gesetzt, Peer ohne Profil → null", withMap?.peers.find(p => p.ticker === "LLY")?.industry === "Drug Manufacturers - General" && withMap?.peers.find(p => p.ticker === "ADD")?.industry === null && withMap?.peers.find(p => p.ticker === "ADD")?.sector === null);
  // H1: genau 1 /profile-Call für ADD (kein Map-Eintrag); Stub liefert kein Profil → n/a, Fehlschlag 6 h im Speicher gecacht.
  check("mit Map: nur 1 Profil-Call für den Peer ohne Map-Eintrag (H1), sonst keine", callsWith === callsWithout + 1, `${callsWith} vs ${callsWithout}`);
  check("peerAvg bitgleich mit/ohne Map", JSON.stringify(withMap?.peerAvg) === JSON.stringify(without?.peerAvg), `${JSON.stringify(withMap?.peerAvg)} vs ${JSON.stringify(without?.peerAvg)}`);
  check("subject bitgleich mit/ohne Map", JSON.stringify(withMap?.subject) === JSON.stringify(without?.subject));
  check("Variante A: genau 1 analyst-estimates-Call je Peer nur mit Map", estimateCalls === 3 * 2, `${estimateCalls}`);
  const strip = (ps: any[]) => JSON.stringify(ps.map(({ industry: _i, sector: _s, forwardPe: _f, ...rest }) => rest));
  check("Peers ohne industry/sector bitgleich", strip(withMap!.peers) === JSON.stringify(without!.peers));
  const fullAvg = viewAverage(without!.peers as PeerCompany[]);
  check("Ansichts-Ø auf vollem Set = Server-peerAvg (gleiche Grenzen)", ["pe", "peg", "ps", "pb", "epsGrowth1Y", "epsGrowth5Y", "roic", "roic5Y"].every(k => fullAvg[k] === (without!.peerAvg as any)[k]), `${JSON.stringify(fullAvg)} vs ${JSON.stringify(without!.peerAvg)}`);

  console.log("\nIndustrie-Tab befüllt (Verdrahtung analyze-route)");
  const chainedPeers = (chained?.peers ?? []) as PeerCompany[];
  check("Kette resolve → fetch: Branche aus den 2-Hop-Profilen gesetzt", chainedPeers.find(p => p.ticker === "LLY")?.industry === "Drug Manufacturers - General" && chainedPeers.find(p => p.ticker === "AZN")?.industry === "Drug Manufacturers - General", JSON.stringify(chainedPeers.map(p => [p.ticker, p.industry])));
  check("Kette: manuell hinzugefügter Peer ohne Profil → null (n/a)", chainedPeers.find(p => p.ticker === "ADD")?.industry === null);
  const industryTab = filterPeersForView(chainedPeers, { marketCap: 400e9, pe: 20 }, "Drug Manufacturers - General", "industry");
  check("Industrie-Tab nicht leer: LLY, AZN", industryTab.map(p => p.ticker).sort().join(",") === "AZN,LLY", industryTab.map(p => p.ticker).join(","));
  check("Kette: peerAvg bitgleich zum Altpfad ohne Map", JSON.stringify(chained?.peerAvg) === JSON.stringify(without?.peerAvg));
  const routeSrc = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  check("analyze-route übernimmt resolved.profiles", routeSrc.includes("peerProfiles = resolved.profiles;"));
  check("analyze-route reicht peerProfiles an fetchPeerComparisonFromTickers", /\{ pb: subjectPB, epsGrowth1Y: subjectEpsGrowth1Y \},\s*peerProfiles,\s*\);/.test(routeSrc));
  check("analyze-route: genau 3 peerProfiles-Vorkommen (Deklaration, Zuweisung, Übergabe)", (routeSrc.match(/peerProfiles/g) ?? []).length === 3);

  console.log("\nSSR");
  const data: any = {
    ticker: "NVO", industry: "Drug Manufacturers - General",
    peerComparison: { subject: { ...subject, ticker: "NVO" }, peers, peerAvg: without!.peerAvg },
    activePeerOverrides: { add: ["ADD"], remove: [] },
  };
  const html = renderToStaticMarkup(React.createElement(PeerComparison as any, { data, onOverridesChange: () => {} }));
  check("Tabs gerendert", ["all", "marketCap", "pe", "industry"].every(k => html.includes(`data-testid="peer-view-tab-${k}"`)));
  check("Tab-Labels neutral „KGV“ (kein TTM, kein Forward)", html.includes("Ähnliche Market Cap (±50 %)") && html.includes("Ähnliches KGV (±30 %)") && !html.includes("KGV TTM") && html.includes("Gleiche Industrie") && !/>[^<]*forward[^<]*</i.test(html));
  check("Tab-Zähler: Alle (5), Market Cap (3), KGV (2), Industrie (3)", html.includes("Alle (5)") && html.includes("Ähnliche Market Cap (±50 %) (3)") && html.includes("Ähnliches KGV (±30 %) (2)") && html.includes("Gleiche Industrie (3)"));
  check("KGV-Tooltip nennt die gemischte Basis", html.includes('title="Subjekt ≈ TTM (quote.pe), Peers letztes Geschäftsjahr (/ratios)"'));
  check("Tab Alle: kein Ansichts-Ø, Ø Peers da", !html.includes('data-testid="peer-view-avg"') && html.includes("Ø Peers"));
  check("Peer ohne Profil zeigt n/a", /data-testid="peer-industry">n\/a</.test(html));
  check("alle 5 Peer-Zeilen im Tab Alle", (html.match(/data-testid="peer-industry"/g) ?? []).length === 5);

  console.log("\nScore/PDF unberührt");
  const serverFiles: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) serverFiles.push(p); } };
  walk(new URL("../server", import.meta.url).pathname);
  check("kein Server-Modul importiert peerViewFilter", serverFiles.every(f => !readFileSync(f, "utf8").includes("peerViewFilter")));
  const pdf = readFileSync(new URL("../server/pdf-export.ts", import.meta.url), "utf8");
  check("PDF liest weiter peerComparison.peerAvg (volles Set)", pdf.includes("peerAvg"));

  console.log(failed === 0 ? "\n✅ Alle Peer-Filter-Tab-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(err => { console.error(err); process.exit(1); });
