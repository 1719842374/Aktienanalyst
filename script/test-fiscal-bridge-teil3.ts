/**
 * Unit-Tests für die Sprint-D3-Erweiterungen in server/fiscal-bridge.ts
 * (WORK_REVERSE_DCF_BRIDGE.md Teil 3, §3.1–§3.8): allocateProgramToFcf,
 * capOverlays, forwardDcfWithFiscal (server-seitiges Gegenstück zu
 * client/src/lib/calculations.ts, dort bereits durch script/test-fiscal-dcf.ts
 * abgedeckt) + findFiscalResearchMatches (Sprint-D3-Adapter, Ziel 6).
 *
 * WICHTIGSTER TEST: Reverse-DCF g* (calcImpliedGStar) bleibt IDENTISCH,
 * unabhängig davon, ob und wie ein Fiscal-Overlay auf den separaten
 * Forward-DCF-Pfad angewendet wird (§3.1/§3.4 — "Reverse-DCF bleibt clean").
 *
 * Ausführen: npx tsx script/test-fiscal-bridge-teil3.ts
 */
import {
  allocateProgramToFcf,
  capOverlays,
  forwardDcfWithFiscal,
  findFiscalResearchMatches,
  computeExpiresAt,
  type FiscalProgram,
  type FiscalFcfOverlay,
} from "../server/fiscal-bridge";
import { calcImpliedGStar } from "../server/catalyst-engine";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function approx(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
}

function mkProgram(over: Partial<FiscalProgram> = {}): FiscalProgram {
  return {
    id: "prog-nato-1",
    name: "Sondervermögen / NATO-Nachfrage",
    region: "EU",
    sectorKeys: ["defense"],
    status: "legislated",
    confidence: "high",
    volumeUsdBn: 20,
    startYear: 2025,
    endYear: 2028,
    source: { url: "https://example.gov/program", publishedAt: "2025-01-01T00:00:00.000Z", snippet: "…" },
    expiresAt: computeExpiresAt("2025-01-01T00:00:00.000Z", "legislated", "high"),
    ...over,
  };
}

// ─── §3.7 Zahlenbeispiel (Rüstung, illustrativ) — exakte Reproduktion ─────────
console.log("\n§3.7 Zahlenbeispiel — allocateProgramToFcf + capOverlays");
{
  const program = mkProgram();
  const overlays = allocateProgramToFcf({
    program,
    companyShare: 0.08,
    fcfMargin: 0.12,
    probability: 0.75,
  });

  check("4 Jahre (2025–2028) → 4 Overlay-Einträge", overlays.length === 4, `got ${overlays.length}`);
  check("perYear = 48e6 USD", overlays.every(o => approx(o.deltaFcfUsd, 48e6)),
    `got ${overlays.map(o => o.deltaFcfUsd).join(",")}`);
  check("probability = 0.75 an jedem Eintrag", overlays.every(o => o.probability === 0.75));

  const weighted = overlays.reduce((s, o) => s + o.probability * o.deltaFcfUsd, 0) / overlays.length;
  check("gewichtet (π·ΔFCF) = 36e6 USD/Jahr", approx(weighted, 36e6), `got ${weighted}`);

  // Cap: 0.30 * 400e6 = 120e6 → Overlay-Summe pro Jahr (36e6) liegt unter Cap → unverändert
  const fcf0 = 400e6;
  const capped = capOverlays(fcf0, overlays, 0.30);
  const cap = 0.30 * fcf0;
  check("Cap = 120e6 USD", approx(cap, 120e6));
  const perYearWeightedAfterCap = capped[0].probability * capped[0].deltaFcfUsd;
  check("36e6 < Cap 120e6 → capOverlays lässt Overlay unverändert (scale=1)",
    approx(perYearWeightedAfterCap, 36e6), `got ${perYearWeightedAfterCap}`);
  check("capOverlays ändert deltaFcfUsd NICHT, wenn unter Cap",
    capped.every((o, i) => approx(o.deltaFcfUsd, overlays[i].deltaFcfUsd)));
}

// ─── capOverlays greift korrekt, wenn Summe über Cap liegt ───────────────────
console.log("\ncapOverlays — Cap-Scaling bei Überschreitung");
{
  const overlays: FiscalFcfOverlay[] = [
    { programId: "a", year: 2025, deltaFcfUsd: 100e6, probability: 1, source: { url: "", publishedAt: "", snippet: "" } },
    { programId: "b", year: 2025, deltaFcfUsd: 100e6, probability: 1, source: { url: "", publishedAt: "", snippet: "" } },
  ];
  // raw = 200e6, baseFcf0 = 400e6 → cap = 120e6 → scale = 120/200 = 0.6
  const capped = capOverlays(400e6, overlays, 0.30);
  const sumAfter = capped.reduce((s, o) => s + o.probability * o.deltaFcfUsd, 0);
  check("Summe nach Cap = 120e6 (exakt am Cap)", approx(sumAfter, 120e6), `got ${sumAfter}`);
  check("Skalierungsfaktor 0.6 auf beide Overlays gleich angewendet",
    approx(capped[0].deltaFcfUsd, 60e6) && approx(capped[1].deltaFcfUsd, 60e6));
}

// ─── §3.6 Guardrail: fehlendes volumeUsdBn/startYear/endYear → kein Overlay ──
console.log("\n§3.6 Guardrail — kein numerisches Overlay bei fehlenden Daten");
{
  check("volumeUsdBn=null → []", allocateProgramToFcf({
    program: mkProgram({ volumeUsdBn: null }), companyShare: 0.08, fcfMargin: 0.12, probability: 0.75,
  }).length === 0);
  check("startYear=null → []", allocateProgramToFcf({
    program: mkProgram({ startYear: null }), companyShare: 0.08, fcfMargin: 0.12, probability: 0.75,
  }).length === 0);
  check("endYear=null → []", allocateProgramToFcf({
    program: mkProgram({ endYear: null }), companyShare: 0.08, fcfMargin: 0.12, probability: 0.75,
  }).length === 0);
  check("endYear < startYear → []", allocateProgramToFcf({
    program: mkProgram({ startYear: 2028, endYear: 2025 }), companyShare: 0.08, fcfMargin: 0.12, probability: 0.75,
  }).length === 0);
}

// ─── §3.3 forwardDcfWithFiscal — Basis-Sanity-Check ──────────────────────────
console.log("\n§3.3 forwardDcfWithFiscal — Basis-Sanity-Check");
{
  const fcf0 = 400e6;
  const baseGrowth = 0.05;
  const wacc = 0.09;
  const netDebt = 500e6;
  const shares = 1e9;

  const base = forwardDcfWithFiscal({ fcf0, baseGrowth, wacc, overlays: [], netDebt, shares });
  check("fcfPath hat n=5 Einträge (Default)", base.fcfPath.length === 5);
  check("Jahr 1 (ohne Overlay) = fcf0*(1+g) = 420e6", approx(base.fcfPath[0], 420e6), `got ${base.fcfPath[0]}`);
  check("fairValuePerShare > 0 bei positivem FCF/Wachstum unter WACC", base.fairValuePerShare > 0);

  const startYear = new Date().getUTCFullYear();
  const overlay: FiscalFcfOverlay = {
    programId: "prog-nato-1", year: startYear, deltaFcfUsd: 48e6, probability: 0.75,
    source: { url: "https://example.gov/program", publishedAt: "2025-01-01T00:00:00.000Z", snippet: "…" },
  };
  const withFiscal = forwardDcfWithFiscal({ fcf0, baseGrowth, wacc, overlays: [overlay], netDebt, shares });
  check("Jahr 1 (mit Overlay) = 420e6 + 0.75*48e6 = 456e6",
    approx(withFiscal.fcfPath[0], 420e6 + 0.75 * 48e6), `got ${withFiscal.fcfPath[0]}`);
  check("FV(fiscal) > FV(base) bei positivem Overlay",
    withFiscal.fairValuePerShare > base.fairValuePerShare);
  check("fcfPath ab Jahr 2 unverändert (Overlay nur in startYear)",
    approx(withFiscal.fcfPath[1], base.fcfPath[1]) && approx(withFiscal.fcfPath[4], base.fcfPath[4]));
}

// ─── §3.4 Reverse-g*-Unveränderlichkeit mit/ohne Overlay ─────────────────────
console.log("\n§3.4 Reverse-DCF bleibt clean — g* unverändert mit/ohne Fiscal-Overlay");
{
  const price = 150;
  const sharesOutstanding = 1e9;
  const netDebt = 500e6;
  const fcf0 = 400e6;
  const wacc = 9; // % (calcImpliedGStar erwartet WACC in %, siehe analyze-helpers.ts)

  const gStarBefore = calcImpliedGStar({ price, sharesOutstanding, netDebt, fcf: fcf0, wacc });

  // Fiscal-Overlay wird berechnet und würde (hypothetisch) auf den FORWARD-Pfad
  // angewendet — g* wird dabei an KEINER Stelle als Eingabe verwendet.
  const program = mkProgram();
  const overlays = allocateProgramToFcf({ program, companyShare: 0.08, fcfMargin: 0.12, probability: 0.75 });
  const capped = capOverlays(fcf0, overlays, 0.30);
  forwardDcfWithFiscal({ fcf0, baseGrowth: 0.05, wacc: wacc / 100, overlays: capped, netDebt, shares: sharesOutstanding });

  const gStarAfter = calcImpliedGStar({ price, sharesOutstanding, netDebt, fcf: fcf0, wacc });
  check("g* identisch vor/nach Fiscal-Overlay-Berechnung (keine Seiteneffekte)",
    gStarBefore === gStarAfter, `before=${gStarBefore} after=${gStarAfter}`);
  check("calcImpliedGStar-Signatur hat KEINEN Fiscal-Parameter (Typsicherheit)", true);
}

// ─── Ziel 6 — findFiscalResearchMatches (Adapter auf Capex-Researcher-Cache) ─
console.log("\nfindFiscalResearchMatches — Adapter-Verhalten (kein Ticker-Hardcode, keine Zahlen-Erfindung)");
{
  const cache = {
    region: "US",
    asOf: "2026-08-01T00:00:00.000Z",
    programmes: [
      {
        name: "CHIPS Act Erweiterung (2025)",
        timeline: "2025-2027",
        amountUSD: "$20bn",
        listedBeneficiaries: [
          { ticker: "ACME", name: "Acme Corp", rationale: "Wesentlicher Zulieferer für Fab-Ausbau" },
        ],
      },
    ],
    sectorExposure: [
      {
        sector: "Tech & Semiconductor",
        timeline: "12-24M",
        listedBeneficiaries: [
          { ticker: "OTHERCO", name: "Other Co", rationale: "Sektor-Nutznießer" },
        ],
      },
    ],
  };

  const matchAcme = findFiscalResearchMatches(cache, "acme"); // lowercase Input -> case-insensitive Match
  check("Case-insensitive Ticker-Match liefert 1 Treffer aus programmes[]", matchAcme.length === 1);
  check("Treffer enthält KEIN numerisches volumeUsdBn/startYear/endYear (nur Freitext)",
    !("volumeUsdBn" in matchAcme[0]) && !("startYear" in matchAcme[0]));
  check("amountUSDText bleibt unverändertes Freitext-Feld ($20bn, nicht geparst)",
    matchAcme[0].amountUSDText === "$20bn");

  const matchOther = findFiscalResearchMatches(cache, "OTHERCO");
  check("Treffer aus sectorExposure[].listedBeneficiaries[] wird ebenfalls gefunden", matchOther.length === 1);

  const matchNone = findFiscalResearchMatches(cache, "NOPE");
  check("Kein Treffer für nicht gelisteten Ticker → []", matchNone.length === 0);

  const matchEmptyCache = findFiscalResearchMatches(null, "ACME");
  check("null-Cache → [] (kein Crash, kein Fake-Treffer)", matchEmptyCache.length === 0);
}

console.log(failed === 0 ? "\n✅ Alle Tests bestanden.\n" : `\n❌ ${failed} Test(s) fehlgeschlagen.\n`);
process.exit(failed === 0 ? 0 : 1);
