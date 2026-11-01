/**
 * Befund B (dod-258/REPORT.md, auf main seit vor #258): Wird die Analyse per Deep-Link `#/?ticker=`
 * oder durch Wiederherstellen nach einem Reload geöffnet, lösten Peer-Add, Peer-Remove und Reset
 * keinen Request aus. Ursache: onPeerOverridesChange prüft currentTickerRef, den nur onSearch setzte.
 *
 * Regressionstest mit dem ECHTEN Dashboard (react-dom createRoot + React.act auf script/lib/fake-dom),
 * gemocktem fetch und echter Handler-Kette: Eingabe/Buttons in PeerComparison → Section7 →
 * Dashboard.onPeerOverridesChange → startAnalyze → POST /api/analyze.
 * Gegenprobe: mit dem alten Dashboard (ohne Ticker-Sync in startAnalyze) 0 Requests nach dem Klick.
 *
 * Ausfuehren: npx tsx --tsconfig script/tsconfig.jsx.json script/test-peer-deeplink-overrides.ts
 */
import React from "react";
import { readFileSync } from "node:fs";
import { installFakeDom, reactPropsOf, findByTestId, FakeElement, type FakeNode } from "./lib/fake-dom";

(globalThis as any).React = React;

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const { doc, win, localStorage } = installFakeDom();
const fixture = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8"));
const posts: any[] = [];
(globalThis as any).fetch = async (input: any, init: any = {}) => {
  const url = String(input);
  if (url.includes("/api/analyze") && (init.method ?? "GET") === "POST") {
    const body = JSON.parse(init.body);
    posts.push(body);
    // Server-Echo wie analyze-route: aktive Overrides zurück
    const resp = { ...fixture, ticker: body.ticker, activePeerOverrides: body.peerOverrides ?? { add: [], remove: [] } };
    return new Response(JSON.stringify(resp), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
};

function findBy(n: FakeNode, pred: (e: FakeElement) => boolean): FakeElement | null {
  if (n instanceof FakeElement && pred(n)) return n;
  for (const c of n.childNodes) { const r = findBy(c, pred); if (r) return r; }
  return null;
}
const hostProps = (el: FakeElement | null) => (el ? reactPropsOf(el) : null);

async function main() {
  const { createRoot } = await import("react-dom/client");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const { queryClient } = await import("@/lib/queryClient");
  const { ThemeProvider } = await import("@/components/ThemeProvider");
  const { default: Dashboard } = await import("@/pages/Dashboard");
  const act = (React as any).act as (cb: () => Promise<void>) => Promise<void>;
  const settle = async (ms = 150) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); };

  // Sektionen, die das gekürzte Fixture nicht vollständig abdeckt, fangen ihre SectionErrorBoundary ab;
  // diese Logs sind für den Test irrelevant.
  const origError = console.error; const origWarn = console.warn; const origLog = console.log;
  const quiet = () => { console.error = () => {}; console.warn = () => {}; console.log = (...a: any[]) => { const m = String(a[0] ?? ""); if (m.startsWith("  ✅") || m.startsWith("  ❌") || m.startsWith("\n") || /^[A-ZÄÖÜ]/.test(m) && !m.startsWith("[")) origLog(...a); }; };
  const loud = () => { console.error = origError; console.warn = origWarn; console.log = origLog; };

  async function mount(hash: string) {
    win.location.hash = hash;
    const c = doc.createElement("div"); doc.body.appendChild(c);
    const root = createRoot(c as any);
    quiet();
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ThemeProvider as any, null, React.createElement(Dashboard))));
    });
    for (let i = 0; i < 20 && !findByTestId(c, "input-peer-add"); i++) await settle(50);
    loud();
    return { c, root };
  }
  async function ui(fn: () => void) { quiet(); await act(async () => { fn(); }); await settle(); loud(); }

  console.log("Befund B — Deep-Link #/?ticker=MSFT");
  localStorage.clear(); posts.length = 0;
  let { c, root } = await mount("#/?ticker=MSFT");
  check("Deep-Link: 1 Analyse-Request (force:false, ohne Overrides)", posts.length === 1 && posts[0].ticker === "MSFT" && posts[0].force === false && !("peerOverrides" in posts[0]), JSON.stringify(posts));
  check("Peer-Steuerung gerendert", !!findByTestId(c, "input-peer-add") && !!findByTestId(c, "button-peer-add"));
  // Peer-Add über die echte Eingabe + Button
  await ui(() => hostProps(findByTestId(c, "input-peer-add"))?.onChange({ target: { value: "LLY" } }));
  await ui(() => hostProps(findByTestId(c, "button-peer-add"))?.onClick());
  check("Peer-Add nach Deep-Link → Request mit add:[LLY], force:true", posts.length === 2 && JSON.stringify(posts[1]?.peerOverrides) === JSON.stringify({ add: ["LLY"], remove: [] }) && posts[1]?.force === true, JSON.stringify(posts.slice(1)));
  check("Overrides in localStorage gespeichert", localStorage.getItem("aktienanalyst.peerOverrides.v1:MSFT") === JSON.stringify({ add: ["LLY"], remove: [] }), String(localStorage.getItem("aktienanalyst.peerOverrides.v1:MSFT")));
  // Peer-Remove über das „×“ der Zeile
  await ui(() => hostProps(findBy(c, e => e.attributes.title === "ORCL aus Peer-Liste entfernen"))?.onClick());
  check("Peer-Remove nach Deep-Link → Request mit remove:[ORCL]", posts.length === 3 && JSON.stringify(posts[2]?.peerOverrides) === JSON.stringify({ add: ["LLY"], remove: ["ORCL"] }), JSON.stringify(posts.slice(2)));
  // Reset
  await ui(() => hostProps(findByTestId(c, "button-peer-reset"))?.onClick());
  check("Reset nach Deep-Link → Request ohne peerOverrides (Standard-Peers)", posts.length === 4 && posts[3]?.ticker === "MSFT" && !("peerOverrides" in posts[3]) && posts[3]?.force === true, JSON.stringify(posts.slice(3)));
  quiet(); await act(async () => { root.unmount(); }); loud();

  console.log("\nBefund B — Wiederherstellen nach Reload (kein ?ticker, letzter Ticker + Overrides aus localStorage)");
  localStorage.clear(); posts.length = 0;
  localStorage.setItem("aktienanalyst.lastAnalyze.v1", "MSFT");
  localStorage.setItem("aktienanalyst.peerOverrides.v1:MSFT", JSON.stringify({ add: ["LLY"], remove: [] }));
  ({ c, root } = await mount("#/"));
  check("Reload: 1 Request mit gespeicherten Overrides", posts.length === 1 && posts[0].ticker === "MSFT" && JSON.stringify(posts[0].peerOverrides) === JSON.stringify({ add: ["LLY"], remove: [] }), JSON.stringify(posts));
  await ui(() => hostProps(findByTestId(c, "input-peer-add"))?.onChange({ target: { value: "JNJ" } }));
  await ui(() => hostProps(findByTestId(c, "button-peer-add"))?.onClick());
  check("Peer-Add nach Reload → Request add:[LLY,JNJ]", posts.length === 2 && JSON.stringify(posts[1]?.peerOverrides) === JSON.stringify({ add: ["JNJ", "LLY"], remove: [] }), JSON.stringify(posts.slice(1)));
  await ui(() => hostProps(findByTestId(c, "button-peer-reset"))?.onClick());
  check("Reset nach Reload → Request ohne peerOverrides, localStorage geleert", posts.length === 3 && !("peerOverrides" in posts[2]) && localStorage.getItem("aktienanalyst.peerOverrides.v1:MSFT") === JSON.stringify({ add: [], remove: [] }), JSON.stringify(posts.slice(2)));
  quiet(); await act(async () => { root.unmount(); }); loud();

  console.log("\nQuelltext");
  const dash = readFileSync(new URL("../client/src/pages/Dashboard.tsx", import.meta.url), "utf8");
  const sa = dash.slice(dash.indexOf("const startAnalyze = useCallback("), dash.indexOf("analyzeMutationRef.current.mutate("));
  check("startAnalyze setzt currentTickerRef + currentTicker", sa.includes("currentTickerRef.current = args.ticker;") && sa.includes("setCurrentTicker(args.ticker);"));

  console.log(failed === 0 ? "\n✅ Alle Peer-Deep-Link-Override-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
