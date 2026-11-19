/**
 * ScreenerPanel with Phase-2 Watchlist/Portfolio buttons.
 * Custom Criteria filtern nur die bereits geladenen Kandidaten.
 */
import { useState } from "react";
import { ListPlus } from "lucide-react";
import { TickerAddButtons, bulkAddToWatchlist } from "@/components/portfolio/TickerAddButtons";
import { CustomCriteriaFields } from "@/components/screener/CustomCriteriaFields";
import type { PortfolioRegion } from "@/lib/portfolio/watchlist";
import {
  LOADED_UNIVERSE_NOTE,
  MISSING_INDUSTRY,
  MISSING_MARKET_CAP,
  RESEARCHER_MARKET_CAP_USD_PER_MILLION,
  criteriaFromInputs,
  emptyDraft,
  projectLoadedScreen,
  rowFromLoadedCandidate,
} from "@shared/custom-screen";

const ACTION_COLORS: Record<string, string> = {
  Buy: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  Watch: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  Avoid: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

// ============================================================
// Tab 3: Screener
// ============================================================

export function ScreenerPanel({ data, region }: { data: any; region?: PortfolioRegion }) {
  const [criteriaDraft, setCriteriaDraft] = useState(emptyDraft());
  const candidates: any[] = data.candidates || [];
  const parsedCriteria = criteriaFromInputs(criteriaDraft, RESEARCHER_MARKET_CAP_USD_PER_MILLION);
  const customScreen = projectLoadedScreen<any>(candidates, rowFromLoadedCandidate, parsedCriteria.criteria);
  const visible = customScreen.visible;
  const criteriaNotes = Array.from(new Set([
    LOADED_UNIVERSE_NOTE,
    ...parsedCriteria.notes,
    ...customScreen.unavailable,
    ...customScreen.skipped,
  ]));
  if (!candidates.length) {
    return (
      <div className="text-center py-12 text-[11px] text-foreground/50">
        Keine Kandidaten gefunden. Filter anpassen oder andere Region wählen.
      </div>
    );
  }
  function handleBulkWatchlist() {
    const items = visible
      .filter((c: any) => c?.ticker)
      .map((c: any) => ({ ticker: String(c.ticker), name: c.companyName, score: c.moatScore ?? null }));
    const r = bulkAddToWatchlist(items, "researcher", region);
    window.alert(`Watchlist: ${r.added} neu, ${r.skipped} übersprungen (Duplikat/leer)`);
  }

  return (
    <div className="space-y-2">
      <CustomCriteriaFields
        draft={criteriaDraft}
        onField={(key, value) => setCriteriaDraft((prev) => ({ ...prev, [key]: value }))}
        idPrefix="screen"
        testId="custom-screen-form"
        marketCapUnit="Mio. USD"
      />
      <p className="text-[10px] text-foreground/50" data-testid="screen-na-notes">{criteriaNotes.join(" · ")}</p>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[10px] text-foreground/50">
          {visible.length === candidates.length
            ? `${candidates.length} Kandidaten`
            : `${visible.length} von ${candidates.length} geladenen Kandidaten`}
        </span>
        <button
          type="button"
          onClick={handleBulkWatchlist}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] border border-border/50 text-foreground/80 hover:bg-muted/40"
          title="Alle sichtbaren Screener-Kandidaten zur Watchlist (P2/P3)"
        >
          <ListPlus className="w-3 h-3" /> Alle sichtbaren zur Watchlist
        </button>
      </div>
      {visible.length === 0 && (
        <div className="text-center py-8 text-[11px] text-foreground/50">
          Keine geladenen Kandidaten erfüllen die Kriterien.
        </div>
      )}
      {visible.map((c, idx) => (
        <div key={c.ticker || idx} className="rounded-lg border border-border/40 bg-card/30 p-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0">
              <div className="text-[10px] font-mono text-foreground/40">#{idx + 1}</div>
              <div className="text-base font-bold font-mono text-foreground/95">{c.ticker}</div>
              <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded border inline-block mt-1 ${ACTION_COLORS[c.actionRecommendation] || ""}`}>
                {c.actionRecommendation}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-foreground/90 truncate">{c.companyName}</div>
              <div className="text-[10px] text-foreground/50">{c.sector || "n/a"} · {c.industry ? c.industry : MISSING_INDUSTRY}</div>
              <p className="text-[11px] text-foreground/75 mt-1.5 leading-relaxed">{c.rationale}</p>
              {c.growthDrivers?.length > 0 && (
                <div className="mt-2">
                  <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Growth Drivers</div>
                  <div className="flex flex-wrap gap-1">
                    {c.growthDrivers.map((d: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-[10px] text-emerald-300/90">{d}</span>
                    ))}
                  </div>
                </div>
              )}
              {c.risks?.length > 0 && (
                <div className="mt-1.5">
                  <div className="text-[9px] uppercase text-foreground/40 mb-0.5">Risks</div>
                  <div className="flex flex-wrap gap-1">
                    {c.risks.map((d: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded bg-rose-500/10 text-[10px] text-rose-300/90">{d}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="shrink-0 flex flex-col items-end gap-2">
              <TickerAddButtons ticker={c.ticker} name={c.companyName} source="researcher" score={c.moatScore ?? null} region={region} />
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-right text-[10px]">
              <div className="text-foreground/40">MCap</div>
              <div className="font-mono tabular-nums text-foreground/85" title={Number.isFinite(c.marketCap) && c.marketCap !== 0 ? undefined : MISSING_MARKET_CAP}>{Number.isFinite(c.marketCap) && c.marketCap !== 0 ? `$${(c.marketCap / 1e9).toFixed(1)}B` : "n/a"}</div>
              <div className="text-foreground/40">P/E</div>
              <div className="font-mono tabular-nums text-foreground/85">{c.pe?.toFixed(1) || "—"}</div>
              <div className="text-foreground/40">RevGrth</div>
              <div className="font-mono tabular-nums text-foreground/85">{c.revenueGrowth?.toFixed(1) || "—"}%</div>
              <div className="text-foreground/40 pt-1">Moat</div>
              <div className="font-bold tabular-nums text-violet-400 pt-1">{c.moatScore}/10</div>
              <div className="text-foreground/40">M-Risk</div>
              <div className="font-bold tabular-nums text-amber-400">{c.marginRiskScore}/10</div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
