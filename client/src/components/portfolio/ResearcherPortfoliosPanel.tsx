/**
 * ResearcherPortfoliosPanel — P3, vollständig von P1 und P2 getrennt.
 *
 * Liest ausschließlich Watchlist-Einträge mit source="researcher" und bildet
 * daraus getrennte automatische Baskets je Researcher-Region. Historische
 * Kurse werden wie bei P2 über /api/analyze geladen; die Gewichtung bleibt in
 * computePortfolioFromTickers() und verändert keine manuellen Positionen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, Loader2, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  computePortfolioFromTickers,
  MIN_POSITIONS_FOR_OPTIMIZATION,
} from "@/lib/portfolio/engine";
import {
  groupResearcherByRegion,
  loadWatchlist,
  removeWatchlistEntry,
  type PortfolioRegion,
  type WatchlistEntry,
} from "@/lib/portfolio/watchlist";
import type { PortfolioPolicy } from "@/lib/portfolio/positions";
import type { StockAnalysis } from "../../../../shared/schema";

type RegionTab = "ALL" | PortfolioRegion;

const REGION_TABS: Array<{ id: RegionTab; label: string }> = [
  { id: "ALL", label: "Alle" },
  { id: "US", label: "USA" },
  { id: "EU", label: "EU" },
  { id: "ASIA", label: "China/Asien" },
  { id: "MIXED", label: "Mixed" },
];

const REGION_LABELS: Record<PortfolioRegion, string> = {
  US: "USA",
  EU: "EU",
  ASIA: "China/Asien",
  MIXED: "Mixed",
};

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

function ResearcherRegionBasket({
  region,
  entries,
  policy,
  analysisByTicker,
  loadingTickers,
}: {
  region: PortfolioRegion;
  entries: WatchlistEntry[];
  policy: PortfolioPolicy;
  analysisByTicker: Record<string, StockAnalysis | undefined>;
  loadingTickers: Set<string>;
}) {
  const tickers = useMemo(
    () => Array.from(new Set(entries.map(entry => entry.ticker.trim().toUpperCase()).filter(Boolean))),
    [entries],
  );
  const isLoading = tickers.some(ticker => loadingTickers.has(ticker));

  const result = useMemo(() => {
    const historicalPricesByTicker: Record<string, Array<{ date: string; close: number }> | undefined> = {};
    const scoreByTicker: Record<string, number | null | undefined> = {};

    for (const entry of entries) {
      const ticker = entry.ticker.toUpperCase();
      historicalPricesByTicker[ticker] = analysisByTicker[ticker]?.historicalPrices
        ?.map(point => ({ date: point.date, close: point.close }));
      if (entry.score != null) {
        scoreByTicker[ticker] = Math.max(scoreByTicker[ticker] ?? -Infinity, entry.score);
      }
    }

    return computePortfolioFromTickers(tickers, policy, {
      historicalPricesByTicker,
      scoreByTicker,
    });
  }, [analysisByTicker, entries, policy, tickers]);

  if (tickers.length < MIN_POSITIONS_FOR_OPTIMIZATION) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid={`status-researcher-${region.toLowerCase()}-minimum-tickers`}>
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          {tickers.length === 0
            ? `Noch keine Researcher-Ticker für ${REGION_LABELS[region]}.`
            : "Noch 1 weiterer Ticker für die automatische Gewichtung nötig."}
        </p>
      </div>
    );
  }

  if (result.status !== "ok") {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground" data-testid={`status-researcher-${region.toLowerCase()}-insufficient-history`}>
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
    <div className="mt-4 space-y-3 rounded-xl border border-border bg-card p-4" data-testid={`panel-researcher-${region.toLowerCase()}-weighting`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Automatische Ziel-Gewichtung</h3>
          <p className="text-[11px] text-muted-foreground" data-testid={`text-researcher-${region.toLowerCase()}-weighting-mode`}>
            {result.mode ? MODE_LABELS[result.mode] : "—"} · CAPM-Basket und separater Kelly-Hinweis
          </p>
        </div>
        {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Kursdaten werden aktualisiert" />}
      </div>

      {result.fallbackReason === "solve_failed" && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400" data-testid={`status-researcher-${region.toLowerCase()}-solve-failed`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>Die Kovarianzmatrix konnte nicht stabil gelöst werden. Die Berechnung verwendet als Basis Equal-Weight; die Zielgewichte sind nur eingeschränkt aussagekräftig.</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="rounded-lg bg-muted/30 p-3">
          <div className="text-[11px] text-muted-foreground">HHI</div>
          <div className="text-base font-semibold tabular-nums" data-testid={`text-researcher-${region.toLowerCase()}-hhi`}>{result.concentration?.hhi.toFixed(3) ?? "—"}</div>
        </div>
        <div className="rounded-lg bg-muted/30 p-3">
          <div className="text-[11px] text-muted-foreground">Effective-N</div>
          <div className="text-base font-semibold tabular-nums" data-testid={`text-researcher-${region.toLowerCase()}-effective-n`}>{result.concentration?.effectiveN.toFixed(2) ?? "—"}</div>
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
                <td className="px-2 py-2 text-right font-semibold tabular-nums" data-testid={`text-researcher-${region.toLowerCase()}-weight-${row.ticker}`}>{formatPercent(row.weightCapm)}</td>
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
    </div>
  );
}

function ResearcherRegionPanel({
  region,
  entries,
  policy,
  analysisByTicker,
  loadingTickers,
}: {
  region: PortfolioRegion;
  entries: WatchlistEntry[];
  policy: PortfolioPolicy;
  analysisByTicker: Record<string, StockAnalysis | undefined>;
  loadingTickers: Set<string>;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-muted/[0.08] p-3" data-testid={`panel-researcher-region-${region.toLowerCase()}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{REGION_LABELS[region]}</h3>
        <span className="text-[10px] text-muted-foreground">{entries.length} {entries.length === 1 ? "Eintrag" : "Einträge"}</span>
      </div>

      {entries.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="px-2 py-2 text-left">Ticker</th>
                <th className="px-2 py-2 text-left">Name</th>
                <th className="px-2 py-2 text-right">Score</th>
                <th className="px-2 py-2 text-right"><span className="sr-only">Entfernen</span></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.ticker} className="border-b border-border/30">
                  <td className="px-2 py-2 font-mono font-medium text-primary">{entry.ticker}</td>
                  <td className="max-w-[18rem] truncate px-2 py-2 text-foreground/70">{entry.name ?? "—"}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{entry.score ?? "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      className="rounded p-1 text-foreground/40 transition-colors hover:bg-red-500/10 hover:text-red-500"
                      title={`${entry.ticker} aus Researcher-Portfolio entfernen`}
                      aria-label={`${entry.ticker} aus Researcher-Portfolio entfernen`}
                      data-testid={`button-remove-researcher-${region.toLowerCase()}-${entry.ticker}`}
                      onClick={() => removeWatchlistEntry(entry.ticker, "researcher")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ResearcherRegionBasket
        region={region}
        entries={entries}
        policy={policy}
        analysisByTicker={analysisByTicker}
        loadingTickers={loadingTickers}
      />
    </section>
  );
}

export default function ResearcherPortfoliosPanel({ policy }: { policy: PortfolioPolicy }) {
  const [entries, setEntries] = useState<WatchlistEntry[]>(() => loadWatchlist().filter(entry => entry.source === "researcher"));
  const [activeTab, setActiveTab] = useState<RegionTab>("ALL");
  const [analysisByTicker, setAnalysisByTicker] = useState<Record<string, StockAnalysis | undefined>>({});
  const [loadingTickers, setLoadingTickers] = useState<Set<string>>(new Set());
  const requestedTickers = useRef(new Set<string>());

  useEffect(() => {
    const syncResearcherEntries = () => setEntries(loadWatchlist().filter(entry => entry.source === "researcher"));
    window.addEventListener("aktienanalyst-watchlist-changed", syncResearcherEntries);
    return () => window.removeEventListener("aktienanalyst-watchlist-changed", syncResearcherEntries);
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
          // Ohne belastbare Historie zeigt die Engine transparent ihren Hinweis.
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

  const groups = useMemo(() => groupResearcherByRegion(entries), [entries]);
  const visibleRegions: PortfolioRegion[] = activeTab === "ALL"
    ? (["US", "EU", "ASIA", "MIXED"] as PortfolioRegion[])
    : [activeTab];

  return (
    <div className="space-y-3" data-testid="panel-researcher-portfolios">
      <p className="text-xs text-muted-foreground">
        P3 nutzt ausschließlich Einträge aus dem Researcher und bildet je Region einen eigenen Auto-Basket. P1 und P2 bleiben unabhängig.
      </p>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Researcher-Portfolio-Regionen">
        {REGION_TABS.map(tab => {
          const count = tab.id === "ALL" ? entries.length : groups[tab.id].length;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                isActive
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-border/60 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
              data-testid={`button-researcher-region-${tab.id.toLowerCase()}`}
            >
              {tab.label}
              <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[10px] font-mono tabular-nums">{count}</span>
            </button>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="status-researcher-empty">
          Noch leer — nutze &apos;Zur Watchlist&apos; im Researcher, um einen Ticker dem passenden Researcher-Portfolio hinzuzufügen.
        </p>
      ) : (
        <div className="space-y-3">
          {visibleRegions.map(region => (
            <ResearcherRegionPanel
              key={region}
              region={region}
              entries={groups[region]}
              policy={policy}
              analysisByTicker={analysisByTicker}
              loadingTickers={loadingTickers}
            />
          ))}
        </div>
      )}
    </div>
  );
}
