/**
 * W5: Technik/RSL sind im Signal-Score nur weiche Hinweise (fertig_WORK_BIAS_FIXES_INVERSE_DCF.md §6),
 * und das PDF-Fazit nutzt dieselbe Logik wie die App (kein eigener PDF-Zähler mehr). Generisch, kein Ticker.
 * Run: npx tsx script/test-fazit-ta-soft.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { prepareFazitMetrics, buildFazitSignal, TIMING_PREFIX } from "../client/src/lib/fazit-signal";
import { generateAnalysisHTML } from "../server/pdf-export";

delete process.env.ANTHROPIC_API_KEY;
const d = JSON.parse(readFileSync("script/fixtures/analysis-MSFT.json", "utf8"));
const m = prepareFazitMetrics(d);
const sig = (data: any) => buildFazitSignal({ data, ...m });
const base = sig(d);
for (const x of [...base.positive, ...base.negative]) assert.ok(!/^Timing|^Technisch|^RSL/.test(x), `Technik zählt nicht: ${x}`);

// Technik-Status umdrehen: Signal-Score darf sich NICHT ändern (vorher ±1 je Technik/RSL).
const flipped = structuredClone(d);
const cs = flipped.technicalIndicators?.currentStatus;
assert.ok(cs, "fixture hat technicalIndicators.currentStatus");
for (const k of ["priceAboveMA200", "ma50AboveMA200", "macdAboveZero", "macdRising", "buySignal"]) cs[k] = !cs[k];
const f2 = buildFazitSignal({ data: flipped, ...m, rsl: m.rsl != null ? (m.rsl > 110 ? 90 : 120) : null });
assert.equal(f2.score, base.score, "Signal-Score unabhängig vom Technik-Status");
assert.ok(f2.neutral.some(x => x.startsWith(TIMING_PREFIX)), "Technik bleibt als Hinweis sichtbar");

(async () => {
  const html = await generateAnalysisHTML(d);
  const v = html.match(/FAZIT: ([^<]+)</)?.[1];
  assert.equal(v, `${m.bias.overallRating} · ${base.rating}`, "PDF-Fazit = App (Gesamtscore · Signal)");
  assert.match(html, /data-testid="pdf-gesamtscore"/);
  assert.ok(html.includes(`${base.positive.length} positiv / ${base.negative.length} negativ / ${base.neutral.length} neutral`), "PDF-Zähler = App-Zähler");
  console.log("test-fazit-ta-soft: OK", v);
})().catch(e => { console.error(e); process.exit(1); });
