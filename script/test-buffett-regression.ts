/**
 * Buffett-Regression: β aus der Reihe, Score aus dem Residuum, keine 200-%-Zone.
 * Lauf: npx tsx script/test-buffett-regression.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buffettReading } from "../server/recession";
import {
  BUFFETT_REGRESSION_PARAMS,
  BUFFETT_SECTOR_UNAVAILABLE,
  applyRegressionToSlot,
  assembleBuffettRegression,
  historyMinimum,
  quarterKey,
  unavailableRegression,
  type DatedValue,
} from "../server/buffett-regression";

let checks = 0;
function check(label: string, ok: boolean, detail = ""): void {
  assert.equal(ok, true, `${label} ${detail}`);
  checks += 1;
  console.log(`  ok ${label}`);
}

function quarterDate(index: number): string {
  const year = 2000 + Math.floor(index / 4);
  const month = (index % 4) * 3 + 1;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

console.log("\n=== Quartalsschlüssel und benannte Parameter ===");
{
  check("Q1", quarterKey("2024-02-15") === "2024Q1");
  check("Q4", quarterKey("2024-12-31") === "2024Q4");
  check("ungültiges Datum", quarterKey("2024/01/01") === null);
  check("CAGR-Lag ist SMOOTH_QUARTERS", BUFFETT_REGRESSION_PARAMS.cagrLagQuarters === 40);
  check("Gewicht und Rohnote-Decke sind benannt", BUFFETT_REGRESSION_PARAMS.weight === 2 && BUFFETT_REGRESSION_PARAMS.rawCap === 8);
  check("z-Clip ist der Fiskal-Clip", BUFFETT_REGRESSION_PARAMS.zClip === 2);
  check("Mindestlänge wächst mit der Spaltenzahl", historyMinimum(3) === 5 && historyMinimum(1) === 3);
  const source = readFileSync(new URL("../server/buffett-regression.ts", import.meta.url), "utf8");
  check("keine 200-Prozent-Zone im Modul", !source.includes(">200") && !source.includes("165"));
}

console.log("\n=== β aus einer bekannten Gerade, Residuum 0 bleibt neutral ===");
{
  const lag = 4;
  const n = 28;
  const profits: DatedValue[] = [];
  const gdp: DatedValue[] = [];
  const realRates: DatedValue[] = [];
  const ratios: { date: string; ratio: number }[] = [];
  const sector: DatedValue[] = [];
  const profitLevel: number[] = [];
  for (let index = 0; index < lag; index++) profitLevel[index] = 100 + index;
  for (let index = 0; index < n; index++) {
    const date = quarterDate(index);
    const cagrDriver = 4 + Math.sin(index / 3);
    const margin = 8 + (index % 5);
    const real = 0.5 + (index % 3) * 0.7;
    if (index >= lag) profitLevel[index] = profitLevel[index - lag] * (1 + cagrDriver / 100);
    const profit = profitLevel[index];
    profits.push({ date, value: profit });
    gdp.push({ date, value: profit / (margin / 100) });
    realRates.push({ date, value: real });
    const ratio = 190 + 1.5 * cagrDriver + 2 * margin - 3 * real;
    ratios.push({ date, ratio });
    sector.push({ date, value: 0.2 + Math.sin(index / 2) * 0.05 });
  }
  const fit = assembleBuffettRegression({
    ratios,
    profits,
    gdp,
    realRates,
    sectorShares: null,
    cagrLagQuarters: lag,
  });
  check("Fit steht", fit.available, fit.reason ?? "");
  check("Sektor fehlt live und im Koeffizienten", fit.sectorNote === BUFFETT_SECTOR_UNAVAILABLE && !fit.coefficients.some(item => item.name === "ΔSektor"));
  const cagrBeta = fit.coefficients.find(item => item.name === "Gewinn-CAGR")?.beta ?? NaN;
  const marginBeta = fit.coefficients.find(item => item.name === "Gewinnmarge")?.beta ?? NaN;
  const realBeta = fit.coefficients.find(item => item.name === "Realzins")?.beta ?? NaN;
  check("β Gewinn-CAGR ≈ 1.5", Math.abs(cagrBeta - 1.5) < 1e-6, String(cagrBeta));
  check("β Marge ≈ 2", Math.abs(marginBeta - 2) < 1e-6, String(marginBeta));
  check("β Realzins ≈ −3", Math.abs(realBeta - (-3)) < 1e-6, String(realBeta));
  check("Punkt auf der Geraden hat Residuum ~0", fit.residual != null && Math.abs(fit.residual) < 1e-6, String(fit.residual));
  check("z ~0 und Rohnote 0, nicht die 200-%-Zone", fit.residualZ != null && Math.abs(fit.residualZ) < 1e-6 && fit.rawScore === 0, `z=${fit.residualZ} raw=${fit.rawScore}`);
  const last = ratios[ratios.length - 1];
  const zoneWouldBe = buffettReading(last.ratio);
  check("dieselbe Quote läge in der alten Zone über 0", zoneWouldBe.rawScore > 0 && last.ratio > 140, `${last.ratio} alt raw=${zoneWouldBe.rawScore}`);
  check("Perzentil liegt in 0…1", fit.residualPercentile != null && fit.residualPercentile >= 0 && fit.residualPercentile <= 1);

  const shocked = assembleBuffettRegression({
    ratios: ratios.map((point, index) => index === ratios.length - 1 ? { ...point, ratio: point.ratio + 40 } : point),
    profits,
    gdp,
    realRates,
    sectorShares: null,
    cagrLagQuarters: lag,
  });
  check("Quote über der Geraden hebt die Rohnote", shocked.available && (shocked.rawScore ?? 0) > 0, `raw=${shocked.rawScore} z=${shocked.residualZ}`);
  check("angepasste Linie hat einen Punkt je Zeile", shocked.curve.length === fit.curve.length && shocked.curve.length > 4);

  const withSector = assembleBuffettRegression({
    ratios,
    profits,
    gdp,
    realRates,
    sectorShares: sector,
    cagrLagQuarters: lag,
  });
  check("übergebene Sektorreihe wird zur Spalte", withSector.available && withSector.coefficients.some(item => item.name === "ΔSektor"), withSector.reason ?? "");
}

console.log("\n=== Fehlende Reihe bleibt n/a, Slot ohne Druck bleibt zu ===");
{
  const empty = assembleBuffettRegression({ ratios: [], profits: [], gdp: [], realRates: [] });
  check("leere Quote", empty.available === false && empty.reason?.includes("Buffett-Reihe leer") === true, empty.reason ?? "");
  const short = unavailableRegression("n/a — zu wenige gemeinsame Quartale (1)");
  const closed = applyRegressionToSlot({
    name: "Buffett Indikator (TMC/GDP)",
    value: "195% (2020-01)",
    rawScore: 0,
    weight: 0,
    weightedScore: 0,
    maxWeighted: 0,
    zone: "N/A",
    source: "Yahoo ^W5000 / FRED GDP",
    description: "Wilshire",
    available: false,
  }, short);
  check("stale Slot bleibt 0", closed.available === false && closed.weightedScore === 0 && closed.zone === "N/A");
  const live = applyRegressionToSlot({
    name: "Buffett Indikator (TMC/GDP)",
    value: "210%",
    rawScore: 8,
    weight: 2,
    weightedScore: 16,
    maxWeighted: 16,
    zone: "Extrem überbewertet",
    source: "Yahoo ^W5000 / FRED GDP",
    description: "Wilshire / BIP.",
    available: true,
  }, short);
  check("ohne Fit bleibt die Zone und der Grund steht in der Beschreibung", live.rawScore === 8 && live.description.includes("Regression n/a"), live.description);
}

console.log(`\n${checks} Checks grün`);
