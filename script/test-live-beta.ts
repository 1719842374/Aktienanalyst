/**
 * Aktuelles Beta = letzte 252 gemeinsame Handelstage gegen den Markt, nicht der 5-Jahres-Schnitt.
 * npx tsx script/test-live-beta.ts
 */
import { readFileSync } from "fs";
import { liveBeta, LIVE_BETA_MIN_OBS, LIVE_BETA_SESSIONS } from "../shared/live-beta";

let failed = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function day(i: number): string {
  const date = new Date(Date.UTC(2020, 0, 1));
  date.setUTCDate(date.getUTCDate() + i);
  return date.toISOString().slice(0, 10);
}

function paired(n: number, beta: number, start = 0) {
  let market = 100;
  let stock = 100;
  const marketPoints = [{ date: day(start), close: market }];
  const stockPoints = [{ date: day(start), close: stock }];
  for (let i = 1; i <= n; i++) {
    const marketReturn = ((i % 5) - 2) / 100;
    market *= 1 + marketReturn;
    stock *= 1 + beta * marketReturn;
    marketPoints.push({ date: day(start + i), close: market });
    stockPoints.push({ date: day(start + i), close: stock });
  }
  return { marketPoints, stockPoints };
}

const exact = paired(LIVE_BETA_SESSIONS, 1.5);
check("exaktes 1,5 über 252 Tage", liveBeta(exact.stockPoints, exact.marketPoints) === 1.5);

const flat = paired(80, 0);
check("flache Aktie → 0", liveBeta(flat.stockPoints, flat.marketPoints) === 0);

const short = paired(LIVE_BETA_MIN_OBS - 1, 1);
check("unter 60 Tagen → null", liveBeta(short.stockPoints, short.marketPoints) === null);

const regimeLength = LIVE_BETA_SESSIONS + 80;
let market = 100;
let stock = 100;
const regimeMarket = [{ date: day(0), close: market }];
const regimeStock = [{ date: day(0), close: stock }];
for (let i = 1; i <= regimeLength; i++) {
  const marketReturn = ((i % 5) - 2) / 100;
  const beta = i > regimeLength - LIVE_BETA_SESSIONS ? 2 : 0;
  market *= 1 + marketReturn;
  stock *= 1 + beta * marketReturn;
  regimeMarket.push({ date: day(i), close: market });
  regimeStock.push({ date: day(i), close: stock });
}
check(
  "nur die letzten 252 Tage, der ältere Schnitt zählt nicht",
  liveBeta(regimeStock, regimeMarket) === 2,
  String(liveBeta(regimeStock, regimeMarket)),
);

const shifted = exact.stockPoints.map((point, i) => ({ ...point, date: day(i + 5000) }));
check("ohne gemeinsame Tage → null", liveBeta(shifted, exact.marketPoints) === null);

const section1 = readFileSync("client/src/components/sections/Section1.tsx", "utf8");
check("Kachel heißt nicht mehr Beta (5Y)", !section1.includes("Beta (5Y)"));
check("Kachel liest betaLive", section1.includes("data.betaLive") && section1.includes('label="Beta"'));
check("Kachel fällt nicht auf beta5Y zurück", !/label="Beta"[\s\S]{0,180}beta5Y/.test(section1));

const route = readFileSync("server/analyze-route.ts", "utf8");
check("Antwort trägt betaLive und lässt beta5Y beim Anbieter-Beta", route.includes("betaLive") && route.includes("beta5Y: beta"));

console.log(failed === 0 ? "\nAlle Live-Beta-Tests grün." : `\n${failed} Test(s) fehlgeschlagen.`);
process.exit(failed === 0 ? 0 : 1);
