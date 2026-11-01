import { waccRoicSignal } from "@shared/wacc-roic-signal";

/** ROIC gegen den in Sektion 6 gezeigten Live-WACC. Nur Anzeige, keine neue WACC-Rechnung. */
export function WaccRoicBadge({ roicPct, waccPct }: { roicPct: number | null; waccPct: number | null }) {
  const signal = waccRoicSignal(roicPct, waccPct);
  const tone = signal.tone === "create"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : signal.tone === "destroy"
      ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
      : signal.tone === "flat"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-border bg-muted/30 text-muted-foreground";
  return (
    <div className={`rounded-md border px-3 py-2 text-[11px] min-w-0 ${tone}`} data-testid="wacc-roic-signal">
      <div className="font-semibold">{signal.label}</div>
      <div className="font-mono tabular-nums mt-0.5">
        ROIC {signal.roicPct == null ? "n/a" : `${signal.roicPct.toFixed(1)} %`}
        {" · "}
        WACC {signal.waccPct == null ? "n/a" : `${signal.waccPct.toFixed(2)} %`}
        {signal.spreadPp != null && <> · Spread {signal.spreadPp >= 0 ? "+" : ""}{signal.spreadPp.toFixed(2)} pp</>}
      </div>
    </div>
  );
}
