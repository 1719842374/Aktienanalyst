/**
 * Regressionstest für die ROIC-Verdrahtung im Kapitalallokations-Score.
 *
 * Ausführen: npx tsx script/test-capital-score-roic.ts
 */
import {
  computeCapitalScore,
  extractRoicInputsFromKeyMetrics,
} from "../server/management-score";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\n=== ROIC-Verdrahtung: FMP-Historie ===");
{
  // FMP-Reihenfolge ist absichtlich gemischt: die Implementierung muss nach
  // Datum sortieren statt sich auf die API-Reihenfolge zu verlassen.
  const fmpKeyMetricsResponse = [
    { date: "2023-06-30", returnOnInvestedCapital: 0.14 },
    { date: "2019-06-30", returnOnInvestedCapital: 0.05 },
    { date: "2024-06-30", returnOnInvestedCapital: 0.17 },
    { date: "2020-06-30", returnOnInvestedCapital: 0.07 },
    { date: "2022-06-30", returnOnInvestedCapital: 0.11 },
    { date: "2021-06-30", returnOnInvestedCapital: 0.09 },
  ];
  const actual = extractRoicInputsFromKeyMetrics(fmpKeyMetricsResponse);
  check("roicPct nimmt den neuesten Jahreswert (17 %)", actual.roicPct === 17, JSON.stringify(actual));
  check("roic5YPct nimmt den ältesten Historienwert (5 %)", actual.roic5YPct === 5, JSON.stringify(actual));
}

console.log("\n=== ROIC-Verdrahtung: unveränderter Leer-/Fehler-Fallback ===");
{
  // Ein leerer Wert entspricht dem abgefangenen fmpKeyMetrics-Fehlerpfad.
  const actual = extractRoicInputsFromKeyMetrics([]);
  check("leere/fehlgeschlagene Antwort liefert roicPct=null", actual.roicPct === null, JSON.stringify(actual));
  check("leere/fehlgeschlagene Antwort liefert roic5YPct=null", actual.roic5YPct === null, JSON.stringify(actual));

  const fallback = computeCapitalScore({
    roicPct: actual.roicPct,
    roic5YPct: actual.roic5YPct,
    waccPct: 8,
    fcfMarginPct: null,
    fcfMarginTrend: null,
    cashConversionRatio: null,
    reinvestmentEfficiency: null,
  });
  check("alter ROIC-Fallback bleibt bei 0.35", fallback.roicScore === 0.35, String(fallback.roicScore));
  check("Flag 'ROIC nicht verfügbar' bleibt erhalten", fallback.flags.includes("ROIC nicht verfügbar"), JSON.stringify(fallback.flags));
  check("vollständiger neutraler Fallback bleibt 0.35", fallback.score === 0.35, String(fallback.score));
}

console.log("\n=== S_Capital: Formel-Regressionsschutz ===");
{
  const fixed = computeCapitalScore({
    roicPct: 15,
    roic5YPct: 10,
    waccPct: 8,
    fcfMarginPct: 20,
    fcfMarginTrend: "stabil",
    cashConversionRatio: 0.9,
    reinvestmentEfficiency: 0.8,
  });
  const expected = 0.40 * 1.0 + 0.35 * 0.8 + 0.25 * 0.6;
  check("0.40/0.35/0.25-Gewichtung ergibt unverändert 0.83", Math.abs(fixed.score - expected) < 1e-12, `${fixed.score} statt ${expected}`);
  check("feste Eingaben behalten Teilwerte bei", fixed.roicScore === 1 && fixed.fcfScore === 0.8 && fixed.reinvestScore === 0.6, JSON.stringify(fixed));
}

console.log(failed === 0 ? "\n✅ Alle Kapitalallokations-ROIC-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
