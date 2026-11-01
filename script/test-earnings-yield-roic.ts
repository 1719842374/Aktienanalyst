/**
 * Earnings Yield und ROIC 5Y — nur Anzeige.
 * Aufruf: npx tsx script/test-earnings-yield-roic.ts
 */
import {
  earningsYieldPct,
  joinFundamentalsOntoPrices,
  medianIndexScale,
  percentAxisDomain,
} from "../shared/earnings-yield-roic";
import { buildEarningsYieldPoints, buildRoicPoints } from "../server/earnings-yield-roic-route";
import { FUNDAMENTAL_PEER_ROW_CLASS, fundamentalOverlayLayout } from "../client/src/lib/fundamentalOverlayLayout";

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (!cond) {
    failures++;
    console.error(`❌ ${label}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`✅ ${label}`);
  }
}

const y = earningsYieldPct(83e9, 2e12);
check("EBIT/EV = 4,15 %", y.value != null && Math.abs(y.value - 4.15) < 1e-9, String(y.value));
check("fehlendes EBIT ist n/a, nicht 0", earningsYieldPct(null, 10).value === null && earningsYieldPct(null, 10).note?.startsWith("n/a") === true);
check("EV 0 ist n/a, nicht 0", earningsYieldPct(10, 0).value === null && !String(earningsYieldPct(10, 0).note).includes("0 %"));
check("negativer EBIT bleibt negativ", earningsYieldPct(-5, 100).value === -5);

const built = buildEarningsYieldPoints(
  [
    { date: "2024-06-30", ebit: 100, operatingIncome: 90 },
    { date: "2023-06-30", operatingIncome: 40 },
    { date: "2022-06-30" },
  ],
  [
    { date: "2024-06-30", enterpriseValue: 1000 },
    { date: "2023-06-30", enterpriseValue: 800 },
  ],
  [],
);
check("2024 Yield 10 %", built.points.find(p => p.date.startsWith("2024"))?.value === 10);
check("2023 fällt auf operatingIncome zurück", built.points.find(p => p.date.startsWith("2023"))?.value === 5);
check("2022 ohne EBIT ist null", built.points.find(p => p.date.startsWith("2022"))?.value === null);
check("kein Punkt ist die Zahl 0", built.points.every(p => p.value !== 0));

const fallback = buildEarningsYieldPoints(
  [{ date: "2024-06-30", ebit: 50 }],
  [],
  [{ date: "2024-06-30", enterpriseValue: 1000 }],
);
check("EV-Fallback key-metrics", fallback.points[0]?.value === 5 && fallback.points[0]?.note?.includes("key-metrics") === true);

const roic = buildRoicPoints([
  { date: "2024-06-30", returnOnInvestedCapital: 0.32 },
  { date: "2023-06-30", returnOnInvestedCapital: null },
  { date: "2021-06-30", returnOnInvestedCapital: 5 },
]);
check("ROIC 32 %", roic.points.find(p => p.date.startsWith("2024"))?.value === 32);
check("fehlender ROIC ist n/a", roic.points.find(p => p.date.startsWith("2023"))?.value === null && roic.points.find(p => p.date.startsWith("2023"))?.note?.startsWith("n/a") === true);
check("unplausibler ROIC ist n/a, nicht geclippt", roic.points.find(p => p.date.startsWith("2021"))?.value === null);

const joined = joinFundamentalsOntoPrices(["2024-01-02", "2024-07-01", "2025-01-02"], {
  earningsYield: [{ date: "2024-06-30", value: 4.2, note: null }],
  roic: [{ date: "2024-06-30", value: 28, note: null }],
  peerRoic: [{ date: "2024-06-30", value: 15, note: null }],
  peerBars: [{ date: "2024-01-02", close: 50 }, { date: "2025-01-02", close: 100 }],
  subjectCloses: [200, 200, 200],
  showEarningsYield: true,
  showRoic: true,
  showPeerRoic: true,
  showPeerPrice: true,
});
check("As-of vor dem Stichtag bleibt leer", joined[0].earningsYieldPct === null && joined[0].roicPct === null);
check("As-of nach dem Stichtag trägt Yield und ROIC", joined[1].earningsYieldPct === 4.2 && joined[2].roicPct === 28 && joined[2].peerRoicPct === 15);
const scale = medianIndexScale([200, 200, 200], [50, 100]);
check("Median-Index skaliert den Peer-Kurs", scale.scale != null && joined[2].peerPriceIndexed === 100 * scale.scale);

const domain = percentAxisDomain([10, 12, 11, 40]);
check("Achse kommt aus der Serie und enthält die Punkte", domain[0] < 10 && domain[1] > 40);
check("leere Achse ist kein Daten-Null", percentAxisDomain([])[0] === 0 && percentAxisDomain([null]).length === 2);

check("375 gestapelt", fundamentalOverlayLayout(375) === "stacked");
check("1440 in einer Zeile", fundamentalOverlayLayout(1440) === "inline");
check("Peer-Zeile stapelt unter sm und liegt ab sm in einer Zeile", FUNDAMENTAL_PEER_ROW_CLASS.includes("flex-col") && FUNDAMENTAL_PEER_ROW_CLASS.includes("sm:flex-row") && FUNDAMENTAL_PEER_ROW_CLASS.includes("min-w-0"));

if (failures > 0) {
  console.error(`\n${failures} Fehler`);
  process.exit(1);
}
console.log("\nEarnings Yield / ROIC Anzeige ok");
