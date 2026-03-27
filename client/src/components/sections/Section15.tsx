import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";
import { Shield, ShieldAlert, ShieldCheck, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface Props { data: StockAnalysis }

const forceIcons: Record<string, string> = {
  "Bedrohung durch neue Wettbewerber": "🚪",
  "Verhandlungsmacht der Lieferanten": "🏭",
  "Verhandlungsmacht der Kunden": "👥",
  "Bedrohung durch Substitute": "🔄",
  "Wettbewerbsintensität": "⚔️",
};

const ratingColors: Record<string, { bg: string; text: string; border: string }> = {
  Low: { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20" },
  Medium: { bg: "bg-amber-500/10", text: "text-amber-500", border: "border-amber-500/20" },
  High: { bg: "bg-red-500/10", text: "text-red-500", border: "border-red-500/20" },
};

export function Section15({ data }: Props) {
  const moat = data.moatAssessment;
  const [expandedForce, setExpandedForce] = useState<number | null>(null);

  if (!moat) {
    return (
      <SectionCard number={15} title="MOAT & PORTER'S FIVE FORCES">
        <div className="text-xs text-muted-foreground">Keine Moat-Daten verfügbar.</div>
      </SectionCard>
    );
  }

  const avgScore = moat.porterForces.reduce((s, f) => s + f.score, 0) / moat.porterForces.length;

  return (
    <SectionCard number={15} title="MOAT & PORTER'S FIVE FORCES">
      {/* Moat Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className={`rounded-lg p-3 border ${
          moat.overallRating === "Wide" ? "bg-emerald-500/5 border-emerald-500/20" :
          moat.overallRating.includes("Narrow") ? "bg-amber-500/5 border-amber-500/20" :
          "bg-red-500/5 border-red-500/20"
        }`}>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Moat Rating</div>
          <div className="flex items-center gap-2 mt-1">
            {moat.overallRating === "Wide" ? (
              <ShieldCheck className="w-5 h-5 text-emerald-500" />
            ) : moat.overallRating.includes("Narrow") ? (
              <Shield className="w-5 h-5 text-amber-500" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-red-500" />
            )}
            <span className={`text-lg font-bold ${
              moat.overallRating === "Wide" ? "text-emerald-500" :
              moat.overallRating.includes("Narrow") ? "text-amber-500" :
              "text-red-500"
            }`}>{moat.overallRating}</span>
          </div>
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Nachhaltigkeit</div>
          <div className="text-lg mt-1">{moat.sustainabilityRating}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">{moat.businessModelStrength}</div>
        </div>

        <div className="bg-muted/30 rounded-lg p-3 border border-border/50">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Porter Avg. Score</div>
          <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${
            avgScore <= 2.5 ? "text-emerald-500" : avgScore <= 3.5 ? "text-amber-500" : "text-red-500"
          }`}>
            {avgScore.toFixed(1)} / 5
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {avgScore <= 2.5 ? "Starke Position" : avgScore <= 3.5 ? "Moderate Position" : "Vulnerable"}
          </div>
        </div>
      </div>

      {/* Moat Sources */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Moat-Quellen</h3>
        <div className="flex flex-wrap gap-2">
          {moat.moatSources.map((source, i) => (
            <span
              key={i}
              className={`px-2.5 py-1 text-xs rounded-md border ${
                moat.overallRating === "Wide" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" :
                moat.overallRating.includes("Narrow") ? "bg-amber-500/10 text-amber-500 border-amber-500/20" :
                "bg-muted/30 text-muted-foreground border-border/50"
              }`}
            >
              {source}
            </span>
          ))}
        </div>
      </div>

      {/* Porter's Five Forces */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Porter's Five Forces</h3>
        <div className="space-y-2">
          {moat.porterForces.map((force, i) => {
            const colors = ratingColors[force.rating] || ratingColors.Medium;
            const isExpanded = expandedForce === i;
            const icon = forceIcons[force.name] || "•";

            return (
              <div key={i} className={`rounded-lg border ${colors.border} overflow-hidden`}>
                <button
                  onClick={() => setExpandedForce(isExpanded ? null : i)}
                  className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/20 transition-colors"
                  data-testid={`button-porter-force-${i}`}
                >
                  <span className="text-base flex-shrink-0">{icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{force.name}</div>
                  </div>
                  {/* Score visualization */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <div
                          key={n}
                          className={`w-3 h-3 rounded-sm ${
                            n <= force.score ? colors.bg + ' ' + colors.border + ' border' : 'bg-muted/30 border border-border/30'
                          }`}
                        />
                      ))}
                    </div>
                    <span className={`text-xs font-bold font-mono tabular-nums w-8 text-center ${colors.text}`}>
                      {force.rating}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-3 h-3 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    )}
                  </div>
                </button>
                {isExpanded && (
                  <div className={`px-3 pb-3 pt-0 text-xs text-foreground/80 leading-relaxed border-t ${colors.border} mx-3 mb-2 pt-2`}>
                    {force.reasoning}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Spider Chart Alternative — Visual Score Summary */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Wettbewerbspositions-Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Force</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Bewertung</th>
                <th className="text-center py-2 px-2 text-muted-foreground font-medium">Score</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Impact auf Moat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {moat.porterForces.map((force, i) => {
                const colors = ratingColors[force.rating];
                const moatImpact = force.rating === "Low" ? "Stärkt den Moat" :
                  force.rating === "Medium" ? "Neutral" : "Schwächt den Moat";
                return (
                  <tr key={i}>
                    <td className="py-2 px-2 font-medium">{force.name}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${colors.bg} ${colors.text} border ${colors.border}`}>
                        {force.rating}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-center font-mono tabular-nums font-bold">{force.score}/5</td>
                    <td className={`py-2 px-2 ${
                      force.rating === "Low" ? "text-emerald-500" :
                      force.rating === "High" ? "text-red-500" :
                      "text-muted-foreground"
                    }`}>
                      {moatImpact}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}
