/**
 * F10-20 (AISC-Marge) und F10-24 (Fiskaldefizit) als Zusatzschicht — nur Anzeige, GIS/adaptiver Score unverändert.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-gold-extra-signals.ts
 */
import { readFileSync } from "node:fs";
import { deepStrictEqual } from "node:assert";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  const mod = await import("../shared/gold-extra-signals").catch(() => null);
  check("shared/gold-extra-signals vorhanden", mod != null);
  if (!mod) { console.error(`\n${failed} Fehler`); process.exit(1); }
  const { goldAiscMarginSignal, goldFiscalDeficitSignal, buildGoldExtraSignals } = mod;
  const { loadGoldAiscSeries } = await import("../server/gold-aisc");
  const { parseFredHistoryCsv } = await import("../server/gold-routes");
  const { scoreGoldAdaptive } = await import("../server/gold-adaptive-score");

  console.log("\nF10-20 AISC-Marge (echte server/data/gold-aisc.json)");
  const series = loadGoldAiscSeries();
  check("AISC-Reihe geladen", series != null && series.quarters.length > 0);
  const last = [...series!.quarters].reverse().find(q => q.aisc != null)!;
  const date = "2099-01-01";
  const m = goldAiscMarginSignal(last.aisc! * 2, series, date);
  check("Marge = (P − AISC)/AISC", m.margin != null && Math.abs(m.margin - 1) < 1e-12, String(m.margin));
  check("Quartal der letzten belegten Stufe", m.quarter === last.quarter && m.aisc === last.aisc);
  check("Stress ok bei doppeltem AISC", m.stress === "ok");
  check("Stresszone < AISC × 1,10", goldAiscMarginSignal(last.aisc! * 1.05, series, date).stress === "stress");
  check("unter AISC -> below, Marge negativ", (() => { const s = goldAiscMarginSignal(last.aisc! * 0.9, series, date); return s.stress === "below" && s.margin! < 0; })());
  check("ohne Reihe n/a", goldAiscMarginSignal(3000, null, date).margin === null && goldAiscMarginSignal(3000, null, date).stress === "na");
  check("vor erstem Quartal n/a", goldAiscMarginSignal(3000, series, "1990-01-01").margin === null);
  check("Preis 0 n/a", goldAiscMarginSignal(0, series, date).margin === null);

  console.log("\nF10-24 Fiskaldefizit (echte FRED-Daten MTSDS133FMS, Fixture)");
  const pts = parseFredHistoryCsv(readFileSync(new URL("./fixtures/fred-mtsds133fms.csv", import.meta.url), "utf-8"));
  check("Fixture >= 24 Monate", pts.length >= 24, String(pts.length));
  const f = goldFiscalDeficitSignal(pts);
  const l24 = pts.slice(-24);
  const exp = -l24.slice(12).reduce((s, p) => s + p.value, 0);
  const expPrior = -l24.slice(0, 12).reduce((s, p) => s + p.value, 0);
  check("12M-Defizit = −Summe letzte 12", Math.abs(f.deficit12m! - exp) < 1e-6);
  check("Vorjahr = −Summe Monate 13–24", Math.abs(f.deficit12mPrior! - expPrior) < 1e-6);
  check("Wachstum", Math.abs(f.growth! - (exp - expPrior) / expPrior) < 1e-12);
  check("Richtung positiv genau dann, wenn Defizit wächst", f.direction === (exp > expPrior ? "positive" : "negative"));
  check("letzter Monat", f.latestMonth === pts.at(-1)!.date);
  check("< 24 Monate -> n/a", goldFiscalDeficitSignal(pts.slice(-23)).direction === "na");
  check("leer/null -> n/a", goldFiscalDeficitSignal(null).growth === null && goldFiscalDeficitSignal([]).direction === "na");
  const gap = pts.slice(-25).filter((_, i) => i !== 12);
  check("Monatslücke -> n/a (keine Interpolation)", goldFiscalDeficitSignal(gap).direction === "na");

  console.log("\nKein Score-Einfluss");
  const src = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf-8");
  check("scoreGoldAdaptive bekommt weiter aisc: null", /aisc: null,/.test(src));
  const gisPart = src.slice(src.indexOf("app.get(\"/api/analyze-gold\""), src.indexOf("const extraSignals"));
  check("extraSignals erst nach GIS/Score/Gates gebaut", gisPart.includes("const gates = [") && gisPart.includes("scoreGoldAdaptive({") && !/extraSignals|deficitPoints/.test(gisPart.replace(/const deficitPromise[^\n]*\n/, "")));
  const extra = buildGoldExtraSignals({ price: 4000, date, aiscLine: series, deficitPoints: pts });
  check("inScore false", extra.inScore === false);
  const days = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10));
  const input: any = {
    closes: days.map((d, i) => ({ date: d, close: 2000 + i * 3 + 40 * Math.sin(i / 9) })), volumes: null, volumeSource: null,
    real10Y: days.map((d, i) => ({ date: d, value: 2 - i / 400 })), fedFunds: days.map(d => ({ date: d, value: 4.3 })),
    m2: days.map((d, i) => ({ date: d, value: 21000 + i })), walcl: days.map((d, i) => ({ date: d, value: 7e6 - i * 100 })),
    tga: null, rrpBillions: null, breakeven: days.map(d => ({ date: d, value: 2.3 })), dxy: days.map((d, i) => ({ date: d, value: 104 - i / 100 })),
    aisc: null, regime: "neutral", newsFlag: null, gis: 0.25, now: "2025-02-04T00:00:00.000Z",
  };
  const before = scoreGoldAdaptive(structuredClone(input));
  buildGoldExtraSignals({ price: 4000, date, aiscLine: series, deficitPoints: pts });
  const after = scoreGoldAdaptive(structuredClone(input));
  let same = true; try { deepStrictEqual(after, before); } catch { same = false; }
  check("adaptiver Score deepEqual vor/nach Zusatzschicht", same);

  console.log("\nKarte (SSR)");
  const { GoldExtraSignalsCard } = await import("../client/src/components/gold/GoldExtraSignalsCard");
  const html = renderToStaticMarkup(React.createElement(GoldExtraSignalsCard, { data: { extraSignals: extra } }));
  check("Zeilen AISC-Marge und Fiskaldefizit", html.includes("gold-extra-aisc-margin") && html.includes("gold-extra-fiscal-deficit"));
  check("Hinweis ohne Score", html.includes("fließt nicht in GIS"));
  const naHtml = renderToStaticMarkup(React.createElement(GoldExtraSignalsCard, { data: {} }));
  check("ohne Feld: n/a statt Ersatzwerte", naHtml.includes("gold-extra-missing"));
  const dash = readFileSync(new URL("../client/src/pages/GoldDashboard.tsx", import.meta.url), "utf-8");
  check("Dashboard bindet Karte ein", dash.includes("<GoldExtraSignalsCard data={data} />"));

  console.log(failed ? `\n${failed} Fehler` : "\nAlle Checks grün");
  process.exit(failed ? 1 : 0);
})();
