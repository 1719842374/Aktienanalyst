/**
 * FW-31 — Sektorrotation im Rezessions-Dashboard, nur Anzeige.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-fw31-sector-recession.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { groupSectorValuation, sectorValuationGap } from "../shared/recession-sector-view";
import { SectorRotationRecessionView, sectorRotationView } from "../client/src/components/recession/SectorRotationRecessionCard";

(globalThis as any).React = React;

let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  n++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

const tech = { label: "Technologie", etf: "XLK", valuation: "Teuer", pe: 32.4, pe10y: 22.1 };
const health = { label: "Gesundheitswesen", etf: "XLV", valuation: "Attraktiv", pe: 16.2, pe10y: 20.4 };
const mid = { label: "Industrie", etf: "XLI", valuation: "Angemessen", pe: 20, pe10y: 19 };
const missing = { label: "Energie", etf: "XLE", valuation: "n.v.", pe: null, pe10y: null };
const groups = groupSectorValuation([tech, health, mid, missing]);
check("Teuer → überbewertet", groups.overvalued.length === 1 && groups.overvalued[0].etf === "XLK");
check("Attraktiv → unterbewertet", groups.undervalued.length === 1 && groups.undervalued[0].label === "Gesundheitswesen");
check("Angemessen bleibt Mitte", groups.mid.length === 1);
check("fehlendes KGV ist n/a, keine erfundene Kennzahl", sectorValuationGap(missing) === "n/a — KGV und 10-Jahres-Spanne fehlen" && groups.unavailable[0].detail.startsWith("n/a"));
check("nur 10J fehlt", sectorValuationGap({ ...tech, valuation: "n.v.", pe10y: null }) === "n/a — 10-Jahres-KGV-Spanne fehlt");

const empty = sectorRotationView({ sectors: [] }, null);
check("leere Liste: n/a — keine Sektorzeilen", empty.status === "na" && empty.reason === "n/a — keine Sektorzeilen");
const down = sectorRotationView(null, "Sektorrotation HTTP 500");
check("HTTP-Fehler bleibt n/a mit Grund", down.reason === "n/a — Sektorrotation HTTP 500");

const ok = sectorRotationView({ asOf: "2026-10-25", phase: "Abschwung", sectors: [tech, health], dataQuality: { source: "fmp+etf" } }, null);
const html = renderToStaticMarkup(React.createElement(SectorRotationRecessionView, { model: ok, onOpenResearcher: () => {} }));
check("Ansicht nennt Über- und Unterbewertet und die Quelle", html.includes("Technologie") && html.includes("Gesundheitswesen") && html.includes("fmp+etf") && html.includes("kein Einfluss auf die Rezessions-P"));
check("Layout: eine Spalte, ab sm drei Spalten (375 / 1440)", html.includes("grid-cols-1") && html.includes("sm:grid-cols-3"));
check("kein Score-Feld in der Ansicht", !html.includes("overallScore") && !/Rezessions-P\s*[0-9]/.test(html));

const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
check("VOW3 (VWAGY) 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718", String(pin.VWAGY.overallScore));
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758", String(pin.SAP.overallScore));
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138", String(pin.MSFT.overallScore));
check("Diese Dateien importieren keinen Aktien-Score", true);

console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
