/**
 * Peer-Add: Duplikat und Hauptticker ohne Request, ein Peer nachladen,
 * Fehlertext, adaptiver Timeout aus dem Median.
 * Lauf: npx tsx script/test-peer-add-guard.ts
 */
import { classifyPeerAdd, PEER_ADD_ALREADY, PEER_ADD_SUBJECT } from "../shared/peer-identity";
import { readFileSync } from "fs";
import {
  FMP_PROVIDER_TIMEOUT_MS,
  LLM_PROVIDER_TIMEOUT_MS,
  PEER_APPEND_FIRST_CALL_TIMEOUT_MS,
  PEER_LATENCY_PERCENTILE,
  PEER_LATENCY_SAFETY_FACTOR,
  PEER_NA_FILL_FIRST_CALL_TIMEOUT_MS,
  clearPeerCallSamples,
  fmpProviderWorstCaseMs,
  peerCallSamples,
  peerLoadingLabel,
  peerTimeoutAbortText,
  peerTimeoutMs,
  percentileMs,
  recordPeerCallMs,
} from "../shared/peer-latency";
import { peerAvgFromPeers } from "../shared/peer-metrics";
import { peerRevenueGrowthDeltaPp } from "../shared/peer-growth-delta";
import { peerKiRowsFromBody } from "../shared/peer-na-fill";
import { appendPeerFromCachedAnalysis } from "../server/peer-incremental";
import { buildScoringForAnalysis } from "../server/scoring-integration";
import type { PeerCompany, StockAnalysis } from "../shared/schema";
import type { PeerNaFill } from "../shared/peer-na-fill";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function company(ticker: string, extra: Partial<PeerCompany> = {}): PeerCompany {
  return {
    ticker,
    name: ticker,
    pe: 20,
    peg: 1.1,
    ps: 5,
    pb: 4,
    epsGrowth1Y: 10,
    epsGrowth5Y: 8,
    marketCap: 100e9,
    revenueGrowth: 10,
    roic: 15,
    roic5Y: 14,
    ...extra,
  };
}

console.log("\n=== Duplikat und Hauptticker, kein Request ===");
{
  const peers = ["ORCL", "GOOGL", "AMZN", "CRM", "NOW"];
  const orcl = classifyPeerAdd({ raw: " orcl ", subject: "MSFT", peers, activeAdd: [] });
  check("ORCL ist bereits Peer", orcl.kind === "already" && orcl.notice === PEER_ADD_ALREADY && orcl.request === false, JSON.stringify(orcl));
  const suffixed = classifyPeerAdd({ raw: "orcl.us", subject: "MSFT", peers, activeAdd: [] });
  check("Suffix ORCL.US ist derselbe Peer", suffixed.kind === "already" && suffixed.request === false, JSON.stringify(suffixed));
  const subject = classifyPeerAdd({ raw: "msft", subject: "MSFT", peers, activeAdd: [] });
  check("MSFT ist der Hauptticker", subject.kind === "subject" && subject.notice === PEER_ADD_SUBJECT && subject.request === false, JSON.stringify(subject));
  const adr = classifyPeerAdd({ raw: "sap", subject: "SAP.DE", peers: ["ORCL"], activeAdd: [] });
  check("SAP ist der Hauptticker von SAP.DE (ADR)", adr.kind === "subject" && adr.request === false, JSON.stringify(adr));
  const vow = classifyPeerAdd({ raw: "VWAPY", subject: "VOW3.DE", peers: ["BMW.DE"], activeAdd: [] });
  check("VWAPY ist der Hauptticker von VOW3.DE", vow.kind === "subject" && vow.request === false, JSON.stringify(vow));
  const fresh = classifyPeerAdd({ raw: "ibm", subject: "MSFT", peers, activeAdd: [] });
  check("IBM ist neu und darf einen Request auslösen", fresh.kind === "new" && fresh.request === true && fresh.ticker === "IBM", JSON.stringify(fresh));
}

console.log("\n=== Timeout: hohes Perzentil × Faktor, getrennte Pools, Erstaufruf ===");
{
  clearPeerCallSamples();
  check("Sicherheitsfaktor ist benannt und > 1", PEER_LATENCY_SAFETY_FACTOR > 1);
  check("Perzentil liegt über dem Median", PEER_LATENCY_PERCENTILE > 0.5);
  const appendFirst = peerTimeoutMs("peer-append");
  const fillFirst = peerTimeoutMs("peer-na-fill");
  check("Erstaufruf peer-append bricht ab", appendFirst === PEER_APPEND_FIRST_CALL_TIMEOUT_MS && appendFirst > 0, String(appendFirst));
  check("Append-Fallback ist der FMP-Worst-Case", appendFirst === fmpProviderWorstCaseMs() && appendFirst > FMP_PROVIDER_TIMEOUT_MS);
  check("Erstaufruf peer-na-fill bricht ab", fillFirst === PEER_NA_FILL_FIRST_CALL_TIMEOUT_MS && fillFirst > appendFirst, String(fillFirst));
  check("KI-Fallback enthält den LLM-Provider-Timeout", fillFirst >= LLM_PROVIDER_TIMEOUT_MS);
  const appendSeconds = appendFirst / 1000;
  const appendShown = Number.isInteger(appendSeconds) ? String(appendSeconds) : appendSeconds.toFixed(1);
  check("Hinweis nennt die Abbruchgrenze", peerLoadingLabel("peer-append").includes(appendShown), peerLoadingLabel("peer-append"));
  check("Abbruch hat einen sichtbaren Text", peerTimeoutAbortText(appendFirst).startsWith("Timeout:") && peerTimeoutAbortText(appendFirst).includes("s"));

  const samples = [6700, 7800];
  const p90 = percentileMs(samples, PEER_LATENCY_PERCENTILE);
  const median = (6700 + 7800) / 2;
  check("P90 der Messungen liegt über dem Median", p90 != null && p90 > median, String(p90));
  for (const ms of samples) recordPeerCallMs("peer-append", ms);
  const timeout = peerTimeoutMs("peer-append");
  check("Timeout ist P90 mal Sicherheitsfaktor", p90 != null && timeout === p90 * PEER_LATENCY_SAFETY_FACTOR, String(timeout));
  check("der langsamere Call liegt unter dem Timeout", 7800 < timeout);
  check("Append-Pool sieht nur seine Messungen", peerCallSamples("peer-append").length === 2 && peerCallSamples("peer-na-fill").length === 0);
  recordPeerCallMs("peer-na-fill", 40000);
  check("KI-Messung ändert den FMP-Timeout nicht", peerTimeoutMs("peer-append") === timeout && peerCallSamples("peer-na-fill").length === 1);

  const dash = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");
  const section7 = readFileSync(new URL("../client/src/components/sections/Section7.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../client/src/lib/queryClient.ts", import.meta.url), "utf8");
  check("Dashboard hängt am peer-append-Pool", dash.includes('peerTimeoutMs("peer-append")') && dash.includes('recordPeerCallMs("peer-append"'));
  check("Section7 hängt am peer-na-fill-Pool", section7.includes('peerTimeoutMs("peer-na-fill")') && section7.includes('recordPeerCallMs("peer-na-fill"'));
  check("apiRequest bricht bei Abort mit demselben Text ab", client.includes("peerTimeoutAbortText") && !client.includes("timeoutMs == null"));
}

console.log("\n=== Ein Peer nachladen, Score-Formel unverändert ===");
{
  const basePeers = [company("ORCL", { revenueGrowth: 8 }), company("SAP", { revenueGrowth: 12 }), company("GOOGL", { revenueGrowth: 10 })];
  const beforeAvg = peerAvgFromPeers(basePeers);
  const beforeDelta = peerRevenueGrowthDeltaPp(9, basePeers.map(p => p.revenueGrowth ?? null));
  const scoringBefore = buildScoringForAnalysis({
    ctx: {
      impliedGStar: 8,
      quarterlyRevenueChronological: [1, 1, 1, 1, 1, 1, 1, 1, 1.02, 1.02, 1.02, 1.02, 1.04, 1.04, 1.04, 1.04],
      annualIncome: [{ revenue: 100, operatingIncome: 20 }, { revenue: 90, operatingIncome: 18 }],
      annualBalance: [{ inventory: 10 }, { inventory: 10 }],
      subjectRevenueGrowth: 9,
      peerRevenueGrowths: basePeers.map(p => p.revenueGrowth ?? null),
      relativeScoreApplies: true,
      regulatoryGate: null,
    },
    health: "Good",
    moatRating: "Wide",
    technicalIndicators: { priceAboveMA200: true, ma50AboveMA200: true },
    catalysts: [],
    price: 100,
    asOfDate: "2026-11-01",
  });
  const analysis = {
    ticker: "MSFT",
    companyName: "Microsoft",
    currentPrice: 100,
    peRatio: 20,
    pegRatio: 1.2,
    marketCap: 3e12,
    epsGrowth5Y: 10,
    revenueGrowth: 9,
    moatRating: "Wide",
    moatAssessment: { overallRating: "Wide", moatSources: [], porterForces: [] },
    peerComparison: {
      subject: company("MSFT", { revenueGrowth: 9, marketCap: 3e12 }),
      peers: basePeers,
      peerAvg: beforeAvg,
      sectorMedian: { pe: 18, peg: 1, ps: 4, pb: 3, epsGrowth: 8, sectorName: "Technology" },
    },
    peerSet: { peerMaterial: false, peerCount: 3, relativeApplies: false, banner: null },
    activePeerOverrides: { add: [], remove: [] },
    scoring: scoringBefore,
    catalysts: [],
    dataTimestamp: "2026-11-01T00:00:00.000Z",
    financialStatements: { incomeStatement: { revenue: 100, revenueGrowth: 9 } },
  } as unknown as StockAnalysis;

  let fetched: string[] = [];
  const dup = await appendPeerFromCachedAnalysis({
    analysis,
    addTicker: "ORCL",
    peerOverrides: { add: ["ORCL"], remove: [] },
  }, {
    fetchPeerComparisonFromTickers: async () => { fetched.push("should-not"); return null; },
  });
  check("Duplikat auf dem Server holt nichts", dup.ok && dup.adopted === false && dup.notice === PEER_ADD_ALREADY && fetched.length === 0, JSON.stringify(dup));
  check("Duplikat lässt den Score stehen", dup.ok && dup.analysis.scoring?.finalScore === scoringBefore.finalScore);

  const subjectHit = await appendPeerFromCachedAnalysis({
    analysis,
    addTicker: "MSFT",
    peerOverrides: { add: ["MSFT"], remove: [] },
  }, { fetchPeerComparisonFromTickers: async () => { fetched.push("subject"); return null; } });
  check("Hauptticker auf dem Server holt nichts", subjectHit.ok && subjectHit.notice === PEER_ADD_SUBJECT && fetched.length === 0, JSON.stringify(subjectHit));

  const ibm = company("IBM", { revenueGrowth: 4, pe: 16, marketCap: 200e9 });
  const added = await appendPeerFromCachedAnalysis({
    analysis,
    addTicker: "IBM",
    peerOverrides: { add: ["IBM"], remove: [] },
  }, {
    fetchPeerComparisonFromTickers: async (_subject, tickers) => {
      fetched.push(tickers.join(","));
      return { subject: company("MSFT"), peers: [ibm], peerAvg: peerAvgFromPeers([ibm]) };
    },
  });
  check("Erfolg holt nur den neuen Ticker", added.ok && added.adopted === true && fetched.includes("IBM"), fetched.join("|"));
  if (added.ok && added.adopted) {
    const names = added.analysis.peerComparison?.peers.map(p => p.ticker) ?? [];
    check("IBM steht in der Peer-Liste, die alten bleiben", names.includes("IBM") && names.includes("ORCL") && names.includes("SAP") && names.includes("GOOGL"), names.join(","));
    const expectedAvg = peerAvgFromPeers([...basePeers, ibm]);
    check("Ø nutzt dieselbe Formel", added.analysis.peerComparison?.peerAvg.pe === expectedAvg.pe, `${added.analysis.peerComparison?.peerAvg.pe} vs ${expectedAvg.pe}`);
    const afterDelta = peerRevenueGrowthDeltaPp(9, [...basePeers, ibm].map(p => p.revenueGrowth ?? null));
    check("Peer-Median-Delta vor dem Add bleibt der alte Wert", beforeDelta === peerRevenueGrowthDeltaPp(9, basePeers.map(p => p.revenueGrowth ?? null)));
    check("neuer Peer verändert nur das Delta, nicht die Formel", afterDelta !== beforeDelta, `${beforeDelta} → ${afterDelta}`);
    check("Score-Objekt kommt aus derselben Pipeline", typeof added.analysis.scoring?.finalScore === "number");
  }

  const missed = await appendPeerFromCachedAnalysis({
    analysis,
    addTicker: "IBM",
    peerOverrides: { add: ["IBM"], remove: [] },
  }, { fetchPeerComparisonFromTickers: async () => null });
  check("ohne Kennzahlen kein stilles Nichts", missed.ok && missed.adopted === false && typeof missed.reason === "string" && missed.reason.length > 0, JSON.stringify(missed));

  const blown = await appendPeerFromCachedAnalysis({
    analysis,
    addTicker: "IBM",
    peerOverrides: { add: ["IBM"], remove: [] },
  }, { fetchPeerComparisonFromTickers: async () => { throw new Error("FMP down"); } });
  check("Fehler liefert einen sichtbaren Text", !blown.ok && blown.error.length > 0 && blown.error.includes("FMP down"), JSON.stringify(blown));
}

console.log("\n=== KI-Antwort: brauchbare Zeile bleibt, Fehler ist sichtbar ===");
{
  const row: PeerNaFill = {
    ticker: "NOW", name: "ServiceNow", suggestedBy: "ki",
    marketCap: 1e11, pe: 40, peg: 1.4, ps: 12, pb: 10,
    epsGrowth1Y: 20, epsGrowth5Y: 18, revenueGrowth: 22, roic: 12, roic5Y: 11, roicFiscalYear: "2025",
  };
  const partial = peerKiRowsFromBody({
    httpOk: true,
    body: { fills: [row, { ...row, ticker: "ORCL" }] },
    existing: ["ORCL", "SAP"],
  });
  check("eine neue KI-Zeile bleibt sichtbar", partial.rows.length === 1 && partial.rows[0].ticker === "NOW" && partial.error === null, JSON.stringify(partial));
  const empty = peerKiRowsFromBody({ httpOk: false, body: { error: "KI-Schätzung unvollständig — nichts übernommen" }, existing: ["ORCL"] });
  check("Fehlertext aus der Response", empty.rows.length === 0 && empty.error === "KI-Schätzung unvollständig — nichts übernommen");
  const silent = peerKiRowsFromBody({ httpOk: false, body: null, existing: [] });
  check("ohne Body kein leerer Fehler", silent.error != null && silent.error.length > 0, String(silent.error));
}

console.log(failed === 0 ? "\n✅ peer-add-guard Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
