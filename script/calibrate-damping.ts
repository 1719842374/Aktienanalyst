/**
 * W7 Gerüst — Dämpfungsfaktor offline kalibrieren (Future_Work.md „Volle Adaptivität“ §3).
 * Grid f = 0.2 … 0.6, Schritt 0.05; gewählt wird das f mit maximaler Korrelation zwischen
 * gedämpfter Valuation und nachfolgender Rendite. KEINE eingebauten Daten: Eingabe ist eine JSON-Datei
 * [{ techStrength, baseValuation, subsequentReturn }] aus echten historischen Fällen.
 * Ergebnis bitte in shared/adaptive-signals.ts ADAPTIVE_CONFIG.dampingFactor übernehmen (Review).
 * Run: npx tsx script/calibrate-damping.ts <cases.json>
 */
import { readFileSync } from "node:fs";

export type DampingCase = { techStrength: number; baseValuation: number; subsequentReturn: number };

function pearson(x: number[], y: number[]): number {
  const n = x.length; if (n < 3) return NaN;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

export function calibrateDamping(cases: DampingCase[]): { factor: number | null; corr: number | null; grid: { f: number; corr: number }[] } {
  const grid: { f: number; corr: number }[] = [];
  for (let k = 0; k <= 8; k++) {
    const f = +(0.2 + k * 0.05).toFixed(2);
    const eff = cases.map(c => c.baseValuation * (1 - c.techStrength * f));
    grid.push({ f, corr: pearson(eff, cases.map(c => c.subsequentReturn)) });
  }
  const valid = grid.filter(g => Number.isFinite(g.corr));
  if (!valid.length) return { factor: null, corr: null, grid }; // zu wenig Daten → n/a, kein Default erfunden
  const best = valid.reduce((a, b) => (b.corr > a.corr ? b : a));
  return { factor: best.f, corr: best.corr, grid };
}

if (process.argv[1]?.endsWith("calibrate-damping.ts")) {
  const file = process.argv[2];
  if (!file) { console.log("Usage: npx tsx script/calibrate-damping.ts <cases.json>  (keine Daten → keine Kalibrierung)"); process.exit(0); }
  console.log(JSON.stringify(calibrateDamping(JSON.parse(readFileSync(file, "utf8"))), null, 2));
}
