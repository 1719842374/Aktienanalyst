/**
 * PDF-Text: Kurs und Preisniveaus nutzen dasselbe Symbol wie der PDF-Kopf
 * (currencySymbol(data.currency) bzw. statementCurrency für DCF/Aktie), kein festes "$".
 * Fixtures: SHEL.L (GBP) und MSFT (USD, currency leer → "$" wie der Kopf-Fallback).
 * Run: npx tsx script/test-pdf-listing-currency.ts
 */
import { readFileSync } from "node:fs";
import { generateAnalysisHTML } from "../server/pdf-export";
import { currencySymbol, statementCurrency } from "../shared/currency-format";

delete process.env.ANTHROPIC_API_KEY;

const load = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
let fail = 0;
const ok = (c: boolean, m: string) => {
  console.log(`${c ? "PASS" : "FAIL"} ${m}`);
  if (!c) fail++;
};

const reLit = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function cell(html: string, label: string): string[] {
  const re = new RegExp(`${reLit(label)}</t[dh][^>]*>\\s*<t[dh][^>]*>([^<]*)`, "g");
  return [...html.matchAll(re)].map((m) => m[1]);
}
function rowVal(html: string, label: string): string | null {
  const m = html.match(new RegExp(`${label}</span><span class="row-val">([^<]*)`));
  return m ? m[1] : null;
}
function yAxis(html: string): string[] {
  return [...html.matchAll(/text-anchor="end">([^<]*)<\/text>/g)].map((m) => m[1]).filter((v) => /^[$£€¥]?\d/.test(v) && !v.includes("-"));
}
function s5Fair(html: string): string[] {
  return [...html.matchAll(/data-testid="pdf-s5-scen">(?:[\s\S]*?<td>[^<]*<\/td>){3}<td>([^<]*)/g)].map((m) => m[1]);
}
const hasDollar = (s: string) => s.includes("$");

const shel = load("analysis-SHEL.L.json");
const msft = load("analysis-MSFT.json");
const shelSym = currencySymbol(shel.currency);
const shelStmt = currencySymbol(statementCurrency(shel));
const msftSym = currencySymbol(msft.currency);

ok(shel.currency === "GBP" && shelSym === "£" && shelStmt === "£", `SHEL-Fixture GBP, Symbol £ (Listing ${shelSym}, Statement ${shelStmt})`);
ok(msftSym === "$", `MSFT-Fixture Symbol $ (currency=${String(msft.currency)})`);

const shelHtml = await generateAnalysisHTML(shel);
const msftHtml = await generateAnalysisHTML(msft);
const px = (n: number) => Number(n).toFixed(2);

ok(shelHtml.includes("Alle Werte in GBP"), "SHEL-Kopf: Alle Werte in GBP");
ok(msftHtml.includes("Alle Werte in USD"), "MSFT-Kopf: Alle Werte in USD");

const shelKurs = cell(shelHtml, "Kurs");
ok(shelKurs.length >= 2 && shelKurs.every((v) => v === `${shelSym}${px(shel.currentPrice)}`), `SHEL Kurs S1+S17 = ${shelSym}${px(shel.currentPrice)} [${shelKurs.join(" | ")}]`);
ok(shelKurs.every((v) => !hasDollar(v)), "SHEL Kurs-Felder ohne $");

const shelPt = rowVal(shelHtml, "Analysten-Konsens");
ok(!!shelPt && !hasDollar(shelPt) && shelPt.includes(shelSym), `SHEL Analysten-PT mit ${shelSym}, ohne $ [${shelPt}]`);

const shelFv = s5Fair(shelHtml);
ok(shelFv.length >= 1 && shelFv.every((v) => v.startsWith("n/a") || (v.startsWith(shelStmt) && !hasDollar(v))), `SHEL S5 Fair Value/Aktie mit Statement-Symbol ${shelStmt} [${shelFv.join(" | ")}]`);

const shel26 = rowVal(shelHtml, "26-Wochen-Durchschnitt");
ok(!!shel26 && shel26.startsWith(shelSym) && !hasDollar(shel26), `SHEL 26W-Durchschnitt ${shelSym} [${shel26}]`);

function thirdCell(html: string, label: string): string | null {
  const m = html.match(new RegExp(`<td>${label}</td><td>[\\s\\S]*?</td><td>([^<]*)</td>`));
  return m ? m[1] : null;
}
const shelMa200 = thirdCell(shelHtml, "Kurs > MA200");
const shelMa50 = thirdCell(shelHtml, "MA50 > MA200");
ok(!!shelMa200 && shelMa200.startsWith(shelSym) && !hasDollar(shelMa200), `SHEL MA200 mit ${shelSym} [${shelMa200}]`);
ok(!!shelMa50 && shelMa50.startsWith(shelSym) && !hasDollar(shelMa50), `SHEL MA50 mit ${shelSym} [${shelMa50}]`);

const shelY = yAxis(shelHtml);
ok(shelY.length === 3 && shelY.every((v) => v.startsWith(shelSym) && !hasDollar(v)), `SHEL Chart-Achse ${shelSym} [${shelY.join(" | ")}]`);

const shelMean = cell(shelHtml, "Mean");
const shelMed = cell(shelHtml, "Median");
const shelP10 = cell(shelHtml, "P10 (Bearish)");
const shelP90 = cell(shelHtml, "P90 (Bullish)");
ok([shelMean, shelMed, shelP10, shelP90].every((a) => a.length === 1 && a[0].startsWith(shelSym) && !hasDollar(a[0])),
  `SHEL Monte-Carlo ${shelSym} [${[shelMean, shelMed, shelP10, shelP90].map((a) => a[0]).join(" | ")}]`);

const shelCap = cell(shelHtml, "Market Cap");
ok(shelCap.length === 1 && shelCap[0].startsWith(shelSym) && !hasDollar(shelCap[0]), `SHEL Market Cap (Listing-Währung) ${shelSym} [${shelCap.join(" | ")}]`);

const shelFcf = cell(shelHtml, "FCF TTM");
ok(shelFcf.length >= 1 && shelFcf.every((v) => v.startsWith(shelStmt) && !hasDollar(v)), `SHEL FCF TTM Statement-Symbol ${shelStmt} [${shelFcf.join(" | ")}]`);

const msftKurs = cell(msftHtml, "Kurs");
ok(msftKurs.length >= 2 && msftKurs.every((v) => v === `${msftSym}${px(msft.currentPrice)}`), `MSFT Kurs S1+S17 = ${msftSym}${px(msft.currentPrice)} [${msftKurs.join(" | ")}]`);
const msftY = yAxis(msftHtml);
ok(msftY.length === 3 && msftY.every((v) => v.startsWith(msftSym)), `MSFT Chart-Achse bleibt ${msftSym} [${msftY.join(" | ")}]`);
const msftMean = cell(msftHtml, "Mean");
ok(msftMean.length === 1 && msftMean[0].startsWith(msftSym), `MSFT Monte-Carlo Mean bleibt ${msftSym} [${msftMean[0]}]`);
const msftFv = s5Fair(msftHtml);
ok(msftFv.length >= 1 && msftFv.every((v) => v.startsWith(msftSym)), `MSFT S5 Fair Value bleibt ${msftSym} [${msftFv.join(" | ")}]`);

console.log(fail ? `\n${fail} FAIL` : "\nALL PASS");
process.exit(fail ? 1 : 0);
