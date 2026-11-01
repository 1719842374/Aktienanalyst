/** S17-Polish (#278-Folgejob a–d). Run: npx tsx script/test-s17-event-polish.ts — auf main (b0d07c8e) muss es mit Exit 1 scheitern. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ev: any = await import("../shared/catalyst-event");
const { eventToCatalyst, validateCatalystEventImpact } = ev;
assert.equal(typeof ev.catalystDisplayName, "function", "catalystDisplayName fehlt");
assert.equal(typeof ev.formatSignedPct, "function", "formatSignedPct fehlt");
const mk = (deltaPct: number, pos: number) => eventToCatalyst((validateCatalystEventImpact({ name: "E", variable: "umsatz", deltaPct, horizonMonths: 6, pos, einpreisungsgrad: 0 }) as any).impact);

// (a) ▲ und ▼ tragen dieselbe Kennung „(Event)“, normale Katalysatoren nicht
assert.equal(ev.catalystDisplayName(mk(20, 70)), "E (Event)");
assert.equal(ev.catalystDisplayName(mk(-15, 60)), "E (Event)");
assert.equal(ev.catalystDisplayName({ name: "Cloud", tags: [] }), "Cloud");
const cs = readFileSync("client/src/components/sections/CatalystsSection.tsx", "utf8");
const s2 = readFileSync("client/src/components/sections/Section2.tsx", "utf8");
const s20 = readFileSync("client/src/components/sections/SummarySection.tsx", "utf8");
assert.match(s2, /catalystDisplayName\(c\)/, "S6-Katalysator-Tabelle (Section2.tsx) ohne Event-Kennung");
assert.match(s20, /catalystDisplayName\(c\)/, "S20 Catalyst Summary ohne Event-Kennung");
assert.match(cs, /USER_EVENT_SUFFIX\.trim\(\)/, "S17 ▲ ohne „(Event)“");

// (b) Vorzeichen: nie „+-“
assert.equal(ev.formatSignedPct(-15, 1), "-15.0%");
assert.equal(ev.formatSignedPct(15, 1), "+15.0%");
assert.equal(ev.formatSignedPct(-15, 2), "-15.00%");
assert.equal(ev.formatSignedPct(0, 1), "0.0%");
assert.equal(ev.formatSignedPct(NaN, 1), "n/a");
assert.doesNotMatch(s2, /\+\{formatNumber\(c\.(bruttoUpside|nettoUpside)/, "S6 hängt noch fest „+“ vor Brutto/Netto");

// (c) echte Labels mit htmlFor ↔ id
const ids = ["catalyst-event-text", "catalyst-event-name", "catalyst-event-variable", "catalyst-event-delta", "catalyst-event-horizon", "catalyst-event-pos", "catalyst-event-einpreisung"];
for (const id of ids) assert.ok(cs.includes(`"${id}"`), `Feld-ID ${id} fehlt`);
assert.match(cs, /<label htmlFor="catalyst-event-text"/);
assert.match(cs, /<label htmlFor=\{f\.id\}/);
assert.match(cs, /<(input|select) id=\{f\.id\}/);
assert.match(cs, /grid-cols-2 sm:grid-cols-3/, "375 px: 2 Spalten");

// (d) ignorierte ▼-Events entfernbar
assert.match(cs, /setIgnoredEvents\(prev => prev\.filter\(\(_, j\) => j !== i\)\)/);
assert.match(cs, /button-catalyst-event-remove-\$\{i\}/);
assert.ok(ev.isDownsideEventBelowThreshold(mk(-15, 50)) && !ev.isDownsideEventBelowThreshold(mk(-15, 60)), "Schwelle unverändert");

// Kein Scoring-Eingriff: Formel unverändert
assert.equal(mk(20, 70).gb, 14);
console.log("OK test-s17-event-polish (a–d)");
