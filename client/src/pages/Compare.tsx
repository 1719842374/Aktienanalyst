import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "../lib/queryClient";
import type { StockAnalysis } from "@shared/schema";
import { Link } from "wouter";
import { ArrowLeft, ArrowUpDown, TrendingUp, TrendingDown, Minus } from "lucide-react";

export default function Compare() {
  const [ticker1, setTicker1] = useState("");
  const [ticker2, setTicker2] = useState("");
  const [data1, setData1] = useState<StockAnalysis | null>(null);
  const [data2, setData2] = useState<StockAnalysis | null>(null);

  const compareMutation = useMutation({
    mutationFn: async ({ t1, t2 }: { t1: string; t2: string }) => {
      const [r1, r2] = await Promise.all([
        apiRequest("POST", "/api/analyze", { ticker: t1 }).then(r => r.json()),
        apiRequest("POST", "/api/analyze", { ticker: t2 }).then(r => r.json()),
      ]);
      return { d1: r1 as StockAnalysis, d2: r2 as StockAnalysis };
    },
    onSuccess: ({ d1, d2 }) => { setData1(d1); setData2(d2); },
  });

  function fmt(v: number | null | undefined, dec = 1): string {
    if (v == null || isNaN(v) || !isFinite(v)) return "—";
    return v.toFixed(dec);
  }
  function fmtB(v: number | null | undefined): string {
    if (v == null || isNaN(v)) return "—";
    if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)}T`;
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
    return `$${(v / 1e6).toFixed(0)}M`;
  }

  // Compare row: green = better, red = worse
  function CompareRow({ label, v1, v2, lowerBetter = false, suffix = "", dec = 1 }: {
    label: string; v1: number | null | undefined; v2: number | null | undefined;
    lowerBetter?: boolean; suffix?: string; dec?: number;
  }) {
    const a = v1 != null && !isNaN(v1) && isFinite(v1) ? v1 : null;
    const b = v2 != null && !isNaN(v2) && isFinite(v2) ? v2 : null;
    let cls1 = "text-foreground/80", cls2 = "text-foreground/80";
    if (a != null && b != null && a !== b) {
      const aWins = lowerBetter ? a < b : a > b;
      cls1 = aWins ? "text-emerald-400 font-semibold" : "text-red-400/80";
      cls2 = aWins ? "text-red-400/80" : "text-emerald-400 font-semibold";
    }
    const icon = a != null && b != null ? (a === b ? <Minus className="w-3 h-3 text-foreground/30" /> :
      (lowerBetter ? a < b : a > b) ? <TrendingUp className="w-3 h-3 text-emerald-400" /> : <TrendingDown className="w-3 h-3 text-red-400" />) : null;

    return (
      <tr className="border-b border-border/30 hover:bg-muted/10">
        <td className="py-1.5 px-2 text-[11px] text-foreground/50 font-medium">{label}</td>
        <td className={`py-1.5 px-2 text-right font-mono text-[11px] ${cls1}`}>{a != null ? `${fmt(a, dec)}${suffix}` : "—"}</td>
        <td className="py-1.5 px-1 text-center">{icon}</td>
        <td className={`py-1.5 px-2 text-right font-mono text-[11px] ${cls2}`}>{b != null ? `${fmt(b, dec)}${suffix}` : "—"}</td>
      </tr>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/">
            <button className="p-2 rounded-lg hover:bg-muted/50 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
          </Link>
          <ArrowUpDown className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold">Ticker-Vergleich</h1>
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 mb-6">
          <input
            value={ticker1} onChange={e => setTicker1(e.target.value.toUpperCase())}
            placeholder="Ticker 1 (z.B. MSFT)"
            className="flex-1 h-10 px-3 rounded-lg bg-muted/30 border border-border text-sm font-mono"
          />
          <span className="text-foreground/30 font-bold">vs</span>
          <input
            value={ticker2} onChange={e => setTicker2(e.target.value.toUpperCase())}
            placeholder="Ticker 2 (z.B. GOOGL)"
            className="flex-1 h-10 px-3 rounded-lg bg-muted/30 border border-border text-sm font-mono"
          />
          <button
            onClick={() => { if (ticker1 && ticker2) compareMutation.mutate({ t1: ticker1, t2: ticker2 }); }}
            disabled={!ticker1 || !ticker2 || compareMutation.isPending}
            className="h-10 px-4 rounded-lg bg-primary text-primary-foreground font-medium text-sm disabled:opacity-50"
          >
            {compareMutation.isPending ? "Laden..." : "Vergleichen"}
          </button>
        </div>

        {/* Loading */}
        {compareMutation.isPending && (
          <div className="text-center py-20 text-foreground/40">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-3" />
            <p className="text-sm">Analysiere {ticker1} und {ticker2}...</p>
          </div>
        )}

        {/* Results */}
        {data1 && data2 && !compareMutation.isPending && (
          <div className="space-y-4">
            {/* Company Header */}
            <div className="grid grid-cols-2 gap-4">
              {[data1, data2].map((d, i) => (
                <div key={i} className="rounded-xl bg-card/50 border border-border p-4 text-center">
                  <div className="text-lg font-bold text-primary">{d.ticker}</div>
                  <div className="text-xs text-foreground/50 mt-1">{d.companyName}</div>
                  <div className="text-xl font-mono font-bold mt-2">${d.currentPrice?.toFixed(2)}</div>
                  <div className="text-[10px] text-foreground/40">{d.sector} / {d.industry}</div>
                  <div className="text-[10px] text-foreground/40 mt-1">Mkt Cap: {fmtB(d.marketCap)}</div>
                </div>
              ))}
            </div>

            {/* Comparison Table */}
            <div className="rounded-xl bg-card/30 border border-border overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="text-left py-2 px-2 text-[10px] text-muted-foreground font-medium w-1/3">Kennzahl</th>
                    <th className="text-right py-2 px-2 text-[10px] text-primary font-bold">{data1.ticker}</th>
                    <th className="w-6"></th>
                    <th className="text-right py-2 px-2 text-[10px] text-primary font-bold">{data2.ticker}</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Bewertung */}
                  <tr><td colSpan={4} className="py-1.5 px-2 text-[9px] text-foreground/30 uppercase tracking-wider bg-muted/10 font-semibold">Bewertung</td></tr>
                  <CompareRow label="P/E" v1={data1.peRatio} v2={data2.peRatio} lowerBetter />
                  <CompareRow label="Forward P/E" v1={data1.forwardPE} v2={data2.forwardPE} lowerBetter />
                  <CompareRow label="PEG" v1={data1.pegRatio} v2={data2.pegRatio} lowerBetter dec={2} />
                  <CompareRow label="EV/EBITDA" v1={data1.evEbitda} v2={data2.evEbitda} lowerBetter />
                  <CompareRow label="P/S" v1={data1.revenue && data1.marketCap ? data1.marketCap / data1.revenue : null} v2={data2.revenue && data2.marketCap ? data2.marketCap / data2.revenue : null} lowerBetter />

                  {/* Wachstum */}
                  <tr><td colSpan={4} className="py-1.5 px-2 text-[9px] text-foreground/30 uppercase tracking-wider bg-muted/10 font-semibold">Wachstum</td></tr>
                  <CompareRow label="Revenue Growth" v1={data1.revenueGrowth} v2={data2.revenueGrowth} suffix="%" />
                  <CompareRow label="EPS Growth 5Y" v1={data1.epsGrowth5Y} v2={data2.epsGrowth5Y} suffix="%" />
                  <CompareRow label="FCF Margin" v1={data1.fcfMargin} v2={data2.fcfMargin} suffix="%" />

                  {/* Margins */}
                  <tr><td colSpan={4} className="py-1.5 px-2 text-[9px] text-foreground/30 uppercase tracking-wider bg-muted/10 font-semibold">Profitabilität</td></tr>
                  <CompareRow label="EBIT-Margin" v1={data1.operatingIncome && data1.revenue ? (data1.operatingIncome / data1.revenue) * 100 : null} v2={data2.operatingIncome && data2.revenue ? (data2.operatingIncome / data2.revenue) * 100 : null} suffix="%" />
                  <CompareRow label="EBITDA-Margin" v1={data1.ebitda && data1.revenue ? (data1.ebitda / data1.revenue) * 100 : null} v2={data2.ebitda && data2.revenue ? (data2.ebitda / data2.revenue) * 100 : null} suffix="%" />

                  {/* Risiko */}
                  <tr><td colSpan={4} className="py-1.5 px-2 text-[9px] text-foreground/30 uppercase tracking-wider bg-muted/10 font-semibold">Risiko & Momentum</td></tr>
                  <CompareRow label="Beta (5Y)" v1={data1.beta5Y} v2={data2.beta5Y} lowerBetter dec={2} />
                  <CompareRow label="RSL" v1={data1.rsl?.value} v2={data2.rsl?.value} />

                  {/* Monte Carlo */}
                  <tr><td colSpan={4} className="py-1.5 px-2 text-[9px] text-foreground/30 uppercase tracking-wider bg-muted/10 font-semibold">Monte Carlo (1Y)</td></tr>
                  <CompareRow label="MC Mean Return" v1={data1.monteCarloResults?.mean && data1.currentPrice ? ((data1.monteCarloResults.mean - data1.currentPrice) / data1.currentPrice) * 100 : null} v2={data2.monteCarloResults?.mean && data2.currentPrice ? ((data2.monteCarloResults.mean - data2.currentPrice) / data2.currentPrice) * 100 : null} suffix="%" />
                  <CompareRow label="MC P50 (Median)" v1={data1.monteCarloResults?.median} v2={data2.monteCarloResults?.median} dec={2} />
                  <CompareRow label="P(Verlust)" v1={data1.monteCarloResults?.probLoss} v2={data2.monteCarloResults?.probLoss} lowerBetter suffix="%" />
                  <CompareRow label="P(≥20% Verlust)" v1={data1.monteCarloResults?.probLoss20} v2={data2.monteCarloResults?.probLoss20} lowerBetter suffix="%" />

                  {/* Katalysatoren */}
                  <tr><td colSpan={4} className="py-1.5 px-2 text-[9px] text-foreground/30 uppercase tracking-wider bg-muted/10 font-semibold">Katalysatoren & Upside</td></tr>
                  <CompareRow label="Catalyst Upside (Σ GB)" v1={data1.catalysts?.reduce((s, c) => s + c.gb, 0)} v2={data2.catalysts?.reduce((s, c) => s + c.gb, 0)} suffix="%" dec={2} />
                  <CompareRow label="Analyst PT Upside" v1={data1.analystPT?.median && data1.currentPrice ? ((data1.analystPT.median - data1.currentPrice) / data1.currentPrice) * 100 : null} v2={data2.analystPT?.median && data2.currentPrice ? ((data2.analystPT.median - data2.currentPrice) / data2.currentPrice) * 100 : null} suffix="%" />
                </tbody>
              </table>
            </div>

            {/* Verdict */}
            <div className="rounded-xl bg-card/30 border border-border p-4 text-center">
              <div className="text-xs text-foreground/40 mb-2">Schnell-Bewertung (automatisch)</div>
              {(() => {
                // Simple scoring: count how many metrics each ticker "wins"
                const metrics = [
                  { v1: data1.peRatio, v2: data2.peRatio, lb: true },
                  { v1: data1.pegRatio, v2: data2.pegRatio, lb: true },
                  { v1: data1.fcfMargin, v2: data2.fcfMargin, lb: false },
                  { v1: data1.epsGrowth5Y, v2: data2.epsGrowth5Y, lb: false },
                  { v1: data1.rsl?.value, v2: data2.rsl?.value, lb: false },
                  { v1: data1.monteCarloResults?.probLoss, v2: data2.monteCarloResults?.probLoss, lb: true },
                ];
                let score1 = 0, score2 = 0;
                for (const m of metrics) {
                  if (m.v1 != null && m.v2 != null && m.v1 !== m.v2) {
                    if (m.lb ? m.v1 < m.v2 : m.v1 > m.v2) score1++; else score2++;
                  }
                }
                const winner = score1 > score2 ? data1.ticker : score2 > score1 ? data2.ticker : "Unentschieden";
                return (
                  <div className="text-sm font-semibold">
                    <span className={winner === data1.ticker ? "text-emerald-400" : winner === data2.ticker ? "text-red-400" : "text-foreground/50"}>
                      {data1.ticker} {score1}
                    </span>
                    <span className="text-foreground/30 mx-2">:</span>
                    <span className={winner === data2.ticker ? "text-emerald-400" : winner === data1.ticker ? "text-red-400" : "text-foreground/50"}>
                      {score2} {data2.ticker}
                    </span>
                    <div className="text-xs text-foreground/40 mt-1">
                      {winner !== "Unentschieden" ? `${winner} gewinnt ${Math.max(score1, score2)}:${Math.min(score1, score2)} Kennzahlen` : "Gleichstand"}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
