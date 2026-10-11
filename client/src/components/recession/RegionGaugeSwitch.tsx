import { useState } from "react";
import type { RegionId, RegionalCatalogs } from "@shared/recession-regions";
import { regionGaugeView } from "@shared/recession-regions";
import { CurrentAssessment, GaugeMini } from "./recessionDashboardPartsA";
import { getProbBg, getProbColor, getProbLabel, type RecessionAnalysis } from "./recessionDashboardShared";

const BUTTONS: Array<{ id: RegionId; label: string }> = [
  { id: "US", label: "US" },
  { id: "EZ", label: "Europa" },
  { id: "JP", label: "Asien (Japan)" },
];

function CatalogGauge({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <div className="basis-full sm:basis-[calc(50%-0.375rem)] min-w-0 p-4 rounded-lg border border-border flex flex-col items-center">
        <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
        <div className="text-2xl font-bold tabular-nums mt-2 text-muted-foreground">N/A</div>
        <div className="text-xs text-muted-foreground">kein gewerteter Slot</div>
      </div>
    );
  }
  return (
    <div className={`basis-full sm:basis-[calc(50%-0.375rem)] min-w-0 p-4 rounded-lg border ${getProbBg(value)} flex flex-col items-center`}>
      <div className="text-xs font-medium text-muted-foreground mb-1">{label}</div>
      <div className="text-[10px] text-muted-foreground/70 mb-2">Horizont: 12M</div>
      <GaugeMini value={value} />
      <div className={`text-2xl font-bold tabular-nums mt-2 ${getProbColor(value)}`}>{value}%</div>
      <div className={`text-xs font-medium ${getProbColor(value)}`}>{getProbLabel(value)}</div>
    </div>
  );
}

/** Section 1: US shows the five live gauges; Europa/Asien show the catalog P from the same payload. */
export function RegionGaugeSwitch({ data, regions }: { data: RecessionAnalysis; regions: RegionalCatalogs | null }) {
  const [selected, setSelected] = useState<RegionId>("US");
  const view = selected === "US" ? null : regionGaugeView(regions, selected);

  return (
    <div className="space-y-3">
      {regions && (
        <div className="flex gap-1.5" role="group" aria-label="Region" data-testid="region-gauge-switch">
          {BUTTONS.map(btn => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setSelected(btn.id)}
              aria-pressed={selected === btn.id}
              data-testid={`region-btn-${btn.id}`}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${selected === btn.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
      {selected === "US" || !view ? (
        <CurrentAssessment data={data} />
      ) : (
        <div className="space-y-3" data-testid={`region-view-${view.id}`}>
          <div className="flex flex-wrap justify-center gap-3">
            <CatalogGauge label={`${view.label} · Katalog Rezession`} value={view.recessionProbability} />
            <CatalogGauge label={`${view.label} · Katalog Korrektur`} value={view.correctionProbability} />
          </div>
          <div className="text-[11px] text-muted-foreground" data-testid="region-view-coverage">
            {view.scoredSlots} von {view.totalSlots} Slots gewertet.
            {view.sparse && (
              <span className="text-amber-600 dark:text-amber-400" data-testid="region-view-sparse">
                {" "}Zu viele Slots ohne Druck (N/A). Die Katalog-P ist dünn belegt, kein Wert wird ergänzt.
              </span>
            )}
          </div>
          {view.topDrivers.length > 0 && (
            <div className="text-xs" data-testid="region-view-top3">
              <div className="font-medium mb-1">Top-3 Katalog-Treiber</div>
              <ul className="space-y-0.5">
                {view.topDrivers.map(slot => (
                  <li key={slot.name} className="flex justify-between gap-2">
                    <span>{slot.name} <span className="text-muted-foreground">({slot.zone})</span></span>
                    <span className="font-mono tabular-nums">{slot.weightedScore > 0 ? "+" : ""}{slot.weightedScore}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground" data-testid="region-view-action-us">
            Nur Anzeige. Handlung bleibt auf den US-Büchern P_korr12 und P_rez12. Gewichtung 0,70 / 0,20 / 0,10 unverändert (Sektion 8).
          </p>
        </div>
      )}
    </div>
  );
}
