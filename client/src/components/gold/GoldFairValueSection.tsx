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
 * other. Pack them into up to three rows; if a fourth label still overlaps,
 * merge the tightest pair into one label and keep every price in the tooltip.
 * Spot stays on the top edge (its own row) and only slides inward when the
 * pill would clip the track. Zone bands are not part of this layout.
 */
export const CORRIDOR_LABEL_GAP_PX = 6;
export const CORRIDOR_LABEL_MAX_LANES = 3;
export const CORRIDOR_LABEL_LANE_PITCH_PX = 14;

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

function orderParts(parts: CorridorLevelInput[]): CorridorLevelInput[] {
  return [...parts].sort((a, b) => (LEVEL_ORDER[a.tag] ?? 9) - (LEVEL_ORDER[b.tag] ?? 9) || a.tag.localeCompare(b.tag));
}

function groupColor(parts: CorridorLevelInput[]): string {
  if (parts.some((part) => part.tag === "FV")) return "text-amber-500";
  const colors = new Set(parts.map((part) => part.colorClass));
  return colors.size === 1 ? parts[0].colorClass : "text-foreground";
}

function presentGroup(group: LevelGroup, trackWidth: number): {
  text: string;
  tooltip: string;
  colorClass: string;
  widthPx: number;
  combined: boolean;
  pct: number;
} {
  const parts = orderParts(group.parts);
  const tooltip = parts.map((part) => `${part.tag}: ${part.priceLabel}`).join("\n");
  const colorClass = groupColor(parts);
  const pct = parts.reduce((sum, part) => sum + part.pct, 0) / parts.length;
  if (parts.length === 1) {
    const text = `${parts[0].tag}: ${parts[0].priceLabel}`;
    return { text, tooltip, colorClass, widthPx: estimateLevelLabelWidthPx(text), combined: false, pct };
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

function packGroups(groups: LevelGroup[], trackWidth: number): PlacedCorridorLabel[] | null {
  const displays = groups.map((group) => {
    const shown = presentGroup(group, trackWidth);
    const center = clampLabelCenterPx(shown.pct, trackWidth, shown.widthPx);
    return { shown, center, group };
  }).sort((a, b) => a.center - b.center || a.shown.text.localeCompare(b.shown.text));

  const lanes: { left: number; right: number }[][] = [];
  const placed: PlacedCorridorLabel[] = [];

  for (const item of displays) {
    const box = { left: item.center - item.shown.widthPx / 2, right: item.center + item.shown.widthPx / 2 };
    let lane = -1;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].every((existing) => !rangesOverlap(existing, box, CORRIDOR_LABEL_GAP_PX))) {
        lane = i;
        break;
      }
    }
    if (lane === -1 && lanes.length < CORRIDOR_LABEL_MAX_LANES) {
      lane = lanes.length;
      lanes.push([]);
    }
    if (lane === -1) return null;
    lanes[lane].push(box);
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
    });
  }

  return placed;
}

function mergeTightestGroups(groups: LevelGroup[], trackWidth: number): LevelGroup[] | null {
  if (groups.length < 2) return null;
  const boxes = groups.map((group) => {
    const shown = presentGroup(group, trackWidth);
    const center = clampLabelCenterPx(shown.pct, trackWidth, shown.widthPx);
    return { left: center - shown.widthPx / 2, right: center + shown.widthPx / 2 };
  });
  let bestI = 0;
  let bestJ = 1;
  let bestSep = Infinity;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const sep = rangeSeparation(boxes[i], boxes[j]);
      if (sep < bestSep) {
        bestSep = sep;
        bestI = i;
        bestJ = j;
      }
    }
  }
  const merged: LevelGroup = { parts: [...groups[bestI].parts, ...groups[bestJ].parts] };
  return groups.filter((_, index) => index !== bestI && index !== bestJ).concat(merged);
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
    const next = mergeTightestGroups(groups, trackWidthPx);
    if (!next) break;
    groups = next;
  }
  return packGroups(groups, trackWidthPx) ?? [];
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

  return (
    <TooltipProvider delayDuration={250}>
      <div style={{ paddingBottom: extraLanes * CORRIDOR_LABEL_LANE_PITCH_PX }}>
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
          <MarkerLine pct={pct(fairValue)} thick />
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
              className="absolute -top-5 bg-amber-500 text-[9px] font-bold text-black px-1.5 py-0.5 rounded whitespace-nowrap"
              style={spotNudge !== 0 ? { transform: `translateX(${spotNudge}px)` } : undefined}
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

function MarkerLine({ pct, thick }: { pct: number; thick?: boolean }) {
  return (
    <div
      className="absolute top-0 h-full"
      style={{ left: `${Math.min(98, Math.max(2, pct))}%` }}
    >
      <div className={`${thick ? "w-0.5" : "w-px"} h-full ${thick ? "bg-amber-500/50" : "bg-border"}`} />
    </div>
  );
}

function CorridorLevelLabel({ label }: { label: PlacedCorridorLabel }) {
  const className = `absolute z-20 text-[8px] font-mono tabular-nums whitespace-nowrap leading-[12px] ${label.colorClass}`;
  const style = {
    left: `${label.leftPct}%`,
    bottom: -(label.lane * CORRIDOR_LABEL_LANE_PITCH_PX),
    transform: "translateX(-50%)",
  };
  if (!label.combined) {
    return (
      <div className={className} style={style} data-testid={`gold-fv-label-${label.id}`} data-lane={label.lane}>
        {label.text}
      </div>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={`${className} cursor-help border-0 bg-transparent p-0`}
          style={style}
          data-testid={`gold-fv-label-${label.id}`}
          data-lane={label.lane}
          aria-label={label.tooltip}
        >
          {label.text}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="whitespace-pre-line font-mono text-[11px]">
        {label.tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
