/**
 * F3-04 / F4-05 / N/A-Grund: Retry nur bei HTTP 429, letzter gültiger Wert bleibt
 * der Score, ein geschlossener Slot zeigt „n/a — Grund“ und zählt nicht in die P.
 * Kette: RecessionDashboard → POST /api/analyze-recession → scoreGoogleTrends
 * → server/cache/google-trends-cache.ts → SerpApi.
 * Anzeige: Summary + Indikator-Tabelle. Overlay liest nur den Cache.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-google-trends-backoff.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { installFakeDom, findByTestId } from "./lib/fake-dom";

(globalThis as any).React = React;

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const timeline = (n: number) => JSON.stringify({
  interest_over_time: { timeline_data: [{ values: [{ extracted_value: n }] }] },
});

console.log("\n=== Backoff nur bei 429, benannte Parameter ===");
{
  const cache = await import("../server/cache/google-trends-cache.ts");
  check("max. 3 Versuche", cache.GOOGLE_TRENDS_BACKOFF.maxAttempts === 3);
  check("Basis, Faktor und Deckel sind benannt", cache.GOOGLE_TRENDS_BACKOFF.baseMs > 0 && cache.GOOGLE_TRENDS_BACKOFF.factor === 2 && cache.GOOGLE_TRENDS_BACKOFF.capMs >= cache.GOOGLE_TRENDS_BACKOFF.baseMs);

  const noHeader = cache.trendsBackoffDelayMs(0, null);
  const second = cache.trendsBackoffDelayMs(1, null);
  check("ohne Retry-After wächst die Pause mit dem Faktor", second === noHeader * cache.GOOGLE_TRENDS_BACKOFF.factor, `${noHeader} → ${second}`);
  check("Retry-After wird genutzt, aber nicht über den Deckel", cache.trendsBackoffDelayMs(0, 50) === 50 && cache.trendsBackoffDelayMs(0, 60_000) === cache.GOOGLE_TRENDS_BACKOFF.capMs);

  const sleeps: number[] = [];
  const calls: number[] = [];
  const recovered = await cache.collectTrendsFetch({
    sleep: (ms: number) => { sleeps.push(ms); },
    call: () => {
      calls.push(1);
      if (calls.length === 1) return { status: 429, body: "{\"error\":\"rate\"}", retryAfterMs: 50 };
      return { status: 200, body: timeline(62), retryAfterMs: null };
    },
  });
  check("429 dann 200: ein Warten, der Körper des zweiten Versuchs", recovered.ok === true && recovered.attempts === 2 && recovered.body === timeline(62) && sleeps.length === 1 && sleeps[0] === 50, JSON.stringify({ recovered, sleeps }));

  let loopRan = false;
  const yielded = await cache.collectTrendsFetch({
    sleep: (ms: number) => new Promise<void>((resolve) => {
      setTimeout(() => { loopRan = true; }, 0);
      setTimeout(resolve, ms);
    }),
    call: (() => {
      let n = 0;
      return () => {
        n += 1;
        if (n === 1) return { status: 429 as const, body: "", retryAfterMs: 15 };
        return { status: 200 as const, body: timeline(62), retryAfterMs: null };
      };
    })(),
  });
  check("die Pause gibt den Event-Loop frei", yielded.ok === true && loopRan === true, `ok=${yielded.ok} loop=${loopRan}`);

  const burned: number[] = [];
  const empty = await cache.collectTrendsFetch({
    sleep: () => { burned.push(1); },
    call: () => ({ status: 200, body: "{\"interest_over_time\":{\"timeline_data\":[]}}", retryAfterMs: null }),
  });
  check("leere Timeline ist ein Fehlversuch ohne weiteren Abruf", empty.ok === false && empty.kind === "empty" && empty.attempts === 1 && burned.length === 0 && empty.body == null);

  const limited = await cache.collectTrendsFetch({
    sleep: () => {},
    call: () => ({ status: 429, body: "", retryAfterMs: null }),
  });
  check("dauerhaft 429 stoppt nach den benannten Versuchen", limited.ok === false && limited.kind === "rate_limit" && limited.attempts === cache.GOOGLE_TRENDS_BACKOFF.maxAttempts && limited.delaysMs.length === cache.GOOGLE_TRENDS_BACKOFF.maxAttempts - 1);

  const timed = await cache.collectTrendsFetch({
    sleep: () => { burned.push(1); },
    call: () => ({ status: null, body: "", retryAfterMs: null }),
  });
  check("Timeout wird nicht wiederholt", timed.ok === false && timed.kind === "timeout" && timed.attempts === 1);

  check("429-Grund", cache.googleTrendsClosedLabel("rate_limit", 429, false) === "n/a — SerpApi-Limit (429), kein Wert innerhalb 48 h");
  check("älter als 48 h nennt den Abrufgrund und keinen erfundenen Wert", cache.googleTrendsClosedLabel("rate_limit", 429, true) === "n/a — letzter Wert älter als 48 h (SerpApi-Limit (429))" && !cache.googleTrendsClosedLabel("rate_limit", 429, true).includes("0"));
  check("Hinweis beim letzten gültigen Wert ändert das Gewicht nicht im Text auf eine neue Zahl", cache.googleTrendsFetchNote("rate_limit", 429) === "Abruf: SerpApi-Limit (429). Letzter gültiger Wert, Gewicht unverändert.");
}

console.log("\n=== Score und P bleiben bei demselben Druck ===");
{
  const { googleReading, probabilityFromNet, scoredTotals, vixReading } = await import("../server/recession.ts");
  const live = googleReading(62);
  const kept = googleReading(62, live.source, { ageHours: 30, isStale: true }, { fetchNote: "Abruf: SerpApi-Limit (429). Letzter gültiger Wert, Gewicht unverändert." });
  check("Zone, Gewicht 1.7 und gewichteter Score sind gleich", live.rawScore === kept.rawScore && live.weight === 1.7 && kept.weight === 1.7 && live.weightedScore === kept.weightedScore && live.maxWeighted === kept.maxWeighted && kept.fetchNote?.includes("Gewicht unverändert"), `w=${kept.weight} s=${kept.weightedScore}`);
  const vix = vixReading(18);
  const pLive = probabilityFromNet(scoredTotals([vix, live]).net, scoredTotals([vix, live]).max);
  const pKept = probabilityFromNet(scoredTotals([vix, kept]).net, scoredTotals([vix, kept]).max);
  check("dieselbe Zone ergibt dieselbe P", pLive === pKept, `${pLive} / ${pKept}`);

  const closed = googleReading(null, "Google Trends", undefined, { closedLabel: "n/a — SerpApi-Limit (429), kein Wert innerhalb 48 h" });
  check("geschlossener Slot: n/a mit Grund, nicht 0, nicht im Max", closed.available === false && closed.value === "n/a — SerpApi-Limit (429), kein Wert innerhalb 48 h" && closed.value !== "0" && closed.unavailableReason === closed.value && closed.weight === 0 && closed.maxWeighted === 0 && closed.rawScore === 0 && closed.weightedScore === 0, closed.value);
  const onlyVix = scoredTotals([vix]);
  const withClosed = scoredTotals([vix, closed]);
  check("geschlossener Trends-Slot ändert Netto, Max und P nicht", onlyVix.net === withClosed.net && onlyVix.max === withClosed.max && probabilityFromNet(onlyVix.net, onlyVix.max) === probabilityFromNet(withClosed.net, withClosed.max));
  check("ohne Grund bleibt der alte N/A-Text", googleReading(null).value === "N/A" && googleReading(null).unavailableReason == null);
}

console.log("\n=== Pipeline: 429 fällt nicht auf Score 0 ===");
{
  const server = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const scoreFn = server.slice(server.indexOf("function scoreGoogleTrends"), server.indexOf("function scoreCrowdLeg"));
  check("frischer Cache vor SerpApi", scoreFn.indexOf("freshGoogleTrends") !== -1 && scoreFn.indexOf("freshGoogleTrends") < scoreFn.indexOf("serpapi.com/search.json"));
  check("Backoff-Helfer sitzt vor accept", scoreFn.indexOf("collectTrendsFetch") !== -1 && scoreFn.indexOf("await collectTrendsFetch") < scoreFn.indexOf("acceptGoogleTrendsFetch"));
  check("kein pytrends und kein Redis", !scoreFn.includes("pytrends") && !scoreFn.includes("redis") && !scoreFn.includes("REDIS"));
  const trendsPath = server.slice(server.indexOf("async function requestSerpApi"), server.indexOf("function scoreCrowdLeg"));
  check("Pause ist setTimeout, nicht Atomics.wait", trendsPath.includes("setTimeout") && !trendsPath.includes("Atomics"));
  check("SerpApi-curl blockiert nicht über execSync", trendsPath.includes("execFileAsync") && !trendsPath.includes("execSync"));
  const tableSrc = readFileSync(new URL("../client/src/components/recession/recessionDashboardPartsB1.tsx", import.meta.url), "utf8");
  check("375 px bricht den Grund um, 1440 px lässt die Spalte offen", tableSrc.includes("break-words max-w-[11rem] min-[1440px]:max-w-none") && tableSrc.includes("overflow-x-auto"));
  const { readGoogleTrendsOverlay } = await import("../server/recession-trends-route.ts");
  const { resetGoogleTrendsCache, writeGoogleTrendsMiss } = await import("../server/cache/google-trends-cache.ts");
  resetGoogleTrendsCache();
  writeGoogleTrendsMiss("rate_limit", 429);
  const emptyOverlay = readGoogleTrendsOverlay(Date.parse("2026-11-01T12:00:00Z"));
  check("leerer Cache reicht den 429-Grund an die Overlay-Route", emptyOverlay.points.length === 0 && emptyOverlay.note === "SerpApi-Limit (429)" && emptyOverlay.unavailableReason === "n/a — SerpApi-Limit (429)", JSON.stringify(emptyOverlay));
  resetGoogleTrendsCache();
  check("Verfügbarkeit hängt nicht mehr allein am Text N/A", server.includes("googleRow.available !== false"));
  const names = execFileSync("git", ["diff", "--name-only"], { encoding: "utf8" });
  check("analyze-route.ts nicht in der Änderung", !names.split("\n").includes("server/analyze-route.ts"), names);
}

console.log("\n=== Anzeige 375 und 1440: Grund sichtbar, Tabelle bricht nicht die Seite ===");
{
  const { doc, win } = installFakeDom({ hash: "#/recession" });
  const { createRoot } = await import("react-dom/client");
  const { Summary } = await import("../client/src/components/recession/recessionDashboardPartsB2.tsx");
  const { IndicatorTable } = await import("../client/src/components/recession/recessionDashboardPartsB1.tsx");
  const act = (React as any).act as (cb: () => Promise<void>) => Promise<void>;

  const closedGoogle = {
    name: "Google Trends \"Recession\"",
    group: "correction" as const,
    subgroup: "sentiment_ext",
    value: "n/a — SerpApi-Limit (429), kein Wert innerhalb 48 h",
    rawScore: 0,
    weight: 0,
    weightedScore: 0,
    maxWeighted: 0,
    zone: "N/A",
    source: "Google Trends (N/A)",
    description: "Google-Suchinteresse",
    available: false,
    unavailableReason: "n/a — SerpApi-Limit (429), kein Wert innerhalb 48 h",
  };
  const data = {
    date: "01.11.2026",
    asOf: "2026-11-01",
    indicators: [closedGoogle],
    subgroups: [],
    nyFedValue: null,
    googleTrendsAvailable: false,
    topDrivers: [],
    interpretation: "Test",
    drivers: { status: "unauffällig" as const, lines: [], cards: [] },
    sources: [],
  };

  async function mountAt(width: number) {
    win.innerWidth = width;
    (globalThis as any).innerWidth = width;
    const c = doc.createElement("div");
    doc.body.appendChild(c);
    const root = createRoot(c as any);
    await act(async () => {
      root.render(React.createElement("div", { "data-width": String(width) },
        React.createElement(Summary, { data }),
        React.createElement(IndicatorTable, { indicators: [closedGoogle] }),
      ));
    });
    return { c, root };
  }

  for (const width of [375, 1440]) {
    const { c, root } = await mountAt(width);
    const note = findByTestId(c, "text-google-trends-age");
    const text = note?.textContent ?? "";
    check(`${width}px: Grund in der Zusammenfassung`, text.includes("n/a — SerpApi-Limit (429)") && text.includes("Der Slot bleibt geschlossen") && !text.includes("Score auf 0"), text);
    const cls = note?.attributes.class ?? "";
    check(`${width}px: Text umbricht (break-words)`, cls.includes("break-words"), cls);
    const tableWrap = c.childNodes[0]?.childNodes.find((n: any) => String(n?.attributes?.class ?? "").includes("overflow-x-auto") || n.childNodes?.some((x: any) => String(x?.attributes?.class ?? "").includes("overflow-x-auto")));
    const html = c.textContent ?? "";
    check(`${width}px: Wertspalte sagt n/a und nicht die Zahl 0 als Score`, html.includes("n/a — SerpApi-Limit (429)") && html.includes("n/a"), html.slice(0, 400));
    check(`${width}px: Tabelle liegt in overflow-x-auto`, /overflow-x-auto/.test(c.textContent ? "" : "") || deepClass(c).includes("overflow-x-auto"));
    await act(async () => { root.unmount(); });
    c.parentNode?.removeChild(c);
  }
}

function deepClass(n: any): string {
  const own = n?.attributes?.class ?? "";
  const kids = (n?.childNodes ?? []).map((c: any) => deepClass(c)).join(" ");
  return `${own} ${kids}`;
}

console.log("\n=== Aktien-Scores unverändert ===");
{
  const head = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  check("VOW3 (VWAGY) 4.735718", round6(head.VWAGY.overallScore) === 4.735718, String(head.VWAGY.overallScore));
  check("SAP 5.174758", round6(head.SAP.overallScore) === 5.174758, String(head.SAP.overallScore));
  check("MSFT 4.058138", round6(head.MSFT.overallScore) === 4.058138, String(head.MSFT.overallScore));
}

console.log(`\n${total - failed}/${total} Checks grün.`);
if (failed) process.exit(1);
