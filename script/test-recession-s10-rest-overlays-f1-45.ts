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

  console.log(failed ? `\n${failed} Check(s) fehlgeschlagen` : "\nAlle Checks grün");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.log("❌ Abbruch:", e?.stack ?? e); process.exit(1); });
