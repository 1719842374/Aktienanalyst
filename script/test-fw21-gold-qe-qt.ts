/**
 * FW-21 / FW-22 — QE/QT-Bänder und Gold/WALCL, nur Anzeige.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-fw21-gold-qe-qt.ts
 */
import { readFileSync } from "node:fs";
import { GOLD_QE_QT_PARAMS, goldQeQtView, type WalclPoint } from "../shared/gold-qe-qt";

let n = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  n++;
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fail++;
};

function day(i: number): string {
  return new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
}

function series(len: number, walclAt: (i: number) => number, price = 2400): WalclPoint[] {
  return Array.from({ length: len }, (_, i) => ({ date: day(i), price, walcl: walclAt(i) }));
}

const missing = goldQeQtView(series(80, () => NaN).map(p => ({ ...p, walcl: null })));
check("ohne WALCL: n/a, keine Bänder", missing.unavailableReason === "n/a — WALCL fehlt in der Gold-Historie" && missing.bands.length === 0 && missing.ratio == null);

const flatThenUp = series(220, i => (i < 140 ? 6 : 6 + (i - 140) * 0.02));
const up = goldQeQtView(flatThenUp);
check("steigende Bilanz am Ende ist Ausweitung", up.regime === "expansion" && up.bands.some(b => b.regime === "expansion"), up.regime ?? "");
check("Perzentil kommt aus der eigenen Reihe", up.changePercentile != null && up.changePercentile > 80, String(up.changePercentile));
check("Gold/WALCL = Kurs / Bilanz", up.ratio != null && Math.abs(up.ratio - 2400 / flatThenUp[flatThenUp.length - 1].walcl!) < 1e-9, String(up.ratio));

const down = goldQeQtView(series(220, i => (i < 140 ? 8 : 8 - (i - 140) * 0.02)));
check("fallende Bilanz am Ende ist Abbau", down.regime === "contraction", down.regime ?? "");

const visible = [day(200), day(201), day(202)];
const clipped = goldQeQtView(flatThenUp, visible);
check("Bänder nutzen nur die sichtbaren Tage", clipped.bands.every(b => visible.includes(b.x1) && visible.includes(b.x2)));

const short = goldQeQtView(series(20, () => 6));
check("zu kurze Reihe: Bänder n/a, Verhältnis ohne erfundenes Perzentil", short.unavailableReason?.startsWith("n/a — zu wenige") === true && short.ratioPercentile == null);

check("Fenster ist der benannte 91-Tage-Parameter", GOLD_QE_QT_PARAMS.changeWindowDays === 91);
check("kein Gate-Name in der Rechnung", !JSON.stringify(up).includes("GOLD_QE_QT_REGIME"));

const pin = JSON.parse(readFileSync(new URL("./fixtures/prod-analyze-dcf-2026-10-25.json", import.meta.url), "utf8")).expectOldHead;
check("VOW3 (VWAGY) 4.735718", Number(pin.VWAGY.overallScore).toFixed(6) === "4.735718");
check("SAP 5.174758", Number(pin.SAP.overallScore).toFixed(6) === "5.174758");
check("MSFT 4.058138", Number(pin.MSFT.overallScore).toFixed(6) === "4.058138");

console.log(`\n${n - fail}/${n} Checks grün`);
process.exit(fail ? 1 : 0);
