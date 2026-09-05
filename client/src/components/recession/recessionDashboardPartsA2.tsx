import {
  AlertTriangle, Activity, TrendingDown, BarChart3, Gauge, Info, RefreshCw,
} from "lucide-react";
import {
  ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import {
  type RecessionAnalysis, type IndicatorResult,
  getProbColor, getProbBg, getProbLabel, getScoreColor, getScoreBg, getGaugeColor,
} from "./recessionDashboardShared";

export function ScoringRules() {
  const recessionRules = [
    { name: "Sahm-Regel (≥0.5pp)", scorePositive: "+4", scoreNegative: "-3", weight: "×1", max: "4" },
    { name: "Inv. Zinskurve (10Y-2Y <0)", scorePositive: "+4", scoreNegative: "-3", weight: "×1", max: "4" },
    { name: "PMI (Mfg+Serv Ø <45)", scorePositive: "+3", scoreNegative: "-3", weight: "×1", max: "3" },
    { name: "Durable Goods (YoY >-5%)", scorePositive: "+3", scoreNegative: "-2", weight: "×1", max: "3" },
    { name: "M2 Wachstum (Zonen)", scorePositive: "+3 bis -2", scoreNegative: "", weight: "×1", max: "3" },
    { name: "Kreditspreads BAA-Trs (Zonen)", scorePositive: "+3 bis -2", scoreNegative: "", weight: "×1", max: "3" },
    { name: "Konsumklima CCI<80/CSI<60", scorePositive: "+3", scoreNegative: "-2", weight: "×1", max: "3" },
  ];

  const correctionRules = [
    { name: "Buffett Ind. (TMC/GDP)", scorePositive: "+8 bis -8", scoreNegative: "", weight: "×2", max: "16" },
    { name: "Shiller CAPE", scorePositive: "+7 bis -9", scoreNegative: "", weight: "×1.8", max: "12.6" },
    { name: "Margin Debt", scorePositive: "+4", scoreNegative: "-2", weight: "×1", max: "4" },
    { name: "Google Trends \"Recession\"", scorePositive: "+7 bis -6.8", scoreNegative: "", weight: "×1.7", max: "11.9" },
    { name: "VIX", scorePositive: "+4 bis -3", scoreNegative: "", weight: "×1", max: "4" },
    { name: "Advance-Decline-Line", scorePositive: "+3 bis -2", scoreNegative: "", weight: "×1", max: "3" },
    { name: "CNN Fear & Greed", scorePositive: "+6 bis -8", scoreNegative: "", weight: "×1.6", max: "9.6" },
    { name: "AAII Sentiment", scorePositive: "+4", scoreNegative: "-4", weight: "×1", max: "4" },
    { name: "CBOE Put/Call Ratio", scorePositive: "+4", scoreNegative: "-4", weight: "×1", max: "4" },
    { name: "Investors Intelligence", scorePositive: "+4", scoreNegative: "-4", weight: "×1", max: "4" },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
          <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          Rezessions-Indikatoren (7)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Indikator</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Score</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Gewicht</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max</th>
              </tr>
            </thead>
            <tbody>
              {recessionRules.map((r) => (
                <tr key={r.name} className="border-b border-border/50">
                  <td className="py-1.5 px-2 font-medium">{r.name}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.scorePositive}{r.scoreNegative ? `/${r.scoreNegative}` : ""}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.weight}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums font-semibold">{r.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-orange-500" />
          Korrektur-Indikatoren (10)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Indikator</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Score</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Gewicht</th>
                <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Max</th>
              </tr>
            </thead>
            <tbody>
              {correctionRules.map((r) => (
                <tr key={r.name} className="border-b border-border/50">
                  <td className="py-1.5 px-2 font-medium">{r.name}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.scorePositive}{r.scoreNegative ? `/${r.scoreNegative}` : ""}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums">{r.weight}</td>
                  <td className="py-1.5 px-2 text-center font-mono tabular-nums font-semibold">{r.max}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Section 4: Scoring Zones
// ============================================================
export function ScoringZones() {
  const zones = [
    { indicator: "M2", zones: "Kontraktion/<2%: +3 | 2-4%: +1 | 4-10%: 0 | >10%: -2" },
    { indicator: "Kreditspreads", zones: ">2.5%: +3 | 2.0-2.5%: +2 | 1.5-2.0%: 0 | 1.0-1.5%: -1 | <1.0%: -2" },
    { indicator: "VIX", zones: ">30: +4 | 20-30: +1 | 15-20: 0 | <15: -3" },
    { indicator: "Google (0-100)", zones: ">75: +11.9 | 60-75: +6.8 | 30-60: 0 | <30: -6.8" },
    { indicator: "Buffett", zones: ">200%: +16 | 165-200%: +10 | 140-165%: +4 | <140%: -8" },
    { indicator: "Shiller CAPE", zones: ">35: +12.6 | 30-35: +5.4 | 15-30: 0 | <15: -9" },
    { indicator: "CNN F&G", zones: ">75: +9.6 | 55-75: +3.2 | 45-55: 0 | 25-45: -3.2 | <25: -8" },
    { indicator: "AD-Line", zones: "Divergenz: +3 | Schwäche: 0 | Parallel: -2" },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-1.5 px-2 text-muted-foreground font-medium w-28">Indikator</th>
            <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Zonen → Gewichteter Score</th>
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.indicator} className="border-b border-border/50">
              <td className="py-1.5 px-2 font-medium">{z.indicator}</td>
              <td className="py-1.5 px-2 font-mono tabular-nums text-muted-foreground">{z.zones}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
