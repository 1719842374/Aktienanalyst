/**
 * B2 — Gold Fair-Value corridor label layout.
 * Pure layout checks (no DOM): close levels stay readable, spread levels stay
 * on one row, and a full pile never drops a price or overlaps a lane.
 *
 * Ausführen: npx tsx script/test-gold-fv-label-layout.ts
 */
import {
  CORRIDOR_LABEL_GAP_PX,
  CORRIDOR_LABEL_MAX_LANES,
  clampLabelCenterPx,
  layoutCorridorLabels,
  type CorridorLevelInput,
  type PlacedCorridorLabel,
} from "../client/src/components/gold/GoldFairValueSection";

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ✅ ${name}`);
  else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function levels(rows: Array<[string, number, string]>): CorridorLevelInput[] {
  const color: Record<string, string> = {
    S2: "text-red-400",
    S1: "text-red-400",
    FV: "text-amber-500",
    R1: "text-emerald-400",
    R2: "text-emerald-400",
  };
  return rows.map(([tag, pct, price]) => ({
    id: tag,
    tag,
    pct,
    priceLabel: price,
    colorClass: color[tag] ?? "text-foreground",
  }));
}

function sameLaneOverlap(placed: PlacedCorridorLabel[], width: number): string | null {
  const byLane = new Map<number, PlacedCorridorLabel[]>();
  for (const label of placed) {
    const lane = byLane.get(label.lane) ?? [];
    lane.push(label);
    byLane.set(label.lane, lane);
  }
  for (const [lane, labels] of byLane) {
    const sorted = [...labels].sort((a, b) => a.leftPct - b.leftPct);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const prevRight = (prev.leftPct / 100) * width + prev.widthPx / 2;
      const currLeft = (curr.leftPct / 100) * width - curr.widthPx / 2;
      if (currLeft < prevRight + CORRIDOR_LABEL_GAP_PX - 0.51) {
        return `lane ${lane}: "${prev.text}" overlaps "${curr.text}"`;
      }
    }
  }
  return null;
}

function tagsOf(placed: PlacedCorridorLabel[]): string[] {
  return placed.flatMap((label) => label.tooltip.split("\n").map((line) => line.split(":")[0]));
}

const spread = levels([
  ["S2", 5.2, "$3080"],
  ["S1", 37.7, "$4050"],
  ["FV", 51.7, "$4467"],
  ["R1", 67.9, "$4950"],
  ["R2", 90.6, "$5625"],
]);

console.log("\nSpread-out corridor (fallback-like) — one row, original texts");
{
  for (const width of [800, 1100]) {
    const placed = layoutCorridorLabels(spread, width);
    const overlap = sameLaneOverlap(placed, width);
    check(`width ${width} all lane 0`, placed.every((label) => label.lane === 0), JSON.stringify(placed.map((l) => [l.text, l.lane])));
    check(`width ${width} not combined`, placed.every((label) => !label.combined));
    check(`width ${width} texts unchanged`, placed.map((l) => l.text).sort().join("|") === [
      "FV: $4467", "R1: $4950", "R2: $5625", "S1: $4050", "S2: $3080",
    ].sort().join("|"));
    check(`width ${width} no same-lane overlap`, overlap === null, overlap ?? "");
  }
}

console.log("\nFV ≈ R1 — both prices distinguishable");
{
  const close = levels([
    ["S2", 8, "$3080"],
    ["S1", 36, "$4050"],
    ["FV", 66.8, "$4900"],
    ["R1", 68.5, "$4950"],
    ["R2", 90, "$5600"],
  ]);
  for (const width of [360, 768, 1440]) {
    const placed = layoutCorridorLabels(close, width);
    const overlap = sameLaneOverlap(placed, width);
    const fv = placed.find((label) => label.tooltip.split("\n").some((line) => line.startsWith("FV:")));
    const r1 = placed.find((label) => label.tooltip.split("\n").some((line) => line.startsWith("R1:")));
    check(`width ${width} keeps FV`, !!fv);
    check(`width ${width} keeps R1`, !!r1);
    check(
      `width ${width} FV and R1 not stacked on one unreadable label`,
      !!fv && !!r1 && (fv.id !== r1.id || (fv.combined && fv.tooltip.includes("FV:") && fv.tooltip.includes("R1:"))),
    );
    if (fv && r1 && fv.id !== r1.id) {
      check(`width ${width} FV/R1 separated`, fv.lane !== r1.lane || fv.leftPct !== r1.leftPct);
    }
    check(`width ${width} lanes ≤ ${CORRIDOR_LABEL_MAX_LANES}`, placed.every((label) => label.lane < CORRIDOR_LABEL_MAX_LANES));
    check(`width ${width} no same-lane overlap`, overlap === null, overlap ?? "");
    check(`width ${width} every tag kept`, ["S2", "S1", "FV", "R1", "R2"].every((tag) => tagsOf(placed).includes(tag)), tagsOf(placed).join(","));
  }
}

console.log("\nAll five levels on one tick — combine rather than drop");
{
  const pile = levels([
    ["S2", 50, "$4400"],
    ["S1", 50.4, "$4410"],
    ["FV", 50.8, "$4420"],
    ["R1", 51.1, "$4430"],
    ["R2", 51.3, "$4440"],
  ]);
  const placed = layoutCorridorLabels(pile, 320);
  const overlap = sameLaneOverlap(placed, 320);
  check("no same-lane overlap", overlap === null, overlap ?? "");
  check("at most 3 lanes", placed.every((label) => label.lane < CORRIDOR_LABEL_MAX_LANES));
  check("fewer labels than levels (some combined)", placed.length < 5);
  check("combined label carries a tooltip", placed.some((label) => label.combined && label.tooltip.includes("\n")));
  check("every tag kept", ["S2", "S1", "FV", "R1", "R2"].every((tag) => tagsOf(placed).includes(tag)), tagsOf(placed).join(","));
  const fvGroup = placed.find((label) => label.tooltip.includes("FV:"));
  check("FV price survives in the tooltip", !!fvGroup && fvGroup.tooltip.includes("$4420"));
}

console.log("\nUnmeasured track and spot-pill clamp");
{
  const placed = layoutCorridorLabels(spread, 0);
  check("width 0 keeps five labels on lane 0", placed.length === 5 && placed.every((label) => label.lane === 0 && !label.combined));
  check("mid spot pill stays put", clampLabelCenterPx(50, 400, 48) === 200);
  check("left spot pill slides inside", clampLabelCenterPx(2, 400, 48) === 24);
  check("right spot pill slides inside", clampLabelCenterPx(98, 400, 48) === 376);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll fair-value label layout checks passed.");
