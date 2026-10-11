import React from "react";
import type { GoldAnalysis, GoldModelGate } from "../../../../shared/gold-schema";

type AdaptiveData = Pick<GoldAnalysis, "adaptiveScore" | "goldNews" | "realYieldModel" | "multiFactorModel">;

function num(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const text = value.toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

function plain(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return value.toFixed(digits);
}

function stamp(iso: string | null | undefined): string {
  if (!iso) return "N/A";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function flagWord(flag: number | null | undefined): string {
  if (flag == null || !Number.isFinite(flag)) return "N/A";
  if (flag > 0) return "bullish";
  if (flag < 0) return "bearish";
  return "neutral";
}

function gateList(data: AdaptiveData): GoldModelGate[] {
  const gates: GoldModelGate[] = [];
  for (const gate of data.realYieldModel?.gates ?? []) gates.push(gate);
  if (data.multiFactorModel?.gate) gates.push(data.multiFactorModel.gate);
  for (const gate of data.adaptiveScore?.gates ?? []) gates.push(gate);
  return gates;
}

export function GoldAdaptiveSection({ data }: { data: AdaptiveData }) {
  const score = data.adaptiveScore;
  const news = data.goldNews;
  const gates = gateList(data);
  const scoreText = score?.score == null ? "N/A" : num(score.score);
  const scoreClass = score?.score == null
    ? "text-muted-foreground bg-muted/40 border-border"
    : score.score > 0
      ? "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
      : score.score < 0
        ? "text-red-500 bg-red-500/10 border-red-500/20"
        : "text-amber-500 bg-amber-500/10 border-amber-500/20";

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="gold-adaptive-section">
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

        <div className="space-y-1" data-testid="gold-adaptive-gates">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Gates</div>
          {gates.length === 0 && <div className="text-[11px] text-muted-foreground">N/A</div>}
          {gates.map(gate => (
            <div
              key={gate.id}
              data-testid={`gold-gate-${gate.id}`}
              className={`text-[10px] px-2 py-1 rounded border ${
                gate.active
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-muted/30 border-border text-muted-foreground"
              }`}
            >
              {gate.id}: {gate.active ? "aktiv" : "inaktiv"} — {gate.rationale}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border/50 bg-card/50 p-3 space-y-2" data-testid="gold-news-card">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-foreground">Gold-News</div>
            <div className="text-[10px] font-mono tabular-nums text-muted-foreground" data-testid="gold-news-flag">
              Flag {news?.flag == null ? "N/A" : `${num(news.flag)} ${flagWord(news.flag)}`}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="gold-news-summary">
            {news?.summary || "N/A"}
          </p>
          <div className="text-[10px] text-muted-foreground">
            Stand {stamp(news?.updatedAt)}
            {news?.unavailableReason ? ` · ${news.unavailableReason}` : ""}
            {news ? ` · Cache ${news.cacheTtlHours} h` : ""}
          </div>
          {news && news.items.length > 0 && (
            <div className="space-y-1">
              {news.items.slice(0, 8).map((item, index) => (
                <a
                  key={`${item.url}-${index}`}
                  href={item.url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs text-foreground/80 hover:text-amber-500"
                >
                  {item.title}
                  <span className="text-[10px] text-muted-foreground"> · {item.source || "N/A"}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
