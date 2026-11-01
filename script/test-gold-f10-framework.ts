/**
 * F10-22 Angebotsreaktion, F10-33 MA-Kreuz-Backtest, F10-34 Zentralbankkäufe,
 * Gold-GIS und QE/QT nur als „n/a — Philip-Entscheidung offen“.
 * Kein GIS, kein analyze-route. Ausführen: npx tsx script/test-gold-f10-framework.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Z_HISTORY_MIN, adaptiveZ, MA_FAST, MA_SLOW } from "../server/gold-adaptive-score";
import { loadGoldMineSupply } from "../server/gold-mine-supply";
import { loadCentralBankPurchases } from "../server/gold-central-bank";
import { quarterPeriodEnd } from "../shared/gold-aisc";
import {
  buildGoldMineSupply,
  type GoldMineProductionFile,
  type GoldMineProductionValue,
} from "../shared/gold-mine-supply";
import { backtestGoldMaCrosses } from "../shared/gold-ma-backtest";
import { interpretCentralBankLlm } from "../shared/gold-central-bank";
import { PHILIP_PENDING_TEXT, philipPendingResponse } from "../shared/gold-philip-pending";
import {
  GoldCentralBankBody,
  GoldMaBacktestBody,
  GoldMineSupplyBody,
  GoldPhilipPendingBody,
} from "../client/src/components/gold/GoldFrameworkCards";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function quarterAt(index: number): string {
  const year = 2016 + Math.floor(index / 4);
  const q = (index % 4) + 1;
  return `${year}-Q${q}`;
}

function sourceDateAfter(quarter: string): string {
  const end = Date.parse(`${quarterPeriodEnd(quarter)}T00:00:00Z`);
  return new Date(end + 40 * 86400000).toISOString().slice(0, 10);
}

function value(company: "NEM" | "B" | "AEM", index: number, koz: number): GoldMineProductionValue {
  const quarter = quarterAt(index);
  return {
    company,
    quarter,
    koz,
    sourceUrl: `https://example.com/${company}/${quarter}`,
    sourceTitle: `${company} Quartalsbericht ${quarter}`,
    sourceDate: sourceDateAfter(quarter),
  };
}

function fileOf(values: GoldMineProductionValue[], reasonEmpty?: string): GoldMineProductionFile {
  return {
    unit: "koz",
    basis: "attributable gold production",
    retrievedAt: "2026-11-01",
    reasonEmpty,
    companies: {
      NEM: { name: "Newmont", ticker: "NEM", metric: "koz" },
      B: { name: "Barrick", ticker: "B", metric: "koz" },
      AEM: { name: "Agnico Eagle", ticker: "AEM", metric: "koz" },
    },
    values,
  };
}

console.log("\nAngebotsreaktion");
{
  const shipped = loadGoldMineSupply();
  check("Repo ohne Mengen: n/a, kein Score", shipped.available === false && shipped.affectsScore === false && !!shipped.reason?.startsWith("n/a —"));
  check("Grund nennt die drei Produzenten", !!shipped.reason?.includes("Newmont") && !/\"koz\":\s*0/.test(JSON.stringify(shipped)));

  const values: GoldMineProductionValue[] = [];
  for (let i = 0; i < 36; i++) {
    values.push(value("NEM", i, 1000 + i * 10));
    values.push(value("AEM", i, 800 + i * 5));
  }
  values.push(value("B", 35, 700));
  const built = buildGoldMineSupply(fileOf(values), adaptiveZ, Z_HISTORY_MIN);
  const barrick = built.rows.find(row => row.company === "B");
  const newmont = built.rows.find(row => row.company === "NEM");
  check("letztes Quartal ist 2024-Q4", built.quarter === "2024-Q4", built.quarter ?? "");
  check("Barrick ohne Vorjahr bleibt n/a", barrick?.yoy == null && !!barrick?.yoyReason?.includes("Vorjahresquartal"));
  check("Newmont hat eine YoY-Rate", newmont?.yoy != null && newmont.yoy !== 0);
  check("Peer-Median aus zwei Produzenten", built.peerSample === 2 && built.peerMedianYoy != null);
  check("z-Score aus der eigenen Historie", built.z != null && built.historyQuarters >= Z_HISTORY_MIN, `z=${built.z} n=${built.historyQuarters}`);
  check("Perzentil liegt in 0–100", built.percentile != null && built.percentile >= 0 && built.percentile <= 100, String(built.percentile));
  check("kein Score-Feld", built.affectsScore === false && !("score" in built));

  const one = buildGoldMineSupply(fileOf([value("NEM", 4, 1100), value("NEM", 0, 1000)]), adaptiveZ, Z_HISTORY_MIN);
  check("ein Produzent: Peer n/a", one.peerMedianYoy == null && !!one.peerMedianReason?.includes("weniger als 2"));

  const gap = fileOf([value("NEM", 0, 1000), value("NEM", 5, 1100)]);
  const gapped = buildGoldMineSupply(gap, adaptiveZ, Z_HISTORY_MIN);
  check("fehlendes Vorjahresquartal wird nicht aufgefüllt", gapped.rows[0]?.yoy == null);

  const bad = fileOf([{ ...value("NEM", 0, 0) }]);
  const rejected = buildGoldMineSupply(bad, adaptiveZ, Z_HISTORY_MIN);
  check("Menge 0 wird verworfen", rejected.available === false && !!rejected.reason?.startsWith("n/a —"));
}

console.log("\nMA-Kreuz-Backtest");
{
  const short = backtestGoldMaCrosses(Array.from({ length: 10 }, (_, i) => ({ date: `2020-01-${String(i + 1).padStart(2, "0")}`, close: 100 })));
  check("zu kurze Reihe: n/a, keine Trefferquote 0", short.available === false && short.golden == null && !!short.reason?.includes(String(MA_SLOW)));

  const points = [];
  const start = Date.parse("2018-01-01T00:00:00Z");
  for (let i = 0; i < 420; i++) {
    const close = i < 250 ? 100 : i < 300 ? 160 : 40;
    const date = new Date(start + i * 86400000).toISOString().slice(0, 10);
    points.push({ date, close });
  }
  const result = backtestGoldMaCrosses(points, MA_FAST, MA_SLOW);
  check("Perioden sind die benannten MA 50/200", result.fastPeriod === MA_FAST && result.slowPeriod === MA_SLOW && MA_FAST === 50 && MA_SLOW === 200);
  check("Golden Cross wird abgeschlossen", !!result.golden && result.golden.completed >= 1 && result.golden.medianReturn != null, JSON.stringify(result.golden));
  check("Rendite ist die Bewegung bis zum Gegenkreuz", result.golden?.medianReturn != null && result.golden.medianReturn < 0, String(result.golden?.medianReturn));
  check("offenes Death Cross zählt nicht als 0-Treffer", !!result.death && result.death.completed === 0 && result.death.hitShare == null && !!result.death.reason, JSON.stringify(result.death));
  check("Backtest trägt kein Score", result.affectsScore === false && !("gis" in result));
}

console.log("\nZentralbankkäufe");
{
  const noKey = interpretCentralBankLlm(null, false);
  check("ohne Key: n/a, kein Flag 0", noKey.stance == null && noKey.reason === "n/a — OPENROUTER_API_KEY fehlt");
  const tonnes = interpretCentralBankLlm({ stance: "unclear", summary: "vielleicht", tonnes: 999 }, true);
  check("unklar bleibt n/a und übernimmt keine Tonnen", tonnes.stance == null && !("tonnes" in tonnes) && !!tonnes.reason?.startsWith("n/a —"));
  const buying = interpretCentralBankLlm({ stance: "net_buying", summary: "Die Schlagzeilen nennen Käufe.", tonnes: 50 }, true);
  check("Nettokäufe ohne übernommene Menge", buying.stance === "net_buying" && buying.summary?.includes("Käufe") && !("tonnes" in buying));

  let calls = 0;
  const deps = {
    now: Date.parse("2026-11-01T12:00:00Z"),
    llmAvailable: true,
    fetchHeadlines: async () => ["Central banks buy gold"],
    complete: async () => {
      calls += 1;
      return { stance: "net_buying", summary: "Käufe in den Schlagzeilen." };
    },
    cacheGet: () => null as any,
    cacheSet: () => {},
  };
  const first = await loadCentralBankPurchases(deps);
  check("LLM-Hinweis ohne Score", first.available && first.stance === "net_buying" && first.affectsScore === false && calls === 1);
  const empty = await loadCentralBankPurchases({ ...deps, fetchHeadlines: async () => [] });
  check("ohne Meldungen n/a", empty.available === false && empty.reason === "n/a — keine Gold-Meldungen" && empty.stance == null);
  const offline = await loadCentralBankPurchases({ ...deps, llmAvailable: false });
  check("Route ohne Key ruft das Modell nicht", offline.reason === "n/a — OPENROUTER_API_KEY fehlt" && calls === 1);
}

console.log("\nPhilip-Anzeige");
{
  const pending = philipPendingResponse();
  check("Gold-GIS exakt der Satz", pending.gis.text === PHILIP_PENDING_TEXT && pending.gis.text === "n/a — Philip-Entscheidung offen");
  check("QE/QT exakt der Satz", pending.qeQt.text === PHILIP_PENDING_TEXT);
  check("beide ohne Score", pending.affectsScore === false);
}

console.log("\nOberfläche, 375 und 1440");
{
  const supply = buildGoldMineSupply(fileOf([value("NEM", 4, 1100), value("NEM", 0, 1000), value("AEM", 4, 900), value("AEM", 0, 1000)]), () => null, Z_HISTORY_MIN);
  const html = [
    renderToStaticMarkup(React.createElement(GoldMineSupplyBody, { data: supply })),
    renderToStaticMarkup(React.createElement(GoldMineSupplyBody, { data: loadGoldMineSupply() })),
    renderToStaticMarkup(React.createElement(GoldMaBacktestBody, { data: backtestGoldMaCrosses([]) })),
    renderToStaticMarkup(React.createElement(GoldCentralBankBody, { data: {
      affectsScore: false, available: false, stance: null, stanceLabel: null, summary: null,
      updatedAt: null, cacheTtlHours: 12, headlineCount: 0, reason: "n/a — OPENROUTER_API_KEY fehlt",
    } })),
    renderToStaticMarkup(React.createElement(GoldPhilipPendingBody, { data: philipPendingResponse() })),
  ].join("\n");
  check("n/a-Gründe und Philip-Satz stehen im Markup", html.includes("Peer-Median") && html.includes("n/a — Philip-Entscheidung offen") && html.includes("n/a — OPENROUTER_API_KEY fehlt") && html.includes("weniger als"));
  check("Philip-Satz zweimal", (html.match(/n\/a — Philip-Entscheidung offen/g) || []).length === 2);
  check("Karten bleiben in der Breite fließend", html.includes('data-layout="fluid"') && html.includes("min-w-0") && html.includes("max-w-full") && html.includes("flex-wrap") && html.includes("overflow-x-auto") && html.includes("break-words"));
  check("kein Festpixel über 320", !/w-\[(\d{3,})/.test(html) && !/min-w-\[(\d{3,})/.test(html));
  const dash = readFileSync(new URL("../client/src/pages/GoldDashboard.tsx", import.meta.url), "utf8");
  const price = dash.indexOf("<GoldPriceSection");
  const news = dash.indexOf("<GoldNewsCard data={data} />");
  const chart = dash.indexOf("<GoldPriceChart");
  check("News bleibt vor dem Chart, eine News-Karte", price > 0 && price < news && news < chart && dash.split("<GoldNewsCard").length === 2);
  check("vier Zusatzkarten hängen am Dashboard", ["GoldCentralBankCard", "GoldMineSupplyCard", "GoldMaBacktestCard", "GoldPhilipPendingCard"].every(name => dash.includes(`<${name}`)));
  check("Dashboard-Rahmen bleibt max-w-5xl (1440) und p-3 (375)", dash.includes("max-w-5xl") && dash.includes("p-3 sm:p-4"));
}

console.log("\nKette und Score");
{
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8");
  check("routes.ts hängt die vier Pfade ein", routes.includes("registerGoldFrameworkRoutes(app)"));
  const handler = readFileSync(new URL("../server/gold-framework-routes.ts", import.meta.url), "utf8");
  for (const path of ["/api/analyze-gold/mine-supply", "/api/analyze-gold/ma-cross-backtest", "/api/analyze-gold/central-bank-purchases", "/api/analyze-gold/philip-pending"]) {
    check(`Route ${path}`, handler.includes(`"${path}"`));
  }
  const glued = [
    "server/gold-mine-supply.ts",
    "server/gold-ma-backtest.ts",
    "server/gold-central-bank.ts",
    "server/gold-framework-routes.ts",
    "shared/gold-mine-supply.ts",
    "shared/gold-ma-backtest.ts",
    "shared/gold-central-bank.ts",
    "shared/gold-philip-pending.ts",
    "client/src/components/gold/GoldFrameworkCards.tsx",
  ].map(path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")).join("\n");
  check("kein analyze-route, kein Gesamtscore", !/analyze-route|overallScore|finalScore|computeThesisStrength/.test(glued));
  const head = JSON.parse(readFileSync(new URL("../script/fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
  const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
  check("VOW3 (VWAGY) 4.735718", round6(head.VWAGY.overallScore) === 4.735718, String(head.VWAGY.overallScore));
  check("SAP 5.174758", round6(head.SAP.overallScore) === 5.174758, String(head.SAP.overallScore));
  check("MSFT 4.058138", round6(head.MSFT.overallScore) === 4.058138, String(head.MSFT.overallScore));
  check("Fixture-Scores sind die Referenz vor und nach dieser Anzeige", round6(head.VWAGY.overallScore) === 4.735718 && round6(head.SAP.overallScore) === 5.174758 && round6(head.MSFT.overallScore) === 4.058138);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll gold F10 framework checks passed.");
