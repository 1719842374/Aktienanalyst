/**
 * Sektion 9: bei tamCAGR == null zeigt die Zeile und der Balken den Median
 * des Peer-Umsatzwachstums (FMP, Prozent). Ein vorhandener tamCAGR bleibt.
 *
 * Rot auf main 7aaa13ce (n/a trotz Peers). Grün, sobald der Median sichtbar ist.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-s9-peer-revenue-median.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { Section7 } from "../client/src/components/sections/Section7";
import { medianPeerRevenueYoY, PEER_REVENUE_MEDIAN_LABEL } from "../shared/peer-revenue-median";

(globalThis as { React?: typeof React }).React = React;

const LABEL = "Median Peer-Umsatzwachstum YoY · FMP";
const NA_REASON = "kein Sektor/keine TAM-Quelle";
const base = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8"));
const shel = JSON.parse(readFileSync(new URL("./fixtures/analysis-SHEL.L.json", import.meta.url), "utf8"));

let fail = 0;
const rows: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  console.log(line);
  rows.push(line);
  if (!ok) fail++;
};

function render(data: Record<string, unknown>) {
  return renderToStaticMarkup(
    React.createElement(Router, { ssrPath: "/" },
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(Section7 as never, { data }))),
  );
}

function growthRow(html: string) {
  return (html.match(/<tr[^>]*>(?:(?!<\/tr>).)*Revenue Growth(?:(?!<\/tr>).)*<\/tr>/) ?? [""])[0];
}

function shell(ticker: string, tamCAGR: number | null, companyGrowth: number, peers: Array<Record<string, unknown>>, medianField?: { value: number; n: number; label: string } | null) {
  const tam = { tamTotal: null, tamLabel: "Segment-TAM unzuverlässig", tamCAGR, companyGrowth, companyRevenue: 1, marketShare: null, tamSource: "test", outperforming: null, quality: "unreliable" as const, segments: [] as unknown[] };
  const peerComparison = {
    subject: { ticker, revenueGrowth: companyGrowth },
    peers,
    peerAvg: {},
    sectorMedian: { pe: null, peg: null, ps: null, pb: null, epsGrowth: null, sectorName: "" },
    ...(medianField !== undefined ? { revenueGrowthMedian: medianField } : {}),
  };
  return {
    ...base,
    ticker,
    dataSource: "fmp",
    tamAnalysis: tam,
    peerComparison,
  };
}

check("Label-Konstante", PEER_REVENUE_MEDIAN_LABEL === LABEL, PEER_REVENUE_MEDIAN_LABEL);

const rules = medianPeerRevenueYoY("MSFT", [
  { ticker: "MSFT", revenueGrowth: 99 },
  { ticker: "ORCL", revenueGrowth: 13.7 },
  { ticker: "SAP", revenueGrowth: null },
  { ticker: "CRM", revenueGrowth: 0 },
  { ticker: "NOW", revenueGrowth: Number.NaN },
]);
check("Median lässt den Ticker selbst weg", rules?.value === 6.85 && rules.n === 2, JSON.stringify(rules));
check("Median ohne Caps: 0 zählt, null und NaN nicht", rules?.n === 2);
check("keine Peers → null", medianPeerRevenueYoY("AAPL", [{ ticker: "AAPL", revenueGrowth: 4 }, { ticker: "X", revenueGrowth: null }]) === null);

const msftPeers = [
  { ticker: "MSFT", revenueGrowth: 99 },
  { ticker: "ORCL", revenueGrowth: 13.7 },
  { ticker: "SAP", revenueGrowth: 7.7 },
  { ticker: "IBM", revenueGrowth: null, revenue: 9_000_000_000 },
];
const msft = render(shell("MSFT", null, 17.8, msftPeers));
const msftRow = growthRow(msft);
check("MSFT: Sektorzelle ist der Median 10.7, n=2", msftRow.includes("+10.7%") && msft.includes(`${LABEL} · n=2`) && msftRow.includes("+7.1 Pkt."), msftRow.slice(0, 400));
check("MSFT: Balken Branche zeigt den Median", msft.includes(">Branche</span>") && msft.includes("+10.7%"));
check("MSFT: kein n/a-Grund, kein 5-%-Fallback", !msft.includes(NA_REASON) && !msft.includes("+5.0%"));

const aapl = render(shell("AAPL", null, 8, [
  { ticker: "AAPL", revenueGrowth: 50 },
  { ticker: "QCOM", revenueGrowth: 10 },
  { ticker: "SONY", revenueGrowth: 20 },
  { ticker: "DELL", revenueGrowth: null },
]));
check("AAPL: Median 15, n=2, Premium −7", growthRow(aapl).includes("+15.0%") && aapl.includes(`${LABEL} · n=2`) && growthRow(aapl).includes("-7.0 Pkt."));

const nvo = render(shell("NVO", null, 12, [
  { ticker: "NOVO-B.CO", revenueGrowth: 4 },
  { ticker: "LLY", revenueGrowth: 8 },
  { ticker: "NVO", revenueGrowth: 80 },
  { ticker: "SNY", revenueGrowth: 12 },
]));
check("NVO: Nicht-USD nur als Prozent, Median 8, n=3", growthRow(nvo).includes("+8.0%") && nvo.includes(`${LABEL} · n=3`) && growthRow(nvo).includes("+4.0 Pkt."));

const shelHtml = render(shell("SHEL.L", 17, -4.2, [
  { ticker: "TTE", revenueGrowth: -0.5 },
  { ticker: "BP", revenueGrowth: 5.2 },
]));
const shelRow = growthRow(shelHtml);
check("SHEL.L: tamCAGR 17 bleibt, Median-Label fehlt", shelRow.includes("+17.0%") && !shelHtml.includes(LABEL) && !shelHtml.includes(NA_REASON), shelRow.slice(0, 280));

const ry = render(shell("RY.TO", 5, 6, [
  { ticker: "RY.TO", revenueGrowth: 99 },
  { ticker: "TD", revenueGrowth: 1 },
  { ticker: "CM", revenueGrowth: 3 },
]));
const ryRow = growthRow(ry);
check("RY.TO: Katalog-tamCAGR 5 bleibt, nicht der Peer-Median 2", ryRow.includes("+5.0%") && !ry.includes(LABEL) && ryRow.includes("+1.0 Pkt."), ryRow.slice(0, 280));

const none = render(shell("MSFT", null, 17.8, [{ ticker: "ORCL", revenueGrowth: null }]));
check("ohne Peer-Zahl: n/a mit Grund", growthRow(none).includes(">n/a</td>") && none.includes(NA_REASON) && !none.includes(LABEL));

const fromField = render(shell("AAPL", null, 8, [], { value: 9.5, n: 4, label: LABEL }));
check("Response-Feld revenueGrowthMedian wird angezeigt", growthRow(fromField).includes("+9.5%") && fromField.includes(`${LABEL} · n=4`));

const route = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
const scoreAt = route.indexOf("buildScoringForAnalysis({");
const medianAt = route.indexOf("revenueGrowthMedian:");
check("Median hängt nach dem Scoring-Aufruf an der Antwort", scoreAt >= 0 && medianAt > scoreAt, `score@${scoreAt} median@${medianAt}`);
const scoringSrc = readFileSync(new URL("../server/scoring-integration.ts", import.meta.url), "utf8");
check("scoring-integration liest revenueGrowthMedian nicht", !scoringSrc.includes("revenueGrowthMedian"));

console.log(fail ? `\n${fail} fehlgeschlagen` : "\nalle bestanden");
process.exit(fail ? 1 : 0);
