/**
 * F1-14/F1-17/F1-18 (Future_1_Work §11.1): Dividendenrendite in Section 6/20 + 4-%-Band — nur Anzeige.
 * Fixtures: script/fixtures/dividend-kpi-live.json (KO, NVO, AMZN), script/fixtures/analysis-MSFT.json.
 * Beweis: buildBiasDecision (Gesamtscore/Rating) und data.scoring sind vor/nach Anzeige-Berechnung deepEqual.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dividendOverlaySeries } from "../shared/dividends";
import { dividendYieldRange, dividendSummaryNote, DIVIDEND_ATTRACTIVE_PCT } from "../shared/dividend-valuation";
import { buildBiasDecision } from "../shared/bias-fixes";

(async () => {
  let pass = 0;
  const ok = (name: string, fn: () => void) => { fn(); pass++; console.log(`✓ ${name}`); };
  const live = JSON.parse(readFileSync("script/fixtures/dividend-kpi-live.json", "utf8"));

  ok("Schwelle 4 %", () => assert.equal(DIVIDEND_ATTRACTIVE_PCT, 4));

  ok("KO: Spanne aus Overlay-Serie, aktuell = letzter TTM-Punkt", () => {
    const pts = dividendOverlaySeries(live.KO.bars, live.KO.dividends.events).points;
    const r = dividendYieldRange(pts)!;
    assert.ok(r);
    const last = pts.filter(p => p.yieldPct != null).at(-1)!;
    assert.equal(r.current, last.yieldPct);
    assert.ok(r.min <= r.median && r.median <= r.max);
    assert.ok(r.percentile >= 0 && r.percentile <= 100);
    assert.equal(r.samples, pts.filter(p => p.yieldPct != null).length);
    console.log("  KO", JSON.stringify(r));
  });

  ok("AMZN ohne Dividende → null, kein Hinweis", () => {
    const pts = dividendOverlaySeries(live.AMZN.bars, live.AMZN.dividends.events ?? []).points;
    assert.equal(dividendYieldRange(pts), null);
    assert.equal(dividendSummaryNote(null), null);
  });

  const mk = (vals: number[]) => vals.map((v, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, yieldPct: v, ttmDividend: null, rawYieldPct: null, droppedExDates: [], specialExDates: [] }));
  ok("Hinweis bei ≥ 4 %", () => {
    const n = dividendSummaryNote(dividendYieldRange(mk([3.5, 4.5, 4.0, 4.2]))!);
    assert.match(n!, /≥ 4 %/);
    assert.match(n!, /kein Score-Einfluss/);
  });
  ok("Hinweis am Rand der Historie (P≤20)", () => assert.match(dividendSummaryNote(dividendYieldRange(mk([3, 3.2, 3.1, 3.3, 2.0]))!)!, /unteres Fünftel/));
  ok("kein Hinweis bei unauffälliger Rendite", () => assert.equal(dividendSummaryNote(dividendYieldRange(mk([2, 3, 2.6, 2.4, 2.5]))!), null));
  ok("null-Punkte werden ignoriert, <2 Werte → null", () => {
    assert.equal(dividendYieldRange([{ ...mk([1])[0], yieldPct: null }, ...mk([2])]), null);
  });

  ok("Score/Rating identisch (deepEqual) — MSFT + Varianten mit Dividende 0 / 4.5 / 8 %", () => {
    const base = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
    for (const dy of [base.dividendYield, 0, 4.5, 8]) {
      const data = { ...base, dividendYield: dy };
      const snap = JSON.stringify(data);
      const before = buildBiasDecision(data);
      const scoringBefore = structuredClone(data.scoring ?? null);
      const pts = dividendOverlaySeries(data.historicalPrices, live.KO.dividends.events).points;
      dividendSummaryNote(dividendYieldRange(pts));
      assert.equal(JSON.stringify(data), snap, "Anzeige-Helfer mutiert Analyse nicht");
      assert.deepEqual(buildBiasDecision(data), before);
      assert.deepEqual(data.scoring ?? null, scoringBefore);
    }
  });

  console.log(`\n${pass} passed`);
})().catch(e => { console.error(e); process.exit(1); });
