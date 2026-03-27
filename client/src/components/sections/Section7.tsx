import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { formatNumber } from "../../lib/formatters";

interface Props { data: StockAnalysis }

export function Section7({ data }: Props) {
  const fwdPEPremium = ((data.forwardPE / data.sectorAvgPE) - 1) * 100;
  const evEbitdaPremium = ((data.evEbitda / data.sectorAvgEVEBITDA) - 1) * 100;

  // Estimate moat-justified vs speculative premium
  const moatJustified = data.moatRating === "Wide" ? Math.min(fwdPEPremium, 30) :
    data.moatRating === "Narrow" ? Math.min(fwdPEPremium, 15) : 0;
  const speculative = fwdPEPremium - moatJustified;

  const metrics = [
    { label: "Forward P/E", stock: data.forwardPE, sector: data.sectorAvgPE, premium: fwdPEPremium },
    { label: "EV/EBITDA", stock: data.evEbitda, sector: data.sectorAvgEVEBITDA, premium: evEbitdaPremium },
    { label: "PEG", stock: data.pegRatio, sector: data.sectorAvgPEG, premium: ((data.pegRatio / data.sectorAvgPEG) - 1) * 100 },
  ];

  return (
    <SectionCard number={7} title="RELATIVE BEWERTUNG">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 px-2 text-muted-foreground font-medium">Metric</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Stock</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Sector Avg</th>
              <th className="text-right py-2 px-2 text-muted-foreground font-medium">Premium</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {metrics.map((m, i) => (
              <tr key={i}>
                <td className="py-2 px-2 font-medium">{m.label}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold">{formatNumber(m.stock, 1)}</td>
                <td className="py-2 px-2 text-right font-mono tabular-nums text-muted-foreground">{formatNumber(m.sector, 1)}</td>
                <td className={`py-2 px-2 text-right font-mono tabular-nums font-medium ${m.premium > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                  {m.premium >= 0 ? "+" : ""}{formatNumber(m.premium, 1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Visual bar comparing stock vs sector for Forward PE */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Forward P/E Comparison</h3>
        <div className="space-y-2">
          <BarRow label={data.ticker} value={data.forwardPE} max={Math.max(data.forwardPE, data.sectorAvgPE) * 1.3} color="bg-primary" />
          <BarRow label="Sector Avg" value={data.sectorAvgPE} max={Math.max(data.forwardPE, data.sectorAvgPE) * 1.3} color="bg-muted-foreground/50" />
        </div>
      </div>

      {/* Premium Breakdown */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Premium Breakdown</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-500/5 rounded-md p-3 border border-emerald-500/20">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Moat-Justified</div>
            <div className="text-sm font-bold font-mono tabular-nums text-emerald-500 mt-1">+{formatNumber(moatJustified, 1)}%</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">Moat: {data.moatRating}</div>
          </div>
          <div className={`rounded-md p-3 border ${speculative > 15 ? "bg-red-500/5 border-red-500/20" : "bg-amber-500/5 border-amber-500/20"}`}>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Speculative</div>
            <div className={`text-sm font-bold font-mono tabular-nums mt-1 ${speculative > 15 ? "text-red-500" : "text-amber-500"}`}>
              {speculative >= 0 ? "+" : ""}{formatNumber(speculative, 1)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{speculative > 15 ? "Elevated risk" : "Within range"}</div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = (value / max) * 100;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 h-5 bg-muted/30 rounded overflow-hidden">
        <div className={`h-full ${color} rounded transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono tabular-nums font-semibold w-12 text-right">{formatNumber(value, 1)}</span>
    </div>
  );
}
