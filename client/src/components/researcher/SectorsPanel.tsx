/**
 * SectorsPanel (extracted).
 */
import { useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import { TickerAddButtons } from "@/components/portfolio/TickerAddButtons";
import type { PortfolioRegion } from "@/lib/portfolio/watchlist";
import { SectorRotationPanel } from "@/components/researcher/SectorRotationPanel";
import "./cycle-progress-table.css";

const ACTION_COLORS: Record<string, string> = {
  Buy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Watch: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Avoid: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

const RISK_COLORS: Record<string, string> = {
  low: "bg-emerald-500/10 text-emerald-400",
  medium: "bg-amber-500/10 text-amber-400",
  high: "bg-rose-500/10 text-rose-400",
};

// ============================================================
// Tab 2: Sector Opportunity
// ============================================================

export function SectorsPanel({ data, region }: { data: any; region?: PortfolioRegion }) {
  const [subtab, setSubtab] = useState<"opportunity" | "rotation">("opportunity");
  const trends: any[] = data?.trends || [];
  const topPicks: string[] = data?.topPicks || [];
  const sectorsStale = !!data && (data?.modelUsed === "fallback" || trends.length === 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-muted/30 rounded-md p-0.5 w-fit">
        <button
          type="button"
          onClick={() => setSubtab("opportunity")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium ${subtab === "opportunity" ? "bg-primary/15 text-primary" : "text-foreground/50 hover:text-foreground/80"}`}
          data-testid="button-sectors-subtab-opportunity"
        >Opportunity</button>
        <button
          type="button"
          onClick={() => setSubtab("rotation")}
          className={`px-2.5 py-1 rounded text-[11px] font-medium ${subtab === "rotation" ? "bg-primary/15 text-primary" : "text-foreground/50 hover:text-foreground/80"}`}
          data-testid="button-sectors-subtab-rotation"
        >Rotation</button>
      </div>
      {subtab === "rotation" ? <SectorRotationPanel /> : (
    <div className="space-y-4">
      {sectorsStale ? (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <div>
            <div className="text-[11px] font-semibold text-rose-200">KI nicht verfügbar — Daten veraltet</div>
            <div className="text-[10px] text-rose-300/80 mt-0.5">
              Keine Sector-Trends generiert. Bitte "Aktualisieren" oben klicken.
            </div>
          </div>
        </div>
      ) : data?._cached ? (
        <div className="text-[10px] text-emerald-400/70">
          Gecachte Analyse — vor {data._cacheAge < 60 ? `${data._cacheAge} Min` : `${Math.round(data._cacheAge / 60)} Std`} erstellt · 0 Credits
        </div>
      ) : null}
      {topPicks.length > 0 && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
          <div className="text-[10px] text-violet-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Top Picks (nach Growth × Moat)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {topPicks.map(id => {
              const t = trends.find(x => x.id === id);
              if (!t) return null;
              return (
                <span key={id} className="px-2 py-0.5 rounded bg-violet-500/15 border border-violet-500/30 text-[10px] text-violet-200 font-medium">
                  {t.label} · G{t.growthScore}/M{t.moatScore}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        {trends.map((t, idx) => (
          <div key={t.id} className="rounded-lg border border-border/40 bg-card/30 p-3">
            <div className="flex items-start gap-3">
              <div className="text-[10px] font-mono text-foreground/40 shrink-0 w-6 pt-0.5">#{idx + 1}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="text-xs font-semibold text-foreground/90">{t.label}</div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${ACTION_COLORS[t.actionRecommendation] || ""}`}>
                    {t.actionRecommendation}
                  </span>
                  <span className="text-[10px] text-foreground/40">· {t.timeline}</span>
                </div>
                <p className="text-[11px] text-foreground/70 mt-1.5 leading-relaxed">{t.reasoning}</p>
                {t.topPlayers?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {t.topPlayers.map((p: string, i: number) => (
                      <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted/40 text-[10px] font-mono text-foreground/70">
                        {p}
                        <TickerAddButtons ticker={p} source="researcher" region={region} compact />
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 grid grid-cols-2 gap-2 text-center">
                <div>
                  <div className="text-[9px] text-foreground/40 uppercase">Growth</div>
                  <div className="text-sm font-bold tabular-nums text-emerald-400">{t.growthScore}<span className="text-[10px] text-foreground/40">/10</span></div>
                </div>
                <div>
                  <div className="text-[9px] text-foreground/40 uppercase">Moat</div>
                  <div className="text-sm font-bold tabular-nums text-violet-400">{t.moatScore}<span className="text-[10px] text-foreground/40">/10</span></div>
                </div>
                <div className="col-span-2">
                  <span className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded ${RISK_COLORS[t.marginRisk] || ""}`}>
                    Margin Risk: {t.marginRisk}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
      )}
    </div>
  );
}
