/**
 * Label-Fixes S-01, S-02, T1-04, S-07.
 * Keine Score-, Wert-, Ampel- oder Schwellenänderung.
 * Auf ed1e98cd rot, auf dem Label-Head grün.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execLageFromFazit } from "../client/src/lib/execLageFromFazit";
import { buildCrossLine, buildFazit, type ExecSummaryInput } from "../server/exec-summary";
import { buildExecSummaryInputFromAnalysis } from "../server/exec-summary-attach";
import { applyBiasFix, buildBiasDecision } from "../shared/bias-fixes";
import { fazitEntryForExport } from "../shared/fazit-entry";

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

const MAIN = "ed1e98cdf17bca6251650d2eb2c1825e850c6530";
const fixturePaths = [
  ["MSFT", "script/fixtures/analysis-MSFT.json"],
  ["SHEL.L", "script/fixtures/analysis-SHEL.L.json"],
  ["SPY", "script/fixtures/analysis-SPY.json"],
  ["VOW3.DE", "script/fixtures/analysis-VOW3.DE-negfcf.json"],
] as const;
const snapshotPaths = [
  "client/src/lib/fazit-signal-ed1e98cd-snapshot.ts",
  "server/exec-summary-ed1e98cd-snapshot.ts",
  "server/exec-summary-attach-ed1e98cd-snapshot.ts",
];

function materializeMainSnapshots(): void {
  const fazit = execSync(`git show ${MAIN}:client/src/lib/fazit-signal.ts`, { encoding: "utf8" });
  const summary = execSync(`git show ${MAIN}:server/exec-summary.ts`, { encoding: "utf8" });
  const attach = execSync(`git show ${MAIN}:server/exec-summary-attach.ts`, { encoding: "utf8" })
    .replace('from "./exec-summary"', 'from "./exec-summary-ed1e98cd-snapshot"');
  writeFileSync(snapshotPaths[0], fazit);
  writeFileSync(snapshotPaths[1], summary);
  writeFileSync(snapshotPaths[2], attach);
}

function removeMainSnapshots(): void {
  for (const path of snapshotPaths) rmSync(path, { force: true });
}

check("DC 1–3: Score, Rating, Farben, Counts, Downgrades, fazitSatz und execSummary gegen ed1e98cd", () => {
  materializeMainSnapshots();
  try {
    execSync("npx tsx --tsconfig script/tsconfig.jsx.json script/nvda-label-dc-compare.ts", {
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    const detail = `${err.stdout ?? ""}\n${err.stderr ?? ""}`.trim() || err.message || String(error);
    assert.fail(detail.split("\n").slice(0, 12).join("\n"));
  } finally {
    removeMainSnapshots();
  }
});

check("DC 4: jedes der fünf Ratings steht kleingeschrieben im ersten Lage-Satz", () => {
  const msft = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
  const ratings = ["ATTRAKTIV", "LEICHT ATTRAKTIV", "NEUTRAL", "UNATTRAKTIV", "STARK UNATTRAKTIV"] as const;
  for (const rating of ratings) {
    const lage = execLageFromFazit(msft, rating);
    assert.ok(lage, rating);
    assert.match(lage, new RegExp(`^${msft.companyName} ist ${rating.toLowerCase()}\\.`));
    if (rating !== "STARK UNATTRAKTIV") assert.doesNotMatch(lage, /stark unattraktiv/);
  }
});

check("DC 5: nach applyBiasFix ist das Lage-Label die frische Basis und die Zahl der Fair Value", () => {
  for (const [name, path] of fixturePaths) {
    const fixed = applyBiasFix(structuredClone(JSON.parse(readFileSync(path, "utf8"))));
    const fresh = buildBiasDecision(fixed);
    const fe = fazitEntryForExport(fixed);
    assert.ok(fe, name);
    assert.equal(fe.fairValue, fresh.decisionPerShare, name);
    const lage = execLageFromFazit(fixed, "NEUTRAL");
    assert.ok(lage, name);
    const shown = fe.fairValue.toLocaleString("de-DE", { maximumFractionDigits: 2 });
    assert.ok(lage.includes(`${fresh.valuationBaseLabel} sitzt bei ${shown}`), `${name}: ${lage}`);
  }
});

check("DC 6: Schwellen score>=4/2/-1/-3, isBuy, techBear>=2 und buySignal bleiben wie ed1e98cd", () => {
  const head = readFileSync("client/src/lib/fazit-signal.ts", "utf8");
  const main = execSync(`git show ${MAIN}:client/src/lib/fazit-signal.ts`, { encoding: "utf8" });
  const sliceBetween = (src: string, start: string, end: string) => {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i + start.length);
    assert.ok(i >= 0 && j > i, start);
    return src.slice(i, j);
  };
  assert.equal(
    sliceBetween(head, "if (score >= 4)", "const dcfMarketDivergence"),
    sliceBetween(main, "if (score >= 4)", "const dcfMarketDivergence"),
  );
  assert.equal(
    sliceBetween(head, "const isBuy = score >= 2 && techStatus?.buySignal && data.currentPrice <= dcfBeiCRV3;", "\n"),
    sliceBetween(main, "const isBuy = score >= 2 && techStatus?.buySignal && data.currentPrice <= dcfBeiCRV3;", "\n"),
  );
  assert.match(head, /else if \(techBear\.length >= 2\)/);
  assert.match(main, /else if \(techBear\.length >= 2\)/);
  const buy = "buySignal: priceAboveMA200 && ma50AboveMA200 && macdAboveZero && macdRising,";
  const route = readFileSync("server/analyze-route.ts", "utf8");
  const routeMain = execSync(`git show ${MAIN}:server/analyze-route.ts`, { encoding: "utf8" });
  assert.equal(route.includes(buy), true);
  assert.equal(routeMain.includes(buy), true);
  assert.equal(execSync(`git diff --numstat ${MAIN} -- server/analyze-route.ts`, { encoding: "utf8" }).trim(), "");
});

check("P3: void techBull ist entfernt, die Bären-Schwelle bleibt", () => {
  const src = readFileSync("client/src/lib/fazit-signal.ts", "utf8");
  assert.doesNotMatch(src, /void techBull/);
  assert.match(src, /const techBull: string\[\] = \[\]/);
  assert.match(src, /else if \(techBear\.length >= 2\)/);
});

check("S-02 Cache: SHEL roh nennt das Label der frischen Zahl, nicht das alte biasFix neben 58,55", () => {
  const shel = JSON.parse(readFileSync("script/fixtures/analysis-SHEL.L.json", "utf8"));
  const fresh = buildBiasDecision(shel);
  const fe = fazitEntryForExport(shel);
  assert.ok(fe);
  assert.equal(fe.fairValue, fresh.decisionPerShare);
  assert.notEqual(shel.biasFix.valuationBaseLabel, fresh.valuationBaseLabel);
  const lage = execLageFromFazit(shel);
  assert.ok(lage);
  const shown = fe.fairValue.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  assert.ok(lage.includes(`${fresh.valuationBaseLabel} sitzt bei ${shown}`), lage);
  assert.ok(!lage.includes(`${shel.biasFix.valuationBaseLabel} sitzt bei ${shown}`), lage);
  assert.ok(!lage.includes("49,45"), lage);
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
