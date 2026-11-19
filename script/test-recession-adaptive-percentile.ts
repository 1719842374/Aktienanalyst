/**
 * Future_7/8 (Mini-PR 10, erster Schritt): CAPE-20J-Perzentil als Zusatzzeile.
 * Prueft, dass die Ablesung den Score NICHT aendert.
 *
 * Ausführen: npx tsx script/test-recession-adaptive-percentile.ts
 */
import {
  ADAPTIVE_PERCENTILE_MIN_POINTS,
  adaptivePercentileReading,
  capeFromPoint,
  capeReading,
  latestMultplCape,
  multplCapeHistory,
  percentileCompareRaw,
  withAdaptivePercentile,
} from "../server/recession";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

function monthly(n: number, endYear: number, f: (i: number) => number) {
  const out: { date: string; value: number }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(endYear, 11, 1));
    d.setUTCMonth(d.getUTCMonth() - (n - 1 - i));
    out.push({ date: d.toISOString().slice(0, 10), value: f(i) });
  }
  return out;
}

console.log("\nFuture_8 percentileScore-Stufen");
check(">90 → +4", percentileCompareRaw(95) === 4);
check(">75 → +2", percentileCompareRaw(80) === 2);
check("Mitte → 0", percentileCompareRaw(50) === 0);
check("<25 → −2", percentileCompareRaw(20) === -2);
check("<10 → −4", percentileCompareRaw(5) === -4);

console.log("\nPerzentil-Fenster");
{
  const rising = monthly(300, 2026, (i) => 10 + i * 0.1); // letzter Wert ist das Maximum
  const r = adaptivePercentileReading(rising);
  check("Maximum → Perzentil 100", r?.percentile === 100, JSON.stringify(r));
  check("Fenster 20 Jahre ≈ 240 Monate", !!r && r.n >= 239 && r.n <= 240, String(r?.n));
  check("Vergleich +4", r?.compareRaw === 4);
  const falling = monthly(300, 2026, (i) => 50 - i * 0.1);
  check("Minimum → niedriges Perzentil, Vergleich −4", adaptivePercentileReading(falling)?.compareRaw === -4);
  check(`unter ${ADAPTIVE_PERCENTILE_MIN_POINTS} Punkten → null`, adaptivePercentileReading(monthly(59, 2026, () => 20)) === null);
  check("leere Reihe → null", adaptivePercentileReading([]) === null);
  check("NaN-Werte fliegen raus", adaptivePercentileReading(monthly(70, 2026, (i) => (i % 2 ? NaN : 20)))  === null);
}

console.log("\nMultpl-Tabelle → Historie");
{
  const rows = monthly(260, 2026, (i) => 20 + (i % 30)).reverse();
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const html = `<table><tr><th>Date</th><th>Value</th></tr>${rows.map((r) => `<tr><td>${fmt(r.date)}</td><td>${r.value.toFixed(2)}</td></tr>`).join("")}</table>`;
  const hist = multplCapeHistory(html);
  check("alle Zeilen gelesen", hist.length === 260, String(hist.length));
  check("aufsteigend", hist.every((p, i) => i === 0 || hist[i - 1].date < p.date));
  check("letzter Punkt = latestMultplCape", hist[hist.length - 1]?.date === latestMultplCape(html)?.date);
  check("Cloudflare-Seite → leer", multplCapeHistory("Just a moment...").length === 0);
}

console.log("\nScore bleibt unveraendert");
{
  const hist = monthly(300, 2026, (i) => 15 + i * 0.1);
  const last = hist[hist.length - 1];
  const scored = capeFromPoint(last, last.date);
  const withP = withAdaptivePercentile(scored, hist);
  check("adaptive gesetzt", !!withP.adaptive);
  for (const k of ["rawScore", "weight", "weightedScore", "maxWeighted", "zone", "value", "available"] as const) {
    check(`${k} byte-gleich`, JSON.stringify(withP[k]) === JSON.stringify(scored[k]));
  }
  check("feste Zone weiter >35 → +12.6", capeReading(41.6).weightedScore === 12.6 && capeReading(41.6).maxWeighted === 12.6);
  const closed = capeReading(Number.NaN);
  check("geschlossener Slot bekommt keine Ablesung", withAdaptivePercentile(closed, hist).adaptive === undefined);
  check("kurze Historie → kein Feld", withAdaptivePercentile(scored, hist.slice(-30)).adaptive === undefined);
}

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll adaptive percentile checks passed.");
