/** FW-16: GDX/GLD-Verhältnis – Berechnung, Route (Cache, n/a), Anzeige, kein Score-Eingang.
 *  Stubs = echte Yahoo-Chart-Antworten (script/fixtures/yahoo-gdx-gld-1y.json, abgerufen 2026-10-25). */
import express from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { computeGdxGldRatio, closesByDate, registerGdxGldRatioRoute, GDX_GLD_SOURCE } from "../server/gold-gdx-gld-ratio";
import { GdxGldRatioView } from "../client/src/components/gold/GdxGldRatioRow";

let fail = 0;
const check = (n: string, ok: boolean, extra = "") => { console.log(`${ok ? "✅" : "❌"} ${n}${extra ? " — " + extra : ""}`); if (!ok) fail++; };
const fx = JSON.parse(readFileSync(new URL("./fixtures/yahoo-gdx-gld-1y.json", import.meta.url), "utf8"));

// Echte Payloads
const r = computeGdxGldRatio(fx.GDX, fx.GLD);
const gdx = closesByDate(fx.GDX), gld = closesByDate(fx.GLD);
check("Stand = letzter gemeinsamer Handelstag", r.asOf === "2026-10-23", String(r.asOf));
check("Ratio = GDX/GLD-Schluss desselben Tages", r.ratio === gdx.get("2026-10-23")! / gld.get("2026-10-23")! && Math.abs(r.ratio! - 80.2 / 366.61) < 1e-4, String(r.ratio));
check("1J-Kontext vorhanden (≥20 Tage)", r.points >= 200 && r.min1y! <= r.ratio! && r.max1y! >= r.ratio! && r.unavailableReason === null, `${r.points} Tage`);
check("Lage in 0..100", r.rangePct! >= 0 && r.rangePct! <= 100);
check("Quelle benannt", r.source === GDX_GLD_SOURCE);

// n/a-Fälle
check("GLD fehlt → n/a + Grund", computeGdxGldRatio(fx.GDX, null).ratio === null && computeGdxGldRatio(fx.GDX, null).unavailableReason === "GLD-Kurse fehlen");
check("beide fehlen → n/a", computeGdxGldRatio(null, { chart: { result: [] } }).unavailableReason === "keine Kursdaten (GDX und GLD)");
const shift = JSON.parse(JSON.stringify(fx.GLD)); shift.chart.result[0].timestamp = shift.chart.result[0].timestamp.map((t: number) => t + 3 * 365 * 86400);
check("kein gemeinsamer Tag → n/a statt Mischwert", computeGdxGldRatio(fx.GDX, shift).ratio === null && /gemeinsamer/.test(computeGdxGldRatio(fx.GDX, shift).unavailableReason ?? ""));
const short = JSON.parse(JSON.stringify(fx.GLD)); const q = short.chart.result[0]; q.timestamp = q.timestamp.slice(-5); q.indicators.quote[0].close = q.indicators.quote[0].close.slice(-5);
const rs = computeGdxGldRatio(fx.GDX, short);
check("<20 Tage → Ratio ja, 1J-Kontext n/a mit Grund", rs.ratio != null && rs.min1y === null && /nur 5 gemeinsame/.test(rs.unavailableReason ?? ""));
const holes = JSON.parse(JSON.stringify(fx.GDX)); holes.chart.result[0].indicators.quote[0].close[holes.chart.result[0].timestamp.length - 1] = null;
check("null-Schluss am letzten Tag → Vortag, kein Ersatzwert", computeGdxGldRatio(holes, fx.GLD).asOf === "2026-10-22");

// Route
let calls = 0; let clock = 0; let up = false;
const app = express();
registerGdxGldRatioRoute(app, { now: () => clock, chart: async s => { calls++; return up ? fx[s] : null; } });
const srv = app.listen(0); const port = (srv.address() as any).port;
const get = async () => (await fetch(`http://127.0.0.1:${port}/api/gdx-gld-ratio`)).json();
const a = await get();
check("Route ohne Daten → n/a, Grund", a.ratio === null && a.unavailableReason === "keine Kursdaten (GDX und GLD)");
up = true; const b = await get(); const c1 = calls; await get();
check("n/a nicht gecacht, Wert gecacht", b.ratio != null && calls === c1);
clock += 31 * 60 * 1000; await get();
check("Cache läuft nach 30 min ab", calls === c1 + 2);
srv.close();

// Anzeige
const html = renderToStaticMarkup(React.createElement(GdxGldRatioView, { data: r }));
check("Anzeige: Wert 0.219 + Stand 23.10.2026", html.includes(">0.219<") && html.includes("23.10.2026"));
const na = renderToStaticMarkup(React.createElement(GdxGldRatioView, { data: computeGdxGldRatio(fx.GDX, null) }));
check("Anzeige n/a + Grund, keine Zahl", na.includes(">n/a<") && na.includes("GLD-Kurse fehlen") && !na.includes("1J:"));
check("Anzeige ohne Antwort → n/a + Endpoint-Grund", renderToStaticMarkup(React.createElement(GdxGldRatioView, { data: null })).includes("Endpoint nicht erreichbar"));

// Kein Score-Eingang
for (const f of ["server/analyze-route.ts", "server/researcher.ts", "server/gold-routes.ts", "server/gold-scoring.ts"]) {
  let src = ""; try { src = readFileSync(new URL("../" + f, import.meta.url), "utf8"); } catch { continue; }
  check(`${f} importiert gold-gdx-gld-ratio nicht`, !src.includes("gold-gdx-gld-ratio") && !src.includes("gdxGld"));
}

console.log(fail ? `\n❌ ${fail} fehlgeschlagen` : "\n✅ alle bestanden");
process.exit(fail ? 1 : 0);
