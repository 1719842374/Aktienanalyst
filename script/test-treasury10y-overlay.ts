/**
 * A3 — 10Y-Treasury-Overlay (FRED DGS10) in der Technischen Analyse (Offen_WORK_BUFFETT_ASIA_10Y.md §3). Score unverändert.
 * Muster: script/test-credit-overlay.ts (#253).
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-treasury10y-overlay.ts
 * Fixtures: script/fixtures/analysis-MSFT.json (bestehend), script/fixtures/treasury10y/DGS10-2026-10-18.csv
 * (FRED fredgraph.csv?id=DGS10, abgerufen 18.10.2026, ab 2000-01-01 gekürzt).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeTreasury10YPoints, treasury10YOverlaySeries, treasury10YWindowChange,
  TREASURY10Y_LABEL, TREASURY10Y_SERIES_ID, TREASURY10Y_SOURCE_URL, OVERLAY_MAX_GAP_DAYS,
} from "../shared/treasury10y";
import { fredCsvObservations } from "../server/fred-csv";
import { loadMarketTreasury10Y } from "../server/treasury10y-route";
import { buildBiasDecision } from "../shared/bias-fixes";
import { generateAnalysisHTML } from "../server/pdf-export";
import { withTreasury10YOverlay } from "../client/src/components/sections/TechnicalChart";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };
const SNAP = "script/fixtures/treasury10y/DGS10-2026-10-18.csv";

// Normalisierung über den gemeinsamen FRED-Kern
const csv = "observation_date,DGS10\n2024-01-03,4.00\n2024-01-02,3.95\n2024-01-04,.\nbad,1\n2024-01-05,\n2024-01-03,4.00\n";
assert.deepEqual(normalizeTreasury10YPoints(fredCsvObservations(csv)), [{ date: "2024-01-02", value: 3.95 }, { date: "2024-01-03", value: 4 }]);
assert.deepEqual(normalizeTreasury10YPoints(fredCsvObservations("<html>")), []);
assert.deepEqual(normalizeTreasury10YPoints(null), []);
ok("normalizeTreasury10YPoints(fredCsvObservations): sortiert, '.'/leer/Müll/Duplikate verworfen, HTML → []");

// Konstanten
assert.equal(TREASURY10Y_SERIES_ID, "DGS10");
assert.equal(TREASURY10Y_SOURCE_URL, "https://fred.stlouisfed.org/series/DGS10");
assert.equal(TREASURY10Y_LABEL, "10J US-Treasury-Rendite (DGS10)");
assert.equal(OVERLAY_MAX_GAP_DAYS, 7);
ok("Serie DGS10, Quelle FRED, Label exakt, Lückentoleranz 7 Tage (wie Credit)");

// Overlay: as-of, max 7 Tage Lücke, vorher null
const pts = [{ date: "2024-01-02", value: 4.1 }, { date: "2024-01-10", value: 4.3 }];
const ov = treasury10YOverlaySeries([{ date: "2024-01-01" }, { date: "2024-01-05" }, { date: "2024-01-10" }, { date: "2024-01-30" }], pts);
assert.deepEqual(ov.map(p => p.yieldPct), [null, 4.1, 4.3, null]);
assert.deepEqual(ov.map(p => p.yieldDate), [null, "2024-01-02", "2024-01-10", null]);
assert.deepEqual(treasury10YOverlaySeries([{ date: "2024-01-05" }], []), [{ date: "2024-01-05", yieldPct: null, yieldDate: null }]);
ok("treasury10YOverlaySeries: letzter Wert ≤ Datum, Lücke > 7 Tage bzw. keine Daten → n/a (kein Fake-Wert)");

// Zinsrichtung im Fenster
const up = treasury10YWindowChange(ov)!;
assert.deepEqual(up, { first: 4.1, firstDate: "2024-01-02", last: 4.3, lastDate: "2024-01-10", changeBp: 20, direction: "steigend" });
const down = treasury10YWindowChange([{ date: "a", yieldPct: 4.5, yieldDate: "2024-01-02" }, { date: "b", yieldPct: null, yieldDate: null }, { date: "c", yieldPct: 4.25, yieldDate: "2024-02-01" }])!;
assert.equal(down.changeBp, -25);
assert.equal(down.direction, "fallend");
assert.equal(treasury10YWindowChange([{ date: "a", yieldPct: 4, yieldDate: "2024-01-02" }, { date: "b", yieldPct: 4, yieldDate: "2024-01-03" }])!.direction, "unverändert");
assert.equal(treasury10YWindowChange([{ date: "a", yieldPct: 4, yieldDate: "2024-01-02" }]), null);
assert.equal(treasury10YWindowChange([{ date: "a", yieldPct: 4, yieldDate: "2024-01-02" }, { date: "b", yieldPct: 4, yieldDate: "2024-01-02" }]), null);
assert.equal(treasury10YWindowChange(null), null);
assert.equal(treasury10YWindowChange(ov.map(p => ({ ...p, yieldPct: null, yieldDate: null }))), null);
ok("treasury10YWindowChange: steigend/fallend/unverändert nach Vorzeichen; < 2 Werte bzw. ein FRED-Tag → null (n/a)");

// Chart-Join
const bars = [{ date: "2024-01-05", close: 1 }, { date: "2024-01-10", close: 2 }] as any[];
assert.equal(withTreasury10YOverlay(bars, null), bars);
const joined = withTreasury10YOverlay(bars, treasury10YOverlaySeries(bars, pts));
assert.deepEqual(joined.map(p => [p._t10y, p._t10yDate]), [[4.1, "2024-01-02"], [4.3, "2024-01-10"]]);
assert.equal(joined[1].close, 2);
ok("withTreasury10YOverlay: ohne Serie unverändert, sonst _t10y/_t10yDate je Kurstag, Kursfelder bleiben");

// Echter FRED-Snapshot
const real = normalizeTreasury10YPoints(fredCsvObservations(readFileSync(SNAP, "utf8")));
assert.ok(real.length > 6000 && real[0].date === "2000-01-03", `${real.length} ${real[0]?.date}`);
const last = real[real.length - 1];
console.log(`     DGS10 Snapshot: ${real[0].date}…${last.date}, ${real.length} Werte, letzter ${last.value}%`);
ok("FRED-Snapshot DGS10 geparst (ab 2000)");

// Route-Loader mit gestubbtem Fetch; FRED weg → n/a
let askedFor = "";
const okResp = await loadMarketTreasury10Y({ fetchCsv: async id => { askedFor = id; return readFileSync(SNAP, "utf8"); } });
assert.equal(askedFor, "DGS10");
assert.equal(okResp.seriesId, "DGS10");
assert.equal(okResp.points.length, real.length);
assert.equal(okResp.note, null);
const naResp = await loadMarketTreasury10Y({ fetchCsv: async () => null });
assert.deepEqual(naResp.points, []);
assert.ok(naResp.note);
ok("loadMarketTreasury10Y: fragt DGS10 ab; Daten bzw. n/a ohne Ersatzwert");

// UI-Verdrahtung (Quelltext): Chip, Default aus, Reset je Ticker, Hook nur bei Chip an, eigene Achse, n/a-Status
const ui = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
assert.ok(ui.includes('const [showT10y, setShowT10y] = useState(false);'));
assert.ok(ui.includes('useEffect(() => { setShowT10y(false); }, [data.ticker]);'));
assert.ok(ui.includes('const t10yQuery = useMarketTreasury10Y(showT10y);'));
assert.ok(ui.includes('data-testid="button-t10y" aria-pressed={showT10y}'));
assert.ok(ui.includes('yAxisId="t10y"') && ui.includes('dataKey="_t10y"'));
assert.ok(/data-testid="t10y-overlay-empty">10J-Treasury: n\/a/.test(ui));
assert.equal((ui.match(/t10y=\{t10yOverlay\}/g) ?? []).length, 2, "nur Fenster A (Einzel + Band A)");
// Credit/Dividende unverändert verdrahtet
assert.ok(ui.includes('const creditQuery = useMarketCreditSpread(showCredit);') && ui.includes('const dividendQuery = useDividendHistory(data.ticker, showDividend);'));
const hook = readFileSync("client/src/lib/useMarketTreasury10Y.ts", "utf8");
assert.ok(hook.includes('queryKey: ["/api/treasury-10y/market"]') && hook.includes("enabled,"));
const reg = readFileSync("server/routes-register.ts", "utf8");
assert.ok(reg.includes('registerTreasury10YRoute(app);') && reg.includes('registerCreditRoute(app);'));
ok("UI-Kette: Chip „10J-Treasury“ (Default aus, Reset je Ticker) → useMarketTreasury10Y → /api/treasury-10y/market registriert; eigene rechte Achse; n/a-Status");

// Kein Score-/Fazit-Pfad kennt das Overlay
for (const f of ["shared/bias-fixes.ts", "server/scoring-integration.ts", "server/pdf-export.ts", "server/analyze-route.ts", "client/src/components/sections/SummarySection.tsx"]) {
  const src = readFileSync(f, "utf8");
  assert.ok(!/treasury-10y|treasury10y|DGS10/i.test(src), `${f} referenziert das 10Y-Overlay`);
}
ok("Score-/Fazit-Dateien (bias-fixes, scoring-integration, pdf-export, analyze-route, SummarySection) ohne 10Y-Overlay-Bezug");

// Score + PDF-Fazit exakt unverändert, auch wenn 10Y-Daten am Analyseobjekt hängen
const data = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const verdict = (h: string) => /FAZIT: ([A-ZÄÖÜ ]+)</.exec(h)?.[1] ?? "n/a";
const before = buildBiasDecision(data);
const withT = buildBiasDecision({ ...data, treasury10Y: okResp } as any);
assert.deepEqual(withT, before);
const htmlNo = await generateAnalysisHTML(data);
const htmlYes = await generateAnalysisHTML({ ...data, treasury10Y: okResp });
assert.equal(verdict(htmlYes), verdict(htmlNo));
assert.ok(!htmlYes.includes(TREASURY10Y_LABEL));
console.log(`     MSFT (Fixture): Score ${before.overallScore.toFixed(4)} ${before.overallRating} = ${withT.overallScore.toFixed(4)} ${withT.overallRating}, PDF-Fazit ${verdict(htmlNo)} = ${verdict(htmlYes)}`);
ok("Score/Rating identisch (deepEqual), PDF-Fazit identisch, kein 10Y-Text im PDF");

console.log(`\n${n} Checks grün`);
