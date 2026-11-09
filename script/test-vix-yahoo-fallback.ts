import assert from "node:assert/strict";
import { crowdReading, resolveVixLevel, vixReading } from "../server/recession";

const yahoo = (closes: Array<number | null>) => () => ({
  chart: { result: [{ timestamp: closes.map((_, i) => 1760000000 + i * 86400), indicators: { quote: [{ close: closes }] } }] },
});

let yahooCalls = 0;
const fred = resolveVixLevel(18.4, () => { yahooCalls++; return null; });
assert.equal(fred.value, 18.4);
assert.equal(fred.source, "FRED VIXCLS");
assert.equal(yahooCalls, 0, "Yahoo must not be called when FRED is finite");

const fb = resolveVixLevel(NaN, yahoo([21.2, null, 32.5]));
assert.equal(fb.value, 32.5);
assert.match(fb.source, /^Yahoo \^VIX \d{4}-\d{2}-\d{2} \(Fallback/);
const r = vixReading(fb.value, fb.source);
assert.equal(r.rawScore, 4);
assert.equal(r.maxWeighted, 4);
assert.equal(r.source, fb.source);

const none = resolveVixLevel(NaN, () => ({ chart: { result: [] } }));
assert.ok(Number.isNaN(none.value));
const closed = vixReading(none.value, none.source);
assert.equal(closed.available, false);
assert.equal(closed.maxWeighted, 0);

const bad = resolveVixLevel(NaN, () => "garbage");
assert.ok(Number.isNaN(bad.value));

assert.equal(vixReading(16).source, "FRED VIXCLS");
assert.equal(vixReading(16).rawScore, 0);
const crowdFb = crowdReading(null, fb.value, false, fb.source);
assert.equal(crowdFb.name, "VIX-Proxy");
assert.equal(crowdFb.source, fb.source);
assert.match(crowdFb.source, /^Yahoo \^VIX/);
assert.equal(crowdReading(null, 18, false).source, "FRED VIXCLS");
assert.equal(crowdReading(65, 18, false).source, "CNN Fear & Greed (Live)");
console.log("test-vix-yahoo-fallback: OK");
