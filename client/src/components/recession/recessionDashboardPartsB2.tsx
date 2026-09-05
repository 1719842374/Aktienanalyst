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

export function Summary({ data }: { data: RecessionAnalysis }) {
  return (
    <div className="space-y-4">
      {/* Interpretation */}
      <div className="p-3 rounded-lg bg-muted/30 border border-border">
        <div className="flex items-start gap-2">
          <Shield className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm leading-relaxed">{data.interpretation}</div>
        </div>
      </div>

      {/* Top 3 Drivers */}
      <div>
        <h3 className="text-xs font-semibold text-foreground mb-2">Top-3 Treiber (nach absolutem Gewicht)</h3>
        <div className="space-y-1.5">
          {data.topDrivers.map((driver, i) => (
            <div key={i} className="flex items-center gap-2 text-xs p-2 rounded bg-muted/20">
              <span className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                {i + 1}
              </span>
              <span className="font-mono tabular-nums">{driver}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Google Trends Note */}
      {!data.googleTrendsAvailable && (
        <div className="flex items-start gap-2 p-2 rounded bg-yellow-500/10 border border-yellow-500/20 text-xs">
          <Info className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <span className="text-muted-foreground">
            Google Trends nicht verfügbar. Score auf 0 gesetzt, effektiver Max-Score für Korrektur Vollständig auf 61.2 reduziert.
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Section 9: Fazit & Makro-Risikobewertung
// ============================================================
export function FazitSection({ fazit }: { fazit: { summary: string; riskLevel: string; sections: FazitSection[] } }) {
  const riskColor = fazit.riskLevel === "Hoch" ? "text-red-500 bg-red-500/10 border-red-500/30"
    : fazit.riskLevel === "Erhöht" ? "text-orange-500 bg-orange-500/10 border-orange-500/30"
    : fazit.riskLevel === "Moderat" ? "text-yellow-500 bg-yellow-500/10 border-yellow-500/30"
    : "text-green-500 bg-green-500/10 border-green-500/30";

  return (
    <div className="space-y-4">
      {/* Risk Level Badge + Summary */}
      <div className={`rounded-lg border p-3 ${riskColor}`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg font-bold">{fazit.riskLevel}es Risiko</span>
        </div>
        <p className="text-xs leading-relaxed opacity-90">{fazit.summary}</p>
      </div>

      {/* Fazit Sections */}
      {fazit.sections.map((section, i) => (
        <div key={i} className="border border-border/50 rounded-lg overflow-hidden">
          <div className="bg-muted/30 px-3 py-2 border-b border-border/50">
            <h4 className="text-xs font-semibold flex items-center gap-1.5">
              <span>{section.emoji}</span>
              <span>{section.title}</span>
            </h4>
          </div>
          <div className="px-3 py-2.5">
            <p className="text-[11px] leading-[1.6] text-muted-foreground">{section.text}</p>
          </div>
        </div>
      ))}

      <div className="text-[10px] text-muted-foreground/50 italic pt-1">
        Quellen: Dallas Fed, Goldman Sachs, Natixis, Morgan Stanley, CNBC, BIS, IWF, Al Jazeera, Fortune, CBS News
      </div>
    </div>
  );
}

// ============================================================
// Section 10: Sources
// ============================================================
export function SourcesList({ sources }: { sources: { name: string; url: string }[] }) {
  return (
    <div className="space-y-1.5">
      {sources.map((s) => (
        <a
          key={s.url}
          href={s.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs p-2 rounded hover:bg-muted/30 transition-colors group"
        >
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary flex-shrink-0" />
          <span className="text-foreground group-hover:text-primary">{s.name}</span>
          <ExternalLink className="w-3 h-3 text-muted-foreground/50 ml-auto" />
        </a>
      ))}
    </div>
  );
}
