/**
 * Draft 1 Bilanz-Kalibrierung. Keine FMP-Calls, nur Fixtures.
 * Ausführen: env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-dcf-calibration.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DCF_CALIBRATION, calibrateDcfTerms, calibrationLineText, healthLevelOrNull, impliedGStarPct, resolveGrowthAnchor, resolveGStarPrice, tvShareWarns, waccAddPpForLevel } from "../shared/dcf-calibration";
import { buildBiasDecision, computeRuleBasedMoat, sumUpsideGb } from "../shared/bias-fixes";
import { buildDefaultDCFParams, calculateFCFFDCF, calculateReverseDCF } from "../shared/valuation-signal";
import { computeFazitEntry, fazitEntryForExport } from "../shared/fazit-entry";
import { selectCatalystBase } from "../shared/catalyst-base";
import { pdfCalibrationRows, pdfCatalystTarget } from "../server/pdf-export";
import { Section5 } from "../client/src/components/sections/Section5";
import { Section6 } from "../client/src/components/sections/Section6";
import type { StockAnalysis } from "../shared/schema";

const saved = {
  enabled: DCF_CALIBRATION.enabled,
  stageModel: DCF_CALIBRATION.stageModel,
  forceSpotPrice: DCF_CALIBRATION.forceSpotPrice,
};

function restore() {
  DCF_CALIBRATION.enabled = saved.enabled;
  DCF_CALIBRATION.stageModel = saved.stageModel;
  DCF_CALIBRATION.forceSpotPrice = saved.forceSpotPrice;
}

const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")) as StockAnalysis;
const shel = JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8")) as StockAnalysis;
const pinFile = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function n(v: number, d = 2): string {
  return Number.isFinite(v) ? v.toFixed(d) : "n/a";
}

function row(data: StockAnalysis) {
  const bias = buildBiasDecision(data);
  const entry = computeFazitEntry(data);
  const fe = fazitEntryForExport(data);
  const gb = sumUpsideGb(data.catalysts);
  const base = selectCatalystBase(bias.decisionPerShare, gb, data.currentPrice, data.analystPT?.median ?? 0);
  const uiTarget = base.base * (1 + gb / 100);
  const pdf = pdfCatalystTarget(data, fe, gb);
  const dcf = calculateFCFFDCF(buildDefaultDCFParams(data));
  return { bias, entry, uiTarget, pdfTarget: pdf?.target ?? Number.NaN, pdfBase: pdf?.base ?? Number.NaN, dcf: dcf.perShare, wacc: dcf.wacc, tv: dcf.enterpriseValue > 0 ? (dcf.pvTerminal / dcf.enterpriseValue) * 100 : Number.NaN };
}

try {
  assert.equal(DCF_CALIBRATION.enabled, false, "Default-Flag");
  assert.equal(pinFile.MSFT.overallScore, 4.058137820476081);
  const msftOff = buildBiasDecision(msft);
  const shelOff = buildBiasDecision(shel);
  assert.equal(msftOff.overallScore, 5.638130012567666);
  assert.equal(msftOff.decisionPerShare, 385.6067352818258);
  assert.equal(shelOff.decisionPerShare, 58.550963145898166);
  assert.equal(msftOff.calibration, undefined);
  assert.equal("calibration" in msftOff, false);
  console.log(`PIN Flag aus: Fixture-MSFT-Score ${pinFile.MSFT.overallScore} (script/fixtures/prod-analyze-dcf-2026-10-25.json expectOldHead, Quelle Fixture)`);
  console.log(`PIN Flag aus: Buffett/buildBiasDecision MSFT ${msftOff.overallScore} (script/fixtures/analysis-MSFT.json, Quelle Fixture über buildBiasDecision)`);
  console.log(`PIN Flag aus: SHEL.L decision ${shelOff.decisionPerShare} score ${shelOff.overallScore}`);

  const raw = buildDefaultDCFParams(msft);
  const fcff = calculateFCFFDCF(raw);
  const rev = calculateReverseDCF({
    currentPrice: msft.currentPrice,
    fcfBase: msft.fcfTTM,
    wacc: fcff.wacc,
    sharesOutstanding: msft.sharesOutstanding,
    netDebt: msft.totalDebt - msft.cashEquivalents,
    fcfHaircut: msft.fcfHaircut ?? 0,
    sectorG1: msft.sectorProfile.growthAssumptions.g1,
    epsGrowthNext5Y: msft.epsGrowth5Y,
  });
  const gLocal = impliedGStarPct({
    price: msft.currentPrice,
    fcf: msft.fcfTTM,
    waccPct: fcff.wacc,
    shares: msft.sharesOutstanding,
    netDebt: msft.totalDebt - msft.cashEquivalents,
    fcfHaircutPct: msft.fcfHaircut ?? 0,
  });
  assert.equal(gLocal, rev.impliedGrowth);
  console.log(`g* Gegenprobe MSFT Tageskurs: impliedGStarPct ${gLocal} = calculateReverseDCF ${rev.impliedGrowth} (Formel valuation-signal.ts, WACC roh ${fcff.wacc}, Quelle Fixture)`);

  for (const data of [msft, shel]) {
    const px = resolveGStarPrice({ spot: data.currentPrice, historicalPrices: data.historicalPrices });
    assert.equal(px.source, "3m-avg");
    assert.ok(px.points >= 60);
    console.log(`3M-Fenster ${data.ticker}: ${px.reason} Schnitt ${px.price.toFixed(4)} vs Tageskurs ${data.currentPrice} (Quelle Fixture historicalPrices)`);
  }
  const short = resolveGStarPrice({ spot: 10, historicalPrices: [{ date: "2026-10-01", close: 10 }, { date: "2026-10-02", close: 11 }] });
  assert.equal(short.source, "tageskurs");
  assert.match(short.reason, /Abweichung/);

  const anchor = resolveGrowthAnchor({
    istYoY: msft.financialStatements!.incomeStatement.revenueGrowth,
    sectorG1: msft.sectorProfile.growthAssumptions.g1,
    consensus: { years2to3: 1, medianYears3to5: 2, guidanceMid: 3 },
  });
  assert.equal(anchor.source, "ist-yoy");
  assert.equal(anchor.gAnker, msft.financialStatements!.incomeStatement.revenueGrowth);
  assert.match(anchor.detail, /nicht gelesen/);
  const sectorOnly = resolveGrowthAnchor({ istYoY: null, sectorG1: 5, consensus: null });
  assert.equal(sectorOnly.source, "sektor-g1");
  assert.equal(sectorOnly.gAnker, 5);
  const missing = resolveGrowthAnchor({ istYoY: Number.NaN, sectorG1: null, consensus: null });
  assert.equal(missing.source, "fehlt");
  assert.equal(missing.gAnker, null);

  assert.equal(tvShareWarns(74.9), false);
  assert.equal(tvShareWarns(75), false);
  assert.equal(tvShareWarns(75.1), true);
  console.log("TV-Schwelle: 74,9 % kein Hinweis, 75,0 % kein Hinweis, 75,1 % Hinweis (Schwelle > 75, synthetisch)");

  assert.equal(healthLevelOrNull("Excellent"), 0);
  assert.equal(healthLevelOrNull("Critical"), 4);
  assert.equal(healthLevelOrNull("nope"), null);
  for (let level = 0; level <= 4; level++) {
    assert.equal(waccAddPpForLevel(level, "stetig"), DCF_CALIBRATION.waccPerLevelPp * level);
  }
  assert.deepEqual([0, 1, 2, 3, 4].map(level => waccAddPpForLevel(level, "dreiStufen")), [0, 0, 1, 2, 2]);

  const cap = calibrateDcfTerms({
    health: "Excellent",
    level: 0,
    model: "stetig",
    g1Model: 15,
    terminalModel: 3,
    waccRohPct: 10.06,
    anchor: anchor,
    istYoY: anchor.gAnker,
    gStarPct: 8,
    priceInfo: resolveGStarPrice({ spot: 1, historicalPrices: msft.historicalPrices }),
  });
  assert.equal(cap.terminalAfter, 2.5);
  const tight = calibrateDcfTerms({
    health: "Moderate",
    level: 2,
    model: "stetig",
    g1Model: 4,
    terminalModel: 3,
    waccRohPct: 5,
    anchor: { gAnker: 4, source: "ist-yoy", detail: "synthetisch" },
    istYoY: 4,
    gStarPct: 1,
    priceInfo: { price: 1, source: "tageskurs", points: 0, from: null, to: null, reason: "synthetisch" },
  });
  assert.equal(tight.terminalAfter, Math.min(3, 2.5, 5 + 0.8 - 3));
  assert.ok(cap.rules.every(rule => rule.relation === "ersetzt" || rule.relation === "ergaenzt"));
  assert.ok(cap.rules.every(rule => rule.ref.includes("bias-fixes.ts:")));

  const moatInput = {
    grossMarginPct: null,
    roic5YPct: null,
    sectorMedianRoic5YPct: null,
    fcfMarginStableOrRising: null,
    switchingOrNetwork: null,
    intangiblesStrong: null,
    governmentExposurePct: 0,
    highRivalry: false,
    llmMode: true,
    existingRating: "Wide",
  };
  const moatOff = computeRuleBasedMoat(moatInput);
  assert.equal(moatOff.kiDelta, 1.5);
  assert.equal(moatOff.moatFaktor, undefined);
  DCF_CALIBRATION.enabled = true;
  const moatOn = computeRuleBasedMoat(moatInput);
  assert.equal(moatOn.moatFaktor, 1);
  assert.equal(moatOn.kiDeltaRoh, 1.5);
  assert.equal(moatOn.kiDelta, 1.5);
  assert.equal(moatOn.rating, moatOff.rating);
  DCF_CALIBRATION.enabled = false;
  console.log(`Moat-Nachlauf llmMode: Flag aus kiDelta ${moatOff.kiDelta} ohne moatFaktor-Feld; Flag an moatFaktor ${moatOn.moatFaktor}, Roh ${moatOn.kiDeltaRoh}, angewendet ${moatOn.kiDelta} (weiter voll, separate Freigabe)`);

  const levels = ["Excellent", "Good", "Moderate", "Weak", "Critical"] as const;
  for (const model of ["stetig", "dreiStufen"] as const) {
    DCF_CALIBRATION.enabled = true;
    DCF_CALIBRATION.stageModel = model;
    DCF_CALIBRATION.forceSpotPrice = false;
    const values: number[] = [];
    const adds: number[] = [];
    for (const health of levels) {
      const sample = clone(msft);
      sample.financialStatements!.health = health;
      const bias = buildBiasDecision(sample);
      values.push(bias.decisionPerShare);
      adds.push(bias.calibration?.waccAddPp ?? Number.NaN);
    }
    assert.equal(adds[0], waccAddPpForLevel(0, model === "stetig" ? "stetig" : "dreiStufen"));
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i] <= values[i - 1] + 1e-6, `${model} ${levels[i]} ${values[i]} > ${values[i - 1]}`);
      if (model === "stetig") assert.equal(adds[i], waccAddPpForLevel(i, "stetig"));
    }
    console.log(`Stetigkeit ${model}: DCF ${values.map(v => n(v)).join(" → ")} | WACC-Add ${adds.map(v => n(v)).join(" → ")} (MSFT-Fixture, health überschrieben, Quelle Fixture+Formel)`);
  }

  console.log("\nVorher/Nachher (Quelle: script/fixtures/analysis-MSFT.json und analysis-SHEL.L.json, keine FMP-Calls)");
  console.log("Modell | Ticker | DCF | decision | Entry | CRV | Score | Ziel UI | Ziel PDF | WACC-Summe | g-Abschlag | g* | Kursquelle");
  const before = new Map<string, ReturnType<typeof row>>();
  DCF_CALIBRATION.enabled = false;
  for (const data of [msft, shel]) before.set(data.ticker, row(data));
  for (const model of ["stetig", "dreiStufen"] as const) {
    DCF_CALIBRATION.enabled = true;
    DCF_CALIBRATION.stageModel = model;
    DCF_CALIBRATION.forceSpotPrice = false;
    for (const data of [msft, shel]) {
      const prev = before.get(data.ticker)!;
      const next = row(data);
      assert.equal(next.uiTarget, next.pdfTarget);
      const cal = next.bias.calibration!;
      assert.ok(cal.rules.length >= 6);
      console.log(`vorher ${data.ticker}: DCF ${n(prev.dcf)} decision ${n(prev.bias.decisionPerShare, 4)} Entry ${n(prev.entry.dcfBeiCRV3)} CRV ${n(prev.entry.crvConservative)} Score ${n(prev.bias.overallScore, 4)} Ziel ${n(prev.uiTarget)}`);
      console.log(`${model} ${data.ticker}: DCF ${n(next.dcf)} decision ${n(next.bias.decisionPerShare, 4)} Entry ${n(next.entry.dcfBeiCRV3)} CRV ${n(next.entry.crvConservative)} Score ${n(next.bias.overallScore, 4)} ZielUI ${n(next.uiTarget)} ZielPDF ${n(next.pdfTarget)}`);
      console.log(`  ${calibrationLineText(cal)}`);
      console.log(`  Summe WACC ${n(cal.waccSumPp)} Pp (Health ${n(cal.waccAddPp)} + Bias an ${n(cal.biasUpliftAppliedPp)}; ersetzt nicht addiert ${n(cal.biasUpliftReplacedPp)}) + g-Abschlag ${n(cal.gDropPp)} Pp | g* ${cal.gStarPct == null ? "n/a" : n(cal.gStarPct, 4)} ${cal.gStarPriceSource} | Anker ${cal.anchorSource} ${cal.gAnker} | ${cal.gStarCapNote}`);
      for (const rule of cal.rules) console.log(`  Regel ${rule.relation} ${rule.ref} ${rule.id}: ${rule.detail}`);
    }
  }

  DCF_CALIBRATION.enabled = false;
  const synthetic = clone(msft);
  synthetic.financialStatements!.health = "Excellent";
  synthetic.currentPrice = 100;
  synthetic.ticker = "SYN-A";
  const beforeA = buildBiasDecision(synthetic).decisionPerShare;
  DCF_CALIBRATION.enabled = true;
  DCF_CALIBRATION.stageModel = "stetig";
  const afterA = buildBiasDecision(synthetic).decisionPerShare;
  assert.ok(beforeA > synthetic.currentPrice * 1.2, `Gegenprobe a vorher ${beforeA}`);
  assert.ok(afterA > synthetic.currentPrice, `Gegenprobe a nachher ${afterA}`);
  console.log(`Gegenprobe (a) SYN-A Excellent, Kurs 100 synthetisch auf MSFT-Fixture: vorher ${n(beforeA)} (>20 % über Kurs) nachher ${n(afterA)} bleibt über Kurs. Konsens nicht im Payload (analyze-route.ts:925–935 nur EPS), nicht geschätzt.`);

  DCF_CALIBRATION.enabled = false;
  const beforeB = buildBiasDecision(shel).decisionPerShare;
  DCF_CALIBRATION.enabled = true;
  const afterB = buildBiasDecision(shel).decisionPerShare;
  const gapB = (afterB / shel.currentPrice - 1) * 100;
  console.log(`Gegenprobe (b) Beobachtung, kein Abnahmekriterium: SHEL.L Moderate vorher ${n(beforeB)} nachher ${n(afterB)} Abstand zum Kurs ${n(gapB)} % (Kurs ${shel.currentPrice}, Quelle Fixture). Kein Fit auf den Kurs.`);
  assert.ok(Number.isFinite(afterB));

  console.log("DCF-Reaktion ±20 % Kurs, RSL festgehalten, nur g*-Kanal (Quelle Fixture-Preise):");
  const baseRsl = buildDefaultDCFParams(msft).rsl;
  for (const data of [msft, shel]) {
    for (const smooth of [true, false]) {
      DCF_CALIBRATION.enabled = true;
      DCF_CALIBRATION.stageModel = "stetig";
      DCF_CALIBRATION.forceSpotPrice = !smooth;
      const at = (price: number) => {
        const sample = clone(data);
        sample.currentPrice = price;
        const params = { ...buildDefaultDCFParams(sample), rsl: baseRsl };
        return calculateFCFFDCF(params).perShare;
      };
      const mid = at(data.currentPrice);
      const up = (at(data.currentPrice * 1.2) / mid - 1) * 100;
      const dn = (at(data.currentPrice * 0.8) / mid - 1) * 100;
      console.log(`  ${data.ticker} ${smooth ? "mit 3M" : "Tageskurs"}: +20 % → ${n(up)} %, −20 % → ${n(dn)} %`);
      if (smooth) {
        assert.ok(Math.abs(up) < 20 && Math.abs(dn) < 20, `${data.ticker} Glättung ${up} ${dn}`);
      }
    }
  }

  DCF_CALIBRATION.enabled = false;
  DCF_CALIBRATION.forceSpotPrice = false;
  console.log("g* selbst bei ±20 % Kurs (nicht der DCF; der g*-Deckel bindet auf diesen Fixtures nicht, weil der Anker das Ist-YoY ist):");
  for (const data of [msft, shel]) {
    const wacc = buildDefaultDCFParams(data).waccOverride;
    const roh = calculateFCFFDCF(buildDefaultDCFParams(data)).wacc;
    const star = (price: number) => impliedGStarPct({
      price,
      fcf: data.fcfTTM,
      waccPct: roh,
      shares: data.sharesOutstanding,
      netDebt: data.totalDebt - data.cashEquivalents,
      fcfHaircutPct: data.fcfHaircut ?? 0,
    });
    const smoothPx = resolveGStarPrice({ spot: data.currentPrice, historicalPrices: data.historicalPrices }).price;
    const spot = star(data.currentPrice)!;
    const up = (star(data.currentPrice * 1.2)! / spot - 1) * 100;
    const dn = (star(data.currentPrice * 0.8)! / spot - 1) * 100;
    console.log(`  ${data.ticker} Tageskurs-g* ${n(spot, 2)} | +20 % ${n(up)} % | −20 % ${n(dn)} % | 3M-g* ${n(star(smoothPx)!, 2)} (WACC ${n(roh)}, Override ${String(wacc)})`);
    assert.ok(Math.abs(up) > 0 && Math.abs(dn) > 0);
  }

  DCF_CALIBRATION.enabled = false;
  delete (msft as { calibration?: unknown }).calibration;
  const cached = clone(msft);
  // Die Score-Fixture hat kein description/industry. Die Produktionsanalyse hat beides.
  // Nur der Render-Harness füllt leere Strings, damit Section5 die echte Komponente durchläuft.
  cached.description = cached.description ?? "";
  cached.industry = cached.industry ?? "";
  assert.equal(Object.prototype.hasOwnProperty.call(cached, "calibration"), false);
  const htmlOff5 = renderToStaticMarkup(React.createElement(Section5, { data: cached }));
  const htmlOff6 = renderToStaticMarkup(React.createElement(Section6, { data: cached }));
  assert.equal(htmlOff5.includes("Bilanz-Kalibrierung"), false);
  assert.equal(htmlOff6.includes("Bilanz-Kalibrierung"), false);
  assert.equal(pdfCalibrationRows(cached), "");
  const bogus = clone(cached);
  bogus.calibration = { lage: 9, waccAddPp: 99, g1Before: 1, g1After: 2, terminalBefore: 1, terminalAfter: 2, tvSharePct: 99 };
  const htmlBogusOff = renderToStaticMarkup(React.createElement(Section5, { data: bogus }));
  assert.equal(htmlBogusOff.includes("Stufe 9"), false);
  DCF_CALIBRATION.enabled = true;
  DCF_CALIBRATION.stageModel = "stetig";
  const htmlOn = renderToStaticMarkup(React.createElement(Section5, { data: bogus }));
  const htmlOn6 = renderToStaticMarkup(React.createElement(Section6, { data: cached }));
  assert.ok(htmlOn.includes("Bilanz-Kalibrierung"));
  assert.ok(htmlOn.includes("Stufe 0"));
  assert.equal(htmlOn.includes("Stufe 9"), false);
  assert.equal(htmlOn.includes("WACC +99"), false);
  assert.ok(htmlOn6.includes("Bilanz-Kalibrierung"));
  assert.ok(pdfCalibrationRows(cached).includes("pdf-s5-calibration"));
  console.log("Cache ohne calibration-Feld: Section5/Section6 und PDF-Zeile ohne Wurf. Gespeichertes calibration.lage=9 wird nicht angezeigt.");

  DCF_CALIBRATION.enabled = false;
  assert.equal(buildBiasDecision(msft).overallScore, 5.638130012567666);
  assert.equal(pinFile.MSFT.overallScore, 4.058137820476081);
  console.log("PIN nach den Läufen unverändert: MSFT 4.058137820476081, Buffett 5.638130012567666");
  console.log("dcf-calibration: ok");
} finally {
  restore();
}
