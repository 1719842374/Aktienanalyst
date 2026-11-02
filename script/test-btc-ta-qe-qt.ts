/**
 * BTC-TA: QE/QT über goldQeQtView, Handelstage-Fenster mit SMA-Vorlauf,
 * Dividende n/a. Pins und die drei Blobs bleiben.
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-btc-ta-qe-qt.ts
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildBiasDecision } from "../shared/bias-fixes";
import { goldQeQtView } from "../shared/gold-qe-qt";
import {
  BTC_PRICE_SOURCE,
  BTC_TA_CUTOFF,
  BTC_TA_RANGES,
  sliceBtcTaWindow,
  smaAt,
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

const long = series(3000);
const y10 = sliceBtcTaWindow(long, "10Y");
check("10Y schneidet die letzten 2520 Bars", y10.visible.length === 2520 && y10.warmupBars === 480);
check("10Y: MA200 am ersten sichtbaren Tag = SMA der 200 Schlüsse davor",
  y10.ma200FromFirst && y10.visible[0].ma200 === smaAt(long.map(p => p.price), 480, 200));
check("10Y mit genug Historie nennt kein Historie-seit", y10.historyNote == null && y10.short === false);

const three = sliceBtcTaWindow(long, "3M");
check("3M = 63 Handelstage, Vorlauf bleibt in der SMA", three.visible.length === 63 && three.warmupBars === 3000 - 63 && three.ma50FromFirst && three.ma200FromFirst);
check("3M-MA50 ist nicht die SMA nur des Fensters", three.visible[0].ma50 !== smaAt(three.visible.map(p => p.price), 0, 50));

const maxShort = sliceBtcTaWindow(series(80), "Max");
check("Max zu kurz: Historie seit, MA200 nicht am ersten Tag",
  maxShort.historyNote?.startsWith(`Historie seit ${maxShort.since}`) === true
  && maxShort.historyNote.includes("MA200 n/a")
  && maxShort.historyNote.includes(BTC_PRICE_SOURCE)
  && maxShort.ma200FromFirst === false
  && maxShort.visible[0].ma200 == null);

const tenShort = sliceBtcTaWindow(series(400), "10Y");
check("10Y ohne 2520 Bars: Historie seit, keine volle Linie",
  tenShort.short && tenShort.visible.length === 400 && tenShort.historyNote?.includes("Historie seit") === true && tenShort.ma200FromFirst === false);

const chart = readFileSync("client/src/components/sections/TechnicalChart.tsx", "utf8");
for (const range of BTC_TA_RANGES) {
  if (range === "Max") {
    check("Max wie TechnicalChart unbegrenzt", BTC_TA_CUTOFF.Max === Number.MAX_SAFE_INTEGER && chart.includes('"Max": Number.MAX_SAFE_INTEGER'));
  } else {
    check(`Cutoff ${range} = ${BTC_TA_CUTOFF[range]} wie TechnicalChart`, chart.includes(`"${range}": ${BTC_TA_CUTOFF[range]}`));
  }
}

const dash = readFileSync("client/src/pages/BTCDashboard.tsx", "utf8");
check("Dashboard nutzt den gemeinsamen Hook, nicht eine zweite goldQeQtView-Kopie",
  dash.includes("useQeQtOverlay") && dash.includes("qeQtBandNodes") && !dash.includes("function goldQeQtView") && !dash.includes("changeWindowDays"));
check("Preset-Knöpfe ohne 2Y", dash.includes("BTC_TA_RANGES.map") && !dash.includes('["3M", "6M", "1Y", "2Y", "3Y", "5Y"]'));
check("MA50/MA200 verbinden keine Lücken", dash.includes("connectNulls={!sma}"));
check("Dividenden-Chip ist der n/a-Baustein", dash.includes("<BtcDividendNa"));

const miner = readFileSync("client/src/components/sections/Section13Miner.tsx", "utf8");
check("Miner teilt die Knopfleiste und kennt Max", miner.includes("BTC_TA_RANGES.map") && miner.includes('timeRange === "Max"'));

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
