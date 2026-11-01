/**
 * F1-17 / F1-18: Dividendenrendite gegen eigene Historie und Peers/Sektor.
 * Nur Text. Kein Score, kein Rating, kein Live-P.
 */
import type { DividendMedianResult } from "@shared/dividends";
import { useDividendYieldContext, type DividendYieldContextInput } from "@/lib/useDividendHistory";

function na(reason: string): string {
  return `n/a — ${reason}`;
}

function medianText(prefix: string, result: DividendMedianResult): string {
  if (!result.available) return `${prefix}: ${na(result.reason)}`;
  const n = result.n > 1 ? ` (n=${result.n})` : "";
  return `${prefix}: Median ${result.medianPct.toFixed(2)} %${n}`;
}

function Stat({ label, testid, value, sub }: { label: string; testid: string; value: string; sub?: string | null }) {
  return (
    <div className="bg-muted/30 rounded-md p-2 border border-border/50 min-w-0" data-testid={testid}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold font-mono tabular-nums break-words">{value}</div>
      {sub ? <div className="text-[10px] text-muted-foreground break-words">{sub}</div> : null}
    </div>
  );
}

function thresholdText(threshold: ReturnType<typeof useDividendYieldContext>["threshold"]): string {
  if (!threshold.available) return `Schwelle: ${na(threshold.reason)}`;
  return `Schwelle: hoch ${threshold.highPct.toFixed(2)} % / tief ${threshold.lowPct.toFixed(2)} % (Gewichte Historie ${threshold.historyWeight}, Peers ${threshold.peerWeight})`;
}

/** Sektion 6: aktuelle Rendite, Perzentil, Median, Min, Max, adaptive Schwelle, Peers, Sektor. */
export function DividendYieldSpanPanel({ data }: { data: DividendYieldContextInput }) {
  const { span, peer, sector, threshold } = useDividendYieldContext(data);
  return (
    <div data-testid="dividend-span" className="space-y-2 text-xs break-words min-w-0 max-w-full">
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Dividendenrendite</h3>
      <p className="text-[10px] text-muted-foreground">
        TTM gegen die eigene Historie aus /api/dividends und den Peer-Median. Kein Score.
      </p>
      {span.available ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Stat label="Aktuell (TTM)" testid="dividend-span-current" value={`${span.currentPct.toFixed(2)} %`} sub={span.asOf} />
          <Stat label="Perzentil" testid="dividend-span-percentile" value={span.percentile.toFixed(0)} sub="eigene Historie" />
          <Stat label="Median" testid="dividend-span-median" value={`${span.median.toFixed(2)} %`} />
          <Stat label="Min" testid="dividend-span-min" value={`${span.min.toFixed(2)} %`} />
          <Stat label="Max" testid="dividend-span-max" value={`${span.max.toFixed(2)} %`} />
          <Stat label="n" testid="dividend-span-n" value={String(span.n)} sub="TTM-Punkte" />
        </div>
      ) : (
        <p data-testid="dividend-span-current" className="break-words">{na(span.reason)}</p>
      )}
      <p data-testid="dividend-span-threshold" className="text-[11px] text-foreground/80 break-words">{thresholdText(threshold)}</p>
      <p data-testid="dividend-span-peers" className="text-[11px] text-foreground/80 break-words">{medianText("Peers", peer)}</p>
      <p data-testid="dividend-span-sector" className="text-[11px] text-foreground/80 break-words">{medianText("Sektor", sector)}</p>
    </div>
  );
}

/** Sektion 20 / Exec: ein Satz, nur wenn die adaptive Schwelle (oder, ohne Peer-Median, die eigene Historie) auffällig ist. */
export function DividendNotableHint({ data }: { data: DividendYieldContextInput }) {
  const { hint, span } = useDividendYieldContext(data);
  const mismatch = !span.available && span.reason.includes("≠");
  if (!hint && !mismatch) return null;
  return (
    <p
      data-testid={hint ? "dividend-notable-hint" : "dividend-currency-mismatch"}
      className="text-xs text-amber-700 dark:text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5 break-words min-w-0 max-w-full"
    >
      {hint ?? (!span.available ? `Dividendenrendite: ${na(span.reason)}` : null)}
    </p>
  );
}
