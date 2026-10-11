/**
 * B2 — Gold Fair-Value corridor label layout.
 * Pure layout checks (no DOM): close levels stay readable, spread levels stay
 * on one row, and a full pile never drops a price or overlaps a lane.
 *
 * Ausführen: npx tsx script/test-gold-fv-label-layout.ts
 */
import {
  CORRIDOR_LABEL_GAP_PX,
  CORRIDOR_LABEL_LINE_PX,
  CORRIDOR_LABEL_MAX_LANES,
  CORRIDOR_PILE_MAX_PRICE_GAP,
  CORRIDOR_SPOT_HEADING_CLEARANCE_PX,
  CORRIDOR_SPOT_PILL_OVERHANG_PX,
  clampLabelCenterPx,
  corridorSpotTopPadPx,
  fvMarkerBottomInsetPx,
  layoutCorridorLabels,
  pricesClose,
  reduceComboTooltip,
  type ComboTooltipState,
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

function pricesOf(label: PlacedCorridorLabel): number[] {
  return label.tooltip.split("\n").map((line) => {
    const rhs = line.includes(":") ? line.split(":").slice(1).join(":") : line;
    return Number(rhs.replace(/[^0-9.-]/g, ""));
  });
}

function contiguousPriceError(placed: PlacedCorridorLabel[], sortedPrices: number[]): string | null {
  for (const label of placed) {
    const prices = pricesOf(label);
    const sorted = [...prices].sort((a, b) => a - b);
    if (prices.some((price, index) => price !== sorted[index])) return `${label.text} tooltip is not in price order`;
    const start = sortedPrices.indexOf(sorted[0]);
    if (start < 0 || sorted.some((price, index) => sortedPrices[start + index] !== price)) {
      return `${label.text} skips a price between neighbors`;
    }
  }
  return null;
}

function laneOrderError(placed: PlacedCorridorLabel[], width: number): string | null {
  const items = placed.map((label) => {
    const price = Math.min(...pricesOf(label));
    const center = (label.leftPct / 100) * width;
    return { label, price, left: center - label.widthPx / 2, right: center + label.widthPx / 2 };
  });
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const overlap = a.left < b.right + CORRIDOR_LABEL_GAP_PX && b.left < a.right + CORRIDOR_LABEL_GAP_PX;
      if (!overlap || a.price === b.price) continue;
      const cheaper = a.price < b.price ? a : b;
      const dearer = a.price < b.price ? b : a;
      if (cheaper.label.lane > dearer.label.lane) {
        return `${cheaper.label.text} (lane ${cheaper.label.lane}) sits below ${dearer.label.text} (lane ${dearer.label.lane})`;
      }
    }
  }
  return null;
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
  const pilePrices = [4400, 4410, 4420, 4430, 4440];
  const pileContig = contiguousPriceError(placed, pilePrices);
  check("pile groups are price-contiguous", pileContig === null, pileContig ?? "");
  const pileLanes = laneOrderError(placed, 320);
  check("pile rows follow price", pileLanes === null, pileLanes ?? "");
}

console.log("\nNarrow track — clamped ends must not merge across a middle price");
{
  const narrow = levels([
    ["S2", 2, "$1000"],
    ["S1", 30, "$2000"],
    ["FV", 50, "$3000"],
    ["R1", 70, "$4000"],
    ["R2", 98, "$5000"],
  ]);
  const width = 140;
  const placed = layoutCorridorLabels(narrow, width);
  const overlap = sameLaneOverlap(placed, width);
  const contig = contiguousPriceError(placed, [1000, 2000, 3000, 4000, 5000]);
  const lanes = laneOrderError(placed, width);
  check("no same-lane overlap", overlap === null, overlap ?? "");
  check("at most 3 lanes", placed.every((label) => label.lane < CORRIDOR_LABEL_MAX_LANES));
  check("every tag kept", ["S2", "S1", "FV", "R1", "R2"].every((tag) => tagsOf(placed).includes(tag)), tagsOf(placed).join(","));
  check("only price-adjacent levels share a label", contig === null, contig ?? "");
  check("rows follow price", lanes === null, lanes ?? "");
  const jumped = placed.some((label) => {
    const prices = pricesOf(label);
    return prices.includes(1000) && prices.includes(5000);
  });
  check("S2 is not combined with R2", !jumped);
}

console.log("\nUnmeasured track and spot-pill clamp");
{
  const placed = layoutCorridorLabels(spread, 0);
  check("width 0 keeps five labels on lane 0", placed.length === 5 && placed.every((label) => label.lane === 0 && !label.combined));
  check("mid spot pill stays put", clampLabelCenterPx(50, 400, 48) === 200);
  check("left spot pill slides inside", clampLabelCenterPx(2, 400, 48) === 24);
  check("right spot pill slides inside", clampLabelCenterPx(98, 400, 48) === 376);
}

console.log("\n375px spot pill vs FAIR-VALUE-KORRIDOR heading");
{
  const pad = corridorSpotTopPadPx();
  check("top pad covers the pill overhang plus clearance", pad >= CORRIDOR_SPOT_PILL_OVERHANG_PX + CORRIDOR_SPOT_HEADING_CLEARANCE_PX);
  check("pad is the value the track uses (B2-Folge: 8px Abstand)", pad === 28);
  check("clearance at least 8px at 375", CORRIDOR_SPOT_HEADING_CLEARANCE_PX >= 8);
}

console.log("\nCombo-label tooltip opens on tap");
{
  let state: ComboTooltipState = { open: false, pinned: false };
  state = reduceComboTooltip(state, "tap");
  check("first tap opens and pins", state.open && state.pinned);
  state = reduceComboTooltip(state, "hover-out");
  check("pinned tooltip ignores hover-out", state.open && state.pinned);
  state = reduceComboTooltip(state, "tap");
  check("second tap closes", !state.open && !state.pinned);
  state = reduceComboTooltip(state, "hover-in");
  state = reduceComboTooltip(state, "tap");
  check("tap on a hover-open tooltip pins it", state.open && state.pinned);
  state = reduceComboTooltip(state, "dismiss");
  check("outside dismiss closes a pin", !state.open && !state.pinned);
}

console.log("\nFV marker line stops above lane-0 text");
{
  const placed = layoutCorridorLabels(spread, 800);
  const fv = placed.find((label) => label.tooltip.split("\n").some((line) => line.startsWith("FV:")));
  check("spread FV is on lane 0", fv?.lane === 0);
  check(
    "lane-0 FV line insets by the label line height",
    !!fv && fvMarkerBottomInsetPx({ markerPct: 51.7, trackWidth: 800, label: fv }) === CORRIDOR_LABEL_LINE_PX,
  );
  check(
    "a lower-lane FV label does not shorten the in-bar line",
    fvMarkerBottomInsetPx({
      markerPct: 51.7,
      trackWidth: 800,
      label: fv ? { ...fv, lane: 1 } : undefined,
    }) === 0,
  );
}

console.log("\nB2-Folge — Stapel nur bei nahen PREISEN");
{
  check("3 % threshold constant", CORRIDOR_PILE_MAX_PRICE_GAP === 0.03);
  check("4900 vs 4950 counts as close", pricesClose(4900, 4950));
  check("4050 vs 4467 is not close", !pricesClose(4050, 4467));

  // FV ≈ R1 at 375 px track (~320): FV/R1 may share a pile, nothing else joins it.
  const fvR1 = levels([
    ["S2", 8, "$3080"],
    ["S1", 36, "$4050"],
    ["FV", 66.8, "$4900"],
    ["R1", 68.5, "$4950"],
    ["R2", 90, "$5600"],
  ]);
  for (const width of [320, 1100]) {
    const placed = layoutCorridorLabels(fvR1, width);
    const bad = placed.filter((l) => l.combined).find((l) => {
      const p = pricesOf(l).sort((a, b) => a - b);
      return p.some((v, i) => i > 0 && !pricesClose(p[i - 1], v));
    });
    check(`FV≈R1 width ${width}: piles only hold price-close levels`, !bad, bad?.text);
    check(`FV≈R1 width ${width}: every tag kept`, ["S2", "S1", "FV", "R1", "R2"].every((t) => tagsOf(placed).includes(t)));
    const ov = sameLaneOverlap(placed, width);
    check(`FV≈R1 width ${width}: no same-lane overlap`, ov === null, ov ?? "");
  }

  // Wide spread: never piles, at 1440-ish and 375-ish widths.
  for (const width of [320, 1100]) {
    const placed = layoutCorridorLabels(spread, width);
    check(`wide spread width ${width}: no pile`, placed.every((l) => !l.combined), JSON.stringify(placed.map((l) => l.text)));
    check(`wide spread width ${width}: five labels`, placed.length === 5);
    const ov = sameLaneOverlap(placed, width);
    check(`wide spread width ${width}: no same-lane overlap`, ov === null, ov ?? "");
  }

  // Five-level pile (all within 1 %) still piles at 320.
  const pile5 = levels([
    ["S2", 50, "$4400"], ["S1", 50.4, "$4410"], ["FV", 50.8, "$4420"], ["R1", 51.1, "$4430"], ["R2", 51.3, "$4440"],
  ]);
  const p5 = layoutCorridorLabels(pile5, 320);
  check("five-level pile: combined at 320", p5.some((l) => l.combined));
  check("five-level pile: every tag kept", ["S2", "S1", "FV", "R1", "R2"].every((t) => tagsOf(p5).includes(t)));

  // Large price gap: S2 sits visually next to the pile (pct 49) but costs far less.
  const gap = levels([
    ["S2", 49, "$1000"], ["S1", 50, "$4400"], ["FV", 50.4, "$4410"], ["R1", 50.8, "$4420"], ["R2", 51.2, "$4430"],
  ]);
  for (const width of [200, 320]) {
    const placed = layoutCorridorLabels(gap, width);
    const s2 = placed.find((l) => l.tooltip.split("\n").some((line) => line.startsWith("S2:")));
    check(`large gap width ${width}: S2 kept`, !!s2);
    check(`large gap width ${width}: S2 never in a pile`, !!s2 && !s2.combined && pricesOf(s2).length === 1, s2?.text);
    check(`large gap width ${width}: S2 price stays reachable`, !!s2 && s2.tooltip.includes("$1000"));
    const ov = sameLaneOverlap(placed, width);
    check(`large gap width ${width}: no same-lane overlap`, ov === null, ov ?? "");
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nAll fair-value label layout checks passed.");
