/**
 * F1-45: Rest-Overlays in „Vier Märkte“ — Buffett, CAPE, Zinskurve (T10Y2Y), M2 (M2SL), Google Trends.
 * Jede Linie auf eigener z-Achse über das Chart-Fenster, Default aus wie #330 (470c28c5), kein Score.
 * Schwellen (Median, Perzentil, Peer-Position) nur aus der Reihe im Fenster.
 *
 * Echte Sektion (createRoot + React.act auf script/lib/fake-dom), Märkte aus
 * script/fixtures/recession-s10-credit-t10y-live.json. Recharts zeichnet hier nicht —
 * geprüft werden Schalter, Abrufe, Statuszeile (Quelle + Datum) und der z-Helfer.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-s10-rest-overlays-f1-45.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { installFakeDom, reactPropsOf, findByTestId, FakeElement } from "./lib/fake-dom";

(globalThis as any).React = React;
(FakeElement.prototype as any).getElementsByClassName = () => [];

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { doc } = installFakeDom({ hash: "#/recession" });
const fx = JSON.parse(readFileSync(new URL("./fixtures/recession-s10-credit-t10y-live.json", import.meta.url), "utf8"));
const spy = fx.markets.markets.find((m: any) => m.id === "SPY");
const dates: string[] = spy.ohlcv.map((b: any) => b.date);

function seriesOn(step: number, valueAt: (i: number) => number) {
  const out: { date: string; value: number }[] = [];
  dates.forEach((date, i) => { if (i % step === 0) out.push({ date, value: valueAt(out.length) }); });
  return out;
}

const buffettUs = {
  region: "US",
  asOf: dates[dates.length - 1],
  sources: [{ id: "^W5000", role: "Wilshire" }, { id: "GDP", role: "BIP" }],
  points: seriesOn(15, i => 140 + i).map(p => ({ date: p.date, ratio: p.value })),
  note: "Test",
};
const buffettEu = { ...buffettUs, region: "EU", sources: [{ id: "DDDM01EZA156NWDB", role: "Weltbank" }, { id: "^STOXX", role: "Kurs" }] };
const buffettCn = { ...buffettUs, region: "CN", sources: [{ id: "DDDM01CNA156NWDB", role: "Weltbank" }, { id: "ASHR", role: "Proxy" }] };

let mode: "ok" | "fail" | "empty" = "ok";
const calls: string[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
(globalThis as any).fetch = async (input: any) => {
  const url = String(input?.url ?? input);
  calls.push(url);
  if (url.includes("/api/analyze-recession/markets")) return json(fx.markets);
  if (url.includes("/api/credit-spread/market")) return json(fx.credit);
  if (url.includes("/api/analyze-btc/real10y-history")) return json(fx.real10y);
  if (url.includes("/api/analyze-recession/google-trends")) {
    if (mode === "fail") return new Response("upstream", { status: 503 });
    if (mode === "empty") return json({ source: "Google-Trends-Cache", points: [], asOf: null, note: "Google-Trends-Cache leer", ageHours: null, isStale: false });
    return json({
      source: "Google Trends via SerpApi (7d Ø=60, Latest=70, Peak=100)",
      points: seriesOn(3, i => 40 + (i % 7)),
      asOf: dates[dates.length - 1],
      note: null,
      ageHours: 1,
      isStale: false,
    });
  }
  if (url.includes("/api/analyze-recession/fred-history")) {
    if (mode === "fail") return new Response("upstream", { status: 503 });
    if (mode === "empty") return json({ seriesId: "T10Y2Y", source: "FRED T10Y2Y (US)", points: [], note: "FRED nicht erreichbar oder leer" });
    const series = url.includes("series=M2SL") ? "M2SL" : "T10Y2Y";
    const source = series === "M2SL" ? "FRED M2SL YoY (US)" : "FRED T10Y2Y (US)";
    return json({ seriesId: series, source, points: seriesOn(series === "M2SL" ? 21 : 5, i => series === "M2SL" ? 2 + i * 0.15 : -0.4 + i * 0.03), note: null });
  }
  if (url.includes("/api/analyze-recession/cape")) {
    if (mode === "fail") return new Response("upstream", { status: 503 });
    if (mode === "empty") return json({ source: "Multpl Shiller PE (US)", sourceUrl: "https://www.multpl.com/shiller-pe/table/by-month", points: [], note: "Multpl nicht erreichbar oder leer" });
    return json({
      source: "Multpl Shiller PE (US)",
      sourceUrl: "https://www.multpl.com/shiller-pe/table/by-month",
      points: seriesOn(21, i => 20 + i * 0.4),
      note: null,
    });
  }
  if (url.includes("/api/analyze-recession/buffett")) {
    if (mode === "fail") return json({ error: "Buffett-Quote nicht verfügbar: Timeout" }, 502);
    if (mode === "empty") return json({ region: "US", asOf: null, sources: [], points: [], note: "leer" });
    if (url.includes("region=EU")) return json(buffettEu);
    if (url.includes("region=CN")) return json(buffettCn);
    return json(buffettUs);
  }
  return json({});
};

async function main() {
  let ov: any = null;
  try { ov = await import("../shared/recession-rest-overlays"); }
  catch (e: any) { check("shared/recession-rest-overlays lädt", false, e?.message ?? String(e)); }

  console.log("1) z-Score über das Chart-Fenster (handgerechnet)");
  const zFn = ov?.windowZScore;
  check("windowZScore exportiert", typeof zFn === "function");
  if (typeof zFn === "function") {
    const hand = zFn([
      { date: "2020-01-01", value: 1 },
      { date: "2020-01-02", value: 2 },
      { date: "2020-01-03", value: 3 },
    ], "2020-01-01", "2020-01-03");
    check("n=3, μ=2, s=1, z=−1/0/1", hand && hand.mean === 2 && hand.sd === 1 && hand.points.map((p: any) => p.z).join(",") === "-1,0,1", JSON.stringify(hand?.points));
    check("Median-z = 0 (aus den z-Werten, nicht fest)", hand?.medianZ === 0, String(hand?.medianZ));
    check("letzter Punkt Peer-Perzentil 100 (größter Rohwert)", hand?.latest?.peerPercentile === 100, String(hand?.latest?.peerPercentile));
    const dropped = zFn([
      { date: "2019-01-01", value: 100 },
      { date: "2020-01-02", value: 2 },
      { date: "2020-01-03", value: 3 },
    ], "2020-01-01", "2020-01-03");
    check("Punkt vor dem Fenster zählt nicht (μ der zwei Werte, nicht gezogen von 100)", dropped?.points?.length === 2 && dropped.mean === 2.5, JSON.stringify(dropped));
    check("konstante Reihe → kein z (s=0), kein Ersatz", zFn([
      { date: "2020-01-01", value: 5 },
      { date: "2020-01-02", value: 5 },
    ], "2020-01-01", "2020-01-02") === null);
    check("minPoints steht als benannte Konstante", ov.REST_OVERLAY_PARAMS?.minPoints === 2, JSON.stringify(ov.REST_OVERLAY_PARAMS));
  }
  check("Markt → Buffett-Region: SPY/QQQ US, VGK EU, ASHR CN", ov?.marketBuffettRegion?.("SPY") === "US" && ov?.marketBuffettRegion?.("QQQ") === "US" && ov?.marketBuffettRegion?.("VGK") === "EU" && ov?.marketBuffettRegion?.("ASHR") === "CN");

  console.log("2) Sektion: Buffett-Schalter, Default aus, Quelle+Datum, US/EU/Asien");
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { getQueryFn } = await import("../client/src/lib/queryClient");
  const mod: any = await import("../client/src/components/recession/RecessionMarketChartsSection");
  const act = (React as any).act as (cb: () => Promise<void>) => Promise<void>;
  const settle = async (ms = 40) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
  const origError = console.error; const origWarn = console.warn;
  function quietOn() { console.error = () => {}; console.warn = () => {}; }
  function quietOff() { console.error = origError; console.warn = origWarn; }

  async function mount() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(mod.RecessionMarketChartsSection, { number: 10 }))); });
    for (let i = 0; i < 30 && !findByTestId(c, "price-chart"); i++) await settle(30);
    return { c, root };
  }
  const click = async (el: FakeElement | null) => {
    if (!el) return;
    await act(async () => { reactPropsOf(el)?.onClick?.({}); });
    for (let i = 0; i < 8; i++) await settle(40);
  };

  quietOn();
  calls.length = 0;
  const { c, root } = await mount();
  const tB = findByTestId(c, "toggle-recession-buffett");
  check("Schalter Buffett vorhanden", !!tB && tB.textContent === "Buffett", tB?.textContent);
  check("Default aus", !!tB && reactPropsOf(tB)?.["aria-pressed"] === false);
  check("Default aus: keine Buffett-Statuszeile und kein Abruf", !findByTestId(c, "recession-buffett-status") && !calls.some(u => u.includes("buffett")), calls.filter(u => u.includes("buffett")).join(","));
  check("Baa-Spread und Real 10J bleiben", findByTestId(c, "toggle-recession-credit")?.textContent === "Baa-Spread" && findByTestId(c, "toggle-recession-t10y")?.textContent === "Real 10J");

  await click(tB);
  const sB = findByTestId(c, "recession-buffett-status")?.textContent ?? "";
  const lastBuffett = buffettUs.points[buffettUs.points.length - 1];
  check("Buffett an: genau ein Abruf region=US", calls.filter(u => u.includes("/api/analyze-recession/buffett?region=US")).length === 1, calls.filter(u => u.includes("buffett")).join(","));
  check("Status nennt Quelle ^W5000 und GDP", sB.includes("^W5000") && sB.includes("GDP"), sB);
  check(`Status nennt Datum ${lastBuffett.date}`, sB.includes(lastBuffett.date), sB);
  check("Status: eigene z-Achse, US, kein Score-Einfluss", sB.includes("z") && sB.includes("US") && sB.includes("kein Score-Einfluss"), sB);
  check("Preis-Chart bleibt", !!findByTestId(c, "price-chart"));

  await click(findByTestId(c, "tab-vgk"));
  const sEu = findByTestId(c, "recession-buffett-status")?.textContent ?? "";
  check("VGK (EU): Abruf region=EU, Status EU + Quelle", calls.some(u => u.includes("region=EU")) && sEu.includes("EU") && sEu.includes("DDDM01EZA156NWDB") && sEu.includes(lastBuffett.date), sEu);

  await click(findByTestId(c, "tab-ashr"));
  const sAs = findByTestId(c, "recession-buffett-status")?.textContent ?? "";
  check("ASHR (Asien): Abruf region=CN, Status Asien + Quelle", calls.some(u => u.includes("region=CN")) && sAs.includes("Asien") && sAs.includes("DDDM01CNA156NWDB") && sAs.includes(lastBuffett.date), sAs);

  await click(findByTestId(c, "toggle-recession-buffett"));
  check("Buffett wieder aus → Statuszeile weg", !findByTestId(c, "recession-buffett-status"));
  await act(async () => { root.unmount(); });

  for (const m of ["fail", "empty"] as const) {
    mode = m;
    const r = await mount();
    await click(findByTestId(r.c, "toggle-recession-buffett"));
    const a = findByTestId(r.c, "recession-buffett-status")?.textContent ?? "";
    check(`${m}: Status n/a, keine aktuelle z-Zahl`, a.includes(": n/a") && !/aktuell /.test(a), a);
    check(`${m}: Preis-Chart bleibt`, !!findByTestId(r.c, "price-chart"));
    await act(async () => { r.root.unmount(); });
  }
  quietOff();

  console.log("3) CAPE: dieselbe Multpl-Tabelle wie scoreCAPE, Linie mit Quelle+Datum");
  mode = "ok";
  let multplCapeSeries: (html: string) => { date: string; value: number }[] = () => [];
  let CAPE_SOURCE_URL = "";
  try {
    const capeMod = await import("../server/recession-cape-route.ts");
    multplCapeSeries = capeMod.multplCapeSeries;
    CAPE_SOURCE_URL = capeMod.CAPE_SOURCE_URL;
  } catch (e: any) {
    check("server/recession-cape-route lädt", false, e?.message ?? String(e));
  }
  const { latestMultplCape } = await import("../server/recession.ts");
  const capeHtml = `<table><tr><td>Oct 1, 2026</td><td>39.2</td></tr><tr><td>Sep 1, 2024</td><td>32.1</td></tr><tr><td>Jan 1, 2020</td><td>4.0</td></tr></table>`;
  const capeSeries = multplCapeSeries(capeHtml);
  const capeLatest = latestMultplCape(capeHtml);
  check("URL ist die von scoreCAPE", CAPE_SOURCE_URL.length > 0 && readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8").includes(CAPE_SOURCE_URL), CAPE_SOURCE_URL);
  check("4.0 liegt außerhalb und fällt weg, zwei Drucke bleiben", capeSeries.length === 2 && capeSeries.every((p: { value: number }) => p.value >= 5), JSON.stringify(capeSeries));
  check("erster Druck = latestMultplCape (Score-Parser unverändert)", capeLatest?.date === "2026-10-01" && capeLatest.value === 39.2 && capeSeries[0]?.date === capeLatest.date && capeSeries[0]?.value === capeLatest.value);

  calls.length = 0;
  const capeMount = await mount();
  await click(findByTestId(capeMount.c, "toggle-recession-cape"));
  const capePoints = seriesOn(21, i => 20 + i * 0.4);
  const capeLast = capePoints[capePoints.length - 1];
  const sCape = findByTestId(capeMount.c, "recession-cape-status")?.textContent ?? "";
  check("Schalter CAPE", findByTestId(capeMount.c, "toggle-recession-cape")?.textContent === "CAPE");
  check("CAPE an: ein Abruf /api/analyze-recession/cape", calls.filter(u => u.includes("/api/analyze-recession/cape")).length === 1, calls.filter(u => u.includes("cape")).join(","));
  check("CAPE-Status: Multpl, US, Datum, kein Score", sCape.includes("Multpl") && sCape.includes("US") && sCape.includes(capeLast.date) && sCape.includes("kein Score-Einfluss"), sCape);
  await click(findByTestId(capeMount.c, "tab-vgk"));
  await click(findByTestId(capeMount.c, "tab-ashr"));
  const sCapeAs = findByTestId(capeMount.c, "recession-cape-status")?.textContent ?? "";
  check("CAPE auf EU- und Asien-Tab bleibt die US-Reihe mit Datum", sCapeAs.includes("US") && sCapeAs.includes(capeLast.date) && calls.filter(u => u.includes("/api/analyze-recession/cape")).length === 1, sCapeAs);
  await act(async () => { capeMount.root.unmount(); });

  for (const m of ["fail", "empty"] as const) {
    mode = m;
    const r = await mount();
    await click(findByTestId(r.c, "toggle-recession-cape"));
    const a = findByTestId(r.c, "recession-cape-status")?.textContent ?? "";
    check(`CAPE ${m}: n/a ohne aktuelle z-Zahl`, a.includes(": n/a") && !/aktuell /.test(a), a);
    await act(async () => { r.root.unmount(); });
  }

  console.log("4) Zinskurve T10Y2Y über fred-csv");
  mode = "ok";
  let fredMod: any = null;
  try { fredMod = await import("../server/recession-fred-history-route.ts"); }
  catch (e: any) { check("fred-history-Route lädt", false, e?.message ?? String(e)); }
  if (fredMod) {
    const { fredCsvObservations } = await import("../server/fred-csv.ts");
    const csv = "DATE,T10Y2Y\n2024-01-02,-0.20\n2024-01-03,.\n2024-01-04,0.15\n";
    const obs = fredCsvObservations(csv);
    check("Parser wirft '.' weg", obs.length === 2 && obs[1].value === 0.15, JSON.stringify(obs));
    const body = await fredMod.loadFredHistory("T10Y2Y", async () => csv);
    check("Route reicht fred-csv-Beobachtungen durch", body.points.length === 2 && body.points[0].date === "2024-01-02" && body.source.includes("T10Y2Y"), JSON.stringify(body));
    const denied = await fredMod.loadFredHistory("DGS10", async () => csv);
    check("DGS10 bleibt zu", denied.points.length === 0 && /nicht/.test(denied.note ?? ""), JSON.stringify(denied));
  }

  calls.length = 0;
  const curveMount = await mount();
  await click(findByTestId(curveMount.c, "toggle-recession-curve"));
  const curveLast = seriesOn(5, i => -0.4 + i * 0.03).at(-1)!;
  const sCurve = findByTestId(curveMount.c, "recession-curve-status")?.textContent ?? "";
  check("Schalter Zinskurve", findByTestId(curveMount.c, "toggle-recession-curve")?.textContent === "Zinskurve");
  check("ein Abruf series=T10Y2Y", calls.filter(u => u.includes("/api/analyze-recession/fred-history?series=T10Y2Y")).length === 1, calls.filter(u => u.includes("fred-history")).join(","));
  check("Status: T10Y2Y, US, Datum, kein Score", sCurve.includes("T10Y2Y") && sCurve.includes("US") && sCurve.includes(curveLast.date) && sCurve.includes("kein Score-Einfluss"), sCurve);
  await click(findByTestId(curveMount.c, "tab-vgk"));
  await click(findByTestId(curveMount.c, "tab-ashr"));
  const sCurveAs = findByTestId(curveMount.c, "recession-curve-status")?.textContent ?? "";
  check("Kurve auf EU/Asien bleibt T10Y2Y (US) mit Datum", sCurveAs.includes("T10Y2Y") && sCurveAs.includes("US") && sCurveAs.includes(curveLast.date), sCurveAs);
  await act(async () => { curveMount.root.unmount(); });
  for (const m of ["fail", "empty"] as const) {
    mode = m;
    const r = await mount();
    await click(findByTestId(r.c, "toggle-recession-curve"));
    const a = findByTestId(r.c, "recession-curve-status")?.textContent ?? "";
    check(`Kurve ${m}: n/a ohne aktuelle z-Zahl`, a.includes(": n/a") && !/aktuell /.test(a), a);
    await act(async () => { r.root.unmount(); });
  }

  console.log("5) M2 YoY aus M2SL, gleicher Lag wie yoyPercent");
  mode = "ok";
  const { m2YoyPoints, M2_YOY_PARAMS } = ov;
  const { yoyPercent } = await import("../server/recession.ts");
  const levels = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(2023, i, 1)).toISOString().slice(0, 10);
    return { date: d, value: 100 + i * 2 };
  });
  check("Lag ist 12 Beobachtungen", M2_YOY_PARAMS?.lagObservations === 12, JSON.stringify(M2_YOY_PARAMS));
  const yoy = typeof m2YoyPoints === "function" ? m2YoyPoints(levels) : [];
  check("ein YoY-Druck, identisch zu yoyPercent", yoy.length === 1 && yoy[0].value === yoyPercent(levels) && yoy[0].date === levels[12].date, `${yoy[0]?.value} vs ${yoyPercent(levels)}`);
  if (fredMod?.loadFredHistory) {
    const csv = ["DATE,M2SL", ...levels.map(p => `${p.date},${p.value}`)].join("\n");
    const m2Body = await fredMod.loadFredHistory("M2SL", async () => csv);
    check("Route liefert YoY, nicht das Niveau", m2Body.points.length === 1 && m2Body.points[0].value === yoyPercent(levels) && m2Body.source.includes("M2SL"), JSON.stringify(m2Body));
  } else check("Route kennt M2SL", false);

  calls.length = 0;
  const m2Mount = await mount();
  await click(findByTestId(m2Mount.c, "toggle-recession-m2"));
  const m2Last = seriesOn(21, i => 2 + i * 0.15).at(-1)!;
  const sM2 = findByTestId(m2Mount.c, "recession-m2-status")?.textContent ?? "";
  check("Schalter M2", findByTestId(m2Mount.c, "toggle-recession-m2")?.textContent === "M2");
  check("ein Abruf series=M2SL", calls.filter(u => u.includes("series=M2SL")).length === 1, calls.filter(u => u.includes("fred-history")).join(","));
  check("Status: M2SL, US, Datum, kein Score", sM2.includes("M2SL") && sM2.includes("US") && sM2.includes(m2Last.date) && sM2.includes("kein Score-Einfluss"), sM2);
  await click(findByTestId(m2Mount.c, "tab-ashr"));
  const sM2As = findByTestId(m2Mount.c, "recession-m2-status")?.textContent ?? "";
  check("M2 auf Asien-Tab bleibt die US-Reihe mit Datum", sM2As.includes("M2SL") && sM2As.includes(m2Last.date), sM2As);
  await act(async () => { m2Mount.root.unmount(); });
  for (const m of ["fail", "empty"] as const) {
    mode = m;
    const r = await mount();
    await click(findByTestId(r.c, "toggle-recession-m2"));
    const a = findByTestId(r.c, "recession-m2-status")?.textContent ?? "";
    check(`M2 ${m}: n/a ohne aktuelle z-Zahl`, a.includes(": n/a") && !/aktuell /.test(a), a);
    await act(async () => { r.root.unmount(); });
  }

  console.log("6) Google-Trends-Cache, keine zweite Quelle");
  mode = "ok";
  let trendsMod: any = null;
  try { trendsMod = await import("../server/recession-trends-route.ts"); }
  catch (e: any) { check("trends-Route lädt", false, e?.message ?? String(e)); }
  const scoreSrc = readFileSync(new URL("../server/recession.ts", import.meta.url), "utf8");
  const scoreFn = scoreSrc.slice(scoreSrc.indexOf("function scoreGoogleTrends"), scoreSrc.indexOf("function scoreCrowdLeg"));
  check("Score öffnet weiter keine Route", !scoreFn.includes("app.get") && !scoreFn.includes("app.post"));
  if (trendsMod) {
    const routeSrc = readFileSync(new URL("../server/recession-trends-route.ts", import.meta.url), "utf8");
    check("Route ruft SerpApi nicht selbst", !routeSrc.includes("serpapi.com"));
    const { resetGoogleTrendsCache, writeGoogleTrendsCache, parseSerpApiGoogleTrends } = await import("../server/cache/google-trends-cache.ts");
    resetGoogleTrendsCache();
    check("leerer Cache → n/a", trendsMod.readGoogleTrendsOverlay(Date.parse("2026-11-01T12:00:00Z")).points.length === 0);
    const raw = JSON.stringify({ interest_over_time: { timeline_data: [
      { timestamp: "1761004800", values: [{ extracted_value: 40 }] },
      { timestamp: "1761091200", values: [{ extracted_value: 70 }] },
    ] } });
    const parsed = parseSerpApiGoogleTrends(raw);
    check("7d-Ø des Score-Parsers bleibt 55", parsed?.value === 55, JSON.stringify(parsed));
    writeGoogleTrendsCache({ value: parsed!.value, timestamp: Date.parse("2026-10-22T00:00:00Z"), source: parsed!.source, points: trendsMod.pointsFromSerp(raw) });
    const body = trendsMod.readGoogleTrendsOverlay(Date.parse("2026-10-22T01:00:00Z"));
    check("Route gibt die Cache-Punkte zurück", body.points.length === 2 && body.points[1].value === 70 && body.source.includes("SerpApi"), JSON.stringify(body));
    resetGoogleTrendsCache();
  }

  calls.length = 0;
  const trMount = await mount();
  await click(findByTestId(trMount.c, "toggle-recession-trends"));
  const trLast = seriesOn(3, i => 40 + (i % 7)).at(-1)!;
  const sTr = findByTestId(trMount.c, "recession-trends-status")?.textContent ?? "";
  check("Schalter Trends", findByTestId(trMount.c, "toggle-recession-trends")?.textContent === "Trends");
  check("ein Abruf google-trends", calls.filter(u => u.includes("/api/analyze-recession/google-trends")).length === 1, calls.filter(u => u.includes("trends")).join(","));
  check("Status: SerpApi, US, Datum, kein Score", sTr.includes("SerpApi") && sTr.includes("US") && sTr.includes(trLast.date) && sTr.includes("kein Score-Einfluss"), sTr);
  await click(findByTestId(trMount.c, "tab-vgk"));
  const sTrEu = findByTestId(trMount.c, "recession-trends-status")?.textContent ?? "";
  check("Trends auf EU-Tab bleibt der US-Cache mit Datum", sTrEu.includes("US") && sTrEu.includes(trLast.date) && calls.filter(u => u.includes("google-trends")).length === 1, sTrEu);
  await act(async () => { trMount.root.unmount(); });
  for (const m of ["fail", "empty"] as const) {
    mode = m;
    const r = await mount();
    await click(findByTestId(r.c, "toggle-recession-trends"));
    const a = findByTestId(r.c, "recession-trends-status")?.textContent ?? "";
    check(`Trends ${m}: n/a ohne aktuelle z-Zahl`, a.includes(": n/a") && !/aktuell /.test(a), a);
    await act(async () => { r.root.unmount(); });
  }

  console.log(failed ? `\n${failed} Check(s) fehlgeschlagen` : "\nAlle Checks grün");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.log("❌ Abbruch:", e?.stack ?? e); process.exit(1); });
