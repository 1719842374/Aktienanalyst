/**
 * Kosmetik (a) Rezession S7 „Formel: Formel:“ und (b) S9-Chat-Fakt peerOverrides „+- / −-“.
 * Offline. Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-cosmetic-s7-formula-peers.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
(globalThis as any).React = React;
let fail = 0, n = 0;
const check = (name: string, ok: boolean, info = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${info ? ` — ${info}` : ""}`); if (!ok) fail++; };

const { ProbabilityEstimates } = await import("../client/src/components/recession/recessionDashboardPartsB1");
const { formulaWithoutLabel } = await import("../client/src/lib/formulaLabel");
const { RECESSION_FALLBACK_DATA } = await import("../client/src/lib/recessionFallbackData");
const cc = await import("../shared/chat-context");

console.log("=== (a) S7 Formel einmal ===");
{
  const subs = (RECESSION_FALLBACK_DATA as any).subgroups;
  const full = subs.find((s: any) => s.name === "recession_full");
  check("Datenkette: recession_full-Formel trägt Präfix (Server/Fallback)", /^Formel:/.test(full.formula), full.formula.slice(0, 30));
  check("übrige Gruppen ohne Präfix", subs.filter((s: any) => s.name !== "recession_full").every((s: any) => !/^Formel:/.test(s.formula)));
  const html = renderToStaticMarkup(React.createElement(ProbabilityEstimates, { subgroups: subs }));
  const text = html.replace(/<[^>]+>/g, "");
  check("kein „Formel: Formel:“ im Render", !/Formel:\s*Formel:/.test(text));
  check("„Formel:“-Label je Gruppe genau einmal", (text.match(/Formel:/g) ?? []).length === subs.length, `${(text.match(/Formel:/g) ?? []).length}/${subs.length}`);
  check("Formel-Inhalt erhalten (recession_full)", text.includes(full.formula.replace(/^Formel:\s*/, "")));
  for (const s of subs.filter((x: any) => x.name !== "recession_full")) check(`unverändert: ${s.name}`, formulaWithoutLabel(s.formula) === s.formula);
  check("leer/fehlend → n/a", formulaWithoutLabel("") === "n/a" && formulaWithoutLabel(undefined) === "n/a" && formulaWithoutLabel("Formel: ") === "n/a");
  check("Prozentwerte unverändert", subs.every((s: any) => html.includes(`${s.probability}%`)));
  const srv = readFileSync("server/recession.ts", "utf8");
  check("Quelle des Präfixes: server/recession.ts (unverändert gelassen)", srv.includes("? `Formel: ${rezFullMax > 0"));
}

console.log("=== (b) peerOverrides echter Wert oder n/a ===");
{
  const f = cc.peerOverridesFact;
  check("Server-Default {add:[],remove:[]} → „keine“ (statt „+- / −-“)", f({ add: [], remove: [] }) === "keine", String(f({ add: [], remove: [] })));
  check("nur add", f({ add: ["LLY", "ABT"], remove: [] }) === "+LLY,ABT");
  check("nur remove", f({ add: [], remove: ["PFE"] }) === "−PFE");
  check("beide", f({ add: ["LLY"], remove: ["PFE"] }) === "+LLY / −PFE");
  check("fehlt (alter Cache) → null = n/a", f(undefined) === null && f(null) === null);
  check("Leer-Strings gefiltert", f({ add: [" "], remove: [""] }) === "keine");
  const base = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  for (const [label, ov, want] of [["MSFT + Server-Default {add:[],remove:[]}", { add: [], remove: [] }, "keine"], ["mit Overrides", { add: ["AAPL"], remove: ["ORCL"] }, "+AAPL / −ORCL"]] as const) {
    const ctx = cc.buildStockChatContext({ ...base, activePeerOverrides: ov });
    const v = ctx.sections.find(s => s.id === 9)!.facts.peerOverrides;
    check(`Chat-Kontext S9 ${label}`, v === want && !String(v).includes("-/") && !/[+−]-/.test(String(v)), String(v));
  }
  const ctxNo = cc.buildStockChatContext({ ...base, activePeerOverrides: undefined });
  check("ohne Feld → null (n/a in auffaelligkeiten)", ctxNo.sections.find(s => s.id === 9)!.facts.peerOverrides === null);
  const ctx = cc.buildStockChatContext(base);
  const others = ctx.sections.find(s => s.id === 9)!.facts;
  check("übrige S9-Fakten unverändert vorhanden", "peers" in others && "peerKgvSchnitt" in others);
}
console.log(`\n${n - fail}/${n} passed`);
if (fail) process.exit(1);
