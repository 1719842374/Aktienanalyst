/**
 * Gold-Offline-Hinweis: Fällt /api/analyze-gold aus, zeigt GoldDashboard die gebündelten
 * GOLD_FALLBACK_DATA. Soll: sichtbarer Hinweis „Offline-Daten vom <Datum>“, Werte/Scores unverändert.
 * Live-Pfad (andere timestamp): kein Hinweis. Echter SSR-Render der ganzen Seite mit vorbefülltem Query-Cache.
 */
import * as esbuild from "esbuild";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
let failed = 0;
const check = (name: string, ok: boolean, info?: unknown) => {
  console.log(`  ${ok ? "✅" : "❌"} ${name}${ok || info === undefined ? "" : ` → ${JSON.stringify(info)}`}`);
  if (!ok) failed++;
};

const outfile = path.join(os.tmpdir(), `gold-offline-note-${process.pid}.cjs`);
await esbuild.build({
  absWorkingDir: root,
  stdin: {
    contents: `export { default as GoldDashboard } from "./client/src/pages/GoldDashboard";
export { ThemeProvider } from "./client/src/components/ThemeProvider";
export { GOLD_FALLBACK_DATA } from "./client/src/lib/goldFallbackData";
export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
export { createElement } from "react";
export { Router } from "wouter";
export { renderToStaticMarkup } from "react-dom/server";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true, format: "cjs", platform: "node", jsx: "automatic", loader: { ".css": "empty" },
  alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") },
  outfile, logLevel: "silent",
});
const mod = createRequire(import.meta.url)(outfile);
const render = (data: any) => {
  const client = new mod.QueryClient();
  client.setQueryData(["/api/analyze-gold"], data);
  const h = mod.createElement;
  return mod.renderToStaticMarkup(h(mod.QueryClientProvider, { client }, h(mod.Router, { ssrPath: "/gold" }, h(mod.ThemeProvider, null, h(mod.GoldDashboard)))));
};
const strip = (html: string) => html.replace(/<[^>]+>/g, "|").replace(/data-testid="gold-offline-note"/g, "");
const F = mod.GOLD_FALLBACK_DATA;
const snapshot = JSON.stringify(F);

console.log("Fallback-Pfad (GOLD_FALLBACK_DATA)");
const off = render(F);
const note = /data-testid="gold-offline-note"[^>]*>([^<]*)</.exec(off)?.[1];
check("Hinweis gerendert", note != null);
check("Text „Offline-Daten vom 27.03.2026 …“", !!note && note.startsWith("Offline-Daten vom 27.03.2026"), note);
check("Fallback-Objekt nicht verändert (Scores/Werte identisch)", JSON.stringify(F) === snapshot);

console.log("Live-Pfad (andere timestamp, sonst gleiche Werte)");
const live = render({ ...F, timestamp: "2026-10-25T12:00:00.000Z", analysisDate: "25.10.2026, 13:00" });
check("kein Offline-Hinweis", !live.includes("gold-offline-note") && !live.includes("Offline-Daten vom"));
check("übriger Seiteninhalt identisch (nur Hinweis + Datum/Zeitstempel unterscheiden sich)",
  strip(off.replace(/<div[^>]*data-testid="gold-offline-note"[^>]*>[^<]*<\/div>/, "")).replaceAll("27.03.2026, 20:18", "D") ===
  strip(live).replaceAll("25.10.2026, 13:00", "D"));

console.log(failed === 0 ? "\nAlle Offline-Hinweis-Tests grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
