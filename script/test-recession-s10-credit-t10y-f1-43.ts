/**
 * F1-43 / F1-45 (ohne F1-41): Rezessions-Sektion „Vier Märkte“ bekommt zwei Overlay-Schalter im
 * Preis-Pane — Markt-Spread Baa (FRED BAA10Y) und Real 10J (FRED DFII10, wie #267 Real10Y). Bestehende Endpoints
 * /api/credit-spread/market und /api/analyze-btc/real10y-history, nur Anzeige, kein Score. Default aus.
 *
 * Echte Sektion (createRoot + React.act auf script/lib/fake-dom), fetch gestubbt mit Live-Payloads
 * (script/fixtures/recession-s10-credit-t10y-live.json). Recharts zeichnet in fake-dom nicht —
 * geprüft werden Schalter, Abrufe, Statuszeilen und der geteilte Join-Helper.
 * Gegenprobe: auf main (2e360ca9) fehlen Schalter und Helper → exit 1; auf 438f26ac (nominal DGS10) → exit 1.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-recession-s10-credit-t10y-f1-43.ts
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
const lastC = fx.credit.points.at(-1), lastT = fx.real10y.latestReal10y;

let mode: "ok" | "fail" | "empty" = "ok";
const calls: string[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
(globalThis as any).fetch = async (input: any) => {
  const url = String(input?.url ?? input);
  calls.push(url);
  if (url.includes("/api/analyze-recession/markets")) return json(fx.markets);
  if (url.includes("/api/credit-spread/market")) {
    if (mode === "fail") return new Response("upstream", { status: 503 });
    if (mode === "empty") return json({ ...fx.credit, points: [], stress: null, note: "FRED nicht erreichbar oder leer" });
    return json(fx.credit);
  }
  if (url.includes("/api/analyze-btc/real10y-history")) {
    if (mode === "fail") return json({ error: "FRED DFII10 nicht verfügbar" }, 502);
    if (mode === "empty") return json({ real10yByDate: {}, latestReal10y: null });
    return json(fx.real10y);
  }
  return json({});
};

async function main() {
  const { createRoot } = await import("react-dom/client");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { getQueryFn } = await import("@/lib/queryClient");
  const mod: any = await import("@/components/recession/RecessionMarketChartsSection");
  const act = (React as any).act as (cb: () => Promise<void>) => Promise<void>;
  const settle = async (ms = 60) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };
  const origError = console.error; const origWarn = console.warn;

  console.log("1) Join-Helper (geteilt mit shared/credit as-of-Join)");
  const join = mod.withRecessionMacroOverlays;
  check("withRecessionMacroOverlays exportiert", typeof join === "function");
  const spy = fx.markets.markets.find((m: any) => m.id === "SPY");
  if (typeof join === "function") {
    const off = join(spy.ohlcv, null, null);
    check("beide aus → Bars unverändert (gleiche Referenz)", off === spy.ohlcv);
    const on = join(spy.ohlcv, fx.credit, fx.real10y);
    const last = on.at(-1);
    check(`letzter Bar ${last.date}: Baa = ${lastC.value} (FRED ${lastC.date})`, last._credit === lastC.value, String(last._credit));
    const atT = on.find((b: any) => b.date === lastT.date);
    check(`Bar ${lastT.date}: Real 10J = ${lastT.value} (DFII10, exakter Treffer wie #267)`, atT?._t10y === lastT.value, String(atT?._t10y));
    check(`letzter Bar ${last.date} ohne DFII10-Wert → null (n/a), kein Fortschreiben`, last._t10y === null, String(last._t10y));
    const nullT = on.filter((b: any) => b._t10y == null).length;
    check("Real 10J ist nicht der nominale DGS10 (Werte < 3,5 %)", on.every((b: any) => b._t10y == null || b._t10y < 3.5) && nullT < on.length * 0.05, String(nullT));
    check("Close bleibt unverändert", last.close === spy.ohlcv.at(-1).close);
    const nullC = on.filter((b: any) => b._credit == null).length;
    check("fast alle Bars haben einen Spread (Lücke ≤ 7 Tage)", nullC < on.length * 0.02, String(nullC));
    const old = join([{ date: "1980-01-02", close: 1 }], fx.credit, null);
    check("Kurstag vor Fixture-Historie → null (n/a), kein erfundener Wert", old[0]._credit === null && !("_t10y" in old[0]));
  }

  console.log("2) Sektion: Default aus, Schalter, Statuszeilen");
  quietOn();
  async function mount() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } } });
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(mod.RecessionMarketChartsSection, { number: 10 }))); });
    for (let i = 0; i < 30 && !findByTestId(c, "price-chart"); i++) await settle(30);
    return { c, root };
  }
  const click = async (el: FakeElement | null) => { await act(async () => { reactPropsOf(el)?.onClick?.({}); }); for (let i = 0; i < 5; i++) await settle(40); };

  calls.length = 0;
  const { c, root } = await mount();
  const tC = findByTestId(c, "toggle-recession-credit"), tT = findByTestId(c, "toggle-recession-t10y");
  check("Preis-Chart gerendert", !!findByTestId(c, "price-chart"));
  check("Schalter Baa-Spread vorhanden", !!tC && tC.textContent === "Baa-Spread");
  check("Schalter Real 10J vorhanden", !!tT && tT.textContent === "Real 10J");
  check("Default aus: aria-pressed false", reactPropsOf(tC)?.["aria-pressed"] === false && reactPropsOf(tT)?.["aria-pressed"] === false);
  check("Default aus: keine Statuszeile", !findByTestId(c, "recession-credit-status") && !findByTestId(c, "recession-t10y-status"));
  check("Default aus: kein FRED-Abruf", !calls.some(u => u.includes("credit-spread") || u.includes("real10y") || u.includes("treasury-10y")), calls.join(","));

  await click(tC);
  const sC = findByTestId(c, "recession-credit-status")?.textContent ?? "";
  check("Baa an: genau ein Abruf /api/credit-spread/market", calls.filter(u => u.includes("/api/credit-spread/market")).length === 1);
  check(`Baa-Status nennt ${lastC.value.toFixed(2)} % per ${lastC.date}`, sC.includes(`aktuell ${lastC.value.toFixed(2)} % per ${lastC.date}`), sC);
  check("Baa-Status: FRED BAA10Y + kein Score-Einfluss", sC.includes("BAA10Y") && sC.includes("kein Score-Einfluss"), sC);
  check("Real 10J weiter aus", !findByTestId(c, "recession-t10y-status") && !calls.some(u => u.includes("real10y")));

  await click(tT);
  const sT = findByTestId(c, "recession-t10y-status")?.textContent ?? "";
  check("Real-10J-Abruf über bestehende DFII10-Route mit startDate = ältester SPY-Kurstag", calls.some(u => u.includes(`/api/analyze-btc/real10y-history?startDate=${spy.ohlcv[0].date}`)), calls.filter(u => u.includes("real10y")).join(","));
  check("kein Abruf des nominalen DGS10", !calls.some(u => u.includes("treasury-10y")));
  check(`Real-10J-Status nennt ${lastT.value.toFixed(2)} % per ${lastT.date}`, sT.includes(`aktuell ${lastT.value.toFixed(2)} % per ${lastT.date}`), sT);
  check("Label 'Real 10J (DFII10)', kein DGS10", sT.startsWith("■ Real 10J (DFII10)") && !sT.includes("DGS10"), sT);

  await click(findByTestId(c, "toggle-recession-credit"));
  check("Baa wieder aus → Statuszeile weg", !findByTestId(c, "recession-credit-status"));
  await act(async () => { root.unmount(); });

  for (const m of ["fail", "empty"] as const) {
    mode = m;
    const r = await mount();
    await click(findByTestId(r.c, "toggle-recession-credit"));
    await click(findByTestId(r.c, "toggle-recession-t10y"));
    const a = findByTestId(r.c, "recession-credit-status")?.textContent ?? "";
    const b = findByTestId(r.c, "recession-t10y-status")?.textContent ?? "";
    check(`${m}: Baa-Status n/a, keine Zahl`, a.includes(": n/a") && !/aktuell \d/.test(a), a);
    check(`${m}: Real-10J-Status n/a, keine Zahl`, b.includes(": n/a") && !/aktuell \d/.test(b), b);
    check(`${m}: Preis-Chart bleibt`, !!findByTestId(r.c, "price-chart"));
    await act(async () => { r.root.unmount(); });
  }
  quietOff();

  function quietOn() { console.error = () => {}; console.warn = () => {}; }
  function quietOff() { console.error = origError; console.warn = origWarn; }

  console.log(failed ? `\n${failed} Check(s) fehlgeschlagen` : "\nAlle Checks grün");
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.log("❌ Abbruch:", e?.message ?? e); process.exit(1); });
