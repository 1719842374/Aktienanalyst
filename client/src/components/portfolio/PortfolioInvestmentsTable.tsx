/**
 * PortfolioInvestmentsTable — Positions-Tracker (Ticket 10.08.2026, Teil A,
 * Screen 2 "Investments"). Eigenstaendige Komponente fuer PortfolioPage.tsx.
 *
 * Analyse-Spalte: Deep-Link zur Aktienanalyse des Tickers (/#/?ticker=XXX,
 * siehe App.tsx-Routing) -- kein Voll-Refresh erzwungen, der Analyse-Cache
 * des Ziel-Tickers wird beim Laden dort normal genutzt.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { Search, X, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { PortfolioPosition, PositionSide } from "@/lib/portfolio/positions";
import { computePositionPerformance, computeClosedPositionPerformance } from "@/lib/portfolio/positions";

function fmtEur(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
}
function fmtPct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
}

interface TickerSearchResult { ticker: string; name: string; exchange?: string }

/** Kompakte, eigenstaendige Ticker-Autocomplete fuer "Position hinzufuegen" --
 * bewusst NICHT TickerSearch.tsx wiederverwendet (fragile Datei, siehe
 * stock-analyst-regression-guard: "Only style changes. Never replace with
 * another component" -- das gilt auch in die andere Richtung: TickerSearch
 * nicht fuer einen strukturell anderen Zweck zweckentfremden). */
function AddPositionTickerInput({ onSelect }: { onSelect: (ticker: string, name?: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TickerSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  async function runSearch(query: string) {
    if (query.trim().length < 1) { setResults([]); setOpen(false); return; }
    setSearching(true);
    try {
      const res = await apiRequest("GET", `/api/search-ticker?q=${encodeURIComponent(query.trim())}`);
      const data = await res.json();
      // /api/search-ticker liefert { results: [...] }, kein bares Array.
      const list = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : [];
      setResults(list.filter((r: TickerSearchResult & { unavailable?: boolean }) => !r.unavailable).slice(0, 8));
      setOpen(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="relative w-48">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); runSearch(e.target.value); }}
          onFocus={() => q && setOpen(true)}
          placeholder="Ticker suchen…"
          className="w-full text-xs bg-muted/30 border border-border/50 rounded-md pl-7 pr-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-20 top-full mt-1 w-full bg-card border border-border rounded-md shadow-lg max-h-52 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.ticker}
              className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted/50 flex items-center justify-between gap-2"
              onClick={() => { onSelect(r.ticker, r.name); setQ(""); setResults([]); setOpen(false); }}
            >
              <span className="font-mono font-medium">{r.ticker}</span>
              <span className="text-muted-foreground truncate">{r.name}</span>
            </button>
          ))}
        </div>
      )}
      {searching && <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">…</div>}
    </div>
  );
}

export default function PortfolioInvestmentsTable({
  positions,
  lastPriceByTicker,
  cacheStatusByTicker,
  onAddPosition,
  onUpdatePosition,
  onClosePosition,
  onDeletePosition,
}: {
  positions: PortfolioPosition[];
  lastPriceByTicker: Record<string, number | null | undefined>;
  cacheStatusByTicker: Record<string, { cached: boolean; generatedAt?: string | null }>;
  onAddPosition: (ticker: string, name?: string) => void;
  onUpdatePosition: (id: string, patch: Partial<PortfolioPosition>) => void;
  onClosePosition: (id: string, exitPrice: number) => void;
  onDeletePosition: (id: string) => void;
}) {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [directionFilter, setDirectionFilter] = useState<"all" | "long" | "short">("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "closed" | "all">("open");

  const filtered = positions.filter(p => {
    if (search && !p.ticker.toLowerCase().includes(search.toLowerCase()) && !(p.name ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    if (directionFilter !== "all" && p.side !== directionFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  function goToAnalysis(ticker: string) {
    // Deep-Link zur Aktienanalyse (App.tsx-Root-Route liest ?ticker= beim
    // Laden). Analyse-Cache des Ziel-Tickers wird dort normal verwendet --
    // kein erzwungener Voll-Refresh von hier aus.
    setLocation(`/?ticker=${encodeURIComponent(ticker)}`);
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold">Investments</h3>
        <AddPositionTickerInput onSelect={onAddPosition} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen"
            className="w-full text-xs bg-muted/30 border border-border/50 rounded-md pl-7 pr-2 py-1.5"
          />
        </div>
        <select className="text-xs bg-muted/30 border border-border/50 rounded-md px-2 py-1.5" value={directionFilter} onChange={e => setDirectionFilter(e.target.value as any)}>
          <option value="all">Long/Short</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select className="text-xs bg-muted/30 border border-border/50 rounded-md px-2 py-1.5" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
          <option value="open">Offene Investments</option>
          <option value="closed">Geschlossene Investments</option>
          <option value="all">Alle</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] text-muted-foreground uppercase tracking-wide border-b border-border/50">
              <th className="text-left py-2 px-2">Werte</th>
              <th className="text-right py-2 px-2">Volumen</th>
              <th className="text-left py-2 px-2">Einstieg</th>
              <th className="text-right py-2 px-2">Stopp</th>
              <th className="text-right py-2 px-2">Kurs</th>
              <th className="text-right py-2 px-2">Performance</th>
              <th className="text-center py-2 px-2">Analyse</th>
              <th className="text-center py-2 px-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-muted-foreground text-xs">
                  Keine Positionen — Ticker oben hinzufügen.
                </td>
              </tr>
            )}
            {filtered.map(p => {
              const lastPrice = lastPriceByTicker[p.ticker.toUpperCase()];
              const perf = p.status === "closed" ? computeClosedPositionPerformance(p) : computePositionPerformance(p.entryPrice, lastPrice, p.side);
              const cacheStatus = cacheStatusByTicker[p.ticker.toUpperCase()];
              return (
                <tr key={p.id} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold shrink-0">
                        {p.ticker.slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{p.name || p.ticker}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{p.ticker}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      value={p.qty}
                      onChange={e => onUpdatePosition(p.id, { qty: Number(e.target.value) || 0 })}
                      className="w-16 text-right bg-transparent border-b border-transparent hover:border-border focus:border-primary/50 focus:outline-none tabular-nums"
                    />
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={p.side}
                        onChange={e => onUpdatePosition(p.id, { side: e.target.value as PositionSide })}
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${p.side === "long" ? "bg-emerald-500/15 text-emerald-500" : "bg-red-500/15 text-red-500"}`}
                      >
                        <option value="long">LONG</option>
                        <option value="short">SHORT</option>
                      </select>
                      <span>Ø</span>
                      <input
                        type="number"
                        value={p.entryPrice}
                        onChange={e => onUpdatePosition(p.id, { entryPrice: Number(e.target.value) || 0 })}
                        className="w-16 bg-transparent border-b border-transparent hover:border-border focus:border-primary/50 focus:outline-none tabular-nums"
                      />
                    </div>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <input
                      type="number"
                      value={p.stopPrice ?? ""}
                      onChange={e => onUpdatePosition(p.id, { stopPrice: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder="—"
                      className="w-16 text-right bg-transparent border-b border-transparent hover:border-border focus:border-primary/50 focus:outline-none tabular-nums placeholder:text-muted-foreground/40"
                    />
                  </td>
                  <td className="py-2 px-2 text-right tabular-nums">{lastPrice != null ? fmtEur(lastPrice) : "n/a"}</td>
                  <td className="py-2 px-2 text-right">
                    <span className={`font-semibold tabular-nums ${perf == null ? "text-muted-foreground" : perf >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      {perf == null ? "n/a" : `Ø ${fmtPct(perf)}`}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <button
                      onClick={() => goToAnalysis(p.ticker)}
                      className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      title={cacheStatus?.cached ? `Cache vom ${cacheStatus.generatedAt ? new Date(cacheStatus.generatedAt).toLocaleString("de-DE") : "?"}` : "Noch nicht analysiert"}
                    >
                      {cacheStatus?.cached ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3 opacity-40" />}
                      →
                    </button>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {p.status === "open" && (
                        <button
                          title="Position schließen"
                          onClick={() => { const exit = lastPrice ?? p.entryPrice; onClosePosition(p.id, exit); }}
                          className="text-[10px] text-muted-foreground hover:text-amber-400 transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        title="Position löschen"
                        onClick={() => onDeletePosition(p.id)}
                        className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
