/**
 * TECH_MOAT_OVERRIDE (A2/A3, WORK_NVO_TECHNICAL_OVERRIDE.md / WORK_SECTION_WEIGHTING_ADAPTIVE.md).
 * Regel (Philip 18.10.2026): Death Cross + RSL < 105 + schwacher Moat (min Regel/KI) gleichzeitig
 * → Gesamtscore-Label (Ampel) UND Fazit höchstens NEUTRAL. Titel ohne Kombination unverändert.
 * Ausführen: npx tsx script/test-tech-moat-override.ts
 */
import { readFileSync } from "fs";
import type { StockAnalysis } from "../shared/schema";
import {
  buildBiasDecision,
  evaluateTechMoatOverride,
  overallRatingFromScore,
  rslHistoryStats,
  weakerMoatRating,
  TECH_MOAT_CAP_CEIL,
  TECH_MOAT_CAP_FLOOR,
  TECH_MOAT_RSL_HISTORY_MIN,
  TECH_MOAT_RSL_THRESHOLD,
} from "../shared/bias-fixes";
import { buildFazitSignal, prepareFazitMetrics } from "../client/src/lib/fazit-signal";

let failed = 0;
function check(name: string, condition: boolean, detail?: string) {
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Deterministische Monte-Carlo-Pfade (Fazit-MC-Faktor), damit Vergleiche stabil sind.
function seedRandom() {
  let seed = 42;
  Math.random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
}

const ABOVE = new Set(["ATTRAKTIV", "LEICHT ATTRAKTIV"]);

console.log("\n=== Moat-Minimum (Regel vs. KI) ===");
{
  check("Narrow + None → None", weakerMoatRating("Narrow", "None") === "None");
  check("Wide + Narrow → Narrow", weakerMoatRating("Wide", "Narrow") === "Narrow");
  check("Wide + fehlend → Wide", weakerMoatRating("Wide", null) === "Wide");
  check("beide fehlend → n/v", weakerMoatRating(null, undefined) === "n/v");
}

console.log("\n=== RSL-Historie (adaptiv, eigene Kurshistorie) ===");
const prices = Array.from({ length: 600 }, (_, i) => ({
  date: new Date(Date.UTC(2023, 0, 1) + i * 86400000).toISOString().slice(0, 10),
  close: 100 + 10 * Math.sin(i / 20),
}));
{
  const lo = rslHistoryStats(prices, 80);
  const hi = rslHistoryStats(prices, 130);
  check("Perzentil 0 bei RSL unter jeder Historie", lo.percentile === 0, JSON.stringify(lo));
  check("Perzentil 1 bei RSL über jeder Historie", hi.percentile === 1, JSON.stringify(hi));
  check("z-Score Vorzeichen folgt der Lage", (lo.zScore ?? 0) < 0 && (hi.zScore ?? 0) > 0);
  const short = rslHistoryStats(prices.slice(0, 200), 90);
  check(`< ${TECH_MOAT_RSL_HISTORY_MIN} RSL-Punkte → kein Perzentil`, short.percentile == null && short.points < TECH_MOAT_RSL_HISTORY_MIN, JSON.stringify(short));
}

console.log("\n=== Kombination: greift / greift nicht / löst sich auf ===");
{
  const weak = { rating: "Narrow" as const, score: 2 };
  const base = { ma50AboveMA200: false, rsl: 87, historicalPrices: prices, ruleMoat: weak, llmMoatRating: "None" };
  const on = evaluateTechMoatOverride(base);
  check("Death Cross + RSL 87 + Moat min(Narrow, None) → aktiv", on.active && on.effectiveMoatRating === "None" && on.moatWeak);
  check("Deckel liegt im NEUTRAL-Band", on.capScore != null && on.capScore >= TECH_MOAT_CAP_FLOOR && on.capScore <= TECH_MOAT_CAP_CEIL
    && overallRatingFromScore(on.capScore) === "NEUTRAL", String(on.capScore));
  check("beide Moat-Werte transparent im Payload", on.ruleMoatRating === "Narrow" && on.ruleMoatScore === 2 && on.llmMoatRating === "None");
  check("Golden Cross → nicht aktiv (Death Cross aufgelöst)", !evaluateTechMoatOverride({ ...base, ma50AboveMA200: true }).active);
  check(`RSL ${TECH_MOAT_RSL_THRESHOLD} → nicht aktiv`, !evaluateTechMoatOverride({ ...base, rsl: TECH_MOAT_RSL_THRESHOLD }).active);
  check("Moat Wide/Wide → nicht aktiv (Moat verbessert)", !evaluateTechMoatOverride({ ...base, ruleMoat: { rating: "Wide", score: 3.5 }, llmMoatRating: "Wide" }).active);
  check("Moat Wide (Regel) + Narrow (KI) → schwach, aktiv", evaluateTechMoatOverride({ ...base, ruleMoat: { rating: "Wide", score: 3.5 }, llmMoatRating: "Narrow" }).active);
  check("keine Technik im Payload → nicht aktiv", !evaluateTechMoatOverride({ ...base, ma50AboveMA200: undefined }).active);
  check("RSL n/a → nicht aktiv", !evaluateTechMoatOverride({ ...base, rsl: null }).active);
  const noHist = evaluateTechMoatOverride({ ...base, historicalPrices: prices.slice(0, 100) });
  check("ohne Historie: Deckel = oberer NEUTRAL-Rand", noHist.active && noHist.capScore === TECH_MOAT_CAP_CEIL, String(noHist.capScore));
  const deeper = evaluateTechMoatOverride({ ...base, rsl: 80 });
  check("tiefere RSL in eigener Historie → tieferer Deckel", (deeper.capScore ?? 99) <= (on.capScore ?? 0), `${deeper.capScore} vs ${on.capScore}`);
}

console.log("\n=== Ganze Analyse (Fixture analysis-MSFT.json, echte Payload-Struktur) ===");
const msft = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8")) as StockAnalysis;
function run(d: StockAnalysis) {
  seedRandom();
  const bias = buildBiasDecision(d);
  const m = prepareFazitMetrics(d);
  const fazit = buildFazitSignal({ data: d, ...m });
  // Gegenprobe: dieselbe Eingabe, Override künstlich aus → Rating vor dem Fazit-Guard.
  seedRandom();
  const m2 = prepareFazitMetrics(d);
  const fazitNoGuard = buildFazitSignal({ data: d, ...m2, bias: { ...m2.bias, techMoatOverride: { ...m2.bias.techMoatOverride, active: false } } });
  return { bias, fazit, fazitNoGuard };
}
{
  // Ohne Kombination (MSFT: Golden Cross, Moat Wide): bitgleich zum ungedeckelten Score.
  const plain = run(msft);
  check("MSFT: Override nicht aktiv", !plain.bias.techMoatOverride.active, plain.bias.techMoatOverride.detail);
  check("MSFT: Gesamtscore === ungedeckelter Score", plain.bias.overallScore === plain.bias.overallScoreUncapped);
  check("MSFT: Label === overallRatingFromScore(ungedeckelt)", plain.bias.overallRating === overallRatingFromScore(plain.bias.overallScoreUncapped));
  check("MSFT: Fazit unverändert", plain.fazit.rating === plain.fazitNoGuard.rating && plain.fazit.fazitSatz === plain.fazitNoGuard.fazitSatz && !plain.fazit.techMoatDowngraded);
  check("MSFT: keine Override-Red-Flag", !plain.bias.redFlags.some(f => f.includes("Tech-Moat-Override")));

  // Kombination hergestellt: Death Cross, LLM-Moat None, Kurs 15 % unter dem 26w-Schnitt (RSL ≈ 85).
  const sorted = [...msft.historicalPrices].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 130);
  const avg26w = sorted.reduce((s, p) => s + p.close, 0) / sorted.length;
  const cs = msft.technicalIndicators!.currentStatus;
  const combo = {
    ...msft,
    currentPrice: avg26w * 0.85,
    technicalIndicators: { ...msft.technicalIndicators!, currentStatus: { ...cs, priceAboveMA200: false, ma50AboveMA200: false, macdAboveZero: false, buySignal: false } },
    moatAssessment: { ...msft.moatAssessment!, overallRating: "None" },
    moatRating: "None",
    // Zusätzlicher positiver Katalysator (GB +20 % → +2.0), damit der ungedeckelte Score über 6.5 liegt
    // und der Deckel tatsächlich greift.
    catalysts: [...(msft.catalysts ?? []), { name: "Test-Katalysator", timeline: "12M", pos: 50, bruttoUpside: 40, einpreisungsgrad: 0, nettoUpside: 40, gb: 20 }],
  } as StockAnalysis;
  const hit = run(combo);
  console.log(`  ℹ Kombination: ungedeckelt ${hit.bias.overallScoreUncapped.toFixed(3)} → ${hit.bias.overallScore.toFixed(3)} ${hit.bias.overallRating}; Fazit ${hit.fazitNoGuard.rating} → ${hit.fazit.rating}`);
  check("Kombination: ungedeckelter Score läge über NEUTRAL (Deckel greift)", hit.bias.overallScoreUncapped >= 6.5, String(hit.bias.overallScoreUncapped));
  const t = hit.bias.techMoatOverride;
  check("Kombination: Override aktiv", t.active, t.detail);
  check("Kombination: Ampel höchstens NEUTRAL", !ABOVE.has(hit.bias.overallRating) && hit.bias.overallScore <= TECH_MOAT_CAP_CEIL, `${hit.bias.overallScore} ${hit.bias.overallRating}`);
  check("Kombination: Gesamtscore = min(ungedeckelt, Deckel)", Math.abs(hit.bias.overallScore - Math.min(hit.bias.overallScoreUncapped, t.capScore!)) < 1e-12);
  check("Kombination: Fazit höchstens NEUTRAL", !ABOVE.has(hit.fazit.rating), hit.fazit.rating);
  check("Kombination: Fazit-Guard stuft nur ATTRAKTIV/LEICHT ab", hit.fazit.techMoatDowngraded === ABOVE.has(hit.fazitNoGuard.rating), `${hit.fazitNoGuard.rating} → ${hit.fazit.rating}`);
  check("Kombination: Fazit-Satz nennt den Override", hit.fazit.fazitSatz.includes("Tech-Moat-Override"));
  check("Kombination: Moat-Multiplikator unverändert (Regel-Moat)", hit.bias.moatMultiplier === plain.bias.moatMultiplier || hit.bias.moatRating !== plain.bias.moatRating);

  // Fazit-Guard isoliert: gleiche Kombination, Bewertungssignale so stark, dass das Fazit ohne Guard
  // über NEUTRAL läge (positive Bewertungsfaktoren dominieren wie bei NVO am 11.10.).
  seedRandom();
  const strongData = { ...combo, peRatio: 10, sectorAvgPE: 25, pegRatio: 0.7, beta5Y: 0.6, fcfMargin: 30,
    analystPT: { ...combo.analystPT, median: combo.currentPrice * 1.3 } } as StockAnalysis;
  const mS = prepareFazitMetrics(strongData);
  const strongMetrics = { ...mS, totalUpside: 20, conservativeUpside: 25, crvConservative: 3, raCrvCons: 3,
    dcfBeiCRV3: strongData.currentPrice * 1.1, totalExpDmg: 5, stressDownside: -10,
    mcResult: { ...mS.mcResult, downsideProb: 0.2 },
    conservativeDCF: { ...mS.conservativeDCF, perShare: strongData.currentPrice * 1.25 },
    reverseDCF: { impliedGrowth: 4, rating: "realistic", referenceGrowth: 10 } };
  const fOn = buildFazitSignal({ data: strongData, ...strongMetrics });
  const fOff = buildFazitSignal({ data: strongData, ...strongMetrics, bias: { ...mS.bias, techMoatOverride: { ...mS.bias.techMoatOverride, active: false } } });
  console.log(`  ℹ Fazit-Guard: ohne Override ${fOff.rating} (Score ${fOff.score}) → mit Override ${fOn.rating}`);
  check("Fazit ohne Guard läge über NEUTRAL", ABOVE.has(fOff.rating), fOff.rating);
  check("Fazit mit Guard = NEUTRAL, Signal-Score unverändert", fOn.rating === "NEUTRAL" && fOn.techMoatDowngraded && fOn.score === fOff.score, `${fOn.rating} ${fOn.score}/${fOff.score}`);
  check("Fazit-Guard ändert die Faktorlisten nicht", JSON.stringify([fOn.positive, fOn.negative, fOn.neutral]) === JSON.stringify([fOff.positive, fOff.negative, fOff.neutral]));

  // Auflösung: Death Cross weg → Bewertung schlägt wieder voll durch.
  const golden = run({ ...combo, technicalIndicators: { ...combo.technicalIndicators!, currentStatus: { ...combo.technicalIndicators!.currentStatus, ma50AboveMA200: true } } } as StockAnalysis);
  check("Golden Cross: Override aus, Score = ungedeckelt", !golden.bias.techMoatOverride.active && golden.bias.overallScore === golden.bias.overallScoreUncapped);
  // Einziger Unterschied im ungedeckelten Score ist die bestehende Technik-Komponente (−0.5 → 0).
  check("Golden Cross: ungedeckelter Score wie Kombination bis auf die Technik-Komponente",
    Math.abs((golden.bias.overallScoreUncapped - golden.bias.technicalComponent) - (hit.bias.overallScoreUncapped - hit.bias.technicalComponent)) < 1e-12,
    `${golden.bias.overallScoreUncapped} vs ${hit.bias.overallScoreUncapped}`);
  // Auflösung: Moat verbessert (KI Wide, Regel-Moat bleibt) → nur aktiv, wenn der Regel-Moat schwach ist.
  const moatUp = run({ ...combo, moatAssessment: { ...combo.moatAssessment!, overallRating: "Wide" }, moatRating: "Wide" } as StockAnalysis);
  const ruleWeak = ["None", "Narrow"].includes(moatUp.bias.techMoatOverride.ruleMoatRating);
  check("Moat Wide (KI): Override folgt dem Minimum", moatUp.bias.techMoatOverride.active === ruleWeak, moatUp.bias.techMoatOverride.detail);
}

console.log(failed === 0 ? "\n✅ Alle Tech-Moat-Override-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
