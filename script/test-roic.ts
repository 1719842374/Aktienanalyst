/**
 * Tests fuer die ROIC-Extraktion (Return on Invested Capital) in der
 * Peer-Group-Vergleichstabelle — sowohl die 1Y/FY-Spalte (bestehend) als
 * auch die 5Y-Durchschnittsspalte (Auftrag 05.08.2026).
 *
 * Bug-Kontext (1Y/FY): fmpKeyMetrics() (liefert `returnOnInvestedCapital`)
 * wurde im primaeren Analyze-Pfad importiert, aber NIRGENDS aufgerufen. Im
 * Fallback-Pfad (analyze-helpers.ts) wurde das Ergebnis sogar schon geholt,
 * aber beim Destrukturieren mit einem leeren Slot verworfen. PeerCompany
 * hatte ueberhaupt kein roic-Feld.
 *
 * Erweiterung (5Y, 05.08.2026): Peer-Tabelle zeigte nur EINEN ROIC-Wert
 * (letztes FY) — zu kurzfristig fuer zyklische/investitionsintensive
 * Unternehmen. extractRoicFromKeyMetricsRows() nimmt jetzt die volle
 * key-metrics-Historie (bis zu 5 Jahre) und berechnet zusaetzlich den
 * arithmetischen Durchschnitt ueber alle Jahre mit echtem numerischem Wert.
 *
 * Importiert die ECHTE Implementierung aus server/news-peers.ts (kein
 * Nachbau) — verhindert Test/Code-Drift.
 *
 * Ausfuehren: npx tsx script/test-roic.ts
 */
import { extractRoicFromKeyMetricsRows, extractRoicPercentFromRow } from "../server/news-peers";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n=== Extraktion aus FMP /stable/key-metrics Zeile (1Y/FY, bestehend) ===");
{
  // Echte Struktur, live gegen FMP AAPL 2025 verifiziert (0..1-Skala von FMP)
  const row = { symbol: "AAPL", date: "2025-09-27", fiscalYear: "2025", returnOnInvestedCapital: 0.5196842110031786 };
  const r = extractRoicFromKeyMetricsRows([row]);
  check("returnOnInvestedCapital 0.5197 → 52.0 % (×100, 1 Dezimalstelle)", r.roicPercent === 52.0, String(r.roicPercent));
  check("fiscalYear durchgereicht", r.fiscalYear === "2025");
  check("periodDate durchgereicht (Datenaktualitaet)", r.periodDate === "2025-09-27");
}
{
  const r = extractRoicFromKeyMetricsRows([{ returnOnInvestedCapital: 0.0629, fiscalYear: "2026" }]);
  check("kleiner positiver ROIC korrekt (NVDA-Groessenordnung, hier synthetisch)", r.roicPercent === 6.3);
}
{
  // Negativer ROIC (Turnaround-Kandidat) muss erhalten bleiben, NICHT gefiltert
  const r = extractRoicFromKeyMetricsRows([{ returnOnInvestedCapital: -0.042, fiscalYear: "2025" }]);
  check("negativer ROIC bleibt negativ (kein Clamping auf 0)", r.roicPercent === -4.2);
}
{
  const r = extractRoicFromKeyMetricsRows([{ returnOnInvestedCapital: 0, fiscalYear: "2025" }]);
  check("ROIC exakt 0 bleibt 0 (echte Null, nicht null)", r.roicPercent === 0);
}
{
  const r = extractRoicFromKeyMetricsRows([{ returnOnInvestedCapital: null, fiscalYear: "2025" }]);
  check("fehlendes Feld → null (kein Fake-Wert)", r.roicPercent === null);
}
{
  const r = extractRoicFromKeyMetricsRows([{ returnOnInvestedCapital: "not_a_number" }]);
  check("nicht-numerischer Wert → null (kein NaN durchgereicht)", r.roicPercent === null);
}
{
  const r = extractRoicFromKeyMetricsRows([]);
  check("keine Zeile (Ticker ohne key-metrics) → alle Felder null", r.roicPercent === null && r.fiscalYear === null);
}

console.log("\n=== ROIC 5Y — arithmetischer Durchschnitt (Auftrag 05.08.2026) ===");
{
  // Echte Struktur, live gegen FMP AAPL 2020-2025 verifiziert (6 Jahre, alle positiv)
  const rows = [
    { fiscalYear: "2025", date: "2025-09-27", returnOnInvestedCapital: 0.5196842110031786 },
    { fiscalYear: "2024", date: "2024-09-28", returnOnInvestedCapital: 0.4430708117427921 },
    { fiscalYear: "2023", date: "2023-09-30", returnOnInvestedCapital: 0.4338918291689624 },
    { fiscalYear: "2022", date: "2022-09-24", returnOnInvestedCapital: 0.45174761493312454 },
    { fiscalYear: "2021", date: "2021-09-25", returnOnInvestedCapital: 0.3892505618225257 },
    { fiscalYear: "2020", date: "2020-09-26", returnOnInvestedCapital: 0.24269486859682882 },
  ];
  const r = extractRoicFromKeyMetricsRows(rows);
  // Durchschnitt der ERSTEN 5 Jahre (2025-2021), NICHT aller 6 — MAX_ROIC_5Y_YEARS=5
  const expectedAvg = +(((51.968 + 44.307 + 43.389 + 45.175 + 38.925) / 5)).toFixed(1);
  check("roicPercent = neuestes Jahr (FY2025)", r.roicPercent === 52.0, String(r.roicPercent));
  check(`roic5YPercent = Durchschnitt der letzten 5 Jahre (≈${expectedAvg}%)`, Math.abs((r.roic5YPercent ?? 0) - expectedAvg) < 0.15, String(r.roic5YPercent));
  check("roic5YYearsUsed = 5 (nicht 6 — nur die ersten 5 Zeilen fliessen ein)", r.roic5YYearsUsed === 5, String(r.roic5YYearsUsed));
}
{
  // BYDDY-Fall: 6 Jahre Historie, davon ein extremer Ausreisser (2022: -940%,
  // echter Sondereffekt laut FMP-Rohdaten) — MUSS normal einbezogen werden,
  // kein Ausfiltern nach Groesse (Regel #2 im Auftrag).
  const rows = [
    { fiscalYear: "2025", returnOnInvestedCapital: 0.03759826729471851 },
    { fiscalYear: "2024", returnOnInvestedCapital: 0.14112118620717876 },
    { fiscalYear: "2023", returnOnInvestedCapital: 0.13122572369884322 },
    { fiscalYear: "2022", returnOnInvestedCapital: -9.406199617465873 },
    { fiscalYear: "2021", returnOnInvestedCapital: 0.048562354159807655 },
  ];
  const r = extractRoicFromKeyMetricsRows(rows);
  check("extremer negativer Ausreisser (2022) wird NICHT gefiltert (fliesst in den Durchschnitt ein)",
    r.roic5YYearsUsed === 5, `yearsUsed=${r.roic5YYearsUsed}`);
  check("roic5YPercent ist stark negativ durch den Ausreisser (kein Clamping)",
    (r.roic5YPercent ?? 0) < -100, String(r.roic5YPercent));
}
{
  // Genau 3 Jahre mit Wert → Grenzfall, MIN_ROIC_5Y_YEARS=3 → Durchschnitt wird gezeigt
  const rows = [
    { fiscalYear: "2025", returnOnInvestedCapital: 0.10 },
    { fiscalYear: "2024", returnOnInvestedCapital: 0.20 },
    { fiscalYear: "2023", returnOnInvestedCapital: 0.30 },
  ];
  const r = extractRoicFromKeyMetricsRows(rows);
  check("genau 3 Jahre → Durchschnitt wird berechnet (Grenzfall, nicht n/a)", r.roic5YPercent === 20.0, String(r.roic5YPercent));
  check("roic5YYearsUsed = 3", r.roic5YYearsUsed === 3);
}
{
  // Nur 2 Jahre mit echtem Wert → < MIN_ROIC_5Y_YEARS (3) → n/a (null), NIEMALS 0
  const rows = [
    { fiscalYear: "2025", returnOnInvestedCapital: 0.10 },
    { fiscalYear: "2024", returnOnInvestedCapital: 0.20 },
  ];
  const r = extractRoicFromKeyMetricsRows(rows);
  check("nur 2 Jahre verfuegbar → roic5YPercent = null (n/a), NICHT 0", r.roic5YPercent === null, String(r.roic5YPercent));
  check("roicPercent (FY) bleibt trotzdem sichtbar (nur die 5Y-Spalte ist n/a)", r.roicPercent === 10.0);
}
{
  // 5 Jahre Historie, aber 2 davon haben null (fehlender Wert) → nur 3 echte
  // Werte fliessen ein, MIN_ROIC_5Y_YEARS=3 erreicht → Durchschnitt ueber 3, NICHT 5
  const rows = [
    { fiscalYear: "2025", returnOnInvestedCapital: 0.30 },
    { fiscalYear: "2024", returnOnInvestedCapital: null },
    { fiscalYear: "2023", returnOnInvestedCapital: 0.20 },
    { fiscalYear: "2022", returnOnInvestedCapital: null },
    { fiscalYear: "2021", returnOnInvestedCapital: 0.10 },
  ];
  const r = extractRoicFromKeyMetricsRows(rows);
  check("null-Jahre werden UEBERSPRUNGEN, nicht als 0 gezaehlt (Durchschnitt aus 3, nicht 5 Werten)",
    r.roic5YPercent === 20.0, String(r.roic5YPercent));
  check("roic5YYearsUsed = 3 (nur echte Werte gezaehlt)", r.roic5YYearsUsed === 3);
}
{
  // 0 als echter Wert zaehlt normal mit (Regel #2: "Negative Werte und 0
  // werden normal einbezogen") — NICHT verwechseln mit "fehlend".
  const rows = [
    { fiscalYear: "2025", returnOnInvestedCapital: 0.30 },
    { fiscalYear: "2024", returnOnInvestedCapital: 0 },
    { fiscalYear: "2023", returnOnInvestedCapital: 0.15 },
  ];
  const r = extractRoicFromKeyMetricsRows(rows);
  check("ROIC=0 in einem Jahr zaehlt normal mit (nicht als fehlend behandelt)",
    r.roic5YYearsUsed === 3 && Math.abs((r.roic5YPercent ?? -1) - 15.0) < 0.1, String(r.roic5YPercent));
}
{
  // Keine Historie ueberhaupt (Ticker ohne key-metrics)
  const r = extractRoicFromKeyMetricsRows([]);
  check("keine Historie → roic5YPercent = null, roic5YYearsUsed = 0", r.roic5YPercent === null && r.roic5YYearsUsed === 0);
}
{
  // extractRoicPercentFromRow direkt (Hilfsfunktion, wird auch fuer die
  // Einzelwerte im 5Y-Fenster verwendet) — Regressionsschutz fuer die
  // null-vs-0-Unterscheidung auf der untersten Ebene.
  check("extractRoicPercentFromRow(null-Feld) → null", extractRoicPercentFromRow({ returnOnInvestedCapital: null }) === null);
  check("extractRoicPercentFromRow(0) → 0 (echte Null)", extractRoicPercentFromRow({ returnOnInvestedCapital: 0 }) === 0);
  check("extractRoicPercentFromRow(keine Zeile) → null", extractRoicPercentFromRow(null) === null);
}

console.log(failed === 0 ? "\n✅ Alle ROIC-Tests bestanden (1Y/FY + 5Y-Durchschnitt)" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
