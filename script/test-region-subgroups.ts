/**
 * F1-52 / F1-47 — five subgroup gauges per region, display only.
 * EZ/JP get Rez 3M/6M/12M and Korr 3-6M/12M from their own slots. n/a carries a reason.
 * US region, weights and the 0.70/0.20/0.10 blend stay byte-identical to main 73eff97e.
 * Run: npx tsx script/test-region-subgroups.ts
 */
import { readFileSync } from "node:fs";
import * as shared from "../shared/recession-regions";
import { emptyRegionalPrints, scoreRegionalCatalogs, type RegionScorers } from "../server/recession-regions";
import { capeReading, creditReading, durableReading, m2Reading, scoreSeriesStress, vixReading } from "../server/recession";
import type { DatedPoint, RegionSlot } from "../shared/recession-regions";

let failed = 0;
let total = 0;
function check(name: string, condition: boolean, detail = "") {
  total++;
  if (condition) console.log(`  ✅ ${name}`);
  else { failed++; console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const TODAY = "2026-10-04";
function months(start: string, count: number, valueAt: (i: number) => number): DatedPoint[] {
  const [y, m] = start.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return { date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`, value: valueAt(i) };
  });
}
const scorers: RegionScorers = {
  money: yoy => m2Reading(yoy),
  credit: spread => creditReading(spread),
  vol: level => vixReading(level),
  valuation: ratio => capeReading(ratio),
  activity: yoy => { const r = durableReading(yoy); return { rawScore: r.rawScore, zone: r.zone }; },
  curve: (levels, low) => { const s = scoreSeriesStress(low ? levels.map(v => -v) : levels); return { available: s.available, raw: s.raw }; },
};
const usSlot = (id: RegionSlot["id"], name: string, book: RegionSlot["book"], ws: number, max: number, available = true): RegionSlot => ({
  id, name, book, value: available ? "v" : "N/A", rawScore: ws, weight: available ? 1 : 0, weightedScore: available ? ws : 0,
  maxWeighted: available ? max : 0, zone: "z", source: "src", available,
});
const usSlots: RegionSlot[] = [
  usSlot("labor", "Sahm-Regel", "recession", -3, 4),
  usSlot("curve", "Zinskurve", "recession", 2, 4),
  usSlot("activity", "Aktivität", "recession", -1, 3),
  usSlot("money", "M2", "recession", 1, 3),
  usSlot("spreads", "Kredit", "recession", -2, 3),
  usSlot("valuation", "Buffett", "correction", 3, 4),
  usSlot("valuation", "CAPE", "correction", 3, 4),
  usSlot("vol", "VIX", "correction", -1, 3, false),
];
const curve = months("2006-01", 240, i => 1 + Math.sin(i / 7));
const input = {
  prints: {
    ...emptyRegionalPrints(),
    ezUnemployment: { geo: "EA20", points: months("2025-01", 20, () => 6.4) },
    ezLong: curve.map(p => ({ ...p, value: p.value + 1.5 })),
    ezShort: curve,
    ezIp: { geo: "EA20", points: [{ date: "2025-08-01", value: 100 }, { date: "2026-08-01", value: 97.6 }] },
    ezM3Yoy: null,
    ezHy: 3.54,
    ezPe: 18.49,
    ezPeSource: "iShares EXSA KGV 2026-10-23",
    ezVol: 21.9,
    jpUnemployment: months("2025-01", 20, () => 2.5),
    jpLong: curve,
    jpIp: [{ date: "2025-04-01", value: 95 }, { date: "2026-04-01", value: 93.4 }],
    jpM2Yoy: 2,
  },
  usSlots,
  usRecession12m: 40,
  usCorrection12m: 55,
  today: TODAY,
  scorers,
};

console.log("\n=== US region, weights and blend byte-identical to main 73eff97e ===");
const catalogs = scoreRegionalCatalogs(input);
const usSnapshot = JSON.stringify({
  us: catalogs.regions.find(r => r.id === "US"),
  weights: catalogs.weights,
  blendedRecession12m: catalogs.blendedRecession12m,
  blendedCorrection12m: catalogs.blendedCorrection12m,
  ezCatalog: [catalogs.regions[1].recessionProbability, catalogs.regions[1].correctionProbability],
  jpCatalog: [catalogs.regions[2].recessionProbability, catalogs.regions[2].correctionProbability],
  action: catalogs.actionUsesUsBooks,
});
// Captured on main 73eff97e with this exact input.
const MAIN_SNAPSHOT = String.raw`{"us":{"id":"US","label":"USA","weight":0.7,"slots":[{"id":"labor","name":"Sahm-Regel","book":"recession","value":"v","rawScore":-3,"weight":1,"weightedScore":-3,"maxWeighted":4,"zone":"z","source":"src","available":true},{"id":"curve","name":"Zinskurve","book":"recession","value":"v","rawScore":2,"weight":1,"weightedScore":2,"maxWeighted":4,"zone":"z","source":"src","available":true},{"id":"activity","name":"Aktivität","book":"recession","value":"v","rawScore":-1,"weight":1,"weightedScore":-1,"maxWeighted":3,"zone":"z","source":"src","available":true},{"id":"money","name":"M2","book":"recession","value":"v","rawScore":1,"weight":1,"weightedScore":1,"maxWeighted":3,"zone":"z","source":"src","available":true},{"id":"spreads","name":"Kredit","book":"recession","value":"v","rawScore":-2,"weight":1,"weightedScore":-2,"maxWeighted":3,"zone":"z","source":"src","available":true},{"id":"valuation","name":"Buffett","book":"correction","value":"v","rawScore":3,"weight":1,"weightedScore":3,"maxWeighted":4,"zone":"z","source":"src","available":true},{"id":"valuation","name":"CAPE","book":"correction","value":"v","rawScore":3,"weight":1,"weightedScore":3,"maxWeighted":4,"zone":"z","source":"src","available":true},{"id":"vol","name":"VIX","book":"correction","value":"N/A","rawScore":-1,"weight":0,"weightedScore":0,"maxWeighted":0,"zone":"z","source":"src","available":false}],"recessionProbability":40,"correctionProbability":90},"weights":{"US":0.7,"EZ":0.2,"JP":0.1},"blendedRecession12m":40,"blendedCorrection12m":55,"ezCatalog":[45,55],"jpCatalog":[40,null],"action":true}`;
check("US + aggregate snapshot equals main", usSnapshot === MAIN_SNAPSHOT, `\n got  ${usSnapshot}\n want ${MAIN_SNAPSHOT}`);
check("server payload has no new key on regions", catalogs.regions.every(r => Object.keys(r).join() === "id,label,weight,slots,recessionProbability,correctionProbability"));

console.log("\n=== Five subgroups for EZ and JP ===");
const view = (shared as Record<string, unknown>).regionGaugeView as typeof shared.regionGaugeView;
const KEYS = ["rez3m", "rez6m", "rez12m", "korr3_6m", "korr12m"];
for (const id of ["EZ", "JP"] as const) {
  const v = view(catalogs, id) as (ReturnType<typeof shared.regionGaugeView> & { subgroups?: shared.RegionSubgroup[] }) | null;
  const groups = v?.subgroups ?? [];
  check(`${id} has 5 subgroups in order`, groups.map(g => g.key).join() === KEYS.join(), groups.map(g => g.key).join());
  const region = catalogs.regions.find(r => r.id === id)!;
  const by = (k: string) => groups.find(g => g.key === k);
  check(`${id} Rez 12M equals catalog recession P`, by("rez12m")?.probability === region.recessionProbability);
  check(`${id} Korr 12M equals catalog correction P`, by("korr12m")?.probability === region.correctionProbability);
  for (const g of groups) {
    if (g.probability == null) check(`${id} ${g.key} n/a has a reason`, typeof g.note === "string" && g.note.startsWith("n/a:"), String(g.note));
    else check(`${id} ${g.key} = bookProbability(net,max)`, g.probability === shared.bookProbability(g.net, g.max));
  }
}
const ez = view(catalogs, "EZ") as any;
const jp = view(catalogs, "JP") as any;
const ez3 = ez?.subgroups?.find((g: any) => g.key === "rez3m");
check("EZ Rez 3M uses only labor/curve/activity", ez3 && ez3.scoredNames.join() === "ALQ Eurozone,Kurve EZ (10J−3M),Aktivität EZ", ez3?.scoredNames?.join());
const ez6 = ez?.subgroups?.find((g: any) => g.key === "rez6m");
check("EZ Rez 6M leaves M3 (null) out of net and max", ez6 && !ez6.scoredNames.includes("Geld EZ M3") && ez6.scoredNames.includes("Spreads EZ HY"));
const jpK = jp?.subgroups?.find((g: any) => g.key === "korr3_6m");
check("JP Korr 3-6M is n/a with JNVI reason", jpK?.probability === null && /JNVI/.test(jpK?.note ?? ""), jpK?.note);
const jpK12 = jp?.subgroups?.find((g: any) => g.key === "korr12m");
check("JP Korr 12M is n/a (no PE, no vol), nothing invented", jpK12?.probability === null && jpK12?.note?.startsWith("n/a:"), jpK12?.note);
check("view does not mutate catalogs", JSON.stringify(scoreRegionalCatalogs(input)) === JSON.stringify(catalogs));

console.log("\n=== UI renders the five gauges with n/a reason ===");
const ui = readFileSync("client/src/components/recession/RegionGaugeSwitch.tsx", "utf8");
check("UI maps view.subgroups", /view\.subgroups\.map/.test(ui));
check("UI gauge testid per subgroup", /region-subgroup-\$\{group\.key\}/.test(ui));
check("UI n/a shows the note", /\{note \?\? "kein gewerteter Slot"\}/.test(ui));
check("US keeps CurrentAssessment", /<CurrentAssessment data=\{data\} \/>/.test(ui));

console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
