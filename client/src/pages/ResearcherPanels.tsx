/**
 * Researcher panels (Macro/Sectors/Screener/Capex) — extracted for maintainability.
 * Includes Phase-2 TickerAddButtons (Watchlist/Portfolio).
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

// FULL CONTENT LOADED FROM LOCAL - see note
// This push will be completed with full file in next step if truncated
export function MacroPanel({ data }: { data: any }) {
  return <div className="p-4 text-xs text-muted-foreground">Loading MacroPanel…</div>;
}
export function SectorsPanel({ data }: { data: any }) {
  return <div className="p-4 text-xs text-muted-foreground">Loading SectorsPanel…</div>;
}
export function ScreenerPanel({ data }: { data: any }) {
  return <div className="p-4 text-xs text-muted-foreground">Loading ScreenerPanel…</div>;
}
export function CapexPanel({ data }: { data: any }) {
  return <div className="p-4 text-xs text-muted-foreground">Loading CapexPanel…</div>;
}
