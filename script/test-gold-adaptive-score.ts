/**
 * Future_10 §2–§3, §8–§10. Ohne Netzwerk.
 * Ausführen: npx tsx script/test-gold-adaptive-score.ts
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GOLD_ADAPTIVE_BASE_WEIGHTS,
  GOLD_EFFECTIVE_WEIGHT,
  GOLD_HABITAT,
  ATR_WINDOW,
  BOLLINGER_WINDOW,
  FISCAL_GROWTH_LAG,
  FISCAL_SERIES_ID,
  VOLUME_SPIKE_MULTIPLE,
  adaptiveZ,
  aggregateAdaptiveLayers,
  aiscStepsForAdaptive,
  effectiveWeight,
  habitatMultipliers,
  goldScoreDelta,
  percentileRank,
  scoreGoldAdaptive,
  volumeReadingsAreReal,
  type GoldAdaptiveInput,
} from "../server/gold-adaptive-score";
import { loadGoldAiscSeries } from "../server/gold-aisc";
import type { GoldAiscQuarterStep, GoldAiscSeries } from "../shared/schema";
import {
  FED_GOLD_PATTERN,
  GOLD_NEWS_CACHE_HOURS,
  interpretGoldNewsLlm,
  loadGoldNewsImpact,
  parseGoldRssItems,
  type GoldNewsCacheEntry,
} from "../server/gold-news";
import { GoldAdaptiveLayersCard } from "../client/src/components/gold/GoldAdaptiveLayersCard";
import { GoldAdaptiveGatesCard } from "../client/src/components/gold/GoldAdaptiveGatesCard";
import { GoldNewsCard } from "../client/src/components/gold/GoldNewsCard";
import type { GoldAdaptiveLayer } from "../shared/gold-schema";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function day(index: number): string {
  const date = new Date(Date.UTC(2020, 0, 1));
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
}

function month(index: number): string {
  const date = new Date(Date.UTC(2018, 0, 1));
  date.setUTCMonth(date.getUTCMonth() + index);
  return date.toISOString().slice(0, 10);
}

function baseInput(over: Partial<GoldAdaptiveInput> = {}): GoldAdaptiveInput {
  return {
    closes: [],
    volumes: null,
    volumeSource: null,
    real10Y: [],
    fedFunds: [],
    m2: [],
    walcl: [],
    tga: null,
    rrpBillions: null,
    breakeven: [],
    dxy: [],
    aisc: null,
    regime: null,
    newsFlag: null,
    now: "2026-10-11T00:00:00.000Z",
    ...over,
  };
}

function signal(score: ReturnType<typeof scoreGoldAdaptive>, layerId: string, signalId: string) {
  const layer = score.layers.find(item => item.id === layerId);
  return layer?.signals.find(item => item.id === signalId) ?? null;
}

console.log("\nGewichte, Habitat, effectiveWeight");
{
  check("Real Yield Basis 1.8", GOLD_ADAPTIVE_BASE_WEIGHTS.realYield === 1.8);
  check("Policy Basis 1.3", GOLD_ADAPTIVE_BASE_WEIGHTS.policy === 1.3);
  check("Liquidität Basis 1.2", GOLD_ADAPTIVE_BASE_WEIGHTS.liquidity === 1.2);
  check("Inflation Basis 0.8", GOLD_ADAPTIVE_BASE_WEIGHTS.inflation === 0.8);
  check("Angebot Basis 0.9", GOLD_ADAPTIVE_BASE_WEIGHTS.supply === 0.9);
  check("Technik Basis 1.0", GOLD_ADAPTIVE_BASE_WEIGHTS.technical === 1.0);
  check("Makro Basis 0.9", GOLD_ADAPTIVE_BASE_WEIGHTS.macro === 0.9);
  check(
    "effectiveWeight = base × habitat × (0.7 + strength × 0.6)",
    Math.abs(effectiveWeight(1.8, 1.25, 1) - 1.8 * 1.25 * (0.7 + 0.6)) < 1e-12,
  );
  check("Floor und Spanne sind die Spec-Konstanten", GOLD_EFFECTIVE_WEIGHT.FLOOR === 0.7 && GOLD_EFFECTIVE_WEIGHT.STRENGTH_SPAN === 0.6);
  const calm = habitatMultipliers({ regime: null, realRateTrendPp: -0.3, m2GrowthZ: 1 });
  check("Realzins-Trend −0,30 löst Policy nicht aus", calm.policy === 1);
  check("M2-z = 1 löst Liquidität nicht aus", calm.liquidity === 1);
  check("ohne Stress bleibt Real Yield bei 1", calm.realYield === 1);
  const hot = habitatMultipliers({ regime: "stress", realRateTrendPp: -0.31, m2GrowthZ: 1.01 });
  check("Stress multipliziert Real Yield mit 1.25", hot.realYield === GOLD_HABITAT.STRESS_REAL_YIELD);
  check("Trend unter −0,30 multipliziert Policy mit 1.2", hot.policy === GOLD_HABITAT.POLICY_BOOST);
  check("M2-z über 1 multipliziert Liquidität mit 1.15", hot.liquidity === GOLD_HABITAT.LIQUIDITY_BOOST);
}

console.log("\nAggregation lässt N/A-Dimensionen aus der Summe");
{
  const used: GoldAdaptiveLayer = {
    id: "macro",
    label: "Makro",
    available: true,
    baseWeight: 0.9,
    habitatMultiplier: 1,
    strength: 1,
    effectiveWeight: 2,
    direction: 1,
    contribution: 2,
    detail: "",
    signals: [],
  };
  const other: GoldAdaptiveLayer = { ...used, id: "policy", effectiveWeight: 1, contribution: -1, direction: -1 };
  const missing: GoldAdaptiveLayer = { ...used, id: "supply", available: false, effectiveWeight: null, contribution: null, strength: null, direction: null };
  check("zwei Dimensionen: (2 + −1) / 3", Math.abs((aggregateAdaptiveLayers([used, other]) ?? 99) - (1 / 3)) < 1e-12);
  check("N/A-Angebot ändert die Summe nicht", aggregateAdaptiveLayers([used, other]) === aggregateAdaptiveLayers([used, other, missing]));
  check("nur N/A → Score null, nicht 0", aggregateAdaptiveLayers([missing]) === null);
}

console.log("\nFehlende Quellen bleiben N/A");
{
  const empty = scoreGoldAdaptive(baseInput());
  check("leerer Input → Score null", empty.score === null);
  check("ohne Score bleibt das Delta null", empty.scoreDelta === null && goldScoreDelta(null, 0.55) === null);
  check("Technik-Signale liegen auch ohne Quelle flach", empty.technicalSignals.some(item => item.id === "technical.volumeSpike" && item.available === false));
  check("News-Flag ist nicht Teil des Scores", empty.newsInScore === false);
  check("Supply ohne AISC ist N/A", signal(empty, "supply", "supply.aisc")?.available === false);
  check("Supply-Beitrag ist null", empty.layers.find(layer => layer.id === "supply")?.contribution == null);
  check("Volumen ohne Quelle ist N/A", signal(empty, "technical", "technical.volumeSpike")?.available === false);
  const zeros = scoreGoldAdaptive(baseInput({
    closes: Array.from({ length: 40 }, (_, i) => ({ date: day(i), close: 100 + i })),
    volumes: Array.from({ length: 40 }, (_, i) => ({ date: day(i), volume: 0 })),
    volumeSource: "FMP GCUSD",
  }));
  check("Null-Volumen ist nicht echt", volumeReadingsAreReal(Array.from({ length: 40 }, () => 0)) === false);
  check("Null-Volumen wird nicht als Signal gewertet", signal(zeros, "technical", "technical.volumeSpike")?.available === false);
  check("Null-Volumen ist keine Divergenz-0", signal(zeros, "technical", "technical.volumeDivergence")?.direction == null);
  check("Volumen-Trend ohne echte Prints ist n/a", signal(zeros, "technical", "technical.volumeTrend")?.available === false);
  check("Bollinger ohne Schlüsse ist n/a", signal(empty, "technical", "technical.bollinger")?.available === false);
  check("ATR ohne High/Low ist n/a", (signal(empty, "technical", "technical.atr")?.detail ?? "").includes("High/Low"));
  check("Fiskal ohne Reihe ist n/a und nicht 0", signal(empty, "policy", "policy.fiscal")?.available === false && signal(empty, "policy", "policy.fiscal")?.direction == null);
  const withFlag = scoreGoldAdaptive(baseInput({ newsFlag: 1 }));
  const withoutFlag = scoreGoldAdaptive(baseInput({ newsFlag: null }));
  check("Flag +1 lässt den Score unverändert", withFlag.score === withoutFlag.score);
  check("Flag wird nur angezeigt", withFlag.newsFlag === 1 && withoutFlag.newsFlag === null);
}

console.log("\nVolumen-Spike nur bei echter Reihe");
{
  const bars = Array.from({ length: 80 }, (_, i) => ({
    date: day(i),
    close: 1800 + i,
    volume: 100 + (i % 7) * 8,
  }));
  bars[bars.length - 1].volume = 420;
  const scored = scoreGoldAdaptive(baseInput({
    closes: bars.map(bar => ({ date: bar.date, close: bar.close })),
    volumes: bars.map(bar => ({ date: bar.date, volume: bar.volume })),
    volumeSource: "Yahoo GC=F",
  }));
  const spike = signal(scored, "technical", "technical.volumeSpike");
  check("echte positive Prints gelten als Volumen", volumeReadingsAreReal(bars.map(bar => bar.volume)));
  check("Spike ist verfügbar", spike?.available === true, spike?.detail);
  check("Spike in steigendem Preis ist bullisch", (spike?.direction ?? 0) > 0, String(spike?.direction));
  check("Detail nennt die 1,5×-Marke", (spike?.detail ?? "").includes(String(VOLUME_SPIKE_MULTIPLE)));
  check("Volumenquelle steht am Score", scored.volumeSource === "Yahoo GC=F");
  const trend = signal(scored, "technical", "technical.volumeTrend");
  check("steigendes Volumen in der Aufwärtsbewegung ist bullisch", trend?.available === true && (trend?.direction ?? 0) > 0, trend?.detail);
  check("die Schwelle ist der Volumen-z, kein festes Vielfaches", (trend?.detail ?? "").includes("Schwelle = Volumen-z") && !(trend?.detail ?? "").includes("×"));
  const falling = bars.map((bar, i) => ({ ...bar, close: 2200 - i }));
  const down = scoreGoldAdaptive(baseInput({
    closes: falling.map(bar => ({ date: bar.date, close: bar.close })),
    volumes: falling.map(bar => ({ date: bar.date, volume: bar.volume })),
    volumeSource: "Yahoo GC=F",
  }));
  const downTrend = signal(down, "technical", "technical.volumeTrend");
  check("ohne Aufwärtsbewegung bleibt der Trend n/a", downTrend?.available === false && (downTrend?.detail ?? "").includes("Aufwärtsbewegung"), downTrend?.detail);
}

console.log("\nGates: Policy-Mismatch und Death Cross");
{
  const calmCloses = Array.from({ length: 420 }, (_, i) => ({ date: day(i), close: 1900 + Math.sin(i / 4) * 8 }));
  const richCloses = calmCloses.map((point, i) => i === calmCloses.length - 1 ? { ...point, close: point.close + 180 } : point);
  const risingReal = Array.from({ length: 140 }, (_, i) => ({ date: day(i), value: 1 + i * 0.01 }));
  const fallingReal = Array.from({ length: 140 }, (_, i) => ({ date: day(i), value: 2 - i * 0.01 }));
  const mismatch = scoreGoldAdaptive(baseInput({ closes: richCloses, real10Y: risingReal }));
  const policyOn = mismatch.gates.find(gate => gate.id === "GOLD_POLICY_MISMATCH");
  check("hoher Preis und steigender Realzins aktivieren Policy-Mismatch", policyOn?.active === true, policyOn?.rationale);
  const aligned = scoreGoldAdaptive(baseInput({ closes: richCloses, real10Y: fallingReal }));
  check("fallender Realzins lässt Policy-Mismatch aus", aligned.gates.find(gate => gate.id === "GOLD_POLICY_MISMATCH")?.active === false);
  const deathCloses = [
    ...Array.from({ length: 160 }, (_, i) => ({ date: day(i), close: 200 })),
    ...Array.from({ length: 50 }, (_, i) => ({ date: day(160 + i), close: 100 })),
  ];
  const death = scoreGoldAdaptive(baseInput({ closes: deathCloses }));
  const deathGate = death.gates.find(gate => gate.id === "GOLD_DEATH_CROSS_ACTIVE");
  check("50-MA unter 200-MA ist Death Cross aktiv", deathGate?.active === true, deathGate?.rationale);
  check("Death Cross deckelt den Score nicht", death.gates.every(gate => gate.cap === 100));
  const goldenCloses = Array.from({ length: 220 }, (_, i) => ({ date: day(i), close: 100 + i }));
  const golden = scoreGoldAdaptive(baseInput({ closes: goldenCloses }));
  check("steigende Reihe hat keinen aktiven Death Cross", golden.gates.find(gate => gate.id === "GOLD_DEATH_CROSS_ACTIVE")?.active === false);
  check("unter 200 Schlüssen bleibt Death Cross N/A", scoreGoldAdaptive(baseInput({
    closes: Array.from({ length: 80 }, (_, i) => ({ date: day(i), close: 50 - i * 0.1 })),
  })).gates.find(gate => gate.id === "GOLD_DEATH_CROSS_ACTIVE")?.active === false);
}

console.log("\nAdaptive Richtung statt fester RSI-Schwelle");
{
  const closes = Array.from({ length: 420 }, (_, i) => ({ date: day(i), close: 2000 + Math.sin(i / 5) }));
  for (let i = 400; i < 420; i++) closes[i] = { date: day(i), close: closes[i - 1].close * 1.012 };
  const scored = scoreGoldAdaptive(baseInput({ closes }));
  const rsi = signal(scored, "technical", "technical.rsi");
  check("RSI gegen die eigene Historie ist verfügbar", rsi?.available === true, rsi?.detail);
  check("hoher RSI gegen die Historie ist bärisch", (rsi?.direction ?? 0) < 0, String(rsi?.z));
  check("z-Score braucht eine Streuung", adaptiveZ(1, Array.from({ length: 40 }, () => 1)) === null);
  check("zu kurze Historie ist kein z", adaptiveZ(3, [1, 2, 3]) === null);
}

console.log("\nMakro DXY fallend ist bullisch, AISC ohne Reihe bleibt draußen");
{
  const dxy = [
    ...Array.from({ length: 180 }, (_, i) => ({ date: day(i), value: 120 + Math.sin(i / 6) })),
    ...Array.from({ length: 70 }, (_, i) => ({ date: day(180 + i), value: 120 - i * 0.25 })),
  ];
  const scored = scoreGoldAdaptive(baseInput({ dxy, aisc: [{ date: day(10), aisc: 1400 }] }));
  const macro = scored.layers.find(layer => layer.id === "macro");
  const supply = scored.layers.find(layer => layer.id === "supply");
  check("fallender DXY ist bullisch", (macro?.direction ?? 0) > 0, macro?.detail);
  check("eine AISC-Stufe ergibt keinen Score", supply?.available === false, supply?.detail);
  check("DXY-only-Score ist die Makro-Richtung", scored.score != null && Math.abs(scored.score - (macro?.direction ?? 0)) < 1e-12);
}

console.log("\nNews-Flag ohne Key ist N/A, kein Fake");
{
  check("ohne Key kein Flag", interpretGoldNewsLlm({ flag: 0.4, summary: "x" }, false).flag === null);
  check("ohne Key nennt den fehlenden Key", interpretGoldNewsLlm({}, false).reason === "OPENROUTER_API_KEY fehlt");
  check("Flag wird auf ±1 begrenzt", interpretGoldNewsLlm({ flag: 4, summary: "stark" }, true).flag === 1);
  check("negatives Flag bleibt negativ", interpretGoldNewsLlm({ flag: -2.2, summary: "schwach" }, true).flag === -1);
  check("Text-Flag wird nicht zu 0", interpretGoldNewsLlm({ flag: "bullish", summary: "x" }, true).flag === null);
  check("fehlendes Flag wird nicht zu 0", interpretGoldNewsLlm({ summary: "nur Text" }, true).flag === null);
  check("Cache-Spanne ist 12 h", GOLD_NEWS_CACHE_HOURS === 12);

  const parsed = parseGoldRssItems(
    `<rss><channel><item><title>Gold rallies - Kitco</title><link>https://news.example/gold</link><pubDate>Fri, 09 Oct 2026 12:00:00 GMT</pubDate></item></channel></rss>`,
    "Kitco",
    5,
  );
  check("RSS-Titel und Quelle", parsed.length === 1 && parsed[0].title === "Gold rallies" && parsed[0].source === "Kitco");
  check("Fed-Filter lässt Gold durch und verwirft den Rest", FED_GOLD_PATTERN.test("FOMC holds rates") && !FED_GOLD_PATTERN.test("Community bank director"));

  let store: GoldNewsCacheEntry | null = null;
  let fetches = 0;
  let completes = 0;
  const item = { title: "Central banks buy gold", source: "Reuters", url: "https://news.example/cb", pubDate: "2026-10-09T00:00:00.000Z" };
  const deps = {
    now: 1_000,
    llmAvailable: false,
    fetchItems: async () => { fetches += 1; return [item]; },
    complete: async () => { completes += 1; return { flag: 3, summary: "Käufe stützen Gold" }; },
    cacheGet: () => store,
    cacheSet: (entry: GoldNewsCacheEntry) => { store = entry; },
  };
  const blocked = await loadGoldNewsImpact(deps);
  check("ohne Key bleibt das Flag null", blocked.flag === null && blocked.unavailableReason === "OPENROUTER_API_KEY fehlt");
  check("ohne Key wird OpenRouter nicht gerufen", completes === 0);
  check("RSS-Zeilen bleiben sichtbar", blocked.items.length === 1);

  deps.llmAvailable = true;
  deps.now = 2_000;
  const live = await loadGoldNewsImpact(deps);
  check("mit Key wird das Flag geklemmt", live.flag === 1 && live.summary === "Käufe stützen Gold", String(live.flag));
  check("OpenRouter lief einmal", completes === 1 && fetches === 1);

  deps.now = 3_000;
  const cached = await loadGoldNewsImpact(deps);
  check("innerhalb von 12 h kein zweiter LLM-Call", completes === 1 && cached.flag === 1);

  deps.now = 2_000 + 13 * 60 * 60 * 1000;
  await loadGoldNewsImpact(deps);
  check("nach 12 h wird neu bewertet", completes === 2 && fetches === 2);
}

function renderCards(data: {
  adaptiveScore?: ReturnType<typeof scoreGoldAdaptive> | null;
  goldNews?: {
    flag: number | null;
    summary: string | null;
    updatedAt: string | null;
    llmAvailable: boolean;
    unavailableReason: string | null;
    items: [];
    cacheTtlHours: number;
  } | null;
  gates?: { id: string; active: boolean; cap: number; severity: "warn" | "hard"; rationale: string }[];
  realYieldModel?: {
    fairValue: null;
    inverseScore: { windowUsed: number; correlation: null; score: 0; details: string };
    scenarios: [];
    regime: null;
    gates: { id: string; active: boolean; cap: number; severity: "warn"; rationale: string }[];
    generatedAt: string;
  };
}): string {
  return [
    renderToStaticMarkup(React.createElement(GoldAdaptiveLayersCard, { data })),
    renderToStaticMarkup(React.createElement(GoldAdaptiveGatesCard, { data })),
    renderToStaticMarkup(React.createElement(GoldNewsCard, { data })),
  ].join("");
}

console.log("\nUI zeigt Gewicht, Stärke, Beitrag, Gates und News");
{
  const emptyHtml = renderCards({});
  check("ohne Schicht steht N/A", emptyHtml.includes("N/A"));
  check("News-Karte ist da", emptyHtml.includes("gold-news-card") && emptyHtml.includes("Flag N/A"));
  const dxy = [
    ...Array.from({ length: 180 }, (_, i) => ({ date: day(i), value: 110 + Math.sin(i / 5) * 0.4 })),
    ...Array.from({ length: 70 }, (_, i) => ({ date: day(180 + i), value: 110 - i * 0.2 })),
  ];
  const scored = scoreGoldAdaptive(baseInput({ gis: 0.55, dxy }));
  check(
    "scoreDelta ist adaptiv minus GIS",
    scored.score != null && scored.scoreDelta != null && Math.abs(scored.scoreDelta - (scored.score - 0.55)) < 1e-12,
    String(scored.scoreDelta),
  );
  check(
    "technicalSignals gleichen der Technik-Schicht",
    scored.technicalSignals.length > 0
      && scored.technicalSignals.every((item, index) => item.id === scored.layers.find(layer => layer.id === "technical")?.signals[index]?.id),
  );
  const aiscGate = { id: "GOLD_AISC_STRESS", active: false, cap: 100, severity: "warn" as const, rationale: "AISC-Daten nicht verfügbar" };
  const html = renderCards({
    adaptiveScore: scored,
    gates: [aiscGate, ...scored.gates],
    goldNews: {
      flag: null,
      summary: null,
      updatedAt: null,
      llmAvailable: false,
      unavailableReason: "OPENROUTER_API_KEY fehlt",
      items: [],
      cacheTtlHours: 12,
    },
  });
  check("Spalten Gewicht, Stärke, Beitrag", html.includes("Gewicht") && html.includes("Stärke") && html.includes("Beitrag"));
  check("Makro-Zeile ist gerendert", html.includes("gold-adaptive-layer-macro"));
  check("fehlende neue Signale stehen als n/a auf der Karte", html.includes("gold-adaptive-signal-policy.fiscal") && html.includes("gold-adaptive-signal-technical.bollinger") && html.includes("gold-adaptive-signal-technical.atr") && html.includes("n/a —"));
  check("Score-Delta steht auf der Layer-Karte", html.includes("gold-score-delta") && html.includes("Δ GIS"));
  check("bestehendes AISC-Gate bleibt sichtbar", html.includes("GOLD_AISC_STRESS"));
  check("Death-Cross-Gate ist sichtbar", html.includes("GOLD_DEATH_CROSS_ACTIVE"));
  check("News ohne Key zeigt N/A und den Grund", html.includes("Flag N/A") && html.includes("OPENROUTER_API_KEY fehlt"));
  const fromModels = renderToStaticMarkup(React.createElement(GoldAdaptiveGatesCard, {
    data: {
      realYieldModel: {
        fairValue: null,
        inverseScore: { windowUsed: 0, correlation: null, score: 0, details: "" },
        scenarios: [],
        regime: null,
        gates: [aiscGate],
        generatedAt: "2026-10-11T00:00:00.000Z",
      },
      adaptiveScore: scored,
    },
  }));
  check("ohne Wurzel-Feld bleiben Modell-Gates sichtbar", fromModels.includes("GOLD_AISC_STRESS") && fromModels.includes("GOLD_DEATH_CROSS_ACTIVE"));
}

console.log("\nF10 Bollinger, ATR, Fiskal, AISC — nur die Zusatzschicht");
{
  check("Fenster sind benannte Parameter", BOLLINGER_WINDOW === 20 && ATR_WINDOW === 14);
  check("Fiskalreihe ist FRED MTSDS133FMS, Lag 12", FISCAL_SERIES_ID === "MTSDS133FMS" && FISCAL_GROWTH_LAG === 12);
  const calm = Array.from({ length: 420 }, (_, i) => ({ date: day(i), close: 2000 + Math.sin(i / 6) * 4 }));
  const stretched = calm.map((point, i) => i < 400 ? point : { ...point, close: calm[399].close * Math.pow(1.012, i - 399) });
  const dropped = calm.map((point, i) => i < 400 ? point : { ...point, close: calm[399].close * Math.pow(0.988, i - 399) });
  const highBand = signal(scoreGoldAdaptive(baseInput({ closes: stretched })), "technical", "technical.bollinger");
  const lowBand = signal(scoreGoldAdaptive(baseInput({ closes: dropped })), "technical", "technical.bollinger");
  check("Bollinger über der eigenen Historie ist bärisch", highBand?.available === true && (highBand?.direction ?? 0) < 0, highBand?.detail);
  check("Bollinger unter der eigenen Historie ist bullisch", lowBand?.available === true && (lowBand?.direction ?? 0) > 0, lowBand?.detail);
  check("Bollinger-Detail nennt das Fenster", (highBand?.detail ?? "").includes(String(BOLLINGER_WINDOW)));
  const ranges = calm.map((point, i) => {
    const width = i < 360 ? 0.004 : 0.05;
    return { date: point.date, high: point.close * (1 + width), low: point.close * (1 - width) };
  });
  const atr = signal(scoreGoldAdaptive(baseInput({ closes: calm, ranges })), "technical", "technical.atr");
  check("ATR aus High/Low ist verfügbar", atr?.available === true, atr?.detail);
  check("ATR ist kein Richtungs-Summand", atr?.direction == null && atr?.strength == null, atr?.detail);
  check("ATR-Detail nennt das Fenster", (atr?.detail ?? "").includes(String(ATR_WINDOW)));
  const atrMissing = signal(scoreGoldAdaptive(baseInput({ closes: calm })), "technical", "technical.atr");
  check("ohne High/Low kein erfundener ATR", atrMissing?.available === false && atrMissing?.direction == null && (atrMissing?.detail ?? "").includes("nicht aus dem Schluss"));

  const widening = Array.from({ length: 90 }, (_, i) => ({ date: month(i), value: i < 70 ? -120000 : -120000 - (i - 69) * 8000 }));
  const narrowing = Array.from({ length: 90 }, (_, i) => ({ date: month(i), value: i < 70 ? -240000 : -240000 + (i - 69) * 8000 }));
  const fiscalUp = signal(scoreGoldAdaptive(baseInput({ fiscal: widening })), "policy", "policy.fiscal");
  const fiscalDown = signal(scoreGoldAdaptive(baseInput({ fiscal: narrowing })), "policy", "policy.fiscal");
  check("wachsendes Defizit ist bullisch", fiscalUp?.available === true && (fiscalUp?.direction ?? 0) > 0, fiscalUp?.detail);
  check("schrumpfendes Defizit ist bärisch", fiscalDown?.available === true && (fiscalDown?.direction ?? 0) < 0, fiscalDown?.detail);
  check("Perzentil steht im Detail", (fiscalUp?.detail ?? "").includes("Perzentil") && (fiscalUp?.detail ?? "").includes(FISCAL_SERIES_ID));
  const fiscalShort = signal(scoreGoldAdaptive(baseInput({
    fiscal: Array.from({ length: 10 }, (_, i) => ({ date: month(i), value: -1000 - i })),
  })), "policy", "policy.fiscal");
  check("kurze Fiskalreihe ist n/a, nicht 0", fiscalShort?.available === false && fiscalShort?.direction == null && (fiscalShort?.detail ?? "").includes("zu kurz"));
  check("Perzentil braucht Historie", percentileRank(5, [1, 2, 3]) === null);
  check("höchstes Wachstum liegt über dem Median", (percentileRank(100, Array.from({ length: 40 }, (_, i) => i)) ?? 0) > 0.9);

  const quarter = (name: string, aisc: number | null, sourceDates: string[]): GoldAiscQuarterStep => ({
    quarter: name,
    periodEnd: "2024-03-31",
    availableFrom: "2024-05-30",
    aisc,
    count: sourceDates.length,
    values: sourceDates.map((sourceDate, index) => ({
      company: (["NEM", "B", "AEM"] as const)[index],
      quarter: name,
      aisc: aisc ?? 1,
      sourceUrl: "https://example.com/q",
      sourceTitle: "Quelle",
      sourceDate,
    })),
  });
  const series: GoldAiscSeries = {
    unit: "USD/oz",
    basis: "by-product",
    method: "mean",
    minCompanies: 2,
    lagDays: 60,
    stressLow: 1.1,
    stressHigh: 1.15,
    companies: {
      NEM: { name: "Newmont", ticker: "NEM", metric: "AISC" },
      B: { name: "Barrick", ticker: "B", metric: "AISC" },
      AEM: { name: "Agnico Eagle", ticker: "AEM", metric: "AISC" },
    },
    quarters: [
      quarter("2024-Q1", null, []),
      quarter("2024-Q2", 1400, ["2024-08-01"]),
      quarter("2024-Q3", 1500, ["2024-08-15", "2024-11-01"]),
      quarter("2024-Q4", 1550, ["2024-11-01", "2025-02-20"]),
      quarter("2025-Q1", 1600, ["2025-02-20", "2025-02-20"]),
    ],
    gaps: [],
    retrievedAt: "2026-10-18",
    source: "server/data/gold-aisc.json",
    inScore: false,
  };
  const steps = aiscStepsForAdaptive(series);
  check("n/a-Quartal und einzelne Quelle fallen weg", JSON.stringify(steps) === JSON.stringify([
    { date: "2024-11-01", aisc: 1500 },
    { date: "2025-02-20", aisc: 1600 },
  ]), JSON.stringify(steps));
  check("fehlende Datei bleibt null", aiscStepsForAdaptive(null) === null);
  const closes = Array.from({ length: 80 }, (_, i) => ({ date: day(i), close: 1600 + i * 4 }));
  const supplied = signal(scoreGoldAdaptive(baseInput({
    closes,
    aisc: [{ date: day(4), aisc: 1100 }],
  })), "supply", "supply.aisc");
  check("Quartals-AISC mit genug Schlüssen ist verfügbar", supplied?.available === true, supplied?.detail);
  check("weitere Marge ist bullisch", (supplied?.direction ?? 0) > 0, String(supplied?.direction));
  const loaded = aiscStepsForAdaptive(loadGoldAiscSeries());
  check("Repo-Datei liefert positive PIT-Stufen", loaded != null && loaded.length > 0 && loaded.every(step => step.aisc > 0 && /^\d{4}-\d{2}-\d{2}$/.test(step.date)), JSON.stringify(loaded));

  const gis = 0.42;
  const before = scoreGoldAdaptive(baseInput({ gis, closes: calm }));
  const after = scoreGoldAdaptive(baseInput({
    gis,
    closes: calm,
    ranges,
    fiscal: widening,
    aisc: [{ date: day(4), aisc: 1100 }],
    volumes: calm.map((bar, i) => ({ date: bar.date, volume: 80 + (i % 5) + (i > 390 ? 40 : 0) })),
    volumeSource: "Test",
  }));
  check("GIS vorher = GIS nachher", before.score != null && after.score != null && before.scoreDelta != null && after.scoreDelta != null);
  check("Delta vorher ist Schicht minus GIS", Math.abs((before.score as number) - gis - (before.scoreDelta as number)) < 1e-9);
  check("Delta nachher ist Schicht minus GIS", Math.abs((after.score as number) - gis - (after.scoreDelta as number)) < 1e-9);
  console.log(`  GIS vorher ${gis.toFixed(6)} nachher ${gis.toFixed(6)}`);
  console.log(`  Schicht vorher ${before.score?.toFixed(6)} nachher ${after.score?.toFixed(6)}`);
}

console.log("\nRoute lässt GIS, OLS, Multi-Faktor und Monte Carlo stehen");
{
  const routes = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
  const start = routes.indexOf("function getTechnicalScore");
  const end = routes.indexOf("export function registerGoldRoutes");
  const fn = routes.slice(start, end);
  check("getTechnicalScore bleibt ohne Cross- und Volumen-Term", start >= 0 && !/ma50|Golden|Death|volume/i.test(fn));
  check("Chart-Punkte bleiben ohne Volumenfeld", /historicalPrices\.push\(\{ date: dateStr, close \}\)/.test(routes));
  check("Real-Yield-OLS bleibt angebunden", routes.includes("runRealYieldGoldModel("));
  check("Multi-Faktor bleibt angebunden", routes.includes("runMultiFactorGoldModel("));
  check("Monte Carlo bleibt angebunden", routes.includes("runMonteCarlo("));
  check("adaptive Schicht ist angebunden", routes.includes("scoreGoldAdaptive("));
  check("Quartals-AISC geht an die Zusatzschicht", /aisc:\s*aiscStepsForAdaptive\(loadGoldAiscSeries\(\)\)/.test(routes));
  check("Fiskalreihe wird aus FRED geholt", routes.includes("fredHistory.get(FISCAL_SERIES_ID, startDate)"));
  check("High/Low gehen nur an die Schicht", routes.includes("ranges: rangeBars.length > 0 ? rangeBars : null"));
  check("GIS-Formel bleibt die Indikatorsumme", /const gis = indicators\.reduce\(\(sum, ind\) => sum \+ ind\.score \* ind\.weight, 0\);/.test(routes));
  check("gisRounded wird nicht aus der Schicht überschrieben", /const gisRounded = Math\.round\(gis \* 100\) \/ 100;/.test(routes) && !/gisRounded\s*=\s*adaptive/.test(routes));
  check("Yahoo GC=F ist die Volumen-Reserve", routes.includes('yahooFetch("GC=F"'));
  check("GIS fließt nur ins Score-Delta", routes.includes("gis: gisRounded"));
  check("Response liefert scoreDelta, gates und technicalSignals", /scoreDelta,\s*gates,\s*technicalSignals,/.test(routes));
  const schema = readFileSync(new URL("../shared/gold-schema.ts", import.meta.url), "utf8");
  check("Schema hat scoreDelta und technicalSignals", schema.includes("scoreDelta: number | null") && schema.includes("technicalSignals: GoldAdaptiveSignal[]") && schema.includes("technicalSignals?: GoldAdaptiveSignal[]"));
  const dash = readFileSync(new URL("../client/src/pages/GoldDashboard.tsx", import.meta.url), "utf8");
  check(
    "Dashboard bindet die drei Karten nur ein",
    dash.includes("<GoldAdaptiveLayersCard data={data} />")
      && dash.includes("<GoldAdaptiveGatesCard data={data} />")
      && dash.includes("<GoldNewsCard data={data} />")
      && !dash.includes("GoldAdaptiveSection"),
  );
  const point = schema.match(/export interface GoldPricePoint \{[\s\S]*?\n\}/)?.[0] ?? "";
  // #209: volume ist optional und wird nur bei echten positiven Prints gesetzt (gold-chart-series.ts).
  check("GoldPricePoint.volume nur optional, keine 0-Fuellung", point.length > 0 && (!/volume/.test(point) || /volume\?:/.test(point)) && readFileSync(new URL("../server/gold-chart-series.ts", import.meta.url), "utf8").includes("v.volume > 0"));
  check("Chart-Datei ist nicht Teil dieser Schicht", !routes.includes("GoldPriceChart"));
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll gold adaptive checks passed.");
