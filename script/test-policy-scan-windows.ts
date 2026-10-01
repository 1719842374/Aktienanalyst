/**
 * Richtung ueber ein und zwei Jahre. Fehlende Historie bleibt unbekannt.
 * Run: npx tsx --tsconfig script/tsconfig.jsx.json script/test-policy-scan-windows.ts
 */
import { readFileSync } from "node:fs";
import { buildPolicyNote } from "../server/crypto-regulation-llm";
import {
  FRED_LOOKBACK_DAYS,
  WINDOW_GAP_DAYS,
  levelNear,
  readingFromSeries,
  type PolicyWindows,
  type SeriesDirectionReading,
} from "../server/policy-scan-windows";

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const asOf = "2026-10-01";

function point(daysBefore: number, value: number) {
  const t = Date.parse(`${asOf}T00:00:00Z`) - daysBefore * 86400000;
  return { date: new Date(t).toISOString().slice(0, 10), value };
}

console.log("policy scan windows");

ok("Fenster ist mindestens 800 Tage", FRED_LOOKBACK_DAYS >= 800);

const rising = readingFromSeries([
  point(730, 1),
  point(365, 2),
  point(0, 3),
], asOf);
ok("1J steigend", rising.direction1y === "steigend" && rising.level1y === 2 && rising.diff1y === 1, JSON.stringify(rising));
ok("2J steigend", rising.direction2y === "steigend" && rising.level2y === 1 && rising.diff2y === 2);

const falling = readingFromSeries([point(365, 5), point(0, 4)], asOf);
ok("1J fallend", falling.direction1y === "fallend" && falling.diff1y === -1);
ok("ohne 2J-Punkt bleibt die Richtung unbekannt", falling.direction2y === "unbekannt" && falling.level2y == null && falling.diff2y == null);

const flat = readingFromSeries([point(365, 4), point(730, 4), point(0, 4)], asOf);
ok("gleiche Niveaus sind unveraendert", flat.direction1y === "unverändert" && flat.direction2y === "unverändert" && flat.diff1y === 0);

const missing = readingFromSeries([point(10, 9)], asOf);
ok("nur ein aktueller Punkt: beide Richtungen unbekannt", missing.direction1y === "unbekannt" && missing.direction2y === "unbekannt" && missing.latest === 9);

const empty = readingFromSeries([], asOf);
ok("leere Serie hat kein Niveau und keine Richtung", empty.latest == null && empty.direction1y === "unbekannt" && empty.direction2y === "unbekannt");

const tooFar = point(365 + WINDOW_GAP_DAYS + 1, 8);
ok("Punkt ausserhalb der Luecke zaehlt nicht", levelNear([tooFar, point(0, 1)], asOf, 365) == null);
ok("Punkt am Rand der Luecke zaehlt", levelNear([point(365 + WINDOW_GAP_DAYS, 8)], asOf, 365) === 8);

const tga = readingFromSeries([point(365, 800_000), point(0, 977_000)], asOf, value => value / 1000);
ok("TGA wird vor der Richtung von Millionen auf Milliarden gestellt", tga.latest === 977 && tga.level1y === 800 && tga.direction1y === "steigend");

const scanSrc = readFileSync(new URL("../server/policy-scan.ts", import.meta.url), "utf8");
ok("die fuenf Serien nutzen das lange Fenster", ["DGS10", "WTREGEN", "M2SL", "DFF", "DFII10"].every(id => scanSrc.includes(`"${id}"`)));
ok("kein 120-Tage-Fenster mehr", !/fredLatest\(\s*"[A-Z0-9]+"\s*,\s*120\s*\)/.test(scanSrc));

function known(partial: Partial<SeriesDirectionReading> = {}): SeriesDirectionReading {
  return {
    latest: 3,
    level1y: 2,
    level2y: 1,
    diff1y: 1,
    diff2y: 2,
    direction1y: "steigend",
    direction2y: "steigend",
    ...partial,
  };
}

const windows: PolicyWindows = {
  policyRate: known({ latest: 3.88, level1y: 4.5, level2y: 5.1, diff1y: -0.62, diff2y: -1.22, direction1y: "fallend", direction2y: "fallend" }),
  realYield10y: known({ latest: 1.9, level1y: 1.9, level2y: 1.5, diff1y: 0, diff2y: 0.4, direction1y: "unverändert", direction2y: "steigend" }),
  dgs10: known({ latest: 4.1 }),
  m2Bn: known({ latest: 23342.8, level1y: 22000, level2y: 21000, diff1y: 1342.8, diff2y: 2342.8 }),
  tgaBn: known({ latest: 977.08, level1y: 800, level2y: 700, diff1y: 177.08, diff2y: 277.08 }),
};

const invented = buildPolicyNote({
  summary: "Der Leitzins liegt bei 9.99 Prozent und M2 bei 99 Billionen USD. Die Regeln aendern nichts. BTC bleibt offen.",
  ratesView: "Leitzins 9.99 Prozent.",
  liquidityView: "M2 bei 23.34 Billionen USD.",
  keyDrivers: ["Leitzins fallend", "erfunden 42"],
  btcImplication: "BTC folgt der gemessenen Richtung.",
}, windows);
ok("erfundene Zusammenfassung wird nicht uebernommen", !invented.note.summary.includes("9.99") && invented.note.summary.includes("3.88"));
ok("erfundene Zins-Karte faellt auf die Messung zurueck", invented.note.ratesView.includes("3.88") && !invented.note.ratesView.includes("9.99"));
ok("M2-Karte darf die Billionen-Anzeige zitieren", invented.note.liquidityView.includes("23.34"));
ok("Treiber mit erfundener Zahl faellt weg", !invented.note.keyDrivers.some(driver => driver.includes("42")));
ok("BTC-Satz ohne neue Zahl bleibt", invented.note.btcImplication.includes("BTC"));

const clean = buildPolicyNote({
  summary: "Leitzins 3.88 Prozent, ein Jahr fallend. Realzins 1.9 Prozent. Die belegte Regel senkt den Druck auf die Krypto-Liquidität. Das stützt BTC.",
}, windows);
ok("Notiz mit nur gemessenen Zahlen bleibt erhalten", clean.summarySource === "model" && clean.note.summary.includes("3.88") && clean.note.summary.includes("Krypto-Liquidität"));

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\npolicy scan windows ok");
