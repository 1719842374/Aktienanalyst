/** JOB 17: Gold/Silber-Ratio – Berechnung, Route (Cache, n/a), Anzeige, kein Score-Eingang. */
import express from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import { computeGoldSilverRatio, registerGoldSilverRatioRoute, GOLD_SILVER_SOURCE } from "../server/gold-silver-ratio";
import { GoldSilverRatioView } from "../client/src/components/gold/GoldSilverRatioRow";

let fail = 0;
const check = (n: string, ok: boolean) => { console.log(`${ok ? "✅" : "❌"} ${n}`); if (!ok) fail++; };

const r = computeGoldSilverRatio({ price: 4200, timestamp: 1760198400 }, { price: 50, timestamp: 1760194800 });
check("Ratio = Gold/Silber, Quelle FMP/FMP", r.ratio === 84 && r.source === "FMP GCUSD / FMP SIUSD");
check("Stand = ältere Quote (Unix-Sek.)", r.asOf === new Date(1760194800 * 1000).toISOString());
check("Silber fehlt → n/a", computeGoldSilverRatio({ price: 4200 }, null).ratio === null && computeGoldSilverRatio({ price: 4200 }, null).unavailableReason === "Silber-Quote fehlt");
check("0/kaputt → n/a", computeGoldSilverRatio({ price: 4200 }, { price: 0 }).ratio === null && computeGoldSilverRatio({ price: "x" }, { price: 50 }).ratio === null);
check("ohne Zeitstempel kein Ratio (Datum nicht prüfbar)", computeGoldSilverRatio({ price: 4200 }, { price: 50 }).ratio === null && computeGoldSilverRatio({ price: 4200 }, { price: 50 }).asOf === null);
const diff = computeGoldSilverRatio({ price: 4200, timestamp: 1760198400 }, { price: 50, timestamp: 1760198400 - 86400 });
check("unterschiedliche Tage → n/a mit Grund", diff.ratio === null && /Datum ungleich/.test(diff.unavailableReason ?? ""));
const mixed = computeGoldSilverRatio({ price: 4200, timestamp: 1760198400, source: "FMP GCUSD" }, { price: 50, timestamp: 1760198400, source: "Yahoo SI=F" });
check("gemischte Quelle sichtbar", mixed.source === "FMP GCUSD / Yahoo SI=F" && mixed.silverSource === "Yahoo SI=F");

let calls = 0; let ycalls = 0; let clock = 0; let silverUp = false; let yahooUp = false;
const app = express();
registerGoldSilverRatioRoute(app, {
  now: () => clock,
  quote: async s => { calls++; return s === "GCUSD" ? { price: 4000, timestamp: 1760000000 } : silverUp ? { price: 40, timestamp: 1760000000 } : null; },
  yahoo: async s => { ycalls++; return yahooUp && s === "SI=F" ? { price: 50, timestamp: 1760000000, source: "Yahoo SI=F" } : null; },
});
const srv = app.listen(0); const port = (srv.address() as any).port;
const get = async () => (await fetch(`http://127.0.0.1:${port}/api/gold-silver-ratio`)).json();
const a = await get();
check("Route: n/a bei fehlendem Silber (FMP + Yahoo), kein 500", a.ratio === null && a.unavailableReason === "Silber-Quote fehlt" && ycalls === 1);
yahooUp = true;
const y = await get();
check("Yahoo SI=F springt ein, Quelle angezeigt", y.ratio === 80 && y.source === "FMP GCUSD / Yahoo SI=F");
clock += 11 * 60e3; silverUp = true; const c0 = calls;
const b = await get();
check("FMP SIUSD wieder da → FMP bevorzugt", b.ratio === 100 && b.source === "FMP GCUSD / FMP SIUSD" && calls === c0 + 2);
await get(); clock += 9 * 60e3; await get();
check("vollständiger Wert 10 min gecacht", calls === c0 + 2);
clock += 2 * 60e3; await get();
check("nach TTL neu", calls === c0 + 4);
srv.close();

const html = renderToStaticMarkup(React.createElement(GoldSilverRatioView, { data: b }));
check("Anzeige: Wert, Stand, Quelle, kein Score", html.includes(">100.0<") && html.includes("Stand ") && html.includes("FMP GCUSD / FMP SIUSD") && html.includes("kein Score"));
const na = renderToStaticMarkup(React.createElement(GoldSilverRatioView, { data: null }));
check("Anzeige ohne Daten: n/a", na.includes(">n/a<") && na.includes("Stand n/a"));

const routes = readFileSync(new URL("../server/gold-routes.ts", import.meta.url), "utf8");
check("analyze-gold liest kein Silber (kein Score-Eingang)", !/SIUSD|gold-silver/i.test(routes));
const reg = readFileSync(new URL("../server/routes-register.ts", import.meta.url), "utf8");
check("Route registriert", reg.includes("registerGoldSilverRatioRoute(app)"));
const dash = readFileSync(new URL("../client/src/pages/GoldDashboard.tsx", import.meta.url), "utf8");
check("Zeile auf /gold unter Preis & Status", dash.includes("<GoldPriceSection data={data} /><GoldSilverRatioRow />"));

console.log(fail ? `\n${fail} Fehler` : "\nalle grün");
process.exit(fail ? 1 : 0);
