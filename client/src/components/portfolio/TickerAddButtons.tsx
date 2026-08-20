/**
 * WORK_RESEARCHER_PORTFOLIO — Ein-Klick Add zu P1 (Portfolio) / P2 (Watchlist).
 * Generisch, kein Ticker-Hardcode. source steuert P3-Filter (researcher).
 */
import { useState } from "react";
import { Briefcase, ListPlus } from "lucide-react";
import {
  addTickerToManualPortfolio,
} from "@/lib/portfolio/portfolioBridge";
import {
  addToWatchlist,
  bulkAddToWatchlist as bulkAddWatchlistEntries,
  type PortfolioRegion,
  type WatchlistSource,
} from "@/lib/portfolio/watchlist";

export function TickerAddButtons({
  ticker,
  name,
  source = "researcher",
  score,
  region,
  compact = false,
}: {
  ticker: string;
  name?: string;
  source?: WatchlistSource;
  score?: number | null;
  /** Optionaler Researcher-Kontext; inferRegion bleibt der Fallback. */
  region?: PortfolioRegion;
  compact?: boolean;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const upper = (ticker || "").trim().toUpperCase();
  if (!upper) return null;

  function flash(text: string) {
    setMsg(text);
    window.setTimeout(() => setMsg(null), 2000);
  }

  function onPortfolio(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = addTickerToManualPortfolio(upper, name);
    flash(r.ok ? "→ Portfolio" : r.reason === "duplicate" ? "schon im Portfolio" : "Fehler");
  }

  function onWatchlist(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const r = addToWatchlist({ ticker: upper, name, source, score, region });
    flash(r.added ? "→ Watchlist" : r.reason === "duplicate" ? "schon auf Watchlist" : "Fehler");
  }

  if (compact) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          onClick={onPortfolio}
          title="Zum manuellen Portfolio (P1)"
          className="p-0.5 rounded text-foreground/40 hover:text-primary hover:bg-primary/10"
        >
          <Briefcase className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={onWatchlist}
          title="Zur Watchlist (P2/P3)"
          className="p-0.5 rounded text-foreground/40 hover:text-emerald-400 hover:bg-emerald-500/10"
        >
          <ListPlus className="w-3 h-3" />
        </button>
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
      <button
        type="button"
        onClick={onPortfolio}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-primary/30 text-primary/90 hover:bg-primary/15"
        title="Zum manuellen Portfolio (P1)"
      >
        <Briefcase className="w-3 h-3" /> Zum Portfolio
      </button>
      <button
        type="button"
        onClick={onWatchlist}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border border-border/50 text-foreground/70 hover:bg-muted/40"
        title="Zur Watchlist (P2) / Researcher-Portfolio (P3)"
      >
        <ListPlus className="w-3 h-3" /> Zur Watchlist
      </button>
      {msg && <span className="text-[9px] text-emerald-400">{msg}</span>}
    </div>
  );
}

/** Bulk: alle Ticker zur Watchlist (source=researcher default). */
export function bulkAddToWatchlist(
  items: Array<{ ticker: string; name?: string; score?: number | null }>,
  source: WatchlistSource = "researcher",
  region?: PortfolioRegion,
): { added: number; skipped: number } {
  return bulkAddWatchlistEntries(items.map(item => ({ ...item, region })), source);
}
