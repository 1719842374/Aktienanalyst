import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { TrendingUp, TrendingDown, Minus, ArrowLeftRight, BarChart3 } from "lucide-react";

interface Props { data: StockAnalysis }

const corrColors: Record<string, { bg: string; text: string; border: string; label: string }> = {
  Positiv: { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20", label: "Positiv" },
  Neutral: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20", label: "Neutral" },
  Negativ: { bg: "bg-red-500/10", text: "text-red-500", border: "border-red-500/20", label: "Negativ" },
  Invers: { bg: "bg-orange-500/10", text: "text-orange-500", border: "border-orange-500/20", label: "Invers" },
};

const strengthColors: Record<string, { bg: string; text: string }> = {
  Stark: { bg: "bg-red-500/15", text: "text-red-400" },
  Moderat: { bg: "bg-amber-500/15", text: "text-amber-400" },
  Schwach: { bg: "bg-slate-500/15", text: "text-slate-400" },
};

const categoryIcons: Record<string, string> = {
  "Index": "📈",
  "Commodity": "🛢️",
  "Macro-Indikator": "🏛️",
  "Edelmetall": "🥇",
  "Industriemetall": "⚙️",
  "Crypto": "₿",
  "Währung": "💱",
};

function CorrIcon({ corr }: { corr: string }) {
  if (corr === "Positiv") return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (corr === "Negativ") return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  if (corr === "Invers") return <ArrowLeftRight className="w-3.5 h-3.5 text-orange-500" />;
  return <Minus className="w-3.5 h-3.5 text-slate-400" />;
}

export function Section17({ data }: Props) {
  const mc = data.macroCorrelations;

  if (!mc) {
    return (
      <SectionCard number={17} title="MAKRO-KORRELATIONEN">
        <div className="text-xs text-muted-foreground">Keine Makro-Korrelationsdaten verfügbar.</div>
      </SectionCard>
    );
  }

  // Group correlations by category
  const grouped = mc.correlations.reduce((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {} as Record<string, typeof mc.correlations>);

  const categoryOrder = ["Index", "Macro-Indikator", "Commodity", "Edelmetall", "Industriemetall", "Crypto", "Währung"];
  const sortedCategories = categoryOrder.filter(c => grouped[c]);

  const sensColors = {
    Hoch: { bg: "bg-red-500/5 border-red-500/20", text: "text-red-500" },
    Mittel: { bg: "bg-amber-500/5 border-amber-500/20", text: "text-amber-500" },
    Niedrig: { bg: "bg-emerald-500/5 border-emerald-500/20", text: "text-emerald-500" },
  };
  const sensStyle = sensColors[mc.overallMacroSensitivity];

  return (
    <SectionCard number={17} title="MAKRO-KORRELATIONEN & INDEX-SENSITIVITÄT">
      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className={`rounded-lg p-3 border ${sensStyle.bg}`}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Makro-Sensitivität</div>
          <div className={`text-lg font-bold mt-1 ${sensStyle.text}`}>{mc.overallMacroSensitivity}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{mc.correlations.length} Korrelationen analysiert</div>
        </div>
        <div className="bg-muted/20 rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            <BarChart3 className="w-3 h-3 inline mr-1" />
            Key Insight
          </div>
          <div className="text-xs text-foreground/80 leading-relaxed">{mc.keyInsight}</div>
        </div>
      </div>

      {/* Correlation Summary Table */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Korrelations-Matrix ({data.ticker})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Indikator</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Kategorie</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Korrelation</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Stärke</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {mc.correlations
                .sort((a, b) => {
                  const strengthOrder = { Stark: 0, Moderat: 1, Schwach: 2 };
                  return (strengthOrder[a.strength] ?? 2) - (strengthOrder[b.strength] ?? 2);
                })
                .map((c, i) => {
                  const cc = corrColors[c.correlation] || corrColors.Neutral;
                  const sc = strengthColors[c.strength] || strengthColors.Schwach;
                  return (
                    <tr key={i} className="hover:bg-muted/10 transition-colors">
                      <td className="py-2 px-2 font-medium">
                        <div className="flex items-center gap-1.5">
                          <CorrIcon corr={c.correlation} />
                          <span>{c.name}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className="text-muted-foreground">{categoryIcons[c.category] || ""} {c.category}</span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${cc.bg} ${cc.text} border ${cc.border}`}>
                          {cc.label}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${sc.bg} ${sc.text}`}>
                          {c.strength}
                        </span>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Correlations by Category */}
      <div className="space-y-3">
        {sortedCategories.map(cat => {
          const items = grouped[cat];
          return (
            <div key={cat}>
              <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                {categoryIcons[cat]} {cat === "Macro-Indikator" ? "Makro-Indikatoren" : cat === "Commodity" ? "Energie-Rohstoffe" : cat === "Edelmetall" ? "Edelmetalle" : cat === "Industriemetall" ? "Industriemetalle" : cat === "Crypto" ? "Kryptowährungen" : cat === "Währung" ? "Währungen" : "Indizes"}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {items.map((c, i) => {
                  const cc = corrColors[c.correlation] || corrColors.Neutral;
                  const sc = strengthColors[c.strength] || strengthColors.Schwach;
                  return (
                    <div key={i} className={`rounded-lg border p-2.5 ${cc.border}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <CorrIcon corr={c.correlation} />
                        <span className="text-xs font-semibold flex-1">{c.name}</span>
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${cc.bg} ${cc.text}`}>
                          {cc.label}
                        </span>
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${sc.bg} ${sc.text}`}>
                          {c.strength}
                        </span>
                      </div>
                      <div className="text-[11px] text-foreground/70 leading-relaxed">
                        {c.mechanism}
                      </div>
                      {c.currentLevel && (
                        <div className="text-[10px] text-muted-foreground mt-1 font-mono tabular-nums">
                          Aktuell: {c.currentLevel}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
