/**
 * CapexPanel with Phase-2 Watchlist/Portfolio buttons.
 */
import { TickerAddButtons } from "@/components/portfolio/TickerAddButtons";
import type { PortfolioRegion } from "@/lib/portfolio/watchlist";

const IMPACT_COLORS: Record<string, string> = {
  high: "bg-violet-500/15 text-violet-300",
  medium: "bg-sky-500/10 text-sky-300",
  low: "bg-foreground/10 text-foreground/60",
};

// ============================================================
// Tab 4: Capex & Fiscal
// ============================================================

export function CapexPanel({ data, region }: { data: any; region?: PortfolioRegion }) {
  const programmes: any[] = data.programmes || [];
  const sectorExposure: any[] = Array.isArray(data.sectorExposure) ? data.sectorExposure : [];
  const isEmpty = programmes.length === 0 && !data.headline && !data.totalCapexEstimate;
  if (isEmpty) {
    return (
      <div className="text-center py-12 text-[11px] text-foreground/50">
        Keine Capex- oder Fiskalprogramme erfasst. Bitte „Aktualisieren\" klicken.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {(data.headline || data.summary) && (
        <div className="rounded-lg border border-violet-400/30 bg-violet-500/[0.06] p-3">
          {data.headline && (
            <div className="text-sm font-semibold text-foreground/90">{data.headline}</div>
          )}
          {data.summary && (
            <p className="text-[11px] text-foreground/75 leading-relaxed mt-1.5">{data.summary}</p>
          )}
        </div>
      )}

      {(data.totalCapexEstimate || data.govSpendingTrend) && (
        <div className="rounded-lg border border-border/40 bg-card/30 p-3 space-y-2">
          {data.totalCapexEstimate && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">Total Capex / Fiscal Volume</div>
              <div className="text-sm font-semibold text-foreground/85 mt-0.5">{data.totalCapexEstimate}</div>
            </div>
          )}
          {data.govSpendingTrend && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-foreground/40">Gov Spending Trend</div>
              <div className="text-[11px] text-foreground/75 mt-0.5 leading-relaxed">{data.govSpendingTrend}</div>
            </div>
          )}
        </div>
      )}

      {sectorExposure.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-foreground/40 mb-2">Sector Exposure ({sectorExposure.length})</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {sectorExposure.map((s: any, idx: number) => {
              const impact = String(s.impact || "neutral").toLowerCase();
              const impactClass = impact === "positiv"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                : impact === "negativ"
                ? "bg-rose-500/15 text-rose-300 border-rose-400/30"
                : "bg-foreground/10 text-foreground/60 border-border/40";
              return (
                <div key={idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="text-xs font-semibold text-foreground/90">{s.sector}</div>
                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border ${impactClass}`}>{s.impact}</span>
                  </div>
                  {s.timeline && (
                    <div className="text-[10px] text-foreground/50 mb-1.5">{s.timeline}</div>
                  )}
                  {s.reasoning && (
                    <p className="text-[11px] text-foreground/75 leading-relaxed">{s.reasoning}</p>
                  )}
                  {Array.isArray(s.programmes) && s.programmes.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {s.programmes.map((p: string, i: number) => (
                        <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] text-violet-300/90">{p}</span>
                      ))}
                    </div>
                  )}
                  {Array.isArray(s.listedBeneficiaries) && s.listedBeneficiaries.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/20">
                      <div className="text-[10px] font-medium text-muted-foreground mb-1.5">
                        📈 Börsennotierte Profiteure
                      </div>
                      <div className="space-y-1">
                        {s.listedBeneficiaries.map((b: any) => (
                          <div key={b.ticker} className="flex items-start gap-2 text-[10px]">
                            <span className="font-mono font-bold text-primary shrink-0 w-14">{b.ticker}</span>
                            <span className="text-muted-foreground flex-1 min-w-0">
                              {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                              {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                              {b.rationale}
                            </span>
                            <TickerAddButtons ticker={b.ticker} name={b.name} source="researcher" region={region} compact />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {programmes.map((p, idx) => (
          <div key={idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-foreground/90">{p.name}</div>
                <div className="text-[10px] text-foreground/50">{p.region} · {p.timeline}</div>
              </div>
              <div className="flex flex-col items-end gap-0.5 shrink-0">
                {p.amountUSD && (
                  <span className="text-xs font-mono font-semibold text-violet-300">{p.amountUSD}</span>
                )}
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${IMPACT_COLORS[p.impact] || ""}`}>
                  {p.impact}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-1 mb-2">
              <span className="px-1.5 py-0.5 rounded bg-muted/40 text-[10px] text-foreground/70">{p.category}</span>
              <span className="px-1.5 py-0.5 rounded bg-foreground/5 text-[10px] text-foreground/60">{p.status}</span>
            </div>
            <p className="text-[11px] text-foreground/75 leading-relaxed">{p.rationale}</p>
            {p.sectors?.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Sectors</div>
                <div className="flex flex-wrap gap-1">
                  {p.sectors.map((s: string, i: number) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[10px] text-emerald-300/90">{s}</span>
                  ))}
                </div>
              </div>
            )}
            {Array.isArray(p.listedBeneficiaries) && p.listedBeneficiaries.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/20">
                <div className="text-[9px] uppercase text-foreground/40 mb-1">📈 Börsennotierte Profiteure</div>
                <div className="space-y-1">
                  {p.listedBeneficiaries.map((b: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[10px]">
                      <span className="font-mono font-bold text-primary shrink-0 min-w-[56px]">{b.ticker}</span>
                      <span className="text-muted-foreground flex-1 min-w-0">
                        {b.name && <span className="text-foreground/80 font-medium">{b.name}</span>}
                        {b.name && b.rationale && <span className="text-foreground/40"> · </span>}
                        {b.rationale}
                      </span>
                      <TickerAddButtons ticker={b.ticker} name={b.name} source="researcher" region={region} compact />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!p.listedBeneficiaries?.length && p.beneficiaries?.length > 0 && (
              <div className="mt-1.5">
                <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Beneficiaries</div>
                <div className="flex flex-wrap gap-1">
                  {p.beneficiaries.map((b: string, i: number) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-violet-500/10 text-[10px] text-violet-300/90 font-mono">{b}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
