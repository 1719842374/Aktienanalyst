/**
 * Section7 Balken „Revenue Growth vs. Branche“: tamCAGR == null zeigt n/a
 * mit Grund, ein vorhandener tamCAGR (auch 0) bleibt byte-gleich zum Stand
 * vor dem Entfernen von `?? 5`.
 *
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-section7-sector-bar.ts
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { Section7 } from "../client/src/components/sections/Section7";
import { resolveIndustryGrowth } from "../shared/industry-growth";

(globalThis as any).React = React;

const EIGHT_ROW = '<tr class=""><td class="py-2 px-2"><span class="font-medium">Revenue Growth</span><span class="text-[9px] text-muted-foreground ml-1">(YoY vs. Branche)</span></td><td class="py-2 px-2 text-right font-mono tabular-nums font-semibold">+2.0%</td><td class="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">+8.0%</td><td class="py-2 px-2 text-right font-mono tabular-nums font-medium text-red-500">-6.0 Pkt.</td></tr>';
const ZERO_ROW = '<tr class=""><td class="py-2 px-2"><span class="font-medium">Revenue Growth</span><span class="text-[9px] text-muted-foreground ml-1">(YoY vs. Branche)</span></td><td class="py-2 px-2 text-right font-mono tabular-nums font-semibold">+2.0%</td><td class="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">+0.0%</td><td class="py-2 px-2 text-right font-mono tabular-nums font-medium text-emerald-500">+2.0 Pkt.</td></tr>';
const EIGHT_BARS = '<div class="space-y-2"><div class="flex items-center gap-3"><span class="text-xs text-muted-foreground w-20 flex-shrink-0">MSFT</span><div class="flex-1 h-5 bg-muted/30 rounded overflow-hidden"><div class="h-full bg-red-500 rounded transition-all" style="width:16.666666666666664%"></div></div><span class="text-xs font-mono tabular-nums font-semibold w-14 text-right">+2.0%</span></div><div class="flex items-center gap-3"><span class="text-xs text-muted-foreground w-20 flex-shrink-0">Branche</span><div class="flex-1 h-5 bg-muted/30 rounded overflow-hidden"><div class="h-full bg-muted-foreground/50 rounded transition-all" style="width:66.66666666666666%"></div></div><span class="text-xs font-mono tabular-nums font-semibold w-14 text-right">+8.0%</span></div>';
const ZERO_BARS = '<div class="space-y-2"><div class="flex items-center gap-3"><span class="text-xs text-muted-foreground w-20 flex-shrink-0">MSFT</span><div class="flex-1 h-5 bg-muted/30 rounded overflow-hidden"><div class="h-full bg-emerald-500 rounded transition-all" style="width:66.66666666666666%"></div></div><span class="text-xs font-mono tabular-nums font-semibold w-14 text-right">+2.0%</span></div><div class="flex items-center gap-3"><span class="text-xs text-muted-foreground w-20 flex-shrink-0">Branche</span><div class="flex-1 h-5 bg-muted/30 rounded overflow-hidden"><div class="h-full bg-muted-foreground/50 rounded transition-all" style="width:0%"></div></div><span class="text-xs font-mono tabular-nums font-semibold w-14 text-right">+0.0%</span></div>';

const base = JSON.parse(readFileSync(new URL("./fixtures/analysis-MSFT.json", import.meta.url), "utf8"));
const missingResolved = resolveIndustryGrowth({
  quality: "weak",
  tamCAGR: null,
  tamSource: base.tamAnalysis?.tamSource ?? null,
  tamLabel: base.tamAnalysis?.tamLabel ?? null,
  peerRevenueGrowths: (base.peerComparison?.peers ?? []).map((peer: { revenueGrowth?: number | null }) => peer.revenueGrowth),
});
const REASON = missingResolved.kind === "na" ? missingResolved.reason : "";
let fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fail++;
};

function render(tamCAGR: number | null) {
  const tam = { ...(base.tamAnalysis ?? {}), tamCAGR, companyGrowth: 2, quality: "weak" };
  delete tam.companyDataMissing;
  const data = { ...base, dataSource: "fmp", tamAnalysis: tam };
  return renderToStaticMarkup(
    React.createElement(Router, { ssrPath: "/" },
      React.createElement(QueryClientProvider, { client: new QueryClient() },
        React.createElement(Section7 as any, { data }))),
  );
}

function row(h: string) {
  return (h.match(/<tr[^>]*>(?:(?!<\/tr>).)*Revenue Growth(?:(?!<\/tr>).)*<\/tr>/) ?? [""])[0];
}
function bars(h: string) {
  const start = h.indexOf('<div class="space-y-2">', h.indexOf("Revenue Growth vs. Branche"));
  const end = h.indexOf("</div></div></div><div><h3", start);
  return h.slice(start, end);
}

const eight = render(8);
const zero = render(0);
const missing = render(null);

check("tamCAGR 8: Zeile byte-gleich", row(eight) === EIGHT_ROW, row(eight));
check("tamCAGR 8: Balken byte-gleich", bars(eight) === EIGHT_BARS, bars(eight));
check("tamCAGR 8: kein n/a-Grund", !eight.includes(REASON));
check("tamCAGR 0: Zeile byte-gleich (0 ist ein Wert)", row(zero) === ZERO_ROW, row(zero));
check("tamCAGR 0: Balken byte-gleich", bars(zero) === ZERO_BARS, bars(zero));
check("tamCAGR 0: kein n/a-Grund", !zero.includes(REASON));

const branche = (bars(missing).match(/Branche<\/span>.*?w-14 text-right">([^<]*)</) ?? [])[1];
check("tamCAGR null: Branchen-Balken n/a", branche === "n/a", String(branche));
check("tamCAGR null: Grund im Balkenblock", bars(missing).includes(REASON), bars(missing).slice(-180));
check("tamCAGR null: kein erfundenes +5.0%", !missing.includes("+5.0%"));
check("tamCAGR null: Sektor-Zelle der Zeile ist n/a", row(missing).includes(">n/a</td>") && !row(missing).includes("+5.0%"), row(missing));

console.log(fail ? `\n❌ ${fail} fehlgeschlagen` : "\n✅ alle bestanden");
process.exit(fail ? 1 : 0);
