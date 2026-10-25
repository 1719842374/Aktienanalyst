/**
 * Chat-Kontext-Lücken (DoD #281): Rezession S7/S8, BTC S14, Gold-News-Auswahl, stabile Sektions-IDs.
 * Offline, kein LLM, keine Netzabfrage. Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-context-gaps.ts
 * Kernbeweis: Kontextwert == gerenderter Wert (react-dom/server), Anzeige-Nummern unverändert.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

(globalThis as any).React = React;
let fail = 0, n = 0;
const check = (name: string, ok: boolean, info = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` ${info}`}`); if (!ok) fail++; };

const cc = await import("../shared/chat-context");
const bus = await import("../client/src/lib/chatSectionData");
const { RegionalCatalogSection } = await import("../client/src/components/recession/RegionalCatalogSection");
const { ProbabilityEstimates } = await import("../client/src/components/recession/recessionDashboardPartsB1");
const { Section12Fazit } = await import("../client/src/pages/BTCDashboard");
const { BTC_FALLBACK_DATA } = await import("../client/src/lib/btcFallbackData");
const { RECESSION_FALLBACK_DATA } = await import("../client/src/lib/recessionFallbackData");
const html = (el: any) => renderToStaticMarkup(el);
const S = (c: any, id: number) => c.sections.find((s: any) => s.id === id)?.facts ?? {};

// ── Lücke Rezession S8: Regionale Kataloge ──
const slot = (name: string, available: boolean, ws: number) => ({ id: "curve", name, book: "recession", value: available ? "1.2" : "N/A", rawScore: ws, weight: 1, weightedScore: available ? ws : 0, maxWeighted: available ? 4 : 0, zone: "z", source: "s", available });
const catalogs: any = {
  weights: { US: 0.7, EZ: 0.2, JP: 0.1 },
  regions: [
    { id: "US", label: "USA", weight: 0.7, slots: [slot("a", true, 2)], recessionProbability: 60, correctionProbability: 55 },
    { id: "EZ", label: "Eurozone", weight: 0.2, slots: [slot("k", true, -4)], recessionProbability: 50, correctionProbability: 45 },
    { id: "JP", label: "Japan", weight: 0.1, slots: [slot("y", false, 0)], recessionProbability: 75, correctionProbability: null },
  ],
  blendedRecession12m: 60, blendedCorrection12m: 50, actionUsesUsBooks: true,
};
const hReg = html(React.createElement(RegionalCatalogSection, { catalogs }));
const rec = cc.buildRecessionChatContext(RECESSION_FALLBACK_DATA, { hasRegions: true, regions: catalogs });
const s8 = S(rec, 8);
check("S8: Sektion 8 = regionen (mit Regionen)", rec.sections.find((s: any) => s.id === 8)?.key === "regionen");
check("S8: Regionswerte wie Kachel (60%/55%/×0.70)", /Katalog Rez\. 60%, Katalog Korr\. 55%, Gewicht ×0\.70/.test(String(s8.region_US)) && hReg.includes("60%") && hReg.includes("×0.70"), String(s8.region_US));
check("S8: fehlender Wert = n/a (Anzeige N/A)", /Katalog Korr\. n\/a/.test(String(s8.region_JP)) && hReg.includes("N/A"));
check("S8: Slot-Score wie Anzeige (+2/4, -4/4, —/0)", /a: 1\.2 \| z \| Score \+2\/4/.test(String(s8.slots_US)) && /Score -4\/4/.test(String(s8.slots_EZ)) && /Score —\/0/.test(String(s8.slots_JP)) && hReg.includes("+2"));
check("S8: Mischung + Gewichte wie Anzeige", s8.gewichteteRezession12MPct === 60 && s8.gewichteteKorrektur12MPct === 50 && s8.gewichte === "US 0.70 / EZ 0.20 / JP 0.10" && hReg.includes("US 0.70 / EZ 0.20 / JP 0.10"));
check("S8: kein Hinweis statt Werten mehr", s8.hinweis === undefined);
const recNo = cc.buildRecessionChatContext(RECESSION_FALLBACK_DATA, { hasRegions: false });
check("ohne Regionen: keine S8-Regionen-Sektion", !recNo.sections.some((s: any) => s.key === "regionen"));

// ── Lücke Rezession S7: NY-Fed-Anker/final nur, wo die Formel sie hat ──
const subs: any[] = (RECESSION_FALLBACK_DATA as any).subgroups;
const hP = html(React.createElement(ProbabilityEstimates, { subgroups: subs }));
const s7 = S(rec, 7);
const full = String(s7.recession_full);
check("S7: recession_full trägt NY-Fed-Anker und final (wie Formel, 1 Nachkommastelle)", /NY-Fed-Anker 0\.5%, final 25%/.test(full), full);
const others = subs.filter(s => s.name !== "recession_full").map(s => String(s7[s.name]));
check("S7: übrige Gruppen ohne 'final n/a%, NY-Fed-Anker n/a'", others.length >= 4 && others.every(v => !/NY-Fed-Anker|final n\/a/.test(v)), others[0]);
check("S7: P und Formel wie angezeigt", subs.every(s => String(s7[s.name]).startsWith(`P ${s.probability}%`) && hP.includes(`${s.probability}%`) && (!s.formula || String(s7[s.name]).includes(s.formula.slice(0, 40)))));
check("S7: Datenbefund – Server liefert Anker nur für recession_full", subs.filter(s => typeof s.nyFedAnchor === "number").map(s => s.name).join() === "recession_full");

// ── Lücke BTC S14: Gesamt-Fazit ──
bus.resetChatSectionData();
const hF = html(React.createElement(Section12Fazit, { data: BTC_FALLBACK_DATA as any }));
const f14 = bus.readChatSectionData("btc")["14"];
check("BTC S14: veröffentlicht", !!f14);
check("BTC S14: Gesamtbewertung == Anzeige", !!f14 && hF.includes(`Gesamtbewertung: ${f14.gesamtbewertung}`), String(f14?.gesamtbewertung));
check("BTC S14: Kopfzeile == Anzeige", !!f14 && hF.includes(String(f14.kopfzeile).replace(/&/g, "&amp;")), String(f14?.kopfzeile));
check("BTC S14: Blockzeilen == Anzeige", !!f14 && typeof f14["Zyklus-Einordnung"] === "string" && hF.includes(String(f14["Zyklus-Einordnung"]).split(". ")[0]));
const btc = cc.enrichChatContext(cc.buildBtcChatContext(BTC_FALLBACK_DATA), bus.readChatSectionData("btc"));
check("BTC S14: im Kontext, Hinweis entfernt, 'ausblick' bleibt", S(btc, 14).gesamtbewertung === f14?.gesamtbewertung && S(btc, 14).hinweis === undefined && "ausblick" in S(btc, 14));

// ── Lücke Gold-News "100." ──
const news = { id: 100, label: "Gold-News", display: "📰" };
check("Gold-News: Auswahl-Präfix '📰' statt '100.'", cc.chatSectionTag(news) === "📰" && cc.chatSectionName(news) === "Gold-News");
check("übrige Sektionen: Auswahltext byte-gleich '7. Label'", `${cc.chatSectionTag({ id: 7, label: "DCF" })} DCF` === "7. DCF" && cc.chatSectionName({ id: 7, label: "DCF" }) === "7 (DCF)");
check("Bindung ohne key = Nummer (Aktie/BTC/Gold unverändert)", cc.chatSectionKey({ id: 13, label: "x" }) === "13");

// ── Stabile IDs (Rezession, #284) ──
// #284: TA nach Marktcharts → ab TA +1 gegenüber den Formeln vor #284.
const old = (r: boolean, f: boolean) => ({ rsi: r ? 9 : 8, markt: r ? 10 : 9, ta: r ? 11 : 10, buffett: r ? 12 : 11, summary: r ? 13 : 12, ...(f ? { fazit: r ? 14 : 13 } : {}), quellen: r ? (f ? 15 : 14) : (f ? 14 : 13) });
let same = true;
for (const r of [false, true]) for (const f of [false, true]) {
  const nr = cc.recessionSectionNumbers(r, f);
  for (const [k, v] of Object.entries(old(r, f))) if (nr[k] !== v) same = false;
  if (r && nr.regionen !== 8) same = false;
  if (!f && "fazit" in nr) same = false;
}
check("Anzeige-Nummern == Formeln inkl. TA (#284, 4 Kombinationen)", same);
const withTa = [...cc.RECESSION_SECTION_DEFS];
if (!withTa.some(d => d.key === "ta")) withTa.splice(withTa.findIndex(d => d.key === "markt") + 1, 0, { key: "ta", label: "Technische Analyse" }); // #284: bereits in den DEFS
const nrTa = Object.fromEntries(withTa.filter(d => d.when !== "fazit").map((d, i) => [d.key, i + 1]));
check("#284-Simulation: TA = 11, Buffett 12, Quellen 15 (mit Regionen+Fazit)", Object.fromEntries(withTa.map((d, i) => [d.key, i + 1])).ta === 11 && Object.fromEntries(withTa.map((d, i) => [d.key, i + 1])).buffett === 12 && withTa.length === 15);
check("Schlüssel stabil, nur Nummer verschiebt sich", nrTa.buffett === cc.recessionSectionNumbers(false, false).buffett + 1 && nrTa.buffett === 12 && withTa.some(d => d.key === "buffett"));
check("Rezession-Kontext trägt key je Sektion", rec.sections.every((s: any) => typeof s.key === "string"));
// Widget-Bindung über key: nach Umnummerierung zeigt dieselbe Bindung auf dieselbe Sektion.
const before = rec.sections.map((s: any) => ({ id: s.id, label: s.label, key: s.key }));
const after = before.map((s: any) => ({ ...s, id: s.id >= 11 ? s.id + 1 : s.id }));
const boundKey = cc.chatSectionKey(before.find((s: any) => s.key === "buffett")!);
check("Bindung 'buffett' überlebt Umnummerierung", after.find((s: any) => cc.chatSectionKey(s) === boundKey)?.label === "Buffett-Indikator");

console.log(fail ? `${fail}/${n} Checks rot` : `${n}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
