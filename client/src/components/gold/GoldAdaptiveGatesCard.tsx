import React from "react";
import type { GoldAnalysis, GoldModelGate } from "../../../../shared/gold-schema";

type GatesData = Pick<GoldAnalysis, "gates" | "adaptiveScore" | "realYieldModel" | "multiFactorModel">;

function gateList(data: GatesData): GoldModelGate[] {
  if (data.gates != null) return data.gates;
  const gates: GoldModelGate[] = [];
  for (const gate of data.realYieldModel?.gates ?? []) gates.push(gate);
  if (data.multiFactorModel?.gate) gates.push(data.multiFactorModel.gate);
  for (const gate of data.adaptiveScore?.gates ?? []) gates.push(gate);
  return gates;
}

export function GoldAdaptiveGatesCard({ data }: { data: GatesData }) {
  const gates = gateList(data);
  return (
    <div className="bg-card border border-card-border rounded-lg overflow-hidden" data-testid="gold-adaptive-gates">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground tracking-tight">Gates</h2>
      </div>
      <div className="px-4 pb-4 pt-3 space-y-1">
        {gates.length === 0 && <div className="text-[11px] text-muted-foreground">N/A</div>}
        {gates.map(gate => (
          <div
            key={gate.id}
            data-testid={`gold-gate-${gate.id}`}
            className={`text-[10px] px-2 py-1 rounded border ${
              gate.active
                ? "bg-red-500/10 border-red-500/20 text-red-400"
                : "bg-muted/30 border-border text-muted-foreground"
            }`}
          >
            {gate.id}: {gate.active ? "aktiv" : "inaktiv"} — {gate.rationale}
          </div>
        ))}
      </div>
    </div>
  );
}
