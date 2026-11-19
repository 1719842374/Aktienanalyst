/**
 * F1-47 / F1-48 / F1-52 — fünf Untergruppen je Region, Tabelle und Heatmap folgen der Region.
 * US-P der fünf Untergruppen bleibt byte-gleich. Geschlossene Slots sind „n/a — Grund“, nie 0.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-region-subgroups-f1-52.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, findByTestId, reactPropsOf, FakeElement, type FakeElement as FakeElementType } from "./lib/fake-dom";
import { probabilityFromNet, anchoredRecessionProbability } from "../server/recession";
import {
  emptyRegionalPrints,
  scoreRegionalCatalogs,
  type RegionScorers,
} from "../server/recession-regions";
import {
  bookProbability,
  buildRegionSubgroups,
  regionScoreRows,
  type RegionSlot,
  type RegionSlotId,
} from "../shared/recession-regions";
import { RECESSION_FALLBACK_DATA } from "../client/src/lib/recessionFallbackData";

(globalThis as any).React = React;

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Oracle der US-Formel, unabhängig von probabilityFromNet geschrieben. */
function oracleP(net: number, max: number): number {
  const raw = !(max > 0) || !Number.isFinite(net) ? 50 : 50 + (net / max) * 50;
  const clamped = Math.max(5, Math.min(95, raw));
  return Math.round(clamped / 5) * 5;
}

function slot(id: RegionSlotId, name: string, book: RegionSlot["book"], weighted: number, max: number, available = true, extra: Partial<RegionSlot> = {}): RegionSlot {
  return {
    id,
    name,
    book,
    value: available ? String(weighted) : "N/A",
    rawScore: available ? weighted : 0,
    weight: available ? 1 : 0,
    weightedScore: available ? weighted : 0,
    maxWeighted: available ? max : 0,
    zone: available ? "gelesen" : "N/A",
    source: extra.source ?? `${name} Quelle`,
    available,
    ...extra,
  };
}

console.log("\n=== US-P der 5 Untergruppen, Vorher (Fallback) = Nachher (Formel) ===");
{
  const subs = (RECESSION_FALLBACK_DATA as { subgroups: Array<{ name: string; netScore: number; maxScore: number; probability: number; nyFedAnchor?: number }> }).subgroups;
  const before = subs.map(s => s.probability).join("|");
  check("Vorher-String der Fallback-P", before === "15|25|25|60|75", before);
  const afterParts = subs.map(s => {
    if (s.name === "recession_full") {
      return anchoredRecessionProbability(s.netScore, s.maxScore, s.nyFedAnchor ?? null).probability;
    }
    return probabilityFromNet(s.netScore, s.maxScore);
  });
  const after = afterParts.join("|");
  check("Nachher byte-gleich zum Vorher-String", after === before, `${before} vs ${after}`);
  for (const s of subs) {
    if (s.name === "recession_full") continue;
    check(`${s.name} probabilityFromNet = Oracle`, probabilityFromNet(s.netScore, s.maxScore) === oracleP(s.netScore, s.maxScore), `${s.netScore}/${s.maxScore}`);
  }
}

console.log("\n=== EZ/JP: fünf Untergruppen, N/A zählt nicht ===");
{
  const ezSlots: RegionSlot[] = [
    slot("labor", "ALQ Eurozone", "recession", -3, 4),
    slot("curve", "Kurve EZ", "recession", 1, 4),
    slot("activity", "Aktivität EZ", "recession", -2, 3),
    slot("money", "Geld EZ M3", "recession", 0, 3),
    slot("spreads", "Spreads EZ HY", "recession", 9, 5, false, { weightedScore: 9, maxWeighted: 5, source: "FRED BAMLHE00EHYIOAS" }),
    slot("valuation", "STOXX 600 PE", "correction", 4, 6, false, { source: "STOXX 600 PE (FMP leer, iShares ohne KGV)" }),
    slot("vol", "VSTOXX", "correction", 2, 4),
  ];
  const groups = buildRegionSubgroups(ezSlots);
  check("fünf Untergruppen", groups.map(g => g.name).join("|") === "recession_coincident|recession_leading|recession_full|correction_sentiment|correction_full", groups.map(g => g.name).join("|"));
  const coincident = groups[0];
  check("3M-Netz nur gewertete Slots (−4/11)", coincident.netScore === -4 && coincident.maxScore === 11 && coincident.probability === 30, `${coincident.netScore}/${coincident.maxScore}/${coincident.probability}`);
  const leading = groups[1];
  check("6M nimmt M2-Null mit, den geschlossenen Spread nicht (−4/14 → 35)", leading.netScore === -4 && leading.maxScore === 14 && leading.probability === 35, `${leading.netScore}/${leading.maxScore}/${leading.probability}`);
  check("geschlossener Spread steht als fehlend, nicht im Indikator-Namen", leading.missing.some(m => m.name === "Spreads EZ HY" && m.reason.includes("BAMLHE00EHYIOAS")) && !leading.indicators.includes("Spreads EZ HY"));
  check("Durable Goods fehlt mit Grund und ohne Score", leading.missing.some(m => m.name === "Durable Goods" && m.reason.includes("keine regionale Serie")));
  const full = groups[2];
  check("12M ohne Konsumklima-Serie bleibt auf dem Leading-Netz, kein NY-Fed-Anker", full.netScore === -4 && full.maxScore === 14 && full.probability === 35 && full.nyFedAnchor == null && full.missing.some(m => m.name === "Konsumklima"));
  const sentiment = groups[3];
  check("Sentiment ist der Vol-Slot (2/4 → 75)", sentiment.netScore === 2 && sentiment.maxScore === 4 && sentiment.probability === 75);
  const corr = groups[4];
  check("Korrektur 12M ohne PE bleibt beim Sentiment-Netz", corr.netScore === 2 && corr.maxScore === 4 && corr.probability === 75 && corr.missing.some(m => m.name === "STOXX 600 PE"));

  const rows = regionScoreRows(ezSlots);
  const spreadRow = rows.find(row => row.name === "Spreads EZ HY");
  const moneyRow = rows.find(row => row.name === "Geld EZ M3");
  const durableRow = rows.find(row => row.name === "Durable Goods");
  check("geschlossener Spread ist n/a — Grund, Heatmap ohne 0", !!spreadRow && spreadRow.valueText.startsWith("n/a — ") && spreadRow.weightedText === "n/a" && spreadRow.heatScore == null && !spreadRow.valueText.includes("+9") && spreadRow.valueText.includes("BAMLHE00EHYIOAS"), spreadRow?.valueText);
  check("echter M2-Score 0 bleibt 0", moneyRow?.weightedText === "0" && moneyRow.heatScore === 0 && !moneyRow.valueText.startsWith("n/a"), moneyRow?.weightedText);
  check("Durable-Zeile ist n/a — Grund", !!durableRow && durableRow.valueText.startsWith("n/a — ") && durableRow.heatScore == null, durableRow?.valueText);

  const empty = buildRegionSubgroups([
    slot("vol", "JNVI", "correction", 0, 0, false, { source: "JNVI (keine freie Serie)" }),
    slot("valuation", "TOPIX/CAPE JP", "correction", 0, 0, false, { source: "TOPIX/CAPE JP (FMP leer; JPX-PER nur xlsx)" }),
  ]);
  const emptySent = empty.find(g => g.name === "correction_sentiment")!;
  const emptyFull = empty.find(g => g.name === "correction_full")!;
  check("leere Korrektur ist null, nicht 0 und nicht 50", emptySent.probability == null && emptyFull.probability == null && emptySent.formula.includes("n/a") && !emptySent.formula.includes("50%") && !emptySent.formula.includes("0%"), `${emptySent.probability} ${emptySent.formula}`);
}

console.log("\n=== Katalog hängt die US-Live-P byte-gleich an, Blend bleibt ===");
{
  const live = (RECESSION_FALLBACK_DATA as { subgroups: Array<Record<string, unknown>> }).subgroups.map(s => ({
    name: String(s.name),
    label: String(s.label),
    horizon: String(s.horizon),
    indicators: s.indicators as string[],
    netScore: s.netScore as number,
    maxScore: s.maxScore as number,
    probability: s.probability as number,
    formula: String(s.formula),
    nyFedAnchor: s.nyFedAnchor as number | undefined,
    finalProbability: s.finalProbability as number | undefined,
  }));
  const before = JSON.stringify(live.map(s => [s.name, s.probability, s.netScore, s.maxScore, s.formula, s.nyFedAnchor ?? null, s.finalProbability ?? null]));
  const scorers: RegionScorers = {
    money: () => ({ value: "0", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 3, zone: "n", available: false }),
    credit: () => ({ value: "0", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 3, zone: "n", available: false }),
    vol: () => ({ value: "0", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 3, zone: "n", available: false }),
    valuation: () => ({ value: "0", rawScore: 0, weight: 1, weightedScore: 0, maxWeighted: 3, zone: "n", available: false }),
    activity: () => ({ rawScore: 0, zone: "n" }),
    curve: () => ({ available: false, raw: 0 }),
  };
  const catalog = scoreRegionalCatalogs({
    prints: emptyRegionalPrints(),
    usSlots: [],
    usRecession12m: live.find(s => s.name === "recession_full")!.probability,
    usCorrection12m: live.find(s => s.name === "correction_full")!.probability,
    today: "2026-10-04",
    scorers,
    usLiveSubgroups: live,
  });
  const us = catalog.regions.find(region => region.id === "US")!;
  const after = JSON.stringify((us.subgroups ?? []).map(s => [s.name, s.probability, s.netScore, s.maxScore, s.formula, s.nyFedAnchor ?? null, s.finalProbability ?? null]));
  check("US-Untergruppen byte-gleich", after === before, after);
  check("Blend bleibt die übergebenen US-Bücher", catalog.blendedRecession12m === 25 && catalog.blendedCorrection12m === 75, `${catalog.blendedRecession12m}/${catalog.blendedCorrection12m}`);
  check("Handlungsflag bleibt true", catalog.actionUsesUsBooks === true);
  const ez = catalog.regions.find(region => region.id === "EZ")!;
  check("leere EZ-Rezession ist null, nicht die US-P", (ez.subgroups ?? []).find(s => s.name === "recession_coincident")?.probability == null);
  check("Katalog-P der leeren Bücher bleibt null", ez.recessionProbability == null && bookProbability(0, 0) == null);
  const regionsSrc = readFileSync(new URL("../server/recession-regions.ts", import.meta.url), "utf8");
  check("Regionen-Modul importiert die US-Datei nicht", !/from\s+["']\.\/recession["']/.test(regionsSrc));
  const analyze = readFileSync(new URL("../server/analyze-route.ts", import.meta.url), "utf8");
  check("analyze-route.ts unangetastet im Arbeitsbaum", !analyze.includes("buildRegionSubgroups") && !analyze.includes("usLiveSubgroups"));
}

console.log("\n=== Anzeige: US-Gauges bleiben, EZ zeigt fünf und n/a ===");
{
  installFakeDom();
  globalThis.fetch = (async () => new Response("{}", { status: 404 })) as typeof fetch;
  FakeElement.prototype.getElementsByClassName = function getElementsByClassName() { return []; };
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const dash = await import("../client/src/pages/RecessionDashboard");
  const regionsMod = await import("../server/recession-regions");
  const { capeReading, creditReading, durableReading, m2Reading, scoreSeriesStress, vixReading } = await import("../server/recession");

  const scorers: RegionScorers = {
    money: yoy => m2Reading(yoy),
    credit: spread => creditReading(spread),
    vol: level => vixReading(level),
    valuation: ratio => capeReading(ratio),
    activity: yoy => {
      const reading = durableReading(yoy);
      return { rawScore: reading.rawScore, zone: reading.zone };
    },
    curve: (levels, stressWhenLow) => {
      const scored = scoreSeriesStress(stressWhenLow ? levels.map(value => -value) : levels);
      return { available: scored.available, raw: scored.raw };
    },
  };
  const live = (RECESSION_FALLBACK_DATA as { subgroups: any[] }).subgroups;
  const catalogs = regionsMod.scoreRegionalCatalogs({
    prints: {
      ...regionsMod.emptyRegionalPrints(),
      jpVol: null,
    },
    usSlots: [],
    usRecession12m: 25,
    usCorrection12m: 75,
    today: "2026-10-04",
    scorers,
    usLiveSubgroups: live,
  });
  const data = { ...RECESSION_FALLBACK_DATA, regions: catalogs };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, refetchInterval: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(dash.RecessionSectionsBody, { data, regions: catalogs })));
  });

  const usHtml = findByTestId(container, "grid-current-assessment")?.textContent ?? "";
  const beforeGauge = live.map((s: { probability: number }) => `${s.probability}%`).join("|");
  check("US-Default zeigt die fünf Live-P", live.every((s: { probability: number }) => usHtml.includes(`${s.probability}%`)), usHtml.slice(0, 180));
  check("US-Start zeigt keine EZ-Katalog-Gauges", findByTestId(container, "region-gauges-EZ") == null);

  const click = async (id: string) => {
    const btn = findByTestId(container, id) as FakeElementType | null;
    await act(async () => { reactPropsOf(btn)?.onClick?.({}); });
  };
  await click("region-btn-EZ");
  const ezGauges = findByTestId(container, "region-gauges-EZ");
  const ezText = ezGauges?.textContent ?? "";
  const ezGroups = catalogs.regions.find(region => region.id === "EZ")!.subgroups ?? [];
  check("Europa zeigt fünf Gauges", ezGroups.length === 5 && ezGroups.every(g => ezText.includes(g.label)), ezText.slice(0, 240));
  check("Europa-Gauge ohne Druck ist n/a, nicht 0%", ezGroups.filter(g => g.probability == null).every(g => ezText.includes("n/a")) && !/\b0%/.test(ezText), ezText);
  const table = findByTestId(container, "region-score-table-EZ");
  const tableText = table?.textContent ?? "";
  check("Sektion 5 folgt EZ und nennt n/a — Grund", tableText.includes("n/a — ") && tableText.includes("Eurostat"), tableText.slice(0, 300));
  const heat = findByTestId(container, "region-heatmap-EZ");
  check("Heatmap folgt EZ und malt fehlende Slots nicht als +0", (heat?.textContent ?? "").includes("n/a") && !(heat?.textContent ?? "").includes("+0"), heat?.textContent?.slice(0, 200));
  const overview = findByTestId(container, "region-subgroups-EZ");
  check("Sektion 6 folgt EZ", (overview?.textContent ?? "").includes("Rezession Coincident") && (overview?.textContent ?? "").includes("n/a"));

  await click("region-btn-US");
  const usAfter = findByTestId(container, "grid-current-assessment")?.textContent ?? "";
  const afterGauge = live.map((s: { probability: number }) => `${s.probability}%`).filter((token: string) => usAfter.includes(token)).join("|");
  check("Nach der Rückkehr sind die US-P dieselben", usAfter === usHtml && afterGauge === beforeGauge, `${beforeGauge} vs ${afterGauge}`);
  check("US-Tabelle ist wieder die Indikatoren-Tabelle", findByTestId(container, "region-score-table-EZ") == null && (findByTestId(container, "section-5")?.textContent ?? "").includes("Sahm"));
  await act(async () => { root.unmount(); });
  qc.clear();
  qc.unmount();
}

console.log(`\n${total - failed}/${total} passed`);
if (failed > 0) process.exit(1);
