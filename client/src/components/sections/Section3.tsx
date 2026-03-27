import { SectionCard } from "../SectionCard";
import type { StockAnalysis } from "../../../../shared/schema";

interface Props { data: StockAnalysis }

export function Section3({ data }: Props) {
  const sp = data.sectorProfile;
  const macro = sp.macroSensitivity;

  const macroSensitivities = [
    {
      factor: "Interest Rates",
      up: `+100bp → WACC ${macro.interestUp.wacc}, DCF ${macro.interestUp.dcf}`,
      down: `-100bp → WACC ${macro.interestDown.wacc}, DCF ${macro.interestDown.dcf}`,
    },
    {
      factor: "Fiscal Policy",
      up: `Expansionary → ${macro.fiscalUp}`,
      down: `Austerity → ${macro.fiscalDown}`,
    },
    {
      factor: "Geopolitics",
      up: `De-escalation → ${macro.geoUp}`,
      down: `Escalation → ${macro.geoDown}`,
    },
  ];

  return (
    <SectionCard number={3} title="ZYKLUS- & STRUKTURANALYSE">
      {/* Cycle Classification */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Cycle Classification</h3>
        <div className="flex flex-wrap gap-2">
          <Badge label="Konjunkturell" value={sp.cycleClass} />
          <Badge label="Politisch-fiskalisch" value={sp.politicalCycle} />
        </div>
      </div>

      {/* Macro Sensitivity */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Macro Sensitivity</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Factor</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Positive Scenario</th>
                <th className="text-left py-2 px-2 text-muted-foreground font-medium">Negative Scenario</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {macroSensitivities.map((m, i) => (
                <tr key={i}>
                  <td className="py-2 px-2 font-medium">{m.factor}</td>
                  <td className="py-2 px-2 font-mono tabular-nums text-emerald-500 text-[11px]">{m.down}</td>
                  <td className="py-2 px-2 font-mono tabular-nums text-red-500 text-[11px]">{m.up}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Regulatory Notes */}
      {sp.regulatoryNotes && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Regulatory Notes</h3>
          <div className="bg-amber-500/5 rounded-md p-3 border border-amber-500/20 text-xs text-foreground/80">
            {sp.regulatoryNotes}
          </div>
        </div>
      )}

      {/* Geopolitical Risks */}
      {sp.geopoliticalRisks && sp.geopoliticalRisks.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Geopolitische Risiken & Exposure</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-2 text-muted-foreground font-medium">Ereignis</th>
                  <th className="text-left py-2 px-2 text-muted-foreground font-medium">Auswirkung auf Unternehmen</th>
                  <th className="text-center py-2 px-2 text-muted-foreground font-medium">Exposure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {sp.geopoliticalRisks.map((risk, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="py-2 px-2 font-medium min-w-[180px]">{risk.event}</td>
                    <td className="py-2 px-2 text-foreground/70 leading-relaxed">{risk.impact}</td>
                    <td className="py-2 px-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                        risk.exposure === "Hoch" ? "bg-red-500/15 text-red-500" :
                        risk.exposure === "Mittel" ? "bg-amber-500/15 text-amber-500" :
                        "bg-emerald-500/15 text-emerald-500"
                      }`}>
                        {risk.exposure}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Structural Trends */}
      <div>
        <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Structural Trends</h3>
        <div className="flex flex-wrap gap-2">
          {data.structuralTrends.map((trend, i) => (
            <span
              key={i}
              className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary border border-primary/10"
            >
              {trend}
            </span>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

function Badge({ label, value }: { label: string; value: string }) {
  const isPositive = value.toLowerCase().includes("favorable") || value.toLowerCase().includes("early") || value.toLowerCase().includes("neutral");
  const isNegative = value.toLowerCase().includes("headwind") || value.toLowerCase().includes("recession") || value.toLowerCase().includes("hoch");
  const color =
    isPositive ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/20" :
    isNegative ? "bg-red-500/15 text-red-500 border-red-500/20" :
    "bg-amber-500/15 text-amber-500 border-amber-500/20";

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs ${color}`}>
      <span className="font-medium text-muted-foreground">{label}:</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
