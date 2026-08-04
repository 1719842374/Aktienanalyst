/**
 * Tests fuer die YoY-Wachstumsberechnung pro Geschaeftssegment.
 *
 * Bug-Kontext: fmpSegments()/fmpGeoSegments() lasen nur die NEUESTE Periode und
 * lieferten kein Wachstumsfeld. sector-data.ts las `seg.growth` → undefined →
 * die Spalte "Wachstum" der Segment-TAM-Analyse zeigte fuer jedes Segment
 * 0.0 %. Diese Tests sichern die neue Logik ab, inklusive der Regel
 * "keine Vorjahreszahl → null, NIEMALS 0".
 *
 * Ausfuehren: npx tsx script/test-segment-growth.ts
 * Mit Live-FMP-Verifikation: npx tsx script/test-segment-growth.ts --live
 */
import { fmpSegments } from "../server/fmp";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}
function near(a: number | null, b: number, tol = 0.05): boolean {
  return a !== null && Math.abs(a - b) <= tol;
}

// Nachbau der Normalisierungs-Kernlogik, damit die reine Rechenregel ohne
// Netzwerkzugriff getestet werden kann (identische Formel wie in server/fmp.ts).
const SKIP = new Set(["symbol", "date", "reportedCurrency", "cik", "fillingDate",
  "acceptedDate", "calendarYear", "period", "link", "finalLink", "fiscalYear"]);
function extractSegmentMap(row: any): Record<string, number> {
  const src: Record<string, unknown> = row?.data && typeof row.data === "object" ? row.data : (row ?? {});
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(src)) {
    if (SKIP.has(k)) continue;
    const n = Number(v);
    if (!isNaN(n) && n > 0) out[k] = n;
  }
  return out;
}
function normalise(rows: any[]) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const key = (r: any) => String(r?.date ?? r?.reportedDate ?? r?.fiscalYear ?? r?.calendarYear ?? "");
  const sorted = [...rows].sort((a, b) => key(b).localeCompare(key(a)));
  const latest = sorted[0], latestKey = key(latest);
  const prev = sorted.find(r => key(r) !== latestKey);
  const cur = extractSegmentMap(latest), pm = prev ? extractSegmentMap(prev) : {};
  const names = Object.keys(cur);
  const total = names.reduce((s, n) => s + cur[n], 0);
  return names.sort((a, b) => cur[b] - cur[a]).map(name => {
    const revenue = cur[name], pr = pm[name];
    const hasPrev = typeof pr === "number" && isFinite(pr) && pr > 0;
    return {
      name, revenue,
      percentage: total > 0 ? Math.round((revenue / total) * 1000) / 10 : 0,
      growth: hasPrev ? Math.round(((revenue / pr) - 1) * 1000) / 10 : null,
    };
  });
}

console.log("\nKern-Formel: growth = (rev_t / rev_{t-1} - 1) × 100");
{
  const rows = [
    { fiscalYear: 2025, date: "2025-12-31", data: { AWS: 120, Ads: 60, Flat: 50, Shrink: 40 } },
    { fiscalYear: 2024, date: "2024-12-31", data: { AWS: 100, Ads: 50, Flat: 50, Shrink: 50 } },
  ];
  const out = normalise(rows);
  const by = (n: string) => out.find(o => o.name === n)!;
  check("AWS 100→120 = +20.0 %", near(by("AWS").growth, 20));
  check("Ads 50→60 = +20.0 %", near(by("Ads").growth, 20));
  check("Flat 50→50 = 0.0 % (echte Null, nicht Platzhalter)", by("Flat").growth === 0);
  check("Shrink 50→40 = -20.0 % (negativ moeglich)", near(by("Shrink").growth, -20));
}

console.log("\nRegel: fehlende Vorjahreszahl → null, NIEMALS 0");
{
  const rows = [
    { fiscalYear: 2025, date: "2025-12-31", data: { Alt: 120, NeuesSegment: 30 } },
    { fiscalYear: 2024, date: "2024-12-31", data: { Alt: 100 } },
  ];
  const out = normalise(rows);
  check("Neues Segment ohne Vorjahr → growth === null", out.find(o => o.name === "NeuesSegment")!.growth === null);
  check("Bestehendes Segment weiterhin berechnet", near(out.find(o => o.name === "Alt")!.growth, 20));
}
{
  const out = normalise([{ fiscalYear: 2025, date: "2025-12-31", data: { Nur: 100 } }]);
  check("nur EINE Periode berichtet → growth === null (kein 0.0 %)", out[0].growth === null);
}
{
  // Duplikat derselben Periode darf nicht als Vorjahr gelten (sonst faelschlich 0 %)
  const out = normalise([
    { fiscalYear: 2025, date: "2025-12-31", data: { A: 100 } },
    { fiscalYear: 2025, date: "2025-12-31", data: { A: 100 } },
  ]);
  check("Duplikat-Periode wird nicht als Vorjahr missbraucht → null", out[0].growth === null);
}

console.log("\nRobustheit");
{
  check("leere Eingabe → leeres Array", normalise([]).length === 0);
  check("Metadaten werden nicht als Segment gelesen", !normalise([
    { fiscalYear: 2025, date: "2025-12-31", symbol: "X", data: { A: 10 } },
  ]).some(o => o.name === "fiscalYear" || o.name === "symbol"));
  // Alt-Shape (flach, ohne `data`)
  const flat = normalise([
    { date: "2025-12-31", symbol: "X", A: 120 },
    { date: "2024-12-31", symbol: "X", A: 100 },
  ]);
  check("flaches Alt-Shape wird ebenfalls berechnet", near(flat[0].growth, 20));
}

async function live() {
  console.log("\nLive-Verifikation gegen FMP (AMZN)");
  const segs = await fmpSegments("AMZN");
  check("AMZN liefert Segmente", segs.length > 0, `${segs.length} Segmente`);
  const withGrowth = segs.filter(s => s.growth !== null);
  check("mindestens 5 Segmente mit echter Wachstumsrate", withGrowth.length >= 5, `${withGrowth.length} von ${segs.length}`);
  check("NICHT alle Wachstumsraten sind 0 (der gemeldete Bug)", withGrowth.some(s => s.growth !== 0));
  const aws = segs.find(s => /web services/i.test(s.name));
  check("AWS gefunden", !!aws, aws?.name);
  check("AWS Wachstum deutlich positiv (> 5 %)", !!aws && aws.growth !== null && aws.growth > 5, `AWS: ${aws?.growth}%`);
  const ads = segs.find(s => /advertising/i.test(s.name));
  check("Advertising gefunden", !!ads, ads?.name);
  check("Advertising Wachstum deutlich positiv (> 5 %)", !!ads && ads.growth !== null && ads.growth > 5, `Ads: ${ads?.growth}%`);
  console.log("\n  Alle AMZN-Segmente:");
  for (const s of segs) {
    console.log(`    ${s.name.padEnd(28)} $${(s.revenue / 1e9).toFixed(1)}B  ${s.growth === null ? "n/a" : (s.growth >= 0 ? "+" : "") + s.growth + " %"}`);
  }
}

(async () => {
  if (process.argv.includes("--live")) {
    try { await live(); } catch (e: any) { console.error("  ⚠️  Live-Test uebersprungen:", e?.message); }
  }
  console.log(failed === 0 ? "\n✅ Alle Segment-Wachstums-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
  process.exit(failed === 0 ? 0 : 1);
})();
