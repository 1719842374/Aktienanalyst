/**
 * peerMaterial-Gate (Offen_WORK_PEER_PRICING_POWER.md).
 * Relativ nur score-wirksam bei Moat None/Narrow oder Rivalität hoch und |F|≥3.
 * Banner bei materialem, unvollständigem Peer-Set.
 *
 * Ausführen: npx tsx script/test-peer-material.ts
 */
import { buildGates } from "../server/scoring-gates";
import { buildScoringForAnalysis } from "../server/scoring-integration";
import {
  PEER_SET_INCOMPLETE_BANNER,
  assessPeerSet,
} from "../shared/peer-material";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const BANNER = "Peer-Set unvollständig — Relativ nicht score-wirksam.";

console.log("\n=== assessPeerSet ===");
{
  check("Banner-Text ist der Spec-Satz", PEER_SET_INCOMPLETE_BANNER === BANNER);

  const wideComplete = assessPeerSet({ moatRating: "Wide", peerCount: 5 });
  check("Wide, keine hohe Rivalität, 5 Peers → nicht material", wideComplete.peerMaterial === false);
  check("Wide + vollständig → kein Banner, Relativ aus", wideComplete.banner === null && wideComplete.relativeApplies === false);

  const wideRival = assessPeerSet({
    moatRating: "Wide",
    peerCount: 3,
    porterForces: [{ force: "Rivalität unter Wettbewerbern", rating: "Hoch", score: 5 }],
  });
  check("Wide + Rivalität Hoch + 3 Peers → material und score-wirksam", wideRival.peerMaterial && wideRival.relativeApplies && wideRival.banner === null);

  const wideRivalEn = assessPeerSet({
    moatRating: "Wide",
    peerCount: 4,
    porterForces: [{ name: "Rivalry among competitors", rating: "High", score: 4 }],
  });
  check("Englisches High-Rating zählt als Rivalität hoch", wideRivalEn.relativeApplies === true);

  const narrowShort = assessPeerSet({
    moatRating: "Narrow",
    peerCount: 2,
    porterForces: [{ force: "Rivalität unter Wettbewerbern", rating: "Mittel", score: 3 }],
  });
  check("Narrow + 2 Peers → Banner, Relativ aus", narrowShort.peerMaterial && !narrowShort.relativeApplies && narrowShort.banner === BANNER);

  const noneEmpty = assessPeerSet({ moatRating: "None", peerCount: 0 });
  check("None + 0 Peers → Banner", noneEmpty.banner === BANNER && noneEmpty.relativeApplies === false);

  const noneFull = assessPeerSet({ moatRating: "none", peerCount: 3 });
  check("None (klein) + 3 Peers → Relativ an, kein Banner", noneFull.relativeApplies && noneFull.banner === null);

  const wideIncomplete = assessPeerSet({
    moatRating: "Wide",
    peerCount: 1,
    porterForces: [{ force: "Rivalität unter Wettbewerbern", rating: "Niedrig", score: 2 }],
  });
  check("Wide + niedrige Rivalität + 1 Peer → kein Banner (nicht material)", wideIncomplete.banner === null && wideIncomplete.relativeApplies === false);

  const scoreOnly = assessPeerSet({
    moatRating: "Wide",
    peerCount: 3,
    porterForces: [{ force: "Rivalität unter Wettbewerbern", rating: "Mittel", score: 4 }],
  });
  check("Threat-Score ≥ 4 ist Rivalität hoch, auch wenn das Label Mittel ist", scoreOnly.peerMaterial === true && scoreOnly.relativeApplies === true);
}

console.log("\n=== buildGates: Flag aus lässt das bisherige Modell ===");
{
  const gates = buildGates({
    impliedGrowthPercent: 4,
    realizedGrowth8QPercent: 2,
    marginDeltaYoYPp: 0,
    relativeGrowthDeltaYoYPp: -4,
    inventoryDaysDeltaYoYPct: null,
  });
  const rg = gates.find(g => g.id === "RELATIVE_GROWTH")!;
  check("ohne relativeScoreApplies bleibt RELATIVE_GROWTH aktiv", rg.active === true);
  const pp = gates.find(g => g.id === "PRICING_POWER")!;
  check("PRICING_POWER-Formel unberührt (Marge stabil → aus)", pp.active === false && pp.cap === 55);
}

console.log("\n=== buildGates: peerMaterial-Gate schaltet RELATIVE_GROWTH aus ===");
{
  const inputs = {
    impliedGrowthPercent: 4,
    realizedGrowth8QPercent: 2,
    marginDeltaYoYPp: -3,
    relativeGrowthDeltaYoYPp: -4.5,
    inventoryDaysDeltaYoYPct: null,
    relativeScoreApplies: false as const,
  };
  const gates = buildGates(inputs);
  const rg = gates.find(g => g.id === "RELATIVE_GROWTH")!;
  const pp = gates.find(g => g.id === "PRICING_POWER")!;
  check("RELATIVE_GROWTH inaktiv trotz schwachem 8Q und Share-Loss", rg.active === false);
  check("Begründung nennt peerMaterial", rg.rationale.includes("peerMaterial"), rg.rationale);
  check("PRICING_POWER bleibt bei Margenbruch aktiv", pp.active === true && pp.cap === 55);
}

console.log("\n=== buildScoringForAnalysis reicht das Flag durch ===");
{
  const base = {
    ctx: {
      impliedGStar: 4,
      quarterlyRevenueChronological: null as number[] | null,
      annualIncome: null,
      annualBalance: null,
      subjectRevenueGrowth: 2,
      peerRevenueGrowths: [8, 9, 10],
    },
    health: "Good",
    moatRating: "Narrow",
    technicalIndicators: null,
    catalysts: [],
    price: 100,
    asOfDate: "2026-01-01",
  };
  const off = buildScoringForAnalysis({ ...base, ctx: { ...base.ctx, relativeScoreApplies: false } });
  const on = buildScoringForAnalysis({ ...base, ctx: { ...base.ctx, relativeScoreApplies: true } });
  const legacy = buildScoringForAnalysis(base);
  const rg = (r: typeof off) => r.gates.find(g => g.id === "RELATIVE_GROWTH");
  check("Delta bleibt sichtbar, auch wenn das Gate zu ist", off.gateInputs.relativeGrowthDeltaYoYPp != null && off.gateInputs.relativeGrowthDeltaYoYPp < 0, String(off.gateInputs.relativeGrowthDeltaYoYPp));
  check("relativeApplies false → Gate aus", rg(off)?.active === false && off.gateInputs.relativeScoreApplies === false);
  check("relativeApplies true + Share-Loss → Gate an", rg(on)?.active === true);
  check("Aufrufer ohne Flag behält das alte Verhalten", rg(legacy)?.active === true);
}

console.log(failed === 0 ? "\n✅ peerMaterial-Tests bestanden" : `\n❌ ${failed} Test(s) fehlgeschlagen`);
process.exit(failed === 0 ? 0 : 1);
