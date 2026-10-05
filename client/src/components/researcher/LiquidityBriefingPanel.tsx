/**
 * EZ/JP Velocity und APP/PEPP. Spec WORK_DATA_SOURCES_LIQUIDITY_BRIEFING.
 * GET /api/researcher/liquidity-briefing — kein zweiter US-M2V-Pfad.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { LiquidityBriefing } from "@shared/schema";

type BriefingPayload = LiquidityBriefing & { error?: string };

function fmt(x: number | null, d = 1, suffix = ""): string {
  if (x == null || !Number.isFinite(x)) return "n/a";
  return `${x.toFixed(d)}${suffix}`;
}

export function LiquidityBriefingPanel() {
  const [data, setData] = useState<BriefingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(refresh = false) {
    setLoading(true);
    setError(null);
    try {
      const q = refresh ? "?refresh=1" : "";
      const res = await apiRequest("GET", `/api/researcher/liquidity-briefing${q}`);
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Briefing fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(false); }, []);

  return (
    <div className="rounded-lg border border-border/40 bg-card/30 p-4 space-y-3" data-testid="panel-liquidity-briefing">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-foreground/80">Liquidität · Velocity, Realzins, Spillover</div>
          {data && (
            <div className="text-[11px] text-foreground/50 mt-0.5">
              V = NGDP / M · Stand {data.asOf}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          disabled={loading}
          className="px-2 py-1.5 rounded-md text-foreground/50 hover:text-foreground hover:bg-muted/40 text-[10px] flex items-center gap-1"
          data-testid="button-refresh-liquidity-briefing"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Aktualisieren
        </button>
      </div>

      {error && (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 p-2 text-[11px] text-rose-300 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {error}
        </div>
      )}
      {loading && !data && (
        <div className="flex items-center gap-2 py-4 text-[11px] text-foreground/50">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Lade EZB, BoJ, FRED, FiscalData…
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Metric label="EZ M3" value={fmt(data.eurozone.stockBn, 0, " Mrd. €")} />
            <Metric label="EZ M3 YoY" value={fmt(data.eurozone.yoy, 2, " %")} />
            <Metric label="EZ M2" value={fmt(data.eurozone.m2StockBn, 0, " Mrd. €")} testId="text-ez-m2" />
            <Metric label="EZ M1" value={fmt(data.eurozone.m1StockBn, 0, " Mrd. €")} testId="text-ez-m1" />
            <Metric label="Velocity EZ" value={fmt(data.eurozone.velocity, 3)} testId="text-ez-velocity" />
            <Metric label="NGDP-Quartal EZ" value={data.eurozone.ngdpQuarter || "n/a"} />
            <Metric label="JP M2" value={fmt(data.japan.stockBn, 0, " Mrd. ¥")} />
            <Metric label="JP M2 YoY" value={fmt(data.japan.yoy, 2, " %")} />
            <Metric label="JP Geldbasis" value={fmt(data.japan.monetaryBaseTn, 3, " Bio. ¥")} testId="text-jp-mb" />
            <Metric label="JP Geldbasis YoY" value={fmt(data.japan.monetaryBaseYoy, 1, " %")} testId="text-jp-mb-yoy" />
            <Metric label="Velocity JP" value={fmt(data.japan.velocity, 3)} testId="text-jp-velocity" />
            <Metric label="NGDP-Quartal JP" value={data.japan.ngdpQuarter || "n/a"} />
            <Metric label="US M2V" value={fmt(data.us.velocity, 3)} testId="text-us-velocity" />
            <Metric label={`APP Netto ${data.app.period || ""}`.trim()} value={fmt(data.app.netBn, 3, " Mrd. €")} testId="text-app-net" />
            <Metric label="APP Bestand" value={fmt(data.app.holdingsBn, 3, " Mrd. €")} />
            <Metric label="APP kumuliert" value={fmt(data.app.cumulativeNetPurchasesBn, 1, " Mrd. €")} />
            <Metric label={`PEPP Netto ${data.pepp.period || ""}`.trim()} value={fmt(data.pepp.netBn, 3, " Mrd. €")} testId="text-pepp-net" />
            <Metric label="PEPP Bestand" value={fmt(data.pepp.holdingsBn, 1, " Mrd. €")} />
            <Metric label="PEPP kumuliert" value={fmt(data.pepp.cumulativeNetPurchasesBn, 1, " Mrd. €")} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Metric label="US Realzins DFII10" value={fmt(data.rates.usReal.value, 2, " %")} testId="text-us-real" />
            <Metric label="JP Realzins ex post" value={fmt(data.rates.jpRealExPost, 2, " %")} testId="text-jp-real" />
            <Metric label="CN 10y" value={fmt(data.rates.cn10y.value, 2, " %")} testId="text-cn-10y" />
            <Metric label="EM-Gewicht" value={`≤ ${data.em.weightCap.toFixed(2)}`} testId="text-em-weight" />
            <Metric label="T½ US" value={fmt(data.halfLife.usYears, 1, " J")} testId="text-thalf-us" />
            <Metric label="T½ JP" value={fmt(data.halfLife.jpYears, 1, " J")} testId="text-thalf-jp" />
            <Metric label="T½ EZ" value={fmt(data.halfLife.ezYears, 1, " J")} testId="text-thalf-ez" />
            <Metric label="IN 2y" value={fmt(data.rates.in2y.value, 2, " %")} testId="text-in-2y" />
            <Metric label="CN 7d/Policy" value={fmt(data.em.cnRr7d, 2, " %")} testId="text-cn-rr" />
            <Metric
              label="π"
              value={data.pricedIn.available ? fmt(data.pricedIn.pi, 2) : "n/a"}
              testId="text-priced-in"
              warn={!data.pricedIn.available}
            />
            <Metric label="EZ QT Δ" value={fmt(data.books.eu.qtNetBn, 1, " Mrd. €")} testId="text-qt-net" />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <Metric label="WALCL" value={fmt(data.books.us.walclBn, 0, " Mrd. $")} testId="text-walcl" />
            <Metric label="RRP" value={fmt(data.books.us.rrpBn, 1, " Mrd. $")} />
            <Metric label="TGA" value={fmt(data.books.us.tgaBn, 0, " Mrd. $")} />
            <Metric label="DFF Δ90T" value={fmt(data.books.us.dffDelta90, 2, " pp")} testId="text-dff-delta" />
            <Metric label="SOMA Bills" value={fmt(data.books.us.somaBillsMn, 0, " Mio. $")} />
            <Metric label="SOMA Notes" value={fmt(data.books.us.somaNotesBn, 0, " Mrd. $")} />
            <Metric label="MSPD Δ Bills" value={fmt(data.books.us.billsDiffBn, 1, " Mrd. $")} />
            <Metric label="Debt/GDP" value={fmt(data.books.us.debtGdp, 1, " %")} />
            <Metric label="WFS Einlagen" value={fmt(data.books.eu.wfsDepositsBn, 1, " Mrd. €")} testId="text-wfs" />
            <Metric label="BoJ Assets" value={fmt(data.books.jp.assetsTn, 2, " Bio. ¥")} testId="text-boj-assets" />
            <Metric label="PSPP Netto" value={fmt(data.app.psppNetBn, 3, " Mrd. €")} />
            <Metric label="PSPP Bestand" value={fmt(data.app.psppHoldingsBn, 1, " Mrd. €")} />
            <Metric label="US EMG" value={fmt(data.us.emg, 2, " pp")} />
          </div>

          <div className="text-[11px] text-foreground/70" data-testid="text-spillover">
            {data.spillover.map(row => (
              <span key={row.id} className="mr-3 inline-block">
                {row.id} {row.latest == null ? "n/a" : row.latest.toFixed(1)} {row.unit}
                {row.event ? " · |z|≥1" : ""}
              </span>
            ))}
          </div>

          <div className="text-[10px] text-foreground/50" data-testid="text-em-note">
            EM {data.em.tradeNote} CN-M2 {fmt(data.em.cnM2Yoy, 1, " %")} {data.em.cnM2AsOf || ""} · {data.em.cnM2Source}
            {" · "}IN 2y {fmt(data.em.in2y, 2, " %")} {data.em.in2yAsOf || ""} · {data.em.in2ySource}
            {" · "}CN policy {fmt(data.em.cnRr7d, 2, " %")} {data.em.cnRrAsOf || ""} · {data.em.cnRrSource}
            {" · "}CN 10y {data.rates.cn10y.source}
          </div>
          <div className="text-[10px] text-foreground/40" data-testid="text-liquidity-briefing-source">
            {data.sources.m3} · {data.sources.m2} · {data.sources.rates} · US V {data.us.source || "n/a"}
            {data.qra.usFrontendOnly ? ` · QRA bis ${data.qra.nextRelease}` : ""}
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, testId, warn }: { label: string; value: string; testId?: string; warn?: boolean }) {
  return (
    <div className={`rounded-md bg-background/40 border p-2 ${warn ? "border-amber-400/50" : "border-border/30"}`}>
      <div className="text-[9px] uppercase tracking-wider text-foreground/40">{label}</div>
      <div className={`text-[12px] font-mono mt-0.5 ${warn ? "text-amber-200" : "text-foreground/85"}`} data-testid={testId}>{value}</div>
    </div>
  );
}
