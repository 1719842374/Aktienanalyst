import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { calculateRSL } from "../../lib/calculations";
import { formatNumber, getRSLColor, getRSLBgColor } from "../../lib/formatters";
import { useMemo } from "react";

interface Props { data: StockAnalysis }

export function Section9({ data }: Props) {
  const sp = data.sectorProfile;

  const prices26w = useMemo(() => {
    const sorted = [...data.historicalPrices].sort((a, b) => b.date.localeCompare(a.date));
    return sorted.slice(0, 130).map((p) => p.close); // ~26 weeks of trading days
  }, [data.historicalPrices]);

  const rsl = useMemo(() => calculateRSL(data.currentPrice, prices26w), [data.currentPrice, prices26w]);
  const avg26w = prices26w.length > 0 ? prices26w.reduce((s, v) => s + v, 0) / prices26w.length : data.currentPrice;

  // RSL < 105 → DCF growth adjustment -5-10%
  const growthAdj = rsl > 110 ? "+0% (strong momentum)" :
    rsl > 105 ? "+0% (neutral)" :
    `-5% to -10% (RSL < 105 → DCF-Wachstum reduzieren)`;
  const rslZone = rsl > 110 ? "Strong Momentum" : rsl > 105 ? "Neutral" : "Weak Momentum";

  // Gauge positioning
  const gaugeMin = 90;
  const gaugeMax = 130;
  const gaugePos = Math.max(0, Math.min(100, ((rsl - gaugeMin) / (gaugeMax - gaugeMin)) * 100));

  return (
    <SectionCard number={9} title="RSL-MOMENTUM (Levy RSL)">
      {/* RSL < 105 Warning */}
      {rsl < 105 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 flex items-start gap-2">
          <span className="text-amber-500 text-lg">⚠</span>
          <div>
            <div className="text-xs font-bold text-amber-500">RSL &lt; 105 — DCF Growth Adjustment</div>
            <div className="text-[11px] text-amber-400 mt-0.5">
              RSL = {formatNumber(rsl, 1)}. Automatische Anpassung: DCF-Wachstumsrate um -5% bis -10% reduzieren.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* RSL Gauge */}
        <div className="flex flex-col items-center">
          <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">RSL Value</div>
          <div className={`text-3xl font-bold font-mono tabular-nums ${getRSLColor(rsl)}`}>
            {formatNumber(rsl, 1)}
          </div>
          <div className={`text-xs font-medium mt-1 ${getRSLColor(rsl)}`}>{rslZone}</div>

          {/* Visual gauge bar */}
          <div className="w-full mt-4 relative">
            <div className="h-3 rounded-full bg-muted/50 overflow-hidden flex">
              <div className="h-full bg-red-500/30 flex-1" />
              <div className="h-full bg-amber-500/30 flex-1" />
              <div className="h-full bg-emerald-500/30 flex-1" />
            </div>
            {/* Marker */}
            <div
              className="absolute top-0 -translate-x-1/2 transition-all"
              style={{ left: `${gaugePos}%` }}
            >
              <div className={`w-3 h-3 rounded-full border-2 border-background ${getRSLBgColor(rsl)}`} />
            </div>
            {/* Labels */}
            <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
              <span>&lt;105 Weak</span>
              <span>105-110 Neutral</span>
              <span>&gt;110 Strong</span>
            </div>
          </div>
        </div>

        {/* RSL Details */}
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-border/50">
                <tr>
                  <td className="py-1.5 px-2 text-muted-foreground">Current Price</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium">${formatNumber(data.currentPrice)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 text-muted-foreground">26-Week Average</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium">${formatNumber(avg26w)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 text-muted-foreground">RSL = (Price / Avg) × 100</td>
                  <td className={`py-1.5 px-2 text-right font-mono tabular-nums font-bold ${getRSLColor(rsl)}`}>{formatNumber(rsl, 2)}</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 text-muted-foreground">Cycle Class</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium">{sp.cycleClass}</td>
                </tr>
                <tr>
                  <td className="py-1.5 px-2 text-muted-foreground">DCF Growth Adj.</td>
                  <td className="py-1.5 px-2 text-right font-mono tabular-nums font-medium text-[11px]">{growthAdj}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="bg-muted/30 rounded-md p-2.5 border border-border/50 text-xs text-muted-foreground">
            RSL measures relative momentum: Price divided by its 26-week moving average × 100.
            Values above 110 indicate strong momentum, below 105 indicates weakness and triggers automatic DCF growth reduction (-5% to -10%).
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
