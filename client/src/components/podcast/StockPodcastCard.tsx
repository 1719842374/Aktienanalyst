/**
 * Aktien-Podcast in Section 2: Skript laden (useStockPodcast) und im gemeinsamen Player abspielen.
 * Kapitel 1 Earnings Call, Kapitel 2 KI-Gesamtanalyse. Fehlendes bleibt n/a mit Grund.
 */
import React, { useMemo } from "react";
import { Loader2, Mic, RefreshCw } from "lucide-react";
import type { StockAnalysis } from "@shared/schema";
import { stockPodcastEpisode } from "@shared/stock-podcast";
import { useStockPodcast } from "@/hooks/useStockPodcast";
import { PodcastPlayer } from "./PodcastPlayer";

export function StockPodcastCard({ data }: { data: StockAnalysis }) {
  const { state, retry } = useStockPodcast(data);
  const episode = useMemo(() => (state.phase === "done" ? stockPodcastEpisode(state.script, data.companyName) : null), [state, data.companyName]);

  if (state.phase === "loading") {
    return (
      <div data-testid="stock-podcast-loading" className="rounded-xl border border-border bg-card text-foreground p-3 sm:p-4 flex items-center gap-3">
        <div aria-hidden className="shrink-0 w-16 h-16 rounded-lg bg-gradient-to-br from-primary via-primary/70 to-emerald-500 flex items-center justify-center text-primary-foreground">
          <Mic className="w-5 h-5" />
        </div>
        <div className="min-w-0 text-[12px] text-foreground/80">
          <div className="text-sm font-semibold text-foreground">KI-Podcast zu {data.ticker}</div>
          <div className="flex items-center gap-1.5 mt-1"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Earnings Call und Analyse werden zum Skript …</div>
        </div>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div data-testid="stock-podcast-error" className="rounded-xl border border-border bg-card text-foreground p-3 text-[12px] flex items-start justify-between gap-2">
        <span className="min-w-0 break-words">{state.error}</span>
        <button type="button" onClick={retry} className="shrink-0 inline-flex items-center gap-1 text-[11px] text-foreground/80 hover:text-foreground">
          <RefreshCw className="w-3 h-3" /> Erneut
        </button>
      </div>
    );
  }
  const script = state.script;
  return (
    <div data-testid="stock-podcast" className="space-y-1">
      {episode && <PodcastPlayer episode={episode} scope="stock" />}
      <details className="text-[10px] text-foreground/60 px-1">
        <summary className="cursor-pointer select-none">
          Skript {script.cached ? "aus dem Cache" : "neu erstellt"} · {new Date(script.generatedAt).toLocaleString("de-DE")} · Modell {script.model ?? "n/a"}
        </summary>
        <ul className="mt-1 space-y-0.5 break-words" data-testid="stock-podcast-diagnostics">
          {script.earnings.reason && <li>Kapitel 1: {script.earnings.reason}</li>}
          {script.analysis.reason && <li>Kapitel 2: {script.analysis.reason}</li>}
          {script.earnings.diagnostics.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      </details>
    </div>
  );
}
