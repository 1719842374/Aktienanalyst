import type { GoldAnalysis } from "../../../../shared/gold-schema";

interface Props { data: GoldAnalysis }

export function GoldCycleSection({ data }: Props) {
  const cycle = data.cycleAssessment;

  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-7 h-7 rounded-md bg-amber-500/10 text-amber-500 text-xs font-bold tabular-nums">7</span>
          <h2 className="text-sm font-semibold text-foreground tracking-tight">Zyklus-Einschätzung</h2>
        </div>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-4">
        {/* Block A: Historical Cycles */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Block A: Historische Gold-Zyklen</div>
          <div className="bg-muted/30 rounded-md p-3 border border-border text-xs text-foreground leading-relaxed">
            {cycle.historicalCycles}
          </div>
        </div>

        {/* Current Phase */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Aktuelle Phase</div>
          <div className={`rounded-md p-3 border text-xs font-medium ${
            data.sentiment === "Bullish"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : data.sentiment === "Bearish"
                ? "bg-red-500/10 border-red-500/20 text-red-400"
                : "bg-amber-500/10 border-amber-500/20 text-amber-400"
          }`}>
            {cycle.currentPhase}
          </div>
        </div>

        {/* Block C: Drivers */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Block C: Treiber & Wendepunkte</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {cycle.drivers.map((driver, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-foreground">
                <span className="flex-shrink-0 mt-0.5">{driver.startsWith("✅") ? "" : ""}</span>
                <span>{driver}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Outlook */}
        <div className="space-y-2">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Ausblick</div>
          <div className="bg-muted/30 rounded-md p-3 border border-border text-xs text-foreground leading-relaxed">
            {cycle.outlook}
          </div>
        </div>
      </div>
    </div>
  );
}
