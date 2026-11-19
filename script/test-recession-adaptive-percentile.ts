/**
 * Future_7/8 (Mini-PR 10, erster Schritt): CAPE-20J-Perzentil als Zusatzzeile.
 * Prueft, dass die Ablesung den Score NICHT aendert.
 *
 * Ausführen: npx tsx script/test-recession-adaptive-percentile.ts
 */
import {
  ADAPTIVE_PERCENTILE_MIN_POINTS,
  adaptivePercentileReading,
  blendWithNyFedAnchor,
  buffettFromMarketCapGdp,
  buffettMonthlyHistory,
  buffettReading,
  probabilityFromNet,
  scoredTotals,
  withBuffettPercentile,
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

console.log("\nBuffett-Perzentil (Job 6) — Monatsreihe");
{
  // 260 Monatsbalken, Wilshire steigt; GDP quartalsweise konstant 30 000 Mrd. $.
  const stamps: number[] = [];
  const closes: (number | null)[] = [];
  for (let i = 0; i < 260; i++) {
    const d = new Date(Date.UTC(2005, 0, 1)); d.setUTCMonth(d.getUTCMonth() + i);
    stamps.push(d.getTime() / 1000);
    closes.push(i === 5 ? null : 10000 + i * 100);
  }
  const payload = { chart: { result: [{ timestamp: stamps, indicators: { quote: [{ close: closes }] } }] } };
  const gdp = [{ date: "2004-10-01", value: 30000 }, { date: "2010-01-01", value: null }, { date: "2015-01-01", value: 30000 }];
  const h = buffettMonthlyHistory(payload, gdp);
  check("null-Close faellt weg", h.length === 259, String(h.length));
  check("Quote = close×1,05/GDP×100", Math.abs(h[0].value - (10000 * 1.05 / 30000) * 100) < 1e-9, String(h[0].value));
  check("kein GDP davor → leer", buffettMonthlyHistory(payload, [{ date: "2099-01-01", value: 1 }]).length === 0);
  check("kaputte Payload → leer", buffettMonthlyHistory(null, gdp).length === 0);
  check("leere GDP → leer", buffettMonthlyHistory(payload, []).length === 0);

  const today = "2026-10-09";
  const market = { date: today, value: 75000 };
  const gdpPt = { date: "2026-07-01", value: 30000 };
  const scored = buffettFromMarketCapGdp(market, gdpPt, today)!;
  check("Wilshire-Bein gescort", !!scored && scored.available !== false, JSON.stringify(scored));
  const withP = withBuffettPercentile(scored, h, { date: today, value: 250 });
  check("Buffett adaptive gesetzt", !!withP.adaptive && withP.adaptive.percentile === 100, JSON.stringify(withP.adaptive));
  check("heutiger Wert ist der letzte Punkt", withP.adaptive?.to === today);
  for (const k of ["name", "group", "subgroup", "value", "rawScore", "weight", "weightedScore", "maxWeighted", "zone", "source", "description", "available"] as const) {
    check(`Buffett ${k} byte-gleich`, JSON.stringify(withP[k]) === JSON.stringify(scored[k]));
  }
  const { adaptive: _a, ...rest } = withP;
  check("ohne adaptive ist das Objekt identisch", JSON.stringify(rest) === JSON.stringify(scored));
  check("feste Zone >200 % weiter +16/16", buffettReading(250).weightedScore === 16 && buffettReading(250).maxWeighted === 16);
  check("geschlossener Slot → kein Perzentil", withBuffettPercentile(buffettReading(Number.NaN), h, { date: today, value: 250 }).adaptive === undefined);
  check("kurze Historie → kein Perzentil", withBuffettPercentile(scored, h.slice(-20), { date: today, value: 250 }).adaptive === undefined);

  // Netto, Max und P (inkl. NY-Fed-Anker) identisch mit und ohne Perzentil-Zeilen.
  const cape = capeFromPoint({ date: today, value: 41.9 }, today);
  const capeHist = monthly(300, 2026, (i) => 15 + i * 0.1);
  const before = [scored, cape, buffettReading(150), capeReading(Number.NaN)];
  const after = [withP, withAdaptivePercentile(cape, capeHist), before[2], before[3]];
  const tb = scoredTotals(before);
  const ta = scoredTotals(after);
  check("Netto/Max byte-gleich", JSON.stringify(tb) === JSON.stringify(ta), `${JSON.stringify(tb)} vs ${JSON.stringify(ta)}`);
  check("P byte-gleich", probabilityFromNet(tb.net, tb.max) === probabilityFromNet(ta.net, ta.max));
  check("P mit NY-Fed-Anker byte-gleich", blendWithNyFedAnchor(probabilityFromNet(tb.net, tb.max), 12) === blendWithNyFedAnchor(probabilityFromNet(ta.net, ta.max), 12));
}

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll adaptive percentile checks passed.");
