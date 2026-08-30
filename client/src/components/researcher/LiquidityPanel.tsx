/**
 * C2 Liquidity & Regime — self-fetching widget for Macro tab.
 * Spec WORK_RESEARCHER_LIQUIDITY_REGIME.md §3. GET /api/researcher/liquidity
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface LiquidityPayload {
  walclBn: number | null;
  rrpBn: number | null;
  tgaBn: number | null;
  netLiquidityBn: number | null;
  netLiquidityDelta13wBn: number | null;
  m2YoY: number | null;
  velocity: number | null;
  excessMoneyGrowth: number | null;
  regimeScore: number;
  regimeLabel: "expansiv" | "neutral" | "restriktiv";
  asOf: string;
  source: string;
  dataQuality?: { walcl: boolean; rrp: boolean; tga: boolean; m2: boolean };
  _cached?: boolean;
  _cacheAge?: number;
}

const LAMP: Record<string, string> = {
  expansiv: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  neutral: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  restriktiv: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

function fmt(x: number | null, d = 1, suffix = ""): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${x.toFixed(d)}${suffix}`;
}

export function LiquidityPanel() {
  const [data, setData] = useState<LiquidityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await apiRequest("GET", `/api/researcher/liquidity${q}`);
      const json = await res.json();
      if (json?.error) throw new Error(json.error);
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Liquidity fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(false); }, []);

  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-3" data-testid="panel-liquidity-regime">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-foreground/80">Liquidity & Regime</div>
          {data && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              Score {data.regimeScore} · Net {fmt(data.netLiquidityBn, 0)} Mrd. USD
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${LAMP[data.regimeLabel] || ""}`}>
              {data.regimeLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="px-2 py-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-muted/40 text-[10px] flex items-center gap-1"
            data-testid="button-refresh-liquidity"
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Aktualisieren
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {loading && !data && (
        <div className="flex items-center gap-2 py-4 text-[11px] text-foreground/50">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lade FRED WALCL/RRP/TGA…
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Metric label="WALCL" value={fmt(data.walclBn, 0, " Mrd.")} />
            <Metric label="RRP" value={fmt(data.rrpBn, 0, " Mrd.")} />
            <Metric label="TGA" value={fmt(data.tgaBn, 0, " Mrd.")} />
            <Metric label="Netto 13W" value={fmt(data.netLiquidityDelta13wBn, 0, " Mrd.")} />
            <Metric label="M2 YoY" value={fmt(data.m2YoY, 2, " %")} />
            <Metric label="Velocity" value={fmt(data.velocity, 3)} />
            <Metric label="Excess Money" value={fmt(data.excessMoneyGrowth, 2, " pp")} />
            <Metric label="Regime" value={`${data.regimeScore}`} />
          </div>
          <p className="text-[11px] text-foreground/75 leading-relaxed">
            Aktuelles Liquiditätsregime: {data.regimeLabel} (Score {data.regimeScore}).
            {data.excessMoneyGrowth != null && data.excessMoneyGrowth > 0
              ? " Excess Money Growth positiv. Unterstützt eher Growth/Duration."
              : data.excessMoneyGrowth != null && data.excessMoneyGrowth < 0
                ? " Excess Money Growth negativ. Eher restriktiv für Multiples."
                : " Plumbing aus Fed-Bilanz (WALCL − RRP − TGA)."}
          </p>
          <div className="text-[10px] text-foreground/40" data-testid="text-liquidity-source">
            {data.source} · Stand {data.asOf}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-background/40 border border-border/30 p-2">
      <div className="text-[9px] uppercase tracking-wider text-foreground/40">{label}</div>
      <div className="text-[12px] font-mono text-foreground/85 mt-0.5">{value}</div>
    </div>
  );
}
