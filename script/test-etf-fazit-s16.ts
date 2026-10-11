/**
 * ETF/Fonds: Reverse DCF raus aus Fazit-Faktorliste, Sektion 16 und Matrix-Zelle (Live-FAIL #222, SPY).
 * Fixtures: live /api/analyze SPY + MSFT (11.10.2026), trimmed in script/fixtures/analysis-{SPY,MSFT}.json (override: ANALYSIS_FIXTURE_DIR).
 * Run: npx tsx script/test-etf-fazit-s16.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { prepareFazitMetrics, buildFazitSignal } from "../client/src/lib/fazit-signal";
import { conflictMatrixFromAnalysis, ETF_RDCF_NOTE, isEtfOrFund } from "../shared/conflict-matrix";

const dir = process.env.ANALYSIS_FIXTURE_DIR ?? "script/fixtures";
function run(t: string, strip: boolean) {
  const d = JSON.parse(readFileSync(`${dir}/analysis-${t}.json`, "utf8"));
  if (strip) { delete d.isEtf; delete d.isFund; }
  const m = prepareFazitMetrics(d);
  const f = buildFazitSignal({ data: d, ...m });
  const rd = [...f.positive, ...f.neutral, ...f.negative].filter(x => x.startsWith("Reverse-DCF"));
  return { f, rd, d };
}
assert.ok(existsSync(`${dir}/analysis-SPY.json`) && existsSync(`${dir}/analysis-MSFT.json`), "fixtures missing (script/fixtures/analysis-{SPY,MSFT}.json)");
const rows: string[] = [];
for (const t of ["SPY", "MSFT"]) {
  const before = run(t, true), after = run(t, false);
  rows.push(`| ${t} | ${before.rd.join("; ")} | ${before.f.score} ${before.f.rating} | ${after.rd.join("; ")} | ${after.f.score} ${after.f.rating} | server finalScore ${after.d.scoring?.finalScore} |`);
  assert.equal(before.f.score, after.f.score, `${t}: Fazit-Score unverändert`);
  assert.equal(before.f.rating, after.f.rating, `${t}: Rating unverändert`);
  assert.equal(after.f.score, t === "SPY" ? -6 : -1, `${t}: fixture score pinned (W5: RSL/Technik weich, nicht gezählt)`);
  if (t === "SPY") {
    assert.ok(isEtfOrFund(after.d));
    assert.deepEqual(after.rd, [`Reverse-DCF ${ETF_RDCF_NOTE}`]);
    assert.ok(after.f.neutral.includes(`Reverse-DCF ${ETF_RDCF_NOTE}`));
    const cell = conflictMatrixFromAnalysis(after.d, null as any).cells.find((c: any) => c.id === "reverseDcf")!;
    assert.equal(cell.value, ETF_RDCF_NOTE); assert.equal(cell.signal, "n/a");
  } else {
    assert.deepEqual(after.rd, before.rd, "MSFT: Reverse-DCF-Faktor identisch");
    assert.match(after.rd[0], /g\* /);
  }
}
const s16 = readFileSync("client/src/components/sections/ReverseDCFSection.tsx", "utf8");
assert.match(s16, /if \(isEtfOrFund\(data\)\)/); assert.match(s16, /reverse-dcf-etf-na/);
console.log("| Ticker | Fazit-Faktor vorher | Score/Rating vorher | Fazit-Faktor nachher | Score/Rating nachher | Server |\n|---|---|---|---|---|---|\n" + rows.join("\n"));
console.log("test-etf-fazit-s16: OK");
