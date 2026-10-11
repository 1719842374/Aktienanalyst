/** JOB 18: Beschriftung am letzten Datenpunkt des Buffett-Charts (baut auf cursor/buffett-chart-current-date-4fbd auf). */
import { readFileSync } from "fs";
import { lastPointLabel, axisTicks } from "../client/src/components/recession/buffettChartScale";
let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
check("Label: gerundete Quote + Datum", lastPointLabel({ date: "2026-10-05", ratio: 211.4 }) === "211 % · 05.10.26");
check("ohne Punkt / kaputt → null", lastPointLabel(null) === null && lastPointLabel({ date: "x", ratio: 1 }) === null && lastPointLabel({ date: "2026-10-05", ratio: NaN }) === null);
const rows = [{ date: "2026-04-06" }, { date: "2026-10-05" }];
check("Achse endet auf dem letzten Punkt (Branch-Logik bleibt)", axisTicks(rows, "6M", true).at(-1) === Date.parse("2026-10-05T00:00:00Z"));
const src = readFileSync(new URL("../client/src/components/recession/BuffettRatioPanel.tsx", import.meta.url), "utf8");
check("Punkt am letzten Datenpunkt in allen Fenstern", src.includes('data-testid="buffett-last-point"') && src.includes("<circle cx={x} cy={y} r={4}"));
check("Kurzlabel nur ohne Max-Callout (keine Doppelung)", src.includes("{!showCallout && lastPointLabel(last) && ("));
check("Max-Callout aus dem Branch unverändert", src.includes('data-testid="text-buffett-callout"') && src.includes("const showCallout = props.range === \"Max\";"));
console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
