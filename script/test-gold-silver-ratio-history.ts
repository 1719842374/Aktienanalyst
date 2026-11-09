/**
 * Gold/Silber-Ratio im TA-Chart: Tagesrechnung, Datumsausrichtung, Quellwahl wie der Gold-Kurs.
 * Ausführen: npx tsx script/test-gold-silver-ratio-history.ts
 */
import express from "express";
import { readFileSync } from "node:fs";
import { pickLongerSource } from "../server/gold-chart-history";
import { loadGoldSilverRatioHistory, registerGoldSilverRatioRoute } from "../server/gold-silver-ratio";
import {
  alignGoldSilverSeries,
  buildGoldSilverRatioHistory,
  chooseLongerRatioSeries,
  goldSilverRatioAvailability,
  ratioCoverageInWindow,
  FMP_RATIO_SOURCE,
  YAHOO_RATIO_SOURCE,
} from "../shared/gold-silver-ratio";

let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log(`${ok ? "✅" : "❌"} ${name}${ok || detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) fail++;
};

console.log("\nRechnung und Datumsausrichtung");
{
  const gold = [
    { date: "2024-01-03", close: 2010 },
    { date: "2024-01-02", close: 2000 },
    { date: "2024-01-04", close: 2020 },
    { date: "2024-01-05", close: 0 },
    { date: "kein-datum", close: 10 },
    { date: "2024-01-02", close: 9999 },
  ];
  const silver = [
    { date: "2024-01-04", close: 20 },
    { date: "2024-01-02", close: 25 },
    { date: "2024-01-06", close: 21 },
    { date: "2024-01-03", close: Number.NaN },
  ];
  const aligned = alignGoldSilverSeries(gold, silver);
  check("nur gemeinsame Tage, aufsteigend", aligned.map(p => p.date).join(",") === "2024-01-02,2024-01-04", aligned.map(p => p.date));
  check("Ratio = Gold/Silber", aligned[0].ratio === 2000 / 25 && aligned[0].gold === 2000 && aligned[0].silver === 25);
  check("zweiter Tag 2020/20", aligned[1].ratio === 101);
  check("Silber-Tag ohne Gold fällt weg", !aligned.some(p => p.date === "2024-01-06"));
  check("Gold-Tag ohne Silber fällt weg", !aligned.some(p => p.date === "2024-01-03"));
  check("erster Gold-Close gewinnt bei Doppeldatum", aligned[0].gold === 2000);
  check("0, NaN und kaputtes Datum erzeugen keinen Punkt", alignGoldSilverSeries(
    [{ date: "2024-01-02", close: 10 }],
    [{ date: "2024-01-02", close: 0 }],
  ).length === 0);
}

console.log("\nQuellwahl wie pickLongerSource");
{
  const point = (date: string) => [{ date, gold: 2, silver: 1, ratio: 2 }];
  const same = (fmpDate: string, yahooDate: string) => {
    const picked = pickLongerSource([{ date: fmpDate, close: 1 }], [{ date: yahooDate, close: 1 }]).source.startsWith("Yahoo") ? "yahoo" : "fmp";
    return chooseLongerRatioSeries(point(fmpDate), point(yahooDate)).vendor === picked;
  };
  check("Yahoo nur wenn > 365 Tage früher", same("2020-01-02", "2018-01-01") && chooseLongerRatioSeries(point("2020-01-02"), point("2018-01-01")).vendor === "yahoo");
  check("FMP bleibt, wenn Yahoo weniger als ein Jahr früher beginnt", same("2020-06-01", "2020-01-02") && chooseLongerRatioSeries(point("2020-06-01"), point("2020-01-02")).vendor === "fmp");
  check("FMP leer → Yahoo", chooseLongerRatioSeries([], point("2001-01-02")).vendor === "yahoo");
  check("Yahoo leer → FMP", chooseLongerRatioSeries(point("2024-01-02"), []).vendor === "fmp" && chooseLongerRatioSeries(point("2024-01-02"), []).points[0].source === undefined);
  const mixed = buildGoldSilverRatioHistory({
    fmpGold: [{ date: "2024-01-02", close: 2000 }, { date: "2024-01-03", close: 2100 }],
    fmpSilver: [{ date: "2024-01-02", close: 25 }],
    yahooGold: [{ date: "2010-01-04", close: 1100 }, { date: "2024-01-02", close: 1800 }],
    yahooSilver: [{ date: "2010-01-04", close: 18 }, { date: "2024-01-02", close: 20 }],
  });
  check("gemischte Anbieter werden nicht an einem Tag verrechnet", mixed.points.every(p => p.date !== "2024-01-03") && mixed.points[0].date === "2010-01-04");
  check("längere Yahoo-Reihe gewinnt komplett, Quelle steht dran", mixed.source === YAHOO_RATIO_SOURCE && mixed.goldSource === "Yahoo GC=F (Futures)" && mixed.points[0].ratio === 1100 / 18);
  const fmpOnly = buildGoldSilverRatioHistory({
    fmpGold: [{ date: "2024-01-02", close: 4200 }, { date: "2024-01-03", close: 4300 }],
    fmpSilver: [{ date: "2024-01-02", close: 50 }, { date: "2024-01-03", close: 51 }],
    yahooGold: [{ date: "2023-06-01", close: 1900 }],
    yahooSilver: [{ date: "2023-06-01", close: 23 }],
  });
  check("ähnliche Tiefe bleibt FMP, Ratio 84", fmpOnly.source === FMP_RATIO_SOURCE && fmpOnly.points.length === 2 && fmpOnly.points[0].ratio === 84);
  const none = buildGoldSilverRatioHistory({ fmpGold: [], fmpSilver: [], yahooGold: [{ date: "2024-01-02", close: 1 }], yahooSilver: [] });
  check("ohne gemeinsames Bein: leer und Grund, keine erfundene Linie", none.points.length === 0 && none.unavailableReason != null && none.source === FMP_RATIO_SOURCE);
}

console.log("\nFenster 3M–Max folgt den Chart-Daten");
{
  const ratioDates = ["2024-01-02", "2024-06-03", "2026-10-01"];
  const threeM = ["2026-09-01", "2026-10-01", "2026-11-02"];
  const cov = ratioCoverageInWindow(threeM, ratioDates);
  check("im Fenster nur der gemeinsame Tag", cov.matched === 1 && cov.firstMatch === "2026-10-01" && !cov.startsWithWindow);
  check("Max behält jeden gemeinsamen Tag", ratioCoverageInWindow(["2024-01-02", "2024-06-03", "2026-10-01"], ratioDates).matched === 3);
  const miss = goldSilverRatioAvailability({
    pending: false, loadError: null, unavailableReason: null, source: FMP_RATIO_SOURCE,
    windowDates: ["2020-01-02"], ratioDates: ["2024-01-02"],
  });
  check("Fenster ohne Treffer: Hinweis, keine Linie", miss.availability === "window-miss" && miss.hint?.includes("keine Werte in diesem Zeitfenster"));
  const partial = goldSilverRatioAvailability({
    pending: false, loadError: null, unavailableReason: null, source: FMP_RATIO_SOURCE,
    windowDates: threeM, ratioDates,
  });
  check("Teilabdeckung nennt das erste Datum und die Quelle", partial.availability === "partial" && partial.hint?.includes("ab 2026-10-01") && partial.hint?.includes(FMP_RATIO_SOURCE));
  const ready = goldSilverRatioAvailability({
    pending: false, loadError: null, unavailableReason: null, source: YAHOO_RATIO_SOURCE,
    windowDates: ["2024-01-02", "2024-06-03"], ratioDates,
  });
  check("volle Abdeckung ohne Warnhinweis", ready.availability === "ready" && ready.hint == null);
  const down = goldSilverRatioAvailability({
    pending: false, loadError: "HTTP 502", unavailableReason: "HTTP 502", source: FMP_RATIO_SOURCE,
    windowDates: threeM, ratioDates: [],
  });
  check("Ladefehler bleibt sichtbar", down.availability === "missing" && down.hint === "Gold/Silber-Ratio: n/a — HTTP 502");
}

console.log("\nRoute");
{
  let fmpCalls = 0;
  const seen: string[] = [];
  let clock = 0;
  const app = express();
  registerGoldSilverRatioRoute(app, {
    now: () => clock,
    quote: async () => null,
    yahoo: async () => null,
    fmpHistorical: async (symbol) => {
      fmpCalls += 1;
      seen.push(symbol);
      if (symbol === "GCUSD") return [{ date: "2024-01-02", close: 2000 }, { date: "2024-01-03", close: 2100 }, { date: "2024-01-08", close: 2200 }];
      if (symbol === "SIUSD") return [{ date: "2024-01-02", close: 25 }, { date: "2024-01-04", close: 20 }, { date: "2024-01-08", close: 22 }];
      return [];
    },
    yahooBars: async (symbol) => {
      seen.push(symbol);
      if (symbol === "GC=F") return [{ date: "2024-01-02", close: 1800 }];
      if (symbol === "SI=F") return [{ date: "2024-01-02", close: 30 }];
      return [];
    },
  });
  const srv = app.listen(0);
  const port = (srv.address() as { port: number }).port;
  const get = async () => (await fetch(`http://127.0.0.1:${port}/api/gold-silver-ratio/history`)).json();
  const body = await get();
  check("HTTP-Reihe nur gemeinsame FMP-Tage", body.points.map((p: { date: string }) => p.date).join(",") === "2024-01-02,2024-01-08", body.points);
  check("80 = 2000/25 und 100 = 2200/22", body.points[0].ratio === 80 && body.points[1].ratio === 100);
  check("Quelle FMP, weil Yahoo nicht früher beginnt", body.source === FMP_RATIO_SOURCE && body.goldSource === "FMP GCUSD" && body.silverSource === "FMP SIUSD");
  check("beide Symbole wie der Gold-Kurs", seen.includes("GCUSD") && seen.includes("SIUSD") && seen.includes("GC=F") && seen.includes("SI=F"));
  const callsAfterFirst = fmpCalls;
  await get();
  check("vollständige Historie 10 min gecacht", fmpCalls === callsAfterFirst);
  clock += 11 * 60 * 1000;
  await get();
  check("nach TTL neu geladen", fmpCalls > callsAfterFirst);
  srv.close();

  const loaded = await loadGoldSilverRatioHistory({
    fmpHistorical: async () => [],
    yahooBars: async (symbol) => symbol === "GC=F"
      ? [{ date: "2000-08-30", close: 274 }, { date: "2000-08-31", close: 278 }]
      : [{ date: "2000-08-30", close: 4.9 }, { date: "2000-09-01", close: 5 }],
  });
  check("ohne FMP springt Yahoo ein, nur der gemeinsame Tag", loaded.source === YAHOO_RATIO_SOURCE && loaded.points.length === 1 && loaded.points[0].date === "2000-08-30" && loaded.points[0].ratio === 274 / 4.9);
}

console.log("\nChart-Verdrahtung");
{
  const chart = readFileSync(new URL("../client/src/components/gold/GoldPriceChart.tsx", import.meta.url), "utf8");
  check("Toggle wie die anderen Overlays", chart.includes('data-testid="toggle-gold-silver-ratio"') && chart.includes("Gold/Silber-Ratio"));
  check("eigene rechte Achse", chart.includes('yAxisId="gsRatio"') && chart.includes("GS_RATIO_AXIS_WIDTH"));
  check("keine Verbindung über Lücken", /dataKey="gsRatio"[\s\S]{0,240}connectNulls=\{false\}/.test(chart));
  check("Hinweis statt leerer Linie", chart.includes('data-testid="gold-silver-ratio-note"') && chart.includes('data-testid="gold-silver-ratio-na"'));
  check("Quelle in Legende und Tooltip", chart.includes('data-testid="gold-silver-ratio-legend"') && chart.includes('data-testid="gold-silver-ratio-tooltip-source"'));
  check("Historie über die eigene Route", chart.includes('"/api/gold-silver-ratio/history"'));
  const routes = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
  check("analyze-gold liest weiter kein Silber", !/SIUSD|gold-silver-ratio\/history/.test(routes));
  const miner = readFileSync(new URL("../client/src/components/gold/GoldMinerBreakevenSection.tsx", import.meta.url), "utf8");
  check("Miner-Sektion unberührt von der Ratio", !miner.includes("gold-silver-ratio"));
}

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
