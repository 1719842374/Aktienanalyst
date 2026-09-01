/**
 * Fixture: WORK2 TEIL 8 Risks-Herleitung (§8.6–8.7 Beispiele) + Anti-Hardcoding.
 * npx tsx script/test-regulatory-risks.ts
 */
import fs from "node:fs";
import path from "node:path";
import {
  derivePestelRisks, bucketForAxis, enrichAssessment, persistAssessment, readPersistedAssessment,
  type ScoredExposureLite,
} from "../server/regulatory-risks";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok ${name}`);
  else { failed++; console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}

function mk(over: Partial<ScoredExposureLite> = {}): ScoredExposureLite {
  return {
    country: "USA",
    regulationAxis: "price_regulation",
    title: "Testregime",
    description: "Test",
    estimatedImpactOnSales: -0.08,
    probability: 0.7,
    confidence: "high",
    epsImpact: -0.88,
    material: true,
    badgeOnly: false,
    source: { url: "https://example.gov/rule" },
    ...over,
  };
}

console.log("\n§8.6/8.7 derivePestelRisks");
{
  const r = derivePestelRisks([
    mk(),
    mk({ regulationAxis: "environmental_climate", title: "Emissionsauflage", country: "EU", material: true }),
    mk({ confidence: "low", material: false, badgeOnly: true, title: "Schlagzeile", estimatedImpactOnSales: -0.10, probability: 0.40, epsImpact: null }),
    mk({ material: false, badgeOnly: false, title: "Mini-Effekt", estimatedImpactOnSales: -0.01, probability: 0.80, epsImpact: -0.02 }),
  ]);
  check("material Preisregime → political", r.political.length === 1 && r.political[0].includes("Testregime"));
  check("material Umwelt → legal", r.legal.length === 1 && r.legal[0].includes("Emissionsauflage"));
  check("low/badge + mini → badgeOnly (kein Gate-Text)", r.badgeOnly.length === 2);
  check("political enthält EPS", r.political[0].includes("-0.88"));
  check("kein LLM-Feld nötig", !JSON.stringify(r).includes("modelUsed"));
}

console.log("\n§8.7 Spec-Beispiele (Bucket, nicht Gate-Math — die liegt in regulatory.ts)");
{
  check("price_regulation political", bucketForAxis("price_regulation") === "political");
  check("trade_tariff political", bucketForAxis("trade_tariff") === "political");
  check("competition_antitrust legal", bucketForAxis("competition_antitrust") === "legal");
  check("data_privacy_tech legal", bucketForAxis("data_privacy_tech") === "legal");
}

console.log("\nenrichAssessment + Persist");
{
  const enriched = enrichAssessment({ ticker: "FIXT", exposures: [mk()], discarded: 0, gate: { cap: 55 } });
  check("pestelRisks angehängt", enriched.pestelRisks.political.length === 1);
  persistAssessment(enriched);
  const read = readPersistedAssessment("fixt");
  check("Disk-Roundtrip", !!read && (read as any).pestelRisks?.political?.length === 1);
}

console.log("\nAnti-Hardcoding Quelltext");
{
  const src = fs.readFileSync(path.join("server", "regulatory-risks.ts"), "utf8");
  const forbidden = ["Medicaid", "IRA", "CBAM", "Section 301", "CHIPS"];
  check("keine Programmnamen in regulatory-risks.ts", !forbidden.some(f => src.includes(f)));
}

console.log(failed === 0 ? "\nAlle Regulatory-Risks-Tests bestanden" : `\n${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
