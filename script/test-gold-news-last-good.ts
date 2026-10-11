/** JOB 16b: Gold-News – leere/gescheiterte Läufe nie cachen, letzter guter Wert (Disk) mit Stand + Hinweis. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { loadGoldNewsImpact, type GoldNewsCacheEntry } from "../server/gold-news";
import { GoldNewsCard } from "../client/src/components/gold/GoldNewsCard";

let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
const item = { title: "Gold rallies", source: "Reuters", url: "https://x/1", pubDate: "2026-10-11T10:00:00.000Z" };

let store: GoldNewsCacheEntry | null = null;
let lastGood: GoldNewsCacheEntry | null = null;
let feed: any[] = [item];
let llm: any = { flag: 0.35, summary: "Stützend" };
let llmCalls = 0;
const deps = {
  now: 1_000_000,
  llmAvailable: true,
  fetchItems: async () => feed,
  complete: async () => { llmCalls++; if (llm instanceof Error) throw llm; return llm; },
  cacheGet: () => store,
  cacheSet: (e: GoldNewsCacheEntry) => { store = e; },
  lastGoodGet: () => lastGood,
  lastGoodSet: (e: GoldNewsCacheEntry) => { lastGood = e; },
};

const good = await loadGoldNewsImpact(deps);
check("guter Lauf: Flag + gecacht + lastGood", good.flag === 0.35 && store?.flag === 0.35 && lastGood?.flag === 0.35 && !good.lastGood);

// Neustart: In-Memory weg, Disk-lastGood bleibt; Feed leer (Google-Limit)
store = null; feed = [];
const empty = await loadGoldNewsImpact(deps);
check("leerer Feed: nicht gecacht", store === null);
check("leerer Feed: letzter guter Wert statt N/A", empty.flag === 0.35 && empty.lastGood === true && empty.lastGoodReason === "keine Gold-Meldungen" && empty.items.length === 1);

// LLM scheitert
feed = [item]; llm = new Error("timeout");
const failed = await loadGoldNewsImpact(deps);
check("LLM-Fehler: nicht gecacht", store === null);
check("LLM-Fehler: letzter guter Wert", failed.flag === 0.35 && failed.lastGood === true && /OpenRouter fehlgeschlagen/.test(failed.lastGoodReason ?? ""));

// LLM ohne Zahl
llm = { flag: "bullish" };
const junk = await loadGoldNewsImpact(deps);
check("LLM ohne belastbares Flag: nicht gecacht, lastGood", store === null && junk.lastGood === true);

// ohne lastGood: ehrliches N/A
lastGood = null; store = null; feed = [];
const none = await loadGoldNewsImpact(deps);
check("ohne lastGood: N/A, kein erfundener Wert", none.flag === null && !none.lastGood && none.unavailableReason === "keine Gold-Meldungen");

// Wieder gut: neuer Wert ersetzt lastGood, Cache hält 12 h ohne neuen LLM-Call
feed = [item]; llm = { flag: 0.15, summary: "x" };
await loadGoldNewsImpact(deps);
const before = llmCalls; deps.now += 60 * 60 * 1000;
const cached = await loadGoldNewsImpact(deps);
check("gutes Ergebnis 12 h gehalten", cached.flag === 0.15 && llmCalls === before && lastGood?.flag === 0.15);

// Score-Eingang: gleiche News-Eingabe -> gleiches Flag (Score byte-gleich); vollständige Antwort ohne neue Keys
check("vollständige Antwort ohne lastGood-Keys", !("lastGood" in cached) && !("lastGoodReason" in cached));

const html = renderToStaticMarkup(React.createElement(GoldNewsCard, { data: { goldNews: { ...empty, updatedAt: "2026-10-11T18:00:00Z" } } as any }));
check("UI: Hinweis 'Letzter guter Stand' + Stand + Grund", html.includes("gold-news-last-good") && html.includes("Letzter guter Stand vom") && html.includes("keine Gold-Meldungen"));
const normal = renderToStaticMarkup(React.createElement(GoldNewsCard, { data: { goldNews: good } as any }));
check("UI: kein Hinweis bei aktuellem Wert", !normal.includes("gold-news-last-good"));

const src = readFileSync(new URL("../server/gold-news.ts", import.meta.url), "utf8");
check("lastGood auf Disk (überlebt Neustart)", src.includes("diskResearcherSet(LAST_GOOD_KEY, entry)") && src.includes("diskResearcherGetWithTtl(LAST_GOOD_KEY"));
const chart = readFileSync(new URL("../client/src/components/gold/GoldPriceChart.tsx", import.meta.url), "utf8");
check("Sektion-2-Kopf: kurzer Titel + Untertitel (kein Umbruch bei 375 px)", (chart.match(/title="Gold-Preis-Chart" subtitle="Technische Analyse"/g) || []).length === 2);

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
