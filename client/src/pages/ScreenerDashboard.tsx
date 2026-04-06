import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Search, TrendingUp, TrendingDown, Users, DollarSign, ArrowUpDown, Filter, RefreshCw, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

interface ScreenedStock {
  ticker: string;
  name: string;
  price: number;
  marketCap: number;
  pe: number;
  forwardPE: number;
  sector: string;
  beta: number;
  investorCount: number;
  investors: string[];
  totalValue: number;
  targetPrice: number;
  upside: number;
  downside: number;
  crv: number;
  crvPass: boolean;
  yearHigh: number;
  yearLow: number;
  fcfMargin: number;
}

interface ScreenerData {
  lastUpdated: string;
  totalInvestors: number;
  totalHoldings: number;
  screenedStocks: ScreenedStock[];
}

type SortField = "crv" | "investorCount" | "upside" | "pe" | "marketCap" | "price";

export default function ScreenerDashboard() {
  const [sortField, setSortField] = useState<SortField>("crv");
  const [sortAsc, setSortAsc] = useState(false);
  const [filterCRV, setFilterCRV] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  const { data, isLoading, error, refetch, isFetching } = useQuery<ScreenerData>({
    queryKey: ["/api/screener"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/screener");
      return res.json();
    },
    staleTime: 24 * 60 * 60 * 1000, // 24h cache
    retry: 1,
  });

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const stocks = (data?.screenedStocks || [])
    .filter(s => !filterCRV || s.crvPass)
    .filter(s => !searchFilter || s.ticker.toLowerCase().includes(searchFilter.toLowerCase()) || s.name.toLowerCase().includes(searchFilter.toLowerCase()))
    .sort((a, b) => {
      const va = a[sortField] ?? 0;
      const vb = b[sortField] ?? 0;
      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

  const formatMC = (v: number) => {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (v >= 1e9) return `$${(v / 1e9).toFixed(0)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toFixed(0)}`;
  };

  const formatVal = (v: number) => {
    if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
    return `$${v.toFixed(0)}`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-card/95 backdrop-blur-sm border-b border-border px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Search className="w-5 h-5 text-primary" />
            <h1 className="text-sm font-bold tracking-tight">Stock Screener</h1>
          </div>
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded">
            13F Star-Investoren + CRV
          </span>
        </div>
        <div className="flex items-center gap-2">
          <a href="/#/" className="text-xs text-muted-foreground hover:text-foreground transition-colors">&larr; Aktien</a>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-4 py-6 space-y-4">
        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
            <div className="text-center">
              <h2 className="text-sm font-semibold">13F-Holdings werden geladen...</h2>
              <p className="text-xs text-muted-foreground mt-1">
                SEC EDGAR Filings von 14 Star-Investoren abrufen + Bewertung berechnen.
                <br />Erster Lauf dauert ~2-3 Minuten (wird dann 24h gecacht).
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-center">
            <p className="text-sm text-red-500">Fehler beim Laden: {(error as any)?.message || 'Unbekannt'}</p>
            <button onClick={() => refetch()} className="mt-2 text-xs text-primary hover:underline">Erneut versuchen</button>
          </div>
        )}

        {data && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-card border border-border rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase">Star-Investoren</div>
                <div className="text-lg font-bold font-mono">{data.totalInvestors}</div>
                <div className="text-[9px] text-muted-foreground">13F-Filings analysiert</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase">Gescreent</div>
                <div className="text-lg font-bold font-mono">{data.screenedStocks.length}</div>
                <div className="text-[9px] text-muted-foreground">Top-Holdings bewertet</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase">CRV &ge; 3:1</div>
                <div className="text-lg font-bold font-mono text-emerald-500">{data.screenedStocks.filter(s => s.crvPass).length}</div>
                <div className="text-[9px] text-muted-foreground">Attraktives CRV</div>
              </div>
              <div className="bg-card border border-border rounded-lg p-3">
                <div className="text-[10px] text-muted-foreground uppercase">Aktualisiert</div>
                <div className="text-xs font-mono mt-1">{new Date(data.lastUpdated).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                <button onClick={() => refetch()} disabled={isFetching} className="text-[9px] text-primary hover:underline mt-0.5 flex items-center gap-1">
                  <RefreshCw className={`w-2.5 h-2.5 ${isFetching ? 'animate-spin' : ''}`} /> Neu laden
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Ticker oder Name..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-xs bg-muted/30 border border-border rounded-md w-48 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                onClick={() => setFilterCRV(!filterCRV)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
                  filterCRV ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-500' : 'border-border text-muted-foreground hover:text-foreground'
                }`}
              >
                <Filter className="w-3 h-3" />
                Nur CRV &ge; 3:1
              </button>
              <span className="text-[10px] text-muted-foreground ml-auto">{stocks.length} Ergebnisse</span>
            </div>

            {/* Main table */}
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">#</th>
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Aktie</th>
                      <th className="text-left py-2.5 px-3 font-medium text-muted-foreground">Sektor</th>
                      <SortHeader label="Investoren" field="investorCount" current={sortField} asc={sortAsc} onSort={handleSort} />
                      <SortHeader label="Kurs" field="price" current={sortField} asc={sortAsc} onSort={handleSort} />
                      <SortHeader label="MCap" field="marketCap" current={sortField} asc={sortAsc} onSort={handleSort} />
                      <SortHeader label="P/E" field="pe" current={sortField} asc={sortAsc} onSort={handleSort} />
                      <SortHeader label="Upside" field="upside" current={sortField} asc={sortAsc} onSort={handleSort} />
                      <SortHeader label="CRV" field="crv" current={sortField} asc={sortAsc} onSort={handleSort} />
                      <th className="text-center py-2.5 px-3 font-medium text-muted-foreground">Analyse</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {stocks.map((s, i) => (
                      <StockRow
                        key={s.ticker}
                        stock={s}
                        rank={i + 1}
                        expanded={expandedRow === s.ticker}
                        onToggle={() => setExpandedRow(expandedRow === s.ticker ? null : s.ticker)}
                        formatMC={formatMC}
                        formatVal={formatVal}
                      />
                    ))}
                    {stocks.length === 0 && (
                      <tr><td colSpan={10} className="py-8 text-center text-muted-foreground">Keine Ergebnisse</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Disclaimer */}
            <div className="text-[9px] text-muted-foreground/50 text-center">
              Daten basieren auf SEC 13F-HR Filings (45 Tage Verzögerung). CRV ist ein Quick-Screen basierend auf Analyst PT und historischem Drawdown — keine Anlageberatung.
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function SortHeader({ label, field, current, asc, onSort }: {
  label: string; field: SortField; current: SortField; asc: boolean;
  onSort: (f: SortField) => void;
}) {
  const active = current === field;
  return (
    <th
      className="text-right py-2.5 px-3 font-medium text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none"
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && (asc ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />)}
        {!active && <ArrowUpDown className="w-2.5 h-2.5 opacity-30" />}
      </span>
    </th>
  );
}

function StockRow({ stock: s, rank, expanded, onToggle, formatMC, formatVal }: {
  stock: ScreenedStock; rank: number; expanded: boolean;
  onToggle: () => void; formatMC: (v: number) => string; formatVal: (v: number) => string;
}) {
  return (
    <>
      <tr className={`hover:bg-muted/10 transition-colors ${s.crvPass ? '' : 'opacity-70'}`}>
        <td className="py-2 px-3 font-mono text-muted-foreground">{rank}</td>
        <td className="py-2 px-3">
          <button onClick={onToggle} className="flex items-center gap-2 group">
            <div>
              <span className="font-semibold text-primary group-hover:underline">{s.ticker}</span>
              <div className="text-[9px] text-muted-foreground truncate max-w-[140px]">{s.name}</div>
            </div>
            {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
          </button>
        </td>
        <td className="py-2 px-3 text-[10px] text-muted-foreground">{s.sector}</td>
        <td className="py-2 px-3 text-right">
          <span className="inline-flex items-center gap-1 text-amber-500 font-semibold">
            <Users className="w-3 h-3" /> {s.investorCount}
          </span>
        </td>
        <td className="py-2 px-3 text-right font-mono tabular-nums">${s.price.toFixed(2)}</td>
        <td className="py-2 px-3 text-right font-mono tabular-nums text-muted-foreground">{formatMC(s.marketCap)}</td>
        <td className="py-2 px-3 text-right font-mono tabular-nums">{s.pe > 0 ? s.pe.toFixed(1) : 'N/A'}</td>
        <td className={`py-2 px-3 text-right font-mono tabular-nums font-semibold ${s.upside > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
          {s.upside > 0 ? '+' : ''}{s.upside.toFixed(1)}%
        </td>
        <td className="py-2 px-3 text-right">
          <span className={`inline-block px-2 py-0.5 rounded font-bold font-mono tabular-nums text-[10px] ${
            s.crv >= 3 ? 'bg-emerald-500/15 text-emerald-500' :
            s.crv >= 2 ? 'bg-amber-500/15 text-amber-500' :
            'bg-red-500/15 text-red-500'
          }`}>
            {s.crv.toFixed(1)}:1
          </span>
        </td>
        <td className="py-2 px-3 text-center">
          <a
            href={`/#/?ticker=${s.ticker}`}
            onClick={(e) => { e.preventDefault(); window.location.hash = '/'; setTimeout(() => { const inp = document.querySelector('input'); if (inp) { (inp as any).value = s.ticker; const btn = document.querySelector('[data-testid="button-analyze"]') as any; if (btn) btn.click(); } }, 100); }}
            className="text-primary hover:underline text-[10px]"
          >
            <ExternalLink className="w-3 h-3 inline" /> DCF
          </a>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-muted/10 px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[10px]">
              <div>
                <span className="text-muted-foreground">Analyst Target:</span>
                <span className="ml-1 font-mono font-semibold">${s.targetPrice.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">52W Range:</span>
                <span className="ml-1 font-mono">${s.yearLow.toFixed(0)} - ${s.yearHigh.toFixed(0)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Beta:</span>
                <span className="ml-1 font-mono">{s.beta.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Fwd P/E:</span>
                <span className="ml-1 font-mono">{s.forwardPE > 0 ? s.forwardPE.toFixed(1) : 'N/A'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Downside-Risiko:</span>
                <span className="ml-1 font-mono text-red-500">-{s.downside.toFixed(1)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Gesamtwert (13F):</span>
                <span className="ml-1 font-mono">{formatVal(s.totalValue)}</span>
              </div>
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Investoren:</span>
                <span className="ml-1">{s.investors.join(', ')}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
