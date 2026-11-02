/**
 * Szenario-Kegel bleibt nach dem Einschalten im Chart.
 * Root Cause: widthScale > 1 verlängert den Plot; der ResizeObserver zeichnet
 * den Vorlauf aus dem sichtbaren Scrollport. Danach muss der Kegel auch nach
 * Earnings Yield und Zeitraumwechsel noch in den Chartdaten stehen.
 * Die Haltung über 6 echte Sekunden prüft der Browser-Lauf (Labels bleiben sichtbar).
 * und die innere Plot-Breite darf keinen Faktor > 1 tragen.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-scenario-cone-stable.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, findByTestId, reactPropsOf, fiberOf, FakeElement, type FakeNode } from "./lib/fake-dom";

installFakeDom();
const origErr = console.error;
const origWarn = console.warn;
console.error = () => {};
console.warn = () => {};

const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { TechnicalChart } = await import("../client/src/components/sections/TechnicalChart");
const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;

(globalThis as any).fetch = async () => new Response("null", {
  status: 200,
  headers: { "content-type": "application/json" },
});

function findFiber(f: any, pred: (f: any) => boolean): any {
  for (let x = f; x; x = x.sibling) {
    if (pred(x)) return x;
    const r = findFiber(x.child, pred);
    if (r) return r;
  }
  return null;
}

function findButton(n: FakeNode, text: string): FakeElement | null {
  if (n instanceof FakeElement && n.tagName.toUpperCase() === "BUTTON" && (n.textContent || "").replace(/\s+/g, "") === text) return n;
  for (const c of n.childNodes) {
    const r = findButton(c, text);
    if (r) return r;
  }
  return null;
}

function coneRows(root: FakeNode): any[] | null {
  const plot = findByTestId(root, "chart-price-ma");
  if (!plot) return null;
  const hit = findFiber(fiberOf(plot), f => Array.isArray(f.memoizedProps?.data)
    && f.memoizedProps.data.some((p: any) => typeof p?.coneP90 === "number" && Number.isFinite(p.coneP90)));
  return hit?.memoizedProps.data ?? null;
}

const fixture = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const bars = fixture.historicalPrices.slice(-400).map((p: { date: string; close: number }) => ({
  date: String(p.date).slice(0, 10),
  open: p.close,
  high: p.close,
  low: p.close,
  close: p.close,
  volume: 1,
}));
const data = {
  ...fixture,
  ohlcvData: bars,
  technicalIndicators: {
    ...fixture.technicalIndicators,
    maData: bars.map((b: { date: string; close: number }) => ({ date: b.date, close: b.close })),
    macdData: [],
    signals: [],
  },
};

const doc = (globalThis as any).document;
const host = doc.createElement("div");
doc.body.appendChild(host);
const root = createRoot(host);
const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
await act(async () => {
  root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(TechnicalChart, { data })));
});

const coneButton = () => findByTestId(host, "button-scenario-cone");
assert.equal(coneButton()?.attributes["aria-pressed"], "false");
assert.equal(coneRows(host), null);

await act(async () => { reactPropsOf(coneButton())!.onClick(); });
assert.equal(coneButton()?.attributes["aria-pressed"], "true");
const first = coneRows(host);
assert.ok(first && first.filter((p: any) => Number.isFinite(p.coneP90)).length > 10, "Kegelpunkte nach dem Einschalten");
const future = first!.filter((p: any) => p.close == null && Number.isFinite(p.coneP50));
assert.ok(future.length > 0, "Vorlauf hängt am letzten Close");
assert.ok(Number.isFinite(future[future.length - 1].coneInnerLow));
assert.ok(Number.isFinite(future[future.length - 1].coneInnerHigh));
const inner = findByTestId(host, "chart-price-scroll-inner");
assert.ok(inner, "Scroll-Inhalt");
assert.equal(inner!.attributes["data-width-scale"], undefined);
const width = String(inner!.style?.width ?? "");
assert.equal(width.includes("*"), false, width);
const status = findByTestId(host, "scenario-cone-status");
assert.ok(status, "Statuszeile");
assert.match(status!.attributes["data-formula"] ?? "", /σ_η/);
assert.match(status!.textContent ?? "", /50%-Band und 80%-Band/);
assert.match(status!.textContent ?? "", /eigene Kurshistorie/);

await act(async () => { reactPropsOf(findByTestId(host, "button-earnings-yield"))!.onClick(); });
await act(async () => { await new Promise(r => setTimeout(r, 50)); });
assert.equal(coneButton()?.attributes["aria-pressed"], "true");
assert.equal(findByTestId(host, "button-earnings-yield")?.attributes["aria-pressed"], "true");
assert.ok((coneRows(host)?.filter((p: any) => Number.isFinite(p.coneP90)).length ?? 0) > 10, "Kegel bleibt bei Earnings Yield");

const preset = findButton(host, "3M");
assert.ok(preset, "Preset 3M");
await act(async () => { reactPropsOf(preset)!.onClick(); });
assert.equal(coneButton()?.attributes["aria-pressed"], "true");
const afterRange = coneRows(host);
assert.ok(afterRange && afterRange.filter((p: any) => Number.isFinite(p.coneP90)).length > 5, "Kegel bleibt beim Zeitraumwechsel");

for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
assert.equal(coneButton()?.attributes["aria-pressed"], "true", "Toggle bleibt nach weiteren Commits an");
assert.ok((coneRows(host)?.filter((p: any) => Number.isFinite(p.coneP90)).length ?? 0) > 5, "Kegelpunkte nach weiteren Commits");
assert.equal(findByTestId(host, "chart-price-scroll-inner")?.attributes["data-width-scale"], undefined);

await act(async () => { root.unmount(); });
qc.clear();
console.error = origErr;
console.warn = origWarn;
console.log("test-scenario-cone-stable: OK");
