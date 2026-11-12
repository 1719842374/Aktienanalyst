/**
 * RSL-NULL-GUARD (N1): calculateRSL liefert null bei zu kurzer Historie.
 * Section3: Phase n/a mit Grund, keine Zyklusphase. Belegter RSL: Markup identisch zu main.
 * Section9: bei null Momentum n/a und Malus „nicht angewendet“ (DCF wendet ihn nicht an).
 * Belegter RSL: Section9-Markup identisch zu main.
 *
 * SSR mit eigenem QueryClientProvider (script/ssr-query.ts wird nicht vorausgesetzt).
 * Die Mindestlänge kommt aus calculateRSL (Probe) und muss dem Export RSL_MIN_PRICES entsprechen.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-rsl-null-guard.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).React = React;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "ed1e98cdf17bca6251650d2eb2c1825e850c6530";
const LONG_N = 130;

const calculations = await import("../client/src/lib/calculations");
const { calculateRSL } = calculations;
const { buildDefaultDCFParams, calculateFCFFDCF } = await import("../shared/valuation-signal");
const { Section3 } = await import("../client/src/components/sections/Section3");
const { Section9 } = await import("../client/src/components/sections/Section9");

function rslMinPoints(): number {
  const probe: number[] = [];
  while (calculateRSL(100, probe) == null) {
    probe.push(100);
    if (probe.length > 500) throw new Error("calculateRSL bleibt null");
  }
  return probe.length;
}

const MIN_POINTS = rslMinPoints();
const PHASE_NA = `RSL n/a — weniger als ${MIN_POINTS} Kurse`;
const PHASE_NAMES = [
  "Rezession / Trough",
  "Expansion / Mittzyklus",
  "Spätzyklus / Überhitzung",
  "Früher Abschwung",
  "Frühe Erholung",
  "Übergang",
];

type Flags = { above: boolean; golden: boolean; macd: boolean; rising: boolean };

function prices(n: number, close: number): { date: string; close: number }[] {
  const out: { date: string; close: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2018, 0, 1));
    d.setUTCDate(d.getUTCDate() + i);
    out.push({ date: d.toISOString().slice(0, 10), close });
  }
  return out;
}

function fixture(n: number, price: number, flags: Flags) {
  return {
    currentPrice: price,
    currency: "USD",
    dataSource: "fmp",
    lynchClass: null,
    peRatio: 20,
    sectorAvgPE: 18,
    historicalPrices: prices(n, 100),
    structuralTrends: ["Testtrend"],
    technicalIndicators: {
      currentStatus: {
        priceAboveMA200: flags.above,
        ma50AboveMA200: flags.golden,
        macdAboveZero: flags.macd,
        macdRising: flags.rising,
      },
    },
    sectorProfile: {
      cycleClass: "Zyklisch",
      politicalCycle: "Neutral",
      regulatoryNotes: "",
      geopoliticalRisks: [],
      macroSensitivity: {
        interestUp: { wacc: "+0.5pp", dcf: "-8%" },
        interestDown: { wacc: "-0.5pp", dcf: "+8%" },
        fiscalUp: "stützend",
        fiscalDown: "bremsend",
        geoUp: "Entspannung",
        geoDown: "Eskalation",
      },
    },
  };
}

const TROUGH: Flags = { above: false, golden: false, macd: false, rising: false };
const EXPANSION: Flags = { above: true, golden: true, macd: true, rising: true };
const shortTrough = fixture(MIN_POINTS - 1, 80, TROUGH);
const shortExpansion = fixture(MIN_POINTS - 1, 120, EXPANSION);
const longHot = fixture(LONG_N, 120, EXPANSION);
const longTrough = fixture(LONG_N, 80, TROUGH);

function renderSection(Comp: any, data: any): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    React.createElement(QueryClientProvider, { client: qc }, React.createElement(Comp, { data })),
  );
}

function tryRender(Comp: any, data: any): { html: string; error: unknown } {
  try {
    return { html: renderSection(Comp, data), error: null };
  } catch (error) {
    return { html: "", error };
  }
}

function phaseOf(html: string): string {
  return html.match(/<span class="text-sm font-bold">([^<]*)<\/span>/)?.[1] ?? "";
}
function rslLabelOf(html: string): string {
  return html.match(/RSL: ([^<]*)</)?.[1] ?? "";
}
function zoneOf(html: string): string {
  return html.match(/text-xs font-medium mt-1 [^"]*">([^<]*)</)?.[1] ?? "";
}
function growthOf(html: string): string {
  return html.match(/DCF Growth Adj\.<\/td><td[^>]*>([^<]*)</)?.[1] ?? "";
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

const tmp = mkdtempSync(path.join(tmpdir(), "rsl-null-guard-"));
const main3Path = path.join(tmp, "Section3.main.tsx");
const main9Path = path.join(tmp, "Section9.main.tsx");

let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) fail++;
};

try {
  writeFileSync(main3Path, execFileSync("git", ["show", `${BASE}:client/src/components/sections/Section3.tsx`]));
  writeFileSync(main9Path, execFileSync("git", ["show", `${BASE}:client/src/components/sections/Section9.tsx`]));
  // Dieselben relativen Importe wie die Originale (../SectionCard, ../../lib/calculations).
  const sectionsDir = path.join(ROOT, "client/src/components/sections");
  const link3 = path.join(sectionsDir, "__rsl-null-guard-main-Section3.tsx");
  const link9 = path.join(sectionsDir, "__rsl-null-guard-main-Section9.tsx");
  writeFileSync(link3, execFileSync("git", ["show", `${BASE}:client/src/components/sections/Section3.tsx`]));
  writeFileSync(link9, execFileSync("git", ["show", `${BASE}:client/src/components/sections/Section9.tsx`]));
  const MainSection3 = (await import(pathToFileURL(link3).href)).Section3;
  const MainSection9 = (await import(pathToFileURL(link9).href)).Section9;
  rmSync(link3, { force: true });
  rmSync(link9, { force: true });

  console.log(`BASE ${BASE}`);
  console.log(`calculateRSL Mindestpunkte (Probe) = ${MIN_POINTS}; kurz = ${MIN_POINTS - 1}; lang = ${LONG_N}`);
  check("lange Historie liegt über der calculateRSL-Mindestlänge", LONG_N >= MIN_POINTS, `${LONG_N} >= ${MIN_POINTS}`);
  check("kurze Historie lässt calculateRSL null", calculateRSL(shortTrough.currentPrice, shortTrough.historicalPrices.map((p) => p.close)) == null);
  check("lange Historie lässt calculateRSL eine Zahl", typeof calculateRSL(longHot.currentPrice, longHot.historicalPrices.slice(-LONG_N).map((p) => p.close)) === "number");
  check("RSL_MIN_PRICES exportiert und gleich der calculateRSL-Grenze", (calculations as { RSL_MIN_PRICES?: number }).RSL_MIN_PRICES === MIN_POINTS, String((calculations as { RSL_MIN_PRICES?: number }).RSL_MIN_PRICES));

  const dcfData = {
    ...shortTrough,
    marketCap: 5000,
    revenue: 1000,
    operatingIncome: 200,
    ebitda: 250,
    totalDebt: 100,
    cashEquivalents: 40,
    fcfHaircut: 0,
    beta5Y: 1,
    epsTTM: 2,
    epsConsensusNextFY: 2.2,
    sharesOutstanding: 100,
    sectorProfile: { ...shortTrough.sectorProfile, growthAssumptions: { g1: 10, terminal: 2.5 } },
  };
  const dcfParams = buildDefaultDCFParams(dcfData as never);
  const dcf = calculateFCFFDCF(dcfParams);
  const malusLines = dcf.steps.filter((s) => s.includes("RSL-Momentum-Malus aktiv") || s.includes("RSL-adjustiert"));
  console.log(`DCF param.rsl=${String(dcfParams.rsl)} malusZeilen=${malusLines.length}`);
  check("DCF-Kette: buildDefaultDCFParams reicht rsl null durch", dcfParams.rsl == null, String(dcfParams.rsl));
  check("DCF-Kette: calculateFCFFDCF ohne Malus-Zeile", malusLines.length === 0, malusLines.join(" | "));

  console.log("\n=== kurz: Section9 (n/a, Malus nicht angewendet) ===");
  const s9shortMain = tryRender(MainSection9, shortTrough);
  const s9short = tryRender(Section9, shortTrough);
  console.log(`Section9 main: ${s9shortMain.error ? describeError(s9shortMain.error) : `zone=${zoneOf(s9shortMain.html)} growth=${growthOf(s9shortMain.html)}`}`);
  console.log(`Section9 head: ${s9short.error ? describeError(s9short.error) : `zone=${zoneOf(s9short.html)} growth=${growthOf(s9short.html)}`}`);
  check("Section9 kurz: kein Throw", s9short.error == null, s9short.error ? describeError(s9short.error) : "");
  if (!s9short.error) {
    check("Section9 kurz: Momentum n/a mit Grund", s9short.html.includes(PHASE_NA), zoneOf(s9short.html));
    check("Section9 kurz: Malus nicht angewendet", s9short.html.includes("nicht angewendet"), growthOf(s9short.html));
    check("Section9 kurz: kein Weak Momentum", !s9short.html.includes("Weak Momentum"));
    check("Section9 kurz: Malus nicht als aktiv angezeigt", !s9short.html.includes("DCF Growth Adjustment aktiv"));
  }

  console.log("\n=== kurz: Section3 (Phase n/a) ===");
  for (const [name, data] of [["trough-flags", shortTrough], ["expansion-flags", shortExpansion]] as const) {
    const mainR = tryRender(MainSection3, data);
    const headR = tryRender(Section3, data);
    console.log(`Section3 ${name} main: ${mainR.error ? describeError(mainR.error) : phaseOf(mainR.html)}`);
    console.log(`Section3 ${name} head: ${headR.error ? describeError(headR.error) : `phase=${phaseOf(headR.html)} rsl=${rslLabelOf(headR.html)}`}`);
    if (mainR.error) {
      console.error(mainR.error);
      check(`Section3 ${name}: main wirft TypeError`, mainR.error instanceof TypeError, describeError(mainR.error));
    }
    if (headR.error) {
      console.error(headR.error);
      check(`Section3 ${name}: kein Throw`, false, describeError(headR.error));
      continue;
    }
    const hit = PHASE_NAMES.filter((p) => headR.html.includes(p));
    check(`Section3 ${name}: Phase ${PHASE_NA}`, phaseOf(headR.html) === PHASE_NA, phaseOf(headR.html));
    check(`Section3 ${name}: Grund im Markup`, headR.html.includes(PHASE_NA));
    check(`Section3 ${name}: keine Zyklusphase`, hit.length === 0, hit.join(", "));
  }

  console.log("\n=== lang (>=130): identisch zu main ===");
  for (const [name, data] of [["hot", longHot], ["trough", longTrough]] as const) {
    const main3 = tryRender(MainSection3, data);
    const head3 = tryRender(Section3, data);
    const main9 = tryRender(MainSection9, data);
    const head9 = tryRender(Section9, data);
    check(`Section3 ${name}: kein Throw`, head3.error == null && main3.error == null, describeError(head3.error ?? main3.error));
    check(`Section9 ${name}: kein Throw`, head9.error == null && main9.error == null, describeError(head9.error ?? main9.error));
    if (head3.error || main3.error || head9.error || main9.error) continue;
    const snap3 = { phase: phaseOf(head3.html), rsl: rslLabelOf(head3.html) };
    const snap3m = { phase: phaseOf(main3.html), rsl: rslLabelOf(main3.html) };
    const snap9 = { rslZone: zoneOf(head9.html), growthAdj: growthOf(head9.html) };
    const snap9m = { rslZone: zoneOf(main9.html), growthAdj: growthOf(main9.html) };
    console.log(`Section3 ${name} head`, JSON.stringify(snap3));
    console.log(`Section3 ${name} main`, JSON.stringify(snap3m));
    console.log(`Section9 ${name} head`, JSON.stringify(snap9));
    console.log(`Section9 ${name} main`, JSON.stringify(snap9m));
    check(`Section3 ${name}: Phase und RSL-Zahl identisch zu main`, snap3.phase === snap3m.phase && snap3.rsl === snap3m.rsl && snap3.phase !== "" && snap3.rsl !== "", JSON.stringify({ snap3, snap3m }));
    check(`Section9 ${name}: rslZone und growthAdj identisch zu main`, snap9.rslZone === snap9m.rslZone && snap9.growthAdj === snap9m.growthAdj && snap9.rslZone !== "" && snap9.growthAdj !== "", JSON.stringify({ snap9, snap9m }));
    check(`Section3 ${name}: Markup identisch zu main`, head3.html === main3.html);
    check(`Section9 ${name}: Markup identisch zu main`, head9.html === main9.html);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(path.join(ROOT, "client/src/components/sections/__rsl-null-guard-main-Section3.tsx"), { force: true });
  rmSync(path.join(ROOT, "client/src/components/sections/__rsl-null-guard-main-Section9.tsx"), { force: true });
}

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
