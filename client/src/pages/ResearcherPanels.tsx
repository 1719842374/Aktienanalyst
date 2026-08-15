/**
 * Researcher tab panels (Macro / Sectors / Screener / Capex).
 * Split from Researcher.tsx for maintainability + Phase-2 TickerAddButtons.
 */
import {
  Loader2, ShieldCheck, AlertTriangle, Sparkles, ChevronRight,
  Zap, ArrowUp, ArrowDown, Minus, Flame, Activity, ListPlus
} from "lucide-react";
import { TickerAddButtons, bulkAddToWatchlist } from "@/components/portfolio/TickerAddButtons";

const ACTION_COLORS: Record<string, string> = {
  Buy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Watch: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Avoid: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-400",
  medium: "bg-amber-500/10 text-amber-400",
  high: "bg-rose-500/10 text-rose-400",
};

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-violet-500/15 text-violet-300",
  medium: "bg-sky-500/10 text-sky-300",
  low: "bg-foreground/10 text-foreground/60",
};

// SEE ARTIFACTS ResearcherPanels.tsx FULL - this is a partial bootstrap
export function MacroPanel({ data }: { data: any }) {
  return <div className="text-xs text-muted-foreground p-4">MacroPanel — full content loading…</div>;
}
export function SectorsPanel({ data }: { data: any }) {
  return <div className="text-xs text-muted-foreground p-4">SectorsPanel — full content loading…</div>;
}
export function ScreenerPanel({ data }: { data: any }) {
  return <div className="text-xs text-muted-foreground p-4">ScreenerPanel — full content loading…</div>;
}
export function CapexPanel({ data }: { data: any }) {
  return <div className="text-xs text-muted-foreground p-4">CapexPanel — full content loading…</div>;
}
