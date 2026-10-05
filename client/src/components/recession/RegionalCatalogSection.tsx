import { getProbColor, getScoreBg, getScoreColor } from "./recessionDashboardShared";
import type { RegionCatalog, RegionSlot, RegionalCatalogs } from "@shared/recession-regions";

function pct(value: number | null): string {
  return value == null ? "N/A" : `${value}%`;
}

function SlotRow({ regionId, slot }: { regionId: string; slot: RegionSlot }) {
  const score = slot.available ? slot.weightedScore : 0;
  return (
    <tr key={slot.name} className="border-b border-border/50" data-testid={`catalog-slot-${regionId}-${slot.name}`}>
      <td className="py-1 px-1.5">
        <div className="font-medium">{slot.name}</div>
        <div className="text-[10px] text-muted-foreground/70">{slot.source}</div>
      </td>
      <td className="py-1 px-1.5 text-right font-mono tabular-nums">{slot.value}</td>
      <td className="py-1 px-1.5">
        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${getScoreBg(score)} ${getScoreColor(score)}`}>
          {slot.zone}
        </span>
      </td>
      <td className={`py-1 px-1.5 text-center font-mono tabular-nums ${getScoreColor(score)}`}>
        {slot.available ? `${slot.weightedScore > 0 ? "+" : ""}${slot.weightedScore}` : "—"}
      </td>
      <td className="py-1 px-1.5 text-center font-mono tabular-nums text-muted-foreground">
        {slot.available ? slot.maxWeighted : 0}
      </td>
    </tr>
  );
}

function CatalogTile({ region }: { region: RegionCatalog }) {
  return (
    <div className="rounded-md border border-border bg-muted/10 p-2" data-testid={`catalog-${region.id}`}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-xs font-semibold">{region.label}</h3>
        <span className="text-[10px] font-mono text-muted-foreground" data-testid={`catalog-weight-${region.id}`}>
          ×{region.weight.toFixed(2)}
        </span>
      </div>
      <div className="flex gap-3 text-[11px] mb-2">
        <span>
          Katalog Rez.{" "}
          <span className={`font-mono font-semibold ${region.recessionProbability == null ? "" : getProbColor(region.recessionProbability)}`} data-testid={`catalog-rez-${region.id}`}>
            {pct(region.recessionProbability)}
          </span>
        </span>
        <span>
          Katalog Korr.{" "}
          <span className={`font-mono font-semibold ${region.correctionProbability == null ? "" : getProbColor(region.correctionProbability)}`} data-testid={`catalog-korr-${region.id}`}>
            {pct(region.correctionProbability)}
          </span>
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-left py-1 px-1.5 font-medium">Slot</th>
              <th className="text-right py-1 px-1.5 font-medium">Wert</th>
              <th className="text-left py-1 px-1.5 font-medium">Zone</th>
              <th className="text-center py-1 px-1.5 font-medium">Score</th>
              <th className="text-center py-1 px-1.5 font-medium">Max</th>
            </tr>
          </thead>
          <tbody>
            {region.slots.map(slot => (
              <SlotRow key={slot.name} regionId={region.id} slot={slot} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function RegionalCatalogSection({ catalogs }: { catalogs: RegionalCatalogs }) {
  return (
    <div className="space-y-3" data-testid="regional-catalog">
      <p className="text-[11px] text-muted-foreground">
        Gleiches Raster, andere Ämter. Ein fehlender Druck zählt weder im Netto noch im Max.
        Die Mischung nimmt die US-Dashboard-P, die Kachel zeigt nur die Katalog-Slots.
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {catalogs.regions.map(region => (
          <CatalogTile key={region.id} region={region} />
        ))}
      </div>
      <div className="text-xs space-y-1">
        <div data-testid="catalog-blend-recession">
          Gewichtete Rezession 12M:{" "}
          <span className={`font-mono font-semibold ${catalogs.blendedRecession12m == null ? "" : getProbColor(catalogs.blendedRecession12m)}`}>
            {pct(catalogs.blendedRecession12m)}
          </span>
          <span className="text-muted-foreground"> · US {catalogs.weights.US.toFixed(2)} / EZ {catalogs.weights.EZ.toFixed(2)} / JP {catalogs.weights.JP.toFixed(2)}</span>
        </div>
        <div data-testid="catalog-blend-correction">
          Gewichtete Korrektur 12M:{" "}
          <span className={`font-mono font-semibold ${catalogs.blendedCorrection12m == null ? "" : getProbColor(catalogs.blendedCorrection12m)}`}>
            {pct(catalogs.blendedCorrection12m)}
          </span>
        </div>
        {catalogs.actionUsesUsBooks && (
          <p data-testid="catalog-action-us">Handlung bleibt auf den US-Büchern P_korr12 und P_rez12.</p>
        )}
      </div>
    </div>
  );
}
