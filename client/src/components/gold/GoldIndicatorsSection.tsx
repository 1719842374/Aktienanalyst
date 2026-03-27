import type { GoldAnalysis } from "../../../../shared/gold-schema";
import { ArrowUp, ArrowDown, Minus, ShieldAlert } from "lucide-react";

interface Props { data: GoldAnalysis }

export function GoldIndicatorsSection({ data }: Props) {
  const getScoreColor = (score: number) => {
    if (score === 1) return "text-emerald-500";
    if (score === -1) return "text-red-500";
    return "text-amber-500";
  };

  const getScoreBg = (score: number) => {
    if (score === 1) return "bg-emerald-500/10 border-emerald-500/20";
    if (score === -1) return "bg-red-500/10 border-red-500/20";
    return "bg-amber-500/10 border-amber-500/20";
  };

  const ScoreIcon = ({ score }: { score: number }) => {
    if (score === 1) return <ArrowUp className="w-3 h-3 text-emerald-500" />;
    if (score === -1) return <ArrowDown className="w-3 h-3 text-red-500" />;
    return <Minus className="w-3 h-3 text-amber-500" />;
  };

  const gisColor = data.gis >= 0.30 ? "text-emerald-500" : data.gis >= 0 ? "text-amber-500" : "text-red-500";
  const gisBg = data.gis >= 0.30 ? "bg-emerald-500/10 border-emerald-500/20" : data.gis >= 0 ? "bg-amber-500/10 border-amber-500/20" : "bg-red-500/10 border-red-500/20";

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">3</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Indikatoren & GIS</h2>
          <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold font-mono tabular-nums border ${gisBg} ${gisColor}`}>
            GIS: {data.gis.toFixed(2)}
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-3">
        {/* Indicators Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 font-medium">Indikator</th>
                <th className="text-center py-2 font-medium w-16">Gewicht</th>
                <th className="text-center py-2 font-medium w-16">Score</th>
                <th className="text-left py-2 font-medium">Wert</th>
                <th className="text-left py-2 font-medium hidden sm:table-cell">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.indicators.map((ind, i) => {
                const isGeopolitik = ind.name.toLowerCase().includes("geopolitik");
                return (
                <tr key={i} className={`border-b border-border/50 transition-colors ${
                  isGeopolitik
                    ? "bg-orange-500/8 hover:bg-orange-500/15 border-l-2 border-l-orange-500"
                    : "hover:bg-muted/20"
                }`}>
                  <td className="py-2 font-medium text-foreground">
                    <div className="flex items-center gap-1.5">
                      {isGeopolitik && <ShieldAlert className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />}
                      <span className={isGeopolitik ? "text-orange-400 font-semibold" : ""}>{ind.name}</span>
                      {isGeopolitik && <span className="text-[9px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider">Key Driver</span>}
                    </div>
                  </td>
                  <td className={`py-2 text-center font-mono tabular-nums ${isGeopolitik ? "text-orange-400 font-bold" : "text-muted-foreground"}`}>{(ind.weight * 100).toFixed(0)}%</td>
                  <td className="py-2 text-center">
                    <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${getScoreBg(ind.score)}`}>
                      <ScoreIcon score={ind.score} />
                      <span className={`font-mono tabular-nums font-bold ${getScoreColor(ind.score)}`}>
                        {ind.score > 0 ? "+" : ""}{ind.score}
                      </span>
                    </div>
                  </td>
                  <td className="py-2 font-mono tabular-nums text-foreground">{ind.value}</td>
                  <td className="py-2 text-muted-foreground hidden sm:table-cell">{ind.details}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Geopolitik Insight */}
        <div className="bg-orange-500/5 rounded-md p-3 border border-orange-500/20 flex gap-2.5 items-start">
          <ShieldAlert className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-[10px] font-semibold text-orange-400 uppercase tracking-wider mb-0.5">Geopolitik — Erhöhte Gewichtung (15%)</div>
            <div className="text-[11px] text-muted-foreground leading-relaxed">2022 zeigte: Geopolitik (Ukraine, Lieferengpässe) kann steigende Zinsen überkompensieren. Iran-Konflikt zeigt ähnliche Muster. Gewicht von 10% → 15% erhöht, M2 (träge) von 10% → 5% reduziert.</div>
          </div>
        </div>

        {/* GIS Calculation */}
        <div className="bg-muted/30 rounded-md p-3 border border-border">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">GIS-Rechenweg</div>
          <div className="text-[11px] font-mono tabular-nums text-foreground break-all">{data.gisCalculation}</div>
        </div>

        {/* Score Distribution Visual */}
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 rounded-full bg-muted overflow-hidden flex">
            {data.indicators.map((ind, i) => (
              <div
                key={i}
                className={`h-full ${ind.score === 1 ? "bg-emerald-500" : ind.score === -1 ? "bg-red-500" : "bg-amber-500"}`}
                style={{ width: `${ind.weight * 100}%` }}
                title={`${ind.name}: ${ind.score > 0 ? "+" : ""}${ind.score} (${(ind.weight * 100).toFixed(0)}%)`}
              />
            ))}
          </div>
          <div className="flex gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Bullish</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />Neutral</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />Bearish</span>
          </div>
        </div>

        {/* Threshold Reference */}
        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground transition-colors">Schwellenwerte anzeigen</summary>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
            {data.indicators.map((ind, i) => (
              <div key={i} className="flex gap-2 py-0.5">
                <span className="font-medium text-foreground w-32 flex-shrink-0">{ind.name}:</span>
                <span className="text-emerald-400">B: {ind.thresholds.bullish}</span>
                <span className="text-amber-400">| N: {ind.thresholds.neutral}</span>
                <span className="text-red-400">| Be: {ind.thresholds.bearish}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
