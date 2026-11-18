/**
 * Zwei Events derselben Region mit demselben Titel behalten ihre eigenen Kartenfelder.
 * Die Zuordnung ist der Positionsindex der Quelle. Ohne eindeutigen Index: n/a mit Grund.
 * Run: npx tsx script/test-briefing-source-index.ts
 */
import {
  applyTopChangeQuota,
  selectRegionalEvents,
  type SourceEvent,
} from "../server/researcher-briefing-regional";
import { toBriefingKeyEvent } from "../shared/briefing-key-event";
import * as cards from "../shared/briefing-key-event";

const briefingCardForChange = cards.briefingCardForChange;
const DCF_SECTOR_HINT = cards.DCF_SECTOR_HINT;

let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  OK  ${name}`);
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const first: SourceEvent = {
  region: "US",
  sourceIndex: 0,
  title: "Fed",
  category: "Fiskalpolitik",
  severity: "high",
  timeframe: "2025-Q1",
  description: "erstes US-Fed",
  rationale: "erstes US-Fed",
  inflationImpact: "steigend",
  rateImpact: "steigend",
  equityImpact: "positiv",
  affectedSectors: ["Financials"],
};
const second: SourceEvent = {
  region: "US",
  sourceIndex: 1,
  title: "Fed",
  category: "Fiskalpolitik",
  severity: "low",
  timeframe: "2026-Q2",
  description: "zweites US-Fed",
  rationale: "zweites US-Fed",
  inflationImpact: "neutral",
  rateImpact: "fallend",
  equityImpact: "negativ",
  affectedSectors: ["Technology"],
};

const changes = applyTopChangeQuota(selectRegionalEvents([{
  region: "US",
  hasMacro: true,
  events: [first, second],
  prior: [],
  index: null,
}]));
const feds = changes.filter(c => c.region === "US" && c.title === "Fed");
ok("beide gleich betitelten Events bleiben", feds.length === 2, String(feds.length));
ok(
  "Positionsindex bleibt je Event erhalten",
  feds.some(c => c.sourceIndex === 0) && feds.some(c => c.sourceIndex === 1),
  feds.map(c => String(c.sourceIndex)).join(","),
);

const hasJoin = typeof briefingCardForChange === "function";
ok("Zuordnung ohne Titelvergleich ist exportiert", hasJoin);

if (hasJoin) {
  const card0 = briefingCardForChange(feds.find(c => c.sourceIndex === 0)!, [first, second]);
  const card1 = briefingCardForChange(feds.find(c => c.sourceIndex === 1)!, [first, second]);
  ok("erste Karte behält high und 2025-Q1", card0.severity === "high" && card0.timeframe === "2025-Q1", `${card0.severity} ${card0.timeframe}`);
  ok("zweite Karte behält low und 2026-Q2", card1.severity === "low" && card1.timeframe === "2026-Q2", `${card1.severity} ${card1.timeframe}`);
  ok("Begründungen bleiben getrennt", card0.rationale === "erstes US-Fed" && card1.rationale === "zweites US-Fed", `${card0.rationale} | ${card1.rationale}`);
  ok("Sektoren bleiben getrennt", card0.affectedSectors[0] === "Financials" && card1.affectedSectors[0] === "Technology", `${card0.affectedSectors[0]} | ${card1.affectedSectors[0]}`);
  ok("neutrales Impact der zweiten Karte bleibt neutral", card1.inflationImpact === "neutral");
  ok("Titelgleichheit nimmt nicht das erste Event", card1.affectedSectors[0] !== "Financials" && card1.rationale !== "erstes US-Fed");

  const missing = briefingCardForChange(
    { title: "Fed", category: "Fiskalpolitik", region: "US" },
    [first, second],
  );
  ok(
    "ohne Index n/a mit Grund",
    missing.severity.startsWith("n/a —")
      && missing.timeframe.startsWith("n/a —")
      && missing.rationale.startsWith("n/a —")
      && missing.inflationImpact.startsWith("n/a —")
      && missing.affectedSectors[0].startsWith("n/a —")
      && !missing.affectedSectors.includes("Financials")
      && !missing.affectedSectors.includes("Technology"),
    `${missing.severity} / ${missing.affectedSectors.join(",")}`,
  );

  const ambiguous = briefingCardForChange(
    { title: "Fed", category: "Fiskalpolitik", sourceIndex: 0 },
    [first, { ...second, sourceIndex: 0 }],
  );
  ok(
    "doppelter Index ist keine Zuordnung",
    ambiguous.severity.startsWith("n/a —")
      && ambiguous.rationale.startsWith("n/a —")
      && ambiguous.affectedSectors[0].startsWith("n/a —"),
    ambiguous.severity,
  );

  const fromDcf = briefingCardForChange(
    {
      title: "Fed",
      category: "Fiskalpolitik",
      sourceIndex: 0,
      dcfImplications: { affectedSectors: ["Defense"] },
    },
    [{ ...first, affectedSectors: [] }],
  );
  ok(
    "DCF-Sektoren tragen einen Herkunftshinweis",
    fromDcf.affectedSectors.includes("Defense") && fromDcf.affectedSectors.includes(DCF_SECTOR_HINT),
    fromDcf.affectedSectors.join(","),
  );
  const own = briefingCardForChange(feds.find(c => c.sourceIndex === 0)!, [first, second]);
  ok("eigene Sektoren bleiben ohne DCF-Hinweis", !own.affectedSectors.includes(DCF_SECTOR_HINT));
} else {
  ok("erste Karte behält high und 2025-Q1", false);
  ok("zweite Karte behält low und 2026-Q2", false);
  ok("Begründungen bleiben getrennt", false);
  ok("Sektoren bleiben getrennt", false);
  ok("ohne Index n/a mit Grund", false);
  ok("doppelter Index ist keine Zuordnung", false);
}

ok("direkter Mapper lässt echtes neutral", toBriefingKeyEvent({ title: "Fed", inflationImpact: "neutral" }).inflationImpact === "neutral");

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nsource index passed");
