/**
 * K-48: Section 8 Risiko-Refresh muss über apiRequest laufen, damit API_BASE vor
 * /api/refresh-risks steht. Roh-fetch("/api/refresh-risks") auf main ed1e98cd
 * ignoriert die Basis und ist hier rot.
 *
 * API_BASE kommt aus computeApiBase() (client/src/lib/queryClient.ts), nicht aus
 * einer Env-Variable. Dieser Lauf setzt window.location.hostname auf
 * preview.pplx.app, bevor Section8 geladen wird. computeApiBase liefert dann
 * "/port/5000". Dieselbe Verkettung `${API_BASE}${url}` würde aus dem
 * Spec-Beispiel https://example.test die URL
 * https://example.test/api/refresh-risks machen.
 *
 * Sichtbares Fehlerverhalten bleibt: Netzwerkfehler und ein Body, den res.json()
 * nicht liest, ändern die Risiken nicht und setzen keine KI-Fehlermeldung.
 * apiRequest wirft auf diesem Stand bei !res.ok nicht (throwIfResNotOk ist
 * unbenutzt). Der leere catch fängt beides gleich.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-k48-refresh-risks-api-base.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { installFakeDom, FakeText, type FakeNode } from "./lib/fake-dom";

const API_BASE = "/port/5000";

const refreshed = [
  { name: "Azure capacity shortfall", category: "Binary", ew: 20, impact: 30, expectedDamage: 6 },
  { name: "Copilot adoption stalls", category: "Gradual", ew: 35, impact: 15, expectedDamage: 5.25 },
  { name: "EU DMA fine", category: "Binary", ew: 15, impact: 10, expectedDamage: 1.5 },
];

const data: any = {
  ticker: "MSFT",
  companyName: "Microsoft",
  currency: "USD",
  description: "Cloud and software.",
  industry: "Software",
  sector: "Technology",
  revenue: 200e9,
  revenueGrowth: 0,
  fcfMargin: 30,
  forwardPE: 25,
  beta5Y: 0.9,
  governmentExposure: 5,
  catalysts: [
    { name: "Azure AI", context: "growth", tags: [] },
    { name: "Capex", context: "", tags: ["capex-tailwind"] },
    { name: "Copilot", context: "" },
  ],
  newsItems: [
    { title: "N1" },
    { title: "N2" },
    { title: "N3" },
    { title: "N4" },
    { title: "N5-dropped" },
  ],
  risks: [
    { name: "Credit Quality Deterioration", category: "Gradual", ew: 20, impact: 10, expectedDamage: 2 },
    { name: "Earnings Miss / Guidance Cut", category: "Binary", ew: 15, impact: 20, expectedDamage: 3 },
  ],
  sectorProfile: { sector: "Technology", waccScenarios: { kons: 8, avg: 9, opt: 7 }, growthAssumptions: { g1: 8, g2: 6, terminal: 2.5 } },
  totalDebt: 50e9,
  cashEquivalents: 20e9,
  fcfHaircut: 0,
  fcfTTM: 60e9,
  sharesOutstanding: 7e9,
  currentPrice: 400,
  analystPT: { median: 450 },
  peRatio: 30,
  marketCap: 3e12,
  financialStatements: { incomeStatement: { revenueGrowth: 12.3 } },
  peerComparison: { peers: [{ ticker: "AAPL" }] },
};

const expectedBody = {
  ticker: data.ticker,
  companyName: data.companyName,
  description: data.description,
  sector: data.sectorProfile?.sector || "",
  industry: data.industry || "",
  revenue: data.revenue || 0,
  revenueGrowth: data.revenueGrowth || 0,
  fcfMargin: data.fcfMargin || 0,
  forwardPE: data.forwardPE || 0,
  beta: data.beta5Y || 1.1,
  governmentExposure: data.governmentExposure || 0,
  catalysts: (data.catalysts || []).filter((c: any) => !c.tags?.includes("capex-tailwind")),
  newsItems: (data.newsItems || []).slice(0, 4),
};

type Mode = "ok" | "throw" | "http500" | "nullrisks" | "short";
type Call = { url: string; method: string; body: string | undefined };

const calls: Call[] = [];
let mode: Mode = "ok";
const unhandled: string[] = [];

function textOf(nd: FakeNode | null): string {
  if (!nd) return "";
  if (nd instanceof FakeText) return nd.nodeValue;
  return nd.childNodes.map(textOf).join("");
}

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const { doc, win } = installFakeDom();
win.location.hostname = "preview.pplx.app";
win.location.host = "preview.pplx.app";
win.location.protocol = "https:";
win.location.origin = "https://preview.pplx.app";

process.on("unhandledRejection", (err: any) => {
  unhandled.push(String(err?.message ?? err));
});

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  const method = String(init?.method ?? "GET").toUpperCase();
  if (url.includes("/api/refresh-risks")) {
    calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
    if (mode === "throw") throw new Error("network down");
    if (mode === "http500") return new Response("nope", { status: 500, headers: { "content-type": "text/plain" } });
    if (mode === "nullrisks") {
      return new Response(JSON.stringify({ risks: null, reason: "llm_unavailable", ticker: "MSFT" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (mode === "short") {
      return new Response(JSON.stringify({ risks: refreshed.slice(0, 2), ticker: "MSFT" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ risks: refreshed, ticker: "MSFT" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response("null", { status: 200, headers: { "content-type": "application/json" } });
};

(globalThis as any).React = React;

const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Section8 } = await import("../client/src/components/sections/Section8");
const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;

async function mount(until: (text: string, n: number) => boolean): Promise<string> {
  const started = calls.length;
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  const root = createRoot(host as any);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Section8, { data, useLLM: false })));
  });
  let text = "";
  for (let i = 0; i < 40; i++) {
    text = textOf(host);
    if (until(text, calls.length - started)) break;
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
  }
  text = textOf(host);
  await act(async () => { root.unmount(); });
  host.parentNode?.removeChild(host);
  return text;
}

const quiet = console.log;
console.log = (...args: unknown[]) => {
  const line = args.map(a => String(a)).join(" ");
  if (line.startsWith("[Section8]")) return;
  quiet(...args);
};

console.log(`API_BASE=${API_BASE}`);
console.log("Spec-Beispiel https://example.test würde zu https://example.test/api/refresh-risks");

mode = "ok";
const okText = await mount((t, n) => n >= 1 && t.includes("Azure capacity shortfall"));
const refreshCall = calls.find(c => c.url.includes("/api/refresh-risks"));
check(
  "Request-URL ist API_BASE + /api/refresh-risks",
  refreshCall?.url === `${API_BASE}/api/refresh-risks`,
  `url=${refreshCall?.url ?? "kein Aufruf"}`,
);
check("Methode POST", refreshCall?.method === "POST", `method=${refreshCall?.method ?? "—"}`);
let bodyOk = false;
let bodyDetail = "kein Body";
try {
  const parsed = JSON.parse(refreshCall?.body ?? "null");
  bodyOk = JSON.stringify(parsed) === JSON.stringify(expectedBody);
  bodyDetail = JSON.stringify(parsed);
} catch (err: any) {
  bodyDetail = err?.message ?? String(err);
}
check("Body unverändert, revenueGrowth bleibt data.revenueGrowth || 0 (nicht 12.3)", bodyOk, bodyDetail);
check("capex-tailwind ist nicht im Body", bodyOk && !bodyDetail.includes("capex-tailwind"));
check("Response-Felder: neue Namen ersetzen die generischen Risiken", okText.includes("Azure capacity shortfall") && okText.includes("Copilot adoption stalls") && okText.includes("EU DMA fine") && !okText.includes("Credit Quality Deterioration") && !okText.includes("Earnings Miss / Guidance Cut"), okText.slice(0, 400));
check("Response-Felder: Kategorie, EW, Impact, Expected Damage", okText.includes("Binary") && okText.includes("Gradual") && okText.includes("20%") && okText.includes("30%") && okText.includes("6.00") && okText.includes("5.25") && okText.includes("1.50"), okText.match(/Azure capacity[\s\S]{0,180}/)?.[0] ?? "");

const beforeErr = unhandled.length;
mode = "throw";
const throwText = await mount((_t, n) => n >= 1);
check("Netzwerkfehler: alte Risiken bleiben", throwText.includes("Credit Quality Deterioration") && !throwText.includes("Azure capacity shortfall"));
check("Netzwerkfehler: keine KI-Fehlermeldung", !throwText.includes("KI-Analyse fehlgeschlagen") && !throwText.includes("KI-Analyse nicht verfügbar"));

mode = "http500";
const httpText = await mount((_t, n) => n >= 1);
check("HTTP 500 ohne JSON: alte Risiken bleiben (json-Fehler wie !res.ok-Throw)", httpText.includes("Earnings Miss / Guidance Cut") && !httpText.includes("Azure capacity shortfall"));
check("HTTP 500: keine KI-Fehlermeldung", !httpText.includes("KI-Analyse fehlgeschlagen") && !httpText.includes("KI-Analyse nicht verfügbar"));
check("Fehler bleiben gefangen, kein unhandledRejection", unhandled.length === beforeErr, unhandled.join(" | "));

mode = "nullrisks";
const nullText = await mount((_t, n) => n >= 1);
check("risks: null lässt die Tabelle stehen", nullText.includes("Credit Quality Deterioration") && !nullText.includes("Azure capacity shortfall"));

mode = "short";
const shortText = await mount((_t, n) => n >= 1);
check("weniger als 3 Risiken werden verworfen", shortText.includes("Credit Quality Deterioration") && !shortText.includes("Azure capacity shortfall"));

const src = readFileSync("client/src/components/sections/Section8.tsx", "utf8");
check("Quelle nutzt apiRequest für den Refresh", src.includes('apiRequest("POST", "/api/refresh-risks"'));
check("Quelle enthält kein rohes fetch auf /api/refresh-risks", !src.includes('fetch("/api/refresh-risks"') && !src.includes("fetch('/api/refresh-risks'"));
check("K-49 nicht mitgezogen: Body liest data.revenueGrowth || 0", /revenueGrowth:\s*data\.revenueGrowth\s*\|\|\s*0/.test(src));
check("K-47 nicht mitgezogen: kein onRisksRefreshed", !src.includes("onRisksRefreshed"));
check("K-50 nicht mitgezogen: riskAdjTarget ohne Clamp", src.includes("analystPT * (1 - totalExpectedDamage / 100)"));

console.log = quiet;
if (failed) {
  console.error(`\n${failed} Fehler`);
  process.exit(1);
}
console.log("\nalle Checks grün");
