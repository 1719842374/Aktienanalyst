import type { ReactNode } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { BarChart3, TrendingDown } from "lucide-react";
import {
  buildRegionSubgroups,
  regionScoreRows,
  type RegionCatalog,
  type RegionScoreRow,
  type RegionSubgroup,
} from "@shared/recession-regions";
import { getGaugeColor, getProbBg, getProbColor, getScoreBg, getScoreColor } from "./recessionDashboardShared";

function subgroupsOf(region: RegionCatalog): RegionSubgroup[] {
  return region.subgroups ?? buildRegionSubgroups(region.slots);
}

function netText(sg: RegionSubgroup): string {
  if (sg.probability == null) return "n/a";
  return `${sg.netScore > 0 ? "+" : ""}${sg.netScore.toFixed(1)}`;
}

function sumText(rows: RegionScoreRow[]): { weighted: string; max: string; tone: number | null } {
  const scored = rows.filter(row => row.heatScore != null);
  if (scored.length === 0) return { weighted: "n/a", max: "n/a", tone: null };
  const weighted = scored.reduce((sum, row) => sum + (row.heatScore as number), 0);
  const max = scored.reduce((sum, row) => sum + Number(row.maxText), 0);
  return {
    weighted: `${weighted > 0 ? "+" : ""}${weighted.toFixed(1)}`,
    max: max.toFixed(1),
    tone: weighted,
  };
}

function ScoreTable({ title, icon, rows }: { title: string; icon: ReactNode; rows: RegionScoreRow[] }) {
  const sum = sumText(rows);
  return (
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
            {rows.map(row => (
              <tr key={row.key} className="border-b border-border/50 hover:bg-muted/20" data-testid={`region-score-row-${row.key}`}>
                <td className="py-1.5 px-2">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-[10px] text-muted-foreground/70">{row.detail}</div>
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums font-semibold">{row.valueText}</td>
                <td className="py-1.5 px-2">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${row.heatScore == null ? "bg-muted/40 text-muted-foreground" : `${getScoreBg(row.heatScore)} ${getScoreColor(row.heatScore)}`}`}>
                    {row.zone}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums">{row.rawText}</td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums text-muted-foreground">{row.weightText}</td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${row.heatScore == null ? "text-muted-foreground" : getScoreColor(row.heatScore)}`}>
                  {row.weightedText}
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums text-muted-foreground">{row.maxText}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border font-semibold">
              <td className="py-2 px-2" colSpan={5}>Summe gewertet</td>
              <td className={`py-2 px-2 text-center font-mono tabular-nums ${sum.tone == null ? "text-muted-foreground" : getScoreColor(sum.tone)}`}>
                {sum.weighted}
              </td>
              <td className="py-2 px-2 text-center font-mono tabular-nums">{sum.max}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Section 5 for Europa / Asien. US keeps IndicatorTable. */
export function RegionScoreTable({ region }: { region: RegionCatalog }) {
  const rows = regionScoreRows(region.slots);
  const recession = rows.filter(row => row.book === "recession");
  const correction = rows.filter(row => row.book === "correction");
  return (
    <div className="space-y-4" data-testid={`region-score-table-${region.id}`}>
      <ScoreTable title={`Rezessions-Indikatoren ${region.label}`} icon={<TrendingDown className="w-3.5 h-3.5 text-red-500" />} rows={recession} />
      <ScoreTable title={`Korrektur-Indikatoren ${region.label}`} icon={<BarChart3 className="w-3.5 h-3.5 text-orange-500" />} rows={correction} />
      <div data-testid={`region-heatmap-${region.id}`}>
        <h3 className="text-xs font-semibold text-foreground mb-2">Indikator-Heatmap · {region.label}</h3>
        <div className="flex flex-wrap gap-1">
          {rows.map(row => (
            <div
              key={row.key}
              className={`px-2 py-1 rounded text-[10px] font-medium border border-current/10 ${row.heatScore == null ? "bg-muted/40 text-muted-foreground" : `${getScoreBg(row.heatScore)} ${getScoreColor(row.heatScore)}`}`}
              title={row.valueText}
            >
              {row.name.length > 16 ? row.name.substring(0, 14) + "..." : row.name}
              <span className="ml-1 font-bold">{row.heatScore == null ? "n/a" : `${row.heatScore > 0 ? "+" : ""}${row.heatScore}`}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Section 6 for Europa / Asien. */
export function RegionSubgroupPanel({ region }: { region: RegionCatalog }) {
  const subgroups = subgroupsOf(region);
  const chartData = subgroups
    .filter(sg => typeof sg.probability === "number")
    .map(sg => ({
      name: sg.label.replace("Rezession ", "Rez. ").replace("Korrektur ", "Korr. "),
      probability: sg.probability as number,
    }));
  return (
    <div className="space-y-4" data-testid={`region-subgroups-${region.id}`}>
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
            {subgroups.map(sg => (
              <tr key={sg.name} className="border-b border-border/50">
                <td className="py-1.5 px-2 font-medium">{sg.label}</td>
                <td className="py-1.5 px-2 text-center">
                  <span className="px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground text-[10px]">{sg.horizon}</span>
                </td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${sg.probability == null ? "text-muted-foreground" : getScoreColor(sg.netScore)}`}>
                  {netText(sg)}
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums">
                  {sg.probability == null ? "n/a" : sg.maxScore.toFixed(1)}
                </td>
                <td className={`py-1.5 px-2 text-center font-mono tabular-nums font-bold ${sg.probability == null ? "text-muted-foreground" : getProbColor(sg.probability)}`}>
                  {sg.probability == null ? "n/a" : `${sg.probability}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chartData.length > 0 ? (
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
      ) : (
        <p className="text-[11px] text-muted-foreground">n/a — kein gewerteter Slot in den fünf Untergruppen.</p>
      )}
    </div>
  );
}

/** Section 7 for Europa / Asien. The US block stays ProbabilityEstimates. */
export function RegionProbabilityList({ region }: { region: RegionCatalog }) {
  const subgroups = subgroupsOf(region);
  return (
    <div className="space-y-4" data-testid={`region-probabilities-${region.id}`}>
      {subgroups.map(sg => (
        <div key={sg.name} className={`p-3 rounded-lg border ${sg.probability == null ? "border-border bg-muted/20" : getProbBg(sg.probability)}`}>
          <div className="flex items-center justify-between mb-2 gap-2">
            <div>
              <span className="text-sm font-bold">{sg.label}</span>
              <span className="ml-2 text-xs text-muted-foreground">({sg.horizon})</span>
            </div>
            <span className={`text-xl font-bold tabular-nums ${sg.probability == null ? "text-muted-foreground" : getProbColor(sg.probability)}`}>
              {sg.probability == null ? "n/a" : `${sg.probability}%`}
            </span>
          </div>
          <div className="bg-card/50 rounded p-2 font-mono text-[11px] leading-relaxed space-y-0.5 border border-border/50">
            <div>
              <span className="text-muted-foreground">Indikatoren: </span>
              <span>{sg.indicators.length > 0 ? sg.indicators.join(", ") : "n/a"}</span>
            </div>
            {sg.missing.length > 0 && (
              <div>
                <span className="text-muted-foreground">Fehlend: </span>
                <span>{sg.missing.map(item => `${item.name}: n/a — ${item.reason}`).join("; ")}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Netto-Score: </span>
              <span>{netText(sg)}</span>
              <span className="text-muted-foreground"> / Max: </span>
              <span>{sg.probability == null ? "n/a" : sg.maxScore.toFixed(1)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Formel: </span>
              <span>{sg.formula}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
