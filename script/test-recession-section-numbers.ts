/**
 * #284 HOLD (Doublecheck), auf RECESSION_SECTION_DEFS (#290): Rezessions-Dashboard rendert die Technische Analyse als eigene Sektion; Buffett, Zusammenfassung,
 * Fazit und Quellen rücken um 1. Die Chat-Bindung (#281) nummeriert über recessionSectionLayout. Beides muss übereinstimmen,
 * sonst zeigen sectionRefs / Sprung (data-testid="section-N") still auf die falsche Sektion.
 *
 * Prüft für alle 4 Varianten (Regionen ja/nein × Fazit ja/nein):
 *  - SSR-gerenderte data-testid="section-N" (Reihenfolge + Titel) == recessionSectionLayout == buildRecessionChatContext().sections
 *  - "Technische Analyse" steht direkt nach "Marktcharts" und vor "Buffett-Indikator".
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-section-numbers.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { recessionSectionLayout, buildRecessionChatContext } from "../shared/chat-context";
import type { RegionSlot, RegionalCatalogs } from "../shared/recession-regions";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";

(globalThis as any).React = React;
globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
const { RecessionSectionsBody } = await import("../client/src/pages/RecessionDashboard");
const { ThemeProvider } = await import("../client/src/components/ThemeProvider").catch(() => ({ ThemeProvider: null as any }));

const slot = (name: string): RegionSlot => ({ id: "curve", name, book: "recession", value: "1", rawScore: 1, weight: 1, weightedScore: 1, maxWeighted: 4, zone: "z", source: "s", available: true });
const catalogs: RegionalCatalogs = {
  weights: { US: 0.7, EZ: 0.2, JP: 0.1 },
  regions: [
    { id: "US", label: "USA", weight: 0.7, slots: [slot("a")], recessionProbability: 60, correctionProbability: 55 },
    { id: "EZ", label: "Eurozone", weight: 0.2, slots: [slot("k")], recessionProbability: 50, correctionProbability: 45 },
    { id: "JP", label: "Japan", weight: 0.1, slots: [slot("x")], recessionProbability: 75, correctionProbability: null },
  ],
  blendedRecession12m: 60, blendedCorrection12m: 50, actionUsesUsBooks: true,
};

// Titel-Stichwort je Layout-Key (UI-Titel weichen teils vom Chat-Label ab, z.B. „Regionale Kataloge (US / Eurozone / Japan)“).
const TITLE: Record<string, RegExp> = {
  bewertung: /Aktuelle Bewertung/, nyfed: /NY Fed/, regeln: /Scoring-Regeln/, zonen: /Scoring-Zonen/, indikatoren: /Indikatoren-Tabelle/,
  untergruppen: /Score-Übersicht/, prozent: /Prozentschätzungen/, regionen: /Regionale Kataloge/, rsi: /RSI/, markt: /Märkte|Markt/,
  ta: /Technische Analyse/, buffett: /Buffett/, summary: /Zusammenfassung/, fazit: /Fazit/, quellen: /Quellenliste/,
};

let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) fail++; };

for (const hasRegions of [false, true]) for (const hasFazit of [false, true]) {
  const tag = `Regionen ${hasRegions ? "ja" : "nein"} / Fazit ${hasFazit ? "ja" : "nein"}`;
  const data: any = { ...RECESSION_FALLBACK_DATA, fazit: hasFazit ? (RECESSION_FALLBACK_DATA as any).fazit : undefined };
  const regions = hasRegions ? catalogs : null;
  let html = "";
  try {
    const el = React.createElement(RecessionSectionsBody as any, { data, regions });
    const inner = React.createElement(QueryClientProvider, { client: new QueryClient() }, ThemeProvider ? React.createElement(ThemeProvider, null, el) : el);
    html = renderToStaticMarkup(React.createElement(Router, { ssrPath: "/recession" }, inner));
  } catch (e: any) { check(`${tag}: SSR-Render`, false, e?.message); continue; }
  // Top-Level-SectionCards: data-testid="section-N" + erster Titel danach
  const rendered = [...html.matchAll(/data-testid="section-(\d+)"(?:(?!data-testid="section-\d+").)*?<h\d[^>]*>((?:(?!<\/h\d>).)*)<\/h\d>/gs)]
    .map(m => ({ id: Number(m[1]), title: m[2].replace(/<[^>]+>/g, "").replace(/<!-- -->/g, "") }));
  const layout = recessionSectionLayout(hasRegions, hasFazit);
  const chat = buildRecessionChatContext(data, { hasRegions }).sections.map(s => ({ id: s.id, label: s.label }));
  check(`${tag}: UI-Nummern == Layout-IDs`, JSON.stringify(rendered.map(r => r.id)) === JSON.stringify(layout.map(l => l.id)),
    `UI ${rendered.map(r => r.id).join(",")} | Layout ${layout.map(l => l.id).join(",")}`);
  check(`${tag}: Chat-Sektionen == Layout`, JSON.stringify(chat) === JSON.stringify(layout.map(l => ({ id: l.id, label: l.label }))));
  const mism = layout.filter(l => { const r = rendered.find(x => x.id === l.id); return !r || !TITLE[l.key].test(r.title); })
    .map(l => `S${l.id} ${l.key}≠„${rendered.find(x => x.id === l.id)?.title ?? "fehlt"}“`);
  check(`${tag}: jede Layout-Nummer zeigt in der UI auf die passende Sektion`, mism.length === 0, mism.join("; "));
  const keys = layout.map(l => l.key);
  if (hasRegions && hasFazit) {
    const at = (k: string) => rendered.find(r => TITLE[k].test(r.title))?.id;
    check(`${tag}: gerendert TA 11, Buffett 12, Quellen 15`, at("ta") === 11 && at("buffett") === 12 && at("quellen") === 15, `TA ${at("ta")} Buffett ${at("buffett")} Quellen ${at("quellen")}`);
  }
  check(`${tag}: TA direkt nach Marktcharts, vor Buffett`, keys.indexOf("ta") === keys.indexOf("markt") + 1 && keys.indexOf("buffett") === keys.indexOf("ta") + 1);
}
console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
