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
check("Ratio = Gold/Silber", r.ratio === 84 && r.source === GOLD_SILVER_SOURCE);
check("Stand = ältere Quote (Unix-Sek.)", r.asOf === new Date(1760194800 * 1000).toISOString());
check("Silber fehlt → n/a", computeGoldSilverRatio({ price: 4200 }, null).ratio === null && computeGoldSilverRatio({ price: 4200 }, null).unavailableReason === "SIUSD fehlt");
check("0/kaputt → n/a", computeGoldSilverRatio({ price: 4200 }, { price: 0 }).ratio === null && computeGoldSilverRatio({ price: "x" }, { price: 50 }).ratio === null);
check("ohne Zeitstempel kein erfundenes Datum", computeGoldSilverRatio({ price: 4200 }, { price: 50 }).asOf === null);

let calls = 0; let clock = 0; let silverUp = false;
const app = express();
registerGoldSilverRatioRoute(app, { now: () => clock, quote: async s => { calls++; return s === "GCUSD" ? { price: 4000, timestamp: 1760000000 } : silverUp ? { price: 40, timestamp: 1760000000 } : null; } });
const srv = app.listen(0); const port = (srv.address() as any).port;
const get = async () => (await fetch(`http://127.0.0.1:${port}/api/gold-silver-ratio`)).json();
const a = await get();
check("Route: n/a bei fehlendem SIUSD, kein 500", a.ratio === null && a.unavailableReason === "SIUSD fehlt");
silverUp = true;
const b = await get();
check("n/a nicht gecacht, nächster Aufruf lädt neu", b.ratio === 100 && calls === 4);
await get(); clock += 9 * 60e3; await get();
check("vollständiger Wert 10 min gecacht", calls === 4);
clock += 2 * 60e3; await get();
check("nach TTL neu", calls === 6);
srv.close();

const html = renderToStaticMarkup(React.createElement(GoldSilverRatioView, { data: b }));
check("Anzeige: Wert, Stand, Quelle, kein Score", html.includes(">100.0<") && html.includes("Stand ") && html.includes(GOLD_SILVER_SOURCE) && html.includes("kein Score"));
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
