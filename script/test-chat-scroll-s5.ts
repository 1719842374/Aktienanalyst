/**
 * PR 3 v2 Slices B+C. Offline. Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-chat-scroll-s5.ts
 * B: „Aktuelle Sektion“ – Referenzlinie = sichtbare Oberkante des Scroll-Bereichs (Main- ODER Window-Scroll).
 * C: Geschäftsmodell-Warnungen (bisher IIFE in Section5.tsx/S7) im Chat-Kontext, Anzeige byte-gleich.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";

(globalThis as any).React = React;
let fail = 0, n = 0;
const check = (name: string, ok: boolean, info = "") => { n++; console.log(`${ok ? "✅" : "❌"} ${name}${ok ? "" : ` ${info}`}`); if (!ok) fail++; };

const as = await import("../client/src/lib/activeSection");
const bus = await import("../client/src/lib/chatSectionData");
const cc = await import("../shared/chat-context");
const { Section5, businessModelWarnings } = await import("../client/src/components/sections/Section5");

// ── B ── Layout: Header 48 px, Sektionen je 600 px hoch, untereinander.
const el = (top: number) => ({ getBoundingClientRect: () => ({ top, bottom: top + 600 }) }) as unknown as Element;
const layout = (mainTop: number, scrolled: number) => [1, 2, 3, 4].map((id, i) => ({ id, bottom: mainTop + i * 600 + 600 - scrolled }));
const legacy = (mainTop: number, secs: { id: number; bottom: number }[]) => as.pickActiveSectionId(mainTop, secs); // alte Regel: Container-Oberkante roh
// Main scrollt 1300 px: Container bleibt bei 48, Sektionen wandern.
check("Main-Scroll 0 → S1", as.pickActiveSectionId(as.visibleTopOf(el(48)), layout(48, 0)) === 1);
check("Main-Scroll 1300 → S3", as.pickActiveSectionId(as.visibleTopOf(el(48)), layout(48, 1300)) === 3);
// Window/Dokument scrollt 1300 px: Container-Oberkante wandert mit (48−1300).
const winTop = 48 - 1300;
check("Window-Scroll 1300: alte Regel bleibt auf S1 hängen (Repro des Bugs)", legacy(winTop, layout(winTop, 0)) === 1);
check("Window-Scroll 1300: neue Regel → S3", as.pickActiveSectionId(as.visibleTopOf(el(winTop)), layout(winTop, 0)) === 3);
check("ohne Container → Referenz 0", as.visibleTopOf(null) === 0);
check("zugeklappte/fehlende Sektion (bottom null) übersprungen", as.pickActiveSectionId(0, [{ id: 1, bottom: null }, { id: 2, bottom: 500 }]) === 2);
for (const f of ["Dashboard", "BTCDashboard", "GoldDashboard", "RecessionDashboard"]) {
  const src = readFileSync(`client/src/pages/${f}.tsx`, "utf8");
  check(`${f}: getActiveSectionId nutzt visibleTopOf(mainRef.current)`, src.includes("const top = visibleTopOf(mainRef.current);") && !src.includes("mainRef.current?.getBoundingClientRect().top ?? 0"));
}

// ── C ──
const raw = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const base: any = { description: "", industry: "", sector: "", ...raw };
const variants: [string, any][] = [
  ["MSFT-Fixture", base],
  ["Pharma+Patent+negFCF+Staat", { ...base, industry: "Drug Manufacturers", description: "patent generic", fcfTTM: -5, governmentExposure: 35 }],
  ["Luxus zyklisch", { ...base, sector: "Consumer Cyclical", industry: "Luxury Goods" }],
  ["keine Warnung", { ...base, industry: "Banks", sector: "Financial", description: "", fcfTTM: 1, ebitda: 0, governmentExposure: 0 }],
];
for (const [name, d] of variants) {
  bus.resetChatSectionData();
  const h = renderToStaticMarkup(React.createElement(Section5, { data: d }));
  const p: any = bus.readChatSectionData("stock")["7"];
  const ws = businessModelWarnings(d);
  const shown = [...h.matchAll(/<span class="text-amber-500 flex-shrink-0 mt-0.5">⚠<\/span><span>([^<]*)<\/span>/g)].map(m => m[1].replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">"));
  check(`${name}: angezeigte Warnungen == businessModelWarnings (${ws.length})`, JSON.stringify(shown) === JSON.stringify(ws), JSON.stringify(shown));
  check(`${name}: Kontext geschaeftsmodellWarnungen == Anzeige`, ws.length ? p.geschaeftsmodellWarnungen === ws.join(" | ") : p.geschaeftsmodellWarnungen === null, String(p?.geschaeftsmodellWarnungen));
  const ctx = cc.enrichChatContext(cc.buildStockChatContext(d), bus.readChatSectionData("stock")).sections.find(s => s.id === 7)!.facts;
  check(`${name}: im S7-Kontext angekommen`, ctx.geschaeftsmodellWarnungen === p.geschaeftsmodellWarnungen);
}
console.log(fail ? `❌ ${fail}/${n} FAIL` : `${n}/${n} Checks grün`);
if (fail) process.exit(1);
