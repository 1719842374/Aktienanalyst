import { useState } from "react";
import {
  buildRegionSubgroups,
  regionGaugeView,
  type RegionId,
  type RegionalCatalogs,
  type RegionSubgroup,
} from "@shared/recession-regions";
import { CurrentAssessment, GaugeMini } from "./recessionDashboardPartsA";
import { getProbBg, getProbColor, getProbLabel, type RecessionAnalysis } from "./recessionDashboardShared";

const BUTTONS: Array<{ id: RegionId; label: string }> = [
  { id: "US", label: "US" },
  { id: "EZ", label: "Europa" },
  { id: "JP", label: "Asien (Japan)" },
];

function RegionGaugeCard({ sg }: { sg: RegionSubgroup }) {
  const frame = "basis-full sm:basis-[calc(50%-0.375rem)] lg:basis-[calc(33.333%-0.5rem)] xl:basis-[calc(20%-0.6rem)] min-w-0 p-4 rounded-lg border flex flex-col items-center";
  if (sg.probability == null) {
    const reason = sg.missing[0]?.reason ?? "kein gewerteter Slot";
    return (
      <div className={`${frame} border-border`} data-testid={`region-gauge-${sg.name}`}>
        <div className="text-xs font-medium text-muted-foreground mb-1 text-center">{sg.label}</div>
        <div className="text-[10px] text-muted-foreground/70 mb-2">Horizont: {sg.horizon}</div>
        <div className="text-2xl font-bold tabular-nums mt-2 text-muted-foreground">n/a</div>
        <div className="text-[10px] text-center text-muted-foreground mt-1">n/a — {reason}</div>
      </div>
    );
  }
  return (
    <div className={`${frame} ${getProbBg(sg.probability)}`} data-testid={`region-gauge-${sg.name}`}>
      <div className="text-xs font-medium text-muted-foreground mb-1 text-center">{sg.label}</div>
      <div className="text-[10px] text-muted-foreground/70 mb-2">Horizont: {sg.horizon}</div>
      <GaugeMini value={sg.probability} />
      <div className={`text-2xl font-bold tabular-nums mt-2 ${getProbColor(sg.probability)}`}>{sg.probability}%</div>
      <div className={`text-xs font-medium ${getProbColor(sg.probability)}`}>{getProbLabel(sg.probability)}</div>
    </div>
  );
}

/** Section 1: US keeps the five live gauges. Europa/Asien show the five regional horizons. */
export function RegionGaugeSwitch({
  data,
  regions,
  onSelect,
}: {
  data: RecessionAnalysis;
  regions: RegionalCatalogs | null;
  onSelect?: (id: RegionId) => void;
}) {
  const [selected, setSelected] = useState<RegionId>("US");
  const choose = (id: RegionId) => {
    setSelected(id);
    onSelect?.(id);
  };
  const view = selected === "US" ? null : regionGaugeView(regions, selected);
  const region = selected === "US" ? null : regions?.regions.find(item => item.id === selected) ?? null;
  const subgroups = region ? (region.subgroups ?? buildRegionSubgroups(region.slots)) : [];

  return (
    <div className="space-y-3">
      {regions && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Region" data-testid="region-gauge-switch">
          {BUTTONS.map(btn => (
            <button
              key={btn.id}
              type="button"
              onClick={() => choose(btn.id)}
              aria-pressed={selected === btn.id}
              data-testid={`region-btn-${btn.id}`}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${selected === btn.id ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
      {selected === "US" || !view || !region ? (
        <CurrentAssessment data={data} />
      ) : (
        <div className="space-y-3" data-testid={`region-view-${view.id}`}>
          <div className="flex flex-wrap justify-center gap-3" data-testid={`region-gauges-${view.id}`}>
            {subgroups.map(sg => (
              <RegionGaugeCard key={sg.name} sg={sg} />
            ))}
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
