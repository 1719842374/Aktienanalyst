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

      {/* Cycle Progression Indicator */}
      {(() => {
        // Determine cycle phase from data signals
        const ti = data.technicalIndicators?.currentStatus;
        const rslPrices = data.historicalPrices.slice(-130).map(p => p.close);
        const rslAvg = rslPrices.length > 0 ? rslPrices.reduce((a, b) => a + b, 0) / rslPrices.length : 0;
        const rsl = rslAvg > 0 ? (data.currentPrice / rslAvg) * 100 : 100;
        const isAboveMA200 = ti?.priceAboveMA200 ?? false;
        const isGolden = ti?.ma50AboveMA200 ?? false;
        const macdPos = ti?.macdAboveZero ?? false;
        const macdRising = ti?.macdRising ?? false;
        const peVsSector = data.sectorAvgPE > 0 ? data.peRatio / data.sectorAvgPE : 1;

        // Determine phase
        let phase = '';
        let phaseColor = '';
        let phaseIcon = '';
        let phaseDetail = '';

        if (isAboveMA200 && isGolden && macdPos && rsl > 110) {
          phase = 'Sp\u00e4tzyklus / \u00dcberhitzung';
          phaseColor = 'text-red-400 bg-red-500/10 border-red-500/20';
          phaseIcon = '\u26a0';
          phaseDetail = 'Starkes Momentum (RSL ' + rsl.toFixed(0) + '), aber Zyklush\u00f6he n\u00e4hert sich. Gewinne absichern, keine neuen Positionen in Zyklikern.';
        } else if (isAboveMA200 && isGolden && macdPos) {
          phase = 'Expansion / Mittzyklus';
          phaseColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
          phaseIcon = '\u25b2';
          phaseDetail = 'Aufwärtstrend intakt (Golden Cross, MACD > 0). Zyklus schreitet voran \u2014 attraktiv f\u00fcr Wachstumswerte.';
        } else if (isAboveMA200 && !isGolden) {
          phase = 'Fr\u00fcher Abschwung';
          phaseColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
          phaseIcon = '\u25bc';
          phaseDetail = 'Kurs noch \u00fcber MA200, aber MA50 < MA200 (Death Cross). Zyklus dreht \u2014 defensive Ausrichtung.';
        } else if (!isAboveMA200 && !isGolden && !macdPos && rsl < 95) {
          phase = 'Rezession / Trough';
          phaseColor = 'text-red-400 bg-red-500/10 border-red-500/20';
          phaseIcon = '\u25cf';
          phaseDetail = 'B\u00e4renmarktbedingungen (RSL ' + rsl.toFixed(0) + ', unter MA200, Death Cross). Zykliker meiden, Qualit\u00e4tswerte akkumulieren.';
        } else if (!isAboveMA200 && macdRising) {
          phase = 'Fr\u00fche Erholung';
          phaseColor = 'text-blue-400 bg-blue-500/10 border-blue-500/20';
          phaseIcon = '\u21e7';
          phaseDetail = 'MACD dreht aufw\u00e4rts, aber Kurs noch unter MA200. Erholung k\u00f6nnte beginnen \u2014 Zykliker werden attraktiv.';
        } else {
          phase = '\u00dcbergang';
          phaseColor = 'text-muted-foreground bg-muted/30 border-border/50';
          phaseIcon = '\u2194';
          phaseDetail = 'Gemischte Signale \u2014 Zyklusphase unklar. Abwarten bis sich klarer Trend ausbildet.';
        }

        return (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Zyklusfortschritt</h3>
            <div className={`rounded-lg p-3 border ${phaseColor}`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-lg">{phaseIcon}</span>
                <span className="text-sm font-bold">{phase}</span>
              </div>
              <p className="text-[10px] text-foreground/70 leading-relaxed">{phaseDetail}</p>
              <div className="flex flex-wrap gap-3 mt-2 text-[10px]">
                <span className={isAboveMA200 ? 'text-emerald-500' : 'text-red-500'}>Kurs vs MA200: {isAboveMA200 ? 'Dar\u00fcber' : 'Darunter'}</span>
                <span className={isGolden ? 'text-emerald-500' : 'text-red-500'}>{isGolden ? 'Golden Cross' : 'Death Cross'}</span>
                <span className={macdPos ? 'text-emerald-500' : 'text-red-500'}>MACD: {macdPos ? '> 0' : '< 0'}</span>
                <span className="text-muted-foreground">RSL: {rsl.toFixed(0)}</span>
              </div>
            </div>
          </div>
        );
      })()}

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
