/**
 * FW-17 — Gold/Bond GC=F / TLT, nur Anzeige.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-fw17-gold-bond.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GOLD_BOND_PARAMS,
  alignGoldBond,
  closesFromYahooChart,
  goldBondSnapshot,
  type DatedClose,
} from "../shared/gold-bond-ratio";
import { loadGoldBondRatio } from "../server/gold-bond-ratio";
import { GoldBondRatioView } from "../client/src/components/gold/GoldBondRatioRow";

(globalThis as any).React = React;

let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  n++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

function series(start: string, gold0: number, bond0: number, days: number, goldStep: number): { gold: DatedClose[]; bond: DatedClose[] } {
  const gold: DatedClose[] = [];
  const bond: DatedClose[] = [];
  const t0 = Date.parse(`${start}T00:00:00Z`);
  for (let i = 0; i < days; i++) {
    const date = new Date(t0 + i * 86400000).toISOString().slice(0, 10);
    gold.push({ date, close: gold0 + i * goldStep });
    bond.push({ date, close: bond0 });
  }
  return { gold, bond };
}

const aligned = alignGoldBond(
  [{ date: "2026-01-01", close: 2000 }, { date: "2026-01-02", close: 0 }, { date: "2026-01-03", close: 2100 }],
  [{ date: "2026-01-01", close: 100 }, { date: "2026-01-03", close: 105 }],
);
check("gemeinsame Tage, 0 und fehlende Tage fallen weg", aligned.length === 2 && aligned[1].ratio === 2100 / 105);

const short = goldBondSnapshot(series("2026-01-01", 2000, 100, 10, 1).gold, series("2026-01-01", 2000, 100, 10, 1).bond);
check("kurzes Fenster: Verhältnis da, Verteilung n/a", short.ratio != null && short.percentile == null && short.distributionReason?.startsWith("n/a — zu wenige"));

const long = series("2024-01-01", 1800, 100, GOLD_BOND_PARAMS.minPointsForDistribution, 2);
const snap = goldBondSnapshot(long.gold, long.bond);
check("60 Tage: letztes Verhältnis ist das höchste Perzentil", snap.ratio != null && snap.percentile != null && snap.percentile > 95, String(snap.percentile));
check("z ist eine Zahl aus der eigenen Reihe", snap.z != null && snap.z > 0, String(snap.z));

const missingBond = goldBondSnapshot([{ date: "2026-01-01", close: 2000 }], null);
check("fehlender Anleihekurs ist n/a, nicht 0", missingBond.ratio == null && missingBond.unavailableReason === "n/a — Anleihekurs (Yahoo TLT) fehlt");

const chart = closesFromYahooChart({
  chart: { result: [{ timestamp: [1761004800], indicators: { quote: [{ close: [2345.5] }] } }] },
});
check("Yahoo-Chart wird gelesen", chart?.[0].close === 2345.5);
check("leerer Chart ist null", closesFromYahooChart({ chart: { result: [] } }) == null);

const loaded = await loadGoldBondRatio(async (symbol) => {
  if (symbol === "GC=F") return long.gold;
  if (symbol === "TLT") return long.bond;
  return null;
});
check("Route-Helfer reicht beide Symbole durch", loaded.ratio === snap.ratio && loaded.source.includes("GC=F") && loaded.source.includes("TLT"));

const html = renderToStaticMarkup(React.createElement(GoldBondRatioView, { data: snap }));
check("Zeile nennt Verhältnis, Perzentil und kein Score", html.includes("Gold/Bond") && html.includes("Perzentil") && html.includes("nur Anzeige, kein Score") && html.includes("flex-wrap"));
const naHtml = renderToStaticMarkup(React.createElement(GoldBondRatioView, { data: missingBond }));
check("n/a-Zeile zeigt den Grund", naHtml.includes("n/a — Anleihekurs (Yahoo TLT) fehlt") && !naHtml.includes(">0<"));

const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
check("VOW3 (VWAGY) 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");

console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
