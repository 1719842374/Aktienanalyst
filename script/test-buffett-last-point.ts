/** JOB 18: Beschriftung am letzten Datenpunkt des Buffett-Charts (baut auf cursor/buffett-chart-current-date-4fbd auf). */
import { readFileSync } from "fs";
import { lastPointLabel, axisTicks, proxySuffix } from "../client/src/components/recession/buffettChartScale";
import { rollClosesForward, ROLL_FORWARD_MAX_DAYS } from "../server/buffett-ratio";
let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };
check("Label: gerundete Quote + Datum", lastPointLabel({ date: "2026-10-05", ratio: 211.4 }) === "211 % · 05.10.26");
check("ohne Punkt / kaputt → null", lastPointLabel(null) === null && lastPointLabel({ date: "x", ratio: 1 }) === null && lastPointLabel({ date: "2026-10-05", ratio: NaN }) === null);
const rows = [{ date: "2026-04-06" }, { date: "2026-10-05" }];
check("Achse endet auf dem letzten Punkt (Branch-Logik bleibt)", axisTicks(rows, "6M", true).at(-1) === Date.parse("2026-10-05T00:00:00Z"));
const src = readFileSync(new URL("../client/src/components/recession/BuffettRatioPanel.tsx", import.meta.url), "utf8");
check("Punkt am letzten Datenpunkt in allen Fenstern", src.includes('data-testid="buffett-last-point"') && src.includes("<circle cx={x} cy={y} r={4}"));
// JOB 22 (#245-Follow-up): Label jetzt auch im Max-Fenster (Tester: fehlte am letzten Punkt), dort unter dem Punkt.
check("Kurzlabel in allen Fenstern inkl. Max (unter dem Punkt)", src.includes("{lastPointLabel(last) && (") && src.includes("y={showCallout || y < 24 ? y + 18 : y - 9}"));
check("Max-Callout aus dem Branch unverändert", src.includes('data-testid="text-buffett-callout"') && src.includes("const showCallout = props.range === \"Max\";"));
// #245: Proxy-Flag, Label/Tooltip, max. 30 Tage
check("Proxy-Label: '211 % · 05.10.26 (fortgeschrieben via VTI)'", lastPointLabel({ date: "2026-10-05", ratio: 211.2, proxy: "VTI" }) === "211 % · 05.10.26 (fortgeschrieben via VTI)");
check("Proxy-Label ^DWCF", lastPointLabel({ date: "2026-10-05", ratio: 211, proxy: "^DWCF" })!.endsWith("(fortgeschrieben via ^DWCF)"));
check("ohne Proxy kein Zusatz", proxySuffix({}) === "" && proxySuffix(null) === "");
const rolled = rollClosesForward([{ date: "2026-09-01", close: 100 }], [{ date: "2026-09-01", close: 50 }, { date: "2026-09-15", close: 55 }, { date: "2026-10-01", close: 60 }, { date: "2026-10-02", close: 61 }]);
check("30-Tage-Grenze", ROLL_FORWARD_MAX_DAYS === 30);
check("bis inkl. 30 Tage fortgeschrieben, danach endet die Linie", rolled.map(b => b.date).join() === "2026-09-01,2026-09-15,2026-10-01");
check("jeder fortgeschriebene Punkt trägt proxy, Primärpunkt nicht", !rolled[0].proxy && rolled.slice(1).every(b => b.proxy === true));
const routeSrc = readFileSync(new URL("../server/buffett-route.ts", import.meta.url), "utf8");
check("Route setzt proxy-Symbol je Punkt", routeSrc.includes("proxyDates.has(point.date) ? { ...point, proxy: proxy.id } : point"));
check("Tooltip mit Proxy-Zusatz", src.includes("return `${longDate(iso)}${proxySuffix(row)}`;"));

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
