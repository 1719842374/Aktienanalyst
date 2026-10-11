/**
 * Kalibrierungs-GERÜST für ADAPTIVE_CONFIG.VALUATION_DAMPING (shared/adaptive-signals.ts).
 * Run: npx tsx script/calibrate-damping.ts [backtest.json]
 *
 * Grid 0.2–0.6 (Schritt 0.05). Ohne echte Backtest-Daten wird KEINE Zahl empfohlen:
 * Das Skript gibt dann nur das Grid aus und beendet sich. Startwert bleibt 0.4.
 *
 * Erwartetes Eingabeformat (echte Daten, z. B. aus server/backtest/*):
 *   [{ "ticker": "NVO", "asOf": "2024-06-28", "analysis": <AdaptiveSource zum Stichtag, point-in-time>,
 *      "forwardReturn12M": -0.31 }, ...]
 * Zielmetrik: Spearman-Rangkorrelation (adaptive score vs. Forward-Rendite), Bericht je damping.
 * Look-ahead vermeiden: analysis muss point-in-time sein (keine späteren Kurse/Fundamentaldaten).
 */
import fs from "fs";
import { adaptiveScoreFromAnalysis, ADAPTIVE_CONFIG, type AdaptiveSource } from "../shared/adaptive-signals";

interface Sample { ticker: string; asOf: string; analysis: AdaptiveSource; forwardReturn12M: number }

export const DAMPING_GRID = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6];

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ra = ranks(a), rb = ranks(b);
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length, mb = rb.reduce((s, v) => s + v, 0) / rb.length;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

export function evaluateGrid(samples: Sample[]) {
  return DAMPING_GRID.map(damping => {
    const pairs = samples
      .map(s => ({ sc: adaptiveScoreFromAnalysis(s.analysis, damping).score, fr: s.forwardReturn12M }))
      .filter((p): p is { sc: number; fr: number } => p.sc != null && Number.isFinite(p.fr));
    return { damping, n: pairs.length, spearman: spearman(pairs.map(p => p.sc), pairs.map(p => p.fr)) };
  });
}

const file = process.argv[2];
if (!file) {
  console.log(`Grid: ${DAMPING_GRID.join(", ")} — aktueller Startwert ${ADAPTIVE_CONFIG.VALUATION_DAMPING}.`);
  console.log("Keine Backtest-Datei übergeben → keine Empfehlung (keine erfundene Zahl).");
  process.exit(0);
}
const samples: Sample[] = JSON.parse(fs.readFileSync(file, "utf8"));
const out = evaluateGrid(samples);
console.table(out);
const valid = out.filter(o => o.spearman != null && o.n >= 30);
if (valid.length === 0) console.log("Zu wenige Stichproben (n<30) → keine Empfehlung.");
else { const best = valid.reduce((a, b) => (b.spearman! > a.spearman! ? b : a)); console.log(`Bester Grid-Punkt: damping=${best.damping} (ρ=${best.spearman!.toFixed(3)}, n=${best.n}). Übernahme nur nach Review.`); }
