/**
 * Regional liquidity index for #/researcher.
 * GET /api/researcher/liquidity?region=US|EU|ASIA — same route as the books payload.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import {
  fiscalOfferLine,
  formatLi,
  liquidityIndexPath,
  liquidityIndexTitle,
  listedSeries,
  type IndexSlot,
  type LiquidityRegion,
} from "./liquidity-index-panel";

interface Slot extends IndexSlot {
  id?: string;
  asOf?: string | null;
}

interface IndexPayload {
  asOf: string | null;
  li: number | null;
  label: "expansiv" | "neutral" | "restriktiv" | null;
  books: { M: Slot[]; F: Slot[] };
  money?: Slot[];
  discovered?: {
    qtLike?: boolean;
    qeLike?: boolean;
    rmpLike?: boolean;
  };
  source?: string;
  error?: string;
}

const LAMP: Record<string, string> = {
  expansiv: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  neutral: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  restriktiv: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const ROLE: Record<string, string> = {
  assets: "Assets",
  policyPortfolio: "Policy-Portfolio",
  drain: "Drain",
  govCash: "Gov-Cash",
  netIssuance: "Netto-Emission",
  buybacks: "Rückkauf",
  rate: "Zins",
  money: "Geldmenge",
};

function fmtX(x: number | null): string {
  if (x == null || !Number.isFinite(x)) return "n/v";
  return x.toFixed(1);
}

export function LiquidityIndexPanel({ region }: { region: LiquidityRegion }) {
  const [data, setData] = useState<IndexPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);

  async function load(refresh = false) {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    if (!refresh) setData(null);
    try {
      const res = await apiRequest("GET", liquidityIndexPath(region, refresh));
      const json = await res.json();
      if (request.current !== id) return;
      if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
      if (!json?.books?.M || !json?.books?.F) throw new Error("Index-Payload ohne Bücher");
      setData(json);
    } catch (err: any) {
      if (request.current !== id) return;
      setData(null);
      setError(err?.message || "Liquidity Index fehlgeschlagen");
    } finally {
      if (request.current === id) setLoading(false);
    }
  }

  useEffect(() => { void load(false); }, [region]);

  const money = data?.money ?? [];
  const series = data ? listedSeries({ books: data.books, money }) : [];
  const fiscal = data ? fiscalOfferLine(data.books.F) : "";

  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-3" data-testid="panel-liquidity-index">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-foreground/80">{liquidityIndexTitle(region)}</div>
          {data && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              LI {formatLi(data.li)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data?.label && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${LAMP[data.label] || ""}`}>
              {data.label}
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            disabled={loading}
            className="px-2 py-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-muted/40 text-[10px] flex items-center gap-1"
            data-testid="button-refresh-liquidity-index"
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
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lade Liquidity Index…
        </div>
      )}
      {data && (
        <>
          <div className="text-[10px] text-foreground/45" data-testid="text-liquidity-index-series">
            {series.join(" · ") || "keine Serie"}
          </div>
          <SlotGroup title="Buch M" slots={data.books.M} />
          <SlotGroup title="Buch F" slots={data.books.F} />
          <div className="text-[11px] text-foreground/70" data-testid="text-fiscal-offer">{fiscal}</div>
          {money.length > 0 && <SlotGroup title="Geld" slots={money} />}
          {data.discovered && (
            <div className="flex flex-wrap gap-2 text-[10px]" data-testid="row-liquidity-discovered">
              <Flag name="QT" on={!!data.discovered.qtLike} />
              <Flag name="QE" on={!!data.discovered.qeLike} />
              <Flag name="RMP" on={!!data.discovered.rmpLike} />
            </div>
          )}
          <div className="text-[10px] text-foreground/40" data-testid="text-liquidity-index-source">
            {data.source || "liqidx"} · Stand {data.asOf || "n/v"}
          </div>
        </>
      )}
    </div>
  );
}

function SlotGroup({ title, slots }: { title: string; slots: Slot[] }) {
  if (!slots.length) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-1">{title}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {slots.map(slot => (
          <div
            key={`${slot.role}-${(slot.series || []).join("-")}`}
            className="rounded-md bg-background/40 border border-border/30 p-2"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[9px] uppercase tracking-wider text-foreground/40">{ROLE[slot.role] || slot.role}</div>
              <div className={`text-[9px] px-1.5 py-0.5 rounded border ${slot.available ? "text-emerald-300 border-emerald-500/30" : "text-foreground/45 border-border/40"}`}>
                {slot.available ? "available" : "n/v"}
              </div>
            </div>
            <div className="text-[12px] font-mono mt-0.5 text-foreground/85">{(slot.series || []).join(", ")}</div>
            <div className="text-[10px] text-foreground/50 mt-0.5">s {slot.score == null ? "n/v" : slot.score} · x {fmtX(slot.x)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Flag({ name, on }: { name: string; on: boolean }) {
  return (
    <span className={`px-1.5 py-0.5 rounded border ${on ? "text-emerald-300 border-emerald-500/30" : "text-foreground/40 border-border/40"}`}>
      {name} {on ? "ja" : "nein"}
    </span>
  );
}
