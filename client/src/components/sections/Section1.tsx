import { useState } from "react";
import { SectionCard } from "../SectionCard";
import { addTickerToManualPortfolio, addTickerToWatchlist } from "@/lib/portfolio/portfolioBridge";
import { useLocation } from "wouter";
import type { StockAnalysis } from "../../../../shared/schema";
import { formatCurrency, formatLargeNumber, formatPercentNoSign, formatNumber } from "../../lib/formatters";
import { AlertTriangle, AlertCircle, Info, RefreshCw, Clock, Briefcase, ListPlus } from "lucide-react";
import { ThesisStrengthPanel } from "./ThesisStrengthPanel";

interface Props { data: StockAnalysis; onRefresh?: () => void }

export function Section1({ data, onRefresh }: Props) {
  const [, setLocation] = useLocation();
  const [flash, setFlash] = useState<string | null>(null);

  function showFlash(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash(null), 2500);
  }

  function handleAddPortfolio() {
    const r = addTickerToManualPortfolio(data.ticker, data.companyName);
    if (r.ok) showFlash(`${data.ticker} → Manuelles Portfolio (P1)`);
    else if (r.reason === "duplicate") showFlash(`${data.ticker} ist bereits im Portfolio`);
  }

  function handleAddWatchlist() {
    const r = addTickerToWatchlist(data.ticker, {
      name: data.companyName,
      source: "dashboard",
      score: (data as any).thesisStrengthScore ?? (data as any).overallScore ?? null,
    });
    if (r.ok) showFlash(`${data.ticker} → Watchlist (P2)`);
    else if (r.reason === "duplicate") showFlash(`${data.ticker} ist bereits auf der Watchlist`);
  }

  const ptUpside = ((data.analystPT.median - data.currentPrice) / data.currentPrice) * 100;

  function fmtAge(mins: number): string {
    if (mins < 1) return "gerade eben";
    if (mins < 60) return `${mins} Min.`;
    if (mins < 1440) return `${Math.round(mins / 60)} Std.`;
    return `${Math.round(mins / 1440)} Tage`;
  }

  const FRESH_CACHE_LIMIT_MIN = 60 * 24 * 7;
  const isFreshCache = !!data._cached && (data._cacheAge != null) && data._cacheAge < FRESH_CACHE_LIMIT_MIN;
  const isStaleCache = !!data._cached && !isFreshCache;

  return (
    <SectionCard number={1} title="DATENAKTUALITÄT & PLAUSIBILITÄT">
      {isStaleCache && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-start gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-400" />
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-amber-400">Offline-Daten (Cache)</span>
              {onRefresh && (
                <button onClick={onRefresh} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors">
                  <RefreshCw className="w-3 h-3" /> Aktualisieren
                </button>
              )}
            </div>
            <p className="text-[10px] text-foreground/60 mt-0.5">
              API nicht erreichbar — zeige gecachte Analyse vom {data._cacheDate ? new Date(data._cacheDate).toLocaleString("de-DE") : "?"}.
              {data._cacheAge != null && ` Alter: ${fmtAge(data._cacheAge)}.`}
              {" "}Kurse und Kennzahlen könnten veraltet sein.
            </p>
          </div>
        </div>
      )}

      {isFreshCache && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/70 mb-2">
          <Clock className="w-3 h-3" />
          <span>Gespeicherte Analyse — vor {fmtAge(data._cacheAge!)} erstellt{data._cachedAt ? ` (${new Date(data._cachedAt).toLocaleString("de-DE")})` : ""} · 0 Credits</span>
          {onRefresh && (
            <button onClick={onRefresh} className="ml-auto flex items-center gap-0.5 text-emerald-400/50 hover:text-emerald-400 transition-colors" title="Live-Daten neu laden (verbraucht Credits)">
              <RefreshCw className="w-3 h-3" /><span className="text-[10px]">Aktualisieren</span>
            </button>
          )}
        </div>
      )}

      {!data._cached && data.dataTimestamp && (
        <div className="flex items-center gap-1.5 text-[10px] text-foreground/35 mb-2">
          <Clock className="w-3 h-3" />
          <span>Live-Daten vom {new Date(data.dataTimestamp).toLocaleString("de-DE")}</span>
          {onRefresh && (
            <button onClick={onRefresh} className="ml-auto flex items-center gap-0.5 text-foreground/30 hover:text-foreground/50 transition-colors" title="Daten neu laden">
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </div>
      )}

      {data.consistencyWarnings && data.consistencyWarnings.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {data.consistencyWarnings.map((w, i) => {
            const isCrit = w.severity === "critical";
            const isWarn = w.severity === "warning";
            const bgCls = isCrit ? "bg-red-500/10 border-red-500/30" : isWarn ? "bg-amber-500/10 border-amber-500/30" : "bg-blue-500/8 border-blue-500/20";
            const iconCls = isCrit ? "text-red-400" : isWarn ? "text-amber-400" : "text-blue-400";
            const Icon = isCrit ? AlertCircle : isWarn ? AlertTriangle : Info;
            return (
              <div key={i} className={`rounded-lg border p-2.5 flex items-start gap-2 ${bgCls}`}>
                <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${iconCls}`} />
                <div>
                  <span className={`text-xs font-semibold ${iconCls}`}>{w.title}</span>
                  <p className="text-[10px] text-foreground/60 mt-0.5 leading-relaxed">{w.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data.currencyInfo?.converted && (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-start gap-2">
          <span className="text-base flex-shrink-0">💱</span>
          <div className="text-xs">
            <span className="font-semibold text-blue-400">Währungsumrechnung aktiv</span>
            <span className="text-foreground/70 ml-1">
              — Finanzdaten in {data.currencyInfo.reportedCurrency} gemeldet, umgerechnet zu USD
              ({data.currencyInfo.fxPair} = {data.currencyInfo.fxRate.toFixed(4)}).
              Alle Bewertungen und DCF-Berechnungen in USD.
            </span>
          </div>
        </div>
      )}

      {/* WORK_RESEARCHER_PORTFOLIO: P1 + P2 Direkt-Add */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button type="button" onClick={handleAddPortfolio}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-primary/15 text-primary hover:bg-primary/25 border border-primary/30 transition-colors"
          title="Als echte Position ins manuelle Portfolio (qty/entry editierbar)">
          <Briefcase className="w-3.5 h-3.5" /> Zum Portfolio
        </button>
        <button type="button" onClick={handleAddWatchlist}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium bg-muted/40 text-foreground/80 hover:bg-muted/60 border border-border/60 transition-colors"
          title="Auf Watchlist-Portfolio — auto-gewichtet, ohne qty">
          <ListPlus className="w-3.5 h-3.5" /> Zur Watchlist
        </button>
        <button type="button" onClick={() => setLocation("/portfolio")}
          className="text-[10px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline ml-1">
          Portfolio öffnen
        </button>
        {flash && <span className="text-[10px] text-emerald-400 ml-auto">{flash}</span>}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPI label="Price" value={formatCurrency(data.currentPrice)} sub={new Date(data.priceTimestamp).toLocaleString()} />
        <KPI label="Market Cap" value={formatLargeNumber(data.marketCap)} />
        <KPI label="Beta (5Y)" value={formatNumber(data.beta5Y)} />
        <KPI label="P/E" value={formatNumber(data.peRatio, 1)} sub={`Fwd: ${formatNumber(data.forwardPE, 1)}`} />
        <KPI label="EV/EBITDA" value={formatNumber(data.evEbitda, 1)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs">
        <div>
          <span className="text-muted-foreground">Nächster Earnings Call: </span>
          {data.nextEarningsDate ? (
            <span className="font-medium">{new Date(`${data.nextEarningsDate}T12:00:00`).toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric" })}{data.nextEarningsTime ? ` (${data.nextEarningsTime.toUpperCase()})` : ""}{data.nextEarningsIsEstimate ? " · geschätzt" : ""}</span>
          ) : <span className="text-muted-foreground">n/a</span>}
          {!data.nextEarningsDate && <p className="text-[10px] text-amber-400 mt-0.5">Kein bestätigter Earnings-Termin verfügbar</p>}
          <p className="text-[10px] text-muted-foreground mt-0.5">Zuletzt berichtet: {data.lastReportedQuarter ?? "n/a"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">FCF Yield: </span>
          <span className="font-mono font-medium">{data.fcfYield != null ? `${data.fcfYield.toFixed(1)}%` : "n/a"}</span>
          {data.fcfYieldYoyAvailable && data.fcfYieldYoyPp != null && (
            <span className={`ml-1.5 font-mono ${Math.abs(data.fcfYieldYoyPp) < 0.05 ? "text-muted-foreground" : data.fcfYieldYoyPp > 0 ? "text-emerald-400" : "text-red-400"}`}>
              (YoY {data.fcfYieldYoyPp > 0 ? "+" : ""}{data.fcfYieldYoyPp.toFixed(1)} pp)
            </span>
          )}
          {!data.fcfYieldYoyAvailable && <span className="ml-1.5 text-muted-foreground">(YoY n/a)</span>}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Metric</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            <Row label="EPS TTM" value={`$${formatNumber(data.epsTTM)}`} />
            <Row label="EPS adj. FY" value={`$${formatNumber(data.epsAdjFY)}`} />
            <Row label="EPS Consensus Next FY" value={`$${formatNumber(data.epsConsensusNextFY)}`} />
            <Row label="EPS Growth 5Y" value={formatPercentNoSign(data.epsGrowth5Y)} />
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Analyst Ratings</h3>
        <div className="flex items-center gap-4 mb-2">
          <RatingBadge label="Buy" count={data.ratings.buy} color="bg-emerald-500/15 text-emerald-500" />
          <RatingBadge label="Hold" count={data.ratings.hold} color="bg-amber-500/15 text-amber-500" />
          <RatingBadge label="Sell" count={data.ratings.sell} color="bg-red-500/15 text-red-500" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border/50">
              <Row label="Median PT" value={formatCurrency(data.analystPT.median)} />
              <Row label="High PT" value={formatCurrency(data.analystPT.high)} />
              <Row label="Low PT" value={formatCurrency(data.analystPT.low)} />
              <Row label="PT Upside" value={`${ptUpside >= 0 ? "+" : ""}${ptUpside.toFixed(1)}%`} valueClass={ptUpside >= 0 ? "text-emerald-500" : "text-red-500"} />
              <Row label="# Analysts" value={data.analystPT.count.toString()} />
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Valuation Metrics</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-border/50">
              <Row label="P/E" value={formatNumber(data.peRatio, 1)} />
              <Row label="Forward P/E" value={formatNumber(data.forwardPE, 1)} />
              <tr className="border-b border-border/50">
                <td className="py-1.5 px-2 text-muted-foreground">PEG</td>
                <td className="py-1.5 px-2 text-right font-mono">
                  <span>{formatNumber(data.pegRatio)}</span>
                  {data.lynchClass && (
                    <span title={data.lynchPEGBasis || data.lynchClass}
                      className={`ml-2 text-[9px] px-1.5 py-0.5 rounded font-medium cursor-help ${
                        data.lynchClass === "cyclical" ? "bg-orange-500/15 text-orange-400" :
                        data.lynchClass === "fast_grower" ? "bg-emerald-500/15 text-emerald-400" :
                        data.lynchClass === "slow_grower" ? "bg-blue-500/15 text-blue-400" :
                        data.lynchClass === "turnaround" ? "bg-purple-500/15 text-purple-400" :
                        "bg-muted text-muted-foreground"}`}>{data.lynchClass === "cyclical" ? "Zykliker" : data.lynchClass === "fast_grower" ? "Fast Grower" : data.lynchClass === "slow_grower" ? "Slow Grower" : data.lynchClass === "turnaround" ? "Turnaround" : data.lynchClass === "stalwart" ? "Stalwart" : data.lynchClass}</span>
                  )}
                </td>
              </tr>
              <Row label="EV/EBITDA" value={formatNumber(data.evEbitda, 1)} />
              <Row label="FCF TTM" value={formatLargeNumber(data.fcfTTM)} />
              <tr>
                <td className="py-1.5 px-2 text-muted-foreground">FCF Margin</td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium text-foreground">
                  {formatPercentNoSign(data.fcfMargin)}
                  {data.fcfMarginYoyAvailable && data.fcfMarginYoyPp != null && (
                    <span className={`ml-1.5 ${Math.abs(data.fcfMarginYoyPp) < 0.05 ? "text-muted-foreground" : data.fcfMarginYoyPp > 0 ? "text-emerald-400" : "text-red-400"}`}>
                      (YoY {data.fcfMarginYoyPp > 0 ? "+" : ""}{data.fcfMarginYoyPp.toFixed(1)} pp)
                    </span>
                  )}
                  {!data.fcfMarginYoyAvailable && <span className="ml-1.5 text-muted-foreground">(YoY n/a)</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <ThesisStrengthPanel data={data} />
    </SectionCard>
  );
}

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-muted/30 rounded-md p-3 border border-border/50">
      <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums mt-0.5">{sub}</div>}
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <tr>
      <td className="py-1.5 px-2 text-muted-foreground">{label}</td>
      <td className={`py-1.5 px-2 text-right font-mono tabular-nums font-medium ${valueClass || "text-foreground"}`}>{value}</td>
    </tr>
  );
}

function RatingBadge({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${color}`}>
      {label} <span className="font-mono tabular-nums font-bold">{count}</span>
    </span>
  );
}
