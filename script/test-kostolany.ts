/**
 * script/test-kostolany.ts — FW-04 Kostolany-Rad.
 * Aufruf: npx tsx script/test-kostolany.ts
 * 1) Regel mit echten FRED-Fixtures (Abruf 25.10.2026) + synthetischen Randfällen.
 * 2) sector-rotation-Ausgabe/Empfehlungen vorher = nachher (Zusatzfeld rein additiv).
 */
import * as fs from "fs";
import * as path from "path";
import { fredCsvObservations } from "../server/fred-csv";
import {
  computeKostolany, phaseFromTrends, classifyPrice, classifyRate, KOSTOLANY_THRESHOLDS,
} from "../shared/kostolany";
import { withKostolany } from "../server/kostolany-live";
import { computeSectorRotation, ETF_PROXY_MAP, type RecessionLike } from "../server/sector-rotation";

let fail = 0, pass = 0;
function ok(label: string, cond: boolean, info = "") {
  if (cond) { pass++; console.log(`✅ ${label}${info ? " — " + info : ""}`); }
  else { fail++; console.error(`❌ ${label}${info ? " — " + info : ""}`); }
}
const fx = (id: string) => fredCsvObservations(fs.readFileSync(path.join("script/fixtures", `fred-kostolany-${id}-2026-10-25.csv`), "utf-8"));
const SP500 = fx("SP500"), FEDFUNDS = fx("FEDFUNDS"), DFF = fx("DFF"), DGS10 = fx("DGS10");

console.log("=== 1. Regel mit FRED-Fixtures ===");
{
  ok("Fixtures geladen", SP500.length > 200 && FEDFUNDS.length > 6 && DFF.length > 100 && DGS10.length > 100,
    `SP500 ${SP500.length}, FEDFUNDS ${FEDFUNDS.length}, DFF ${DFF.length}, DGS10 ${DGS10.length}`);
  const r = computeKostolany({ fedfunds: FEDFUNDS, dff: DFF, dgs10: DGS10, price: SP500, priceSource: "FRED SP500" });
  // Nachrechnen unabhängig von der Implementierung
  const tail = SP500.slice(-200); const sma = tail.reduce((s, o) => s + o.value, 0) / 200;
  const last = SP500[SP500.length - 1].value;
  ok("SMA200 nachgerechnet", Math.abs((r.inputs.sma200 ?? 0) - sma) < 1e-9, `${sma.toFixed(2)}`);
  ok("Kurs vs SMA", Math.abs((r.inputs.priceVsSma ?? 0) - (last / sma - 1)) < 1e-12, `${((last / sma - 1) * 100).toFixed(2)} %`);
  ok("Leitzins-Quelle FEDFUNDS", r.inputs.policySeries === "FEDFUNDS");
  ok("Phase gesetzt", r.phase != null, `${r.phase} (Zins ${r.rateTrend}, Kurs ${r.priceTrend}; ΔFed ${r.inputs.policyDelta?.toFixed(2)} pp, ΔDGS10 ${r.inputs.dgs10Delta?.toFixed(2)} pp) ${r.notes.join("; ")}`);
  ok("Phase = Matrix(Trends)", r.phase === phaseFromTrends(r.rateTrend!, r.priceTrend!));
  ok("Schwellen als Vorschlag markiert", r.thresholdsAreProposal === true);

  const noFed = computeKostolany({ dff: DFF, dgs10: DGS10, price: SP500, priceSource: "FRED SP500" });
  ok("ohne FEDFUNDS → DFF", noFed.inputs.policySeries === "DFF" && noFed.phase != null, `${noFed.phase}`);
  const noRate = computeKostolany({ dgs10: DGS10, price: SP500, priceSource: "FRED SP500" });
  ok("ohne Leitzins → n/a", noRate.phase === null && noRate.rateTrend === null && noRate.inputs.policyLast === null);
  const noPx = computeKostolany({ fedfunds: FEDFUNDS, dgs10: DGS10, price: [], priceSource: null });
  ok("ohne Kurs → n/a (kein SPY-Ersatz)", noPx.phase === null && noPx.priceTrend === null && noPx.inputs.sma200 === null);
  const shortPx = computeKostolany({ fedfunds: FEDFUNDS, price: SP500.slice(-150), priceSource: "FRED SP500" });
  ok("< 200 Kurstage → n/a", shortPx.phase === null);
  const yahoo = computeKostolany({ fedfunds: FEDFUNDS, dgs10: DGS10, price: SP500, priceSource: "Yahoo ^GSPC" });
  ok("Fallback-Quelle wird ausgewiesen", yahoo.inputs.priceSource === "Yahoo ^GSPC" && yahoo.phase === r.phase);
}

console.log("=== 2. Regel-Randfälle (synthetisch) ===");
{
  const T = KOSTOLANY_THRESHOLDS;
  ok("Zins +0.25 → steigend", classifyRate(0.25, T.policyRateDeltaPp) === "steigend");
  ok("Zins −0.24 → seitwärts", classifyRate(-0.24, T.policyRateDeltaPp) === "seitwärts");
  ok("Kurs +10 % → stark steigend", classifyPrice(0.10) === "stark steigend");
  ok("Kurs −2 % → fallend", classifyPrice(-0.02) === "fallend");
  ok("Kurs +1.9 % → seitwärts", classifyPrice(0.019) === "seitwärts");
  const M: [any, any, string][] = [
    ["fallend", "fallend", "A1"], ["fallend", "steigend", "A2"], ["fallend", "stark steigend", "A3"],
    ["seitwärts", "steigend", "A3"], ["seitwärts", "seitwärts", "B1"], ["seitwärts", "fallend", "B2"], ["seitwärts", "stark fallend", "B3"],
    ["steigend", "steigend", "B1"], ["steigend", "fallend", "B2"], ["steigend", "stark fallend", "B3"],
  ];
  for (const [r, p, e] of M) ok(`Matrix ${r}/${p} → ${e}`, phaseFromTrends(r, p) === e);
  // DGS10-Tie-Break: Leitzins flach, 10J +0.6 pp → steigend
  const d = (n: number, v: number) => ({ date: new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10), value: v });
  const flatFed = [d(0, 4), d(200, 4.1)];
  const dgsUp = [d(0, 4), d(200, 4.6)];
  const px = Array.from({ length: 220 }, (_, i) => d(i, 100));
  const tb = computeKostolany({ fedfunds: flatFed, dgs10: dgsUp, price: px, priceSource: "FRED SP500" });
  ok("DGS10-Tie-Break greift", tb.rateTrend === "steigend" && tb.notes.some(n => n.includes("Tie-Break")), `${tb.phase}`);
}

console.log("=== 3. sector-rotation vorher = nachher ===");
{
  const recession: RecessionLike = { indicators: [], subgroups: [], nyFedValue: 25, interpretation: "" } as any;
  const sectors = ETF_PROXY_MAP.map((p, i) => ({
    id: p.id, vol60d: 0.1 + i * 0.01, betaSpx: 0.6 + i * 0.05, maxDd12m: 0.1 + i * 0.02,
    pe: 15 + i, pe10y: 16 + i, return6M: 0.02 * (i - 4), lastDate: "2026-10-21",
  }));
  const before = computeSectorRotation({ asOf: "2026-10-21", recession, sectors });
  const beforeJson = JSON.stringify(before);
  const k = computeKostolany({ fedfunds: FEDFUNDS, dgs10: DGS10, price: SP500, priceSource: "FRED SP500" });
  const after = withKostolany(before, k);
  const { kostolany, ...rest } = after;
  ok("Ausgabe ohne Zusatzfeld identisch", JSON.stringify(rest) === beforeJson);
  ok("Empfehlungen identisch", JSON.stringify(after.recommendations) === JSON.stringify(before.recommendations));
  ok("Phase/Sektoren identisch", after.phase === before.phase && JSON.stringify(after.sectors) === JSON.stringify(before.sectors));
  ok("Eingabe nicht mutiert", JSON.stringify(before) === beforeJson && !("kostolany" in before));
  ok("Zusatzfeld vorhanden", kostolany === k);
  ok("null-Feld (Fehler) erlaubt", withKostolany(before, null).kostolany === null);
  // Engine-Dateien unberührt
  const { execSync } = await import("child_process");
  const diff = execSync("git diff --name-only origin/main -- server/sector-rotation.ts server/sector-rotation-score.ts server/sector-rotation-math.ts server/routes-register.ts server/analyze-route.ts").toString().trim();
  ok("Engine/routes-register/analyze-route unverändert", diff === "", diff || "leer");
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
