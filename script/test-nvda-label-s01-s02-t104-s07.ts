/**
 * Label-Fixes S-01, S-02, T1-04, S-07.
 * Keine Score-, Wert-, Ampel- oder Schwellenänderung.
 * Auf ed1e98cd rot, auf dem Label-Head grün.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { buildCrossLine, buildFazit, type ExecSummaryInput } from "../server/exec-summary";
import { buildExecSummaryInputFromAnalysis } from "../server/exec-summary-attach";

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log("  ✓", name);
  } catch (e: unknown) {
    fail++;
    const msg = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.log("  ✗", name, "—", msg);
  }
}

const base: ExecSummaryInput = {
  ticker: "NVDA",
  companyName: "NVIDIA",
  price: 180,
  dcfConservative: 35.88,
  currency: "USD",
  statementCurrency: "USD",
};

check("S-01: Lage übernimmt das Ampel-Rating statt des Neutral-Defaults", () => {
  const lage = buildFazit({ ...base, fazitRating: "STARK UNATTRAKTIV" }).lage;
  assert.match(lage, /NVIDIA ist stark unattraktiv\./);
  assert.doesNotMatch(lage, /ist neutral/);
});

check("S-01: ohne Rating bleibt der bisherige Default, nichts wird erfunden", () => {
  const lage = buildFazit({ ...base }).lage;
  assert.match(lage, /NVIDIA ist neutral\./);
});

check("S-01: gesetztes s17Verdict bleibt, solange kein Ampel-Rating übergeben wird", () => {
  const lage = buildFazit({ ...base, s17Verdict: "ATTRAKTIV" }).lage;
  assert.match(lage, /NVIDIA ist attraktiv\./);
});

check("S-01: Ampel-Rating gewinnt gegen ein leeres s17Verdict", () => {
  const lage = buildFazit({ ...base, s17Verdict: null, fazitRating: "UNATTRAKTIV" }).lage;
  assert.match(lage, /NVIDIA ist unattraktiv\./);
});

check("S-02: DCF-Satz nennt valuationBaseLabel, die Zahl bleibt 35,88", () => {
  const lage = buildFazit({
    ...base,
    valuationBaseLabel: "Gehärteter Inverse-DCF",
    biasSwitched: true,
  }).lage;
  assert.match(lage, /Gehärteter Inverse-DCF sitzt bei 35,88 Dollar gegenüber 180 Dollar Kurs\./);
  assert.doesNotMatch(lage, /konservative DCF/);
});

check("S-02: Conservative DCF bleibt der Wortlaut des Labels, nicht eine umgerechnete Basis", () => {
  const lage = buildFazit({
    ...base,
    dcfConservative: 38.98,
    valuationBaseLabel: "Conservative DCF",
    biasSwitched: false,
  }).lage;
  assert.match(lage, /Conservative DCF sitzt bei 38,98 Dollar gegenüber 180 Dollar Kurs\./);
  assert.doesNotMatch(lage, /35,88/);
});

check("S-02: ohne Label bleibt der bisherige Satz, kein Basiswechsel", () => {
  const lage = buildFazit({ ...base }).lage;
  assert.match(lage, /Das konservative DCF sitzt bei 35,88 Dollar gegenüber 180 Dollar Kurs\./);
});

check("S-07: Golden Cross und Kurs unter MA200 nennen alle vier Flags und kein Buy", () => {
  const line = buildCrossLine({
    ...base,
    ma50AboveMA200: true,
    priceAboveMA200: false,
    macdAboveZero: false,
    macdRising: false,
  });
  assert.equal(
    line,
    "Kurs unter der 200-Tage, 50-Tage über 200-Tage (Golden-Cross-Lage), MACD unter 0, MACD nicht steigend. Kein Buy-Signal.",
  );
});

check("S-07: vier Ja-Flags ergeben das Buy-Signal, ohne ein Flag zu verschweigen", () => {
  const line = buildCrossLine({
    ...base,
    ma50AboveMA200: true,
    priceAboveMA200: true,
    macdAboveZero: true,
    macdRising: true,
  });
  assert.equal(
    line,
    "Kurs über der 200-Tage, 50-Tage über 200-Tage (Golden-Cross-Lage), MACD über 0, MACD steigend. Buy-Signal.",
  );
});

check("S-07: ohne MACD-Flags kein erfundener MACD-Satz", () => {
  const line = buildCrossLine({ ...base, ma50AboveMA200: true, priceAboveMA200: false });
  assert.equal(line, "50-Tage über 200-Tage (Golden-Cross-Lage).");
  assert.doesNotMatch(line, /MACD/);
});

check("S-07: ohne MA50-Flag bleibt die Zeile leer", () => {
  assert.equal(buildCrossLine({ ...base, ma50AboveMA200: null }), "");
});

check("S-07: Fazit-Klammer nennt dieselben vier Flags, die Bucket-Schwelle bleibt length >= 2", () => {
  const src = readFileSync("client/src/lib/fazit-signal.ts", "utf8");
  assert.match(src, /export function technicalFlagLabels/);
  assert.match(src, /"Kurs < MA200"/);
  assert.match(src, /"MA50 > MA200 \(Golden Cross\)"/);
  assert.match(src, /"MACD < 0"/);
  assert.match(src, /"MACD steigend"/);
  assert.match(src, /if \(techStatus\.buySignal\)/);
  assert.match(src, /else if \(techBear\.length >= 2\)/);
  assert.match(src, /technicalFlagLabels\(techStatus\)/);
  const bucket = src.slice(src.indexOf("const techBull"), src.indexOf("// S11: Moat"));
  assert.doesNotMatch(bucket, /score\s*[+\-]=|rating\s*=/);
});

check("T1-04: feste Namen A–E, unbekannter Schlüssel ohne erfundene Beschriftung", () => {
  assert.equal(existsSync("shared/thesis-subscore-labels.ts"), true);
  const labels = readFileSync("shared/thesis-subscore-labels.ts", "utf8");
  assert.match(labels, /A:\s*"Vertrag"/);
  assert.match(labels, /B:\s*"Bilanz"/);
  assert.match(labels, /C:\s*"Wachstum"/);
  assert.match(labels, /D:\s*"Bilanzqualität"/);
  assert.match(labels, /E:\s*"Katalysator"/);
  assert.match(labels, /export function thesisSubscoreLabel/);
  assert.match(labels, /return null/);
  const panel = readFileSync("client/src/components/sections/ThesisStrengthPanel.tsx", "utf8");
  assert.match(panel, /thesisSubscoreLabel/);
  assert.match(panel, /thesisSubscoreLabel\(k\)/);
});

check("Attach reicht MACD-Flags und das vorhandene valuationBaseLabel durch, ohne die DCF-Zahl zu tauschen", () => {
  const shel = JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8"));
  const input = buildExecSummaryInputFromAnalysis(shel);
  assert.equal(input.valuationBaseLabel, "Gehärteter Inverse-DCF");
  assert.equal(input.macdAboveZero, true);
  assert.equal(input.macdRising, true);
  assert.equal(input.dcfConservative, shel.biasFix.decisionPerShare);
  const lage = buildFazit({ ...input, fazitRating: "UNATTRAKTIV" }).lage;
  assert.match(lage, /ist unattraktiv/);
  assert.match(lage, /Gehärteter Inverse-DCF sitzt bei/);
  assert.doesNotMatch(lage, /konservative DCF/);
});

check("Label-Map liegt in shared und ändert keine Thesis-Scores", () => {
  assert.equal(existsSync("shared/thesis-subscore-labels.ts"), true);
  const thesis = readFileSync("server/thesis-strength.ts", "utf8");
  assert.match(thesis, /subScores:\{A:a\.score,B:b\.score,C:gc\.score,D:d\.score,E:e\.score\}/);
  assert.doesNotMatch(thesis, /THESIS_SUBSCORE_LABELS/);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
