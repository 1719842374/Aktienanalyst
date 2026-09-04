/** npx tsx script/test-factpack-validate.ts */
import {
  buildFactPackFromFactSet,
  extractClaims,
  validateTextAgainstFactPack,
} from "../server/factpack-validate";

function assert(c: boolean, m: string) {
  if (!c) throw new Error(m);
}

const pack = buildFactPackFromFactSet({
  ticker: "NBIS",
  actualRevenue: 582.3e6,
  consensusRevenue: 500e6,
  actualEps: 0.44,
  consensusEps: 0.29,
});

const good = validateTextAgainstFactPack(
  "Umsatz von 582,3 Mio. USD im Quartal. Adjusted EPS lag bei $0.44.",
  pack,
);
assert(good.ok, `expected ok, checks=${JSON.stringify(good.checks)}`);
assert(good.droppedSentences.length === 0, "no drop");

const bad = validateTextAgainstFactPack(
  "Umsatz von 9,1 Mrd. USD im Quartal. Das ist erfunden.",
  pack,
);
assert(!bad.ok, "9.1bn must fail");
assert(bad.droppedSentences.length >= 1, "drop invented revenue");
assert(bad.cleanedText.includes("erfunden") || bad.cleanedText.length > 0, "keep other or original");

const claims = extractClaims("Barmittel 8.042,1 Mio. USD und EPS $0.15 Beat.");
assert(claims.length >= 2, `claims ${claims.length}`);

const empty = validateTextAgainstFactPack("Hallo Welt", { ticker: "X", source: "empty", asOf: "2026-09-04", facts: [] });
assert(empty.available === false && empty.ok, "empty pack passthrough");

console.log("test-factpack-validate: ok");
