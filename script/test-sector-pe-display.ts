/**
 * Sektor-KGV als Anzeige. Der Rotations-Score bleibt außen vor.
 * Aufruf: npx tsx script/test-sector-pe-display.ts
 */
import { readFileSync } from "node:fs";
import {
  canStopHoldingsFetch,
  composeSectorPeDisplay,
  etfPeHistory,
  formatSectorPeText,
  weightedHarmonicPe,
} from "../shared/sector-pe-display";
import { parseHoldingRows, pickRatioPe } from "../server/sector-pe-route";
import { computeSectorRotation } from "../server/sector-rotation";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

const holdings = [
  { symbol: "A", weight: 20, pe: 10 },
  { symbol: "B", weight: 20, pe: 20 },
  { symbol: "C", weight: 5, pe: null },
];
// Harmonisch: Gewichte 20 und 20, PE 10 und 20 → 2 / (20/10 + 20/20) * 20 wait
// value = included / sum(w/pe) = 40 / (2 + 1) = 13.333
const h = weightedHarmonicPe(holdings);
check("harmonisches Mittel 13,3", h.value != null && Math.abs(h.value - 40 / 3) < 1e-9, String(h.value));
check("fehlendes PE wird nicht zu 0", h.value !== 0);

const hole = weightedHarmonicPe([
  { symbol: "BIG", weight: 50, pe: null },
  { symbol: "A", weight: 10, pe: 12 },
  { symbol: "B", weight: 10, pe: 18 },
]);
check("große Lücke bleibt n/a", hole.value === null && hole.note?.startsWith("n/a") === true);

const thin = weightedHarmonicPe([{ symbol: "ONLY", weight: 30, pe: 15 }]);
check("eine Position ist nicht breiter als sie selbst", thin.value === null);

check("Fetch stoppt, wenn der Rest die Entscheidung nicht kippt", canStopHoldingsFetch(4, holdings) === true);
check("Fetch läuft weiter, wenn der Rest die Lücke vergrößert", canStopHoldingsFetch(50, holdings) === false);

const years = Array.from({ length: 11 }, (_, i) => ({
  date: `${2015 + i}-06-30`,
  pe: 20 + i,
}));
const hist = etfPeHistory(years);
check("10J-Schnitt nur bei gedeckter Spanne", hist.avg10y != null && hist.current === 30, String(hist.avg10y));
const short = etfPeHistory([{ date: "2023-06-30", pe: 22 }, { date: "2024-06-30", pe: 24 }]);
check("kurze Historie: aktuelles KGV, 10J n/a", short.current === 24 && short.avg10y === null && short.note?.includes("nicht 10J") === true);

const text = formatSectorPeText(28.4, 22.1, null);
check("Anzeige 28,4 (10J Ø 22,1)", text === "28,4 (10J Ø 22,1)", text);
check("ganz fehlend ist n/a", formatSectorPeText(null, null, "n/a — kein positives ETF-KGV").startsWith("n/a"));

const parsed = parseHoldingRows([
  { asset: "msft", weightPercentage: 22.5 },
  { symbol: "Kein Name" },
  { asset: "aapl", weight: 0 },
]);
check("Holdings-Parser", parsed[0]?.symbol === "MSFT" && parsed[0]?.weight === 22.5 && parsed.every(r => r.symbol !== "KEIN NAME"));
check("PE-Felder", pickRatioPe({ priceToEarningsRatio: 18.2 }) === 18.2 && pickRatioPe({ pe: 0 }) === null);

const display = composeSectorPeDisplay({
  id: "technology",
  etf: "XLK",
  label: "Technologie",
  holdings,
  etfHistory: years,
  holdingsNote: null,
});
check("Quelle Holdings, Score-Flag nicht Teil der Zeile", display.source === "holdings-harmonic" && display.current != null && display.avg10y != null);

const empty = composeSectorPeDisplay({
  id: "utilities",
  etf: "XLU",
  label: "Versorger",
  holdings: null,
  etfHistory: [],
  holdingsNote: "n/a — Holdings nicht geladen",
});
check("ohne Daten n/a mit Grund", empty.current === null && empty.text.startsWith("n/a") && empty.text !== "0");

const before = computeSectorRotation({
  asOf: "2026-10-28",
  recession: { indicators: [], subgroups: [], nyFedValue: null, interpretation: "" },
  sectors: [{ id: "technology", pe: 28, pe10y: 22, return6M: 0.1, vol60d: 0.2, betaSpx: 1, maxDd12m: -0.1 }],
});
const after = computeSectorRotation({
  asOf: "2026-10-28",
  recession: { indicators: [], subgroups: [], nyFedValue: null, interpretation: "" },
  sectors: [{ id: "technology", pe: 28, pe10y: 22, return6M: 0.1, vol60d: 0.2, betaSpx: 1, maxDd12m: -0.1 }],
});
check("Rotations-Score hängt nicht an der Anzeige", JSON.stringify(before.sectors.map(s => s.attractiveness)) === JSON.stringify(after.sectors.map(s => s.attractiveness)));
check("Anzeige-Modul steht nicht im Score-File", !readFileSync(new URL("../server/sector-rotation-score.ts", import.meta.url), "utf8").includes("sector-pe-display"));

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nSektor-KGV Anzeige ok");
