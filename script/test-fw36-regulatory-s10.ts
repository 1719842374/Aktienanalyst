/**
 * FW-36: Regulatory-Risiken (Regulatory-Matrix/PESTEL-Cache) in Sektion 10 Risikoinversion — nur Anzeige.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-fw36-regulatory-s10.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

let failed = 0;
const check = (n: string, c: boolean, d?: string) => { if (c) console.log(`  ✅ ${n}`); else { failed++; console.error(`  ❌ ${n}${d ? ` — ${d}` : ""}`); } };
const wrap = (el: any) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(QueryClientProvider, { client: new QueryClient() }, el)));

(async () => {
  const fx = JSON.parse(readFileSync("script/fixtures/lse-dividends-live.json", "utf8"));
  const shel = { ...fx._analyzeSHEL };
  const { RegulatoryPestelRisks } = await import("../client/src/components/sections/RegulatoryPestelRisks");
  const cached = {
    pestelRisks: { political: ["UK Windfall Tax (Energy Profits Levy) — EPS −3,1 %"], legal: ["EU-Methanverordnung — EPS −0,8 %"], badgeOnly: ["CBAM"] },
    gate: { cap: 6, severity: "soft", rationale: "materielles Exposure UK" },
  };

  console.log("Sektion-10-Variante");
  const s10 = wrap(React.createElement(RegulatoryPestelRisks as any, { data: shel, variant: "risk-inversion", initialCached: cached }));
  check("Panel mit data-testid s10-regulatory-risks", s10.includes('data-testid="s10-regulatory-risks"'));
  check("Titel Regulatorische Risiken + Ticker", s10.includes(`Regulatorische Risiken aus Regulatory-Matrix (${shel.ticker})`));
  check("Hinweis: nicht in Total Expected Damage/Score", s10.includes("nicht in Total Expected Damage, Risk-Adjusted Target oder Score eingerechnet"));
  check("Political/Legal/Badge/Gate aus dem Cache sichtbar", ["UK Windfall Tax", "EU-Methanverordnung", "CBAM", "Gate Cap 6"].every(t => s10.includes(t)));
  const empty = wrap(React.createElement(RegulatoryPestelRisks as any, { data: shel, variant: "risk-inversion" }));
  check("ohne Cache → nichts gerendert (kein leerer Rahmen)", empty === "");

  console.log("PESTEL-Variante unverändert");
  const pestel = wrap(React.createElement(RegulatoryPestelRisks as any, { data: shel, initialCached: cached }));
  check("PESTEL-Titel unverändert, kein S10-Hinweis/testid", pestel.includes(`PESTEL-Risks aus Regulatory-Matrix (${shel.ticker})`) && !pestel.includes("s10-regulatory-risks") && !pestel.includes("nicht in Total Expected Damage"));

  console.log("Sektion 10 verdrahtet, Rechnung unberührt");
  const src = readFileSync("client/src/components/sections/Section8.tsx", "utf8");
  check("Section8 rendert <RegulatoryPestelRisks variant=\"risk-inversion\">", src.includes('<RegulatoryPestelRisks data={data} variant="risk-inversion" />'));
  const calc = src.slice(src.indexOf("const totalExpectedDamage"), src.indexOf("async function triggerKI"));
  check("Risikorechnung (vor dem JSX) liest keine Regulatory-Daten", calc.length > 500 && !/regulator|pestel/i.test(calc));
  const { Section8 } = await import("../client/src/components/sections/Section8");
  const a = wrap(React.createElement(Section8 as any, { data: shel }));
  const b = wrap(React.createElement(Section8 as any, { data: structuredClone(shel) }));
  let ok = true; try { assert.deepEqual(a, b); } catch { ok = false; }
  check("Section8 rendert deterministisch; ohne Cache kein Regulatory-Block (Zahlen identisch zu vorher)", ok && !a.includes("s10-regulatory-risks") && a.includes("Total Expected Damage"));

  if (failed) { console.error(`\n${failed} Fehler`); process.exit(1); }
  console.log("\nalle Checks grün");
})();
