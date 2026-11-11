/**
 * Follow-up #271 (Tester DoD-271 Soft 1): /api/analyze lieferte bei Yahoo-only (kein Konzernumsatz) tamAnalysis
 * companyGrowth 0, companyRevenue 0, marketShare 0, outperforming false, tamTotal 5000 („Global Market“-Default).
 * Fix in server/sector-data.ts generateTAMAnalysis: ohne Umsatz → null (n/a) + companyDataMissing 'no-revenue'.
 * Branchenseite (tamCAGR, tamLabel, tamSource) und quality 'weak' bleiben → dcfGrowthCapFromTam unverändert.
 *
 * 1. Unit: ohne Umsatz (0 / NaN / negativ, bekannte + unbekannte Sektoren, mit Segmenten) → n/a.
 * 2. Mit Umsatz: Ergebnis byte-gleich zur Version auf LEGACY_REF (Standard 995036fa = main) über ein Raster.
 * 3. dcfGrowthCapFromTam für Yahoo-Fälle identisch zu vorher (gleiche quality/tamCAGR).
 * 4. Section7 (SSR) mit Server-Payload ohne Yahoo-Flag: TAM/Wachstum/Marktanteil n/a, kein $5,000B, kein Amber-Banner.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-tam-analysis-server.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { generateTAMAnalysis, dcfGrowthCapFromTam } from "../server/sector-data";

(globalThis as any).React = React;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const LEGACY_REF = process.env.LEGACY_REF ?? "995036fa";
const LEGACY_PATH = `${ROOT}/server/__sector-data-legacy.test-tmp.ts`;

let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` (${detail})` : ""}`); if (!ok) fail++; };

const SECTORS: Array<[string, string, string]> = [
  ["", "", ""], ["Technology", "Software—Infrastructure", "cloud software"], ["Technology", "Semiconductors", "chips"],
  ["Consumer Cyclical", "Auto Manufacturers", "cars"], ["Healthcare", "Drug Manufacturers", "pharma"],
  ["Financial Services", "Banks—Diversified", "bank"], ["Energy", "Oil & Gas Integrated", "oil"], ["Unknown Sector", "Misc", ""],
];
const SEGS = [{ name: "Cloud", revenue: 60e9, percentage: 60, growth: 20 }, { name: "Devices", revenue: 40e9, percentage: 40, growth: 3 }] as any;

console.log("=== 1. Ohne Umsatz → n/a ===");
for (const [sec, ind, desc] of SECTORS) for (const rev of [0, NaN, -1]) for (const segs of [undefined, SEGS]) {
  const r: any = generateTAMAnalysis(sec, ind, desc, rev, 0, segs);
  const ok = r.tamTotal === null && r.companyGrowth === null && r.companyRevenue === null && r.marketShare === null && r.outperforming === null
    && r.companyDataMissing === "no-revenue" && r.quality === "weak" && typeof r.tamLabel === "string"
    // Follow-up #292 (SAP.DE/VOW3.DE): ohne Sektor UND Branche kein Sektor-Default mehr → tamCAGR null (n/a).
    && (sec === "" && ind === "" ? r.tamCAGR === null : typeof r.tamCAGR === "number");
  if (!ok || (rev === 0 && !segs)) check(`'${sec || "(leer)"}' rev=${rev} segs=${segs ? 2 : 0}: n/a, tamCAGR ${r.tamCAGR}, quality ${r.quality}`, ok, JSON.stringify({ t: r.tamTotal, g: r.companyGrowth, rv: r.companyRevenue, m: r.marketShare }));
}

let legacy: any = null;
try {
  writeFileSync(LEGACY_PATH, execSync(`git -C ${ROOT} show ${LEGACY_REF}:server/sector-data.ts`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  legacy = await import("../server/__sector-data-legacy.test-tmp");
} catch { console.log(`⚠ LEGACY_REF ${LEGACY_REF} nicht verfügbar: Vergleich übersprungen`); }
try {
  if (legacy) {
    console.log(`\n=== 2. Mit Umsatz: byte-gleich zu ${LEGACY_REF} ===`);
    let cases = 0, diffs: string[] = [];
    for (const [sec, ind, desc] of SECTORS) for (const rev of [1e6, 5e9, 245e9]) for (const g of [-12, 0, 7.5, 40]) for (const segs of [undefined, [], SEGS]) {
      cases++;
      const a = JSON.stringify(legacy.generateTAMAnalysis(sec, ind, desc, rev, g, segs)), b = JSON.stringify(generateTAMAnalysis(sec, ind, desc, rev, g, segs));
      if (a !== b) diffs.push(`${sec}/${rev}/${g}/${segs ? segs.length : "-"}`);
    }
    check(`${cases} Fälle mit Umsatz > 0 identisch (FMP-Pfad, z.B. MSFT)`, diffs.length === 0, diffs.slice(0, 5).join(", "));
    console.log("\n=== 3. DCF-Gate (dcfGrowthCapFromTam) für Yahoo-Fälle unverändert ===");
    let same = 0, tot = 0;
    for (const [sec, ind, desc] of SECTORS) for (const g of [-5, 0, 3, 25]) {
      tot++;
      const o: any = legacy.generateTAMAnalysis(sec, ind, desc, 0, g, undefined), nn: any = generateTAMAnalysis(sec, ind, desc, 0, g, undefined);
      const capO = JSON.stringify(legacy.dcfGrowthCapFromTam({ quality: o.quality ?? "weak", tamCAGR: o.tamCAGR, companyGrowth: g }));
      const capN = JSON.stringify(dcfGrowthCapFromTam({ quality: nn.quality ?? "weak", tamCAGR: nn.tamCAGR, companyGrowth: g }));
      // Follow-up #292: leerer Sektor/Branche → tamCAGR jetzt null statt Default 5; DCF-Gate muss trotzdem identisch sein.
      const cagrOk = sec === "" && ind === "" ? nn.tamCAGR === null : o.tamCAGR === nn.tamCAGR;
      if (capO === capN && cagrOk && o.quality === nn.quality) same++;
    }
    check(`dcfGrowthCapFromTam/tamCAGR/quality identisch (${same}/${tot})`, same === tot);
  }
} finally { if (existsSync(LEGACY_PATH)) unlinkSync(LEGACY_PATH); }

console.log("\n=== 4. Section7 mit Server-n/a (ohne Yahoo-Flag) ===");
const { Section7 } = await import("../client/src/components/sections/Section7");
const fixture = (await import("./fixtures/analysis-MSFT.json", { with: { type: "json" } }) as any).default;
const tamNa: any = generateTAMAnalysis("", "", "", 0, 0, undefined);
const data = { ...fixture, dataSource: "fmp", tamAnalysis: tamNa };
const h = renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: new QueryClient() }, React.createElement(Section7 as any, { data }))));
const tile = (label: string) => (h.match(new RegExp(`${label}</div><div class="[^"]*">([^<]*)</div>`)) ?? [])[1];
check("TAM-Karte sichtbar (nicht ausgeblendet)", h.includes("TAM &amp; Marktposition") || h.includes("TAM & Marktposition"));
check("TAM n/a", tile("TAM") === "n/a", String(tile("TAM")));
check("Unternehmens-Wachstum n/a", tile("Unternehmens-Wachstum") === "n/a", String(tile("Unternehmens-Wachstum")));
check("Branchen-CAGR bleibt (Branchenseite)", /Branchen-CAGR/.test(h));
check("kein Amber-Banner „Segment-TAM nicht belastbar“", !h.includes("Segment-TAM nicht belastbar"));
check("Wachstum vs. Branche: n/a (kein Umsatz)", h.includes("n/a (kein Umsatz)") && !/Pkt\. (langsamer|schneller) als die Branche/.test(h));
const leaks = ["$5,000B", "$0.0B", "&lt;0.01%"].filter(s => h.includes(s));
check("keine 0-/Default-Werte im Markup", leaks.length === 0, leaks.join(", "));

console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
