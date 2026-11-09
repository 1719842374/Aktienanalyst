/**
 * Future_10 §5 (B1) — AISC-Linie im Gold-Chart: belegte Quartalsdaten, Ø-Stufen, Stresszone, kein Score-Einfluss.
 * Ausführen: npx tsx script/test-gold-aisc-line.ts
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";
import {
  GOLD_AISC_OFFLINE_LABEL,
  goldAiscAvailability,
  aiscBands,
  aiscStressRuns,
  attachAiscToChart,
  buildGoldAiscSeries,
  GOLD_AISC_FORMULA,
  goldAiscNaReason,
  goldAiscStepAt,
  goldAiscStress,
  quarterPeriodEnd,
  validateGoldAiscFile,
  type GoldAiscFile,
} from "../shared/gold-aisc";
import { loadGoldAiscSeries } from "../server/gold-aisc";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const root = process.cwd();
const file = JSON.parse(readFileSync(path.join(root, "server/data/gold-aisc.json"), "utf8")) as GoldAiscFile;

console.log("\nDatei server/data/gold-aisc.json ist belegt");
{
  const errors = validateGoldAiscFile(file);
  check("Validierung ohne Fehler", errors.length === 0, errors.join("; "));
  check("112 Werte (Historie 2016-Q3…2023-Q4 plus NEM/B/AEM × 2024-Q1…2026-Q2)", file.values.length === 112, String(file.values.length));
  check("jeder Wert hat https-Quelle + Datum", file.values.every(v => /^https:\/\//.test(v.sourceUrl) && /^\d{4}-\d{2}-\d{2}$/.test(v.sourceDate)));
  check("jede Quelle liegt nach dem Quartalsende", file.values.every(v => v.sourceDate > quarterPeriodEnd(v.quarter)));
  const nem = (q: string) => file.values.find(v => v.company === "NEM" && v.quarter === q)?.aisc;
  check("Stichprobe NEM 2025-Q4 = 1302", nem("2025-Q4") === 1302);
  check("Stichprobe B 2026-Q2 = 1866", file.values.find(v => v.company === "B" && v.quarter === "2026-Q2")?.aisc === 1866);
  check("Stichprobe AEM 2024-Q1 = 1190", file.values.find(v => v.company === "AEM" && v.quarter === "2024-Q1")?.aisc === 1190);
  const bad = validateGoldAiscFile({ ...file, values: [...file.values, { ...file.values[0], sourceUrl: "http://x" }] });
  check("Validierung erkennt Duplikat + Nicht-https", bad.some(e => /doppelt/i.test(e)) && bad.some(e => /https/i.test(e)), bad.join("; "));
}

console.log("\nLookahead-Kennzeichnung (Quelle nach der Chart-Stufe eingereicht)");
{
  const LAG = 60;
  const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
  const late = file.values.filter(v => v.sourceDate > addDays(quarterPeriodEnd(v.quarter), LAG));
  const ids = late.map(v => `${v.company} ${v.quarter}`).sort();
  const expected = ["AEM", "B", "NEM"].flatMap(c => ["2024-Q1", "2024-Q2", "2024-Q3", "2024-Q4"].map(q => `${c} ${q}`))
    .concat(["NEM 2025-Q1", "NEM 2025-Q2", "NEM 2025-Q3", "B 2020-Q2", "B 2020-Q4", "B 2022-Q2"]).sort();
  check(`18 Werte nicht point-in-time (15 aus 2024/2025 plus Barrick 2020-Q2, 2020-Q4, 2022-Q2), gezählt: ${late.length}`, JSON.stringify(ids) === JSON.stringify(expected), ids.join(","));
  check("jeder davon trägt die Lookahead-Note (inkl. „nicht point-in-time, nur Anzeige; B2 braucht PIT oder Kennzeichnung“)",
    late.every(v => (v.note ?? "").startsWith("Lookahead:") && (v.note ?? "").includes("nicht point-in-time, nur Anzeige; B2 braucht PIT oder Kennzeichnung")));
  check("kein point-in-time-Wert trägt eine Lookahead-Note", file.values.filter(v => !late.includes(v)).every(v => !(v.note ?? "").includes("Lookahead")));
  check("NEM-Notes nennen den Release vom 19.02.2026", late.filter(v => v.company === "NEM").every(v => (v.note ?? "").includes("19.02.2026")));
  check("_comment nennt 15 von 30", /15 von 30 Werten/.test((file as any)._comment ?? ""));
}

console.log("\nØ-Stufen und Verfügbarkeit (Quartalsende + 60 Tage)");
const series = buildGoldAiscSeries(file);
{
  const expected: Record<string, number> = {
    "2024-Q1": 1346, "2024-Q2": 1360, "2024-Q3": 1445, "2024-Q4": 1362,
    "2025-Q1": 1468, "2025-Q2": 1449, "2025-Q3": 1405, "2025-Q4": 1467,
    "2026-Q1": 1407, "2026-Q2": 1649,
  };
  check("40 Quartale, 2016-Q3 bis 2026-Q2", series.quarters.length === 40 && series.quarters[0].quarter === "2016-Q3" && series.quarters.at(-1)!.quarter === "2026-Q2", `${series.quarters.length} ${series.quarters[0]?.quarter}…${series.quarters.at(-1)?.quarter}`);
  const barrickGaps = ["2016-Q4", "2017-Q3", "2017-Q4", "2018-Q4", "2019-Q1", "2019-Q2", "2019-Q4", "2022-Q1"].map(q => `B ${q}`);
  check("Lücken nur unbelegte Barrick-Quartale, nichts interpoliert", JSON.stringify(series.gaps) === JSON.stringify(barrickGaps), series.gaps.join(","));
  for (const [quarter, aisc] of Object.entries(expected)) {
    const q = series.quarters.find(step => step.quarter === quarter);
    check(`${quarter} Ø ${q?.aisc} (n=${q?.count})`, q?.aisc === aisc && q.count === 3, `erwartet ${aisc}`);
  }
  const q4 = series.quarters.find(q => q.quarter === "2025-Q4")!;
  check("2025-Q4 periodEnd 2025-12-31, availableFrom 2026-03-01", q4.periodEnd === "2025-12-31" && q4.availableFrom === "2026-03-01", `${q4.periodEnd} ${q4.availableFrom}`);
  check("inScore=false", series.inScore === false);
  check("2016-Q3 Ø 820 ab 2016-11-29", series.quarters[0].aisc === 820 && series.quarters[0].availableFrom === "2016-11-29" && series.quarters[0].count === 3);
  check("2016-Q4 ohne Barrick: Ø aus NEM+AEM = 873", series.quarters.find(q => q.quarter === "2016-Q4")!.aisc === 873 && series.quarters.find(q => q.quarter === "2016-Q4")!.count === 2);
  check("2018-Q1 Ø 883, 2018-Q2 Ø 926", series.quarters.find(q => q.quarter === "2018-Q1")!.aisc === 883 && series.quarters.find(q => q.quarter === "2018-Q2")!.aisc === 926);
  check("vor erster Stufe → null", goldAiscStepAt(series, "2016-11-28") === null);
  check("2016-11-29 → 2016-Q3", goldAiscStepAt(series, "2016-11-29")?.quarter === "2016-Q3");
  check("2018-06-15 → 2018-Q1 (Q2 erst ab 2018-08-29)", goldAiscStepAt(series, "2018-06-15")?.quarter === "2018-Q1" && goldAiscStepAt(series, "2018-06-15")?.aisc === 883);
  check("2018-09-01 → 2018-Q2", goldAiscStepAt(series, "2018-09-01")?.aisc === 926);
  check("n/a-Grund vor der ersten Stufe, ohne Interpolation", (goldAiscNaReason(series, "2016-11-28") ?? "").includes("Nicht interpoliert") && goldAiscNaReason(series, "2018-06-15") === null);
  check("Formel nennt Mittelwert, minCompanies und lagDays", GOLD_AISC_FORMULA.includes("minCompanies") && GOLD_AISC_FORMULA.includes("lagDays") && GOLD_AISC_FORMULA.includes("Keine Interpolation"));
  check("2024-05-30 → 2024-Q1", goldAiscStepAt(series, "2024-05-30")?.quarter === "2024-Q1");
  check("2026-10-18 → 2026-Q2 (Q3 erst ab 2026-11-29)", goldAiscStepAt(series, "2026-10-18")?.quarter === "2026-Q2");
  check("kein Lookahead: 2026-08-28 → 2026-Q1", goldAiscStepAt(series, "2026-08-28")?.quarter === "2026-Q1");
}

console.log("\nn/a statt Schätzung bei < 2 Firmen");
{
  const thin: GoldAiscFile = { ...file, values: file.values.filter(v => !(v.quarter === "2025-Q2" && v.company !== "NEM")) };
  const s = buildGoldAiscSeries(thin);
  const q = s.quarters.find(x => x.quarter === "2025-Q2")!;
  check("2025-Q2 nur NEM → aisc null, count 1", q.aisc === null && q.count === 1);
  check("Lücken gelistet", s.gaps.includes("B 2025-Q2") && s.gaps.includes("AEM 2025-Q2"), s.gaps.join(","));
  check("Datum in n/a-Stufe → null", goldAiscStepAt(s, "2025-09-15") === null);
  const two = buildGoldAiscSeries({ ...file, values: file.values.filter(v => !(v.quarter === "2025-Q2" && v.company === "AEM")) });
  check("2 Firmen → Ø aus 2", two.quarters.find(x => x.quarter === "2025-Q2")!.aisc === Math.round((1375 + 1684) / 2));
}

console.log("\nStresszone AISC × 1,10–1,15");
{
  check("unter AISC → below", goldAiscStress(990, 1000) === "below");
  check("1000…1099 → stress", goldAiscStress(1000, 1000) === "stress" && goldAiscStress(1099, 1000) === "stress");
  check("1100…1149 → watch", goldAiscStress(1100, 1000) === "watch" && goldAiscStress(1149, 1000) === "watch");
  check("≥ 1150 → ok", goldAiscStress(1150, 1000) === "ok");
  check("keine AISC → na", goldAiscStress(1000, null) === "na");
  const pts = [
    { date: "2026-03-02", price: 4000 },
    { date: "2026-03-03", price: 1500 },
    { date: "2026-03-04", price: 1600 },
    { date: "2026-03-05", price: 3000 },
    { date: "2026-06-01", price: 1400 },
  ];
  const withA = attachAiscToChart(pts, series);
  check("Punkte erhalten aisc der gültigen Stufe", withA[0].aisc === 1467 && withA[0].aiscQuarter === "2025-Q4" && withA[4].aiscQuarter === "2026-Q1");
  check("Originalfelder bleiben", withA.every((p, i) => p.price === pts[i].price && p.date === pts[i].date));
  check("Stress-Flag", withA.map(p => p.aiscStress).join() === "false,true,true,false,true");
  const bands = aiscBands(withA);
  check("Bänder je Stufe", bands.length === 2 && bands[0].x1 === "2026-03-02" && bands[0].x2 === "2026-03-05" && bands[1].quarter === "2026-Q1");
  const runs = aiscStressRuns(withA);
  check("Stress-Läufe", runs.length === 2 && runs[0].x1 === "2026-03-03" && runs[0].x2 === "2026-03-04", JSON.stringify(runs));
  check("ohne Serie → aisc null, kein Stress", attachAiscToChart(pts, null).every(p => p.aisc === null && !p.aiscStress));
}

console.log("\nServer-Loader + Verdrahtung");
{
  const loaded = loadGoldAiscSeries();
  check("loadGoldAiscSeries() liefert Serie", !!loaded && loaded.quarters.length === 40 && loaded.quarters[0].quarter === "2016-Q3" && loaded.quarters.at(-1)!.aisc === 1649);
  check("ungültige Datei → null", loadGoldAiscSeries(path.join(root, "server/data/does-not-exist.json")) === null);
  const loaderSrc = readFileSync(path.join(root, "server/gold-aisc.ts"), "utf8");
  check("Prod: JSON wird importiert (esbuild bündelt, cwd-unabhängig)", /import bundledGoldAisc from "\.\/data\/gold-aisc\.json"/.test(loaderSrc));
  const cwd = process.cwd();
  process.chdir(os.tmpdir());
  const fromTmp = loadGoldAiscSeries();
  process.chdir(cwd);
  check("loadGoldAiscSeries() aus fremdem cwd liefert 40 Quartale", !!fromTmp && fromTmp.quarters.length === 40 && fromTmp.quarters.at(-1)!.aisc === 1649);
  const routes = readFileSync(path.join(root, "server/gold-routes.ts"), "utf8");
  check("gold-routes liefert aiscLine aus dem Loader", /const aiscSeries = loadGoldAiscSeries\(\)/.test(routes) && /aiscLine: aiscSeries/.test(routes));
  check("aiscZone neben der Linie, Fehler wird null", /buildGoldMinerZone\(zonePrices, aiscSeries\)/.test(routes) && /aiscZone = null/.test(routes) && /\[GOLD-MINER-ZONE\]/.test(routes));
  check("Spot-Quelle der Zone steht an der Antwort", /aiscZoneSpotSource/.test(routes));
  check("supplySignal-Platzhalter `aisc: null` unverändert (B2)", /aisc:\s*null/.test(routes));
  check("getTechnicalScore vorhanden", /function getTechnicalScore\(/.test(routes));
  // Schnitt endet vor der Response-Zeile: die Reihe wird einmal geladen, nachdem GIS und
  // scoreGoldAdaptive schon stehen. Der Loader darf nicht in den Indikatorblock rutschen.
  const gisBlock = routes.slice(routes.indexOf("indicators"), routes.indexOf("const aiscSeries"));
  check("AISC fließt nicht in Indikatoren/GIS", gisBlock.length > 0 && !/loadGoldAiscSeries|aiscLine|buildGoldMinerZone/.test(gisBlock));
  const analyze = readFileSync(path.join(root, "server/analyze-route.ts"), "utf8");
  check("analyze-route.ts kennt AISC nicht", !/gold-aisc|aiscLine/.test(analyze));
  const schema = readFileSync(path.join(root, "shared/gold-schema.ts"), "utf8");
  check("GoldAnalysis.aiscLine typisiert", /aiscLine\?:\s*GoldAiscSeries \| null/.test(schema));
  check("GoldAnalysis.aiscZoneSpotSource typisiert", /aiscZoneSpotSource\?: string \| null/.test(schema));
  const chart = readFileSync(path.join(root, "client/src/components/gold/GoldPriceChart.tsx"), "utf8");
  check("Chip heißt „Inflations-BE (T10YIE)“", chart.includes('label: "Inflations-BE (T10YIE)"') && !/label: "Breakeven"/.test(chart));
  // AISC ist nicht mehr die gestufte Linie im TA-Chart (Philip 17:48): eigene Sektion 9.
  check("AISC nicht mehr im Preischart", !/dataKey="aisc"|toggle-gold-aisc|gold-aisc-status|gold-aisc-offline/.test(chart));
  check("Link auf Abschnitt 9", chart.includes('data-testid="gold-aisc-link-s9"') && chart.includes("Abschnitt 9 Miner-Breakeven"));
  check("Preisachse zieht AISC nicht mehr ein", !/aiscStressHigh|d\.aisc/.test(chart));
  check("#374 QE/QT, Gold/WALCL und RSI bleiben im Chart", ["toggle-gold-qe-qt", "toggle-gold-walcl-ratio", "gold-walcl-ratio-chart", "gold-qe-qt-status", "goldQeQtView", "gold-rsi-relative"].every(token => chart.includes(token)));
}

console.log("\nOhne aiscLine (Offline-Fallback): sichtbarer Hinweis statt stillem Verschwinden");
{
  check("goldAiscAvailability(null) = offline", goldAiscAvailability(null, false) === "offline" && goldAiscAvailability(undefined, true) === "offline");
  check("Reihe ohne Quartal im Fenster = window-na, sonst ok", goldAiscAvailability(series, false) === "window-na" && goldAiscAvailability(series, true) === "ok");
  check("Label lautet „AISC n/a (Offline-Daten)“", GOLD_AISC_OFFLINE_LABEL === "AISC n/a (Offline-Daten)");
  // Echter Render des Charts (SSR) mit dem Client-Fallback GOLD_FALLBACK_DATA, der kein aiscLine trägt.
  // Alles in ein Bundle (eine React-Instanz für Chart und Renderer).
  const outfile = path.join(os.tmpdir(), `gold-aisc-chart-render-${process.pid}.cjs`);
  await esbuild.build({
    absWorkingDir: root,
    stdin: {
      contents: `export { GoldPriceChart } from "./client/src/components/gold/GoldPriceChart";
export { GOLD_FALLBACK_DATA } from "./client/src/lib/goldFallbackData";
export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
export { createElement } from "react";
export { renderToStaticMarkup } from "react-dom/server";`,
      resolveDir: root,
      loader: "ts",
    },
    bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
    alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
    outfile, logLevel: "silent",
  });
  const mod = createRequire(import.meta.url)(outfile);
  const render = (data: any) => mod.renderToStaticMarkup(mod.createElement(mod.QueryClientProvider, { client: new mod.QueryClient() }, mod.createElement(mod.GoldPriceChart, { data })));
  check("Fallback-Daten haben kein aiscLine", mod.GOLD_FALLBACK_DATA.aiscLine == null);
  // Der statische Fallback hat keine Preise (Chart zeigt dann „Keine Preisdaten“). Für den Fall „Preise da,
  // aiscLine fehlt“ (älterer Server, Loader-Fehler) synthetische Werktags-Kurse anhängen, aiscLine weiter fehlend.
  const prices: Array<{ date: string; close: number }> = [];
  for (let t = Date.parse("2024-01-02T00:00:00Z"); t <= Date.parse("2026-10-16T00:00:00Z"); t += 864e5) {
    const d = new Date(t); if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    prices.push({ date: d.toISOString().slice(0, 10), close: Math.round((2000 + prices.length * 2.5 + 40 * Math.sin(prices.length / 9)) * 100) / 100 });
  }
  const base = { ...mod.GOLD_FALLBACK_DATA, historicalPrices: prices };
  check("Fallback ohne Preise: Chart rendert „Keine Preisdaten“ (unverändert)", render(mod.GOLD_FALLBACK_DATA).includes("Keine Preisdaten"));
  const offline = render(base);
  const hasLink = (html: string) => html.includes('data-testid="gold-aisc-link-s9"') && html.includes("Abschnitt 9 Miner-Breakeven");
  const noOverlay = (html: string) => !html.includes('data-testid="toggle-gold-aisc"') && !html.includes('data-testid="gold-aisc-status"') && !html.includes('dataKey="aisc"');
  check("mit Preisen: Link auf Abschnitt 9, kein AISC-Overlay", hasLink(offline) && noOverlay(offline));
  const online = render({ ...base, aiscLine: series });
  check("mit aiscLine bleibt der TA-Chart ohne AISC-Linie", hasLink(online) && noOverlay(online) && !online.includes("AISC Ø 2026-Q2"));
  check("RSI-Pane bleibt sichtbar", online.includes('data-testid="gold-rsi-relative"'));
  check("#374-Pfade bleiben im Render (Toggle oder n/a)", (online.includes('data-testid="toggle-gold-qe-qt"') || online.includes('data-testid="gold-qe-qt-na"')) && (online.includes('data-testid="toggle-gold-walcl-ratio"') || online.includes('data-testid="gold-walcl-ratio-na"')));
}

console.log(failed === 0 ? "\nAlle AISC-Tests grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
