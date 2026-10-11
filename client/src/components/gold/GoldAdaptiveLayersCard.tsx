import React from "react";
import type { GoldAnalysis } from "../../../../shared/gold-schema";

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function plain(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

export function GoldAdaptiveLayersCard({ data }: { data: Pick<GoldAnalysis, "adaptiveScore"> }) {
  const score = data.adaptiveScore;
  const scoreText = score?.score == null ? "N/A" : num(score.score);
  const scoreClass = score?.score == null
    ? "text-muted-foreground bg-muted/40 border-border"
    : score.score > 0
      ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
      : score.score < 0
        ? "text-red-500 bg-red-500/10 border-red-500/20"
        : "text-amber-500 bg-amber-500/10 border-amber-500/20";

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="gold-adaptive-layers">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">9</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Adaptive Schicht</h2>
          <div className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold font-mono tabular-nums border ${scoreClass}`} data-testid="gold-adaptive-score">
            Score: {scoreText}
          </div>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-3">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          GIS bleibt der bestehende Indikator-Score. Diese Schicht gewichtet Real Yield, Policy, Liquidität, Inflation, Angebot, Technik und Makro mit Stärke.
          Fehlt eine Quelle, steht N/A. Das News-Flag ist ein Hinweis und kein Summand.
        </p>
        <div className="text-[11px] font-mono text-muted-foreground" data-testid="gold-score-delta">
          Δ GIS {num(score?.scoreDelta)}
        </div>

        {score ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 font-medium">Dimension</th>
                  <th className="text-right py-2 font-medium">Gewicht</th>
                  <th className="text-right py-2 font-medium">Stärke</th>
                  <th className="text-right py-2 font-medium">Beitrag</th>
                </tr>
              </thead>
              <tbody>
                {score.layers.map(layer => (
                  <tr key={layer.id} className="border-b border-border/50 align-top" data-testid={`gold-adaptive-layer-${layer.id}`}>
                    <td className="py-2 pr-2">
                      <div className="font-medium text-foreground">{layer.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        Basis {plain(layer.baseWeight, 1)} × Habitat {plain(layer.habitatMultiplier, 2)}
                      </div>
                      <div className="text-[10px] text-muted-foreground hidden sm:block mt-0.5">{layer.detail}</div>
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums">{plain(layer.effectiveWeight)}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{plain(layer.strength)}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{num(layer.contribution)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground" data-testid="gold-adaptive-missing">N/A — adaptive Schicht nicht geladen</div>
        )}

        {score && (
          <div className="bg-muted/30 rounded-md p-3 border border-border space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Rechenweg</div>
            <div className="text-[11px] font-mono text-foreground">{score.formula}</div>
            <div className="text-[11px] text-muted-foreground">{score.habitatNotes.join(" · ")}</div>
            <div className="text-[11px] text-muted-foreground">Volumen: {score.volumeSource ?? "N/A"}</div>
          </div>
        )}
      </div>
    </div>
  );
}
