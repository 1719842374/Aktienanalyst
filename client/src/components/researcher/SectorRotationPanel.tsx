/**
 * SectorRotationPanel — Sprint C1 P0-P3.
 * Spec WORK_SEKTORROTATIONS_RAT.md §3.3 alle 4 Bloecke + §6 Quellenzeile.
 * P0/P1 (Engine/Route/Tabelle) siehe Commit 9aa6f9a.
 * P2 (Sektorradar-Donut) + P3 (Zyklus-Ring + 4 Empfehlungskarten) hier ergaenzt
 * -- rein additiv im Client, KEIN neues API-Feld (Response deckt §3.4 bereits
 * vollstaendig ab: risk/valuation/attractiveness/phaseFit/pe/pe10y/return6M/
 * phase/phaseConfidence/recommendations/dataQuality). Server/Engine unveraendert.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Loader2, RefreshCw,
  Monitor, Radio, ShoppingBag, Factory, Landmark, Fuel, HeartPulse, ShoppingCart, Plug,
} from "lucide-react";
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { apiRequest } from "@/lib/queryClient";

type Valuation = "Teuer" | "Angemessen" | "Attraktiv" | "n.v.";
type CyclePhase = "Frühzyklus" | "Hochkonjunktur" | "Spätkonjunktur" | "Abschwung";

interface SectorRow {
  id: string;
  label: string;
  etf: string;
  risk: 1 | 2 | 3 | 4 | 5;
  valuation: Valuation;
  pe: number | null;
  pe10y: number | null;
  attractiveness: number;
  return6M: number | null;
  phaseFit: number;
}

interface SectorRotationPayload {
  asOf: string;
  phase: CyclePhase;
  phaseConfidence: number;
  sectors: SectorRow[];
  recommendations?: Record<CyclePhase, string[]>;
  dataQuality?: { etfCoverage: number; pe10yCoverage: number; source: string };
  _cached?: boolean;
  _cacheAge?: number;
}

const VAL_CLASS: Record<string, string> = {
  Teuer: "text-rose-300",
  Angemessen: "text-amber-300",
  Attraktiv: "text-emerald-300",
  "n.v.": "text-foreground/40",
};

const SECTOR_COLORS: Record<string, string> = {
  technology: "#e11d48",
  communication: "#f43f5e",
  discretionary: "#f97316",
  industrials: "#f59e0b",
  financials: "#eab308",
  energy: "#84cc16",
  healthcare: "#22c55e",
  staples: "#14b8a6",
  utilities: "#3b82f6",
};
const FALLBACK_COLOR = "#64748b";

const SECTOR_ICONS: Record<string, typeof Monitor> = {
  technology: Monitor,
  communication: Radio,
  discretionary: ShoppingBag,
  industrials: Factory,
  financials: Landmark,
  energy: Fuel,
  healthcare: HeartPulse,
  staples: ShoppingCart,
  utilities: Plug,
};

const PHASE_ORDER: CyclePhase[] = ["Frühzyklus", "Hochkonjunktur", "Spätkonjunktur", "Abschwung"];
const PHASE_DESCRIPTION: Record<CyclePhase, string> = {
  Frühzyklus: "Erholung nach Rezession — Wachstumserwartungen, Investitionen und Risikobereitschaft steigen.",
  Hochkonjunktur: "Expansion & starkes Wachstum — Gewinne breit hoch, Zinsen moderat steigend, Bewertungen teurer.",
  Spätkonjunktur: "Abschwächung & Unsicherheit — Gewinnwachstum verlangsamt, Inflation/Zinsen hoch.",
  Abschwung: "Rezession / Kontraktion — Nachfrage & Gewinne fallen, Risikoaversion steigt.",
};

const PHASE_BAR_COLORS: Record<CyclePhase, string> = {
  Frühzyklus: "#22c55e",
  Hochkonjunktur: "#eab308",
  Spätkonjunktur: "#f97316",
  Abschwung: "#ef4444",
};

function phaseFitFillPct(phaseFit: number): number {
  return clampPct(((phaseFit - 1) / 4) * 100);
}

function clampPct(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(100, Math.max(0, x));
}

function SectorCycleProgressBar({
  phase,
  phaseFit,
  compact = false,
}: {
  phase: CyclePhase;
  phaseFit?: number;
  compact?: boolean;
}) {
  const activeIdx = PHASE_ORDER.indexOf(phase);
  const segW = 100 / PHASE_ORDER.length;
  const hasFit = phaseFit != null && Number.isFinite(phaseFit);
  const fitIsGood = hasFit ? phaseFit! >= 3 : true;
  const markerIdx = hasFit && !fitIsGood && activeIdx >= 0
    ? (activeIdx + Math.floor(PHASE_ORDER.length / 2)) % PHASE_ORDER.length
    : activeIdx;
  const markerLeftPct = markerIdx >= 0 ? markerIdx * segW + segW / 2 : 0;
  const markerColorClass = !hasFit || fitIsGood ? "bg-primary" : "bg-foreground/40";
  const markerTitle = hasFit
    ? `Phase-Fit ${phaseFit} -- ${fitIsGood ? "passt zur aktuellen Phase" : "passt NICHT zur aktuellen Phase"} (${phase})`
    : `Aktuelle Phase: ${phase}`;

  return (
    <div className="w-full" data-testid="bar-cycle-progress">
      {compact ? (
      <div className="relative h-4 px-1.5 overflow-x-hidden">
        <div className="absolute left-1.5 right-1.5 top-1/2 -translate-y-1/2 h-3 flex rounded-full overflow-hidden">
        {PHASE_ORDER.map(p => (
          <div
            key={p}
            className="h-full"
            style={{ width: `${segW}%`, backgroundColor: PHASE_BAR_COLORS[p], opacity: p === phase ? 1 : 0.35 }}
          />
        ))}
        </div>
        <div
          className={`absolute top-1/2 w-2 h-2 rounded-full border-2 border-white shadow -translate-x-1/2 -translate-y-1/2 ${markerColorClass}`}
          style={{ left: `clamp(6px, ${markerLeftPct}%, calc(100% - 6px))` }}
          title={markerTitle}
          data-testid="marker-cycle-current-phase"
        />
      </div>
      ) : (
      <div className="relative h-2 rounded-full overflow-hidden flex">
        {PHASE_ORDER.map(p => (
          <div
            key={p}
            className="h-full"
            style={{ width: `${segW}%`, backgroundColor: PHASE_BAR_COLORS[p], opacity: p === phase ? 1 : 0.35 }}
          />
        ))}
        <div
          className={`absolute -top-1 w-3 h-3 rounded-full border-2 border-white shadow -translate-x-1/2 ${markerColorClass}`}
          style={{ left: `${markerLeftPct}%` }}
          title={markerTitle}
          data-testid="marker-cycle-current-phase"
        />
      </div>
      )}
      {hasFit && (
        <div className={`mt-0.5 text-[8px] leading-tight ${fitIsGood ? "text-emerald-400/80" : "text-foreground/40"}`}>
          {fitIsGood ? "passt zur Phase" : "passt nicht"}
        </div>
      )}
      {!compact && (
        <div className="flex justify-between mt-1">
          {PHASE_ORDER.map(p => (
            <span
              key={p}
              className={`text-[8px] leading-tight ${p === phase ? "text-foreground/80 font-semibold" : "text-foreground/30"}`}
              style={{ width: `${segW}%` }}
            >
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
