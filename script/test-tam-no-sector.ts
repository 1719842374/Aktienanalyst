// Follow-up #292: SAP.DE / VOW3.DE (Yahoo-Fallback, sector/industry leer) bekamen den Sektor-Default
// „Global Market“ 5 %. Stubs = echte /api/analyze-Payloads (script/fixtures/analyze-tam-no-sector-2026-10-25.json).
import { readFileSync } from "fs";
import { generateTAMAnalysis, dcfGrowthCapFromTam } from "../server/sector-data";

let fail = 0;
const ok = (c: boolean, m: string, x = "") => { console.log(`${c ? "✅" : "❌"} ${m}${x ? " — " + x : ""}`); if (!c) fail++; };
const fx = JSON.parse(readFileSync(new URL("./fixtures/analyze-tam-no-sector-2026-10-25.json", import.meta.url), "utf8"));
const run = (a: any, growth: number) => generateTAMAnalysis(a.sector, a.industry, a.description, a.revenue, growth, a.revenueSegments ?? []);

for (const t of ["SAP.DE", "VOW3.DE"]) {
  const a = fx[t];
  ok(a.sector === "" && a.industry === "" && a.dataSource === "yahoo", `${t}: Live-Payload Yahoo, Sektor/Branche leer (Ursache)`);
  ok(a.tamAnalysis.tamLabel === "Global Market" && a.tamAnalysis.tamCAGR === 5, `${t}: main lieferte Sektor-Default Global Market 5 %`);
  const r = run(a, 0);
  ok(/^n\/a/.test(r.tamLabel) && /Sektor/.test(r.tamLabel), `${t}: Label n/a mit Grund`, r.tamLabel);
  ok(r.tamCAGR === null && r.tamTotal === null && r.marketShare === null, `${t}: CAGR/TAM/Marktanteil null (n/a)`);
  ok(/Sektor|Branche/.test(r.tamSource) && !/IMF/.test(r.tamSource), `${t}: Quelle nennt Grund, kein IMF-Default`);
  ok(r.companyDataMissing === "no-revenue" && r.companyGrowth === null && r.outperforming === null, `${t}: Unternehmensseite weiter n/a`);
  ok(r.quality === "weak", `${t}: quality weak wie vorher`);
  const before = dcfGrowthCapFromTam({ quality: a.tamAnalysis.quality, tamCAGR: a.tamAnalysis.tamCAGR, companyGrowth: 0 });
  const after = dcfGrowthCapFromTam({ quality: r.quality!, tamCAGR: r.tamCAGR, companyGrowth: 0 });
  ok(JSON.stringify(before) === JSON.stringify(after) && after.useSegmentCagr === false, `${t}: DCF-Kopplung identisch (useSegmentCagr false)`);
}

// US-Kontrolle MSFT: Ergebnis identisch zur Live-Antwort von main
const m = fx.MSFT;
const rm = run(m, m.tamAnalysis.companyGrowth);
ok(rm.tamLabel === m.tamAnalysis.tamLabel && rm.tamSource === m.tamAnalysis.tamSource && rm.quality === m.tamAnalysis.quality && rm.tamCAGR === m.tamAnalysis.tamCAGR, "MSFT: TAM unverändert", rm.tamLabel);

// Generik: bekannte Sektoren unverändert, Unbekannter Sektor (nicht leer) bleibt wie bisher
ok(generateTAMAnalysis("Technology", "Software - Application", "saas", 3e10, 10).tamLabel === "Global Enterprise Software", "Sektor bekannt → Mapping unverändert");
ok(generateTAMAnalysis("", "Auto Manufacturers", "", 3e11, 2).tamLabel === "Global Market", "nur Branche bekannt → Verhalten unverändert (kein leerer Sektor+Branche)");
const withRev = generateTAMAnalysis("", "", "", 5e10, 4);
ok(withRev.tamLabel === "Global Market" && withRev.companyGrowth === 4, "leer + Umsatz (FMP-Pfad) → unverändert (außerhalb Scope, siehe PR)");

console.log(fail ? `\n❌ ${fail} fehlgeschlagen` : "\n✅ alle bestanden");
process.exit(fail ? 1 : 0);
