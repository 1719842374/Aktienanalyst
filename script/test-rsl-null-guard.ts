/**
 * RSL-NULL-GUARD: calculateRSL liefert null bei zu kurzer Historie.
 * Section3 darf dann nicht über rsl.toFixed abstürzen; Anzeige "n/a" mit Grund.
 * Section9: nur wenn der Render wirft, n/a verlangen — sonst Markup identisch zu main
 * (Malus, Zone, growthAdj, gaugePos unangetastet).
 * Mindestens 130 Kurse: Section3 und Section9 identisch zu main (Phase, RSL-Zahl, rslZone, growthAdj).
 *
 * SSR mit eigenem QueryClientProvider (script/ssr-query.ts wird nicht vorausgesetzt).
 * Die Mindestlänge kommt aus calculateRSL (Probe), keine zweite Schwelle im Test.
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

const { calculateRSL } = await import("../client/src/lib/calculations");
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
const REASON = `n/a (weniger als ${MIN_POINTS} Kurse)`;

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

  console.log("\n=== kurz: Section9 (nur Throw prüfen) ===");
  const s9shortMain = tryRender(MainSection9, shortTrough);
  const s9short = tryRender(Section9, shortTrough);
  console.log(`Section9 main: ${s9shortMain.error ? describeError(s9shortMain.error) : "kein Throw"}`);
  console.log(`Section9 head: ${s9short.error ? describeError(s9short.error) : "kein Throw"}`);
  if (s9shortMain.error) {
    console.error(s9shortMain.error);
    check("Section9 kurz: Head wirft nicht mehr", s9short.error == null, describeError(s9short.error));
    check("Section9 kurz: n/a sichtbar", s9short.html.includes("n/a"), s9short.html.slice(0, 240));
  } else {
    check("Section9 kurz: kein Throw", s9short.error == null, s9short.error ? describeError(s9short.error) : "");
    check("Section9 kurz: Markup identisch zu main", s9short.html === s9shortMain.html);
  }

  console.log("\n=== kurz: Section3 (RED = TypeError) ===");
  const s3cases = [
    ["trough", shortTrough, "Rezession / Trough"],
    ["expansion", shortExpansion, "Expansion / Mittzyklus"],
  ] as const;
  let section3Threw = false;
  for (const [name, data, phase] of s3cases) {
    const mainR = tryRender(MainSection3, data);
    const headR = tryRender(Section3, data);
    console.log(`Section3 ${name} main: ${mainR.error ? describeError(mainR.error) : "kein Throw"}`);
    console.log(`Section3 ${name} head: ${headR.error ? describeError(headR.error) : `phase=${phaseOf(headR.html)} rsl=${rslLabelOf(headR.html)}`}`);
    if (mainR.error) {
      section3Threw = true;
      console.error(mainR.error);
      check(`Section3 ${name}: main wirft TypeError`, mainR.error instanceof TypeError, describeError(mainR.error));
    }
    if (headR.error) {
      section3Threw = true;
      console.error(headR.error);
      check(`Section3 ${name}: kein Throw`, false, describeError(headR.error));
      continue;
    }
    check(`Section3 ${name}: Phase bleibt ${phase}`, phaseOf(headR.html) === phase, phaseOf(headR.html));
    check(`Section3 ${name}: RSL-Anzeige ${REASON}`, rslLabelOf(headR.html) === REASON, rslLabelOf(headR.html));
    check(`Section3 ${name}: Grund im Markup`, headR.html.includes(REASON));
    check(`Section3 ${name}: kein RSL: 0`, !headR.html.includes("RSL: 0"));
  }
  if (section3Threw && fail > 0) {
    console.log("\nRED: Section3 wirft bei rsl null.");
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
