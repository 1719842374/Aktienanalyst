/**
 * Skript des Aktien-Podcasts in Section 2, automatisch beim Öffnen der Analyse.
 * Kette: Section1 → StockPodcastCard → dieses Hook → apiRequest POST /api/stock-podcast/:symbol
 * → server/stock-podcast-route → earnings-call-source (FMP/SEC) + OpenRouter. Cache je Ticker und Quartal liegt am Server.
 * Kapitel 2 bekommt denselben Kontext wie der KI-Chat (buildStockChatContext, Budget fitChatContextBudget).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { buildStockChatContext, fitChatContextBudget } from "@shared/chat-context";
import type { StockAnalysis } from "@shared/schema";
import { STOCK_PODCAST_PARAMS, type StockPodcastScript } from "@shared/stock-podcast";

export type StockPodcastState =
  | { phase: "loading"; script: null; error: null }
  | { phase: "done"; script: StockPodcastScript; error: null }
  | { phase: "error"; script: null; error: string };

export function useStockPodcast(data: StockAnalysis): { state: StockPodcastState; retry: () => void } {
  const [state, setState] = useState<StockPodcastState>({ phase: "loading", script: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const context = useMemo(() => fitChatContextBudget(buildStockChatContext(data)), [data]);
  const symbol = data.ticker;

  useEffect(() => {
    let cancel = false;
    setState({ phase: "loading", script: null, error: null });
    apiRequest("POST", `/api/stock-podcast/${encodeURIComponent(symbol)}`, { context, companyName: data.companyName }, STOCK_PODCAST_PARAMS.clientTimeoutMs)
      .then(async (res) => {
        const body = await res.json().catch(() => null) as StockPodcastScript | { error?: string } | null;
        if (cancel) return;
        if (!res.ok || !body || !("earnings" in body)) {
          const err = body && "error" in body && body.error ? body.error : `HTTP ${res.status}`;
          setState({ phase: "error", script: null, error: `n/a — Podcast-Skript: ${err}` });
          return;
        }
        setState({ phase: "done", script: body, error: null });
      })
      .catch((err: unknown) => {
        if (cancel) return;
        setState({ phase: "error", script: null, error: `n/a — Podcast-Skript: ${err instanceof Error ? err.message : "Abruf fehlgeschlagen"}` });
      });
    return () => { cancel = true; };
  // context hängt an data; ein neuer Lauf je Ticker, Datenstand oder Wiederholung.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, data.dataTimestamp, attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { state, retry };
}
