/**
 * Folge-Fix zu #494: Wechselt das Dashboard von MSFT auf SAP.DE, während der
 * KI-Enrich von MSFT noch läuft, darf die lokale S15-Ansicht die MSFT-KI-Namen
 * nicht auf die SAP-Seite malen. Der Guard applyCatalystFollowUp schützt nur
 * setData im Dashboard; die Tabelle liest llmEnrichedCatalysts zuerst.
 *
 * Harness ohne key: Dashboard hält CatalystsSection beim Tickerwechsel gemountet
 * (data bleibt stehen, setData ersetzt nur das Objekt).
 *
 * RED auf main 58f6c237, GREEN danach. Bestehender Reload derselben Tickers
 * (DoD 1) muss den KI-Namen behalten.
 *
 * Ausführen: npx tsx --tsconfig script/tsconfig.jsx.json script/test-catalyst-enrich-stale-ticker.ts
 */
import React from "react";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDom, findByTestId, reactPropsOf, type FakeNode, FakeText } from "./lib/fake-dom";

(globalThis as any).React = React;

const MSFT_KI = "MSFT-KI-Copilot-Only";
const SAP_NAME = "SAP-DE-S4HANA-Only";
const SWITCH_DELAYS_MS = [41, 57, 73] as const;

const base = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const proto = (base.catalysts as { name?: string; bruttoUpside?: number }[]).find(
  (c) => typeof c?.name === "string" && (c.bruttoUpside ?? 0) > 0,
);
assert.ok(proto, "Fixture braucht einen positiven Katalysator als Form");

function named(name: string) {
  return { ...proto, name, context: name, deepDive: undefined, newsSentiment: "neutral", direction: "positive", flag: "▲" };
}

function analysis(ticker: string, catalystName: string) {
  return { ...base, ticker, companyName: ticker === "SAP.DE" ? "SAP" : "Microsoft", catalysts: [named(catalystName)] };
}

const msft = analysis("MSFT", "MSFT-GENERIC-BASE");
const sap = analysis("SAP.DE", SAP_NAME);

type Pending = { ticker: string; resolve: (res: Response) => void };

function okEnrich(name: string): Response {
  return new Response(JSON.stringify({ catalysts: [named(name)], growthThesis: null, execSummary: null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textOf(nd: FakeNode | null): string {
  if (!nd) return "";
  if (nd instanceof FakeText) return nd.nodeValue;
  return nd.childNodes.map(textOf).join("");
}

async function main() {
  const pin = JSON.parse(readFileSync("script/fixtures/prod-analyze-dcf-2026-10-25.json", "utf8")).expectOldHead;
  assert.equal(Number(pin.VWAGY.overallScore).toFixed(6), "4.735718");
  assert.equal(Number(pin.SAP.overallScore).toFixed(6), "5.174758");
  assert.equal(Number(pin.MSFT.overallScore).toFixed(6), "4.058138");

  const { doc } = installFakeDom();
  const pending: Pending[] = [];
  (globalThis as any).fetch = (url: string, init?: RequestInit) => {
    const u = String(url);
    assert.ok(u.endsWith("/api/catalyst-enrich"), u);
    const body = JSON.parse(String(init?.body ?? "{}")) as { ticker?: string };
    return new Promise<Response>((resolve) => {
      pending.push({ ticker: String(body.ticker ?? ""), resolve });
    });
  };

  const { createRoot } = await import("react-dom/client");
  const { CatalystsSection } = await import("../client/src/components/sections/CatalystsSection");
  const act = (React as any).act as (cb: () => Promise<void> | void) => Promise<void>;

  function view(data: typeof msft) {
    return React.createElement(CatalystsSection, {
      data: data as never,
      onReloadAnalysis: async () => data,
    });
  }

  async function mount(data: typeof msft) {
    const host = doc.createElement("div");
    doc.body.appendChild(host);
    const root = createRoot(host as never);
    await act(async () => { root.render(view(data)); });
    return {
      host,
      root,
      unmount: async () => { await act(async () => { root.unmount(); }); host.parentNode?.removeChild(host); },
    };
  }

  async function clickKi(host: FakeNode) {
    const button = findByTestId(host, "button-catalyst-ki-analyse");
    assert.ok(button, "KI-Analyse-Button fehlt");
    const props = reactPropsOf(button);
    assert.equal(typeof props?.onClick, "function");
    await act(async () => { props.onClick(); });
  }

  async function settle() {
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  }

  // Gleicher Ticker: Enrich bleibt sichtbar (auch wenn das Analyse-Objekt
  // dazwischen ersetzt wird, wie beim Cache-Reload aus DoD 1).
  {
    pending.length = 0;
    const ui = await mount(msft);
    await clickKi(ui.host);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].ticker, "MSFT");
    const reloaded = analysis("MSFT", "MSFT-GENERIC-AFTER-RELOAD");
    await act(async () => { ui.root.render(view(reloaded)); });
    await act(async () => { pending[0].resolve(okEnrich(MSFT_KI)); });
    await settle();
    const table = textOf(findByTestId(ui.host, "catalyst-table"));
    assert.ok(table.includes(MSFT_KI), `Reload gleicher Ticker muss den KI-Namen behalten, Tabelle: ${table.slice(0, 240)}`);
    assert.ok(!table.includes("MSFT-GENERIC-AFTER-RELOAD"), "KI-Liste ersetzt die generische Liste desselben Tickers");
    const page = textOf(ui.host);
    assert.ok(page.includes("✦ KI"), "KI-Badge bleibt nach Enrich desselben Tickers");
    await ui.unmount();
    console.log("  gleicher Ticker, Reload mitten im Enrich: KI-Name bleibt");
  }

  // MSFT → SAP.DE, Antwort trifft nach dem Wechsel ein. 3/3, auch wenn ein Lauf kippt.
  const leaks: string[] = [];
  for (const delay of SWITCH_DELAYS_MS) {
    pending.length = 0;
    const ui = await mount(msft);
    const t0 = Date.now();
    await clickKi(ui.host);
    assert.equal(pending.length, 1, "Enrich-Request muss vor dem Wechsel laufen");
    assert.equal(pending[0].ticker, "MSFT");
    const left = delay - (Date.now() - t0);
    if (left > 0) await act(async () => { await new Promise((r) => setTimeout(r, left)); });
    await act(async () => { ui.root.render(view(sap)); });
    const sapBefore = textOf(findByTestId(ui.host, "catalyst-table"));
    assert.ok(sapBefore.includes(SAP_NAME), `direkt nach dem Wechsel SAP-Katalysator, Tabelle: ${sapBefore.slice(0, 240)}`);
    await act(async () => { pending[0].resolve(okEnrich(MSFT_KI)); });
    await settle();
    const table = textOf(findByTestId(ui.host, "catalyst-table"));
    const clean = !table.includes(MSFT_KI) && table.includes(SAP_NAME);
    if (clean) console.log(`  Lauf Wechsel nach ${delay} ms: SAP-Seite ohne ${MSFT_KI}`);
    else leaks.push(`${delay} ms: ${table.includes(MSFT_KI) ? "MSFT-KI-Name auf der SAP-Seite" : "SAP-Katalysator fehlt"}`);
    await ui.unmount();
  }
  assert.equal(leaks.length, 0, `MSFT→SAP.DE mitten im Enrich nicht sauber (${leaks.length}/3): ${leaks.join("; ")}`);

  // Enrich ist schon da, dann Wechsel: lokaler KI-State muss weg.
  {
    pending.length = 0;
    const ui = await mount(msft);
    await clickKi(ui.host);
    await act(async () => { pending[0].resolve(okEnrich(MSFT_KI)); });
    await settle();
    assert.ok(textOf(findByTestId(ui.host, "catalyst-table")).includes(MSFT_KI));
    await act(async () => { ui.root.render(view(sap)); });
    await settle();
    const table = textOf(findByTestId(ui.host, "catalyst-table"));
    assert.ok(!table.includes(MSFT_KI), `nach abgeschlossenem Enrich bleibt der MSFT-Name auf SAP\n${table.slice(0, 400)}`);
    assert.ok(table.includes(SAP_NAME), "SAP-Katalysator nach dem Wechsel");
    await ui.unmount();
    console.log("  Enrich fertig, dann Wechsel: lokaler KI-State weg");
  }

  console.log("catalyst enrich stale ticker: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
