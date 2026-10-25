/**
 * F1-24 — PESTEL „Economic“: Kreditrisiko-Zeile (FRED BAA10Y), nur Anzeige.
 * Ausführen: npx tsx script/test-pestel-credit-line.ts
 * Fixtures: script/fixtures/credit/BAA10Y-2026-10-11.csv (echter FRED-Abzug), script/fixtures/analysis-MSFT.json.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pestelCreditLine, isEconomicCategory, PESTEL_CREDIT_DISPLAY_NOTE } from "../shared/pestel-credit-line";
import { emptyCreditSpread, loadMarketCreditSpread } from "../server/credit-route";
import { pestelDampeningFactor } from "../shared/bias-fixes";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const root = process.cwd();

console.log("\nn/a statt Ersatzwerte");
{
  const empty = pestelCreditLine(emptyCreditSpread("FRED-Abruf Timeout (25 s)"));
  check("leere Antwort → n/a mit Routen-Notiz", empty.status === "na" && empty.text.includes("n/a") && empty.text.includes("Timeout"));
  check("null → n/a mit Grund", pestelCreditLine(null).status === "na" && /keine Antwort/.test(pestelCreditLine(null).text));
  check("Fehler → n/a mit Grund", pestelCreditLine(undefined, { error: true }).status === "na");
  check("lädt → kein Wert", pestelCreditLine(undefined, { loading: true }).status === "loading");
  check("kein Zahlenwert im n/a-Text", !/\d+\.\d+ %/.test(empty.text));
}

console.log("\nEchter FRED-Abzug BAA10Y (2026-10-11) über loadMarketCreditSpread");
const csv = readFileSync(path.join(root, "script/fixtures/credit/BAA10Y-2026-10-11.csv"), "utf8");
const resp = await loadMarketCreditSpread({ fetchCsv: async () => csv });
const line = pestelCreditLine(resp);
{
  const last = resp.points[resp.points.length - 1];
  check("ok mit letztem FRED-Wert und Datum", line.status === "ok" && line.valuePct === last.value && line.asOf === last.date, JSON.stringify(line));
  check("Text nennt Wert, Stand und Quelle", line.text.includes(`${last.value.toFixed(2)} %`) && line.text.includes(last.date) && line.text.includes("BAA10Y"));
  check("3M-Änderung aus stress (gleiches Datum)", line.status === "ok" && line.change3MPp === (resp.stress?.change3MPp ?? null));
  const noStress = pestelCreditLine({ ...resp, stress: null });
  check("ohne stress: 3M n/a, kein erfundener Wert", noStress.status === "ok" && noStress.change3MPp === null && noStress.text.includes("3M-Änderung n/a"));
  console.log(`     → ${line.text}`);
}

console.log("\nKein Effekt auf pestelDampeningFactor / geopoliticalScore / overallExposure");
{
  const msft = JSON.parse(readFileSync(path.join(root, "script/fixtures/analysis-MSFT.json"), "utf8"));
  const pestel = msft.pestelAnalysis;
  const before = JSON.stringify(pestel);
  const geo = pestel.geopoliticalScore, exp = pestel.overallExposure, damp = pestelDampeningFactor(geo);
  pestelCreditLine(resp); pestelCreditLine(null);
  check("MSFT pestelAnalysis unverändert (deepEqual)", JSON.stringify(pestel) === before);
  check(`geopoliticalScore ${geo}, overallExposure ${exp}, Dämpfung ${damp.toFixed(2)} unverändert`, pestel.geopoliticalScore === geo && pestel.overallExposure === exp && pestelDampeningFactor(pestel.geopoliticalScore) === damp);
  check("Economic-Kategorie im MSFT-Payload gefunden", pestel.factors.some((f: any) => isEconomicCategory(f.category)));

  const sec = readFileSync(path.join(root, "client/src/components/sections/PestelSection.tsx"), "utf8");
  const lines = sec.split("\n");
  const scoreLines = lines.filter((l) => /pestelDampeningFactor\(|geopoliticalScore|overallExposure/.test(l));
  check("Score-/Exposure-Zeilen lesen keine Credit-Daten", scoreLines.length > 0 && scoreLines.every((l) => !/credit|Credit/.test(l)));
  check("Section zeigt Anzeige-Hinweis", sec.includes("PESTEL_CREDIT_DISPLAY_NOTE") && /nicht in PESTEL-Exposure/.test(PESTEL_CREDIT_DISPLAY_NOTE));

  const importers: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f.startsWith(".")) continue;
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && readFileSync(p, "utf8").includes("pestel-credit-line")) importers.push(path.relative(root, p));
    }
  };
  for (const d of ["client", "server", "shared"]) walk(path.join(root, d));
  check("nur PestelSection.tsx importiert das Modul", importers.join() === "client/src/components/sections/PestelSection.tsx", importers.join(", "));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
