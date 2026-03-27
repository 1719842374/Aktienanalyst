import type { GoldAnalysis } from "../../../../shared/gold-schema";
import { TrendingUp, TrendingDown, Minus, CheckCircle, AlertTriangle } from "lucide-react";

interface Props { data: GoldAnalysis }

export function GoldPriceSection({ data }: Props) {
  const sentimentColors: Record<string, string> = {
    Bullish: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    Neutral: "text-amber-500 bg-amber-500/10 border-amber-500/20",
    Bearish: "text-red-500 bg-red-500/10 border-red-500/20",
  };

  const sentimentIcons: Record<string, typeof TrendingUp> = {
    Bullish: TrendingUp,
    Neutral: Minus,
    Bearish: TrendingDown,
  };

  const SentimentIcon = sentimentIcons[data.sentiment] || Minus;

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">1</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Gold-Preis & Status</h2>
          <span className="text-[10px] text-muted-foreground ml-auto">{data.analysisDate}</span>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-4">
        {/* Price Hero */}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Gold Spot (XAU/USD)</div>
            <div className="text-3xl font-bold font-mono tabular-nums text-amber-500">${data.spotPrice.toFixed(2)}</div>
          </div>
          <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-mono tabular-nums ${data.changePercent >= 0 ? "text-emerald-500 bg-emerald-500/10" : "text-red-500 bg-red-500/10"}`}>
            {data.changePercent >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {data.changePercent >= 0 ? "+" : ""}{data.changePercent.toFixed(2)}%
          </div>
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${sentimentColors[data.sentiment]}`}>
            <SentimentIcon className="w-3.5 h-3.5" />
            {data.sentiment}
          </div>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: "52W Hoch", value: `$${data.yearHigh.toFixed(0)}`, color: "text-foreground" },
            { label: "52W Tief", value: `$${data.yearLow.toFixed(0)}`, color: "text-foreground" },
            { label: "200-DMA", value: `$${data.ma200.toFixed(0)}`, color: "text-foreground" },
            {
              label: "Abw. 200-DMA",
              value: `${data.deviationFromMA200 >= 0 ? "+" : ""}${data.deviationFromMA200.toFixed(1)}%`,
              color: data.deviationFromMA200 > 15 ? "text-red-400" : data.deviationFromMA200 > 0 ? "text-emerald-400" : "text-red-400",
            },
            { label: "RSI (14)", value: data.rsi14.toFixed(1), color: data.rsi14 > 70 ? "text-red-400" : data.rsi14 < 30 ? "text-emerald-400" : "text-foreground" },
            { label: "GIS", value: data.gis.toFixed(2), color: data.gis >= 0.30 ? "text-emerald-400" : data.gis >= 0 ? "text-amber-400" : "text-red-400" },
            { label: "Fair Value", value: `$${data.fairValue.fvAdj.toFixed(0)}`, color: "text-foreground" },
            { label: "Währung", value: data.currency, color: "text-muted-foreground" },
          ].map((m, i) => (
            <div key={i} className="bg-muted/30 rounded-md p-2 border border-border">
              <div className="text-[10px] text-muted-foreground">{m.label}</div>
              <div className={`text-sm font-mono tabular-nums font-semibold ${m.color}`}>{m.value}</div>
            </div>
          ))}
        </div>

        {/* Plausibility Checks */}
        <div className="border-t border-border pt-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Plausibilitäts-Checks</div>
          <div className="flex flex-wrap gap-2">
            {data.plausibilityChecks.map((check, i) => (
              <div key={i} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {check.includes("✅") ? (
                  <CheckCircle className="w-3 h-3 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-3 h-3 text-amber-500" />
                )}
                <span>{check.replace("✅", "").replace("⚠️", "").trim()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
