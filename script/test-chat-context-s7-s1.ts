/**
 * Tester-FAIL #275 (Prod MSFT): Chat-Kontext muss in S7 genau die angezeigten Fair Values, WACC,
 * Abweichung zum Kurs, Bewertungsurteil und Warnbox tragen und in S1 die angezeigte Ampel statt
 * eines 0–100-Scores. Außerdem: S8 katalysatorGBSumme == Seiten-Summe (sumUpsideGb, ▼ = 0).
 * Offline, kein LLM. Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-context-s7-s1.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";

(globalThis as any).React = React;
let fail = 0, n = 0;
const check = (name: string, ok: boolean, info = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` ${info}`}`); if (!ok) fail++; };
const r2 = (v: number) => Math.round(v * 100) / 100;

const cc = await import("../shared/chat-context");
const bias = await import("../shared/bias-fixes");
const bus = await import("../client/src/lib/chatSectionData");
const fmt = await import("../client/src/lib/formatters");
const { buildFazitSignal, prepareFazitMetrics } = await import("../client/src/lib/fazit-signal");
const { Section5 } = await import("../client/src/components/sections/Section5");
const { ExecSummaryCard } = await import("../client/src/components/ExecSummaryCard");

const raw = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const data: any = { description: "", industry: "", sector: "", ...raw };
const before = JSON.stringify(data);
const strip = (h: string) => h.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

// ── S7 ──
bus.resetChatSectionData();
const h7 = strip(renderToStaticMarkup(React.createElement(Section5, { data })));
const p7: any = bus.readChatSectionData("stock")["7"];
const ccy = fmt.statementCurrency(data);
for (const k of ["fairValue_konservativ", "fairValue_optimistisch", "fairValue_makroStress", "fairValue_riskAdjInverted", "fairValue_safetyMargin30"]) {
  check(`S7 ${k} gesetzt und so im HTML (${p7?.[k]})`, typeof p7?.[k] === "number" && h7.includes(fmt.formatCurrency(p7[k], 2, ccy)));
}
for (const k of ["waccPct", "waccOptimistischPct", "waccMakroStressPct"]) check(`S7 ${k} so im HTML (${p7?.[k]}%)`, typeof p7?.[k] === "number" && h7.includes(`${p7[k].toFixed(2)}%`));
for (const [k, fv] of [["vsKurs_konservativPct", "fairValue_konservativ"], ["vsKurs_optimistischPct", "fairValue_optimistisch"], ["vsKurs_makroStressPct", "fairValue_makroStress"]] as const) {
  check(`S7 ${k} so im HTML (${p7?.[k]}%)`, typeof p7?.[k] === "number" && h7.includes(`${p7[k].toFixed(1)}%`));
}
check("S7 kurs = data.currentPrice", p7?.kurs === r2(data.currentPrice));
const over = p7.fairValue_konservativ < data.currentPrice;
check(`S7 bewertungsurteil passt zur Anzeige (${over ? "Über" : "Unter"}bewertung)`, typeof p7?.bewertungsurteil === "string" && p7.bewertungsurteil.startsWith(over ? "Überbewertung laut S7" : "Unterbewertung laut S7"), p7?.bewertungsurteil);
const warnShown = h7.includes("AUTOMATISCHE WARNUNG");
check(`S7 warnbox genau dann gesetzt, wenn angezeigt (${warnShown})`, warnShown ? typeof p7.warnbox === "string" && h7.includes(p7.warnbox.split(" — ")[1]) : p7.warnbox === null, p7?.warnbox);
check("S7 Kontext enthält Fair Values + WACC (kein n/a)", cc.enrichChatContext(cc.buildStockChatContext(data), bus.readChatSectionData("stock")).sections.find(s => s.id === 7)!.facts.waccPct === p7.waccPct);

// Konstruierter Fall wie Prod: Kurs über Conservative-FV → Überbewertung + Warnbox.
bus.resetChatSectionData();
const hi = { ...data, currentPrice: p7.fairValue_konservativ * 1.23 };
const hHi = strip(renderToStaticMarkup(React.createElement(Section5, { data: hi })));
const pHi: any = bus.readChatSectionData("stock")["7"];
check("S7 Kurs > FV: Urteil Überbewertung, Warnbox im Kontext = Warnbox im HTML", pHi.bewertungsurteil.startsWith("Überbewertung laut S7") && pHi.warnbox && hHi.includes("AUTOMATISCHE WARNUNG") && hHi.includes(pHi.warnbox.split(" — ")[1]), JSON.stringify(pHi.warnbox));

// ── S1 ──
bus.resetChatSectionData();
const view = { ...data, execSummary: data.execSummary ?? { headline: "x", pro: [], contra: [] } };
const h1 = strip(renderToStaticMarkup(React.createElement(ExecSummaryCard, { data: view })));
const p1: any = bus.readChatSectionData("stock")["1"];
const fz = buildFazitSignal({ data: view, ...prepareFazitMetrics(view) });
const bd = bias.buildBiasDecision(view);
check("S1 veröffentlicht", !!p1);
check(`S1 ampel == angezeigte Ampel (${p1?.ampel})`, p1?.ampel === (bd?.overallRating ?? fz.rating) && h1.includes(`Ampel (S17)${p1.ampel}`));
check("S1 signalScore so im HTML", h1.includes(`Signal-Score: ${p1.signalScore}`), p1?.signalScore);
check("S1 Basis/Upside so im HTML", h1.includes(`Basis: ${p1.bewertungsBasis} ${bd.decisionPerShare.toFixed(2)}`) && h1.includes(`Upside ${bd.decisionUpsidePct >= 0 ? "+" : ""}${bd.decisionUpsidePct.toFixed(1)}%`));
const ctx1 = cc.enrichChatContext(cc.buildStockChatContext(data), bus.readChatSectionData("stock")).sections.find(s => s.id === 1)!.facts;
check("S1 hat kein 'finalScore' mehr (0–100-Score nur als S20-Verweis)", !("finalScore" in ctx1) && ctx1.scoringFinalScore_S20 === (data.scoring ? r2(data.scoring.finalScore * 1) : null) && ctx1.ampel === p1.ampel);
const s20 = cc.buildStockChatContext(data).sections.find(s => s.id === 20)!.facts;
check("S20 finalScore unverändert = data.scoring.finalScore", s20.finalScore === (data.scoring ? Math.round(data.scoring.finalScore * 10) / 10 : null));

// ── S8 katalysatorGBSumme == sumUpsideGb ──
const cats = [{ name: "A", gb: 5 }, { name: "B", gb: 3, flag: "▼" }, { name: "C", gb: 2.5, direction: "negative" }, { name: "D", gb: 1.25 }];
const s8 = cc.buildStockChatContext({ ...data, catalysts: cats } as any).sections.find(s => s.id === 8)!.facts;
check(`S8 katalysatorGBSumme == sumUpsideGb (▼ = 0) → ${s8.katalysatorGBSumme}`, s8.katalysatorGBSumme === 6.25 && bias.sumUpsideGb(cats as any) === 6.25);
const s8m = cc.buildStockChatContext(data).sections.find(s => s.id === 8)!.facts;
check("S8 MSFT-Fixture == sumUpsideGb(data.catalysts)", s8m.katalysatorGBSumme === Math.round(bias.sumUpsideGb(data.catalysts) * 100) / 100, `${s8m.katalysatorGBSumme}`);

check("Fixture nicht mutiert", JSON.stringify(data) === before);
console.log(fail ? `❌ ${fail}/${n} FAIL` : `${n}/${n} Checks grün`);
if (fail) process.exit(1);
