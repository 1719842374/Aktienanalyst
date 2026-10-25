/**
 * S1-Kopf "Ampel (S17)" (ExecSummaryCard) zeigt dieselbe Ampel wie der Fazit-Kasten
 * und das S20-Fazit (buildFazitSignal) – unabhaengig davon, ob die spaet
 * nachgeladenen Scores (Management /api/management-score, Thesis Strength) schon da sind.
 *
 * Bug (main 995036fa): Der Kopf zeigte bias.overallRating (Gesamtscore). Der kippt
 * fuer SHEL.L je nach Ladezeitpunkt: ohne Management-Score ATTRAKTIV, mit Score 3
 * LEICHT ATTRAKTIV (gleich viel Wartezeit -> je nach Geraet/Breite verschieden),
 * waehrend S20 "Signal-Score = NEUTRAL" zeigt.
 * Reine Anzeige: buildFazitSignal / buildBiasDecision bleiben unveraendert.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { ExecSummaryCard } from "../client/src/components/ExecSummaryCard";
import { SummarySection } from "../client/src/components/sections/SummarySection";
import { buildFazitSignal, prepareFazitMetrics } from "../client/src/lib/fazit-signal";
import { buildBiasDecision } from "../shared/bias-fixes";
import { calculateGBMParams, gbmMonteCarlo } from "../client/src/lib/calculations";

const base = (await import("./fixtures/analysis-SHEL.L.json", { with: { type: "json" } }) as any).default;
let pass = 0, fail = 0;
const check = (name: string, fn: () => void) => { try { fn(); pass++; console.log("  ✓", name); } catch (e: any) { fail++; console.log("  ✗", name, "—", e.message.split("\n")[0]); } };

const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
const headerAmpel = (h: string) => strip((h.match(/data-testid="exec-summary-ampel"[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? "");
const execFazit = (h: string) => strip((h.match(/data-testid="exec-summary-fazit-ampel"[\s\S]*?<span class="text-sm font-bold[^"]*">([\s\S]*?)<\/span>/) ?? [])[1] ?? "");
const s20Signal = (h: string) => strip((h.match(/Signal-Score:[\s\S]*?<span class="font-semibold[^"]*">([\s\S]*?)<\/span>/) ?? [])[1] ?? "");

const prices = base.historicalPrices.map((p: any) => p.close);
const gp = calculateGBMParams(prices);
const mc = gbmMonteCarlo({ currentPrice: base.currentPrice, mu: gp.mu, sigma: gp.sigma, iterations: 10000, tradingDays: 252 }, base.analystPT.median);

// Ladezustaende wie im Browser: vor/nach Management-Score, plus Thesis-Score.
const states: Array<[string, any]> = [
  ["initial (Scores noch nicht da)", { ...base }],
  ["Management-Score 3 nachgeladen", { ...base, managementScore: 3 }],
  ["Management-Score 1 nachgeladen", { ...base, managementScore: 1 }],
  ["Management 3 + Thesis 30", { ...base, managementScore: 3, thesisStrengthScore: 30 }],
];

console.log("SHEL.L – Ampel im S1-Kopf je Ladezustand");
const biasRatings = new Set<string>();
const headers = new Set<string>();
for (const [label, data] of states) {
  const expected = buildFazitSignal({ data, ...prepareFazitMetrics(data, mc) }).rating;
  biasRatings.add(buildBiasDecision(data).overallRating);
  const hExec = renderToStaticMarkup(React.createElement(ExecSummaryCard as any, { data, sharedMonteCarlo: mc }));
  const hS20 = renderToStaticMarkup(React.createElement(SummarySection as any, { data, sharedMonteCarlo: mc }));
  const head = headerAmpel(hExec);
  headers.add(head);
  check(`${label}: Kopf "${head}" == Fazit-Ampel "${expected}"`, () => assert.equal(head, expected));
  check(`${label}: Kopf == Fazit/Ampel-Kasten (S1)`, () => assert.equal(head, execFazit(hExec)));
  check(`${label}: Kopf == S20 Signal-Score`, () => assert.equal(head, s20Signal(hS20)));
}
check(`Vorbedingung: Gesamtscore-Rating kippt mit Ladezustand (${[...biasRatings].join(" / ")})`, () => assert.ok(biasRatings.size >= 2));
check(`Kopf-Ampel stabil ueber alle Ladezustaende (${[...headers].join(" / ")})`, () => assert.equal(headers.size, 1));

// Ohne sharedMonteCarlo-Prop (Altaufrufer) rendert die Karte weiter.
check("ohne sharedMonteCarlo rendert Kopf weiterhin", () => assert.ok(headerAmpel(renderToStaticMarkup(React.createElement(ExecSummaryCard as any, { data: base }))).length > 0));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
