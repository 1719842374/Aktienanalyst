/**
 * Drei signifikante Stellen und Rangfolge. Kein Netz.
 *   env -u FMP_API_KEY -u FRED_API_KEY -u RENDER_API_KEY -u OPENROUTER_API_KEY npx tsx --tsconfig script/tsconfig.jsx.json script/test-ki-podcast-rounding.ts
 */
import assert from "node:assert/strict";
import { rankAfterRounding, roundSig, speakIsoDate, speakPercent, speakRounded } from "../shared/podcast-speak";

let n = 0;
const ok = (name: string) => { n++; console.log(`  ✅ ${name}`); };

assert.equal(roundSig(149, 3), 149);
assert.equal(roundSig(52.76, 3), 52.8);
assert.equal(roundSig(3.472, 3), 3.47);
assert.equal(roundSig(1000, 3), 1000);
ok("Kurs, fair und Entry auf drei signifikante Stellen");

assert.equal(speakPercent(11.4), "elf Komma vier Prozent");
assert.equal(speakRounded(149, 3), "einhundertneunundvierzig");
assert.equal(speakRounded(52.8, 3), "zweiundfünfzig Komma acht");
assert.equal(speakIsoDate("2027-02-24"), "vierundzwanzigster Februar zweitausendsiebenundzwanzig");
ok("Sprechform für Prozent, Betrag und Datum");

const kept = rankAfterRounding({ price: 149, entry: 120, fair: 130, low: 110, high: 140 });
assert.equal(kept.ok, true);
assert.equal(kept.sig, 3);
ok("Rangfolge bleibt nach drei Stellen erhalten");

const widened = rankAfterRounding({ price: 2.001, entry: 2.004, fair: null, low: null, high: null });
assert.equal(widened.ok, true);
assert.equal(widened.sig, 4);
assert.equal(roundSig(2.001, 3), roundSig(2.004, 3));
assert.notEqual(roundSig(2.001, 4), roundSig(2.004, 4));
ok("Gleichstand bei drei Stellen wird einmal mit vier Stellen gesprochen");

const stuck = rankAfterRounding({ price: 1.0001, entry: 1.0002, fair: null, low: null, high: null });
assert.equal(stuck.ok, false);
assert.equal(roundSig(1.0001, 4), roundSig(1.0002, 4));
ok("Bleibt der Gleichstand, fällt der Satz zur Reihenfolge weg");

console.log(`ki-podcast rounding: ${n} checks ok`);
