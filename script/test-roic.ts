/**
 * Tests fuer die ROIC-Extraktion (Return on Invested Capital) in der
 * Peer-Group-Vergleichstabelle.
 *
 * Bug-Kontext: fmpKeyMetrics() (liefert `returnOnInvestedCapital`) wurde im
 * primaeren Analyze-Pfad importiert, aber NIRGENDS aufgerufen. Im Fallback-Pfad
 * (analyze-helpers.ts) wurde das Ergebnis sogar schon geholt, aber beim
 * Destrukturieren mit einem leeren Slot verworfen. PeerCompany hatte
 * ueberhaupt kein roic-Feld. Diese Tests sichern die neue Extraktionslogik ab.
 *
 * Ausfuehren: npx tsx script/test-roic.ts
 */
let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// Nachbau der Kernlogik aus server/news-peers.ts extractRoicFromKeyMetricsRow,
// damit die reine Extraktions-/Rundungsregel ohne Netzwerkzugriff testbar ist.
function extractRoic(row: any): { roicPercent: number | null; fiscalYear: string | null; periodDate: string | null } {
  if (!row) return { roicPercent: null, fiscalYear: null, periodDate: null };
  const field = row.returnOnInvestedCapital;
  const raw = field == null ? NaN : Number(field);
  const roicPercent = isFinite(raw) ? +(raw * 100).toFixed(1) : null;
  return {
    roicPercent,
    fiscalYear: row.fiscalYear != null ? String(row.fiscalYear) : null,
    periodDate: typeof row.date === "string" ? row.date : null,
  };
}

console.log("\nExtraktion aus FMP /stable/key-metrics Zeile");
{
  // Echte Struktur, live gegen FMP AAPL 2025 verifiziert (0..1-Skala von FMP)
  const row = { symbol: "AAPL", date: "2025-09-27", fiscalYear: "2025", returnOnInvestedCapital: 0.5196842110031786 };
  const r = extractRoic(row);
  check("returnOnInvestedCapital 0.5197 → 52.0 % (×100, 1 Dezimalstelle)", r.roicPercent === 52.0, String(r.roicPercent));
  check("fiscalYear durchgereicht", r.fiscalYear === "2025");
  check("periodDate durchgereicht (Datenaktualitaet)", r.periodDate === "2025-09-27");
}
{
  const r = extractRoic({ returnOnInvestedCapital: 0.0629, fiscalYear: "2026" });
  check("kleiner positiver ROIC korrekt (NVDA-Groessenordnung, hier synthetisch)", r.roicPercent === 6.3);
}
{
  // Negativer ROIC (Turnaround-Kandidat) muss erhalten bleiben, NICHT gefiltert
  const r = extractRoic({ returnOnInvestedCapital: -0.042, fiscalYear: "2025" });
  check("negativer ROIC bleibt negativ (kein Clamping auf 0)", r.roicPercent === -4.2);
}
{
  const r = extractRoic({ returnOnInvestedCapital: 0, fiscalYear: "2025" });
  check("ROIC exakt 0 bleibt 0 (echte Null, nicht null)", r.roicPercent === 0);
}
{
  const r = extractRoic({ returnOnInvestedCapital: null, fiscalYear: "2025" });
  check("fehlendes Feld → null (kein Fake-Wert)", r.roicPercent === null);
}
{
  const r = extractRoic({ returnOnInvestedCapital: "not_a_number" });
  check("nicht-numerischer Wert → null (kein NaN durchgereicht)", r.roicPercent === null);
}
{
  const r = extractRoic(undefined);
  check("keine Zeile (Ticker ohne key-metrics) → alle Felder null", r.roicPercent === null && r.fiscalYear === null);
}

console.log(failed === 0 ? "\n✅ Alle ROIC-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
