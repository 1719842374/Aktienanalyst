/**
 * Future_9 F9-09 / F9-12 / F9-13 / F9-16 / F9-17.
 * Ohne Netzwerk. Live-P wird nicht umgeschaltet.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-adaptive-weights.ts
 */
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { execFileSync } from "node:child_process";
import {
  ADAPTIVE_WEIGHT_FORMULA,
  CONCENTRATION_ABSENT,
  RECESSION_HABITAT_RESTRICTIVE,
  RECESSION_MACRO_BASE_WEIGHTS,
  RECESSION_MACRO_DIMENSIONS,
  RECESSION_STRENGTH_LAYER,
  bookTotals,
  calculateAdaptiveWeights,
  dimensionMultiplier,
  macroWeightPriors,
  strengthFromIndicator,
  type AdaptiveIndicator,
} from "../server/recession-adaptive-weights";
import {
  AI_WEIGHT_MAX_SHARE,
  RECESSION_AI_WEIGHT_CACHE_MAX_MS,
  RECESSION_AI_WEIGHT_CACHE_MIN_MS,
  RECESSION_AI_WEIGHT_CACHE_MS,
  RECESSION_AI_WEIGHT_TIMEOUT_MS,
  getAIWeightSuggestion,
  resetRecessionAiWeightCache,
} from "../server/recession-adaptive-ai";
import { loadRecessionAdaptiveView } from "../server/recession-adaptive";
import { RecessionAdaptiveWeightsCard } from "../client/src/components/recession/RecessionAdaptiveWeightsCard";
import { PRIOR_KIND_LABEL, type RecessionAdaptiveView } from "../shared/recession-adaptive-weights-view";
import {
  anchoredRecessionProbability,
  buffettReading,
  capeReading,
  vixReading,
} from "../server/recession";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function layer(id: string, result = calculateAdaptiveWeights({ regime: null }, [])) {
  return result.layers.find(item => item.id === id)!;
}

console.log("\nBasisgewichte und benannte Parameter");
{
  check("Bewertung 1.8", RECESSION_MACRO_BASE_WEIGHTS.bewertung === 1.8);
  check("Kredit 1.2", RECESSION_MACRO_BASE_WEIGHTS.kredit === 1.2);
  check("Realwirtschaft 1.0", RECESSION_MACRO_BASE_WEIGHTS.realwirtschaft === 1);
  check("Geldpolitik 1.0", RECESSION_MACRO_BASE_WEIGHTS.geldpolitik === 1);
  check("Sentiment 0.8", RECESSION_MACRO_BASE_WEIGHTS.sentiment === 0.8);
  check("Managing 1.5", RECESSION_MACRO_BASE_WEIGHTS.managing === 1.5);
  check("Widersprüche 1.3", RECESSION_MACRO_BASE_WEIGHTS.widersprueche === 1.3);
  check("restriktiv Bewertung 1.3", RECESSION_HABITAT_RESTRICTIVE.bewertung === 1.3);
  check("restriktiv Managing 1.2", RECESSION_HABITAT_RESTRICTIVE.managing === 1.2);
  check("restriktiv Geldpolitik 1.2", RECESSION_HABITAT_RESTRICTIVE.geldpolitik === 1.2);
  check("Stärke-Layer 0.7 + 0.6", RECESSION_STRENGTH_LAYER.FLOOR === 0.7 && RECESSION_STRENGTH_LAYER.SPAN === 0.6);
  check("Cache liegt in 6–12 h", RECESSION_AI_WEIGHT_CACHE_MS >= RECESSION_AI_WEIGHT_CACHE_MIN_MS && RECESSION_AI_WEIGHT_CACHE_MS <= RECESSION_AI_WEIGHT_CACHE_MAX_MS);
  check("KI-Zeitgrenze liegt unter der 24s-Proxy-Wache", RECESSION_AI_WEIGHT_TIMEOUT_MS > 0 && RECESSION_AI_WEIGHT_TIMEOUT_MS < 24_000);
  check("KI-Band ±25 %", AI_WEIGHT_MAX_SHARE === 0.25);
  const src = readFileSync(new URL("../server/recession-adaptive-weights.ts", import.meta.url), "utf8");
  check("Gewichtedatei enthält kein festes Level 0,4", !src.includes("0.4"));
  check("P75-Pfad ist entfernt", !src.includes("concentrationLimitFromHistory") && !src.includes("CONCENTRATION_LIMIT_PERCENTILE"));
  const priors = macroWeightPriors();
  check("Basis, Habitat und Stärke sind als Prior benannt", priors.length === 3 && priors.every(item => item.kind === "prior"));
}

console.log("\nHabitat restrictive, Stärke, Konzentration ohne Reihe");
{
  const hot = calculateAdaptiveWeights({ regime: "restrictive" }, []);
  check("restriktiv hebt Bewertung", Math.abs(layer("bewertung", hot).quantitativeWeight - 1.8 * 1.3) < 1e-12);
  check("restriktiv hebt Managing", Math.abs(layer("managing", hot).quantitativeWeight - 1.5 * 1.2) < 1e-12);
  check("restriktiv hebt Geldpolitik", Math.abs(layer("geldpolitik", hot).quantitativeWeight - 1.2) < 1e-12);
  check("Kredit bleibt auf der Basis", layer("kredit", hot).quantitativeWeight === 1.2);
  check("ohne Stärke kein Faktor 0,7", layer("sentiment", hot).strength === null && layer("sentiment", hot).quantitativeWeight === 0.8);
  check("Managing ohne Quelle ist n/a", layer("managing", hot).detail.includes("n/a — Managing-Score"));
  check("Widersprüche ohne Definition sind n/a", layer("widersprueche", hot).detail.includes("n/a — Makro-Bilanzwidersprüche"));

  check("Konzentrationsaufschlag entfällt mit Grund", hot.concentrationDetail === CONCENTRATION_ABSENT && hot.concentrationLimit === null);
  check("restriktiv hebt Bewertung nur um den Habitat-Prior", Math.abs(layer("bewertung", hot).habitatMultiplier - 1.3) < 1e-12);
  const strong = calculateAdaptiveWeights(
    { regime: null },
    [{ indicator: "Buffett Indikator (TMC/GDP)", strength: 1 }],
  );
  check(
    "Stärke 1 → Basis × (0,7 + 0,6)",
    Math.abs(layer("bewertung", strong).quantitativeWeight - 1.8 * (0.7 + 0.6)) < 1e-12,
  );
  const mixed = calculateAdaptiveWeights(
    { regime: null },
    [
      { indicator: "Buffett Indikator (TMC/GDP)", strength: 0 },
      { indicator: "Shiller CAPE", strength: 1 },
    ],
  );
  check("zwei Signale: Mittel der Stärke, ein Layer", Math.abs((layer("bewertung", mixed).strength ?? -1) - 0.5) < 1e-12);
  check("Mittel 0,5 lässt das Basisgewicht stehen", Math.abs(layer("bewertung", mixed).quantitativeWeight - 1.8) < 1e-12);
}

console.log("\nKI: ±25 %, Fehler → quantitativ, Cache 8 h");
{
  const weights = Object.fromEntries(RECESSION_MACRO_DIMENSIONS.map(id => [id, RECESSION_MACRO_BASE_WEIGHTS[id]]));
  const habitat = { regime: "neutral" as const, concentration: null, concentrationLimit: null, growthMomentum: null };
  resetRecessionAiWeightCache();
  let calls = 0;
  const call = async () => {
    calls += 1;
    return { data: { adjustedWeights: { bewertung: 9, kredit: 0.1, sentiment: "keine Zahl" }, reason: "eng", riskFlag: 1 } };
  };
  const first = await getAIWeightSuggestion({ habitat, signals: [], currentWeights: weights, now: 1_000, llmAvailable: true, call });
  check("Quelle KI", first.source === "ki");
  check("Bewertung auf +25 % begrenzt", Math.abs(first.weights.bewertung - 1.8 * 1.25) < 1e-12, String(first.weights.bewertung));
  check("Kredit auf −25 % begrenzt", Math.abs(first.weights.kredit - 1.2 * 0.75) < 1e-12, String(first.weights.kredit));
  check("unbrauchbares Sentiment bleibt quantitativ", first.weights.sentiment === 0.8);
  check("unbekannter Schlüssel ändert nichts", first.weights.managing === 1.5);
  const second = await getAIWeightSuggestion({ habitat, signals: [], currentWeights: weights, now: 2_000, llmAvailable: true, call });
  check("zweiter Abruf innerhalb 8 h kommt aus dem Cache", second.cached && calls === 1, `calls=${calls}`);
  const third = await getAIWeightSuggestion({
    habitat,
    signals: [],
    currentWeights: weights,
    now: 1_000 + RECESSION_AI_WEIGHT_CACHE_MS,
    llmAvailable: true,
    call,
  });
  check("nach 8 h wird neu gefragt", !third.cached && calls === 2, `calls=${calls}`);

  resetRecessionAiWeightCache();
  const broken = await getAIWeightSuggestion({
    habitat,
    signals: [],
    currentWeights: weights,
    now: 5_000,
    llmAvailable: true,
    call: async () => null,
  });
  check("leere KI-Antwort → quantitativ", broken.source === "quantitativ" && broken.weights.bewertung === 1.8);
  check("Fehlertext ist n/a mit Grund", broken.reason.startsWith("n/a —"));

  resetRecessionAiWeightCache();
  const threw = await getAIWeightSuggestion({
    habitat,
    signals: [],
    currentWeights: weights,
    now: 6_000,
    llmAvailable: true,
    call: async () => { throw new Error("timeout"); },
  });
  check("Exception → quantitativ", threw.source === "quantitativ" && threw.weights.kredit === 1.2);

  resetRecessionAiWeightCache();
  let blocked = 0;
  const noKey = await getAIWeightSuggestion({
    habitat,
    signals: [],
    currentWeights: weights,
    now: 7_000,
    llmAvailable: false,
    call: async () => { blocked += 1; return { data: {} }; },
  });
  check("ohne OPENROUTER_API_KEY kein Call", blocked === 0 && noKey.source === "quantitativ");
  check("Grund nennt den Key", noKey.reason.includes("OPENROUTER_API_KEY"));
}

console.log("\nLive-P wird kopiert, Schatten rechnet daneben");
{
  const indicator: AdaptiveIndicator = {
    name: "Buffett Indikator (TMC/GDP)",
    rawScore: 4,
    weight: 2,
    weightedScore: 8,
    maxWeighted: 16,
  };
  check("Stärke aus dem eigenen Scorebereich", strengthFromIndicator(indicator) === 0.5);
  const view = await loadRecessionAdaptiveView({
    indicators: [indicator],
    groups: [{
      name: "correction_full",
      label: "Korrektur Vollständig",
      indicators: [indicator],
      nyFed: null,
      liveProbability: 12,
    }],
    zReal: null,
    rateTight: false,
    suggest: async (args) => ({
      source: "quantitativ",
      weights: args.currentWeights,
      reason: "test",
      riskFlag: null,
      cached: false,
    }),
    probability: (_name, net, max) => anchoredRecessionProbability(net, max, null).probability,
  });
  check("P alt ist die übergebene Live-P", view.shadow[0]?.pAlt === 12);
  check("P neu folgt der Formel und ist nicht die Live-P", view.shadow[0]?.pNeu === 75, String(view.shadow[0]?.pNeu));
  check("liveUnchanged", view.liveUnchanged === true);
  check("Formel nennt die Live-P", view.formula === ADAPTIVE_WEIGHT_FORMULA);

  const quiet = calculateAdaptiveWeights({ regime: null }, [
    { indicator: indicator.name, strength: 0.5 },
  ]);
  const same = bookTotals([indicator], name => dimensionMultiplier(name, quiet.layers));
  const plain = bookTotals([indicator], () => 1);
  check("Stärke 0,5 skaliert Netto und Max gleich", Math.abs(same.net / same.max - plain.net / plain.max) < 1e-12);
  check("Karte trägt die Priors", view.priors.some(item => item.kind === "prior" && item.id === "base"));
}

console.log("\nKI-Abruf über der Zeitgrenze wird nicht awaited");
{
  const indicator: AdaptiveIndicator = {
    name: "VIX",
    rawScore: 4,
    weight: 1,
    weightedScore: 4,
    maxWeighted: 4,
  };
  const started = Date.now();
  const view = await loadRecessionAdaptiveView({
    indicators: [indicator],
    groups: [{ name: "correction_sentiment", label: "Korrektur Sentiment", indicators: [indicator], nyFed: null, liveProbability: 33 }],
    zReal: null,
    rateTight: false,
    timeoutMs: 30,
    suggest: () => new Promise(() => {}),
    probability: (_name, net, max) => anchoredRecessionProbability(net, max, null).probability,
  });
  const elapsed = Date.now() - started;
  check("Await endet an der Zeitgrenze", elapsed < 500, `${elapsed} ms`);
  check("Zeitgrenze ist n/a mit Grund", view.reason.startsWith("n/a — KI-Abruf über der Zeitgrenze"));
  check("Quelle bleibt quantitativ", view.source === "quantitativ");
  check("Live-P bleibt die übergebene 33", view.shadow[0]?.pAlt === 33);
  check("quantitative Gewichte bleiben gesetzt", view.layers.find(item => item.id === "sentiment")?.quantitativeWeight != null);
}

console.log("\nHistorische Validierung 2000 / 2008 / 2022 — P alt gegen P neu");
{
  const years: Array<{ year: number; indicators: AdaptiveIndicator[]; missing: string }> = [
    {
      year: 2000,
      indicators: [buffettReading(155), capeReading(44)],
      missing: "VIX n/a — Future_7 ohne Zahl für 2000; Sahm n/a — Future_7 nennt den Auslöser, aber keine Arbeitslosenreihe",
    },
    {
      year: 2008,
      indicators: [buffettReading(110), capeReading(25.5), vixReading(80)],
      missing: "Sahm n/a — Future_7 nennt den Auslöser, aber keine Arbeitslosenreihe; Rezessionsbuch n/a — keine vollständige Indikatorreihe",
    },
    {
      year: 2022,
      indicators: [buffettReading(205), capeReading(27), vixReading(35.5)],
      missing: "Sahm n/a — 2022 ohne Zahl; Rezessionsbuch n/a — keine vollständige Indikatorreihe",
    },
  ];
  console.log("  Korrekturbuch, Dokumentationsmitten aus Future_7. Habitat und Konzentration: n/a, Aufschlag nicht angewendet.");
  console.log("  Jahr | P alt roh | P alt | P neu roh | P neu | belegt | fehlt");
  for (const year of years) {
    const weights = calculateAdaptiveWeights({
      regime: null,
      regimeDetail: "n/a — kein DFII10-z in Future_7, restriktiver Aufschlag nicht angewendet",
    }, year.indicators.map(item => ({ indicator: item.name, strength: strengthFromIndicator(item) })));
    const alt = bookTotals(year.indicators, () => 1);
    const neu = bookTotals(year.indicators, name => dimensionMultiplier(name, weights.layers));
    const pAlt = anchoredRecessionProbability(alt.net, alt.max, null);
    const pNeu = anchoredRecessionProbability(neu.net, neu.max, null);
    console.log(`  ${year.year} | ${pAlt.formulaPct.toFixed(1)} | ${pAlt.probability} | ${pNeu.formulaPct.toFixed(1)} | ${pNeu.probability} | ${alt.used.join(", ")} | ${year.missing}`);
    check(`${year.year} P alt und P neu sind gesetzt`, Number.isFinite(pAlt.probability) && Number.isFinite(pNeu.probability));
    check(`${year.year} gerundet auf 5 und nicht 0`, pAlt.probability % 5 === 0 && pNeu.probability % 5 === 0 && pAlt.probability !== 0 && pNeu.probability !== 0);
    check(`${year.year} fehlt-Text ist n/a`, year.missing.includes("n/a —"));
    if (year.year === 2000) {
      check("2000 eine Dimension, Rohwerte gleich", Math.abs(pAlt.formulaPct - pNeu.formulaPct) < 1e-9);
    } else {
      check(`${year.year} zwei Dimensionen, Rohwerte verschieden`, Math.abs(pAlt.formulaPct - pNeu.formulaPct) > 0.1, `${pAlt.formulaPct} vs ${pNeu.formulaPct}`);
    }
  }
}

console.log("\nKarte");
{
  const empty = renderToStaticMarkup(React.createElement(RecessionAdaptiveWeightsCard, { view: undefined }));
  check("ohne Payload n/a mit Grund", empty.includes("n/a — adaptive Gewichte nicht im Payload"));
  check("Hinweis, dass die Live-P bleibt", empty.includes("Live-P"));

  const sample: RecessionAdaptiveView = {
    liveUnchanged: true,
    source: "ki",
    reason: "n/a — Testgrund",
    riskFlag: null,
    cached: false,
    regime: "restrictive",
    regimeDetail: "Habitat restriktiv",
    concentration: null,
    concentrationLimit: null,
    concentrationDetail: CONCENTRATION_ABSENT,
    formula: ADAPTIVE_WEIGHT_FORMULA,
    priors: macroWeightPriors(),
    layers: calculateAdaptiveWeights({ regime: "restrictive" }, []).layers.map(item => (
      item.id === "bewertung" ? { ...item, adjustedWeight: item.quantitativeWeight * 1.1, detail: `${item.detail} · KI +10.0 %` } : item
    )),
    shadow: [{ name: "recession_full", label: "Rezession Vollständig", pAlt: 40, pNeu: 45, detail: "Schatten" }],
    generatedAt: "2026-11-01T00:00:00.000Z",
  };
  const html = renderToStaticMarkup(React.createElement(RecessionAdaptiveWeightsCard, { view: sample }));
  check("Quelle KI", html.includes("Quelle KI") && html.includes("recession-adaptive-source"));
  check("Basis und angepasst stehen in der Zeile", html.includes("1.80") && html.includes("recession-adaptive-adjusted-bewertung"));
  check("Konzentration n/a mit Grund", html.includes("Perzentil-Aufschlag ist entfernt"));
  check("Prior steht in der Karte", html.includes(PRIOR_KIND_LABEL) && html.includes("recession-adaptive-prior-base"));
  check("Schatten zeigt P alt und P neu", html.includes("P alt 40%") && html.includes("P neu 45%"));
  check("keine Gewichtszelle 0 für eine fehlende Stärke", !html.includes(">0.00<") && !html.includes(">0<"));

  const quant = renderToStaticMarkup(React.createElement(RecessionAdaptiveWeightsCard, {
    view: { ...sample, source: "quantitativ", reason: "n/a — OPENROUTER_API_KEY fehlt, quantitative Gewichte" },
  }));
  check("Quelle quantitativ", quant.includes("Quelle quantitativ"));

  const page = readFileSync(new URL("../client/src/pages/RecessionDashboard.tsx", import.meta.url), "utf8");
  check("Karte hängt am Dashboard", page.includes("<RecessionAdaptiveWeightsCard"));
  check("Prozentschätzungen lesen weiter die Live-Untergruppen", page.includes("<ProbabilityEstimates subgroups={data.subgroups} />"));
  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  check("Live-P der 12M-Gruppe bleibt pRezFull", server.includes("probability: pRezFull"));
  check("Schatten kopiert pRezFull als liveProbability", server.includes("liveProbability: pRezFull"));
  check("Server importiert analyze-route nicht", !server.includes("analyze-route"));
}

console.log("\nScore vorher/nachher, Fixture des alten Heads");
{
  const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
  const rows: Array<[string, string, string]> = [
    ["VOW3 (VWAGY)", "4.735718", pin.VWAGY.overallScore],
    ["SAP", "5.174758", pin.SAP.overallScore],
    ["MSFT", "4.058138", pin.MSFT.overallScore],
  ];
  for (const [label, expect, actual] of rows) {
    const shown = Number(actual).toFixed(6);
    console.log(`  ${label} vorher ${expect} nachher ${shown}`);
    check(`${label} bleibt ${expect}`, shown === expect, shown);
  }
  const names = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
  check("analyze-route.ts nicht im Diff", !names.split("\n").includes("server/analyze-route.ts"), names);
}

console.log(`\n${failed === 0 ? "alle Checks grün" : `${failed} Checks rot`}`);
process.exit(failed ? 1 : 0);
