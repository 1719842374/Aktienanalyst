/**
 * BTC-TA: QE/QT über goldQeQtView, Datumsfenster mit SMA-Vorlauf,
 * Dividende n/a. Pins und die drei Blobs bleiben.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-btc-ta-qe-qt.ts
 */
import React, { createElement } from "react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBiasDecision } from "../shared/bias-fixes";
import { goldQeQtView } from "../shared/gold-qe-qt";
import {
  BTC_PRICE_SOURCE,
  BTC_TA_RANGES,
  btcTaCutoffDate,
  sliceBtcTaWindow,
  smaAt,
  type BtcTaRange,
} from "../client/src/lib/btcTaWindow";
import {
  BTC_DIVIDEND_NA,
  BtcDividendNa,
  QE_QT_SOURCE,
  QeQtBandsToggle,
  qeQtBandNodes,
  qeQtPhaseCaptions,
  qeQtPhaseText,
  qeQtUnavailableText,
  useQeQtOverlay,
} from "../client/src/components/qeQtBands";

(globalThis as any).React = React;

let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok || info === undefined ? "" : ` → ${JSON.stringify(info)}`}`);
  if (!ok) failed++;
};

const day = (i: number) => new Date(Date.UTC(2010, 0, 1) + i * 86400000).toISOString().slice(0, 10);

function series(n: number) {
  const closes = Array.from({ length: n }, (_, i) => 100 + i);
  return closes.map((price, i) => ({
    date: day(i),
    price,
    ma50: smaAt(closes, i, 50),
    ma200: smaAt(closes, i, 200),
  }));
}

const AS_OF = "2026-11-02";

const long = series(6000);
const longEnd = long[long.length - 1].date;
const y10 = sliceBtcTaWindow(long, "10Y", longEnd);
const y10Cut = btcTaCutoffDate("10Y", longEnd)!;
check("10Y auf täglicher Reihe beginnt am Stichtag", y10.since === y10Cut && y10.visible[0].date === y10Cut);
check("10Y: MA200 am ersten sichtbaren Tag = SMA der 200 Schlüsse davor",
  y10.ma200FromFirst && y10.warmupBars >= 200 && y10.visible[0].ma200 === smaAt(long.map(p => p.price), y10.warmupBars, 200));
check("10Y mit genug Historie nennt kein Historie-seit", y10.historyNote == null && y10.short === false);

const three = sliceBtcTaWindow(long, "3M", longEnd);
const threeCut = btcTaCutoffDate("3M", longEnd)!;
check("3M beginnt am Stichtag, Vorlauf bleibt in der SMA",
  three.since === threeCut && three.warmupBars === long.findIndex(p => p.date >= threeCut) && three.ma50FromFirst && three.ma200FromFirst);
check("3M-MA50 ist nicht die SMA nur des Fensters", three.visible[0].ma50 !== smaAt(three.visible.map(p => p.price), 0, 50));

check("3M vor dem 31.03. ist der 31.12.", btcTaCutoffDate("3M", "2026-03-31") === "2025-12-31");
check("1Y vom 29.02. fällt auf den 28.02.", btcTaCutoffDate("1Y", "2024-02-29") === "2023-02-28");

const maxShort = sliceBtcTaWindow(series(80), "Max");
check("Max zu kurz: Historie seit, MA200 nicht am ersten Tag",
  maxShort.historyNote?.startsWith(`Historie seit ${maxShort.since}`) === true
  && maxShort.historyNote.includes("MA200 n/a")
  && maxShort.historyNote.includes(BTC_PRICE_SOURCE)
  && maxShort.ma200FromFirst === false
  && maxShort.visible[0].ma200 == null);

/** Vier-Tage-Raster plus ein Loch, analog zur blockchain.info-Reihe. */
function gappyThrough(asOf: string) {
  const dates: string[] = [];
  let t = Date.UTC(2010, 0, 3);
  const end = Date.parse(`${asOf}T00:00:00.000Z`);
  while (t <= end) {
    const date = new Date(t).toISOString().slice(0, 10);
    t += 4 * 86400000;
    if (date >= "2023-06-01" && date < "2023-07-11") continue;
    dates.push(date);
  }
  if (dates[dates.length - 1] !== asOf) dates.push(asOf);
  const closes = dates.map((_, i) => 100 + i);
  return dates.map((date, i) => ({
    date,
    price: closes[i],
    ma50: smaAt(closes, i, 50),
    ma200: smaAt(closes, i, 200),
  }));
}

const gappy = gappyThrough(AS_OF);
const expectedStart = (range: BtcTaRange) => {
  const cutoff = btcTaCutoffDate(range, AS_OF);
  if (cutoff == null) return gappy[0].date;
  return gappy.find(p => p.date >= cutoff)!.date;
};
const presets: BtcTaRange[] = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "10Y", "Max"];
for (const range of presets) {
  const sliced = sliceBtcTaWindow(gappy, range, AS_OF);
  const cutoff = btcTaCutoffDate(range, AS_OF);
  const start = expectedStart(range);
  const inWindow = cutoff == null ? gappy.length : gappy.filter(p => p.date >= cutoff).length;
  check(`${range} auf lückenhafter Reihe beginnt bei ${start}`,
    sliced.since === start
    && sliced.visible.length === inWindow
    && sliced.visible.every(p => cutoff == null || p.date >= cutoff)
    && (cutoff == null || gappy[sliced.warmupBars - 1]?.date < cutoff));
}
const two = sliceBtcTaWindow(gappy, "2Y", AS_OF);
const one = sliceBtcTaWindow(gappy, "1Y", AS_OF);
const threeGappy = sliceBtcTaWindow(gappy, "3M", AS_OF);
const tenGappy = sliceBtcTaWindow(gappy, "10Y", AS_OF);
const maxGappy = sliceBtcTaWindow(gappy, "Max", AS_OF);
check("Stichtage 2Y/1Y/3M/10Y",
  btcTaCutoffDate("2Y", AS_OF) === "2024-11-02"
  && btcTaCutoffDate("1Y", AS_OF) === "2025-11-02"
  && btcTaCutoffDate("3M", AS_OF) === "2026-08-02"
  && btcTaCutoffDate("10Y", AS_OF) === "2016-11-02");
check("2Y liegt in 11/2024, nicht beim 504-Bar-Schnitt",
  two.since!.startsWith("2024-11") && gappy[gappy.length - 504].date < "2022-01-01" && two.since !== gappy[gappy.length - 504].date);
check("1Y liegt in 11/2025, nicht beim 252-Bar-Schnitt",
  one.since!.startsWith("2025-11") && gappy[gappy.length - 252].date < "2024-06-01");
check("3M liegt in 08/2026, nicht beim 63-Bar-Schnitt",
  threeGappy.since!.startsWith("2026-08") && gappy[gappy.length - 63].date < "2026-04-01");
check("10Y ist kürzer als Max",
  tenGappy.since!.startsWith("2016-11") && tenGappy.since !== maxGappy.since && tenGappy.visible.length < maxGappy.visible.length && tenGappy.short === false);
check("Punkt am Stichtag gehört ins Fenster, der Tag davor nicht",
  sliceBtcTaWindow([
    { date: "2024-11-01", price: 1, ma50: 1, ma200: 1 },
    { date: "2024-11-02", price: 2, ma50: 2, ma200: 2 },
    { date: AS_OF, price: 3, ma50: 3, ma200: 3 },
  ], "2Y", AS_OF).since === "2024-11-02");
check("2Y-MA200 ist die SMA der vollen lückenhaften Reihe",
  two.ma200FromFirst && two.visible[0].ma200 === smaAt(gappy.map(p => p.price), two.warmupBars, 200)
  && two.visible[0].ma200 !== smaAt(two.visible.map(p => p.price), 0, 200));

const lateCloses = gappy.filter(p => p.date >= "2020-01-01").map(p => p.price);
const late = gappy.filter(p => p.date >= "2020-01-01").map((p, i) => ({
  date: p.date,
  price: lateCloses[i],
  ma50: smaAt(lateCloses, i, 50),
  ma200: smaAt(lateCloses, i, 200),
}));
const tenShort = sliceBtcTaWindow(late, "10Y", AS_OF);
check("10Y ohne Historie bis zum Stichtag: Historie seit, MA200 nicht am ersten Tag",
  tenShort.short && tenShort.since === late[0].date && tenShort.visible.length === late.length
  && tenShort.historyNote?.includes("Historie seit") === true && tenShort.ma200FromFirst === false);

const dash = readFileSync("client/src/pages/BTCDashboard.tsx", "utf8");
check("Dashboard nutzt den gemeinsamen Hook, nicht eine zweite goldQeQtView-Kopie",
  dash.includes("useQeQtOverlay") && dash.includes("qeQtBandNodes") && !dash.includes("function goldQeQtView") && !dash.includes("changeWindowDays"));
check("Preset-Knöpfe enthalten 2Y", (BTC_TA_RANGES as readonly string[]).includes("2Y") && btcTaCutoffDate("2Y", AS_OF) === "2024-11-02" && dash.includes("BTC_TA_RANGES.map"));
check("MA50/MA200 verbinden keine Lücken", dash.includes("connectNulls={!sma}"));
check("Dividenden-Chip ist der n/a-Baustein", dash.includes("<BtcDividendNa"));

const miner = readFileSync("client/src/components/sections/Section13Miner.tsx", "utf8");
check("Miner teilt die Knopfleiste und kennt 2Y und Max", miner.includes("BTC_TA_RANGES.map") && miner.includes('"2Y": 730') && miner.includes('timeRange === "Max"'));
const bands = readFileSync("client/src/components/qeQtBands.tsx", "utf8");
check("QE/QT-Flächen bleiben Grün, Rot und Grau",
  bands.includes('expansion: "#22c55e"') && bands.includes('contraction: "#ef4444"') && bands.includes('neutral: "#94a3b8"')
  && bands.includes('fillOpacity={band.regime === "neutral" ? 0.05 : 0.14}'));
check("Miner-Zone im Kurschart ist die orange Schraffur",
  dash.includes('id="btc-miner-zone"') && dash.includes('fill="url(#btc-miner-zone)"') && dash.includes('data-testid="btc-miner-zone-legend"'));

const points = Array.from({ length: 220 }, (_, i) => ({
  date: day(i),
  price: 20000 + i,
  walcl: i < 140 ? 6 : 6 + (i - 140) * 0.02,
}));
const view = goldQeQtView(points, points.slice(-30).map(p => p.date));
const obs = points.filter((_, i) => i % 7 === 0).map(p => ({ date: p.date }));
const phases = qeQtPhaseCaptions(view, QE_QT_SOURCE, obs);
check("Phasen kommen aus goldQeQtView", view.bands.length > 0 && phases.length === view.bands.length);
check("jede Phase nennt Quelle und Datum", phases.every(p => qeQtPhaseText(p).includes(QE_QT_SOURCE) && qeQtPhaseText(p).includes(p.from) && /\d{4}-\d{2}-\d{2}/.test(p.asOf ?? "")));
check("ohne WALCL: BTC-Text, Gold-String bleibt in der Rechnung",
  qeQtUnavailableText("n/a — WALCL fehlt in der Gold-Historie", "btc") === "n/a — WALCL fehlt in der BTC-Historie"
  && goldQeQtView(points.map(p => ({ ...p, walcl: null }))).unavailableReason === "n/a — WALCL fehlt in der Gold-Historie");

const html = renderToStaticMarkup(createElement("div", null,
  createElement(QeQtBandsToggle, { view, show: false, onToggle: () => {}, asset: "btc", testId: "toggle-btc-qe-qt" }),
  createElement(BtcDividendNa, null),
));
check("Knopf heißt QE/QT-Bänder", html.includes("QE/QT-Bänder") && html.includes('data-testid="toggle-btc-qe-qt"'));
check("Dividende n/a mit Grund", html.includes("Div. Yield n/a") && html.includes(BTC_DIVIDEND_NA.slice(0, 40)));
check("Hook ist eine Funktion", typeof useQeQtOverlay === "function");
const nodes = qeQtBandNodes(view.bands, true);
check("Bänder sind ein Array von ReferenceArea", Array.isArray(nodes) && nodes!.length === view.bands.length && nodes!.every(n => (n as { type?: { displayName?: string } }).type?.displayName === "ReferenceArea" || (n as { type?: { name?: string } }).type?.name === "ReferenceArea"));

const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
check("VOW3 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");
const msft = buildBiasDecision(JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8")));
const spy = buildBiasDecision(JSON.parse(readFileSync("script/fixtures/analysis-SPY.json", "utf8")));
check("MSFT buildBias 5.6381", msft.overallScore.toFixed(4) === "5.6381", msft.overallScore);
check("SPY 1.1580", spy.overallScore.toFixed(4) === "1.1580", spy.overallScore);

const blobs = {
  "shared/schema.ts": "1d3edc73",
  "server/analyze-route.ts": "1f62cd45",
  "server/researcher.ts": "e773aa47",
};
for (const [file, prefix] of Object.entries(blobs)) {
  const sha = execSync(`git rev-parse HEAD:${file}`, { encoding: "utf8" }).trim();
  check(`Blob ${file} ${prefix}`, sha.startsWith(prefix), sha.slice(0, 8));
}

console.log(failed === 0 ? "\nAlle BTC-TA-Checks grün." : `\n${failed} Check(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
