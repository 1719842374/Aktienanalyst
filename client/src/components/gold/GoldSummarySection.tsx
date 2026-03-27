import type { GoldAnalysis } from "../../../../shared/gold-schema";
import { ExternalLink } from "lucide-react";

interface Props { data: GoldAnalysis }

export function GoldSummarySection({ data }: Props) {
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">8</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Zusammenfassung</h2>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-4">
        {/* Summary Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {data.summaryTable.map((row, i) => (
                <tr key={i} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="py-2 text-muted-foreground font-medium w-48">{row.metric}</td>
                  <td className="py-2 text-foreground font-mono tabular-nums">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Final Assessment */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Finale Einschätzung</div>
          <div className={`rounded-md p-4 border text-xs leading-relaxed ${
            data.sentiment === "Bullish"
              ? "bg-emerald-500/5 border-emerald-500/20 text-foreground"
              : data.sentiment === "Bearish"
                ? "bg-red-500/5 border-red-500/20 text-foreground"
                : "bg-amber-500/5 border-amber-500/20 text-foreground"
          }`}>
            {data.finalAssessment}
          </div>
        </div>

        {/* Sources */}
        <div className="space-y-2 border-t border-border pt-3">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Quellen</div>
          <div className="flex flex-wrap gap-2">
            {data.sources.map((source, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/30 border border-border text-[10px] text-muted-foreground">
                <ExternalLink className="w-2.5 h-2.5" />
                {source}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
