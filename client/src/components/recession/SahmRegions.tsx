import type { SahmRegionBoard } from "./recessionDashboardShared";

function fmt(value: number): string {
  return value.toFixed(2);
}

/**
 * Eurozone and Japan use the same Sahm score as the US unemployment backup.
 * They stay outside the 17-indicator net.
 */
export function SahmRegions({ regions }: { regions?: SahmRegionBoard[] }) {
  if (!regions?.length) return null;
  const us = regions.find(region => region.region === "US");
  const misses = (us?.control ?? []).filter(row =>
    row.computed == null || row.absDiff == null || row.absDiff > 0.02);
  return (
    <div className="mt-4 space-y-2" data-testid="sahm-regions">
      <h3 className="text-xs font-semibold text-foreground">Sahm nach Region</h3>
      <p className="text-[10px] text-muted-foreground">
        Dieselbe Formel auf der Arbeitslosenquote, dann s(z) über bis zu 20 Jahre.
        0,50 pp bleibt die Beschriftung. Diese Zeilen stehen nicht in der 17er-Summe.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Region</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Karte</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Raw</th>
              <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">S selbst</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">s(S)</th>
              <th className="text-center py-1.5 px-2 text-muted-foreground font-medium">Raw S</th>
              <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">Zone</th>
            </tr>
          </thead>
          <tbody>
            {regions.map(region => (
              <tr key={region.region} className="border-b border-border/50" data-testid={`sahm-region-${region.region}`}>
                <td className="py-1.5 px-2">
                  <div className="font-medium">{region.label}</div>
                  <div className="text-[10px] text-muted-foreground/70">{region.source}</div>
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums">{region.value}</td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums" data-testid={`sahm-raw-${region.region}`}>
                  {region.raw > 0 ? "+" : ""}{region.raw}
                </td>
                <td className="py-1.5 px-2 text-right font-mono tabular-nums" data-testid={`sahm-computed-${region.region}`}>
                  {region.computedValue}
                </td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums">{fmt(region.computedS)}</td>
                <td className="py-1.5 px-2 text-center font-mono tabular-nums" data-testid={`sahm-computed-raw-${region.region}`}>
                  {region.computedAvailable ? `${region.computedRaw > 0 ? "+" : ""}${region.computedRaw}` : "—"}
                </td>
                <td className="py-1.5 px-2 text-[10px]" data-testid={`sahm-zone-${region.region}`}>{region.zone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {us?.control && (
        <p className="text-[10px] text-muted-foreground" data-testid="sahm-us-control">
          {us.controlOk
            ? "US-Kontrolle: die letzten 12 Realtime-Drucke liegen innerhalb ±0,02 des selbst gerechneten S."
            : `US-Kontrolle: ${us.control.length - misses.length}/${us.control.length} der letzten Realtime-Drucke innerhalb ±0,02.`}
          {misses.length > 0 && (
            <span>
              {" "}Daneben: {misses.map(row => `${row.date.slice(0, 7)} Δ=${row.absDiff == null ? "—" : row.absDiff.toFixed(2)}`).join(", ")}.
            </span>
          )}
        </p>
      )}
    </div>
  );
}
