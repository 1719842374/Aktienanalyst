/**
 * Stocks row above the liquidity index.
 * Spec WORK_LIQUIDITY_INDEX_STOCKS_VELOCITY §6.
 * GET /api/researcher/liquidity?region= — does not replace the US C2 panel.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

type Region = "US" | "EU" | "ASIA";

interface RegionalStocks {
  debtGdpPct: number | null;
  bondMarketBn: number | null;
  bondMarketGdpPct: number | null;
  realRatePct: number | null;
  tHalfYears: number | null;
  velocity: number | null;
  velocityZ: number | null;
  excessMoneyGrowth: number | null;
  fiscalTrend: number | null;
  moneyTrend: number | null;
  pricedIn: number | null;
  unpricedPvBn: number | null;
  available: { debt: boolean; bonds: boolean; real: boolean; vel: boolean; pi: boolean };
}

interface BooksPayload {
  region: Region;
  stocks?: RegionalStocks;
  error?: string;
}

function fmt(x: number | null, d = 1, suffix = ""): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${x.toFixed(d)}${suffix}`;
}

export function RegionalStocksStrip({ region }: { region: Region }) {
  const [data, setData] = useState<BooksPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
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
  const piMissing = stocks != null && stocks.available.pi === false;

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
      {stocks && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]" data-testid="row-regional-stocks">
            <Cell label="Debt/GDP" value={fmt(stocks.debtGdpPct, 1, " %")} />
            <Cell label="Bondmarkt" value={stocks.bondMarketBn == null ? "n/a" : `${fmt(stocks.bondMarketBn, 0)} · ${fmt(stocks.bondMarketGdpPct, 1, " % BIP")}`} />
            <Cell label="Realzins r" value={fmt(stocks.realRatePct, 2, " %")} />
            <Cell label="Velocity" value={fmt(stocks.velocity, 3)} />
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]" data-testid="row-regional-trends">
            <Cell label="Fiscal trend" value={fmt(stocks.fiscalTrend, 0)} />
            <Cell label="Geldtrend" value={fmt(stocks.moneyTrend, 0)} />
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]" data-testid="row-regional-pi">
            <Cell
              label="π"
              value={stocks.pricedIn == null ? "n/a" : fmt(stocks.pricedIn, 2)}
              warn={piMissing}
              testId="text-priced-in"
            />
            <Cell label="T½" value={fmt(stocks.tHalfYears, 1, " J")} testId="text-thalf" />
            <Cell label="V" value={fmt(stocks.velocity, 3)} testId="text-velocity" />
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ label, value, warn, testId }: { label: string; value: string; warn?: boolean; testId?: string }) {
  return (
    <div className={`rounded-md border p-2 ${warn ? "border-amber-300 bg-amber-400/30" : "border-border/30 bg-background/40"}`}>
      <div className={`text-[9px] uppercase tracking-wider ${warn ? "text-amber-100" : "text-foreground/40"}`}>{label}</div>
      <div className={`text-[12px] font-mono mt-0.5 ${warn ? "text-amber-50" : "text-foreground/85"}`} data-testid={testId}>{value}</div>
    </div>
  );
}
