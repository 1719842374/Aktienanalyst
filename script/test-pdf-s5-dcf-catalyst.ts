// PDF S5: (1) negative DCF-Szenarien → n/a mit Grund (dcfNaReason / UI-Bedingung fcfTTM<0),
// (2) Katalysatoren-adj. Zielwert = UI-S17 (CatalystsSection: decisionPerShare → selectCatalystBase → × (1+ΣGB)).
// Stubs: echte /api/analyze-Antworten (SHEL.L, MSFT aus script/fixtures; VOW3.DE aus DoD #326). Kein FMP-Key nötig.
import { readFileSync } from "node:fs";
import { generateAnalysisHTML } from "../server/pdf-export";
import { buildBiasDecision, sumUpsideGb } from "../shared/bias-fixes";
import { calculateFCFFDCF, buildDefaultDCFParams, selectCatalystBase } from "../client/src/lib/calculations";
import { formatCurrency, statementCurrency } from "../shared/currency-format";

delete process.env.ANTHROPIC_API_KEY;
let fail = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? "PASS" : "FAIL"} ${m}`); if (!c) fail++; };
const load = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const s5 = (html: string) => text(html.slice(html.indexOf("<!-- S5: DCF -->"), html.indexOf("<!-- S6: CRV -->")));

/** UI-Wert exakt wie CatalystsSection.tsx (ohne KI-Enrich): Zahl + formatierter Text. */
function uiCatalystTarget(d: any) {
  const bias = buildBiasDecision(d);
  const cons = calculateFCFFDCF(buildDefaultDCFParams(d));
  const totalGB = sumUpsideGb(d.catalysts);
  const decision = Number.isFinite(bias.decisionPerShare) ? bias.decisionPerShare : cons.perShare;
  const info = selectCatalystBase(decision, totalGB, d.currentPrice, d.analystPT.median);
  const ccy = info.source !== "dcf" ? d.currency : statementCurrency(d);
  const target = info.base * (1 + totalGB / 100);
  return { target, text: formatCurrency(target, 2, ccy) };
}

for (const [file, tk] of [["analysis-SHEL.L.json", "SHEL.L"], ["analysis-MSFT.json", "MSFT"], ["analysis-VOW3.DE-negfcf.json", "VOW3.DE"]] as const) {
  const d = load(file);
  const html = await generateAnalysisHTML(d);
  const t = s5(html);
  const ui = uiCatalystTarget(d);
  const row = (t.match(/Katalysatoren-adj\. Zielwert (.*?) DCF vs Kurs/) || [])[1] || "";
  console.log(`  ${tk}: UI ${ui.text} | PDF „${row.trim()}“`);
  ok(row.trim().startsWith(ui.text + " "), `${tk}: Kat.-Ziel PDF = UI-S17 (${ui.text})`);
  ok(!/\$-\d+\.\d{2}(?!\d|B|M|T)|-\d{3,}\.\d%/.test(t), `${tk}: keine negativen DCF-Rohwerte in S5`);
}
{ // VOW3: alle drei Szenarien negativ → n/a mit Grund aus der API (dcfNaReason „negativer FCF“)
  const d = load("analysis-VOW3.DE-negfcf.json");
  const t = s5(await generateAnalysisHTML(d));
  ok((t.match(/n\/a — negativer FCF/g) || []).length >= 4, "VOW3: 3 Szenarien + DCF vs Kurs = n/a — negativer FCF");
  ok(!/-825\.67|-1164\.9/.test(t), "VOW3: −825.67 / −1164.9 % nicht mehr im PDF");
}
{ // Positive Szenarien (MSFT) unverändert als Zahl
  const t = s5(await generateAnalysisHTML(load("analysis-MSFT.json")));
  ok(!/n\/a — negativer/.test(t) && /Konservativ \S+ \S+ \$\d/.test(t), "MSFT: positive Szenarien weiter als Zahl");
}
console.log(fail ? `\n${fail} FAIL` : "\nALL PASS");
process.exit(fail ? 1 : 0);
