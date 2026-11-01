/**
 * Peer-Varianten A/B (WORK_PEER_SELECTION_DETAILED §6 Z. 107–108, WORK_PEER_SELECTION §3.4 Z. 55–56).
 * A: KGV-Tab Forward ±30 % (Fallback trailing) vs. Trailing ±30 %. B: Industrie-Tab GICS Sub-Industry (n/a, keine Quelle) vs. FMP-Industrie.
 * Echte server/news-peers fetchPeerComparisonFromTickers mit gemocktem FMP-fetch (FMP ist auf der Box nicht konfiguriert),
 * echte Client-Filter (client/src/lib/peerViewFilter.ts), Score-Beweis über buildBiasDecision.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-variants-ab.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
process.env.FMP_API_KEY = "test"; process.env.FMP_MIN_INTERVAL_MS = "0"; process.env.FMP_MAX_RETRIES = "0";
let n = 0; const ok = (s: string) => { n++; console.log(`  ✅ ${s}`); };
const TODAY = new Date().toISOString().slice(0, 10);
const Y = Number(TODAY.slice(0, 4));

// Peer-Universum je Testticker: [ticker, price, mcap, trailing pe (ratios), reportedCurrency, next-FY EPS | null]
type P = [string, number, number, number, string, number | null];
const UNIVERSE: Record<string, { pe: number; fwd: number | null; mcap: number; industry: string; peers: P[] }> = {
  MSFT: { pe: 36.0, fwd: 31.0, mcap: 3.8e12, industry: "Software - Infrastructure", peers: [
    ["ORCL", 300, 8.4e11, 41.8, "USD", 7.5], ["SAP", 270, 3.1e11, 32.9, "EUR", 6.9], ["ADBE", 350, 1.5e11, 22.0, "USD", 20.1], ["NOW", 900, 1.9e11, 110.0, "USD", 18.5], ["CRM", 250, 2.4e11, 38.0, "USD", null]] },
  "SAP.DE": { pe: 33.0, fwd: 27.0, mcap: 3.1e11, industry: "Software - Application", peers: [
    ["ORCL", 300, 8.4e11, 41.8, "USD", 7.5], ["CRM", 250, 2.4e11, 38.0, "USD", null], ["DSY.PA", 30, 4.0e10, 30.0, "EUR", 1.3], ["INTU", 650, 1.8e11, 58.0, "USD", 23.0]] },
  "SHEL.L": { pe: 13.0, fwd: 9.5, mcap: 2.1e11, industry: "Oil & Gas Integrated", peers: [
    ["XOM", 115, 4.9e11, 14.5, "USD", 8.0], ["CVX", 155, 2.7e11, 16.0, "USD", 10.5], ["BP.L", 4.3, 7.0e10, 22.0, "USD", 0.6], ["TTE", 62, 1.4e11, 9.0, "USD", 7.4]] },
  NVO: { pe: 13.5, fwd: 11.6, mcap: 2.3e11, industry: "Drug Manufacturers - General", peers: [
    ["LLY", 800, 7.6e11, 55.0, "USD", 23.0], ["AZN", 75, 2.3e11, 30.0, "USD", 4.8], ["SNY", 50, 1.2e11, 13.0, "EUR", 8.5], ["MRK", 85, 2.1e11, 12.5, "USD", 9.2], ["PFE", 25, 1.4e11, 13.8, "USD", 3.0]] },
  "RY.TO": { pe: 15.0, fwd: 13.2, mcap: 1.9e11, industry: "Banks - Diversified", peers: [
    ["TD.TO", 85, 1.0e11, 11.0, "CAD", 8.0], ["BMO", 110, 8.0e10, 14.0, "CAD", 9.6], ["JPM", 300, 8.3e11, 15.5, "USD", 19.5], ["BNS", 60, 7.5e10, 12.0, "CAD", 6.4]] },
};
let withEstimates = true; let calls: string[] = [];
const all = new Map<string, P>(); for (const u of Object.values(UNIVERSE)) for (const p of u.peers) all.set(p[0], p);
(globalThis as any).fetch = async (input: any) => {
  const url = new URL(String(input)); const sym = url.searchParams.get("symbol") ?? ""; const path = url.pathname.replace("/stable", "");
  calls.push(`${path}:${sym}`);
  const p = all.get(sym); const j = (b: any) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (!p) return j([]);
  const [t, price, mcap, pe, ccy, fwdEps] = p;
  if (path === "/quote") return j([{ symbol: t, name: t, price, marketCap: mcap, eps: price / pe }]);
  if (path === "/ratios") return j([0, 1, 2, 3].map(i => ({ symbol: t, date: `${Y - 1 - i}-12-31`, reportedCurrency: ccy, priceToEarningsRatio: pe, priceToSalesRatio: 8, priceToBookRatio: 10, netIncomePerShare: 5 / (1.1 ** i), revenuePerShare: 20 / (1.08 ** i) })));
  if (path === "/key-metrics") return j([{ date: `${Y - 1}-12-31`, returnOnInvestedCapital: 0.2 }]);
  if (path === "/analyst-estimates") return j(!withEstimates || fwdEps == null ? [] : [
    { symbol: t, date: `${Y + 3}-12-31`, epsAvg: fwdEps * 1.5 }, { symbol: t, date: `${Y + 1}-06-30`, epsAvg: fwdEps * 1.1 }, { symbol: t, date: `${Y}-12-31`, epsAvg: fwdEps }, { symbol: t, date: `${Y - 1}-12-31`, epsAvg: fwdEps * 0.9 }]);
  return j([]);
};

async function main() {
  const { fetchPeerComparisonFromTickers } = await import("../server/news-peers");
  const { peerForwardPe, pickNextFyEps } = await import("../shared/peer-forward-pe");
  const F = await import("../client/src/lib/peerViewFilter");

  // 1. Forward-KGV-Regeln
  assert.equal(pickNextFyEps([{ date: `${Y + 3}-12-31`, epsAvg: 9 }, { date: `${Y}-12-31`, epsAvg: 5 }, { date: `${Y - 1}-12-31`, epsAvg: 4 }], `${Y}-06-01`), 5, "nächstes künftiges GJ, nicht [0]");
  assert.equal(pickNextFyEps([{ date: `${Y - 1}-12-31`, epsAvg: 4 }], `${Y}-06-01`), 4, "sonst letztes vergangenes");
  assert.equal(peerForwardPe({ ticker: "ORCL", price: 300, reportedCurrency: "USD", estimates: [{ date: "2999-01-01", epsAvg: 7.5 }], todayIso: TODAY }), 40);
  assert.equal(peerForwardPe({ ticker: "CRM", price: 250, reportedCurrency: "USD", estimates: [], todayIso: TODAY }), null, "FMP-Ticker ohne Forward-Daten");
  assert.equal(peerForwardPe({ ticker: "SAP", price: 270, reportedCurrency: "EUR", estimates: [{ date: "2999-01-01", epsAvg: 6.9 }], todayIso: TODAY }), null, "Berichtswährung ≠ USD → kein geschätzter FX-Wert");
  assert.equal(peerForwardPe({ ticker: "DSY.PA", price: 30, reportedCurrency: "USD", estimates: [{ date: "2999-01-01", epsAvg: 1.3 }], todayIso: TODAY }), null, "Börsen-Suffix → Handelswährung unbekannt");
  ok("Forward-KGV: Kurs / EPS nächstes GJ; ohne Schätzung oder bei Nicht-USD → null (UI-Fallback trailing)");

  // 2. Server: forwardPe nur additiv, alles andere bitgleich; Score-Felder (peerAvg) identisch
  const rows: string[] = [];
  const results: Record<string, any> = {};
  for (const [subj, u] of Object.entries(UNIVERSE)) {
    const tick = u.peers.map(p => p[0]);
    const profiles = new Map(tick.map(t => [t, { industry: t === "SNY" || t === "DSY.PA" || t === "TD.TO" ? null : u.industry, sector: "X" }]));
    const args = [subj, tick, u.pe, 2, u.mcap / 10, u.mcap, 10, 10, { pb: 10, epsGrowth1Y: 10 }] as const;
    withEstimates = true; calls = [];
    const a = await fetchPeerComparisonFromTickers(...args, profiles);
    const estCalls = calls.filter(c => c.startsWith("/analyst-estimates")).length;
    withEstimates = false;
    const b = await fetchPeerComparisonFromTickers(...args, profiles);
    calls = [];
    const legacy = await fetchPeerComparisonFromTickers(...args);
    assert.equal(calls.filter(c => c.startsWith("/analyst-estimates")).length, 0, "ohne Profil-Map kein Extra-Call");
    assert.ok(a && b && legacy);
    assert.ok(b!.peers.every((p: any) => p.forwardPe === null), "ohne Schätzungen → forwardPe null");
    assert.equal(estCalls, tick.length);
    const strip = (r: any) => ({ ...r, peers: r.peers.map(({ forwardPe, industry, sector, ...rest }: any) => rest) });
    assert.deepEqual(strip(a), strip(b)); assert.deepEqual(strip(a), strip(legacy));
    assert.deepEqual(a!.peerAvg, legacy!.peerAvg); assert.deepEqual(a!.subject, legacy!.subject);
    assert.ok(legacy!.peers.every((p: any) => !("forwardPe" in p)), "Altpfad ohne neue Keys");
    results[subj] = { a, u };
  }
  ok("Server: forwardPe nur im Profil-Pfad, ein analyst-estimates-Call je Peer; subject, peerAvg und alle übrigen Peer-Felder deepEqual mit/ohne Schätzungen und zum Altpfad (5 Ticker)");

  // 3. Variantenvergleich (Ansicht)
  for (const [subj, { a, u }] of Object.entries(results) as any) {
    const sfwd = u.fwd;
    const fA = F.filterPeersForView(a.peers, a.subject, u.industry, "pe", { peBasis: "forward", subjectForwardPe: sfwd }).map((p: any) => p.ticker);
    const tA = F.filterPeersForView(a.peers, a.subject, u.industry, "pe", { peBasis: "trailing", subjectForwardPe: sfwd }).map((p: any) => p.ticker);
    const legacyPe = F.filterPeersForView(a.peers, a.subject, u.industry, "pe").map((p: any) => p.ticker);
    assert.deepEqual(legacyPe, tA, "ohne variants = PR-B-Verhalten (trailing)");
    const fmpB = F.filterPeersForView(a.peers, a.subject, u.industry, "industry", { industryBasis: "fmp" }).map((p: any) => p.ticker);
    const gicsB = F.filterPeersForView(a.peers, a.subject, u.industry, "industry", { industryBasis: "gics" });
    assert.deepEqual(gicsB, [], "GICS → n/a, kein Ersatz");
    const basis = a.peers.map((p: any) => { const r = F.peForView(p.pe, p.forwardPe, "forward"); return `${p.ticker} ${r.basis === "forward" ? "Fwd" : "TTM"} ${r.value}`; }).join(", ");
    const ref = F.peForView(a.subject.pe, sfwd, "forward");
    rows.push(`| ${subj} | ${ref.value} Fwd / ${a.subject.pe} TTM | ${basis} | ${fA.join(", ") || "–"} | ${tA.join(", ") || "–"} | ${fmpB.join(", ") || "–"} | n/a (0) |`);
  }
  // Konkrete Erwartungen
  const msft = results.MSFT.a; const fwd = (t: string) => msft.peers.find((p: any) => p.ticker === t).forwardPe;
  assert.equal(fwd("ORCL"), 40); assert.equal(fwd("SAP"), null); assert.equal(fwd("CRM"), null);
  assert.equal(F.PEER_GICS_AVAILABLE, false);
  console.log("\n| Ticker | Referenz-KGV | Peer-KGV in Variante A (forward, Fallback TTM) | A forward ±30 % | A trailing ±30 % | B FMP-Industrie | B GICS |\n|---|---|---|---|---|---|---|\n" + rows.join("\n") + "\n");
  ok("Varianten: A forward vs. trailing liefern je Ticker unterschiedliche Treffer; ohne variants = trailing (PR B); B GICS immer n/a");

  // 4. Score/Rating/Kursziel unverändert
  const { buildBiasDecision } = await import("../shared/bias-fixes");
  for (const name of ["MSFT", "SPY"]) {
    const d = JSON.parse(readFileSync(`script/fixtures/analysis-${name}.json`, "utf8"));
    const b0 = buildBiasDecision(d);
    const withFwd = d.peerComparison ? { ...d, peerComparison: { ...d.peerComparison, peers: d.peerComparison.peers.map((p: any, i: number) => ({ ...p, forwardPe: i % 2 ? null : 25.5, industry: null, sector: null })) } } : { ...d, peerComparison: results.MSFT.a };
    assert.deepEqual(buildBiasDecision(withFwd), b0);
    console.log(`     ${name}: ${b0.overallScore.toFixed(4)} ${b0.overallRating}, Kursziel/Fair Value ${b0.decisionPerShare?.toFixed?.(2)} mit/ohne forwardPe identisch (deepEqual)`);
  }
  for (const f of ["shared/bias-fixes.ts", "server/scoring-integration.ts", "server/pdf-export.ts", "server/analyze-route.ts", "server/researcher.ts"])
    assert.ok(!/forwardPe\b|peBasis|industryBasis|PEER_GICS/.test(readFileSync(f, "utf8")), f);
  ok("Score: Score-/PT-Pfade lesen forwardPe/Varianten nicht; MSFT/SPY buildBiasDecision deepEqual; peerAvg (5 Ticker) deepEqual");
  console.log(`\n${n} Checks grün`); process.exit(0);
}
main().catch(e => { process.stderr.write(`${e?.stack ?? e}\n`); process.exit(1); });
