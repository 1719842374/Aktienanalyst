import { useLayoutEffect, useRef, useState } from "react";
import type { GoldAnalysis } from "../../../../shared/gold-schema";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Props { data: GoldAnalysis }

export function GoldFairValueSection({ data }: Props) {
  const fv = data.fairValue;
  const priceVsFV = ((data.spotPrice - fv.fvAdj) / fv.fvAdj) * 100;
  // Sprint D5 (WORK_TEIL7_SCORING.md §6.6 letzter Punkt): 3-Faktor-Vergleichslinie ist
  // standardmäßig AUS — 1-Faktor (realYieldModel) bleibt die Standard-Anzeige. Der Nutzer
  // kann die Vergleichslinie optional einblenden.
  const [showMultiFactor, setShowMultiFactor] = useState(false);

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">4</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Fair Value (inflationsbereinigt)</h2>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-4">
        {/* 10-Step Calculation */}
        <div className="bg-muted/30 rounded-lg p-3 border border-border space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">10-Schritte-Berechnung</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
            <StepRow step={1} label="CPI heute" value={fv.cpiToday.toFixed(1)} />
            <StepRow step={2} label="FV₁₉₈₀ = 850 × (CPI/82.4)" value={`$${fv.fv1980.toLocaleString()}`} />
            <StepRow step={3} label="FV₂₀₁₁ = 1920 × (CPI/224.9)" value={`$${fv.fv2011.toLocaleString()}`} />
            <StepRow step={4} label="FV Basis = Ø(FV₁₉₈₀, FV₂₀₁₁)" value={`$${fv.fvBasis.toLocaleString()}`} />
            <StepRow step={5} label={`Premium (${fv.premiumReason})`} value={`${(fv.premium * 100).toFixed(0)}%`} />
            <StepRow step={6} label="FV adj. = Basis × (1+Premium)" value={`$${fv.fvAdj.toLocaleString()}`} highlight />
            <StepRow step={7} label="Support 1 (Preis × 0.90)" value={`$${fv.support1.toLocaleString()}`} />
            <StepRow step={8} label="Support 2 (FV Basis)" value={`$${fv.support2.toLocaleString()}`} />
            <StepRow step={9} label="Resistance 1 (Preis × 1.10)" value={`$${fv.resistance1.toLocaleString()}`} />
            <StepRow step={10} label="Resistance 2" value={`$${fv.resistance2.toLocaleString()}`} />
          </div>
        </div>

        {/* Fair Value Corridor Visual */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Fair-Value-Korridor</div>
          <FairValueBar
            spotPrice={data.spotPrice}
            support1={fv.support1}
            support2={fv.support2}
            fairValue={fv.fvAdj}
            resistance1={fv.resistance1}
            resistance2={fv.resistance2}
          />
        </div>

        {/* Price vs Fair Value */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${
          priceVsFV > 10
            ? "bg-red-500/10 border-red-500/20 text-red-400"
            : priceVsFV < -10
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-amber-500/10 border-amber-500/20 text-amber-400"
        }`}>
          <span className="font-medium">
            Spot vs. Fair Value: {priceVsFV >= 0 ? "+" : ""}{priceVsFV.toFixed(1)}%
          </span>
          <span className="text-muted-foreground">
            {priceVsFV > 10
              ? "→ Über Fair Value (Vorsicht)"
              : priceVsFV < -10
                ? "→ Unter Fair Value (Aufwärtspotenzial)"
                : "→ Im Bereich der Fair Value"}
          </span>
        </div>

        {/* Punkt 2 (HOCH-Ticket 05.08.2026): Real-Yield-Modell additiv, altes
            10-Schritte-Modell oben bleibt unveraendert der Hauptpfad. */}
        {data.realYieldModel && <RealYieldModelCard model={data.realYieldModel} />}

        {/* Sprint D5 (WORK_TEIL7_SCORING.md §6.6): optionale 3-Faktor-Vergleichslinie —
            additiv, standardmäßig eingeklappt/aus. 1-Faktor (oben) bleibt Standard-Anzeige. */}
        {data.multiFactorModel && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowMultiFactor(v => !v)}
              className="text-[10px] font-medium text-muted-foreground hover:text-foreground uppercase tracking-wider underline decoration-dotted"
            >
              {showMultiFactor ? "3-Faktor (Vergleich) ausblenden" : "3-Faktor (Vergleich) einblenden"}
            </button>
            {showMultiFactor && <MultiFactorModelCard model={data.multiFactorModel} />}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Sprint D5 (WORK_TEIL7_SCORING.md §6.6): sekundäre, rein additive Vergleichskarte für das
 * 3-Faktor-Modell (Real10Y + DXY + log(WALCL)). Wird nur gerendert, wenn der Nutzer sie über
 * den Toggle oben aktiv einblendet — 1-Faktor (RealYieldModelCard) bleibt Standardanzeige.
 */
function MultiFactorModelCard({ model }: { model: NonNullable<import("../../../../shared/gold-schema").GoldAnalysis["multiFactorModel"]> }) {
  const fv = model.fairValue;
  const gateActive = model.gate.active;

  return (
    <div className="bg-muted/20 rounded-lg p-3 border border-dashed border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          3-Faktor-Modell (Vergleich): Real10Y + DXY + log(WALCL)
        </div>
        <span className="text-[9px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          Sekundär — nur Vergleich
        </span>
      </div>

      {gateActive && (
        <div className="text-[10px] px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-400">
          {model.gate.id}: {model.gate.rationale}
        </div>
      )}

      {fv ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
            <StepRow step={1} label="Fair Value (3-Faktor-Fit)" value={`$${fv.fairValue.toFixed(0)}`} highlight={!gateActive} />
            <StepRow step={2} label="Aktueller Preis" value={`$${fv.actualPrice.toFixed(0)}`} />
            <StepRow step={3} label="Premium/Discount" value={`${fv.premiumPct >= 0 ? "+" : ""}${(fv.premiumPct * 100).toFixed(1)}%`} />
            <StepRow step={4} label="Fenster (Handelstage)" value={String(fv.windowUsed)} />
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
            <StepRow step={5} label="β1 (Real10Y, erw. <0)" value={fv.beta1.toFixed(2)} />
            <StepRow step={6} label="β2 (DXY, erw. <0)" value={fv.beta2.toFixed(4)} />
            <StepRow step={7} label="β3 (log WALCL, erw. >0)" value={fv.beta3.toFixed(1)} />
          </div>
          {!gateActive && (
            <div className="text-[10px] text-muted-foreground">Vorzeichen-Check bestanden (β1&lt;0, β2&lt;0, β3&gt;0) — Linie gilt als verlässlich.</div>
          )}
        </>
      ) : (
        <div className="text-xs text-muted-foreground">Zu wenig vollständige Datenpunkte für die 3-Faktor-Regression (WALCL/DXY/Real10Y müssen alle vorliegen).</div>
      )}
    </div>
  );
}

function RealYieldModelCard({ model }: { model: NonNullable<import("../../../../shared/gold-schema").GoldAnalysis["realYieldModel"]> }) {
  const fv = model.fairValue;
  const activeGates = model.gates.filter(g => g.active);
  const regimeColor = model.regime?.regime === "stress"
    ? "text-red-400 bg-red-500/10 border-red-500/20"
    : model.regime?.regime === "tailwind"
      ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
      : "text-amber-400 bg-amber-500/10 border-amber-500/20";

  return (
    <div className="bg-muted/30 rounded-lg p-3 border border-border space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
          Real-Yield-Modell (Regression Gold ~ Real10Y)
        </div>
        {fv?.decoupled && (
          <span className="text-[9px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            Entkoppelt — geringe Aussagekraft
          </span>
        )}
      </div>

      {fv ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
          <StepRow step={1} label="Fair Value (Real10Y-Fit)" value={`$${fv.fairValue.toFixed(0)}`} highlight />
          <StepRow step={2} label="Aktueller Preis" value={`$${fv.actualPrice.toFixed(0)}`} />
          <StepRow step={3} label="Premium/Discount" value={`${fv.premiumPct >= 0 ? "+" : ""}${(fv.premiumPct * 100).toFixed(1)}%`} />
          <StepRow step={4} label="Korrelation (252T)" value={fv.correlation.toFixed(2)} />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Zu wenig Datenpunkte für Regression (&lt;30 Handelstage verfügbar)</div>
      )}

      <div className={`flex items-center gap-2 px-3 py-2 rounded-md border text-xs ${regimeColor}`}>
        <span className="font-medium">Regime: {model.regime?.regime ?? "n/a"}</span>
        <span className="text-muted-foreground">{model.regime?.rationale ?? "Nicht bestimmbar"}</span>
      </div>

      <div className="text-xs text-muted-foreground">
        Inverse-Score (60T): <span className="font-mono tabular-nums text-foreground">{model.inverseScore.score}</span> — {model.inverseScore.details}
      </div>

      {activeGates.length > 0 && (
        <div className="space-y-1">
          {activeGates.map(g => (
            <div key={g.id} className="text-[10px] px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-red-400">
              {g.id}: {g.rationale}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step, label, value, highlight }: { step: number; label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center gap-2 ${highlight ? "font-bold text-amber-500" : ""}`}>
      <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-4">{step}.</span>
      <span className="flex-1 text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${highlight ? "text-amber-500" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

/**
 * B2 — Fair-Value label collision.
 * S2/S1/FV/R1/R2 share the bottom edge of the corridor. When two prices land
 * on nearly the same x (FV ≈ R1, …) those labels used to paint on top of each
 * other. Pack them into up to three rows in price order (cheaper label closer
 * to the bar). If a fourth label still overlaps, merge only the closest
 * price-adjacent pair and keep every price in the tooltip. Spot stays on the
 * top edge (its own row) and only slides inward when the pill would clip the
 * track. The track has top padding so the pill clears the "Fair-Value-Korridor"
 * heading. The FV marker stops above a lane-0 FV label so the line does not
 * run through that text. Zone bands are not part of this layout.
 */
export const CORRIDOR_LABEL_GAP_PX = 6;
export const CORRIDOR_LABEL_MAX_LANES = 3;
export const CORRIDOR_LABEL_LANE_PITCH_PX = 14;
export const CORRIDOR_LABEL_LINE_PX = 12;
/** Spot pill is shifted up by this many pixels (was the Tailwind class `-top-5`). */
export const CORRIDOR_SPOT_PILL_OVERHANG_PX = 20;
export const CORRIDOR_SPOT_HEADING_CLEARANCE_PX = 8;
/**
 * B2-Folge: Labels landen nur dann in einem gemeinsamen Stapel, wenn ihre
 * PREISE nah beieinander liegen (relativer Abstand ≤ 3 %). Ein Label mit
 * grosser Preisluecke wird nie gestapelt, auch wenn es optisch nah liegt —
 * dann zeigt es nur sein Kuerzel (Preis im Tap-Tooltip) oder bekommt eine
 * eigene Zeile.
 */
export const CORRIDOR_PILE_MAX_PRICE_GAP = 0.03;

/** Top padding so the spot pill stays below the corridor heading, including at 375px. */
export function corridorSpotTopPadPx(): number {
  return CORRIDOR_SPOT_PILL_OVERHANG_PX + CORRIDOR_SPOT_HEADING_CLEARANCE_PX;
}

const LEVEL_CHAR_PX = 5;
const SPOT_CHAR_PX = 6.2;
const SPOT_PAD_PX = 12;

const LEVEL_ORDER: Record<string, number> = { S2: 0, S1: 1, FV: 2, R1: 3, R2: 4 };

export type CorridorLevelInput = {
  id: string;
  tag: string;
  priceLabel: string;
  pct: number;
  colorClass: string;
};

export type PlacedCorridorLabel = {
  id: string;
  text: string;
  tooltip: string;
  colorClass: string;
  lane: number;
  leftPct: number;
  widthPx: number;
  combined: boolean;
  /** Einzel-Label nur mit Kuerzel (Platzmangel, Preis zu weit fuer einen Stapel). Preis im Tooltip. */
  compact?: boolean;
};

type LevelGroup = {
  parts: CorridorLevelInput[];
};

export function estimateLevelLabelWidthPx(text: string): number {
  return Math.ceil(text.length * LEVEL_CHAR_PX + 2);
}

export function estimateSpotLabelWidthPx(text: string): number {
  return Math.ceil(text.length * SPOT_CHAR_PX + SPOT_PAD_PX);
}

export function clampMarkerPct(pct: number): number {
  return Math.min(98, Math.max(2, pct));
}

/** Horizontal center in pixels so a label of `labelWidth` stays inside the track. */
export function clampLabelCenterPx(markerPct: number, trackWidth: number, labelWidth: number): number {
  const raw = (clampMarkerPct(markerPct) / 100) * trackWidth;
  if (trackWidth <= labelWidth) return trackWidth / 2;
  const half = labelWidth / 2;
  return Math.min(trackWidth - half, Math.max(half, raw));
}

function rangesOverlap(
  a: { left: number; right: number },
  b: { left: number; right: number },
  gap: number,
): boolean {
  return a.left < b.right + gap && b.left < a.right + gap;
}

function rangeSeparation(a: { left: number; right: number }, b: { left: number; right: number }): number {
  if (a.right < b.left) return b.left - a.right;
  if (b.right < a.left) return a.left - b.right;
  return -(Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

function levelPrice(level: CorridorLevelInput): number {
  const parsed = Number(String(level.priceLabel).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : level.pct;
}

function orderParts(parts: CorridorLevelInput[]): CorridorLevelInput[] {
  return [...parts].sort((a, b) => levelPrice(a) - levelPrice(b) || (LEVEL_ORDER[a.tag] ?? 9) - (LEVEL_ORDER[b.tag] ?? 9) || a.tag.localeCompare(b.tag));
}

function groupMinPrice(group: LevelGroup): number {
  return Math.min(...group.parts.map(levelPrice));
}

function groupMaxPrice(group: LevelGroup): number {
  return Math.max(...group.parts.map(levelPrice));
}

function groupColor(parts: CorridorLevelInput[]): string {
  if (parts.some((part) => part.tag === "FV")) return "text-amber-500";
  const colors = new Set(parts.map((part) => part.colorClass));
  return colors.size === 1 ? parts[0].colorClass : "text-foreground";
}

function presentGroup(group: LevelGroup, trackWidth: number, compact = false): {
  text: string;
  tooltip: string;
  colorClass: string;
  widthPx: number;
  combined: boolean;
  compact?: boolean;
  pct: number;
} {
  const parts = orderParts(group.parts);
  const tooltip = parts.map((part) => `${part.tag}: ${part.priceLabel}`).join("\n");
  const colorClass = groupColor(parts);
  const pct = parts.reduce((sum, part) => sum + part.pct, 0) / parts.length;
  if (parts.length === 1) {
    const text = compact ? parts[0].tag : `${parts[0].tag}: ${parts[0].priceLabel}`;
    return { text, tooltip, colorClass, widthPx: estimateLevelLabelWidthPx(text), combined: false, compact: compact || undefined, pct };
  }
  const prices: string[] = [];
  for (const part of parts) {
    if (!prices.includes(part.priceLabel)) prices.push(part.priceLabel);
  }
  const tags = parts.map((part) => part.tag);
  const full = prices.length === 1
    ? `${tags.join("·")}: ${prices[0]}`
    : parts.map((part) => `${part.tag} ${part.priceLabel}`).join(" · ");
  const short = tags.join("·");
  const fullWidth = estimateLevelLabelWidthPx(full);
  const text = fullWidth > trackWidth * 0.9 ? short : full;
  return {
    text,
    tooltip,
    colorClass,
    widthPx: estimateLevelLabelWidthPx(text),
    combined: true,
    pct,
  };
}

function packGroups(
  groups: LevelGroup[],
  trackWidth: number,
  opts: { compact?: boolean; maxLanes?: number } = {},
): PlacedCorridorLabel[] | null {
  const maxLanes = opts.maxLanes ?? CORRIDOR_LABEL_MAX_LANES;
  const displays = groups.map((group) => {
    const shown = presentGroup(group, trackWidth, !!opts.compact);
    const center = clampLabelCenterPx(shown.pct, trackWidth, shown.widthPx);
    return { shown, center, group, price: groupMinPrice(group) };
  }).sort((a, b) => a.price - b.price || a.center - b.center || a.shown.text.localeCompare(b.shown.text));

  const placedBoxes: { left: number; right: number; lane: number }[] = [];
  const placed: PlacedCorridorLabel[] = [];

  for (const item of displays) {
    const box = { left: item.center - item.shown.widthPx / 2, right: item.center + item.shown.widthPx / 2 };
    let lane = 0;
    for (const existing of placedBoxes) {
      if (rangesOverlap(existing, box, CORRIDOR_LABEL_GAP_PX)) {
        lane = Math.max(lane, existing.lane + 1);
      }
    }
    if (lane >= maxLanes) return null;
    placedBoxes.push({ ...box, lane });
    const parts = orderParts(item.group.parts);
    placed.push({
      id: parts.map((part) => part.id).join("-"),
      text: item.shown.text,
      tooltip: item.shown.tooltip,
      colorClass: item.shown.colorClass,
      lane,
      leftPct: (item.center / trackWidth) * 100,
      widthPx: item.shown.widthPx,
      combined: item.shown.combined,
      ...(item.shown.compact ? { compact: true } : {}),
    });
  }

  return placed;
}

/** Relativer Preisabstand zweier Nachbarn ≤ CORRIDOR_PILE_MAX_PRICE_GAP. */
export function pricesClose(a: number, b: number): boolean {
  const lo = Math.min(a, b);
  if (!(lo > 0)) return Math.abs(a - b) < 1e-9;
  return Math.abs(b - a) / lo <= CORRIDOR_PILE_MAX_PRICE_GAP + 1e-9;
}

/** Merge only neighbors in price order. Visual overlap is the tie-break, not a reason to skip a level in between. */
function mergePriceAdjacentGroups(groups: LevelGroup[], trackWidth: number): LevelGroup[] | null {
  if (groups.length < 2) return null;
  const indexed = groups.map((group, index) => ({
    group,
    index,
    minPrice: groupMinPrice(group),
    maxPrice: groupMaxPrice(group),
  }));
  indexed.sort((a, b) => a.minPrice - b.minPrice || a.index - b.index);

  const boxes = new Map<number, { left: number; right: number }>();
  for (const item of indexed) {
    const shown = presentGroup(item.group, trackWidth);
    const center = clampLabelCenterPx(shown.pct, trackWidth, shown.widthPx);
    boxes.set(item.index, { left: center - shown.widthPx / 2, right: center + shown.widthPx / 2 });
  }

  let best = -1;
  let bestGap = Infinity;
  let bestSep = Infinity;
  for (let i = 0; i < indexed.length - 1; i++) {
    const gap = indexed[i + 1].minPrice - indexed[i].maxPrice;
    // Nur preisnahe Nachbarn duerfen einen Stapel bilden.
    if (!pricesClose(indexed[i].maxPrice, indexed[i + 1].minPrice)) continue;
    const sep = rangeSeparation(boxes.get(indexed[i].index)!, boxes.get(indexed[i + 1].index)!);
    if (gap < bestGap - 1e-6 || (Math.abs(gap - bestGap) <= 1e-6 && sep < bestSep)) {
      bestGap = gap;
      bestSep = sep;
      best = i;
    }
  }

  if (best < 0) return null;
  const left = indexed[best];
  const right = indexed[best + 1];
  const merged: LevelGroup = { parts: [...left.group.parts, ...right.group.parts] };
  return groups.filter((_, index) => index !== left.index && index !== right.index).concat(merged);
}

export function layoutCorridorLabels(levels: CorridorLevelInput[], trackWidthPx: number): PlacedCorridorLabel[] {
  if (levels.length === 0) return [];
  if (trackWidthPx <= 0) {
    return levels.map((level) => {
      const text = `${level.tag}: ${level.priceLabel}`;
      return {
        id: level.id,
        text,
        tooltip: text,
        colorClass: level.colorClass,
        lane: 0,
        leftPct: clampMarkerPct(level.pct),
        widthPx: estimateLevelLabelWidthPx(text),
        combined: false,
      };
    });
  }

  let groups: LevelGroup[] = levels.map((level) => ({ parts: [level] }));
  for (let attempt = 0; attempt < levels.length; attempt++) {
    const packed = packGroups(groups, trackWidthPx);
    if (packed) return packed;
    const next = mergePriceAdjacentGroups(groups, trackWidthPx);
    if (!next) break;
    groups = next;
  }
  // Kein preisnahes Paar mehr: nicht stapeln, sondern Kuerzel (Preis im Tooltip),
  // notfalls zusaetzliche Zeilen. Nie ein Label weglassen.
  return packGroups(groups, trackWidthPx, { compact: true })
    ?? packGroups(groups, trackWidthPx, { compact: true, maxLanes: Infinity })
    ?? [];
}

export type ComboTooltipState = { open: boolean; pinned: boolean };
export type ComboTooltipEvent = "tap" | "hover-in" | "hover-out" | "dismiss";

/** Tap opens a combined-label tooltip and pins it. A second tap closes it. Hover-out does not dismiss a pin. */
export function reduceComboTooltip(state: ComboTooltipState, event: ComboTooltipEvent): ComboTooltipState {
  if (event === "tap") {
    if (!state.open || !state.pinned) return { open: true, pinned: true };
    return { open: false, pinned: false };
  }
  if (event === "hover-in") {
    if (state.open) return state;
    return { open: true, pinned: false };
  }
  if (event === "hover-out") {
    if (state.pinned || !state.open) return state;
    return { open: false, pinned: false };
  }
  if (!state.open && !state.pinned) return state;
  return { open: false, pinned: false };
}

/** Lane-0 labels sit in the bottom strip of the track, so the FV line stops above that text. */
export function fvMarkerBottomInsetPx(args: {
  markerPct: number;
  trackWidth: number;
  label: Pick<PlacedCorridorLabel, "lane" | "leftPct" | "widthPx" | "tooltip"> | undefined;
}): number {
  const { label, trackWidth, markerPct } = args;
  if (!label || trackWidth <= 0 || label.lane > 0) return 0;
  if (!label.tooltip.split("\n").some((line) => line.startsWith("FV:"))) return 0;
  const center = (label.leftPct / 100) * trackWidth;
  const marker = (clampMarkerPct(markerPct) / 100) * trackWidth;
  const half = label.widthPx / 2;
  if (marker < center - half - 0.01 || marker > center + half + 0.01) return 0;
  return CORRIDOR_LABEL_LINE_PX;
}

function FairValueBar({
  spotPrice,
  support1,
  support2,
  fairValue,
  resistance1,
  resistance2,
}: {
  spotPrice: number;
  support1: number;
  support2: number;
  fairValue: number;
  resistance1: number;
  resistance2: number;
}) {
  const min = Math.min(support2, support1, spotPrice) * 0.95;
  const max = Math.max(resistance2, resistance1, spotPrice) * 1.05;
  const range = max - min;
  // Fix 4: guard against division by zero when all values are equal
  const pct = (v: number) => range > 0 ? Math.min(100, Math.max(0, ((v - min) / range) * 100)) : 50;

  const trackRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useLayoutEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const placed = layoutCorridorLabels(
    [
      { id: "S2", tag: "S2", priceLabel: `$${support2}`, pct: pct(support2), colorClass: "text-red-400" },
      { id: "S1", tag: "S1", priceLabel: `$${support1}`, pct: pct(support1), colorClass: "text-red-400" },
      { id: "FV", tag: "FV", priceLabel: `$${fairValue}`, pct: pct(fairValue), colorClass: "text-amber-500" },
      { id: "R1", tag: "R1", priceLabel: `$${resistance1}`, pct: pct(resistance1), colorClass: "text-emerald-400" },
      { id: "R2", tag: "R2", priceLabel: `$${resistance2}`, pct: pct(resistance2), colorClass: "text-emerald-400" },
    ],
    trackWidth,
  );
  const extraLanes = placed.reduce((maxLane, label) => Math.max(maxLane, label.lane), 0);
  const spotText = `$${spotPrice.toFixed(0)}`;
  const spotMarkerPct = Math.min(98, Math.max(2, pct(spotPrice)));
  const spotNudgePx = trackWidth > 0
    ? clampLabelCenterPx(spotMarkerPct, trackWidth, estimateSpotLabelWidthPx(spotText)) - (spotMarkerPct / 100) * trackWidth
    : 0;
  const spotNudge = Math.abs(spotNudgePx) < 0.5 ? 0 : spotNudgePx;
  const spotTopPad = corridorSpotTopPadPx();
  const fvLabel = placed.find((label) => label.tooltip.split("\n").some((line) => line.startsWith("FV:")));
  const fvInset = fvMarkerBottomInsetPx({ markerPct: pct(fairValue), trackWidth, label: fvLabel });

  return (
    <TooltipProvider delayDuration={250}>
      <div
        style={{ paddingTop: spotTopPad, paddingBottom: extraLanes * CORRIDOR_LABEL_LANE_PITCH_PX }}
        data-testid="gold-fv-corridor-pad"
        data-spot-pad={spotTopPad}
      >
        <div ref={trackRef} className="relative h-12 bg-muted/30 rounded-lg border border-border" data-testid="gold-fv-corridor">
          {/* Support zone */}
          <div
            className="absolute h-full bg-red-500/10 rounded-l-lg"
            style={{ left: `${pct(min)}%`, width: `${pct(support1) - pct(min)}%` }}
          />
          {/* Fair Value zone */}
          <div
            className="absolute h-full bg-emerald-500/10"
            style={{ left: `${pct(support1)}%`, width: `${pct(resistance1) - pct(support1)}%` }}
          />
          {/* Resistance zone */}
          <div
            className="absolute h-full bg-red-500/10 rounded-r-lg"
            style={{ left: `${pct(resistance1)}%`, width: `${pct(max) - pct(resistance1)}%` }}
          />

          {/* Markers — lines only; labels are placed underneath so bands stay put. */}
          <MarkerLine pct={pct(support2)} />
          <MarkerLine pct={pct(support1)} />
          <MarkerLine pct={pct(fairValue)} thick bottomInset={fvInset} />
          <MarkerLine pct={pct(resistance1)} />
          <MarkerLine pct={pct(resistance2)} />

          {placed.map((label) => (
            <CorridorLevelLabel key={label.id} label={label} />
          ))}

          {/* Spot Price marker */}
          <div
            className="absolute top-0 h-full flex flex-col items-center z-10"
            style={{ left: `${spotMarkerPct}%` }}
          >
            <div className="w-0.5 h-full bg-amber-500" />
            <div
              className="absolute bg-amber-500 text-[9px] font-bold text-black px-1.5 py-0.5 rounded whitespace-nowrap"
              style={{
                top: -CORRIDOR_SPOT_PILL_OVERHANG_PX,
                ...(spotNudge !== 0 ? { transform: `translateX(${spotNudge}px)` } : {}),
              }}
              data-testid="gold-fv-spot-label"
            >
              {spotText}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function MarkerLine({ pct, thick, bottomInset = 0 }: { pct: number; thick?: boolean; bottomInset?: number }) {
  return (
    <div
      className="absolute top-0"
      style={{
        left: `${Math.min(98, Math.max(2, pct))}%`,
        height: bottomInset > 0 ? `calc(100% - ${bottomInset}px)` : "100%",
      }}
      data-testid={thick ? "gold-fv-marker-fv" : undefined}
      data-inset={thick ? bottomInset : undefined}
    >
      <div className={`${thick ? "w-0.5" : "w-px"} h-full ${thick ? "bg-amber-500/50" : "bg-border"}`} />
    </div>
  );
}

function CorridorLevelLabel({ label }: { label: PlacedCorridorLabel }) {
  const [tip, setTip] = useState<ComboTooltipState>({ open: false, pinned: false });
  const className = `absolute z-20 text-[8px] font-mono tabular-nums whitespace-nowrap ${label.colorClass}`;
  const style = {
    left: `${label.leftPct}%`,
    bottom: -(label.lane * CORRIDOR_LABEL_LANE_PITCH_PX),
    transform: "translateX(-50%)",
    lineHeight: `${CORRIDOR_LABEL_LINE_PX}px`,
  };
  if (!label.combined && !label.compact) {
    return (
      <div className={className} style={style} data-testid={`gold-fv-label-${label.id}`} data-lane={label.lane}>
        {label.text}
      </div>
    );
  }
  return (
    <Tooltip
      open={tip.open}
      onOpenChange={(next) => {
        setTip((current) => reduceComboTooltip(current, next ? "hover-in" : "hover-out"));
      }}
    >
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`${className} cursor-help border-0 bg-transparent p-0`}
          style={style}
          data-testid={`gold-fv-label-${label.id}`}
          data-lane={label.lane}
          aria-label={`${label.combined ? "Gestapelte Marken" : "Marke"} — ${label.tooltip.replace(/\n/g, ", ")}. Tippen zeigt die Preise.`}
          aria-expanded={tip.open}
          aria-haspopup="true"
          data-combined={label.combined ? "true" : undefined}
          onKeyDown={(event) => {
            if (event.key === "Escape") setTip((current) => reduceComboTooltip(current, "dismiss"));
          }}
          onClick={(event) => {
            event.preventDefault();
            setTip((current) => reduceComboTooltip(current, "tap"));
          }}
        >
          {label.text}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="whitespace-pre-line font-mono text-[11px]"
        onPointerDownOutside={() => setTip((current) => reduceComboTooltip(current, "dismiss"))}
        onEscapeKeyDown={() => setTip((current) => reduceComboTooltip(current, "dismiss"))}
      >
        {label.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
