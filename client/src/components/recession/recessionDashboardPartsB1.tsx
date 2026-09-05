import type { ReactNode } from "react";
import {
  TrendingDown, BarChart3, Shield, BookOpen, ExternalLink, Info,
} from "lucide-react";
import {
  ResponsiveContainer, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import {
  type RecessionAnalysis, type IndicatorResult, type SubgroupResult, type FazitSection,
  getProbColor, getProbBg, getScoreColor, getScoreBg, getGaugeColor,
} from "./recessionDashboardShared";

// Section 5: Indicator Table (full 17 indicators)
// ============================================================
export function IndicatorTable({ indicators }: { indicators: IndicatorResult[] }) {
  const recession = indicators.filter(i => i.group === "recession");
  const correction = indicators.filter(i => i.group === "correction");

  const renderTable = (items: IndicatorResult[], title: string, icon: ReactNode) => (
    <div>
      <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Indikator</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Wert</th>
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Zone</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Raw</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">×Gew.</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Gewichtet</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max</th>
            </tr>
          </thead>
          <tbody>
            {items.map((ind) => (
              <tr key={ind.name} className="border-b border-border/50 hover:bg-muted/20">
                <td className="py-1.5 px-2">
                  <div className="font-medium">{ind.name}</div>
                  <div className="text-[10px] text-muted-foreground/70">{ind.source}</div>
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold">{ind.value}</td>
                <td className="py-1.5 px-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${getScoreBg(ind.weightedScore)} ${getScoreColor(ind.weightedScore)}`}>
                    {ind.zone}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums">{ind.rawScore > 0 ? "+" : ""}{ind.rawScore}</td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums text-muted-foreground">×{ind.weight}</td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${getScoreColor(ind.weightedScore)}`}>
                  {ind.weightedScore > 0 ? "+" : ""}{ind.weightedScore}
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums text-muted-foreground">{ind.maxWeighted}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2 px-2" colSpan={5}>Summe</td>
              <td className={`py-2 px-2 text-center font-mono tabular-nums ${getScoreColor(items.reduce((s, i) => s + i.weightedScore, 0))}`}>
                {items.reduce((s, i) => s + i.weightedScore, 0) > 0 ? "+" : ""}
                {items.reduce((s, i) => s + i.weightedScore, 0).toFixed(1)}
              </td>
              <td className="py-2 px-2 text-center font-mono tabular-nums">
                {items.reduce((s, i) => s + i.maxWeighted, 0).toFixed(1)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {renderTable(recession, "Rezessions-Indikatoren (7)", <TrendingDown className="w-3.5 h-3.5 text-red-500" />)}
      {renderTable(correction, "Korrektur-Indikatoren (10)", <BarChart3 className="w-3.5 h-3.5 text-orange-500" />)}

      {/* Heatmap visualization */}
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2">Indikator-Heatmap</h3>
        <div className="flex flex-wrap gap-1">
          {indicators.map((ind) => (
            <div
              key={ind.name}
              className={`px-2 py-1 rounded text-[10px] font-medium ${getScoreBg(ind.weightedScore)} ${getScoreColor(ind.weightedScore)} border border-current/10`}
              title={`${ind.name}: ${ind.value} → ${ind.weightedScore > 0 ? "+" : ""}${ind.weightedScore}`}
            >
              {ind.name.length > 16 ? ind.name.substring(0, 14) + "..." : ind.name}
              <span className="ml-1 font-bold">{ind.weightedScore > 0 ? "+" : ""}{ind.weightedScore}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section 6: Subgroup Overview
// ============================================================
export function SubgroupOverview({ subgroups }: { subgroups: SubgroupResult[] }) {
  // Bar chart data
  const chartData = subgroups.map(sg => ({
    name: sg.label.replace("Rezession ", "Rez. ").replace("Korrektur ", "Korr. "),
    netScore: sg.netScore,
    maxScore: sg.maxScore,
    probability: sg.probability,
  }));

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Untergruppe</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Horizont</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Netto-Score</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max-Score</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Wahrsch.</th>
            </tr>
          </thead>
          <tbody>
            {subgroups.map((sg) => (
              <tr key={sg.name} className="border-b border-border/50">
                <td className="py-1.5 px-2 font-medium">{sg.label}</td>
                <td className="py-1.5 px-2 text-center">
                  <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground text-[10px]">
                    {sg.horizon}
                  </span>
                </td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${getScoreColor(sg.netScore)}`}>
                  {sg.netScore > 0 ? "+" : ""}{sg.netScore.toFixed(1)}
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums">{sg.maxScore.toFixed(1)}</td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${getProbColor(sg.probability)}`}>
                  {sg.probability}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Bar chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
            <Tooltip
              contentStyle={{
                fontSize: 11,
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
              }}
              formatter={(value: number) => [`${value}%`, "Wahrscheinlichkeit"]}
            />
            <Bar dataKey="probability" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={index} fill={getGaugeColor(entry.probability)} />
              ))}
            </Bar>
            <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" opacity={0.5} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ============================================================
// Section 7: Probability Estimates (Pflicht-Format)
// ============================================================
export function ProbabilityEstimates({ subgroups }: { subgroups: SubgroupResult[] }) {
  return (
    <div className="space-y-4">
      {subgroups.map((sg) => (
        <div key={sg.name} className={`p-3 rounded-lg border ${getProbBg(sg.probability)}`}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-sm font-bold">{sg.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">({sg.horizon})</span>
            </div>
            <span className={`text-xl font-bold tabular-nums ${getProbColor(sg.probability)}`}>
              {sg.probability}%
            </span>
          </div>

          {/* Pflicht-Format block */}
          <div className="bg-card/50 rounded p-2 font-mono text-[11px] leading-relaxed space-y-0.5 border border-border/50">
            <div>
              <span className="text-muted-foreground">Indikatoren: </span>
              <span>{sg.indicators.join(", ")}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Netto-Score: </span>
              <span className={getScoreColor(sg.netScore)}>
                {sg.netScore > 0 ? "+" : ""}{sg.netScore.toFixed(1)}
              </span>
              <span className="text-muted-foreground"> / Max: </span>
              <span>{sg.maxScore.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Formel: </span>
              <span>{sg.formula}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Gerundet: → </span>
              <span className={`font-bold ${getProbColor(sg.probability)}`}>{sg.probability}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

