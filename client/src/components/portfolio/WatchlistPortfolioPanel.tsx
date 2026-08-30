/**
 * WatchlistPortfolioPanel — P2, vollständig von P1 getrennt.
 *
 * Liest ausschließlich lokale WatchlistEntry-Daten und historische Kurse aus
 * /api/analyze. Die Gewichtung delegiert an computePortfolioFromTickers(),
 * das wiederum die etablierte Portfolio-Engine nutzt. Manuelle Positionen
 * werden weder gelesen noch verändert.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, Loader2, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  computePortfolioFromTickers,
  MIN_POSITIONS_FOR_OPTIMIZATION,
} from "@/lib/portfolio/engine";
import {
  loadWatchlist,
  removeWatchlistEntry,
  type WatchlistEntry,
} from "@/lib/portfolio/watchlist";
import type { PortfolioPolicy } from "@/lib/portfolio/positions";
import type { StockAnalysis } from "../../../../shared/schema";
import EfficientFrontierPanel from "./EfficientFrontierPanel";

const MODE_LABELS: Record<string, string> = {
  A: "Modus A — Max-Sharpe",
  B: "Modus B — Risk-Parity",
  C: "Modus C — Score-Tilt",
  "kelly-only": "Kelly-only",
};

function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

function WatchlistBasketResult({
  entries,
  policy,
  analysisByTicker,
  loadingTickers,
}: {
  entries: WatchlistEntry[];
  policy: PortfolioPolicy;
  analysisByTicker: Record<string, StockAnalysis | undefined>;
  loadingTickers: Set<string>;
}) {
  const tickers = useMemo(
    () => Array.from(new Set(entries.map(entry => entry.ticker.toUpperCase()).filter(Boolean))),
    [entries],
  );
  const isLoading = tickers.some(ticker => loadingTickers.has(ticker));

  const historicalPricesByTicker = useMemo(() => {
    const map: Record<string, Array<{ date: string; close: number }> | undefined> = {};
    for (const entry of entries) {
      const ticker = entry.ticker.toUpperCase();
      map[ticker] = analysisByTicker[ticker]?.historicalPrices
        ?.map(point => ({ date: point.date, close: point.close }));
    }
    return map;
  }, [analysisByTicker, entries]);

  const result = useMemo(() => {
    const scoreByTicker: Record<string, number | null | undefined> = {};

    for (const entry of entries) {
      const ticker = entry.ticker.toUpperCase();
      // Falls P2 und P3 denselben Ticker enthalten, genügt ein vorhandener
      // Score. Der höchste verfügbare Score ist für den Score-Tilt stabil und
      // transparent; eine doppelte Position wird nicht angelegt.
      if (entry.score != null) {
        scoreByTicker[ticker] = Math.max(scoreByTicker[ticker] ?? -Infinity, entry.score);
      }
    }

    return computePortfolioFromTickers(tickers, policy, {
      historicalPricesByTicker,
      scoreByTicker,
    });
  }, [entries, historicalPricesByTicker, policy, tickers]);

  // Referenzgewichte fuer die Effizienzlinie (Phase 5, additiv): P2 hat keine
  // echten Marktwerte (Watchlist-Basket ohne Stueckzahl) -- nur das CAPM-Ziel
  // wird markiert, Equal-Weight berechnet EfficientFrontierPanel selbst.
  const frontierCurrentWeights = useMemo(() => {
    if (result.status !== "ok") return undefined;
    const map: Record<string, { market?: number | null; capm?: number | null }> = {};
    result.rows.forEach(row => { map[row.ticker] = { capm: row.weightCapm }; });
    return map;
  }, [result]);

  if (tickers.length < MIN_POSITIONS_FOR_OPTIMIZATION) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="status-watchlist-minimum-tickers">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Mindestens 2 Ticker für automatische Gewichtung nötig.</p>
      </div>
    );
  }

  if (result.status !== "ok") {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground" data-testid="status-watchlist-insufficient-history">
        {isLoading ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-500" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
        <div className="space-y-1">
          <p className="font-medium text-foreground">
            {isLoading ? "Kurs-Historien für die automatische Gewichtung werden geladen." : "Nicht genug Kurs-Historie für eine belastbare automatische Gewichtung."}
          </p>
          {result.flags.map((flag, index) => <p key={index}>{flag}</p>)}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-card p-4" data-testid="panel-watchlist-weighting">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Automatische Ziel-Gewichtung</h3>
          <p className="text-[11px] text-muted-foreground" data-testid="text-watchlist-weighting-mode">
            {result.mode ? MODE_LABELS[result.mode] : "—"} · CAPM-Basket und separater Kelly-Hinweis
          </p>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Kursdaten werden aktualisiert" />}
      </div>

      {result.fallbackReason === "solve_failed" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400" data-testid="status-watchlist-solve-failed">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Die Kovarianzmatrix konnte nicht stabil gelöst werden. Die Berechnung verwendet als Basis Equal-Weight; die Zielgewichte sind nur eingeschränkt aussagekräftig.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-muted/30 p-3">
          <div className="text-[11px] text-muted-foreground">HHI</div>
          <div className="text-base font-semibold tabular-nums" data-testid="text-watchlist-hhi">{result.concentration?.hhi.toFixed(3) ?? "—"}</div>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <div className="text-[11px] text-muted-foreground">Effective-N</div>
          <div className="text-base font-semibold tabular-nums" data-testid="text-watchlist-effective-n">{result.concentration?.effectiveN.toFixed(2) ?? "—"}</div>
        </div>
        <div className="col-span-2 rounded-lg bg-muted/30 p-3 md:col-span-1">
          <div className="text-[11px] text-muted-foreground">CAPM maxWeight</div>
          <div className="text-base font-semibold tabular-nums">{formatPercent(result.effectiveMaxWeight, 0)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-left">Ticker</th>
              <th className="px-2 py-2 text-right">Zielgewicht CAPM</th>
              <th className="px-2 py-2 text-right">Kelly-Hinweis</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map(row => (
              <tr key={row.ticker} className="border-b border-border/30">
                <td className="px-2 py-2 font-mono font-medium">{row.ticker}</td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums" data-testid={`text-watchlist-weight-${row.ticker}`}>{formatPercent(row.weightCapm)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatPercent(row.kelly?.fCapped)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {result.flags.length > 0 && (
        <ul className="space-y-1 border-t border-border/30 pt-2 text-[10px] text-muted-foreground">
          {result.flags.map((flag, index) => (
            <li key={index} className="flex gap-1">
              <span className="text-amber-500">⚠</span><span>{flag}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Effizienzlinie (Phase 5, additiv) */}
      <EfficientFrontierPanel
        tickers={tickers}
        historicalPricesByTicker={historicalPricesByTicker}
        currentWeights={frontierCurrentWeights}
      />
    </div>
  );
}

export default function WatchlistPortfolioPanel({ policy }: { policy: PortfolioPolicy }) {
  const [entries, setEntries] = useState<WatchlistEntry[]>(() => loadWatchlist());
  const [analysisByTicker, setAnalysisByTicker] = useState<Record<string, StockAnalysis | undefined>>({});
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const requestedTickers = useRef(new Set<string>());

  useEffect(() => {
    const syncWatchlist = () => setEntries(loadWatchlist());
    window.addEventListener("aktienanalyst-watchlist-changed", syncWatchlist);
    return () => window.removeEventListener("aktienanalyst-watchlist-changed", syncWatchlist);
  }, []);

  useEffect(() => {
    const tickers = Array.from(new Set(entries.map(entry => entry.ticker.trim().toUpperCase()).filter(Boolean)));
    tickers.forEach(ticker => {
      if (requestedTickers.current.has(ticker)) return;
      requestedTickers.current.add(ticker);
      setLoadingTickers(previous => new Set(previous).add(ticker));
      void (async () => {
        try {
          const response = await apiRequest("POST", "/api/analyze", { ticker, useLLM: false });
          if (!response.ok) return;
          const analysis: StockAnalysis = await response.json();
          setAnalysisByTicker(previous => ({ ...previous, [ticker]: analysis }));
        } catch {
          // Die Engine zeigt dann transparent den Historien-Hinweis statt
          // synthetische Kursdaten anzunehmen.
        } finally {
          setLoadingTickers(previous => {
            const next = new Set(previous);
            next.delete(ticker);
            return next;
          });
        }
      })();
    });
  }, [entries]);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="status-watchlist-empty">
        Noch leer — nutze &apos;Zur Watchlist&apos; in der Analyse oder im Researcher
      </p>
    );
  }

  const uniqueTickerCount = new Set(entries.map(entry => entry.ticker.toUpperCase())).size;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Auto-Basket aus allen &bdquo;Zur Watchlist&ldquo;-Einträgen. P1 bleibt unabhängig und unverändert.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="px-2 py-2 text-left">Ticker</th>
              <th className="px-2 py-2 text-left">Name</th>
              <th className="px-2 py-2 text-left">Quelle</th>
              <th className="px-2 py-2 text-right">Score</th>
              <th className="px-2 py-2 text-right"><span className="sr-only">Entfernen</span></th>
            </tr>
          </thead>
          <tbody>
            {entries.map(entry => (
              <tr key={`${entry.ticker}-${entry.source}`} className="border-b border-border/30">
                <td className="px-2 py-2 font-mono font-medium text-primary">{entry.ticker}</td>
                <td className="max-w-[18rem] truncate px-2 py-2 text-foreground/70">{entry.name ?? "—"}</td>
                <td className="px-2 py-2 capitalize text-foreground/60">{entry.source}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums">{entry.score ?? "—"}</td>
                <td className="px-2 py-2 text-right">
                  <button
                    type="button"
                    className="rounded p-1 text-foreground/40 transition-colors hover:bg-red-500/10 hover:text-red-500"
                    title={`${entry.ticker} aus Watchlist entfernen`}
                    aria-label={`${entry.ticker} aus Watchlist entfernen`}
                    data-testid={`button-remove-watchlist-${entry.ticker}-${entry.source}`}
                    onClick={() => removeWatchlistEntry(entry.ticker, entry.source)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground" data-testid="text-watchlist-count">
        {entries.length} Einträge · {uniqueTickerCount} eindeutige Ticker
      </p>
      <WatchlistBasketResult
        entries={entries}
        policy={policy}
        analysisByTicker={analysisByTicker}
        loadingTickers={loadingTickers}
      />
    </div>
  );
}
