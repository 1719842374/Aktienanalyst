/**
 * Exec-CRV-Satz trägt das Währungswort wie der Fazit-Satz "Nachkaufen erst unter … <Währung>".
 * Reine Anzeige: Max-Entry-Zahl, CRV-Werte und "erfüllt"-Zweig bleiben unverändert.
 */
import fs from "fs";
import { buildExecSummaryInputFromAnalysis } from "../server/exec-summary-attach";
import { buildCrvLine, buildFazit, type ExecSummaryInput } from "../server/exec-summary";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, info = "") {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${info}`); }
}

// 1) SHEL.L, gespeicherte Analyse-Antwort
const a = JSON.parse(fs.readFileSync(new URL("./fixtures/analysis-SHEL.L.json", import.meta.url), "utf8"));
const inp = buildExecSummaryInputFromAnalysis(a);
const crv = buildCrvLine(inp);
const handlung = buildFazit(inp).handlung;
check("SHEL.L Max-Entry unverändert 29.8688", Math.abs((inp.maxEntryCrv3 ?? 0) - 29.86882093355182) < 1e-9);
check("SHEL.L Fazit: Nachkaufen erst unter 29,87 Pfund", handlung.includes("Nachkaufen erst unter 29,87 Pfund."), handlung);
check("SHEL.L CRV-Satz: Dafür erst unter 29,87 Pfund.", crv.endsWith("Dafür erst unter 29,87 Pfund."), crv);
check("SHEL.L CRV-Werte unverändert (1.7 / 1.3)", crv.includes("jetzt 1.7:1, risikoadjustiert 1.3:1"), crv);
const m = handlung.match(/unter ([\d.,]+ \S+?)\./), n = crv.match(/Dafür erst unter ([\d.,]+ \S+?)\./);
check("CRV-Satz == Fazit-Satz (Zahl + Währung)", !!m && !!n && m[1] === n[1], `${m?.[1]} vs ${n?.[1]}`);

// 2) Synthetische Fälle
const base: ExecSummaryInput = { ticker: "X", companyName: "X", price: 100, maxEntryCrv3: 80, crvBase: 1.5, crvRiskAdj: 1.1 };
check("USD: Dollar", buildCrvLine({ ...base, currency: "USD" }).endsWith("unter 80 Dollar."));
check("ohne Währung: Dollar (wie Fazit)", buildCrvLine(base).endsWith("unter 80 Dollar."));
check("Statement-Währung gewinnt (wie Fazit)", buildCrvLine({ ...base, currency: "CAD", statementCurrency: "USD" }).endsWith("unter 80 Dollar."));
check("EUR: Euro", buildCrvLine({ ...base, currency: "EUR", statementCurrency: "EUR" }).endsWith("unter 80 Euro."));
check("kein Entry: n/v ohne Währung", buildCrvLine({ ...base, maxEntryCrv3: null, currency: "GBP" }).endsWith("Dafür erst unter n/v."));
check("erfüllt-Zweig unverändert", buildCrvLine({ ...base, price: 70, currency: "GBP" }) === "Chance zu Risiko 3 zu 1 ist am Kurs erfüllt.");

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
