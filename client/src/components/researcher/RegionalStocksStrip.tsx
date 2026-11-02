/**
 * Stocks row above the liquidity index.
 * Spec WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY §6.
 * GET /api/researcher/liquidity?region= — does not replace the US C2 panel.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { formatRegionalStockTiles, type RegionalStocksDisplay, type StockTile } from "./regional-stocks-format";

type Region = "US" | "EU" | "ASIA";

interface RegionalStocks extends RegionalStocksDisplay {
  velocityZ: number | null;
  excessMoneyGrowth: number | null;
  unpricedPvBn: number | null;
  programAgeYears: number | null;
  available: { debt: boolean; bonds: boolean; real: boolean; vel: boolean; pi: boolean };
}

interface BooksPayload {
  region: Region;
  stocks?: RegionalStocks;
  error?: string;
}

export function RegionalStocksTiles({ stocks }: { stocks: RegionalStocksDisplay }) {
  const tiles = formatRegionalStockTiles(stocks);
  const levels = tiles.filter(tile => tile.row === "levels");
  const trends = tiles.filter(tile => tile.row === "trends");
  const pi = tiles.filter(tile => tile.row === "pi");
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]" data-testid="row-regional-stocks">
        {levels.map(tile => <Cell key={tile.label} tile={tile} />)}
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]" data-testid="row-regional-trends">
        {trends.map(tile => <Cell key={tile.label} tile={tile} />)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]" data-testid="row-regional-pi">
        {pi.map(tile => <Cell key={tile.label} tile={tile} />)}
      </div>
    </>
  );
}

export function RegionalStocksStrip({ region }: { region: Region }) {
  const [data, setData] = useState<BooksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiRequest("GET", `/api/researcher/liquidity?region=${region}`);
        const json = await res.json();
        if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
        if (!cancelled) setData(json);
      } catch (err: any) {
        if (!cancelled) {
          setData(null);
          setError(err?.message || "Stocks fehlgeschlagen");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [region]);

  const stocks = data?.stocks;

  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-2" data-testid="panel-regional-stocks">
      <div className="text-xs font-semibold text-foreground/80">Stocks · {region}</div>
      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {loading && !stocks && (
        <div className="flex items-center gap-2 py-2 text-[11px] text-foreground/50">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lade regionale Stocks…
        </div>
      )}
      {stocks && <RegionalStocksTiles stocks={stocks} />}
    </div>
  );
}

function Cell({ tile, warn }: { tile: StockTile; warn?: boolean }) {
  return (
    <div title={tile.title} className={`rounded-md border p-2 ${warn ? "border-amber-300 bg-amber-400/30" : "border-border/30 bg-background/40"}`}>
      <div className={`text-[9px] uppercase tracking-wider ${warn ? "text-amber-100" : "text-foreground/40"}`}>{tile.label}</div>
      <div className={`text-[12px] font-mono mt-0.5 ${warn ? "text-amber-50" : "text-foreground/85"}`} data-testid={tile.testId}>{tile.value}</div>
      {tile.hint ? (
        <div className={`text-[9px] mt-0.5 ${warn ? "text-amber-100/80" : "text-foreground/45"}`}>{tile.hint}</div>
      ) : null}
    </div>
  );
}
