/**
 * Produktiver Render: Growth Gap, Implied Gap und Abstand zum Median
 * sind bereits berechnete Differenzen und bleiben Prozentpunkte.
 * EPS-YoY, Forward, Median, g* und das Perzentil bleiben Prozent.
 * Kein Netz, kein FMP, kein LLM. g* ist nur in der Fixture available.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-growth-pp-render.ts
 */
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RecessionGrowthSection } from "../client/src/components/recession/RecessionGrowthSection";
import { readChatSectionData, resetChatSectionData } from "../client/src/lib/chatSectionData";
import {
  FAZIT_FORMULA,
  GSTAR_NA_REASON,
  LLM_NA_REASON,
  REALIZED_FORMULA,
  type GapReading,
  type RecessionGrowthBody,
} from "../shared/recession-growth";

(globalThis as { React?: typeof React }).React = React;

const MINUS = "\u2212";
const fetches: string[] = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown) => {
  fetches.push(String(input).slice(0, 180));
  throw new Error(`unerwartetes HTTP ${String(input).slice(0, 180)}`);
}) as typeof fetch;

const savedFmp = process.env.FMP_API_KEY;
const savedFmpLower = process.env.FMP_API_key;
delete process.env.FMP_API_KEY;
delete process.env.FMP_API_key;

function numericBody(input: {
  realizedPct: number;
  median10y: number;
  distanceToMedianPp: number;
  percentile: number;
  gFwdPct: number;
  growthGap: GapReading;
  gStarPct: number;
  impliedGap: GapReading;
}): RecessionGrowthBody {
  const asOf = "2025-09-30";
  return {
    index: "SPY",
    label: "USA",
    etf: "SPY",
    priceSource: "Fixture",
    priceError: null,
    realizedSource: "Fixture",
    realizedError: null,
    realizedFrequency: "quarterly",
    realized: [{ date: asOf, yoyPct: input.realizedPct }],
    chart: [{ date: asOf, close: 500, yoyPct: input.realizedPct }],
    stats: {
      available: true,
      asOf,
      realizedPct: input.realizedPct,
      median10y: input.median10y,
      mean10y: input.median10y,
      std10y: 4,
      z: 0.5,
      percentile: input.percentile,
      prints: 20,
      windowStart: "2015-09-30",
      coneLow: input.median10y - 8,
      coneHigh: input.median10y + 8,
      distanceToMedianPp: input.distanceToMedianPp,
    },
    forward: {
      available: true,
      gFwdPct: input.gFwdPct,
      epsConsensus: 115,
      epsTtm: 100,
      asOf,
      source: "Fixture-Konsens",
      formula: "g_fwd = EPS_consensus / EPS_TTM − 1",
    },
    gStar: {
      available: true,
      gStarPct: input.gStarPct,
      asOf,
      source: "synthetische Fixture, kein produktives g*",
    },
    growthGap: input.growthGap,
    impliedGap: input.impliedGap,
    vix: { available: false, reason: "n/a — VIX: Fixture" },
    llm: { available: false, reason: LLM_NA_REASON },
    fazit: {
      available: true,
      text: "Fixture-Fazit",
      realizedBand: "innerhalb_nearZero",
      gapBand: "innerhalb_nearZero",
      formula: FAZIT_FORMULA,
    },
    consensusTrace: "",
    sources: ["Fixture"],
  };
}

function naBody(): RecessionGrowthBody {
  const distanceReason = "n/a — zu wenig Historie (Fixture, Abstand zum Median nicht belegt)";
  const forwardReason = "n/a — Forward-Konsens: Fixture ohne Konsens";
  const growthReason = "n/a — Growth Gap: Fixture ohne g_fwd";
  const impliedReason = "n/a — Implied Gap: Fixture ohne g*";
  return {
    index: "SPY",
    label: "USA",
    etf: "SPY",
    priceSource: "Fixture",
    priceError: null,
    realizedSource: "Fixture",
    realizedError: distanceReason,
    realizedFrequency: null,
    realized: [],
    chart: [{ date: "2025-09-30", close: 500, yoyPct: null }],
    stats: { available: false, reason: distanceReason },
    forward: { available: false, reason: forwardReason },
    gStar: { available: false, reason: GSTAR_NA_REASON },
    growthGap: { available: false, reason: growthReason },
    impliedGap: { available: false, reason: impliedReason },
    vix: { available: false, reason: "n/a — VIX: Fixture" },
    llm: { available: false, reason: LLM_NA_REASON },
    fazit: { available: false, text: distanceReason, realizedBand: null, gapBand: null, formula: FAZIT_FORMULA },
    consensusTrace: "",
    sources: ["Fixture"],
  };
}

function renderBody(body: RecessionGrowthBody): string {
  resetChatSectionData();
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
        refetchOnMount: false,
        queryFn: async () => {
          throw new Error("queryFn darf die Wachstumskarte nicht nachladen");
        },
      },
    },
  });
  client.setQueryData(["/api/recession/earnings-growth", "SPY"], body);
  client.setQueryData(["/api/recession/growth-gap", "SPY"], body);
  return renderToStaticMarkup(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(RecessionGrowthSection, { number: 17 }),
    ),
  );
}

function card(html: string, testId: string): string {
  const marker = `data-testid="${testId}"`;
  const start = html.indexOf(marker);
  assert.ok(start >= 0, `Karte fehlt: ${testId}`);
  const next = html.indexOf("data-testid=", start + marker.length);
  return html.slice(start, next === -1 ? undefined : next);
}

function texts(fragment: string): string[] {
  return [...fragment.matchAll(/>([^<]*)</g)].map(match => match[1]).filter(text => text.trim().length > 0);
}

function gap(gapPp: number, direction: "positiv" | "negativ" | "nahe_null"): GapReading {
  return { available: true, gapPp, z: gapPp === 0 ? 0 : gapPp > 0 ? 1.5 : -1.5, warn: false, direction };
}

let passed = 0;
const fails: { name: string; msg: string }[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    fails.push({ name, msg });
    console.error(`✗ ${name}\n${msg}`);
  }
}

const positiveHtml = renderBody(numericBody({
  realizedPct: 10,
  median10y: 8,
  distanceToMedianPp: 2,
  percentile: 80,
  gFwdPct: 15,
  growthGap: gap(5, "positiv"),
  gStarPct: 12,
  impliedGap: gap(2, "positiv"),
}));

check("positiv Abstand: 10 % − 8 % bleibt +2,0 Pp", () => {
  const realized = card(positiveHtml, "recession-growth-realized");
  assert.equal(texts(realized)[1], "+10,0 %", realized);
  assert.match(realized, /Median \+8,0 %/);
  assert.match(realized, /Abstand \+2,0 Pp/);
  assert.equal(realized.includes("Abstand +2,0 %"), false, realized);
  assert.match(realized, /Perzentil 80,0 %/);
  assert.match(realized, new RegExp(REALIZED_FORMULA.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

check("positiv Growth Gap: 15 % − 10 % bleibt +5,0 Pp", () => {
  const growth = card(positiveHtml, "recession-growth-gap");
  assert.equal(texts(growth)[1], "+5,0 Pp", growth);
  assert.equal(growth.includes("%"), false, growth);
  assert.match(growth, /g_fwd − g_realized/);
  assert.match(growth, /Markt erwartet mehr Wachstum als zuletzt realisiert/);
  assert.match(growth, /z 1,50/);
  assert.equal(texts(card(positiveHtml, "recession-growth-forward"))[1], "+15,0 %");
});

check("positiv Implied Gap: synthetisches g* bleibt +2,0 Pp, g* selbst %", () => {
  const implied = card(positiveHtml, "recession-growth-implied");
  const gstar = card(positiveHtml, "recession-growth-gstar");
  assert.equal(texts(implied)[1], "+2,0 Pp", implied);
  assert.equal(implied.includes("%"), false, implied);
  assert.match(implied, /g\* − g_realized/);
  assert.equal(texts(gstar)[1], "+12,0 %", gstar);
  assert.match(gstar, /synthetische Fixture, kein produktives g\*/);
  const facts = readChatSectionData("recession").gewinn;
  assert.equal(facts.realisiertPct, 10);
  assert.equal(facts.forwardPct, 15);
  assert.equal(facts.growthGapPp, 5);
  assert.equal(facts.impliedGap, 2);
  assert.equal(facts.abstandMedianPp, 2);
  assert.equal(facts.gStar, 12);
  assert.equal(facts.median10y, 8);
  assert.equal(facts.realisiertPerzentil, 80);
});

const negativeHtml = renderBody(numericBody({
  realizedPct: -4,
  median10y: 6,
  distanceToMedianPp: -10,
  percentile: 12.5,
  gFwdPct: -9,
  growthGap: gap(-5, "negativ"),
  gStarPct: 1,
  impliedGap: gap(5, "positiv"),
}));

check("negativ Abstand: −10,0 Pp, YoY und Median bleiben %", () => {
  const realized = card(negativeHtml, "recession-growth-realized");
  assert.equal(texts(realized)[1], `${MINUS}4,0 %`, realized);
  assert.match(realized, /Median \+6,0 %/);
  assert.match(realized, new RegExp(`Abstand ${MINUS}10,0 Pp`));
  assert.equal(realized.includes(`Abstand ${MINUS}10,0 %`), false, realized);
  assert.match(realized, /Perzentil 12,5 %/);
});

check("negativ Growth Gap: −5,0 Pp, Forward bleibt %", () => {
  const growth = card(negativeHtml, "recession-growth-gap");
  assert.equal(texts(growth)[1], `${MINUS}5,0 Pp`, growth);
  assert.equal(growth.includes("%"), false, growth);
  assert.match(growth, /Markt erwartet weniger als zuletzt realisiert/);
  assert.match(growth, new RegExp(`z ${MINUS}1,50`));
  assert.equal(texts(card(negativeHtml, "recession-growth-forward"))[1], `${MINUS}9,0 %`);
});

check("negativ Implied Gap: +5,0 Pp, g* bleibt %", () => {
  const implied = card(negativeHtml, "recession-growth-implied");
  assert.equal(texts(implied)[1], "+5,0 Pp", implied);
  assert.equal(implied.includes("%"), false, implied);
  assert.equal(texts(card(negativeHtml, "recession-growth-gstar"))[1], "+1,0 %");
  const facts = readChatSectionData("recession").gewinn;
  assert.equal(facts.growthGapPp, -5);
  assert.equal(facts.impliedGap, 5);
  assert.equal(facts.abstandMedianPp, -10);
  assert.equal(facts.realisiertPct, -4);
  assert.equal(facts.gStar, 1);
});

const zeroHtml = renderBody(numericBody({
  realizedPct: 10,
  median10y: 10,
  distanceToMedianPp: 0,
  percentile: 50,
  gFwdPct: 10,
  growthGap: gap(0, "nahe_null"),
  gStarPct: 10,
  impliedGap: gap(0, "nahe_null"),
}));

check("null Abstand: 0,0 Pp, YoY und Median bleiben %", () => {
  const realized = card(zeroHtml, "recession-growth-realized");
  assert.equal(texts(realized)[1], "+10,0 %", realized);
  assert.match(realized, /Median \+10,0 %/);
  assert.match(realized, /Abstand 0,0 Pp/);
  assert.equal(realized.includes("Abstand 0,0 %"), false, realized);
  assert.match(realized, /Perzentil 50,0 %/);
});

check("null Growth Gap: 0,0 Pp und nahe null", () => {
  const growth = card(zeroHtml, "recession-growth-gap");
  assert.equal(texts(growth)[1], "0,0 Pp", growth);
  assert.equal(growth.includes("%"), false, growth);
  assert.match(growth, /Erwartung und Realität im Takt/);
  assert.match(growth, /z 0,00/);
  assert.equal(texts(card(zeroHtml, "recession-growth-forward"))[1], "+10,0 %");
});

check("null Implied Gap: 0,0 Pp und nahe null, g* bleibt %", () => {
  const implied = card(zeroHtml, "recession-growth-implied");
  assert.equal(texts(implied)[1], "0,0 Pp", implied);
  assert.equal(implied.includes("%"), false, implied);
  assert.match(implied, /Erwartung und Realität im Takt/);
  assert.equal(texts(card(zeroHtml, "recession-growth-gstar"))[1], "+10,0 %");
  const facts = readChatSectionData("recession").gewinn;
  assert.equal(facts.growthGapPp, 0);
  assert.equal(facts.impliedGap, 0);
  assert.equal(facts.abstandMedianPp, 0);
});

check("n/a: Gründe der drei Differenzen bleiben stehen, kein erfundenes 0", () => {
  const html = renderBody(naBody());
  const realized = card(html, "recession-growth-realized");
  const forward = card(html, "recession-growth-forward");
  const growth = card(html, "recession-growth-gap");
  const implied = card(html, "recession-growth-implied");
  const gstar = card(html, "recession-growth-gstar");
  assert.equal(texts(realized)[1], "n/a — zu wenig Historie (Fixture, Abstand zum Median nicht belegt)", realized);
  assert.equal(texts(realized)[2], "n/a", realized);
  assert.equal(/Abstand [+\u2212]?[0-9]/.test(realized), false, realized);
  assert.equal(realized.includes("0,0 %"), false, realized);
  assert.equal(realized.includes("0,0 Pp"), false, realized);
  assert.equal(texts(forward)[1], "n/a — Forward-Konsens: Fixture ohne Konsens", forward);
  assert.equal(texts(growth)[1], "n/a — Growth Gap: Fixture ohne g_fwd", growth);
  assert.equal(texts(growth)[2], "n/a", growth);
  assert.equal(growth.includes("0,0 %"), false, growth);
  assert.equal(growth.includes("0,0 Pp"), false, growth);
  assert.equal(texts(implied)[1], "n/a — Implied Gap: Fixture ohne g*", implied);
  assert.equal(texts(implied)[2], "n/a", implied);
  assert.equal(implied.includes("0,0 %"), false, implied);
  assert.equal(implied.includes("0,0 Pp"), false, implied);
  assert.equal(texts(gstar)[1], GSTAR_NA_REASON, gstar);
  assert.equal(gstar.includes("0,0 %"), false, gstar);
  const facts = readChatSectionData("recession").gewinn;
  assert.equal(facts.realisiert, "n/a — zu wenig Historie (Fixture, Abstand zum Median nicht belegt)");
  assert.equal(facts.forward, "n/a — Forward-Konsens: Fixture ohne Konsens");
  assert.equal(facts.growthGap, "n/a — Growth Gap: Fixture ohne g_fwd");
  assert.equal(facts.impliedGap, "n/a — Implied Gap: Fixture ohne g*");
  assert.equal(facts.gStar, GSTAR_NA_REASON);
  assert.equal("growthGapPp" in facts, false);
  assert.equal("abstandMedianPp" in facts, false);
});

if (savedFmp === undefined) delete process.env.FMP_API_KEY;
else process.env.FMP_API_KEY = savedFmp;
if (savedFmpLower === undefined) delete process.env.FMP_API_key;
else process.env.FMP_API_key = savedFmpLower;
globalThis.fetch = originalFetch;

assert.equal(fetches.length, 0, `HTTP-Aufrufe: ${fetches.join(" | ")}`);
console.log(`HTTP-Aufrufe: ${fetches.length}`);

if (fails.length > 0) {
  console.error(`\n${fails.length} fehlgeschlagen, ${passed} bestanden`);
  process.exit(1);
}
console.log(`\n${passed} bestanden`);
