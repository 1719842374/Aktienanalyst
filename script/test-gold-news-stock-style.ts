/**
 * JOB 14: Gold-News an zweiter Stelle, im Stil der Aktien-News (gemeinsame SentimentNewsList).
 * Prüft: Anreicherung (Keyword-Sentiment, Sprache, kein erfundenes lang), Karte (Zähler, Pills,
 * Punkt, Sprach-Chip, relative Zeit, Score-Badge, Pfeil, n/a), Reihenfolge im Dashboard,
 * Section2 nutzt dieselbe Komponente, und das News-Flag bleibt der einzige Score-Eingang.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { enrichGoldNewsItems } from "../server/gold-news";
import { GoldNewsCard } from "../client/src/components/gold/GoldNewsCard";
import { relativeTimeDe, newsSentimentCounts } from "../client/src/components/news/SentimentNewsList";

let fail = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${name}`); if (!ok) fail++; };
const NOW = Date.parse("2026-10-11T20:00:00Z");

const raw = [
  { title: "Gold surges to record high", source: "Reuters", url: "https://x/1", pubDate: "2026-10-11T16:00:00Z", lang: "en" as const },
  { title: "Gold slumps on strong jobs data warning", source: "Kitco", url: "https://x/2", pubDate: "2026-10-10T10:00:00Z", lang: "en" as const },
  { title: "Central bank buying update", source: "", url: "", pubDate: "" },
];
const enriched = enrichGoldNewsItems(raw as any);
check("Keyword-Sentiment je Meldung", enriched[0].sentiment === "bullish" && enriched[0].sentimentScore === 1 && enriched[0].sentimentSource === "keyword");
check("bearish erkannt", enriched[1].sentiment === "bearish");
check("fehlende Sprache bleibt null (n/a), nicht geraten", enriched[2].lang === null);
check("Titel/URL/Datum unverändert", enriched.every((e, i) => e.title === raw[i].title && e.url === raw[i].url && e.pubDate === raw[i].pubDate));

check("relative Zeit 'vor 4 Std.'", relativeTimeDe("2026-10-11T16:00:00Z", NOW) === "vor 4 Std.");
check("relative Zeit 'gestern'", relativeTimeDe("2026-10-10T10:00:00Z", NOW) === "gestern");
check("ohne Datum null", relativeTimeDe("", NOW) === null && relativeTimeDe("kaputt", NOW) === null);
check("Zähler bullish/bearish/neutral", JSON.stringify(newsSentimentCounts(enriched.map(e => ({ ...e })) as any)).includes('"bullish":1,"bearish":1,"neutral":1'));

const goldNews = { flag: 0.4, summary: "Realzinsen fallen.", updatedAt: "2026-10-11T18:00:00Z", llmAvailable: true, unavailableReason: null, items: enriched, cacheTtlHours: 12 };
const html = renderToStaticMarkup(React.createElement(GoldNewsCard, { data: { goldNews } as any, now: NOW }));
check("Kopf mit Zähler (3)", html.includes("Gold-News") && /\((<!-- -->)?3(<!-- -->)?\)/.test(html));
check("Pills ▲/▼/●", /▲ (<!-- -->)?1(<!-- -->)? bullish/.test(html) && /▼ (<!-- -->)?1(<!-- -->)? bearish/.test(html) && /● (<!-- -->)?1(<!-- -->)? neutral/.test(html));
check("farbiger Punkt + Titel", html.includes("bg-emerald-400") && html.includes("text-emerald-300/90") && html.includes("text-red-300/90"));
check("Sprach-Chip EN", />en</.test(html));
check("relative Zeit gerendert", html.includes("vor 4 Std.") && html.includes("gestern"));
check("Score-Badge +100/-50", html.includes(">+100<") && html.includes(">-50<"));
check("Link-Pfeil", (html.match(/↗/g) || []).length === 3);
check("fehlende Felder als n/a", (html.match(/>n\/a</g) || []).length >= 3);
check("Flag, Summary, Stand/Cache bleiben", html.includes("Flag +0.40 bullish") && html.includes("Realzinsen fallen.") && html.includes("Cache 12 h") && html.includes("gold-news-stand"));
const empty = renderToStaticMarkup(React.createElement(GoldNewsCard, { data: {} as any }));
check("ohne Daten: Flag N/A, keine Meldungen", empty.includes("Flag N/A") && empty.includes("Keine Gold-Meldungen"));

const dash = readFileSync(new URL("../client/src/pages/GoldDashboard.tsx", import.meta.url), "utf8");
const iPrice = dash.indexOf("<GoldPriceSection data={data} />"), iNews = dash.indexOf("<GoldNewsCard data={data} />"), iChart = dash.indexOf("<GoldPriceChart data={data} />");
check("Dashboard: News an zweiter Stelle", iPrice > 0 && iPrice < iNews && iNews < iChart && dash.split("<GoldNewsCard").length === 2);
const s2 = readFileSync(new URL("../client/src/components/sections/Section2.tsx", import.meta.url), "utf8");
check("Section2 nutzt dieselbe SentimentNewsList", s2.includes('from "../news/SentimentNewsList"') && s2.includes("<SentimentNewsList items={data.newsItems} />"));

const routes = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
check("Score-Eingang bleibt nur goldNews.flag", routes.includes("newsFlag: goldNews?.flag ?? null") && !/goldNews\??\.items/.test(routes));
const newsSrc = readFileSync(new URL("../server/gold-news.ts", import.meta.url), "utf8");
check("LLM-Prompt bekommt weiter nur Titel", newsSrc.includes("deps.complete(items.slice(0, 8).map(item => item.title))"));

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
