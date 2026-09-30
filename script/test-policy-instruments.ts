/**
 * Politikinstrumente: Belegpflicht, Halbwertzeit, kein stiller Score.
 * Run: npx tsx script/test-policy-instruments.ts
 */
import {
  activeTreasuryBuybackCapBn,
  evidencedReserveShares,
  parsePolicyInstruments,
  parseRegulationNotes,
  priceInInstrument,
  statuteContribution,
  type PolicyInstrument,
} from "../server/policy-instruments";
import { buildPolicyScanPrompt, policyScanIsCacheable } from "../server/crypto-regulation-llm";
import {
  fallbackScanSummary,
  isRefusalSummary,
  mergeByTitle,
  noticesToRegulationPayload,
  parseFederalRegisterPage,
} from "../server/crypto-regulation-sources";
import { defiTvlFromSeries, estimateTBillDemand, type StablecoinMarketSnapshot } from "../server/stablecoin-liquidity";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const evidence = { source: "Amtsblatt", url: "https://example.test/notice", date: "2026-01-01" };

function inst(partial: Partial<PolicyInstrument> & Pick<PolicyInstrument, "office" | "instrumentType" | "status">): PolicyInstrument {
  return {
    id: partial.id ?? "fixture",
    jurisdiction: "US",
    channels: {},
    evidence: [evidence],
    ...partial,
  };
}

console.log("policy instruments");

const parsed = parsePolicyInstruments({
  instruments: [
    { office: "treasury", instrumentType: "debt_operation", status: "enacted", channels: { duration: "easing" }, evidence: [evidence], magnitude: { kind: "cap_bn", value: 6, unit: "bn" } },
    { office: "legislature", instrumentType: "statute", status: "enacted", evidence: [{ source: "x", url: "notaurl", date: "2026-01-01" }] },
    { office: "nope", instrumentType: "statute", status: "enacted", evidence: [evidence] },
    { office: "regulator", instrumentType: "statute", status: "uncertain" },
  ],
});
ok("Beleg ohne https fliegt raus", parsed.instruments.length === 1 && parsed.dropped === 3, `kept=${parsed.instruments.length} dropped=${parsed.dropped}`);

const rejected = inst({ office: "legislature", instrumentType: "statute", status: "rejected", halfLifeDays: 30, expectedMoveBp: -20 });
const rejectedPriced = priceInInstrument(rejected, "2026-01-15", -10);
ok("rejected setzt den Rest sofort auf 0", rejectedPriced.residual === 0);

const enacted = inst({
  office: "legislature",
  instrumentType: "statute",
  status: "enacted",
  effectiveFrom: "2026-02-01",
  decisionDate: "2026-02-21",
  halfLifeDays: 10,
  expectedMoveBp: -20,
  magnitude: { kind: "score", value: 1.2, unit: "score" },
});
const atStart = priceInInstrument(enacted, "2026-02-01", -10);
ok("Uhr startet am Inkrafttreten", atStart.clockStart === "2026-02-01");
ok("Entscheidungstermin setzt die Halbwertzeit", atStart.halfLifeDays === 20);
ok("pricedIn 10/20 = 50", atStart.pricedInPct === 50);
ok("Rest am Start = 0.5", atStart.residual === 0.5, String(atStart.residual));

const later = priceInInstrument(enacted, "2026-02-21", -10);
ok("nach einer Halbwertzeit Rest 0.25", later.residual === 0.25, String(later.residual));

const noDate = priceInInstrument({ ...enacted, evidence: [] }, "2026-02-01", -10);
ok("ohne Belegdatum bleiben die Felder leer", noDate.pricedInPct == null && noDate.halfLifeDays == null && noDate.residual == null);

const buy = inst({
  id: "buy",
  office: "treasury",
  instrumentType: "debt_operation",
  status: "implementing",
  effectiveFrom: "2026-03-01",
  effectiveTo: "2026-06-01",
  channels: { duration: "easing" },
  magnitude: { kind: "cap_bn", value: 4, unit: "bn" },
});
ok("Cap nur waehrend der Laufzeit", activeTreasuryBuybackCapBn([buy], "2026-04-01") === 4);
ok("Cap vor Beginn leer", activeTreasuryBuybackCapBn([buy], "2026-02-01") === null);
ok("Cap nach Ende leer", activeTreasuryBuybackCapBn([buy], "2026-06-02") === null);
const otherOffice = inst({ office: "central_bank", instrumentType: "debt_operation", status: "enacted", channels: { duration: "easing" }, magnitude: { kind: "cap_bn", value: 9, unit: "bn" } });
ok("anderes Amt zaehlt nicht", activeTreasuryBuybackCapBn([otherOffice], "2026-04-01") === null);

const withLiquidity = parsePolicyInstruments({
  instruments: [{
    office: "central_bank",
    instrumentType: "debt_operation",
    status: "enacted",
    channels: { cryptoLiquidity: "up", m2: "up" },
    evidence: [evidence],
  }],
});
ok("Kanal Krypto-Liquiditaet bleibt erhalten", withLiquidity.instruments[0]?.channels.cryptoLiquidity === "up" && withLiquidity.dropped === 0);

const day = 86400;
const tvl = defiTvlFromSeries([
  { date: 1_700_000_000, tvl: 80e9 },
  { date: 1_700_000_000 + 30 * day, tvl: 95e9 },
]);
ok("TVL und 30-Tage-Aenderung sind gemessen", tvl.available && tvl.tvlUsd === 95e9 && tvl.change30dUsd === 15e9, JSON.stringify(tvl));

const shares = [
  inst({ id: "t", office: "regulator", instrumentType: "statute", status: "enacted", magnitude: { kind: "share", value: 0.8, unit: "share", issuer: "USDT" } }),
  inst({ id: "c", office: "regulator", instrumentType: "statute", status: "proposed", magnitude: { kind: "share", value: 0.55, unit: "share", issuer: "USDC" } }),
];
const ev = evidencedReserveShares(shares, "2026-04-01");
ok("nur der belegte Anteil zaehlt", ev.tether === 0.8 && ev.usdc == null, JSON.stringify(ev));

const statute = statuteContribution([
  enacted,
  inst({ office: "legislature", instrumentType: "statute", status: "rejected", magnitude: { kind: "score", value: 1.2, unit: "score" } }),
], "2026-02-01", -10);
ok("enacted Score bleibt, rejected traegt 0 bei", statute.score === 1.2 && statute.contribution === 0.6, JSON.stringify(statute));

const onlyRejected = statuteContribution([
  inst({ office: "legislature", instrumentType: "statute", status: "expired", magnitude: { kind: "score", value: 1.2, unit: "score" } }),
], "2026-02-01", -10);
ok("abgelehnt oder abgelaufen: Beitrag 0", onlyRejected.contribution === 0 && onlyRejected.score == null);

const snapshot: StablecoinMarketSnapshot = {
  available: true,
  fetchedAt: "2026-09-30T00:00:00.000Z",
  totalMarketCapUsd: 300e9,
  totalMarketCapPrevMonthUsd: 290e9,
  usdt: null,
  usdc: null,
  constituentCount: 2,
};
const demand = estimateTBillDemand(snapshot);
ok("Schaetzanteile gehen nicht in den Bedarf", demand.estimatedTBillDemandUsd == null && demand.dynamicMultiplier == null);
ok("30-Tage-Aenderung bleibt gemessen", demand.mcapChange30dUsd === 10e9);

const prompt = buildPolicyScanPrompt({
  asOf: "2026-09-30",
  jurisdiction: "US",
  stablecoinMcapUsd: 1,
  mcapChange30dUsd: 2,
  usdtMcapUsd: 3,
  usdcMcapUsd: 4,
  defiTvlUsd: 95e9,
  defiTvlChange30dUsd: 15e9,
  tgaBn: 5,
  dgs10: 4.1,
  dgs10History: [],
  policyRate: 4.3,
  realYield10y: 1.9,
  m2Bn: 6,
}, [
  {
    title: "Beispielregel aus der Amtssuche",
    url: "https://example.test/notice",
    date: "2026-09-01",
    snippet: "Kurztext",
    office: "regulator",
    instrumentType: "statute",
  },
]);
const banned = ["Trump", "OBBBA", "Ishiba", "Bessent", "GENIUS"];
ok("Prompt enthaelt keine fest eingetragenen Namen", banned.every(w => !prompt.includes(w)), banned.filter(w => prompt.includes(w)).join(","));
ok("Prompt enthaelt das Datum und die gemessene Rendite", prompt.includes("2026-09-30") && prompt.includes("4.1"));
ok(
  "Prompt sucht Krypto-Regulierungen und den Liquiditaetstracker",
  prompt.includes("Krypto-Regulierungen") && prompt.includes("Liquiditätstracker") && prompt.includes("Krypto-Liquidität"),
);
ok(
  "gemessene TVL steht im Prompt",
  prompt.includes("95000000000") && prompt.includes("15000000000"),
);
ok(
  "Kanaele erklaeren Druck auf den Tracker",
  ["cryptoLiquidity", "m2", "longYield", "tBillDemand"].every(ch => prompt.includes(ch)),
);
ok("Prompt verbietet das Ueberschreiben gemessener Zahlen", prompt.includes("überschreibe"));
ok(
  "Prompt verlangt eine deutsche Zusammenfassung und verbietet die leere Ablehnung",
  prompt.includes("summary") && prompt.includes("zwei deutsche Sätze") && prompt.includes("Ablehnung ohne Titel ist ungültig"),
);
ok(
  "Prompt sucht Fiskalprogramm, Leitzins, Realzins und die 10-Jahres-Rendite",
  ["Fiskalprogramm", "Leitzins", "Realzins", "10-Jahres", "M2", "policyRate", "realYield"].every(w => prompt.includes(w)),
);
ok("Amtshinweis steht im Prompt, kein fest eingetragener Gesetzesname", prompt.includes("Beispielregel aus der Amtssuche"));
ok(
  "Prompt verlangt regulations auch ohne URL",
  prompt.includes("regulations") && prompt.includes("estimated") && prompt.includes("unbestätigt"),
);

const estimatedOnly = {
  regulations: [{
    id: "offen",
    title: "Regel ohne Quelle",
    office: "legislature",
    status: "enacted",
    confidence: "cited",
    channels: { cryptoLiquidity: "up" },
    note: "unbestätigt",
  }],
  instruments: [{
    office: "legislature",
    instrumentType: "statute",
    status: "enacted",
    title: "Regel ohne Quelle",
    channels: { cryptoLiquidity: "up" },
  }],
};
const notes = parseRegulationNotes(estimatedOnly);
ok(
  "Regulierung ohne URL bleibt Anzeige und wird estimated",
  notes.regulations.length === 1 && notes.regulations[0].confidence === "estimated" && notes.regulations[0].title === "Regel ohne Quelle",
  JSON.stringify(notes),
);
const notScored = parsePolicyInstruments(estimatedOnly);
ok("dieselbe Zeile ohne https geht nicht in den Score", notScored.instruments.length === 0 && notScored.dropped === 1);

const cited = parseRegulationNotes({
  regulations: [{
    title: "Regel mit Quelle",
    office: "regulator",
    status: "implementing",
    confidence: "estimated",
    evidence: [evidence],
    channels: { cryptoLiquidity: "down" },
  }],
});
ok(
  "https-Beleg setzt cited",
  cited.regulations[0]?.confidence === "cited" && cited.regulations[0]?.evidence.length === 1,
);

ok(
  "leere Ablehnung wird nicht gecacht",
  !policyScanIsCacheable({
    llmAvailable: true,
    summary: "Ohne Beleg keine Namen.",
    instruments: [],
    regulations: [],
    _fallback: true,
  }),
);
ok(
  "unbestätigte Regulierung wird gecacht, der Score bleibt leer",
  policyScanIsCacheable({
    llmAvailable: true,
    summary: "Zwei Sätze zur Liquidität.",
    instruments: [],
    regulations: notes.regulations,
  }) && statuteContribution(notScored.instruments, "2026-09-30", null).contribution === 0,
);
const refusal = "Ohne verifizierte Belege mit URLs und Daten können keine aktuellen US-Krypto-Regulierungen zur Liquiditätsänderung benannt werden.";
ok("die leere Ablehnung wird erkannt", isRefusalSummary(refusal));
ok("eine normale Zusammenfassung ist keine Ablehnung", !isRefusalSummary("Zwei Sätze zur Liquidität und zum Fiskalprogramm."));

const page = parseFederalRegisterPage({
  results: [
    {
      title: "Self-Regulatory Organizations; Example Exchange",
      html_url: "https://www.federalregister.gov/documents/2026/01/02/example-sro",
      publication_date: "2026-01-02",
      abstract: "A crypto listing notice.",
      agencies: [{ slug: "securities-and-exchange-commission" }],
    },
    {
      title: "Payment Stablecoin Reserve Rule",
      html_url: "https://www.federalregister.gov/documents/2026/09/01/example-rule",
      publication_date: "2026-09-01",
      abstract: "Requirements for payment stablecoin reserves.",
      agencies: [{ slug: "federal-reserve-system" }],
    },
    { title: "Short", html_url: "https://www.federalregister.gov/x", publication_date: "2026-09-01", abstract: "stablecoin" },
  ],
}, /crypto|stablecoin|digital asset|virtual currency/i);
const byAbstract = parseFederalRegisterPage({
  results: [{
    title: "Board Responsibilities Under a New Statute",
    html_url: "https://www.federalregister.gov/documents/2026/09/29/example-new",
    publication_date: "2026-09-29",
    abstract: "Responsibilities for payment stablecoin issuance.",
    agencies: [{ slug: "federal-reserve-system" }],
  }],
}, /crypto|stablecoin|digital asset|virtual currency/i, true);
ok("neues Gesetz im Kurztext bleibt erhalten", byAbstract.length === 1 && byAbstract[0].office === "central_bank");
ok(
  "Amtssuche behaelt den Treffer und wirft Boersennotizen weg",
  page.length === 1 && page[0].title === "Payment Stablecoin Reserve Rule" && page[0].office === "central_bank" && page[0].instrumentType === "statute",
  JSON.stringify(page),
);
const fromNotices = parseRegulationNotes(noticesToRegulationPayload(page, "US"));
ok(
  "Treffer ohne Modell bleibt Anzeige und geht nicht in den Score",
  fromNotices.regulations.length === 1
    && fromNotices.regulations[0].confidence === "cited"
    && fromNotices.regulations[0].status === "uncertain"
    && statuteContribution([], "2026-09-30", null).contribution === 0,
);
const merged = mergeByTitle(
  [{ title: "Nur Modell" }],
  [{ title: "Payment Stablecoin Reserve Rule" }, { title: "nur modell" }],
);
ok("Modell und Amtssuche werden nach Titel zusammengefuehrt", merged.length === 2);
ok("Ersatztext nennt keinen festen Gesetzesnamen", !["Trump", "OBBBA", "Ishiba", "Bessent", "GENIUS"].some(w => fallbackScanSummary(3).includes(w)));

ok(
  "fehlender Schlüssel wird nicht gecacht",
  !policyScanIsCacheable({
    llmAvailable: false,
    error: "OPENROUTER_API_KEY fehlt",
    summary: null,
    instruments: [],
    regulations: [],
    _fallback: true,
  }),
);

if (failed) {
  console.log(`\n${failed} TESTS FEHLGESCHLAGEN`);
  process.exit(1);
}
console.log("\nALLE TESTS BESTANDEN");
