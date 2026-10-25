/**
 * KI-Chatbot PR 3: Kontext vollständig (alle Sektionen je Asset, Client-Werte, Auffälligkeiten, Budget).
 * Offline, kein LLM, keine Netzabfrage. Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-context-full.ts
 *
 * Kernbeweis „Kontextwert == angezeigter Wert“: die Sektionen werden mit einer Fixture gerendert
 * (react-dom/server); der Wert, den die Sektion im Render veröffentlicht, muss im gerenderten HTML
 * genau so formatiert stehen und mit derselben bestehenden Client-Funktion übereinstimmen.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).React = React;
let fail = 0, n = 0;
const check = (name: string, ok: boolean, info = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` ${info}`}`); if (!ok) fail++; };
const r2 = (v: number) => Math.round(v * 100) / 100;

const cc = await import("../shared/chat-context");
const bus = await import("../client/src/lib/chatSectionData");
const calc = await import("../client/src/lib/calculations");
const fmt = await import("../client/src/lib/formatters");
const { Section5 } = await import("../client/src/components/sections/Section5");
const { Section6 } = await import("../client/src/components/sections/Section6");
const { Section9 } = await import("../client/src/components/sections/Section9");
const { MonteCarloSection } = await import("../client/src/components/sections/MonteCarloSection");
const { RegionRsiPanel } = await import("../client/src/components/recession/RegionRsiPanel");
const { BuffettRatioPanel } = await import("../client/src/components/recession/BuffettRatioPanel");
const { RecessionMarketChartsSection } = await import("../client/src/components/recession/RecessionMarketChartsSection");
const { handleChat, validateChatRequest, CHAT_SYSTEM_PROMPT } = await import("../server/chat-route");
const { BTC_FALLBACK_DATA } = await import("../client/src/lib/btcFallbackData");
const { GOLD_FALLBACK_DATA } = await import("../client/src/lib/goldFallbackData");
const { RECESSION_FALLBACK_DATA } = await import("../client/src/lib/recessionFallbackData");

// Fixture: echte MSFT-Analyse; `description` fehlt im alten Cache-Eintrag → leer ergänzt (Section5 liest .toLowerCase()).
const fbBefore = JSON.stringify([BTC_FALLBACK_DATA, GOLD_FALLBACK_DATA, RECESSION_FALLBACK_DATA]);
const raw = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const data = { description: "", industry: "", sector: "", ...raw };
const dataBefore = JSON.stringify(data);
const html = (el: any) => renderToStaticMarkup(el);
const ccy = fmt.statementCurrency(data);

// ── Sektion 7 DCF ──
bus.resetChatSectionData();
const h7 = html(React.createElement(Section5, { data }));
const p7 = bus.readChatSectionData("stock")["7"];
const dcf = calc.calculateFCFFDCF(calc.buildDefaultDCFParams(data));
check("S7 veröffentlicht", !!p7);
check("S7 fairValue_konservativ == calculateFCFFDCF(buildDefaultDCFParams) (gleiche Funktion)", p7?.fairValue_konservativ === r2(dcf.perShare), `${p7?.fairValue_konservativ} vs ${dcf.perShare}`);
check("S7 Fair Value steht so im HTML", h7.includes(fmt.formatCurrency(p7!.fairValue_konservativ as number, 2, ccy)));
check("S7 Risk-Adj. DCF steht so im HTML", h7.includes(fmt.formatCurrency(p7!.fairValue_riskAdjInverted as number, 2, ccy)));
check("S7 WACC steht so im HTML", h7.includes(`${(p7!.waccPct as number).toFixed(2)}%`));

// ── Sektion 8 CRV ──
const h8 = html(React.createElement(Section6, { data }));
const p8 = bus.readChatSectionData("stock")["8"];
check("S8 veröffentlicht", !!p8);
check("S8 CRV konservativ steht so im HTML", h8.includes(`${fmt.formatNumber(p8!.crv_konservativ as number, 1)}:1`));
check("S8 Worst Case steht so im HTML", h8.includes(fmt.formatCurrency(p8!.worstCase as number, 2, data.currency)));
const wc = Math.min(calc.worstCaseM1(data.currentPrice, data.beta5Y, data.sectorMaxDrawdown || 35),
  calc.worstCaseM2(data.currentPrice, data.risks?.length ? Math.max(...data.risks.map((r: any) => Math.abs(r.impact))) : 35),
  calc.worstCaseM3(data.currentPrice, data.sectorMaxDrawdown || 35, data.lynchClass));
check("S8 crv_konservativ == calculateCRV(gleiche Eingaben)", p8!.crv_konservativ === r2(calc.calculateCRV(dcf.perShare, wc, data.currentPrice)));
check("S8 DCF-FV identisch mit S7 (Single Source of Truth)", p8!.dcfBeiCRV3_base === r2((dcf.perShare + 2 * wc) / 3));

// ── Sektion 11 RSL ──
const h11 = html(React.createElement(Section9, { data }));
const p11 = bus.readChatSectionData("stock")["11"];
const prices26w = [...data.historicalPrices].sort((a: any, b: any) => b.date.localeCompare(a.date)).slice(0, 130).map((p: any) => p.close);
check("S11 rsl == calculateRSL (gleiche Funktion)", p11?.rsl === r2(calc.calculateRSL(data.currentPrice, prices26w)!));
check("S11 RSL steht so im HTML", h11.includes(fmt.formatNumber(p11!.rsl as number, 2)) && h11.includes(String(p11!.rslZone)));

// ── Sektion 18 Monte Carlo (Default-Ansicht zeigt den geteilten Lauf des Dashboards) ──
const gbm = calc.calculateGBMParams(data.historicalPrices.map((p: any) => p.close));
const shared = calc.gbmMonteCarlo({ currentPrice: data.currentPrice, mu: gbm.mu, sigma: gbm.sigma, iterations: 10000, tradingDays: 252 }, data.analystPT.median);
html(React.createElement(MonteCarloSection, { data, sharedResult: shared }));
const p18 = bus.readChatSectionData("stock")["18"];
const r4 = (v: number) => Math.round(v * 10000) / 10000;
check("S18 veröffentlicht = sharedResult (derselbe Lauf wie Anzeige/Sektion 20)", !!p18 && p18.p50 === r4(shared.p50) && p18.p10 === r4(shared.p10) && p18.wVerlust === r4(shared.downsideProb));
check("S18 ohne sharedResult und ohne Lauf → nichts (n/a), nicht geschätzt", (() => { bus.resetChatSectionData(); html(React.createElement(MonteCarloSection, { data, sharedResult: null })); return !bus.readChatSectionData("stock")["18"]; })());
html(React.createElement(Section5, { data })); html(React.createElement(Section6, { data })); html(React.createElement(Section9, { data }));
html(React.createElement(MonteCarloSection, { data, sharedResult: shared }));

// ── Aktie: Provider + Enrich ──
const base = cc.buildStockChatContext(data);
const baseJson = JSON.stringify(base);
const live = bus.readChatSectionData("stock");
const stock = cc.enrichChatContext(base, live, { gatesSectionId: 20 });
check("Aktie: Provider unverändert (byte-gleich nach Enrich, keine Mutation)", JSON.stringify(cc.buildStockChatContext(data)) === baseJson && JSON.stringify(base) === baseJson);
check("Aktie: Analyse-Daten unverändert (byte-gleich)", JSON.stringify(data) === dataBefore);
check("Aktie: 20 Sektionen", stock.sections.length === 20 && stock.sections.map(s => s.id).join() === Array.from({ length: 20 }, (_, i) => i + 1).join());
const S = (c: any, id: number) => c.sections.find((s: any) => s.id === id)!.facts;
check("Aktie: Kontext S7 == angezeigter Wert", S(stock, 7).fairValue_konservativ === p7!.fairValue_konservativ);
check("Aktie: Kontext S8/S11/S18 == angezeigter Wert", S(stock, 8).crv_konservativ === p8!.crv_konservativ && S(stock, 11).rsl === p11!.rsl && S(stock, 18).p50 === r4(shared.p50));
check("Aktie: Client-Hinweis in S11/S18 entfernt", S(stock, 11).hinweis === undefined && S(stock, 18).hinweis === undefined);
check("Aktie: Notiz 'nur teilweise' ersetzt", !stock.notes.some(x => /nur teilweise/.test(x)) && stock.notes.some(x => /7, 8, 11, 18/.test(x)));

// ── Auffälligkeiten ──
const allCtx: Array<[string, any]> = [];
allCtx.push(["stock", stock]);
const btcBare = cc.enrichChatContext(cc.buildBtcChatContext(BTC_FALLBACK_DATA), null);
allCtx.push(["btc", btcBare]);
const gold = cc.enrichChatContext(cc.buildGoldChatContext(GOLD_FALLBACK_DATA), null, { gatesSectionId: 8 });
allCtx.push(["gold", gold]);
for (const [name, c] of allCtx) check(`${name}: jede Sektion hat 'auffaelligkeiten' (string)`, c.sections.every((s: any) => typeof s.facts[cc.CHAT_WEAKNESS_KEY] === "string" && s.facts[cc.CHAT_WEAKNESS_KEY].length <= 400));
check("Aktie: S7 Auffälligkeit aus angezeigtem Flag oder 'keine'", typeof S(stock, 7).auffaelligkeiten === "string");
check("Aktie: '_auffaelligkeiten' nicht als Rohfeld im Kontext", stock.sections.every(s => !("_auffaelligkeiten" in s.facts)));
const act = base.gates.filter(g => g.active);
check("Aktie: aktive Gates in S20-Auffälligkeiten", act.length === 0 ? true : act.every(g => String(S(stock, 20).auffaelligkeiten).includes(g.id)));
check("BTC ohne Live-Daten: S3/S13 'nicht geladen: n/a'", /nicht geladen/.test(String(S(btcBare, 3).auffaelligkeiten)) && /nicht geladen/.test(String(S(btcBare, 13).auffaelligkeiten)));
check("Auffälligkeiten nennen n/a-Felder", (() => { const c = cc.enrichChatContext({ ...base, sections: [{ id: 1, label: "x", facts: { a: null, b: 1 } }] }, null); return /fehlende Werte \(n\/a\): a/.test(String(c.sections[0].facts.auffaelligkeiten)); })());

// ── BTC mit veröffentlichten S3/S13 (Form wie Publisher) ──
bus.publishChatSectionData("btc", "3", { newsAnzahl: 4, adaptiveNoteS: 51.2, _auffaelligkeiten: "QRA-Anker veraltet (stale)" });
bus.publishChatSectionData("btc", "13", { zone: "neutral", breakevenUSD: 61000, _auffaelligkeiten: null });
const btc = cc.enrichChatContext(cc.buildBtcChatContext(BTC_FALLBACK_DATA), bus.readChatSectionData("btc"));
check("BTC: S3/S13 aus Anzeige, Hinweis weg", S(btc, 3).adaptiveNoteS === 51.2 && S(btc, 13).breakevenUSD === 61000 && S(btc, 3).hinweis === undefined);
check("BTC: S3-Auffälligkeit aus angezeigtem Flag", /stale/.test(String(S(btc, 3).auffaelligkeiten)));
check("BTC: Notiz 'fehlen im Kontext' entfernt", !btc.notes.some(x => /fehlen im Kontext/.test(x)));

// ── Rezession: RSI / Marktcharts / Buffett über den bestehenden react-query-Cache (keine Abfrage) ──
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: true } } });
const rsiPayload = { region: "US", label: "US · SPY", etf: "SPY", window: "5Y", asOf: "2026-10-23", rsi: 72.4, rsiZone: "overbought", macd: 1.2, signal: 1.5, hist: -0.3, combo: "overbought_fade", divergence: { kind: "none", lookback: 90, from: null, to: null, price1: 0, price2: 0, rsi1: 0, rsi2: 0 }, series: [], volLatest: 16.2, volBand: "Complacency", vol: [] };
qc.setQueryData(["recession-markets", "US", "5Y"], rsiPayload);
const buff = { region: "US", asOf: "2026-10-20", note: "FRED", latest: { date: "2026-09-30", ratio: 205.3, trend: 150.1, plus1: 175, plus2: 200, minus1: 125, minus2: 100, premiumPct: 36.8, zScore: 2.2 }, points: [] };
qc.setQueryData(["recession-buffett", "US"], buff);
const snap = (pe: number) => ({ pe, peFwd: 21, peg: 3.4, pegFwd: 2, pegKind: "formula", pegFwdKind: "formula", epsYoy: 8, rsi: 60, macdHist: 0.1, missing: null });
const mk = (id: string) => ({ id, etf: id, name: id, volId: "VIX", volKind: "implied", bandsAnalog: false, volYMax: 90, volNote: null, ohlcv: [], vol: [], marks: [], snapshot: snap(25), leverage: null, leverageNote: null, valuationLabel: `${id} Bewertung` });
qc.setQueryData(["recession-market-charts", "5Y"], { asOf: "2026-10-23", window: "5Y", markets: ["SPY", "QQQ", "VGK", "ASHR"].map(mk) });
const origFetch = globalThis.fetch; let fetches = 0;
(globalThis as any).fetch = async () => { fetches++; throw new Error("kein Netz im Test"); };
const wrap = (el: any) => renderToStaticMarkup(React.createElement(QueryClientProvider, { client: qc }, el));
const hR = wrap(React.createElement(RegionRsiPanel));
const hB = wrap(React.createElement(BuffettRatioPanel));
const hM = wrap(React.createElement(RecessionMarketChartsSection, { number: 9 }));
(globalThis as any).fetch = origFetch;
const rl = bus.readChatSectionData("recession");
check("Rezession: keine zusätzliche Abfrage beim Rendern/Veröffentlichen", fetches === 0, `fetches=${fetches}`);
check("Rezession RSI: Kontext == Anzeige", rl.rsi?.rsi14 === 72.4 && hR.includes("RSI(14) 72.4") && /Überkauft/.test(String(rl.rsi?._auffaelligkeiten)));
check("Rezession Buffett: Kontext == Cache-Wert", rl.buffett?.marktwertZuBipPct === 205.3 && rl.buffett?.zScore === 2.2 && /\+2σ/.test(String(rl.buffett?._auffaelligkeiten)) && hB.length > 0);
check("Rezession Märkte: Snapshot-Zeile == Anzeige", typeof rl.markt?.SPY === "string" && hM.includes(String(rl.markt!.SPY).split(" · PEG")[0].replace("SPY Bewertung · ", "")) && /PEG > 3/.test(String(rl.markt?._auffaelligkeiten)));
const layout = cc.recessionSectionLayout(false, !!(RECESSION_FALLBACK_DATA as any).fazit);
const rec = cc.enrichChatContext(cc.buildRecessionChatContext(RECESSION_FALLBACK_DATA, { hasRegions: false }), rl, { keyToId: Object.fromEntries(layout.map(s => [s.key, s.id])) });
const idOf = (k: string) => layout.find(s => s.key === k)!.id;
check("Rezession: RSI/Markt/Buffett im Kontext an richtiger Sektion", S(rec, idOf("rsi")).rsi14 === 72.4 && S(rec, idOf("buffett")).zScore === 2.2 && typeof S(rec, idOf("markt")).QQQ === "string");
check("Rezession: jede Sektion hat Auffälligkeiten", rec.sections.every(s => typeof s.facts.auffaelligkeiten === "string"));

// ── Budget / Größe ──
for (const [name, c] of [["stock", stock], ["btc", btc], ["gold", gold], ["recession", rec]] as const) {
  const len = JSON.stringify(c).length;
  console.log(`   Größe ${name}: ${len} Zeichen`);
  check(`${name}: ≤ Budget ${cc.CHAT_CONTEXT_BUDGET}`, len <= cc.CHAT_CONTEXT_BUDGET);
  check(`${name}: Server-Validierung akzeptiert`, validateChatRequest({ dashboard: name, sectionId: null, context: c, messages: [{ role: "user", content: "Schwächen?" }] }).ok);
}
const huge = { ...stock, sections: stock.sections.map(s => ({ ...s, facts: { ...s.facts, ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`x${i}`, "y".repeat(400)])) } })) };
const fitted = cc.fitChatContextBudget(huge as any);
check("Budget: Übergroßer Kontext wird auf ≤ Budget gekürzt, Auffälligkeiten bleiben", JSON.stringify(fitted).length <= cc.CHAT_CONTEXT_BUDGET && fitted.sections.every(s => typeof s.facts.auffaelligkeiten === "string"));

// ── System-Prompt + Route ──
check("System-Prompt erklärt 'auffaelligkeiten' und verbietet Änderungsvorschläge", /auffaelligkeiten/.test(CHAT_SYSTEM_PROMPT) && /keine Änderungsvorschläge/.test(CHAT_SYSTEM_PROMPT));
let seen = "";
const res = await handleChat({ dashboard: "stock", sectionId: 7, context: stock, messages: [{ role: "user", content: "Welche Schwächen hat das DCF?" }] },
  { llmAvailable: () => true, llm: async (a: any) => { seen = a.prompt; return { data: { answer: "ok", sectionRefs: [7] } } as any; } });
check("Route: Prompt enthält DCF-Fair-Value und Auffälligkeiten der gebundenen Sektion", res.body.ok && seen.includes(String(p7!.fairValue_konservativ)) && seen.includes("auffaelligkeiten"));

check("Kein Score-Einfluss: Aktien-Analyse (inkl. scoring/gates) nach Render, Enrich und handleChat byte-gleich", JSON.stringify(data) === dataBefore);
check("Kein Score-Einfluss: BTC/Gold/Rezession-Daten byte-gleich", JSON.stringify([BTC_FALLBACK_DATA, GOLD_FALLBACK_DATA, RECESSION_FALLBACK_DATA]) === fbBefore);

console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
