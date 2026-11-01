/**
 * F1-39: Dollar-Anteil an den Weltreserven (IMF COFER) im Buffett-Abschnitt des
 * Rezessions-Dashboards (Future_1_Work.md Z.461). Nur Anzeige, kein Score.
 * Daten: useQuery ohne eigene queryFn → Default-Fetcher in client/src/lib/queryClient.ts
 * → GET /api/macro/dollar-reserve-share.
 */
import { useQuery } from "@tanstack/react-query";
import {
  DOLLAR_RESERVE_SHARE_PARAMS,
  DOLLAR_RESERVE_TREND_ARROW,
  DOLLAR_RESERVE_TREND_LABEL,
  type DollarReserveShareResponse,
} from "@shared/dollar-reserve-share";

function formatFixed(value: number): string {
  return Math.abs(value).toFixed(DOLLAR_RESERVE_SHARE_PARAMS.displayDecimals).replace(".", ",");
}

function formatPct(value: number): string {
  return `${formatFixed(value)} %`;
}

/**
 * 5xx außerhalb der Route: der Default-Fetcher wirft `${status}: ${body}`.
 * Nur die führenden Ziffern sind der HTTP-Status. Der Body bleibt unsichtbar.
 * Ohne führende Ziffern kein Status in der Zeile.
 */
function gatewayErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const status = /^(\d+)/.exec(message)?.[1];
  return status
    ? `n/a — Datenquelle nicht erreichbar (HTTP ${status})`
    : "n/a — Datenquelle nicht erreichbar";
}

export function DollarReserveShareCard() {
  const query = useQuery<DollarReserveShareResponse | null>({
    queryKey: ["/api/macro/dollar-reserve-share"],
    staleTime: DOLLAR_RESERVE_SHARE_PARAMS.cacheTtlMs,
  });
  const data = query.data;
  const ready = !!data && data.available && data.latestPct != null && !!data.latestPeriod;

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3" data-testid="card-dollar-reserve-share">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold">Dollar-Anteil an Weltreserven (IMF COFER)</span>
        <span className="text-[9px] text-muted-foreground">nur Anzeige, kein Score</span>
      </div>
      {query.isLoading ? (
        <p className="text-[11px] text-muted-foreground">wird geladen …</p>
      ) : query.isError ? (
        <p className="text-[11px] leading-snug text-muted-foreground" data-testid="text-dollar-reserve-share-error">
          {gatewayErrorText(query.error)}
        </p>
      ) : !data ? (
        <p className="text-[11px] leading-snug text-muted-foreground" data-testid="text-dollar-reserve-share-error">
          n/a — keine Daten
        </p>
      ) : !ready ? (
        <p className="text-[11px] leading-snug text-muted-foreground" data-testid="text-dollar-reserve-share-error">
          n/a — {data.reason ?? "keine Daten"}
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-mono text-lg font-bold tabular-nums" data-testid="text-dollar-reserve-share-value">
            {formatPct(data.latestPct!)}
          </span>
          <span className="text-[11px] text-muted-foreground" data-testid="text-dollar-reserve-share-period">
            Stand {data.latestPeriod}
          </span>
          <span className="text-[11px] text-foreground" data-testid="text-dollar-reserve-share-trend">
            {data.trend
              ? `${DOLLAR_RESERVE_TREND_ARROW[data.trend.direction]} ${DOLLAR_RESERVE_TREND_LABEL[data.trend.direction]} (Perzentil ${formatFixed(data.trend.percentile)})`
              : `Trend n/a — ${data.trendReason ?? "keine Einordnung"}`}
          </span>
        </div>
      )}
    </div>
  );
}
